"use server";
import { rateLimit } from "@/server/rate-limit";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runAction, UserFacingError } from "@/server/actions";
import { db } from "@/server/db";
import * as billing from "@/server/domain/billing";
import { EXPORT_FORMATS } from "@/server/domain/payment-exports";
import * as pay from "@/server/domain/payments";
import * as yearEnd from "@/server/domain/t4a";
import { kickOutbox } from "@/server/notify/run";
import { authorizeInternal, requireFreshAuth } from "@/server/session";

const uuid = z.string().uuid();

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof pay.PaymentError || err instanceof billing.BillingError || err instanceof yearEnd.YearEndError) throw new UserFacingError(err.message);
    throw err;
  }
}

function refresh(batchId?: string) {
  revalidatePath("/dashboard/payments", "layout");
  revalidatePath("/dashboard/reports/finance");
  if (batchId) revalidatePath(`/dashboard/payments/batches/${batchId}`);
}

export async function createBatchAction(input: { type: string; periodDate: string | null; payableIds: string[] }): Promise<ActionResult<{ batchId: string }>> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    const type = z.enum(["contractor", "payroll"]).parse(input.type);
    const ids = z.array(uuid).min(1).max(2000).parse(input.payableIds);
    const batch = await guard(async () => {
      const period = input.periodDate ? await pay.ensurePayPeriod(db, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(input.periodDate)) : null;
      return pay.createBatch(viewer.userId, { type, payPeriodId: period?.id ?? null, payableIds: ids });
    });
    refresh();
    return { ok: true, message: `Batch ${batch.reference} created with ${ids.length} item${ids.length === 1 ? "" : "s"}. A second person needs to approve it.`, data: { batchId: batch.id } };
  });
}

export async function refreshClassificationsAction(): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    const n = await guard(() => pay.refreshClassifications(viewer.userId));
    refresh();
    return { ok: true, message: n ? `Recalculated ${n} payable${n === 1 ? "" : "s"} with current pay details.` : "Everything already matches." };
  });
}

export async function approveBatchAction(batchId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await requireFreshAuth(viewer);
    await guard(() => pay.approveBatch(viewer.userId, uuid.parse(batchId)));
    refresh(batchId);
    return { ok: true, message: "Batch approved. It can now be exported." };
  });
}

export async function removeFromBatchAction(batchId: string, payableId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await guard(() => pay.removeFromBatch(viewer.userId, uuid.parse(batchId), uuid.parse(payableId), reason));
    refresh(batchId);
    return { ok: true, message: "Removed. It's back in the ready-to-pay list." };
  });
}

export async function exportBatchAction(batchId: string, format: string): Promise<ActionResult<{ exportId: string }>> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await requireFreshAuth(viewer);
    await rateLimit("export.payments", viewer.userId);
    const f = z.enum(EXPORT_FORMATS).parse(format);
    const res = await guard(() => pay.exportBatch(viewer.userId, uuid.parse(batchId), f));
    refresh(batchId);
    return { ok: true, message: `Bank file generated (${res.rowCount} row${res.rowCount === 1 ? "" : "s"}). Nothing is marked paid until you record what the bank did.`, data: { exportId: res.exportId } };
  });
}

export async function supersedeExportAction(batchId: string, exportId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await guard(() => pay.supersedeExport(viewer.userId, uuid.parse(exportId), reason));
    refresh(batchId);
    return { ok: true, message: "Export voided. You can generate a new file." };
  });
}

export async function markPaidAction(batchId: string, input: { paidOn: string; evidence: string; bankReference: string; failed: { payableId: string; reason: string }[] }): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await requireFreshAuth(viewer);
    const failed = z.array(z.object({ payableId: uuid, reason: z.string().max(500) })).parse(input.failed);
    await guard(() =>
      pay.markBatchPaid(viewer.userId, uuid.parse(batchId), { paidOn: z.string().parse(input.paidOn), evidence: z.string().max(500).parse(input.evidence), bankReference: input.bankReference?.trim() || null, failed }),
    );
    kickOutbox();
    refresh(batchId);
    return { ok: true, message: failed.length ? `Settlement recorded. ${failed.length} failed item${failed.length === 1 ? " is" : "s are"} ready to retry.` : "Settlement recorded. Contractors can see it in their portal." };
  });
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function markSubmittedAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await requireFreshAuth(viewer);
    const batchId = uuid.parse(str(formData, "batchId"));
    await guard(() => pay.markBatchSubmitted(viewer.userId, batchId, { submittedOn: dateStr.parse(str(formData, "submittedOn")), bankReference: str(formData, "bankReference") }));
    refresh(batchId);
    return { ok: true, message: "Bank submission recorded. Record each payment's outcome once the bank confirms it." };
  });
}

/** One payment outcome from the batch page's reconcile form. */
export async function recordSettlementAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await requireFreshAuth(viewer);
    const batchId = uuid.parse(str(formData, "batchId"));
    const outcome = z.enum(["settled", "failed", "bank_cancelled"]).parse(str(formData, "outcome"));
    await guard(() =>
      pay.recordSettlement(viewer.userId, batchId, [
        { payableId: uuid.parse(str(formData, "payableId")), outcome, date: str(formData, "date"), bankReference: str(formData, "bankReference") || null, evidence: str(formData, "evidence") || null, reason: str(formData, "reason") || null },
      ]),
    );
    kickOutbox();
    refresh(batchId);
    return { ok: true, message: outcome === "settled" ? "Recorded as settled." : "Recorded. The line is ready to retry in a new batch." };
  });
}

export async function recordReturnAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await requireFreshAuth(viewer);
    const batchId = uuid.parse(str(formData, "batchId"));
    await guard(() => pay.recordReturn(viewer.userId, { batchId, payableId: uuid.parse(str(formData, "payableId")), returnedOn: str(formData, "returnedOn"), reason: str(formData, "reason"), bankReference: str(formData, "bankReference") }));
    refresh(batchId);
    return { ok: true, message: "Return recorded. The line is ready to retry against the same bill." };
  });
}

/** Finance sets the tax on a line waiting for review: chosen configured rules, or none. */
export async function overrideLineTaxAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await requireFreshAuth(viewer);
    const payableId = uuid.parse(str(formData, "payableId"));
    const ruleIds = z.array(uuid).max(4).parse(formData.getAll("ruleId").map(String).filter(Boolean));
    await guard(() => pay.overrideLineTax(viewer.userId, payableId, { reason: str(formData, "reason"), ruleIds }));
    refresh();
    return { ok: true, message: "Tax decision recorded. The line can now be batched." };
  });
}

/** Dollars with an optional minus sign → signed cents. */
function signedCents(v: string) {
  const m = /^(-)?\$?(\d{1,6})(?:\.(\d{1,2}))?$/.exec(v.replace(/[\s,]/g, ""));
  if (!m) throw new UserFacingError("Enter an amount like 25.00, or -25.00 for a credit.");
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

export async function createAdjustmentAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await requireFreshAuth(viewer);
    const payableId = uuid.parse(str(formData, "payableId"));
    await guard(() => pay.createAdjustment(viewer.userId, { payableId, amountCents: signedCents(str(formData, "amount")), reason: str(formData, "reason") }));
    refresh();
    revalidatePath("/dashboard/payments/bills", "layout");
    return { ok: true, message: "Adjustment added. It's ready to batch with the contractor's next payment." };
  });
}

export async function createAccountingExportAction(billIds: string[]): Promise<ActionResult<{ exportId: string }>> {
  return runAction(async () => {
    const viewer = await authorizeInternal("accounting.manage");
    await rateLimit("export.payments", viewer.userId);
    const ids = z.array(uuid).min(1).max(1000).parse(billIds);
    const res = await guard(() => billing.createAccountingExport(viewer.userId, { billIds: ids }));
    revalidatePath("/dashboard/payments/accounting");
    return { ok: true, message: `Accounting file ${res.reference} generated.${res.validatedFormat ? "" : " The format hasn't been validated with your accounting system yet; check the import carefully."}`, data: { exportId: res.exportId } };
  });
}

export async function setAccountingExportStatusAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("accounting.manage");
    const status = z.enum(["imported", "rejected"]).parse(str(formData, "status"));
    await guard(() => billing.setAccountingExportStatus(viewer.userId, uuid.parse(str(formData, "exportId")), { status, note: str(formData, "note") }));
    revalidatePath("/dashboard/payments/accounting");
    return { ok: true, message: status === "imported" ? "Marked as imported." : "Marked as rejected. Its bills can be exported again." };
  });
}

export async function recordInvoiceAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    const billId = uuid.parse(str(formData, "billId"));
    const inv = await guard(() =>
      billing.recordContractorInvoice(viewer.userId, {
        staffId: uuid.parse(str(formData, "staffId")),
        billId,
        invoiceNumber: str(formData, "invoiceNumber"),
        invoiceDate: dateStr.parse(str(formData, "invoiceDate")),
        subtotalCents: signedCents(str(formData, "subtotal")),
        taxCents: signedCents(str(formData, "tax") || "0"),
      }),
    );
    revalidatePath(`/dashboard/payments/bills/${billId}`);
    return { ok: true, message: inv.status === "matched" ? "Invoice recorded. It matches the bill." : "Invoice recorded. It differs from the bill and is flagged for review." };
  });
}

export async function resolveInvoiceAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await guard(() => billing.resolveInvoiceVariance(viewer.userId, uuid.parse(str(formData, "invoiceId")), str(formData, "note")));
    revalidatePath("/dashboard/payments/bills", "layout");
    return { ok: true, message: "Resolution recorded." };
  });
}

export async function resolvePayReviewAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await guard(() => billing.resolvePayReview(viewer.userId, uuid.parse(str(formData, "requestId")), str(formData, "resolution")));
    revalidatePath("/dashboard/payments/reviews");
    return { ok: true, message: "Marked resolved. Let the contractor know the outcome." };
  });
}

// ─── Year-end ──────────────────────────────────────────────────────────────────

const year = z.coerce.number().int().min(2000).max(2100);

export async function setYearEndDecisionAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    const raw = str(formData, "decision");
    const decision = raw === "include" || raw === "exclude" ? raw : null;
    await guard(() => yearEnd.setYearEndDecision(viewer.userId, year.parse(str(formData, "year")), uuid.parse(str(formData, "staffId")), { decision, reason: str(formData, "reason") }));
    revalidatePath("/dashboard/payments/t4a");
    return { ok: true, message: decision ? "Decision recorded." : "Decision cleared." };
  });
}

export async function setIdentityReceivedAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    const received = str(formData, "received") === "true";
    await guard(() => yearEnd.setIdentityReceived(viewer.userId, year.parse(str(formData, "year")), uuid.parse(str(formData, "staffId")), received, str(formData, "note") || null));
    revalidatePath("/dashboard/payments/t4a");
    return { ok: true, message: received ? "Recorded that the accountant has their tax identity information." : "Cleared." };
  });
}

export async function createSnapshotAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    const s = await guard(() => yearEnd.createYearEndSnapshot(viewer.userId, year.parse(str(formData, "year")), str(formData, "note") || null));
    revalidatePath("/dashboard/payments/t4a");
    return { ok: true, message: `Snapshot version ${s.version} saved.` };
  });
}

export async function setSnapshotStatusAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    const status = z.enum(["handed_off", "filed"]).parse(str(formData, "status"));
    await guard(() => yearEnd.setSnapshotStatus(viewer.userId, uuid.parse(str(formData, "snapshotId")), status));
    revalidatePath("/dashboard/payments/t4a");
    return { ok: true, message: status === "handed_off" ? "Marked as handed to the accountant." : "Marked as filed." };
  });
}

export async function voidBatchAction(batchId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await guard(() => pay.voidBatch(viewer.userId, uuid.parse(batchId), reason));
    refresh(batchId);
    return { ok: true, message: "Batch voided in Crew. Its items are back in the ready-to-pay list (billed lines keep their bill)." };
  });
}
