import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/server/db";
import { accounts, userRoles, users } from "@/server/db/schema";
import { requireInternal } from "@/server/session";
import { UsersTable, type TeamMember } from "./users-table";

export const metadata: Metadata = { title: "Team & roles" };

export default async function UsersPage() {
  const viewer = await requireInternal("users.manage");
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      twoFactorEnabled: users.twoFactorEnabled,
      lastSignInAt: users.lastSignInAt,
      isDemo: users.isDemo,
    })
    .from(users)
    .where(eq(users.kind, "internal"))
    .orderBy(asc(users.name));
  const roles = await db.select().from(userRoles);
  const credentials = await db.select({ userId: accounts.userId }).from(accounts).where(eq(accounts.providerId, "credential"));
  const hasPassword = new Set(credentials.map((c) => c.userId));

  const members: TeamMember[] = rows.map((r) => ({
    ...r,
    twoFactorEnabled: Boolean(r.twoFactorEnabled),
    lastSignInAt: r.lastSignInAt?.toISOString() ?? null,
    roles: roles.filter((x) => x.userId === r.id).map((x) => x.role),
    invitePending: !hasPassword.has(r.id),
  }));

  return <UsersTable members={members} currentUserId={viewer.userId} />;
}
