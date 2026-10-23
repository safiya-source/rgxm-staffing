// Read models for the staff portal. Always scoped to one staff member.
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { bookings, offerResponses, projectLocations, projects, shifts } from "@/server/db/schema";

const bookingFields = {
  id: bookings.id,
  status: bookings.status,
  role: bookings.role,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  offeredRateCents: bookings.offeredRateCents,
  agreedRateCents: bookings.agreedRateCents,
  currency: bookings.currency,
  responseDeadline: bookings.responseDeadline,
  waitlistPosition: bookings.waitlistPosition,
  cancelReason: bookings.cancelReason,
  projectId: projects.id,
  projectName: projects.name,
  timezone: shifts.timezone,
  locationName: projectLocations.name,
  address: projectLocations.address,
  city: projectLocations.city,
  uniform: shifts.uniform,
  instructions: shifts.instructions,
  reportingLocation: shifts.reportingLocation,
  onsiteContact: shifts.onsiteContact,
  askedQuestion: sql<boolean>`exists (select 1 from ${offerResponses} r where r.booking_id = ${bookings.id} and r.response = 'more_info')`,
};

function base() {
  return db
    .select(bookingFields)
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId));
}

export type PortalBooking = Awaited<ReturnType<typeof getOpportunities>>[number];

/** Open offers and responses still waiting on RGXM, soonest first. */
export async function getOpportunities(staffId: string, now = new Date()) {
  return base()
    .where(and(eq(bookings.staffId, staffId), inArray(bookings.status, ["offered", "interested", "awaiting_confirmation", "waitlisted"]), gte(bookings.startsAt, now)))
    .orderBy(asc(bookings.startsAt));
}

export async function getSchedule(staffId: string, now = new Date()) {
  const [upcoming, past, recentChanges] = await Promise.all([
    base()
      .where(and(eq(bookings.staffId, staffId), eq(bookings.status, "confirmed"), gte(bookings.endsAt, now)))
      .orderBy(asc(bookings.startsAt)),
    base()
      .where(and(eq(bookings.staffId, staffId), inArray(bookings.status, ["confirmed", "completed", "no_show"]), lt(bookings.endsAt, now)))
      .orderBy(desc(bookings.startsAt))
      .limit(20),
    base()
      .where(
        and(
          eq(bookings.staffId, staffId),
          eq(bookings.status, "cancelled"),
          gte(bookings.startsAt, now),
          sql`${bookings.cancelledAt} > now() - interval '14 days'`,
        ),
      )
      .orderBy(asc(bookings.startsAt)),
  ]);
  return { upcoming, past, cancelled: recentChanges };
}
