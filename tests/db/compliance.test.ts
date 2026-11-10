// Contractor onboarding records, year-end review, privacy operations, incidents and security.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { minimizePersonalData, recordAudit } from "@/server/audit";
import { hasFreshStepUp, recordStepUp, rememberSignInContext, screenSignIn, STEP_UP_MAX_AGE_MS } from "@/server/auth/step-up";
import { db } from "@/server/db";
import * as a from "@/server/domain/attendance";
import { confirmBooking } from "@/server/domain/bookings";
import * as incidents from "@/server/domain/incidents";
import * as onboarding from "@/server/domain/onboarding";
import * as pay from "@/server/domain/payments";
import { anonymizeStaff } from "@/server/domain/privacy";
import * as ops from "@/server/domain/privacy-ops";
import * as yearEnd from "@/server/domain/t4a";
import * as taxConfig from "@/server/domain/tax-config";
import { emailAllowed } from "@/server/notify/notify";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

const MIN = 60_000;
let admin: { id: string };
let finance2: { id: string };
let project: { projectId: string; locationId: string };

async function person() {
  const u = await makeUser("staff");
  const p = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Ola', 'Onboard', $2) returning id", [u.id, `o.${crypto.randomUUID()}@example.test`]);
  await pool.query("insert into staff_sensitive (staff_id, legal_name, gst_registration_status, gst_verification_status) values ($1, 'Ola Onboard', 'no', 'verified')", [p.id]);
  return { userId: u.id, staffId: p.id };
}

async function offered(staffId: string, hoursAhead = 48) {
  const start = new Date(Date.now() + hoursAhead * 60 * MIN);
  const s = await makeShift(project, start.toISOString(), new Date(start.getTime() + 4 * 60 * MIN).toISOString());
  const b = await book(s.id, staffId, { status: "awaiting_confirmation" });
  await pool.query("update bookings set offered_rate_cents = 2500 where id = $1", [b.id]);
  return b.id;
}

beforeAll(async () => {
  admin = await makeUser();
  finance2 = await makeUser();
  project = await makeProject();
});
afterAll(async () => {
  await pool.query("update org_settings set require_contractor_approval = false");
  await pool.end();
  await db.$client.end();
});

describe("contractor onboarding", () => {
  it("requires a recorded contractor approval before a booking can be confirmed", async () => {
    await pool.query("update org_settings set require_contractor_approval = true");
    const who = await person();
    const bookingId = await offered(who.staffId, 50);
    await expect(confirmBooking(admin.id, bookingId)).rejects.toThrow(/approval for the contractor process/);
    await expect(onboarding.approveContractors(admin.id, [who.staffId], { approvedOn: "2999-01-01" })).rejects.toThrow(/future/);
    const r = await onboarding.approveContractors(admin.id, [who.staffId], { approvedOn: "2026-11-01", assessmentReference: "Accountant checklist v1, file 2026-11" });
    expect(r).toEqual({ approved: 1, alreadyApproved: 0 });
    expect(await onboarding.approveContractors(admin.id, [who.staffId], { approvedOn: "2026-11-01" })).toEqual({ approved: 0, alreadyApproved: 1 });
    await confirmBooking(admin.id, bookingId);
    // Revoked approval blocks new confirmations again, and the history is kept.
    await onboarding.revokeContractorApproval(admin.id, who.staffId, "Engagement ended");
    await expect(confirmBooking(admin.id, await offered(who.staffId, 60))).rejects.toThrow(/approval/);
    expect((await onboarding.contractorApprovalHistory(who.staffId)).length).toBe(1);
  });

  it("keeps privacy acknowledgement and terms acceptance separate, versioned and append-only", async () => {
    const who = await person();
    await onboarding.approveContractors(admin.id, [who.staffId], { approvedOn: "2026-11-01" });
    const body = "These are the platform terms for RGXM Crew contractors. ".repeat(3);
    const termsId = await onboarding.saveDraftDocument(admin.id, { kind: "contractor_terms", version: "1.0", title: "Contractor terms", body });
    // A draft doesn't block anything.
    expect(await onboarding.bookingBlockers(db, who.staffId)).toEqual([]);
    await expect(onboarding.approveDocument(admin.id, termsId, "")).rejects.toThrow(/legal review/);
    await onboarding.approveDocument(admin.id, termsId, "Reviewed by counsel, email 2026-11-25");
    expect(await onboarding.bookingBlockers(db, who.staffId)).toEqual(["they haven't accepted the current Independent Contractor Agreement"]);
    await expect(pool.query("update legal_documents set body = 'changed' where id = $1", [termsId])).rejects.toThrow(/frozen/);
    // The agreement records who it's with.
    await expect(onboarding.acceptDocuments(who, [termsId], "portal_onboarding")).rejects.toThrow(/who is entering/);
    expect(() => onboarding.normalizeParty({ actingFor: "business", businessName: "Ola Events Inc.", representative: "" })).toThrow(/authorized/);
    await onboarding.acceptDocuments(who, [termsId], "portal_onboarding", onboarding.normalizeParty({ actingFor: "business", businessName: "Ola Events Inc.", representative: "Ola Onboard" }));
    expect(await onboarding.bookingBlockers(db, who.staffId)).toEqual([]);
    const history = await onboarding.acceptanceHistory(who.staffId);
    expect(history).toEqual([expect.objectContaining({ kind: "contractor_terms", version: "1.0", method: "portal_onboarding", actingFor: "business", contractingParty: "Ola Events Inc.", authorizedRepresentative: "Ola Onboard" })]);
    const copy = await onboarding.acceptedCopy(who.staffId, history[0]!.id);
    expect(copy?.d.body).toBe(body.trim());
    // Another contractor can't open this person's copy.
    expect(await onboarding.acceptedCopy((await person()).staffId, history[0]!.id)).toBeNull();
    await expect(pool.query("insert into staff_acceptances (staff_id, document_id, kind, version, method) values ($1, $2, 'contractor_terms', '1.0', 'portal_update')", [(await person()).staffId, termsId])).rejects.toThrow(/staff_acceptances_party/);
    await expect(pool.query("delete from staff_acceptances where staff_id = $1", [who.staffId])).rejects.toThrow(/append-only/);

    // A new version replaces the old one and must be accepted again.
    const v2 = await onboarding.saveDraftDocument(admin.id, { kind: "contractor_terms", version: "1.1", title: "Contractor terms", body: `${body} Updated.` });
    await onboarding.approveDocument(admin.id, v2, "Reviewed by counsel, email 2026-12-02");
    expect(await onboarding.pendingAcceptances(who.staffId)).toEqual([expect.objectContaining({ version: "1.1" })]);
    await expect(onboarding.acceptDocuments(who, [termsId], "portal_update", { actingFor: "self", legalName: "Ola Onboard" })).rejects.toThrow(/newer version/);
    // Retire it again so other suites aren't blocked.
    await pool.query("update legal_documents set status = 'retired' where kind = 'contractor_terms' and status = 'approved'");
  });

  it("records the contractor approval automatically when the agreement is accepted, but never undoes a revocation", async () => {
    await pool.query("update org_settings set require_contractor_approval = true");
    const body = "These are the contractor terms for RGXM Crew, auto-approval test. ".repeat(3);
    const termsId = await onboarding.saveDraftDocument(admin.id, { kind: "contractor_terms", version: "9.0", title: "Contractor terms", body });
    await onboarding.approveDocument(admin.id, termsId, "Reviewed by counsel, auto-approval test");
    const self = { actingFor: "self" as const, legalName: "Ola Onboard" };

    const who = await person();
    expect(await onboarding.bookingBlockers(db, who.staffId)).toContain("RGXM hasn't recorded their approval for the contractor process");
    await onboarding.acceptDocuments(who, [termsId], "portal_onboarding", self);
    expect(await onboarding.bookingBlockers(db, who.staffId)).toEqual([]);
    const [approval] = await onboarding.contractorApprovalHistory(who.staffId);
    expect(approval).toMatchObject({ approvedBy: who.userId, revokedAt: null, notes: expect.stringMatching(/automatically.*version 9\.0/) });

    // RGXM revokes; accepting a newer agreement doesn't quietly approve them again.
    await onboarding.revokeContractorApproval(admin.id, who.staffId, "Not working with RGXM for now");
    const v2 = await onboarding.saveDraftDocument(admin.id, { kind: "contractor_terms", version: "9.1", title: "Contractor terms", body: `${body} Updated.` });
    await onboarding.approveDocument(admin.id, v2, "Reviewed by counsel, auto-approval test v2");
    await onboarding.acceptDocuments(who, [v2], "portal_update", self);
    expect(await onboarding.bookingBlockers(db, who.staffId)).toEqual(["RGXM hasn't recorded their approval for the contractor process"]);
    expect(await onboarding.contractorApprovalHistory(who.staffId)).toHaveLength(1);

    await pool.query("update legal_documents set status = 'retired' where kind = 'contractor_terms' and status = 'approved'");
  });

  it("records optional consents as a history and only offers approved purposes", async () => {
    const who = await person();
    expect(await onboarding.offeredConsentPurposes()).toEqual([]);
    expect(await onboarding.setConsents(who, { marketing_email: true }, "portal_onboarding")).toBe(0);
    await onboarding.approveConsentPurpose(admin.id, "marketing_email", "Wording approved by counsel 2026-11-25", true);
    expect(await onboarding.setConsents(who, { marketing_email: true }, "portal_onboarding")).toBe(1);
    expect(await emailAllowed("marketing", who.userId, "x")).toBe(true);
    expect(await onboarding.setConsents(who, { marketing_email: false }, "portal_update")).toBe(1);
    expect(await onboarding.setConsents(who, { marketing_email: false }, "portal_update")).toBe(0);
    expect(await emailAllowed("marketing", who.userId, "x")).toBe(false);
    expect((await one<{ n: number }>("select count(*)::int n from staff_consent_events where staff_id = $1", [who.staffId])).n).toBe(2);
    // Shift-opportunity emails can be switched off; essential ones can't.
    await onboarding.setEmailPreferences(who, { shiftOpportunityEmails: false });
    expect(await emailAllowed("shift_opportunity", who.userId, "x")).toBe(false);
    expect(await emailAllowed("essential", who.userId, "x")).toBe(true);
    await onboarding.approveConsentPurpose(admin.id, "marketing_email", "", false);
  });

  it("stores optional WSIB/status evidence without requiring it", async () => {
    const who = await person();
    const e = await onboarding.addEvidence(admin.id, who.staffId, { kind: "wsib_coverage_not_required", reference: "WSIB letter 2026-10", verified: true });
    expect(e).toMatchObject({ kind: "wsib_coverage_not_required", verifiedBy: admin.id });
    await onboarding.removeEvidence(admin.id, e.id);
    expect(await onboarding.listEvidence(who.staffId)).toEqual([]);
  });
});

describe("RGXM's published documents", () => {
  it("are loaded as drafts (an admin approves them), with the platform terms accepted separately", async () => {
    const docs = (await pool.query("select kind, version, title from legal_documents where version in ('2026-11-09', '1.0.0', '1.0.1') order by kind")).rows;
    expect(docs).toEqual([
      { kind: "contractor_terms", version: "1.0.1", title: "RGXM Independent Contractor Agreement" },
      { kind: "platform_terms", version: "1.0.0", title: "RGXM Crew Platform Terms of Use" },
      { kind: "privacy_notice", version: "2026-11-09", title: "RGXM Crew Privacy Policy" },
    ]);
    const settings = await one<Record<string, unknown>>("select privacy_officer_email, support_email, finance_email, privacy_request_response_days, payment_terms from org_settings");
    expect(settings).toMatchObject({ privacy_officer_email: "safiya@rgxmagency.com", support_email: "staffing@rgxmagency.com", finance_email: "safiya@rgxmagency.com", privacy_request_response_days: 30 });
    expect((settings.payment_terms as { dueRule: string; approvedAt?: string }).dueRule).toBe("semi_monthly_agreement");
    expect((settings.payment_terms as { approvedAt?: string }).approvedAt).toBeUndefined();

    const platform = await one<{ id: string }>("select id from legal_documents where kind = 'platform_terms' and version = '1.0.0'");
    await onboarding.approveDocument(admin.id, platform.id, "Approved by the Privacy Officer for release");
    const who = await person();
    await onboarding.approveContractors(admin.id, [who.staffId], { approvedOn: "2026-11-01" });
    expect(await onboarding.bookingBlockers(db, who.staffId)).toEqual(["they haven't accepted the current Platform Terms of Use"]);
    // Platform terms need no contracting party.
    await onboarding.acceptDocuments(who, [platform.id], "portal_onboarding");
    expect(await onboarding.bookingBlockers(db, who.staffId)).toEqual([]);
    await pool.query("update legal_documents set status = 'retired' where id = $1", [platform.id]);
  });
});

describe("year-end review", () => {
  it("totals reconciled payments by category, excludes tax from box 048 candidates, records decisions and flags later changes", async () => {
    const who = await person();
    await pool.query("update staff_sensitive set business_number = '123456789', gst_registration_status = 'yes', gst_hst_number = '123456789RT0001', gst_registration_effective_date = '2020-01-01' where staff_id = $1", [who.staffId]);
    const pm = await makeUser();
    const lines: string[] = [];
    for (const daysAgo of [3, 4, 5]) {
      const start = new Date(Date.now() - daysAgo * 24 * 60 * MIN);
      const s = await makeShift(project, start.toISOString(), new Date(start.getTime() + 8 * 60 * MIN).toISOString());
      const b = await book(s.id, who.staffId, { agreedRateCents: 2500 });
      const rgxm = { kind: "rgxm" as const, userId: pm.id };
      await a.recordAttendance(rgxm, b.id, { type: "check_in", occurredAt: start, note: "sheet" });
      await a.recordAttendance(rgxm, b.id, { type: "check_out", occurredAt: new Date(start.getTime() + 8 * 60 * MIN), note: "sheet" });
      const t = await one<{ id: string }>("select id from timesheets where booking_id = $1", [b.id]);
      await a.approveTimesheet(pm.id, t.id);
      const p = await one<{ id: string }>("select id from payable_items where timesheet_id = $1 and status <> 'void'", [t.id]);
      // Registered but tax decided by Finance (HST ON) for this test.
      const rule = await one<{ id: string }>("select id from tax_rules where jurisdiction = 'ON' and component = 'HST' and status <> 'retired' limit 1");
      lines.push((await pay.overrideLineTax(admin.id, p.id, { reason: "Accountant confirmed 13% HST for this event", ruleIds: [rule.id] })).id);
    }
    const batch = await pay.createBatch(admin.id, { type: "contractor", payPeriodId: null, payableIds: lines });
    await pay.approveBatch(finance2.id, batch.id);
    const year = new Date().getFullYear();
    // Exported but not settled: nothing counts yet.
    await pay.exportBatch(admin.id, batch.id, "csv_generic");
    expect((await yearEnd.getYearEndReview(year)).rows.find((r) => r.staffId === who.staffId)).toBeUndefined();
    await pay.markBatchPaid(admin.id, batch.id, { paidOn: new Date().toISOString().slice(0, 10), evidence: "Statement line 77" });

    const review = await yearEnd.getYearEndReview(year);
    const row = review.rows.find((r) => r.staffId === who.staffId)!;
    expect(row).toMatchObject({ fees: 60000, tax: 7800, netPaid: 67800, box048CandidateCents: 60000, overThreshold: true, possiblyIncorporated: true, decision: null, missing: ["mailing address"] });
    // Not excluded automatically even though they have a business number.
    await expect(yearEnd.setYearEndDecision(admin.id, year, who.staffId, { decision: "exclude", reason: "" })).rejects.toThrow(/reason/);
    await yearEnd.setYearEndDecision(admin.id, year, who.staffId, { decision: "include", reason: "Accountant: unincorporated sole proprietor" });
    await expect(yearEnd.setIdentityReceived(admin.id, year, who.staffId, true, "SIN 046 454 286")).rejects.toThrow(/Don't enter a SIN/);
    await yearEnd.setIdentityReceived(admin.id, year, who.staffId, true, "Accountant has it on file");

    const snap = await yearEnd.createYearEndSnapshot(admin.id, year, "First hand-off");
    await yearEnd.setSnapshotStatus(admin.id, snap.id, "handed_off");
    await expect(pool.query("update year_end_snapshots set summary = '{}' where id = $1", [snap.id])).rejects.toThrow(/frozen/);
    expect((await yearEnd.getYearEndReview(year)).amendmentReview).toBe(false);

    // A payment is returned after the hand-off: flagged for amendment review, shown as a reversal.
    await pay.recordReturn(admin.id, { batchId: batch.id, payableId: lines[0]!, returnedOn: new Date().toISOString().slice(0, 10), reason: "Account closed", bankReference: "RTN-1" });
    const after = await yearEnd.getYearEndReview(year);
    const changed = after.rows.find((r) => r.staffId === who.staffId)!;
    expect(changed).toMatchObject({ reversals: -20000, reversedTax: -2600, box048CandidateCents: 40000, changedSinceSnapshot: true });
    expect(after.amendmentReview).toBe(true);
    const csv = await yearEnd.buildT4aCsv(admin.id, year);
    expect(csv.csv).toContain("SIN (accountant to add)");
    expect(csv.csv).not.toMatch(/046 454 286/);
  });
});

describe("privacy operations", () => {
  it("legal holds stop erasure and scheduled deletion; deletion only runs for approved periods and is reported", async () => {
    const who = await person();
    await pool.query("insert into internal_notes (staff_id, author_id, body, created_at) values ($1, $2, 'Old note', now() - interval '400 days')", [who.staffId, admin.id]);
    const other = await person();
    await pool.query("insert into internal_notes (staff_id, author_id, body, created_at) values ($1, $2, 'Old note', now() - interval '400 days')", [other.staffId, admin.id]);
    // No approved period for notes yet: nothing is deleted.
    await ops.runRetention();
    expect((await one<{ n: number }>("select count(*)::int n from internal_notes where staff_id in ($1, $2)", [who.staffId, other.staffId])).n).toBe(2);
    await expect(ops.setRetentionPolicy(admin.id, "internal_notes", { retentionDays: 365, approvalReference: "" })).rejects.toThrow(/approval/);
    await expect(ops.setRetentionPolicy(admin.id, "financial_records", { retentionDays: 10, approvalReference: "RGXM decision" })).rejects.toThrow(/aren't deleted automatically/);
    await ops.setRetentionPolicy(admin.id, "internal_notes", { retentionDays: 365, approvalReference: "RGXM privacy policy v1, approved 2026-11-25" });

    const hold = await ops.placeHold(admin.id, { staffId: who.staffId, reason: "Pending dispute with client; preserve records" });
    await expect(anonymizeStaff(admin.id, who.staffId, "Requested by email 2026-11-25")).rejects.toThrow(/legal hold/);
    await ops.runRetention();
    expect((await one<{ n: number }>("select count(*)::int n from internal_notes where staff_id = $1", [who.staffId])).n).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int n from internal_notes where staff_id = $1", [other.staffId])).n).toBe(0);
    const runs = await ops.recentRetentionRuns();
    expect(runs.find((r) => r.category === "internal_notes")).toMatchObject({ skippedHeld: 1 });
    await ops.releaseHold(admin.id, hold.id, "Dispute settled 2026-12-01");
    await ops.runRetention();
    expect((await one<{ n: number }>("select count(*)::int n from internal_notes where staff_id = $1", [who.staffId])).n).toBe(0);
    await ops.setRetentionPolicy(admin.id, "internal_notes", { retentionDays: null, approvalReference: "Reset for other tests" });
  });

  it("works access requests: deadline only when RGXM set one, identity first, every section reviewed, private package", async () => {
    const who = await person();
    await pool.query("insert into internal_notes (staff_id, author_id, body) values ($1, $2, 'Great with guests')", [who.staffId, admin.id]);
    const r = await ops.createPrivacyRequest(admin.id, { kind: "access", staffId: who.staffId, requesterName: "Ola Onboard", requesterContact: "by email", receivedAt: "2026-11-20", receivedVia: "email" });
    // RGXM's Privacy Policy states a 30-day response period (set by migration 0013).
    expect(r.dueAt?.toISOString().slice(0, 10)).toBe("2026-12-20");
    expect(r.reference).toMatch(/^PR-2026-\d{4}$/);
    await expect(ops.buildAccessPackage(admin.id, r.id)).rejects.toThrow(/identity/);
    await ops.verifyRequesterIdentity(admin.id, r.id, "Replied from the email on file and confirmed two recent shift dates");
    const pkg = await ops.buildAccessPackage(admin.id, r.id);
    const file = await ops.readAccessPackage(admin.id, r.id);
    const json = JSON.parse(file.data.toString("utf8"));
    expect(json.forReview.internalNotes[0].note).toBe("Great with guests");
    expect(pkg.sha256).toHaveLength(64);
    await expect(ops.respondToRequest(admin.id, r.id, { outcome: "responded", summary: "Package sent", method: "Secure link" })).rejects.toThrow(/Review every section/);
    for (const item of ops.REVIEW_ITEMS) await ops.updateReviewChecklist(admin.id, r.id, { item, reviewed: true });
    await ops.respondToRequest(admin.id, r.id, { outcome: "responded", summary: "Package released after review; no redactions needed", method: "Secure download link, expired after 7 days" });
    await expect(ops.verifyRequesterIdentity(admin.id, r.id, "again please")).rejects.toThrow(/responded/);

    // With no configured response period, there's no deadline.
    await pool.query("update org_settings set privacy_request_response_days = null");
    const r2 = await ops.createPrivacyRequest(admin.id, { kind: "correction", staffId: who.staffId, requesterName: "Ola Onboard", receivedAt: "2026-11-20" });
    expect(r2.dueAt).toBeNull();
    await pool.query("update org_settings set privacy_request_response_days = 30");
  });
});

describe("incidents", () => {
  it("need a risk assessment and remediation before closing", async () => {
    const inc = await incidents.reportIncident(admin.id, { title: "Laptop left in a taxi", category: "lost_or_stolen_device", detectedAt: "2026-11-21T09:30", description: "Encrypted laptop with Crew session left in a taxi; recovered next day." });
    expect(inc.reference).toMatch(/^INC-2026-\d{3}$/);
    const base = { affectedPeopleEstimate: null, dataCategories: [], containment: "Remote sign-out of all sessions", riskAssessment: "undetermined" as const, riskRationale: null, commissionerNotifiedAt: null, individualsNotifiedAt: null, otherNotifications: null, remediation: null };
    await expect(incidents.updateIncident(admin.id, inc.id, { ...base, status: "closed" })).rejects.toThrow(/risk assessment/);
    await expect(incidents.updateIncident(admin.id, inc.id, { ...base, riskAssessment: "no_real_risk", status: "contained" })).rejects.toThrow(/reasoning/);
    await incidents.updateIncident(admin.id, inc.id, { ...base, riskAssessment: "no_real_risk", riskRationale: "Disk encrypted; sessions revoked within the hour", remediation: "Reminder about device handling", status: "closed" });
    expect((await incidents.getIncident(inc.id))?.status).toBe("closed");
  });
});

describe("security", () => {
  it("expires step-up authentication after a few minutes", async () => {
    const u = await makeUser();
    const sessionId = crypto.randomUUID();
    expect(await hasFreshStepUp(sessionId)).toBe(false);
    await recordStepUp(sessionId, u.id);
    expect(await hasFreshStepUp(sessionId)).toBe(true);
    expect(await hasFreshStepUp(sessionId, new Date(Date.now() + STEP_UP_MAX_AGE_MS + 1000))).toBe(false);
  });

  it("revokes remembered devices when an internal user signs in from a new network/browser", async () => {
    const u = await makeUser();
    const email = (await one<{ email: string }>("select email from users where id = $1", [u.id])).email;
    await pool.query("insert into verifications (identifier, value, expires_at) values ($1, $2, now() + interval '10 days')", [`trust-device-${crypto.randomUUID()}`, u.id]);
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
    await rememberSignInContext(u.id, "203.0.113.10", ua);
    expect((await screenSignIn(email, "203.0.113.99", ua)).suspicious).toBe(false); // same /24 and browser
    expect((await one<{ n: number }>("select count(*)::int n from verifications where value = $1 and identifier like 'trust-device-%'", [u.id])).n).toBe(1);
    expect((await screenSignIn(email, "198.51.100.7", ua)).suspicious).toBe(true);
    expect((await one<{ n: number }>("select count(*)::int n from verifications where value = $1 and identifier like 'trust-device-%'", [u.id])).n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int n from known_sign_in_contexts where user_id = $1 and fingerprint like '203.%'", [u.id])).n).toBe(0); // hashed, not raw
  });

  it("keeps personal details out of audit entries", async () => {
    expect(minimizePersonalData({ email: "a@b.c", nested: [{ legalName: "X", ok: 1 }], count: 2 })).toEqual({ email: "[redacted]", nested: [{ legalName: "[redacted]", ok: 1 }], count: 2 });
    await recordAudit({ actorId: admin.id, action: "test.minimize", entityType: "test", entityId: "t1", after: { phone: "416-555-0100", status: "x" } });
    const row = await one<{ after: Record<string, unknown> }>("select after from audit_log where action = 'test.minimize' order by id desc limit 1");
    expect(row.after).toEqual({ phone: "[redacted]", status: "x" });
  });

  it("keeps tax configuration approvals on record", async () => {
    await expect(taxConfig.approveServiceCategory(admin.id, "load_in_setup", "")).rejects.toThrow();
  });
});
