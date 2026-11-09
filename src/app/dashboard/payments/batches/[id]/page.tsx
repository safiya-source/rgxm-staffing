import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMinutes, formatMoney } from "@/lib/format";
import { EXPORT_FORMAT_LABEL } from "@/server/domain/payment-exports";
import { BATCH_TYPE_LABEL } from "@/server/domain/pay-rules";
import { CATEGORY_LABEL } from "@/server/domain/tax-engine";
import { getBatchDetail } from "@/server/queries/payments";
import { requireInternal } from "@/server/session";
import { AttemptBadge, BatchActions, LineReconcile, SupersedeExport } from "./batch-actions";

export const metadata: Metadata = { title: "Payment batch" };

const TZ = "America/Toronto";

export default async function BatchPage({ params }: PageProps<"/dashboard/payments/batches/[id]">) {
  const viewer = await requireInternal("payments.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await getBatchDetail(id);
  if (!b) notFound();
  const shown = b.items.filter((i) => !["removed", "voided"].includes(i.state));
  const removed = b.items.filter((i) => ["removed", "voided"].includes(i.state));
  const liveExport = b.exports.find((e) => !e.e.supersededAt && e.e.purpose === "bank");
  const tax = shown.reduce((n, i) => n + i.taxCents, 0);

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
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-6">
        <div>
          <dt className="text-muted-foreground">Type</dt>
          <dd className="font-medium">{BATCH_TYPE_LABEL[b.type]}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Pay period</dt>
          <dd className="font-medium">{b.period ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total (incl. {formatMoney(tax, b.currency)} tax)</dt>
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
        <div>
          <dt className="text-muted-foreground">Sent to bank</dt>
          <dd className="font-medium">{b.submittedAt ? `${formatInZone(b.submittedAt, "UTC", "MMM d, yyyy")}${b.bankReference ? ` · ${b.bankReference}` : ""}` : "—"}</dd>
        </div>
      </dl>
      {b.status === "void" ? <p className="text-sm text-muted-foreground">Voided in Crew: {b.voidReason}</p> : null}
      {b.status === "paid" ? <p className="text-sm text-success">Reconciled{b.paidAt ? `: last settlement ${formatInZone(b.paidAt, "UTC", "MMMM d, yyyy")}` : ""}.</p> : null}
      {b.invalidations.length ? (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm text-warning">
          {b.invalidations.map((x, i) => (
            <p key={i}>
              Approval cancelled {formatInZone(x.at, TZ, "MMM d, h:mm a")}: {x.reason ?? "something changed after approval"}.
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Person / bill</TableHead>
                <TableHead>Line</TableHead>
                <TableHead className="text-right">Before tax</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Bank payment</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((i) => (
                <TableRow key={i.payableId}>
                  <TableCell>
                    <span className="font-medium">{i.staffName}</span>
                    {i.billId ? (
                      <Link href={`/dashboard/payments/bills/${i.billId}`} className="block text-xs text-muted-foreground hover:underline">
                        {i.billNumber}
                      </Link>
                    ) : (
                      <span className="block text-xs text-muted-foreground">Bill created at export</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {CATEGORY_LABEL[i.category] ?? i.category} · {i.serviceDate}
                    <span className="block text-xs text-muted-foreground">
                      {i.projectCode}
                      {i.category === "fee" ? ` · ${formatMinutes(i.payableMinutes)} @ ${formatMoney(i.rateCents, i.currency)}` : i.description ? ` · ${i.description}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.baseCents, i.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.taxCents, i.currency)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(i.amountCents, i.currency)}</TableCell>
                  <TableCell className="text-xs">
                    <AttemptBadge state={i.state} />
                    {i.paidAt ? <span className="block text-muted-foreground">Settled {formatInZone(i.paidAt, "UTC", "MMM d")}</span> : null}
                    {i.returnedAt ? <span className="block text-muted-foreground">Returned {formatInZone(i.returnedAt, "UTC", "MMM d")}</span> : null}
                    {i.bankReference ? <span className="block text-muted-foreground">Ref {i.bankReference}</span> : null}
                    {i.evidence ? <span className="block text-muted-foreground">Evidence: {i.evidence}</span> : null}
                    {i.failureReason && i.state !== "settled" ? <span className="block text-muted-foreground">{i.failureReason}</span> : null}
                  </TableCell>
                  <TableCell>{b.status === "exported" || (b.status === "paid" && i.state === "settled") ? <LineReconcile batchId={b.id} payableId={i.payableId} state={i.state} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {removed.length ? (
            <div className="border-t px-4 py-3 text-sm">
              <p className="mb-1 font-medium">Removed or voided</p>
              <ul className="grid gap-1 text-muted-foreground">
                {removed.map((i) => (
                  <li key={i.payableId}>
                    {i.staffName} · {i.serviceDate} · {formatMoney(i.amountCents, i.currency)} — {i.failureReason ?? (i.state === "voided" ? "batch voided" : "removed")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <div className="grid content-start gap-4">
          <BatchActions
            batch={{ id: b.id, status: b.status, type: b.type, isOwn: b.createdBy === viewer.userId, hasLiveExport: Boolean(liveExport), submitted: Boolean(b.submittedAt) }}
            items={shown.filter((i) => i.active).map((i) => ({ payableId: i.payableId, state: i.state, label: `${i.staffName} · ${CATEGORY_LABEL[i.category] ?? i.category} ${i.serviceDate} · ${formatMoney(i.amountCents, i.currency)}` }))}
          />
          <Card>
            <CardHeader>
              <CardTitle>Bank files</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {b.exports.length === 0 ? <p className="text-muted-foreground">Not exported yet.</p> : null}
              {b.exports.map(({ e, by }) => (
                <div key={e.id} className={e.supersededAt ? "text-muted-foreground" : undefined}>
                  <p className="font-medium">
                    {EXPORT_FORMAT_LABEL[e.format] ?? e.format} · {e.rowCount} rows {e.supersededAt ? "(voided)" : ""}
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
              {liveExport ? <SupersedeExport batchId={b.id} exportId={liveExport.e.id} canVoid={b.status === "exported" && !b.submittedAt} /> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
