// Payables, payment batches, exports and paid status. Amounts are calculated once, stored with
// their inputs, and never edited (DB triggers enforce it). Corrections before payment void and
// recreate the payable; nothing here moves money, it records what Finance does elsewhere.
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { assertDifferentApprover } from "@/server/authz/permissions";
import { db, type Tx } from "@/server/db";
import {
  bookings,
  payableItems,
  paymentBatches,
  paymentBatchItems,
  paymentExports,
  payPeriods,
  projects,
  shifts,
  staffProfiles,
  staffSensitive,
  timesheets,
} from "@/server/db/schema";
import { utcToZoned } from "@/lib/time";
import { enqueue } from "@/server/notify/outbox";
import { getOrgSettings } from "@/server/settings";
import { storage } from "@/server/storage";
import { buildExport, type ExportFormat, type ExportRow } from "./payment-exports";
import {
  basePayCents,
  batchTypeFor,
  CALC_VERSION,
  canMoveBatch,
  canMovePayable,
  payPeriodFor,
  type BatchStatus,
  type BatchType,
  type PayableStatus,
  type PayPeriodRule,
} from "./pay-rules";

export class PaymentError extends Error {}

type Payable = typeof payableItems.$inferSelect;
type Batch = typeof paymentBatches.$inferSelect;

// ─── Payables ───────────────────────────────────────────────────────────────────

/**
 * Creates the payable for an approved timesheet at the booking's agreed-rate snapshot (rule 3)
 * and the person's current pay classification. Called inside the approval transaction.
 */
export async function createPayableForTimesheet(tx: Tx, timesheetId: string, actorId: string) {
  const [row] = await tx
    .select({
      t: timesheets,
      agreedRateCents: bookings.agreedRateCents,
      currency: bookings.currency,
      role: bookings.role,
      startsAt: shifts.startsAt,
      timezone: shifts.timezone,
      classification: staffProfiles.classification,
    })
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
  const [p] = await tx
    .insert(payableItems)
    .values({
      timesheetId: t.id,
      staffId: t.staffId,
      projectId: t.projectId,
      serviceDate,
      classification: row.classification,
      payableMinutes: t.payableMinutes,
      rateCents: row.agreedRateCents,
      baseCents: base,
      totalCents: base,
      currency: row.currency,
      calcVersion: CALC_VERSION,
      calcInputs: { payableMinutes: t.payableMinutes, rateCents: row.agreedRateCents, rounding: "half_up_cent", timesheetVersion: t.version, role: row.role },
      createdBy: actorId,
    })
    .returning();
  await recordAudit({ actorId, action: "payable.create", entityType: "payable", entityId: p!.id, projectId: t.projectId, after: { totalCents: base, payableMinutes: t.payableMinutes, rateCents: row.agreedRateCents, classification: row.classification } }, tx);
  return p!;
}

async function voidPayable(tx: Tx, p: Payable, actorId: string, reason: string) {
  if (!canMovePayable(p.status, "void")) throw new PaymentError(`A payable that is ${p.status} can't be voided.`);
  await tx.update(payableItems).set({ status: "void", voidedAt: new Date(), voidedBy: actorId, voidReason: reason }).where(eq(payableItems.id, p.id));
  await recordAudit({ actorId, action: "payable.void", entityType: "payable", entityId: p.id, projectId: p.projectId, before: { status: p.status }, after: { status: "void" }, reason }, tx);
}

/** After a post-approval correction (timesheet still approved, so the payable isn't batched yet). */
export async function replacePayableAfterCorrection(tx: Tx, timesheetId: string, actorId: string, reason: string) {
  const [current] = await tx.select().from(payableItems).where(and(eq(payableItems.timesheetId, timesheetId), sql`${payableItems.status} <> 'void'`)).for("update");
  if (current) await voidPayable(tx, current, actorId, `Hours corrected: ${reason}`);
  return createPayableForTimesheet(tx, timesheetId, actorId);
}

/**
 * Re-snapshots the classification on payables that aren't in a batch yet, for people whose pay
 * classification has since been set or changed. Each one is voided and recreated (amounts unchanged).
 */
export async function refreshClassifications(actorId: string) {
  return db.transaction(async (tx) => {
    const stale = await tx
      .select({ p: payableItems })
      .from(payableItems)
      .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
      .where(and(inArray(payableItems.status, ["pending", "failed"]), sql`${payableItems.classification} <> ${staffProfiles.classification}`))
      .for("update", { of: payableItems });
    for (const { p } of stale) {
      await voidPayable(tx, p, actorId, "Pay classification updated");
      await createPayableForTimesheet(tx, p.timesheetId, actorId);
    }
    return stale.length;
  });
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

/** Timesheet status follows its payable through the batch (approved → locked → exported → paid). */
async function moveTimesheets(tx: Tx, payableIds: string[], from: ("approved" | "locked" | "exported")[], to: "approved" | "locked" | "exported" | "paid") {
  if (!payableIds.length) return;
  await tx
    .update(timesheets)
    .set({ status: to, ...(to === "locked" ? { lockedAt: new Date() } : to === "approved" ? { lockedAt: null } : {}) })
    .where(
      and(
        inArray(timesheets.id, tx.select({ id: payableItems.timesheetId }).from(payableItems).where(inArray(payableItems.id, payableIds))),
        inArray(timesheets.status, from),
      ),
    );
}

function assertUuids(ids: string[]) {
  for (const id of ids) if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PaymentError("Invalid id.");
}

async function nextReference(tx: Tx, type: BatchType, periodStart: string | null) {
  const prefix = `${type === "contractor" ? "CON" : "PAY"}-${(periodStart ?? new Date().toISOString().slice(0, 10)).replaceAll("-", "")}`;
  const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from payment_batches where reference like ${prefix + "-%"}`)).rows as [{ n: number }];
  return `${prefix}-${n + 1}`;
}

/**
 * Creates a draft batch from approved payables. All must be ready (pending, or failed and being
 * retried), match the batch type, and be all-demo or all-real. Their timesheets are locked.
 */
export async function createBatch(actorId: string, input: { type: BatchType; payPeriodId: string | null; payableIds: string[] }) {
  if (!input.payableIds.length) throw new PaymentError("Select at least one payable.");
  assertUuids(input.payableIds);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ p: payableItems, projectDemo: projects.isDemo, staffDemo: staffProfiles.isDemo, staffClassification: staffProfiles.classification })
      .from(payableItems)
      .innerJoin(projects, eq(projects.id, payableItems.projectId))
      .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
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
    for (const { p, staffClassification } of rows) {
      if (p.status !== "pending" && p.status !== "failed") throw new PaymentError("Some payables are already in a batch or paid.");
      if (p.classification === "unset" || batchTypeFor(p.classification) !== input.type) {
        throw new PaymentError(p.classification === "unset" ? "Some people don't have a pay classification yet." : "Contractors and employees are paid in separate batches.");
      }
      if (staffClassification !== p.classification) throw new PaymentError("Someone's pay classification changed since approval. Refresh classifications first.");
      if (period && p.serviceDate > period.endsOn) throw new PaymentError("Some shifts are after the end of this pay period.");
    }
    const total = rows.reduce((n, r) => n + r.p.totalCents, 0);
    const currencies = new Set(rows.map((r) => r.p.currency));
    if (currencies.size > 1) throw new PaymentError("All payables in a batch must use one currency.");
    const [batch] = await tx
      .insert(paymentBatches)
      .values({
        reference: await nextReference(tx, input.type, period?.startsOn ?? null),
        type: input.type,
        payPeriodId: period?.id ?? null,
        isDemo: [...demo][0]!,
        totalCents: total,
        currency: rows[0]!.p.currency,
        createdBy: actorId,
      })
      .returning();
    await tx.insert(paymentBatchItems).values(rows.map(({ p }) => ({ batchId: batch!.id, payableItemId: p.id, amountCents: p.totalCents })));
    const ids = rows.map((r) => r.p.id);
    await movePayables(tx, ids, ["pending", "failed"], "batched");
    await moveTimesheets(tx, ids, ["approved"], "locked");
    await recordAudit({ actorId, action: "batch.create", entityType: "payment_batch", entityId: batch!.id, after: { reference: batch!.reference, type: input.type, items: ids.length, totalCents: total, isDemo: batch!.isDemo } }, tx);
    return batch!;
  });
}

/** Takes one payable out of a draft batch (it goes back to ready, its timesheet back to approved). */
export async function removeFromBatch(actorId: string, batchId: string, payableId: string, reason: string) {
  assertUuids([batchId, payableId]);
  if (!reason.trim()) throw new PaymentError("Give a reason for removing it.");
  await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    if (b.status !== "draft") throw new PaymentError("Items can only be removed from a draft batch.");
    const [item] = await tx
      .select()
      .from(paymentBatchItems)
      .where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.payableItemId, payableId), eq(paymentBatchItems.active, true)));
    if (!item) throw new PaymentError("That payable isn't in this batch.");
    await tx.update(paymentBatchItems).set({ active: false, failureReason: `Removed: ${reason.trim()}` }).where(eq(paymentBatchItems.id, item.id));
    await movePayables(tx, [payableId], ["batched"], "pending");
    await moveTimesheets(tx, [payableId], ["locked"], "approved");
    await tx.update(paymentBatches).set({ totalCents: b.totalCents - item.amountCents }).where(eq(paymentBatches.id, b.id));
    await recordAudit({ actorId, action: "batch.remove_item", entityType: "payment_batch", entityId: b.id, before: { payableId }, reason }, tx);
  });
}

/** Four-eyes approval: someone other than the creator (also enforced by a DB check). */
export async function approveBatch(actorId: string, batchId: string) {
  await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    assertDifferentApprover(b.createdBy, actorId);
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int n from payment_batch_items where batch_id = ${batchId} and active`)).rows as [{ n: number }];
    if (!n) throw new PaymentError("This batch is empty.");
    await moveBatch(tx, b, "approved", actorId, { approvedBy: actorId, approvedAt: new Date() });
  });
}

async function exportRows(tx: Tx | typeof db, batchId: string): Promise<ExportRow[]> {
  return tx
    .select({
      payableId: payableItems.id,
      staffName: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`,
      // Payee name for invoices/bills: business name, else legal name (restricted; export is Finance-only).
      legalName: sql<string | null>`coalesce(${staffSensitive.businessName}, ${staffSensitive.legalName})`,
      email: staffProfiles.email,
      projectCode: projects.code,
      projectName: projects.name,
      serviceDate: payableItems.serviceDate,
      role: sql<string>`(${payableItems.calcInputs} ->> 'role')`,
      payableMinutes: payableItems.payableMinutes,
      rateCents: payableItems.rateCents,
      totalCents: payableItems.totalCents,
      currency: payableItems.currency,
    })
    .from(paymentBatchItems)
    .innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId))
    .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
    .leftJoin(staffSensitive, eq(staffSensitive.staffId, payableItems.staffId))
    .innerJoin(projects, eq(projects.id, payableItems.projectId))
    .where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)))
    .orderBy(asc(staffProfiles.lastName), asc(payableItems.serviceDate));
}

/**
 * Generates the export file once. While a live export exists, generating another (in any format)
 * is refused so the same payments can't be imported twice; the original file can be downloaded
 * again, or explicitly superseded with a reason before generating a replacement.
 */
export async function exportBatch(actorId: string, batchId: string, format: ExportFormat) {
  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    if (b.status !== "approved" && b.status !== "exported") throw new PaymentError(b.status === "draft" ? "A second person needs to approve this batch before export." : `This batch is ${b.status}.`);
    const live = await tx.select().from(paymentExports).where(and(eq(paymentExports.batchId, batchId), isNull(paymentExports.supersededAt)));
    if (live.length) throw new PaymentError("This batch has already been exported. Download the existing file, or void that export (with a reason) to generate a new one.");
    const rows = await exportRows(tx, batchId);
    if (!rows.length) throw new PaymentError("This batch is empty.");
    const [period] = b.payPeriodId ? await tx.select().from(payPeriods).where(eq(payPeriods.id, b.payPeriodId)) : [];
    const file = await buildExport(format, { reference: b.reference, type: b.type, periodLabel: period?.label ?? null, isDemo: b.isDemo }, rows, new Date().toISOString().slice(0, 10));
    const sha256 = createHash("sha256").update(file.data).digest("hex");
    const key = `exports/${b.id}/${Date.now()}-${file.fileName}`;
    await storage().put(key, file.data, file.contentType);
    const [exp] = await tx.insert(paymentExports).values({ batchId, format, storageKey: key, sha256, rowCount: file.rowCount, exportedBy: actorId }).returning();
    if (b.status === "approved") {
      await moveBatch(tx, b, "exported", actorId);
      const ids = rows.map((r) => r.payableId);
      await movePayables(tx, ids, ["batched"], "exported");
      await moveTimesheets(tx, ids, ["locked"], "exported");
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

export async function supersedeExport(actorId: string, exportId: string, reason: string) {
  if (!reason.trim()) throw new PaymentError("Explain why the export is being replaced (e.g. the file was rejected and not imported).");
  await db.transaction(async (tx) => {
    const [exp] = await tx.select().from(paymentExports).where(eq(paymentExports.id, exportId)).for("update");
    if (!exp || exp.supersededAt) throw new PaymentError("Export not found or already voided.");
    const b = await lockBatch(tx, exp.batchId);
    if (b.status !== "exported") throw new PaymentError(`This batch is ${b.status}; its export can't be replaced.`);
    await tx.update(paymentExports).set({ supersededAt: new Date(), supersededReason: reason.trim() }).where(eq(paymentExports.id, exportId));
    await recordAudit({ actorId, action: "batch.export_void", entityType: "payment_batch", entityId: b.id, before: { exportId, sha256: exp.sha256 }, reason }, tx);
  });
}

/**
 * Records that Finance paid the batch outside the platform. Items that bounced are marked failed
 * (with a reason) and can go into a later batch. Staff are notified of what was paid.
 */
export async function markBatchPaid(actorId: string, batchId: string, input: { paidOn: string; failed?: { payableId: string; reason: string }[] }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) throw new PaymentError("Enter the payment date.");
  const paidAt = new Date(`${input.paidOn}T12:00:00Z`);
  if (paidAt.getTime() > Date.now() + 24 * 3_600_000) throw new PaymentError("The payment date can't be in the future.");
  const failed = input.failed ?? [];
  for (const f of failed) if (!f.reason.trim()) throw new PaymentError("Give a reason for each failed payment.");
  await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    if (b.status !== "exported") throw new PaymentError("Export the batch before marking it paid.");
    const items = await tx.select().from(paymentBatchItems).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)));
    const failedIds = new Set(failed.map((f) => f.payableId));
    for (const id of failedIds) if (!items.some((i) => i.payableItemId === id)) throw new PaymentError("A failed item isn't in this batch.");
    const paidIds = items.filter((i) => !failedIds.has(i.payableItemId)).map((i) => i.payableItemId);
    if (!paidIds.length) throw new PaymentError("At least one payment must have gone through. Void the batch instead.");
    await tx.update(paymentBatchItems).set({ paidAt }).where(and(eq(paymentBatchItems.batchId, batchId), inArray(paymentBatchItems.payableItemId, paidIds)));
    await movePayables(tx, paidIds, ["exported"], "paid");
    await moveTimesheets(tx, paidIds, ["exported"], "paid");
    for (const f of failed) {
      await tx.update(paymentBatchItems).set({ active: false, failureReason: f.reason.trim() }).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.payableItemId, f.payableId)));
      await movePayables(tx, [f.payableId], ["exported"], "failed");
    }
    const paidTotal = items.filter((i) => paidIds.includes(i.payableItemId)).reduce((n, i) => n + i.amountCents, 0);
    await moveBatch(tx, b, "paid", actorId, { paidAt }, failed.length ? `${failed.length} failed` : null);
    const staff = await tx.selectDistinct({ staffId: payableItems.staffId }).from(payableItems).where(inArray(payableItems.id, paidIds));
    for (const s of staff) {
      await enqueue(tx, { type: "payment.paid", payload: { batchId, staffId: s.staffId }, dedupeKey: `payment.paid:${batchId}:${s.staffId}` });
    }
    await recordAudit({ actorId, action: "batch.paid_detail", entityType: "payment_batch", entityId: b.id, after: { paidOn: input.paidOn, paid: paidIds.length, paidTotal, failed } }, tx);
  });
}

/**
 * Voids a batch that hasn't been paid. Its payables return to ready and their timesheets to
 * approved; any live export is marked superseded. Use when a batch was built wrongly or the
 * export was rejected and never imported.
 */
export async function voidBatch(actorId: string, batchId: string, reason: string) {
  if (!reason.trim()) throw new PaymentError("Give a reason for voiding the batch.");
  await db.transaction(async (tx) => {
    const b = await lockBatch(tx, batchId);
    const items = await tx.select().from(paymentBatchItems).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)));
    const ids = items.map((i) => i.payableItemId);
    await moveBatch(tx, b, "void", actorId, { voidedAt: new Date(), voidReason: reason.trim() }, reason);
    await tx.update(paymentBatchItems).set({ active: false }).where(and(eq(paymentBatchItems.batchId, batchId), eq(paymentBatchItems.active, true)));
    await movePayables(tx, ids, ["batched", "exported"], "pending");
    await moveTimesheets(tx, ids, ["locked", "exported"], "approved");
    await tx
      .update(paymentExports)
      .set({ supersededAt: new Date(), supersededReason: `Batch voided: ${reason.trim()}` })
      .where(and(eq(paymentExports.batchId, batchId), isNull(paymentExports.supersededAt)));
  });
}
