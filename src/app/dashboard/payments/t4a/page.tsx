import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getT4aSummary } from "@/server/domain/t4a";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "T4A summary" };

export default async function T4aPage({ searchParams }: PageProps<"/dashboard/payments/t4a">) {
  await requireInternal("payments.manage");
  const sp = await searchParams;
  const thisYear = new Date().getFullYear();
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= thisYear ? Number(sp.year) : thisYear;
  const rows = await getT4aSummary(year);
  const slips = rows.filter((r) => r.slipRequired);
  const incomplete = slips.filter((r) => r.missing.length);
  const total = rows.reduce((n, r) => n + r.feesCents, 0);

  return (
    <>
      <Link href="/dashboard/payments" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Payments
      </Link>
      <PageHeader
        title={`T4A summary ${year}`}
        description="Fees paid to each contractor in the calendar year, by the date the payment was recorded. Give the CSV to your accountant to prepare T4A slips."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Year" className="flex gap-1.5">
          {[thisYear - 2, thisYear - 1, thisYear].filter((y) => y >= 2026).map((y) => (
            <Link
              key={y}
              href={`/dashboard/payments/t4a?year=${y}`}
              aria-current={y === year ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-sm", y === year ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent")}
            >
              {y}
            </Link>
          ))}
        </nav>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/payments/t4a?year=${year}`}>
            <DownloadIcon /> Download CSV for accountant
          </a>
        </Button>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        {rows.length} contractor{rows.length === 1 ? "" : "s"} paid {formatMoney(total)} before HST. {slips.length} {slips.length === 1 ? "is" : "are"} over the $500 T4A threshold
        {incomplete.length ? `, and ${incomplete.length} of them ${incomplete.length === 1 ? "is" : "are"} missing tax details` : ""}. The CSV contains full SINs: store it securely and delete it once filed.
        Your accountant should confirm the slip boxes and amounts.
      </p>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Contractor</TableHead>
              <TableHead>SIN / BN</TableHead>
              <TableHead className="text-right">Fees (before HST)</TableHead>
              <TableHead className="text-right">HST</TableHead>
              <TableHead className="text-right">Total paid</TableHead>
              <TableHead>T4A</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No contractor payments recorded in {year}.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.staffId}>
                  <TableCell>
                    <Link href={`/dashboard/talent/${r.staffId}`} className="font-medium hover:underline">
                      {r.legalName ?? `${r.firstName} ${r.lastName}`}
                    </Link>
                    {r.businessName ? <p className="text-xs text-muted-foreground">{r.businessName}</p> : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.sinLast3 ? `SIN ••• ••• ${r.sinLast3}` : r.businessNumber ? `BN ${r.businessNumber}` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.feesCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.hstCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.totalCents)}</TableCell>
                  <TableCell>
                    {!r.slipRequired ? (
                      <span className="text-sm text-muted-foreground">Under $500</span>
                    ) : r.missing.length ? (
                      <Badge tone="warning">Missing {r.missing.join(", ")}</Badge>
                    ) : (
                      <Badge tone="success">Ready</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
