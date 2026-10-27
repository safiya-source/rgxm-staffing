import { CheckCircle2Icon } from "lucide-react";
import { CheckInPanel } from "@/components/portal/check-in-panel";
import { HoursForm } from "@/components/portal/hours-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMinutes } from "@/lib/format";
import { utcToZoned } from "@/lib/time";
import { staffCanEdit, TIMESHEET_STATUS_LABEL } from "@/server/domain/attendance-rules";
import { getAttendanceStates, getTimesheetForBooking } from "@/server/queries/portal";

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "brand"> = {
  needs_review: "warning",
  submitted: "brand",
  supervisor_verified: "brand",
  rgxm_review: "brand",
  approved: "success",
  locked: "success",
  exported: "success",
  paid: "success",
};

/** Check-in/out and the person's own hours for one booking. */
export async function MyHoursSection({ bookingId, status, startsAt, timezone }: { bookingId: string; status: string; startsAt: Date; timezone: string }) {
  if (status !== "confirmed" && status !== "completed") return null;
  const now = new Date();
  const [states, t] = await Promise.all([getAttendanceStates([bookingId], now), getTimesheetForBooking(bookingId)]);
  const att = states.get(bookingId)!;
  const started = startsAt <= now;
  // Hours are reviewed once the person has checked out (or the shift is over), not mid-shift.
  const readyForHours = att.state === "checked_out" || att.state === "closed" || t?.status === "needs_review";
  const editable = status === "confirmed" && started && readyForHours && (!t || staffCanEdit(t.status));
  const local = (d: Date | null | undefined) => (d ? utcToZoned(d, timezone).time : "");

  return (
    <section aria-labelledby="attendance" className="grid gap-3">
      <h2 id="attendance" className="text-sm font-medium text-muted-foreground">
        Attendance & hours
      </h2>
      {status === "confirmed" ? (
        <Card className="p-4">
          <CheckInPanel bookingId={bookingId} state={att.state} opensAt={att.opensAt} checkedInAt={att.checkedInAt} timezone={timezone} requireLocation={att.requireLocation} />
        </Card>
      ) : null}
      {t && t.status === "needs_review" && t.reviewNote ? (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <span className="font-medium">Please check your hours:</span> {t.reviewNote}
        </p>
      ) : null}
      {editable ? (
        <Card className="p-4">
          <p className="mb-3 font-medium">Your hours</p>
          <HoursForm
            bookingId={bookingId}
            initial={{ date: utcToZoned(startsAt, timezone).date, start: local(t?.workedStart), end: local(t?.workedEnd), breakMinutes: t?.breakMinutes ?? 0, note: t?.staffNote ?? "" }}
            recorded={t?.actualStart && t.actualEnd ? { start: local(t.actualStart), end: local(t.actualEnd) } : null}
          />
        </Card>
      ) : t && t.status !== "not_started" ? (
        <Card className="grid gap-2 p-4 text-[15px]">
          <p className="flex items-center justify-between gap-2">
            <span className="font-medium">Your hours</span>
            <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{TIMESHEET_STATUS_LABEL[t.status]}</Badge>
          </p>
          {t.workedStart && t.workedEnd ? (
            <p>
              {local(t.workedStart)} – {local(t.workedEnd)}
              {t.breakMinutes ? ` · ${t.breakMinutes} min break` : ""}
            </p>
          ) : null}
          {t.payableMinutes != null && ["approved", "locked", "exported", "paid"].includes(t.status) ? (
            <p className="flex items-center gap-1.5 text-success">
              <CheckCircle2Icon className="size-4" /> Approved for {formatMinutes(t.payableMinutes)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Submitted for review. Message RGXM if something needs fixing.</p>
          )}
        </Card>
      ) : null}
    </section>
  );
}
