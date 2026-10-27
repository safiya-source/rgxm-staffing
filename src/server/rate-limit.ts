// App-level rate limits for actions that send messages, write data in bulk or produce files.
// Fixed windows counted in Postgres, so limits hold across server instances.
import { lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { appRateLimits } from "@/server/db/schema";
import { env } from "@/server/env";

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`You're doing that too often. Please wait ${retryAfterSeconds < 90 ? `${retryAfterSeconds} seconds` : `${Math.ceil(retryAfterSeconds / 60)} minutes`} and try again.`);
    this.name = "RateLimitError";
  }
}

export const LIMITS = {
  "message.send": { max: 20, windowSeconds: 600 },
  "offer.respond": { max: 60, windowSeconds: 600 },
  "attendance.record": { max: 30, windowSeconds: 600 },
  "upload": { max: 30, windowSeconds: 600 },
  "offers.send": { max: 30, windowSeconds: 600 },
  "export.payments": { max: 30, windowSeconds: 600 },
  "export.talent": { max: 20, windowSeconds: 600 },
  "export.personal_data": { max: 5, windowSeconds: 3600 },
} as const;
export type LimitName = keyof typeof LIMITS;

/** Counts one use of `name` by `subject` (usually a user id); throws RateLimitError over the limit. */
export async function rateLimit(name: LimitName, subject: string, now = new Date()) {
  // Shares the switch used for sign-in limits so local E2E runs aren't throttled (refused in production).
  if (env.AUTH_RATE_LIMIT === "off") return;
  const { max, windowSeconds } = LIMITS[name];
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(appRateLimits)
    .values({ key: `${name}:${subject}`, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [appRateLimits.key, appRateLimits.windowStart], set: { count: sql`${appRateLimits.count} + 1` } })
    .returning({ count: appRateLimits.count });
  if (row!.count > max) throw new RateLimitError(Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
}

/** Drops windows older than a day (called from the scheduled sweeps). */
export async function pruneRateLimits(now = new Date()) {
  await db.delete(appRateLimits).where(lt(appRateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
}
