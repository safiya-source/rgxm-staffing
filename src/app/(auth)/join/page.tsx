import type { Metadata } from "next";
import Link from "next/link";
import { MagicLinkForm } from "../sign-in/sign-in-forms";

export const metadata: Metadata = { title: "Join RGXM" };

export default function JoinPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Work events with RGXM</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        Create your staff profile to receive shift opportunities, manage your schedule and get paid. It takes about two
        minutes.
      </p>
      <div className="mt-6">
        <MagicLinkForm cta="Continue with email" />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have a profile?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
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
