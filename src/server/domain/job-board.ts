// The contractor job board: published shifts with open spots that a contractor is qualified for,
// on projects shown on the board. Applying records interest ("interested"), the same as replying
// to an offer, so it lands on the project's Staffing board where RGXM decides who's booked.
// Nothing here books anyone.
import { and, asc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { bookings, bookingStatusHistory, projectLocations, projects, shifts, staffProfiles, staffRoles } from "@/server/db/schema";
import { enqueue } from "@/server/notify/outbox";
import { BookingError, findConflicts, resolveRates } from "./bookings";
import { getOrCreateThread, postMessage } from "./comms";

/** Project stages whose open shifts can be shown. */
const BOARD_PROJECT_STATUSES = ["staffing", "confirmed", "live"] as const;

/** Bookings that mean the person is already on (or offered) the shift. Declined/cancelled can apply again. */
const ON_SHIFT = ["offered", "interested", "awaiting_confirmation", "waitlisted", "confirmed", "completed", "no_show"] as const;

export async function listOpenShifts(staffId: string, now = new Date()) {
  const [me] = await db.select({ status: staffProfiles.status, isDemo: staffProfiles.isDemo }).from(staffProfiles).where(eq(staffProfiles.id, staffId));
  if (!me || me.status !== "active") return [];
  const roles = (await db.select({ role: staffRoles.role }).from(staffRoles).where(eq(staffRoles.staffId, staffId))).map((r) => r.role);
  if (!roles.length) return [];
  const rows = await db
    .select({
      shiftId: shifts.id,
      projectId: projects.id,
      projectName: projects.name,
      role: shifts.role,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      timezone: shifts.timezone,
      headcount: shifts.headcount,
      rateCents: shifts.rateCents,
      uniform: shifts.uniform,
      locationName: projectLocations.name,
      city: projectLocations.city,
      filled: sql<number>`(select count(*)::int from ${bookings} b where b.shift_id = ${shifts.id} and b.status in ('confirmed', 'completed'))`,
    })
    .from(shifts)
    .innerJoin(projects, eq(projects.id, shifts.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .where(
      and(
        eq(shifts.status, "open"),
        gt(shifts.startsAt, now),
        inArray(shifts.role, roles),
        eq(projects.showOnJobBoard, true),
        inArray(projects.status, [...BOARD_PROJECT_STATUSES]),
        eq(projects.isDemo, me.isDemo),
        sql`not exists (select 1 from ${bookings} b where b.shift_id = ${shifts.id} and b.staff_id = ${staffId} and b.status in (${sql.join(
          ON_SHIFT.map((s) => sql`${s}`),
          sql`, `,
        )}))`,
      ),
    )
    .orderBy(asc(shifts.startsAt))
    .limit(200);
  const open = rows.filter((r) => r.filled < r.headcount);
  const rates = await resolveRates(
    db,
    open.map((r) => ({ id: r.shiftId, projectId: r.projectId, role: r.role, rateCents: r.rateCents })),
    [staffId],
  );
  // The rate shown is the one that would apply to this person (personal, project or shift rate).
  return open.map((r) => ({ ...r, spotsLeft: r.headcount - r.filled, rateCents: rates.get(`${r.shiftId}:${staffId}`)?.rateCents ?? null }));
}
export type OpenShift = Awaited<ReturnType<typeof listOpenShifts>>[number];

/** A contractor says they're interested in an open shift from the job board. */
export async function applyForShift(staff: { userId: string; staffId: string }, shiftId: string, note: string | null) {
  const message = note?.trim().slice(0, 1000) || null;
  try {
    return await db.transaction(async (tx) => {
      const [s] = await tx
        .select({ s: shifts, p: projects })
        .from(shifts)
        .innerJoin(projects, eq(projects.id, shifts.projectId))
        .where(eq(shifts.id, shiftId))
        .for("update", { of: shifts });
      const [me] = await tx.select({ status: staffProfiles.status, isDemo: staffProfiles.isDemo }).from(staffProfiles).where(eq(staffProfiles.id, staff.staffId));
      if (!s || !me || s.p.isDemo !== me.isDemo || !s.p.showOnJobBoard || !(BOARD_PROJECT_STATUSES as readonly string[]).includes(s.p.status)) throw new BookingError("This shift isn't on the job board.");
      if (me.status !== "active") throw new BookingError("Your profile isn't active right now. Message RGXM to be considered for work.");
      if (s.s.status !== "open" || s.s.startsAt <= new Date()) throw new BookingError("This shift isn't open any more.");
      const [qualified] = await tx.select({ role: staffRoles.role }).from(staffRoles).where(and(eq(staffRoles.staffId, staff.staffId), eq(staffRoles.role, s.s.role)));
      if (!qualified) throw new BookingError("This shift is for a role that isn't on your profile.");
      const [existing] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.shiftId, shiftId), eq(bookings.staffId, staff.staffId), notInArray(bookings.status, ["declined", "cancelled"])));
      if (existing) throw new BookingError("You've already responded to this shift. It's under Opportunities or your schedule.");
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int n from ${bookings} where shift_id = ${shiftId} and status in ('confirmed', 'completed')`)).rows as [{ n: number }];
      if (n >= s.s.headcount) throw new BookingError("This shift is full.");
      if ((await findConflicts(tx, staff.staffId, s.s)).length) throw new BookingError("You're already booked for a shift at the same time.");
      const rate = (await resolveRates(tx, [s.s], [staff.staffId])).get(`${s.s.id}:${staff.staffId}`);
      if (!rate) throw new BookingError("RGXM hasn't set a rate for this role yet. Message RGXM if you're available.");
      const now = new Date();
      const [b] = await tx
        .insert(bookings)
        .values({
          shiftId,
          staffId: staff.staffId,
          projectId: s.s.projectId,
          role: s.s.role,
          startsAt: s.s.startsAt,
          endsAt: s.s.endsAt,
          status: "interested",
          offeredRateCents: rate.rateCents,
          rateSource: rate.source,
          currency: s.s.currency,
          respondedAt: now,
        })
        .returning({ id: bookings.id });
      await tx.insert(bookingStatusHistory).values({ bookingId: b!.id, fromStatus: null, toStatus: "interested", actorId: staff.userId, reason: "Applied from the job board" });
      if (message) {
        const thread = await getOrCreateThread(tx, staff.staffId, s.s.projectId);
        await postMessage(tx, { threadId: thread.id, authorUserId: staff.userId, body: message, side: "staff" });
      }
      await enqueue(tx, { type: "offer.response", payload: { bookingId: b!.id, response: "interested", source: "job_board" }, dedupeKey: `job_board.apply:${b!.id}` });
      await recordAudit({ actorId: staff.userId, action: "booking.apply", entityType: "booking", entityId: b!.id, projectId: s.s.projectId, after: { shiftId, rateCents: rate.rateCents } }, tx);
      return { bookingId: b!.id, projectId: s.s.projectId };
    });
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") throw new BookingError("You've already responded to this shift.");
    throw err;
  }
}
