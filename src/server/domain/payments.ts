// Bill lines (payables), payment batches, bank payment attempts and settlement.
//
// The money trail is kept in separate records:
//   approved work (timesheets, approved compensation)
//     → bill lines (payable_items, one per shift fee / allowance / mileage / bonus / adjustment,
//       each with its own stored tax decision in payable_tax_lines)
//     → bills (one per contractor, finalized when the bank file is exported; see finalizeBills)
//     → payment batches (bank files; two people: creator and a different approver)
//     → payment attempts (payment_batch_items: exported → submitted → settled | failed | returned
//       | bank_cancelled) with bank references and reconciliation evidence.
// Exporting a file never settles anything. A failed or returned payment is retried in a later batch
// against the same bill line, so no second expense is created. Amounts are never edited: before a
// bill exists a line is voided and recreated; afterwards it's corrected with a linked adjustment.
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { assertDifferentApprover } from "@/server/authz/permissions";
import { db, type Tx } from "@/server/db";
import {
  bills,
  bookings,
  compensationItems,
  payableItems,
  payableTaxLines,
  paymentBatches,
  paymentBatchItems,
  paymentExports,
  payPeriods,
  projects,
  shifts,
  staffProfiles,
  staffSensitive,
  taxRules,
  timesheets,
} from "@/server/db/schema";
import { utcToZoned } from "@/lib/time";
import { enqueue } from "@/server/notify/outbox";
import { getOrgSettings } from "@/server/settings";
import { storage } from "@/server/storage";
import { autoInvoice, createBill, torontoToday } from "./invoices";
import { dollarsToCents, taxOnCents } from "./money";
import { currentRegSnapshot, staleLine } from "./payable-sql";
import { buildExport, type ExportFormat, type ExportRow } from "./payment-exports";
import {
  basePayCents,
  batchTypeFor,
  canMoveBatch,
  canMovePayable,
  payPeriodFor,
  type BatchStatus,
  type BatchType,
  type PayableStatus,
  type PayPeriodRule,
} from "./pay-rules";
import { loadTaxContext } from "./tax-config";

export { approvedPaymentTerms, torontoToday } from "./invoices";
import { CATEGORY_LABEL, decideTax, mirrorTaxLines, registrationSnapshot, type TaxDecision, type TaxLine } from "./tax-engine";

export class PaymentError extends Error {}

/** Bumped whenever the calculation changes; stored on every line with its inputs. */
export const LINE_CALC_VERSION = "lines-tax-v3";

type Payable = typeof payableItems.$inferSelect;
type Batch = typeof paymentBatches.$inferSelect;

/** Finance's decision on tax for a line, replacing the automatic one before the bill is finalized. */
export type TaxOverride = { reason: string; ruleIds: string[] };

const UNIT: Record<string, string> = { fee: "hour", meal_breakfast: "meal", meal_lunch: "meal", meal_dinner: "meal", per_diem: "day", mileage: "km", bonus: "each", adjustment: "each" };

// ─── Creating bill lines ─────────────────────────────────────────────────────────

type NewLine = {
  timesheetId?: string | null;
  compensationItemId?: string | null;
  adjustsPayableId?: string | null;
  staffId: string;
  projectId: string;
  serviceDate: string;
  classification: Payable["classification"];
  category: string;
  payableMinutes: number;
  rateCents: number;
  baseCents: number;
  quantity: string;
  unitRate: string;
  description: string;
  currency: string;
  calcInputs: Record<string, unknown>;
};

async function insertLine(tx: Tx, line: NewLine, decision: Omit<TaxDecision, "status"> & { status: string }, actorId: string) {
  const [p] = await tx
    .insert(payableItems)
    .values({
      timesheetId: line.timesheetId ?? null,
      compensationItemId: line.compensationItemId ?? null,
      adjustsPayableId: line.adjustsPayableId ?? null,
      staffId: line.staffId,
      projectId: line.projectId,
      serviceDate: line.serviceDate,
      classification: line.classification,
      category: line.category,
      description: line.description,
      payableMinutes: line.payableMinutes,
      rateCents: line.rateCents,
      quantity: line.quantity,
      unit: UNIT[line.category] ?? "each",
      unitRate: line.unitRate,
      baseCents: line.baseCents,
      taxCents: decision.taxCents,
      totalCents: line.baseCents + decision.taxCents,
      currency: line.currency,
      taxStatus: decision.status,
      taxBasis: decision.basis,
      registrationSnapshot: decision.registrationSnapshot,
      calcVersion: LINE_CALC_VERSION,
      calcInputs: { ...line.calcInputs, rounding: "half_up_cent", tax: { status: decision.status, components: decision.lines.map((l) => ({ c: l.component, j: l.jurisdiction, ppm: l.ratePpm, rule: l.taxRuleId })) } },
      createdBy: actorId,
    })
    .returning();
  if (decision.lines.length) {
    await tx.insert(payableTaxLines).values(decision.lines.map((l) => ({ payableItemId: p!.id, component: l.component, jurisdiction: l.jurisdiction, ratePpm: l.ratePpm, taxableCents: l.taxableCents, taxCents: l.taxCents, taxRuleId: l.taxRuleId, serviceCategory: l.serviceCategory, basis: l.basis })));
  }
  // Self-billing contractors get their invoice as soon as the work is approved (record only).
  await autoInvoice(tx, p!, actorId);
  await recordAudit(
    { actorId, action: "payable.create", entityType: "payable", entityId: p!.id, projectId: line.projectId, after: { category: line.category, baseCents: line.baseCents, taxCents: decision.taxCents, taxStatus: decision.status, payableMinutes: line.payableMinutes, rateCents: line.rateCents } },
    tx,
  );
  return p!;
}

/** Builds a Finance tax decision from configured rules (never a free-typed rate). */
async function overrideDecision(tx: Tx, override: TaxOverride, amountCents: number, regSnapshot: string): Promise<TaxDecision> {
  const reason = override.reason.trim();
  if (reason.length < 5) throw new PaymentError("Explain the tax decision (at least a few words).");
  const rules = override.ruleIds.length ? await tx.select().from(taxRules).where(inArray(taxRules.id, override.ruleIds)) : [];
  if (rules.length !== new Set(override.ruleIds).size) throw new PaymentError("Choose tax rules from the configured list.");
  if (rules.some((r) => r.status === "retired")) throw new PaymentError("A retired tax rule can't be used.");
  if (new Set(rules.map((r) => r.component)).size !== rules.length) throw new PaymentError("Choose each tax component once.");
  const lines: TaxLine[] = rules.map((r) => ({
    component: r.component,
    jurisdiction: r.jurisdiction,
    ratePpm: r.ratePpm,
    taxableCents: amountCents,
    taxCents: taxOnCents(amountCents, r.ratePpm),
    taxRuleId: r.id,
    serviceCategory: r.serviceCategory,
    basis: `Finance decision: ${reason}`,
  }));
  const taxCents = lines.reduce((n, l) => n + l.taxCents, 0);
  return { status: "calculated", lines, taxCents, basis: `Finance decision${lines.length ? "" : " (no tax)"}: ${reason}`, registrationSnapshot: regSnapshot };
}

async function decide(tx: Tx, input: { staffId: string; projectId: string; category: string; amountCents: number; workDate: string }, override?: TaxOverride) {
  const ctx = await loadTaxContext(tx, input);
  if (override) {
    const d = await overrideDecision(tx, override, input.amountCents, registrationSnapshot(ctx.registration));
    return { ...d, status: "finance_override" };
  }
  return decideTax(ctx, { category: input.category, amountCents: input.amountCents, workDate: input.workDate });
}

/**
 * Creates the hourly-fee line for an approved timesheet at the booking's agreed-rate snapshot
 * (rule 3). Tax is decided per the accountant-approved rules (or routed to Finance review).
 */
export async function createPayableForTimesheet(tx: Tx, timesheetId: string, actorId: string, override?: TaxOverride) {
  const [row] = await tx
    .select({ t: timesheets, agreedRateCents: bookings.agreedRateCents, currency: bookings.currency, role: bookings.role, startsAt: shifts.startsAt, timezone: shifts.timezone, classification: staffProfiles.classification })
    .from(timesheets)
    .innerJoin(bookings, eq(bookings.id, timesheets.bookingId))
    .innerJoin(shifts, eq(shifts.id, timesheets.shiftId))
    .innerJoin(staffProfiles, eq(staffProfiles.id, timesheets.staffId))
    .where(eq(timesheets.id, timesheetId));
  if (!row) throw new PaymentError("Timesheet not found.");
  const { t } = row;
  if (t.payableMinutes == null) throw new PaymentError("Approved minutes are missing.");
  if (row.agreedRateCents == null) throw new PaymentError("This booking has no agreed rate, so pay can't be calculated.");
  const base = basePayCents(t.payableMinutes, row.agreedRateCents);
  const serviceDate = utcToZoned(row.startsAt, row.timezone).date;
  const decision = await decide(tx, { staffId: t.staffId, projectId: t.projectId, category: "fee", amountCents: base, workDate: serviceDate }, override);
  return insertLine(
    tx,
    {
      timesheetId: t.id,
      staffId: t.staffId,
      projectId: t.projectId,
      serviceDate,
      classification: row.classification,
      category: "fee",
      payableMinutes: t.payableMinutes,
      rateCents: row.agreedRateCents,
      baseCents: base,
      quantity: (Math.round((t.payableMinutes / 60) * 100) / 100).toFixed(2),
      unitRate: (row.agreedRateCents / 100).toFixed(4),
      description: `${row.role} ${(t.payableMinutes / 60).toFixed(2)} h`,
      currency: row.currency,
      calcInputs: { payableMinutes: t.payableMinutes, breakMinutes: t.breakMinutes, rateCents: row.agreedRateCents, timesheetVersion: t.version, role: row.role, bookingId: t.bookingId, shiftId: t.shiftId },
    },
    decision,
    actorId,
  );
}

/** Creates the bill line for an approved allowance, mileage claim or bonus. */
export async function createPayableForCompensation(tx: Tx, compensationItemId: string, actorId: string, override?: TaxOverride) {
  const [c] = await tx.select({ c: compensationItems, classification: staffProfiles.classification, currency: projects.currency }).from(compensationItems).innerJoin(staffProfiles, eq(staffProfiles.id, compensationItems.staffId)).innerJoin(projects, eq(projects.id, compensationItems.projectId)).where(eq(compensationItems.id, compensationItemId));
  if (!c) throw new PaymentError("Compensation item not found.");
  if (c.c.status !== "approved") throw new PaymentError("Only approved compensation can be paid.");
  const i = c.c;
  const decision = await decide(tx, { staffId: i.staffId, projectId: i.projectId, category: i.category, amountCents: i.amountCents, workDate: i.workDate }, override);
  const label = CATEGORY_LABEL[i.category] ?? i.category;
  const p = await insertLine(
    tx,
    {
      compensationItemId: i.id,
      staffId: i.staffId,
      projectId: i.projectId,
      serviceDate: i.workDate,
      classification: c.classification,
      category: i.category,
      payableMinutes: 0,
      rateCents: dollarsToCents(i.unitRate),
      baseCents: i.amountCents,
      quantity: i.quantity,
      unitRate: i.unitRate,
      description: i.category === "mileage" ? `${label}: ${i.quantity} km on ${i.tripDate} (${i.businessPurpose})` : i.category === "bonus" ? `${label}: ${i.reason}` : label,
      currency: c.currency,
      calcInputs: { compensationItemId: i.id, unitRate: i.unitRate, quantity: i.quantity, shiftId: i.shiftId },
    },
    decision,
    actorId,
  );
  await tx.update(compensationItems).set({ payableItemId: p.id }).where(eq(compensationItems.id, i.id));
  return p;
}

async function voidPayable(tx: Tx, p: Payable, actorId: string, reason: string) {
  if (!canMovePayable(p.status, "void") || p.billId) throw new PaymentError(p.billId ? "This line is on a finalized bill. Correct it with an adjustment." : `A payable that is ${p.status} can't be voided.`);
  await tx.update(payableItems).set({ status: "void", voidedAt: new Date(), voidedBy: actorId, voidReason: reason }).where(eq(payableItems.id, p.id));
  await recordAudit({ actorId, action: "payable.void", entityType: "payable", entityId: p.id, projectId: p.projectId, before: { status: p.status }, after: { status: "void" }, reason }, tx);
}

/** Recalculates a line from its source (timesheet or compensation item). */
async function recreate(tx: Tx, p: Payable, actorId: string, override?: TaxOverride) {
  if (p.timesheetId) return createPayableForTimesheet(tx, p.timesheetId, actorId, override);
  if (p.compensationItemId) {
    await tx.update(compensationItems).set({ payableItemId: null }).where(eq(compensationItems.id, p.compensationItemId));
    return createPayableForCompensation(tx, p.compensationItemId, actorId, override);
  }
  throw new PaymentError("Adjustment lines can't be recalculated; add another adjustment instead.");
}

/** After a post-approval correction (timesheet still approved, so the line isn't batched yet). */
export async function replacePayableAfterCorrection(tx: Tx, timesheetId: string, actorId: string, reason: string) {
  const [current] = await tx.select().from(payableItems).where(and(eq(payableItems.timesheetId, timesheetId), sql`${payableItems.status} <> 'void'`)).for("update");
  // Already on a (self-billed) invoice: the invoice stands; the difference becomes a linked adjustment.
  if (current?.billId) {
    const [t] = await tx.select({ minutes: timesheets.payableMinutes }).from(timesheets).where(eq(timesheets.id, timesheetId));
    const delta = basePayCents(t?.minutes ?? 0, current.rateCents) - current.baseCents;
    return delta === 0 ? current : adjustInTx(tx, actorId, { payableId: current.id, amountCents: delta, reason: `Hours corrected after approval: ${reason}` });
  }
  if (current) await voidPayable(tx, current, actorId, `Hours corrected: ${reason}`);
  return createPayableForTimesheet(tx, timesheetId, actorId);
}

/**
 * Finance corrects the tax treatment of a line before its bill is finalized: the line is voided
 * and recreated with Finance's decision (chosen from configured rules) and the reason is audited.
 */
export async function overrideLineTax(actorId: string, payableId: string, override: TaxOverride) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payableItems).where(eq(payableItems.id, payableId)).for("update");
    if (!p) throw new PaymentError("Line not found.");
    if (p.status !== "pending" || p.billId) throw new PaymentError("Tax can only be corrected before the line is batched and billed. Take it out of the batch first, or use an adjustment.");
    await voidPayable(tx, p, actorId, `Tax treatment corrected by Finance: ${override.reason.trim()}`);
    const next = await recreate(tx, p, actorId, override);
    await recordAudit({ actorId, action: "payable.tax_override", entityType: "payable", entityId: next.id, projectId: p.projectId, before: { payableId: p.id, taxCents: p.taxCents, taxStatus: p.taxStatus }, after: { taxCents: next.taxCents, ruleIds: override.ruleIds }, reason: override.reason.trim() }, tx);
    return next;
  });
}


/**
 * Recalculates unbatched, unbilled lines whose basis changed (classification, GST/HST answer or
 * Finance verification) and lines waiting for tax review that may now be calculated automatically.
 */
export async function refreshClassifications(actorId: string) {
  return db.transaction(async (tx) => {
    const stale = await tx
      .select({ p: payableItems })
      .from(payableItems)
      .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
      .leftJoin(staffSensitive, eq(staffSensitive.staffId, payableItems.staffId))
      .where(and(eq(payableItems.status, "pending"), isNull(payableItems.billId), sql`${payableItems.category} <> 'adjustment'`, sql`(${staleLine} or ${payableItems.taxStatus} = 'review_required')`))
      .for("update", { of: payableItems });
    let changed = 0;
    for (const { p } of stale) {
      await voidPayable(tx, p, actorId, "Pay details updated");
      const next = await recreate(tx, p, actorId);
      if (next.taxCents !== p.taxCents || next.taxStatus !== p.taxStatus || next.classification !== p.classification) changed++;
    }
    await recordAudit({ actorId, action: "payables.refresh", entityType: "payable", after: { recalculated: stale.length, changed } }, tx);
    return stale.length;
  });
}

// ─── Adjustments (after a line is billed, exported or paid) ─────────────────────

/**
 * Corrects a finalized line with a linked adjustment (positive) or credit (negative). The original
 * line and its bill are untouched. Tax mirrors the original line's components and rates.
 */
export async function createAdjustment(actorId: string, input: { payableId: string; amountCents: number; reason: string }) {
  return db.transaction((tx) => adjustInTx(tx, actorId, input));
}

async function adjustInTx(tx: Tx, actorId: string, input: { payableId: string; amountCents: number; reason: string }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) throw new PaymentError("Enter a non-zero amount in cents.");
  if (input.reason.trim().length < 5) throw new PaymentError("Explain the adjustment.");
  {
    const [orig] = await tx.select({ p: payableItems, billNumber: bills.billNumber }).from(payableItems).leftJoin(bills, eq(bills.id, payableItems.billId)).where(eq(payableItems.id, input.payableId)).for("update", { of: payableItems });
    if (!orig) throw new PaymentError("Line not found.");
    const p = orig.p;
    if (p.status === "void") throw new PaymentError("A void line can't be adjusted.");
    if (!p.billId && !["exported", "paid", "disputed"].includes(p.status)) throw new PaymentError("This line isn't finalized yet; correct the hours or tax instead of adjusting.");
    if (p.taxStatus === "review_required") throw new PaymentError("Resolve the tax review on the original line first.");
    const taxLines = await tx.select().from(payableTaxLines).where(eq(payableTaxLines.payableItemId, p.id));
    const label = `${orig.billNumber ?? "line"} ${CATEGORY_LABEL[p.category] ?? p.category} ${p.serviceDate}`;
    const mirrored = mirrorTaxLines(taxLines, input.amountCents, label);
    const taxCents = mirrored.reduce((n, l) => n + l.taxCents, 0);
    const reg = await tx.select({ s: currentRegSnapshot }).from(staffProfiles).leftJoin(staffSensitive, eq(staffSensitive.staffId, staffProfiles.id)).where(eq(staffProfiles.id, p.staffId));
    const line = await insertLine(
      tx,
      {
        adjustsPayableId: p.id,
        staffId: p.staffId,
        projectId: p.projectId,
        serviceDate: p.serviceDate,
        classification: p.classification,
        category: "adjustment",
        payableMinutes: 0,
        rateCents: input.amountCents,
        baseCents: input.amountCents,
        quantity: "1",
        unitRate: (input.amountCents / 100).toFixed(4),
        description: `${input.amountCents < 0 ? "Credit" : "Adjustment"} to ${label}: ${input.reason.trim()}`,
        currency: p.currency,
        calcInputs: { adjusts: p.id, originalCategory: p.category, reason: input.reason.trim() },
      },
      { status: mirrored.length ? "calculated" : "no_tax", lines: mirrored, taxCents, basis: mirrored.length ? `Adjustment: same tax as ${label}.` : `Adjustment: no tax on ${label}.`, registrationSnapshot: reg[0]?.s ?? "unknown:unverified" },
      actorId,
    );
    await recordAudit({ actorId, action: "payable.adjust", entityType: "payable", entityId: line.id, projectId: p.projectId, before: { adjusts: p.id }, after: { amountCents: input.amountCents, taxCents }, reason: input.reason.trim() }, tx);
    return line;
  }
}

// ─── Pay periods ────────────────────────────────────────────────────────────────

export async function ensurePayPeriod(tx: Tx | typeof db, serviceDate: string) {
  const settings = await getOrgSettings();
  const p = payPeriodFor(serviceDate, (settings.payPeriodRule as PayPeriodRule) ?? "semi_monthly");
  await tx.insert(payPeriods).values(p).onConflictDoNothing();
  const [row] = await tx.select().from(payPeriods).where(and(eq(payPeriods.startsOn, p.startsOn), eq(payPeriods.endsOn, p.endsOn)));
  return row!;
}

// ─── Batches ────────────────────────────────────────────────────────────────────

async function lockBatch(tx: Tx, batchId: string) {
  const [b] = await tx.select().from(paymentBatches).where(eq(paymentBatches.id, batchId)).for("update");
  if (!b) throw new PaymentError("Batch not found.");
  return b;
}

async function moveBatch(tx: Tx, b: Batch, to: BatchStatus, actorId: string, extra: Partial<typeof paymentBatches.$inferInsert> = {}, reason: string | null = null) {
  if (!canMoveBatch(b.status, to)) throw new PaymentError(`This batch is ${b.status} and can't be ${to === "void" ? "voided" : `marked ${to}`}.`);
  await tx.update(paymentBatches).set({ status: to, ...extra }).where(eq(paymentBatches.id, b.id));
  await recordAudit({ actorId, action: `batch.${to}`, entityType: "payment_batch", entityId: b.id, before: { status: b.status }, after: { status: to }, reason }, tx);
}

async function movePayables(tx: Tx, ids: string[], from: PayableStatus[], to: PayableStatus) {
  if (!ids.length) return;
  for (const f of from) if (!canMovePayable(f, to)) throw new Error(`payable ${f} → ${to} not allowed`);
  await tx.update(payableItems).set({ status: to }).where(and(inArray(payableItems.id, ids), inArray(payableItems.status, from)));
}

/** Timesheet status follows its fee line through the batch (approved → locked → exported → paid). */
async function moveTimesheets(tx: Tx, payableIds: string[], from: ("approved" | "locked" | "exported" | "paid")[], to: "approved" | "locked" | "exported" | "paid") {
  if (!payableIds.length) return;
  await tx
    .update(timesheets)
    .set({ status: to, ...(to === "locked" ? { lockedAt: new Date() } : to === "approved" ? { lockedAt: null } : {}) })
    .where(
      and(
        inArray(timesheets.id, tx.select({ id: sql<string>`${payableItems.timesheetId}` }).from(payableItems).where(and(inArray(payableItems.id, payableIds), sql`${payableItems.timesheetId} is not null`))),
        inArray(timesheets.status, from),
      ),
    );
}

function assertUuids(ids: string[]) {
  for (const id of ids) if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PaymentError("Invalid id.");
}

async function nextReference(tx: Tx, type: BatchType, periodStart: string | null) {
  const prefix = `${type === "contractor" ? "CON" : "PAY"}-${(periodStart ?? new Date().toISOString().slice(0, 10)).replaceAll("-", "")}`;
  // Serialise reference allocation for the same prefix.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${prefix}, 0))`);
  const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from payment_batches where reference like ${prefix + "-%"}`)).rows as [{ n: number }];
  return `${prefix}-${n + 1}`;
}

/**
 * Creates a draft batch from ready lines (pending, or failed and being retried). Lines are locked
 * FOR UPDATE and a partial unique index allows each line in only one active batch, so concurrent
 * requests for the same lines can't both succeed. Lines waiting for tax review, or whose basis
 * changed since they were calculated, are refused.
 */
export async function createBatch(actorId: string, input: { type: BatchType; payPeriodId: string | null; payableIds: string[] }) {
  if (!input.payableIds.length) throw new PaymentError("Select at least one payable.");
  assertUuids(input.payableIds);
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select({ p: payableItems, projectDemo: projects.isDemo, staffDemo: staffProfiles.isDemo, staffClassification: staffProfiles.classification, stale: staleLine })
        .from(payableItems)
        .innerJoin(projects, eq(projects.id, payableItems.projectId))
        .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
        .leftJoin(staffSensitive, eq(staffSensitive.staffId, payableItems.staffId))
        .where(inArray(payableItems.id, input.payableIds))
        .orderBy(asc(payableItems.id))
        .for("update", { of: payableItems });
      if (rows.length !== new Set(input.payableIds).size) throw new PaymentError("Some payables weren't found.");
      let period: typeof payPeriods.$inferSelect | undefined;
      if (input.payPeriodId) {
        [period] = await tx.select().from(payPeriods).where(eq(payPeriods.id, input.payPeriodId));
        if (!period) throw new PaymentError("Pay period not found.");
        if (period.closedAt) throw new PaymentError("That pay period is closed.");
      }
      const demo = new Set(rows.map((r) => r.projectDemo || r.staffDemo));
      if (demo.size > 1) throw new PaymentError("Demo and real payables can't be in the same batch.");
      for (const { p, stale } of rows) {
        if (p.status !== "pending" && p.status !== "failed") throw new PaymentError("Some payables are already in a batch or paid.");
        if (p.classification === "unset" || batchTypeFor(p.classification) !== input.type) {
          throw new PaymentError(p.classification === "unset" ? "Some people don't have a pay classification yet." : "Contractors and employees are paid in separate batches.");
        }
        if (p.taxStatus === "review_required") throw new PaymentError("Some lines are waiting for a Finance tax review. Resolve them first.");
        if (stale && !p.billId) throw new PaymentError("Someone's pay details changed since approval. Use Refresh pay details first.");
        if (period && p.serviceDate > period.endsOn) throw new PaymentError("Some shifts are after the end of this pay period.");
      }
      const perPerson = new Map<string, number>();
      for (const { p } of rows) perPerson.set(p.staffId, (perPerson.get(p.staffId) ?? 0) + p.totalCents);
      if ([...perPerson.values()].some((v) => v < 0)) throw new PaymentError("A credit is larger than what that contractor is owed in this batch. Add their other lines or leave the credit for a later batch.");
      const total = rows.reduce((n, r) => n + r.p.totalCents, 0);
      const currencies = new Set(rows.map((r) => r.p.currency));
      if (currencies.size > 1) throw new PaymentError("All payables in a batch must use one currency.");
      const [batch] = await tx
        .insert(paymentBatches)
        .values({ reference: await nextReference(tx, input.type, period?.startsOn ?? null), type: input.type, payPeriodId: period?.id ?? null, isDemo: [...demo][0]!, totalCents: total, currency: rows[0]!.p.currency, createdBy: actorId })
        .returning();
      await tx.insert(paymentBatchItems).values(rows.map(({ p }) => ({ batchId: batch!.id, payableItemId: p.id, amountCents: p.totalCents })));
      const ids = rows.map((r) => r.p.id);
      await movePayables(tx, ids, ["pending", "failed"], "batched");
      await moveTimesheets(tx, ids, ["approved"], "locked");
      await recordAudit({ actorId, action: "batch.create", entityType: "payment_batch", entityId: batch!.id, after: { reference: batch!.reference, type: input.type, items: ids.length, totalCents: total, isDemo: batch!.isDemo } }, tx);
      return batch!;
    });
  } catch (err) {
    // Unique violation on the active-batch index: another request batched the same line first.
    if ((err as { code?: string; cause?: { code?: string } }).code === "23505" || (err as { cause?: { code?: string } }).cause?.code === "23505") {
      throw new PaymentError("Some of these lines were just added to another batch.");
    }
    throw err;
  }
}

/**
 * What a batch approval covers: each line, its amount, the recipient and their payment details.
 * Any change afterwards (detected at export) cancels the approval.
 */
async function batchFingerprint(tx: Tx | typeof db, batchId: string) {
  const rows = await tx
    .select({
      payableId: payableItems.id,
      amountCents: paymentBatchItems.amountCents,
      staffId: payableItems.staffId,
      payee: sql<string | null>`coalesce(${staffSensitive.businessName}, ${staffSensitive.legalName})`,
      paymentRef: staffSensitive.paymentProviderRef,
      gst: staffSensitive.gstHstNumber,
      status: payableItems.status,
    })
    .from(paymentBatchItems)
    .innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId))
    .leftJoin(staffSensitive, eq(staffSensitive.staffId, payableItems.staffId))
    .where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)))
    .orderBy(asc(payableItems.id));
  return createHash("sha256").update(JSON.stringify(rows.map((r) => [r.payableId, r.amountCents, r.staffId, r.payee, r.paymentRef, r.gst, r.status === "void"]))).digest("hex");
}

async function invalidateApproval(tx: Tx, b: Batch, actorId: string, reason: string) {
  await tx.update(paymentBatches).set({ status: "draft", approvedBy: null, approvedAt: null, approvalFingerprint: null }).where(eq(paymentBatches.id, b.id));
  await recordAudit({ actorId, action: "batch.approval_invalidated", entityType: "payment_batch", entityId: b.id, before: { status: b.status, approvedBy: b.approvedBy }, after: { status: "draft" }, reason }, tx);
}

/** Takes one line out of a draft (or approved, which cancels the approval) batch. */
export async function removeFromBatch(actorId: string, batchId: string, payableId: string, reason: string) {
  assertUuids([batchId, payableId]);
  if (!reason.trim()) throw new PaymentError("Give a reason for removing it.");
  await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    if (b.status !== "draft" && b.status !== "approved") throw new PaymentError("Items can only be removed before the batch is exported.");
    const [item] = await tx.select().from(paymentBatchItems).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.payableItemId, payableId), eq(paymentBatchItems.active, true)));
    if (!item) throw new PaymentError("That payable isn't in this batch.");
    if (b.status === "approved") await invalidateApproval(tx, b, actorId, `Item removed after approval: ${reason.trim()}`);
    await tx.update(paymentBatchItems).set({ active: false, state: "removed", failureReason: `Removed: ${reason.trim()}` }).where(eq(paymentBatchItems.id, item.id));
    const [p] = await tx.select({ billId: payableItems.billId }).from(payableItems).where(eq(payableItems.id, payableId));
    await movePayables(tx, [payableId], ["batched"], p?.billId ? "failed" : "pending");
    await moveTimesheets(tx, [payableId], ["locked"], "approved");
    await tx.update(paymentBatches).set({ totalCents: b.totalCents - item.amountCents }).where(eq(paymentBatches.id, b.id));
    await recordAudit({ actorId, action: "batch.remove_item", entityType: "payment_batch", entityId: b.id, before: { payableId }, reason }, tx);
  });
}

/** Four-eyes approval: someone other than the creator (also a DB check). Fingerprints the batch. */
export async function approveBatch(actorId: string, batchId: string) {
  await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    assertDifferentApprover(b.createdBy, actorId);
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int n from payment_batch_items where batch_id = ${batchId} and active`)).rows as [{ n: number }];
    if (!n) throw new PaymentError("This batch is empty.");
    await moveBatch(tx, b, "approved", actorId, { approvedBy: actorId, approvedAt: new Date(), approvalFingerprint: await batchFingerprint(tx, batchId) });
  });
}

// ─── Bills ──────────────────────────────────────────────────────────────────────




/**
 * Finalizes a bill per contractor for the batch's lines that aren't billed yet (normally Finance
 * issues invoices before batching; this is the fallback). Contractors who accepted the self-billing
 * arrangement get a Contractor Invoice; others an internal bill.
 */
async function finalizeBills(tx: Tx, b: Batch, actorId: string) {
  const lines = await tx
    .select({ id: payableItems.id, staffId: payableItems.staffId })
    .from(paymentBatchItems)
    .innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId))
    .where(and(eq(paymentBatchItems.batchId, b.id), eq(paymentBatchItems.active, true), isNull(payableItems.billId)));
  const byStaff = new Map<string, string[]>();
  for (const l of lines) byStaff.set(l.staffId, [...(byStaff.get(l.staffId) ?? []), l.id]);
  const created: string[] = [];
  for (const [staffId, ids] of byStaff) created.push((await createBill(tx, { staffId, lineIds: ids, actorId, batch: { id: b.id, currency: b.currency, isDemo: b.isDemo } })).id);
  return created;
}

/** A bill is paid when every non-void line on it is paid. */
async function refreshBillStatus(tx: Tx, billIds: (string | null)[]) {
  const ids = [...new Set(billIds.filter((x): x is string => Boolean(x)))];
  for (const id of ids) {
    const [{ open }] = (await tx.execute<{ open: number }>(sql`select count(*)::int as open from payable_items where bill_id = ${id} and status not in ('paid', 'void', 'disputed')`)).rows as [{ open: number }];
    await tx.update(bills).set({ status: open ? "open" : "paid" }).where(and(eq(bills.id, id), sql`${bills.status} <> 'void'`));
  }
}

// ─── Bank export ────────────────────────────────────────────────────────────────

async function exportRows(tx: Tx | typeof db, batchId: string): Promise<ExportRow[]> {
  return tx
    .select({
      payableId: payableItems.id,
      billNumber: bills.billNumber,
      staffName: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`,
      legalName: sql<string | null>`coalesce(${staffSensitive.businessName}, ${staffSensitive.legalName})`,
      email: staffProfiles.email,
      projectCode: projects.code,
      projectName: projects.name,
      serviceDate: payableItems.serviceDate,
      category: payableItems.category,
      description: payableItems.description,
      role: sql<string>`coalesce(${payableItems.calcInputs} ->> 'role', '')`,
      payableMinutes: payableItems.payableMinutes,
      rateCents: payableItems.rateCents,
      subtotalCents: payableItems.baseCents,
      hstCents: payableItems.taxCents,
      gstHstNumber: staffSensitive.gstHstNumber,
      totalCents: payableItems.totalCents,
      currency: payableItems.currency,
    })
    .from(paymentBatchItems)
    .innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId))
    .leftJoin(bills, eq(bills.id, payableItems.billId))
    .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
    .leftJoin(staffSensitive, eq(staffSensitive.staffId, payableItems.staffId))
    .innerJoin(projects, eq(projects.id, payableItems.projectId))
    .where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)))
    .orderBy(asc(staffProfiles.lastName), asc(payableItems.serviceDate), asc(payableItems.category));
}

/**
 * Generates the bank payment file once. The approval must still match the batch (people, amounts,
 * payment details, lines); otherwise the approval is cancelled and a second person must approve
 * again. The first export finalizes the bills. While a live export exists another is refused.
 */
export async function exportBatch(actorId: string, batchId: string, format: ExportFormat) {
  if (format === ("csv_qbo" as ExportFormat)) throw new PaymentError("QuickBooks bills are exported from Accounting exports, separately from bank files.");
  // Check the approval in its own transaction so a cancelled approval is saved even though the export stops.
  const invalidated = await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    if (b.status !== "approved") return false;
    if (b.approvalFingerprint === (await batchFingerprint(tx, batchId))) return false;
    await invalidateApproval(tx, b, actorId, "Recipients, amounts, payment details or lines changed after approval.");
    return true;
  });
  if (invalidated) throw new PaymentError("Something in this batch changed after it was approved (a recipient, amount, payment detail or line). The approval was cancelled; a second person needs to approve it again.");
  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    if (b.status !== "approved" && b.status !== "exported") throw new PaymentError(b.status === "draft" ? "A second person needs to approve this batch before export." : `This batch is ${b.status}.`);
    if (b.status === "exported" && b.submittedAt) throw new PaymentError("This batch was already submitted to the bank.");
    const live = await tx.select().from(paymentExports).where(and(eq(paymentExports.batchId, batchId), isNull(paymentExports.supersededAt), eq(paymentExports.purpose, "bank")));
    if (live.length) throw new PaymentError("This batch has already been exported. Download the existing file, or void that export (with a reason) to generate a new one.");
    if (b.status === "approved") await finalizeBills(tx, b, actorId);
    const rows = await exportRows(tx, batchId);
    if (!rows.length) throw new PaymentError("This batch is empty.");
    const [period] = b.payPeriodId ? await tx.select().from(payPeriods).where(eq(payPeriods.id, b.payPeriodId)) : [];
    const file = await buildExport(format, { reference: b.reference, type: b.type, periodLabel: period?.label ?? null, isDemo: b.isDemo }, rows, torontoToday());
    const sha256 = createHash("sha256").update(file.data).digest("hex");
    const key = `exports/${b.id}/${Date.now()}-${file.fileName}`;
    await storage().put(key, file.data, file.contentType);
    const [exp] = await tx.insert(paymentExports).values({ batchId, format, purpose: "bank", storageKey: key, sha256, rowCount: file.rowCount, exportedBy: actorId }).returning();
    if (b.status === "approved") {
      await moveBatch(tx, b, "exported", actorId);
      const ids = rows.map((r) => r.payableId);
      await movePayables(tx, ids, ["batched"], "exported");
      await moveTimesheets(tx, ids, ["locked"], "exported");
      await tx.update(paymentBatchItems).set({ state: "exported" }).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)));
    }
    await recordAudit({ actorId, action: "batch.export", entityType: "payment_batch", entityId: b.id, after: { format, sha256, rows: file.rowCount, exportId: exp!.id } }, tx);
    return { exportId: exp!.id, ...file, sha256 };
  });
}

/** Re-download of an existing export: the same bytes, checked against the stored fingerprint. */
export async function readExport(actorId: string, exportId: string) {
  const [exp] = await db.select({ e: paymentExports, b: paymentBatches }).from(paymentExports).innerJoin(paymentBatches, eq(paymentBatches.id, paymentExports.batchId)).where(eq(paymentExports.id, exportId));
  if (!exp?.e.storageKey) throw new PaymentError("Export not found.");
  const data = await storage().get(exp.e.storageKey);
  if (createHash("sha256").update(data).digest("hex") !== exp.e.sha256) throw new PaymentError("The stored export doesn't match its fingerprint. Contact an administrator.");
  await recordAudit({ actorId, action: "batch.export_download", entityType: "payment_batch", entityId: exp.b.id, after: { exportId, superseded: Boolean(exp.e.supersededAt) } });
  const fileName = exp.e.storageKey.split("/").pop()!.replace(/^\d+-/, "");
  const contentType = exp.e.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
  return { data, fileName, contentType };
}

/** Voids a bank file that was rejected or never used, before it was submitted to the bank. */
export async function supersedeExport(actorId: string, exportId: string, reason: string) {
  if (!reason.trim()) throw new PaymentError("Explain why the export is being replaced (e.g. the file was rejected and not imported).");
  await db.transaction(async (tx) => {
    const [exp] = await tx.select().from(paymentExports).where(eq(paymentExports.id, exportId)).for("update");
    if (!exp || exp.supersededAt) throw new PaymentError("Export not found or already voided.");
    const b = await lockBatch(tx, exp.batchId);
    if (b.status !== "exported") throw new PaymentError(`This batch is ${b.status}; its export can't be replaced.`);
    if (b.submittedAt) throw new PaymentError("This file was submitted to the bank. Record what the bank did with each payment instead.");
    await tx.update(paymentExports).set({ supersededAt: new Date(), supersededReason: reason.trim() }).where(eq(paymentExports.id, exportId));
    await recordAudit({ actorId, action: "batch.export_void", entityType: "payment_batch", entityId: b.id, before: { exportId, sha256: exp.sha256 }, reason }, tx);
  });
}

// ─── Bank submission and reconciliation (manual, auditable) ─────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function dateAt(day: string, label: string) {
  if (!ISO.test(day)) throw new PaymentError(`Enter the ${label}.`);
  const at = new Date(`${day}T12:00:00Z`);
  if (at.getTime() > Date.now() + 24 * 3_600_000) throw new PaymentError(`The ${label} can't be in the future.`);
  return at;
}

/** Finance records that the bank file was submitted (still not settled). */
export async function markBatchSubmitted(actorId: string, batchId: string, input: { submittedOn: string; bankReference: string }) {
  const at = dateAt(input.submittedOn, "submission date");
  if (input.bankReference.trim().length < 2) throw new PaymentError("Enter the bank's reference for the submission.");
  await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    if (b.status !== "exported") throw new PaymentError("Export the bank file before recording its submission.");
    if (b.submittedAt) throw new PaymentError("Submission was already recorded.");
    await tx.update(paymentBatches).set({ submittedAt: at, submittedBy: actorId, bankReference: input.bankReference.trim() }).where(eq(paymentBatches.id, b.id));
    await tx.update(paymentBatchItems).set({ state: "submitted" }).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true), eq(paymentBatchItems.state, "exported")));
    await recordAudit({ actorId, action: "batch.submitted", entityType: "payment_batch", entityId: b.id, after: { submittedOn: input.submittedOn, bankReference: input.bankReference.trim() } }, tx);
  });
}

export type SettlementOutcome = {
  payableId: string;
  outcome: "settled" | "failed" | "bank_cancelled";
  date: string;
  bankReference?: string | null;
  /** Required for settled: where the bank confirmation is (e.g. statement line, bank portal reference). */
  evidence?: string | null;
  /** Required for failed and bank_cancelled. */
  reason?: string | null;
};

/**
 * Manual reconciliation: Finance records what the bank did with each payment, with evidence.
 * Settled lines become paid; failed or bank-cancelled ones become ready to retry against the same
 * bill. When nothing is outstanding the batch is reconciled (status "paid").
 */
export async function recordSettlement(actorId: string, batchId: string, outcomes: SettlementOutcome[]) {
  if (!outcomes.length) throw new PaymentError("Record at least one payment outcome.");
  for (const o of outcomes) {
    dateAt(o.date, o.outcome === "settled" ? "settlement date" : "date");
    if (o.outcome === "settled" && !o.evidence?.trim()) throw new PaymentError("Record the bank evidence for each settled payment.");
    if (o.outcome !== "settled" && !o.reason?.trim()) throw new PaymentError("Give a reason for each payment that didn't go through.");
    if (o.outcome === "bank_cancelled" && !o.bankReference?.trim()) throw new PaymentError("Enter the bank's cancellation reference.");
  }
  await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    if (b.status !== "exported") throw new PaymentError(b.status === "paid" ? "This batch is already reconciled." : "Export the bank file first.");
    const items = await tx.select({ i: paymentBatchItems, billId: payableItems.billId, staffId: payableItems.staffId }).from(paymentBatchItems).innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId)).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)));
    const settledStaff = new Set<string>();
    let latest: Date | null = null;
    for (const o of outcomes) {
      const row = items.find((x) => x.i.payableItemId === o.payableId);
      if (!row) throw new PaymentError("A payment isn't in this batch.");
      if (!["exported", "submitted"].includes(row.i.state)) throw new PaymentError("A payment in this batch was already reconciled.");
      const at = dateAt(o.date, "date");
      if (o.outcome === "settled") {
        await tx.update(paymentBatchItems).set({ state: "settled", paidAt: at, evidence: o.evidence!.trim(), bankReference: o.bankReference?.trim() || null, reconciledBy: actorId, reconciledAt: new Date() }).where(eq(paymentBatchItems.id, row.i.id));
        await movePayables(tx, [o.payableId], ["exported"], "paid");
        await moveTimesheets(tx, [o.payableId], ["exported"], "paid");
        settledStaff.add(row.staffId);
        if (!latest || at > latest) latest = at;
      } else {
        await tx.update(paymentBatchItems).set({ state: o.outcome, active: false, failureReason: o.reason!.trim(), bankReference: o.bankReference?.trim() || null, reconciledBy: actorId, reconciledAt: new Date() }).where(eq(paymentBatchItems.id, row.i.id));
        await movePayables(tx, [o.payableId], ["exported"], "failed");
      }
    }
    await refreshBillStatus(tx, items.map((x) => x.billId));
    const [{ open }] = (await tx.execute<{ open: number }>(sql`select count(*)::int as open from payment_batch_items where batch_id = ${batchId} and active and state in ('exported', 'submitted')`)).rows as [{ open: number }];
    if (!open) {
      const [{ settled, last }] = (await tx.execute<{ settled: number; last: Date | null }>(sql`select count(*)::int as settled, max(paid_at) as last from payment_batch_items where batch_id = ${batchId} and state = 'settled'`)).rows as [{ settled: number; last: Date | null }];
      if (settled) await moveBatch(tx, b, "paid", actorId, { paidAt: last ? new Date(last) : latest }, "Reconciled");
    }
    for (const staffId of settledStaff) await enqueue(tx, { type: "payment.paid", payload: { batchId, staffId }, dedupeKey: `payment.paid:${batchId}:${staffId}` });
    await recordAudit({ actorId, action: "batch.reconcile", entityType: "payment_batch", entityId: b.id, after: { outcomes: outcomes.map((o) => ({ payableId: o.payableId, outcome: o.outcome, date: o.date, bankReference: o.bankReference ?? null })) } }, tx);
  });
}

/**
 * Convenience for a whole batch confirmed by the bank: every outstanding payment settled on one
 * date with one piece of evidence, except those listed as failed.
 */
export async function markBatchPaid(actorId: string, batchId: string, input: { paidOn: string; evidence: string; bankReference?: string | null; failed?: { payableId: string; reason: string }[] }) {
  const [b] = await db.select({ status: paymentBatches.status }).from(paymentBatches).where(eq(paymentBatches.id, batchId));
  if (!b) throw new PaymentError("Batch not found.");
  if (b.status !== "exported") throw new PaymentError(b.status === "paid" ? "This batch is already reconciled." : "Export the bank file before recording what the bank did.");
  const items = await db.select({ payableId: paymentBatchItems.payableItemId, state: paymentBatchItems.state }).from(paymentBatchItems).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)));
  const failed = new Map((input.failed ?? []).map((f) => [f.payableId, f.reason]));
  for (const id of failed.keys()) if (!items.some((i) => i.payableId === id)) throw new PaymentError("A failed item isn't in this batch.");
  const outstanding = items.filter((i) => ["exported", "submitted"].includes(i.state));
  if (outstanding.length && outstanding.every((i) => failed.has(i.payableId))) throw new PaymentError("At least one payment must have gone through. Record the failures, or void the batch if it was never submitted.");
  await recordSettlement(
    actorId,
    batchId,
    outstanding.map((i) =>
      failed.has(i.payableId)
        ? { payableId: i.payableId, outcome: "failed" as const, date: input.paidOn, reason: failed.get(i.payableId)! }
        : { payableId: i.payableId, outcome: "settled" as const, date: input.paidOn, evidence: input.evidence, bankReference: input.bankReference ?? null },
    ),
  );
}

/** The bank returned a payment after it settled: the line goes back to ready-to-retry on its bill. */
export async function recordReturn(actorId: string, input: { batchId: string; payableId: string; returnedOn: string; reason: string; bankReference: string }) {
  const at = dateAt(input.returnedOn, "return date");
  if (!input.reason.trim() || !input.bankReference.trim()) throw new PaymentError("Enter the return reason and the bank's reference.");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ i: paymentBatchItems, billId: payableItems.billId })
      .from(paymentBatchItems)
      .innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId))
      .where(and(eq(paymentBatchItems.batchId, input.batchId), eq(paymentBatchItems.payableItemId, input.payableId), eq(paymentBatchItems.state, "settled")))
      .for("update", { of: paymentBatchItems });
    if (!row) throw new PaymentError("Only a settled payment can be returned.");
    await tx.update(paymentBatchItems).set({ state: "returned", active: false, returnedAt: at, failureReason: `Returned: ${input.reason.trim()}`, bankReference: input.bankReference.trim(), reconciledBy: actorId, reconciledAt: new Date() }).where(eq(paymentBatchItems.id, row.i.id));
    await movePayables(tx, [input.payableId], ["paid"], "failed");
    await moveTimesheets(tx, [input.payableId], ["paid"], "exported");
    await refreshBillStatus(tx, [row.billId]);
    await recordAudit({ actorId, action: "payment.returned", entityType: "payment_batch", entityId: input.batchId, after: { payableId: input.payableId, returnedOn: input.returnedOn, bankReference: input.bankReference.trim() }, reason: input.reason.trim() }, tx);
  });
}

/**
 * Crew void: cancels a batch inside Crew before anything was submitted to the bank. Lines return to
 * ready (billed lines keep their bill and are retried against it). After submission, use
 * recordSettlement with "bank_cancelled" and the bank's confirmation instead.
 */
export async function voidBatch(actorId: string, batchId: string, reason: string) {
  if (!reason.trim()) throw new PaymentError("Give a reason for voiding the batch.");
  await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    if (b.submittedAt) throw new PaymentError("This batch was submitted to the bank, so it can't be voided in Crew. Record the bank's cancellation for each payment instead.");
    const items = await tx.select({ i: paymentBatchItems, billId: payableItems.billId }).from(paymentBatchItems).innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId)).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)));
    if (items.some((x) => x.i.state === "settled")) throw new PaymentError("Some payments in this batch have settled.");
    await moveBatch(tx, b, "void", actorId, { voidedAt: new Date(), voidReason: reason.trim() }, reason);
    await tx.update(paymentBatchItems).set({ active: false, state: "voided" }).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)));
    const billed = items.filter((x) => x.billId).map((x) => x.i.payableItemId);
    const unbilled = items.filter((x) => !x.billId).map((x) => x.i.payableItemId);
    await movePayables(tx, unbilled, ["batched", "exported"], "pending");
    await movePayables(tx, billed, ["batched", "exported"], "pending");
    await moveTimesheets(tx, [...billed, ...unbilled], ["locked", "exported"], "approved");
    await tx.update(paymentExports).set({ supersededAt: new Date(), supersededReason: `Batch voided: ${reason.trim()}` }).where(and(eq(paymentExports.batchId, batchId), isNull(paymentExports.supersededAt)));
  });
}
