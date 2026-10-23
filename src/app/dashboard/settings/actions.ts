"use server";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { recordAudit } from "@/server/audit";
import { runAction, UserFacingError } from "@/server/actions";
import { auth } from "@/server/auth";
import { INTERNAL_ROLES, type InternalRole } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { orgSettings, sessions, userRoles, users } from "@/server/db/schema";
import { HEX_COLOR } from "@/server/settings";
import { authorizeInternal } from "@/server/session";

const roleList = z.array(z.enum(INTERNAL_ROLES)).min(1, "Choose at least one role");

// ─── Organisation settings ─────────────────────────────────────────────────────

const orgSchema = z.object({
  orgName: z.string().trim().min(1, "Required").max(80),
  accentColor: z.string().regex(HEX_COLOR, "Use a 6-digit hex colour, e.g. #E4572E"),
  checkInWindowMinutes: z.coerce.number().int().min(0).max(240),
  checkInGeofenceMeters: z.coerce.number().int().min(50).max(5000),
});

export async function updateOrgSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("settings.manage");
    const input = orgSchema.parse(Object.fromEntries(formData));
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(orgSettings).where(eq(orgSettings.id, 1));
      await tx
        .insert(orgSettings)
        .values({ id: 1, ...input, updatedBy: viewer.userId })
        .onConflictDoUpdate({ target: orgSettings.id, set: { ...input, updatedBy: viewer.userId } });
      await recordAudit({ actorId: viewer.userId, action: "settings.update", entityType: "org_settings", entityId: "1", before, after: input }, tx);
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Settings saved." };
  });
}

// ─── Internal users ───────────────────────────────────────────────────────────

const inviteSchema = z.object({
  name: z.string().trim().min(2, "Enter their full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  roles: roleList,
});

async function sendPasswordSetupEmail(email: string) {
  await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
}

export async function inviteInternalUser(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("users.manage");
    const input = inviteSchema.parse({
      name: formData.get("name"),
      email: formData.get("email"),
      roles: formData.getAll("roles"),
    });

    const [existing] = await db
      .select({ id: users.id, kind: users.kind })
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email));
    if (existing) {
      throw new UserFacingError(
        existing.kind === "staff"
          ? "That email belongs to a field staff account. Use a work email for the RGXM team account."
          : "A team member with that email already exists.",
      );
    }

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ name: input.name, email: input.email, kind: "internal", emailVerified: true })
        .returning({ id: users.id });
      await tx.insert(userRoles).values(input.roles.map((role) => ({ userId: created!.id, role, grantedBy: viewer.userId })));
      await recordAudit(
        { actorId: viewer.userId, action: "user.invite", entityType: "user", entityId: created!.id, after: input },
        tx,
      );
    });
    await sendPasswordSetupEmail(input.email);
    revalidatePath("/dashboard/settings/users");
    return { ok: true, message: `Invitation sent to ${input.email}.` };
  });
}

export async function resendInvite(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("users.manage");
    const [u] = await db.select({ email: users.email, kind: users.kind }).from(users).where(eq(users.id, userId));
    if (!u || u.kind !== "internal") throw new UserFacingError("User not found.");
    await sendPasswordSetupEmail(u.email);
    await recordAudit({ actorId: viewer.userId, action: "user.password_link_sent", entityType: "user", entityId: userId });
    return { ok: true, message: `Password link sent to ${u.email}.` };
  });
}

async function countOtherActiveAdmins(excludingUserId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.role, "admin"), eq(users.status, "active"), ne(users.id, excludingUserId)));
  return row?.n ?? 0;
}

export async function updateUserRoles(userId: string, roles: InternalRole[]): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("users.manage");
    const next = roleList.parse(roles);
    const current = (await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role);
    if (current.includes("admin") && !next.includes("admin")) {
      if (userId === viewer.userId) throw new UserFacingError("You can't remove your own administrator role.");
      if ((await countOtherActiveAdmins(userId)) === 0) throw new UserFacingError("At least one active administrator is required.");
    }
    const toAdd = next.filter((r) => !current.includes(r));
    const toRemove = current.filter((r) => !next.includes(r));
    await db.transaction(async (tx) => {
      if (toRemove.length) {
        await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.role, toRemove)));
      }
      if (toAdd.length) {
        await tx.insert(userRoles).values(toAdd.map((role) => ({ userId, role, grantedBy: viewer.userId })));
      }
      await recordAudit(
        { actorId: viewer.userId, action: "user.roles_update", entityType: "user", entityId: userId, before: current, after: next },
        tx,
      );
    });
    revalidatePath("/dashboard/settings/users");
    return { ok: true, message: "Roles updated." };
  });
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("users.manage");
    if (userId === viewer.userId) throw new UserFacingError("You can't deactivate your own account.");
    if (!active) {
      const [isAdmin] = await db
        .select({ n: count() })
        .from(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.role, "admin")));
      if ((isAdmin?.n ?? 0) > 0 && (await countOtherActiveAdmins(userId)) === 0) {
        throw new UserFacingError("At least one active administrator is required.");
      }
    }
    await db.transaction(async (tx) => {
      await tx.update(users).set({ status: active ? "active" : "inactive" }).where(and(eq(users.id, userId), eq(users.kind, "internal")));
      // Deactivation signs the person out everywhere immediately.
      if (!active) await tx.delete(sessions).where(eq(sessions.userId, userId));
      await recordAudit(
        { actorId: viewer.userId, action: active ? "user.reactivate" : "user.deactivate", entityType: "user", entityId: userId },
        tx,
      );
    });
    revalidatePath("/dashboard/settings/users");
    return { ok: true, message: active ? "Account reactivated." : "Account deactivated and signed out." };
  });
}
