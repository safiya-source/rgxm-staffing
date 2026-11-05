"use client";
import { useState } from "react";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/action-result";
import { PROVINCES } from "@/lib/provinces";
import { useFormAction } from "@/lib/use-form-action";

export type TaxDetailsValues = {
  legalName: string | null;
  businessName: string | null;
  businessNumber: string | null;
  taxRegistered: boolean;
  gstHstNumber: string | null;
  mailingStreet: string | null;
  mailingCity: string | null;
  mailingProvince: string | null;
  mailingPostalCode: string | null;
};

/** Contractor tax details (used on the talent profile and in the staff portal). No SIN: see tax-details.ts. */
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
  const [registered, setRegistered] = useState(initial.taxRegistered);
  const [state, onSubmit, pending] = useFormAction(async (prev, fd) => {
    const res = await action(prev, fd);
    if (res.ok) onDone?.();
    return res;
  });
  const e = state.ok ? undefined : state.fieldErrors;
  const you = selfService ? "your" : "their";

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <fieldset disabled={pending} className="contents">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name" htmlFor="legalName" error={e?.legalName} hint="As it appears on government ID">
            <Input id="legalName" name="legalName" autoComplete="name" defaultValue={initial.legalName ?? ""} />
          </Field>
          <Field label="Business name (if any)" htmlFor="businessName" error={e?.businessName}>
            <Input id="businessName" name="businessName" autoComplete="organization" defaultValue={initial.businessName ?? ""} />
          </Field>
        </div>

        <Field label="Business number (if any)" htmlFor="businessNumber" error={e?.businessNumber} hint="9 digits, for incorporated or registered businesses">
          <Input id="businessNumber" name="businessNumber" inputMode="numeric" defaultValue={initial.businessNumber ?? ""} className="sm:max-w-xs" />
        </Field>

        <div className="grid gap-3 rounded-lg border p-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="taxRegistered" checked={registered} onCheckedChange={(c) => setRegistered(c === true)} className="mt-0.5" />
            <span>
              <span className="block font-medium">Registered for GST/HST</span>
              <span className="block text-xs text-muted-foreground">HST (13%) is then added on top of {you} pay.</span>
            </span>
          </label>
          {registered ? (
            <Field label="GST/HST number" htmlFor="gstHstNumber" error={e?.gstHstNumber} hint="Format: 123456789 RT0001">
              <Input id="gstHstNumber" name="gstHstNumber" defaultValue={initial.gstHstNumber ?? ""} />
            </Field>
          ) : null}
        </div>

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
