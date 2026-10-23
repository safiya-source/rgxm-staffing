"use client";
import { format, parseISO } from "date-fns";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { formatInZone } from "@/lib/format";
import { FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { expandShiftPattern, utcToZoned } from "@/lib/time";
import { cancelShiftAction, duplicateShiftAction, updateShiftAction } from "../../actions";
import type { BreakPolicyOption, RequirementOption, ShiftItem } from "./types";

function useFinish(onClose: () => void) {
  const router = useRouter();
  return (res: ActionResult, setError: (e: string) => void) => {
    if (!res.ok) return setError(res.error);
    toast.success(res.message ?? "Saved");
    router.refresh();
    onClose();
  };
}

function describe(shift: ShiftItem) {
  return `${FIELD_ROLE_NAMES[shift.role]} · ${formatInZone(shift.startsAt, shift.timezone, "EEE MMM d, h:mm a")} · ${shift.locationName}`;
}

export function EditShiftDialog({
  shift,
  requirements,
  breakPolicies,
  showRates,
  onClose,
}: {
  shift: ShiftItem;
  requirements: RequirementOption[];
  breakPolicies: BreakPolicyOption[];
  showRates: boolean;
  onClose: () => void;
}) {
  const finish = useFinish(onClose);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const startLocal = utcToZoned(new Date(shift.startsAt), shift.timezone);
  const endLocal = utcToZoned(new Date(shift.endsAt), shift.timezone);
  const [f, setF] = useState({
    date: startLocal.date,
    startTime: startLocal.time,
    endTime: endLocal.time,
    role: shift.role,
    headcount: String(shift.headcount),
    rate: shift.rateCents != null ? (shift.rateCents / 100).toFixed(2) : "",
    requirementId: shift.requirementId ?? "",
    breakPolicyId: shift.breakPolicyId ?? "",
    reportingLocation: shift.reportingLocation ?? "",
    onsiteContact: shift.onsiteContact ?? "",
    uniform: shift.uniform ?? "",
    instructions: shift.instructions ?? "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit shift</DialogTitle>
          <DialogDescription>
            {shift.confirmed > 0
              ? `${shift.confirmed} confirmed ${shift.confirmed === 1 ? "person" : "people"} will see the new details. Time changes are checked for double-booking.`
              : "Times are local to the location."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date" htmlFor="e-date">
              <Input id="e-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
            </Field>
            <Field label="Start" htmlFor="e-st">
              <Input id="e-st" type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            </Field>
            <Field label="End" htmlFor="e-et" hint={f.endTime <= f.startTime ? "Ends the next day" : undefined}>
              <Input id="e-et" type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Role" htmlFor="e-role">
              <NativeSelect id="e-role" value={f.role} onChange={(e) => set({ role: e.target.value as FieldRole })}>
                {FIELD_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {FIELD_ROLE_NAMES[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="People" htmlFor="e-hc">
              <Input id="e-hc" type="number" min={Math.max(1, shift.confirmed)} value={f.headcount} onChange={(e) => set({ headcount: e.target.value })} />
            </Field>
            {showRates ? (
              <Field label="Hourly rate (CAD)" htmlFor="e-rate">
                <Input id="e-rate" inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} />
              </Field>
            ) : null}
          </div>
          <Field label="Requirement" htmlFor="e-req">
            <NativeSelect id="e-req" value={f.requirementId} onChange={(e) => set({ requirementId: e.target.value })}>
              <option value="">None</option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.quantity} × {FIELD_ROLE_NAMES[r.role]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reporting location" htmlFor="e-report">
              <Input id="e-report" value={f.reportingLocation} onChange={(e) => set({ reportingLocation: e.target.value })} />
            </Field>
            <Field label="On-site contact" htmlFor="e-contact">
              <Input id="e-contact" value={f.onsiteContact} onChange={(e) => set({ onsiteContact: e.target.value })} />
            </Field>
          </div>
          <Field label="Uniform" htmlFor="e-uniform">
            <Input id="e-uniform" value={f.uniform} onChange={(e) => set({ uniform: e.target.value })} />
          </Field>
          <Field label="Instructions" htmlFor="e-instr">
            <Textarea id="e-instr" value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} rows={3} />
          </Field>
          {breakPolicies.length ? (
            <Field label="Break policy" htmlFor="e-break">
              <NativeSelect id="e-break" value={f.breakPolicyId} onChange={(e) => set({ breakPolicyId: e.target.value })}>
                <option value="">None</option>
                {breakPolicies.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {error ? <FormMessage>{error}</FormMessage> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(undefined);
                const res = await updateShiftAction(shift.id, {
                  date: f.date,
                  startTime: f.startTime,
                  endTime: f.endTime,
                  role: f.role,
                  headcount: f.headcount,
                  rateCents: showRates ? f.rate : shift.rateCents != null ? (shift.rateCents / 100).toFixed(2) : "",
                  requirementId: f.requirementId || null,
                  breakPolicyId: f.breakPolicyId || null,
                  reportingLocation: f.reportingLocation,
                  onsiteContact: f.onsiteContact,
                  uniform: f.uniform,
                  instructions: f.instructions,
                });
                finish(res, setError);
              })
            }
          >
            {pending ? "Saving…" : "Save shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DuplicateShiftDialog({ shift, onClose }: { shift: ShiftItem; onClose: () => void }) {
  const finish = useFinish(onClose);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const local = utcToZoned(new Date(shift.startsAt), shift.timezone);
  const dates = useMemo(() => {
    if (!from || !to) return [];
    try {
      return expandShiftPattern({ startDate: from, endDate: to, weekdays: [], startTime: "00:00", endTime: "01:00", timeZone: "UTC" })
        .map((w) => w.date)
        .filter((d) => d !== local.date);
    } catch {
      return [];
    }
  }, [from, to, local.date]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate shift</DialogTitle>
          <DialogDescription>{describe(shift)}. Copies keep the same local times and details; nobody is booked on them.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From" htmlFor="d-from">
            <Input id="d-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="d-to">
            <Input id="d-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">
          {dates.length ? `${dates.length} cop${dates.length === 1 ? "y" : "ies"}: ${dates.slice(0, 4).map((d) => format(parseISO(d), "MMM d")).join(", ")}${dates.length > 4 ? "…" : ""}` : "Choose a date range."}
        </p>
        {error ? <FormMessage>{error}</FormMessage> : null}
        <DialogFooter>
          <Button
            disabled={pending || dates.length === 0}
            onClick={() =>
              start(async () => {
                setError(undefined);
                finish(await duplicateShiftAction(shift.id, dates), setError);
              })
            }
          >
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelShiftDialog({ shift, onClose }: { shift: ShiftItem; onClose: () => void }) {
  const finish = useFinish(onClose);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this shift?</DialogTitle>
          <DialogDescription>
            {describe(shift)}.{" "}
            {shift.confirmed + shift.pending > 0
              ? `${shift.confirmed + shift.pending} offer${shift.confirmed + shift.pending === 1 ? "" : "s"}/booking${shift.confirmed + shift.pending === 1 ? "" : "s"} will be cancelled too.`
              : ""}{" "}
            The shift stays in the history.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" htmlFor="c-reason">
          <Textarea id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required />
        </Field>
        {error ? <FormMessage>{error}</FormMessage> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep shift
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !reason.trim()}
            onClick={() =>
              start(async () => {
                setError(undefined);
                finish(await cancelShiftAction(shift.id, reason), setError);
              })
            }
          >
            Cancel shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
