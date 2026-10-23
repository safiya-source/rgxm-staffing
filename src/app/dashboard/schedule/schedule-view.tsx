"use client";
import { addDays, format, isSameMonth, parseISO } from "date-fns";
import { AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { formatInZone } from "@/lib/format";
import { FIELD_ROLE_NAMES, FIELD_ROLES } from "@/lib/roles";
import { utcToZoned } from "@/lib/time";
import { cn } from "@/lib/utils";
import { moveShiftAction } from "../projects/actions";

export type View = "day" | "week" | "month";

type CalShift = {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  locationName: string;
  role: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  headcount: number;
  confirmed: number;
  status: string;
};

type Unfilled = { id: string; projectId: string; projectName: string; role: string; startsAt: string; timezone: string; open: number; locationName: string };

function coverageTone(s: CalShift) {
  if (s.status === "draft") return "border-dashed border-border bg-card text-muted-foreground";
  if (s.confirmed >= s.headcount) return "border-success/30 bg-success-soft text-foreground";
  if (s.confirmed > 0) return "border-warning/40 bg-warning-soft text-foreground";
  return "border-destructive/30 bg-danger-soft text-foreground";
}

function ShiftChip({ s, draggable, compact }: { s: CalShift; draggable: boolean; compact?: boolean }) {
  return (
    <Link
      href={`/dashboard/projects/${s.projectId}/shifts`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/shift-id", s.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn("block rounded-md border px-2 py-1 text-xs leading-tight hover:ring-1 hover:ring-ring/40", coverageTone(s), draggable && "cursor-grab active:cursor-grabbing")}
      title={`${s.projectName} · ${s.locationName} · ${FIELD_ROLE_NAMES[s.role as keyof typeof FIELD_ROLE_NAMES]} · ${s.confirmed}/${s.headcount} filled${s.status === "draft" ? " · draft" : ""}`}
    >
      <span className="flex items-baseline justify-between gap-1">
        <span className="truncate">
          <span className="font-medium tabular-nums">{formatInZone(s.startsAt, s.timezone, "h:mma").toLowerCase()}</span> {s.role}
        </span>{" "}
        <span className="shrink-0 tabular-nums">
          {s.confirmed}/{s.headcount}
        </span>
      </span>
      {!compact ? <span className="block truncate text-muted-foreground">{s.projectCode}</span> : null}
    </Link>
  );
}

export function ScheduleView(props: {
  view: View;
  anchor: string;
  today: string;
  rangeStart: string;
  rangeEnd: string;
  prev: string;
  next: string;
  projectId: string;
  role: string;
  projects: { id: string; name: string }[];
  manageableProjectIds: string[];
  unfilled: Unfilled[];
  shifts: CalShift[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return `${pathname}?${next.toString()}`;
  };

  const byDate = useMemo(() => {
    const m = new Map<string, CalShift[]>();
    for (const s of props.shifts) {
      const d = utcToZoned(new Date(s.startsAt), s.timezone).date;
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return m;
  }, [props.shifts]);

  const days: string[] = [];
  for (let d = parseISO(props.rangeStart); format(d, "yyyy-MM-dd") <= props.rangeEnd; d = addDays(d, 1)) days.push(format(d, "yyyy-MM-dd"));

  const canDrag = (s: CalShift) => props.view === "week" && props.manageableProjectIds.includes(s.projectId) && s.status !== "cancelled" && s.status !== "completed";

  function onDrop(date: string, e: React.DragEvent) {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData("text/shift-id");
    const s = props.shifts.find((x) => x.id === id);
    if (!s || utcToZoned(new Date(s.startsAt), s.timezone).date === date) return;
    start(async () => {
      const res = await moveShiftAction(id, date);
      if (res.ok) toast.success(`Moved to ${format(parseISO(date), "EEE MMM d")}`);
      else toast.error(res.error);
      router.refresh();
    });
  }

  const title =
    props.view === "day"
      ? format(parseISO(props.anchor), "EEEE, MMMM d, yyyy")
      : props.view === "week"
        ? `${format(parseISO(props.rangeStart), "MMM d")} – ${format(parseISO(props.rangeEnd), "MMM d, yyyy")}`
        : format(parseISO(props.anchor), "MMMM yyyy");

  return (
    <div className="grid gap-5 2xl:grid-cols-[1fr_17rem]">
      <div className="grid min-w-0 content-start gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center">
            <Button asChild variant="ghost" size="icon" aria-label="Previous">
              <Link href={href({ date: props.prev })}>
                <ChevronLeftIcon />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="icon" aria-label="Next">
              <Link href={href({ date: props.next })}>
                <ChevronRightIcon />
              </Link>
            </Button>
          </div>
          <h2 className="mr-2 text-lg font-semibold">{title}</h2>
          <Button asChild variant="outline" size="sm">
            <Link href={href({ date: null })}>Today</Link>
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <NativeSelect aria-label="Project" value={props.projectId} onChange={(e) => router.replace(href({ project: e.target.value || null }))} className="h-9 w-auto max-w-56">
              <option value="">All projects</option>
              {props.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Role" value={props.role} onChange={(e) => router.replace(href({ role: e.target.value || null }))} className="h-9 w-auto">
              <option value="">All roles</option>
              {FIELD_ROLES.map((r) => (
                <option key={r} value={r}>
                  {FIELD_ROLE_NAMES[r]}
                </option>
              ))}
            </NativeSelect>
            <div className="inline-flex rounded-md border bg-card p-0.5" role="group" aria-label="View">
              {(["day", "week", "month"] as const).map((v) => (
                <Link
                  key={v}
                  href={href({ view: v })}
                  aria-current={props.view === v ? "true" : undefined}
                  className={cn("rounded px-3 py-1 text-sm capitalize", props.view === v ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}
                >
                  {v}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Legend">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-success/30 bg-success-soft" /> Filled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-warning/40 bg-warning-soft" /> Partly filled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-destructive/30 bg-danger-soft" /> Unfilled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-dashed" /> Draft
          </span>
          {props.view === "week" && props.manageableProjectIds.length ? <span>· Drag a shift to another day to move it</span> : null}
          {pending ? <span>· Saving…</span> : null}
        </div>

        {props.view === "month" ? (
          <Card className="overflow-hidden">
            <div className="grid grid-cols-7 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="px-2 py-1.5">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const items = byDate.get(d) ?? [];
                const inMonth = isSameMonth(parseISO(d), parseISO(props.anchor));
                return (
                  <div key={d} className={cn("min-h-28 min-w-0 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-muted/30")}>
                    <Link
                      href={href({ view: "day", date: d })}
                      className={cn(
                        "mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs",
                        d === props.today ? "bg-brand font-semibold text-brand-foreground" : inMonth ? "" : "text-muted-foreground",
                      )}
                    >
                      {format(parseISO(d), "d")}
                    </Link>
                    <div className="grid gap-1">
                      {items.slice(0, 3).map((s) => (
                        <ShiftChip key={s.id} s={s} draggable={false} compact />
                      ))}
                      {items.length > 3 ? (
                        <Link href={href({ view: "day", date: d })} className="px-1 text-xs text-muted-foreground hover:text-foreground">
                          +{items.length - 3} more
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : props.view === "week" ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[760px] grid-cols-7 gap-2">
              {days.map((d) => {
                const items = byDate.get(d) ?? [];
                return (
                  <div
                    key={d}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes("text/shift-id")) {
                        e.preventDefault();
                        setDropTarget(d);
                      }
                    }}
                    onDragLeave={() => setDropTarget((t) => (t === d ? null : t))}
                    onDrop={(e) => onDrop(d, e)}
                    className={cn("min-h-80 min-w-0 rounded-xl border bg-card p-2", dropTarget === d && "ring-2 ring-brand/50")}
                  >
                    <Link href={href({ view: "day", date: d })} className="mb-2 flex items-baseline justify-between px-1">
                      <span className="text-xs font-medium text-muted-foreground">{format(parseISO(d), "EEE")}</span>
                      <span
                        className={cn(
                          "inline-flex size-6 items-center justify-center rounded-full text-sm font-semibold",
                          d === props.today && "bg-brand text-brand-foreground",
                        )}
                      >
                        {format(parseISO(d), "d")}
                      </span>
                    </Link>
                    <div className="grid gap-1.5">
                      {items.map((s) => (
                        <ShiftChip key={s.id} s={s} draggable={canDrag(s)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <DayList shifts={byDate.get(props.anchor) ?? []} />
        )}
      </div>

      <aside aria-labelledby="unfilled" className="grid content-start gap-2">
        <h2 id="unfilled" className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangleIcon className="size-4 text-warning" /> Unfilled · next 7 days
        </h2>
        {props.unfilled.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No unfilled shifts in the next 7 days.</p>
        ) : (
          <Card className="grid divide-y sm:grid-cols-2 sm:divide-y-0 2xl:grid-cols-1 2xl:divide-y">
            {props.unfilled.map((u) => (
              <Link key={u.id} href={`/dashboard/projects/${u.projectId}/shifts`} className="block px-3 py-2.5 text-sm hover:bg-accent">
                <p className="font-medium">
                  {u.open} × {u.role} · {formatInZone(u.startsAt, u.timezone, "EEE MMM d, h:mm a")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {u.projectName} · {u.locationName}
                </p>
              </Link>
            ))}
          </Card>
        )}
      </aside>
    </div>
  );
}

function DayList({ shifts }: { shifts: CalShift[] }) {
  if (shifts.length === 0) return <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">No shifts this day.</p>;
  const byLocation = new Map<string, CalShift[]>();
  for (const s of shifts) byLocation.set(`${s.projectName} — ${s.locationName}`, [...(byLocation.get(`${s.projectName} — ${s.locationName}`) ?? []), s]);
  return (
    <div className="grid gap-4">
      {[...byLocation.entries()].map(([label, items]) => (
        <section key={label}>
          <h3 className="mb-2 text-sm font-semibold">{label}</h3>
          <Card className="divide-y">
            {items.map((s) => (
              <Link key={s.id} href={`/dashboard/projects/${s.projectId}/shifts`} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-accent">
                <span className="w-40 font-medium tabular-nums">
                  {formatInZone(s.startsAt, s.timezone, "h:mm a")} – {formatInZone(s.endsAt, s.timezone, "h:mm a")}
                </span>
                <span className="flex-1">{FIELD_ROLE_NAMES[s.role as keyof typeof FIELD_ROLE_NAMES]}</span>
                <span className={cn("rounded-md border px-2 py-0.5 text-xs tabular-nums", coverageTone(s))}>
                  {s.confirmed}/{s.headcount} filled
                </span>
              </Link>
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}
