"use client";
import Link from "next/link";
import { toast } from "sonner";
import { saveStaffProfile } from "@/app/portal/actions";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/action-result";
import { useFormAction } from "@/lib/use-form-action";
import { PROVINCES } from "@/lib/provinces";
import { FIELD_ROLE_DESCRIPTIONS, FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";

export type ProfileDefaults = {
  firstName: string;
  lastName: string;
  preferredName: string;
  phone: string;
  city: string;
  province: string;
  roles: FieldRole[];
};

export function ProfileForm({ mode, defaults }: { mode: "onboarding" | "profile"; defaults: ProfileDefaults }) {
  const [state, onSubmit, pending] = useFormAction(async (prev: ActionResult, formData: FormData) => {
    const result = await saveStaffProfile(prev, formData);
    if (result.ok && result.message) toast.success(result.message);
    return result;
  });
  const errors = state.ok ? undefined : state.fieldErrors;

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <input type="hidden" name="mode" value={mode} />
      <div className="grid grid-cols-2 gap-4">
        <Field label="First name" htmlFor="firstName" error={errors?.firstName}>
          <Input id="firstName" name="firstName" autoComplete="given-name" defaultValue={defaults.firstName} required />
        </Field>
        <Field label="Last name" htmlFor="lastName" error={errors?.lastName}>
          <Input id="lastName" name="lastName" autoComplete="family-name" defaultValue={defaults.lastName} required />
        </Field>
      </div>
      <Field label="Preferred name (optional)" htmlFor="preferredName" error={errors?.preferredName} hint="What you'd like to be called on site.">
        <Input id="preferredName" name="preferredName" autoComplete="nickname" defaultValue={defaults.preferredName} />
      </Field>
      <Field label="Mobile number" htmlFor="phone" error={errors?.phone}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={defaults.phone} required placeholder="416 555 0123" />
      </Field>
      <div className="grid grid-cols-[1fr_8rem] gap-4">
        <Field label="City" htmlFor="city" error={errors?.city}>
          <Input id="city" name="city" autoComplete="address-level2" defaultValue={defaults.city} required />
        </Field>
        <Field label="Province" htmlFor="province" error={errors?.province}>
          <NativeSelect id="province" name="province" defaultValue={defaults.province || "ON"}>
            {PROVINCES.map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Roles you can work</legend>
        {FIELD_ROLES.map((role) => (
          <label key={role} className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 has-[[data-state=checked]]:border-foreground/40">
            <Checkbox name="roles" value={role} defaultChecked={defaults.roles.includes(role)} className="mt-0.5" />
            <span>
              <span className="block text-[15px] font-medium">{FIELD_ROLE_NAMES[role]}</span>
              <span className="block text-[13px] text-muted-foreground">{FIELD_ROLE_DESCRIPTIONS[role]}</span>
            </span>
          </label>
        ))}
        {errors?.roles ? <p className="text-[13px] text-destructive">{errors.roles[0]}</p> : null}
      </fieldset>
      {mode === "onboarding" ? (
        <div className="grid gap-2">
          <div className="flex items-start gap-3">
            <Checkbox id="consent" name="consent" className="mt-0.5" />
            <Label htmlFor="consent" className="leading-snug font-normal">
              I&apos;ve read the{" "}
              <Link href="/privacy" target="_blank" className="underline underline-offset-2">
                privacy notice
              </Link>{" "}
              and agree to RGXM using my information to offer and manage event work.
            </Label>
          </div>
          {errors?.consent ? <p className="text-[13px] text-destructive">Please confirm to continue.</p> : null}
        </div>
      ) : null}
      {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : mode === "onboarding" ? "Finish setup" : "Save changes"}
      </Button>
    </form>
  );
}
