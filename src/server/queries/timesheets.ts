import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { resolveGrant, type Actor, type Permission } from "@/server/authz/permissions";
import { db } from "@/server/db";
import {
  attendanceEvents,
  bookings,
  projectLocations,
  projectMembers,
  projects,
  shifts,
  staffProfiles,
  timesheetAdjustments,
  timesheets,
  users,
} from "@/server/db/schema";

/** Project ids an actor may see timesheets for, or null for all. */
export function timesheetProjectScope(actor: Actor) {
  return projectScope(actor, "timesheet.view");
}

/** null = every project; otherwise the projects this person is assigned to (empty = none). */
export async function projectScope(actor: Actor, permission: Permission): Promise<string[] | null> {
  const grant = resolveGrant(actor.roles, permission);
  if (grant === "all") return null;
  if (grant !== "assigned") return [];
  const rows = await db
    .selectDistinct({ id: projects.id })
    .from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)))
    .where(or(eq(projects.ownerId, actor.userId), eq(projects.coordinatorId, actor.userId), eq(projectMembers.userId, actor.userId)));
  return rows.map((r) => r.id);
}

export const TIMESHEET_VIEWS = {
  review: { label: "To approve", statuses: ["submitted", "supervisor_verified", "needs_review"] },
  open: { label: "Not submitted", statuses: ["not_started", "in_progress"] },
  approved: { label: "Approved", statuses: ["approved", "locked", "exported", "paid"] },
  all: { label: "All", statuses: null },
} as const;
export type TimesheetView = keyof typeof TIMESHEET_VIEWS;

/** Bookings whose shift has started, with their timesheet (if one exists yet). */
export async function listTimesheets(f: { view: TimesheetView; projectId?: string; from?: Date; to?: Date; scope: string[] | null; now?: Date }) {
  const now = f.now ?? new Date();
  const conds: SQL[] = [inArray(bookings.status, ["confirmed", "completed", "no_show"]), lt(bookings.startsAt, now)];
  if (f.scope) conds.push(f.scope.length ? inArray(bookings.projectId, f.scope) : sql`false`);
  if (f.projectId) conds.push(eq(bookings.projectId, f.projectId));
  if (f.from) conds.push(gte(bookings.startsAt, f.from));
  if (f.to) conds.push(lt(bookings.startsAt, f.to));
  const statuses = TIMESHEET_VIEWS[f.view].statuses as readonly (typeof timesheets.status.enumValues)[number][] | null;
  if (statuses) {
    // Bookings without a timesheet row yet count as "not started"; no-shows are never "open".
    conds.push(
      statuses.includes("not_started")
        ? and(or(isNull(timesheets.status), inArray(timesheets.status, [...statuses]))!, ne(bookings.status, "no_show"))!
        : inArray(timesheets.status, [...statuses]),
    );
  }
  return db
    .select({
      bookingId: bookings.id,
      bookingStatus: bookings.status,
      role: bookings.role,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      agreedRateCents: bookings.agreedRateCents,
      timezone: shifts.timezone,
      projectId: projects.id,
      projectName: projects.name,
      locationName: projectLocations.name,
      staffId: staffProfiles.id,
      staffName: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`,
      timesheetId: timesheets.id,
      status: sql<string>`coalesce(${timesheets.status}::text, 'not_started')`,
      actualStart: timesheets.actualStart,
      actualEnd: timesheets.actualEnd,
      workedStart: timesheets.workedStart,
      workedEnd: timesheets.workedEnd,
      breakMinutes: timesheets.breakMinutes,
      payableMinutes: timesheets.payableMinutes,
      flags: timesheets.flags,
    })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .innerJoin(staffProfiles, eq(staffProfiles.id, bookings.staffId))
    .leftJoin(timesheets, eq(timesheets.bookingId, bookings.id))
    .where(and(...conds))
    .orderBy(desc(bookings.startsAt), asc(staffProfiles.lastName))
    .limit(500);
}
export type TimesheetRow = Awaited<ReturnType<typeof listTimesheets>>[number];

export async function getTimesheetDetail(bookingId: string) {
  const [row] = await db
    .select({
      booking: bookings,
      shift: shifts,
      projectName: projects.name,
      locationName: projectLocations.name,
      staffName: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`,
      staffUserId: staffProfiles.userId,
      timesheet: timesheets,
    })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .innerJoin(staffProfiles, eq(staffProfiles.id, bookings.staffId))
    .leftJoin(timesheets, eq(timesheets.bookingId, bookings.id))
    .where(eq(bookings.id, bookingId));
  if (!row) return null;
  const [events, adjustments] = await Promise.all([
    db
      .select({ e: attendanceEvents, by: users.name })
      .from(attendanceEvents)
      .leftJoin(users, eq(users.id, attendanceEvents.recordedBy))
      .where(eq(attendanceEvents.bookingId, bookingId))
      .orderBy(asc(attendanceEvents.occurredAt)),
    row.timesheet
      ? db
          .select({ a: timesheetAdjustments, by: users.name })
          .from(timesheetAdjustments)
          .leftJoin(users, eq(users.id, timesheetAdjustments.actorId))
          .where(eq(timesheetAdjustments.timesheetId, row.timesheet.id))
          .orderBy(asc(timesheetAdjustments.createdAt))
      : [],
  ]);
  const ids = [row.timesheet?.verifiedBy, row.timesheet?.approvedBy].filter((x): x is string => Boolean(x));
  const people = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  return { ...row, events, adjustments, nameOf: Object.fromEntries(people.map((p) => [p.id, p.name])) as Record<string, string> };
}
