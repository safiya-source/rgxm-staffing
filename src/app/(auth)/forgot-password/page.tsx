"use client";
import Link from "next/link";
import { useState } from "react";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    // Always show the same message so the form doesn't reveal which emails have accounts.
    setPending(false);
    setSent(true);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">For RGXM team accounts. Event staff sign in with an email link instead.</p>
      {sent ? (
        <div className="mt-6">
          <FormMessage tone="success">If that email belongs to an RGXM team account, a reset link is on its way.</FormMessage>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 grid gap-4">
          <Field label="Work email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </Field>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <Link href="/sign-in?tab=team" className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground">
        Back to sign in
      </Link>
    </div>
  );
}
