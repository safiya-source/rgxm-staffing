"use client";
// Small building blocks for admin screens: run a server action, show the result as a toast,
// refresh the page, and, when the server asks for fresh two-step verification (payment approval,
// payment-detail changes), prompt for a code and retry once.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const needsStepUp = (r: ActionResult<unknown>) => !r.ok && Boolean(r.fieldErrors?.stepUp);

/** Runs actions with toasts and a two-step code prompt when the server requires fresh authentication. */
export function useRunAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [prompt, setPrompt] = useState<null | (() => Promise<void>)>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();

  function run<T>(fn: () => Promise<ActionResult<T>>, after?: (r: ActionResult<T>) => void) {
    start(async () => {
      const res = await fn();
      if (needsStepUp(res)) {
        setCode("");
        setError(undefined);
        setPrompt(() => async () => {
          const again = await fn();
          if (again.ok) {
            toast.success(again.message ?? "Done");
            after?.(again);
            router.refresh();
          } else toast.error(again.error);
        });
        return;
      }
      if (res.ok) {
        toast.success(res.message ?? "Done");
        after?.(res);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const { error: err } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    if (err) {
      setError("That code didn't work. Try again.");
      return;
    }
    const retry = prompt;
    setPrompt(null);
    if (retry) start(retry);
  }

  const stepUpDialog = (
    <Dialog open={prompt !== null} onOpenChange={(o) => !o && setPrompt(null)}>
      <DialogContent>
        <form onSubmit={verify} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Confirm it&apos;s you</DialogTitle>
            <DialogDescription>Payment approvals and payment-detail changes need a fresh code from your authenticator app.</DialogDescription>
          </DialogHeader>
          <Field label="Verification code" htmlFor="step-up-code">
            <Input id="step-up-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" required autoFocus />
          </Field>
          <FormMessage>{error}</FormMessage>
          <DialogFooter>
            <Button type="submit">Verify and continue</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  return { pending, run, stepUpDialog };
}

/**
 * A form posting to a server action `(formData) => ActionResult`. Hidden values are added as
 * fields. The form resets after success unless `keep` is set.
 */
export function ActionForm({
  action,
  hidden,
  submitLabel,
  children,
  className,
  variant = "default",
  size = "sm",
  keep,
  confirm,
  disabled,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  hidden?: Record<string, string>;
  submitLabel: string;
  children?: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  keep?: boolean;
  confirm?: string;
  disabled?: boolean;
}) {
  const { pending, run, stepUpDialog } = useRunAction();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className={cn("flex flex-wrap items-end gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        for (const [k, v] of Object.entries(hidden ?? {})) fd.set(k, v);
        run(() => action(fd), (r) => r.ok && !keep && ref.current?.reset());
      }}
    >
      {children}
      <Button type="submit" variant={variant} size={size} disabled={pending || disabled}>
        {pending ? "Working…" : submitLabel}
      </Button>
      {stepUpDialog}
    </form>
  );
}
