// Contractor tax details, HST on pay, and the year-end T4A summary.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as a from "@/server/domain/attendance";
import * as pay from "@/server/domain/payments";
import { buildT4aCsv, getT4aSummary } from "@/server/domain/t4a";
import { getTaxDetails, saveTaxDetails } from "@/server/domain/tax-details";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

const MIN = 60_000;
const VALID_SIN = "130 692 544"; // the standard documentation example; passes the Luhn check
let finance: { id: string };
let finance2: { id: string };
let pm: { id: string };
let project: { projectId: string; locationId: string };

async function contractor() {
  const u = await makeUser("staff");
  const p = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Tia', 'Taxpayer', $2) returning id", [u.id, `t.${crypto.randomUUID()}@example.test`]);
  return { userId: u.id, staffId: p.id };
}

/** An approved 8-hour shift at $25/h → a $200 payable (before any HST). */
async function approved(staffId: string, daysAgo = 2) {
  const start = new Date(Date.now() - daysAgo * 24 * 60 * MIN);
  const end = new Date(start.getTime() + 8 * 60 * MIN);
  const s = await makeShift(project, start.toISOString(), end.toISOString());
  const b = await book(s.id, staffId, { agreedRateCents: 2500 });
  const rgxm = { kind: "rgxm" as const, userId: pm.id };
  await a.recordAttendance(rgxm, b.id, { type: "check_in", occurredAt: start, note: "Sign-in sheet" });
  await a.recordAttendance(rgxm, b.id, { type: "check_out", occurredAt: end, note: "Sign-in sheet" });
  const t = await one<{ id: string }>("select id from timesheets where booking_id = $1", [b.id]);
  await a.approveTimesheet(pm.id, t.id);
  return one<{ id: string; base_cents: number; tax_cents: number; total_cents: number; calc_inputs: { hst: { number: string } | null } }>(
    "select id, base_cents::int, tax_cents::int, total_cents::int, calc_inputs from payable_items where timesheet_id = $1 and status <> 'void'",
    [t.id],
  );
}

const registered = { legalName: "Tia Taxpayer", taxRegistered: true, gstHstNumber: "123456789 RT0001" };

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

describe("tax details", () => {
  it("validate GST/HST, SIN and postal codes", async () => {
    const { staffId } = await contractor();
    await expect(saveTaxDetails(finance.id, staffId, { taxRegistered: true })).rejects.toThrow(/GST\/HST number/);
    await expect(saveTaxDetails(finance.id, staffId, { taxRegistered: true, gstHstNumber: "12345" })).rejects.toThrow(/look like/);
    await expect(saveTaxDetails(finance.id, staffId, { taxRegistered: false, sin: "123 456 789" })).rejects.toThrow(/isn't valid/);
    await expect(saveTaxDetails(finance.id, staffId, { taxRegistered: false, mailingPostalCode: "90210" })).rejects.toThrow(/postal code/);
  });

  it("store the SIN encrypted and write-only, and keep it when left blank", async () => {
    const { userId, staffId } = await contractor();
    await saveTaxDetails(userId, staffId, { ...registered, sin: VALID_SIN, mailingStreet: "1 Front St W", mailingCity: "Toronto", mailingProvince: "ON", mailingPostalCode: "m5j 1a1" }, { bySelf: true });
    const row = await one<{ sin_encrypted: string; sin_last3: string; gst_hst_number: string; mailing_postal_code: string }>("select sin_encrypted, sin_last3, gst_hst_number, mailing_postal_code from staff_sensitive where staff_id = $1", [staffId]);
    expect(row.sin_encrypted).toMatch(/^v1:/);
    expect(row.sin_encrypted).not.toContain("130692544");
    expect(row).toMatchObject({ sin_last3: "544", gst_hst_number: "123456789RT0001", mailing_postal_code: "M5J1A1" });
    // Saving again without a SIN keeps it; the read model never includes it.
    await saveTaxDetails(finance.id, staffId, { ...registered, legalName: "Tia T. Taxpayer" });
    const details = await getTaxDetails(staffId);
    expect(details).toMatchObject({ legalName: "Tia T. Taxpayer", sinLast3: "544" });
    expect(JSON.stringify(details)).not.toContain("130692544");
    // The audit log records that it changed, never the number.
    const audits = (await pool.query("select action, after::text from audit_log where entity_id = $1 order by created_at", [staffId])).rows;
    expect(audits.map((r) => r.action)).toEqual(["staff.tax_details_self", "staff.tax_details"]);
    expect(audits.map((r) => r.after).join()).not.toMatch(/130692|RT0001|Front St/);
  });
});

describe("HST", () => {
  it("is added at 13% for GST/HST-registered contractors only", async () => {
    const plain = await contractor();
    const hst = await contractor();
    await saveTaxDetails(finance.id, hst.staffId, registered);
    expect(await approved(plain.staffId)).toMatchObject({ base_cents: 20000, tax_cents: 0, total_cents: 20000 });
    const p = await approved(hst.staffId);
    expect(p).toMatchObject({ base_cents: 20000, tax_cents: 2600, total_cents: 22600 });
    expect(p.calc_inputs.hst).toMatchObject({ number: "123456789RT0001" });
  });

  it("is recalculated when registration changes after approval, and stale pay can't be batched", async () => {
    const who = await contractor();
    const p = await approved(who.staffId);
    expect(p.tax_cents).toBe(0);
    await saveTaxDetails(finance.id, who.staffId, registered);
    await expect(pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [p.id] })).rejects.toThrow(/Refresh pay details/);
    expect(await pay.refreshClassifications(finance.id)).toBeGreaterThanOrEqual(1);
    const now = await one<{ id: string; tax_cents: number; total_cents: number }>("select id, tax_cents::int, total_cents::int from payable_items where staff_id = $1 and status <> 'void'", [who.staffId]);
    expect(now).toMatchObject({ tax_cents: 2600, total_cents: 22600 });
    const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [now.id] });
    expect(batch.totalCents).toBe(22600);
  });
});

describe("T4A summary", () => {
  it("totals fees paid in the year per contractor, with the decrypted SIN only in the CSV", async () => {
    const who = await contractor();
    await saveTaxDetails(who.userId, who.staffId, { ...registered, sin: VALID_SIN }, { bySelf: true });
    const items = [await approved(who.staffId, 2), await approved(who.staffId, 3), await approved(who.staffId, 4)];
    const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: items.map((i) => i.id) });
    await pay.approveBatch(finance2.id, batch.id);
    await pay.exportBatch(finance.id, batch.id, "csv_generic");
    const paidOn = new Date().toISOString().slice(0, 10);
    await pay.markBatchPaid(finance.id, batch.id, { paidOn });
    const year = Number(paidOn.slice(0, 4));

    const row = (await getT4aSummary(year)).find((r) => r.staffId === who.staffId)!;
    expect(row).toMatchObject({ feesCents: 60000, hstCents: 7800, totalCents: 67800, payments: 3, slipRequired: true, missing: ["mailing address"] });
    expect(JSON.stringify(row)).not.toContain("130692544");

    const csv = await buildT4aCsv(finance.id, year);
    expect(csv.csv).toContain("130 692 544");
    expect(csv.csv).toContain("600.00,78.00,678.00,123456789RT0001,3,Yes,mailing address");
    expect((await one<{ n: number }>("select count(*)::int n from audit_log where action = 't4a.export' and actor_id = $1", [finance.id])).n).toBeGreaterThanOrEqual(1);
    // Nothing for a year with no payments.
    expect((await getT4aSummary(year - 5)).find((r) => r.staffId === who.staffId)).toBeUndefined();
  });
});
