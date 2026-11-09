import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { DemoBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listBills } from "@/server/queries/payments";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Bills" };

const BILL_STATUS: Record<string, [string, "info" | "success" | "outline"]> = { open: ["Open", "info"], paid: ["Paid", "success"], void: ["Void", "outline"] };

export default async function BillsPage({ searchParams }: PageProps<"/dashboard/payments/bills">) {
  await requireInternal("payments.manage");
  const sp = await searchParams;
  const status = sp.status === "open" || sp.status === "paid" ? sp.status : null;
  const rows = await listBills({ status });
  return (
    <>
      <Link href="/dashboard/payments" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Payments
      </Link>
      <PageHeader
        title="Bills"
        description="One bill per contractor, finalized when a batch's bank file is first exported. Bill numbers never change; corrections are added as adjustment lines on a later bill."
      />
      <nav aria-label="Filter" className="mb-4 flex gap-1.5">
        {[
          [null, "All"],
          ["open", "Open"],
          ["paid", "Paid"],
        ].map(([k, label]) => (
          <Link
            key={label}
            href={k ? `/dashboard/payments/bills?status=${k}` : "/dashboard/payments/bills"}
            className={cn("rounded-full border px-3 py-1 text-sm", status === k ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Bill</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Bill date</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Accounting</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No bills yet. They&apos;re created when a batch&apos;s bank file is exported.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((b) => {
              const [label, tone] = BILL_STATUS[b.status] ?? [b.status, "outline"];
              return (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/dashboard/payments/bills/${b.id}`} className="font-medium hover:underline">
                      {b.billNumber}
                    </Link>{" "}
                    {b.kind === "credit" ? <Badge tone="warning">Credit</Badge> : null} {b.isDemo ? <DemoBadge /> : null}
                    {b.openInvoices ? <Badge tone="warning">Invoice differs</Badge> : null}
                    {b.invoiceKind === "self_billed" ? (
                      <span className="block text-xs text-muted-foreground">Contractor invoice (self-billed, issued on approval)</span>
                    ) : (
                      <span className="block text-xs text-muted-foreground">Internal bill · contractor sends their own invoice</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.supplier}
                    <span className="block text-xs text-muted-foreground">{b.supplierRef}</span>
                  </TableCell>
                  <TableCell className="text-sm">{b.billDate}</TableCell>
                  <TableCell className="text-sm">
                    {b.dueDate}
                    {!b.termsApproved ? <span className="block text-xs text-warning">Terms not approved</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(b.taxCents, b.currency)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(b.totalCents, b.currency)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{b.accounting ?? "Not exported"}</TableCell>
                  <TableCell>
                    <Badge tone={tone}>{label}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
