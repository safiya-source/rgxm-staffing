// Expense reimbursements: purchases a contractor made on RGXM's behalf with their own money. The
// contractor submits one with a receipt; RGXM approves it like any allowance (on the project's
// Allowances & bonuses page), which creates a bill line repaid at cost with no GST/HST.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate, utcToZoned } from "@/lib/time";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { bookings, compensationItems, payableItems, projects, shifts } from "@/server/db/schema";
import { enqueue } from "@/server/notify/outbox";
import { getOrgSettings } from "@/server/settings";
import { storage, UploadError, validateUpload } from "@/server/storage";
import { CompensationError } from "./compensation";
import { dollarsToCents } from "./money";

/** Receipts are photos or PDFs. */
export const RECEIPT_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp"] as const;
const MAX_CLAIM_CENTS = 500_000; // $5,000 per receipt; anything larger is arranged with RGXM directly

export const expenseSchema = z.object({
  projectId: z.string().uuid("Choose the project it was for"),
  bookingId: z.preprocess((v) => (v === "" || v == null ? null : v), z.string().uuid().nullable()),
  purchaseDate: z.string().refine(isIsoDate, "Enter the purchase date"),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,5}(\.\d{1,2})?$/, "Enter the total paid, e.g. 23.45"),
  vendor: z.string().trim().min(2, "Where did you buy it?").max(120),
  description: z.string().trim().min(5, "Describe what you bought and why").max(500),
});
export type ExpenseInput = z.input<typeof expenseSchema>;

/** Projects the contractor can claim for: ones where they have a confirmed or completed shift. */
export async function claimableProjects(staffId: string) {
  const rows = await db
    .select({ bookingId: bookings.id, projectId: projects.id, projectName: projects.name, startsAt: shifts.startsAt, timezone: shifts.timezone, role: bookings.role })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .where(and(eq(bookings.staffId, staffId), inArray(bookings.status, ["confirmed", "completed"])))
    .orderBy(desc(shifts.startsAt))
    .limit(200);
  return rows.map((r) => ({ ...r, date: utcToZoned(r.startsAt, r.timezone).date }));
}

/** Stores the receipt and records the claim (pending RGXM approval). */
export async function submitExpense(me: { userId: string; staffId: string }, raw: ExpenseInput, receipt: { name: string; data: Buffer }) {
  const v = expenseSchema.parse(raw);
  const amountCents = dollarsToCents(v.amount);
  if (amountCents <= 0) throw new CompensationError("Enter an amount greater than zero.");
  if (amountCents > MAX_CLAIM_CENTS) throw new CompensationError("That's more than $5,000. Contact RGXM to arrange a large reimbursement.");
  const { defaultTimezone } = await getOrgSettings();
  if (v.purchaseDate > utcToZoned(new Date(), defaultTimezone).date) throw new CompensationError("The purchase date can't be in the future.");

  const claimable = await claimableProjects(me.staffId);
  if (!claimable.some((c) => c.projectId === v.projectId)) throw new CompensationError("Choose a project you've been booked on.");
  if (v.bookingId && !claimable.some((c) => c.bookingId === v.bookingId && c.projectId === v.projectId)) throw new CompensationError("Choose one of your shifts on that project.");
  const shiftId = v.bookingId ? ((await db.select({ shiftId: bookings.shiftId }).from(bookings).where(eq(bookings.id, v.bookingId)))[0]?.shiftId ?? null) : null;

  const ext = receipt.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(RECEIPT_EXTENSIONS as readonly string[]).includes(ext)) throw new UploadError("Upload the receipt as a photo (JPG, PNG, WEBP) or a PDF.");
  const { safeName, contentType } = validateUpload(receipt.name, receipt.data);
  const key = `receipts/${me.staffId}/${randomUUID()}/${safeName}`;
  // Store first; if the database write fails the orphaned object is harmless and unreachable.
  await storage().put(key, receipt.data, contentType);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(compensationItems)
      .values({
        staffId: me.staffId,
        projectId: v.projectId,
        shiftId,
        bookingId: v.bookingId,
        workDate: v.purchaseDate,
        category: "reimbursement",
        unitRate: (amountCents / 100).toFixed(2),
        quantity: "1",
        amountCents,
        businessPurpose: v.description,
        vendor: v.vendor,
        receiptKey: key,
        receiptName: safeName,
        receiptContentType: contentType,
        requestedBy: me.userId,
      })
      .returning({ id: compensationItems.id });
    await enqueue(tx, { type: "expense.submitted", payload: { itemId: row!.id }, dedupeKey: `expense.submitted:${row!.id}` });
    await recordAudit(
      { actorId: me.userId, action: "expense.submit", entityType: "compensation", entityId: row!.id, projectId: v.projectId, after: { amountCents, purchaseDate: v.purchaseDate, vendor: v.vendor } },
      tx,
    );
    return row!.id;
  });
}

/** The contractor's own claims, newest first, with whether they've been paid. */
export async function myExpenses(staffId: string) {
  return db
    .select({
      id: compensationItems.id,
      projectName: projects.name,
      purchaseDate: compensationItems.workDate,
      amountCents: compensationItems.amountCents,
      vendor: compensationItems.vendor,
      description: compensationItems.businessPurpose,
      status: compensationItems.status,
      decisionNote: compensationItems.decisionNote,
      receiptName: compensationItems.receiptName,
      paymentStatus: payableItems.status,
    })
    .from(compensationItems)
    .innerJoin(projects, eq(projects.id, compensationItems.projectId))
    .leftJoin(payableItems, eq(payableItems.id, compensationItems.payableItemId))
    .where(and(eq(compensationItems.staffId, staffId), eq(compensationItems.category, "reimbursement")))
    .orderBy(desc(compensationItems.requestedAt))
    .limit(200);
}

/** The receipt file for a claim (the caller checks who may see it). */
export async function receiptFor(itemId: string) {
  const [c] = await db
    .select({ staffId: compensationItems.staffId, projectId: compensationItems.projectId, key: compensationItems.receiptKey, name: compensationItems.receiptName, contentType: compensationItems.receiptContentType })
    .from(compensationItems)
    .where(and(eq(compensationItems.id, itemId), sql`${compensationItems.receiptKey} is not null`));
  if (!c) return null;
  return { ...c, data: () => storage().get(c.key!) };
}
