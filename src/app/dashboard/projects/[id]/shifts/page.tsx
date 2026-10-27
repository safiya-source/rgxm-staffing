import type { Metadata } from "next";
import { canAny, canOnProject } from "@/server/authz/permissions";
import { getShifts, listBreakPolicies, listTemplates } from "@/server/domain/shifts";
import { getProjectSetup } from "@/server/queries/projects";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { ShiftBoard } from "./shift-board";

export const metadata: Metadata = { title: "Shifts" };

export default async function ProjectShiftsPage({ params, searchParams }: PageProps<"/dashboard/projects/[id]/shifts">) {
  const viewer = await requireInternal("project.view");
  const { id } = await params;
  const sp = await searchParams;
  const includeCancelled = sp.cancelled === "1";
  const actor = toActor(viewer);
  const scope = (await loadProjectScopes([id])).get(id)!;
  const [rows, setup, templates, breakPolicies] = await Promise.all([
    getShifts({ from: new Date(0), to: new Date("2100-01-01"), projectIds: [id], includeCancelled }),
    getProjectSetup(id),
    listTemplates(),
    listBreakPolicies(),
  ]);
  const showRates = canAny(actor, "rates.view");

  return (
    <ShiftBoard
      projectId={id}
      canManage={canOnProject(actor, "shift.manage", scope)}
      showRates={showRates}
      includeCancelled={includeCancelled}
      locations={setup.locations.map((l) => ({ id: l.id, name: l.name, timezone: l.timezone }))}
      requirements={setup.requirements.map((r) => ({
        id: r.id,
        role: r.role,
        quantity: r.quantity,
        locationId: r.locationId,
        defaultRateCents: showRates ? r.defaultRateCents : null,
        startDate: r.startDate,
        endDate: r.endDate,
      }))}
      templates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        localStartTime: t.localStartTime.slice(0, 5),
        localEndTime: t.localEndTime.slice(0, 5),
        headcount: t.headcount,
        rateCents: showRates ? t.rateCents : null,
        uniform: t.uniform,
        instructions: t.instructions,
      }))}
      breakPolicies={breakPolicies}
      shifts={rows.map((s) => ({
        ...s,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        rateCents: showRates ? s.rateCents : null,
      }))}
    />
  );
}
