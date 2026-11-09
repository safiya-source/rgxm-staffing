// Step-up ("fresh") authentication and sign-in context tracking for RGXM staff.
//  - A successful two-step code entry (at sign-in or later, from inside the app) marks the session
//    as freshly verified. Payment approval and payment-detail changes need that within
//    STEP_UP_MAX_AGE_MS.
//  - Sign-ins from a network/browser combination the person hasn't used before count as
//    suspicious: any "trusted device" remembered for them is revoked so they must enter a code.
// Only salted hashes of the IP prefix and browser family are stored.
import { createHash } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { authStepUps, knownSignInContexts, users, verifications } from "@/server/db/schema";
import { env } from "@/server/env";

export const STEP_UP_MAX_AGE_MS = 10 * 60_000;
/** How long a device can be trusted to skip the code at sign-in. */
export const TRUST_DEVICE_DAYS = 14;

export async function recordStepUp(sessionId: string, userId: string, at = new Date()) {
  await db.insert(authStepUps).values({ sessionId, userId, verifiedAt: at }).onConflictDoUpdate({ target: authStepUps.sessionId, set: { verifiedAt: at } });
}

export async function hasFreshStepUp(sessionId: string, now = new Date()) {
  const [row] = await db.select({ at: authStepUps.verifiedAt }).from(authStepUps).where(eq(authStepUps.sessionId, sessionId));
  return Boolean(row && now.getTime() - row.at.getTime() <= STEP_UP_MAX_AGE_MS);
}

function browserFamily(userAgent: string | null | undefined) {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "edge" : /Chrome\//.test(ua) ? "chrome" : /Firefox\//.test(ua) ? "firefox" : /Safari\//.test(ua) ? "safari" : "other";
  const os = /iPhone|iPad/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : /Mac OS X/.test(ua) ? "mac" : /Windows/.test(ua) ? "windows" : /Linux/.test(ua) ? "linux" : "other";
  return `${browser}/${os}`;
}

function ipPrefix(ip: string | null | undefined) {
  if (!ip) return "unknown";
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":"); // IPv6 /48
  return ip.split(".").slice(0, 3).join("."); // IPv4 /24
}

export function signInFingerprint(ip: string | null | undefined, userAgent: string | null | undefined) {
  return createHash("sha256").update(`${env.BETTER_AUTH_SECRET}|${ipPrefix(ip)}|${browserFamily(userAgent)}`).digest("hex").slice(0, 32);
}

/** Before a password sign-in: revokes remembered devices when the context is new for an internal user. */
export async function screenSignIn(email: string, ip: string | null, userAgent: string | null) {
  const [u] = await db.select({ id: users.id, kind: users.kind }).from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase()));
  if (!u || u.kind !== "internal") return { suspicious: false };
  const fp = signInFingerprint(ip, userAgent);
  const [known] = await db.select({ fp: knownSignInContexts.fingerprint }).from(knownSignInContexts).where(and(eq(knownSignInContexts.userId, u.id), eq(knownSignInContexts.fingerprint, fp)));
  if (known) return { suspicious: false };
  await db.delete(verifications).where(and(eq(verifications.value, u.id), like(verifications.identifier, "trust-device-%")));
  return { suspicious: true };
}

/** After a session starts: remember this context for the person. */
export async function rememberSignInContext(userId: string, ip: string | null | undefined, userAgent: string | null | undefined) {
  const fp = signInFingerprint(ip, userAgent);
  await db.insert(knownSignInContexts).values({ userId, fingerprint: fp }).onConflictDoUpdate({ target: [knownSignInContexts.userId, knownSignInContexts.fingerprint], set: { lastSeenAt: new Date() } });
}
