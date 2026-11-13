import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { decideCompensation, listCompensation } from "@/server/domain/compensation";
import { myExpenses, receiptFor, submitExpense } from "@/server/domain/expenses";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

// A minimal valid PNG header is enough for the upload check.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("receipt")]);
const receipt = { name: "receipt.png", data: PNG };

let me: { userId: string; staffId: string };
let project: { projectId: string; locationId: string };
let bookingId: string;
let admin: { id: string };
const input = () => ({ projectId: project.projectId, bookingId, purchaseDate: "2026-11-01", amount: "23.45", vendor: "Staples", description: "Tape and markers for the booth" });

beforeAll(async () => {
  admin = await makeUser();
  const u = await makeUser("staff");
  const s = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Ena', 'Expense', $2) returning id", [u.id, `e.${crypto.randomUUID()}@example.test`]);
  // A registered, verified contractor: GST/HST would apply to their fees, never to reimbursements.
  await pool.query("insert into staff_sensitive (staff_id, legal_name, gst_registration_status, gst_verification_status) values ($1, 'Ena Expense', 'yes', 'verified')", [s.id]);
  me = { userId: u.id, staffId: s.id };
  project = await makeProject();
  const shift = await makeShift(project, "2026-11-01T14:00:00Z", "2026-11-01T22:00:00Z");
  bookingId = (await book(shift.id, me.staffId)).id;
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("expense reimbursements", () => {
  it("lets a contractor submit an expense with a receipt for a project they're booked on", async () => {
    const id = await submitExpense(me, input(), receipt);
    const row = await one<{ category: string; amount_cents: number; status: string; vendor: string; receipt_key: string; requested_by: string }>(
      "select category, amount_cents::int, status, vendor, receipt_key, requested_by from compensation_items where id = $1",
      [id],
    );
    expect(row).toMatchObject({ category: "reimbursement", amount_cents: 2345, status: "pending", vendor: "Staples", requested_by: me.userId });
    expect(row.receipt_key).toMatch(new RegExp(`^receipts/${me.staffId}/`));
    expect((await receiptFor(id))!.staffId).toBe(me.staffId);
    expect(await (await receiptFor(id))!.data()).toEqual(PNG);
    expect((await myExpenses(me.staffId)).map((e) => e.id)).toContain(id);
    // The project team is told there's something to approve.
    expect((await one<{ n: number }>("select count(*)::int n from outbox_events where type = 'expense.submitted' and payload->>'itemId' = $1", [id])).n).toBe(1);
  });

  it("refuses other projects, future dates, missing details and files that aren't receipts", async () => {
    const other = await makeProject();
    await expect(submitExpense(me, { ...input(), projectId: other.projectId, bookingId: null }, receipt)).rejects.toThrow(/booked on/);
    await expect(submitExpense(me, { ...input(), purchaseDate: "2099-01-01" }, receipt)).rejects.toThrow(/future/);
    await expect(submitExpense(me, { ...input(), amount: "0" }, receipt)).rejects.toThrow(/greater than zero/);
    await expect(submitExpense(me, { ...input(), amount: "6000" }, receipt)).rejects.toThrow(/\$5,000/);
    await expect(submitExpense(me, { ...input(), description: "x" }, receipt)).rejects.toThrow(/Describe/);
    await expect(submitExpense(me, input(), { name: "notes.docx", data: Buffer.from("PK..") })).rejects.toThrow(/photo .* or a PDF/);
    await expect(submitExpense(me, input(), { name: "fake.png", data: Buffer.from("not an image") })).rejects.toThrow(/don't match/);
    // The database insists on a receipt and a description for every reimbursement.
    await expect(
      pool.query("insert into compensation_items (staff_id, project_id, work_date, category, unit_rate, amount_cents, requested_by) values ($1, $2, '2026-11-01', 'reimbursement', 10, 1000, $3)", [
        me.staffId,
        project.projectId,
        me.userId,
      ]),
    ).rejects.toThrow(/compensation_items_reimbursement/);
  });

  it("approval pays it back at cost with no GST/HST, even for a registered contractor", async () => {
    const id = await submitExpense(me, { ...input(), amount: "40.00", description: "Ice for the cooler" }, receipt);
    const payable = await decideCompensation(admin.id, id, { approve: true });
    const p = await one<{ base_cents: number; tax_cents: number; total_cents: number; tax_status: string; category: string; description: string }>(
      "select base_cents::int, tax_cents::int, total_cents::int, tax_status, category, description from payable_items where id = $1",
      [payable!.id],
    );
    expect(p).toMatchObject({ base_cents: 4000, tax_cents: 0, total_cents: 4000, tax_status: "no_tax", category: "reimbursement" });
    expect(p.description).toMatch(/Staples · Ice for the cooler .*no GST\/HST/);
    const listed = (await listCompensation(project.projectId)).find((i) => i.id === id);
    expect(listed).toMatchObject({ category: "reimbursement", vendor: "Staples", hasReceipt: true, status: "approved" });
  });
});
