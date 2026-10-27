import { CalendarIcon, ChevronRightIcon, ClockIcon, FileCheckIcon, InboxIcon, MapPinIcon, UsersIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckInPanel } from "@/components/portal/check-in-panel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatInZone, formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES } from "@/lib/roles";
import { getSupervisedTeam } from "@/server/domain/attendance";
import { getAttendanceStates, getHoursToReview } from "@/server/queries/portal";
import { getPortalHome } from "@/server/queries/portal-home";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Home" };

const PAYMENT_LABEL: Record<string, string> = {
  pending: "Approved, awaiting payment",
  batched: "In a payment run",
  exported: "Sent for payment",
  paid: "Paid",
  failed: "Payment issue, RGXM will contact you",
  disputed: "Under review",
};

function TaskRow({ href, icon: Icon, label, count }: { href: string; icon: typeof InboxIcon; label: string; count: number }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-accent">
      <Icon className="size-5 text-muted-foreground" />
      <span className="flex-1 text-[15px]">{label}</span>
      {count > 0 ? <Badge tone="brand">{count}</Badge> : <span className="text-sm text-muted-foreground">None</span>}
      <ChevronRightIcon className="size-4 text-muted-foreground" />
    </Link>
  );
}

export default async function PortalHome() {
  const viewer = await requireStaff();
  const staffId = viewer.staff!.id;
  const now = new Date();
  const [home, hours, team] = await Promise.all([
    getPortalHome(staffId, now),
    getHoursToReview(staffId, now),
    getSupervisedTeam(staffId, { from: new Date(now.getTime() - 12 * 3_600_000), to: new Date(now.getTime() + 18 * 3_600_000) }),
  ]);
  const attendance = home.next ? (await getAttendanceStates([home.next.bookingId], now)).get(home.next.bookingId) : undefined;
  const teamIn = team.filter((m) => m.actual_start).length;
  const name = viewer.staff!.preferredName ?? viewer.staff!.firstName;

  return (
    <div className="grid gap-6">
      <h1 className="text-[22px] font-semibold">Hi {name}</h1>

      <section aria-labelledby="next-shift">
        <h2 id="next-shift" className="mb-2 text-sm font-medium text-muted-foreground">
          Next shift
        </h2>
        {home.next ? (
          <Card className="overflow-hidden">
            <div className="h-1 bg-brand" />
            <div className="p-4">
              <p className="text-sm text-muted-foreground">{home.next.projectName}</p>
              <p className="mt-1 text-lg font-semibold">{formatInZone(home.next.startsAt, home.next.timezone, "EEEE, MMMM d")}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[15px]">
                <ClockIcon className="size-4 text-muted-foreground" />
                {formatInZone(home.next.startsAt, home.next.timezone, "h:mm a")} – {formatInZone(home.next.endsAt, home.next.timezone, "h:mm a")}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[15px]">
                <MapPinIcon className="size-4 text-muted-foreground" />
                {home.next.locationName}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <Badge>{FIELD_ROLE_NAMES[home.next.role]}</Badge>
                <Link href={`/portal/shifts/${home.next.bookingId}`} className="text-sm font-medium underline-offset-4 hover:underline">
                  Shift details
                </Link>
              </div>
              {attendance ? (
                <div className="mt-4 border-t pt-4">
                  <CheckInPanel
                    bookingId={home.next.bookingId}
                    state={attendance.state}
                    opensAt={attendance.opensAt}
                    checkedInAt={attendance.checkedInAt}
                    timezone={home.next.timezone}
                    requireLocation={attendance.requireLocation}
                  />
                </div>
              ) : null}
            </div>
          </Card>
        ) : (
          <Card className="p-5 text-center">
            <CalendarIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 font-medium">No upcoming shifts</p>
            <p className="mt-1 text-sm text-muted-foreground">When RGXM confirms you for a shift, it&apos;ll show up here.</p>
          </Card>
        )}
      </section>

      {team.length ? (
        <Link href="/portal/team">
          <Card className="flex items-center gap-3 p-4 hover:bg-accent">
            <UsersIcon className="size-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-medium">My team</p>
              <p className="text-sm text-muted-foreground">
                {teamIn} of {team.length} checked in
              </p>
            </div>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Card>
        </Link>
      ) : null}

      <section aria-labelledby="to-do">
        <h2 id="to-do" className="mb-2 text-sm font-medium text-muted-foreground">
          To do
        </h2>
        <Card className="divide-y overflow-hidden">
          <TaskRow href="/portal/opportunities" icon={InboxIcon} label="New shift offers" count={home.openOffers} />
          <TaskRow href="/portal/schedule" icon={FileCheckIcon} label="Briefs to review" count={home.outstandingAcks} />
          <TaskRow href="/portal/hours" icon={ClockIcon} label="Hours to submit" count={hours.length} />
          <Link href="/portal/availability" className="flex items-center gap-3 px-4 py-3.5 hover:bg-accent">
            <CalendarIcon className="size-5 text-muted-foreground" />
            <span className="flex-1 text-[15px]">Update my availability</span>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Link>
        </Card>
      </section>

      {home.upcoming.length > 0 ? (
        <section aria-labelledby="upcoming">
          <h2 id="upcoming" className="mb-2 text-sm font-medium text-muted-foreground">
            Also coming up
          </h2>
          <Card className="divide-y">
            {home.upcoming.map((b) => (
              <div key={b.bookingId} className="px-4 py-3">
                <p className="text-[15px] font-medium">{formatInZone(b.startsAt, b.timezone, "EEE MMM d · h:mm a")}</p>
                <p className="text-sm text-muted-foreground">
                  {b.projectName} · {b.locationName}
                </p>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="pay">
        <h2 id="pay" className="mb-2 text-sm font-medium text-muted-foreground">
          Latest payment
        </h2>
        <Card className="flex items-center gap-3 p-4">
          <WalletIcon className="size-5 text-muted-foreground" />
          {home.lastPayment ? (
            <div>
              <p className="font-medium tabular-nums">{formatMoney(home.lastPayment.totalCents, home.lastPayment.currency)}</p>
              <p className="text-sm text-muted-foreground">{PAYMENT_LABEL[home.lastPayment.status] ?? home.lastPayment.status}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Payments for approved shifts will show here.</p>
          )}
        </Card>
      </section>
    </div>
  );
}
