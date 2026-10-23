import { and, asc, count, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { bookings, clients, payableItems, projects, shifts, staffProfiles, timesheets } from "@/server/db/schema";

const ACTIVE_PROJECT_STATUSES = ["staffing", "confirmed", "live"] as const;

export async function getOverview(now = new Date()) {
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [[activeStaff], [activeProjects], [upcomingShifts], [openPositions], [awaitingApproval], [unpaid], [demo]] =
    await Promise.all([
      db.select({ n: count() }).from(staffProfiles).where(eq(staffProfiles.status, "active")),
      db.select({ n: count() }).from(projects).where(inArray(projects.status, [...ACTIVE_PROJECT_STATUSES])),
      db
        .select({ n: count() })
        .from(shifts)
        .where(and(gte(shifts.startsAt, now), lt(shifts.startsAt, horizon), ne(shifts.status, "cancelled"))),
      db
        .select({
          n: sql<number>`coalesce(sum(greatest(${shifts.headcount} - coalesce(c.confirmed, 0), 0)), 0)::int`,
        })
        .from(shifts)
        .leftJoin(
          db
            .select({ shiftId: bookings.shiftId, confirmed: sql<number>`count(*)::int`.as("confirmed") })
            .from(bookings)
            .where(eq(bookings.status, "confirmed"))
            .groupBy(bookings.shiftId)
            .as("c"),
          sql`c.shift_id = ${shifts.id}`,
        )
        .where(and(gte(shifts.startsAt, now), ne(shifts.status, "cancelled"))),
      db
        .select({ n: count() })
        .from(timesheets)
        .where(inArray(timesheets.status, ["submitted", "needs_review", "supervisor_verified"])),
      db
        .select({ n: count(), total: sql<number>`coalesce(sum(${payableItems.totalCents}), 0)::bigint` })
        .from(payableItems)
        .where(inArray(payableItems.status, ["pending", "batched", "exported"])),
      db.select({ n: count() }).from(staffProfiles).where(eq(staffProfiles.isDemo, true)),
    ]);

  const projectList = await db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      status: projects.status,
      startDate: projects.startDate,
      endDate: projects.endDate,
      client: clients.name,
      isDemo: projects.isDemo,
    })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(ne(projects.status, "cancelled"))
    .orderBy(asc(projects.startDate))
    .limit(6);

  return {
    activeStaff: activeStaff?.n ?? 0,
    activeProjects: activeProjects?.n ?? 0,
    upcomingShifts: upcomingShifts?.n ?? 0,
    openPositions: Number(openPositions?.n ?? 0),
    awaitingApproval: awaitingApproval?.n ?? 0,
    unpaidCount: unpaid?.n ?? 0,
    unpaidCents: Number(unpaid?.total ?? 0),
    hasDemoData: (demo?.n ?? 0) > 0,
    projects: projectList,
  };
}
