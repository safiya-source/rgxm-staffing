// Pure payment rules (no database). Unit-tested in tests/unit/pay-rules.test.ts.

/** Bumped whenever the calculation changes; stored on every payable with its inputs. */
export const CALC_VERSION = "base-v1";

/** Base pay in cents: payable minutes × hourly rate, rounded half up to the cent. */
export function basePayCents(payableMinutes: number, rateCentsPerHour: number) {
  if (!Number.isInteger(payableMinutes) || payableMinutes < 0) throw new Error("payableMinutes must be a non-negative integer");
  if (!Number.isInteger(rateCentsPerHour) || rateCentsPerHour < 0) throw new Error("rate must be a non-negative integer");
  return Math.floor((payableMinutes * rateCentsPerHour + 30) / 60);
}

// ─── Pay periods ──────────────────────────────────────────────────────────────

export type PayPeriodRule = "semi_monthly" | "monthly";

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The pay period containing a local service date (yyyy-mm-dd). Semi-monthly = 1st–15th and 16th–end. */
export function payPeriodFor(serviceDate: string, rule: PayPeriodRule = "semi_monthly") {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate);
  if (!m) throw new Error(`Invalid date ${serviceDate}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const last = lastDayOfMonth(year, month);
  const [from, to] = rule === "monthly" ? [1, last] : day <= 15 ? [1, 15] : [16, last];
  const prefix = `${year}-${pad(month)}`;
  return {
    startsOn: `${prefix}-${pad(from)}`,
    endsOn: `${prefix}-${pad(to)}`,
    label: `${MONTHS[month - 1]} ${from}–${to}, ${year}`,
  };
}

// ─── Classification → batch type ──────────────────────────────────────────────

export type Classification = "unset" | "contractor" | "employee";
export type BatchType = "contractor" | "payroll";

/** Contractors and employees are paid in separate batches. "Unset" can't be paid until RGXM sets it. */
export function batchTypeFor(classification: Classification): BatchType | null {
  return classification === "contractor" ? "contractor" : classification === "employee" ? "payroll" : null;
}

export const BATCH_TYPE_LABEL: Record<BatchType, string> = { contractor: "Contractors", payroll: "Employees (payroll)" };

// ─── State machines ───────────────────────────────────────────────────────────

export type PayableStatus = "pending" | "batched" | "exported" | "paid" | "failed" | "disputed" | "void";
export type BatchStatus = "draft" | "approved" | "exported" | "paid" | "void";

const PAYABLE: Record<PayableStatus, PayableStatus[]> = {
  pending: ["batched", "void"],
  // Back to pending when removed from a draft batch or the batch is voided.
  batched: ["pending", "exported"],
  exported: ["paid", "failed", "pending"],
  failed: ["batched", "void"],
  paid: ["disputed"],
  disputed: [],
  void: [],
};
export function canMovePayable(from: PayableStatus, to: PayableStatus) {
  return PAYABLE[from].includes(to);
}

const BATCH: Record<BatchStatus, BatchStatus[]> = {
  draft: ["approved", "void"],
  approved: ["exported", "void"],
  exported: ["paid", "void"],
  paid: [],
  void: [],
};
export function canMoveBatch(from: BatchStatus, to: BatchStatus) {
  return BATCH[from].includes(to);
}

export const PAYABLE_STATUS_LABEL: Record<PayableStatus, string> = {
  pending: "Ready to batch",
  batched: "In a batch",
  exported: "Exported",
  paid: "Paid",
  failed: "Payment failed",
  disputed: "Disputed",
  void: "Void",
};
export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  exported: "Exported",
  paid: "Paid",
  void: "Void",
};

// ─── Employment-standards review hints ───────────────────────────────────────
// Nothing here changes pay. RGXM's advisors decide the rules; these only point a reviewer at
// shifts that may need attention for employees under Ontario's ESA (section 254 risks in the plan).

export type EsaHint = "under_3_hours" | "weekly_over_44";
export const ESA_HINT_LABEL: Record<EsaHint, string> = {
  under_3_hours: "Under 3 hours: check the 3-hour rule",
  weekly_over_44: "Over 44 h that week: check overtime",
};

export function esaHints(input: { classification: Classification; payableMinutes: number; weekMinutes: number }): EsaHint[] {
  if (input.classification !== "employee") return [];
  const hints: EsaHint[] = [];
  if (input.payableMinutes > 0 && input.payableMinutes < 180) hints.push("under_3_hours");
  if (input.weekMinutes > 44 * 60) hints.push("weekly_over_44");
  return hints;
}

/** "12.50" from 1250, for exports (never locale-formatted, never negative here). */
export function centsToDecimal(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "7.25" hours from 435 minutes, rounded to 2 decimals. */
export function minutesToDecimalHours(minutes: number) {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2);
}
