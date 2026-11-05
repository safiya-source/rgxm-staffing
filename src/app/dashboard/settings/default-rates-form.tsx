"use client";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { useFormAction } from "@/lib/use-form-action";
import { updateDefaultRates } from "./actions";

/** Company-wide default hourly rate per role (Admins and Finance). */
export function DefaultRatesForm({ initial, canEdit }: { initial: Partial<Record<FieldRole, number>>; canEdit: boolean }) {
  const [state, onSubmit, pending] = useFormAction(updateDefaultRates);
  const errors = state.ok ? undefined : state.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="max-w-2xl">
      <fieldset disabled={!canEdit || pending} className="contents">
        <Card>
          <CardHeader>
            <CardTitle>Default hourly rates</CardTitle>
            <CardDescription>
              Pre-filled when someone creates shifts, and can be changed per shift. A project&apos;s own rate (Setup → Staffing requirements) takes
              priority. Leave a role blank to use each person&apos;s own rate.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            {FIELD_ROLES.map((r) => (
              <Field key={r} label={`${FIELD_ROLE_NAMES[r]} (CAD / hour)`} htmlFor={`rate-${r}`} error={errors?.[r]}>
                <Input id={`rate-${r}`} name={r} inputMode="decimal" placeholder="Not set" defaultValue={initial[r] != null ? (initial[r]! / 100).toFixed(2) : ""} />
              </Field>
            ))}
          </CardContent>
          {canEdit ? (
            <CardFooter className="justify-between gap-4">
              <div className="min-w-0 flex-1">
                <FormMessage tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</FormMessage>
              </div>
              <Button type="submit">{pending ? "Saving…" : "Save rates"}</Button>
            </CardFooter>
          ) : null}
        </Card>
      </fieldset>
    </form>
  );
}
