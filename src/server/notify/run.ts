import { after } from "next/server";
import { handlers } from "./handlers";
import { processOutbox, releaseStuckEvents } from "./outbox";

export async function runOutbox(limit = 100) {
  await releaseStuckEvents();
  return processOutbox(handlers, { limit });
}

/**
 * Processes queued notifications after the current response is sent. The scheduled runner
 * (/api/cron/outbox) is the safety net for anything this misses or that needs a retry.
 */
export function kickOutbox() {
  after(async () => {
    try {
      await runOutbox();
    } catch (err) {
      console.error("[outbox] background run failed", err);
    }
  });
}
