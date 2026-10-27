import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { canAny } from "@/server/authz/permissions";
import { getClients, getInternalUsers } from "@/server/queries/projects";
import { requireInternal, toActor } from "@/server/session";
import { createProjectAction } from "../actions";
import { ProjectForm } from "../project-form";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  const viewer = await requireInternal("project.create");
  const [team, clients] = await Promise.all([getInternalUsers(), getClients()]);
  return (
    <>
      <Link href="/dashboard/projects" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Projects
      </Link>
      <PageHeader title="New project" description="Add locations, staffing requirements and shifts next." />
      <Card className="max-w-3xl">
        <CardContent>
          <ProjectForm
            action={createProjectAction}
            clients={clients}
            team={team}
            canSeeBudget={canAny(toActor(viewer), "budget.view")}
            submitLabel="Create project"
            values={{
              name: "",
              code: "",
              clientId: null,
              campaignName: null,
              description: null,
              ownerId: viewer.userId,
              coordinatorId: null,
              startDate: null,
              endDate: null,
              budgetCents: null,
              currency: "CAD",
              internalNotes: null,
              clientNotes: null,
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
