import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { resolveGrant, type Actor } from "@/server/authz/permissions";
import { db } from "@/server/db";
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  certifications,
  internalNotes,
  languages,
  projectLocations,
  projectMembers,
  projects,
  shifts,
  skills,
  staffCertifications,
  staffLanguages,
  staffListMembers,
  staffLists,
  staffProfiles,
  staffRates,
  staffRoles,
  staffSensitive,
  staffSkills,
  timesheets,
  users,
} from "@/server/db/schema";

/** Emergency contacts: "all" grant sees everyone; "assigned" only people booked on the viewer's projects. */
async function canSeeEmergency(actor: Actor, staffId: string) {
  const grant = resolveGrant(actor.roles, "talent.emergency.view");
  if (grant === "all") return true;
  if (grant !== "assigned") return false;
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)))
    .where(
      and(
        eq(bookings.staffId, staffId),
        inArray(bookings.status, ["confirmed", "completed"]),
        or(eq(projects.ownerId, actor.userId), eq(projects.coordinatorId, actor.userId), eq(projectMembers.userId, actor.userId)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getStaffDetail(
  staffId: string,
  actor: Actor,
  can: { rates: boolean; editRates: boolean; notes: boolean },
) {
  const [profile] = await db.select().from(staffProfiles).where(eq(staffProfiles.id, staffId));
  if (!profile) return null;

  const now = new Date();
  const [roles, tags, langs, certs, lists, rules, exceptions, upcoming, recent, stats] = await Promise.all([
    db.select({ role: staffRoles.role }).from(staffRoles).where(eq(staffRoles.staffId, staffId)),
    db.select({ id: skills.id, name: skills.name }).from(staffSkills).innerJoin(skills, eq(skills.id, staffSkills.skillId)).where(eq(staffSkills.staffId, staffId)),
    db
      .select({ id: languages.id, name: languages.name })
      .from(staffLanguages)
      .innerJoin(languages, eq(languages.id, staffLanguages.languageId))
      .where(eq(staffLanguages.staffId, staffId)),
    db
      .select({
        id: staffCertifications.id,
        name: certifications.name,
        issuedOn: staffCertifications.issuedOn,
        expiresOn: staffCertifications.expiresOn,
      })
      .from(staffCertifications)
      .innerJoin(certifications, eq(certifications.id, staffCertifications.certificationId))
      .where(eq(staffCertifications.staffId, staffId)),
    db
      .select({ id: staffLists.id, name: staffLists.name })
      .from(staffListMembers)
      .innerJoin(staffLists, eq(staffLists.id, staffListMembers.listId))
      .where(eq(staffListMembers.staffId, staffId)),
    db.select().from(availabilityRules).where(eq(availabilityRules.staffId, staffId)).orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime)),
    db
      .select()
      .from(availabilityExceptions)
      .where(and(eq(availabilityExceptions.staffId, staffId), gte(availabilityExceptions.date, sql`current_date`)))
      .orderBy(asc(availabilityExceptions.date))
      .limit(20),
    db
      .select({
        id: bookings.id,
        status: bookings.status,
        role: bookings.role,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        timezone: shifts.timezone,
        projectId: projects.id,
        projectName: projects.name,
        locationName: projectLocations.name,
      })
      .from(bookings)
      .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
      .innerJoin(projects, eq(projects.id, bookings.projectId))
      .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
      .where(and(eq(bookings.staffId, staffId), gte(bookings.endsAt, now), inArray(bookings.status, ["offered", "interested", "awaiting_confirmation", "confirmed", "waitlisted"])))
      .orderBy(asc(bookings.startsAt))
      .limit(20),
    db
      .select({
        id: bookings.id,
        status: bookings.status,
        role: bookings.role,
        startsAt: bookings.startsAt,
        timezone: shifts.timezone,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(bookings)
      .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
      .innerJoin(projects, eq(projects.id, bookings.projectId))
      .where(and(eq(bookings.staffId, staffId), inArray(bookings.status, ["completed", "no_show", "cancelled"])))
      .orderBy(desc(bookings.startsAt))
      .limit(15),
    db
      .select({
        completed: sql<number>`count(*) filter (where ${bookings.status} = 'completed')::int`,
        noShows: sql<number>`count(*) filter (where ${bookings.status} = 'no_show')::int`,
        staffCancellations: sql<number>`count(*) filter (where ${bookings.status} = 'cancelled' and ${bookings.cancelledByStaff})::int`,
        projects: sql<number>`count(distinct ${bookings.projectId}) filter (where ${bookings.status} = 'completed')::int`,
        lastShiftAt: sql<Date | null>`max(${bookings.startsAt}) filter (where ${bookings.status} = 'completed')`,
        approvedMinutes: sql<number>`coalesce((select sum(${timesheets.payableMinutes}) from ${timesheets} where ${timesheets.staffId} = ${staffId} and ${timesheets.status} in ('approved', 'locked', 'exported', 'paid')), 0)::int`,
      })
      .from(bookings)
      .where(eq(bookings.staffId, staffId)),
  ]);

  const rates = can.rates
    ? await db
        .select({
          id: staffRates.id,
          role: staffRates.role,
          rateCents: staffRates.rateCents,
          currency: staffRates.currency,
          effectiveFrom: staffRates.effectiveFrom,
          effectiveTo: staffRates.effectiveTo,
          note: staffRates.note,
          setBy: users.name,
        })
        .from(staffRates)
        .leftJoin(users, eq(users.id, staffRates.setBy))
        .where(eq(staffRates.staffId, staffId))
        .orderBy(asc(staffRates.role), desc(staffRates.effectiveFrom))
    : null;

  const [sensitive] = await db.select().from(staffSensitive).where(eq(staffSensitive.staffId, staffId));
  const showEmergency = await canSeeEmergency(actor, staffId);

  const notes = can.notes
    ? await db
        .select({ id: internalNotes.id, body: internalNotes.body, createdAt: internalNotes.createdAt, author: users.name })
        .from(internalNotes)
        .leftJoin(users, eq(users.id, internalNotes.authorId))
        .where(eq(internalNotes.staffId, staffId))
        .orderBy(desc(internalNotes.createdAt))
        .limit(50)
    : null;

  return {
    profile,
    roles: roles.map((r) => r.role),
    skills: tags,
    languages: langs,
    certifications: certs,
    lists,
    availability: { rules, exceptions },
    upcoming,
    recent,
    stats: stats[0]!,
    rates,
    pay: can.rates
      ? {
          classification: profile.classification,
          taxRegistered: sensitive?.taxRegistered ?? false,
          // Tax and legal identity details only for people who can edit pay setup.
          gstHstNumber: can.editRates ? (sensitive?.gstHstNumber ?? null) : null,
          legalName: can.editRates ? (sensitive?.legalName ?? null) : null,
          businessName: can.editRates ? (sensitive?.businessName ?? null) : null,
        }
      : null,
    emergency: showEmergency
      ? {
          name: sensitive?.emergencyContactName ?? null,
          phone: sensitive?.emergencyContactPhone ?? null,
          relation: sensitive?.emergencyContactRelation ?? null,
        }
      : null,
    notes,
  };
}

export type StaffDetail = NonNullable<Awaited<ReturnType<typeof getStaffDetail>>>;
