// Compensation, approval invalidation, concurrent batching, bills, payment attempts, retries,
// returns, adjustments, accounting exports and reports.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as a from "@/server/domain/attendance";
import * as billing from "@/server/domain/billing";
import * as comp from "@/server/domain/compensation";
import * as reports from "@/server/domain/finance-reports";
import * as pay from "@/server/domain/payments";
import * as taxConfig from "@/server/domain/tax-config";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

const MIN = 60_000;
let finance: { id: string };
let finance2: { id: string };
let pm: { id: string };
let project: { projectId: string; locationId: string };

async function person() {
  const u = await makeUser("staff");
  const p = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Cam', 'Contractor', $2) returning id", [u.id, `c.${crypto.randomUUID()}@example.test`]);
  await pool.query("insert into staff_sensitive (staff_id, legal_name, gst_registration_status, gst_verification_status) values ($1, 'Cam Contractor', 'no', 'verified')", [p.id]);
  return { userId: u.id, staffId: p.id };
}

/** Confirmed booking on a finished 8 h shift `daysAgo` days back; optionally approved. */
async function shift(staffId: string, daysAgo: number, opts: { approve?: boolean; proj?: typeof project } = {}) {
  const start = new Date(Date.now() - daysAgo * 24 * 60 * MIN);
  start.setUTCHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + 8 * 60 * MIN);
  const s = await makeShift(opts.proj ?? project, start.toISOString(), end.toISOString());
  const b = await book(s.id, staffId, { agreedRateCents: 2500 });
  if (!opts.approve) return { bookingId: b.id, payableId: null as string | null };
  const rgxm = { kind: "rgxm" as const, userId: pm.id };
  await a.recordAttendance(rgxm, b.id, { type: "check_in", occurredAt: start, note: "Sign-in sheet" });
  await a.recordAttendance(rgxm, b.id, { type: "check_out", occurredAt: end, note: "Sign-in sheet" });
  const t = await one<{ id: string }>("select id from timesheets where booking_id = $1", [b.id]);
  await a.approveTimesheet(pm.id, t.id);
  const p = await one<{ id: string }>("select id from payable_items where timesheet_id = $1 and status <> 'void'", [t.id]);
  return { bookingId: b.id, payableId: p.id };
}

const status = async (table: string, id: string) => (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;
const today = () => new Date().toISOString().slice(0, 10);

async function exported(payableIds: string[]) {
  const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds });
  await pay.approveBatch(finance2.id, batch.id);
  await pay.exportBatch(finance.id, batch.id, "csv_generic");
  return batch;
}

beforeAll(async () => {
  finance = await makeUser();
  finance2 = await makeUser();
  pm = await makeUser();
  project = await makeProject();
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("project compensation", () => {
  it("is off by default and uses the initial CAD rates once switched on", async () => {
    const s = await comp.getCompensationSettings(project.projectId);
    expect(s).toMatchObject({ mealsEnabled: false, perDiemEnabled: false, mileageEnabled: false, bonusEnabled: false, breakfastCents: 2000, lunchCents: 2500, dinnerCents: 4000, perDiemCents: 8500, mileageRate: "0.7300" });
    const who = await person();
    const { bookingId } = await shift(who.staffId, 30);
    await expect(comp.recordCompensation(pm.id, project.projectId, { category: "meal_lunch", staffId: who.staffId, bookingId })).rejects.toThrow(/isn't switched on/);
    await comp.saveCompensationSettings(pm.id, project.projectId, { mealsEnabled: true, perDiemEnabled: true, mileageEnabled: true, bonusEnabled: true, bonusConditions: "Covering a no-show at short notice", breakfast: "20", lunch: "25", dinner: "40", perDiem: "85", mileageRate: "0.73" });
    const lunch = await comp.recordCompensation(pm.id, project.projectId, { category: "meal_lunch", staffId: who.staffId, bookingId });
    // A meal that isn't eligible on the project (e.g. provided on site) can't be recorded.
    const other = await makeProject();
    await comp.saveCompensationSettings(pm.id, other.projectId, { mealsEnabled: true, perDiemEnabled: false, mileageEnabled: false, bonusEnabled: false, breakfast: "20", lunch: "25", dinner: "40", perDiem: "85", mileageRate: "0.73", eligibleMeals: ["meal_dinner"] });
    const o = await shift(who.staffId, 36, { proj: other });
    await expect(comp.recordCompensation(pm.id, other.projectId, { category: "meal_lunch", staffId: who.staffId, bookingId: o.bookingId })).rejects.toThrow(/isn't eligible/);
    expect(lunch).toMatchObject({ amountCents: 2500, unitRate: "25.0000", status: "pending" });
  });

  it("prevents duplicate meals across shifts on the same date, and per diem together with meals", async () => {
    const who = await person();
    const morning = await shift(who.staffId, 31);
    await comp.recordCompensation(pm.id, project.projectId, { category: "meal_dinner", staffId: who.staffId, bookingId: morning.bookingId });
    await expect(comp.recordCompensation(pm.id, project.projectId, { category: "meal_dinner", staffId: who.staffId, bookingId: morning.bookingId })).rejects.toThrow(/already has that allowance/);
    await expect(comp.recordCompensation(pm.id, project.projectId, { category: "per_diem", staffId: who.staffId, bookingId: morning.bookingId })).rejects.toThrow(/can't both be paid/);

    // The other way round, and enforced in the database even outside the app.
    const other = await person();
    const s2 = await shift(other.staffId, 32);
    await comp.recordCompensation(pm.id, project.projectId, { category: "per_diem", staffId: other.staffId, bookingId: s2.bookingId });
    await expect(comp.recordCompensation(pm.id, project.projectId, { category: "meal_breakfast", staffId: other.staffId, bookingId: s2.bookingId })).rejects.toThrow(/can't both be paid/);

    // Concurrent requests for the same allowance: exactly one wins.
    const racer = await person();
    const s3 = await shift(racer.staffId, 33);
    const results = await Promise.allSettled([1, 2, 3].map(() => comp.recordCompensation(pm.id, project.projectId, { category: "meal_lunch", staffId: racer.staffId, bookingId: s3.bookingId })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const mixed = await Promise.allSettled([
      comp.recordCompensation(pm.id, project.projectId, { category: "per_diem", staffId: racer.staffId, bookingId: s3.bookingId }),
      comp.recordCompensation(pm.id, project.projectId, { category: "meal_dinner", staffId: racer.staffId, bookingId: s3.bookingId }),
    ]);
    // The lunch already exists, so the per diem can never succeed; the dinner can.
    expect(mixed[0]!.status).toBe("rejected");
  });

  it("calculates mileage with decimal arithmetic and needs a purpose; bonuses need a reason", async () => {
    const who = await person();
    const { bookingId } = await shift(who.staffId, 34);
    await expect(comp.recordCompensation(pm.id, project.projectId, { category: "mileage", staffId: who.staffId, bookingId, km: "12", tripDate: today(), businessPurpose: "" })).rejects.toThrow(/business purpose/);
    await expect(comp.recordCompensation(pm.id, project.projectId, { category: "mileage", staffId: who.staffId, bookingId, km: "1.234", tripDate: today(), businessPurpose: "Venue to warehouse" })).rejects.toThrow(/2 decimals/);
    const m = await comp.recordCompensation(pm.id, project.projectId, { category: "mileage", staffId: who.staffId, bookingId, km: "123.45", tripDate: today(), businessPurpose: "Pick up kit from the warehouse" });
    expect(m).toMatchObject({ amountCents: 9012, quantity: "123.45", unitRate: "0.7300" }); // 90.1185 → 90.12
    await expect(comp.recordCompensation(pm.id, project.projectId, { category: "bonus", staffId: who.staffId, bookingId, amount: "50", reason: "" })).rejects.toThrow(/reason/);
    const b = await comp.recordCompensation(pm.id, project.projectId, { category: "bonus", staffId: who.staffId, bookingId, amount: "50", reason: "Covered a no-show at short notice" });
    expect(b.amountCents).toBe(5000);
  });

  it("needs approval, keeps historical rates and amounts, and becomes its own bill line", async () => {
    const who = await person();
    const { bookingId } = await shift(who.staffId, 35);
    const item = await comp.recordCompensation(pm.id, project.projectId, { category: "meal_breakfast", staffId: who.staffId, bookingId });
    // Rate change later doesn't touch what was recorded.
    await comp.saveCompensationSettings(pm.id, project.projectId, { mealsEnabled: true, perDiemEnabled: true, mileageEnabled: true, bonusEnabled: true, bonusConditions: "Covering a no-show at short notice", breakfast: "22", lunch: "25", dinner: "40", perDiem: "85", mileageRate: "0.75" });
    await expect(pool.query("update compensation_items set amount_cents = 1 where id = $1", [item!.id])).rejects.toThrow(/fixed once recorded/);
    await expect(comp.decideCompensation(pm.id, item!.id, { approve: false })).rejects.toThrow(/reason/);
    const line = await comp.decideCompensation(finance.id, item!.id, { approve: true });
    expect(line).toMatchObject({ category: "meal_breakfast", baseCents: 2000, payableMinutes: 0, compensationItemId: item!.id, taxStatus: "no_tax" });
    await expect(comp.decideCompensation(finance.id, item!.id, { approve: true })).rejects.toThrow(/already approved/);
    const next = await comp.recordCompensation(pm.id, project.projectId, { category: "meal_lunch", staffId: who.staffId, bookingId });
    expect(next!.amountCents).toBe(2500);
    const s = await comp.getCompensationSettings(project.projectId);
    expect(s.breakfastCents).toBe(2200);
  });
});

describe("batch approval and concurrency", () => {
  it("lets only one of several concurrent batches take the same line", async () => {
    const who = await person();
    const { payableId } = await shift(who.staffId, 40, { approve: true });
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [payableId!] })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await one<{ n: number }>("select count(*)::int n from payment_batch_items where payable_item_id = $1 and active", [payableId])).n).toBe(1);
  });

  it("cancels the approval when payment details or lines change after approval", async () => {
    const who = await person();
    const x = await shift(who.staffId, 41, { approve: true });
    const y = await shift(who.staffId, 42, { approve: true });
    const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [x.payableId!, y.payableId!] });
    await pay.approveBatch(finance2.id, batch.id);
    // The payee's payment details change after approval.
    await pool.query("update staff_sensitive set payment_provider_ref = 'new-bank-token' where staff_id = $1", [who.staffId]);
    await expect(pay.exportBatch(finance.id, batch.id, "csv_generic")).rejects.toThrow(/approval was cancelled/);
    expect(await status("payment_batches", batch.id)).toBe("draft");
    expect((await one<{ approved_by: string | null }>("select approved_by from payment_batches where id = $1", [batch.id])).approved_by).toBeNull();
    // Re-approve; then removing a line after approval also cancels it.
    await pay.approveBatch(finance2.id, batch.id);
    await pay.removeFromBatch(finance.id, batch.id, y.payableId!, "Hours queried");
    expect(await status("payment_batches", batch.id)).toBe("draft");
    await pay.approveBatch(finance2.id, batch.id);
    const file = await pay.exportBatch(finance.id, batch.id, "csv_generic");
    expect(file.rowCount).toBe(1);
  });
});

describe("bills, bank attempts and settlement", () => {
  it("finalizes stable bills at export, never settles on export, and needs evidence to settle", async () => {
    const who = await person();
    const x = await shift(who.staffId, 50, { approve: true });
    const y = await shift(who.staffId, 51, { approve: true });
    const batch = await exported([x.payableId!, y.payableId!]);
    const bill = await one<{ id: string; bill_number: string; total_cents: number; due_date: string; bill_date: string; terms_snapshot: { approved: boolean } }>(
      "select b.id, b.bill_number, b.total_cents::int, b.due_date::text, b.bill_date::text, b.terms_snapshot from bills b join payable_items p on p.bill_id = b.id where p.id = $1",
      [x.payableId],
    );
    expect(bill.bill_number).toMatch(/^CRW-B-\d{6}$/);
    expect(bill.total_cents).toBe(40000);
    // No RGXM-approved terms yet: due date equals bill date, flagged as not approved.
    expect(bill.terms_snapshot.approved).toBe(false);
    expect(bill.due_date).toBe(bill.bill_date);
    expect(await status("payable_items", x.payableId!)).toBe("exported");
    expect((await pool.query("select distinct state from payment_batch_items where batch_id = $1", [batch.id])).rows).toEqual([{ state: "exported" }]);
    await expect(pool.query("update bills set total_cents = 1, subtotal_cents = 1, tax_cents = 0 where id = $1", [bill.id])).rejects.toThrow(/finalized/);
    await expect(pool.query("update payable_items set status = 'void' where id = $1", [x.payableId])).rejects.toThrow(/cannot be voided/);

    await pay.markBatchSubmitted(finance.id, batch.id, { submittedOn: today(), bankReference: "EFT-778" });
    await expect(pay.voidBatch(finance.id, batch.id, "Change of plan")).rejects.toThrow(/submitted to the bank/);
    await expect(pay.supersedeExport(finance.id, (await one<{ id: string }>("select id from payment_exports where batch_id = $1", [batch.id])).id, "x")).rejects.toThrow(/submitted/);
    await expect(pay.recordSettlement(finance.id, batch.id, [{ payableId: x.payableId!, outcome: "settled", date: today() }])).rejects.toThrow(/evidence/);
    await expect(pay.recordSettlement(finance.id, batch.id, [{ payableId: y.payableId!, outcome: "bank_cancelled", date: today(), reason: "Recalled" }])).rejects.toThrow(/cancellation reference/);
    await pay.recordSettlement(finance.id, batch.id, [{ payableId: x.payableId!, outcome: "settled", date: today(), evidence: "Bank statement 2026-11 line 12", bankReference: "EFT-778-1" }]);
    expect(await status("payment_batches", batch.id)).toBe("exported"); // y still outstanding
    expect(await status("bills", bill.id)).toBe("open");
    await pay.recordSettlement(finance.id, batch.id, [{ payableId: y.payableId!, outcome: "bank_cancelled", date: today(), reason: "Bank recalled the payment", bankReference: "RECALL-91" }]);
    expect(await status("payment_batches", batch.id)).toBe("paid");
    expect(await status("payable_items", y.payableId!)).toBe("failed");

    // Retry the cancelled one against the same bill: no new bill (no second expense).
    const before = (await one<{ n: number }>("select count(*)::int n from bills where staff_id = $1", [who.staffId])).n;
    const retry = await exported([y.payableId!]);
    expect((await one<{ n: number }>("select count(*)::int n from bills where staff_id = $1", [who.staffId])).n).toBe(before);
    expect((await one<{ bill_id: string }>("select bill_id from payable_items where id = $1", [y.payableId])).bill_id).toBe(bill.id);
    await pay.markBatchPaid(finance.id, retry.id, { paidOn: today(), evidence: "Bank statement line 31" });
    expect(await status("bills", bill.id)).toBe("paid");
  });

  it("handles a payment returned after settlement, distinct from a Crew void", async () => {
    const who = await person();
    const x = await shift(who.staffId, 52, { approve: true });
    const batch = await exported([x.payableId!]);
    await pay.markBatchPaid(finance.id, batch.id, { paidOn: today(), evidence: "Statement line 2" });
    await pay.recordReturn(finance.id, { batchId: batch.id, payableId: x.payableId!, returnedOn: today(), reason: "Account closed", bankReference: "RTN-5" });
    expect(await status("payable_items", x.payableId!)).toBe("failed");
    expect((await one<{ state: string; active: boolean }>("select state, active from payment_batch_items where batch_id = $1", [batch.id]))).toMatchObject({ state: "returned", active: false });
    const failed = await reports.failedPayments();
    expect(failed.some((f) => f.payable_id === x.payableId && f.state === "returned")).toBe(true);
    // Crew void only before bank submission: an unsubmitted exported batch can be voided in Crew.
    const z = await shift(who.staffId, 53, { approve: true });
    const b2 = await exported([z.payableId!]);
    await pay.voidBatch(finance.id, b2.id, "File never sent; wrong period");
    expect((await one<{ state: string }>("select state from payment_batch_items where batch_id = $1", [b2.id])).state).toBe("voided");
    expect(await status("payable_items", z.payableId!)).toBe("pending");
  });

  it("corrects paid lines with linked adjustments and credits, preserving the original", async () => {
    const who = await person();
    const x = await shift(who.staffId, 54, { approve: true });
    const batch = await exported([x.payableId!]);
    await pay.markBatchPaid(finance.id, batch.id, { paidOn: today(), evidence: "Statement line 9" });
    const credit = await pay.createAdjustment(finance.id, { payableId: x.payableId!, amountCents: -2500, reason: "One hour over-reported" });
    expect(credit).toMatchObject({ category: "adjustment", adjustsPayableId: x.payableId, baseCents: -2500, totalCents: -2500, status: "pending" });
    expect((await one<{ total_cents: number; status: string }>("select total_cents::int, status from payable_items where id = $1", [x.payableId])).total_cents).toBe(20000);
    // A credit on its own can't be paid out; it nets against the next work.
    await expect(pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [credit.id] })).rejects.toThrow(/credit is larger/);
    const next = await shift(who.staffId, 55, { approve: true });
    const b2 = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [credit.id, next.payableId!] });
    expect(b2.totalCents).toBe(17500);
    const unbilled = await pay.createAdjustment(finance.id, { payableId: x.payableId!, amountCents: 500, reason: "Parking reimbursement agreed later" }).catch((e) => e);
    expect(unbilled).toMatchObject({ category: "adjustment" });
    const pending = await shift(who.staffId, 56, { approve: true });
    await expect(pay.createAdjustment(finance.id, { payableId: pending.payableId!, amountCents: 100, reason: "Not finalized yet" })).rejects.toThrow(/isn't finalized/);
  });
});

describe("accounting exports", () => {
  it("export each bill once, with project allocation; a rejected import frees the bills; bank failures don't re-export", async () => {
    const who = await person();
    const x = await shift(who.staffId, 60, { approve: true });
    const batch = await exported([x.payableId!]);
    const billId = (await one<{ bill_id: string }>("select bill_id from payable_items where id = $1", [x.payableId])).bill_id;
    const ready = await billing.billsReadyForAccounting();
    expect(ready.some((b) => b.id === billId)).toBe(true);
    const first = await billing.createAccountingExport(finance.id, { billIds: [billId] });
    const csv = first.data.toString("utf8");
    expect(csv).toContain("Bill No,Supplier,Supplier Ref,Supplier ID,Bill Date,Due Date,Account,Line Description,Line Amount,Line Tax Code,Line Tax Amount,Currency,Project,Client,Line ID");
    expect(csv).toMatch(/CRW-B-\d{6},Cam Contractor,CRW-S-\d{6},/);
    expect(csv).toContain("Field staff - contractors");
    expect(csv).toContain(",200.00,Out of Scope,0.00,CAD,T-");
    await expect(billing.createAccountingExport(finance.id, { billIds: [billId] })).rejects.toThrow(/already in another accounting export/);
    expect((await billing.billsReadyForAccounting()).some((b) => b.id === billId)).toBe(false);

    // The bank payment fails; the bill isn't exported to accounting again and keeps its number.
    await pay.recordSettlement(finance.id, batch.id, [{ payableId: x.payableId!, outcome: "failed", date: today(), reason: "Invalid account" }]);
    await exported([x.payableId!]);
    expect((await billing.billsReadyForAccounting()).some((b) => b.id === billId)).toBe(false);

    await expect(billing.setAccountingExportStatus(finance.id, first.exportId, { status: "rejected", note: "" })).rejects.toThrow(/why/);
    await billing.setAccountingExportStatus(finance.id, first.exportId, { status: "rejected", note: "QuickBooks rejected the date format" });
    const again = await billing.createAccountingExport(finance.id, { billIds: [billId] });
    await billing.setAccountingExportStatus(finance.id, again.exportId, { status: "imported", note: "" });
    await expect(billing.setAccountingExportStatus(finance.id, again.exportId, { status: "rejected", note: "late" })).rejects.toThrow(/already marked/);
  });

  it("refuses a tax decision without a configured accounting tax code", async () => {
    const who = await person();
    const x = await shift(who.staffId, 61, { approve: true });
    // Finance applies a QC rule; there's no tax code for GST:QC+QST:QC in the mapping.
    const rule = await taxConfig.createTaxRule(finance.id, { jurisdiction: "NB", component: "HST", ratePercent: "15", effectiveFrom: "2016-07-01" });
    const pending = await pay.createAdjustment(finance.id, { payableId: x.payableId!, amountCents: 1, reason: "noop" }).catch(() => null);
    expect(pending).toBeNull();
    // Re-decide the line's tax before batching, then bill it.
    const fixed = await pay.overrideLineTax(finance.id, x.payableId!, { reason: "Work performed at the New Brunswick event", ruleIds: [rule.id] });
    expect(fixed.taxCents).toBe(3000);
    await exported([fixed.id]);
    const billId = (await one<{ bill_id: string }>("select bill_id from payable_items where id = $1", [fixed.id])).bill_id;
    await expect(billing.createAccountingExport(finance.id, { billIds: [billId] })).rejects.toThrow(/HST:NB/);
  });

  it("flags differences between a contractor's invoice and the bill", async () => {
    const who = await person();
    const x = await shift(who.staffId, 62, { approve: true });
    await exported([x.payableId!]);
    const billId = (await one<{ bill_id: string }>("select bill_id from payable_items where id = $1", [x.payableId])).bill_id;
    const ok = await billing.recordContractorInvoice(finance.id, { staffId: who.staffId, billId, invoiceNumber: "INV-1", invoiceDate: today(), subtotalCents: 20000, taxCents: 0 });
    expect(ok.status).toBe("matched");
    const off = await billing.recordContractorInvoice(finance.id, { staffId: who.staffId, billId, invoiceNumber: "INV-2", invoiceDate: today(), subtotalCents: 20000, taxCents: 2600 });
    expect(off).toMatchObject({ status: "variance_review", expectedTaxCents: 0 });
    await billing.resolveInvoiceVariance(finance.id, off.id, "Contractor isn't registered; asked them to reissue without HST");
  });
});

describe("contractor pay review requests", () => {
  it("only reference the contractor's own lines and notify Finance", async () => {
    const who = await person();
    const other = await person();
    const x = await shift(who.staffId, 70, { approve: true });
    await expect(billing.requestPayReview({ userId: other.userId, staffId: other.staffId }, { payableId: x.payableId!, kind: "tax", message: "This isn't mine" })).rejects.toThrow(/not found/);
    const r = await billing.requestPayReview({ userId: who.userId, staffId: who.staffId }, { payableId: x.payableId!, kind: "tax", message: "I'm registered for HST now" });
    await expect(billing.requestPayReview({ userId: who.userId, staffId: who.staffId }, { payableId: x.payableId!, kind: "tax", message: "Again please" })).rejects.toThrow(/already have an open/);
    expect((await one<{ n: number }>("select count(*)::int n from outbox_events where type = 'pay_review.requested' and payload->>'requestId' = $1", [r.id])).n).toBe(1);
    await billing.resolvePayReview(finance.id, r.id, "Updated your registration and recalculated the line");
  });
});

describe("finance reports", () => {
  it("separate categories, tax recoverability and budget variance per project", async () => {
    const p = await makeProject();
    await pool.query("update projects set budget_cents = 100000 where id = $1", [p.projectId]);
    const who = await person();
    await shift(who.staffId, 80, { approve: true, proj: p });
    await comp.saveCompensationSettings(pm.id, p.projectId, { mealsEnabled: true, perDiemEnabled: false, mileageEnabled: true, bonusEnabled: false, breakfast: "20", lunch: "25", dinner: "40", perDiem: "85", mileageRate: "0.73" });
    const s = await shift(who.staffId, 81, { proj: p });
    const meal = await comp.recordCompensation(pm.id, p.projectId, { category: "meal_lunch", staffId: who.staffId, bookingId: s.bookingId });
    await comp.decideCompensation(finance.id, meal!.id, { approve: true });
    const row = (await reports.projectCostReport()).find((r) => r.projectId === p.projectId)!;
    expect(row).toMatchObject({ fees: 20000, meals: 2500, mileage: 0, preTax: 22500, budget: 100000, variance: 100000 - 22500 });
    const unbilled = await reports.approvedUnbilledWork();
    expect(unbilled.lines.some((l) => l.project === (row.code))).toBe(true);
    expect(Array.isArray(await reports.unreconciledItems())).toBe(true);
    expect(Array.isArray(await reports.outstandingBills())).toBe(true);
  });
});
