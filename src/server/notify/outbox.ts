// Transactional outbox. Domain code calls enqueue() inside its transaction; processOutbox()
// later turns events into notifications/emails. Each event has a dedupe key, and every
// notification/email it produces has one too, so retries never send twice.
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { outboxEvents } from "@/server/db/schema";

export type OutboxEvent =
  | { type: "offer.sent"; payload: { staffId: string; bookingIds: string[] } }
  | { type: "offer.response"; payload: { bookingId: string; response: "interested" | "unavailable" | "more_info" } }
  | { type: "booking.confirmed"; payload: { bookingId: string } }
  | { type: "booking.cancelled"; payload: { bookingId: string; byStaff: boolean } }
  | { type: "booking.waitlisted"; payload: { bookingId: string } }
  | { type: "shift.changed"; payload: { shiftId: string; changeId: string } }
  | { type: "shift.cancelled"; payload: { shiftId: string; bookingIds: string[] } }
  | { type: "announcement.posted"; payload: { announcementId: string } }
  | { type: "document.published"; payload: { documentId: string; version: number } }
  | { type: "message.posted"; payload: { messageId: string } }
  | { type: "shift.reminder"; payload: { bookingId: string } }
  | { type: "timesheet.reminder"; payload: { bookingId: string } }
  | { type: "timesheet.submitted"; payload: { timesheetId: string } }
  | { type: "timesheet.needs_review"; payload: { timesheetId: string } }
  | { type: "timesheet.approved"; payload: { timesheetId: string; corrected?: boolean } }
  | { type: "payment.paid"; payload: { batchId: string; staffId: string } };

export async function enqueue(tx: Tx | typeof db, event: OutboxEvent & { dedupeKey?: string }) {
  await tx
    .insert(outboxEvents)
    .values({ type: event.type, payload: event.payload, dedupeKey: event.dedupeKey ?? null })
    .onConflictDoNothing({ target: outboxEvents.dedupeKey });
}

export type Handler = (payload: Record<string, unknown>, eventId: string) => Promise<void>;

const MAX_ATTEMPTS = 5;

/**
 * Processes due events. Safe to run concurrently (rows are claimed with SKIP LOCKED).
 * Returns counts for monitoring and tests.
 */
export async function processOutbox(handlers: Record<string, Handler>, opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 50;
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: outboxEvents.id, type: outboxEvents.type, payload: outboxEvents.payload, attempts: outboxEvents.attempts })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.status, "pending"), lte(outboxEvents.availableAt, sql`now()`)))
      .orderBy(outboxEvents.createdAt)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length) {
      await tx
        .update(outboxEvents)
        .set({ status: "processing", claimedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1` })
        .where(inArray(outboxEvents.id, rows.map((r) => r.id)));
    }
    return rows;
  });

  let done = 0;
  let failed = 0;
  for (const event of claimed) {
    const handler = handlers[event.type];
    try {
      if (!handler) throw new Error(`No handler for outbox event type "${event.type}"`);
      await handler(event.payload as Record<string, unknown>, event.id);
      await db.update(outboxEvents).set({ status: "done", processedAt: new Date(), lastError: null }).where(eq(outboxEvents.id, event.id));
      done++;
    } catch (err) {
      failed++;
      const attempts = event.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[outbox] ${event.type} ${event.id} failed (attempt ${attempts})`, err);
      await db
        .update(outboxEvents)
        .set({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          lastError: message.slice(0, 2000),
          // Exponential backoff: 1, 2, 4, 8 minutes.
          availableAt: sql`now() + (${2 ** (attempts - 1)} || ' minutes')::interval`,
        })
        .where(eq(outboxEvents.id, event.id));
    }
  }
  return { claimed: claimed.length, done, failed };
}

/** Events stuck in "processing" (e.g. the process died mid-run) are released after 10 minutes. */
export async function releaseStuckEvents() {
  await db
    .update(outboxEvents)
    .set({ status: "pending" })
    .where(and(eq(outboxEvents.status, "processing"), sql`${outboxEvents.claimedAt} < now() - interval '10 minutes'`));
}
