// Contractor GST/HST registration, Finance verification, tax decisions on bill lines and history.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as a from "@/server/domain/attendance";
import * as pay from "@/server/domain/payments";
import { getTaxDetails, saveTaxDetails } from "@/server/domain/tax-details";
import * as taxConfig from "@/server/domain/tax-config";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

const MIN = 60_000;
let finance: { id: string };
let pm: { id: string };
let project: { projectId: string; locationId: string };
let onRuleId: string;

async function contractor() {
  const u = await makeUser("staff");
  const p = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Tia', 'Taxpayer', $2) returning id", [u.id, `t.${crypto.randomUUID()}@example.test`]);
  return { userId: u.id, staffId: p.id };
}

/** An approved 8-hour shift at $25/h → a $200 fee line (before tax). */
async function approved(staffId: string, proj = project, daysAgo = 2) {
  const start = new Date(Date.now() - daysAgo * 24 * 60 * MIN);
  const end = new Date(start.getTime() + 8 * 60 * MIN);
  const s = await makeShift(proj, start.toISOString(), end.toISOString());
  const b = await book(s.id, staffId, { agreedRateCents: 2500 });
  const rgxm = { kind: "rgxm" as const, userId: pm.id };
  await a.recordAttendance(rgxm, b.id, { type: "check_in", occurredAt: start, note: "Sign-in sheet" });
  await a.recordAttendance(rgxm, b.id, { type: "check_out", occurredAt: end, note: "Sign-in sheet" });
  const t = await one<{ id: string }>("select id from timesheets where booking_id = $1", [b.id]);
  await a.approveTimesheet(pm.id, t.id);
  return line(`timesheet_id = '${t.id}'`);
}

async function line(where: string) {
  return one<{ id: string; base_cents: number; tax_cents: number; total_cents: number; tax_status: string; tax_basis: string; status: string }>(
    `select id, base_cents::int, tax_cents::int, total_cents::int, tax_status, tax_basis, status from payable_items where ${where} and status <> 'void'`,
  );
}

const registered = { legalName: "Tia Taxpayer", businessName: "Tia Events", gstRegistrationStatus: "yes" as const, gstHstNumber: "123456789 RT0001", gstRegistrationEffectiveDate: "2020-01-01" };
const notRegistered = { legalName: "Tia Taxpayer", gstRegistrationStatus: "no" as const };

async function projectIn(province: string, supplyType = "onsite") {
  const p = await makeProject();
  await pool.query("update projects set event_province = $2, service_category = 'event_staff_onsite', supply_type = $3 where id = $1", [p.projectId, province, supplyType]);
  return p;
}

beforeAll(async () => {
  finance = await makeUser();
  pm = await makeUser();
  project = await projectIn("ON");
  onRuleId = (await one<{ id: string }>("select id from tax_rules where jurisdiction = 'ON' and component = 'HST' and status = 'draft' limit 1")).id;
});
afterAll(async () => {
  await pool.query("update org_settings set auto_tax_enabled = false");
  await pool.end();
  await db.$client.end();
});

describe("GST/HST registration (contractor-facing)", () => {
  it("asks Yes / No / Unsure, needs number, registered name and start date for Yes, and never a rate", async () => {
    const { staffId } = await contractor();
    await expect(saveTaxDetails(finance.id, staffId, {} as never)).rejects.toThrow(/Yes, No or Unsure/);
    await expect(saveTaxDetails(finance.id, staffId, { gstRegistrationStatus: "yes" })).rejects.toThrow(/registration number/);
    await expect(saveTaxDetails(finance.id, staffId, { ...registered, gstHstNumber: "12345" })).rejects.toThrow(/look like/);
    await expect(saveTaxDetails(finance.id, staffId, { ...registered, gstRegistrationEffectiveDate: null })).rejects.toThrow(/took effect/);
    // A rate sent anyway is ignored: there is nowhere to store it.
    await saveTaxDetails(finance.id, staffId, { ...registered, taxRatePercent: "5" } as never);
    const row = await one<Record<string, unknown>>("select * from staff_sensitive where staff_id = $1", [staffId]);
    expect(row).toMatchObject({ gst_registration_status: "yes", gst_hst_number: "123456789RT0001", tax_registered: true, gst_verification_status: "unverified" });
    expect(Object.keys(row).some((k) => k.includes("rate"))).toBe(false);
    await saveTaxDetails(finance.id, staffId, { gstRegistrationStatus: "unsure" });
    expect(await getTaxDetails(staffId)).toMatchObject({ gstRegistrationStatus: "unsure", gstHstNumber: null, taxRegistered: false });
  });

  it("resets Finance's verification when the answer or number changes, and keeps numbers out of the audit log", async () => {
    const { userId, staffId } = await contractor();
    await saveTaxDetails(userId, staffId, registered, { bySelf: true });
    await expect(taxConfig.verifyGstRegistration(finance.id, staffId, { outcome: "verified", reference: "" })).rejects.toThrow(/evidence/);
    await taxConfig.verifyGstRegistration(finance.id, staffId, { outcome: "verified", reference: "CRA registry lookup 2026-11-09" });
    expect((await getTaxDetails(staffId)).gstVerificationStatus).toBe("verified");
    // Same answer re-saved (e.g. address change): verification kept.
    await saveTaxDetails(userId, staffId, { ...registered, mailingCity: "Toronto" }, { bySelf: true });
    expect((await getTaxDetails(staffId)).gstVerificationStatus).toBe("verified");
    await saveTaxDetails(userId, staffId, { ...registered, gstHstNumber: "987654321RT0001" }, { bySelf: true });
    expect((await getTaxDetails(staffId)).gstVerificationStatus).toBe("unverified");
    const audits = (await pool.query("select after::text from audit_log where entity_id = $1", [staffId])).rows.map((r) => r.after).join();
    expect(audits).not.toMatch(/RT0001/);
    // Unsure can't be verified: the contractor must answer first.
    const other = await contractor();
    await saveTaxDetails(other.userId, other.staffId, { gstRegistrationStatus: "unsure" }, { bySelf: true });
    await expect(taxConfig.verifyGstRegistration(finance.id, other.staffId, { outcome: "verified", reference: "lookup" })).rejects.toThrow(/Yes or No/);
  });
});

describe("tax on bill lines", () => {
  it("routes unknown or unverified registrations to Finance review, which blocks batching until Finance decides", async () => {
    const unknown = await contractor();
    const l1 = await approved(unknown.staffId);
    expect(l1).toMatchObject({ tax_status: "review_required", tax_cents: 0, base_cents: 20000 });
    expect(l1.tax_basis).toMatch(/hasn't said whether they're registered/);
    await expect(pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [l1.id] })).rejects.toThrow(/tax review/);

    // Finance decides with a reason, choosing from configured rules (no free-typed rate).
    await expect(pay.overrideLineTax(finance.id, l1.id, { reason: "ok", ruleIds: [] })).rejects.toThrow(/Explain/);
    await expect(pay.overrideLineTax(finance.id, l1.id, { reason: "Confirmed by phone they're a small supplier, not registered", ruleIds: ["00000000-0000-0000-0000-000000000000"] })).rejects.toThrow(/configured list/);
    const fixed = await pay.overrideLineTax(finance.id, l1.id, { reason: "Confirmed by phone they're a small supplier, not registered", ruleIds: [] });
    expect(fixed).toMatchObject({ taxStatus: "finance_override", taxCents: 0 });
    expect((await one<{ void_reason: string }>("select void_reason from payable_items where id = $1", [l1.id])).void_reason).toMatch(/Tax treatment corrected/);
    const batch = await pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [fixed.id] });
    expect(batch.totalCents).toBe(20000);
    await expect(pay.overrideLineTax(finance.id, fixed.id, { reason: "Changing my mind again", ruleIds: [] })).rejects.toThrow(/before the line is batched/);
  });

  it("adds no tax for a verified non-registrant", async () => {
    const who = await contractor();
    await saveTaxDetails(who.userId, who.staffId, notRegistered, { bySelf: true });
    await taxConfig.verifyGstRegistration(finance.id, who.staffId, { outcome: "verified", reference: "Not found in CRA registry 2026-11-09" });
    expect(await approved(who.staffId)).toMatchObject({ tax_status: "no_tax", tax_cents: 0, total_cents: 20000 });
  });

  it("stays in review while automatic calculation or any approval is missing", async () => {
    const who = await contractor();
    await saveTaxDetails(who.userId, who.staffId, registered, { bySelf: true });
    await taxConfig.verifyGstRegistration(finance.id, who.staffId, { outcome: "verified", reference: "CRA registry lookup" });
    const l = await approved(who.staffId);
    expect(l.tax_status).toBe("review_required");
    expect(l.tax_basis).toMatch(/automatic tax calculation is off/);
    await expect(taxConfig.setAutoTax(finance.id, true, "")).rejects.toThrow(/approved it/);
  });

  it("calculates from the event province once everything is approved, stores the decision per line, and keeps history", async () => {
    // Accountant approvals, recorded by Finance.
    await taxConfig.approveTaxRule(finance.id, onRuleId, "Accountant email 2026-11-20");
    await taxConfig.approveServiceCategory(finance.id, "event_staff_onsite", "Accountant email 2026-11-20");
    await taxConfig.saveTreatment(finance.id, { category: "fee", gstHst: "taxable", yearEnd: "box_048" });
    await taxConfig.approveTreatment(finance.id, "fee", "Accountant email 2026-11-20");
    await taxConfig.setAutoTax(finance.id, true, "Accountant sign-off 2026-11-20");

    const who = await contractor();
    // The contractor lives in Alberta; the event is in Ontario. Only the event province counts.
    await saveTaxDetails(who.userId, who.staffId, { ...registered, mailingProvince: "AB" }, { bySelf: true });
    await taxConfig.verifyGstRegistration(finance.id, who.staffId, { outcome: "verified", reference: "CRA registry lookup" });
    const l = await approved(who.staffId);
    expect(l).toMatchObject({ tax_status: "calculated", base_cents: 20000, tax_cents: 2600, total_cents: 22600 });
    const tl = await one<Record<string, unknown>>("select component, jurisdiction, rate_ppm, taxable_cents::int, tax_cents::int, tax_rule_id, service_category, basis from payable_tax_lines where payable_item_id = $1", [l.id]);
    expect(tl).toMatchObject({ component: "HST", jurisdiction: "ON", rate_ppm: 130000, taxable_cents: 20000, tax_cents: 2600, tax_rule_id: onRuleId, service_category: "event_staff_onsite" });
    expect(String(tl.basis)).toMatch(/event province/);
    await expect(pool.query("update payable_tax_lines set tax_cents = 0 where payable_item_id = $1", [l.id])).rejects.toThrow(/append-only/);

    // Quebec event: GST and QST as separate components.
    const qc = await projectIn("QC");
    const gst = await taxConfig.createTaxRule(finance.id, { jurisdiction: "QC", component: "GST", ratePercent: "5", effectiveFrom: "2008-01-01" });
    const qst = await taxConfig.createTaxRule(finance.id, { jurisdiction: "QC", component: "QST", ratePercent: "9.975", effectiveFrom: "2013-01-01" });
    await taxConfig.approveTaxRule(finance.id, gst.id, "Accountant email");
    await taxConfig.approveTaxRule(finance.id, qst.id, "Accountant email");
    const q = await approved(who.staffId, qc, 3);
    expect(q).toMatchObject({ tax_status: "calculated", tax_cents: 1000 + 1995 });
    expect((await pool.query("select component, tax_cents::int from payable_tax_lines where payable_item_id = $1 order by component", [q.id])).rows).toEqual([
      { component: "GST", tax_cents: 1000 },
      { component: "QST", tax_cents: 1995 },
    ]);
    // An overlapping approved rule is refused.
    const dup = await taxConfig.createTaxRule(finance.id, { jurisdiction: "QC", component: "GST", ratePercent: "6", effectiveFrom: "2020-01-01" });
    await expect(taxConfig.approveTaxRule(finance.id, dup.id, "Accountant email")).rejects.toThrow(/already covers/);

    // Offsite and multi-province work go to Finance.
    const off = await projectIn("ON", "offsite");
    expect((await approved(who.staffId, off, 4)).tax_status).toBe("review_required");
    const multi = await projectIn("ON", "multi_province");
    expect((await approved(who.staffId, multi, 5)).tax_basis).toMatch(/multi-province/);

    // Historical values: retiring the rule and changing the profile don't change existing lines.
    await taxConfig.retireTaxRule(finance.id, gst.id, "Superseded");
    await saveTaxDetails(who.userId, who.staffId, notRegistered, { bySelf: true });
    expect(await line(`id = '${q.id}'`)).toMatchObject({ tax_cents: 2995 });
    expect((await pool.query("select count(*)::int n from payable_tax_lines where payable_item_id = $1", [q.id])).rows[0].n).toBe(2);

    // The line no longer matches the person's answer: it can't be batched until refreshed.
    await expect(pay.createBatch(finance.id, { type: "contractor", payPeriodId: null, payableIds: [l.id] })).rejects.toThrow(/Refresh pay details/);
    expect(await pay.refreshClassifications(finance.id)).toBeGreaterThanOrEqual(1);
    // Now "no" but unverified again → Finance review.
    expect(await line(`timesheet_id = (select timesheet_id from payable_items where id = '${l.id}')`)).toMatchObject({ tax_status: "review_required", tax_cents: 0 });
  });
});
