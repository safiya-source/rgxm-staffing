import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { canOnProject } from "@/server/authz/permissions";
import { getProjectBudget, type BudgetLine } from "@/server/queries/budget";
import { getProjectHeader } from "@/server/queries/projects";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";

export const metadata: Metadata = { title: "Budget" };

function Breakdown({ title, lines, label, currency }: { title: string; lines: BudgetLine[]; label: (k: string) => string; currency: string }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{title.replace("By ", "").replace(/^\w/, (c) => c.toUpperCase())}</TableHead>
            <TableHead className="text-right">Actual</TableHead>
            <TableHead className="text-right">Pending</TableHead>
            <TableHead className="text-right">Committed</TableHead>
            <TableHead className="text-right">Forecast</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                No confirmed bookings yet.
              </TableCell>
            </TableRow>
          ) : null}
          {lines.map((l) => (
            <TableRow key={l.key}>
              <TableCell className="font-medium">{label(l.key)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(l.actual, currency)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(l.pending, currency)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(l.committed, currency)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatMoney(l.actual + l.pending + l.committed, currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default async function BudgetPage({ params }: PageProps<"/dashboard/projects/[id]/budget">) {
  const viewer = await requireInternal("project.view");
  const { id } = await params;
  const scope = (await loadProjectScopes([id])).get(id)!;
  if (!canOnProject(toActor(viewer), "budget.view", scope)) notFound();
  const [header, budget] = await Promise.all([getProjectHeader(id), getProjectBudget(id)]);
  const p = header!.project;
  const c = p.currency;
  const t = budget.totals;
  const forecast = t.actual + t.pending + t.committed;
  const variance = p.budgetCents != null ? p.budgetCents - forecast : null;
  const pct = p.budgetCents ? Math.round((forecast / p.budgetCents) * 100) : null;
  const tone = pct === null ? "default" : pct > 100 ? "danger" : pct >= 90 ? "warning" : "default";

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Budget" value={p.budgetCents != null ? formatMoney(p.budgetCents, c) : "Not set"} hint={p.budgetCents == null ? "Set it in Setup" : undefined} />
        <StatCard label="Actual (approved)" value={formatMoney(t.actual, c)} hint="Approved payables" />
        <StatCard label="Pending approval" value={formatMoney(t.pending, c)} hint="Ended shifts, estimated" />
        <StatCard label="Committed" value={formatMoney(t.committed, c)} hint="Upcoming confirmed shifts" />
        <StatCard
          label="Variance"
          value={variance != null ? formatMoney(variance, c) : "—"}
          tone={variance != null && variance < 0 ? "danger" : tone}
          hint={variance != null ? (variance < 0 ? "Over budget (forecast)" : "Left after forecast") : undefined}
        />
      </div>

      {p.budgetCents ? (
        <Card>
          <CardContent className="grid gap-2 pt-5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Forecast {formatMoney(forecast, c)}</span>
              <span className="text-muted-foreground tabular-nums">{pct}% of budget</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label="Forecast spend as a share of budget"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(pct!, 100)}
              aria-valuetext={`${pct}% of budget`}
            >
              <div className={`h-full rounded-full ${tone === "danger" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-success"}`} style={{ width: `${Math.min(pct!, 100)}%` }} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>How these are worked out</CardTitle>
          <CardDescription>
            Actual is the sum of approved payables. Pending estimates ended shifts that aren&apos;t approved yet from the hours under review
            (or the schedule if there are none). Committed is upcoming confirmed shifts at the scheduled length. All use each booking&apos;s agreed rate.
            Forecast = actual + pending + committed. Open positions and expenses aren&apos;t included.
            {budget.unpriced ? ` ${budget.unpriced} booking(s) have no agreed rate and are left out.` : ""}
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Breakdown title="By role" lines={budget.byRole} label={(k) => FIELD_ROLE_NAMES[k as FieldRole] ?? k} currency={c} />
        <Breakdown title="By location" lines={budget.byLocation} label={(k) => k} currency={c} />
      </div>
      <Breakdown title="By date" lines={budget.byDate} label={(k) => k} currency={c} />
    </div>
  );
}
