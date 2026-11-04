import { ArrowLeftIcon } from "lucide-react";
import { and, asc, inArray, notInArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { canAny, canOnProject } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { projectLocations, projects } from "@/server/db/schema";
import { getClients } from "@/server/queries/projects";
import { projectScope } from "@/server/queries/timesheets";
import { getOrgSettings } from "@/server/settings";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { StaffingRequestForm } from "./staffing-request-form";

export const metadata: Metadata = { title: "New staffing request" };

export default async function NewStaffingRequestPage({ searchParams }: PageProps<"/dashboard/staffing/new">) {
  const viewer = await requireInternal("shift.manage");
  const actor = toActor(viewer);
  const sp = await searchParams;
  const canCreateProject = canAny(actor, "project.create");
  const scope = await projectScope(actor, "shift.manage");

  const rows =
    scope && !scope.length
      ? []
      : await db
          .select({ id: projects.id, name: projects.name, code: projects.code, startDate: projects.startDate })
          .from(projects)
          .where(and(notInArray(projects.status, ["closed", "cancelled", "completed", "reconciliation"]), scope ? inArray(projects.id, scope) : undefined))
          .orderBy(asc(projects.name));
  const ids = rows.map((r) => r.id);
  const [locations, scopes, clients, settings] = await Promise.all([
    ids.length
      ? db
          .select({ id: projectLocations.id, projectId: projectLocations.projectId, name: projectLocations.name, city: projectLocations.city, timezone: projectLocations.timezone })
          .from(projectLocations)
          .where(inArray(projectLocations.projectId, ids))
          .orderBy(asc(projectLocations.name))
      : Promise.resolve([]),
    loadProjectScopes(ids),
    canCreateProject ? getClients() : Promise.resolve([]),
    getOrgSettings(),
  ]);

  const projectOptions = rows.map((p) => ({
    id: p.id,
    label: `${p.name} (${p.code})`,
    canAddVenue: canOnProject(actor, "project.edit", scopes.get(p.id)!),
    locations: locations.filter((l) => l.projectId === p.id).map((l) => ({ id: l.id, label: [l.name, l.city].filter(Boolean).join(", "), timezone: l.timezone })),
  }));
  const preselect = typeof sp.project === "string" && projectOptions.some((p) => p.id === sp.project) ? sp.project : undefined;

  return (
    <>
      <Link href="/dashboard/staffing" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Staffing Requests
      </Link>
      <PageHeader
        title="New staffing request"
        description="Say where and when you need people. A new project or venue is created if you need one, and the shifts are published so you can send offers straight away."
      />
      <StaffingRequestForm
        projects={projectOptions}
        clients={clients}
        canCreateProject={canCreateProject}
        defaultTimezone={settings.defaultTimezone}
        showRates={canAny(actor, "rates.view")}
        preselectProjectId={preselect}
      />
    </>
  );
}
