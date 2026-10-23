"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { PROVINCE_CODES } from "@/lib/provinces";
import { FIELD_ROLES } from "@/lib/roles";
import { recordAudit } from "@/server/audit";
import { runAction } from "@/server/actions";
import { db } from "@/server/db";
import * as availability from "@/server/domain/availability";
import { staffProfiles, staffRoles, users } from "@/server/db/schema";
import { ForbiddenError, getViewer } from "@/server/session";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(60),
  lastName: z.string().trim().min(1, "Required").max(60),
  preferredName: optional(60),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()\-.]{10,20}$/, "Enter a valid phone number"),
  city: z.string().trim().min(1, "Required").max(80),
  province: z.enum(PROVINCE_CODES),
  roles: z.array(z.enum(FIELD_ROLES)).min(1, "Choose at least one role"),
});

export async function saveStaffProfile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const mode = formData.get("mode") === "onboarding" ? "onboarding" : "profile";
  const result = await runAction(async (): Promise<ActionResult> => {
    const viewer = await getViewer();
    if (!viewer || viewer.kind !== "staff") throw new ForbiddenError("Please sign in.");
    if (mode === "onboarding" && formData.get("consent") !== "on") {
      return { ok: false, error: "Please confirm you've read the privacy notice.", fieldErrors: { consent: ["Required"] } };
    }
    const input = profileSchema.parse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      preferredName: formData.get("preferredName"),
      phone: formData.get("phone"),
      city: formData.get("city"),
      province: formData.get("province"),
      roles: formData.getAll("roles"),
    });
    const { roles, ...fields } = input;

    await db.transaction(async (tx) => {
      let staffId = viewer.staff?.id;
      if (staffId) {
        await tx
          .update(staffProfiles)
          .set({ ...fields, ...(viewer.staff?.onboarded ? {} : { onboardingCompletedAt: new Date() }) })
          .where(eq(staffProfiles.id, staffId));
      } else {
        const [created] = await tx
          .insert(staffProfiles)
          .values({ ...fields, email: viewer.email, userId: viewer.userId, onboardingCompletedAt: new Date() })
          .returning({ id: staffProfiles.id });
        staffId = created!.id;
      }
      await tx.delete(staffRoles).where(eq(staffRoles.staffId, staffId));
      await tx.insert(staffRoles).values(roles.map((role) => ({ staffId: staffId!, role })));
      await tx.update(users).set({ name: `${fields.firstName} ${fields.lastName}` }).where(eq(users.id, viewer.userId));
      await recordAudit(
        {
          actorId: viewer.userId,
          action: viewer.staff ? "staff.profile_update" : "staff.register",
          entityType: "staff_profile",
          entityId: staffId,
          after: input,
        },
        tx,
      );
    });
    revalidatePath("/portal", "layout");
    return { ok: true, message: "Profile saved." };
  });
  if (result.ok && mode === "onboarding") redirect("/portal");
  return result;
}

// ─── Availability ───────────────────────────────────────────────────────────

async function requireStaffViewer() {
  const viewer = await getViewer();
  if (!viewer || viewer.kind !== "staff" || !viewer.staff) throw new ForbiddenError("Please sign in.");
  return { userId: viewer.userId, staffId: viewer.staff.id };
}

export async function saveWeeklyAvailabilityAction(rules: { weekday: number; startTime: string; endTime: string }[]): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    const parsed = availability.weeklySchema.safeParse(rules);
    if (!parsed.success) return { ok: false, error: "Each day needs an end time after its start time." };
    await availability.saveWeeklyAvailability(me.userId, me.staffId, parsed.data);
    revalidatePath("/portal/availability");
    return { ok: true, message: "Weekly availability saved." };
  });
}

export async function addAvailabilityExceptionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    const allDay = formData.get("allDay") === "on";
    const text = (k: string) => String(formData.get(k) ?? "").trim() || null;
    const parsed = availability.exceptionSchema.safeParse({
      date: formData.get("date"),
      kind: formData.get("kind"),
      startTime: allDay ? null : text("startTime"),
      endTime: allDay ? null : text("endTime"),
      note: text("note"),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the date and times." };
    try {
      await availability.addAvailabilityException(me.userId, me.staffId, parsed.data);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't save that date." };
    }
    revalidatePath("/portal/availability");
    return { ok: true, message: "Saved." };
  });
}

export async function removeAvailabilityExceptionAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    await availability.removeAvailabilityException(me.userId, me.staffId, z.string().uuid().parse(id));
    revalidatePath("/portal/availability");
    return { ok: true, message: "Removed." };
  });
}
