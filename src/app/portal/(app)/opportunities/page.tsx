import { InboxIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { listOpenShifts } from "@/server/domain/job-board";
import { getOpportunities } from "@/server/queries/portal";
import { requireStaff } from "@/server/session";
import { JobBoard } from "./job-board";
import { OpportunityGroup } from "./opportunity-group";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  const viewer = await requireStaff();
  const [rows, board] = await Promise.all([getOpportunities(viewer.staff!.id), listOpenShifts(viewer.staff!.id)]);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.projectId}:${r.role}:${r.locationName}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-[22px] font-semibold">Opportunities</h1>
        <p className="mt-1 text-sm text-muted-foreground">Say if you&apos;re interested. RGXM confirms who&apos;s booked.</p>
      </div>

      <section aria-labelledby="offers-heading" className="grid gap-3">
        <h2 id="offers-heading" className="text-base font-semibold">
          Offers for you
        </h2>
        {groups.size === 0 ? (
          <EmptyState icon={InboxIcon} title="No open offers" description="When RGXM offers you shifts, they'll appear here and you'll get an email." />
        ) : (
          [...groups.entries()].map(([key, items]) => (
            <OpportunityGroup
              key={key}
              items={items.map((i) => ({
                ...i,
                startsAt: i.startsAt.toISOString(),
                endsAt: i.endsAt.toISOString(),
                responseDeadline: i.responseDeadline?.toISOString() ?? null,
              }))}
            />
          ))
        )}
      </section>

      <section aria-labelledby="board-heading" className="grid gap-3">
        <div>
          <h2 id="board-heading" className="text-base font-semibold">
            Open shifts
          </h2>
          <p className="text-sm text-muted-foreground">Shifts that still need people in your roles. Tap I&apos;m interested and RGXM will confirm if you&apos;re booked.</p>
        </div>
        {board.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">No open shifts in your roles right now.</p>
        ) : (
          <JobBoard shifts={board.map((s) => ({ ...s, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }))} />
        )}
      </section>
    </div>
  );
}
