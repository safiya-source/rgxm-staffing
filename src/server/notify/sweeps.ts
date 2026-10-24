// Time-based automation, run by the scheduled runner. Every event uses a dedupe key, so running
// sweeps repeatedly (or concurrently) never duplicates a reminder.
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { bookings, timesheets } from "@/server/db/schema";
import { ensureTimesheet, recomputeTimesheet } from "@/server/domain/attendance";
import { enqueue } from "./outbox";

const HOUR = 3_600_000;

export async function runSweeps(now = new Date()) {
  // 1. Shift reminders ~24 hours ahead.
  const upcoming = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "confirmed"), gte(bookings.startsAt, now), lte(bookings.startsAt, new Date(now.getTime() + 24 * HOUR))));
  for (const b of upcoming) await enqueue(db, { type: "shift.reminder", payload: { bookingId: b.id }, dedupeKey: `shift.reminder:${b.id}` });

  // 2. After a shift ends: make sure a timesheet exists, refresh time-based flags, and prompt the staff member once.
  const ended = await db
    .select({ id: bookings.id, ts: timesheets.status })
    .from(bookings)
    .leftJoin(timesheets, eq(timesheets.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        lte(bookings.endsAt, new Date(now.getTime() - 0.5 * HOUR)),
        gte(bookings.endsAt, new Date(now.getTime() - 7 * 24 * HOUR)),
        sql`(${timesheets.status} is null or ${timesheets.status} in ('not_started', 'in_progress', 'submitted', 'needs_review', 'supervisor_verified'))`,
      ),
    );
  for (const b of ended) {
    await db.transaction(async (tx) => {
      await ensureTimesheet(tx, b.id);
      await recomputeTimesheet(tx, b.id, now);
    });
    if (!b.ts || ["not_started", "in_progress"].includes(b.ts)) {
      await enqueue(db, { type: "timesheet.reminder", payload: { bookingId: b.id }, dedupeKey: `timesheet.reminder:${b.id}` });
    }
  }
  return { reminders: upcoming.length, endedShifts: ended.length };
}

