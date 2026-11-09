import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { PageHeader } from "@/components/app/page-header";
import { DemoBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/format";
import { billsReadyForAccounting, getAccountingConfig, listAccountingExports } from "@/server/domain/billing";
import { requireInternal } from "@/server/session";
import { setAccountingExportStatusAction } from "../actions";
import { GenerateAccountingExport } from "./generate-export";

export const metadata: Metadata = { title: "Accounting exports" };

const STATUS: Record<string, [string, "info" | "success" | "danger"]> = { generated: ["Generated · not confirmed", "info"], imported: ["Imported", "success"], rejected: ["Rejected", "danger"] };

export default async function AccountingPage() {
  await requireInternal("accounting.manage");
  const [ready, demoReady, exports, config] = await Promise.all([billsReadyForAccounting(), billsReadyForAccounting({ demo: true }), listAccountingExports(), getAccountingConfig()]);
  return (
    <>
      <Link href="/dashboard/payments" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Payments
      </Link>
      <PageHeader
        title="Accounting exports"
        description="Bills for your accounting system, separate from bank payment files. Each bill can be in only one live export, so it can't be imported twice. A failed bank payment never re-exports its bill."
      />
      {!config.validatedAt ? (
        <p role="status" className="mb-4 rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm text-warning">
          The file layout, account names and tax codes haven&apos;t been validated with RGXM&apos;s accounting system yet. Test an import with your accountant, then mark the format
          validated in Settings → Tax &amp; accounting.
        </p>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">
          Format validated{config.system ? ` for ${config.system}` : ""} on {config.validatedAt.slice(0, 10)}.
        </p>
      )}
      <div className="grid gap-6">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Bills ready for accounting ({ready.length})</CardTitle>
            <CardDescription>One row per bill line, with its project and client, account and tax code from Settings.</CardDescription>
          </CardHeader>
          {ready.length ? <GenerateAccountingExport bills={ready} /> : <p className="px-6 pb-6 text-sm text-muted-foreground">Nothing waiting. Bills appear here after a bank file is exported.</p>}
        </Card>
        {demoReady.length ? (
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Demo bills <DemoBadge />
              </CardTitle>
              <CardDescription>Exported separately and marked DO NOT IMPORT.</CardDescription>
            </CardHeader>
            <GenerateAccountingExport bills={demoReady} />
          </Card>
        ) : null}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Exports</CardTitle>
            <CardDescription>After importing, record whether it worked. A rejected file frees its bills to be exported again.</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Bills / rows</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {exports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No accounting exports yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {exports.map((e) => {
                const [label, tone] = STATUS[e.status] ?? [e.status, "info"];
                return (
                  <TableRow key={e.id} className="align-top">
                    <TableCell>
                      <a href={`/api/payments/accounting/${e.id}`} className="font-medium hover:underline">
                        {e.reference}
                      </a>{" "}
                      {e.isDemo ? <DemoBadge /> : null}
                      <p className="font-mono text-[11px] break-all text-muted-foreground">{e.sha256.slice(0, 16)}…</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.billCount} / {e.rowCount}
                    </TableCell>
                    <TableCell className="text-sm">{formatInZone(e.createdAt, "America/Toronto", "MMM d, yyyy h:mm a")}</TableCell>
                    <TableCell>
                      <Badge tone={tone}>{label}</Badge>
                      {e.statusNote ? <p className="mt-1 text-xs text-muted-foreground">{e.statusNote}</p> : null}
                    </TableCell>
                    <TableCell>
                      {e.status === "generated" ? (
                        <div className="grid gap-2">
                          <ActionForm action={setAccountingExportStatusAction} hidden={{ exportId: e.id, status: "imported" }} submitLabel="Imported OK" variant="outline">
                            <Input name="note" placeholder="Note (optional)" aria-label="Note" className="h-8 w-44" />
                          </ActionForm>
                          <ActionForm action={setAccountingExportStatusAction} hidden={{ exportId: e.id, status: "rejected" }} submitLabel="Rejected" variant="outline">
                            <Input name="note" placeholder="Why it was rejected" aria-label="Why rejected" className="h-8 w-44" required />
                          </ActionForm>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
