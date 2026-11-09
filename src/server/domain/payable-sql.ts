// SQL fragments shared by the payments and invoice modules.
import { sql } from "drizzle-orm";
import { payableItems, staffProfiles, staffSensitive } from "@/server/db/schema";

/** Current GST/HST snapshot per person, compared with the one stored on each line. */
export const currentRegSnapshot = sql<string>`coalesce(${staffSensitive.gstRegistrationStatus}, 'unknown') || ':' || coalesce(${staffSensitive.gstVerificationStatus}, 'unverified')`;

/** Lines whose basis no longer matches the person's pay details (classification or GST/HST). Needs staff_profiles and staff_sensitive joined. */
export const staleLine = sql<boolean>`(
  ${payableItems.classification} <> ${staffProfiles.classification}
  or (${payableItems.taxStatus} in ('legacy_hst', 'legacy_none') and ((${payableItems.taxCents} > 0) <> coalesce(${staffSensitive.taxRegistered}, false)))
  or (${payableItems.taxStatus} in ('calculated', 'no_tax', 'review_required') and ${payableItems.registrationSnapshot} is distinct from ${currentRegSnapshot})
)`;
