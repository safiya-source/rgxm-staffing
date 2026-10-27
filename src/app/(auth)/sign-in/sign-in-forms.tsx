"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";

export function SignInForms({ defaultTab, linkError }: { defaultTab: "staff" | "team"; linkError: boolean }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Welcome back.</p>
      {linkError ? (
        <div className="mt-5">
          <FormMessage>That sign-in link has expired or was already used. Request a new one below.</FormMessage>
        </div>
      ) : null}
      <Tabs defaultValue={defaultTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="staff">Event staff</TabsTrigger>
          <TabsTrigger value="team">RGXM team</TabsTrigger>
        </TabsList>
        <TabsContent value="staff" className="pt-6">
          <MagicLinkForm />
          <p className="mt-6 text-sm text-muted-foreground">
            New to RGXM?{" "}
            <Link href="/join" className="font-medium text-foreground underline-offset-4 hover:underline">
              Create your staff profile
            </Link>
          </p>
        </TabsContent>
        <TabsContent value="team" className="pt-6">
          <PasswordForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function MagicLinkForm({ cta = "Email me a sign-in link" }: { cta?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: "/",
      newUserCallbackURL: "/portal/onboarding",
      errorCallbackURL: "/sign-in?error=link",
    });
    setPending(false);
    if (error) {
      setError(error.status === 429 ? "Too many attempts. Please wait a minute and try again." : "We couldn't send a link. Check the email address and try again.");
      return;
    }
    router.push(`/sign-in/check-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate={false}>
      <Field label="Email" htmlFor="ml-email" hint="We'll email you a secure link. No password needed.">
        <Input id="ml-email" name="email" type="email" autoComplete="email" inputMode="email" required placeholder="you@example.com" />
      </Field>
      <FormMessage>{error}</FormMessage>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : cta}
      </Button>
    </form>
  );
}

function PasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(e.currentTarget);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    if (error) {
      setPending(false);
      setError(error.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Incorrect email or password.");
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push("/sign-in/two-factor");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field label="Work email" htmlFor="pw-email">
        <Input id="pw-email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password" htmlFor="pw-password">
        <Input id="pw-password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage>{error}</FormMessage>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">
        Forgot your password?
      </Link>
    </form>
  );
}
