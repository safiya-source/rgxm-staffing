import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMinutes, formatMoney } from "@/lib/format";
import { EXPORT_FORMAT_LABEL, type ExportFormat } from "@/server/domain/payment-exports";
import { BATCH_TYPE_LABEL } from "@/server/domain/pay-rules";
import { getBatchDetail } from "@/server/queries/payments";
import { requireInternal } from "@/server/session";
import { BatchActions, SupersedeExport } from "./batch-actions";

export const metadata: Metadata = { title: "Payment batch" };

const TZ = "America/Toronto";

export default async function BatchPage({ params }: PageProps<"/dashboard/payments/batches/[id]">) {
  const viewer = await requireInternal("payments.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await getBatchDetail(id);
  if (!b) notFound();
  const active = b.items.filter((i) => i.active || i.paidAt);
  const removed = b.items.filter((i) => !i.active && !i.paidAt);
  const liveExport = b.exports.find((e) => !e.e.supersededAt);

  return (
    <div className="grid gap-6">
      <Link href="/dashboard/payments?tab=batches" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Batches
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{b.reference}</h1>
        <StatusBadge kind="batch" status={b.status} />
        {b.isDemo ? <DemoBadge /> : null}
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
        <div>
          <dt className="text-muted-foreground">Type</dt>
          <dd className="font-medium">{BATCH_TYPE_LABEL[b.type]}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Pay period</dt>
          <dd className="font-medium">{b.period ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-medium tabular-nums">{formatMoney(b.totalCents, b.currency)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Created by</dt>
          <dd className="font-medium">{b.createdByName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Approved by</dt>
          <dd className="font-medium">{b.approvedByName ?? "—"}</dd>
        </div>
      </dl>
      {b.status === "void" ? <p className="text-sm text-muted-foreground">Voided: {b.voidReason}</p> : null}
      {b.paidAt ? <p className="text-sm text-success">Paid {formatInZone(b.paidAt, "UTC", "MMMM d, yyyy")}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Person</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((i) => (
                <TableRow key={i.payableId}>
                  <TableCell className="font-medium">{i.staffName}</TableCell>
                  <TableCell className="text-sm">
                    {i.serviceDate} · {i.role}
                    <span className="block text-xs text-muted-foreground">{i.projectCode}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMinutes(i.payableMinutes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.rateCents, i.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.amountCents, i.currency)}</TableCell>
                  <TableCell>
                    <StatusBadge kind="payable" status={i.payableStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {removed.length ? (
            <div className="border-t px-4 py-3 text-sm">
              <p className="mb-1 font-medium">Removed or failed</p>
              <ul className="grid gap-1 text-muted-foreground">
                {removed.map((i) => (
                  <li key={i.payableId}>
                    {i.staffName} · {i.serviceDate} · {formatMoney(i.amountCents, i.currency)} — {i.failureReason ?? "removed"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <div className="grid content-start gap-4">
          <BatchActions
            batch={{ id: b.id, status: b.status, type: b.type, isOwn: b.createdBy === viewer.userId, hasLiveExport: Boolean(liveExport) }}
            items={active.filter((i) => i.active).map((i) => ({ payableId: i.payableId, label: `${i.staffName} · ${i.serviceDate} · ${formatMoney(i.amountCents, i.currency)}` }))}
          />
          <Card>
            <CardHeader>
              <CardTitle>Exports</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {b.exports.length === 0 ? <p className="text-muted-foreground">Not exported yet.</p> : null}
              {b.exports.map(({ e, by }) => (
                <div key={e.id} className={e.supersededAt ? "text-muted-foreground" : undefined}>
                  <p className="font-medium">
                    {EXPORT_FORMAT_LABEL[e.format as ExportFormat] ?? e.format} · {e.rowCount} rows {e.supersededAt ? "(voided)" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {by ?? "—"} · {formatInZone(e.createdAt, TZ, "MMM d, h:mm a")}
                  </p>
                  <p className="font-mono text-[11px] break-all text-muted-foreground" title="SHA-256 fingerprint">
                    {e.sha256}
                  </p>
                  {e.supersededReason ? <p className="text-xs">Voided: {e.supersededReason}</p> : null}
                  <a href={`/api/payments/exports/${e.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                    Download{e.supersededAt ? " (voided copy)" : ""}
                  </a>
                </div>
              ))}
              {liveExport ? <SupersedeExport batchId={b.id} exportId={liveExport.e.id} canVoid={b.status === "exported"} /> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
