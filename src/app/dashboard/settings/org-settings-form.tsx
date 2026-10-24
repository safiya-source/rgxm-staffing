"use client";
import { useState } from "react";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFormAction } from "@/lib/use-form-action";
import { updateOrgSettings } from "./actions";

type Initial = {
  orgName: string;
  accentColor: string;
  checkInWindowMinutes: number;
  checkInGeofenceMeters: number;
  requireMfaForPrivileged: boolean;
  locationRetentionDays: number;
  mailLogRetentionDays: number;
};

export function OrgSettingsForm({ initial, canEdit }: { initial: Initial; canEdit: boolean }) {
  const [state, onSubmit, pending] = useFormAction(updateOrgSettings);
  const [accent, setAccent] = useState(initial.accentColor);
  const errors = state.ok ? undefined : state.fieldErrors;

  return (
    <form onSubmit={onSubmit} className="grid max-w-2xl gap-6">
      <fieldset disabled={!canEdit || pending} className="contents">
        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>Shown across the dashboard and the staff portal.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Field label="Organisation name" htmlFor="orgName" error={errors?.orgName}>
              <Input id="orgName" name="orgName" defaultValue={initial.orgName} required />
            </Field>
            <Field label="Accent colour" htmlFor="accentColor" error={errors?.accentColor} hint="Used sparingly for highlights and key actions.">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label="Pick accent colour"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value.toUpperCase())}
                  className="h-10 w-12 cursor-pointer rounded-md border bg-card p-1"
                />
                <Input id="accentColor" name="accentColor" value={accent} onChange={(e) => setAccent(e.target.value)} className="max-w-36 font-mono" />
                <span className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: accent, color: "#fff" }}>
                  Preview
                </span>
              </div>
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Check-in defaults</CardTitle>
            <CardDescription>
              Location is only ever captured at the moment of check-in, and only on projects where it&apos;s switched on.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Field label="Check-in opens (minutes before start)" htmlFor="checkInWindowMinutes" error={errors?.checkInWindowMinutes}>
              <Input id="checkInWindowMinutes" name="checkInWindowMinutes" type="number" min={0} max={240} defaultValue={initial.checkInWindowMinutes} />
            </Field>
            <Field label="Location radius (metres)" htmlFor="checkInGeofenceMeters" error={errors?.checkInGeofenceMeters}>
              <Input id="checkInGeofenceMeters" name="checkInGeofenceMeters" type="number" min={50} max={5000} defaultValue={initial.checkInGeofenceMeters} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Security & privacy</CardTitle>
            <CardDescription>Retention clears personal details that are no longer needed. Work, pay and audit records are kept.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <label className="flex items-start gap-3">
              <Checkbox name="requireMfaForPrivileged" defaultChecked={initial.requireMfaForPrivileged} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">Require two-step verification for Administrators and Finance</span>
                <span className="block text-xs text-muted-foreground">Strongly recommended. Turning this off is recorded in the audit log.</span>
              </span>
            </label>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Keep check-in locations for (days)" htmlFor="locationRetentionDays" error={errors?.locationRetentionDays} hint="Coordinates are then cleared; the check-in time stays.">
                <Input id="locationRetentionDays" name="locationRetentionDays" type="number" min={7} max={3650} defaultValue={initial.locationRetentionDays} />
              </Field>
              <Field label="Keep email copies in the mail log for (days)" htmlFor="mailLogRetentionDays" error={errors?.mailLogRetentionDays} hint="Message bodies are then cleared; who/when stays.">
                <Input id="mailLogRetentionDays" name="mailLogRetentionDays" type="number" min={1} max={3650} defaultValue={initial.mailLogRetentionDays} />
              </Field>
            </div>
          </CardContent>
          {canEdit ? (
            <CardFooter className="justify-between gap-4">
              <div className="min-w-0 flex-1">
                <FormMessage tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</FormMessage>
              </div>
              <Button type="submit">{pending ? "Saving…" : "Save changes"}</Button>
            </CardFooter>
          ) : null}
        </Card>
      </fieldset>
      {!canEdit ? <p className="text-sm text-muted-foreground">Only administrators can change these settings.</p> : null}
    </form>
  );
}
