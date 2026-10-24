"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveMyHoursAction } from "@/app/portal/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMinutes } from "@/lib/format";

type Values = { date: string; start: string; end: string; breakMinutes: number; note: string };

function minutesBetween(start: string, end: string, breakMinutes: number) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => n === undefined || Number.isNaN(n))) return null;
  let mins = eh! * 60 + em! - (sh! * 60 + sm!);
  if (mins < 0) mins += 24 * 60; // finished after midnight
  return Math.max(mins - breakMinutes, 0);
}

/** Staff review of their own hours. Changing a time needs a short reason, which RGXM sees. */
export function HoursForm({ bookingId, initial, recorded }: { bookingId: string; initial: Values; recorded: { start: string; end: string } | null }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const timesChanged = v.start !== initial.start || v.end !== initial.end;
  const differsFromRecorded = recorded ? v.start !== recorded.start || v.end !== recorded.end : false;
  const needsReason = timesChanged && Boolean(initial.start && initial.end);
  const total = v.start && v.end ? minutesBetween(v.start, v.end, v.breakMinutes) : null;

  function save(submit: boolean) {
    if (!v.start || !v.end) return toast.error("Add your start and finish times.");
    if (v.start === v.end) return toast.error("Your finish time must be after your start time.");
    if (needsReason && !reason.trim()) return toast.error("Tell us briefly why the times changed.");
    start(async () => {
      const res = await saveMyHoursAction(bookingId, { ...v, reason }, submit);
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        setReason("");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="hours-start">Started</Label>
          <Input id="hours-start" type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hours-end">Finished</Label>
          <Input id="hours-end" type="time" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="hours-break">Unpaid break (minutes)</Label>
        <Input id="hours-break" type="number" inputMode="numeric" min={0} max={600} value={v.breakMinutes} onChange={(e) => setV({ ...v, breakMinutes: Math.max(0, Number(e.target.value) || 0) })} />
      </div>
      {total !== null ? (
        <p className="text-sm">
          Total worked: <span className="font-semibold tabular-nums">{formatMinutes(total)}</span>
        </p>
      ) : null}
      {differsFromRecorded ? <p className="text-xs text-muted-foreground">Your check-in/out was recorded at {recorded!.start} – {recorded!.end}. Both are kept for RGXM to review.</p> : null}
      {needsReason ? (
        <div className="grid gap-1.5">
          <Label htmlFor="hours-reason">Why did the times change?</Label>
          <Input id="hours-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to check out when I left" />
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="hours-note">Note for RGXM (optional)</Label>
        <Textarea id="hours-note" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button size="lg" disabled={pending} onClick={() => save(true)}>
          Submit hours
        </Button>
        <Button size="lg" variant="outline" disabled={pending} onClick={() => save(false)}>
          Save for later
        </Button>
      </div>
    </div>
  );
}
