import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { formatDateRange } from "@/lib/format";
import { canOnProject } from "@/server/authz/permissions";
import { getProjectHeader } from "@/server/queries/projects";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { ProjectTabs } from "./project-tabs";
import { ProjectStatusControl } from "./status-control";

export default async function ProjectLayout({ children, params }: LayoutProps<"/dashboard/projects/[id]">) {
  const viewer = await requireInternal("project.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const header = await getProjectHeader(id);
  if (!header) notFound();
  const scope = (await loadProjectScopes([id])).get(id)!;
  const canEdit = canOnProject(toActor(viewer), "project.edit", scope);
  const p = header.project;

  return (
    <>
      <Link href="/dashboard/projects" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Projects
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{[header.client, p.code, p.campaignName].filter(Boolean).join(" · ")}</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {p.name} <StatusBadge kind="project" status={p.status} /> {p.isDemo ? <DemoBadge /> : null}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateRange(p.startDate, p.endDate)} · Owner {header.ownerName ?? "—"} · Coordinator {header.coordinatorName ?? "—"}
          </p>
        </div>
        {canEdit ? <ProjectStatusControl projectId={p.id} status={p.status} /> : null}
      </div>
      <ProjectTabs projectId={p.id} />
      <div className="pt-6">{children}</div>
    </>
  );
}
