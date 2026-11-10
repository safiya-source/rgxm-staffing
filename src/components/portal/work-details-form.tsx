"use client";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { saveWorkDetailsAction } from "@/app/portal/actions";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { useFormAction } from "@/lib/use-form-action";
import type { WorkDetails } from "@/server/domain/work-details";

type YesNo = "yes" | "no" | "";
const toYesNo = (v: boolean | null): YesNo => (v === true ? "yes" : v === false ? "no" : "");

function YesNoQuestion({ name, legend, value, onChange, error }: { name: string; legend: string; value: YesNo; onChange: (v: YesNo) => void; error?: string[] }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex gap-6 text-[15px]" role="radiogroup">
        {(
          [
            ["yes", "Yes"],
            ["no", "No"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="size-4 accent-brand" />
            {label}
          </label>
        ))}
      </div>
      {error?.[0] ? <FormMessage>{error[0]}</FormMessage> : null}
    </fieldset>
  );
}

export function WorkDetailsForm({ mode, initial }: { mode: "onboarding" | "profile"; initial: WorkDetails }) {
  const [licence, setLicence] = useState<YesNo>(toYesNo(initial.hasDriversLicence));
  const [vehicle, setVehicle] = useState<YesNo>(toYesNo(initial.hasVehicle));
  const [travel, setTravel] = useState<YesNo>(toYesNo(initial.willingToTravel));
  const [state, onSubmit, pending] = useFormAction(async (prev: ActionResult, formData: FormData) => {
    const result = await saveWorkDetailsAction(prev, formData);
    if (result.ok && result.message) toast.success(result.message);
    return result;
  });
  const errors = state.ok ? undefined : state.fieldErrors;

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <input type="hidden" name="mode" value={mode} />
      <YesNoQuestion name="hasDriversLicence" legend="Do you have a valid driver's licence?" value={licence} onChange={setLicence} error={errors?.hasDriversLicence} />
      <YesNoQuestion name="hasVehicle" legend="Do you have access to a vehicle for work?" value={vehicle} onChange={setVehicle} error={errors?.hasVehicle} />
      <YesNoQuestion name="willingToTravel" legend="Are you willing to travel for events?" value={travel} onChange={setTravel} error={errors?.willingToTravel} />
      {travel === "yes" ? (
        <Field label="How far are you willing to travel? (km)" htmlFor="travelRadiusKm" error={errors?.travelRadiusKm} hint="From your home city, one way.">
          <Input id="travelRadiusKm" name="travelRadiusKm" type="number" inputMode="numeric" min={1} max={5000} defaultValue={initial.travelRadiusKm ?? ""} placeholder="e.g. 100" />
        </Field>
      ) : null}
      <Field label="Years of event experience" htmlFor="experienceYears" error={errors?.experienceYears}>
        <Input id="experienceYears" name="experienceYears" type="number" inputMode="numeric" min={0} max={60} defaultValue={initial.experienceYears ?? ""} placeholder="e.g. 3" />
      </Field>
      <Field label="Languages you speak" htmlFor="languages" error={errors?.languages} hint="Separate with commas, e.g. English, French, Punjabi.">
        <Input id="languages" name="languages" defaultValue={initial.languages.join(", ")} placeholder="English, French" />
      </Field>
      <Field label="Skills" htmlFor="skills" error={errors?.skills} hint="Separate with commas, e.g. Sampling, Product demos, Food handling certificate.">
        <Input id="skills" name="skills" defaultValue={initial.skills.join(", ")} placeholder="Sampling, Product demos" />
      </Field>
      {!state.ok && state.error ? <FormMessage>{state.error}</FormMessage> : null}
      <div className="grid gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : mode === "onboarding" ? "Save and continue" : "Save work details"}
        </Button>
        {mode === "onboarding" ? (
          <Button asChild variant="ghost" size="lg">
            <Link href="/portal/onboarding/next">Skip for now</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
