// The printed contractor invoice / bill, rendered from the document frozen at issue.
import { formatMoney } from "@/lib/format";
import { formatRatePpm } from "@/server/domain/money";
import type { InvoiceDocument } from "@/server/domain/invoices";

const UNIT: Record<string, string> = { hour: "h", km: "km", meal: "meal", day: "day", each: "" };

function Party({ label, name, lines }: { label: string; name: string; lines: (string | null)[] }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-medium">{name}</p>
      {lines.filter(Boolean).map((l) => (
        <p key={l} className="text-sm text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  );
}

export function InvoiceView({ doc, status }: { doc: InvoiceDocument; status?: React.ReactNode }) {
  const money = (c: number) => formatMoney(c, doc.currency);
  const sameDay = doc.serviceDates.from === doc.serviceDates.to;
  return (
    <article className="grid gap-6 rounded-xl border bg-card p-5 text-[15px] print:border-0 print:p-0">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold">{doc.title}</h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
          <dt className="text-muted-foreground">Invoice number</dt>
          <dd className="font-mono">{doc.number}</dd>
          <dt className="text-muted-foreground">Issue date</dt>
          <dd>{doc.issueDate}</dd>
          <dt className="text-muted-foreground">Service dates</dt>
          <dd>{sameDay ? doc.serviceDates.from : `${doc.serviceDates.from} to ${doc.serviceDates.to}`}</dd>
          <dt className="text-muted-foreground">Due date</dt>
          <dd>{doc.dueDate}</dd>
        </dl>
        {status ? <div className="mt-2 print:hidden">{status}</div> : null}
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Party
          label="Supplier"
          name={doc.supplier.name}
          lines={[
            doc.supplier.businessName && doc.supplier.legalName && doc.supplier.businessName !== doc.supplier.legalName ? `Legal name: ${doc.supplier.legalName}` : null,
            doc.supplier.address,
            doc.supplier.gstHstNumber ? `GST/HST registration: ${doc.supplier.gstHstNumber}` : "Not registered for GST/HST",
            doc.supplier.businessNumber ? `Business number: ${doc.supplier.businessNumber}` : null,
          ]}
        />
        <Party label="Customer" name={doc.customer.name} lines={[doc.customer.address]} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 pr-3 text-right font-medium">Qty</th>
              <th className="py-2 pr-3 text-right font-medium">Rate</th>
              <th className="py-2 pr-3 text-right font-medium">Amount</th>
              <th className="py-2 text-right font-medium">Tax</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id} className="border-b align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{l.date}</td>
                <td className="py-2 pr-3">
                  <span className="font-medium">{l.categoryLabel}</span>
                  {l.description ? <span className="block text-muted-foreground">{l.description}</span> : null}
                  <span className="block text-xs text-muted-foreground">
                    {l.project.code} · {l.project.name}
                    {l.location ? ` · ${l.location.name}${l.location.address ? `, ${l.location.address}` : ""}` : ""}
                  </span>
                  {l.adjustsInvoice ? <span className="block text-xs text-muted-foreground">Adjusts invoice {l.adjustsInvoice}</span> : null}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                  {l.quantity != null ? `${Number(l.quantity)}${UNIT[l.unit ?? ""] ? ` ${UNIT[l.unit ?? ""]}` : ""}` : ""}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{l.unitRate != null && l.category !== "adjustment" ? (l.unit === "km" ? `$${Number(l.unitRate)}/km` : money(Math.round(Number(l.unitRate) * 100))) : ""}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(l.amountCents)}</td>
                <td className="py-2 text-right tabular-nums">
                  {l.taxes.length ? l.taxes.map((t) => <span key={t.component} className="block">{`${t.component} ${formatRatePpm(t.ratePpm)} ${money(t.taxCents)}`}</span>) : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt>Subtotal</dt>
        <dd className="text-right tabular-nums">{money(doc.subtotalCents)}</dd>
        {doc.taxes.map((t) => (
          <div key={`${t.component}-${t.jurisdiction}-${t.ratePpm}`} className="contents">
            <dt>
              {t.component} {formatRatePpm(t.ratePpm)} ({t.jurisdiction})
            </dt>
            <dd className="text-right tabular-nums">{money(t.taxCents)}</dd>
          </div>
        ))}
        {!doc.taxes.length ? (
          <>
            <dt>Sales tax</dt>
            <dd className="text-right tabular-nums">{money(0)}</dd>
          </>
        ) : null}
        <dt className="border-t pt-1 font-semibold">Total payable</dt>
        <dd className="border-t pt-1 text-right font-semibold tabular-nums">{money(doc.totalCents)}</dd>
      </dl>

      <section className="grid gap-1 text-sm">
        <p>
          <span className="font-medium">Payment terms: </span>
          {doc.terms.description ?? "As agreed with RGXM."} Due {doc.dueDate}.{doc.terms.approved ? "" : " (Payment terms not yet approved by RGXM.)"}
        </p>
        <p className="text-muted-foreground">This invoice records the amount payable. It isn&apos;t a confirmation of payment.</p>
        {doc.statement ? <p className="mt-2 border-t pt-2 font-medium">{doc.statement}</p> : null}
      </section>
    </article>
  );
}
