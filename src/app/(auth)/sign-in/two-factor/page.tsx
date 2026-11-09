"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function TwoFactorPage() {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setPending(false);
    if (error) {
      setError("That code didn't work. Try again.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Two-step verification</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        {useBackup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}
      </p>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4">
        <Field label={useBackup ? "Backup code" : "Verification code"} htmlFor="code">
          <Input
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode={useBackup ? "text" : "numeric"}
            pattern={useBackup ? undefined : "[0-9 ]{6,7}"}
            required
            autoFocus
          />
        </Field>
        <div className="flex items-start gap-2">
          <Checkbox id="trustDevice" checked={trustDevice} onCheckedChange={(c) => setTrustDevice(c === true)} className="mt-0.5" />
          <Label htmlFor="trustDevice" className="leading-snug font-normal">
            Trust this device for 14 days
            <span className="block text-[13px] text-muted-foreground">Only on a device you use alone. New devices and unusual sign-ins will still ask for a code.</span>
          </Label>
        </div>
        <FormMessage>{error}</FormMessage>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Verifying…" : "Verify"}
        </Button>
        <button
          type="button"
          onClick={() => setUseBackup((v) => !v)}
          className="cursor-pointer text-left text-sm text-muted-foreground hover:text-foreground"
        >
          {useBackup ? "Use authenticator app instead" : "Use a backup code instead"}
        </button>
      </form>
    </div>
  );
}
