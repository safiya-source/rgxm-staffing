import { ChevronRightIcon, ClockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatInZone } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { getHoursToReview } from "@/server/queries/portal";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Hours to submit" };

export default async function HoursPage() {
  const viewer = await requireStaff();
  const rows = await getHoursToReview(viewer.staff!.id);
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-[22px] font-semibold">Hours to submit</h1>
        <p className="mt-1 text-sm text-muted-foreground">Check your start, finish and break for each shift, then submit them for approval.</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={ClockIcon} title="You're all caught up" description="Finished shifts that need your hours will show here." />
      ) : (
        <Card className="divide-y">
          {rows.map((r) => (
            <Link key={r.id} href={`/portal/shifts/${r.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-accent">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{formatInZone(r.startsAt, r.timezone, "EEE MMM d · h:mm a")}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {FIELD_ROLE_NAMES[r.role as FieldRole]} · {r.projectName}
                </span>
              </span>
              {r.timesheetStatus === "needs_review" ? <Badge tone="warning">Check again</Badge> : <Badge tone="brand">To do</Badge>}
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
