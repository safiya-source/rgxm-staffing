"use server";
import { rateLimit } from "@/server/rate-limit";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { formatInZone } from "@/lib/format";
import { FIELD_ROLES } from "@/lib/roles";
import { isIsoDate, isLocalTime, zonedToUtc } from "@/lib/time";
import { runAction, UserFacingError } from "@/server/actions";
import { canOnProject } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { bookings, messageThreads, shifts } from "@/server/db/schema";
import * as b from "@/server/domain/bookings";
import { CommsError, markThreadRead, postMessage } from "@/server/domain/comms";
import { parseTalentFilters } from "@/server/domain/talent-search";
import { kickOutbox } from "@/server/notify/run";
import { getCandidates, type Candidate } from "@/server/queries/staffing";
import { getOrgSettings } from "@/server/settings";
import { authorizeProject, ForbiddenError, loadProjectScopes, toActor } from "@/server/session";

const uuid = z.string().uuid();

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof b.BookingError || err instanceof CommsError) throw new UserFacingError(err.message);
    throw err;
  }
}

async function projectOfBooking(bookingId: string) {
  const [row] = await db.select({ projectId: bookings.projectId }).from(bookings).where(eq(bookings.id, uuid.parse(bookingId)));
  if (!row) throw new ForbiddenError("Booking not found.");
  return row.projectId;
}

function refresh(projectId: string) {
  revalidatePath(`/dashboard/staffing/${projectId}`);
  revalidatePath("/dashboard/staffing");
  revalidatePath(`/dashboard/projects/${projectId}`, "layout");
}

export async function findCandidatesAction(projectId: string, shiftIds: string[], params: Record<string, string>): Promise<ActionResult<{ candidates: Candidate[] }>> {
  return runAction(async () => {
    await authorizeProject("booking.offer", uuid.parse(projectId));
    const ids = z.array(uuid).min(1).max(60).parse(shiftIds);
    const rows = await db.select({ projectId: shifts.projectId }).from(shifts).where(inArray(shifts.id, ids));
    if (rows.length !== ids.length || rows.some((r) => r.projectId !== projectId)) throw new UserFacingError("Those shifts aren't part of this project.");
    const settings = await getOrgSettings();
    const { candidates } = await getCandidates(ids, parseTalentFilters(params), { timeZone: settings.defaultTimezone });
    return { ok: true, data: { candidates } };
  });
}

export async function sendOffersAction(
  projectId: string,
  input: {
    shiftIds: string[];
    staffIds: string[];
    pairs?: { shiftId: string; staffId: string }[];
    deadlineDate: string;
    deadlineTime: string;
    skipConflicts: boolean;
  },
): Promise<ActionResult<{ skipped: string[] }>> {
  return runAction(async () => {
    const viewer = await authorizeProject("booking.offer", uuid.parse(projectId));
    await rateLimit("offers.send", viewer.userId);
    const shiftIds = z.array(uuid).min(1).max(60).parse(input.shiftIds);
    const staffIds = z.array(uuid).min(1).max(500).parse(input.staffIds);
    const [first] = await db.select({ timezone: shifts.timezone }).from(shifts).where(eq(shifts.id, shiftIds[0]!));
    let deadline: Date | null = null;
    if (input.deadlineDate) {
      if (!isIsoDate(input.deadlineDate) || !isLocalTime(input.deadlineTime || "17:00")) throw new UserFacingError("Check the response deadline.");
      deadline = zonedToUtc(input.deadlineDate, input.deadlineTime || "17:00", first?.timezone ?? "America/Toronto");
    }
    const pairs = input.pairs ? z.array(z.object({ shiftId: uuid, staffId: uuid })).max(5000).parse(input.pairs) : undefined;
    const res = await guard(() => b.sendOffers(viewer.userId, { shiftIds, staffIds, pairs, responseDeadline: deadline, skipConflicts: input.skipConflicts, projectId }));
    kickOutbox();
    refresh(projectId);
    const reasons = [...new Set(res.skipped.map((s) => b.SKIP_REASON_LABEL[s.reason]))];
    return {
      ok: true,
      message:
        res.created === 0
          ? "No new offers were sent."
          : `Sent ${res.created} offer${res.created === 1 ? "" : "s"} to ${res.people} ${res.people === 1 ? "person" : "people"}.`,
      data: { skipped: res.skipped.length ? [`${res.skipped.length} skipped: someone ${reasons.join("; someone ")}.`] : [] },
    };
  });
}

type Op = "shortlist" | "unshortlist" | "waitlist" | "release" | "withdraw";

export async function bookingOpAction(bookingId: string, op: Op, reason?: string): Promise<ActionResult> {
  return runAction(async () => {
    const projectId = await projectOfBooking(bookingId);
    const viewer = await authorizeProject("booking.offer", projectId);
    await guard(async () => {
      switch (op) {
        case "shortlist":
          return b.shortlist(viewer.userId, bookingId);
        case "unshortlist":
          return b.unshortlist(viewer.userId, bookingId);
        case "waitlist":
          return b.waitlist(viewer.userId, bookingId);
        case "release":
          return b.release(viewer.userId, bookingId, reason?.trim() || null);
        case "withdraw":
          return b.withdrawOffer(viewer.userId, bookingId);
      }
    });
    kickOutbox();
    refresh(projectId);
    const done = { shortlist: "Shortlisted.", unshortlist: "Moved back to interested.", waitlist: "Added to the waitlist.", release: "Released.", withdraw: "Offer withdrawn." };
    return { ok: true, message: done[op] };
  });
}

export type ConfirmResult = ActionResult<{ conflicts?: { projectName: string; when: string }[]; canOverride?: boolean }>;

export async function confirmBookingAction(bookingId: string, overrideReason?: string): Promise<ConfirmResult> {
  return runAction(async (): Promise<ConfirmResult> => {
    const projectId = await projectOfBooking(bookingId);
    const viewer = await authorizeProject("booking.confirm", projectId);
    const scope = (await loadProjectScopes([projectId])).get(projectId)!;
    const canOverride = canOnProject(toActor(viewer), "booking.override_conflict", scope);
    if (overrideReason !== undefined && !canOverride) throw new ForbiddenError("Only an administrator or the project manager can override a scheduling conflict.");
    try {
      const res = await b.confirmBooking(viewer.userId, bookingId, overrideReason !== undefined ? { override: { reason: overrideReason } } : {});
      kickOutbox();
      refresh(projectId);
      return { ok: true, message: res.overridden ? "Confirmed with a recorded conflict override." : "Confirmed. They'll get the booking details now." };
    } catch (err) {
      if (err instanceof b.ConflictError) {
        return {
          ok: false,
          error: err.message,
          data: {
            canOverride,
            conflicts: err.conflicts.map((c) => ({ projectName: c.projectName, when: `${formatInZone(c.startsAt, c.timezone, "EEE MMM d, h:mm a")} – ${formatInZone(c.endsAt, c.timezone, "h:mm a")}` })),
          },
        };
      }
      if (err instanceof b.BookingError) throw new UserFacingError(err.message);
      throw err;
    }
  });
}

/** Confirms several people; returns per-booking failures instead of stopping at the first. */
export async function bulkConfirmAction(bookingIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const ids = z.array(uuid).min(1).max(200).parse(bookingIds);
    let ok = 0;
    const failures: string[] = [];
    let projectId: string | null = null;
    for (const id of ids) {
      projectId = await projectOfBooking(id);
      const viewer = await authorizeProject("booking.confirm", projectId);
      try {
        await b.confirmBooking(viewer.userId, id);
        ok++;
      } catch (err) {
        if (err instanceof b.BookingError) failures.push(err.message);
        else throw err;
      }
    }
    kickOutbox();
    if (projectId) refresh(projectId);
    if (failures.length && !ok) return { ok: false, error: [...new Set(failures)].join(" ") };
    return { ok: true, message: `Confirmed ${ok}.${failures.length ? ` ${failures.length} couldn't be confirmed: ${[...new Set(failures)].join(" ")}` : ""}` };
  });
}

export async function cancelBookingAction(bookingId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const projectId = await projectOfBooking(bookingId);
    const viewer = await authorizeProject("booking.confirm", projectId);
    await guard(() => b.cancelBooking(viewer.userId, bookingId, reason));
    kickOutbox();
    refresh(projectId);
    return { ok: true, message: "Booking cancelled. They've been notified." };
  });
}

export async function replyToThreadAction(threadId: string, body: string): Promise<ActionResult> {
  return runAction(async () => {
    const [t] = await db.select({ projectId: messageThreads.projectId }).from(messageThreads).where(eq(messageThreads.id, uuid.parse(threadId)));
    if (!t?.projectId) throw new ForbiddenError("Conversation not found.");
    const viewer = await authorizeProject("comms.manage", t.projectId);
    await rateLimit("message.send", viewer.userId);
    await guard(() => postMessage(db, { threadId, authorUserId: viewer.userId, body, side: "rgxm" }));
    kickOutbox();
    refresh(t.projectId);
    return { ok: true, message: "Reply sent." };
  });
}

export async function markThreadReadAction(threadId: string): Promise<void> {
  const [t] = await db.select({ projectId: messageThreads.projectId }).from(messageThreads).where(eq(messageThreads.id, uuid.parse(threadId)));
  if (!t?.projectId) return;
  await authorizeProject("comms.manage", t.projectId);
  await markThreadRead(threadId, "rgxm");
}

export async function setProjectRateAction(projectId: string, input: { role: string; staffId: string | null; rate: string }): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("rates.project_override", uuid.parse(projectId));
    const role = z.enum(FIELD_ROLES).parse(input.role);
    const m = /^\d{1,4}(\.\d{1,2})?$/.exec(input.rate.trim().replace(/^\$/, ""));
    if (!m) throw new UserFacingError("Enter an hourly rate like 27.50.");
    const [w, f = ""] = input.rate.trim().replace(/^\$/, "").split(".");
    await guard(() => b.setProjectRate(viewer.userId, projectId, { role, staffId: input.staffId ? uuid.parse(input.staffId) : null, rateCents: Number(w) * 100 + Number(f.padEnd(2, "0")) }));
    refresh(projectId);
    return { ok: true, message: "Project rate saved. It applies to new offers." };
  });
}

export async function revokeProjectRateAction(projectId: string, projectRateId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("rates.project_override", uuid.parse(projectId));
    await guard(() => b.revokeProjectRate(viewer.userId, projectId, uuid.parse(projectRateId)));
    refresh(projectId);
    return { ok: true, message: "Project rate removed." };
  });
}
