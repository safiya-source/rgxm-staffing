// Attendance and timesheets. Attendance events are append-only facts; timesheets are derived from
// them and then reviewed. Every change to worked/payable time writes a timesheet_adjustment with the
// original value, new value, reason, person and time (section 9 of the brief).
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { assertNotOwnTimesheet, SeparationOfDutiesError } from "@/server/authz/permissions";
import { db, type Tx } from "@/server/db";
import {
  attendanceEvents,
  bookings,
  bookingStatusHistory,
  projectLocations,
  shifts,
  staffProfiles,
  timesheetAdjustments,
  timesheets,
} from "@/server/db/schema";
import { enqueue } from "@/server/notify/outbox";
import { createPayableForTimesheet, replacePayableAfterCorrection } from "./payments";
import { getOrgSettings } from "@/server/settings";
import {
  canMoveTimesheet,
  CHECK_OUT_GRACE_MINUTES,
  checkInWindow,
  deriveFlags,
  distanceMeters,
  staffCanEdit,
  supervises,
  workedMinutes,
  type Rounding,
  type TimesheetActor,
  type TimesheetStatus,
} from "./attendance-rules";

export class AttendanceError extends Error {}

const MINUTE = 60_000;

type Timesheet = typeof timesheets.$inferSelect;

async function rounding(): Promise<Rounding> {
  const s = await getOrgSettings();
  return s.payableRounding === "quarter_hour" ? "quarter_hour" : "minute";
}

/** Creates the timesheet for a confirmed booking if it doesn't exist yet. */
export async function ensureTimesheet(tx: Tx | typeof db, bookingId: string) {
  const [b] = await tx
    .select({ id: bookings.id, staffId: bookings.staffId, projectId: bookings.projectId, shiftId: bookings.shiftId, status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!b) throw new AttendanceError("Booking not found.");
  if (b.status !== "confirmed" && b.status !== "completed") throw new AttendanceError("Only confirmed bookings have timesheets.");
  await tx.insert(timesheets).values({ bookingId, staffId: b.staffId, projectId: b.projectId, shiftId: b.shiftId }).onConflictDoNothing({ target: timesheets.bookingId });
  const [t] = await tx.select().from(timesheets).where(eq(timesheets.bookingId, bookingId));
  return t!;
}

/** Rebuilds the actual times and flags from attendance events. Worked times follow actual times until someone corrects them. */
async function recompute(tx: Tx, bookingId: string, now = new Date()) {
  const t = await ensureTimesheet(tx, bookingId);
  const [ctx] = await tx
    .select({ startsAt: shifts.startsAt, endsAt: shifts.endsAt })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .where(eq(bookings.id, bookingId));
  const events = await tx.select().from(attendanceEvents).where(eq(attendanceEvents.bookingId, bookingId)).orderBy(asc(attendanceEvents.occurredAt));
  const checkIn = events.find((e) => e.type === "check_in")?.occurredAt ?? null;
  const checkOut = checkIn ? ([...events].reverse().find((e) => e.type === "check_out" && e.occurredAt > checkIn)?.occurredAt ?? null) : null;
  const [adj] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(timesheetAdjustments)
    .where(and(eq(timesheetAdjustments.timesheetId, t.id), inArray(timesheetAdjustments.field, ["worked_start", "worked_end"])));
  const corrected = (adj?.n ?? 0) > 0;
  const flags = deriveFlags({
    scheduledStart: ctx!.startsAt,
    scheduledEnd: ctx!.endsAt,
    checkIn,
    checkOut,
    shiftEnded: now > ctx!.endsAt,
    anyOffline: events.some((e) => e.method === "offline_sync"),
    anyOutsideGeofence: events.some((e) => e.withinGeofence === false),
    anySupervisorRecorded: events.some((e) => e.method === "supervisor" || e.method === "admin"),
    corrected,
  });
  const actualMinutes = checkIn && checkOut ? workedMinutes(checkIn, checkOut, 0) : null;

  const editable = !["approved", "locked", "exported", "paid"].includes(t.status);
  await tx
    .update(timesheets)
    .set({
      actualStart: checkIn,
      actualEnd: checkOut,
      actualMinutes,
      flags,
      ...(editable && !corrected ? { workedStart: checkIn, workedEnd: checkOut } : {}),
      ...(t.status === "not_started" && checkIn ? { status: "in_progress" as const } : {}),
    })
    .where(eq(timesheets.id, t.id));
}

// ─── Attendance ─────────────────────────────────────────────────────────────

export type AttendanceActor =
  | { kind: "staff"; userId: string; staffId: string }
  | { kind: "supervisor"; userId: string; staffId: string }
  | { kind: "rgxm"; userId: string };

export type AttendanceInput = {
  type: "check_in" | "check_out";
  /** Device time; defaults to now. Offline events carry the time they happened. */
  occurredAt?: Date;
  clientEventId?: string;
  location?: { lat: number; lng: number; accuracy: number | null } | null;
  note?: string | null;
};

export async function recordAttendance(actor: AttendanceActor, bookingId: string, input: AttendanceInput) {
  const now = new Date();
  const occurredAt = input.occurredAt ?? now;
  if (occurredAt.getTime() > now.getTime() + 2 * MINUTE) throw new AttendanceError("That time is in the future. Check your phone's clock.");
  if (now.getTime() - occurredAt.getTime() > 24 * 60 * MINUTE && actor.kind === "staff") {
    throw new AttendanceError("That's more than a day ago. Ask your Team Lead or RGXM to record it.");
  }
  const settings = await getOrgSettings();

  return db.transaction(async (tx) => {
    if (input.clientEventId) {
      const [dup] = await tx.select({ id: attendanceEvents.id }).from(attendanceEvents).where(eq(attendanceEvents.clientEventId, input.clientEventId));
      if (dup) return { duplicate: true as const };
    }
    const [row] = await tx
      .select({ booking: bookings, shift: shifts, location: projectLocations })
      .from(bookings)
      .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
      .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
      .where(eq(bookings.id, bookingId))
      .for("update", { of: bookings });
    if (!row) throw new AttendanceError("Shift not found.");
    const { booking: b, shift: s, location: l } = row;
    // Supervisors and RGXM record attendance for others, never for themselves (rules 7–8).
    if (actor.kind !== "staff") assertNotOwnTimesheet(actor.userId, await staffUserId(tx, b.staffId));
    if (actor.kind === "staff" && b.staffId !== actor.staffId) throw new AttendanceError("Shift not found.");
    if (actor.kind === "supervisor") {
      if (b.staffId === actor.staffId) throw new SeparationOfDutiesError("Record your own attendance from your shift screen.");
      if (!(await isSupervisorOf(tx, actor.staffId, bookingId))) throw new AttendanceError("You don't supervise this person on this shift.");
    }
    if (b.status !== "confirmed" && b.status !== "completed") throw new AttendanceError("You're not confirmed for this shift.");
    if (actor.kind !== "staff" && !input.note?.trim()) throw new AttendanceError("Add a note explaining why you're recording this for them.");

    const events = await tx.select().from(attendanceEvents).where(eq(attendanceEvents.bookingId, bookingId)).orderBy(asc(attendanceEvents.occurredAt));
    const lastCheckIn = [...events].reverse().find((e) => e.type === "check_in");
    const lastCheckOut = [...events].reverse().find((e) => e.type === "check_out");
    const checkedIn = Boolean(lastCheckIn && (!lastCheckOut || lastCheckOut.occurredAt < lastCheckIn.occurredAt));

    if (input.type === "check_in") {
      if (checkedIn) throw new AttendanceError("You're already checked in.");
      if (lastCheckOut) throw new AttendanceError("You've already checked out of this shift.");
      const w = checkInWindow(s, settings.checkInWindowMinutes);
      if (actor.kind === "staff" && occurredAt < w.opensAt) {
        throw new AttendanceError(`Check-in opens ${settings.checkInWindowMinutes} minutes before your shift.`);
      }
      if (actor.kind === "staff" && occurredAt > w.closesAt) throw new AttendanceError("This shift has ended. Ask your Team Lead or RGXM to record your hours.");
    } else {
      if (!checkedIn) throw new AttendanceError("Check in first.");
      if (occurredAt < lastCheckIn!.occurredAt) throw new AttendanceError("Check-out can't be before check-in.");
      if (actor.kind === "staff" && occurredAt.getTime() > s.endsAt.getTime() + CHECK_OUT_GRACE_MINUTES * MINUTE) {
        throw new AttendanceError("It's too late to check out here. Ask your Team Lead or RGXM to record it.");
      }
    }

    // Location is only ever captured with the tap itself, and only where the venue requires it.
    let withinGeofence: boolean | null = null;
    const loc = l.requireLocationAtCheckIn && actor.kind === "staff" ? (input.location ?? null) : null;
    if (loc && l.latitude != null && l.longitude != null) {
      const radius = l.geofenceMeters ?? settings.checkInGeofenceMeters;
      withinGeofence = distanceMeters(loc, { lat: l.latitude, lng: l.longitude }) <= radius + Math.min(loc.accuracy ?? 0, 200);
    } else if (l.requireLocationAtCheckIn && actor.kind === "staff") {
      withinGeofence = false; // couldn't be verified; flagged for review, never blocked
    }

    const method =
      actor.kind === "supervisor" ? "supervisor" : actor.kind === "rgxm" ? "admin" : now.getTime() - occurredAt.getTime() > 2 * MINUTE ? "offline_sync" : "self";
    const [ev] = await tx
      .insert(attendanceEvents)
      .values({
        bookingId,
        type: input.type,
        occurredAt,
        method,
        recordedBy: actor.userId,
        latitude: loc?.lat ?? null,
        longitude: loc?.lng ?? null,
        accuracyMeters: loc?.accuracy ?? null,
        withinGeofence,
        clientEventId: input.clientEventId ?? null,
        note: input.note?.trim() || null,
      })
      .returning({ id: attendanceEvents.id });
    await recompute(tx, bookingId, now);
    await recordAudit(
      {
        actorId: actor.userId,
        action: `attendance.${input.type}`,
        entityType: "booking",
        entityId: bookingId,
        projectId: b.projectId,
        after: { eventId: ev!.id, occurredAt, method, withinGeofence },
        reason: input.note ?? null,
      },
      tx,
    );
    return { duplicate: false as const, withinGeofence };
  });
}

// ─── Supervision ────────────────────────────────────────────────────────────

/** True when `supervisorStaffId` is confirmed as TL/AM at the same project and location on a shift that overlaps the member's, with a role that outranks theirs. */
export async function isSupervisorOf(tx: Tx | typeof db, supervisorStaffId: string, bookingId: string) {
  const r = await tx.execute<{ role: string; member_role: string }>(sql`
    select sb.role::text as role, b.role::text as member_role
    from ${bookings} b
    join ${shifts} s on s.id = b.shift_id
    join ${bookings} sb on sb.project_id = b.project_id and sb.staff_id = ${supervisorStaffId} and sb.status in ('confirmed', 'completed') and sb.role in ('TL', 'AM')
    join ${shifts} ss on ss.id = sb.shift_id and ss.location_id = s.location_id
    where b.id = ${bookingId}
      and b.staff_id <> ${supervisorStaffId}
      and ss.starts_at < s.ends_at and s.starts_at < ss.ends_at`);
  return r.rows.some((x) => supervises(x.role, x.member_role));
}

/** Everyone a staff member supervises on a given local day (or all days when date is omitted), with attendance. */
export async function getSupervisedTeam(supervisorStaffId: string, opts: { from: Date; to: Date }) {
  const r = await db.execute<{
    booking_id: string;
    staff_id: string;
    name: string;
    phone: string | null;
    role: string;
    starts_at: Date;
    ends_at: Date;
    timezone: string;
    project_name: string;
    location_name: string;
    supervisor_role: string;
    timesheet_id: string | null;
    timesheet_status: string | null;
    actual_start: Date | null;
    actual_end: Date | null;
    worked_start: Date | null;
    worked_end: Date | null;
    break_minutes: number | null;
    flags: string[] | null;
    staff_note: string | null;
  }>(sql`
    select distinct on (b.id)
      b.id as booking_id, b.staff_id, coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as name, p.phone,
      b.role::text as role, s.starts_at, s.ends_at, s.timezone, pr.name as project_name, l.name as location_name,
      sb.role::text as supervisor_role,
      t.id as timesheet_id, t.status::text as timesheet_status, t.actual_start, t.actual_end, t.worked_start, t.worked_end,
      t.break_minutes, t.flags, t.staff_note
    from bookings b
    join shifts s on s.id = b.shift_id
    join staff_profiles p on p.id = b.staff_id
    join projects pr on pr.id = b.project_id
    join project_locations l on l.id = s.location_id
    join bookings sb on sb.project_id = b.project_id and sb.staff_id = ${supervisorStaffId} and sb.status in ('confirmed', 'completed') and sb.role in ('TL', 'AM')
    join shifts ss on ss.id = sb.shift_id and ss.location_id = s.location_id
      and ss.starts_at < s.ends_at and s.starts_at < ss.ends_at
    left join timesheets t on t.booking_id = b.id
    where b.status in ('confirmed', 'completed') and b.staff_id <> ${supervisorStaffId}
      and s.starts_at < ${opts.to.toISOString()}::timestamptz and s.ends_at > ${opts.from.toISOString()}::timestamptz
      and ((sb.role = 'AM' and b.role <> 'AM') or (sb.role = 'TL' and b.role in ('BA', 'PA')))
    order by b.id, sb.role desc`);
  return r.rows.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime() || a.name.localeCompare(b.name));
}

// ─── Timesheet changes ──────────────────────────────────────────────────────

type Changes = { workedStart?: Date | null; workedEnd?: Date | null; breakMinutes?: number };
type Stage = "staff_correction" | "supervisor_recommendation" | "rgxm_review" | "approval" | "post_approval_correction";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
// Times are entered to the minute while check-ins carry seconds; the same minute is not a change.
const sameMinute = (a: Date | null | undefined, b: Date | null | undefined) => (a && b ? Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000) : !a && !b);

/** Applies changes and records one adjustment per changed field. Returns whether anything changed. */
async function applyChanges(tx: Tx, t: Timesheet, changes: Changes, ctx: { actorId: string; reason: string; stage: Stage }) {
  const rows: (typeof timesheetAdjustments.$inferInsert)[] = [];
  const set: Partial<typeof timesheets.$inferInsert> = {};
  if (changes.workedStart !== undefined && !sameMinute(changes.workedStart, t.workedStart)) {
    rows.push({ timesheetId: t.id, field: "worked_start", oldValue: iso(t.workedStart), newValue: iso(changes.workedStart), reason: ctx.reason, stage: ctx.stage, actorId: ctx.actorId });
    set.workedStart = changes.workedStart;
  }
  if (changes.workedEnd !== undefined && !sameMinute(changes.workedEnd, t.workedEnd)) {
    rows.push({ timesheetId: t.id, field: "worked_end", oldValue: iso(t.workedEnd), newValue: iso(changes.workedEnd), reason: ctx.reason, stage: ctx.stage, actorId: ctx.actorId });
    set.workedEnd = changes.workedEnd;
  }
  if (changes.breakMinutes !== undefined && changes.breakMinutes !== t.breakMinutes) {
    if (!Number.isInteger(changes.breakMinutes) || changes.breakMinutes < 0 || changes.breakMinutes > 600) throw new AttendanceError("Enter break minutes between 0 and 600.");
    rows.push({ timesheetId: t.id, field: "break_minutes", oldValue: String(t.breakMinutes), newValue: String(changes.breakMinutes), reason: ctx.reason, stage: ctx.stage, actorId: ctx.actorId });
    set.breakMinutes = changes.breakMinutes;
  }
  const start = set.workedStart !== undefined ? set.workedStart : t.workedStart;
  const end = set.workedEnd !== undefined ? set.workedEnd : t.workedEnd;
  if (start && end && end <= start) throw new AttendanceError("The end time must be after the start time.");
  if (start && end && end.getTime() - start.getTime() > 24 * 60 * MINUTE) throw new AttendanceError("A shift can't be longer than 24 hours.");
  // Time corrections need a reason; a staff member simply recording their break doesn't.
  const timeChanged = rows.some((r) => r.field !== "break_minutes");
  if ((timeChanged || ctx.stage !== "staff_correction") && rows.length && !ctx.reason.trim()) throw new AttendanceError("Give a reason for the change.");
  if (rows.length) {
    await tx.update(timesheets).set(set).where(eq(timesheets.id, t.id));
    await tx.insert(timesheetAdjustments).values(rows.map((r) => ({ ...r, reason: r.reason || "Break recorded" })));
  }
  return rows.length > 0;
}

async function lockTimesheet(tx: Tx, timesheetId: string) {
  const [t] = await tx.select().from(timesheets).where(eq(timesheets.id, timesheetId)).for("update");
  if (!t) throw new AttendanceError("Timesheet not found.");
  return t;
}

async function setStatus(tx: Tx, t: Timesheet, to: TimesheetStatus, actor: TimesheetActor, actorId: string, extra: Partial<typeof timesheets.$inferInsert> = {}, reason: string | null = null) {
  if (!canMoveTimesheet(t.status, to, actor)) throw new AttendanceError(`This timesheet is ${t.status.replace("_", " ")} and can't move to ${to.replace("_", " ")}.`);
  await tx.update(timesheets).set({ status: to, ...extra }).where(eq(timesheets.id, t.id));
  await recordAudit({ actorId, action: `timesheet.${to}`, entityType: "timesheet", entityId: t.id, projectId: t.projectId, before: { status: t.status }, after: { status: to, ...extra }, reason }, tx);
}

async function staffUserId(tx: Tx | typeof db, staffId: string) {
  const [p] = await tx.select({ userId: staffProfiles.userId }).from(staffProfiles).where(eq(staffProfiles.id, staffId));
  return p?.userId ?? null;
}

/** Staff edit their own times/break before submitting (or after being sent back). */
export async function staffEditTimesheet(staff: { userId: string; staffId: string }, timesheetId: string, changes: Changes & { note?: string | null }, reason: string) {
  await db.transaction(async (tx) => {
    const t = await lockTimesheet(tx, timesheetId);
    if (t.staffId !== staff.staffId) throw new AttendanceError("Timesheet not found.");
    if (!staffCanEdit(t.status)) throw new AttendanceError("This timesheet has been submitted. Message RGXM if something needs fixing.");
    await applyChanges(tx, t, changes, { actorId: staff.userId, reason, stage: "staff_correction" });
    if (changes.note !== undefined) await tx.update(timesheets).set({ staffNote: changes.note?.trim() || null }).where(eq(timesheets.id, t.id));
    await recompute(tx, t.bookingId);
  });
}

export async function submitTimesheet(staff: { userId: string; staffId: string }, timesheetId: string) {
  await db.transaction(async (tx) => {
    const t = await lockTimesheet(tx, timesheetId);
    if (t.staffId !== staff.staffId) throw new AttendanceError("Timesheet not found.");
    if (!t.workedStart || !t.workedEnd) throw new AttendanceError("Add your start and finish times before submitting.");
    await setStatus(tx, t, "submitted", "staff", staff.userId, { submittedAt: new Date(), reviewNote: null });
    await enqueue(tx, { type: "timesheet.submitted", payload: { timesheetId }, dedupeKey: `timesheet.submitted:${timesheetId}:${Date.now()}` });
  });
}

/** Team Lead / AM verification, optionally with a recommended adjustment. */
export async function supervisorVerify(supervisor: { userId: string; staffId: string }, timesheetId: string, input: { changes?: Changes; reason?: string; note?: string | null }) {
  await db.transaction(async (tx) => {
    const t = await lockTimesheet(tx, timesheetId);
    assertNotOwnTimesheet(supervisor.userId, await staffUserId(tx, t.staffId));
    if (!(await isSupervisorOf(tx, supervisor.staffId, t.bookingId))) throw new AttendanceError("You don't supervise this person on this shift.");
    if (input.changes) await applyChanges(tx, t, input.changes, { actorId: supervisor.userId, reason: input.reason ?? "", stage: "supervisor_recommendation" });
    const fresh = await lockTimesheet(tx, timesheetId);
    if (!fresh.workedStart || !fresh.workedEnd) throw new AttendanceError("Add start and finish times before verifying.");
    await setStatus(tx, fresh, "supervisor_verified", "supervisor", supervisor.userId, { verifiedBy: supervisor.userId, verifiedAt: new Date(), supervisorNote: input.note?.trim() || null });
    await recompute(tx, t.bookingId);
  });
}

/** Supervisor or RGXM sends hours back to the staff member with a reason. */
export async function sendBack(actor: { kind: "supervisor"; userId: string; staffId: string } | { kind: "rgxm"; userId: string }, timesheetId: string, reason: string) {
  if (!reason.trim()) throw new AttendanceError("Explain what needs fixing.");
  await db.transaction(async (tx) => {
    const t = await lockTimesheet(tx, timesheetId);
    if (actor.kind === "supervisor") {
      assertNotOwnTimesheet(actor.userId, await staffUserId(tx, t.staffId));
      if (!(await isSupervisorOf(tx, actor.staffId, t.bookingId))) throw new AttendanceError("You don't supervise this person on this shift.");
    }
    await setStatus(tx, t, "needs_review", actor.kind, actor.userId, { reviewNote: reason.trim() }, reason);
    await enqueue(tx, { type: "timesheet.needs_review", payload: { timesheetId }, dedupeKey: `timesheet.needs_review:${timesheetId}:${Date.now()}` });
  });
}

/** RGXM edits times before approval (e.g. missing check-out). */
export async function rgxmAdjust(actorId: string, timesheetId: string, changes: Changes, reason: string) {
  await db.transaction(async (tx) => {
    const t = await lockTimesheet(tx, timesheetId);
    if (["approved", "locked", "exported", "paid"].includes(t.status)) throw new AttendanceError("Approved hours can only be changed with a post-approval correction.");
    assertNotOwnTimesheet(actorId, await staffUserId(tx, t.staffId));
    await applyChanges(tx, t, changes, { actorId, reason, stage: "rgxm_review" });
    await recompute(tx, t.bookingId);
  });
}

/**
 * Final authorisation of payable hours (rules 7–9). Payable minutes default to worked time minus
 * breaks; any different figure needs a reason. The booking becomes completed.
 */
export async function approveTimesheet(actorId: string, timesheetId: string, input: { payableMinutes?: number; reason?: string } = {}) {
  await db.transaction(async (tx) => {
    const t = await lockTimesheet(tx, timesheetId);
    assertNotOwnTimesheet(actorId, await staffUserId(tx, t.staffId));
    const [s] = await tx.select({ endsAt: shifts.endsAt }).from(shifts).where(eq(shifts.id, t.shiftId));
    if (s && s.endsAt > new Date()) throw new AttendanceError("Hours can be approved once the shift has ended.");
    if (!t.workedStart || !t.workedEnd) throw new AttendanceError("Start and finish times are missing. Add them (with a reason) before approving.");
    const computed = workedMinutes(t.workedStart, t.workedEnd, t.breakMinutes, await rounding());
    const payable = input.payableMinutes ?? computed;
    if (!Number.isInteger(payable) || payable < 0 || payable > 24 * 60) throw new AttendanceError("Payable time must be between 0 and 24 hours.");
    if (payable !== computed) {
      if (!input.reason?.trim()) throw new AttendanceError("Explain why payable time differs from the worked time.");
      await tx.insert(timesheetAdjustments).values({
        timesheetId: t.id,
        field: "payable_minutes",
        oldValue: String(computed),
        newValue: String(payable),
        reason: input.reason.trim(),
        stage: "approval",
        actorId,
      });
    }
    await setStatus(tx, t, "approved", "rgxm", actorId, { payableMinutes: payable, approvedBy: actorId, approvedAt: new Date() }, input.reason ?? null);
    const [b] = await tx.select({ id: bookings.id, status: bookings.status }).from(bookings).where(eq(bookings.id, t.bookingId)).for("update");
    if (b?.status === "confirmed") {
      await tx.update(bookings).set({ status: "completed" }).where(eq(bookings.id, b.id));
      await tx.insert(bookingStatusHistory).values({ bookingId: b.id, fromStatus: "confirmed", toStatus: "completed", actorId, reason: "Hours approved" });
    }
    // Approval creates the immutable payable at the agreed-rate snapshot.
    await createPayableForTimesheet(tx, t.id, actorId);
    await enqueue(tx, { type: "timesheet.approved", payload: { timesheetId }, dedupeKey: `timesheet.approved:${timesheetId}` });
  });
}

/** Rule 10: changing approved hours is a separate, authorised, fully recorded workflow. */
export async function correctApprovedTimesheet(actorId: string, timesheetId: string, input: { payableMinutes: number; reason: string }) {
  if (!input.reason.trim()) throw new AttendanceError("Give a reason for the correction.");
  if (!Number.isInteger(input.payableMinutes) || input.payableMinutes < 0 || input.payableMinutes > 24 * 60) throw new AttendanceError("Payable time must be between 0 and 24 hours.");
  await db.transaction(async (tx) => {
    const t = await lockTimesheet(tx, timesheetId);
    if (t.status !== "approved") {
      throw new AttendanceError(
        t.status === "locked" || t.status === "exported" || t.status === "paid"
          ? "These hours are already in a payment batch. Corrections after that are made as a separate adjustment payment."
          : "Only approved timesheets use the correction workflow.",
      );
    }
    assertNotOwnTimesheet(actorId, await staffUserId(tx, t.staffId));
    if (input.payableMinutes === t.payableMinutes) throw new AttendanceError("That's the same as the approved time.");
    await tx.execute(sql`select set_config('rgxm.hours_correction', 'on', true)`);
    await tx.update(timesheets).set({ payableMinutes: input.payableMinutes, version: t.version + 1 }).where(eq(timesheets.id, t.id));
    await tx.insert(timesheetAdjustments).values({
      timesheetId: t.id,
      field: "payable_minutes",
      oldValue: String(t.payableMinutes),
      newValue: String(input.payableMinutes),
      reason: input.reason.trim(),
      stage: "post_approval_correction",
      actorId,
    });
    await replacePayableAfterCorrection(tx, t.id, actorId, input.reason.trim());
    await recordAudit(
      { actorId, action: "timesheet.correct", entityType: "timesheet", entityId: t.id, projectId: t.projectId, before: { payableMinutes: t.payableMinutes }, after: { payableMinutes: input.payableMinutes }, reason: input.reason },
      tx,
    );
    await enqueue(tx, { type: "timesheet.approved", payload: { timesheetId, corrected: true }, dedupeKey: `timesheet.corrected:${timesheetId}:${t.version + 1}` });
  });
}

/** Marks a confirmed booking as a no-show once the shift has started without a check-in. */
export async function markNoShow(actorId: string, bookingId: string, reason: string) {
  if (!reason.trim()) throw new AttendanceError("Give a reason.");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ b: bookings, startsAt: shifts.startsAt })
      .from(bookings)
      .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
      .where(eq(bookings.id, bookingId))
      .for("update", { of: bookings });
    if (!row || row.b.status !== "confirmed") throw new AttendanceError("Only confirmed bookings can be marked as a no-show.");
    if (row.startsAt > new Date()) throw new AttendanceError("The shift hasn't started yet.");
    const [ev] = await tx.select({ id: attendanceEvents.id }).from(attendanceEvents).where(eq(attendanceEvents.bookingId, bookingId)).limit(1);
    if (ev) throw new AttendanceError("This person has attendance records for the shift.");
    await tx.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    await tx.insert(bookingStatusHistory).values({ bookingId, fromStatus: "confirmed", toStatus: "no_show", actorId, reason: reason.trim() });
    await recordAudit({ actorId, action: "booking.no_show", entityType: "booking", entityId: bookingId, projectId: row.b.projectId, reason }, tx);
  });
}

export { recompute as recomputeTimesheet };
