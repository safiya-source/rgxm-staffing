"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runAction, UserFacingError } from "@/server/actions";
import { db } from "@/server/db";
import { EXPORT_FORMATS } from "@/server/domain/payment-exports";
import * as pay from "@/server/domain/payments";
import { kickOutbox } from "@/server/notify/run";
import { authorizeInternal } from "@/server/session";

const uuid = z.string().uuid();

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof pay.PaymentError) throw new UserFacingError(err.message);
    throw err;
  }
}

function refresh(batchId?: string) {
  revalidatePath("/dashboard/payments", "layout");
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
    return { ok: true, message: n ? `Updated ${n} payable${n === 1 ? "" : "s"} to the current classification.` : "Everything already matches." };
  });
}

export async function approveBatchAction(batchId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
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
    const f = z.enum(EXPORT_FORMATS).parse(format);
    const res = await guard(() => pay.exportBatch(viewer.userId, uuid.parse(batchId), f));
    refresh(batchId);
    return { ok: true, message: `Exported ${res.rowCount} row${res.rowCount === 1 ? "" : "s"}.`, data: { exportId: res.exportId } };
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

export async function markPaidAction(batchId: string, input: { paidOn: string; failed: { payableId: string; reason: string }[] }): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    const failed = z.array(z.object({ payableId: uuid, reason: z.string().max(500) })).parse(input.failed);
    await guard(() => pay.markBatchPaid(viewer.userId, uuid.parse(batchId), { paidOn: z.string().parse(input.paidOn), failed }));
    kickOutbox();
    refresh(batchId);
    return { ok: true, message: failed.length ? `Marked paid. ${failed.length} failed item${failed.length === 1 ? " is" : "s are"} ready to retry.` : "Marked paid. Staff can see it in their portal." };
  });
}

export async function voidBatchAction(batchId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("payments.manage");
    await guard(() => pay.voidBatch(viewer.userId, uuid.parse(batchId), reason));
    refresh(batchId);
    return { ok: true, message: "Batch voided. Its items are back in the ready-to-pay list." };
  });
}
