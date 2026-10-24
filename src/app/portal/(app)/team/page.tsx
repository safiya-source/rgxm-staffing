import { UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { utcToZoned } from "@/lib/time";
import { getSupervisedTeam } from "@/server/domain/attendance";
import { requireStaff } from "@/server/session";
import { TeamMemberCard } from "./team-member-card";

export const metadata: Metadata = { title: "My team" };

const HOUR = 3_600_000;

export default async function TeamPage() {
  const viewer = await requireStaff();
  const now = new Date();
  const rows = await getSupervisedTeam(viewer.staff!.id, { from: new Date(now.getTime() - 7 * 24 * HOUR), to: new Date(now.getTime() + 18 * HOUR) });
  // Today's team, plus earlier shifts still waiting on your verification.
  const today = rows.filter((r) => new Date(r.ends_at).getTime() > now.getTime() - 12 * HOUR);
  const waiting = rows.filter((r) => !today.includes(r) && (r.timesheet_status === "submitted" || r.timesheet_status === "in_progress"));

  const toCard = (r: (typeof rows)[number]) => {
    const tz = r.timezone;
    const local = (d: Date | null) => (d ? utcToZoned(new Date(d), tz).time : null);
    const started = new Date(r.starts_at) <= now;
    return (
      <TeamMemberCard
        key={r.booking_id}
        member={{
          bookingId: r.booking_id,
          name: r.name,
          phone: r.phone,
          role: r.role,
          projectName: r.project_name,
          locationName: r.location_name,
          timezone: tz,
          date: utcToZoned(new Date(r.starts_at), tz).date,
          scheduled: { start: local(r.starts_at)!, end: local(r.ends_at)! },
          checkIn: local(r.actual_start),
          checkOut: local(r.actual_end),
          worked: r.worked_start && r.worked_end ? { start: local(r.worked_start)!, end: local(r.worked_end)! } : null,
          breakMinutes: r.break_minutes ?? 0,
          flags: r.flags ?? [],
          staffNote: r.staff_note,
          status: r.timesheet_status,
          started,
        }}
      />
    );
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-[22px] font-semibold">My team</h1>
        <p className="mt-1 text-sm text-muted-foreground">People you lead on site. Verified hours go to RGXM for final approval.</p>
      </div>
      {rows.length === 0 ? <EmptyState icon={UsersIcon} title="No team right now" description="When you lead a shift, your team shows here on the day." /> : null}
      {today.length ? (
        <section aria-labelledby="team-today" className="grid grid-cols-1 gap-3">
          <h2 id="team-today" className="text-sm font-medium text-muted-foreground">
            Today
          </h2>
          {today.map(toCard)}
        </section>
      ) : null}
      {waiting.length ? (
        <section aria-labelledby="team-waiting" className="grid grid-cols-1 gap-3">
          <h2 id="team-waiting" className="text-sm font-medium text-muted-foreground">
            Waiting for your verification
          </h2>
          {waiting.map(toCard)}
        </section>
      ) : null}
    </div>
  );
}
