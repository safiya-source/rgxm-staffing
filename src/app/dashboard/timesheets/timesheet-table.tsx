"use client";
import { ClockIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMinutes } from "@/lib/format";
import { FLAG_LABEL, TIMESHEET_STATUS_LABEL, workedMinutes, type Flag, type TimesheetStatus } from "@/server/domain/attendance-rules";
import { bulkApproveAction } from "./actions";

type Row = {
  bookingId: string;
  bookingStatus: string;
  role: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  projectName: string;
  locationName: string;
  staffName: string;
  status: string;
  actualStart: string | null;
  actualEnd: string | null;
  workedStart: string | null;
  workedEnd: string | null;
  breakMinutes: number | null;
  payableMinutes: number | null;
  flags: string[];
};

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "brand" | "danger" | "outline"> = {
  not_started: "outline",
  in_progress: "info",
  submitted: "brand",
  needs_review: "warning",
  supervisor_verified: "info",
  approved: "success",
  locked: "success",
  exported: "neutral",
  paid: "neutral",
};

const APPROVABLE = ["in_progress", "submitted", "needs_review", "supervisor_verified"];

export function TimesheetTable({ rows, canApprove }: { rows: Row[]; canApprove: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const t = (iso: string | null, tz: string) => (iso ? formatInZone(iso, tz, "h:mm a") : "—");
  const approvable = rows.filter((r) => APPROVABLE.includes(r.status) && r.workedStart && r.workedEnd);

  if (!rows.length) return <EmptyState icon={ClockIcon} title="Nothing here" description="Timesheets appear once shifts start." />;

  return (
    <div className="grid gap-3">
      {canApprove && selected.length ? (
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-xs">
          <span className="font-medium">{selected.length} selected</span>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await bulkApproveAction(selected);
                if (res.ok) toast.success(res.message ?? "Approved");
                else toast.error(res.error);
                setSelected([]);
                router.refresh();
              })
            }
          >
            Approve worked hours
          </Button>
          <span className="text-xs text-muted-foreground">Payable time = worked time minus recorded breaks.</span>
        </div>
      ) : null}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {canApprove ? (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all approvable"
                    checked={approvable.length > 0 && approvable.every((r) => selected.includes(r.bookingId))}
                    onCheckedChange={(c) => setSelected(c ? approvable.map((r) => r.bookingId) : [])}
                  />
                </TableHead>
              ) : null}
              <TableHead>Person</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Checked in / out</TableHead>
              <TableHead>Worked</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const worked = r.workedStart && r.workedEnd ? workedMinutes(new Date(r.workedStart), new Date(r.workedEnd), r.breakMinutes ?? 0) : null;
              const status = r.bookingStatus === "no_show" ? "no_show" : r.status;
              return (
                <TableRow key={r.bookingId}>
                  {canApprove ? (
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${r.staffName}`}
                        disabled={!approvable.some((x) => x.bookingId === r.bookingId)}
                        checked={selected.includes(r.bookingId)}
                        onCheckedChange={(c) => setSelected((s) => (c ? [...s, r.bookingId] : s.filter((x) => x !== r.bookingId)))}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Link href={`/dashboard/timesheets/${r.bookingId}`} className="font-medium hover:underline">
                      {r.staffName}
                    </Link>
                    <p className="text-xs text-muted-foreground">{r.role}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatInZone(r.startsAt, r.timezone, "EEE MMM d")} · {t(r.startsAt, r.timezone)}–{t(r.endsAt, r.timezone)}
                    <p className="text-xs text-muted-foreground">
                      {r.projectName} · {r.locationName}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {t(r.actualStart, r.timezone)} / {t(r.actualEnd, r.timezone)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {r.payableMinutes != null ? (
                      <span className="font-medium">{formatMinutes(r.payableMinutes)} approved</span>
                    ) : worked != null ? (
                      <>
                        {formatMinutes(worked)}
                        {r.breakMinutes ? <span className="text-xs text-muted-foreground"> ({r.breakMinutes}m break)</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <Badge key={f} tone={f === "late" || f.startsWith("missing") || f === "outside_geofence" ? "warning" : "outline"}>
                          {FLAG_LABEL[f as Flag] ?? f}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {status === "no_show" ? <Badge tone="danger">No-show</Badge> : <Badge tone={STATUS_TONE[status]}>{TIMESHEET_STATUS_LABEL[status as TimesheetStatus]}</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
