"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { formatMinutes } from "@/lib/format";
import { adjustTimesAction, approveAction, correctAction, markNoShowAction, recordAttendanceAction, sendBackAction } from "../actions";

type Props = {
  bookingId: string;
  status: string;
  bookingStatus: string;
  hasCheckIn: boolean;
  shiftStarted: boolean;
  shiftEnded: boolean;
  shiftDate: string;
  defaults: { start: string; end: string; breakMinutes: number; computedMinutes: number | null; payableMinutes: number | null };
  can: { prepare: boolean; approve: boolean; correct: boolean; noShow: boolean };
  isOwn: boolean;
};

const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const toMinutes = (v: string) => {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export function TimesheetActions(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [times, setTimes] = useState({ date: p.shiftDate, start: p.defaults.start, end: p.defaults.end, breakMinutes: String(p.defaults.breakMinutes), reason: "" });
  const [attendance, setAttendance] = useState({ type: "check_in" as "check_in" | "check_out", date: p.shiftDate, time: p.defaults.start, note: "" });
  const [payable, setPayable] = useState(p.defaults.computedMinutes != null ? hm(p.defaults.computedMinutes) : "");
  const [payReason, setPayReason] = useState("");
  const [text, setText] = useState("");
  const approved = ["approved", "locked", "exported", "paid"].includes(p.status);
  const noShow = p.bookingStatus === "no_show";

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(undefined);
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.refresh();
      } else setError(res.error);
    });

  if (p.isOwn) return <p className="text-sm text-muted-foreground">You can&apos;t review your own hours.</p>;
  if (noShow) return <Card className="h-fit p-5 text-sm text-muted-foreground">Marked as a no-show. Nothing is payable.</Card>;

  return (
    <div className="grid content-start gap-4">
      {error ? <FormMessage>{error}</FormMessage> : null}

      {p.can.approve && !approved && p.shiftEnded ? (
        <Card>
          <CardHeader>
            <CardTitle>Approve payable hours</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Payable time (h:mm)" htmlFor="payable" hint={p.defaults.computedMinutes != null ? `Worked time is ${formatMinutes(p.defaults.computedMinutes)}.` : "Add worked times first."}>
              <Input id="payable" value={payable} onChange={(e) => setPayable(e.target.value)} className="w-28 tabular-nums" />
            </Field>
            {p.defaults.computedMinutes != null && toMinutes(payable) !== p.defaults.computedMinutes ? (
              <Field label="Why does it differ? (required)" htmlFor="pay-reason">
                <Textarea id="pay-reason" value={payReason} onChange={(e) => setPayReason(e.target.value)} rows={2} />
              </Field>
            ) : null}
            <Button
              disabled={pending || Number.isNaN(toMinutes(payable))}
              onClick={() =>
                run(() =>
                  approveAction(p.bookingId, toMinutes(payable) === p.defaults.computedMinutes ? {} : { payableMinutes: toMinutes(payable), reason: payReason }),
                )
              }
            >
              Approve
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {p.can.correct && p.status === "approved" ? (
        <Card>
          <CardHeader>
            <CardTitle>Correct approved hours</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">Approved {p.defaults.payableMinutes != null ? formatMinutes(p.defaults.payableMinutes) : ""}. Corrections are recorded separately and can&apos;t be made once hours are in a payment batch.</p>
            <Field label="Corrected payable time (h:mm)" htmlFor="corr">
              <Input id="corr" value={payable} onChange={(e) => setPayable(e.target.value)} className="w-28 tabular-nums" />
            </Field>
            <Field label="Reason (required)" htmlFor="corr-reason">
              <Textarea id="corr-reason" value={payReason} onChange={(e) => setPayReason(e.target.value)} rows={2} />
            </Field>
            <Button variant="outline" disabled={pending || !payReason.trim()} onClick={() => run(() => correctAction(p.bookingId, { payableMinutes: toMinutes(payable), reason: payReason }))}>
              Record correction
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {p.can.prepare && !approved ? (
        <Card>
          <CardHeader>
            <CardTitle>Adjust worked time</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Start" htmlFor="adj-start">
                <Input id="adj-start" type="time" value={times.start} onChange={(e) => setTimes({ ...times, start: e.target.value })} />
              </Field>
              <Field label="Finish" htmlFor="adj-end" hint={times.end <= times.start ? "Next day" : undefined}>
                <Input id="adj-end" type="time" value={times.end} onChange={(e) => setTimes({ ...times, end: e.target.value })} />
              </Field>
              <Field label="Break (min)" htmlFor="adj-break">
                <Input id="adj-break" type="number" min={0} value={times.breakMinutes} onChange={(e) => setTimes({ ...times, breakMinutes: e.target.value })} />
              </Field>
            </div>
            <Field label="Reason (required)" htmlFor="adj-reason">
              <Textarea id="adj-reason" value={times.reason} onChange={(e) => setTimes({ ...times, reason: e.target.value })} rows={2} />
            </Field>
            <Button variant="outline" disabled={pending || !times.reason.trim()} onClick={() => run(() => adjustTimesAction(p.bookingId, { ...times, breakMinutes: Number(times.breakMinutes) }))}>
              Save times
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {p.can.prepare && !approved && p.shiftStarted ? (
        <Card>
          <CardHeader>
            <CardTitle>Record attendance for them</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Event" htmlFor="att-type">
                <NativeSelect id="att-type" value={attendance.type} onChange={(e) => setAttendance({ ...attendance, type: e.target.value as "check_in" | "check_out" })}>
                  <option value="check_in">Check-in</option>
                  <option value="check_out">Check-out</option>
                </NativeSelect>
              </Field>
              <Field label="Date" htmlFor="att-date">
                <Input id="att-date" type="date" value={attendance.date} onChange={(e) => setAttendance({ ...attendance, date: e.target.value })} />
              </Field>
              <Field label="Time" htmlFor="att-time">
                <Input id="att-time" type="time" value={attendance.time} onChange={(e) => setAttendance({ ...attendance, time: e.target.value })} />
              </Field>
            </div>
            <Field label="Note (required)" htmlFor="att-note" hint="e.g. Phone battery died; confirmed with Team Lead.">
              <Input id="att-note" value={attendance.note} onChange={(e) => setAttendance({ ...attendance, note: e.target.value })} />
            </Field>
            <Button variant="outline" disabled={pending || !attendance.note.trim()} onClick={() => run(() => recordAttendanceAction(p.bookingId, attendance))}>
              Record
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {p.can.prepare && ["submitted", "supervisor_verified", "in_progress", "not_started"].includes(p.status) ? (
        <Card>
          <CardHeader>
            <CardTitle>Send back to staff</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="What should they check?" aria-label="What should they check?" />
            <Button variant="outline" disabled={pending || !text.trim()} onClick={() => run(() => sendBackAction(p.bookingId, text))}>
              Send back
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {p.can.noShow && !p.hasCheckIn && p.shiftStarted && p.bookingStatus === "confirmed" ? (
        <Card>
          <CardHeader>
            <CardTitle>Didn&apos;t show up?</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="What happened?" aria-label="No-show reason" />
            <Button variant="destructive" disabled={pending || !text.trim()} onClick={() => run(() => markNoShowAction(p.bookingId, text))}>
              Mark as no-show
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
