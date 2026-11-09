import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { listMyInvoices } from "@/server/domain/invoices";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "My invoices" };

export default async function InvoicesPage() {
  const viewer = await requireStaff();
  const invoices = await listMyInvoices(viewer.staff!.id);
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-[22px] font-semibold">My invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          RGXM creates these on your behalf automatically when your work is approved (Contractor Agreement section 7). They&apos;re for your records: there&apos;s nothing to approve, and you don&apos;t need to send your own invoice.
        </p>
      </div>
      {invoices.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {invoices.map((i) => (
            <li key={i.id}>
              <Link href={`/portal/invoices/${i.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent">
                <span>
                  <span className="block font-mono text-sm">{i.billNumber}</span>
                  <span className="block text-xs text-muted-foreground">
                    Issued {i.billDate} · due {i.dueDate}
                  </span>
                </span>
                <span className="grid justify-items-end gap-1">
                  <span className="font-medium tabular-nums">{formatMoney(i.totalCents, i.currency)}</span>
                  {i.status === "paid" ? <Badge tone="success">Paid</Badge> : <Badge tone="neutral">Not paid yet</Badge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No invoices yet. They appear here once RGXM has approved your work.</p>
      )}
    </div>
  );
}
