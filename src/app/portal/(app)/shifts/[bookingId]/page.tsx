import { ArrowLeftIcon, FileTextIcon, MegaphoneIcon, PhoneIcon, ShirtIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/app/status-badge";
import { ShiftSummary } from "@/components/portal/shift-summary";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { getBookingForStaff } from "@/server/domain/bookings";
import { listStaffAnnouncements, listStaffDocuments } from "@/server/domain/comms";
import { requireStaff } from "@/server/session";
import { ShiftActions } from "./shift-actions";

export const metadata: Metadata = { title: "Shift" };

export default async function ShiftPage({ params }: PageProps<"/portal/shifts/[bookingId]">) {
  const viewer = await requireStaff();
  const { bookingId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) notFound();
  const row = await getBookingForStaff(viewer.staff!.id, bookingId);
  if (!row) notFound();
  const { booking: b, shift: s, location: l } = row;
  const [docs, news] = await Promise.all([listStaffDocuments(viewer.staff!.id, { projectId: b.projectId }), listStaffAnnouncements(viewer.staff!.id)]);
  const projectNews = news.filter((n) => n.a.projectId === b.projectId).slice(0, 5);
  const relevantDocs = docs.filter((d) => !d.shiftId || d.shiftId === s.id);

  return (
    <div className="grid gap-5">
      <Link href="/portal/schedule" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> My schedule
      </Link>
      <div>
        <p className="text-sm text-muted-foreground">{row.projectName}</p>
        <h1 className="flex items-center gap-2 text-[22px] font-semibold">
          {FIELD_ROLE_NAMES[b.role as FieldRole]} <StatusBadge kind="booking" status={b.status} />
        </h1>
      </div>

      <Card className="grid gap-4 p-4">
        <ShiftSummary startsAt={b.startsAt} endsAt={b.endsAt} timezone={s.timezone} locationName={[l.name, l.address].filter(Boolean).join(", ")} />
        {l.address ? (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address)}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            Open in Maps
          </a>
        ) : null}
        <dl className="grid gap-3 border-t pt-4 text-[15px]">
          {s.reportingLocation ? (
            <div>
              <dt className="text-xs text-muted-foreground">Report to</dt>
              <dd>{s.reportingLocation}</dd>
            </div>
          ) : null}
          {s.onsiteContact ? (
            <div className="flex items-start gap-2">
              <PhoneIcon className="mt-1 size-4 text-muted-foreground" />
              <div>
                <dt className="text-xs text-muted-foreground">On-site contact</dt>
                <dd>{s.onsiteContact}</dd>
              </div>
            </div>
          ) : null}
          {s.uniform ? (
            <div className="flex items-start gap-2">
              <ShirtIcon className="mt-1 size-4 text-muted-foreground" />
              <div>
                <dt className="text-xs text-muted-foreground">Uniform</dt>
                <dd>{s.uniform}</dd>
              </div>
            </div>
          ) : null}
          {s.instructions ? (
            <div>
              <dt className="text-xs text-muted-foreground">Instructions</dt>
              <dd className="whitespace-pre-wrap">{s.instructions}</dd>
            </div>
          ) : null}
          {b.agreedRateCents != null ? (
            <div>
              <dt className="text-xs text-muted-foreground">Agreed rate</dt>
              <dd>{formatMoney(b.agreedRateCents, b.currency)}/hour</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <section aria-labelledby="docs">
        <h2 id="docs" className="mb-2 text-sm font-medium text-muted-foreground">
          Briefs & documents
        </h2>
        {relevantDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        ) : (
          <Card className="divide-y">
            {relevantDocs.map((d) => (
              <Link key={d.id} href={`/portal/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
                <FileTextIcon className="size-5 text-muted-foreground" />
                <span className="flex-1 text-[15px]">{d.title}</span>
                {d.requiresAck ? d.acknowledgedAt ? <Badge tone="success">Reviewed</Badge> : <Badge tone="warning">Review</Badge> : null}
              </Link>
            ))}
          </Card>
        )}
      </section>

      {projectNews.length ? (
        <section aria-labelledby="news">
          <h2 id="news" className="mb-2 text-sm font-medium text-muted-foreground">
            Announcements
          </h2>
          <Card className="divide-y">
            {projectNews.map(({ a }) => (
              <div key={a.id} className="px-4 py-3">
                <p className="flex items-center gap-2 font-medium">
                  <MegaphoneIcon className="size-4 text-muted-foreground" /> {a.title} {a.important ? <Badge tone="danger">Important</Badge> : null}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <ShiftActions bookingId={b.id} projectId={b.projectId} canWithdraw={b.status === "confirmed" && b.startsAt > new Date()} />
    </div>
  );
}
