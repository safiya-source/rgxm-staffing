import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { cn } from "@/lib/utils";
import { canAny } from "@/server/authz/permissions";
import { getProjectsForSelect } from "@/server/queries/projects";
import { listTimesheets, TIMESHEET_VIEWS, timesheetProjectScope, type TimesheetView } from "@/server/queries/timesheets";
import { requireInternal, toActor } from "@/server/session";
import { NativeSelectLink } from "./select-link";
import { TimesheetTable } from "./timesheet-table";

export const metadata: Metadata = { title: "Timesheets" };

export default async function TimesheetsPage({ searchParams }: PageProps<"/dashboard/timesheets">) {
  const viewer = await requireInternal("timesheet.view");
  const actor = toActor(viewer);
  const sp = await searchParams;
  const view = (Object.keys(TIMESHEET_VIEWS).find((k) => k === sp.view) ?? "review") as TimesheetView;
  const projectId = typeof sp.project === "string" && /^[0-9a-f-]{36}$/i.test(sp.project) ? sp.project : undefined;
  const scope = await timesheetProjectScope(actor);
  const [rows, projects] = await Promise.all([listTimesheets({ view, projectId, scope }), getProjectsForSelect({ includeClosed: true })]);
  const visibleProjects = scope ? projects.filter((p) => scope.includes(p.id)) : projects;
  const q = (v: string) => `/dashboard/timesheets?view=${v}${projectId ? `&project=${projectId}` : ""}`;

  return (
    <>
      <PageHeader title="Timesheets" description="Review attendance, verify hours and approve what's payable." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Timesheet views" className="flex flex-wrap gap-1.5">
          {(Object.entries(TIMESHEET_VIEWS) as [TimesheetView, { label: string }][]).map(([k, v]) => (
            <Link
              key={k}
              href={q(k)}
              aria-current={view === k ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-sm", view === k ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent")}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <NativeSelectLink
          label="Project"
          value={projectId ?? ""}
          options={[{ value: "", label: "All projects" }, ...visibleProjects.map((p) => ({ value: p.id, label: p.name }))]}
          base={`/dashboard/timesheets?view=${view}`}
          param="project"
        />
      </div>
      <TimesheetTable
        canApprove={canAny(actor, "timesheet.approve")}
        rows={rows.map((r) => ({
          ...r,
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          actualStart: r.actualStart?.toISOString() ?? null,
          actualEnd: r.actualEnd?.toISOString() ?? null,
          workedStart: r.workedStart?.toISOString() ?? null,
          workedEnd: r.workedEnd?.toISOString() ?? null,
          flags: r.flags ?? [],
        }))}
      />
    </>
  );
}
