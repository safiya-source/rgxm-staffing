// Staff portal invitations ("Set up your RGXM profile" emails). RGXM decides who to invite; the
// email carries a single-use link valid for 7 days that signs the person in and takes them to
// profile set-up. Only a hash of the link's token is stored.
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { staffInvitations, staffProfiles, users } from "@/server/db/schema";
import { env } from "@/server/env";
import { sendEmail } from "@/server/notify/mailer";
import { enqueue } from "@/server/notify/outbox";
import { actionEmail } from "@/server/notify/templates";

export const INVITE_TTL_DAYS = 7;
const RESEND_AFTER_HOURS = 24;
const HOUR = 3_600_000;

export type SkipReason = "demo" | "not_active" | "already_joined" | "recently_invited" | "not_found";
export const SKIP_LABEL: Record<SkipReason, string> = {
  demo: "demo profile",
  not_active: "profile isn't active",
  already_joined: "already using the portal",
  recently_invited: "invited in the last 24 hours",
  not_found: "not found",
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Queues invitation emails. Returns who was invited and who was skipped (and why). */
export async function inviteStaff(actorId: string, staffIds: string[], opts: { resend?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const ids = [...new Set(staffIds)];
  const people = ids.length
    ? await db
        .select({ id: staffProfiles.id, status: staffProfiles.status, isDemo: staffProfiles.isDemo, anonymizedAt: staffProfiles.anonymizedAt, userId: staffProfiles.userId })
        .from(staffProfiles)
        .where(inArray(staffProfiles.id, ids))
    : [];
  const recent = ids.length && !opts.resend
    ? await db
        .select({ staffId: staffInvitations.staffId })
        .from(staffInvitations)
        .where(and(inArray(staffInvitations.staffId, ids), isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt), gt(staffInvitations.createdAt, new Date(now.getTime() - RESEND_AFTER_HOURS * HOUR))))
    : [];
  const recentSet = new Set(recent.map((r) => r.staffId));
  const invited: string[] = [];
  const skipped: { staffId: string; reason: SkipReason }[] = [];
  for (const id of ids) {
    const p = people.find((x) => x.id === id);
    const reason: SkipReason | null = !p
      ? "not_found"
      : p.isDemo
        ? "demo"
        : p.status !== "active" || p.anonymizedAt
          ? "not_active"
          : p.userId
            ? "already_joined"
            : recentSet.has(id)
              ? "recently_invited"
              : null;
    if (reason) skipped.push({ staffId: id, reason });
    else invited.push(id);
  }
  if (invited.length) {
    await db.transaction(async (tx) => {
      // A new invitation replaces any earlier unused one.
      await tx
        .update(staffInvitations)
        .set({ revokedAt: now })
        .where(and(inArray(staffInvitations.staffId, invited), isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt)));
      const rows = await tx
        .insert(staffInvitations)
        .values(invited.map((staffId) => ({ staffId, invitedBy: actorId })))
        .returning({ id: staffInvitations.id, staffId: staffInvitations.staffId });
      for (const r of rows) {
        await enqueue(tx, { type: "staff.invite", payload: { invitationId: r.id }, dedupeKey: `staff.invite:${r.id}` });
      }
      await recordAudit({ actorId, action: "staff.invite", entityType: "staff", after: { invited: invited.length, staffIds: invited } }, tx);
    });
  }
  return { invited, skipped };
}

/** Outbox handler: issues the link and sends the email (once per invitation). */
export async function sendInvitation(invitationId: string) {
  const [row] = await db
    .select({ inv: staffInvitations, firstName: staffProfiles.firstName, preferredName: staffProfiles.preferredName, email: staffProfiles.email, userId: staffProfiles.userId, status: staffProfiles.status })
    .from(staffInvitations)
    .innerJoin(staffProfiles, eq(staffProfiles.id, staffInvitations.staffId))
    .where(eq(staffInvitations.id, invitationId));
  if (!row || row.inv.acceptedAt || row.inv.revokedAt || row.inv.sentAt || row.userId || row.status !== "active") return;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * HOUR);
  await db.update(staffInvitations).set({ tokenHash: hashToken(token), expiresAt, sentAt: new Date() }).where(eq(staffInvitations.id, invitationId));
  const url = `${env.APP_URL}/invite?token=${encodeURIComponent(token)}`;
  const name = row.preferredName ?? row.firstName;
  await sendEmail({
    to: row.email,
    subject: "Set up your RGXM staff profile",
    containsSecretLink: true,
    dedupeKey: `staff.invite:${invitationId}`,
    ...actionEmail({
      heading: `Hi ${name}, you're invited to RGXM's staff portal`,
      intro:
        "RGXM uses this portal to offer event shifts, share briefs, record your hours and show your payments. Tap below to sign in and finish your profile — no password needed. After this, you can sign in any time with a link sent to this email address.",
      actionLabel: "Set up my profile",
      url,
      footer: `This link works once and expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this, you can ignore it.`,
    }),
  });
}

/**
 * Validates and uses up an invitation link. Returns the person to sign in, or null when the
 * link is unknown, used, revoked or expired, or the profile is no longer active.
 */
export async function consumeInvitation(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .update(staffInvitations)
      .set({ acceptedAt: now })
      .where(and(eq(staffInvitations.tokenHash, hashToken(token)), isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt), gt(staffInvitations.expiresAt, now)))
      .returning({ id: staffInvitations.id, staffId: staffInvitations.staffId });
    if (!inv) return null;
    const [p] = await tx
      .select({ email: staffProfiles.email, firstName: staffProfiles.firstName, lastName: staffProfiles.lastName, status: staffProfiles.status, anonymizedAt: staffProfiles.anonymizedAt })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, inv.staffId));
    if (!p || p.status !== "active" || p.anonymizedAt) {
      tx.rollback();
      return null;
    }
    // Team (internal) accounts never sign in through a staff invitation.
    const [u] = await tx.select({ kind: users.kind }).from(users).where(eq(sql`lower(${users.email})`, p.email.toLowerCase()));
    if (u && u.kind !== "staff") {
      tx.rollback();
      return null;
    }
    // Older unused invitations for the same person stop working.
    await tx
      .update(staffInvitations)
      .set({ revokedAt: now })
      .where(and(eq(staffInvitations.staffId, inv.staffId), isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt)));
    await recordAudit({ actorId: null, action: "staff.invite_accept", entityType: "staff", entityId: inv.staffId }, tx);
    return { staffId: inv.staffId, email: p.email, name: `${p.firstName} ${p.lastName}` };
  }).catch((err) => {
    if (err instanceof TransactionRollbackError) return null;
    throw err;
  });
}

/** Latest invitation per person, for showing "Invited Nov 4" / "Joined" in the dashboard. */
export async function latestInvitations(staffIds: string[]) {
  if (!staffIds.length) return new Map<string, { sentAt: Date | null; createdAt: Date; acceptedAt: Date | null; expiresAt: Date | null }>();
  const rows = await db
    .select({ staffId: staffInvitations.staffId, sentAt: staffInvitations.sentAt, createdAt: staffInvitations.createdAt, acceptedAt: staffInvitations.acceptedAt, expiresAt: staffInvitations.expiresAt })
    .from(staffInvitations)
    .where(inArray(staffInvitations.staffId, staffIds))
    .orderBy(desc(staffInvitations.createdAt));
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!map.has(r.staffId)) map.set(r.staffId, r);
  return map;
}
