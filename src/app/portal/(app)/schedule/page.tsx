import { CalendarIcon, ChevronRightIcon, FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { ShiftSummary } from "@/components/portal/shift-summary";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatInZone } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { listStaffDocuments } from "@/server/domain/comms";
import { getSchedule } from "@/server/queries/portal";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "My schedule" };

export default async function SchedulePage() {
  const viewer = await requireStaff();
  const staffId = viewer.staff!.id;
  const [{ upcoming, past, cancelled }, docs] = await Promise.all([getSchedule(staffId), listStaffDocuments(staffId)]);
  const toReview = docs.filter((d) => d.requiresAck && !d.acknowledgedAt);

  return (
    <div className="grid gap-6">
      <h1 className="text-[22px] font-semibold">My schedule</h1>

      {toReview.length ? (
        <section aria-labelledby="briefs">
          <h2 id="briefs" className="mb-2 text-sm font-medium text-muted-foreground">
            Briefs to review
          </h2>
          <Card className="divide-y">
            {toReview.map((d) => (
              <Link key={d.id} href={`/portal/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
                <FileTextIcon className="size-5 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{d.title}</span>
                  <span className="block text-sm text-muted-foreground">{d.projectName}</span>
                </span>
                <Badge tone="warning">Review</Badge>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="upcoming">
        <h2 id="upcoming" className="mb-2 text-sm font-medium text-muted-foreground">
          Confirmed
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState icon={CalendarIcon} title="No confirmed shifts" description="Shifts appear here once RGXM confirms you." />
        ) : (
          <Card className="divide-y">
            {upcoming.map((b) => (
              <Link key={b.id} href={`/portal/shifts/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-sm font-medium">
                    {b.projectName} · {FIELD_ROLE_NAMES[b.role as FieldRole]}
                  </p>
                  <ShiftSummary startsAt={b.startsAt} endsAt={b.endsAt} timezone={b.timezone} locationName={b.locationName} />
                </div>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </Card>
        )}
      </section>

      {cancelled.length ? (
        <section aria-labelledby="changes">
          <h2 id="changes" className="mb-2 text-sm font-medium text-muted-foreground">
            Recently cancelled
          </h2>
          <Card className="divide-y">
            {cancelled.map((b) => (
              <div key={b.id} className="px-4 py-3 text-sm">
                <p className="font-medium line-through decoration-muted-foreground">
                  {b.projectName} · {formatInZone(b.startsAt, b.timezone, "EEE MMM d, h:mm a")}
                </p>
                {b.cancelReason ? <p className="text-muted-foreground">{b.cancelReason}</p> : null}
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      {past.length ? (
        <section aria-labelledby="past">
          <h2 id="past" className="mb-2 text-sm font-medium text-muted-foreground">
            Past shifts
          </h2>
          <Card className="divide-y">
            {past.map((b) => (
              <Link key={b.id} href={`/portal/shifts/${b.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent">
                <span>
                  {formatInZone(b.startsAt, b.timezone, "MMM d")} · {b.projectName}
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}
