import type { Metadata } from "next";
import Link from "next/link";
import { ProfileForm } from "@/components/portal/profile-form";
import { PreferencesForm } from "@/components/portal/preferences-form";
import { SignOutButton } from "@/components/portal/sign-out-button";
import { currentConsents, getEmailPreferences, offeredConsentPurposes } from "@/server/domain/onboarding";
import { getProfileDefaults } from "@/server/queries/staff-profile";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const viewer = await requireStaff();
  const staffId = viewer.staff!.id;
  const [defaults, prefs, offered, current] = await Promise.all([getProfileDefaults(staffId, viewer.name), getEmailPreferences(staffId), offeredConsentPurposes(), currentConsents(staffId)]);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[22px] font-semibold">My profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">{viewer.email}</p>
      </div>
      <ProfileForm mode="profile" defaults={defaults} />
      <PreferencesForm
        shiftOpportunityEmails={prefs.shiftOpportunityEmails}
        consents={offered.map((p) => ({ key: p.key, label: p.label, description: p.description, granted: current.get(p.key)?.granted ?? false }))}
      />
      <div className="grid gap-3 border-t pt-6 text-sm">
        <Link href="/portal/availability" className="font-medium hover:underline">
          Set my availability →
        </Link>
        <Link href="/portal/profile/tax" className="font-medium hover:underline">
          Tax details (GST/HST and mailing address) →
        </Link>
        <section aria-labelledby="my-data" className="grid gap-2">
          <h2 id="my-data" className="font-medium">
            Your data
          </h2>
          <a href="/api/me/data" className="text-muted-foreground hover:text-foreground">
            Download a copy of my data
          </a>
          <Link href="/portal/messages?compose=privacy" className="text-muted-foreground hover:text-foreground">
            Ask RGXM to correct or delete my information
          </Link>
          <Link href="/privacy" className="text-muted-foreground hover:text-foreground">
            Privacy notice
          </Link>
        </section>
        <SignOutButton />
      </div>
    </div>
  );
}
