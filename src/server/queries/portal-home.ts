import { and, asc, count, desc, eq, gt, isNull, notExists, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  bookings,
  documentAcknowledgements,
  documents,
  payableItems,
  projectLocations,
  projects,
  shifts,
} from "@/server/db/schema";

// Everything the staff Home screen shows, scoped to one staff member.
export async function getPortalHome(staffId: string, now = new Date()) {
  const upcoming = await db
    .select({
      bookingId: bookings.id,
      role: bookings.role,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      timezone: shifts.timezone,
      projectName: projects.name,
      locationName: projectLocations.name,
      address: projectLocations.address,
    })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .where(and(eq(bookings.staffId, staffId), eq(bookings.status, "confirmed"), gt(bookings.endsAt, now)))
    .orderBy(asc(bookings.startsAt))
    .limit(4);

  const [[offers], [outstandingAcks], [lastPayment]] = await Promise.all([
    db
      .select({ n: count() })
      .from(bookings)
      .where(and(eq(bookings.staffId, staffId), eq(bookings.status, "offered"))),
    // Required documents on projects where I have a confirmed booking that I haven't acknowledged (current version).
    db
      .select({ n: sql<number>`count(distinct ${documents.id})::int` })
      .from(documents)
      .innerJoin(
        bookings,
        and(eq(bookings.projectId, documents.projectId), eq(bookings.staffId, staffId), eq(bookings.status, "confirmed")),
      )
      .where(
        and(
          eq(documents.requiresAck, true),
          isNull(documents.archivedAt),
          notExists(
            db
              .select({ one: sql`1` })
              .from(documentAcknowledgements)
              .where(
                and(
                  eq(documentAcknowledgements.documentId, documents.id),
                  eq(documentAcknowledgements.documentVersion, documents.version),
                  eq(documentAcknowledgements.staffId, staffId),
                ),
              ),
          ),
        ),
      ),
    db
      .select({ status: payableItems.status, totalCents: payableItems.totalCents, currency: payableItems.currency, serviceDate: payableItems.serviceDate })
      .from(payableItems)
      .where(and(eq(payableItems.staffId, staffId), sql`${payableItems.status} <> 'void'`))
      .orderBy(desc(payableItems.createdAt))
      .limit(1),
  ]);

  return {
    next: upcoming[0] ?? null,
    upcoming: upcoming.slice(1),
    openOffers: offers?.n ?? 0,
    outstandingAcks: outstandingAcks?.n ?? 0,
    lastPayment: lastPayment ?? null,
  };
}
