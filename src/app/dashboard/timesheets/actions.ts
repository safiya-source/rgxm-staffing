"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { isIsoDate, isLocalTime, shiftInstants, zonedToUtc } from "@/lib/time";
import { runAction, UserFacingError } from "@/server/actions";
import { SeparationOfDutiesError } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { bookings, shifts } from "@/server/db/schema";
import * as a from "@/server/domain/attendance";
import { kickOutbox } from "@/server/notify/run";
import { authorizeProject, ForbiddenError } from "@/server/session";

const uuid = z.string().uuid();

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof a.AttendanceError || err instanceof SeparationOfDutiesError) throw new UserFacingError(err.message);
    throw err;
  }
}

async function bookingContext(bookingId: string) {
  const [row] = await db
    .select({ projectId: bookings.projectId, timezone: shifts.timezone })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .where(eq(bookings.id, uuid.parse(bookingId)));
  if (!row) throw new ForbiddenError("Shift not found.");
  return row;
}

function refresh(bookingId?: string) {
  revalidatePath("/dashboard/timesheets", "layout");
  if (bookingId) revalidatePath(`/dashboard/timesheets/${bookingId}`);
}

/** Local date + start/end times (end ≤ start rolls to the next day) → instants in the shift's time zone. Not exported: every export here is a server action. */
function parseWorkedTimes(date: string, start: string, end: string, timeZone: string) {
  if (!isIsoDate(date) || !isLocalTime(start) || !isLocalTime(end)) throw new UserFacingError("Check the date and times.");
  if (start === end) throw new UserFacingError("The finish time must be after the start time.");
  const { startsAt, endsAt } = shiftInstants(date, start, end, timeZone);
  return { workedStart: startsAt, workedEnd: endsAt };
}

export async function adjustTimesAction(bookingId: string, input: { date: string; start: string; end: string; breakMinutes: number; reason: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await bookingContext(bookingId);
    const viewer = await authorizeProject("timesheet.prepare", ctx.projectId);
    const times = parseWorkedTimes(input.date, input.start, input.end, ctx.timezone);
    await guard(async () => {
      const t = await a.ensureTimesheet(db, bookingId);
      await a.rgxmAdjust(viewer.userId, t.id, { ...times, breakMinutes: Number(input.breakMinutes) }, input.reason);
    });
    refresh(bookingId);
    return { ok: true, message: "Times updated. The change is recorded with your reason." };
  });
}

export async function recordAttendanceAction(bookingId: string, input: { type: "check_in" | "check_out"; date: string; time: string; note: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await bookingContext(bookingId);
    const viewer = await authorizeProject("timesheet.prepare", ctx.projectId);
    if (!isIsoDate(input.date) || !isLocalTime(input.time)) throw new UserFacingError("Check the date and time.");
    const occurredAt = zonedToUtc(input.date, input.time, ctx.timezone);
    await guard(() => a.recordAttendance({ kind: "rgxm", userId: viewer.userId }, bookingId, { type: z.enum(["check_in", "check_out"]).parse(input.type), occurredAt, note: input.note }));
    refresh(bookingId);
    return { ok: true, message: input.type === "check_in" ? "Check-in recorded." : "Check-out recorded." };
  });
}

export async function sendBackAction(bookingId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await bookingContext(bookingId);
    const viewer = await authorizeProject("timesheet.prepare", ctx.projectId);
    await guard(async () => {
      const t = await a.ensureTimesheet(db, bookingId);
      await a.sendBack({ kind: "rgxm", userId: viewer.userId }, t.id, reason);
    });
    kickOutbox();
    refresh(bookingId);
    return { ok: true, message: "Sent back. They've been asked to check their hours." };
  });
}

export async function approveAction(bookingId: string, input: { payableMinutes?: number; reason?: string } = {}): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await bookingContext(bookingId);
    const viewer = await authorizeProject("timesheet.approve", ctx.projectId);
    await guard(async () => {
      const t = await a.ensureTimesheet(db, bookingId);
      await a.approveTimesheet(viewer.userId, t.id, input);
    });
    kickOutbox();
    refresh(bookingId);
    return { ok: true, message: "Hours approved." };
  });
}

export async function bulkApproveAction(bookingIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const ids = z.array(uuid).min(1).max(200).parse(bookingIds);
    let ok = 0;
    const problems: string[] = [];
    for (const id of ids) {
      const ctx = await bookingContext(id);
      const viewer = await authorizeProject("timesheet.approve", ctx.projectId);
      try {
        const t = await a.ensureTimesheet(db, id);
        await a.approveTimesheet(viewer.userId, t.id);
        ok++;
      } catch (err) {
        if (err instanceof a.AttendanceError || err instanceof SeparationOfDutiesError) problems.push(err.message);
        else throw err;
      }
    }
    kickOutbox();
    refresh();
    if (!ok) return { ok: false, error: [...new Set(problems)].join(" ") };
    return { ok: true, message: `Approved ${ok}.${problems.length ? ` ${problems.length} need attention: ${[...new Set(problems)].join(" ")}` : ""}` };
  });
}

export async function correctAction(bookingId: string, input: { payableMinutes: number; reason: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await bookingContext(bookingId);
    const viewer = await authorizeProject("timesheet.correct_after_approval", ctx.projectId);
    await guard(async () => {
      const t = await a.ensureTimesheet(db, bookingId);
      await a.correctApprovedTimesheet(viewer.userId, t.id, { payableMinutes: Number(input.payableMinutes), reason: input.reason });
    });
    kickOutbox();
    refresh(bookingId);
    return { ok: true, message: "Correction recorded." };
  });
}

export async function markNoShowAction(bookingId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await bookingContext(bookingId);
    const viewer = await authorizeProject("booking.confirm", ctx.projectId);
    await guard(() => a.markNoShow(viewer.userId, bookingId, reason));
    refresh(bookingId);
    return { ok: true, message: "Marked as a no-show." };
  });
}
