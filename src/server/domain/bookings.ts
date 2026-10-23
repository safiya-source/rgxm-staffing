// Offers and bookings. One row per (shift, person) moves through the lifecycle in booking-rules.ts.
// Every status change writes booking_status_history + audit_log and queues notifications via the
// outbox, all in the same transaction. Authorisation is the caller's job.
import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import {
  bookings,
  bookingStatusHistory,
  offerResponses,
  projectLocations,
  projectRates,
  projects,
  shifts,
  staffProfiles,
  staffRates,
  staffRoles,
} from "@/server/db/schema";
import { enqueue } from "@/server/notify/outbox";
import { getOrCreateThread, postMessage } from "./comms";
import { ACTIVE_STATUSES, assertTransition, BookingTransitionError, resolveRate, type Actor, type BookingStatus } from "./booking-rules";

export class BookingError extends Error {}

type BookingRow = typeof bookings.$inferSelect;

async function lockBooking(tx: Tx, bookingId: string) {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
  if (!b) throw new BookingError("Booking not found.");
  return b;
}

async function transition(
  tx: Tx,
  b: BookingRow,
  to: BookingStatus,
  actor: { kind: Actor; userId: string | null },
  opts: { reason?: string | null; set?: Partial<typeof bookings.$inferInsert> } = {},
) {
  try {
    assertTransition(b.status, to, actor.kind);
  } catch (err) {
    if (err instanceof BookingTransitionError) throw new BookingError(err.message);
    throw err;
  }
  await tx
    .update(bookings)
    .set({ status: to, ...opts.set })
    .where(eq(bookings.id, b.id));
  await tx.insert(bookingStatusHistory).values({ bookingId: b.id, fromStatus: b.status, toStatus: to, actorId: actor.userId, reason: opts.reason ?? null });
  await recordAudit(
    {
      actorId: actor.userId,
      action: `booking.${to}`,
      entityType: "booking",
      entityId: b.id,
      projectId: b.projectId,
      before: { status: b.status },
      after: { status: to, ...opts.set },
      reason: opts.reason ?? null,
    },
    tx,
  );
}

// ─── Rates ──────────────────────────────────────────────────────────────────

/** Resolves the offer rate for each (shift, staff) pair in one go. */
export async function resolveRates(tx: Tx | typeof db, shiftRows: { id: string; projectId: string; role: string; rateCents: number | null }[], staffIds: string[]) {
  const result = new Map<string, ReturnType<typeof resolveRate>>();
  if (!shiftRows.length || !staffIds.length) return result;
  const projectIds = [...new Set(shiftRows.map((s) => s.projectId))];
  const roles = [...new Set(shiftRows.map((s) => s.role))] as (typeof staffRates.role.enumValues)[number][];
  const [defaults, overrides] = await Promise.all([
    tx
      .select({ staffId: staffRates.staffId, role: staffRates.role, rateCents: staffRates.rateCents })
      .from(staffRates)
      .where(and(inArray(staffRates.staffId, staffIds), inArray(staffRates.role, roles), isNull(staffRates.effectiveTo))),
    tx
      .select({ projectId: projectRates.projectId, role: projectRates.role, staffId: projectRates.staffId, rateCents: projectRates.rateCents })
      .from(projectRates)
      .where(and(inArray(projectRates.projectId, projectIds), isNull(projectRates.revokedAt))),
  ]);
  for (const s of shiftRows) {
    for (const staffId of staffIds) {
      result.set(
        `${s.id}:${staffId}`,
        resolveRate({
          projectStaffRate: overrides.find((o) => o.projectId === s.projectId && o.role === s.role && o.staffId === staffId)?.rateCents ?? null,
          shiftRate: s.rateCents,
          projectRoleRate: overrides.find((o) => o.projectId === s.projectId && o.role === s.role && o.staffId === null)?.rateCents ?? null,
          staffDefaultRate: defaults.find((d) => d.staffId === staffId && d.role === s.role)?.rateCents ?? null,
        }),
      );
    }
  }
  return result;
}

// ─── Offers ─────────────────────────────────────────────────────────────────

export type SkipReason = "not_active" | "not_qualified" | "already_on_shift" | "no_rate" | "conflict";
export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  not_active: "isn't active",
  not_qualified: "isn't qualified for the role",
  already_on_shift: "already has an offer or booking on this shift",
  no_rate: "has no rate for this role",
  conflict: "is already confirmed for an overlapping shift",
};

/**
 * Sends offers for one or more shifts to one or more people. Offers are only invitations to
 * express interest; nothing here books anyone (rule 5).
 */
export async function sendOffers(
  actorId: string,
  input: {
    shiftIds: string[];
    staffIds: string[];
    responseDeadline: Date | null;
    skipConflicts?: boolean;
    /** When given, only these (shift, person) pairs are offered — e.g. skipping days someone marked unavailable. */
    pairs?: { shiftId: string; staffId: string }[];
  },
) {
  if (!input.shiftIds.length) throw new BookingError("Choose at least one shift.");
  if (!input.staffIds.length) throw new BookingError("Choose at least one person.");
  if (input.staffIds.length > 500) throw new BookingError("Send to at most 500 people at a time.");
  if (input.responseDeadline && input.responseDeadline < new Date()) throw new BookingError("The response deadline is in the past.");

  return db.transaction(async (tx) => {
    const shiftRows = await tx.select().from(shifts).where(inArray(shifts.id, input.shiftIds)).for("update");
    if (shiftRows.length !== new Set(input.shiftIds).size) throw new BookingError("Some shifts weren't found.");
    const projectIds = new Set(shiftRows.map((s) => s.projectId));
    if (projectIds.size !== 1) throw new BookingError("Offers can only cover shifts from one project at a time.");
    for (const s of shiftRows) {
      // Full shifts can still be offered so people can be waitlisted.
      if (s.status !== "open" && s.status !== "filled") throw new BookingError(`Only published shifts can be offered (one is ${s.status}). Publish drafts first.`);
      if (s.startsAt < new Date()) throw new BookingError("One of the shifts has already started.");
    }
    if (input.responseDeadline && input.responseDeadline > shiftRows.reduce((m, s) => (s.startsAt < m ? s.startsAt : m), shiftRows[0]!.startsAt)) {
      throw new BookingError("The response deadline must be before the first shift starts.");
    }
    const projectId = shiftRows[0]!.projectId;

    const people = await tx
      .select({ id: staffProfiles.id, status: staffProfiles.status })
      .from(staffProfiles)
      .where(inArray(staffProfiles.id, input.staffIds));
    const qualified = await tx
      .select({ staffId: staffRoles.staffId, role: staffRoles.role })
      .from(staffRoles)
      .where(inArray(staffRoles.staffId, input.staffIds));
    const existing = await tx
      .select({ shiftId: bookings.shiftId, staffId: bookings.staffId })
      .from(bookings)
      .where(and(inArray(bookings.shiftId, input.shiftIds), inArray(bookings.staffId, input.staffIds), inArray(bookings.status, ACTIVE_STATUSES)));
    const confirmedElsewhere = input.skipConflicts
      ? await tx
          .select({ staffId: bookings.staffId, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
          .from(bookings)
          .where(and(inArray(bookings.staffId, input.staffIds), inArray(bookings.status, ["confirmed", "completed"])))
      : [];
    const rates = await resolveRates(tx, shiftRows, input.staffIds);

    const now = new Date();
    const created: { id: string; staffId: string }[] = [];
    const skipped: { staffId: string; shiftId: string; reason: SkipReason }[] = [];

    for (const staffId of [...new Set(input.staffIds)]) {
      const person = people.find((p) => p.id === staffId);
      for (const s of shiftRows) {
        if (input.pairs && !input.pairs.some((p) => p.shiftId === s.id && p.staffId === staffId)) continue;
        const skip = (reason: SkipReason) => skipped.push({ staffId, shiftId: s.id, reason });
        if (!person || person.status !== "active") {
          skip("not_active");
          continue;
        }
        if (!qualified.some((q) => q.staffId === staffId && q.role === s.role)) {
          skip("not_qualified");
          continue;
        }
        if (existing.some((e) => e.shiftId === s.id && e.staffId === staffId)) {
          skip("already_on_shift");
          continue;
        }
        if (confirmedElsewhere.some((c) => c.staffId === staffId && c.startsAt < s.endsAt && s.startsAt < c.endsAt)) {
          skip("conflict");
          continue;
        }
        const rate = rates.get(`${s.id}:${staffId}`);
        if (!rate) {
          skip("no_rate");
          continue;
        }
        const [row] = await tx
          .insert(bookings)
          .values({
            shiftId: s.id,
            staffId,
            projectId,
            role: s.role,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            status: "offered",
            offeredRateCents: rate.rateCents,
            rateSource: rate.source,
            currency: s.currency,
            responseDeadline: input.responseDeadline,
            offeredAt: now,
            offeredBy: actorId,
          })
          .returning({ id: bookings.id });
        created.push({ id: row!.id, staffId });
      }
    }

    if (created.length) {
      await tx.insert(bookingStatusHistory).values(created.map((c) => ({ bookingId: c.id, fromStatus: null, toStatus: "offered" as const, actorId })));
      const batchId = randomUUID();
      const byStaff = new Map<string, string[]>();
      for (const c of created) byStaff.set(c.staffId, [...(byStaff.get(c.staffId) ?? []), c.id]);
      for (const [staffId, bookingIds] of byStaff) {
        await enqueue(tx, { type: "offer.sent", payload: { staffId, bookingIds }, dedupeKey: `offer.sent:${batchId}:${staffId}` });
      }
    }
    await recordAudit(
      {
        actorId,
        action: "offer.send",
        entityType: "shift",
        projectId,
        after: { shiftIds: input.shiftIds, offers: created.length, skipped: skipped.length, deadline: input.responseDeadline },
      },
      tx,
    );
    return { created: created.length, people: new Set(created.map((c) => c.staffId)).size, skipped };
  });
}

/** Staff response to an offer. "More info" keeps the offer open and posts their question. */
export async function respondToOffer(
  staff: { userId: string; staffId: string },
  bookingId: string,
  response: "interested" | "unavailable" | "more_info",
  message: string | null,
) {
  return db.transaction(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    if (b.staffId !== staff.staffId) throw new BookingError("Booking not found.");
    if (b.responseDeadline && b.responseDeadline < new Date() && b.status === "offered") {
      throw new BookingError("This offer has closed. Message RGXM if you're still available.");
    }
    if (response === "more_info") {
      if (b.status !== "offered" && b.status !== "interested") throw new BookingError("This offer is no longer open.");
      if (!message?.trim()) throw new BookingError("Write your question.");
      // Questions go to the project conversation so RGXM can reply.
      const thread = await getOrCreateThread(tx, staff.staffId, b.projectId);
      await postMessage(tx, { threadId: thread.id, authorUserId: staff.userId, body: message, side: "staff" });
    } else if (response === "interested") {
      await transition(tx, b, "interested", { kind: "staff", userId: staff.userId }, { set: { respondedAt: new Date() } });
    } else {
      await transition(tx, b, "declined", { kind: "staff", userId: staff.userId }, { set: { respondedAt: new Date() }, reason: message });
    }
    const [r] = await tx
      .insert(offerResponses)
      .values({ bookingId, response, message: message?.trim() || null, respondedBy: staff.userId })
      .returning({ id: offerResponses.id });
    await enqueue(tx, { type: "offer.response", payload: { bookingId, response }, dedupeKey: `offer.response:${r!.id}` });
    return { projectId: b.projectId };
  });
}

// ─── RGXM decisions ─────────────────────────────────────────────────────────

export async function shortlist(actorId: string, bookingId: string) {
  await db.transaction(async (tx) => transition(tx, await lockBooking(tx, bookingId), "awaiting_confirmation", { kind: "rgxm", userId: actorId }));
}

export async function unshortlist(actorId: string, bookingId: string) {
  await db.transaction(async (tx) => transition(tx, await lockBooking(tx, bookingId), "interested", { kind: "rgxm", userId: actorId }));
}

export async function waitlist(actorId: string, bookingId: string) {
  await db.transaction(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${bookings.waitlistPosition}), 0) + 1` })
      .from(bookings)
      .where(and(eq(bookings.shiftId, b.shiftId), eq(bookings.status, "waitlisted")))) as [{ next: number }];
    await transition(tx, b, "waitlisted", { kind: "rgxm", userId: actorId }, { set: { waitlistPosition: next } });
    await enqueue(tx, { type: "booking.waitlisted", payload: { bookingId }, dedupeKey: `booking.waitlisted:${bookingId}:${next}` });
  });
}

/** Releases someone who expressed interest without booking them. */
export async function release(actorId: string, bookingId: string, reason: string | null) {
  await db.transaction(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    if (!["interested", "awaiting_confirmation", "waitlisted"].includes(b.status)) throw new BookingError("Only people who responded can be released.");
    await transition(tx, b, "cancelled", { kind: "rgxm", userId: actorId }, {
      reason: reason || "Not selected",
      set: { cancelledAt: new Date(), cancelledBy: actorId, cancelReason: reason || "Not selected", cancelledByStaff: false, waitlistPosition: null },
    });
    await enqueue(tx, { type: "booking.cancelled", payload: { bookingId, byStaff: false }, dedupeKey: `booking.cancelled:${bookingId}` });
  });
}

export async function withdrawOffer(actorId: string, bookingId: string) {
  await db.transaction(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    if (b.status !== "offered") throw new BookingError("Only unanswered offers can be withdrawn.");
    await transition(tx, b, "cancelled", { kind: "rgxm", userId: actorId }, {
      reason: "Offer withdrawn",
      set: { cancelledAt: new Date(), cancelledBy: actorId, cancelReason: "Offer withdrawn", cancelledByStaff: false },
    });
  });
}

export type Conflict = { bookingId: string; projectName: string; startsAt: Date; endsAt: Date; timezone: string };

/** Confirmed bookings that overlap a time window for one person. */
export async function findConflicts(tx: Tx | typeof db, staffId: string, window: { startsAt: Date; endsAt: Date }, excludeBookingId?: string): Promise<Conflict[]> {
  return tx
    .select({ bookingId: bookings.id, projectName: projects.name, startsAt: bookings.startsAt, endsAt: bookings.endsAt, timezone: shifts.timezone })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .where(
      and(
        eq(bookings.staffId, staffId),
        inArray(bookings.status, ["confirmed", "completed"]),
        sql`${bookings.startsAt} < ${window.endsAt.toISOString()}::timestamptz and ${bookings.endsAt} > ${window.startsAt.toISOString()}::timestamptz`,
        excludeBookingId ? ne(bookings.id, excludeBookingId) : undefined,
      ),
    );
}

export class ConflictError extends BookingError {
  constructor(public conflicts: Conflict[]) {
    super("This person is already confirmed for an overlapping shift.");
  }
}

/**
 * Confirms a booking at the offered rate, which becomes the agreed rate snapshot.
 * Checks capacity and double-booking; an overlap needs an explicit, reasoned override (rule 4).
 */
export async function confirmBooking(actorId: string, bookingId: string, opts: { override?: { reason: string } } = {}) {
  try {
    return await db.transaction(async (tx) => {
      const b = await lockBooking(tx, bookingId);
      // Lock the shift so concurrent confirmations can't exceed headcount.
      const [s] = await tx.select().from(shifts).where(eq(shifts.id, b.shiftId)).for("update");
      if (!s || s.status === "cancelled") throw new BookingError("This shift has been cancelled.");
      if (s.endsAt < new Date()) throw new BookingError("This shift has already ended.");
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(bookings)
        .where(and(eq(bookings.shiftId, b.shiftId), eq(bookings.status, "confirmed")))) as [{ n: number }];
      if (n >= s.headcount) throw new BookingError(`This shift is full (${n}/${s.headcount}). Raise the headcount or waitlist them.`);
      if (b.offeredRateCents == null) throw new BookingError("No rate was offered, so this booking can't be confirmed.");

      const conflicts = await findConflicts(tx, b.staffId, b, b.id);
      if (conflicts.length && !opts.override) throw new ConflictError(conflicts);
      if (opts.override && !opts.override.reason.trim()) throw new BookingError("Give a reason for overriding the conflict.");

      const now = new Date();
      await transition(tx, b, "confirmed", { kind: "rgxm", userId: actorId }, {
        reason: conflicts.length ? `Conflict override: ${opts.override!.reason}` : null,
        set: {
          agreedRateCents: b.offeredRateCents,
          confirmedAt: now,
          confirmedBy: actorId,
          waitlistPosition: null,
          ...(conflicts.length ? { overrideBy: actorId, overrideReason: opts.override!.reason.trim(), overrideAt: now } : {}),
        },
      });
      await enqueue(tx, { type: "booking.confirmed", payload: { bookingId }, dedupeKey: `booking.confirmed:${bookingId}` });
      if (n + 1 >= s.headcount && s.status === "open") await tx.update(shifts).set({ status: "filled" }).where(eq(shifts.id, s.id));
      return { overridden: conflicts.length > 0 };
    });
  } catch (err) {
    // Backstop: the exclusion constraint caught a race we didn't see.
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23P01") throw new BookingError("This person was just confirmed for an overlapping shift.");
    throw err;
  }
}

async function reopenShiftIfNeeded(tx: Tx, shiftId: string) {
  const [s] = await tx.select({ status: shifts.status, headcount: shifts.headcount }).from(shifts).where(eq(shifts.id, shiftId));
  if (s?.status !== "filled") return;
  const [{ n }] = (await tx.select({ n: count() }).from(bookings).where(and(eq(bookings.shiftId, shiftId), eq(bookings.status, "confirmed")))) as [{ n: number }];
  if (n < s.headcount) await tx.update(shifts).set({ status: "open" }).where(eq(shifts.id, shiftId));
}

/** RGXM cancels a confirmed booking. The record is kept (rule 18). */
export async function cancelBooking(actorId: string, bookingId: string, reason: string) {
  if (!reason.trim()) throw new BookingError("Give a reason for cancelling.");
  await db.transaction(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    if (b.status !== "confirmed") throw new BookingError("Only confirmed bookings can be cancelled here.");
    await transition(tx, b, "cancelled", { kind: "rgxm", userId: actorId }, {
      reason,
      set: { cancelledAt: new Date(), cancelledBy: actorId, cancelReason: reason.trim(), cancelledByStaff: false },
    });
    await reopenShiftIfNeeded(tx, b.shiftId);
    await enqueue(tx, { type: "booking.cancelled", payload: { bookingId, byStaff: false }, dedupeKey: `booking.cancelled:${bookingId}` });
  });
}

/** Staff can't make a shift: interest becomes "declined", a confirmed booking becomes a staff cancellation. */
export async function staffWithdraw(staff: { userId: string; staffId: string }, bookingId: string, reason: string) {
  if (!reason.trim()) throw new BookingError("Let RGXM know why.");
  await db.transaction(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    if (b.staffId !== staff.staffId) throw new BookingError("Booking not found.");
    if (b.status === "confirmed") {
      if (b.startsAt < new Date()) throw new BookingError("This shift has started. Contact your on-site lead.");
      await transition(tx, b, "cancelled", { kind: "staff", userId: staff.userId }, {
        reason,
        set: { cancelledAt: new Date(), cancelledBy: staff.userId, cancelReason: reason.trim(), cancelledByStaff: true },
      });
      await reopenShiftIfNeeded(tx, b.shiftId);
      await enqueue(tx, { type: "booking.cancelled", payload: { bookingId, byStaff: true }, dedupeKey: `booking.cancelled:${bookingId}` });
    } else {
      await transition(tx, b, "declined", { kind: "staff", userId: staff.userId }, { reason, set: { respondedAt: new Date(), waitlistPosition: null } });
      const [r] = await tx
        .insert(offerResponses)
        .values({ bookingId, response: "unavailable", message: reason.trim(), respondedBy: staff.userId })
        .returning({ id: offerResponses.id });
      await enqueue(tx, { type: "offer.response", payload: { bookingId, response: "unavailable" }, dedupeKey: `offer.response:${r!.id}` });
    }
  });
}

// ─── Project rate overrides ─────────────────────────────────────────────────

export async function setProjectRate(actorId: string, projectId: string, input: { role: (typeof staffRates.role.enumValues)[number]; staffId: string | null; rateCents: number }) {
  if (!Number.isInteger(input.rateCents) || input.rateCents < 0 || input.rateCents > 100_000) throw new BookingError("Enter a valid hourly rate.");
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(projectRates)
      .set({ revokedAt: now })
      .where(
        and(
          eq(projectRates.projectId, projectId),
          eq(projectRates.role, input.role),
          input.staffId ? eq(projectRates.staffId, input.staffId) : isNull(projectRates.staffId),
          isNull(projectRates.revokedAt),
        ),
      );
    const [row] = await tx.insert(projectRates).values({ projectId, ...input, approvedBy: actorId }).returning({ id: projectRates.id });
    await recordAudit({ actorId, action: "project_rate.set", entityType: "project_rate", entityId: row!.id, projectId, after: input }, tx);
  });
}

export async function revokeProjectRate(actorId: string, projectId: string, projectRateId: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(projectRates)
      .set({ revokedAt: new Date() })
      .where(and(eq(projectRates.id, projectRateId), eq(projectRates.projectId, projectId), isNull(projectRates.revokedAt)))
      .returning();
    if (!row) throw new BookingError("Rate override not found.");
    await recordAudit({ actorId, action: "project_rate.revoke", entityType: "project_rate", entityId: projectRateId, projectId, before: row }, tx);
  });
}

export async function getBookingForStaff(staffId: string, bookingId: string) {
  const [row] = await db
    .select({
      booking: bookings,
      shift: shifts,
      projectName: projects.name,
      clientNotes: projects.clientNotes,
      location: projectLocations,
    })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.staffId, staffId)));
  return row ?? null;
}
