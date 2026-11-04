"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function AcceptInvite({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string>();

  async function accept() {
    setPending(true);
    setFailed(undefined);
    const res = await fetch("/api/auth/staff-invite/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    if (res?.ok) {
      // Full navigation so the new session cookie is used everywhere.
      window.location.assign("/portal");
      return;
    }
    setPending(false);
    setFailed(res?.status === 429 ? "Too many attempts. Please wait a minute and try again." : "expired");
  }

  if (failed === "expired") {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-destructive">This invitation has expired or was already used.</p>
        <p className="text-muted-foreground">
          You can still get in:{" "}
          <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            sign in with your email
          </Link>{" "}
          and we&apos;ll send you a fresh link.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Button className="w-full" size="lg" onClick={accept} disabled={pending}>
        {pending ? "Signing you in…" : "Set up my profile"}
      </Button>
      {failed ? <p className="text-sm text-destructive">{failed}</p> : null}
    </div>
  );
}
