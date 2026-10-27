"use client";
import { format, parseISO } from "date-fns";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone, formatMinutes, formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { expandShiftPattern } from "@/lib/time";
import { createShiftsAction, createTemplateAction } from "../../actions";
import type { BreakPolicyOption, LocationOption, RequirementOption, TemplateOption } from "./types";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dollars = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2));
const toCents = (v: string) => (/^\d{1,4}(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : null);

export function BulkShiftDialog({
  projectId,
  locations,
  requirements,
  templates,
  breakPolicies,
  showRates,
  onClose,
}: {
  projectId: string;
  locations: LocationOption[];
  requirements: RequirementOption[];
  templates: TemplateOption[];
  breakPolicies: BreakPolicyOption[];
  showRates: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [f, setF] = useState({
    locationId: locations[0]!.id,
    requirementId: "",
    role: "BA" as FieldRole,
    startDate: "",
    endDate: "",
    weekdays: [] as number[],
    startTime: "10:00",
    endTime: "18:00",
    headcount: "1",
    rate: "",
    breakPolicyId: "",
    reportingLocation: "",
    onsiteContact: "",
    uniform: "",
    instructions: "",
    publish: true,
    templateName: "",
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const tz = locations.find((l) => l.id === f.locationId)?.timezone ?? "America/Toronto";
  const relevantReqs = requirements.filter((r) => !r.locationId || r.locationId === f.locationId);

  function applyRequirement(id: string) {
    const r = requirements.find((x) => x.id === id);
    if (!r) return set({ requirementId: "" });
    set({
      requirementId: id,
      role: r.role,
      headcount: String(r.quantity),
      rate: showRates ? dollars(r.defaultRateCents) : f.rate,
      startDate: r.startDate ?? f.startDate,
      endDate: r.endDate ?? f.endDate,
    });
  }

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    set({
      role: t.role,
      startTime: t.localStartTime,
      endTime: t.localEndTime,
      headcount: String(t.headcount),
      rate: showRates && t.rateCents != null ? dollars(t.rateCents) : f.rate,
      uniform: t.uniform ?? "",
      instructions: t.instructions ?? "",
    });
  }

  const preview = useMemo(() => {
    if (!f.startDate || !f.endDate) return null;
    try {
      const windows = expandShiftPattern({
        startDate: f.startDate,
        endDate: f.endDate,
        weekdays: f.weekdays,
        startTime: f.startTime,
        endTime: f.endTime,
        timeZone: tz,
      });
      return { windows, error: null as string | null };
    } catch (err) {
      return { windows: [], error: err instanceof Error ? err.message : "Invalid schedule" };
    }
  }, [f.startDate, f.endDate, f.weekdays, f.startTime, f.endTime, tz]);

  const headcount = Number(f.headcount) || 0;
  const rateCents = toCents(f.rate);
  const totalMinutes = preview?.windows.reduce((n, w) => n + w.minutes, 0) ?? 0;
  const estimate = rateCents != null ? Math.round((totalMinutes * headcount * rateCents) / 60) : null;
  const durations = new Set(preview?.windows.map((w) => w.minutes));

  function submit() {
    setError(undefined);
    start(async () => {
      const res = await createShiftsAction(projectId, {
        locationId: f.locationId,
        requirementId: f.requirementId || null,
        role: f.role,
        startDate: f.startDate,
        endDate: f.endDate,
        weekdays: f.weekdays,
        startTime: f.startTime,
        endTime: f.endTime,
        headcount: f.headcount,
        rateCents: f.rate,
        breakPolicyId: f.breakPolicyId || null,
        reportingLocation: f.reportingLocation,
        onsiteContact: f.onsiteContact,
        uniform: f.uniform,
        instructions: f.instructions,
        publish: f.publish,
      });
      if (!res.ok) return setError(res.error);
      toast.success(res.message ?? "Shifts created");
      router.refresh();
      onClose();
    });
  }

  function saveTemplate() {
    start(async () => {
      const res = await createTemplateAction({
        name: f.templateName || `${FIELD_ROLE_NAMES[f.role]} ${f.startTime}–${f.endTime}`,
        role: f.role,
        localStartTime: f.startTime,
        localEndTime: f.endTime,
        headcount: f.headcount,
        rateCents: f.rate,
        uniform: f.uniform,
        instructions: f.instructions,
      });
      if (res.ok) {
        toast.success(res.message ?? "Template saved");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create shifts</DialogTitle>
          <DialogDescription>One shift is created for each matching date. Times are local to the location.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Location" htmlFor="b-loc">
              <NativeSelect id="b-loc" value={f.locationId} onChange={(e) => set({ locationId: e.target.value, requirementId: "" })}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="From requirement" htmlFor="b-req" hint="Optional: pre-fills role, people and rate">
              <NativeSelect id="b-req" value={f.requirementId} onChange={(e) => applyRequirement(e.target.value)}>
                <option value="">None</option>
                {relevantReqs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.quantity} × {FIELD_ROLE_NAMES[r.role]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="From template" htmlFor="b-tpl" hint="Optional: pre-fills times and details">
              <NativeSelect id="b-tpl" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">None</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Role" htmlFor="b-role">
              <NativeSelect id="b-role" value={f.role} onChange={(e) => set({ role: e.target.value as FieldRole })}>
                {FIELD_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {FIELD_ROLE_NAMES[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="People per shift" htmlFor="b-hc">
              <Input id="b-hc" type="number" min={1} max={500} value={f.headcount} onChange={(e) => set({ headcount: e.target.value })} />
            </Field>
            {showRates ? (
              <Field label="Hourly rate (CAD)" htmlFor="b-rate" hint="Leave blank to use each person's default rate">
                <Input id="b-rate" inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} placeholder="25.00" />
              </Field>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="First date" htmlFor="b-start">
              <Input id="b-start" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: f.endDate || e.target.value })} />
            </Field>
            <Field label="Last date" htmlFor="b-end">
              <Input id="b-end" type="date" value={f.endDate} min={f.startDate} onChange={(e) => set({ endDate: e.target.value })} />
            </Field>
            <Field label="Start time" htmlFor="b-st">
              <Input id="b-st" type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            </Field>
            <Field label="End time" htmlFor="b-et" hint={f.endTime <= f.startTime ? "Ends the next day" : undefined}>
              <Input id="b-et" type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Days of the week</legend>
            <div className="flex flex-wrap items-center gap-1.5">
              {DAY_LABELS.map((d, i) => {
                const on = f.weekdays.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_NAMES[i]}
                    onClick={() => set({ weekdays: on ? f.weekdays.filter((x) => x !== i) : [...f.weekdays, i].sort() })}
                    className={`size-9 cursor-pointer rounded-full border text-sm font-medium ${on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent"}`}
                  >
                    {d}
                  </button>
                );
              })}
              <span className="ml-2 text-xs text-muted-foreground">{f.weekdays.length ? "Only selected days" : "Every day in the range"}</span>
            </div>
          </fieldset>

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Details staff will see (optional)</summary>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Reporting location" htmlFor="b-report">
                  <Input id="b-report" value={f.reportingLocation} onChange={(e) => set({ reportingLocation: e.target.value })} placeholder="Staff entrance, Door 5" />
                </Field>
                <Field label="On-site contact" htmlFor="b-contact">
                  <Input id="b-contact" value={f.onsiteContact} onChange={(e) => set({ onsiteContact: e.target.value })} />
                </Field>
              </div>
              <Field label="Uniform" htmlFor="b-uniform">
                <Input id="b-uniform" value={f.uniform} onChange={(e) => set({ uniform: e.target.value })} placeholder="Black pants, black shoes; branded shirt provided" />
              </Field>
              <Field label="Instructions" htmlFor="b-instr">
                <Textarea id="b-instr" value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} rows={3} />
              </Field>
              {breakPolicies.length ? (
                <Field label="Break policy" htmlFor="b-break" hint="Breaks are never deducted automatically unless a policy is attached.">
                  <NativeSelect id="b-break" value={f.breakPolicyId} onChange={(e) => set({ breakPolicyId: e.target.value })}>
                    <option value="">None</option>
                    {breakPolicies.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
            </div>
          </details>

          <div className="rounded-lg bg-muted/60 p-4 text-sm" aria-live="polite">
            {!preview ? (
              <p className="text-muted-foreground">Choose dates to preview the shifts.</p>
            ) : preview.error ? (
              <p className="text-destructive">{preview.error}</p>
            ) : (
              <>
                <p className="font-medium">
                  {preview.windows.length} shift{preview.windows.length === 1 ? "" : "s"} · {preview.windows.length * headcount} positions ·{" "}
                  {formatMinutes(totalMinutes * headcount)} scheduled
                  {showRates && estimate != null ? ` · est. ${formatMoney(estimate)}` : ""}
                </p>
                {durations.size > 1 ? (
                  <p className="mt-1 text-warning">Shift lengths vary because of a daylight-saving change in this range.</p>
                ) : null}
                <ul className="mt-2 grid gap-0.5 text-muted-foreground">
                  {preview.windows.slice(0, 6).map((w) => (
                    <li key={w.date}>
                      {format(parseISO(w.date), "EEE MMM d")}: {formatInZone(w.startsAt, tz, "h:mm a")} – {formatInZone(w.endsAt, tz, "h:mm a")}
                      {w.crossesMidnight ? " (next day)" : ""} · {formatMinutes(w.minutes)}
                    </li>
                  ))}
                  {preview.windows.length > 6 ? <li>…and {preview.windows.length - 6} more</li> : null}
                </ul>
              </>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={f.publish} onCheckedChange={(c) => set({ publish: Boolean(c) })} className="mt-0.5" />
            <span>
              Publish now
              <span className="block text-xs text-muted-foreground">Published shifts are ready for offers. Drafts stay hidden until you publish them.</span>
            </span>
          </label>

          {error ? <FormMessage>{error}</FormMessage> : null}

          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Input
                value={f.templateName}
                onChange={(e) => set({ templateName: e.target.value })}
                placeholder="Template name"
                aria-label="Template name"
                className="h-8 w-44 text-sm"
              />
              <Button variant="ghost" size="sm" type="button" disabled={pending} onClick={saveTemplate}>
                Save as template
              </Button>
            </div>
            <Button disabled={pending || !preview || Boolean(preview.error) || preview.windows.length === 0} onClick={submit}>
              {pending ? "Creating…" : `Create ${preview?.windows.length ?? 0} shift${preview?.windows.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
