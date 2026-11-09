// Privacy operations run by the Privacy Officer:
//  - retention policies per record category, scheduled deletion and deletion reports
//  - legal holds that pause deletion and erasure for a person or project
//  - access, correction and deletion requests with deadlines (RGXM's configured period),
//    identity verification, a review/redaction checklist and a stored, private response package.
// Periods and deadlines come from RGXM; nothing here assumes a statutory number.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import {
  attendanceEvents,
  auditLog,
  evaluations,
  internalNotes,
  legalHolds,
  messages,
  notificationDeliveries,
  orgSettings,
  PRIVACY_REQUEST_KINDS,
  privacyRequests,
  retentionPolicies,
  retentionRuns,
  sessions,
  staffFiles,
  staffProfiles,
  verifications,
} from "@/server/db/schema";
import { storage } from "@/server/storage";
import { anonymizeStaff, exportStaffData } from "./privacy";

export class PrivacyOpsError extends Error {}

const DAY = 86_400_000;

// ─── Legal holds ────────────────────────────────────────────────────────────────

export async function placeHold(actorId: string, input: { staffId?: string | null; projectId?: string | null; reason: string }) {
  if (input.reason.trim().length < 5) throw new PrivacyOpsError("Record why the hold is needed.");
  if (Boolean(input.staffId) === Boolean(input.projectId)) throw new PrivacyOpsError("A hold covers one person or one project.");
  return db.transaction(async (tx) => {
    const [h] = await tx.insert(legalHolds).values({ staffId: input.staffId ?? null, projectId: input.projectId ?? null, reason: input.reason.trim(), placedBy: actorId }).returning();
    await recordAudit({ actorId, action: "legal_hold.place", entityType: input.staffId ? "staff" : "project", entityId: input.staffId ?? input.projectId!, reason: input.reason.trim() }, tx);
    return h!;
  });
}

export async function releaseHold(actorId: string, holdId: string, reason: string) {
  if (reason.trim().length < 5) throw new PrivacyOpsError("Record why the hold is released.");
  await db.transaction(async (tx) => {
    const [h] = await tx.update(legalHolds).set({ releasedAt: new Date(), releasedBy: actorId, releaseReason: reason.trim() }).where(and(eq(legalHolds.id, holdId), isNull(legalHolds.releasedAt))).returning();
    if (!h) throw new PrivacyOpsError("Hold not found or already released.");
    await recordAudit({ actorId, action: "legal_hold.release", entityType: h.staffId ? "staff" : "project", entityId: h.staffId ?? h.projectId!, reason: reason.trim() }, tx);
  });
}

export async function activeHolds(tx: Tx | typeof db = db) {
  return tx.select().from(legalHolds).where(isNull(legalHolds.releasedAt));
}

/** True when the person, or any project they worked on, is under an active legal hold. */
export async function isStaffHeld(tx: Tx | typeof db, staffId: string) {
  const { rows } = await tx.execute<{ held: boolean }>(sql`
    select exists (
      select 1 from legal_holds h where h.released_at is null and (h.staff_id = ${staffId}
        or h.project_id in (select b.project_id from bookings b where b.staff_id = ${staffId}))
    ) as held`);
  return Boolean(rows[0]?.held);
}

// ─── Retention policies ─────────────────────────────────────────────────────────

export async function listRetentionPolicies() {
  return db.select().from(retentionPolicies).orderBy(retentionPolicies.category);
}

/** Sets a category's period (null = keep until RGXM decides). Recording the RGXM approval is required. */
export async function setRetentionPolicy(actorId: string, category: string, input: { retentionDays: number | null; approvalReference: string }) {
  if (input.retentionDays != null && (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 36500)) throw new PrivacyOpsError("Enter a number of days between 1 and 36500, or leave it blank.");
  if (input.approvalReference.trim().length < 5) throw new PrivacyOpsError("Record RGXM's approval of this period (who and when).");
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(retentionPolicies).where(eq(retentionPolicies.category, category)).for("update");
    if (!p) throw new PrivacyOpsError("Unknown category.");
    if (["not_deletable", "restricted_archive"].includes(p.action) && input.retentionDays != null) throw new PrivacyOpsError("Records in this category aren't deleted automatically.");
    if (category === "expired_sessions") throw new PrivacyOpsError("Expired sessions are always removed.");
    await tx.update(retentionPolicies).set({ retentionDays: input.retentionDays, approvalReference: input.approvalReference.trim(), approvedBy: actorId, approvedAt: new Date(), updatedBy: actorId }).where(eq(retentionPolicies.category, category));
    // Keep the older settings columns in step for screens that still show them.
    if (category === "check_in_location" && input.retentionDays) await tx.update(orgSettings).set({ locationRetentionDays: Math.max(7, input.retentionDays) }).where(eq(orgSettings.id, 1));
    if (category === "email_copies" && input.retentionDays) await tx.update(orgSettings).set({ mailLogRetentionDays: input.retentionDays }).where(eq(orgSettings.id, 1));
    await recordAudit({ actorId, action: "retention.policy", entityType: "retention_policy", entityId: category, before: { retentionDays: p.retentionDays }, after: { retentionDays: input.retentionDays }, reason: input.approvalReference.trim() }, tx);
  });
}

async function logRun(category: string, affected: number, skippedHeld = 0, detail: Record<string, unknown> = {}) {
  if (affected || skippedHeld) await db.insert(retentionRuns).values({ category, affected, skippedHeld, detail });
}

/**
 * Runs every policy with a set period. The two that existed before this register (check-in
 * locations, email copies) keep running with their configured period; new categories only run
 * once RGXM has approved a period. Legal holds are skipped and counted.
 */
export async function runRetention(now = new Date()) {
  const policies = await listRetentionPolicies();
  const holds = await activeHolds();
  const heldStaff = holds.filter((h) => h.staffId).map((h) => h.staffId!);
  const heldProjects = holds.filter((h) => h.projectId).map((h) => h.projectId!);
  const result: Record<string, number> = {};
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY);
  const runs = (category: string) => {
    const p = policies.find((x) => x.category === category);
    if (!p || p.retentionDays == null) return null;
    if (!["check_in_location", "email_copies"].includes(category) && !p.approvedAt) return null;
    return p.retentionDays;
  };
  const notHeldBooking = sql`${attendanceEvents.bookingId} not in (select b.id from bookings b where ${heldStaff.length ? sql`b.staff_id in ${heldStaff}` : sql`false`} or ${heldProjects.length ? sql`b.project_id in ${heldProjects}` : sql`false`})`;

  const loc = runs("check_in_location");
  if (loc != null) {
    const rows = await db
      .update(attendanceEvents)
      .set({ latitude: null, longitude: null, accuracyMeters: null })
      .where(and(lt(attendanceEvents.occurredAt, cutoff(loc)), or(isNotNull(attendanceEvents.latitude), isNotNull(attendanceEvents.longitude), isNotNull(attendanceEvents.accuracyMeters)), notHeldBooking))
      .returning({ id: attendanceEvents.id });
    result.locations = rows.length;
    await logRun("check_in_location", rows.length);
  }
  const mail = runs("email_copies");
  if (mail != null) {
    const rows = await db
      .update(notificationDeliveries)
      .set({ bodyText: null, bodyHtml: null })
      .where(and(lt(notificationDeliveries.createdAt, cutoff(mail)), or(isNotNull(notificationDeliveries.bodyText), isNotNull(notificationDeliveries.bodyHtml))))
      .returning({ id: notificationDeliveries.id });
    result.mailBodies = rows.length;
    await logRun("email_copies", rows.length);
  }
  const expiredSessions = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  const expiredTokens = await db.delete(verifications).where(lt(verifications.expiresAt, now)).returning({ id: verifications.id });
  result.sessions = expiredSessions.length;
  result.tokens = expiredTokens.length;
  await logRun("expired_sessions", expiredSessions.length + expiredTokens.length);

  const staffNotHeld = (col: unknown) => (heldStaff.length ? sql`${col} not in ${heldStaff}` : sql`true`);
  const notes = runs("internal_notes");
  if (notes != null) {
    const held = heldStaff.length ? (await db.select({ id: internalNotes.id }).from(internalNotes).where(and(lt(internalNotes.createdAt, cutoff(notes)), inArray(internalNotes.staffId, heldStaff)))).length : 0;
    const rows = await db.delete(internalNotes).where(and(lt(internalNotes.createdAt, cutoff(notes)), staffNotHeld(internalNotes.staffId))).returning({ id: internalNotes.id });
    result.internalNotes = rows.length;
    await logRun("internal_notes", rows.length, held);
  }
  const evals = runs("evaluations");
  if (evals != null) {
    const projectFree = heldProjects.length ? sql`${evaluations.projectId} not in ${heldProjects}` : sql`true`;
    const rows = await db.delete(evaluations).where(and(lt(evaluations.createdAt, cutoff(evals)), staffNotHeld(evaluations.staffId), projectFree)).returning({ id: evaluations.id });
    result.evaluations = rows.length;
    await logRun("evaluations", rows.length);
  }
  const msgs = runs("messages");
  if (msgs != null) {
    const threadFree = sql`${messages.threadId} not in (select t.id from message_threads t where ${heldStaff.length ? sql`t.staff_id in ${heldStaff}` : sql`false`} or ${heldProjects.length ? sql`t.project_id in ${heldProjects}` : sql`false`})`;
    const rows = await db.delete(messages).where(and(lt(messages.createdAt, cutoff(msgs)), threadFree)).returning({ id: messages.id });
    result.messages = rows.length;
    await logRun("messages", rows.length);
  }
  const files = runs("staff_files");
  if (files != null) {
    const rows = await db.delete(staffFiles).where(and(lt(staffFiles.createdAt, cutoff(files)), staffNotHeld(staffFiles.staffId))).returning({ key: staffFiles.storageKey });
    for (const r of rows) await storage().remove(r.key).catch(() => undefined);
    result.staffFiles = rows.length;
    await logRun("staff_files", rows.length);
  }
  const inactive = runs("inactive_profiles");
  if (inactive != null) {
    // Inactive/archived profiles with no shift or pay activity since the cutoff.
    const { rows } = await db.execute<{ id: string }>(sql`
      select sp.id from staff_profiles sp
      where sp.status in ('inactive', 'archived') and sp.anonymized_at is null and not sp.is_demo and sp.updated_at < ${cutoff(inactive)}
        and not exists (select 1 from bookings b where b.staff_id = sp.id and b.ends_at >= ${cutoff(inactive)})
        and not exists (select 1 from payable_items p where p.staff_id = sp.id and p.status in ('pending', 'batched', 'exported', 'failed'))
      limit 100`);
    let done = 0;
    let skipped = 0;
    for (const r of rows) {
      if (await isStaffHeld(db, r.id)) {
        skipped++;
        continue;
      }
      try {
        await anonymizeStaff(null, r.id, `Retention policy: inactive for ${inactive} days`);
        done++;
      } catch {
        skipped++;
      }
    }
    result.anonymized = done;
    await logRun("inactive_profiles", done, skipped);
  }
  return result;
}

export async function recentRetentionRuns(limit = 50) {
  return db.select().from(retentionRuns).orderBy(desc(retentionRuns.ranAt)).limit(limit);
}

// ─── Privacy requests ───────────────────────────────────────────────────────────

const requestSchema = z.object({
  kind: z.enum(PRIVACY_REQUEST_KINDS),
  staffId: z.string().uuid().nullable(),
  requesterName: z.string().trim().min(2).max(160),
  requesterContact: z.string().trim().max(200).optional().nullable(),
  receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receivedVia: z.string().trim().max(80).optional().nullable(),
  details: z.string().trim().max(2000).optional().nullable(),
});

export async function createPrivacyRequest(actorId: string, raw: z.input<typeof requestSchema>) {
  const v = requestSchema.parse(raw);
  const [settings] = await db.select({ days: orgSettings.privacyRequestResponseDays }).from(orgSettings).where(eq(orgSettings.id, 1));
  const received = new Date(`${v.receivedAt}T12:00:00Z`);
  const dueAt = settings?.days ? new Date(received.getTime() + settings.days * DAY) : null;
  return db.transaction(async (tx) => {
    const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('privacy_request_seq')::text as n`)).rows as [{ n: string }];
    const [row] = await tx
      .insert(privacyRequests)
      .values({ reference: `PR-${v.receivedAt.slice(0, 4)}-${n.padStart(4, "0")}`, kind: v.kind, staffId: v.staffId, requesterName: v.requesterName, requesterContact: v.requesterContact ?? null, receivedAt: received, receivedVia: v.receivedVia ?? null, details: v.details ?? null, dueAt, createdBy: actorId, assignedTo: actorId })
      .returning();
    await recordAudit({ actorId, action: "privacy_request.create", entityType: "privacy_request", entityId: row!.id, after: { reference: row!.reference, kind: v.kind, hasDeadline: Boolean(dueAt) } }, tx);
    return row!;
  });
}

async function loadRequest(tx: Tx, id: string) {
  const [r] = await tx.select().from(privacyRequests).where(eq(privacyRequests.id, id)).for("update");
  if (!r) throw new PrivacyOpsError("Request not found.");
  if (["responded", "closed", "refused", "withdrawn"].includes(r.status)) throw new PrivacyOpsError(`This request is ${r.status}.`);
  return r;
}

export async function verifyRequesterIdentity(actorId: string, requestId: string, method: string) {
  if (method.trim().length < 5) throw new PrivacyOpsError("Describe how identity was verified (don't record ID numbers).");
  await db.transaction(async (tx) => {
    const r = await loadRequest(tx, requestId);
    await tx.update(privacyRequests).set({ identityVerifiedAt: new Date(), identityVerifiedBy: actorId, identityMethod: method.trim(), status: r.status === "received" || r.status === "verifying" ? "in_review" : r.status }).where(eq(privacyRequests.id, requestId));
    await recordAudit({ actorId, action: "privacy_request.identity_verified", entityType: "privacy_request", entityId: requestId }, tx);
  });
}

export const REVIEW_ITEMS = ["profile", "notes", "evaluations", "messages", "files", "logs", "payments"] as const;
export const REVIEW_ITEM_LABEL: Record<(typeof REVIEW_ITEMS)[number], string> = {
  profile: "Profile, availability and tax details",
  notes: "Internal notes",
  evaluations: "Evaluations",
  messages: "Messages",
  files: "Uploaded files",
  logs: "Audit and email logs",
  payments: "Bookings, hours and payments",
};

export async function updateReviewChecklist(actorId: string, requestId: string, input: { item: (typeof REVIEW_ITEMS)[number]; reviewed: boolean; note?: string | null }, redactionNotes?: string | null) {
  await db.transaction(async (tx) => {
    const r = await loadRequest(tx, requestId);
    const checklist = { ...(r.reviewChecklist as Record<string, unknown>), [input.item]: { reviewed: input.reviewed, note: input.note?.trim() || null, by: actorId, at: new Date().toISOString() } };
    await tx.update(privacyRequests).set({ reviewChecklist: checklist, ...(redactionNotes !== undefined ? { redactionNotes: redactionNotes?.trim() || null } : {}) }).where(eq(privacyRequests.id, requestId));
    await recordAudit({ actorId, action: "privacy_request.review", entityType: "privacy_request", entityId: requestId, after: { item: input.item, reviewed: input.reviewed } }, tx);
  });
}

export async function extendDeadline(actorId: string, requestId: string, input: { newDueOn: string; reason: string }) {
  if (input.reason.trim().length < 5) throw new PrivacyOpsError("Record the reason for the extension and that the requester was told.");
  await db.transaction(async (tx) => {
    await loadRequest(tx, requestId);
    await tx.update(privacyRequests).set({ extendedDueAt: new Date(`${input.newDueOn}T12:00:00Z`), extensionReason: input.reason.trim() }).where(eq(privacyRequests.id, requestId));
    await recordAudit({ actorId, action: "privacy_request.extend", entityType: "privacy_request", entityId: requestId, reason: input.reason.trim() }, tx);
  });
}

/**
 * Builds the access package for review: everything exportStaffData gives the person, plus the
 * internal notes, evaluations, file list and audit entries about them that must be reviewed (and
 * redacted where appropriate) before release. Stored privately; never emailed.
 */
export async function buildAccessPackage(actorId: string, requestId: string) {
  const r = await db.transaction((tx) => loadRequest(tx, requestId));
  if (!r.staffId) throw new PrivacyOpsError("Link the request to a contractor profile first.");
  if (!r.identityVerifiedAt) throw new PrivacyOpsError("Verify the requester's identity first.");
  const base = await exportStaffData(r.staffId);
  const [notes, evals, files, audit] = await Promise.all([
    db.select({ body: internalNotes.body, at: internalNotes.createdAt }).from(internalNotes).where(eq(internalNotes.staffId, r.staffId)),
    db.select().from(evaluations).where(eq(evaluations.staffId, r.staffId)),
    db.select({ kind: staffFiles.kind, fileName: staffFiles.fileName, at: staffFiles.createdAt }).from(staffFiles).where(eq(staffFiles.staffId, r.staffId)),
    db.select({ action: auditLog.action, at: auditLog.createdAt, reason: auditLog.reason }).from(auditLog).where(and(eq(auditLog.entityId, r.staffId), inArray(auditLog.entityType, ["staff", "staff_profile"]))).orderBy(auditLog.createdAt),
  ]);
  const pkg = {
    reference: r.reference,
    generatedAt: new Date().toISOString(),
    reviewNote: "FOR PRIVACY OFFICER REVIEW. Check each section and redact third-party information or anything withheld under an applicable exception before releasing.",
    record: base,
    forReview: {
      internalNotes: notes.map((n) => ({ note: n.body, at: n.at })),
      evaluations: evals.map((e) => ({ project: e.projectId, overall: e.overall, punctuality: e.punctuality, reliability: e.reliability, professionalism: e.professionalism, feedback: e.feedback, recommendRehire: e.recommendRehire, at: e.createdAt })),
      files: files.map((f) => ({ kind: f.kind, fileName: f.fileName, uploaded: f.at })),
      logEntries: audit,
    },
  };
  const data = Buffer.from(JSON.stringify(pkg, null, 2), "utf8");
  const sha256 = createHash("sha256").update(data).digest("hex");
  const key = `privacy/${r.reference}-${Date.now()}.json`;
  await storage().put(key, data, "application/json");
  await db.transaction(async (tx) => {
    await tx.update(privacyRequests).set({ responseStorageKey: key, responseSha256: sha256 }).where(eq(privacyRequests.id, requestId));
    await recordAudit({ actorId, action: "privacy_request.package", entityType: "privacy_request", entityId: requestId, after: { sha256 } }, tx);
  });
  return { key, sha256 };
}

export async function readAccessPackage(actorId: string, requestId: string) {
  const [r] = await db.select().from(privacyRequests).where(eq(privacyRequests.id, requestId));
  if (!r?.responseStorageKey) throw new PrivacyOpsError("No package has been generated.");
  const data = await storage().get(r.responseStorageKey);
  if (createHash("sha256").update(data).digest("hex") !== r.responseSha256) throw new PrivacyOpsError("The stored package doesn't match its fingerprint.");
  await recordAudit({ actorId, action: "privacy_request.package_download", entityType: "privacy_request", entityId: requestId });
  return { data, fileName: `${r.reference}.json` };
}

/** Records the response. Deletion requests run the erasure (refused under a legal hold). */
export async function respondToRequest(actorId: string, requestId: string, input: { outcome: "responded" | "refused" | "withdrawn"; summary: string; method: string }) {
  if (input.summary.trim().length < 5) throw new PrivacyOpsError("Summarise the response.");
  const r = await db.transaction((tx) => loadRequest(tx, requestId));
  if (input.outcome === "responded") {
    if (!r.identityVerifiedAt) throw new PrivacyOpsError("Verify the requester's identity first.");
    const checklist = r.reviewChecklist as Record<string, { reviewed?: boolean }>;
    const unreviewed = REVIEW_ITEMS.filter((i) => !checklist[i]?.reviewed);
    if (r.kind === "access" && unreviewed.length) throw new PrivacyOpsError(`Review every section first: ${unreviewed.map((i) => REVIEW_ITEM_LABEL[i]).join(", ")}.`);
    if (r.kind === "access" && !r.responseStorageKey) throw new PrivacyOpsError("Generate the access package first.");
    if (r.kind === "deletion") {
      if (!r.staffId) throw new PrivacyOpsError("Link the request to a contractor profile first.");
      if (await isStaffHeld(db, r.staffId)) throw new PrivacyOpsError("This person is under a legal hold; erasure is paused. Record a refusal or wait for the hold to be released.");
      await anonymizeStaff(actorId, r.staffId, `Privacy request ${r.reference}`);
    }
  }
  await db.transaction(async (tx) => {
    await tx.update(privacyRequests).set({ status: input.outcome, responseSummary: input.summary.trim(), responseMethod: input.method.trim() || null, respondedAt: new Date(), closedAt: new Date() }).where(eq(privacyRequests.id, requestId));
    await recordAudit({ actorId, action: `privacy_request.${input.outcome}`, entityType: "privacy_request", entityId: requestId, reason: input.summary.trim() }, tx);
  });
}

export async function listPrivacyRequests() {
  return db
    .select({ r: privacyRequests, staffName: sql<string | null>`case when ${staffProfiles.id} is null then null else ${staffProfiles.firstName} || ' ' || ${staffProfiles.lastName} end` })
    .from(privacyRequests)
    .leftJoin(staffProfiles, eq(staffProfiles.id, privacyRequests.staffId))
    .orderBy(desc(privacyRequests.receivedAt));
}

export async function getPrivacyRequest(id: string) {
  const [row] = await db
    .select({ r: privacyRequests, staffName: sql<string | null>`case when ${staffProfiles.id} is null then null else ${staffProfiles.firstName} || ' ' || ${staffProfiles.lastName} end` })
    .from(privacyRequests)
    .leftJoin(staffProfiles, eq(staffProfiles.id, privacyRequests.staffId))
    .where(eq(privacyRequests.id, id));
  return row ?? null;
}

/** Saves the privacy officer's redaction notes for a request. */
export async function setRedactionNotes(actorId: string, requestId: string, notes: string | null) {
  await db.transaction(async (tx) => {
    await loadRequest(tx, requestId);
    await tx.update(privacyRequests).set({ redactionNotes: notes?.trim() || null }).where(eq(privacyRequests.id, requestId));
    await recordAudit({ actorId, action: "privacy_request.redaction_notes", entityType: "privacy_request", entityId: requestId }, tx);
  });
}
