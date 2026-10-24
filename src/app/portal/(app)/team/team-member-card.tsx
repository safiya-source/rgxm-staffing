"use client";
import { PhoneIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { supervisorRecordAction, supervisorSendBackAction, supervisorVerifyAction } from "@/app/portal/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { FLAG_LABEL, TIMESHEET_STATUS_LABEL, type Flag, type TimesheetStatus } from "@/server/domain/attendance-rules";

export type TeamMember = {
  bookingId: string;
  name: string;
  phone: string | null;
  role: string;
  projectName: string;
  locationName: string;
  timezone: string;
  date: string;
  scheduled: { start: string; end: string };
  checkIn: string | null;
  checkOut: string | null;
  worked: { start: string; end: string } | null;
  breakMinutes: number;
  flags: string[];
  staffNote: string | null;
  status: string | null;
  started: boolean;
};

/** "19:05" → "7:05 PM" for display; inputs keep 24-hour values. */
function to12h(t: string | null) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${h! % 12 || 12}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
}

type Mode = "check_in" | "check_out" | "verify" | "send_back" | null;
const VERIFIABLE = ["in_progress", "submitted", "needs_review"];

export function TeamMemberCard({ member: m }: { member: TeamMember }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [pending, start] = useTransition();
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const base = m.worked ?? (m.checkIn && m.checkOut ? { start: m.checkIn, end: m.checkOut } : { start: m.scheduled.start, end: m.scheduled.end });
  const [hours, setHours] = useState({ start: base.start, end: base.end, breakMinutes: m.breakMinutes });
  const changed = hours.start !== base.start || hours.end !== base.end || hours.breakMinutes !== m.breakMinutes || !m.worked;
  const status = m.status as TimesheetStatus | null;
  const done = status && !VERIFIABLE.includes(status);

  function open(next: Mode) {
    setNote("");
    setTime(next === "check_in" ? m.scheduled.start : next === "check_out" ? m.scheduled.end : "");
    setHours({ start: base.start, end: base.end, breakMinutes: m.breakMinutes });
    setMode(next);
  }

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        setMode(null);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function submit() {
    if (mode === "check_in" || mode === "check_out") {
      if (!note.trim()) return toast.error("Add a short note, e.g. why they couldn't check in themselves.");
      run(() => supervisorRecordAction(m.bookingId, { type: mode, date: m.date, time, note }));
    } else if (mode === "verify") {
      const timesEdited = Boolean(m.worked) && (hours.start !== base.start || hours.end !== base.end || hours.breakMinutes !== m.breakMinutes);
      if (timesEdited && !note.trim()) return toast.error("Add a reason for changing their hours.");
      run(() => supervisorVerifyAction(m.bookingId, { date: m.date, ...hours, reason: note.trim() || (m.worked ? "" : "Set from on-site check-in/out"), note, changed }));
    } else if (mode === "send_back") {
      if (!note.trim()) return toast.error("Tell them what to fix.");
      run(() => supervisorSendBackAction(m.bookingId, note));
    }
  }

  return (
    <Card className="grid grid-cols-1 gap-3 p-4" data-testid="team-member">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{m.name}</p>
          <p className="text-sm text-muted-foreground">
            {FIELD_ROLE_NAMES[m.role as FieldRole] ?? m.role} · {to12h(m.scheduled.start)} – {to12h(m.scheduled.end)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {m.projectName} · {m.locationName}
          </p>
        </div>
        {status ? <Badge tone={done ? "success" : status === "needs_review" ? "warning" : "neutral"}>{TIMESHEET_STATUS_LABEL[status]}</Badge> : <Badge>Not started</Badge>}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Checked in</dt>
          <dd className="tabular-nums">{to12h(m.checkIn)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Checked out</dt>
          <dd className="tabular-nums">{to12h(m.checkOut)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Reported</dt>
          <dd className="tabular-nums">{m.worked ? `${to12h(m.worked.start)}–${to12h(m.worked.end)}` : "—"}</dd>
        </div>
      </dl>
      {m.flags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {m.flags.map((f) => (
            <Badge key={f} tone="warning">
              {FLAG_LABEL[f as Flag] ?? f}
            </Badge>
          ))}
        </div>
      ) : null}
      {m.staffNote ? <p className="text-sm text-muted-foreground">&ldquo;{m.staffNote}&rdquo;</p> : null}
      {!done ? (
        <div className="flex flex-wrap gap-2">
          {m.started && !m.checkIn ? (
            <Button size="sm" variant="outline" onClick={() => open("check_in")}>
              Record check-in
            </Button>
          ) : null}
          {m.checkIn && !m.checkOut ? (
            <Button size="sm" variant="outline" onClick={() => open("check_out")}>
              Record check-out
            </Button>
          ) : null}
          {m.started && (m.worked || (m.checkIn && m.checkOut)) ? (
            <Button size="sm" onClick={() => open("verify")}>
              Verify hours
            </Button>
          ) : null}
          {status === "submitted" || status === "in_progress" ? (
            <Button size="sm" variant="ghost" onClick={() => open("send_back")}>
              Send back
            </Button>
          ) : null}
          {m.phone ? (
            <a href={`tel:${m.phone}`} className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground" aria-label={`Call ${m.name}`}>
              <PhoneIcon className="size-4" />
            </a>
          ) : null}
        </div>
      ) : null}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "check_in" ? "Record check-in" : mode === "check_out" ? "Record check-out" : mode === "verify" ? `Verify ${m.name}'s hours` : "Send back to staff"}
            </DialogTitle>
            <DialogDescription>
              {mode === "verify"
                ? "Your verification and any change you make are recorded and sent to RGXM, who give final approval."
                : mode === "send_back"
                  ? "They'll get a notification asking them to fix their hours."
                  : "Recorded with your name. Use this when they couldn't check in on their phone."}
            </DialogDescription>
          </DialogHeader>
          {mode === "check_in" || mode === "check_out" ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`t-${m.bookingId}`}>Time</Label>
              <Input id={`t-${m.bookingId}`} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          ) : null}
          {mode === "verify" ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`vs-${m.bookingId}`}>Start</Label>
                <Input id={`vs-${m.bookingId}`} type="time" value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`ve-${m.bookingId}`}>Finish</Label>
                <Input id={`ve-${m.bookingId}`} type="time" value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`vb-${m.bookingId}`}>Break (min)</Label>
                <Input
                  id={`vb-${m.bookingId}`}
                  type="number"
                  min={0}
                  value={hours.breakMinutes}
                  onChange={(e) => setHours({ ...hours, breakMinutes: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`n-${m.bookingId}`}>{mode === "verify" ? "Note (required if you change their hours)" : mode === "send_back" ? "What needs fixing?" : "Note"}</Label>
            <Textarea id={`n-${m.bookingId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button disabled={pending} onClick={submit} variant={mode === "send_back" ? "outline" : "default"}>
              {mode === "verify" ? "Verify" : mode === "send_back" ? "Send back" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
