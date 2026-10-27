"use client";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { PROVINCES } from "@/lib/provinces";
import { FIELD_ROLE_NAMES, FIELD_ROLES } from "@/lib/roles";
import { useFormAction } from "@/lib/use-form-action";
import { toast } from "sonner";

export type StaffFormValues = {
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  province: string | null;
  serviceArea: string | null;
  experienceYears: number | null;
  experienceSummary: string | null;
  hasDriversLicence: boolean | null;
  hasVehicle: boolean | null;
  willingToTravel: boolean | null;
  travelRadiusKm: number | null;
  preferredHours: string | null;
};

export const EMPTY_STAFF: StaffFormValues = {
  firstName: "",
  lastName: "",
  preferredName: null,
  email: "",
  phone: null,
  city: "Toronto",
  province: "ON",
  serviceArea: null,
  experienceYears: null,
  experienceSummary: null,
  hasDriversLicence: null,
  hasVehicle: null,
  willingToTravel: null,
  travelRadiusKm: null,
  preferredHours: null,
};

function YesNo({ name, label, value }: { name: string; label: string; value: boolean | null }) {
  return (
    <Field label={label} htmlFor={name}>
      <NativeSelect id={name} name={name} defaultValue={value === null ? "" : value ? "true" : "false"}>
        <option value="">Not provided</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </NativeSelect>
    </Field>
  );
}

export function StaffForm({
  action,
  values,
  mode,
  emailLocked,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  values: StaffFormValues;
  mode: "create" | "edit";
  emailLocked?: boolean;
}) {
  const [state, onSubmit, pending] = useFormAction(async (prev, fd) => {
    const res = await action(prev, fd);
    if (res.ok && res.message) toast.success(res.message);
    return res;
  });
  const e = state.ok ? undefined : state.fieldErrors;
  const v = values;

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="First name" htmlFor="firstName" error={e?.firstName}>
          <Input id="firstName" name="firstName" defaultValue={v.firstName} required />
        </Field>
        <Field label="Last name" htmlFor="lastName" error={e?.lastName}>
          <Input id="lastName" name="lastName" defaultValue={v.lastName} required />
        </Field>
        <Field label="Preferred name" htmlFor="preferredName" error={e?.preferredName}>
          <Input id="preferredName" name="preferredName" defaultValue={v.preferredName ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="email" error={e?.email} hint={emailLocked ? "This person signs in with this email." : undefined}>
          <Input id="email" name="email" type="email" defaultValue={v.email} required readOnly={emailLocked} />
        </Field>
        <Field label="Mobile" htmlFor="phone" error={e?.phone}>
          <Input id="phone" name="phone" type="tel" defaultValue={v.phone ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City" htmlFor="city" error={e?.city}>
          <Input id="city" name="city" defaultValue={v.city ?? ""} />
        </Field>
        <Field label="Province" htmlFor="province" error={e?.province}>
          <NativeSelect id="province" name="province" defaultValue={v.province ?? ""}>
            <option value="">—</option>
            {PROVINCES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Service area" htmlFor="serviceArea" error={e?.serviceArea} hint="e.g. Toronto core, GTA West">
          <Input id="serviceArea" name="serviceArea" defaultValue={v.serviceArea ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Years’ experience" htmlFor="experienceYears" error={e?.experienceYears}>
          <Input id="experienceYears" name="experienceYears" type="number" min={0} max={60} defaultValue={v.experienceYears ?? ""} />
        </Field>
        <YesNo name="hasDriversLicence" label="Driver's licence" value={v.hasDriversLicence} />
        <YesNo name="hasVehicle" label="Access to a vehicle" value={v.hasVehicle} />
        <YesNo name="willingToTravel" label="Willing to travel" value={v.willingToTravel} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Travel radius (km)" htmlFor="travelRadiusKm" error={e?.travelRadiusKm}>
          <Input id="travelRadiusKm" name="travelRadiusKm" type="number" min={0} defaultValue={v.travelRadiusKm ?? ""} />
        </Field>
        <Field label="Preferred working hours" htmlFor="preferredHours" error={e?.preferredHours}>
          <Input id="preferredHours" name="preferredHours" defaultValue={v.preferredHours ?? ""} placeholder="e.g. Evenings and weekends" />
        </Field>
      </div>
      <Field label="Relevant experience" htmlFor="experienceSummary" error={e?.experienceSummary}>
        <Textarea id="experienceSummary" name="experienceSummary" defaultValue={v.experienceSummary ?? ""} rows={3} />
      </Field>
      {mode === "create" ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Qualified roles</legend>
          <div className="flex flex-wrap gap-4">
            {FIELD_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <Checkbox name="roles" value={r} /> {FIELD_ROLE_NAMES[r]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create profile" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
