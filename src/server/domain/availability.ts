import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate, isLocalTime, utcToZoned } from "@/lib/time";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { availabilityExceptions, availabilityRules } from "@/server/db/schema";
import { getOrgSettings } from "@/server/settings";

const window = z
  .object({ weekday: z.number().int().min(0).max(6), startTime: z.string().refine(isLocalTime), endTime: z.string().refine(isLocalTime) })
  .refine((w) => w.endTime > w.startTime, { message: "End time must be after start time" });

export const weeklySchema = z.array(window).max(21);

export const exceptionSchema = z
  .object({
    date: z.string().refine(isIsoDate, "Choose a date"),
    kind: z.enum(["available", "unavailable"]),
    startTime: z.string().refine(isLocalTime).nullable(),
    endTime: z.string().refine(isLocalTime).nullable(),
    note: z.string().trim().max(200).nullable(),
  })
  .refine((e) => (e.startTime === null) === (e.endTime === null), { message: "Give both a start and end time, or neither" })
  .refine((e) => !e.startTime || !e.endTime || e.endTime > e.startTime, { message: "End time must be after start time" });

/** Replaces the weekly pattern in one go. */
export async function saveWeeklyAvailability(actorId: string, staffId: string, rules: z.infer<typeof weeklySchema>) {
  const parsed = weeklySchema.parse(rules);
  await db.transaction(async (tx) => {
    await tx.delete(availabilityRules).where(eq(availabilityRules.staffId, staffId));
    if (parsed.length) await tx.insert(availabilityRules).values(parsed.map((r) => ({ ...r, staffId })));
    await recordAudit({ actorId, action: "availability.weekly", entityType: "staff_profile", entityId: staffId, after: parsed }, tx);
  });
}

export async function addAvailabilityException(actorId: string, staffId: string, input: z.infer<typeof exceptionSchema>) {
  const e = exceptionSchema.parse(input);
  const { defaultTimezone } = await getOrgSettings();
  if (e.date < utcToZoned(new Date(), defaultTimezone).date) throw new Error("Choose today or a future date.");
  await db.transaction(async (tx) => {
    // One entry per date keeps things unambiguous for staff and coordinators.
    await tx.delete(availabilityExceptions).where(and(eq(availabilityExceptions.staffId, staffId), eq(availabilityExceptions.date, e.date)));
    await tx.insert(availabilityExceptions).values({ ...e, staffId });
    await recordAudit({ actorId, action: "availability.exception", entityType: "staff_profile", entityId: staffId, after: e }, tx);
  });
}

export async function removeAvailabilityException(actorId: string, staffId: string, exceptionId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(availabilityExceptions).where(and(eq(availabilityExceptions.id, exceptionId), eq(availabilityExceptions.staffId, staffId)));
    await recordAudit({ actorId, action: "availability.exception_remove", entityType: "staff_profile", entityId: staffId, after: { exceptionId } }, tx);
  });
}

export async function getAvailability(staffId: string) {
  const [rules, exceptions] = await Promise.all([
    db.select().from(availabilityRules).where(eq(availabilityRules.staffId, staffId)).orderBy(availabilityRules.weekday, availabilityRules.startTime),
    db
      .select()
      .from(availabilityExceptions)
      .where(and(eq(availabilityExceptions.staffId, staffId), gte(availabilityExceptions.date, sql`current_date`)))
      .orderBy(availabilityExceptions.date),
  ]);
  return { rules, exceptions };
}
