import { ArrowLeftIcon, SendIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/app/empty-state";
import { DemoBadge } from "@/components/app/status-badge";
import { formatInZone } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { canAny, canOnProject } from "@/server/authz/permissions";
import { getThreadMessages, listProjectThreads } from "@/server/domain/comms";
import { getProjectHeader } from "@/server/queries/projects";
import { getBoard, getShiftGroups } from "@/server/queries/staffing";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { StaffingBoard } from "./staffing-board";
import { ThreadsPanel } from "./threads-panel";

export const metadata: Metadata = { title: "Staffing" };

export default async function ProjectStaffingPage({ params, searchParams }: PageProps<"/dashboard/staffing/[projectId]">) {
  const viewer = await requireInternal("booking.offer");
  const { projectId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) notFound();
  const sp = await searchParams;
  const header = await getProjectHeader(projectId);
  if (!header) notFound();
  const actor = toActor(viewer);
  const scope = (await loadProjectScopes([projectId])).get(projectId)!;
  const can = {
    offer: canOnProject(actor, "booking.offer", scope),
    confirm: canOnProject(actor, "booking.confirm", scope),
    override: canOnProject(actor, "booking.override_conflict", scope),
    reply: canOnProject(actor, "comms.manage", scope),
    rates: canAny(actor, "rates.view"),
  };

  const groups = await getShiftGroups(projectId);
  const groupKey = typeof sp.group === "string" && groups.some((g) => g.key === sp.group) ? sp.group : groups[0]?.key;
  const group = groups.find((g) => g.key === groupKey);
  // Staff messages are only for the project's own team (people who can reply).
  const [board, threads] = await Promise.all([group ? getBoard(group.shifts.map((s) => s.id)) : [], can.reply ? listProjectThreads(projectId) : Promise.resolve([])]);
  const openThreadId = typeof sp.thread === "string" && threads.some((t) => t.id === sp.thread) ? sp.thread : null;
  const openThread = openThreadId ? await getThreadMessages(openThreadId) : null;

  return (
    <>
      <Link href="/dashboard/staffing" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Staffing Requests
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{[header.client, header.project.code].filter(Boolean).join(" · ")}</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            {header.project.name} {header.project.isDemo ? <DemoBadge /> : null}
          </h1>
        </div>
        <Link href={`/dashboard/projects/${projectId}/shifts`} className="text-sm text-muted-foreground hover:text-foreground">
          Manage shifts →
        </Link>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={SendIcon}
          title="No upcoming published shifts"
          description="Create and publish shifts for this project, then come back to send offers."
        />
      ) : (
        <div className="grid gap-6 2xl:grid-cols-[1fr_20rem]">
          <div className="grid min-w-0 content-start gap-4">
            <nav aria-label="Staffing requests" className="flex flex-wrap gap-2">
              {groups.map((g) => {
                const positions = g.shifts.reduce((n, s) => n + s.headcount, 0);
                const confirmed = g.shifts.reduce((n, s) => n + s.confirmed, 0);
                const active = g.key === groupKey;
                return (
                  <Link
                    key={g.key}
                    href={`/dashboard/staffing/${projectId}?group=${encodeURIComponent(g.key)}`}
                    aria-current={active ? "true" : undefined}
                    className={cn("rounded-lg border bg-card px-3 py-2 text-sm hover:border-ring/40", active && "border-foreground/40 ring-1 ring-foreground/10")}
                  >
                    <span className="font-medium">{FIELD_ROLE_NAMES[g.role as FieldRole]}</span>
                    <span className="text-muted-foreground"> · {g.locationName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {g.shifts.length} shift{g.shifts.length === 1 ? "" : "s"} from {formatInZone(g.shifts[0]!.startsAt, g.timezone, "MMM d")} · {confirmed}/{positions} filled
                    </span>
                  </Link>
                );
              })}
            </nav>
            {group ? (
              <StaffingBoard
                key={group.key}
                projectId={projectId}
                can={can}
                group={{
                  role: group.role,
                  locationName: group.locationName,
                  timezone: group.timezone,
                  shifts: group.shifts.map((s) => ({ ...s, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
                }}
                rows={board.map((r) => ({
                  ...r,
                  offeredRateCents: can.rates ? r.offeredRateCents : null,
                  agreedRateCents: can.rates ? r.agreedRateCents : null,
                  responseDeadline: r.responseDeadline?.toISOString() ?? null,
                  respondedAt: r.respondedAt?.toISOString() ?? null,
                }))}
              />
            ) : null}
          </div>
          <ThreadsPanel
            canReply={can.reply}
            threads={threads.map((t) => ({ ...t, lastMessageAt: t.lastMessageAt?.toISOString() ?? null }))}
            openThreadId={openThreadId}
            messages={(openThread ?? []).map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
          />
        </div>
      )}
    </>
  );
}
