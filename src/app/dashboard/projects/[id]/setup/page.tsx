import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAny, canOnProject } from "@/server/authz/permissions";
import { getProjectHeader, getProjectSetup } from "@/server/queries/projects";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { updateProjectAction } from "../../actions";
import { ProjectForm } from "../../project-form";
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

  return (
    <div className="grid gap-6 lg:grid-cols-5">
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
