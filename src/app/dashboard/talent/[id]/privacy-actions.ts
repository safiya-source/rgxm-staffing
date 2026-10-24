"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runAction, UserFacingError } from "@/server/actions";
import { anonymizeStaff, PrivacyError } from "@/server/domain/privacy";
import { authorizeInternal } from "@/server/session";

export async function anonymizeStaffAction(staffId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("privacy.manage");
    try {
      await anonymizeStaff(viewer.userId, z.string().uuid().parse(staffId), z.string().max(500).parse(reason));
    } catch (err) {
      if (err instanceof PrivacyError) throw new UserFacingError(err.message);
      throw err;
    }
    revalidatePath(`/dashboard/talent/${staffId}`);
    revalidatePath("/dashboard/talent");
    return { ok: true, message: "Personal details erased. Work and pay records are kept against the anonymised profile." };
  });
}
