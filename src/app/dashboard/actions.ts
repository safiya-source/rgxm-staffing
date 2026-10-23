"use server";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { canAny } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { clients, notifications, projects, staffProfiles } from "@/server/db/schema";
import { authorizeInternal, toActor } from "@/server/session";

export type SearchResult = { type: "staff" | "project"; id: string; title: string; subtitle: string; href: string };

export async function globalSearch(query: string): Promise<SearchResult[]> {
  const viewer = await authorizeInternal("project.view");
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const actor = toActor(viewer);
  const results: SearchResult[] = [];

  if (canAny(actor, "talent.view")) {
    const staff = await db
      .select({
        id: staffProfiles.id,
        firstName: staffProfiles.firstName,
        lastName: staffProfiles.lastName,
        preferredName: staffProfiles.preferredName,
        city: staffProfiles.city,
        email: staffProfiles.email,
      })
      .from(staffProfiles)
      .where(
        or(
          ilike(sql`${staffProfiles.firstName} || ' ' || ${staffProfiles.lastName}`, pattern),
          ilike(staffProfiles.preferredName, pattern),
          ilike(staffProfiles.email, pattern),
        ),
      )
      .orderBy(staffProfiles.lastName)
      .limit(6);
    for (const s of staff) {
      results.push({
        type: "staff",
        id: s.id,
        title: `${s.preferredName ?? s.firstName} ${s.lastName}`,
        subtitle: [s.city, s.email].filter(Boolean).join(" · "),
        href: `/dashboard/talent/${s.id}`,
      });
    }
  }

  const projectRows = await db
    .select({ id: projects.id, name: projects.name, code: projects.code, client: clients.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(or(ilike(projects.name, pattern), ilike(projects.code, pattern), ilike(clients.name, pattern)))
    .orderBy(desc(projects.startDate))
    .limit(6);
  for (const p of projectRows) {
    results.push({
      type: "project",
      id: p.id,
      title: p.name,
      subtitle: [p.code, p.client].filter(Boolean).join(" · "),
      href: `/dashboard/projects/${p.id}`,
    });
  }
  return results;
}

export async function markAllNotificationsRead() {
  const viewer = await authorizeInternal("project.view");
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, viewer.userId), isNull(notifications.readAt)));
}
