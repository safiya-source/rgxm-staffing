"use server";
import { rateLimit } from "@/server/rate-limit";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { PROVINCE_CODES } from "@/lib/provinces";
import { FIELD_ROLES } from "@/lib/roles";
import { recordAudit } from "@/server/audit";
import { runAction } from "@/server/actions";
import { db } from "@/server/db";
import { bookings as bookingsTable, messageThreads, notifications, shifts as shiftsTable, staffProfiles, staffRoles, users } from "@/server/db/schema";
import * as attendance from "@/server/domain/attendance";
import { SeparationOfDutiesError } from "@/server/authz/permissions";
import { isIsoDate, isLocalTime, shiftInstants, zonedToUtc } from "@/lib/time";
import * as availability from "@/server/domain/availability";
import * as bookingsDomain from "@/server/domain/bookings";
import * as comms from "@/server/domain/comms";
import { kickOutbox } from "@/server/notify/run";
import { ForbiddenError, getViewer } from "@/server/session";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(60),
  lastName: z.string().trim().min(1, "Required").max(60),
  preferredName: optional(60),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()\-.]{10,20}$/, "Enter a valid phone number"),
  city: z.string().trim().min(1, "Required").max(80),
  province: z.enum(PROVINCE_CODES),
  roles: z.array(z.enum(FIELD_ROLES)).min(1, "Choose at least one role"),
});

export async function saveStaffProfile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const mode = formData.get("mode") === "onboarding" ? "onboarding" : "profile";
  const result = await runAction(async (): Promise<ActionResult> => {
    const viewer = await getViewer();
    if (!viewer || viewer.kind !== "staff") throw new ForbiddenError("Please sign in.");
    if (mode === "onboarding" && formData.get("consent") !== "on") {
      return { ok: false, error: "Please confirm you've read the privacy notice.", fieldErrors: { consent: ["Required"] } };
    }
    const input = profileSchema.parse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      preferredName: formData.get("preferredName"),
      phone: formData.get("phone"),
      city: formData.get("city"),
      province: formData.get("province"),
      roles: formData.getAll("roles"),
    });
    const { roles, ...fields } = input;

    await db.transaction(async (tx) => {
      let staffId = viewer.staff?.id;
      if (staffId) {
        await tx
          .update(staffProfiles)
          .set({ ...fields, ...(viewer.staff?.onboarded ? {} : { onboardingCompletedAt: new Date() }) })
          .where(eq(staffProfiles.id, staffId));
      } else {
        const [created] = await tx
          .insert(staffProfiles)
          .values({ ...fields, email: viewer.email, userId: viewer.userId, onboardingCompletedAt: new Date() })
          .returning({ id: staffProfiles.id });
        staffId = created!.id;
      }
      await tx.delete(staffRoles).where(eq(staffRoles.staffId, staffId));
      await tx.insert(staffRoles).values(roles.map((role) => ({ staffId: staffId!, role })));
      await tx.update(users).set({ name: `${fields.firstName} ${fields.lastName}` }).where(eq(users.id, viewer.userId));
      await recordAudit(
        {
          actorId: viewer.userId,
          action: viewer.staff ? "staff.profile_update" : "staff.register",
          entityType: "staff_profile",
          entityId: staffId,
          after: input,
        },
        tx,
      );
    });
    revalidatePath("/portal", "layout");
    return { ok: true, message: "Profile saved." };
  });
  if (result.ok && mode === "onboarding") redirect("/portal");
  return result;
}

// ─── Availability ───────────────────────────────────────────────────────────

async function requireStaffViewer() {
  const viewer = await getViewer();
  if (!viewer || viewer.kind !== "staff" || !viewer.staff) throw new ForbiddenError("Please sign in.");
  return { userId: viewer.userId, staffId: viewer.staff.id };
}

export async function saveWeeklyAvailabilityAction(rules: { weekday: number; startTime: string; endTime: string }[]): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    const parsed = availability.weeklySchema.safeParse(rules);
    if (!parsed.success) return { ok: false, error: "Each day needs an end time after its start time." };
    await availability.saveWeeklyAvailability(me.userId, me.staffId, parsed.data);
    revalidatePath("/portal/availability");
    return { ok: true, message: "Weekly availability saved." };
  });
}

export async function addAvailabilityExceptionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    const allDay = formData.get("allDay") === "on";
    const text = (k: string) => String(formData.get(k) ?? "").trim() || null;
    const parsed = availability.exceptionSchema.safeParse({
      date: formData.get("date"),
      kind: formData.get("kind"),
      startTime: allDay ? null : text("startTime"),
      endTime: allDay ? null : text("endTime"),
      note: text("note"),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the date and times." };
    try {
      await availability.addAvailabilityException(me.userId, me.staffId, parsed.data);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't save that date." };
    }
    revalidatePath("/portal/availability");
    return { ok: true, message: "Saved." };
  });
}

export async function removeAvailabilityExceptionAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    await availability.removeAvailabilityException(me.userId, me.staffId, z.string().uuid().parse(id));
    revalidatePath("/portal/availability");
    return { ok: true, message: "Removed." };
  });
}

// ─── Offers, bookings, briefs, messages ─────────────────────────────────────


function friendly<T = unknown>(err: unknown): ActionResult<T> | null {
  if (err instanceof bookingsDomain.BookingError || err instanceof comms.CommsError) return { ok: false, error: err.message };
  return null;
}

export async function respondToOfferAction(bookingId: string, response: "interested" | "unavailable" | "more_info", message?: string): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    await rateLimit("offer.respond", me.userId);
    const r = z.enum(["interested", "unavailable", "more_info"]).parse(response);
    try {
      await bookingsDomain.respondToOffer(me, z.string().uuid().parse(bookingId), r, message?.trim() || null);
    } catch (err) {
      const f = friendly(err);
      if (f) return f;
      throw err;
    }
    kickOutbox();
    revalidatePath("/portal", "layout");
    const done = {
      interested: "Thanks! RGXM will confirm with you. You're not booked yet.",
      unavailable: "Got it. Thanks for letting us know.",
      more_info: "Your question was sent to the RGXM team.",
    };
    return { ok: true, message: done[r] };
  });
}

export async function respondToAllAction(bookingIds: string[], response: "interested" | "unavailable"): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    await rateLimit("offer.respond", me.userId);
    const ids = z.array(z.string().uuid()).min(1).max(60).parse(bookingIds);
    const r = z.enum(["interested", "unavailable"]).parse(response);
    let failed = 0;
    for (const id of ids) {
      try {
        await bookingsDomain.respondToOffer(me, id, r, null);
      } catch (err) {
        if (friendly(err)) failed++;
        else throw err;
      }
    }
    kickOutbox();
    revalidatePath("/portal", "layout");
    const ok = ids.length - failed;
    return { ok: true, message: `${r === "interested" ? "Interested in" : "Declined"} ${ok} shift${ok === 1 ? "" : "s"}.${failed ? ` ${failed} had already closed.` : ""}` };
  });
}

export async function withdrawFromBookingAction(bookingId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    try {
      await bookingsDomain.staffWithdraw(me, z.string().uuid().parse(bookingId), reason);
    } catch (err) {
      const f = friendly(err);
      if (f) return f;
      throw err;
    }
    kickOutbox();
    revalidatePath("/portal", "layout");
    return { ok: true, message: "RGXM has been told you can't make it." };
  });
}

export async function acknowledgeDocumentAction(documentId: string): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    try {
      await comms.acknowledgeDocument(me, z.string().uuid().parse(documentId));
    } catch (err) {
      const f = friendly(err);
      if (f) return f;
      throw err;
    }
    revalidatePath("/portal", "layout");
    return { ok: true, message: "Thanks for confirming you've reviewed it." };
  });
}

/** Sends a message to RGXM, about a project the person has work on, or in general. */
export async function sendMessageToRgxmAction(input: { threadId?: string; projectId?: string | null; body: string }): Promise<ActionResult<{ threadId: string }>> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    await rateLimit("message.send", me.userId);
    let threadId = input.threadId;
    if (threadId) {
      const [t] = await db
        .select({ id: messageThreads.id })
        .from(messageThreads)
        .where(and(eq(messageThreads.id, z.string().uuid().parse(threadId)), eq(messageThreads.staffId, me.staffId)));
      if (!t) throw new ForbiddenError("Conversation not found.");
    } else {
      const projectId = input.projectId ? z.string().uuid().parse(input.projectId) : null;
      if (projectId) {
        // Only projects the person has been offered or booked on.
        const [b] = await db.select({ id: bookingsTable.id }).from(bookingsTable).where(and(eq(bookingsTable.projectId, projectId), eq(bookingsTable.staffId, me.staffId))).limit(1);
        if (!b) throw new ForbiddenError("Project not found.");
      }
      threadId = (await comms.getOrCreateThread(db, me.staffId, projectId)).id;
    }
    try {
      await comms.postMessage(db, { threadId, authorUserId: me.userId, body: input.body, side: "staff" });
    } catch (err) {
      const f = friendly<{ threadId: string }>(err);
      if (f) return f;
      throw err;
    }
    kickOutbox();
    revalidatePath("/portal/messages", "layout");
    return { ok: true, message: "Message sent.", data: { threadId } };
  });
}

export async function markStaffNotificationsReadAction(): Promise<void> {
  const viewer = await getViewer();
  if (!viewer || viewer.kind !== "staff") return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, viewer.userId), isNull(notifications.readAt)));
  revalidatePath("/portal", "layout");
}

// ─── Attendance & timesheets ────────────────────────────────────────────────

const attendanceSchema = z.object({
  type: z.enum(["check_in", "check_out"]),
  clientEventId: z.string().min(8).max(80),
  occurredAt: z.string().datetime().optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().nonnegative().nullable() }).nullable().optional(),
});

function attendanceError<T>(err: unknown): ActionResult<T> | null {
  if (err instanceof attendance.AttendanceError || err instanceof SeparationOfDutiesError) return { ok: false, error: err.message };
  return null;
}

/** Check in/out. Online taps use server time; queued offline taps carry their original device time. */
export async function recordMyAttendanceAction(bookingId: string, input: z.infer<typeof attendanceSchema>): Promise<ActionResult<{ duplicate: boolean; withinGeofence: boolean | null }>> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    await rateLimit("attendance.record", me.userId);
    const parsed = attendanceSchema.parse(input);
    try {
      const res = await attendance.recordAttendance({ kind: "staff", ...me }, z.string().uuid().parse(bookingId), {
        type: parsed.type,
        clientEventId: parsed.clientEventId,
        occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : undefined,
        location: parsed.location ?? null,
      });
      revalidatePath("/portal", "layout");
      return {
        ok: true,
        message: parsed.type === "check_in" ? "You're checked in. Have a great shift!" : "Checked out. Please review your hours.",
        data: { duplicate: res.duplicate, withinGeofence: res.duplicate ? null : res.withinGeofence },
      };
    } catch (err) {
      const f = attendanceError<{ duplicate: boolean; withinGeofence: boolean | null }>(err);
      if (f) return f;
      throw err;
    }
  });
}

const timeEdit = z.object({
  date: z.string(),
  start: z.string(),
  end: z.string(),
  breakMinutes: z.coerce.number().int().min(0).max(600),
  note: z.string().max(1000).optional(),
  reason: z.string().max(500).default(""),
});

async function myTimesheet(bookingId: string, staffId: string) {
  const [b] = await db
    .select({ staffId: bookingsTable.staffId, timezone: shiftsTable.timezone })
    .from(bookingsTable)
    .innerJoin(shiftsTable, eq(shiftsTable.id, bookingsTable.shiftId))
    .where(eq(bookingsTable.id, z.string().uuid().parse(bookingId)));
  if (!b || b.staffId !== staffId) throw new ForbiddenError("Shift not found.");
  return { timesheet: await attendance.ensureTimesheet(db, bookingId), timezone: b.timezone };
}

export async function saveMyHoursAction(bookingId: string, input: z.infer<typeof timeEdit>, submit: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    const v = timeEdit.parse(input);
    try {
      const { timesheet, timezone } = await myTimesheet(bookingId, me.staffId);
      if (!isIsoDate(v.date) || !isLocalTime(v.start) || !isLocalTime(v.end)) return { ok: false, error: "Check your start and finish times." };
      if (v.start === v.end) return { ok: false, error: "Your finish time must be after your start time." };
      const { startsAt, endsAt } = shiftInstants(v.date, v.start, v.end, timezone);
      await attendance.staffEditTimesheet(me, timesheet.id, { workedStart: startsAt, workedEnd: endsAt, breakMinutes: v.breakMinutes, note: v.note ?? null }, v.reason);
      if (submit) await attendance.submitTimesheet(me, timesheet.id);
    } catch (err) {
      const f = attendanceError(err);
      if (f) return f;
      throw err;
    }
    kickOutbox();
    revalidatePath("/portal", "layout");
    return { ok: true, message: submit ? "Hours submitted. Thanks!" : "Saved." };
  });
}

// Supervisors (Team Leads / Activation Managers) ─────────────────────────────

export async function supervisorRecordAction(bookingId: string, input: { type: "check_in" | "check_out"; date: string; time: string; note: string }): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    const [b] = await db.select({ timezone: shiftsTable.timezone }).from(bookingsTable).innerJoin(shiftsTable, eq(shiftsTable.id, bookingsTable.shiftId)).where(eq(bookingsTable.id, z.string().uuid().parse(bookingId)));
    if (!b || !isIsoDate(input.date) || !isLocalTime(input.time)) return { ok: false, error: "Check the date and time." };
    try {
      await attendance.recordAttendance({ kind: "supervisor", ...me }, bookingId, { type: z.enum(["check_in", "check_out"]).parse(input.type), occurredAt: zonedToUtc(input.date, input.time, b.timezone), note: input.note });
    } catch (err) {
      const f = attendanceError(err);
      if (f) return f;
      throw err;
    }
    revalidatePath("/portal/team");
    return { ok: true, message: "Recorded." };
  });
}

export async function supervisorVerifyAction(bookingId: string, input: { date: string; start: string; end: string; breakMinutes: number; reason: string; note: string; changed: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    const [b] = await db.select({ timezone: shiftsTable.timezone }).from(bookingsTable).innerJoin(shiftsTable, eq(shiftsTable.id, bookingsTable.shiftId)).where(eq(bookingsTable.id, z.string().uuid().parse(bookingId)));
    if (!b || !(await attendance.isSupervisorOf(db, me.staffId, bookingId))) return { ok: false, error: "You don't supervise this person on this shift." };
    try {
      const t = await attendance.ensureTimesheet(db, bookingId);
      let changes;
      if (input.changed) {
        if (!isIsoDate(input.date) || !isLocalTime(input.start) || !isLocalTime(input.end)) return { ok: false, error: "Check the times." };
        if (input.start === input.end) return { ok: false, error: "The finish time must be after the start time." };
        const { startsAt, endsAt } = shiftInstants(input.date, input.start, input.end, b.timezone);
        changes = { workedStart: startsAt, workedEnd: endsAt, breakMinutes: Number(input.breakMinutes) };
      }
      await attendance.supervisorVerify(me, t.id, { changes, reason: input.reason, note: input.note });
    } catch (err) {
      const f = attendanceError(err);
      if (f) return f;
      throw err;
    }
    kickOutbox();
    revalidatePath("/portal/team");
    return { ok: true, message: "Verified and sent to RGXM for approval." };
  });
}

export async function supervisorSendBackAction(bookingId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requireStaffViewer();
    if (!(await attendance.isSupervisorOf(db, me.staffId, z.string().uuid().parse(bookingId)))) return { ok: false, error: "You don't supervise this person on this shift." };
    try {
      const t = await attendance.ensureTimesheet(db, bookingId);
      await attendance.sendBack({ kind: "supervisor", ...me }, t.id, reason);
    } catch (err) {
      const f = attendanceError(err);
      if (f) return f;
      throw err;
    }
    kickOutbox();
    revalidatePath("/portal/team");
    return { ok: true, message: "Sent back with your note." };
  });
}
