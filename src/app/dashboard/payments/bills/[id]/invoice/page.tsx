import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceView } from "@/components/legal/invoice-view";
import { PrintButton } from "@/components/legal/print-button";
import { getInvoice, type InvoiceDocument } from "@/server/domain/invoices";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Invoice" };

export default async function BillInvoicePage({ params }: PageProps<"/dashboard/payments/bills/[id]/invoice">) {
  await requireInternal("payments.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const inv = await getInvoice(id);
  if (!inv) notFound();
  const doc = inv.document as InvoiceDocument;
  return (
    <div className="grid max-w-3xl gap-5">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/dashboard/payments/bills/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {inv.bill.billNumber}
        </Link>
        {doc.number ? <PrintButton label="Print or save" /> : null}
      </div>
      {doc.number ? (
        <InvoiceView doc={doc} />
      ) : (
        <p className="text-sm text-muted-foreground">{inv.bill.billNumber} was finalized before invoice documents were introduced, so there&apos;s no printable document. Its lines and amounts are on the bill page.</p>
      )}
    </div>
  );
}
