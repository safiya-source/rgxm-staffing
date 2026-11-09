"use server";
// Project compensation: settings (switches and rates), recording items, approval and voiding.
import { readCompensationForm } from "@/lib/compensation-form";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runAction, UserFacingError } from "@/server/actions";
import { db } from "@/server/db";
import { compensationItems } from "@/server/db/schema";
import * as comp from "@/server/domain/compensation";
import { PaymentError } from "@/server/domain/payments";
import { authorizeProject } from "@/server/session";
import { eq } from "drizzle-orm";

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof comp.CompensationError || err instanceof PaymentError) throw new UserFacingError(err.message);
    throw err;
  }
}

async function projectOfItem(itemId: string) {
  const [row] = await db.select({ projectId: compensationItems.projectId }).from(compensationItems).where(eq(compensationItems.id, uuid.parse(itemId)));
  if (!row) throw new UserFacingError("Item not found.");
  return row.projectId;
}

export async function saveCompensationSettingsAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const projectId = uuid.parse(fd.get("projectId"));
    const viewer = await authorizeProject("compensation.configure", projectId);
    await guard(() =>
      comp.saveCompensationSettings(viewer.userId, projectId, readCompensationForm(fd)),
    );
    revalidatePath(`/dashboard/projects/${projectId}`, "layout");
    return { ok: true, message: "Compensation settings saved. Items already recorded keep their rates." };
  });
}

export async function recordCompensationAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const projectId = uuid.parse(fd.get("projectId"));
    const viewer = await authorizeProject("compensation.record", projectId);
    const [bookingId, staffId] = str(fd, "booking").split(":");
    const category = str(fd, "category");
    const base = { staffId: staffId ?? "", bookingId: bookingId ?? "" };
    const input =
      category === "mileage"
        ? { category, ...base, km: str(fd, "km"), tripDate: str(fd, "tripDate"), businessPurpose: str(fd, "businessPurpose") }
        : category === "bonus"
          ? { category, ...base, amount: str(fd, "amount"), reason: str(fd, "reason") }
          : { category, ...base };
    await guard(() => comp.recordCompensation(viewer.userId, projectId, input as comp.RecordCompensationInput));
    revalidatePath(`/dashboard/projects/${projectId}/compensation`);
    return { ok: true, message: "Recorded. It needs approval before it's paid." };
  });
}

export async function decideCompensationAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const itemId = str(fd, "itemId");
    const projectId = await projectOfItem(itemId);
    const viewer = await authorizeProject("compensation.approve", projectId);
    const approve = fd.get("decision") === "approve";
    await guard(() => comp.decideCompensation(viewer.userId, itemId, { approve, note: str(fd, "note") || null }));
    revalidatePath(`/dashboard/projects/${projectId}/compensation`);
    return { ok: true, message: approve ? "Approved. It's now ready to pay." : "Rejected." };
  });
}

export async function voidCompensationAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const itemId = str(fd, "itemId");
    const projectId = await projectOfItem(itemId);
    const viewer = await authorizeProject("compensation.record", projectId);
    await guard(() => comp.voidCompensation(viewer.userId, itemId, str(fd, "reason")));
    revalidatePath(`/dashboard/projects/${projectId}/compensation`);
    return { ok: true, message: "Voided." };
  });
}
