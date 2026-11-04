import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/server/session";
import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = { title: "Set up your profile", referrer: "no-referrer" };

export default async function InvitePage({ searchParams }: PageProps<"/invite">) {
  const viewer = await getViewer();
  if (viewer) redirect(homeFor(viewer));
  const { token } = await searchParams;
  return (
    <div>
      <h1 className="text-2xl font-semibold">You&apos;re invited to work with RGXM</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        This portal is where you&apos;ll get shift offers, event briefs and payment updates. Continue to sign in and finish
        your profile. It takes about two minutes, and you won&apos;t need a password.
      </p>
      <div className="mt-6">
        {typeof token === "string" && token ? (
          <AcceptInvite token={token} />
        ) : (
          <p className="text-sm text-destructive">This link is incomplete. Open it again from your invitation email.</p>
        )}
      </div>
      <p className="mt-8 text-xs text-muted-foreground">
        By continuing you agree to our{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          privacy notice
        </Link>
        .
      </p>
    </div>
  );
}
