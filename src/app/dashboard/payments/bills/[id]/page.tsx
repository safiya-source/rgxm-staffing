import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/app/action-form";
import { DemoBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMoney } from "@/lib/format";
import { formatRatePpm } from "@/server/domain/money";
import { CATEGORY_LABEL } from "@/server/domain/tax-engine";
import { getBillDetail } from "@/server/queries/payments";
import { requireInternal } from "@/server/session";
import { createAdjustmentAction, recordInvoiceAction, resolveInvoiceAction } from "../../actions";
import { AttemptBadge } from "../../batches/[id]/batch-actions";

export const metadata: Metadata = { title: "Bill" };

const INVOICE_STATUS: Record<string, [string, "success" | "warning" | "neutral"]> = {
  matched: ["Matches the bill", "success"],
  variance_review: ["Differs: review", "warning"],
  unmatched: ["Not matched", "warning"],
  resolved: ["Resolved", "neutral"],
};

export default async function BillPage({ params }: PageProps<"/dashboard/payments/bills/[id]">) {
  await requireInternal("payments.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await getBillDetail(id);
  if (!b) notFound();
  const terms = b.termsSnapshot as { approved?: boolean; note?: string; description?: string | null };

  return (
    <div className="grid gap-6">
      <Link href="/dashboard/payments/bills" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Bills
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{b.billNumber}</h1>
        <Badge tone={b.status === "paid" ? "success" : b.status === "void" ? "outline" : "info"}>{b.status === "paid" ? "Paid" : b.status === "void" ? "Void" : "Open"}</Badge>
        {b.kind === "credit" ? <Badge tone="warning">Credit</Badge> : null}
        {b.isDemo ? <DemoBadge /> : null}
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-6">
        <div>
          <dt className="text-muted-foreground">Contractor</dt>
          <dd className="font-medium">
            <Link href={`/dashboard/talent/${b.staffId}`} className="hover:underline">
              {b.staffName}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Supplier</dt>
          <dd className="font-medium">
            {b.supplier.displayName}
            <span className="block text-xs font-normal text-muted-foreground">
              {b.supplier.supplierRef}
              {b.supplier.externalId ? ` · ${b.supplier.externalId}` : " · not matched in accounting yet"}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Bill date</dt>
          <dd className="font-medium">{b.billDate}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Due</dt>
          <dd className="font-medium">
            {b.dueDate}
            {!terms.approved ? <span className="block text-xs font-normal text-warning">No RGXM-approved terms when finalized</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Before tax / tax</dt>
          <dd className="font-medium tabular-nums">
            {formatMoney(b.subtotalCents, b.currency)} / {formatMoney(b.taxCents, b.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-medium tabular-nums">{formatMoney(b.totalCents, b.currency)}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        Accounting: {b.accounting.length ? b.accounting.map((a) => `${a.reference} (${a.active ? a.status : "rejected, freed"})`).join(", ") : "not exported yet"}. A finalized bill never changes; correct a line with an adjustment, which goes on the contractor&apos;s next bill.
      </p>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Line</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Before tax</TableHead>
              <TableHead>Tax</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Payment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {b.lines.map((l) => {
              const tax = b.taxLines.filter((t) => t.payableItemId === l.id);
              const attempts = b.attempts.filter((a) => a.payableId === l.id);
              const adjustments = b.adjustments.filter((a) => a.adjustsPayableId === l.id);
              return (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="text-sm">
                    <span className="font-medium">{CATEGORY_LABEL[l.category] ?? l.category}</span> · {l.serviceDate} · {l.projectCode}
                    {l.description ? <span className="block text-xs text-muted-foreground">{l.description}</span> : null}
                    {l.adjustsPayableId ? <span className="block text-xs text-muted-foreground">Corrects an earlier line</span> : null}
                    {adjustments.map((a) => (
                      <span key={a.id} className="block text-xs text-warning">
                        Adjusted {formatMoney(a.totalCents)} {a.billNumber ? `on ${a.billNumber}` : "(not billed yet)"}
                      </span>
                    ))}
                    {l.status !== "void" ? (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Add an adjustment or credit</summary>
                        <ActionForm action={createAdjustmentAction} hidden={{ payableId: l.id }} submitLabel="Add adjustment" className="mt-2">
                          <Input name="amount" placeholder="-25.00 for a credit" aria-label="Amount before tax" className="h-8 w-36" required />
                          <Input name="reason" placeholder="Reason" aria-label="Reason" className="h-8 min-w-56" required />
                        </ActionForm>
                        <p className="mt-1 text-muted-foreground">Tax follows this line&apos;s tax. The original stays as it is.</p>
                      </details>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {l.quantity ?? "—"} {l.unit ?? ""}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{l.unitRate != null ? `$${l.unitRate.replace(/(\.\d\d)00$/, "$1")}` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.baseCents, b.currency)}</TableCell>
                  <TableCell className="max-w-72 text-xs">
                    {tax.length ? (
                      tax.map((t) => (
                        <span key={t.id} className="block">
                          {t.component} {formatRatePpm(t.ratePpm)} ({t.jurisdiction}) {formatMoney(t.taxCents, b.currency)}
                          <span className="block text-muted-foreground">{t.basis}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">{l.taxBasis ?? "No tax"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(l.totalCents, b.currency)}</TableCell>
                  <TableCell className="text-xs">
                    {attempts.map((a, i) => (
                      <span key={i} className="mb-1 block">
                        <Link href={`/dashboard/payments/batches/${a.batchId}`} className="hover:underline">
                          {a.reference}
                        </Link>{" "}
                        <AttemptBadge state={a.state} />
                        {a.paidAt ? <span className="block text-muted-foreground">Settled {formatInZone(a.paidAt, "UTC", "MMM d, yyyy")}</span> : null}
                        {a.failureReason && a.state !== "settled" ? <span className="block text-muted-foreground">{a.failureReason}</span> : null}
                      </span>
                    ))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contractor invoices</CardTitle>
          <CardDescription>If the contractor sent an invoice, record its totals. Crew compares them with this bill and flags any difference (especially tax) for review; nothing changes automatically.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          {b.invoices.map((inv) => {
            const [label, tone] = INVOICE_STATUS[inv.status] ?? [inv.status, "neutral"];
            return (
              <div key={inv.id} className="grid gap-1 rounded-lg border p-3">
                <p>
                  <span className="font-medium">{inv.invoiceNumber}</span> · {inv.invoiceDate} · {formatMoney(inv.subtotalCents, b.currency)} + tax {formatMoney(inv.taxCents, b.currency)} <Badge tone={tone}>{label}</Badge>
                </p>
                {inv.status === "variance_review" ? (
                  <p className="text-xs text-warning">
                    Bill has {formatMoney(inv.expectedSubtotalCents ?? 0, b.currency)} + tax {formatMoney(inv.expectedTaxCents ?? 0, b.currency)}.
                  </p>
                ) : null}
                {inv.resolutionNote ? <p className="text-xs text-muted-foreground">Resolved: {inv.resolutionNote}</p> : null}
                {inv.status === "variance_review" || inv.status === "unmatched" ? (
                  <ActionForm action={resolveInvoiceAction} hidden={{ invoiceId: inv.id }} submitLabel="Mark resolved">
                    <Input name="note" placeholder="How it was resolved" aria-label="Resolution" className="h-9 min-w-72 flex-1" required />
                  </ActionForm>
                ) : null}
              </div>
            );
          })}
          <ActionForm action={recordInvoiceAction} hidden={{ billId: b.id, staffId: b.staffId }} submitLabel="Record invoice">
            <Input name="invoiceNumber" placeholder="Invoice number" aria-label="Invoice number" className="h-9 w-40" required />
            <Input name="invoiceDate" type="date" aria-label="Invoice date" className="h-9 w-40" required />
            <Input name="subtotal" placeholder="Subtotal, e.g. 200.00" aria-label="Subtotal" className="h-9 w-40" required />
            <Input name="tax" placeholder="Tax, e.g. 26.00" aria-label="Tax" className="h-9 w-36" />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
