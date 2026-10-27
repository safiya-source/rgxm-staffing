// Read models for the Staffing Requests screens.
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { availabilityOnDate, type AvailabilityStatus } from "@/lib/availability";
import { utcToZoned } from "@/lib/time";
import { db } from "@/server/db";
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  clients,
  messageThreads,
  offerResponses,
  projectLocations,
  projectRates,
  projects,
  shifts,
  staffProfiles,
  users,
} from "@/server/db/schema";
import { resolveRates } from "@/server/domain/bookings";
import { talentWhere, type TalentFilters } from "@/server/domain/talent-search";

/** Projects with upcoming shifts and what needs attention on each. */
export async function getStaffingOverview(now = new Date()) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      status: projects.status,
      client: clients.name,
      isDemo: projects.isDemo,
      nextShift: sql<Date | null>`min(${shifts.startsAt})`,
      positions: sql<number>`coalesce(sum(${shifts.headcount}), 0)::int`,
      confirmed: sql<number>`coalesce(sum((select count(*) from ${bookings} b where b.shift_id = ${shifts.id} and b.status = 'confirmed')), 0)::int`,
      offered: sql<number>`coalesce(sum((select count(*) from ${bookings} b where b.shift_id = ${shifts.id} and b.status = 'offered')), 0)::int`,
      toReview: sql<number>`coalesce(sum((select count(*) from ${bookings} b where b.shift_id = ${shifts.id} and b.status in ('interested', 'awaiting_confirmation'))), 0)::int`,
      waitlisted: sql<number>`coalesce(sum((select count(*) from ${bookings} b where b.shift_id = ${shifts.id} and b.status = 'waitlisted')), 0)::int`,
      unreadQuestions: sql<number>`(select count(*)::int from ${messageThreads} t where t.project_id = ${projects.id} and t.last_message_at > coalesce(t.rgxm_last_read_at, 'epoch'::timestamptz))`,
    })
    .from(projects)
    .innerJoin(shifts, and(eq(shifts.projectId, projects.id), ne(shifts.status, "cancelled"), ne(shifts.status, "draft"), gte(shifts.endsAt, now)))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .groupBy(projects.id, clients.name)
    .orderBy(sql`min(${shifts.startsAt})`);
}

export type ShiftGroup = {
  key: string;
  role: string;
  locationId: string;
  locationName: string;
  timezone: string;
  shifts: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    headcount: number;
    rateCents: number | null;
    status: string;
    confirmed: number;
    pending: number;
  }[];
};

/** Upcoming, published shifts grouped by role and location (one group = one staffing request). */
export async function getShiftGroups(projectId: string, now = new Date()): Promise<ShiftGroup[]> {
  const rows = await db
    .select({
      id: shifts.id,
      role: shifts.role,
      locationId: shifts.locationId,
      locationName: projectLocations.name,
      timezone: shifts.timezone,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      headcount: shifts.headcount,
      rateCents: shifts.rateCents,
      status: shifts.status,
      confirmed: sql<number>`(select count(*)::int from ${bookings} b where b.shift_id = ${shifts.id} and b.status = 'confirmed')`,
      pending: sql<number>`(select count(*)::int from ${bookings} b where b.shift_id = ${shifts.id} and b.status in ('offered', 'interested', 'awaiting_confirmation'))`,
    })
    .from(shifts)
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .where(and(eq(shifts.projectId, projectId), inArray(shifts.status, ["open", "filled", "live"]), gte(shifts.endsAt, now)))
    .orderBy(asc(shifts.startsAt));
  const groups = new Map<string, ShiftGroup>();
  for (const r of rows) {
    const key = `${r.role}:${r.locationId}`;
    if (!groups.has(key)) groups.set(key, { key, role: r.role, locationId: r.locationId, locationName: r.locationName, timezone: r.timezone, shifts: [] });
    groups.get(key)!.shifts.push(r);
  }
  const order = ["BA", "TL", "PA", "AM"];
  return [...groups.values()].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.locationName.localeCompare(b.locationName));
}

/** Every booking (any status) on the given shifts, with the latest response note. */
export async function getBoard(shiftIds: string[]) {
  if (!shiftIds.length) return [];
  return db
    .select({
      id: bookings.id,
      shiftId: bookings.shiftId,
      staffId: bookings.staffId,
      status: bookings.status,
      offeredRateCents: bookings.offeredRateCents,
      agreedRateCents: bookings.agreedRateCents,
      rateSource: bookings.rateSource,
      responseDeadline: bookings.responseDeadline,
      offeredAt: bookings.offeredAt,
      respondedAt: bookings.respondedAt,
      confirmedAt: bookings.confirmedAt,
      waitlistPosition: bookings.waitlistPosition,
      overrideReason: bookings.overrideReason,
      cancelReason: bookings.cancelReason,
      cancelledByStaff: bookings.cancelledByStaff,
      createdAt: bookings.createdAt,
      name: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`,
      phone: staffProfiles.phone,
      city: staffProfiles.city,
      isDemo: staffProfiles.isDemo,
      lastQuestion: sql<string | null>`(select r.message from ${offerResponses} r where r.booking_id = ${bookings.id} and r.response = 'more_info' order by r.created_at desc limit 1)`,
    })
    .from(bookings)
    .innerJoin(staffProfiles, eq(staffProfiles.id, bookings.staffId))
    .where(inArray(bookings.shiftId, shiftIds))
    .orderBy(asc(staffProfiles.lastName), desc(bookings.createdAt));
}
export type BoardRow = Awaited<ReturnType<typeof getBoard>>[number];

export type Candidate = {
  id: string;
  name: string;
  city: string | null;
  sameCity: boolean;
  completedShifts: number;
  lastShiftAt: Date | null;
  isDemo: boolean;
  /** Per selected shift. */
  perShift: Record<
    string,
    { availability: AvailabilityStatus; conflict: boolean; existingStatus: string | null; rateCents: number | null; rateSource: string | null }
  >;
};

/**
 * People qualified for the role who could be offered the selected shifts, with objective facts
 * (availability, conflicts, rate, existing offers). No scoring or ranking beyond these facts.
 */
export async function getCandidates(
  shiftIds: string[],
  filters: TalentFilters,
  opts: { timeZone: string; limit?: number },
): Promise<{ candidates: Candidate[]; total: number }> {
  const selected = await db
    .select({ id: shifts.id, projectId: shifts.projectId, role: shifts.role, startsAt: shifts.startsAt, endsAt: shifts.endsAt, timezone: shifts.timezone, rateCents: shifts.rateCents, city: projectLocations.city })
    .from(shifts)
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .where(inArray(shifts.id, shiftIds));
  if (!selected.length) return { candidates: [], total: 0 };
  const role = selected[0]!.role;

  const where = talentWhere({ ...filters, role, status: "active", availableOn: undefined, noConflicts: false, page: 1 }, { canFilterRates: false, timeZone: opts.timeZone });
  const people = await db
    .select({
      id: staffProfiles.id,
      firstName: staffProfiles.firstName,
      preferredName: staffProfiles.preferredName,
      lastName: staffProfiles.lastName,
      city: staffProfiles.city,
      isDemo: staffProfiles.isDemo,
      completedShifts: sql<number>`(select count(*)::int from ${bookings} b where b.staff_id = ${staffProfiles.id} and b.status = 'completed')`,
      lastShiftAt: sql<Date | null>`(select max(b.starts_at) from ${bookings} b where b.staff_id = ${staffProfiles.id} and b.status = 'completed')`,
    })
    .from(staffProfiles)
    .where(where)
    .orderBy(asc(staffProfiles.lastName), asc(staffProfiles.firstName))
    .limit(opts.limit ?? 400);
  const ids = people.map((p) => p.id);
  if (!ids.length) return { candidates: [], total: 0 };

  const windowStart = selected.reduce((m, s) => (s.startsAt < m ? s.startsAt : m), selected[0]!.startsAt);
  const windowEnd = selected.reduce((m, s) => (s.endsAt > m ? s.endsAt : m), selected[0]!.endsAt);
  const [rules, exceptions, confirmed, existing, rates] = await Promise.all([
    db.select().from(availabilityRules).where(inArray(availabilityRules.staffId, ids)),
    db.select().from(availabilityExceptions).where(inArray(availabilityExceptions.staffId, ids)),
    db
      .select({ staffId: bookings.staffId, shiftId: bookings.shiftId, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
      .from(bookings)
      .where(
        and(
          inArray(bookings.staffId, ids),
          inArray(bookings.status, ["confirmed", "completed"]),
          sql`${bookings.startsAt} < ${windowEnd.toISOString()}::timestamptz and ${bookings.endsAt} > ${windowStart.toISOString()}::timestamptz`,
        ),
      ),
    db
      .select({ staffId: bookings.staffId, shiftId: bookings.shiftId, status: bookings.status })
      .from(bookings)
      .where(and(inArray(bookings.staffId, ids), inArray(bookings.shiftId, shiftIds), ne(bookings.status, "cancelled"))),
    resolveRates(db, selected, ids),
  ]);

  const candidates: Candidate[] = people.map((p) => {
    const perShift: Candidate["perShift"] = {};
    for (const s of selected) {
      const date = utcToZoned(s.startsAt, s.timezone).date;
      const rate = rates.get(`${s.id}:${p.id}`);
      perShift[s.id] = {
        availability: availabilityOnDate(
          rules.filter((r) => r.staffId === p.id),
          exceptions.filter((e) => e.staffId === p.id),
          date,
        ),
        conflict: confirmed.some((c) => c.staffId === p.id && c.shiftId !== s.id && c.startsAt < s.endsAt && s.startsAt < c.endsAt),
        existingStatus: existing.find((e) => e.staffId === p.id && e.shiftId === s.id)?.status ?? null,
        rateCents: rate?.rateCents ?? null,
        rateSource: rate?.source ?? null,
      };
    }
    return {
      id: p.id,
      name: `${p.preferredName ?? p.firstName} ${p.lastName}`,
      city: p.city,
      sameCity: Boolean(p.city && selected[0]!.city && p.city.toLowerCase() === selected[0]!.city.toLowerCase()),
      completedShifts: p.completedShifts,
      lastShiftAt: p.lastShiftAt,
      isDemo: p.isDemo,
      perShift,
    };
  });
  return { candidates, total: candidates.length };
}

export async function getProjectRates(projectId: string) {
  const sp = staffProfiles;
  return db
    .select({
      id: projectRates.id,
      role: projectRates.role,
      staffId: projectRates.staffId,
      staffName: sql<string | null>`case when ${sp.id} is null then null else coalesce(${sp.preferredName}, ${sp.firstName}) || ' ' || ${sp.lastName} end`,
      rateCents: projectRates.rateCents,
      approvedBy: users.name,
      approvedAt: projectRates.approvedAt,
    })
    .from(projectRates)
    .leftJoin(sp, eq(sp.id, projectRates.staffId))
    .leftJoin(users, eq(users.id, projectRates.approvedBy))
    .where(and(eq(projectRates.projectId, projectId), isNull(projectRates.revokedAt)))
    .orderBy(asc(projectRates.role));
}
