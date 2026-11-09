// Creates an in-app notification and (optionally) an email, both idempotent by dedupe key.
//
// Email categories:
//  - essential: about work the person accepted, their pay, account or security. Always sent.
//  - shift_opportunity: offers of new shifts. Contractors can switch these emails off (the in-app
//    notification still appears).
//  - marketing: anything else (news, promotions). Sent only with the contractor's recorded consent
//    to an RGXM-approved "marketing_email" purpose. No marketing templates exist yet.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications, staffConsentEvents, staffEmailPreferences, staffProfiles } from "@/server/db/schema";
import { sendEmail } from "./mailer";

export type EmailCategory = "essential" | "shift_opportunity" | "marketing";

/** Category by notification type; anything not listed is essential. */
export const EMAIL_CATEGORY: Record<string, EmailCategory> = { offer: "shift_opportunity" };

/** Whether an email of this category may be sent to the person with this account. */
export async function emailAllowed(category: EmailCategory, userId: string | null, email: string) {
  if (category === "essential") return true;
  const [staff] = await db
    .select({ id: staffProfiles.id })
    .from(staffProfiles)
    .where(userId ? eq(staffProfiles.userId, userId) : eq(staffProfiles.email, email));
  if (!staff) return category !== "marketing";
  if (category === "shift_opportunity") {
    const [pref] = await db.select({ on: staffEmailPreferences.shiftOpportunityEmails }).from(staffEmailPreferences).where(eq(staffEmailPreferences.staffId, staff.id));
    return pref?.on ?? true;
  }
  const [consent] = await db
    .select({ granted: staffConsentEvents.granted })
    .from(staffConsentEvents)
    .where(and(eq(staffConsentEvents.staffId, staff.id), eq(staffConsentEvents.purposeKey, "marketing_email")))
    .orderBy(desc(staffConsentEvents.recordedAt))
    .limit(1);
  return consent?.granted ?? false;
}

export type NotifyInput = {
  dedupeKey: string;
  userId: string | null; // null: the recipient has no account yet (email only)
  type: string;
  title: string;
  body?: string;
  href?: string;
  payload?: Record<string, unknown>;
  email?: { to: string; subject: string; text: string; html?: string };
  emailCategory?: EmailCategory;
};

export async function notify(input: NotifyInput) {
  let notificationId: string | undefined;
  if (input.userId) {
    const [row] = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        payload: input.payload ?? {},
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id });
    notificationId = row?.id;
    if (!notificationId) {
      const [existing] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.dedupeKey, input.dedupeKey));
      notificationId = existing?.id;
    }
  }
  const category = input.emailCategory ?? EMAIL_CATEGORY[input.type] ?? "essential";
  if (input.email && (await emailAllowed(category, input.userId, input.email.to))) {
    const result = await sendEmail({ ...input.email, notificationId, dedupeKey: `${input.dedupeKey}:email` });
    if (result.status === "failed") throw new Error(`Email to ${input.email.to} failed`);
  }
}
