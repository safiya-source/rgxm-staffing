"use client";
import { TimeAgo } from "@/components/app/time-ago";
import { AlertTriangleIcon, MessageCircleQuestionIcon, SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { DemoBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { formatInZone, formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { bookingOpAction, bulkConfirmAction, cancelBookingAction, confirmBookingAction } from "../actions";
import { OfferBuilder } from "./offer-builder";

export type GroupShift = { id: string; startsAt: string; endsAt: string; headcount: number; rateCents: number | null; status: string; confirmed: number; pending: number };
export type BoardRow = {
  id: string;
  shiftId: string;
  staffId: string;
  status: string;
  name: string;
  phone: string | null;
  city: string | null;
  isDemo: boolean;
  offeredRateCents: number | null;
  agreedRateCents: number | null;
  responseDeadline: string | null;
  respondedAt: string | null;
  waitlistPosition: number | null;
  overrideReason: string | null;
  cancelReason: string | null;
  cancelledByStaff: boolean | null;
  lastQuestion: string | null;
};
type Can = { offer: boolean; confirm: boolean; override: boolean; reply: boolean; rates: boolean };

const CELL: Record<string, { label: string; className: string }> = {
  offered: { label: "Offered", className: "bg-info-soft text-info" },
  interested: { label: "Interested", className: "bg-brand/10 text-brand font-medium" },
  awaiting_confirmation: { label: "Shortlisted", className: "bg-warning-soft text-warning font-medium" },
  confirmed: { label: "Confirmed", className: "bg-success-soft text-success font-medium" },
  waitlisted: { label: "Waitlist", className: "bg-secondary text-secondary-foreground" },
  declined: { label: "Declined", className: "text-muted-foreground line-through" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground line-through" },
  completed: { label: "Completed", className: "bg-secondary text-muted-foreground" },
  no_show: { label: "No-show", className: "bg-danger-soft text-destructive" },
};

const FILTERS = [
  ["all", "All"],
  ["decide", "Needs decision"],
  ["noreply", "No reply"],
  ["confirmed", "Confirmed"],
  ["waitlisted", "Waitlist"],
  ["declined", "Declined / cancelled"],
] as const;

/** The current (most recent, non-superseded) booking per person per shift. */
function latestBy(rows: BoardRow[]) {
  const m = new Map<string, BoardRow>();
  for (const r of rows) {
    const key = `${r.staffId}:${r.shiftId}`;
    const prev = m.get(key);
    const live = (x: BoardRow) => !["declined", "cancelled"].includes(x.status);
    if (!prev || (live(r) && !live(prev))) m.set(key, r);
  }
  return m;
}

export function StaffingBoard({
  projectId,
  can,
  group,
  rows,
}: {
  projectId: string;
  can: Can;
  group: { role: string; locationName: string; timezone: string; shifts: GroupShift[] };
  rows: BoardRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [offering, setOffering] = useState(false);
  const [conflict, setConflict] = useState<{ bookingId: string; name: string; conflicts: { projectName: string; when: string }[]; canOverride: boolean } | null>(null);
  const [cancelling, setCancelling] = useState<BoardRow | null>(null);
  const [now] = useState(() => Date.now());

  const cells = useMemo(() => latestBy(rows), [rows]);
  const people = useMemo(() => {
    const m = new Map<string, { staffId: string; name: string; city: string | null; isDemo: boolean }>();
    for (const r of rows) if (!m.has(r.staffId)) m.set(r.staffId, { staffId: r.staffId, name: r.name, city: r.city, isDemo: r.isDemo });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const statusesOf = (staffId: string) => group.shifts.map((s) => cells.get(`${staffId}:${s.id}`)?.status).filter(Boolean) as string[];
  const matches = (staffId: string) => {
    const st = statusesOf(staffId);
    switch (filter) {
      case "decide":
        return st.some((s) => s === "interested" || s === "awaiting_confirmation");
      case "noreply":
        return st.some((s) => s === "offered");
      case "confirmed":
        return st.includes("confirmed");
      case "waitlisted":
        return st.includes("waitlisted");
      case "declined":
        return st.some((s) => s === "declined" || s === "cancelled");
      default:
        return true;
    }
  };
  const visible = people.filter((p) => matches(p.staffId));

  const latest = [...cells.values()];
  const count = (pred: (r: BoardRow) => boolean) => latest.filter(pred).length;
  const summary = [
    ["Offers sent", count((r) => r.status !== "draft")],
    ["Interested", count((r) => r.status === "interested")],
    ["No reply", count((r) => r.status === "offered")],
    ["Questions", count((r) => r.status === "offered" && Boolean(r.lastQuestion))],
    ["Declined", count((r) => r.status === "declined")],
    ["Shortlisted", count((r) => r.status === "awaiting_confirmation")],
    ["Confirmed", count((r) => r.status === "confirmed")],
    ["Waitlisted", count((r) => r.status === "waitlisted")],
  ] as const;
  const positions = group.shifts.reduce((n, s) => n + s.headcount, 0);
  const confirmed = group.shifts.reduce((n, s) => n + s.confirmed, 0);

  function report(res: ActionResult) {
    if (res.ok) toast.success(res.message ?? "Done");
    else toast.error(res.error);
    router.refresh();
  }

  function confirm(bookingId: string, name: string, overrideReason?: string) {
    start(async () => {
      const res = await confirmBookingAction(bookingId, overrideReason);
      if (!res.ok && res.data?.conflicts) {
        setConflict({ bookingId, name, conflicts: res.data.conflicts, canOverride: Boolean(res.data.canOverride) });
        return;
      }
      setConflict(null);
      report(res);
    });
  }

  function op(row: BoardRow, action: Parameters<typeof bookingOpAction>[1], reason?: string) {
    start(async () => report(await bookingOpAction(row.id, action, reason)));
  }

  const selectedDecidable = latest.filter((r) => selected.includes(r.staffId) && (r.status === "interested" || r.status === "awaiting_confirmation" || r.status === "waitlisted"));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {FIELD_ROLE_NAMES[group.role as FieldRole]} · {group.locationName}
          </h2>
          <p className="text-sm text-muted-foreground">
            {confirmed}/{positions} positions confirmed across {group.shifts.length} shift{group.shifts.length === 1 ? "" : "s"}
          </p>
        </div>
        {can.offer ? (
          <Button onClick={() => setOffering(true)}>
            <SendIcon /> Send offers
          </Button>
        ) : null}
      </div>

      <dl className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {summary.map(([label, n]) => (
          <div key={label} className="rounded-lg border bg-card px-3 py-2">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter people">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn("cursor-pointer rounded-full border px-3 py-1 text-sm", filter === key ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent")}
          >
            {label}
          </button>
        ))}
      </div>

      {selected.length > 0 && can.confirm ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-xs" role="region" aria-label="Bulk actions">
          <span className="font-medium">{selected.length} selected</span>
          <Button
            size="sm"
            disabled={pending || selectedDecidable.length === 0}
            onClick={() =>
              start(async () => {
                report(await bulkConfirmAction(selectedDecidable.map((r) => r.id)));
                setSelected([]);
              })
            }
          >
            Confirm {selectedDecidable.length} response{selectedDecidable.length === 1 ? "" : "s"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      ) : null}

      {people.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="font-medium">No offers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Send offers to qualified staff. Responses appear here as they come in.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b">
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    aria-label="Select everyone shown"
                    checked={visible.length > 0 && visible.every((p) => selected.includes(p.staffId))}
                    onCheckedChange={(c) => setSelected(c ? visible.map((p) => p.staffId) : [])}
                  />
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Person</th>
                {group.shifts.map((s) => (
                  <th key={s.id} className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                    <span className="block text-foreground">{formatInZone(s.startsAt, group.timezone, "EEE MMM d")}</span>
                    {formatInZone(s.startsAt, group.timezone, "h:mma").toLowerCase()} ·{" "}
                    <span className={cn("tabular-nums", s.confirmed >= s.headcount ? "text-success" : undefined)}>
                      {s.confirmed}/{s.headcount}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.staffId} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <Checkbox
                      aria-label={`Select ${p.name}`}
                      checked={selected.includes(p.staffId)}
                      onCheckedChange={(c) => setSelected((s) => (c ? [...s, p.staffId] : s.filter((x) => x !== p.staffId)))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <a href={`/dashboard/talent/${p.staffId}`} className="font-medium hover:underline">
                      {p.name}
                    </a>
                    {p.isDemo ? <DemoBadge className="ml-1.5" /> : null}
                    <span className="block text-xs text-muted-foreground">{p.city ?? ""}</span>
                  </td>
                  {group.shifts.map((s) => {
                    const r = cells.get(`${p.staffId}:${s.id}`);
                    if (!r) return <td key={s.id} className="px-2 py-2 text-xs text-muted-foreground">—</td>;
                    const cell = CELL[r.status] ?? { label: r.status, className: "" };
                    const overdue = r.status === "offered" && r.responseDeadline && new Date(r.responseDeadline).getTime() < now;
                    return (
                      <td key={s.id} className="px-2 py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={cn("inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs hover:ring-1 hover:ring-ring/40", cell.className)}
                            aria-label={`${p.name}, ${formatInZone(s.startsAt, group.timezone, "MMM d")}: ${cell.label}`}
                          >
                            {cell.label}
                            {r.status === "waitlisted" && r.waitlistPosition ? ` #${r.waitlistPosition}` : ""}
                            {r.lastQuestion && r.status === "offered" ? <MessageCircleQuestionIcon className="size-3.5" /> : null}
                            {r.overrideReason ? <AlertTriangleIcon className="size-3.5 text-warning" /> : null}
                            {overdue ? <span className="text-[10px] text-muted-foreground">· late</span> : null}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-64">
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
                              {can.rates && (r.agreedRateCents ?? r.offeredRateCents) != null
                                ? `${r.agreedRateCents != null ? "Agreed" : "Offered"} ${formatMoney((r.agreedRateCents ?? r.offeredRateCents)!)}/h`
                                : cell.label}
                              {r.respondedAt ? (
                                <>
                                  {" · replied "}
                                  <TimeAgo date={r.respondedAt} />
                                </>
                              ) : null}
                              {r.lastQuestion ? <span className="mt-1 block text-foreground">“{r.lastQuestion}”</span> : null}
                              {r.overrideReason ? <span className="mt-1 block text-warning">Override: {r.overrideReason}</span> : null}
                              {r.cancelReason ? <span className="mt-1 block">{r.cancelledByStaff ? "They cancelled" : "Reason"}: {r.cancelReason}</span> : null}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {can.confirm && ["interested", "awaiting_confirmation", "waitlisted"].includes(r.status) ? (
                              <DropdownMenuItem disabled={pending} onSelect={() => confirm(r.id, r.name)}>
                                Confirm booking
                              </DropdownMenuItem>
                            ) : null}
                            {can.offer && r.status === "interested" ? <DropdownMenuItem onSelect={() => op(r, "shortlist")}>Shortlist</DropdownMenuItem> : null}
                            {can.offer && r.status === "awaiting_confirmation" ? <DropdownMenuItem onSelect={() => op(r, "unshortlist")}>Remove from shortlist</DropdownMenuItem> : null}
                            {can.offer && ["interested", "awaiting_confirmation"].includes(r.status) ? <DropdownMenuItem onSelect={() => op(r, "waitlist")}>Add to waitlist</DropdownMenuItem> : null}
                            {can.offer && ["interested", "awaiting_confirmation", "waitlisted"].includes(r.status) ? (
                              <DropdownMenuItem onSelect={() => op(r, "release", "Not selected")}>Release (not selected)</DropdownMenuItem>
                            ) : null}
                            {can.offer && r.status === "offered" ? <DropdownMenuItem onSelect={() => op(r, "withdraw")}>Withdraw offer</DropdownMenuItem> : null}
                            {can.confirm && r.status === "confirmed" ? (
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setCancelling(r)}>
                                Cancel booking…
                              </DropdownMenuItem>
                            ) : null}
                            {["declined", "cancelled"].includes(r.status) ? (
                              <DropdownMenuItem disabled>Send a new offer from “Send offers”</DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {offering ? <OfferBuilder projectId={projectId} group={group} showRates={can.rates} onClose={() => setOffering(false)} /> : null}

      <ConflictDialog state={conflict} pending={pending} onClose={() => setConflict(null)} onOverride={(reason) => conflict && confirm(conflict.bookingId, conflict.name, reason)} />
      <CancelDialog
        row={cancelling}
        onClose={() => setCancelling(null)}
        onCancel={(reason) =>
          start(async () => {
            report(await cancelBookingAction(cancelling!.id, reason));
            setCancelling(null);
          })
        }
        pending={pending}
      />
    </div>
  );
}

function ConflictDialog({
  state,
  pending,
  onClose,
  onOverride,
}: {
  state: { name: string; conflicts: { projectName: string; when: string }[]; canOverride: boolean } | null;
  pending: boolean;
  onClose: () => void;
  onOverride: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scheduling conflict</DialogTitle>
          <DialogDescription>{state?.name} is already confirmed for an overlapping shift:</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1 rounded-lg bg-warning-soft p-3 text-sm">
          {state?.conflicts.map((c, i) => (
            <li key={i}>
              <span className="font-medium">{c.projectName}</span> · {c.when}
            </li>
          ))}
        </ul>
        {state?.canOverride ? (
          <>
            <Field label="Reason for overriding (recorded in the audit log)" htmlFor="override-reason">
              <Textarea id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Don&apos;t confirm
              </Button>
              <Button variant="destructive" disabled={pending || !reason.trim()} onClick={() => onOverride(reason)}>
                Confirm anyway
              </Button>
            </DialogFooter>
          </>
        ) : (
          <FormMessage>Only an administrator or this project&apos;s manager can override a double-booking.</FormMessage>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ row, onClose, onCancel, pending }: { row: BoardRow | null; onClose: () => void; onCancel: (reason: string) => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {row?.name}&apos;s booking?</DialogTitle>
          <DialogDescription>They&apos;ll be notified. The booking stays in the history.</DialogDescription>
        </DialogHeader>
        <Field label="Reason (shared with them)" htmlFor="cancel-reason">
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep booking
          </Button>
          <Button variant="destructive" disabled={pending || !reason.trim()} onClick={() => onCancel(reason)}>
            Cancel booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

