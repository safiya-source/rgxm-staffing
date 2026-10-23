import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/server/db";
import { bookings, clients, projectLocations, projectMembers, projects, shifts, staffingRequirements, users } from "@/server/db/schema";

const owner = alias(users, "owner");
const coordinator = alias(users, "coordinator");

/** Estimated cost of all non-cancelled scheduled positions, in cents. Shifts without a rate are excluded and counted. */
const scheduledCost = sql<number>`coalesce((select sum(round(s.headcount * extract(epoch from (s.ends_at - s.starts_at)) / 3600.0 * s.rate_cents))
  from ${shifts} s where s.project_id = ${projects.id} and s.status <> 'cancelled' and s.rate_cents is not null), 0)::bigint`;

export async function listProjects(f: { q?: string; status?: string; mine?: string; userId: string }) {
  const conds: SQL[] = [];
  if (f.status === "active") conds.push(inArray(projects.status, ["draft", "staffing", "confirmed", "live"]));
  else if (f.status && f.status !== "all") conds.push(eq(projects.status, f.status as (typeof projects.status.enumValues)[number]));
  if (f.q) {
    const pattern = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(projects.name, pattern), ilike(projects.code, pattern), ilike(clients.name, pattern), ilike(projects.campaignName, pattern))!);
  }
  if (f.mine) {
    conds.push(
      or(
        eq(projects.ownerId, f.userId),
        eq(projects.coordinatorId, f.userId),
        sql`exists (select 1 from ${projectMembers} m where m.project_id = ${projects.id} and m.user_id = ${f.userId})`,
      )!,
    );
  }

  return db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      status: projects.status,
      startDate: projects.startDate,
      endDate: projects.endDate,
      budgetCents: projects.budgetCents,
      currency: projects.currency,
      isDemo: projects.isDemo,
      client: clients.name,
      ownerName: owner.name,
      locations: sql<number>`(select count(*)::int from ${projectLocations} l where l.project_id = ${projects.id})`,
      positions: sql<number>`(select coalesce(sum(s.headcount), 0)::int from ${shifts} s where s.project_id = ${projects.id} and s.status <> 'cancelled')`,
      confirmed: sql<number>`(select count(*)::int from ${bookings} b join ${shifts} s on s.id = b.shift_id where b.project_id = ${projects.id} and s.status <> 'cancelled' and b.status in ('confirmed', 'completed'))`,
      estimatedCents: scheduledCost,
    })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(owner, eq(owner.id, projects.ownerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${projects.startDate} is null`, desc(projects.startDate), asc(projects.name))
    .limit(200);
}

export async function getProjectHeader(projectId: string) {
  const [row] = await db
    .select({
      project: projects,
      client: clients.name,
      ownerName: owner.name,
      coordinatorName: coordinator.name,
    })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(owner, eq(owner.id, projects.ownerId))
    .leftJoin(coordinator, eq(coordinator.id, projects.coordinatorId))
    .where(eq(projects.id, projectId));
  return row ?? null;
}

export async function getProjectSetup(projectId: string) {
  const [locations, requirements, members, team, clientList] = await Promise.all([
    db.select().from(projectLocations).where(eq(projectLocations.projectId, projectId)).orderBy(asc(projectLocations.name)),
    db.select().from(staffingRequirements).where(eq(staffingRequirements.projectId, projectId)).orderBy(asc(staffingRequirements.role)),
    db
      .select({ userId: users.id, name: users.name, email: users.email })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId)),
    getInternalUsers(),
    getClients(),
  ]);
  return { locations, requirements, members, team, clients: clientList };
}

export async function getInternalUsers() {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.kind, "internal"), eq(users.status, "active")))
    .orderBy(asc(users.name));
}

/** Per role (and location): required people, scheduled positions, confirmed and pending. */
export async function getProjectCoverage(projectId: string) {
  const [byRole, totals, reqs] = await Promise.all([
    db
      .select({
        role: shifts.role,
        locationId: shifts.locationId,
        shifts: sql<number>`count(*)::int`,
        positions: sql<number>`sum(${shifts.headcount})::int`,
        confirmed: sql<number>`coalesce(sum((select count(*) from ${bookings} b where b.shift_id = ${shifts.id} and b.status in ('confirmed', 'completed'))), 0)::int`,
        pending: sql<number>`coalesce(sum((select count(*) from ${bookings} b where b.shift_id = ${shifts.id} and b.status in ('offered', 'interested', 'awaiting_confirmation'))), 0)::int`,
        estimatedCents: sql<number>`coalesce(sum(round(${shifts.headcount} * extract(epoch from (${shifts.endsAt} - ${shifts.startsAt})) / 3600.0 * ${shifts.rateCents})), 0)::bigint`,
        unpricedShifts: sql<number>`count(*) filter (where ${shifts.rateCents} is null)::int`,
      })
      .from(shifts)
      .where(and(eq(shifts.projectId, projectId), ne(shifts.status, "cancelled")))
      .groupBy(shifts.role, shifts.locationId),
    db
      .select({
        upcoming: sql<number>`count(*) filter (where ${shifts.startsAt} > now())::int`,
        drafts: sql<number>`count(*) filter (where ${shifts.status} = 'draft')::int`,
        first: sql<Date | null>`min(${shifts.startsAt})`,
        last: sql<Date | null>`max(${shifts.endsAt})`,
      })
      .from(shifts)
      .where(and(eq(shifts.projectId, projectId), ne(shifts.status, "cancelled"))),
    db.select().from(staffingRequirements).where(eq(staffingRequirements.projectId, projectId)),
  ]);
  return { byRole: byRole.map((r) => ({ ...r, estimatedCents: Number(r.estimatedCents) })), totals: totals[0]!, requirements: reqs };
}

export async function getProjectsForSelect(opts: { includeClosed?: boolean } = {}) {
  return db
    .select({ id: projects.id, name: projects.name, code: projects.code })
    .from(projects)
    .where(opts.includeClosed ? undefined : inArray(projects.status, ["draft", "staffing", "confirmed", "live", "completed"]))
    .orderBy(desc(projects.startDate));
}

export async function getClients() {
  return db.select({ id: clients.id, name: clients.name }).from(clients).where(sql`${clients.archivedAt} is null`).orderBy(asc(clients.name));
}
