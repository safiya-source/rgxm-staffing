import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getYearEndReview, listSnapshots } from "@/server/domain/t4a";
import { requireInternal } from "@/server/session";
import { createSnapshotAction, setIdentityReceivedAction, setSnapshotStatusAction, setYearEndDecisionAction } from "../actions";

export const metadata: Metadata = { title: "Year-end review" };

const SNAPSHOT_STATUS: Record<string, string> = { draft: "Draft", handed_off: "Handed to accountant", filed: "Filed" };

export default async function YearEndPage({ searchParams }: PageProps<"/dashboard/payments/t4a">) {
  await requireInternal("payments.manage");
  const sp = await searchParams;
  const thisYear = new Date().getFullYear();
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= thisYear ? Number(sp.year) : thisYear;
  const [review, snapshots] = await Promise.all([getYearEndReview(year), listSnapshots(year)]);
  const { rows } = review;
  const flagged = rows.filter((r) => r.overThreshold);
  const m = (c: number) => (c ? formatMoney(c) : "—");

  return (
    <>
      <Link href="/dashboard/payments" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Payments
      </Link>
      <PageHeader
        title={`Year-end review ${year}`}
        description="Totals for your accountant, from payments the bank confirmed (settled) in the calendar year, by settlement date. Categories, sales tax, returned payments and adjustments are kept separate."
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
      {review.amendmentReview ? (
        <p role="alert" className="mb-4 rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm text-warning">
          Totals changed after the last snapshot was handed to the accountant
          {review.removedSinceSnapshot.length ? ` (${review.removedSinceSnapshot.length} recipient(s) no longer appear)` : ""}. Review the rows marked &ldquo;Changed&rdquo;, take a new snapshot, and
          tell the accountant in case slips need amending.
        </p>
      ) : null}
      <p className="mb-4 max-w-4xl text-sm text-muted-foreground">
        {rows.length} contractor{rows.length === 1 ? "" : "s"} paid; {flagged.length} over the {formatMoney(review.threshold)} threshold your accountant should confirm. Box 048 candidates are fees
        before GST/HST, plus other categories only where the accountant approved that treatment (Settings → Tax &amp; accounting); anything undecided is listed separately. Nobody is
        excluded automatically, including incorporated contractors: record the accountant&apos;s decision. Crew never stores SINs: just record when the accountant has received what they need.
      </p>
      <Card className="mb-6 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Contractor</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead className="text-right">Meals / per diems</TableHead>
              <TableHead className="text-right">Mileage</TableHead>
              <TableHead className="text-right">Bonuses</TableHead>
              <TableHead className="text-right">Adjust. / reversals</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Net paid</TableHead>
              <TableHead className="text-right">Box 048 candidate</TableHead>
              <TableHead>Review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                  No settled contractor payments in {year}.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.staffId} className="align-top">
                  <TableCell>
                    <Link href={`/dashboard/talent/${r.staffId}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    {r.businessName ? <p className="text-xs text-muted-foreground">{r.businessName}</p> : null}
                    {r.possiblyIncorporated ? <p className="text-xs text-muted-foreground">BN {r.businessNumber}: accountant to check incorporation</p> : null}
                    {r.changedSinceSnapshot ? <Badge tone="warning">Changed since snapshot</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m(r.fees)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m(r.meals)} / {m(r.perDiems)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m(r.mileage)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(r.bonuses)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m(r.adjustments)} / {m(r.reversals)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m(r.tax)}
                    {r.reversedTax ? <span className="block text-xs text-muted-foreground">reversed {formatMoney(r.reversedTax)}</span> : null}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(r.netPaid)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.box048CandidateCents)}
                    {r.overThreshold ? <Badge tone="info">Over threshold</Badge> : null}
                    {r.undecided.map((u) => (
                      <span key={u.category} className="block text-xs text-warning">
                        {u.label} {formatMoney(u.cents)}: accountant to decide
                      </span>
                    ))}
                  </TableCell>
                  <TableCell className="min-w-64 text-xs">
                    <div className="grid gap-1">
                      <p>
                        Decision: <span className="font-medium">{r.decision === "include" ? "Include" : r.decision === "exclude" ? "Exclude" : "Not decided"}</span>
                        {r.decisionReason ? <span className="block text-muted-foreground">{r.decisionReason}</span> : null}
                      </p>
                      <p>
                        Tax identity with accountant:{" "}
                        <span className="font-medium">{r.identityReceivedAt ? `Yes (${formatInZone(r.identityReceivedAt, "America/Toronto", "MMM d")})` : "Not yet"}</span>
                      </p>
                      {r.missing.length ? <Badge tone="warning">Missing {r.missing.join(", ")}</Badge> : null}
                      <details>
                        <summary className="cursor-pointer text-muted-foreground">Record decision</summary>
                        <ActionForm action={setYearEndDecisionAction} hidden={{ year: String(year), staffId: r.staffId }} submitLabel="Save" className="mt-2">
                          <NativeSelect name="decision" defaultValue={r.decision ?? ""} aria-label="Decision" className="h-8 w-32">
                            <option value="">Not decided</option>
                            <option value="include">Include</option>
                            <option value="exclude">Exclude</option>
                          </NativeSelect>
                          <Input name="reason" placeholder="Reason (accountant's advice)" aria-label="Reason" className="h-8 w-56" />
                        </ActionForm>
                        <ActionForm
                          action={setIdentityReceivedAction}
                          hidden={{ year: String(year), staffId: r.staffId, received: r.identityReceivedAt ? "false" : "true" }}
                          submitLabel={r.identityReceivedAt ? "Clear" : "Accountant has it"}
                          variant="outline"
                          className="mt-2"
                        >
                          {!r.identityReceivedAt ? <Input name="note" placeholder="Note: never a SIN" aria-label="Note" className="h-8 w-48" /> : null}
                        </ActionForm>
                      </details>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Snapshots and hand-off</CardTitle>
          <CardDescription>A snapshot freezes these totals as handed to the accountant. Later changes are flagged above for amendment review.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {snapshots.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <p>
                <span className="font-medium">Version {s.version}</span> · {formatInZone(s.createdAt, "America/Toronto", "MMM d, yyyy h:mm a")} · <Badge tone={s.status === "draft" ? "outline" : "success"}>{SNAPSHOT_STATUS[s.status] ?? s.status}</Badge>
                {s.note ? <span className="block text-xs text-muted-foreground">{s.note}</span> : null}
              </p>
              {s.status === "draft" ? <ActionForm action={setSnapshotStatusAction} hidden={{ snapshotId: s.id, status: "handed_off" }} submitLabel="Mark handed to accountant" variant="outline" /> : null}
              {s.status === "handed_off" ? <ActionForm action={setSnapshotStatusAction} hidden={{ snapshotId: s.id, status: "filed" }} submitLabel="Mark filed" variant="outline" /> : null}
            </div>
          ))}
          <ActionForm action={createSnapshotAction} hidden={{ year: String(year) }} submitLabel="Take snapshot">
            <Input name="note" placeholder="Note (optional), e.g. first hand-off" aria-label="Snapshot note" className="h-9 min-w-72 flex-1" />
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
