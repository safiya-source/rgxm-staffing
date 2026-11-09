// Contractor tax details: legal/business name, GST/HST registration, business number and mailing
// address, used for sales tax on bill lines and year-end reporting. Contractors answer "Are you
// registered for GST/HST?" (Yes / No / Unsure); they never pick a tax rate. Any change to the
// answer or the number resets Finance's verification, so the next bill line goes to review. Entered by Finance/Admins on the talent
// profile, or by the contractor in the staff portal. SINs are deliberately NOT collected or stored
// here: RGXM's accountant collects them directly when preparing T4A slips.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PROVINCE_CODES } from "@/lib/provinces";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { staffProfiles, staffSensitive } from "@/server/db/schema";

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
    gstRegistrationStatus: z.enum(["yes", "no", "unsure"], { message: "Choose Yes, No or Unsure" }),
    gstRegistrationEffectiveDate: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date on your registration").nullable().optional()),
    gstHstNumber: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() || null : v),
      z.string().regex(/^\d{9}RT\d{4}$/, "GST/HST numbers look like 123456789 RT0001").nullable().optional(),
    ),
    mailingStreet: optText(200),
    mailingCity: optText(100),
    mailingProvince: z.preprocess(blankToNull, z.enum(PROVINCE_CODES).nullable().optional()),
    mailingPostalCode: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() || null : v),
      z.string().regex(/^[A-Z]\d[A-Z]\d[A-Z]\d$/, "Use a Canadian postal code, e.g. M5V 2T6").nullable().optional(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.gstRegistrationStatus === "yes") {
      if (!v.gstHstNumber) ctx.addIssue({ code: "custom", path: ["gstHstNumber"], message: "Enter your GST/HST registration number." });
      if (!v.businessName && !v.legalName) ctx.addIssue({ code: "custom", path: ["businessName"], message: "Enter the name your GST/HST account is registered under." });
      if (!v.gstRegistrationEffectiveDate) ctx.addIssue({ code: "custom", path: ["gstRegistrationEffectiveDate"], message: "Enter the date your registration took effect." });
    }
  });
export type TaxDetailsInput = z.input<typeof taxDetailsSchema>;

/** Saves tax details. `bySelf` marks a contractor updating their own record from the portal. */
export async function saveTaxDetails(actorId: string, staffId: string, raw: TaxDetailsInput, opts: { bySelf?: boolean } = {}) {
  const input = taxDetailsSchema.parse(raw);
  const registered = input.gstRegistrationStatus === "yes";
  const values = {
    legalName: input.legalName ?? null,
    businessName: input.businessName ?? null,
    businessNumber: input.businessNumber ?? null,
    taxRegistered: registered,
    gstRegistrationStatus: input.gstRegistrationStatus,
    gstRegistrationEffectiveDate: registered ? (input.gstRegistrationEffectiveDate ?? null) : null,
    gstHstNumber: registered ? (input.gstHstNumber ?? null) : null,
    mailingStreet: input.mailingStreet ?? null,
    mailingCity: input.mailingCity ?? null,
    mailingProvince: input.mailingProvince ?? null,
    mailingPostalCode: input.mailingPostalCode ?? null,
  };
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ taxRegistered: staffSensitive.taxRegistered, status: staffSensitive.gstRegistrationStatus, number: staffSensitive.gstHstNumber, effective: staffSensitive.gstRegistrationEffectiveDate, verification: staffSensitive.gstVerificationStatus })
      .from(staffSensitive)
      .where(eq(staffSensitive.staffId, staffId));
    // A changed answer, number or start date needs Finance to verify it again.
    const regChanged = !before || before.status !== values.gstRegistrationStatus || before.number !== values.gstHstNumber || before.effective !== values.gstRegistrationEffectiveDate;
    const verificationReset = regChanged ? { gstVerificationStatus: "unverified", gstVerifiedAt: null, gstVerifiedBy: null, gstVerificationReference: null } : {};
    // RGXM engages field staff as independent contractors only.
    await tx.update(staffProfiles).set({ classification: "contractor" }).where(eq(staffProfiles.id, staffId));
    await tx.insert(staffSensitive).values({ staffId, ...values }).onConflictDoUpdate({ target: staffSensitive.staffId, set: { ...values, ...verificationReset } });
    // Tax numbers and addresses are never copied into the audit log, only what changed in kind.
    await recordAudit(
      {
        actorId,
        action: opts.bySelf ? "staff.tax_details_self" : "staff.tax_details",
        entityType: "staff_profile",
        entityId: staffId,
        before: { gstRegistrationStatus: before?.status ?? null, verification: before?.verification ?? null },
        after: { gstRegistrationStatus: values.gstRegistrationStatus, verificationReset: regChanged, hasBusinessNumber: Boolean(values.businessNumber), hasMailingAddress: Boolean(values.mailingStreet) },
      },
      tx,
    );
  });
}

/** What the tax-details forms show. */
export async function getTaxDetails(staffId: string) {
  const [s] = await db.select().from(staffSensitive).where(eq(staffSensitive.staffId, staffId));
  return {
    legalName: s?.legalName ?? null,
    businessName: s?.businessName ?? null,
    businessNumber: s?.businessNumber ?? null,
    taxRegistered: s?.taxRegistered ?? false,
    gstRegistrationStatus: (s?.gstRegistrationStatus ?? "unknown") as "yes" | "no" | "unsure" | "unknown",
    gstRegistrationEffectiveDate: s?.gstRegistrationEffectiveDate ?? null,
    gstVerificationStatus: (s?.gstVerificationStatus ?? "unverified") as "unverified" | "verified" | "rejected",
    gstVerifiedAt: s?.gstVerifiedAt ?? null,
    gstVerificationReference: s?.gstVerificationReference ?? null,
    gstHstNumber: s?.gstHstNumber ?? null,
    mailingStreet: s?.mailingStreet ?? null,
    mailingCity: s?.mailingCity ?? null,
    mailingProvince: s?.mailingProvince ?? null,
    mailingPostalCode: s?.mailingPostalCode ?? null,
  };
}
export type TaxDetails = Awaited<ReturnType<typeof getTaxDetails>>;
