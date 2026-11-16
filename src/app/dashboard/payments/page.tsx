import type { Metadata } from "next";
import { getOrgSettings } from "@/server/settings";
import Link from "next/link";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { canAny } from "@/server/authz/permissions";
import { BATCH_TYPE_LABEL, payPeriodFor } from "@/server/domain/pay-rules";
import { getReadyPayables, listBatches, listChoosableTaxRules } from "@/server/queries/payments";
import { projectScope } from "@/server/queries/timesheets";
import { requireInternal, toActor } from "@/server/session";
import { torontoToday } from "@/server/domain/invoices";
import { ReadyToPay } from "./ready-to-pay";
import { TaxReview } from "./tax-review";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: PageProps<"/dashboard/payments">) {
  const viewer = await requireInternal("payments.view");
  const actor = toActor(viewer);
  const canManage = canAny(actor, "payments.manage");
  const canVerify = canAny(actor, "tax.verify_registration");
  const sp = await searchParams;
  const tab = sp.tab === "batches" && canManage ? "batches" : "ready";
  const scope = await projectScope(actor, "payments.view");
  const [all, batches, rules, settings] = await Promise.all([getReadyPayables(scope), canManage ? listBatches() : Promise.resolve([]), canManage ? listChoosableTaxRules() : Promise.resolve([]), getOrgSettings()]);
  const review = all.filter((r) => r.needsTaxReview);
  const ready = all.filter((r) => !r.needsTaxReview);
  const terms = settings.paymentTerms ?? {};
  const termsApproved = Boolean(terms.approvedAt && terms.dueDaysAfterBillDate != null);
  const periods = [...new Map(ready.map((r) => [payPeriodFor(r.serviceDate).startsOn, payPeriodFor(r.serviceDate)])).values()].sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  return (
    <>
      <PageHeader title="Payments" description="Approved hours, allowances and expenses become pay lines here. Settle GST/HST, batch the lines, have a second person approve, export the bank file, then record what the bank paid." />
      <details className="-mt-2 mb-4 max-w-3xl text-sm text-muted-foreground">
        <summary className="cursor-pointer">Good to know</summary>
        <p className="mt-1">
          Crew doesn&apos;t send money, and exporting a bank file never marks anything paid. Bills go to your accounting system separately (Accounting exports). HST is only added where
          the accountant-approved rules apply.
        </p>
      </details>
      <p className="mb-4 max-w-3xl text-sm">
        <span className="font-medium">Payment terms: </span>
        {termsApproved ? (
          <>
            due {terms.dueDaysAfterBillDate} days after the bill date
            {terms.cutoffDaysAfterPeriodEnd != null ? `; work approved within ${terms.cutoffDaysAfterPeriodEnd} days after a pay period ends is paid with that period` : ""}
            {terms.description ? `. ${terms.description}` : ""}.
          </>
        ) : (
          <span className="text-warning">
            not set yet, so bills are due on the bill date. Set them in <Link href="/dashboard/settings" className="underline">Settings</Link> → Contractors &amp; legal.
          </span>
        )}
      </p>
      {canManage ? (
        <nav aria-label="Payment views" className="mb-4 flex flex-wrap gap-1.5">
          {[
            ["ready", review.length ? `To pay (${ready.length} ready, ${review.length} waiting)` : `Ready to pay (${ready.length})`],
            ["batches", "Batches"],
          ].map(([k, label]) => (
            <Link
              key={k}
              href={`/dashboard/payments?tab=${k}`}
              aria-current={tab === k ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-sm", tab === k ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent")}
            >
              {label}
            </Link>
          ))}
          {[
            ["/dashboard/payments/bills", "Bills & invoices"],
            ["/dashboard/payments/accounting", "Accounting exports"],
            ["/dashboard/payments/reviews", "Pay reviews"],
            ["/dashboard/payments/t4a", "Year-end"],
            ["/dashboard/reports/finance", "Finance reports"],
          ].map(([href, label]) => (
            <Link key={href} href={href!} className="whitespace-nowrap rounded-full border bg-card px-3 py-1 text-sm hover:bg-accent">
              {label}
            </Link>
          ))}
        </nav>
      ) : null}

      {tab === "ready" && review.length ? <TaxReview lines={review} rules={rules} canDecide={canManage} canVerify={canVerify} today={torontoToday()} autoTax={Boolean(settings.autoTaxEnabled)} /> : null}

      {tab === "ready" && review.length ? <h2 className="mb-3 text-base font-semibold">Step 2: Ready to pay</h2> : null}
      {tab === "ready" ? (
        <ReadyToPay
          canManage={canManage}
          waitingOnTax={review.length}
          periods={periods}
          rows={ready.map((r) => ({
            id: r.id,
            staffName: r.staffName,
            projectCode: r.projectCode,
            serviceDate: r.serviceDate,
            role: r.role,
            payableMinutes: r.payableMinutes,
            rateCents: r.rateCents,
            totalCents: r.totalCents,
            taxCents: r.taxCents,
            category: r.category,
            description: r.description,
            billNumber: r.billNumber,
            currency: r.currency,
            status: r.status,
            isDemo: r.isDemo,
            batchType: r.batchType,
            needsClassification: r.needsClassification,
            hints: r.hints,
            staffId: r.staffId,
          }))}
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Batch</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Pay period</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created / approved</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No batches yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/dashboard/payments/batches/${b.id}`} className="font-medium hover:underline">
                      {b.reference}
                    </Link>{" "}
                    {b.isDemo ? <DemoBadge /> : null}
                    <p className="text-xs text-muted-foreground">{formatInZone(b.createdAt, "America/Toronto", "MMM d, yyyy")}</p>
                  </TableCell>
                  <TableCell>{BATCH_TYPE_LABEL[b.type]}</TableCell>
                  <TableCell className="text-muted-foreground">{b.period ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.items}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(b.totalCents, b.currency)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {b.createdBy ?? "—"} / {b.approvedBy ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="batch" status={b.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
