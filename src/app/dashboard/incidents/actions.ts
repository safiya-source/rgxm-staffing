"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { runAction, UserFacingError } from "@/server/actions";
import * as incidents from "@/server/domain/incidents";
import { authorizeInternal } from "@/server/session";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof incidents.IncidentError) throw new UserFacingError(err.message);
    throw err;
  }
}

export async function reportIncidentAction(fd: FormData): Promise<ActionResult> {
  let id: string | undefined;
  const res = await runAction(async () => {
    const viewer = await authorizeInternal("incidents.manage");
    const inc = await guard(() =>
      incidents.reportIncident(viewer.userId, { title: str(fd, "title"), category: str(fd, "category") as "other", detectedAt: str(fd, "detectedAt"), description: str(fd, "description") }),
    );
    id = inc.id;
    revalidatePath("/dashboard/incidents");
    return { ok: true, message: `Incident ${inc.reference} recorded.` };
  });
  if (res.ok && id) redirect(`/dashboard/incidents/${id}`);
  return res;
}

export async function updateIncidentAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("incidents.manage");
    const id = str(fd, "incidentId");
    await guard(() =>
      incidents.updateIncident(viewer.userId, id, {
        affectedPeopleEstimate: str(fd, "affectedPeopleEstimate"),
        dataCategories: str(fd, "dataCategories")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        containment: str(fd, "containment"),
        riskAssessment: str(fd, "riskAssessment") as "undetermined",
        riskRationale: str(fd, "riskRationale"),
        commissionerNotifiedAt: str(fd, "commissionerNotifiedAt"),
        individualsNotifiedAt: str(fd, "individualsNotifiedAt"),
        otherNotifications: str(fd, "otherNotifications"),
        remediation: str(fd, "remediation"),
        status: str(fd, "status") as "open",
      }),
    );
    revalidatePath("/dashboard/incidents");
    revalidatePath(`/dashboard/incidents/${id}`);
    return { ok: true, message: "Incident updated." };
  });
}
