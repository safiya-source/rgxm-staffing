// Pure booking rules (no database). Unit-tested in tests/unit/booking-rules.test.ts.

export const BOOKING_STATUSES = [
  "draft",
  "offered",
  "interested",
  "declined",
  "awaiting_confirmation",
  "confirmed",
  "waitlisted",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type Actor = "rgxm" | "staff" | "system";

/**
 * Allowed transitions and who may make them.
 *  - Interest is never a booking: only RGXM moves someone to confirmed (rules 5 & 6).
 *  - "awaiting_confirmation" is RGXM's shortlist of interested people, pending confirmation.
 *  - Cancelled/declined rows are terminal; a fresh offer creates a new row so history is kept.
 */
const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingStatus, Actor[]>>> = {
  draft: { offered: ["rgxm"], cancelled: ["rgxm"] },
  offered: { interested: ["staff"], declined: ["staff"], cancelled: ["rgxm", "system"] },
  interested: {
    awaiting_confirmation: ["rgxm"],
    confirmed: ["rgxm"],
    waitlisted: ["rgxm"],
    declined: ["staff"],
    cancelled: ["rgxm", "system"],
  },
  awaiting_confirmation: { interested: ["rgxm"], confirmed: ["rgxm"], waitlisted: ["rgxm"], declined: ["staff"], cancelled: ["rgxm", "system"] },
  waitlisted: { confirmed: ["rgxm"], awaiting_confirmation: ["rgxm"], declined: ["staff"], cancelled: ["rgxm", "system"] },
  confirmed: { cancelled: ["rgxm", "staff", "system"], completed: ["rgxm", "system"], no_show: ["rgxm"] },
  declined: {},
  cancelled: {},
  completed: {},
  no_show: { completed: ["rgxm"] },
};

export class BookingTransitionError extends Error {}

export function canTransition(from: BookingStatus, to: BookingStatus, actor: Actor) {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function assertTransition(from: BookingStatus, to: BookingStatus, actor: Actor) {
  if (!canTransition(from, to, actor)) {
    throw new BookingTransitionError(`Can't move a booking from ${from.replace("_", " ")} to ${to.replace("_", " ")}.`);
  }
}

/** Statuses that hold or may soon hold a place on a shift (one per person per shift). */
export const ACTIVE_STATUSES: BookingStatus[] = ["offered", "interested", "awaiting_confirmation", "confirmed", "waitlisted"];

// ─── Rates ─────────────────────────────────────────────────────────────────

export type RateSource = "project_staff" | "shift" | "project_role" | "default";

export type RateInputs = {
  /** Authorised project override for this specific person and role. */
  projectStaffRate: number | null;
  /** Rate posted on the shift. */
  shiftRate: number | null;
  /** Authorised project override for everyone in the role. */
  projectRoleRate: number | null;
  /** The person's current default rate for the role. */
  staffDefaultRate: number | null;
};

/**
 * Which hourly rate applies to an offer. Precedence:
 *   1. a person-specific project override (authorised — rule 3)
 *   2. the rate posted on the shift
 *   3. a project-wide override for the role
 *   4. the person's default rate for the role
 * Returns null when no rate is known; such people can't be offered the shift.
 */
export function resolveRate(r: RateInputs): { rateCents: number; source: RateSource } | null {
  if (r.projectStaffRate != null) return { rateCents: r.projectStaffRate, source: "project_staff" };
  if (r.shiftRate != null) return { rateCents: r.shiftRate, source: "shift" };
  if (r.projectRoleRate != null) return { rateCents: r.projectRoleRate, source: "project_role" };
  if (r.staffDefaultRate != null) return { rateCents: r.staffDefaultRate, source: "default" };
  return null;
}

export const RATE_SOURCE_LABEL: Record<RateSource, string> = {
  project_staff: "Project rate for this person",
  shift: "Shift rate",
  project_role: "Project rate for the role",
  default: "Their default rate",
};

/** Half-open interval overlap: back-to-back shifts don't conflict. */
export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}
