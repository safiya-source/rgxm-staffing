import type { Metadata } from "next";
import { ActionForm } from "@/components/app/action-form";
import { Badge } from "@/components/ui/badge";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatRatePpm } from "@/server/domain/money";
import { CATEGORY_LABEL } from "@/server/domain/tax-engine";
import { getOrgSettings } from "@/server/settings";
import { overrideLineTaxAction } from "./actions";
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
import { ReadyToPay } from "./ready-to-pay";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: PageProps<"/dashboard/payments">) {
  const viewer = await requireInternal("payments.view");
  const actor = toActor(viewer);
  const canManage = canAny(actor, "payments.manage");
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
      <PageHeader
        title="Payments"
        description="Approved hours and compensation become bill lines. Finance batches them (a second person approves), exports a bank file, then records what the bank confirmed."
      />
      <p className="-mt-2 mb-4 max-w-3xl text-sm text-muted-foreground">
        Crew doesn&apos;t send money, and exporting a file never marks anything paid. Bills go to your accounting system separately (Accounting exports).
        Sales tax is added per line only where the accountant-approved rules apply; anything else waits for a Finance decision below.
      </p>
      <p className="mb-4 max-w-3xl text-sm">
        <span className="font-medium">Payment terms: </span>
        {termsApproved ? (
          <>
            due {terms.dueDaysAfterBillDate} days after the bill date
            {terms.cutoffDaysAfterPeriodEnd != null ? `; work approved within ${terms.cutoffDaysAfterPeriodEnd} days after a pay period ends is paid with that period` : ""}
            {terms.description ? `. ${terms.description}` : ""}.
          </>
        ) : (
          <span className="text-warning">not approved by RGXM yet. Bills show the bill date as the due date until terms are set in Settings → Contractors &amp; legal.</span>
        )}
      </p>
      {canManage ? (
        <nav aria-label="Payment views" className="mb-4 flex gap-1.5">
          {[
            ["ready", `Ready to pay (${ready.length})`],
            ["batches", "Batches"],
          ].map(([k, label]) => (
            <Link
              key={k}
              href={`/dashboard/payments?tab=${k}`}
              aria-current={tab === k ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-sm", tab === k ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent")}
            >
              {label}
            </Link>
          ))}
          {[
            ["/dashboard/payments/bills", "Bills"],
            ["/dashboard/payments/accounting", "Accounting exports"],
            ["/dashboard/payments/reviews", "Pay reviews"],
            ["/dashboard/payments/t4a", "Year-end"],
            ["/dashboard/reports/finance", "Finance reports"],
          ].map(([href, label]) => (
            <Link key={href} href={href!} className="rounded-full border bg-card px-3 py-1 text-sm hover:bg-accent">
              {label}
            </Link>
          ))}
        </nav>
      ) : null}

      {tab === "ready" && review.length ? (
        <Card className="mb-6 overflow-hidden border-warning/40">
          <CardHeader>
            <CardTitle>Needs Finance tax review ({review.length})</CardTitle>
            <CardDescription>
              Crew couldn&apos;t apply an approved rule to these lines (for example, the contractor&apos;s GST/HST status isn&apos;t verified, or the project is offsite). Decide the tax for
              each, choosing from the configured rules, with a reason. Verifying the contractor&apos;s registration and then using Refresh pay details also works.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {review.map((r) => (
              <div key={r.id} className="grid gap-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <Link href={`/dashboard/talent/${r.staffId}`} className="font-medium hover:underline">
                      {r.staffName}
                    </Link>{" "}
                    · {CATEGORY_LABEL[r.category] ?? r.category} · {r.serviceDate} · {r.projectCode} · {formatMoney(r.baseCents, r.currency)} before tax {r.isDemo ? <DemoBadge /> : null}
                  </p>
                  <Badge tone="warning">Tax review</Badge>
                </div>
                <p className="text-muted-foreground">{r.taxBasis}</p>
                {canManage ? (
                  <ActionForm action={overrideLineTaxAction} hidden={{ payableId: r.id }} submitLabel="Record tax decision">
                    <fieldset className="flex flex-wrap gap-3">
                      <legend className="sr-only">Tax rules to apply</legend>
                      {rules.map((t) => (
                        <label key={t.id} className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" name="ruleId" value={t.id} />
                          {t.component} {formatRatePpm(t.ratePpm)} ({t.jurisdiction}){t.status === "draft" ? " · draft" : ""}
                          {t.serviceCategory ? ` · ${t.serviceCategory}` : ""}
                        </label>
                      ))}
                      <span className="text-xs text-muted-foreground">Tick none for no tax.</span>
                    </fieldset>
                    <Input name="reason" placeholder="Reason (e.g. accountant advice, registration checked)" aria-label="Reason" className="h-9 min-w-72 flex-1" required />
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {tab === "ready" ? (
        <ReadyToPay
          canManage={canManage}
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
