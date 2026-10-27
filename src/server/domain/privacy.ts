// Privacy operations (PIPEDA): retention clean-up, a person's own data export, and erasing a
// former staff member's personal details on request. Work, pay and audit records are kept because
// RGXM must retain them (tax records, accountability); see docs/SECURITY.md for what stays.
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import {
  accounts,
  attendanceEvents,
  availabilityExceptions,
  availabilityRules,
  bookings,
  bookingStatusHistory,
  documentAcknowledgements,
  evaluations,
  internalNotes,
  messages,
  messageThreads,
  notificationDeliveries,
  notifications,
  payableItems,
  projects,
  projectTeamMembers,
  sessions,
  staffCertifications,
  staffFiles,
  staffLanguages,
  staffListMembers,
  staffProfiles,
  staffRoles,
  staffSensitive,
  staffSkills,
  timesheets,
  twoFactors,
  users,
  verifications,
} from "@/server/db/schema";
import { getOrgSettings } from "@/server/settings";
import { storage } from "@/server/storage";

export class PrivacyError extends Error {}

const DAY = 86_400_000;

/** Clears personal data past its retention period. Safe to run repeatedly. */
export async function purgeExpiredPersonalData(now = new Date()) {
  const settings = await getOrgSettings();
  const locationCutoff = new Date(now.getTime() - settings.locationRetentionDays * DAY);
  const mailCutoff = new Date(now.getTime() - settings.mailLogRetentionDays * DAY);
  const locations = await db
    .update(attendanceEvents)
    .set({ latitude: null, longitude: null, accuracyMeters: null })
    .where(and(lt(attendanceEvents.occurredAt, locationCutoff), or(isNotNull(attendanceEvents.latitude), isNotNull(attendanceEvents.longitude), isNotNull(attendanceEvents.accuracyMeters))))
    .returning({ id: attendanceEvents.id });
  const mail = await db
    .update(notificationDeliveries)
    .set({ bodyText: null, bodyHtml: null })
    .where(and(lt(notificationDeliveries.createdAt, mailCutoff), or(isNotNull(notificationDeliveries.bodyText), isNotNull(notificationDeliveries.bodyHtml))))
    .returning({ id: notificationDeliveries.id });
  const expiredSessions = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  const expiredTokens = await db.delete(verifications).where(lt(verifications.expiresAt, now)).returning({ id: verifications.id });
  return { locations: locations.length, mailBodies: mail.length, sessions: expiredSessions.length, tokens: expiredTokens.length };
}

/** Everything a staff member gave us or that records their work and pay, as JSON (access request). */
export async function exportStaffData(staffId: string) {
  const [profile] = await db.select().from(staffProfiles).where(eq(staffProfiles.id, staffId));
  if (!profile) throw new PrivacyError("Profile not found.");
  const [sensitive] = await db.select().from(staffSensitive).where(eq(staffSensitive.staffId, staffId));
  const q = <T,>(p: Promise<T>) => p;
  const [roles, skills, languages, certs, rulesRows, exceptionsRows, bookingRows, timesheetRows, attendanceRows, payRows, ackRows, threadRows] = await Promise.all([
    q(db.select({ role: staffRoles.role, qualifiedAt: staffRoles.qualifiedAt }).from(staffRoles).where(eq(staffRoles.staffId, staffId))),
    q(db.select({ skillId: staffSkills.skillId }).from(staffSkills).where(eq(staffSkills.staffId, staffId))),
    q(db.select({ languageId: staffLanguages.languageId }).from(staffLanguages).where(eq(staffLanguages.staffId, staffId))),
    q(db.select({ certificationId: staffCertifications.certificationId, issuedOn: staffCertifications.issuedOn, expiresOn: staffCertifications.expiresOn }).from(staffCertifications).where(eq(staffCertifications.staffId, staffId))),
    q(db.select({ weekday: availabilityRules.weekday, startTime: availabilityRules.startTime, endTime: availabilityRules.endTime }).from(availabilityRules).where(eq(availabilityRules.staffId, staffId))),
    q(db.select({ date: availabilityExceptions.date, kind: availabilityExceptions.kind, note: availabilityExceptions.note }).from(availabilityExceptions).where(eq(availabilityExceptions.staffId, staffId))),
    q(
      db
        .select({ id: bookings.id, project: projects.name, role: bookings.role, startsAt: bookings.startsAt, endsAt: bookings.endsAt, status: bookings.status, agreedRateCents: bookings.agreedRateCents, currency: bookings.currency })
        .from(bookings)
        .innerJoin(projects, eq(projects.id, bookings.projectId))
        .where(eq(bookings.staffId, staffId))
        .orderBy(desc(bookings.startsAt)),
    ),
    q(
      db
        .select({ bookingId: timesheets.bookingId, status: timesheets.status, actualStart: timesheets.actualStart, actualEnd: timesheets.actualEnd, workedStart: timesheets.workedStart, workedEnd: timesheets.workedEnd, breakMinutes: timesheets.breakMinutes, payableMinutes: timesheets.payableMinutes, staffNote: timesheets.staffNote })
        .from(timesheets)
        .where(eq(timesheets.staffId, staffId)),
    ),
    q(
      db
        .select({ bookingId: attendanceEvents.bookingId, type: attendanceEvents.type, occurredAt: attendanceEvents.occurredAt, method: attendanceEvents.method, latitude: attendanceEvents.latitude, longitude: attendanceEvents.longitude, withinGeofence: attendanceEvents.withinGeofence })
        .from(attendanceEvents)
        .innerJoin(bookings, eq(bookings.id, attendanceEvents.bookingId))
        .where(eq(bookings.staffId, staffId)),
    ),
    q(
      db
        .select({ serviceDate: payableItems.serviceDate, payableMinutes: payableItems.payableMinutes, rateCents: payableItems.rateCents, totalCents: payableItems.totalCents, currency: payableItems.currency, status: payableItems.status, classification: payableItems.classification })
        .from(payableItems)
        .where(and(eq(payableItems.staffId, staffId), sql`${payableItems.status} <> 'void'`)),
    ),
    q(db.select({ documentId: documentAcknowledgements.documentId, version: documentAcknowledgements.documentVersion, at: documentAcknowledgements.acknowledgedAt }).from(documentAcknowledgements).where(eq(documentAcknowledgements.staffId, staffId))),
    q(db.select({ id: messageThreads.id, subject: messageThreads.subject }).from(messageThreads).where(eq(messageThreads.staffId, staffId))),
  ]);
  const threadMessages = threadRows.length
    ? await db.select({ threadId: messages.threadId, authorId: messages.authorId, body: messages.body, at: messages.createdAt }).from(messages).where(inArray(messages.threadId, threadRows.map((t) => t.id)))
    : [];
  // Internal identifiers and flags aren't part of the person's record.
  const profileFields: Partial<typeof profile> = { ...profile };
  delete profileFields.id;
  delete profileFields.userId;
  delete profileFields.isDemo;
  return {
    exportedAt: new Date().toISOString(),
    note: "Your RGXM staff record. Internal notes and evaluations are available on request from RGXM's privacy officer.",
    profile: profileFields,
    payDetails: sensitive
      ? { legalName: sensitive.legalName, businessName: sensitive.businessName, taxRegistered: sensitive.taxRegistered, gstHstNumber: sensitive.gstHstNumber, emergencyContactName: sensitive.emergencyContactName, emergencyContactPhone: sensitive.emergencyContactPhone }
      : null,
    roles,
    skills,
    languages,
    certifications: certs,
    availability: { weekly: rulesRows, exceptions: exceptionsRows },
    bookings: bookingRows,
    timesheets: timesheetRows,
    attendance: attendanceRows,
    payments: payRows,
    documentAcknowledgements: ackRows,
    messages: threadRows.map((t) => ({ subject: t.subject, messages: threadMessages.filter((m) => m.threadId === t.id).map((m) => ({ fromYou: m.authorId === profile.userId, body: m.body, at: m.at })) })),
  };
}

/**
 * Erases a former staff member's personal details (right to withdraw consent). Refused while they
 * have upcoming confirmed shifts or money still owed. Bookings, timesheets, attendance times,
 * payables and their legal/tax identity (needed for tax records) are kept against the anonymised
 * profile; messages they exchanged with RGXM are kept as business correspondence.
 */
export async function anonymizeStaff(actorId: string, staffId: string, reason: string) {
  if (reason.trim().length < 5) throw new PrivacyError("Record why (e.g. the date and channel of their request).");
  const storageKeys: string[] = [];
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(staffProfiles).where(eq(staffProfiles.id, staffId)).for("update");
    if (!p) throw new PrivacyError("Profile not found.");
    if (p.anonymizedAt) throw new PrivacyError("This profile has already been anonymised.");
    const [upcoming] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.staffId, staffId), eq(bookings.status, "confirmed"), sql`${bookings.endsAt} > now()`));
    if (upcoming!.n > 0) throw new PrivacyError("They still have upcoming confirmed shifts. Cancel or reassign those first.");
    const [owed] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(payableItems)
      .where(and(eq(payableItems.staffId, staffId), inArray(payableItems.status, ["pending", "batched", "exported", "failed"])));
    if (owed!.n > 0) throw new PrivacyError("They still have approved pay that hasn't been paid. Pay it first so their payment details are still on file.");
    const [unapproved] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(timesheets)
      .where(and(eq(timesheets.staffId, staffId), inArray(timesheets.status, ["not_started", "in_progress", "submitted", "needs_review", "supervisor_verified"])));
    if (unapproved!.n > 0) throw new PrivacyError("They have hours that haven't been approved yet. Approve (or mark no-show) first.");

    // Close any open offers.
    const open = await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actorId, cancelReason: "Account closed" })
      .where(and(eq(bookings.staffId, staffId), inArray(bookings.status, ["draft", "offered", "interested", "awaiting_confirmation", "waitlisted"])))
      .returning({ id: bookings.id, status: bookings.status });
    if (open.length) await tx.insert(bookingStatusHistory).values(open.map((b) => ({ bookingId: b.id, fromStatus: null, toStatus: "cancelled" as const, actorId, reason: "Account closed" })));

    const files = await tx.select({ key: staffFiles.storageKey }).from(staffFiles).where(eq(staffFiles.staffId, staffId));
    const certFiles = await tx.select({ key: staffCertifications.documentKey }).from(staffCertifications).where(and(eq(staffCertifications.staffId, staffId), isNotNull(staffCertifications.documentKey)));
    storageKeys.push(...files.map((f) => f.key), ...certFiles.map((f) => f.key!));
    if (p.photoKey) storageKeys.push(p.photoKey);

    for (const t of [staffSkills, staffLanguages, staffCertifications, availabilityRules, availabilityExceptions, staffListMembers, projectTeamMembers, staffFiles, internalNotes, evaluations, staffRoles] as const) {
      await tx.delete(t).where(eq(t.staffId, staffId));
    }
    await tx
      .update(staffSensitive)
      .set({ emergencyContactName: null, emergencyContactPhone: null, emergencyContactRelation: null, paymentProviderRef: null })
      .where(eq(staffSensitive.staffId, staffId));

    const erasedEmail = `erased-${staffId.slice(0, 8)}@invalid.example`;
    await tx
      .update(staffProfiles)
      .set({
        firstName: "Former",
        lastName: `staff member ${staffId.slice(0, 4).toUpperCase()}`,
        preferredName: null,
        email: erasedEmail,
        phone: null,
        photoKey: null,
        city: null,
        province: null,
        serviceArea: null,
        status: "archived",
        experienceYears: null,
        experienceSummary: null,
        hasDriversLicence: null,
        hasVehicle: null,
        willingToTravel: null,
        travelRadiusKm: null,
        preferredEventTypes: [],
        preferredHours: null,
        anonymizedAt: new Date(),
      })
      .where(eq(staffProfiles.id, staffId));

    if (p.userId) {
      await tx.delete(sessions).where(eq(sessions.userId, p.userId));
      await tx.delete(accounts).where(eq(accounts.userId, p.userId));
      await tx.delete(twoFactors).where(eq(twoFactors.userId, p.userId));
      await tx.delete(verifications).where(eq(sql`lower(${verifications.identifier})`, p.email.toLowerCase()));
      await tx.delete(notifications).where(and(eq(notifications.userId, p.userId), isNull(notifications.readAt)));
      await tx.update(users).set({ name: "Former staff member", email: erasedEmail, image: null, status: "archived" }).where(eq(users.id, p.userId));
    }
    // The audit entry records that it happened and why, without repeating the erased details.
    await recordAudit({ actorId, action: "staff.anonymize", entityType: "staff", entityId: staffId, reason: reason.trim(), after: { cancelledOffers: open.length, filesRemoved: storageKeys.length } }, tx);
  });
  // Files are removed after the database commit; a failure here leaves unreachable files, not personal data in the app.
  for (const key of storageKeys) await storage().remove(key).catch((err) => console.error("[privacy] file removal failed", key, err));
}
