// Time-based automation, run by the scheduled runner. Every event uses a dedupe key, so running
// sweeps repeatedly (or concurrently) never duplicates a reminder.
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { attendanceEvents, bookings, timesheets } from "@/server/db/schema";
import { ensureTimesheet, recomputeTimesheet } from "@/server/domain/attendance";
import { runRetention } from "@/server/domain/privacy-ops";
import { pruneRateLimits } from "@/server/rate-limit";
import { enqueue } from "./outbox";

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** The check-in reminder goes out this many minutes before a shift (the runner may be a few minutes late). */
export const CHECK_IN_LEAD_MINUTES = 12;
const CHECK_IN_LATE_MINUTES = 15;

export async function runSweeps(now = new Date()) {
  // 1. Shift reminders ~24 hours ahead.
  const upcoming = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "confirmed"), gte(bookings.startsAt, now), lte(bookings.startsAt, new Date(now.getTime() + 24 * HOUR))));
  for (const b of upcoming) await enqueue(db, { type: "shift.reminder", payload: { bookingId: b.id }, dedupeKey: `shift.reminder:${b.id}` });

  // 1b. Check-in nudge ~10 minutes before the start, to anyone who hasn't checked in yet. The runner
  // may only call every few minutes (or late), so the window is a little wider and still catches a
  // shift that started in the last 15 minutes. Sent once per booking.
  const checkInDue = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "confirmed"),
        gte(bookings.startsAt, new Date(now.getTime() - CHECK_IN_LATE_MINUTES * MINUTE)),
        lte(bookings.startsAt, new Date(now.getTime() + CHECK_IN_LEAD_MINUTES * MINUTE)),
        sql`not exists (select 1 from ${attendanceEvents} e where e.booking_id = ${bookings.id} and e.type = 'check_in')`,
      ),
    );
  for (const b of checkInDue) await enqueue(db, { type: "shift.check_in_reminder", payload: { bookingId: b.id }, dedupeKey: `shift.check_in_reminder:${b.id}` });

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
  // 3. Privacy retention: every category with an RGXM-set period (legal holds are skipped).
  const retention = await runRetention(now);
  await pruneRateLimits(now);
  return { reminders: upcoming.length, checkInReminders: checkInDue.length, endedShifts: ended.length, retention };
}

