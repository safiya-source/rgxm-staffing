// Shift scheduling. Local wall-clock times are converted to UTC using the location's time zone.
import { and, asc, count, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FIELD_ROLES } from "@/lib/roles";
import { expandShiftPattern, isIsoDate, isLocalTime, shiftInstants, utcToZoned } from "@/lib/time";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import {
  bookings,
  bookingStatusHistory,
  breakPolicies,
  projectLocations,
  projects,
  shifts,
  shiftTemplates,
  staffingRequirements,
} from "@/server/db/schema";
import { enqueue } from "@/server/notify/outbox";
import { moneyToCents } from "./projects";

export class ShiftError extends Error {}

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const localTime = z.string().refine(isLocalTime, "Use HH:MM");
const isoDate = z.string().refine(isIsoDate, "Choose a date");

const ACTIVE_BOOKINGS = ["offered", "interested", "awaiting_confirmation", "confirmed", "waitlisted"] as const;

export const shiftDetailsSchema = z.object({
  role: z.enum(FIELD_ROLES),
  headcount: z.coerce.number().int().min(1, "At least 1").max(500),
  rateCents: moneyToCents.optional(),
  requirementId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()),
  breakPolicyId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()),
  reportingLocation: optText(200),
  onsiteContact: optText(200),
  uniform: optText(1000),
  instructions: optText(4000),
});

export const bulkShiftSchema = shiftDetailsSchema.extend({
  locationId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate,
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).default([]),
  startTime: localTime,
  endTime: localTime,
  publish: z.boolean().default(true),
});
export type BulkShiftInput = z.infer<typeof bulkShiftSchema>;

async function loadLocation(tx: Tx, projectId: string, locationId: string) {
  const [loc] = await tx
    .select({ id: projectLocations.id, timezone: projectLocations.timezone })
    .from(projectLocations)
    .where(and(eq(projectLocations.id, locationId), eq(projectLocations.projectId, projectId)));
  if (!loc) throw new ShiftError("That location isn't part of this project.");
  return loc;
}

async function assertRequirement(tx: Tx, projectId: string, requirementId: string | null | undefined) {
  if (!requirementId) return;
  const [r] = await tx
    .select({ id: staffingRequirements.id })
    .from(staffingRequirements)
    .where(and(eq(staffingRequirements.id, requirementId), eq(staffingRequirements.projectId, projectId)));
  if (!r) throw new ShiftError("That staffing requirement isn't part of this project.");
}

function isExclusionViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23P01" || e?.cause?.code === "23P01";
}

/** Creates one shift per matching date in the pattern, all in one transaction. */
export async function createShifts(actorId: string, projectId: string, input: BulkShiftInput) {
  return db.transaction(async (tx) => {
    const loc = await loadLocation(tx, projectId, input.locationId);
    await assertRequirement(tx, projectId, input.requirementId);
    let windows;
    try {
      windows = expandShiftPattern({
        startDate: input.startDate,
        endDate: input.endDate,
        weekdays: input.weekdays,
        startTime: input.startTime,
        endTime: input.endTime,
        timeZone: loc.timezone,
      });
    } catch (err) {
      throw new ShiftError(err instanceof Error ? err.message : "Invalid schedule");
    }
    if (!windows.length) throw new ShiftError("No dates match that pattern.");
    const rows = await tx
      .insert(shifts)
      .values(
        windows.map((w) => ({
          projectId,
          locationId: loc.id,
          requirementId: input.requirementId ?? null,
          role: input.role,
          startsAt: w.startsAt,
          endsAt: w.endsAt,
          timezone: loc.timezone,
          headcount: input.headcount,
          rateCents: input.rateCents ?? null,
          breakPolicyId: input.breakPolicyId ?? null,
          reportingLocation: input.reportingLocation ?? null,
          onsiteContact: input.onsiteContact ?? null,
          uniform: input.uniform ?? null,
          instructions: input.instructions ?? null,
          status: input.publish ? ("open" as const) : ("draft" as const),
          createdBy: actorId,
        })),
      )
      .returning({ id: shifts.id });
    await recordAudit(
      {
        actorId,
        action: "shift.bulk_create",
        entityType: "shift",
        projectId,
        after: { count: rows.length, ...input, ids: rows.map((r) => r.id) },
      },
      tx,
    );
    return rows.map((r) => r.id);
  });
}

export const shiftUpdateSchema = shiftDetailsSchema.extend({
  date: isoDate,
  startTime: localTime,
  endTime: localTime,
});
export type ShiftUpdateInput = z.infer<typeof shiftUpdateSchema>;

async function loadShift(tx: Tx, shiftId: string) {
  const [s] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).for("update");
  if (!s) throw new ShiftError("Shift not found.");
  return s;
}

async function confirmedCount(tx: Tx, shiftId: string) {
  const [r] = await tx
    .select({ n: count() })
    .from(bookings)
    .where(and(eq(bookings.shiftId, shiftId), eq(bookings.status, "confirmed")));
  return r?.n ?? 0;
}

export async function updateShift(actorId: string, shiftId: string, input: ShiftUpdateInput) {
  try {
    await db.transaction(async (tx) => {
      const before = await loadShift(tx, shiftId);
      if (before.status === "cancelled" || before.status === "completed") throw new ShiftError(`A ${before.status} shift can't be edited.`);
      await assertRequirement(tx, before.projectId, input.requirementId);
      const confirmed = await confirmedCount(tx, shiftId);
      if (input.headcount < confirmed) throw new ShiftError(`${confirmed} people are already confirmed; headcount can't go below that.`);
      const { startsAt, endsAt } = shiftInstants(input.date, input.startTime, input.endTime, before.timezone);
      const values = {
        role: input.role,
        headcount: input.headcount,
        rateCents: input.rateCents ?? null,
        requirementId: input.requirementId ?? null,
        breakPolicyId: input.breakPolicyId ?? null,
        reportingLocation: input.reportingLocation ?? null,
        onsiteContact: input.onsiteContact ?? null,
        uniform: input.uniform ?? null,
        instructions: input.instructions ?? null,
        startsAt,
        endsAt,
        ...(before.status === "open" || before.status === "filled" ? { status: confirmed >= input.headcount ? ("filled" as const) : ("open" as const) } : {}),
      };
      if (values.role !== before.role) {
        const [active] = await tx
          .select({ n: count() })
          .from(bookings)
          .where(and(eq(bookings.shiftId, shiftId), inArray(bookings.status, [...ACTIVE_BOOKINGS])));
        if ((active?.n ?? 0) > 0) throw new ShiftError("People have already been offered this shift, so its role can't change.");
      }
      await tx.update(shifts).set(values).where(eq(shifts.id, shiftId));
      await recordAudit({ actorId, action: "shift.update", entityType: "shift", entityId: shiftId, projectId: before.projectId, before, after: values }, tx);
      // Tell people with a live offer or booking when what they'd see has changed.
      const visibleChange =
        before.startsAt.getTime() !== startsAt.getTime() ||
        before.endsAt.getTime() !== endsAt.getTime() ||
        before.reportingLocation !== values.reportingLocation ||
        before.uniform !== values.uniform ||
        before.instructions !== values.instructions ||
        before.onsiteContact !== values.onsiteContact;
      if (visibleChange) {
        await enqueue(tx, { type: "shift.changed", payload: { shiftId, changeId: randomUUID() } });
      }
    });
  } catch (err) {
    if (isExclusionViolation(err)) throw new ShiftError("That time would double-book someone already confirmed on this shift.");
    throw err;
  }
}

/** Moves a shift to another local date, keeping its local start/end times (used by drag-and-drop). */
export async function moveShiftToDate(actorId: string, shiftId: string, date: string) {
  const s = await db.select().from(shifts).where(eq(shifts.id, shiftId)).then((r) => r[0]);
  if (!s) throw new ShiftError("Shift not found.");
  const start = utcToZoned(s.startsAt, s.timezone);
  const end = utcToZoned(s.endsAt, s.timezone);
  await updateShift(actorId, shiftId, {
    date,
    startTime: start.time,
    endTime: end.time,
    role: s.role,
    headcount: s.headcount,
    rateCents: s.rateCents,
    requirementId: s.requirementId,
    breakPolicyId: s.breakPolicyId,
    reportingLocation: s.reportingLocation,
    onsiteContact: s.onsiteContact,
    uniform: s.uniform,
    instructions: s.instructions,
  });
}

/** Copies a shift (details + local times) onto other dates. Bookings are not copied. */
export async function duplicateShift(actorId: string, shiftId: string, dates: string[]) {
  const unique = [...new Set(dates)].filter(isIsoDate);
  if (!unique.length) throw new ShiftError("Choose at least one date.");
  if (unique.length > 60) throw new ShiftError("Duplicate to at most 60 dates at once.");
  return db.transaction(async (tx) => {
    const s = await loadShift(tx, shiftId);
    const start = utcToZoned(s.startsAt, s.timezone);
    const end = utcToZoned(s.endsAt, s.timezone);
    const rows = await tx
      .insert(shifts)
      .values(
        unique.map((date) => {
          const t = shiftInstants(date, start.time, end.time, s.timezone);
          return {
            projectId: s.projectId,
            locationId: s.locationId,
            requirementId: s.requirementId,
            role: s.role,
            startsAt: t.startsAt,
            endsAt: t.endsAt,
            timezone: s.timezone,
            headcount: s.headcount,
            rateCents: s.rateCents,
            currency: s.currency,
            breakPolicyId: s.breakPolicyId,
            reportingLocation: s.reportingLocation,
            onsiteContact: s.onsiteContact,
            uniform: s.uniform,
            instructions: s.instructions,
            status: s.status === "draft" ? ("draft" as const) : ("open" as const),
            createdBy: actorId,
          };
        }),
      )
      .returning({ id: shifts.id });
    await recordAudit(
      { actorId, action: "shift.duplicate", entityType: "shift", entityId: shiftId, projectId: s.projectId, after: { dates: unique, ids: rows.map((r) => r.id) } },
      tx,
    );
    return rows.length;
  });
}

export async function publishShifts(actorId: string, projectId: string, shiftIds: string[]) {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(shifts)
      .set({ status: "open" })
      .where(and(eq(shifts.projectId, projectId), inArray(shifts.id, shiftIds), eq(shifts.status, "draft")))
      .returning({ id: shifts.id });
    await recordAudit({ actorId, action: "shift.publish", entityType: "shift", projectId, after: { ids: updated.map((u) => u.id) } }, tx);
    return updated.length;
  });
}

/** Cancels a shift. The shift and its bookings are kept for history (rule 18). */
export async function cancelShift(actorId: string, shiftId: string, reason: string) {
  if (!reason.trim()) throw new ShiftError("Give a reason for cancelling.");
  return db.transaction(async (tx) => {
    const s = await loadShift(tx, shiftId);
    if (s.status === "cancelled") return 0;
    if (s.status === "completed") throw new ShiftError("Completed shifts can't be cancelled.");
    const now = new Date();
    await tx.update(shifts).set({ status: "cancelled", cancelledAt: now, cancelledBy: actorId, cancelReason: reason }).where(eq(shifts.id, shiftId));
    const affected = await tx
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.shiftId, shiftId), inArray(bookings.status, [...ACTIVE_BOOKINGS])))
      .for("update");
    if (affected.length) {
      await tx
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: now, cancelledBy: actorId, cancelReason: `Shift cancelled: ${reason}`, cancelledByStaff: false })
        .where(inArray(bookings.id, affected.map((b) => b.id)));
      await tx.insert(bookingStatusHistory).values(
        affected.map((b) => ({ bookingId: b.id, fromStatus: b.status, toStatus: "cancelled" as const, actorId, reason: `Shift cancelled: ${reason}` })),
      );
    }
    await recordAudit(
      { actorId, action: "shift.cancel", entityType: "shift", entityId: shiftId, projectId: s.projectId, reason, after: { bookingsCancelled: affected.length } },
      tx,
    );
    if (affected.length) {
      await enqueue(tx, { type: "shift.cancelled", payload: { shiftId, bookingIds: affected.map((b) => b.id) }, dedupeKey: `shift.cancelled:${shiftId}` });
    }
    return affected.length;
  });
}

// ─── Templates ──────────────────────────────────────────────────────────────

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.enum(FIELD_ROLES),
  localStartTime: localTime,
  localEndTime: localTime,
  headcount: z.coerce.number().int().min(1).max(500),
  rateCents: moneyToCents.optional(),
  uniform: optText(1000),
  instructions: optText(4000),
});

export async function createTemplate(actorId: string, input: z.infer<typeof templateSchema>) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(shiftTemplates)
      .values({ ...input, rateCents: input.rateCents ?? null, createdBy: actorId })
      .returning({ id: shiftTemplates.id });
    await recordAudit({ actorId, action: "shift_template.create", entityType: "shift_template", entityId: row!.id, after: input }, tx);
    return row!.id;
  });
}

export async function deleteTemplate(actorId: string, templateId: string) {
  await db.transaction(async (tx) => {
    const [before] = await tx.delete(shiftTemplates).where(eq(shiftTemplates.id, templateId)).returning();
    await recordAudit({ actorId, action: "shift_template.delete", entityType: "shift_template", entityId: templateId, before }, tx);
  });
}

export async function listTemplates() {
  return db.select().from(shiftTemplates).orderBy(asc(shiftTemplates.name));
}

export async function listBreakPolicies() {
  return db.select({ id: breakPolicies.id, name: breakPolicies.name }).from(breakPolicies).orderBy(asc(breakPolicies.name));
}

// ─── Queries ────────────────────────────────────────────────────────────────

export type ShiftQuery = {
  from: Date;
  to: Date;
  projectIds?: string[];
  locationId?: string;
  role?: (typeof FIELD_ROLES)[number];
  includeCancelled?: boolean;
};

/** Shifts in a window with coverage (confirmed vs headcount) and offer activity. */
export async function getShifts(q: ShiftQuery) {
  const conds = [lt(shifts.startsAt, q.to), gte(shifts.endsAt, q.from)];
  if (q.projectIds) conds.push(q.projectIds.length ? inArray(shifts.projectId, q.projectIds) : sql`false`);
  if (q.locationId) conds.push(eq(shifts.locationId, q.locationId));
  if (q.role) conds.push(eq(shifts.role, q.role));
  if (!q.includeCancelled) conds.push(ne(shifts.status, "cancelled"));

  return db
    .select({
      id: shifts.id,
      projectId: shifts.projectId,
      projectName: projects.name,
      projectCode: projects.code,
      locationId: shifts.locationId,
      locationName: projectLocations.name,
      requirementId: shifts.requirementId,
      role: shifts.role,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      timezone: shifts.timezone,
      headcount: shifts.headcount,
      rateCents: shifts.rateCents,
      status: shifts.status,
      uniform: shifts.uniform,
      instructions: shifts.instructions,
      reportingLocation: shifts.reportingLocation,
      onsiteContact: shifts.onsiteContact,
      breakPolicyId: shifts.breakPolicyId,
      cancelReason: shifts.cancelReason,
      confirmed: sql<number>`(select count(*)::int from ${bookings} b where b.shift_id = ${shifts.id} and b.status in ('confirmed', 'completed'))`,
      pending: sql<number>`(select count(*)::int from ${bookings} b where b.shift_id = ${shifts.id} and b.status in ('offered', 'interested', 'awaiting_confirmation'))`,
    })
    .from(shifts)
    .innerJoin(projects, eq(projects.id, shifts.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .where(and(...conds))
    .orderBy(asc(shifts.startsAt), asc(shifts.role));
}

export type ShiftRow = Awaited<ReturnType<typeof getShifts>>[number];

/** Estimated cost of scheduled positions: headcount × scheduled minutes × rate. */
export function estimateShiftCents(s: { headcount: number; startsAt: Date; endsAt: Date; rateCents: number | null }) {
  if (s.rateCents == null) return null;
  const minutes = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60000);
  return Math.round((s.headcount * minutes * s.rateCents) / 60);
}
