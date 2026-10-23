import type { Metadata } from "next";
import Link from "next/link";
import { ProfileForm } from "@/components/portal/profile-form";
import { SignOutButton } from "@/components/portal/sign-out-button";
import { getProfileDefaults } from "@/server/queries/staff-profile";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const viewer = await requireStaff();
  const defaults = await getProfileDefaults(viewer.staff!.id, viewer.name);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[22px] font-semibold">My profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">{viewer.email}</p>
      </div>
      <ProfileForm mode="profile" defaults={defaults} />
      <div className="grid gap-3 border-t pt-6 text-sm">
        <Link href="/privacy" className="text-muted-foreground hover:text-foreground">
          Privacy notice
        </Link>
        <SignOutButton />
      </div>
    </div>
  );
}
