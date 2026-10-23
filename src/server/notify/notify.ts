// Creates an in-app notification and (optionally) an email, both idempotent by dedupe key.
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications } from "@/server/db/schema";
import { sendEmail } from "./mailer";

export type NotifyInput = {
  dedupeKey: string;
  userId: string | null; // null: the recipient has no account yet (email only)
  type: string;
  title: string;
  body?: string;
  href?: string;
  payload?: Record<string, unknown>;
  email?: { to: string; subject: string; text: string; html?: string };
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
  if (input.email) {
    const result = await sendEmail({ ...input.email, notificationId, dedupeKey: `${input.dedupeKey}:email` });
    if (result.status === "failed") throw new Error(`Email to ${input.email.to} failed`);
  }
}
