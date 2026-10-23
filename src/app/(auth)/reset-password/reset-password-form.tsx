"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token, invalid }: { token: string | null; invalid: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  if (!token || invalid) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Link expired</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">This password link is invalid or has expired.</p>
        <Button asChild className="mt-6">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    setError(undefined);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    setPending(false);
    if (error) {
      setError(error.message ?? "Couldn't set your password. The link may have expired.");
      return;
    }
    router.replace("/sign-in?tab=team");
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Choose a password</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">Use at least 12 characters. A short phrase works well.</p>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4">
        <Field label="New password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
        </Field>
        <FormMessage>{error}</FormMessage>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save password"}
        </Button>
      </form>
    </div>
  );
}
