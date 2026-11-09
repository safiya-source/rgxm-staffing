// Read models for the staff portal. Always scoped to one staff member.
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import type { CheckInState } from "@/components/portal/check-in-panel";
import { attendanceEvents, bookings, offerResponses, projectLocations, projects, shifts, timesheets } from "@/server/db/schema";
import { CHECK_OUT_GRACE_MINUTES, checkInWindow } from "@/server/domain/attendance-rules";
import { getOrgSettings } from "@/server/settings";

const bookingFields = {
  id: bookings.id,
  status: bookings.status,
  role: bookings.role,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  offeredRateCents: bookings.offeredRateCents,
  agreedRateCents: bookings.agreedRateCents,
  currency: bookings.currency,
  responseDeadline: bookings.responseDeadline,
  waitlistPosition: bookings.waitlistPosition,
  cancelReason: bookings.cancelReason,
  projectId: projects.id,
  projectName: projects.name,
  timezone: shifts.timezone,
  locationName: projectLocations.name,
  address: projectLocations.address,
  city: projectLocations.city,
  uniform: shifts.uniform,
  instructions: shifts.instructions,
  reportingLocation: shifts.reportingLocation,
  onsiteContact: shifts.onsiteContact,
  askedQuestion: sql<boolean>`exists (select 1 from ${offerResponses} r where r.booking_id = ${bookings.id} and r.response = 'more_info')`,
};

function base() {
  return db
    .select(bookingFields)
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId));
}

export type PortalBooking = Awaited<ReturnType<typeof getOpportunities>>[number];

/** Open offers and responses still waiting on RGXM, soonest first. */
export async function getOpportunities(staffId: string, now = new Date()) {
  return base()
    .where(and(eq(bookings.staffId, staffId), inArray(bookings.status, ["offered", "interested", "awaiting_confirmation", "waitlisted"]), gte(bookings.startsAt, now)))
    .orderBy(asc(bookings.startsAt));
}

export async function getSchedule(staffId: string, now = new Date()) {
  const [upcoming, past, recentChanges] = await Promise.all([
    base()
      .where(and(eq(bookings.staffId, staffId), eq(bookings.status, "confirmed"), gte(bookings.endsAt, now)))
      .orderBy(asc(bookings.startsAt)),
    base()
      .where(and(eq(bookings.staffId, staffId), inArray(bookings.status, ["confirmed", "completed", "no_show"]), lt(bookings.endsAt, now)))
      .orderBy(desc(bookings.startsAt))
      .limit(20),
    base()
      .where(
        and(
          eq(bookings.staffId, staffId),
          eq(bookings.status, "cancelled"),
          gte(bookings.startsAt, now),
          sql`${bookings.cancelledAt} > now() - interval '14 days'`,
        ),
      )
      .orderBy(asc(bookings.startsAt)),
  ]);
  return { upcoming, past, cancelled: recentChanges };
}

// ─── Attendance state for the portal ────────────────────────────────────────


export type AttendanceState = {
  state: CheckInState;
  opensAt: string;
  checkedInAt: string | null;
  requireLocation: boolean;
};

/** Check-in state per booking, from the immutable attendance events. */
export async function getAttendanceStates(bookingIds: string[], now = new Date()): Promise<Map<string, AttendanceState>> {
  const out = new Map<string, AttendanceState>();
  if (!bookingIds.length) return out;
  const settings = await getOrgSettings();
  const [rows, events] = await Promise.all([
    db
      .select({ id: bookings.id, startsAt: shifts.startsAt, endsAt: shifts.endsAt, requireLocation: projectLocations.requireLocationAtCheckIn })
      .from(bookings)
      .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
      .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
      .where(inArray(bookings.id, bookingIds)),
    db.select().from(attendanceEvents).where(inArray(attendanceEvents.bookingId, bookingIds)).orderBy(asc(attendanceEvents.occurredAt)),
  ]);
  for (const r of rows) {
    const mine = events.filter((e) => e.bookingId === r.id);
    const lastIn = [...mine].reverse().find((e) => e.type === "check_in");
    const lastOut = [...mine].reverse().find((e) => e.type === "check_out");
    const w = checkInWindow(r, settings.checkInWindowMinutes);
    let state: CheckInState;
    if (lastOut && (!lastIn || lastOut.occurredAt >= lastIn.occurredAt)) state = "checked_out";
    else if (lastIn) state = now.getTime() <= r.endsAt.getTime() + CHECK_OUT_GRACE_MINUTES * 60_000 ? "checked_in" : "closed";
    else if (now < w.opensAt) state = "before_window";
    else if (now <= w.closesAt) state = "can_check_in";
    else state = "closed";
    out.set(r.id, { state, opensAt: w.opensAt.toISOString(), checkedInAt: lastIn?.occurredAt.toISOString() ?? null, requireLocation: r.requireLocation });
  }
  return out;
}

/** Finished shifts whose hours the person still needs to confirm (or fix). */
export async function getHoursToReview(staffId: string, now = new Date()) {
  return db
    .select({ ...bookingFields, timesheetStatus: timesheets.status })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .leftJoin(timesheets, eq(timesheets.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.staffId, staffId),
        inArray(bookings.status, ["confirmed"]),
        lt(bookings.endsAt, now),
        sql`(${timesheets.status} is null or ${timesheets.status} in ('not_started', 'in_progress', 'needs_review'))`,
        gte(bookings.endsAt, sql`now() - interval '14 days'`),
      ),
    )
    .orderBy(desc(bookings.startsAt));
}

export async function getTimesheetForBooking(bookingId: string) {
  const [t] = await db.select().from(timesheets).where(eq(timesheets.bookingId, bookingId));
  return t ?? null;
}

/**
 * A contractor's own pay lines with their stored tax decision, bill and payment state, plus their
 * open pay review requests. Never includes other people's data.
 */
export async function getMyPayLines(staffId: string) {
  const { rows } = await db.execute<{
    id: string;
    project_name: string;
    service_date: string;
    category: string;
    description: string | null;
    quantity: string | null;
    unit: string | null;
    unit_rate: string | null;
    payable_minutes: number;
    rate_cents: number;
    base_cents: string;
    tax_cents: string;
    total_cents: string;
    currency: string;
    status: string;
    tax_status: string;
    bill_number: string | null;
    paid_at: Date | null;
    last_state: string | null;
    adjusts_payable_id: string | null;
  }>(sql`
    select p.id, pr.name as project_name, p.service_date::text, p.category, p.description, p.quantity::text, p.unit, p.unit_rate::text,
      p.payable_minutes, p.rate_cents, p.base_cents, p.tax_cents, p.total_cents, p.currency, p.status, p.tax_status, b.bill_number,
      (select max(i.paid_at) from payment_batch_items i where i.payable_item_id = p.id and i.state = 'settled') as paid_at,
      (select i.state from payment_batch_items i where i.payable_item_id = p.id order by coalesce(i.reconciled_at, i.returned_at, i.paid_at) desc nulls last limit 1) as last_state,
      p.adjusts_payable_id
    from payable_items p join projects pr on pr.id = p.project_id left join bills b on b.id = p.bill_id
    where p.staff_id = ${staffId} and p.status <> 'void'
    order by p.service_date desc, p.category
    limit 300`);
  const ids = rows.map((r) => r.id);
  const taxLines = ids.length
    ? (
        await db.execute<{ payable_item_id: string; component: string; jurisdiction: string; rate_ppm: number; tax_cents: string }>(
          sql`select payable_item_id, component, jurisdiction, rate_ppm, tax_cents from payable_tax_lines where payable_item_id in ${ids} order by component`,
        )
      ).rows
    : [];
  const { rows: reviews } = await db.execute<{ id: string; payable_item_id: string | null; kind: string; message: string; status: string; resolution: string | null; created_at: Date }>(
    sql`select id, payable_item_id, kind, message, status, resolution, created_at from pay_review_requests where staff_id = ${staffId} order by created_at desc limit 20`,
  );
  return {
    lines: rows.map((r) => ({
      ...r,
      base_cents: Number(r.base_cents),
      tax_cents: Number(r.tax_cents),
      total_cents: Number(r.total_cents),
      taxes: taxLines.filter((t) => t.payable_item_id === r.id).map((t) => ({ component: t.component, jurisdiction: t.jurisdiction, ratePpm: t.rate_ppm, cents: Number(t.tax_cents) })),
    })),
    reviews,
  };
}
