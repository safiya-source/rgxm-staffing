"use server";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { runAction, UserFacingError } from "@/server/actions";
import { db } from "@/server/db";
import { staffProfiles } from "@/server/db/schema";
import { PrivacyError } from "@/server/domain/privacy";
import * as ops from "@/server/domain/privacy-ops";
import { authorizeInternal } from "@/server/session";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ops.PrivacyOpsError || err instanceof PrivacyError) throw new UserFacingError(err.message);
    throw err;
  }
}

function refresh(id?: string) {
  revalidatePath("/dashboard/privacy");
  if (id) revalidatePath(`/dashboard/privacy/${id}`);
}

export async function createRequestAction(fd: FormData): Promise<ActionResult> {
  let id: string | undefined;
  const res = await runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    const email = str(fd, "staffEmail");
    let staffId: string | null = null;
    if (email) {
      const [s] = await db.select({ id: staffProfiles.id }).from(staffProfiles).where(eq(sql`lower(${staffProfiles.email})`, email.toLowerCase()));
      if (!s) throw new UserFacingError("No contractor has that email. Leave it blank to record the request without linking a profile.");
      staffId = s.id;
    }
    const r = await guard(() =>
      ops.createPrivacyRequest(viewer.userId, {
        kind: str(fd, "kind") as "access",
        staffId,
        requesterName: str(fd, "requesterName"),
        requesterContact: str(fd, "requesterContact") || null,
        receivedAt: str(fd, "receivedAt"),
        receivedVia: str(fd, "receivedVia") || null,
        details: str(fd, "details") || null,
      }),
    );
    id = r.id;
    refresh();
    return { ok: true, message: `Request ${r.reference} recorded.` };
  });
  if (res.ok && id) redirect(`/dashboard/privacy/${id}`);
  return res;
}

export async function verifyIdentityAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    const id = str(fd, "requestId");
    await guard(() => ops.verifyRequesterIdentity(viewer.userId, id, str(fd, "method")));
    refresh(id);
    return { ok: true, message: "Identity verification recorded." };
  });
}

export async function reviewItemAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    const id = str(fd, "requestId");
    const item = str(fd, "item") as (typeof ops.REVIEW_ITEMS)[number];
    if (!ops.REVIEW_ITEMS.includes(item)) throw new UserFacingError("Unknown section.");
    await guard(() => ops.updateReviewChecklist(viewer.userId, id, { item, reviewed: str(fd, "reviewed") === "true", note: str(fd, "note") || null }));
    refresh(id);
    return { ok: true, message: "Review updated." };
  });
}

export async function redactionNotesAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    const id = str(fd, "requestId");
    await guard(() => ops.setRedactionNotes(viewer.userId, id, str(fd, "redactionNotes")));
    refresh(id);
    return { ok: true, message: "Redaction notes saved." };
  });
}

export async function buildPackageAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    const id = str(fd, "requestId");
    await guard(() => ops.buildAccessPackage(viewer.userId, id));
    refresh(id);
    return { ok: true, message: "Package generated. Download and review it before releasing anything." };
  });
}

export async function extendDeadlineAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    const id = str(fd, "requestId");
    const newDueOn = str(fd, "newDueOn");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDueOn)) throw new UserFacingError("Choose the new due date.");
    await guard(() => ops.extendDeadline(viewer.userId, id, { newDueOn, reason: str(fd, "reason") }));
    refresh(id);
    return { ok: true, message: "Extension recorded." };
  });
}

export async function respondAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    const id = str(fd, "requestId");
    const outcome = str(fd, "outcome") as "responded" | "refused" | "withdrawn";
    if (!["responded", "refused", "withdrawn"].includes(outcome)) throw new UserFacingError("Choose an outcome.");
    await guard(() => ops.respondToRequest(viewer.userId, id, { outcome, summary: str(fd, "summary"), method: str(fd, "method") }));
    refresh(id);
    return { ok: true, message: "Response recorded and the request closed." };
  });
}
