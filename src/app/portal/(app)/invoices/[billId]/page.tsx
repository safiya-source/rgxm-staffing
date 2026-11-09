import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceView } from "@/components/legal/invoice-view";
import { PrintButton } from "@/components/legal/print-button";
import { PayReviewRequest } from "@/components/portal/pay-review-request";
import { Badge } from "@/components/ui/badge";
import { getInvoice, type InvoiceDocument } from "@/server/domain/invoices";
import { getOrgSettings } from "@/server/settings";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/portal/invoices/[billId]">) {
  const viewer = await requireStaff();
  const { billId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(billId)) notFound();
  const inv = await getInvoice(billId, { staffId: viewer.staff!.id });
  if (!inv || inv.bill.invoiceKind !== "self_billed") notFound();
  const settings = await getOrgSettings();
  const doc = inv.document as InvoiceDocument;
  const status = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {inv.bill.status === "paid" ? <Badge tone="success">Paid</Badge> : <Badge tone="neutral">Not paid yet</Badge>}
      {inv.adjustments.length ? (
        <span className="text-muted-foreground">
          Adjusted on{" "}
          {inv.adjustments.map((a, i) => (
            <span key={a.billId}>
              {i ? ", " : ""}
              <Link href={`/portal/invoices/${a.billId}`} className="underline underline-offset-2">
                {a.billNumber}
              </Link>
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/portal/invoices" className="text-sm text-muted-foreground hover:text-foreground">
          ← My invoices
        </Link>
        <PrintButton label="Print or save" />
      </div>
      <InvoiceView doc={doc} status={status} />
      <section className="grid gap-3 rounded-xl border bg-card p-4 print:hidden">
        <h2 className="font-medium">Something wrong?</h2>
        <PayReviewRequest payableId={null} billId={billId} label="Report a discrepancy to RGXM Finance" kind="amount" showKinds />
        <p className="text-xs text-muted-foreground">
          This invoice is a record of your approved work: there&apos;s nothing to approve, and it never delays payment. If something&apos;s wrong, RGXM investigates and issues
          a linked adjustment where needed. Please don&apos;t send a separate invoice for this work{settings.financeEmail ? `; questions to ${settings.financeEmail}` : ""}.
        </p>
      </section>
    </div>
  );
}
