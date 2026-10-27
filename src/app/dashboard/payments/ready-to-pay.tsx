"use client";
import { WalletIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/empty-state";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinutes, formatMoney } from "@/lib/format";
import { BATCH_TYPE_LABEL, ESA_HINT_LABEL, type BatchType, type EsaHint } from "@/server/domain/pay-rules";
import { createBatchAction, refreshClassificationsAction } from "./actions";

type Row = {
  id: string;
  staffId: string;
  staffName: string;
  projectCode: string;
  serviceDate: string;
  role: string;
  payableMinutes: number;
  rateCents: number;
  totalCents: number;
  currency: string;
  status: string;
  isDemo: boolean;
  batchType: BatchType | null;
  needsClassification: boolean;
  hints: EsaHint[];
};
type Period = { startsOn: string; endsOn: string; label: string };

function PayableTable({ rows, selected, onToggle, onToggleAll, showClassificationLink }: {
  rows: Row[];
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
  showClassificationLink?: boolean;
}) {
  const allOn = selected ? rows.every((r) => selected.has(r.id)) : false;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {selected ? (
            <TableHead className="w-10">
              <Checkbox aria-label="Select all in this section" checked={allOn} onCheckedChange={onToggleAll} />
            </TableHead>
          ) : null}
          <TableHead>Person</TableHead>
          <TableHead>Shift</TableHead>
          <TableHead className="text-right">Hours</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            {selected ? (
              <TableCell>
                <Checkbox aria-label={`Select ${r.staffName}, ${r.serviceDate}`} checked={selected.has(r.id)} onCheckedChange={() => onToggle?.(r.id)} />
              </TableCell>
            ) : null}
            <TableCell className="font-medium">
              {showClassificationLink ? (
                <Link href={`/dashboard/talent/${r.staffId}`} className="hover:underline">
                  {r.staffName}
                </Link>
              ) : (
                r.staffName
              )}
            </TableCell>
            <TableCell className="text-sm">
              {r.serviceDate} · {r.role}
              <span className="block text-xs text-muted-foreground">{r.projectCode}</span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMinutes(r.payableMinutes)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(r.rateCents, r.currency)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatMoney(r.totalCents, r.currency)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {r.isDemo ? <DemoBadge /> : null}
                {r.status === "failed" ? <StatusBadge kind="payable" status="failed" /> : null}
                {r.hints.map((h) => (
                  <Badge key={h} tone="warning" title="Review only: pay isn't changed automatically">
                    {ESA_HINT_LABEL[h]}
                  </Badge>
                ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BatchSection({ type, demo, rows, periods }: { type: BatchType; demo: boolean; rows: Row[]; periods: Period[] }) {
  const router = useRouter();
  const [period, setPeriod] = useState("");
  const [selected, setSelected] = useState(() => new Set(rows.map((r) => r.id)));
  const [pending, start] = useTransition();
  const p = periods.find((x) => x.startsOn === period);
  const eligible = rows.filter((r) => !p || r.serviceDate <= p.endsOn);
  const chosen = eligible.filter((r) => selected.has(r.id));
  const total = chosen.reduce((n, r) => n + r.totalCents, 0);
  const label = `${BATCH_TYPE_LABEL[type]}${demo ? " · demo data" : ""}`;

  return (
    <Card className="overflow-hidden" role="region" aria-label={label}>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            {BATCH_TYPE_LABEL[type]} {demo ? <DemoBadge /> : null}
          </CardTitle>
          <CardDescription>
            {rows.length} approved shift{rows.length === 1 ? "" : "s"} waiting.{demo ? " Demo items can only go into a demo batch; its export is marked DO NOT PAY." : ""}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Pay period
            <NativeSelect value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 w-48" aria-label={`Pay period for ${label}`}>
              <option value="">No specific period</option>
              {periods.map((x) => (
                <option key={x.startsOn} value={x.startsOn}>
                  {x.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button
            disabled={pending || chosen.length === 0}
            onClick={() =>
              start(async () => {
                const res = await createBatchAction({ type, periodDate: p?.startsOn ?? null, payableIds: chosen.map((r) => r.id) });
                if (res.ok) {
                  toast.success(res.message ?? "Batch created");
                  router.push(`/dashboard/payments/batches/${res.data!.batchId}`);
                } else toast.error(res.error);
              })
            }
          >
            Create batch · {chosen.length} · {formatMoney(total, rows[0]?.currency ?? "CAD")}
          </Button>
        </div>
      </CardHeader>
      <PayableTable
        rows={eligible}
        selected={selected}
        onToggle={(id) =>
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          })
        }
        onToggleAll={() => setSelected((s) => (eligible.every((r) => s.has(r.id)) ? new Set() : new Set(eligible.map((r) => r.id))))}
      />
      {p && eligible.length < rows.length ? (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">{rows.length - eligible.length} later shift(s) are hidden because they fall after this pay period.</p>
      ) : null}
    </Card>
  );
}

export function ReadyToPay({ rows, periods, canManage }: { rows: Row[]; periods: Period[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (rows.length === 0) return <EmptyState icon={WalletIcon} title="Nothing waiting to be paid" description="Approved hours show up here, ready to batch." />;
  if (!canManage) {
    return (
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Approved, not yet paid</CardTitle>
          <CardDescription>On your projects. Finance batches and pays these.</CardDescription>
        </CardHeader>
        <PayableTable rows={rows} />
      </Card>
    );
  }
  const unclassified = rows.filter((r) => r.needsClassification);
  const sections: { type: BatchType; demo: boolean; rows: Row[] }[] = [];
  for (const type of ["contractor", "payroll"] as const) {
    for (const demo of [false, true]) {
      const list = rows.filter((r) => r.batchType === type && r.isDemo === demo);
      if (list.length) sections.push({ type, demo, rows: list });
    }
  }
  return (
    <div className="grid gap-6">
      {unclassified.length ? (
        <Card className="overflow-hidden border-warning/40">
          <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Needs a pay classification</CardTitle>
              <CardDescription>
                These people are unset or were reclassified after approval. Set contractor or employee on their profile, then refresh.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await refreshClassificationsAction();
                  if (res.ok) {
                    toast.success(res.message ?? "Done");
                    router.refresh();
                  } else toast.error(res.error);
                })
              }
            >
              Refresh classifications
            </Button>
          </CardHeader>
          <PayableTable rows={unclassified} showClassificationLink />
        </Card>
      ) : null}
      {sections.map((s) => (
        <BatchSection key={`${s.type}-${s.demo}`} type={s.type} demo={s.demo} rows={s.rows} periods={periods} />
      ))}
    </div>
  );
}
