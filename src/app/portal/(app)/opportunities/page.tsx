import { InboxIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { getOpportunities } from "@/server/queries/portal";
import { requireStaff } from "@/server/session";
import { OpportunityGroup } from "./opportunity-group";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  const viewer = await requireStaff();
  const rows = await getOpportunities(viewer.staff!.id);
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
      {groups.size === 0 ? (
        <EmptyState icon={InboxIcon} title="No open offers" description="When RGXM has shifts for you, they'll appear here and you'll get an email." />
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
    </div>
  );
}
