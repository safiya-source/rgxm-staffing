import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAny, canOnProject } from "@/server/authz/permissions";
import { getProjectHeader, getProjectSetup, getServiceCategoryOptions, projectTaxWarnings } from "@/server/queries/projects";
import { getProjectRates } from "@/server/queries/staffing";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { updateProjectAction } from "../../actions";
import { ProjectForm } from "../../project-form";
import { getCompensationSettings } from "@/server/domain/compensation";
import { CompensationSettingsCard } from "./compensation-settings";
import { RateOverrides } from "./rate-overrides";
import { LocationsSection, RequirementsSection, TeamSection } from "./sections";

export const metadata: Metadata = { title: "Project setup" };

export default async function ProjectSetupPage({ params }: PageProps<"/dashboard/projects/[id]/setup">) {
  const viewer = await requireInternal("project.view");
  const { id } = await params;
  const [header, setup, scopes] = await Promise.all([getProjectHeader(id), getProjectSetup(id), loadProjectScopes([id])]);
  const actor = toActor(viewer);
  const scope = scopes.get(id)!;
  const canEdit = canOnProject(actor, "project.edit", scope);
  const showRates = canAny(actor, "rates.view");
  const p = header!.project;
  const overrides = showRates ? await getProjectRates(id) : [];
  const [serviceCategories, taxWarnings, compSettings] = await Promise.all([getServiceCategoryOptions(), projectTaxWarnings(p), getCompensationSettings(id)]);
  const canConfigureComp = canOnProject(actor, "compensation.configure", scope);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {taxWarnings.length ? (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning lg:col-span-5">
          <p className="font-medium">Tax on this project will go to Finance review.</p>
          <ul className="mt-1 list-disc pl-5">
            {taxWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid content-start gap-6 lg:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle>Staffing requirements</CardTitle>
            <CardDescription>The people this activation needs, by role and location.</CardDescription>
          </CardHeader>
          <CardContent>
            <RequirementsSection projectId={id} requirements={setup.requirements} locations={setup.locations} canEdit={canEdit} showRates={showRates} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Project details</CardTitle>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <ProjectForm
                action={updateProjectAction.bind(null, id)}
                values={p}
                clients={setup.clients}
                team={setup.team}
                serviceCategories={serviceCategories}
                canSeeBudget={canOnProject(actor, "budget.view", scope)}
                submitLabel="Save project"
              />
            ) : (
              <p className="text-sm text-muted-foreground">Only the project&apos;s owner, coordinator, members and administrators can edit it.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid content-start gap-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Locations</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationsSection projectId={id} locations={setup.locations} canEdit={canEdit} />
          </CardContent>
        </Card>
        {showRates ? (
          <Card>
            <CardHeader>
              <CardTitle>Project rate overrides</CardTitle>
            </CardHeader>
            <CardContent>
              <RateOverrides projectId={id} overrides={overrides} canEdit={canOnProject(actor, "rates.project_override", scope)} />
            </CardContent>
          </Card>
        ) : null}
        <CompensationSettingsCard projectId={id} settings={compSettings} canEdit={canConfigureComp} />
        <Card>
          <CardHeader>
            <CardTitle>Project team</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamSection projectId={id} members={setup.members} team={setup.team} canEdit={canEdit} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
