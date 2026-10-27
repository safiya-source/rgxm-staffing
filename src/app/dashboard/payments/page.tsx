import type { Metadata } from "next";
import Link from "next/link";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { canAny } from "@/server/authz/permissions";
import { BATCH_TYPE_LABEL, payPeriodFor } from "@/server/domain/pay-rules";
import { getReadyPayables, listBatches } from "@/server/queries/payments";
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
  const [ready, batches] = await Promise.all([getReadyPayables(scope), canManage ? listBatches() : Promise.resolve([])]);
  const periods = [...new Map(ready.map((r) => [payPeriodFor(r.serviceDate).startsOn, payPeriodFor(r.serviceDate)])).values()].sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  return (
    <>
      <PageHeader title="Payments" description="Approved hours become payables. Finance batches them by pay type, exports a file for payment, then records what was paid." />
      <p className="-mt-2 mb-4 max-w-3xl text-sm text-muted-foreground">
        This platform doesn&apos;t send money. Exports are imported into your accounting or payroll system, and pay classification
        (contractor or employee) should be confirmed with your accountant. Payroll batches carry gross hours and pay only; deductions and
        vacation pay are calculated by the payroll provider.
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
        </nav>
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
