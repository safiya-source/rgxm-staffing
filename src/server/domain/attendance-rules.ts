// Pure attendance and timesheet rules (no database). Unit-tested in tests/unit/attendance-rules.test.ts.

const MINUTE = 60_000;

/** Check-in opens `windowMinutes` before the start and stays open until the scheduled end. */
export function checkInWindow(shift: { startsAt: Date; endsAt: Date }, windowMinutes: number) {
  return { opensAt: new Date(shift.startsAt.getTime() - windowMinutes * MINUTE), closesAt: shift.endsAt };
}

/** Check-out is accepted until 12 hours after the scheduled end (covers late finishes and offline sync). */
export const CHECK_OUT_GRACE_MINUTES = 12 * 60;

export type Rounding = "minute" | "quarter_hour";

/** Whole minutes between two instants minus breaks, never negative. Rounding is a configured policy, not a deduction. */
export function workedMinutes(start: Date, end: Date, breakMinutes: number, rounding: Rounding = "minute") {
  const raw = Math.floor((end.getTime() - start.getTime()) / MINUTE) - breakMinutes;
  const minutes = Math.max(0, raw);
  return rounding === "quarter_hour" ? Math.round(minutes / 15) * 15 : minutes;
}

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const LATE_GRACE_MINUTES = 5;
export const EARLY_LEAVE_MINUTES = 15;

export type Flag =
  | "late"
  | "left_early"
  | "missing_check_in"
  | "missing_check_out"
  | "offline_entry"
  | "outside_geofence"
  | "recorded_by_supervisor"
  | "times_corrected"
  | "long_shift";

export const FLAG_LABEL: Record<Flag, string> = {
  late: "Late check-in",
  left_early: "Left early",
  missing_check_in: "No check-in",
  missing_check_out: "No check-out",
  offline_entry: "Recorded offline",
  outside_geofence: "Outside venue radius",
  recorded_by_supervisor: "Recorded by supervisor",
  times_corrected: "Times corrected",
  long_shift: "Much longer than scheduled",
};

/** Objective flags for reviewers. Flags inform a person's review; they never change pay on their own. */
export function deriveFlags(input: {
  scheduledStart: Date;
  scheduledEnd: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  shiftEnded: boolean;
  anyOffline: boolean;
  anyOutsideGeofence: boolean;
  anySupervisorRecorded: boolean;
  corrected: boolean;
}): Flag[] {
  const f: Flag[] = [];
  if (input.checkIn && input.checkIn.getTime() > input.scheduledStart.getTime() + LATE_GRACE_MINUTES * MINUTE) f.push("late");
  if (input.checkOut && input.checkOut.getTime() < input.scheduledEnd.getTime() - EARLY_LEAVE_MINUTES * MINUTE) f.push("left_early");
  if (!input.checkIn && input.shiftEnded) f.push("missing_check_in");
  if (input.checkIn && !input.checkOut && input.shiftEnded) f.push("missing_check_out");
  if (input.anyOffline) f.push("offline_entry");
  if (input.anyOutsideGeofence) f.push("outside_geofence");
  if (input.anySupervisorRecorded) f.push("recorded_by_supervisor");
  if (input.corrected) f.push("times_corrected");
  if (input.checkIn && input.checkOut) {
    const scheduled = input.scheduledEnd.getTime() - input.scheduledStart.getTime();
    if (input.checkOut.getTime() - input.checkIn.getTime() > scheduled * 1.25 + 30 * MINUTE) f.push("long_shift");
  }
  return f;
}

// ─── Timesheet status machine ────────────────────────────────────────────────

export type TimesheetStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "needs_review"
  | "supervisor_verified"
  | "approved"
  | "locked"
  | "exported"
  | "paid";

export type TimesheetActor = "staff" | "supervisor" | "rgxm" | "system";

const T: Record<TimesheetStatus, Partial<Record<TimesheetStatus, TimesheetActor[]>>> = {
  not_started: { in_progress: ["staff", "supervisor", "rgxm", "system"], submitted: ["staff"], needs_review: ["rgxm", "supervisor"], approved: ["rgxm"] },
  in_progress: { submitted: ["staff"], needs_review: ["rgxm", "supervisor"], supervisor_verified: ["supervisor"], approved: ["rgxm"] },
  submitted: { needs_review: ["supervisor", "rgxm"], supervisor_verified: ["supervisor"], approved: ["rgxm"] },
  needs_review: { submitted: ["staff"], supervisor_verified: ["supervisor"], approved: ["rgxm"] },
  supervisor_verified: { needs_review: ["rgxm"], approved: ["rgxm"] },
  // Approved hours change only via the post-approval correction workflow (no status change).
  approved: { locked: ["system"] },
  // Removed from a draft batch, or the batch was voided: back to approved (hours unchanged).
  locked: { exported: ["system"], approved: ["system"] },
  exported: { paid: ["system"], approved: ["system"] },
  paid: {},
};

export function canMoveTimesheet(from: TimesheetStatus, to: TimesheetStatus, actor: TimesheetActor) {
  return T[from][to]?.includes(actor) ?? false;
}

/** Staff can edit their own times until RGXM approves (and while sent back for review). */
export function staffCanEdit(status: TimesheetStatus) {
  return status === "not_started" || status === "in_progress" || status === "needs_review";
}

export const TIMESHEET_STATUS_LABEL: Record<TimesheetStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  needs_review: "Needs review",
  supervisor_verified: "Verified by supervisor",
  approved: "Approved",
  locked: "Locked",
  exported: "Exported for payment",
  paid: "Paid",
};

/** Who may verify whose hours on site: AMs verify TLs, BAs and PAs; TLs verify BAs and PAs. */
export function supervises(supervisorRole: string, memberRole: string) {
  if (supervisorRole === "AM") return memberRole !== "AM";
  if (supervisorRole === "TL") return memberRole === "BA" || memberRole === "PA";
  return false;
}
