import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, FIELD_ROLES } from "@/lib/roles";
import { canOnProject } from "@/server/authz/permissions";
import { getProjectCoverage, getProjectHeader, getProjectSetup } from "@/server/queries/projects";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";

export const metadata: Metadata = { title: "Project overview" };

export default async function ProjectOverviewPage({ params }: PageProps<"/dashboard/projects/[id]">) {
  const viewer = await requireInternal("project.view");
  const { id } = await params;
  const [header, coverage, setup, scopes] = await Promise.all([getProjectHeader(id), getProjectCoverage(id), getProjectSetup(id), loadProjectScopes([id])]);
  const p = header!.project;
  const actor = toActor(viewer);
  const showBudget = canOnProject(actor, "budget.view", scopes.get(id)!);

  const positions = coverage.byRole.reduce((n, r) => n + r.positions, 0);
  const confirmed = coverage.byRole.reduce((n, r) => n + r.confirmed, 0);
  const pending = coverage.byRole.reduce((n, r) => n + r.pending, 0);
  const estimated = coverage.byRole.reduce((n, r) => n + r.estimatedCents, 0);
  const unpriced = coverage.byRole.reduce((n, r) => n + r.unpricedShifts, 0);
  const budget = p.budgetCents;
  const budgetPct = budget ? Math.round((estimated / budget) * 100) : null;

  const locationName = (lid: string | null) => setup.locations.find((l) => l.id === lid)?.name ?? "All locations";
  // Combine requirements and scheduled shifts into one row per role + location.
  const keys = new Map<string, { role: (typeof FIELD_ROLES)[number]; locationId: string | null }>();
  for (const r of coverage.requirements) keys.set(`${r.role}|${r.locationId ?? ""}`, { role: r.role, locationId: r.locationId });
  for (const r of coverage.byRole) keys.set(`${r.role}|${r.locationId}`, { role: r.role, locationId: r.locationId });
  const rows = [...keys.values()]
    .sort((a, b) => FIELD_ROLES.indexOf(a.role) - FIELD_ROLES.indexOf(b.role) || locationName(a.locationId).localeCompare(locationName(b.locationId)))
    .map((k) => {
      const req = coverage.requirements.filter((r) => r.role === k.role && (r.locationId ?? null) === k.locationId).reduce((n, r) => n + r.quantity, 0);
      const sched = coverage.byRole.find((r) => r.role === k.role && r.locationId === k.locationId);
      return { ...k, required: req, shifts: sched?.shifts ?? 0, positions: sched?.positions ?? 0, confirmed: sched?.confirmed ?? 0, pending: sched?.pending ?? 0 };
    });

  const steps = [
    { done: setup.locations.length > 0, label: "Add activation locations", href: "setup" },
    { done: setup.requirements.length > 0, label: "Define staffing requirements", href: "setup" },
    { done: positions > 0, label: "Create shifts", href: "shifts" },
    { done: confirmed > 0, label: "Send offers and confirm staff (coming in M3)", href: null },
  ];

  return (
    <div className="grid gap-6">
      {steps.some((s) => !s.done) ? (
        <Card>
          <CardHeader>
            <CardTitle>Setup checklist</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 pt-2 sm:grid-cols-2">
            {steps.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-sm">
                {s.done ? <CheckCircle2Icon className="size-4 text-success" /> : <CircleIcon className="size-4 text-muted-foreground" />}
                {s.href && !s.done ? (
                  <Link href={`/dashboard/projects/${id}/${s.href}`} className="font-medium hover:underline">
                    {s.label}
                  </Link>
                ) : (
                  <span className={s.done ? "text-muted-foreground line-through" : undefined}>{s.label}</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Scheduled positions" value={positions} hint={`${coverage.totals.upcoming} upcoming shifts`} href={`/dashboard/projects/${id}/shifts`} />
        <StatCard label="Confirmed" value={confirmed} hint={positions ? `${Math.round((confirmed / positions) * 100)}% filled` : undefined} />
        <StatCard label="Unfilled" value={Math.max(positions - confirmed, 0)} tone={positions - confirmed > 0 ? "warning" : "default"} />
        <StatCard label="Pending offers" value={pending} />
        {showBudget ? (
          <StatCard
            label="Estimated cost"
            value={formatMoney(estimated, p.currency)}
            tone={budgetPct !== null && budgetPct > 100 ? "danger" : budgetPct !== null && budgetPct >= 90 ? "warning" : "default"}
            hint={budget ? `${budgetPct}% of ${formatMoney(budget, p.currency)} budget` : "No budget set"}
          />
        ) : (
          <StatCard label="Draft shifts" value={coverage.totals.drafts} />
        )}
      </div>
      {showBudget && unpriced > 0 ? (
        <p className="-mt-3 text-sm text-warning">
          {unpriced} shift{unpriced === 1 ? " has" : "s have"} no rate, so {unpriced === 1 ? "it isn't" : "they aren't"} included in the estimate.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Staffing by role</CardTitle>
          <CardDescription>
            &ldquo;Required&rdquo; is the number of people in the staffing plan; positions are headcount summed across scheduled shifts.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add staffing requirements or shifts to see coverage.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Role</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Required</TableHead>
                  <TableHead className="text-right">Shifts</TableHead>
                  <TableHead className="text-right">Positions</TableHead>
                  <TableHead className="text-right">Confirmed</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="w-40">Fill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const pct = r.positions ? Math.round((r.confirmed / r.positions) * 100) : 0;
                  return (
                    <TableRow key={`${r.role}-${r.locationId}`}>
                      <TableCell className="font-medium">{FIELD_ROLE_NAMES[r.role]}</TableCell>
                      <TableCell className="text-muted-foreground">{locationName(r.locationId)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.required || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.shifts}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.positions}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.confirmed}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.pending}</TableCell>
                      <TableCell>
                        {r.positions ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                              <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No shifts</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Locations</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-2 text-sm">
            {setup.locations.length === 0 ? <p className="text-muted-foreground">None yet.</p> : null}
            {setup.locations.map((l) => (
              <div key={l.id}>
                <p className="font-medium">{l.name}</p>
                <p className="text-muted-foreground">{[l.address, l.timezone, l.onsiteContactName && `On-site: ${l.onsiteContactName}`].filter(Boolean).join(" · ")}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Project notes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-2 text-sm">
            {p.description ? <p className="whitespace-pre-wrap">{p.description}</p> : null}
            {p.internalNotes ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Internal</p>
                <p className="whitespace-pre-wrap">{p.internalNotes}</p>
              </div>
            ) : null}
            {p.clientNotes ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Client-facing</p>
                <p className="whitespace-pre-wrap">{p.clientNotes}</p>
              </div>
            ) : null}
            {!p.description && !p.internalNotes && !p.clientNotes ? <p className="text-muted-foreground">No notes.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
