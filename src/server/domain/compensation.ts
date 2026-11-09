// Project compensation: meal allowances, full-day per diems, mileage and bonuses. Each category is
// switched on per project (all off by default). Items are recorded per contractor and work date,
// tied to a booked shift, with the rate and amount snapshotted; approval by an authorised RGXM
// user creates the bill line. The database enforces one meal of each kind (and one per diem) per
// contractor per date across all shifts, and never a per diem together with meal allowances.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { utcToZoned } from "@/lib/time";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { bookings, compensationItems, payableItems, projectCompensationSettings, projects, shifts, staffProfiles } from "@/server/db/schema";
import { dollarsToCents, multiplyToCents, normalizeKm } from "./money";
import { createPayableForCompensation, PaymentError } from "./payments";

export class CompensationError extends Error {}

export const COMPENSATION_DEFAULTS = { breakfastCents: 2000, lunchCents: 2500, dinnerCents: 4000, perDiemCents: 8500, mileageRate: "0.7300" } as const;
const MEALS = ["meal_breakfast", "meal_lunch", "meal_dinner"] as const;
export type CompensationCategory = (typeof MEALS)[number] | "per_diem" | "mileage" | "bonus";

export async function getCompensationSettings(projectId: string) {
  const [row] = await db.select().from(projectCompensationSettings).where(eq(projectCompensationSettings.projectId, projectId));
  return (
    row ?? {
      projectId,
      mealsEnabled: false,
      perDiemEnabled: false,
      mileageEnabled: false,
      bonusEnabled: false,
      ...COMPENSATION_DEFAULTS,
      eligibleMeals: [...MEALS] as string[],
      bonusCents: null as number | null,
      bonusConditions: null as string | null,
      notes: null as string | null,
      updatedBy: null,
      updatedAt: null,
    }
  );
}
export type CompensationSettings = Awaited<ReturnType<typeof getCompensationSettings>>;

const money = z.string().trim().regex(/^\d{1,5}(\.\d{1,2})?$/, "Enter an amount like 25 or 25.00");
const rate = z.string().trim().regex(/^\d{1,2}(\.\d{1,4})?$/, "Enter a rate like 0.73");
const optText = (max: number) => z.preprocess((v) => (typeof v === "string" && !v.trim() ? null : v), z.string().trim().max(max).nullable().optional());
export const compensationSettingsSchema = z
  .object({
    mealsEnabled: z.boolean(),
    perDiemEnabled: z.boolean(),
    mileageEnabled: z.boolean(),
    bonusEnabled: z.boolean(),
    breakfast: money,
    lunch: money,
    dinner: money,
    perDiem: money,
    mileageRate: rate,
    // Defaults to all three meals when not given (older forms).
    eligibleMeals: z.array(z.enum(MEALS)).optional(),
    bonusAmount: z.preprocess((v) => (typeof v === "string" && !v.trim() ? null : v), money.nullable().optional()),
    bonusConditions: optText(500),
    notes: optText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.mealsEnabled && v.eligibleMeals && !v.eligibleMeals.length) ctx.addIssue({ code: "custom", path: ["eligibleMeals"], message: "Choose at least one eligible meal, or switch meal allowances off." });
    // The agreement: a bonus applies only when its amount (or calculation) and conditions are communicated.
    if (v.bonusEnabled && !v.bonusConditions) ctx.addIssue({ code: "custom", path: ["bonusConditions"], message: "Describe when the bonus is earned (and how it's calculated, if not a fixed amount)." });
  });
const settingsSchema = compensationSettingsSchema;
export type CompensationSettingsInput = z.input<typeof compensationSettingsSchema>;

/** Saves a project's switches and rates. Items already recorded keep the rates they were recorded with. */
export async function saveCompensationSettings(actorId: string, projectId: string, raw: z.input<typeof settingsSchema>, outerTx?: Tx) {
  const v = settingsSchema.parse(raw);
  const values = {
    mealsEnabled: v.mealsEnabled,
    perDiemEnabled: v.perDiemEnabled,
    mileageEnabled: v.mileageEnabled,
    bonusEnabled: v.bonusEnabled,
    breakfastCents: dollarsToCents(v.breakfast),
    lunchCents: dollarsToCents(v.lunch),
    dinnerCents: dollarsToCents(v.dinner),
    perDiemCents: dollarsToCents(v.perDiem),
    mileageRate: v.mileageRate,
    eligibleMeals: v.eligibleMeals ?? [...MEALS],
    bonusCents: v.bonusEnabled && v.bonusAmount ? dollarsToCents(v.bonusAmount) : null,
    bonusConditions: v.bonusEnabled ? (v.bonusConditions ?? null) : null,
    notes: v.notes ?? null,
    updatedBy: actorId,
  };
  const run = async (tx: Tx) => {
    const [before] = await tx.select().from(projectCompensationSettings).where(eq(projectCompensationSettings.projectId, projectId));
    await tx.insert(projectCompensationSettings).values({ projectId, ...values }).onConflictDoUpdate({ target: projectCompensationSettings.projectId, set: values });
    const after = { ...values, updatedBy: undefined };
    await recordAudit({ actorId, action: "project.compensation_settings", entityType: "project", entityId: projectId, projectId, before: before ?? null, after }, tx);
  };
  if (outerTx) await run(outerTx);
  else await db.transaction(run);
}

const recordSchema = z.discriminatedUnion("category", [
  z.object({ category: z.enum(MEALS), staffId: z.string().uuid(), bookingId: z.string().uuid() }),
  z.object({ category: z.literal("per_diem"), staffId: z.string().uuid(), bookingId: z.string().uuid() }),
  z.object({
    category: z.literal("mileage"),
    staffId: z.string().uuid(),
    bookingId: z.string().uuid(),
    km: z.string(),
    tripDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the trip date"),
    businessPurpose: z.string().trim().min(5, "Describe the business purpose of the trip").max(300),
  }),
  z.object({ category: z.literal("bonus"), staffId: z.string().uuid(), bookingId: z.string().uuid(), amount: money, reason: z.string().trim().min(5, "Give a reason for the bonus").max(300) }),
]);
export type RecordCompensationInput = z.input<typeof recordSchema>;

const ENABLED: Record<CompensationCategory, keyof CompensationSettings> = {
  meal_breakfast: "mealsEnabled",
  meal_lunch: "mealsEnabled",
  meal_dinner: "mealsEnabled",
  per_diem: "perDiemEnabled",
  mileage: "mileageEnabled",
  bonus: "bonusEnabled",
};

function friendly(err: unknown): never {
  const e = err as { code?: string; cause?: { code?: string; constraint?: string }; constraint?: string };
  const code = e.code ?? e.cause?.code;
  if (code === "23505") throw new CompensationError("This contractor already has that allowance for this date (one per day, across all shifts).");
  if (code === "23P01") throw new CompensationError("A full-day per diem and meal allowances can't both be paid for the same contractor and date.");
  throw err;
}

/** Records one allowance, mileage claim or bonus for a booked shift (pending approval). */
export async function recordCompensation(actorId: string, projectId: string, raw: RecordCompensationInput) {
  const v = recordSchema.parse(raw);
  const settings = await getCompensationSettings(projectId);
  if (!settings[ENABLED[v.category]]) throw new CompensationError("This kind of compensation isn't switched on for this project.");
  if ((MEALS as readonly string[]).includes(v.category) && !settings.eligibleMeals.includes(v.category)) throw new CompensationError("That meal isn't eligible on this project (for example, it's provided on site).");
  const [b] = await db
    .select({ staffId: bookings.staffId, projectId: bookings.projectId, status: bookings.status, shiftId: bookings.shiftId, startsAt: shifts.startsAt, timezone: shifts.timezone, isDemo: projects.isDemo })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .where(eq(bookings.id, v.bookingId));
  if (!b || b.projectId !== projectId || b.staffId !== v.staffId) throw new CompensationError("Choose one of this contractor's shifts on this project.");
  if (!["confirmed", "completed"].includes(b.status)) throw new CompensationError("Compensation can only be recorded for a confirmed or completed shift.");
  const workDate = utcToZoned(b.startsAt, b.timezone).date;

  let unitRate: string;
  let quantity = "1";
  let amountCents: number;
  if (v.category === "mileage") {
    try {
      quantity = normalizeKm(v.km);
    } catch (e) {
      throw new CompensationError((e as Error).message);
    }
    unitRate = settings.mileageRate;
    amountCents = multiplyToCents(quantity, unitRate);
  } else if (v.category === "bonus") {
    amountCents = dollarsToCents(v.amount);
    if (amountCents <= 0) throw new CompensationError("Enter a bonus amount greater than zero.");
    unitRate = v.amount;
  } else {
    const cents = v.category === "per_diem" ? settings.perDiemCents : v.category === "meal_breakfast" ? settings.breakfastCents : v.category === "meal_lunch" ? settings.lunchCents : settings.dinnerCents;
    amountCents = cents;
    unitRate = (cents / 100).toFixed(2);
  }
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(compensationItems)
        .values({
          staffId: v.staffId,
          projectId,
          shiftId: b.shiftId,
          bookingId: v.bookingId,
          workDate,
          category: v.category,
          unitRate,
          quantity,
          amountCents,
          tripDate: v.category === "mileage" ? v.tripDate : null,
          businessPurpose: v.category === "mileage" ? v.businessPurpose : null,
          reason: v.category === "bonus" ? v.reason : null,
          requestedBy: actorId,
        })
        .returning();
      await recordAudit({ actorId, action: "compensation.record", entityType: "compensation", entityId: row!.id, projectId, after: { category: v.category, workDate, amountCents, unitRate, quantity } }, tx);
      return row!;
    });
  } catch (err) {
    friendly(err);
  }
}

/** Approves (creating the bill line) or rejects a pending item. */
export async function decideCompensation(actorId: string, itemId: string, input: { approve: boolean; note?: string | null }) {
  try {
    return await db.transaction(async (tx) => {
      const [item] = await tx.select().from(compensationItems).where(eq(compensationItems.id, itemId)).for("update");
      if (!item) throw new CompensationError("Item not found.");
      if (item.status !== "pending") throw new CompensationError(`This item is already ${item.status}.`);
      if (!input.approve && !input.note?.trim()) throw new CompensationError("Give a reason for rejecting it.");
      await tx.update(compensationItems).set({ status: input.approve ? "approved" : "rejected", decidedBy: actorId, decidedAt: new Date(), decisionNote: input.note?.trim() || null }).where(eq(compensationItems.id, itemId));
      const payable = input.approve ? await createPayableForCompensation(tx, itemId, actorId) : null;
      await recordAudit({ actorId, action: input.approve ? "compensation.approve" : "compensation.reject", entityType: "compensation", entityId: itemId, projectId: item.projectId, after: { amountCents: item.amountCents, payableId: payable?.id ?? null }, reason: input.note?.trim() || null }, tx);
      return payable;
    });
  } catch (err) {
    if (err instanceof CompensationError || err instanceof PaymentError) throw err;
    friendly(err);
  }
}

/** Voids an item recorded in error. An approved one can only be voided before its line is batched. */
export async function voidCompensation(actorId: string, itemId: string, reason: string) {
  if (reason.trim().length < 3) throw new CompensationError("Give a reason.");
  await db.transaction(async (tx) => {
    const [item] = await tx.select().from(compensationItems).where(eq(compensationItems.id, itemId)).for("update");
    if (!item) throw new CompensationError("Item not found.");
    if (item.status === "void" || item.status === "rejected") throw new CompensationError(`This item is already ${item.status}.`);
    if (item.payableItemId) {
      const [p] = await tx.select().from(payableItems).where(eq(payableItems.id, item.payableItemId)).for("update");
      if (p && (p.status !== "pending" || p.billId)) throw new CompensationError("Its payment line is already batched or billed. Use an adjustment instead.");
      if (p) {
        await tx.update(payableItems).set({ status: "void", voidedAt: new Date(), voidedBy: actorId, voidReason: `Compensation voided: ${reason.trim()}` }).where(eq(payableItems.id, p.id));
      }
    }
    await tx.update(compensationItems).set({ status: "void", decisionNote: reason.trim(), decidedBy: actorId, decidedAt: new Date() }).where(eq(compensationItems.id, itemId));
    await recordAudit({ actorId, action: "compensation.void", entityType: "compensation", entityId: itemId, projectId: item.projectId, reason: reason.trim() }, tx);
  });
}

/** A project's compensation items with who/what, newest work date first. */
export async function listCompensation(projectId: string) {
  return db
    .select({
      id: compensationItems.id,
      staffId: compensationItems.staffId,
      name: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`,
      workDate: compensationItems.workDate,
      category: compensationItems.category,
      unitRate: compensationItems.unitRate,
      quantity: compensationItems.quantity,
      amountCents: compensationItems.amountCents,
      tripDate: compensationItems.tripDate,
      businessPurpose: compensationItems.businessPurpose,
      reason: compensationItems.reason,
      status: compensationItems.status,
      decisionNote: compensationItems.decisionNote,
      payableItemId: compensationItems.payableItemId,
      taxCents: payableItems.taxCents,
      taxStatus: payableItems.taxStatus,
    })
    .from(compensationItems)
    .innerJoin(staffProfiles, eq(staffProfiles.id, compensationItems.staffId))
    .leftJoin(payableItems, eq(payableItems.id, compensationItems.payableItemId))
    .where(eq(compensationItems.projectId, projectId))
    .orderBy(sql`${compensationItems.workDate} desc`, asc(staffProfiles.lastName));
}

/** Shifts that compensation can be recorded against (confirmed or completed bookings). */
export async function compensableBookings(projectId: string) {
  const rows = await db
    .select({ bookingId: bookings.id, staffId: bookings.staffId, name: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`, role: bookings.role, startsAt: shifts.startsAt, timezone: shifts.timezone })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(staffProfiles, eq(staffProfiles.id, bookings.staffId))
    .where(and(eq(bookings.projectId, projectId), inArray(bookings.status, ["confirmed", "completed"])))
    .orderBy(sql`${shifts.startsAt} desc`);
  return rows.map((r) => ({ ...r, workDate: utcToZoned(r.startsAt, r.timezone).date }));
}
