// Contractor onboarding records, each kept separately with its own history:
//  - RGXM's approval of the person for the contractor process (approver, date, optional reference
//    to the assessment done outside Crew). Required before a booking can be confirmed.
//  - Privacy notice acknowledgement and contractor agreement / platform terms acceptance, against
//    versioned documents that RGXM's lawyer approved. Append-only.
//  - Optional consent choices (grant/withdraw history), for purposes RGXM has approved.
//  - Status evidence (WSIB, business registration, insurance), optional.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import {
  CONTRACTOR_EVIDENCE_KINDS,
  consentPurposes,
  contractorApprovals,
  contractorEvidence,
  legalDocuments,
  orgSettings,
  staffAcceptances,
  staffConsentEvents,
  staffEmailPreferences,
  staffProfiles,
} from "@/server/db/schema";
import { invoicePendingLines } from "./invoices";

export class OnboardingError extends Error {}

export type LegalKind = "privacy_notice" | "contractor_terms" | "platform_terms";
export const LEGAL_KINDS: LegalKind[] = ["privacy_notice", "contractor_terms", "platform_terms"];
export const LEGAL_KIND_LABEL: Record<LegalKind, string> = {
  privacy_notice: "Privacy Policy",
  contractor_terms: "Independent Contractor Agreement",
  platform_terms: "Platform Terms of Use",
};
/** Public page for each document. */
export const LEGAL_KIND_PATH: Record<LegalKind, string> = { privacy_notice: "/privacy", contractor_terms: "/contractor-agreement", platform_terms: "/terms" };
/** What the contractor ticks for each document (the Terms require this exact wording). */
export const LEGAL_KIND_ACCEPT: Record<LegalKind, string> = {
  privacy_notice: "I've read the RGXM Crew Privacy Policy",
  contractor_terms: "I accept the RGXM Independent Contractor Agreement",
  platform_terms: "I agree to the Platform Terms of Use",
};

/** The tick-box wording, made explicit when the agreement includes the self-billing clause. */
export function acceptLabel(doc: { kind: string; selfBilling?: boolean }) {
  if (doc.kind === "contractor_terms" && doc.selfBilling) return "I accept the RGXM Independent Contractor Agreement, including section 7: RGXM prepares and issues invoices on my behalf through Crew";
  return LEGAL_KIND_ACCEPT[doc.kind as LegalKind];
}

/** Who the contractor agreement is with: the person themselves, or a business they're authorized to bind. */
export type ContractingParty = { actingFor: "self"; legalName: string } | { actingFor: "business"; businessName: string; representative: string };

export function normalizeParty(raw: { actingFor?: unknown; legalName?: unknown; businessName?: unknown; representative?: unknown }): ContractingParty {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (raw.actingFor === "business") {
    const businessName = str(raw.businessName);
    const representative = str(raw.representative);
    if (businessName.length < 2) throw new OnboardingError("Enter the business's legal name.");
    if (representative.length < 2) throw new OnboardingError("Enter your full name as the person authorized to accept for the business.");
    return { actingFor: "business", businessName: businessName.slice(0, 160), representative: representative.slice(0, 160) };
  }
  const legalName = str(raw.legalName);
  if (legalName.length < 2) throw new OnboardingError("Enter your full legal name for the agreement.");
  return { actingFor: "self", legalName: legalName.slice(0, 160) };
}

// ─── Legal documents ─────────────────────────────────────────────────────────────

export async function currentDocuments() {
  const rows = await db.select().from(legalDocuments).where(eq(legalDocuments.status, "approved"));
  const find = (k: LegalKind) => rows.find((r) => r.kind === k) ?? null;
  return { privacy_notice: find("privacy_notice"), contractor_terms: find("contractor_terms"), platform_terms: find("platform_terms") };
}

export async function listDocuments() {
  return db.select().from(legalDocuments).orderBy(legalDocuments.kind, desc(legalDocuments.createdAt));
}

const draftSchema = z.object({
  kind: z.enum(["privacy_notice", "contractor_terms", "platform_terms"]),
  version: z.string().trim().regex(/^[0-9A-Za-z.\-]{1,20}$/, "Use a short version like 1.0 or 2026-11"),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(50, "Paste the full approved text").max(100_000),
  summaryOfChanges: z.string().trim().max(500).optional().nullable(),
  selfBilling: z.boolean().default(false),
});

export async function saveDraftDocument(actorId: string, raw: z.input<typeof draftSchema>, documentId?: string) {
  const v = draftSchema.parse(raw);
  return db.transaction(async (tx) => {
    if (documentId) {
      const [d] = await tx.select().from(legalDocuments).where(eq(legalDocuments.id, documentId)).for("update");
      if (!d || d.status !== "draft") throw new OnboardingError("Only drafts can be edited.");
      await tx.update(legalDocuments).set({ ...v, selfBilling: v.kind === "contractor_terms" && v.selfBilling, summaryOfChanges: v.summaryOfChanges ?? null }).where(eq(legalDocuments.id, documentId));
      await recordAudit({ actorId, action: "legal.draft_update", entityType: "legal_document", entityId: documentId, after: { kind: v.kind, version: v.version } }, tx);
      return documentId;
    }
    const [d] = await tx.insert(legalDocuments).values({ ...v, selfBilling: v.kind === "contractor_terms" && v.selfBilling, summaryOfChanges: v.summaryOfChanges ?? null, createdBy: actorId }).returning();
    await recordAudit({ actorId, action: "legal.draft_create", entityType: "legal_document", entityId: d!.id, after: { kind: v.kind, version: v.version } }, tx);
    return d!.id;
  });
}

/**
 * Publishes a draft as the current version once legal review is recorded. The previous version is
 * retired; contractors are asked to accept the new one at their next visit.
 */
export async function approveDocument(actorId: string, documentId: string, approvalReference: string) {
  if (approvalReference.trim().length < 5) throw new OnboardingError("Record the legal review (who reviewed it and when).");
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(legalDocuments).where(eq(legalDocuments.id, documentId)).for("update");
    if (!d || d.status !== "draft") throw new OnboardingError("Only drafts can be approved.");
    await tx.update(legalDocuments).set({ status: "retired" }).where(and(eq(legalDocuments.kind, d.kind), eq(legalDocuments.status, "approved")));
    const now = new Date();
    await tx.update(legalDocuments).set({ status: "approved", approvedBy: actorId, approvedAt: now, effectiveAt: now, approvalReference: approvalReference.trim() }).where(eq(legalDocuments.id, documentId));
    await recordAudit({ actorId, action: "legal.approve", entityType: "legal_document", entityId: documentId, after: { kind: d.kind, version: d.version }, reason: approvalReference.trim() }, tx);
  });
}

export async function deleteDraftDocument(actorId: string, documentId: string) {
  await db.transaction(async (tx) => {
    const [d] = await tx.delete(legalDocuments).where(and(eq(legalDocuments.id, documentId), eq(legalDocuments.status, "draft"))).returning();
    if (!d) throw new OnboardingError("Only drafts can be deleted.");
    await recordAudit({ actorId, action: "legal.draft_delete", entityType: "legal_document", entityId: documentId, after: { kind: d.kind, version: d.version } }, tx);
  });
}

// ─── Acceptances ─────────────────────────────────────────────────────────────────

/** Which current documents the contractor still needs to acknowledge/accept. */
export async function pendingAcceptances(staffId: string) {
  const docs = await currentDocuments();
  const current = LEGAL_KINDS.map((k) => docs[k]).filter((d): d is NonNullable<typeof d> => Boolean(d));
  if (!current.length) return [];
  const accepted = await db.select({ documentId: staffAcceptances.documentId }).from(staffAcceptances).where(and(eq(staffAcceptances.staffId, staffId), inArray(staffAcceptances.documentId, current.map((d) => d.id))));
  return current.filter((d) => !accepted.some((a) => a.documentId === d.id));
}

/** Records acceptance of the given current documents (each document id must be the live version). */
export async function acceptDocuments(user: { userId: string; staffId: string }, documentIds: string[], method: "portal_onboarding" | "portal_update", party?: ContractingParty) {
  if (!documentIds.length) return;
  await db.transaction(async (tx) => {
    const docs = await tx.select().from(legalDocuments).where(and(inArray(legalDocuments.id, documentIds), eq(legalDocuments.status, "approved")));
    if (docs.length !== new Set(documentIds).size) throw new OnboardingError("A newer version was just published. Please review it and try again.");
    // The contractor agreement records who it is with (the person, or a business and its representative).
    if (docs.some((d) => d.kind === "contractor_terms") && !party) throw new OnboardingError("Tell us who is entering the contractor agreement.");
    const partyFields = (kind: string) =>
      kind !== "contractor_terms" || !party
        ? {}
        : party.actingFor === "self"
          ? { actingFor: "self", contractingParty: party.legalName, authorizedRepresentative: null }
          : { actingFor: "business", contractingParty: party.businessName, authorizedRepresentative: party.representative };
    await tx
      .insert(staffAcceptances)
      .values(docs.map((d) => ({ staffId: user.staffId, documentId: d.id, kind: d.kind, version: d.version, userId: user.userId, method, ...partyFields(d.kind) })))
      .onConflictDoNothing();
    await recordAudit({ actorId: user.userId, action: "legal.accept", entityType: "staff", entityId: user.staffId, after: docs.map((d) => ({ kind: d.kind, version: d.version })) }, tx);
    return docs.some((d) => d.selfBilling);
  }).then(async (selfBilling) => {
    // Approved work from before they accepted the self-billing clause gets its invoice now.
    if (selfBilling) await invoicePendingLines(user.staffId, user.userId);
  });
}

/** One accepted document exactly as it was presented, with the acceptance record (the contractor's own copy). */
export async function acceptedCopy(staffId: string, acceptanceId: string) {
  const [row] = await db
    .select({ a: staffAcceptances, d: legalDocuments })
    .from(staffAcceptances)
    .innerJoin(legalDocuments, eq(legalDocuments.id, staffAcceptances.documentId))
    .where(and(eq(staffAcceptances.id, acceptanceId), eq(staffAcceptances.staffId, staffId)));
  return row ?? null;
}

export async function acceptanceHistory(staffId: string) {
  return db.select().from(staffAcceptances).where(eq(staffAcceptances.staffId, staffId)).orderBy(desc(staffAcceptances.acceptedAt));
}

// ─── Optional consents ───────────────────────────────────────────────────────────

/** Approved, active consent purposes offered to contractors. */
export async function offeredConsentPurposes() {
  return db.select().from(consentPurposes).where(and(eq(consentPurposes.active, true), sql`${consentPurposes.approvedAt} is not null`));
}

export async function listConsentPurposes() {
  return db.select().from(consentPurposes).orderBy(consentPurposes.key);
}

/** The latest choice per purpose (no row = never asked/answered = not granted). */
export async function currentConsents(staffId: string) {
  const rows = await db.select().from(staffConsentEvents).where(eq(staffConsentEvents.staffId, staffId)).orderBy(desc(staffConsentEvents.recordedAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.purposeKey)) latest.set(r.purposeKey, r);
  return latest;
}

export async function hasConsent(tx: Tx | typeof db, staffId: string, purposeKey: string) {
  const [row] = await tx.select({ granted: staffConsentEvents.granted }).from(staffConsentEvents).where(and(eq(staffConsentEvents.staffId, staffId), eq(staffConsentEvents.purposeKey, purposeKey))).orderBy(desc(staffConsentEvents.recordedAt)).limit(1);
  return row?.granted ?? false;
}

/** Records the contractor's choices; only changes are written (history is append-only). */
export async function setConsents(user: { userId: string; staffId: string }, choices: Record<string, boolean>, method: string) {
  const offered = await offeredConsentPurposes();
  const current = await currentConsents(user.staffId);
  const changes = offered.filter((p) => p.key in choices && (current.get(p.key)?.granted ?? null) !== choices[p.key]);
  if (!changes.length) return 0;
  await db.transaction(async (tx) => {
    await tx.insert(staffConsentEvents).values(changes.map((p) => ({ staffId: user.staffId, purposeKey: p.key, purposeVersion: p.version, granted: choices[p.key]!, userId: user.userId, method })));
    await recordAudit({ actorId: user.userId, action: "consent.update", entityType: "staff", entityId: user.staffId, after: Object.fromEntries(changes.map((p) => [p.key, choices[p.key]])) }, tx);
  });
  return changes.length;
}

const purposeSchema = z.object({ key: z.string().regex(/^[a-z_]{3,40}$/), label: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(600) });

/** Edits a purpose's wording (bumps its version and clears approval until legal re-approves). */
export async function saveConsentPurpose(actorId: string, raw: z.input<typeof purposeSchema>) {
  const v = purposeSchema.parse(raw);
  await db.transaction(async (tx) => {
    await tx
      .insert(consentPurposes)
      .values({ ...v, active: false })
      .onConflictDoUpdate({ target: consentPurposes.key, set: { label: v.label, description: v.description, version: sql`${consentPurposes.version} + 1`, approvedAt: null, approvedBy: null, approvalReference: null, active: false } });
    await recordAudit({ actorId, action: "consent.purpose_save", entityType: "consent_purpose", entityId: v.key, after: { label: v.label } }, tx);
  });
}

export async function approveConsentPurpose(actorId: string, key: string, reference: string, active: boolean) {
  if (active && reference.trim().length < 5) throw new OnboardingError("Record the legal review of this wording.");
  await db.transaction(async (tx) => {
    const [p] = await tx
      .update(consentPurposes)
      .set(active ? { active: true, approvedBy: actorId, approvedAt: new Date(), approvalReference: reference.trim() } : { active: false })
      .where(eq(consentPurposes.key, key))
      .returning();
    if (!p) throw new OnboardingError("Purpose not found.");
    await recordAudit({ actorId, action: active ? "consent.purpose_approve" : "consent.purpose_deactivate", entityType: "consent_purpose", entityId: key, reason: reference.trim() || null }, tx);
  });
}

// ─── Email preferences ───────────────────────────────────────────────────────────

export async function getEmailPreferences(staffId: string) {
  const [row] = await db.select().from(staffEmailPreferences).where(eq(staffEmailPreferences.staffId, staffId));
  return { shiftOpportunityEmails: row?.shiftOpportunityEmails ?? true };
}

export async function setEmailPreferences(user: { userId: string; staffId: string }, prefs: { shiftOpportunityEmails: boolean }) {
  await db.transaction(async (tx) => {
    await tx.insert(staffEmailPreferences).values({ staffId: user.staffId, ...prefs }).onConflictDoUpdate({ target: staffEmailPreferences.staffId, set: prefs });
    await recordAudit({ actorId: user.userId, action: "email_prefs.update", entityType: "staff", entityId: user.staffId, after: prefs }, tx);
  });
}

// ─── Contractor approval ─────────────────────────────────────────────────────────

const approvalSchema = z.object({
  approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the approval date"),
  assessmentReference: z.preprocess((v) => (typeof v === "string" && !v.trim() ? null : v), z.string().trim().max(300).nullable().optional()),
  notes: z.preprocess((v) => (typeof v === "string" && !v.trim() ? null : v), z.string().trim().max(1000).nullable().optional()),
});

/** Records RGXM's approval for the contractor process for one or more people. */
export async function approveContractors(actorId: string, staffIds: string[], raw: z.input<typeof approvalSchema>) {
  const v = approvalSchema.parse(raw);
  if (v.approvedOn > new Date().toISOString().slice(0, 10)) throw new OnboardingError("The approval date can't be in the future.");
  const ids = [...new Set(staffIds)];
  if (!ids.length) throw new OnboardingError("Choose at least one person.");
  return db.transaction(async (tx) => {
    const existing = await tx.select({ staffId: contractorApprovals.staffId }).from(contractorApprovals).where(and(inArray(contractorApprovals.staffId, ids), isNull(contractorApprovals.revokedAt)));
    const people = await tx.select({ id: staffProfiles.id, isDemo: staffProfiles.isDemo, anonymizedAt: staffProfiles.anonymizedAt }).from(staffProfiles).where(inArray(staffProfiles.id, ids));
    const todo = people.filter((p) => !p.anonymizedAt && !existing.some((e) => e.staffId === p.id)).map((p) => p.id);
    if (todo.length) {
      await tx.insert(contractorApprovals).values(todo.map((staffId) => ({ staffId, approvedBy: actorId, approvedOn: v.approvedOn, assessmentReference: v.assessmentReference ?? null, notes: v.notes ?? null })));
      await recordAudit({ actorId, action: "contractor.approve", entityType: "staff", after: { staffIds: todo, approvedOn: v.approvedOn, hasAssessmentReference: Boolean(v.assessmentReference) } }, tx);
    }
    return { approved: todo.length, alreadyApproved: existing.length };
  });
}

export async function revokeContractorApproval(actorId: string, staffId: string, reason: string) {
  if (reason.trim().length < 5) throw new OnboardingError("Give a reason.");
  await db.transaction(async (tx) => {
    const [row] = await tx.update(contractorApprovals).set({ revokedAt: new Date(), revokedBy: actorId, revokeReason: reason.trim() }).where(and(eq(contractorApprovals.staffId, staffId), isNull(contractorApprovals.revokedAt))).returning();
    if (!row) throw new OnboardingError("No current approval to revoke.");
    await recordAudit({ actorId, action: "contractor.revoke", entityType: "staff", entityId: staffId, reason: reason.trim() }, tx);
  });
}

export async function contractorApprovalHistory(staffId: string) {
  return db.select().from(contractorApprovals).where(eq(contractorApprovals.staffId, staffId)).orderBy(desc(contractorApprovals.createdAt));
}

/**
 * Why this person can't be booked yet (empty = ready): RGXM's contractor approval, and acceptance
 * of the current privacy notice and contractor terms once approved versions exist.
 */
export async function bookingBlockers(tx: Tx | typeof db, staffId: string): Promise<string[]> {
  const [settings] = await tx.select({ requireApproval: orgSettings.requireContractorApproval }).from(orgSettings).where(eq(orgSettings.id, 1));
  const blockers: string[] = [];
  if (settings?.requireApproval ?? true) {
    const [approval] = await tx.select({ id: contractorApprovals.id }).from(contractorApprovals).where(and(eq(contractorApprovals.staffId, staffId), isNull(contractorApprovals.revokedAt)));
    if (!approval) blockers.push("RGXM hasn't recorded their approval for the contractor process");
  }
  const docs = await tx.select({ id: legalDocuments.id, kind: legalDocuments.kind }).from(legalDocuments).where(eq(legalDocuments.status, "approved"));
  if (docs.length) {
    const accepted = await tx.select({ documentId: staffAcceptances.documentId }).from(staffAcceptances).where(and(eq(staffAcceptances.staffId, staffId), inArray(staffAcceptances.documentId, docs.map((d) => d.id))));
    for (const d of docs) if (!accepted.some((a) => a.documentId === d.id)) blockers.push(`they haven't accepted the current ${LEGAL_KIND_LABEL[d.kind as LegalKind]}`);
  }
  return blockers;
}

// ─── Status evidence ─────────────────────────────────────────────────────────────

const evidenceSchema = z.object({
  kind: z.enum(CONTRACTOR_EVIDENCE_KINDS),
  reference: z.string().trim().max(200).optional().nullable(),
  issuedOn: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  expiresOn: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  notes: z.string().trim().max(500).optional().nullable(),
  verified: z.boolean().default(false),
});

export const EVIDENCE_LABEL: Record<(typeof CONTRACTOR_EVIDENCE_KINDS)[number], string> = {
  wsib_clearance: "WSIB clearance certificate",
  wsib_coverage_not_required: "WSIB: confirmation coverage isn't required",
  independent_operator: "Independent operator status",
  business_registration: "Business registration",
  insurance: "Insurance certificate",
  other: "Other",
};

export async function addEvidence(actorId: string, staffId: string, raw: z.input<typeof evidenceSchema>) {
  const v = evidenceSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contractorEvidence)
      .values({ staffId, kind: v.kind, reference: v.reference ?? null, issuedOn: v.issuedOn ?? null, expiresOn: v.expiresOn ?? null, notes: v.notes ?? null, createdBy: actorId, ...(v.verified ? { verifiedBy: actorId, verifiedAt: new Date() } : {}) })
      .returning();
    await recordAudit({ actorId, action: "contractor.evidence_add", entityType: "staff", entityId: staffId, after: { kind: v.kind, verified: v.verified } }, tx);
    return row!;
  });
}

export async function removeEvidence(actorId: string, evidenceId: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx.update(contractorEvidence).set({ removedAt: new Date(), removedBy: actorId }).where(and(eq(contractorEvidence.id, evidenceId), isNull(contractorEvidence.removedAt))).returning();
    if (!row) throw new OnboardingError("Evidence not found.");
    await recordAudit({ actorId, action: "contractor.evidence_remove", entityType: "staff", entityId: row.staffId, after: { kind: row.kind } }, tx);
  });
}

export async function listEvidence(staffId: string) {
  return db.select().from(contractorEvidence).where(and(eq(contractorEvidence.staffId, staffId), isNull(contractorEvidence.removedAt))).orderBy(desc(contractorEvidence.createdAt));
}

/** Everything the talent profile shows about onboarding. */
export async function onboardingSummary(staffId: string) {
  const [approvals, acceptances, consents, purposes, evidence, blockers] = await Promise.all([
    contractorApprovalHistory(staffId),
    acceptanceHistory(staffId),
    currentConsents(staffId),
    listConsentPurposes(),
    listEvidence(staffId),
    bookingBlockers(db, staffId),
  ]);
  return {
    currentApproval: approvals.find((a) => !a.revokedAt) ?? null,
    approvals,
    acceptances,
    consents: purposes.map((p) => ({ key: p.key, label: p.label, offered: p.active && Boolean(p.approvedAt), granted: consents.get(p.key)?.granted ?? null, at: consents.get(p.key)?.recordedAt ?? null })),
    evidence,
    blockers,
  };
}
