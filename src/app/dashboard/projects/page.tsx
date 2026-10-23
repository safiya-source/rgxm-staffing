import { BriefcaseIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateRange, formatMoney } from "@/lib/format";
import { canAny } from "@/server/authz/permissions";
import { listProjects } from "@/server/queries/projects";
import { requireInternal, toActor } from "@/server/session";
import { ProjectFilters } from "./project-filters";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: PageProps<"/dashboard/projects">) {
  const viewer = await requireInternal("project.view");
  const actor = toActor(viewer);
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const status = str(sp.status) ?? "active";
  const rows = await listProjects({ q: str(sp.q)?.slice(0, 80), status, mine: str(sp.mine), userId: viewer.userId });
  const showBudget = canAny(actor, "budget.view");

  return (
    <>
      <PageHeader
        title="Projects"
        description="Activations, locations, staffing and budgets."
        actions={
          canAny(actor, "project.create") ? (
            <Button asChild size="sm">
              <Link href="/dashboard/projects/new">
                <PlusIcon /> New project
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4">
        <ProjectFilters />
        {rows.length === 0 ? (
          <EmptyState
            icon={BriefcaseIcon}
            title="No projects match"
            description={status === "active" ? "Active means draft, staffing, confirmed or live." : undefined}
          />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Project</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Staffing</TableHead>
                  {showBudget ? <TableHead className="text-right">Est. cost / budget</TableHead> : null}
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const fill = p.positions ? Math.round((p.confirmed / p.positions) * 100) : 0;
                  const est = Number(p.estimatedCents);
                  const over = p.budgetCents != null && est > p.budgetCents;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/dashboard/projects/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        {p.isDemo ? <DemoBadge className="ml-1.5" /> : null}
                        <p className="text-xs text-muted-foreground">{[p.client, p.code].filter(Boolean).join(" · ")}</p>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{formatDateRange(p.startDate, p.endDate)}</TableCell>
                      <TableCell>
                        <StatusBadge kind="project" status={p.status} />
                      </TableCell>
                      <TableCell className="min-w-36">
                        {p.positions ? (
                          <div>
                            <div className="flex justify-between text-xs">
                              <span>
                                {p.confirmed}/{p.positions} filled
                              </span>
                              <span className="text-muted-foreground">{fill}%</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                              <div className="h-full rounded-full bg-success" style={{ width: `${fill}%` }} />
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">No shifts yet</span>
                        )}
                      </TableCell>
                      {showBudget ? (
                        <TableCell className="text-right text-sm whitespace-nowrap tabular-nums">
                          <span className={over ? "font-medium text-destructive" : undefined}>{formatMoney(est, p.currency)}</span>
                          <span className="text-muted-foreground"> / {p.budgetCents != null ? formatMoney(p.budgetCents, p.currency) : "—"}</span>
                        </TableCell>
                      ) : null}
                      <TableCell className="text-sm text-muted-foreground">{p.ownerName ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
