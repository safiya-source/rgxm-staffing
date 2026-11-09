import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMoney } from "@/lib/format";
import { approvedUnbilledWork, clientCostRollup, failedPayments, outstandingBills, projectCostReport, taxReviewQueue, unreconciledItems } from "@/server/domain/finance-reports";
import { CATEGORY_LABEL } from "@/server/domain/tax-engine";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Finance reports" };

const m = (v: unknown) => formatMoney(Number(v ?? 0));
const label = (c: unknown) => CATEGORY_LABEL[String(c)] ?? String(c);
const ATTEMPT: Record<string, string> = { failed: "Failed", returned: "Returned by bank", bank_cancelled: "Cancelled by bank", exported: "In bank file", submitted: "Sent to bank", settled: "Settled" };

function Empty({ cols, text }: { cols: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-6 text-center text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );
}

export default async function FinanceReportsPage() {
  await requireInternal("reports.finance");
  const [projects, unbilled, bills, failed, unreconciledRaw, reviews] = await Promise.all([projectCostReport(), approvedUnbilledWork(), outstandingBills(), failedPayments(), unreconciledItems(), taxReviewQueue()]);
  const clients = clientCostRollup(projects);
  const unreconciled = unreconciledRaw as (Record<string, unknown> & { legacy: boolean; ageDays: number | null })[];

  return (
    <>
      <PageHeader
        title="Finance reports"
        description="Costs come from approved work (bill lines), so they include work not yet paid. Demo data is excluded. Sales tax is split by whether RGXM recovers it, as set in Settings → Tax & accounting (unconfirmed until the accountant says)."
      />
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Badge tone={reviews.length ? "warning" : "success"}>{reviews.length} line(s) waiting for a Finance tax review</Badge>
        <Badge tone={failed.length ? "danger" : "success"}>{failed.length} failed or returned payment(s)</Badge>
        <Badge tone={unreconciled.length ? "warning" : "success"}>{unreconciled.length} unreconciled item(s)</Badge>
        <Link href="/dashboard/payments" className="text-muted-foreground underline-offset-4 hover:underline">
          Go to Payments
        </Link>
      </div>

      <div className="grid gap-6">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Project costs and budget variance</CardTitle>
            <CardDescription>Variance compares the budget with the pre-tax cost plus non-recoverable and unconfirmed tax.</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Meals / per diems</TableHead>
                <TableHead className="text-right">Mileage</TableHead>
                <TableHead className="text-right">Bonuses</TableHead>
                <TableHead className="text-right">Adjustments</TableHead>
                <TableHead className="text-right">Pre-tax</TableHead>
                <TableHead className="text-right">Tax: recoverable / not / unconfirmed</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.length === 0 ? <Empty cols={10} text="No project costs yet." /> : null}
              {projects.map((p) => (
                <TableRow key={p.projectId}>
                  <TableCell>
                    <Link href={`/dashboard/projects/${p.projectId}/budget`} className="font-medium hover:underline">
                      {p.code}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {p.name} · {p.client}
                    </span>
                    {p.taxReviews ? <Badge tone="warning">{p.taxReviews} tax review</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m(p.fees)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(p.meals)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(p.mileage)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(p.bonuses)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(p.adjustments)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{m(p.preTax)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {m(p.tax.recoverable)} / {m(p.tax.nonRecoverable)} / {m(p.tax.unconfirmed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.budget == null ? "—" : m(p.budget)}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${p.variance != null && p.variance < 0 ? "text-destructive" : ""}`}>{p.variance == null ? "—" : m(p.variance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Client costs</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead className="text-right">Pre-tax</TableHead>
                <TableHead className="text-right">Recoverable tax</TableHead>
                <TableHead className="text-right">Non-recoverable tax</TableHead>
                <TableHead className="text-right">Unconfirmed tax</TableHead>
                <TableHead className="text-right">Budgets</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 ? <Empty cols={7} text="No client costs yet." /> : null}
              {clients.map((c) => (
                <TableRow key={c.client}>
                  <TableCell className="font-medium">{c.client}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.projects}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(c.preTax)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(c.recoverable)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(c.nonRecoverable)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(c.unconfirmed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.budget ? m(c.budget) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Approved work not yet billed</CardTitle>
            <CardDescription>Bill lines that aren&apos;t on a finalized bill yet, plus compensation still waiting for approval.</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Contractor</TableHead>
                <TableHead>Line</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Before tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unbilled.lines.length === 0 && unbilled.pendingCompensation.length === 0 ? <Empty cols={5} text="Nothing unbilled." /> : null}
              {unbilled.lines.map((l) => (
                <TableRow key={String(l.id)}>
                  <TableCell>{String(l.name)}</TableCell>
                  <TableCell className="text-sm">
                    {label(l.category)} · {String(l.service_date).slice(0, 10)} · {String(l.project)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {String(l.status)}
                    {l.tax_status === "review_required" ? <Badge tone="warning">Tax review</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m(l.base_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(l.total_cents)}</TableCell>
                </TableRow>
              ))}
              {unbilled.pendingCompensation.map((c) => (
                <TableRow key={String(c.id)}>
                  <TableCell>{String(c.name)}</TableCell>
                  <TableCell className="text-sm">
                    {label(c.category)} · {String(c.work_date).slice(0, 10)} · {String(c.project)}
                  </TableCell>
                  <TableCell>
                    <Badge tone="outline">Awaiting approval</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m(c.amount_cents)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {unbilled.approvedWithoutLine.length ? (
            <p className="border-t px-4 py-3 text-sm text-destructive">
              {unbilled.approvedWithoutLine.length} approved timesheet(s) have no bill line ({unbilled.approvedWithoutLine.map((t) => `${String(t.name)} on ${String(t.project)}`).join("; ")}). Contact an administrator.
            </p>
          ) : null}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Outstanding bills</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Bill</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Settled</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Accounting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.length === 0 ? <Empty cols={7} text="No open bills." /> : null}
              {bills.map((b) => (
                <TableRow key={String(b.id)}>
                  <TableCell>
                    <Link href={`/dashboard/payments/bills/${String(b.id)}`} className="font-medium hover:underline">
                      {String(b.bill_number)}
                    </Link>
                  </TableCell>
                  <TableCell>{String(b.supplier)}</TableCell>
                  <TableCell className="text-sm">
                    {String(b.due_date).slice(0, 10)}
                    {b.terms_approved !== "true" ? <span className="block text-xs text-warning">Terms not approved</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m(b.total_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(b.settled_cents)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{m(b.outstanding_cents)}</TableCell>
                  <TableCell className="text-sm">{b.in_accounting ? "Exported" : "Not exported"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Failed and returned payments</CardTitle>
            <CardDescription>Waiting to be retried in a new batch, against the same bill.</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Contractor</TableHead>
                <TableHead>Line</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed.length === 0 ? <Empty cols={4} text="None." /> : null}
              {failed.map((f) => (
                <TableRow key={String(f.payable_id)}>
                  <TableCell>{String(f.name)}</TableCell>
                  <TableCell className="text-sm">
                    {label(f.category)} · {String(f.service_date).slice(0, 10)}
                    <span className="block text-xs text-muted-foreground">
                      {f.bill_number ? String(f.bill_number) : "No bill"} · batch {String(f.batch)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {ATTEMPT[String(f.state)] ?? String(f.state)}
                    {f.at ? ` ${formatInZone(f.at as string, "America/Toronto", "MMM d")}` : ""}
                    {f.failure_reason ? <span className="block text-xs text-muted-foreground">{String(f.failure_reason)}</span> : null}
                    {f.bank_reference ? <span className="block text-xs text-muted-foreground">Ref {String(f.bank_reference)}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m(f.total_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Unreconciled items</CardTitle>
            <CardDescription>Payments in a bank file or sent to the bank without a recorded outcome, and older settlements recorded without bank evidence (before reconciliation was tracked).</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Batch</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Days since export</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unreconciled.length === 0 ? <Empty cols={5} text="Everything is reconciled." /> : null}
              {unreconciled.map((u) => (
                <TableRow key={String(u.id)}>
                  <TableCell>
                    <Link href={`/dashboard/payments/batches/${String(u.batch_id)}`} className="font-medium hover:underline">
                      {String(u.batch)}
                    </Link>
                  </TableCell>
                  <TableCell>{String(u.name)}</TableCell>
                  <TableCell className="text-sm">{u.legacy ? <Badge tone="outline">Settled before evidence was recorded</Badge> : (ATTEMPT[String(u.state)] ?? String(u.state))}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.ageDays ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(u.amount_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
