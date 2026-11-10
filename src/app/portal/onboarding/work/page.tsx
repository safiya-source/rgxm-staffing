import type { Metadata } from "next";
import { Logo } from "@/components/app/logo";
import { WorkDetailsForm } from "@/components/portal/work-details-form";
import { getWorkDetails } from "@/server/domain/work-details";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Work details" };

/** Shown once, straight after profile setup. Every answer is optional and can be skipped. */
export default async function OnboardingWorkDetailsPage() {
  const viewer = await requireStaff();
  const initial = await getWorkDetails(viewer.staff!.id);
  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pt-6 pb-16">
      <Logo />
      <p className="mt-10 text-sm font-medium text-muted-foreground">Almost done</p>
      <h1 className="mt-1 text-2xl font-semibold">Work details</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        A few quick questions so RGXM can offer you the right shifts, like ones that need a driver or a second language. You can skip
        any of them and change your answers any time in My profile.
      </p>
      <div className="mt-8">
        <WorkDetailsForm mode="onboarding" initial={initial} />
      </div>
    </div>
  );
}
