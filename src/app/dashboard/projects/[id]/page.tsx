import { eq } from "drizzle-orm";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlannedSection } from "@/components/app/empty-state";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateRange, formatMoney, formatRate } from "@/lib/format";
import { FIELD_ROLE_NAMES } from "@/lib/roles";
import { canAny } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { clients, projectLocations, projects, staffingRequirements } from "@/server/db/schema";
import { requireInternal, toActor } from "@/server/session";

export const metadata: Metadata = { title: "Project" };


export default async function ProjectPage({ params }: PageProps<"/dashboard/projects/[id]">) {
  const viewer = await requireInternal("project.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [p] = await db
    .select({ project: projects, client: clients.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.id, id));
  if (!p) notFound();
  const locations = await db.select().from(projectLocations).where(eq(projectLocations.projectId, id));
  const reqs = await db.select().from(staffingRequirements).where(eq(staffingRequirements.projectId, id));
  const actor = toActor(viewer);
  const showRates = canAny(actor, "rates.view");
  const showBudget = canAny(actor, "budget.view");
  const project = p.project;

  return (
    <>
      <Link href="/dashboard/projects" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Projects
      </Link>
      <div className="mb-8">
        <p className="text-sm text-muted-foreground">{[p.client, project.code].filter(Boolean).join(" · ")}</p>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {project.name} <StatusBadge kind="project" status={project.status} /> {project.isDemo ? <DemoBadge /> : null}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatDateRange(project.startDate, project.endDate)}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Staffing requirements</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {reqs.length === 0 ? (
              <p className="text-sm text-muted-foreground">None defined yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Role</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Needed</TableHead>
                    {showRates ? <TableHead className="text-right">Rate</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reqs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{FIELD_ROLE_NAMES[r.role]}</TableCell>
                      <TableCell className="text-muted-foreground">{locations.find((l) => l.id === r.locationId)?.name ?? "All"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                      {showRates ? (
                        <TableCell className="text-right tabular-nums">{r.defaultRateCents != null ? formatRate(r.defaultRateCents) : "—"}</TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Locations</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {locations.length === 0 ? (
                <p className="text-muted-foreground">None yet.</p>
              ) : (
                locations.map((l) => (
                  <div key={l.id}>
                    <p className="font-medium">{l.name}</p>
                    <p className="text-muted-foreground">{[l.address, l.timezone].filter(Boolean).join(" · ")}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          {showBudget ? (
            <Card>
              <CardHeader>
                <CardTitle>Staffing budget</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {project.budgetCents != null ? formatMoney(project.budgetCents, project.currency) : "Not set"}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
      <div className="mt-6">
        <PlannedSection
          milestone="M2–M5"
          title="Project workspace"
          items={["Shifts and calendar", "Offers, bookings and waitlist", "Attendance and timesheets", "Estimated vs actual cost against budget"]}
        />
      </div>
    </>
  );
}
