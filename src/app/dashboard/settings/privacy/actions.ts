"use server";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { runAction, UserFacingError } from "@/server/actions";
import { db } from "@/server/db";
import { staffProfiles } from "@/server/db/schema";
import * as ops from "@/server/domain/privacy-ops";
import { authorizeInternal } from "@/server/session";

const PATH = "/dashboard/settings/privacy";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ops.PrivacyOpsError) throw new UserFacingError(err.message);
    throw err;
  }
}

export async function setRetentionAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    const raw = str(fd, "days");
    const days = raw === "" ? null : Number(raw);
    if (days != null && !Number.isInteger(days)) throw new UserFacingError("Enter a whole number of days, or leave it blank.");
    await guard(() => ops.setRetentionPolicy(viewer.userId, str(fd, "category"), { retentionDays: days, approvalReference: str(fd, "reference") }));
    revalidatePath(PATH);
    return { ok: true, message: days == null ? "Period cleared: nothing in this category is deleted automatically." : `Records older than ${days} days will be removed at the next scheduled run.` };
  });
}

/** Finds a contractor by email (exact, case-insensitive). */
async function staffByEmail(email: string) {
  const [s] = await db.select({ id: staffProfiles.id }).from(staffProfiles).where(eq(sql`lower(${staffProfiles.email})`, email.toLowerCase()));
  if (!s) throw new UserFacingError("No contractor has that email.");
  return s.id;
}

export async function placeHoldAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    const email = str(fd, "email");
    const projectId = str(fd, "projectId");
    if (Boolean(email) === Boolean(projectId)) throw new UserFacingError("Choose either a contractor (by email) or a project.");
    const staffId = email ? await staffByEmail(email) : null;
    await guard(() => ops.placeHold(viewer.userId, { staffId, projectId: projectId || null, reason: str(fd, "reason") }));
    revalidatePath(PATH);
    return { ok: true, message: "Legal hold placed. Deletion and erasure are paused for these records." };
  });
}

export async function releaseHoldAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    await guard(() => ops.releaseHold(viewer.userId, str(fd, "holdId"), str(fd, "reason")));
    revalidatePath(PATH);
    return { ok: true, message: "Hold released." };
  });
}
