import { addDays, addMonths, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { isIsoDate, localDayBounds, utcToZoned } from "@/lib/time";
import { canOnProject } from "@/server/authz/permissions";
import { getShifts } from "@/server/domain/shifts";
import { getProjectsForSelect } from "@/server/queries/projects";
import { getOrgSettings } from "@/server/settings";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { ScheduleView, type View } from "./schedule-view";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage({ searchParams }: PageProps<"/dashboard/schedule">) {
  const viewer = await requireInternal("project.view");
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const settings = await getOrgSettings();
  const tz = settings.defaultTimezone;

  const view: View = (["day", "week", "month"] as const).find((v) => v === str(sp.view)) ?? "week";
  const now = new Date();
  const today = utcToZoned(now, tz).date;
  const anchor = str(sp.date) && isIsoDate(str(sp.date)!) ? str(sp.date)! : today;
  const projectId = str(sp.project);
  const role = FIELD_ROLES.find((r) => r === str(sp.role)) as FieldRole | undefined;

  const a = parseISO(anchor);
  const [rangeStart, rangeEnd] =
    view === "day"
      ? [anchor, anchor]
      : view === "week"
        ? [format(startOfWeek(a, { weekStartsOn: 1 }), "yyyy-MM-dd"), format(endOfWeek(a, { weekStartsOn: 1 }), "yyyy-MM-dd")]
        : [
            format(startOfWeek(startOfMonth(a), { weekStartsOn: 1 }), "yyyy-MM-dd"),
            format(endOfWeek(endOfMonth(a), { weekStartsOn: 1 }), "yyyy-MM-dd"),
          ];
  // Pad by a day either side so shifts in other time zones near the edges are included.
  const from = localDayBounds(format(addDays(parseISO(rangeStart), -1), "yyyy-MM-dd"), tz)[0];
  const to = localDayBounds(format(addDays(parseISO(rangeEnd), 1), "yyyy-MM-dd"), tz)[1];

  const [rows, projects, alertsRows] = await Promise.all([
    getShifts({ from, to, projectIds: projectId ? [projectId] : undefined, role }),
    getProjectsForSelect(),
    getShifts({ from: now, to: addDays(now, 7), projectIds: projectId ? [projectId] : undefined, role }),
  ]);
  const scopes = await loadProjectScopes([...new Set(rows.map((r) => r.projectId))]);
  const actor = toActor(viewer);
  const manageable = [...scopes.entries()].filter(([, s]) => canOnProject(actor, "shift.manage", s)).map(([id]) => id);

  const step = view === "day" ? (n: number) => addDays(a, n) : view === "week" ? (n: number) => addDays(a, 7 * n) : (n: number) => addMonths(a, n);

  return (
    <>
      <PageHeader title="Schedule" description="Shifts across every project and location. Times are shown in each location's time zone." />
      <ScheduleView
        view={view}
        anchor={anchor}
        today={today}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        prev={format(step(-1), "yyyy-MM-dd")}
        next={format(step(1), "yyyy-MM-dd")}
        projectId={projectId ?? ""}
        role={role ?? ""}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        manageableProjectIds={manageable}
        unfilled={alertsRows
          .filter((s) => s.confirmed < s.headcount)
          .slice(0, 12)
          .map((s) => ({
            id: s.id,
            projectId: s.projectId,
            projectName: s.projectName,
            role: s.role,
            startsAt: s.startsAt.toISOString(),
            timezone: s.timezone,
            open: s.headcount - s.confirmed,
            locationName: s.locationName,
          }))}
        shifts={rows.map((s) => ({
          id: s.id,
          projectId: s.projectId,
          projectName: s.projectName,
          projectCode: s.projectCode,
          locationName: s.locationName,
          role: s.role,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          timezone: s.timezone,
          headcount: s.headcount,
          confirmed: s.confirmed,
          status: s.status,
        }))}
      />
    </>
  );
}
