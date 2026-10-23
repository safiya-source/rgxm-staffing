"use client";
import { addDays, format } from "date-fns";
import { CheckIcon, CircleHelpIcon, SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatInZone, formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { utcToZoned } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Candidate } from "@/server/queries/staffing";
import { findCandidatesAction, sendOffersAction } from "../actions";
import type { GroupShift } from "./staffing-board";

const EXISTING_LABEL: Record<string, string> = {
  offered: "Already offered",
  interested: "Interested",
  awaiting_confirmation: "Shortlisted",
  confirmed: "Confirmed",
  waitlisted: "Waitlisted",
  declined: "Declined",
  completed: "Completed",
  no_show: "No-show",
};

function defaultDeadline(firstShiftStart: string, tz: string) {
  // Tomorrow 5pm, or the day before the first shift if that's sooner.
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
  const dayBefore = format(addDays(new Date(`${utcToZoned(new Date(firstShiftStart), tz).date}T12:00:00`), -1), "yyyy-MM-dd");
  return dayBefore < tomorrow ? (dayBefore >= format(new Date(), "yyyy-MM-dd") ? dayBefore : "") : tomorrow;
}

export function OfferBuilder({
  projectId,
  group,
  showRates,
  onClose,
}: {
  projectId: string;
  group: { role: string; locationName: string; timezone: string; shifts: GroupShift[] };
  showRates: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [shiftIds, setShiftIds] = useState(group.shifts.filter((s) => s.confirmed < s.headcount).map((s) => s.id).concat(group.shifts.every((s) => s.confirmed >= s.headcount) ? group.shifts.map((s) => s.id) : []));
  const [q, setQ] = useState("");
  const [hideConflicts, setHideConflicts] = useState(true);
  const [hideUnavailable, setHideUnavailable] = useState(true);
  const [onlyDeclared, setOnlyDeclared] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deadlineDate, setDeadlineDate] = useState(() => defaultDeadline(group.shifts[0]!.startsAt, group.timezone));
  const [deadlineTime, setDeadlineTime] = useState("17:00");
  const [error, setError] = useState<string>();
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();
  const req = useRef(0);

  useEffect(() => {
    if (!shiftIds.length) return;
    const id = ++req.current;
    const t = setTimeout(
      () =>
        startLoading(async () => {
          const res = await findCandidatesAction(projectId, shiftIds, q.trim() ? { q: q.trim() } : {});
          if (id !== req.current) return;
          if (res.ok) setCandidates(res.data!.candidates);
          else setError(res.error);
        }),
      q ? 250 : 0,
    );
    return () => clearTimeout(t);
  }, [projectId, shiftIds, q]);

  const chosenShifts = group.shifts.filter((s) => shiftIds.includes(s.id));
  const rows = useMemo(() => {
    return (candidates ?? []).filter((c) => {
      const per = chosenShifts.map((s) => c.perShift[s.id]).filter(Boolean);
      if (hideConflicts && per.length && per.every((x) => x!.conflict || x!.existingStatus)) return false;
      if (hideUnavailable && per.length && per.every((x) => x!.availability === "unavailable")) return false;
      if (onlyDeclared && !per.some((x) => x!.availability === "available")) return false;
      return true;
    });
  }, [candidates, chosenShifts, hideConflicts, hideUnavailable, onlyDeclared]);

  // Offers that will actually be created: skip shifts where they're busy, already offered or have no rate.
  const offerable = (c: Candidate) => chosenShifts.filter((s) => {
    const x = c.perShift[s.id];
    return x && !x.conflict && !x.existingStatus && x.rateCents != null && (!hideUnavailable || x.availability !== "unavailable");
  });
  const selectedRows = rows.filter((c) => selected.includes(c.id));
  const offerCount = selectedRows.reduce((n, c) => n + offerable(c).length, 0);

  function send() {
    setError(undefined);
    startSending(async () => {
      const pairs = selectedRows.flatMap((c) => offerable(c).map((s) => ({ shiftId: s.id, staffId: c.id })));
      const res = await sendOffersAction(projectId, { shiftIds, staffIds: selectedRows.map((c) => c.id), pairs, deadlineDate, deadlineTime, skipConflicts: true });
      if (!res.ok) return setError(res.error);
      toast.success(res.message ?? "Offers sent");
      for (const s of res.data?.skipped ?? []) toast.info(s);
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[94dvh] max-w-5xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            Send offers · {FIELD_ROLE_NAMES[group.role as FieldRole]} at {group.locationName}
          </DialogTitle>
          <DialogDescription>
            An offer asks people if they&apos;re available. Nobody is booked until you confirm them.
          </DialogDescription>
        </DialogHeader>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Shifts to offer</legend>
          <div className="flex flex-wrap gap-2">
            {group.shifts.map((s) => {
              const on = shiftIds.includes(s.id);
              return (
                <label key={s.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", on ? "border-foreground/40 bg-card" : "bg-muted/40 text-muted-foreground")}>
                  <Checkbox checked={on} onCheckedChange={(c) => setShiftIds((x) => (c ? [...x, s.id] : x.filter((y) => y !== s.id)))} />
                  {formatInZone(s.startsAt, group.timezone, "EEE MMM d, h:mma")}
                  <span className="tabular-nums text-muted-foreground">
                    {s.confirmed}/{s.headcount}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name" aria-label="Filter candidates by name" className="h-9 pl-9" />
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={hideConflicts} onCheckedChange={(c) => setHideConflicts(Boolean(c))} /> Hide people already booked or offered
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={hideUnavailable} onCheckedChange={(c) => setHideUnavailable(Boolean(c))} /> Hide marked unavailable
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={onlyDeclared} onCheckedChange={(c) => setOnlyDeclared(Boolean(c))} /> Only people who said they&apos;re available
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {!shiftIds.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Choose at least one shift.</p>
          ) : candidates === null || (loading && !candidates.length) ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Finding qualified staff…</p>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No one matches. Try clearing a filter.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="w-10 px-3 py-2">
                    <Checkbox
                      aria-label="Select all shown"
                      checked={rows.length > 0 && rows.every((r) => selected.includes(r.id))}
                      onCheckedChange={(c) => setSelected(c ? rows.filter((r) => offerable(r).length).map((r) => r.id) : [])}
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Person</th>
                  {chosenShifts.map((s) => (
                    <th key={s.id} className="px-2 py-2 text-left font-medium">
                      {formatInZone(s.startsAt, group.timezone, "EEE d")}
                    </th>
                  ))}
                  {showRates ? <th className="px-3 py-2 text-right font-medium">Rate</th> : null}
                  <th className="px-3 py-2 text-right font-medium">Shifts worked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const able = offerable(c).length;
                  const rates = [...new Set(chosenShifts.map((s) => c.perShift[s.id]?.rateCents).filter((x): x is number => x != null))];
                  return (
                    <tr key={c.id} className={cn("border-b last:border-0", !able && "opacity-60")}>
                      <td className="px-3 py-2">
                        <Checkbox
                          aria-label={`Select ${c.name}`}
                          disabled={!able}
                          checked={selected.includes(c.id)}
                          onCheckedChange={(v) => setSelected((x) => (v ? [...x, c.id] : x.filter((y) => y !== c.id)))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.city ?? "City not set"}
                          {c.sameCity ? " · same city" : ""}
                        </span>
                      </td>
                      {chosenShifts.map((s) => {
                        const x = c.perShift[s.id];
                        if (!x) return <td key={s.id} />;
                        const [Icon, label, cls] = x.existingStatus
                          ? [CheckIcon, EXISTING_LABEL[x.existingStatus] ?? x.existingStatus, "text-muted-foreground"]
                          : x.conflict
                            ? [TriangleAlertIcon, "Booked elsewhere", "text-warning"]
                            : x.availability === "available"
                              ? [CheckIcon, "Available", "text-success"]
                              : x.availability === "unavailable"
                                ? [XIcon, "Unavailable", "text-destructive"]
                                : [CircleHelpIcon, "Not set", "text-muted-foreground"];
                        return (
                          <td key={s.id} className="px-2 py-2">
                            <span className={cn("inline-flex items-center gap-1 text-xs", cls)} title={label}>
                              <Icon className="size-3.5" />
                              <span className="sr-only sm:not-sr-only">{label}</span>
                            </span>
                          </td>
                        );
                      })}
                      {showRates ? (
                        <td className="px-3 py-2 text-right text-xs whitespace-nowrap tabular-nums">
                          {rates.length === 0 ? <Badge tone="danger">No rate</Badge> : rates.length === 1 ? `${formatMoney(rates[0]!)}/h` : "Varies"}
                        </td>
                      ) : null}
                      <td className="px-3 py-2 text-right tabular-nums">{c.completedShifts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-end gap-3">
              <Field label="Respond by" htmlFor="deadline-date">
                <Input id="deadline-date" type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} className="h-9 w-40" />
              </Field>
              <Field label="Time" htmlFor="deadline-time">
                <Input id="deadline-time" type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} className="h-9 w-28" disabled={!deadlineDate} />
              </Field>
            </div>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{group.timezone.replace("_", " ")} time · leave blank for no deadline</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {error ? <FormMessage>{error}</FormMessage> : null}
            <Button disabled={sending || offerCount === 0} onClick={send}>
              {sending ? "Sending…" : offerCount ? `Send ${offerCount} offer${offerCount === 1 ? "" : "s"} to ${selectedRows.length} ${selectedRows.length === 1 ? "person" : "people"}` : "Select people"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
