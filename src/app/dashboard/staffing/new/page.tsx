import { ArrowLeftIcon } from "lucide-react";
import { and, asc, inArray, notInArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { canAny, canOnProject } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { projectCompensationSettings, projectLocations, projects, staffingRequirements } from "@/server/db/schema";
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
  const showRates = canAny(actor, "rates.view");
  const [locations, scopes, clients, settings, requirementRates] = await Promise.all([
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
    ids.length && showRates
      ? db
          .select({ projectId: staffingRequirements.projectId, role: staffingRequirements.role, rateCents: staffingRequirements.defaultRateCents })
          .from(staffingRequirements)
          .where(inArray(staffingRequirements.projectId, ids))
      : Promise.resolve([]),
  ]);

  // Allowances/mileage/bonus: shown to people who may configure them, prefilled per project.
  const canSetCompensation = canAny(actor, "compensation.configure");
  const compRows = canSetCompensation && ids.length ? await db.select().from(projectCompensationSettings).where(inArray(projectCompensationSettings.projectId, ids)) : [];
  const projectOptions = rows.map((p) => ({
    id: p.id,
    label: `${p.name} (${p.code})`,
    canAddVenue: canOnProject(actor, "location.manage", scopes.get(p.id)!),
    // The project's own rate for a role (Setup → Staffing requirements) beats the company default.
    roleRates: Object.fromEntries(requirementRates.filter((r) => r.projectId === p.id && r.rateCents != null).map((r) => [r.role, r.rateCents!])),
    compensation: canSetCompensation && canOnProject(actor, "compensation.configure", scopes.get(p.id)!) ? (compRows.find((c) => c.projectId === p.id) ?? null) : undefined,
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
        showRates={showRates}
        defaultRates={showRates ? settings.defaultRates : {}}
        preselectProjectId={preselect}
        canSetCompensation={canSetCompensation}
      />
    </>
  );
}
