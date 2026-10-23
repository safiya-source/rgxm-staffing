// Outbound email. Every message is recorded in notification_deliveries first; the
// configured transport then delivers it. With MAIL_TRANSPORT=log (development) nothing
// leaves the system. Demo recipients are always suppressed, regardless of transport.
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { notificationDeliveries, users } from "@/server/db/schema";
import { env } from "@/server/env";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  notificationId?: string;
  // Same key → same message is recorded and sent at most once.
  dedupeKey?: string;
  // Contains a credential (sign-in or password link). When real delivery is on, the stored
  // copy is redacted so nobody can use the link from the mail log.
  containsSecretLink?: boolean;
};

const redact = (s: string | undefined) => s?.replace(/https?:\/\/\S+/g, "[link redacted]");

export type EmailResult = { deliveryId: string | null; status: "sent" | "logged" | "suppressed" | "failed" | "duplicate" };

const DEMO_DOMAIN = /\.test$/i;

export async function isDemoRecipient(email: string): Promise<boolean> {
  if (DEMO_DOMAIN.test(email.split("@")[1] ?? "")) return true;
  const [row] = await db
    .select({ isDemo: users.isDemo })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1);
  return row?.isDemo ?? false;
}

export async function sendEmail(message: OutgoingEmail): Promise<EmailResult> {
  const suppressed = await isDemoRecipient(message.to);
  const transport = env.MAIL_TRANSPORT;

  const [delivery] = await db
    .insert(notificationDeliveries)
    .values({
      notificationId: message.notificationId,
      channel: "email",
      toAddress: message.to,
      subject: message.subject,
      bodyText: message.containsSecretLink && transport !== "log" ? redact(message.text) : message.text,
      bodyHtml: message.containsSecretLink && transport !== "log" ? null : message.html,
      transport,
      status: suppressed ? "suppressed" : transport === "log" ? "logged" : "queued",
      dedupeKey: message.dedupeKey,
    })
    .onConflictDoNothing({ target: notificationDeliveries.dedupeKey })
    .returning({ id: notificationDeliveries.id, status: notificationDeliveries.status });

  if (!delivery) return { deliveryId: null, status: "duplicate" };
  if (delivery.status === "suppressed" || delivery.status === "logged") {
    if (env.NODE_ENV === "development") {
      console.info(`[mail:${delivery.status}] to=${message.to} subject="${message.subject}"\n${message.text}`);
    }
    return { deliveryId: delivery.id, status: delivery.status };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { id?: string };
    await db
      .update(notificationDeliveries)
      .set({ status: "sent", sentAt: new Date(), providerMessageId: body.id })
      .where(eq(notificationDeliveries.id, delivery.id));
    return { deliveryId: delivery.id, status: "sent" };
  } catch (err) {
    await db
      .update(notificationDeliveries)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .where(eq(notificationDeliveries.id, delivery.id));
    console.error("[mail] delivery failed", delivery.id, err);
    return { deliveryId: delivery.id, status: "failed" };
  }
}
