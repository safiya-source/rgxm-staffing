// Shared wrapper for server actions: maps domain/permission errors to user-facing results
// and keeps unexpected errors out of the client.
import { ZodError } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { SeparationOfDutiesError } from "@/server/authz/permissions";
import { logError } from "@/server/observability";
import { RateLimitError } from "@/server/rate-limit";
import { ForbiddenError } from "@/server/session";

export class UserFacingError extends Error {}

export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) {
      return { ok: false, error: "Please check the highlighted fields.", fieldErrors: err.flatten().fieldErrors as Record<string, string[]> };
    }
    if (err instanceof ForbiddenError || err instanceof SeparationOfDutiesError || err instanceof UserFacingError || err instanceof RateLimitError) {
      return { ok: false, error: err.message };
    }
    // Next.js uses thrown errors for redirect()/notFound(); let them through.
    if (err && typeof err === "object" && "digest" in err) throw err;
    logError(err, { where: "server-action" });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
