import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { ProfileForm } from "@/components/portal/profile-form";
import { getProfileDefaults } from "@/server/queries/staff-profile";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Set up your profile" };

export default async function OnboardingPage() {
  const viewer = await requireStaff({ allowIncompleteOnboarding: true });
  if (viewer.staff?.onboarded) redirect("/portal");
  const defaults = await getProfileDefaults(viewer.staff?.id, viewer.name);
  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pt-6 pb-16">
      <Logo />
      <h1 className="mt-10 text-2xl font-semibold">Set up your profile</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        This helps RGXM match you with the right shifts. You can change it any time.
      </p>
      <div className="mt-8">
        <ProfileForm mode="onboarding" defaults={defaults} />
      </div>
    </div>
  );
}
