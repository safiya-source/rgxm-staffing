import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { ProfileForm } from "@/components/portal/profile-form";
import { currentDocuments, offeredConsentPurposes } from "@/server/domain/onboarding";
import { getProfileDefaults } from "@/server/queries/staff-profile";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Set up your profile" };

export default async function OnboardingPage() {
  const viewer = await requireStaff({ allowIncompleteOnboarding: true });
  if (viewer.staff?.onboarded) redirect("/portal");
  const [defaults, docs, consents] = await Promise.all([getProfileDefaults(viewer.staff?.id, viewer.name), currentDocuments(), offeredConsentPurposes()]);
  const agreements = {
    privacy: docs.privacy_notice ? { title: docs.privacy_notice.title, version: docs.privacy_notice.version } : null,
    terms: docs.contractor_terms ? { title: docs.contractor_terms.title, version: docs.contractor_terms.version } : null,
    consents: consents.map((c) => ({ key: c.key, label: c.label, description: c.description })),
  };
  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pt-6 pb-16">
      <Logo />
      <h1 className="mt-10 text-2xl font-semibold">Set up your profile</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        This helps RGXM match you with the right shifts. You can change it any time.
      </p>
      <div className="mt-8">
        <ProfileForm mode="onboarding" defaults={defaults} agreements={agreements} />
      </div>
    </div>
  );
}
