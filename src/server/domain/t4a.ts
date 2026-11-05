// Year-end T4A summary: fees paid to each contractor in a calendar year (by the date payment was
// recorded), with the name, business number and address a T4A slip needs. RGXM's accountant
// prepares and files the slips and collects SINs directly (the platform deliberately doesn't store
// them); the CSV leaves a SIN column for them to fill in. Demo data is never included.
import { and, eq, sql } from "drizzle-orm";
import { toCsv } from "@/lib/csv";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { payableItems, paymentBatches, paymentBatchItems, staffProfiles, staffSensitive } from "@/server/db/schema";
import { centsToDecimal } from "./pay-rules";

/** CRA requires a T4A for fees for services when the year's total is over $500. */
export const T4A_THRESHOLD_CENTS = 500_00;

export async function getT4aSummary(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Invalid year");
  const paidYear = sql`extract(year from (${paymentBatchItems.paidAt} at time zone 'America/Toronto'))`;
  const rows = await db
    .select({
      staffId: staffProfiles.id,
      firstName: staffProfiles.firstName,
      lastName: staffProfiles.lastName,
      email: staffProfiles.email,
      legalName: staffSensitive.legalName,
      businessName: staffSensitive.businessName,
      businessNumber: staffSensitive.businessNumber,
      gstHstNumber: staffSensitive.gstHstNumber,
      mailingStreet: staffSensitive.mailingStreet,
      mailingCity: staffSensitive.mailingCity,
      mailingProvince: staffSensitive.mailingProvince,
      mailingPostalCode: staffSensitive.mailingPostalCode,
      feesCents: sql<number>`sum(${payableItems.baseCents})::bigint`.mapWith(Number),
      hstCents: sql<number>`sum(${payableItems.taxCents})::bigint`.mapWith(Number),
      totalCents: sql<number>`sum(${paymentBatchItems.amountCents})::bigint`.mapWith(Number),
      payments: sql<number>`count(*)::int`,
    })
    .from(paymentBatchItems)
    .innerJoin(paymentBatches, eq(paymentBatches.id, paymentBatchItems.batchId))
    .innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId))
    .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
    .leftJoin(staffSensitive, eq(staffSensitive.staffId, staffProfiles.id))
    .where(
      and(
        eq(paymentBatches.type, "contractor"),
        eq(paymentBatches.isDemo, false),
        eq(paymentBatchItems.active, true),
        sql`${paymentBatchItems.paidAt} is not null`,
        sql`${paidYear} = ${year}`,
      ),
    )
    .groupBy(staffProfiles.id, staffSensitive.staffId)
    .orderBy(staffProfiles.lastName, staffProfiles.firstName);

  return rows.map((r) => {
    const missing = [
      !r.legalName && "legal name",
      !(r.mailingStreet && r.mailingCity && r.mailingProvince && r.mailingPostalCode) && "mailing address",
    ].filter((x): x is string => Boolean(x));
    return { ...r, slipRequired: r.feesCents > T4A_THRESHOLD_CENTS, missing };
  });
}
export type T4aRow = Awaited<ReturnType<typeof getT4aSummary>>[number];

/** The CSV for the accountant (they add SINs). Every download is audited. */
export async function buildT4aCsv(actorId: string, year: number) {
  const rows = await getT4aSummary(year);
  const headers = [
    "Recipient legal name",
    "Business name",
    "SIN (accountant to add)",
    "Business number",
    "Street",
    "City",
    "Province",
    "Postal code",
    "Fees for services before HST (box 048)",
    "HST paid",
    "Total paid",
    "GST/HST number",
    "Payments",
    "Over $500",
    "Missing details",
    "Email",
  ];
  const data = rows.map((r) => [
    r.legalName ?? `${r.firstName} ${r.lastName}`,
    r.businessName ?? "",
    "",
    r.businessNumber ?? "",
    r.mailingStreet ?? "",
    r.mailingCity ?? "",
    r.mailingProvince ?? "",
    r.mailingPostalCode ?? "",
    centsToDecimal(r.feesCents),
    centsToDecimal(r.hstCents),
    centsToDecimal(r.totalCents),
    r.gstHstNumber ?? "",
    r.payments,
    r.slipRequired ? "Yes" : "No",
    r.missing.join("; "),
    r.email,
  ]);
  await recordAudit({ actorId, action: "t4a.export", entityType: "report", entityId: `t4a-${year}`, after: { year, recipients: rows.length } });
  return { csv: `﻿${toCsv(headers, data)}`, fileName: `RGXM-T4A-summary-${year}.csv`, count: rows.length };
}
