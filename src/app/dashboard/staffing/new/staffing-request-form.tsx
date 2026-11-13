"use client";
import { addDays, format, parseISO } from "date-fns";
import { PlusIcon, XIcon } from "lucide-react";
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
import { CompensationFields, type CompensationDefaults } from "@/components/app/compensation-fields";
import { readCompensationForm } from "@/lib/compensation-form";
import { FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { COMMON_TIME_ZONES, isIsoDate, MAX_BULK_SHIFTS, shiftInstants } from "@/lib/time";
import { cn } from "@/lib/utils";
import { createStaffingRequestAction } from "../actions";

type ProjectOption = {
  id: string;
  label: string;
  canAddVenue: boolean;
  roleRates: Partial<Record<FieldRole, number>>;
  // null = nothing set yet (defaults); undefined = the viewer can't set compensation on this project.
  compensation?: CompensationDefaults | null;
  locations: { id: string; label: string; timezone: string }[];
};

/** All off, at the initial CAD rates. */
const NEW_COMPENSATION: CompensationDefaults = {
  mealsEnabled: false,
  perDiemEnabled: false,
  mileageEnabled: false,
  bonusEnabled: false,
  breakfastCents: 2000,
  lunchCents: 2500,
  dinnerCents: 4000,
  perDiemCents: 8500,
  mileageRate: "0.7300",
  eligibleMeals: ["meal_breakfast", "meal_lunch", "meal_dinner"],
  bonusCents: null,
  bonusConditions: null,
  notes: null,
};

const NEW = "__new";

type RoleLine = { key: number; role: FieldRole; headcount: string; rate: string; rateEdited: boolean };
const toCents = (v: string) => (/^\d{1,4}(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : null);

type DayLine = { key: number; date: string; startTime: string; endTime: string };

/** The shifts each role will get: one per day line, in date order. */
function previewShifts(days: DayLine[], timeZone: string) {
  const filled = days.filter((d) => isIsoDate(d.date));
  if (!filled.length) return null;
  if (filled.some((d) => !d.startTime || !d.endTime)) return { windows: [], error: "Add a start and end time for each day." };
  if (filled.some((d) => d.startTime === d.endTime)) return { windows: [], error: "A day's start and end time can't be the same." };
  const windows = filled
    .map((d) => ({ date: d.date, ...shiftInstants(d.date, d.startTime, d.endTime, timeZone) }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { windows, error: null as string | null };
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
  defaultRates,
  preselectProjectId,
  canSetCompensation = false,
}: {
  projects: ProjectOption[];
  clients: { id: string; name: string }[];
  canCreateProject: boolean;
  defaultTimezone: string;
  showRates: boolean;
  defaultRates: Partial<Record<FieldRole, number>>;
  preselectProjectId?: string;
  canSetCompensation?: boolean;
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
  // Rate to pre-fill for a role: the project's own rate, else the company default.
  const rateFor = (role: FieldRole) => {
    const cents = (projectMode === "existing" ? project?.roleRates[role] : undefined) ?? defaultRates[role];
    return showRates && cents != null ? (cents / 100).toFixed(2) : "";
  };
  const [roles, setRoles] = useState<RoleLine[]>(() => [{ key: 1, role: "BA", headcount: "1", rate: "", rateEdited: false }]);
  // Untouched rates follow the role and project; a rate someone typed is kept.
  const lines = roles.map((l) => (l.rateEdited ? l : { ...l, rate: rateFor(l.role) }));
  const setLine = (key: number, patch: Partial<RoleLine>) => setRoles((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const unusedRole = FIELD_ROLES.find((r) => !roles.some((l) => l.role === r));
  const [days, setDays] = useState<DayLine[]>(() => [{ key: 1, date: "", startTime: "10:00", endTime: "18:00" }]);
  const setDay = (key: number, patch: Partial<DayLine>) => setDays((cur) => cur.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  // A new day starts the day after the last one, with the same times; change either as needed.
  const addDay = () =>
    setDays((cur) => {
      const last = cur.at(-1)!;
      const next = isIsoDate(last.date) ? format(addDays(parseISO(last.date), 1), "yyyy-MM-dd") : "";
      return [...cur, { key: Math.max(...cur.map((d) => d.key)) + 1, date: next, startTime: last.startTime, endTime: last.endTime }];
    });
  const [s, setS] = useState({
    reportingLocation: "",
    uniform: "",
    instructions: "",
  });
  const setShift = (patch: Partial<typeof s>) => setS((cur) => ({ ...cur, ...patch }));

  // Keep the venue choice valid when the project changes.
  const venueValue = locationChoice === NEW || existingLocations.some((l) => l.id === locationChoice) ? locationChoice : (existingLocations[0]?.id ?? NEW);
  const usingNewVenue = venueValue === NEW;
  const timezone = usingNewVenue ? nl.timezone : (existingLocations.find((l) => l.id === venueValue)?.timezone ?? defaultTimezone);

  const preview = previewShifts(days, timezone);
  const headcount = lines.reduce((n, l) => n + (Number(l.headcount) || 0), 0);
  const minutes = preview?.windows.reduce((n, w) => n + w.minutes, 0) ?? 0;
  // Only estimate cost when every role has a rate.
  const allRated = lines.every((l) => toCents(l.rate) != null);
  const estimate = allRated ? lines.reduce((n, l) => n + Math.round((minutes * (Number(l.headcount) || 0) * toCents(l.rate)!) / 60), 0) : null;

  const missing =
    (projectMode === "existing" ? !projectId : np.name.trim().length < 2) ||
    (usingNewVenue ? !canAddVenue || !nl.name.trim() : false) ||
    days.some((d) => !isIsoDate(d.date)) ||
    !preview?.windows.length ||
    preview.windows.length * lines.length > MAX_BULK_SHIFTS ||
    lines.some((l) => !(Number(l.headcount) >= 1));

  const selectedProject = projectMode === "existing" ? projects.find((p) => p.id === projectId) : undefined;
  // New project: anyone allowed to configure compensation; existing: only where they may on that project.
  const showCompensation = canSetCompensation && (projectMode === "new" || selectedProject?.compensation !== undefined);
  const compensationDefaults = projectMode === "new" ? NEW_COMPENSATION : (selectedProject?.compensation ?? NEW_COMPENSATION);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const compensation = showCompensation ? readCompensationForm(new FormData(e.currentTarget)) : undefined;
    start(async () => {
      const res = await createStaffingRequestAction({
        project:
          projectMode === "existing"
            ? { mode: "existing", projectId }
            : { mode: "new", name: np.name, clientId: np.clientId === NEW ? null : np.clientId || null, newClientName: np.clientId === NEW ? np.newClientName : null, code: np.code },
        location: usingNewVenue ? { mode: "new", ...nl } : { mode: "existing", locationId: venueValue },
        shifts: {
          roles: lines.map((l) => ({ role: l.role, headcount: l.headcount, rateCents: showRates ? l.rate : "" })),
          days: days.map((d) => ({ date: d.date, startTime: d.startTime, endTime: d.endTime })),
          reportingLocation: s.reportingLocation,
          uniform: s.uniform,
          instructions: s.instructions,
        },
        compensation,
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
          <CardDescription>Each role gets one shift on every day you add.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <fieldset className="grid gap-3">
            <legend className="sr-only">Roles</legend>
            {lines.map((l, i) => (
              <div key={l.key} className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_9rem_2.25rem]" data-testid="role-line">
                <Field label={i === 0 ? "Role" : `Role ${i + 1}`} htmlFor={`r-role-${l.key}`}>
                  <NativeSelect id={`r-role-${l.key}`} value={l.role} onChange={(e) => setLine(l.key, { role: e.target.value as FieldRole })}>
                    {FIELD_ROLES.filter((r) => r === l.role || !roles.some((o) => o.role === r)).map((r) => (
                      <option key={r} value={r}>
                        {FIELD_ROLE_NAMES[r]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="People per shift" htmlFor={`r-head-${l.key}`}>
                  <Input id={`r-head-${l.key}`} type="number" min={1} max={500} value={l.headcount} onChange={(e) => setLine(l.key, { headcount: e.target.value })} />
                </Field>
                {showRates ? (
                  <Field label="Hourly rate" htmlFor={`r-rate-${l.key}`}>
                    <Input id={`r-rate-${l.key}`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value, rateEdited: true })} placeholder="Own rate" />
                  </Field>
                ) : (
                  <span />
                )}
                {lines.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${FIELD_ROLE_NAMES[l.role]}`} onClick={() => setRoles((cur) => cur.filter((x) => x.key !== l.key))}>
                    <XIcon />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              {unusedRole ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRoles((cur) => [...cur, { key: Math.max(...cur.map((x) => x.key)) + 1, role: unusedRole, headcount: "1", rate: "", rateEdited: false }])}
                >
                  <PlusIcon /> Add another role
                </Button>
              ) : null}
              {showRates ? <span className="text-xs text-muted-foreground">Rates are pre-filled from the project or company defaults. Leave a rate blank to use each person&apos;s own rate.</span> : null}
            </div>
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Days and times</legend>
            {days.map((d, i) => (
              <div key={d.key} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Field label={i === 0 ? "Day" : `Day ${i + 1}`} htmlFor={`r-day-${d.key}`} className="col-span-2 sm:col-span-1">
                  <Input id={`r-day-${d.key}`} type="date" value={d.date} onChange={(e) => setDay(d.key, { date: e.target.value })} />
                </Field>
                <Field label="Start time" htmlFor={`r-st-${d.key}`}>
                  <Input id={`r-st-${d.key}`} type="time" value={d.startTime} onChange={(e) => setDay(d.key, { startTime: e.target.value })} />
                </Field>
                <Field label="End time" htmlFor={`r-et-${d.key}`} hint={d.endTime && d.endTime <= d.startTime ? "Ends the next day" : undefined}>
                  <Input id={`r-et-${d.key}`} type="time" value={d.endTime} onChange={(e) => setDay(d.key, { endTime: e.target.value })} />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove day ${i + 1}`}
                  disabled={days.length === 1}
                  onClick={() => setDays((cur) => cur.filter((x) => x.key !== d.key))}
                  className={cn(days.length === 1 && "invisible")}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={addDay}>
                <PlusIcon /> Add another day
              </Button>
              <span className="ml-2 text-xs text-muted-foreground">Each day can have its own times.</span>
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

      {showCompensation ? (
        <Card>
          <CardHeader>
            <CardTitle>4. Allowances, mileage &amp; bonus</CardTitle>
            <CardDescription>
              On top of the hourly rate. These apply to the whole project and are shown to contractors on each shift before they accept. Staff record them per person and day
              once approved work comes in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompensationFields key={projectMode === "new" ? "new" : projectId} defaults={compensationDefaults} idPrefix="req-comp" />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 rounded-xl border bg-card p-4" aria-live="polite">
        {preview?.error ? (
          <p className="text-sm text-destructive">{preview.error}</p>
        ) : preview?.windows.length ? (
          <p className="text-sm">
            <span className="font-medium">
              {preview.windows.length} day{preview.windows.length === 1 ? "" : "s"} × {headcount} {headcount === 1 ? "person" : "people"}
              {lines.length > 1 ? ` (${lines.map((l) => `${Number(l.headcount) || 0} ${l.role}`).join(" + ")})` : ""} = {preview.windows.length * headcount} position
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
