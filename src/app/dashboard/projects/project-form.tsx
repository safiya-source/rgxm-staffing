"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { useFormAction } from "@/lib/use-form-action";

export type ProjectFormValues = {
  name: string;
  code: string;
  clientId: string | null;
  campaignName: string | null;
  description: string | null;
  ownerId: string | null;
  coordinatorId: string | null;
  startDate: string | null;
  endDate: string | null;
  budgetCents: number | null;
  currency: string;
  internalNotes: string | null;
  clientNotes: string | null;
};

export function ProjectForm({
  action,
  values,
  clients,
  team,
  submitLabel,
  canSeeBudget,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  values: ProjectFormValues;
  clients: { id: string; name: string }[];
  team: { id: string; name: string }[];
  submitLabel: string;
  canSeeBudget: boolean;
}) {
  const [clientId, setClientId] = useState(values.clientId ?? (clients.length ? "" : "__new"));
  const [state, onSubmit, pending] = useFormAction(async (prev, fd) => {
    const res = await action(prev, fd);
    if (res.ok && res.message) toast.success(res.message);
    return res;
  });
  const e = state.ok ? undefined : state.fieldErrors;

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Project name" htmlFor="name" error={e?.name}>
          <Input id="name" name="name" defaultValue={values.name} required placeholder="Cadbury Sampling Activation" />
        </Field>
        <Field label="Project code" htmlFor="code" error={e?.code} hint="Unique, e.g. CAD-2611">
          <Input id="code" name="code" defaultValue={values.code} required className="uppercase" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client" htmlFor="clientId" error={e?.clientId}>
          <NativeSelect id="clientId" name="clientId" value={clientId} onChange={(ev) => setClientId(ev.target.value)}>
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="__new">+ New client…</option>
          </NativeSelect>
        </Field>
        {clientId === "__new" ? (
          <Field label="New client name" htmlFor="newClientName" error={e?.newClientName}>
            <Input id="newClientName" name="newClientName" required />
          </Field>
        ) : (
          <Field label="Campaign" htmlFor="campaignName" error={e?.campaignName}>
            <Input id="campaignName" name="campaignName" defaultValue={values.campaignName ?? ""} />
          </Field>
        )}
      </div>
      {clientId === "__new" ? (
        <Field label="Campaign" htmlFor="campaignName" error={e?.campaignName}>
          <Input id="campaignName" name="campaignName" defaultValue={values.campaignName ?? ""} />
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project owner" htmlFor="ownerId" error={e?.ownerId}>
          <NativeSelect id="ownerId" name="ownerId" defaultValue={values.ownerId ?? ""}>
            <option value="">Me</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Staffing coordinator" htmlFor="coordinatorId" error={e?.coordinatorId}>
          <NativeSelect id="coordinatorId" name="coordinatorId" defaultValue={values.coordinatorId ?? ""}>
            <option value="">Not assigned</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start date" htmlFor="startDate" error={e?.startDate}>
          <Input id="startDate" name="startDate" type="date" defaultValue={values.startDate ?? ""} />
        </Field>
        <Field label="End date" htmlFor="endDate" error={e?.endDate}>
          <Input id="endDate" name="endDate" type="date" defaultValue={values.endDate ?? ""} />
        </Field>
      </div>
      {canSeeBudget ? (
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="Staffing budget" htmlFor="budget" error={e?.budgetCents}>
            <Input
              id="budget"
              name="budget"
              inputMode="decimal"
              defaultValue={values.budgetCents != null ? (values.budgetCents / 100).toFixed(2) : ""}
              placeholder="15000.00"
            />
          </Field>
          <Field label="Currency" htmlFor="currency">
            <NativeSelect id="currency" name="currency" defaultValue={values.currency}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </NativeSelect>
          </Field>
        </div>
      ) : (
        <>
          <input type="hidden" name="budget" value={values.budgetCents != null ? (values.budgetCents / 100).toFixed(2) : ""} />
          <input type="hidden" name="currency" value={values.currency} />
        </>
      )}
      <Field label="Description" htmlFor="description" error={e?.description}>
        <Textarea id="description" name="description" defaultValue={values.description ?? ""} rows={3} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Internal notes" htmlFor="internalNotes" hint="RGXM only">
          <Textarea id="internalNotes" name="internalNotes" defaultValue={values.internalNotes ?? ""} rows={3} />
        </Field>
        <Field label="Client-facing notes" htmlFor="clientNotes">
          <Textarea id="clientNotes" name="clientNotes" defaultValue={values.clientNotes ?? ""} rows={3} />
        </Field>
      </div>
      {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
