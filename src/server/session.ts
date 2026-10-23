// Request-scoped identity + authorisation helpers for server components and actions.
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/server/auth";
import {
  canAny,
  canOnProject,
  type Actor,
  type InternalRole,
  type Permission,
  type ProjectScope,
} from "@/server/authz/permissions";
import { db } from "@/server/db";
import { projectMembers, projects, staffProfiles, userRoles, users } from "@/server/db/schema";

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type Viewer = {
  userId: string;
  name: string;
  email: string;
  kind: "internal" | "staff";
  twoFactorEnabled: boolean;
  roles: InternalRole[];
  staff: { id: string; firstName: string; preferredName: string | null; onboarded: boolean } | null;
};

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      kind: users.kind,
      status: users.status,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(users)
    .where(eq(users.id, session.user.id));
  if (!user || user.status !== "active") return null;

  const roleRows =
    user.kind === "internal"
      ? await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, user.id))
      : [];

  const [staff] = await db
    .select({
      id: staffProfiles.id,
      firstName: staffProfiles.firstName,
      preferredName: staffProfiles.preferredName,
      onboardingCompletedAt: staffProfiles.onboardingCompletedAt,
    })
    .from(staffProfiles)
    .where(eq(staffProfiles.userId, user.id));

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    kind: user.kind,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    roles: roleRows.map((r) => r.role),
    staff: staff
      ? {
          id: staff.id,
          firstName: staff.firstName,
          preferredName: staff.preferredName,
          onboarded: Boolean(staff.onboardingCompletedAt),
        }
      : null,
  };
});

export function toActor(viewer: Viewer): Actor {
  return { userId: viewer.userId, roles: viewer.roles };
}

/** Where a signed-in user belongs. */
export function homeFor(viewer: Viewer) {
  return viewer.kind === "internal" ? "/dashboard" : viewer.staff?.onboarded ? "/portal" : "/portal/onboarding";
}

// ─── Page guards (redirect) ───────────────────────────────────────────────────────

export async function requireInternal(permission?: Permission): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  if (viewer.kind !== "internal") redirect(homeFor(viewer));
  if (permission && !canAny(toActor(viewer), permission)) redirect("/dashboard?denied=1");
  return viewer;
}

export async function requireStaff(opts: { allowIncompleteOnboarding?: boolean } = {}): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  if (viewer.kind !== "staff") redirect(homeFor(viewer));
  if (!opts.allowIncompleteOnboarding && !viewer.staff?.onboarded) redirect("/portal/onboarding");
  return viewer;
}

// ─── Action guards (throw) ────────────────────────────────────────────────────────

export async function authorizeInternal(permission: Permission): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer || viewer.kind !== "internal") throw new ForbiddenError("Please sign in.");
  if (!canAny(toActor(viewer), permission)) throw new ForbiddenError();
  return viewer;
}

export async function loadProjectScopes(projectIds: string[]): Promise<Map<string, ProjectScope>> {
  const map = new Map<string, ProjectScope>();
  if (projectIds.length === 0) return map;
  const rows = await db
    .select({ id: projects.id, ownerId: projects.ownerId, coordinatorId: projects.coordinatorId })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  const members = await db
    .select({ projectId: projectMembers.projectId, userId: projectMembers.userId })
    .from(projectMembers)
    .where(inArray(projectMembers.projectId, projectIds));
  for (const r of rows) map.set(r.id, { ownerId: r.ownerId, coordinatorId: r.coordinatorId, memberIds: [] });
  for (const m of members) (map.get(m.projectId)?.memberIds as string[] | undefined)?.push(m.userId);
  return map;
}

export async function authorizeProject(permission: Permission, projectId: string): Promise<Viewer> {
  const viewer = await authorizeInternal(permission);
  const scope = (await loadProjectScopes([projectId])).get(projectId);
  if (!scope || !canOnProject(toActor(viewer), permission, scope)) throw new ForbiddenError();
  return viewer;
}
