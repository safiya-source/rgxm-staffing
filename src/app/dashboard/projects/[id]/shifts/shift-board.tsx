"use client";
import { format, parseISO } from "date-fns";
import { CalendarPlusIcon, CopyIcon, MoreHorizontalIcon, PencilIcon, SendIcon, XCircleIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/ui/native-select";
import { formatInZone, formatMinutes, formatMoney, zoneAbbreviation } from "@/lib/format";
import { FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { utcToZoned } from "@/lib/time";
import { publishShiftsAction } from "../../actions";
import { BulkShiftDialog } from "./bulk-shift-dialog";
import { CancelShiftDialog, DuplicateShiftDialog, EditShiftDialog } from "./shift-dialogs";
import type { BreakPolicyOption, LocationOption, RequirementOption, ShiftItem, TemplateOption } from "./types";

export function ShiftBoard(props: {
  projectId: string;
  canManage: boolean;
  showRates: boolean;
  includeCancelled: boolean;
  locations: LocationOption[];
  requirements: RequirementOption[];
  templates: TemplateOption[];
  breakPolicies: BreakPolicyOption[];
  shifts: ShiftItem[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ShiftItem | null>(null);
  const [duplicating, setDuplicating] = useState<ShiftItem | null>(null);
  const [cancelling, setCancelling] = useState<ShiftItem | null>(null);
  const [locationId, setLocationId] = useState("");
  const [role, setRole] = useState<FieldRole | "">("");
  const [pending, start] = useTransition();

  const filtered = props.shifts.filter((s) => (!locationId || s.locationId === locationId) && (!role || s.role === role));
  const drafts = filtered.filter((s) => s.status === "draft");
  const groups = useMemo(() => {
    const m = new Map<string, ShiftItem[]>();
    for (const s of filtered) {
      const d = utcToZoned(new Date(s.startsAt), s.timezone).date;
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return [...m.entries()];
  }, [filtered]);

  if (props.locations.length === 0) {
    return (
      <EmptyState
        icon={CalendarPlusIcon}
        title="Add a location first"
        description="Shifts happen at a location, which sets their time zone."
        action={
          <Button asChild size="sm">
            <Link href={`/dashboard/projects/${props.projectId}/setup`}>Go to setup</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-9 w-auto">
          <option value="">All locations</option>
          {props.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as FieldRole | "")} className="h-9 w-auto">
          <option value="">All roles</option>
          {FIELD_ROLES.map((r) => (
            <option key={r} value={r}>
              {FIELD_ROLE_NAMES[r]}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={props.includeCancelled}
            onCheckedChange={(c) => router.replace(c ? `${pathname}?cancelled=1` : pathname, { scroll: false })}
          />
          Show cancelled
        </label>
        <div className="ml-auto flex gap-2">
          {props.canManage && drafts.length ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await publishShiftsAction(props.projectId, drafts.map((d) => d.id));
                  if (res.ok) toast.success(res.message ?? "Published");
                  else toast.error(res.error);
                  router.refresh();
                })
              }
            >
              <SendIcon /> Publish {drafts.length} draft{drafts.length === 1 ? "" : "s"}
            </Button>
          ) : null}
          {props.canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <CalendarPlusIcon /> Create shifts
            </Button>
          ) : null}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={CalendarPlusIcon}
          title="No shifts yet"
          description="Create shifts for each role and date. You can generate a whole run of dates at once."
        />
      ) : (
        groups.map(([date, items]) => (
          <section key={date} aria-label={format(parseISO(date), "EEEE, MMMM d")}>
            <h3 className="mb-2 text-sm font-semibold">
              {format(parseISO(date), "EEEE, MMMM d, yyyy")}
              <span className="ml-2 font-normal text-muted-foreground">
                {items.reduce((n, s) => n + s.confirmed, 0)}/{items.reduce((n, s) => n + s.headcount, 0)} filled
              </span>
            </h3>
            <Card className="divide-y">
              {items.map((s) => {
                const minutes = Math.round((new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000);
                const overnight = utcToZoned(new Date(s.endsAt), s.timezone).date !== date;
                const full = s.confirmed >= s.headcount;
                return (
                  <div key={s.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${s.status === "cancelled" ? "opacity-60" : ""}`}>
                    <div className="w-44 shrink-0">
                      <p className="font-medium tabular-nums">
                        {formatInZone(s.startsAt, s.timezone, "h:mm a")} – {formatInZone(s.endsAt, s.timezone, "h:mm a")}
                        {overnight ? <span className="ml-1 text-xs text-warning">+1 day</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatMinutes(minutes)} · {zoneAbbreviation(s.startsAt, s.timezone)}
                      </p>
                    </div>
                    <div className="min-w-40 flex-1">
                      <p className="text-sm font-medium">{FIELD_ROLE_NAMES[s.role]}</p>
                      <p className="text-xs text-muted-foreground">{s.locationName}</p>
                    </div>
                    <div className="w-28">
                      <Badge tone={s.status === "cancelled" ? "neutral" : full ? "success" : s.confirmed > 0 ? "warning" : "danger"}>
                        {s.confirmed}/{s.headcount} filled
                      </Badge>
                      {s.pending ? <p className="mt-1 text-xs text-muted-foreground">{s.pending} pending</p> : null}
                    </div>
                    {props.showRates ? (
                      <div className="w-20 text-right text-sm tabular-nums text-muted-foreground">{s.rateCents != null ? `${formatMoney(s.rateCents)}/h` : "No rate"}</div>
                    ) : null}
                    <div className="w-24">
                      <StatusBadge kind="shift" status={s.status} />
                    </div>
                    {props.canManage && s.status !== "cancelled" && s.status !== "completed" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Shift actions">
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(s)}>
                            <PencilIcon /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDuplicating(s)}>
                            <CopyIcon /> Duplicate to other dates
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setCancelling(s)} className="text-destructive focus:text-destructive">
                            <XCircleIcon /> Cancel shift
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="w-9" />
                    )}
                    {s.status === "cancelled" && s.cancelReason ? <p className="w-full text-xs text-muted-foreground">Cancelled: {s.cancelReason}</p> : null}
                  </div>
                );
              })}
            </Card>
          </section>
        ))
      )}

      {creating ? (
        <BulkShiftDialog
          projectId={props.projectId}
          locations={props.locations}
          requirements={props.requirements}
          templates={props.templates}
          breakPolicies={props.breakPolicies}
          showRates={props.showRates}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {editing ? <EditShiftDialog shift={editing} requirements={props.requirements} breakPolicies={props.breakPolicies} showRates={props.showRates} onClose={() => setEditing(null)} /> : null}
      {duplicating ? <DuplicateShiftDialog shift={duplicating} onClose={() => setDuplicating(null)} /> : null}
      {cancelling ? <CancelShiftDialog shift={cancelling} onClose={() => setCancelling(null)} /> : null}
    </div>
  );
}
