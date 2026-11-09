// Contractor invoices prepared by RGXM under the self-billing arrangement (Agreement v1.0.1 §7).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as a from "@/server/domain/attendance";
import * as billing from "@/server/domain/billing";
import * as invoices from "@/server/domain/invoices";
import * as onboarding from "@/server/domain/onboarding";
import * as pay from "@/server/domain/payments";
import { saveTaxDetails } from "@/server/domain/tax-details";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

const MIN = 60_000;
let finance: { id: string };
let finance2: { id: string };
let pm: { id: string };
let project: { projectId: string; locationId: string };
let agreementId: string;

async function person(opts: { address?: boolean; selfBilling?: boolean } = {}) {
  const u = await makeUser("staff");
  const p = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Inez', 'Invoice', $2) returning id", [u.id, `i.${crypto.randomUUID()}@example.test`]);
  await pool.query(
    `insert into staff_sensitive (staff_id, legal_name, business_name, gst_registration_status, gst_verification_status, mailing_street, mailing_city, mailing_province, mailing_postal_code)
     values ($1, 'Inez Invoice', null, 'no', 'verified', $2, $3, $4, $5)`,
    opts.address === false ? [p.id, null, null, null, null] : [p.id, "1 King St W", "Toronto", "ON", "M5H1A1"],
  );
  const who = { userId: u.id, staffId: p.id };
  if (opts.selfBilling !== false) await onboarding.acceptDocuments(who, [agreementId], "portal_onboarding", { actingFor: "self", legalName: "Inez Invoice" });
  return who;
}

async function approvedLine(staffId: string, daysAgo: number) {
  const start = new Date(Date.now() - daysAgo * 24 * 60 * MIN);
  start.setUTCHours(15, 0, 0, 0);
  const end = new Date(start.getTime() + 8 * 60 * MIN);
  const s = await makeShift(project, start.toISOString(), end.toISOString());
  const b = await book(s.id, staffId, { agreedRateCents: 2500 });
  const rgxm = { kind: "rgxm" as const, userId: pm.id };
  await a.recordAttendance(rgxm, b.id, { type: "check_in", occurredAt: start, note: "sheet" });
  await a.recordAttendance(rgxm, b.id, { type: "check_out", occurredAt: end, note: "sheet" });
  const t = await one<{ id: string }>("select id from timesheets where booking_id = $1", [b.id]);
  await a.approveTimesheet(pm.id, t.id);
  return (await one<{ id: string }>("select id from payable_items where timesheet_id = $1 and status <> 'void'", [t.id])).id;
}

beforeAll(async () => {
  finance = await makeUser();
  finance2 = await makeUser();
  pm = await makeUser();
  project = await makeProject();
  await pool.query("update project_locations set name = 'Union Station', address = '65 Front St W', city = 'Toronto', province = 'ON' where id = $1", [project.locationId]);
  // The agreement version with the self-billing clause (loaded as a draft by migration 0014).
  const doc = await one<{ id: string; self_billing: boolean }>("select id, self_billing from legal_documents where kind = 'contractor_terms' and version = '1.0.1'");
  expect(doc.self_billing).toBe(true);
  await onboarding.approveDocument(finance.id, doc.id, "Approved for tests");
  agreementId = doc.id;
});
afterAll(async () => {
  // Other suites confirm bookings for people who haven't accepted it.
  await pool.query("update legal_documents set status = 'retired' where id = $1", [agreementId]);
  await pool.end();
  await db.$client.end();
});

const billFor = (payableId: string) =>
  one<{ id: string; bill_number: string; invoice_kind: string; document: invoices.InvoiceDocument; self_billing_acceptance_id: string | null } | undefined>(
    "select b.id, b.bill_number, b.invoice_kind, b.document, b.self_billing_acceptance_id from bills b join payable_items p on p.bill_id = b.id where p.id = $1",
    [payableId],
  );

describe("self-billed contractor invoices", () => {
  it("are created automatically when work is approved, for record only, with every required detail, frozen", async () => {
    const who = await person();
    const outsider = await person({ selfBilling: false });
    const l1 = await approvedLine(who.staffId, 20);
    const l2 = await approvedLine(who.staffId, 19);
    const lx = await approvedLine(outsider.staffId, 20);

    // Issued on approval, one per approved timesheet; nobody issues, sends or confirms anything.
    const bill = (await billFor(l1))!;
    expect(bill.invoice_kind).toBe("self_billed");
    expect(bill.self_billing_acceptance_id).toBeTruthy();
    expect((await billFor(l2))!.id).not.toBe(bill.id);
    expect(await billFor(lx)).toBeUndefined();
    expect((await one<{ n: number }>("select count(*)::int n from outbox_events where type like 'invoice%'")).n).toBe(0);

    const doc = bill.document;
    expect(doc.title).toBe("Contractor Invoice — Prepared by RGXM on behalf of Inez Invoice");
    expect(doc.number).toBe(bill.bill_number);
    expect(doc.statement).toBe("Prepared by RGXM Inc. on behalf of the supplier under an agreed self-billing arrangement.");
    expect(doc.supplier).toMatchObject({ name: "Inez Invoice", address: "1 King St W, Toronto, ON M5H 1A1", gstHstNumber: null });
    expect(doc.customer).toEqual({ name: "RGXM Inc.", address: "Unit A - 6975 Pacific Circle, Mississauga, ON L5T 2H3" });
    expect(doc.lines).toEqual([expect.objectContaining({ categoryLabel: "Hourly fees", quantity: "8.00", unit: "hour", amountCents: 20000, location: { name: "Union Station", address: "65 Front St W, Toronto, ON" } })]);
    expect(doc).toMatchObject({ subtotalCents: 20000, taxCents: 0, totalCents: 20000, currency: "CAD", selfBilling: { version: "1.0.1" } });
    expect(doc.serviceDates.from).toBe(doc.serviceDates.to);
    expect(doc.dueDate).toBeTruthy();
    await expect(pool.query("update bills set document = '{}' where id = $1", [bill.id])).rejects.toThrow(/finalized/);

    // Payment doesn't depend on the invoice: batching and the bank file proceed as usual and reuse it.
    const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [l1, l2, lx] });
    await pay.approveBatch(finance2.id, batch.id);
    await pay.exportBatch(finance.id, batch.id, "csv_generic");
    expect((await one<{ n: number }>("select count(*)::int n from bills where staff_id = $1", [who.staffId])).n).toBe(2);
    // The contractor without self-billing gets an internal bill when paid.
    expect((await billFor(lx))!.invoice_kind).toBe("rgxm_bill");
  });

  it("wait for missing details or a tax decision, then catch up automatically", async () => {
    const who = await person({ address: false });
    const line = await approvedLine(who.staffId, 21);
    expect(await billFor(line)).toBeUndefined();
    expect(await invoices.invoiceDetailsMissing(who.staffId)).toEqual(["mailing address"]);
    // Adding the address issues the waiting invoice.
    await saveTaxDetails(who.userId, who.staffId, { legalName: "Inez Invoice", gstRegistrationStatus: "no", mailingStreet: "1 King St W", mailingCity: "Toronto", mailingProvince: "ON", mailingPostalCode: "M5H 1A1" }, { bySelf: true });
    expect((await billFor(line))!.invoice_kind).toBe("self_billed");
    // A line waiting for a Finance tax decision isn't invoiced until Finance decides.
    await pool.query("update staff_sensitive set gst_verification_status = 'unverified' where staff_id = $1", [who.staffId]);
    const pending = await approvedLine(who.staffId, 22);
    expect(await one<{ tax_status: string }>("select tax_status from payable_items where id = $1", [pending])).toMatchObject({ tax_status: "review_required" });
    expect(await billFor(pending)).toBeUndefined();
    // Finance decides the tax; the new line is invoiced immediately.
    const decided = await pay.overrideLineTax(finance.id, pending, { reason: "Confirmed not registered", ruleIds: [] });
    expect((await billFor(decided.id))!.invoice_kind).toBe("self_billed");
  });

  it("issue for work approved before the contractor accepted self-billing", async () => {
    const who = await person({ selfBilling: false });
    const line = await approvedLine(who.staffId, 23);
    expect(await billFor(line)).toBeUndefined();
    await onboarding.acceptDocuments(who, [agreementId], "portal_update", { actingFor: "self", legalName: "Inez Invoice" });
    expect((await billFor(line))!.invoice_kind).toBe("self_billed");
  });

  it("let only the contractor report a discrepancy, and aren't duplicated by contractor invoices", async () => {
    const who = await person();
    const other = await person();
    const line = await approvedLine(who.staffId, 24);
    const billId = (await billFor(line))!.id;
    await expect(billing.requestPayReview(other, { payableId: null, billId, kind: "amount", message: "Not my invoice" })).rejects.toThrow(/not found/);
    const r = await billing.requestPayReview(who, { payableId: null, billId, kind: "amount", message: "The lunch allowance is missing" });
    expect(r.billId).toBe(billId);
    await expect(billing.recordContractorInvoice(finance.id, { staffId: who.staffId, billId, invoiceNumber: "MY-1", invoiceDate: "2026-11-09", subtotalCents: 20000, taxCents: 0 })).rejects.toThrow(/duplicate/);
    expect(await invoices.getInvoice(billId, { staffId: other.staffId })).toBeNull();
  });

  it("are corrected by a linked adjustment on a new invoice, preserving the original", async () => {
    const who = await person();
    const line = await approvedLine(who.staffId, 25);
    const original = (await billFor(line))!;
    // Hours corrected after approval: the invoice stands; the difference is a linked adjustment.
    const ts = await one<{ timesheet_id: string }>("select timesheet_id from payable_items where id = $1", [line]);
    await a.correctApprovedTimesheet(pm.id, ts.timesheet_id, { payableMinutes: 420, reason: "Unpaid break wasn't recorded" });
    expect(await one<{ status: string; total_cents: number }>("select status, total_cents::int from payable_items where id = $1", [line])).toEqual({ status: "pending", total_cents: 20000 });
    const adj = await one<{ id: string; total_cents: number }>("select id, total_cents::int from payable_items where adjusts_payable_id = $1", [line]);
    expect(adj.total_cents).toBe(-2500);
    const credit = (await billFor(adj.id))!;
    expect(credit.document.title).toMatch(/^Contractor Credit Note/);
    expect(credit.document.lines[0]).toMatchObject({ amountCents: -2500, adjustsInvoice: original.bill_number });
    expect((await invoices.getInvoice(original.id))!.adjustments).toHaveLength(1);
  });

  it("stop when the contractor accepts a later agreement without the clause", async () => {
    const who = await person();
    expect(await invoices.selfBillingAuthorization(db, who.staffId)).toMatchObject({ version: "1.0.1" });
    const v2 = await onboarding.saveDraftDocument(finance.id, { kind: "contractor_terms", version: "9.9-test", title: "Agreement without self-billing", body: "A test agreement version without the self-billing clause. ".repeat(3), selfBilling: false });
    await onboarding.approveDocument(finance.id, v2, "Test only");
    await onboarding.acceptDocuments(who, [v2], "portal_update", { actingFor: "self", legalName: "Inez Invoice" });
    expect(await invoices.selfBillingAuthorization(db, who.staffId)).toBeNull();
    expect(await billFor(await approvedLine(who.staffId, 26))).toBeUndefined();
    await pool.query("update legal_documents set status = 'retired' where id = $1", [v2]);
  });
});
