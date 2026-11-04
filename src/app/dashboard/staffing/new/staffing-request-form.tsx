"use client";
import { format, parseISO } from "date-fns";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMinutes, formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { COMMON_TIME_ZONES, expandShiftPattern } from "@/lib/time";
import { cn } from "@/lib/utils";
import { createStaffingRequestAction } from "../actions";

type ProjectOption = { id: string; label: string; canAddVenue: boolean; locations: { id: string; label: string; timezone: string }[] };

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NEW = "__new";
const toCents = (v: string) => (/^\d{1,4}(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : null);

function previewShifts(s: { startDate: string; endDate: string; weekdays: number[]; startTime: string; endTime: string }, timeZone: string) {
  if (!s.startDate || !s.endDate) return null;
  try {
    return { windows: expandShiftPattern({ startDate: s.startDate, endDate: s.endDate, weekdays: s.weekdays, startTime: s.startTime, endTime: s.endTime, timeZone }), error: null as string | null };
  } catch (err) {
    return { windows: [], error: err instanceof Error ? err.message : "Check the dates" };
  }
}

function Choice({ checked, onSelect, label }: { checked: boolean; onSelect: () => void; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn("rounded-full border px-3 py-1.5 text-sm", checked ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent")}
    >
      {label}
    </button>
  );
}

export function StaffingRequestForm({
  projects,
  clients,
  canCreateProject,
  defaultTimezone,
  showRates,
  preselectProjectId,
}: {
  projects: ProjectOption[];
  clients: { id: string; name: string }[];
  canCreateProject: boolean;
  defaultTimezone: string;
  showRates: boolean;
  preselectProjectId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  // Start on an existing project when there is one; otherwise straight into a new project.
  const [projectMode, setProjectMode] = useState<"existing" | "new">(projects.length || !canCreateProject ? "existing" : "new");
  const [projectId, setProjectId] = useState(preselectProjectId ?? projects[0]?.id ?? "");
  const [np, setNp] = useState({ name: "", clientId: "", newClientName: "", code: "" });
  const project = projects.find((p) => p.id === projectId);
  const existingLocations = projectMode === "existing" ? (project?.locations ?? []) : [];
  const canAddVenue = projectMode === "new" || Boolean(project?.canAddVenue);
  const [locationChoice, setLocationChoice] = useState<string>(existingLocations[0]?.id ?? NEW);
  const [nl, setNl] = useState({ name: "", address: "", city: "", timezone: defaultTimezone });
  const [s, setS] = useState({
    role: "BA" as FieldRole,
    startDate: "",
    endDate: "",
    weekdays: [] as number[],
    startTime: "10:00",
    endTime: "18:00",
    headcount: "1",
    rate: "",
    reportingLocation: "",
    uniform: "",
    instructions: "",
  });
  const setShift = (patch: Partial<typeof s>) => setS((cur) => ({ ...cur, ...patch, ...(patch.startDate && (!cur.endDate || cur.endDate < patch.startDate) ? { endDate: patch.startDate } : {}) }));

  // Keep the venue choice valid when the project changes.
  const venueValue = locationChoice === NEW || existingLocations.some((l) => l.id === locationChoice) ? locationChoice : (existingLocations[0]?.id ?? NEW);
  const usingNewVenue = venueValue === NEW;
  const timezone = usingNewVenue ? nl.timezone : (existingLocations.find((l) => l.id === venueValue)?.timezone ?? defaultTimezone);

  const preview = previewShifts(s, timezone);
  const headcount = Number(s.headcount) || 0;
  const minutes = preview?.windows.reduce((n, w) => n + w.minutes, 0) ?? 0;
  const rateCents = toCents(s.rate);
  const estimate = rateCents != null ? Math.round((minutes * headcount * rateCents) / 60) : null;

  const missing =
    (projectMode === "existing" ? !projectId : np.name.trim().length < 2) ||
    (usingNewVenue ? !canAddVenue || !nl.name.trim() : false) ||
    !s.startDate ||
    !s.endDate ||
    !preview?.windows.length ||
    headcount < 1;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    start(async () => {
      const res = await createStaffingRequestAction({
        project:
          projectMode === "existing"
            ? { mode: "existing", projectId }
            : { mode: "new", name: np.name, clientId: np.clientId === NEW ? null : np.clientId || null, newClientName: np.clientId === NEW ? np.newClientName : null, code: np.code },
        location: usingNewVenue ? { mode: "new", ...nl } : { mode: "existing", locationId: venueValue },
        shifts: {
          role: s.role,
          startDate: s.startDate,
          endDate: s.endDate,
          weekdays: s.weekdays,
          startTime: s.startTime,
          endTime: s.endTime,
          headcount: s.headcount,
          rateCents: s.rate,
          reportingLocation: s.reportingLocation,
          uniform: s.uniform,
          instructions: s.instructions,
        },
      });
      if (!res.ok) return setError(res.error);
      toast.success(res.message ?? "Staffing request created");
      router.push(res.data!.url);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Project</CardTitle>
          <CardDescription>Which activation is this for?</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {canCreateProject ? (
            <div role="radiogroup" aria-label="Project" className="flex flex-wrap gap-2">
              <Choice checked={projectMode === "existing"} onSelect={() => setProjectMode("existing")} label="Existing project" />
              <Choice checked={projectMode === "new"} onSelect={() => setProjectMode("new")} label="New project" />
            </div>
          ) : null}
          {projectMode === "existing" ? (
            projects.length ? (
              <Field label="Project" htmlFor="r-project">
                <NativeSelect id="r-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">
                {canCreateProject ? "No open projects yet. Choose “New project”." : "You aren't assigned to any open projects. Ask a Project Manager to add you."}
              </p>
            )
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project name" htmlFor="r-name" className="sm:col-span-2">
                <Input id="r-name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="e.g. Oreo Holiday Sampling" />
              </Field>
              <Field label="Client" htmlFor="r-client">
                <NativeSelect id="r-client" value={np.clientId} onChange={(e) => setNp({ ...np, clientId: e.target.value })}>
                  <option value="">No client yet</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value={NEW}>+ New client…</option>
                </NativeSelect>
              </Field>
              {np.clientId === NEW ? (
                <Field label="New client name" htmlFor="r-newclient">
                  <Input id="r-newclient" value={np.newClientName} onChange={(e) => setNp({ ...np, newClientName: e.target.value })} />
                </Field>
              ) : null}
              <Field label="Project code (optional)" htmlFor="r-code" hint="Leave blank and we'll make one, e.g. OREO-2612">
                <Input id="r-code" value={np.code} onChange={(e) => setNp({ ...np, code: e.target.value.toUpperCase() })} className="font-mono" />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Venue</CardTitle>
          <CardDescription>Shift times are local to the venue.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {existingLocations.length ? (
            <Field label="Venue" htmlFor="r-venue">
              <NativeSelect id="r-venue" value={venueValue} onChange={(e) => setLocationChoice(e.target.value)}>
                {existingLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
                {canAddVenue ? <option value={NEW}>+ New venue…</option> : null}
              </NativeSelect>
            </Field>
          ) : null}
          {usingNewVenue ? (
            canAddVenue ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Venue name" htmlFor="r-vname">
                  <Input id="r-vname" value={nl.name} onChange={(e) => setNl({ ...nl, name: e.target.value })} placeholder="e.g. CF Toronto Eaton Centre" />
                </Field>
                <Field label="City" htmlFor="r-vcity">
                  <Input id="r-vcity" value={nl.city} onChange={(e) => setNl({ ...nl, city: e.target.value })} placeholder="Toronto" />
                </Field>
                <Field label="Address (optional)" htmlFor="r-vaddr">
                  <Input id="r-vaddr" value={nl.address} onChange={(e) => setNl({ ...nl, address: e.target.value })} />
                </Field>
                <Field label="Time zone" htmlFor="r-vtz">
                  <NativeSelect id="r-vtz" value={nl.timezone} onChange={(e) => setNl({ ...nl, timezone: e.target.value })}>
                    {COMMON_TIME_ZONES.map(([tz, label]) => (
                      <option key={tz} value={tz}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This project has no venues yet, and only its Project Manager can add one.</p>
            )
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Shifts</CardTitle>
          <CardDescription>One shift is created for each matching day.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Role" htmlFor="r-role">
              <NativeSelect id="r-role" value={s.role} onChange={(e) => setShift({ role: e.target.value as FieldRole })}>
                {FIELD_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {FIELD_ROLE_NAMES[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="People per shift" htmlFor="r-head">
              <Input id="r-head" type="number" min={1} max={500} value={s.headcount} onChange={(e) => setShift({ headcount: e.target.value })} />
            </Field>
            {showRates ? (
              <Field label="Hourly rate (optional)" htmlFor="r-rate" hint="Blank = each person's own rate">
                <Input id="r-rate" inputMode="decimal" value={s.rate} onChange={(e) => setShift({ rate: e.target.value })} placeholder="25.00" />
              </Field>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="First day" htmlFor="r-start">
              <Input id="r-start" type="date" value={s.startDate} onChange={(e) => setShift({ startDate: e.target.value })} />
            </Field>
            <Field label="Last day" htmlFor="r-end">
              <Input id="r-end" type="date" value={s.endDate} min={s.startDate} onChange={(e) => setShift({ endDate: e.target.value })} />
            </Field>
            <Field label="Start time" htmlFor="r-st">
              <Input id="r-st" type="time" value={s.startTime} onChange={(e) => setShift({ startTime: e.target.value })} />
            </Field>
            <Field label="End time" htmlFor="r-et" hint={s.endTime <= s.startTime ? "Ends the next day" : undefined}>
              <Input id="r-et" type="time" value={s.endTime} onChange={(e) => setShift({ endTime: e.target.value })} />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Days of the week</legend>
            <div className="flex flex-wrap items-center gap-1.5">
              {DAY_LABELS.map((d, i) => {
                const on = s.weekdays.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_NAMES[i]}
                    onClick={() => setShift({ weekdays: on ? s.weekdays.filter((x) => x !== i) : [...s.weekdays, i].sort() })}
                    className={cn("size-9 rounded-full border text-sm font-medium", on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent")}
                  >
                    {d}
                  </button>
                );
              })}
              <span className="ml-2 text-xs text-muted-foreground">{s.weekdays.length ? "Only selected days" : "Every day in the range"}</span>
            </div>
          </fieldset>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">More details for staff (optional)</summary>
            <div className="mt-4 grid gap-4">
              <Field label="Report to" htmlFor="r-report">
                <Input id="r-report" value={s.reportingLocation} onChange={(e) => setShift({ reportingLocation: e.target.value })} placeholder="e.g. Staff entrance off Queen St" />
              </Field>
              <Field label="Uniform" htmlFor="r-uniform">
                <Input id="r-uniform" value={s.uniform} onChange={(e) => setShift({ uniform: e.target.value })} />
              </Field>
              <Field label="Instructions" htmlFor="r-instr">
                <Textarea id="r-instr" rows={3} value={s.instructions} onChange={(e) => setShift({ instructions: e.target.value })} />
              </Field>
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="grid gap-3 rounded-xl border bg-card p-4" aria-live="polite">
        {preview?.error ? (
          <p className="text-sm text-destructive">{preview.error}</p>
        ) : preview?.windows.length ? (
          <p className="text-sm">
            <span className="font-medium">
              {preview.windows.length} shift{preview.windows.length === 1 ? "" : "s"} × {headcount} {headcount === 1 ? "person" : "people"} = {preview.windows.length * headcount} position
              {preview.windows.length * headcount === 1 ? "" : "s"}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · {format(parseISO(preview.windows[0]!.date), "EEE MMM d")}
              {preview.windows.length > 1 ? ` – ${format(parseISO(preview.windows.at(-1)!.date), "EEE MMM d")}` : ""} · {formatMinutes(minutes * headcount)} in total
              {estimate != null ? ` · about ${formatMoney(estimate)}` : ""}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Pick the days and times to see what will be created.</p>
        )}
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button type="submit" disabled={pending || missing} className="w-fit">
          {pending ? "Creating…" : "Create & send offers"}
        </Button>
      </div>
    </form>
  );
}
