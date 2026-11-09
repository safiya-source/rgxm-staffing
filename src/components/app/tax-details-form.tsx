"use client";
import { useState } from "react";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/action-result";
import { authClient } from "@/lib/auth-client";
import { PROVINCES } from "@/lib/provinces";
import { useFormAction } from "@/lib/use-form-action";

export type TaxDetailsValues = {
  legalName: string | null;
  businessName: string | null;
  businessNumber: string | null;
  gstRegistrationStatus: "yes" | "no" | "unsure" | "unknown";
  gstRegistrationEffectiveDate: string | null;
  gstHstNumber: string | null;
  mailingStreet: string | null;
  mailingCity: string | null;
  mailingProvince: string | null;
  mailingPostalCode: string | null;
};

/**
 * Contractor tax details (used on the talent profile and in the staff portal). No SIN: see
 * tax-details.ts. Contractors say whether they're registered for GST/HST; they never choose a
 * rate. RGXM staff saving these details may be asked for a fresh two-step code.
 */
export function TaxDetailsForm({
  initial,
  action,
  onDone,
  onCancel,
  selfService = false,
}: {
  initial: TaxDetailsValues;
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  onDone?: () => void;
  onCancel?: () => void;
  selfService?: boolean;
}) {
  const [status, setStatus] = useState(initial.gstRegistrationStatus === "unknown" ? "" : initial.gstRegistrationStatus);
  const [code, setCode] = useState("");
  const [state, onSubmit, pending] = useFormAction(async (prev, fd) => {
    // Fresh two-step verification for RGXM staff changing payment details.
    const typed = String(fd.get("stepUpCode") ?? "").replace(/\s/g, "");
    if (typed) {
      const { error } = await authClient.twoFactor.verifyTotp({ code: typed });
      if (error) return { ok: false, error: "That verification code didn't work.", fieldErrors: { stepUp: ["required"] } };
    }
    const res = await action(prev, fd);
    if (res.ok) {
      setCode("");
      onDone?.();
    }
    return res;
  });
  const e = state.ok ? undefined : state.fieldErrors;
  const you = selfService ? "you" : "they";
  const needsCode = !state.ok && Boolean(state.fieldErrors?.stepUp);

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <fieldset disabled={pending} className="contents">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name" htmlFor="legalName" error={e?.legalName} hint="As it appears on government ID">
            <Input id="legalName" name="legalName" autoComplete="name" defaultValue={initial.legalName ?? ""} />
          </Field>
          <Field label={status === "yes" ? "Name registered with CRA for GST/HST" : "Business name (if any)"} htmlFor="businessName" error={e?.businessName} hint={status === "yes" ? "Leave blank if it's your legal name." : undefined}>
            <Input id="businessName" name="businessName" autoComplete="organization" defaultValue={initial.businessName ?? ""} />
          </Field>
        </div>

        <Field label="Business number (if any)" htmlFor="businessNumber" error={e?.businessNumber} hint="9 digits, for incorporated or registered businesses">
          <Input id="businessNumber" name="businessNumber" inputMode="numeric" defaultValue={initial.businessNumber ?? ""} className="sm:max-w-xs" />
        </Field>

        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Are {you} registered for GST/HST?</legend>
          <div className="flex flex-wrap gap-4 text-sm" role="radiogroup">
            {(
              [
                ["yes", "Yes"],
                ["no", "No"],
                ["unsure", "Unsure"],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="gstRegistrationStatus" value={v} checked={status === v} onChange={() => setStatus(v)} className="size-4 accent-brand" required />
                {label}
              </label>
            ))}
          </div>
          {e?.gstRegistrationStatus ? <FormMessage>{e.gstRegistrationStatus[0]}</FormMessage> : null}
          {status === "yes" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="GST/HST registration number" htmlFor="gstHstNumber" error={e?.gstHstNumber} hint="Format: 123456789 RT0001">
                <Input id="gstHstNumber" name="gstHstNumber" defaultValue={initial.gstHstNumber ?? ""} />
              </Field>
              <Field label="Registration effective date" htmlFor="gstRegistrationEffectiveDate" error={e?.gstRegistrationEffectiveDate} hint="The date on the CRA confirmation">
                <Input id="gstRegistrationEffectiveDate" name="gstRegistrationEffectiveDate" type="date" defaultValue={initial.gstRegistrationEffectiveDate ?? ""} />
              </Field>
            </div>
          ) : status === "unsure" ? (
            <p className="text-xs text-muted-foreground">That&apos;s fine. RGXM Finance will follow up before any tax is worked out on {selfService ? "your" : "their"} pay.</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {selfService ? "You don't choose a tax rate." : "Contractors never choose a tax rate."} RGXM Finance verifies the answer, and tax is worked out per item from
            accountant-approved rules for where the event takes place. Changing this answer or number pauses automatic tax until Finance checks it again.
          </p>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-medium">Mailing address (for tax slips)</legend>
          <Field label="Street address" htmlFor="mailingStreet" error={e?.mailingStreet}>
            <Input id="mailingStreet" name="mailingStreet" autoComplete="street-address" defaultValue={initial.mailingStreet ?? ""} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" htmlFor="mailingCity" error={e?.mailingCity}>
              <Input id="mailingCity" name="mailingCity" autoComplete="address-level2" defaultValue={initial.mailingCity ?? ""} />
            </Field>
            <Field label="Province" htmlFor="mailingProvince" error={e?.mailingProvince}>
              <NativeSelect id="mailingProvince" name="mailingProvince" defaultValue={initial.mailingProvince ?? ""}>
                <option value="">—</option>
                {PROVINCES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Postal code" htmlFor="mailingPostalCode" error={e?.mailingPostalCode}>
              <Input id="mailingPostalCode" name="mailingPostalCode" autoComplete="postal-code" defaultValue={initial.mailingPostalCode ?? ""} />
            </Field>
          </div>
        </fieldset>

        {needsCode ? (
          <Field label="Two-step verification code" htmlFor="stepUpCode" hint="Changing payment details needs a fresh code from your authenticator app.">
            <Input id="stepUpCode" name="stepUpCode" value={code} onChange={(ev) => setCode(ev.target.value)} autoComplete="one-time-code" inputMode="numeric" className="sm:max-w-40" autoFocus />
          </Field>
        ) : null}
        {!state.ok ? <FormMessage>{state.error}</FormMessage> : state.message ? <FormMessage tone="success">{state.message}</FormMessage> : null}
        <div className="flex gap-2">
          <Button size="sm" type="submit">
            {pending ? "Saving…" : "Save tax details"}
          </Button>
          {onCancel ? (
            <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
}
