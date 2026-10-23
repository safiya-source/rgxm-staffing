"use client";
import { ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type Step = { kind: "idle" } | { kind: "scan"; qr: string; secret: string; backupCodes: string[] } | { kind: "done"; backupCodes: string[] };

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data) return setError("Incorrect password.");
    if (data.method !== "totp") return setError("Authenticator setup is unavailable.");
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 });
    setStep({ kind: "scan", qr, secret, backupCodes: data.backupCodes });
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "scan") return;
    setPending(true);
    setError(undefined);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) return setError("That code didn't match. Check your device's clock and try again.");
    setStep({ kind: "done", backupCodes: step.backupCodes });
    router.refresh();
  }

  async function disable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    const { error } = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (error) return setError("Incorrect password.");
    toast.success("Two-step verification turned off.");
    router.refresh();
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4" /> Two-step verification
          {enabled ? <Badge tone="success">On</Badge> : <Badge tone="outline">Off</Badge>}
        </CardTitle>
        <CardDescription>
          Protects your account with a code from an authenticator app (1Password, Google Authenticator, Authy…). Strongly
          recommended for anyone with access to rates or payments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step.kind === "scan" ? (
          <form onSubmit={verify} className="grid gap-5">
            <div className="flex flex-col gap-5 sm:flex-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step.qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded-lg border bg-white" />
              <div className="text-sm text-muted-foreground">
                <p>1. Scan this code with your authenticator app.</p>
                <p className="mt-2">Can&apos;t scan? Enter this key manually:</p>
                <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-xs break-all text-foreground">{step.secret}</code>
                <p className="mt-4">2. Enter the 6-digit code it shows.</p>
              </div>
            </div>
            <Field label="Verification code" htmlFor="code">
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required className="max-w-40" />
            </Field>
            <FormMessage>{error}</FormMessage>
            <Button type="submit" disabled={pending} className="w-fit">
              {pending ? "Verifying…" : "Turn on"}
            </Button>
          </form>
        ) : step.kind === "done" ? (
          <div className="grid gap-4">
            <FormMessage tone="success">Two-step verification is on.</FormMessage>
            <p className="text-sm">
              Save these backup codes somewhere safe. Each can be used once if you lose your device. They won&apos;t be shown again.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-4 font-mono text-sm sm:grid-cols-3">
              {step.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : enabled ? (
          <form onSubmit={disable} className="grid max-w-sm gap-4">
            <Field label="Confirm your password to turn it off" htmlFor="password">
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </Field>
            <FormMessage>{error}</FormMessage>
            <Button type="submit" variant="outline" disabled={pending} className="w-fit">
              Turn off two-step verification
            </Button>
          </form>
        ) : (
          <form onSubmit={start} className="grid max-w-sm gap-4">
            <Field label="Confirm your password" htmlFor="password">
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </Field>
            <FormMessage>{error}</FormMessage>
            <Button type="submit" disabled={pending} className="w-fit">
              {pending ? "Starting…" : "Set up two-step verification"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
