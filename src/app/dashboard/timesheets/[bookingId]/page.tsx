import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMinutes, formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { utcToZoned } from "@/lib/time";
import { canAny, canOnProject } from "@/server/authz/permissions";
import { FLAG_LABEL, TIMESHEET_STATUS_LABEL, workedMinutes, type Flag, type TimesheetStatus } from "@/server/domain/attendance-rules";
import { getTimesheetDetail } from "@/server/queries/timesheets";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { TimesheetActions } from "./timesheet-actions";

export const metadata: Metadata = { title: "Timesheet" };

const STAGE: Record<string, string> = {
  staff_correction: "Staff correction",
  supervisor_recommendation: "Supervisor",
  rgxm_review: "RGXM review",
  approval: "Approval",
  post_approval_correction: "Post-approval correction",
};
const METHOD: Record<string, string> = { self: "Staff (phone)", offline_sync: "Staff (synced after offline)", supervisor: "Supervisor", admin: "RGXM" };

export default async function TimesheetPage({ params }: PageProps<"/dashboard/timesheets/[bookingId]">) {
  const viewer = await requireInternal("timesheet.view");
  const { bookingId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) notFound();
  const d = await getTimesheetDetail(bookingId);
  if (!d) notFound();
  const actor = toActor(viewer);
  const scope = (await loadProjectScopes([d.booking.projectId])).get(d.booking.projectId)!;
  if (!canOnProject(actor, "timesheet.view", scope)) notFound();
  const tz = d.shift.timezone;
  const t = d.timesheet;
  const f = (x: Date | null | undefined, p = "h:mm a") => (x ? formatInZone(x, tz, p) : "—");
  const status = (t?.status ?? "not_started") as TimesheetStatus;
  const worked = t?.workedStart && t?.workedEnd ? workedMinutes(t.workedStart, t.workedEnd, t.breakMinutes) : null;
  const showRates = canAny(actor, "rates.view");

  return (
    <>
      <Link href="/dashboard/timesheets" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Timesheets
      </Link>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">
          {d.projectName} · {d.locationName}
        </p>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {d.staffName}
          {d.booking.status === "no_show" ? <Badge tone="danger">No-show</Badge> : <Badge>{TIMESHEET_STATUS_LABEL[status]}</Badge>}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {FIELD_ROLE_NAMES[d.booking.role as FieldRole]} · {f(d.shift.startsAt, "EEEE, MMMM d")} · scheduled {f(d.shift.startsAt)}–{f(d.shift.endsAt)}
          {showRates && d.booking.agreedRateCents != null ? ` · agreed ${formatMoney(d.booking.agreedRateCents)}/h` : ""}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Hours</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-2">
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Scheduled</dt>
                  <dd className="tabular-nums">
                    {f(d.shift.startsAt)}–{f(d.shift.endsAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Checked in / out (actual)</dt>
                  <dd className="tabular-nums">
                    {f(t?.actualStart)}–{f(t?.actualEnd)}
                    {t?.actualMinutes != null ? <span className="text-muted-foreground"> · {formatMinutes(t.actualMinutes)}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Worked (under review)</dt>
                  <dd className="tabular-nums">
                    {f(t?.workedStart)}–{f(t?.workedEnd)}
                    {t?.breakMinutes ? <span className="text-muted-foreground"> · {t.breakMinutes}m break</span> : null}
                    {worked != null ? <span className="block font-medium">{formatMinutes(worked)}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Approved payable</dt>
                  <dd className="text-lg font-semibold tabular-nums">{t?.payableMinutes != null ? formatMinutes(t.payableMinutes) : "—"}</dd>
                </div>
              </dl>
              {t?.flags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {t.flags.map((x) => (
                    <Badge key={x} tone="warning">
                      {FLAG_LABEL[x as Flag] ?? x}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {t?.staffNote ? <p className="rounded-md bg-muted px-3 py-2 text-sm">Staff note: {t.staffNote}</p> : null}
              {t?.supervisorNote ? <p className="rounded-md bg-muted px-3 py-2 text-sm">Supervisor note: {t.supervisorNote}</p> : null}
              {t?.reviewNote && status === "needs_review" ? <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Sent back: {t.reviewNote}</p> : null}
              <p className="text-xs text-muted-foreground">
                {t?.submittedAt ? `Submitted ${f(t.submittedAt, "MMM d, h:mm a")}. ` : "Not submitted by staff. "}
                {t?.verifiedAt ? `Verified by ${d.nameOf[t.verifiedBy!] ?? "supervisor"} ${f(t.verifiedAt, "MMM d, h:mm a")}. ` : ""}
                {t?.approvedAt ? `Approved by ${d.nameOf[t.approvedBy!] ?? "RGXM"} ${f(t.approvedAt, "MMM d, h:mm a")}.` : ""}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attendance records</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {d.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No check-in or check-out recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Event</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Recorded by</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.events.map(({ e, by }) => (
                      <TableRow key={e.id}>
                        <TableCell>{e.type === "check_in" ? "Check-in" : "Check-out"}</TableCell>
                        <TableCell className="tabular-nums">
                          {f(e.occurredAt, "MMM d, h:mm a")}
                          {Math.abs(e.recordedAt.getTime() - e.occurredAt.getTime()) > 120_000 ? (
                            <span className="block text-xs text-muted-foreground">received {f(e.recordedAt, "MMM d, h:mm a")}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {METHOD[e.method] ?? e.method}
                          {e.method !== "self" && by ? <span className="block text-xs text-muted-foreground">{by}</span> : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {e.withinGeofence === null ? "—" : e.withinGeofence ? <Badge tone="success">At venue</Badge> : <Badge tone="warning">{e.latitude == null ? "Not shared" : "Outside radius"}</Badge>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.note ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-3 text-xs text-muted-foreground">Attendance records can&apos;t be edited or deleted. Changes to hours are recorded below.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Change history</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {d.adjustments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>When</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.adjustments.map(({ a, by }) => {
                      const fmt = (v: string | null) => {
                        if (v == null) return "—";
                        if (a.field === "break_minutes") return `${v}m`;
                        if (a.field === "payable_minutes") return formatMinutes(Number(v));
                        const z = utcToZoned(new Date(v), tz);
                        return `${formatInZone(v, tz, "h:mm a")}${z.date !== utcToZoned(d.shift.startsAt, tz).date ? " (+1)" : ""}`;
                      };
                      const label = { worked_start: "Start", worked_end: "Finish", break_minutes: "Break", payable_minutes: "Payable" }[a.field] ?? a.field;
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{f(a.createdAt, "MMM d, h:mm a")}</TableCell>
                          <TableCell className="text-sm">
                            {by ?? "Unknown"}
                            <span className="block text-xs text-muted-foreground">{STAGE[a.stage] ?? a.stage}</span>
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {label}: {fmt(a.oldValue)} → <span className="font-medium">{fmt(a.newValue)}</span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{a.reason}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <TimesheetActions
          bookingId={bookingId}
          status={status}
          bookingStatus={d.booking.status}
          hasCheckIn={d.events.some((e) => e.e.type === "check_in")}
          shiftStarted={d.shift.startsAt < new Date()}
          shiftEnded={d.shift.endsAt < new Date()}
          shiftDate={utcToZoned(d.shift.startsAt, tz).date}
          defaults={{
            start: utcToZoned(t?.workedStart ?? d.shift.startsAt, tz).time,
            end: utcToZoned(t?.workedEnd ?? d.shift.endsAt, tz).time,
            breakMinutes: t?.breakMinutes ?? 0,
            computedMinutes: worked,
            payableMinutes: t?.payableMinutes ?? null,
          }}
          can={{
            prepare: canOnProject(actor, "timesheet.prepare", scope),
            approve: canOnProject(actor, "timesheet.approve", scope),
            correct: canOnProject(actor, "timesheet.correct_after_approval", scope),
            noShow: canOnProject(actor, "booking.confirm", scope),
          }}
          isOwn={d.staffUserId === viewer.userId}
        />
      </div>
    </>
  );
}
