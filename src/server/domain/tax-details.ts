// Contractor tax details: legal/business name, GST/HST registration, business number, SIN and
// mailing address, used for HST on payables and year-end T4A slips. Entered by Finance/Admins on
// the talent profile, or by the contractor in the staff portal. SINs are encrypted and write-only.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PROVINCE_CODES } from "@/lib/provinces";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { staffProfiles, staffSensitive } from "@/server/db/schema";
import { encryptSin, normalizeSin, TaxIdError } from "@/server/crypto/tax-id";

export class TaxDetailsError extends Error {}

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v);
const optText = (max: number) => z.preprocess(blankToNull, z.string().max(max).nullable().optional());

export const taxDetailsSchema = z
  .object({
    legalName: optText(160),
    businessName: optText(160),
    businessNumber: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() || null : v),
      z.string().regex(/^\d{9}([A-Z]{2}\d{4})?$/, "Business numbers are 9 digits, e.g. 123456789").nullable().optional(),
    ),
    taxRegistered: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()),
    gstHstNumber: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() || null : v),
      z.string().regex(/^\d{9}RT\d{4}$/, "GST/HST numbers look like 123456789 RT0001").nullable().optional(),
    ),
    // Blank keeps the SIN already on file.
    sin: optText(20),
    mailingStreet: optText(200),
    mailingCity: optText(100),
    mailingProvince: z.preprocess(blankToNull, z.enum(PROVINCE_CODES).nullable().optional()),
    mailingPostalCode: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() || null : v),
      z.string().regex(/^[A-Z]\d[A-Z]\d[A-Z]\d$/, "Use a Canadian postal code, e.g. M5V 2T6").nullable().optional(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.taxRegistered && !v.gstHstNumber) ctx.addIssue({ code: "custom", path: ["gstHstNumber"], message: "Enter the GST/HST number for a registered contractor." });
  });
export type TaxDetailsInput = z.input<typeof taxDetailsSchema>;

/** Saves tax details. `bySelf` marks a contractor updating their own record from the portal. */
export async function saveTaxDetails(actorId: string, staffId: string, raw: TaxDetailsInput, opts: { bySelf?: boolean } = {}) {
  const input = taxDetailsSchema.parse(raw);
  let sin: { sinEncrypted: string; sinLast3: string } | null = null;
  if (input.sin) {
    const digits = normalizeSin(input.sin);
    if (!digits) throw new TaxDetailsError("That SIN isn't valid. Check the 9 digits.");
    try {
      sin = { sinEncrypted: encryptSin(digits), sinLast3: digits.slice(-3) };
    } catch (err) {
      if (err instanceof TaxIdError) throw new TaxDetailsError(err.message);
      throw err;
    }
  }
  const values = {
    legalName: input.legalName ?? null,
    businessName: input.businessName ?? null,
    businessNumber: input.businessNumber ?? null,
    taxRegistered: input.taxRegistered,
    gstHstNumber: input.taxRegistered ? (input.gstHstNumber ?? null) : null,
    mailingStreet: input.mailingStreet ?? null,
    mailingCity: input.mailingCity ?? null,
    mailingProvince: input.mailingProvince ?? null,
    mailingPostalCode: input.mailingPostalCode ?? null,
    ...(sin ?? {}),
  };
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ taxRegistered: staffSensitive.taxRegistered }).from(staffSensitive).where(eq(staffSensitive.staffId, staffId));
    // RGXM engages field staff as independent contractors only.
    await tx.update(staffProfiles).set({ classification: "contractor" }).where(eq(staffProfiles.id, staffId));
    await tx.insert(staffSensitive).values({ staffId, ...values }).onConflictDoUpdate({ target: staffSensitive.staffId, set: values });
    // Tax numbers and addresses are never copied into the audit log, only what changed in kind.
    await recordAudit(
      {
        actorId,
        action: opts.bySelf ? "staff.tax_details_self" : "staff.tax_details",
        entityType: "staff_profile",
        entityId: staffId,
        before: { taxRegistered: before?.taxRegistered ?? false },
        after: { taxRegistered: values.taxRegistered, sinUpdated: Boolean(sin), hasBusinessNumber: Boolean(values.businessNumber), hasMailingAddress: Boolean(values.mailingStreet) },
      },
      tx,
    );
  });
}

/** What the forms show: never the SIN itself, only whether one is on file and its last 3 digits. */
export async function getTaxDetails(staffId: string) {
  const [s] = await db.select().from(staffSensitive).where(eq(staffSensitive.staffId, staffId));
  return {
    legalName: s?.legalName ?? null,
    businessName: s?.businessName ?? null,
    businessNumber: s?.businessNumber ?? null,
    taxRegistered: s?.taxRegistered ?? false,
    gstHstNumber: s?.gstHstNumber ?? null,
    sinLast3: s?.sinLast3 ?? null,
    mailingStreet: s?.mailingStreet ?? null,
    mailingCity: s?.mailingCity ?? null,
    mailingProvince: s?.mailingProvince ?? null,
    mailingPostalCode: s?.mailingPostalCode ?? null,
  };
}
export type TaxDetails = Awaited<ReturnType<typeof getTaxDetails>>;
