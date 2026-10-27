import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as a from "@/server/domain/attendance";
import * as pay from "@/server/domain/payments";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

const MIN = 60_000;
let finance: { id: string };
let finance2: { id: string };
let pm: { id: string };
let project: { projectId: string; locationId: string };

async function person(classification: "contractor" | "employee" | "unset" = "contractor", demo = false) {
  const u = await makeUser("staff");
  const p = await one<{ id: string }>(
    "insert into staff_profiles (user_id, first_name, last_name, email, classification, is_demo) values ($1, 'Pat', 'Payee', $2, $3, $4) returning id",
    [u.id, `p.${crypto.randomUUID()}@example.test`, classification, demo],
  );
  return { userId: u.id, staffId: p.id };
}

/** A finished 8-hour shift, attendance recorded, hours approved by the PM. Returns the payable. */
async function approved(opts: { who?: Awaited<ReturnType<typeof person>>; rate?: number; proj?: typeof project; daysAgo?: number } = {}) {
  const who = opts.who ?? (await person());
  const start = new Date(Date.now() - (opts.daysAgo ?? 1) * 24 * 60 * MIN);
  const end = new Date(start.getTime() + 8 * 60 * MIN);
  const s = await makeShift(opts.proj ?? project, start.toISOString(), end.toISOString());
  const b = await book(s.id, who.staffId, { agreedRateCents: opts.rate ?? 2500 });
  const rgxm = { kind: "rgxm" as const, userId: pm.id };
  await a.recordAttendance(rgxm, b.id, { type: "check_in", occurredAt: start, note: "Sign-in sheet" });
  await a.recordAttendance(rgxm, b.id, { type: "check_out", occurredAt: end, note: "Sign-in sheet" });
  const t = await one<{ id: string }>("select id from timesheets where booking_id = $1", [b.id]);
  await a.approveTimesheet(pm.id, t.id);
  const p = await one<{ id: string; total_cents: number; status: string; rate_cents: number; classification: string }>(
    "select id, total_cents::int, status, rate_cents, classification from payable_items where timesheet_id = $1 and status <> 'void'",
    [t.id],
  );
  return { ...who, bookingId: b.id, timesheetId: t.id, payable: p };
}

const status = async (table: string, id: string) => (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;

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

describe("payables", () => {
  it("are created on approval at the agreed-rate snapshot and can't be edited (rules 3, 6)", async () => {
    const x = await approved({ rate: 2750 });
    expect(x.payable).toMatchObject({ total_cents: 22000, rate_cents: 2750, status: "pending", classification: "contractor" });
    await expect(pool.query("update payable_items set total_cents = 1 where id = $1", [x.payable.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("delete from payable_items where id = $1", [x.payable.id])).rejects.toThrow(/cannot be deleted/);
    // Inserting a payable that doesn't match the approved minutes is rejected.
    await expect(
      pool.query(
        `insert into payable_items (timesheet_id, staff_id, project_id, service_date, classification, payable_minutes, rate_cents, base_cents, total_cents, calc_version, calc_inputs)
         select id, staff_id, project_id, current_date, 'contractor', 999, 100, 1, 1, 'x', '{}' from timesheets where id = $1`,
        [x.timesheetId],
      ),
    ).rejects.toThrow(/approved minutes/);
  });

  it("are replaced (old one voided) by a post-approval correction", async () => {
    const x = await approved();
    await a.correctApprovedTimesheet(pm.id, x.timesheetId, { payableMinutes: 420, reason: "Unpaid break wasn't recorded" });
    const rows = (await pool.query("select status, total_cents::int, void_reason from payable_items where timesheet_id = $1 order by created_at", [x.timesheetId])).rows;
    expect(rows).toEqual([
      { status: "void", total_cents: 20000, void_reason: "Hours corrected: Unpaid break wasn't recorded" },
      { status: "pending", total_cents: 17500, void_reason: null },
    ]);
  });

  it("pick up a classification set after approval when refreshed", async () => {
    const who = await person("unset");
    const x = await approved({ who });
    expect(x.payable.classification).toBe("unset");
    await expect(pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [x.payable.id] })).rejects.toThrow(/pay classification/);
    await pool.query("update staff_profiles set classification = 'employee' where id = $1", [who.staffId]);
    expect(await pay.refreshClassifications(finance.id)).toBeGreaterThanOrEqual(1);
    const p = await one<{ classification: string; total_cents: number }>("select classification, total_cents::int from payable_items where timesheet_id = $1 and status <> 'void'", [x.timesheetId]);
    expect(p).toEqual({ classification: "employee", total_cents: 20000 });
  });
});

describe("payment batches", () => {
  it("keep contractors, employees and demo data apart", async () => {
    const c = await approved();
    const e = await approved({ who: await person("employee") });
    const d = await approved({ who: await person("contractor", true) });
    await expect(pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [c.payable.id, e.payable.id] })).rejects.toThrow(/separate batches/);
    await expect(pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [c.payable.id, d.payable.id] })).rejects.toThrow(/Demo and real/);
    const demo = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [d.payable.id] });
    expect(demo.isDemo).toBe(true);
    const payroll = await pay.createBatch(finance.id, { type: "payroll", payPeriodId: null, payableIds: [e.payable.id] });
    expect(payroll.reference).toMatch(/^PAY-/);
  });

  it("lock their timesheets, need a second approver, and export once (duplicate protection)", async () => {
    const x = await approved();
    const y = await approved();
    const period = await pay.ensurePayPeriod(db, new Date().toISOString().slice(0, 10));
    const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [x.payable.id, y.payable.id] });
    expect(period.label).toMatch(/\d{4}$/);
    expect(await status("timesheets", x.timesheetId)).toBe("locked");
    expect(await status("payable_items", x.payable.id)).toBe("batched");
    // Locked hours can't be corrected any more, and the payable can't join another batch.
    await expect(a.correctApprovedTimesheet(pm.id, x.timesheetId, { payableMinutes: 400, reason: "x" })).rejects.toThrow(/payment batch/);
    await expect(pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [x.payable.id] })).rejects.toThrow(/already in a batch/);

    await expect(pay.exportBatch(finance.id, batch.id, "csv_generic")).rejects.toThrow(/approve/);
    await expect(pay.approveBatch(finance.id, batch.id)).rejects.toThrow(/someone other than its creator/);
    await pay.approveBatch(finance2.id, batch.id);

    const first = await pay.exportBatch(finance.id, batch.id, "csv_generic");
    expect(first.rowCount).toBe(2);
    expect(await status("payment_batches", batch.id)).toBe("exported");
    expect(await status("timesheets", x.timesheetId)).toBe("exported");
    await expect(pay.exportBatch(finance.id, batch.id, "xlsx")).rejects.toThrow(/already been exported/);
    const again = await pay.readExport(finance.id, first.exportId);
    expect(again.data.equals(first.data)).toBe(true);
    await expect(pool.query("update payment_exports set sha256 = 'x' where id = $1", [first.exportId])).rejects.toThrow(/immutable/);

    await expect(pay.supersedeExport(finance.id, first.exportId, " ")).rejects.toThrow(/Explain/);
    await pay.supersedeExport(finance.id, first.exportId, "Bank rejected the file; nothing was imported");
    const second = await pay.exportBatch(finance.id, batch.id, "csv_qbo");
    expect(second.sha256).not.toBe(first.sha256);
  });

  it("record payment, keep failed items payable later, notify staff, and become final", async () => {
    const x = await approved();
    const y = await approved();
    const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [x.payable.id, y.payable.id] });
    await expect(pay.markBatchPaid(finance.id, batch.id, { paidOn: "2026-01-01" })).rejects.toThrow(/Export/);
    await pay.approveBatch(finance2.id, batch.id);
    await pay.exportBatch(finance.id, batch.id, "csv_generic");
    await expect(pay.markBatchPaid(finance.id, batch.id, { paidOn: "2026-01-01", failed: [{ payableId: y.payable.id, reason: "" }] })).rejects.toThrow(/reason/);
    await pay.markBatchPaid(finance.id, batch.id, { paidOn: new Date().toISOString().slice(0, 10), failed: [{ payableId: y.payable.id, reason: "Account closed" }] });

    expect(await status("payment_batches", batch.id)).toBe("paid");
    expect(await status("payable_items", x.payable.id)).toBe("paid");
    expect(await status("timesheets", x.timesheetId)).toBe("paid");
    expect(await status("payable_items", y.payable.id)).toBe("failed");
    const events = await pool.query("select payload from outbox_events where type = 'payment.paid' and payload->>'batchId' = $1", [batch.id]);
    expect(events.rows.map((r) => r.payload.staffId)).toEqual([x.staffId]);

    // Paid is final; the failed one goes into a new batch.
    await expect(pay.voidBatch(finance.id, batch.id, "oops")).rejects.toThrow(/paid/);
    await expect(pool.query("update payment_batches set total_cents = 0 where id = $1", [batch.id])).rejects.toThrow(/cannot change/);
    await expect(pool.query("update payable_items set status = 'pending' where id = $1", [x.payable.id])).rejects.toThrow(/paid payables/);
    const retry = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [y.payable.id] });
    expect(retry.totalCents).toBe(20000);
  });

  it("can be voided before payment, returning hours to approved", async () => {
    const x = await approved();
    const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [x.payable.id] });
    await pay.approveBatch(finance2.id, batch.id);
    const exp = await pay.exportBatch(finance.id, batch.id, "csv_generic");
    await expect(pay.voidBatch(finance.id, batch.id, "")).rejects.toThrow(/reason/);
    await pay.voidBatch(finance.id, batch.id, "Built with the wrong period; file never imported");
    expect(await status("payable_items", x.payable.id)).toBe("pending");
    expect(await status("timesheets", x.timesheetId)).toBe("approved");
    const e = await one<{ superseded_reason: string }>("select superseded_reason from payment_exports where id = $1", [exp.exportId]);
    expect(e.superseded_reason).toMatch(/Batch voided/);
    await expect(pool.query("delete from payment_batch_items where batch_id = $1", [batch.id])).rejects.toThrow(/cannot be deleted/);
  });

  it("lets Finance take an item out of a draft batch with a reason", async () => {
    const x = await approved();
    const y = await approved();
    const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [x.payable.id, y.payable.id] });
    await expect(pay.removeFromBatch(finance.id, batch.id, y.payable.id, "")).rejects.toThrow(/reason/);
    await pay.removeFromBatch(finance.id, batch.id, y.payable.id, "Hours under dispute");
    expect(await status("payable_items", y.payable.id)).toBe("pending");
    expect(await status("timesheets", y.timesheetId)).toBe("approved");
    expect((await one<{ total_cents: number }>("select total_cents::int from payment_batches where id = $1", [batch.id])).total_cents).toBe(20000);
  });
});
