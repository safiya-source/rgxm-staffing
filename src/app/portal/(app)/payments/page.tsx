import { WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { PayReviewRequest } from "@/components/portal/pay-review-request";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatInZone, formatMinutes, formatMoney } from "@/lib/format";
import { formatRatePpm } from "@/server/domain/money";
import { CATEGORY_LABEL } from "@/server/domain/tax-engine";
import { getMyPayLines } from "@/server/queries/portal";
import { requireStaff } from "@/server/session";
import { getOrgSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Payments" };

type Tone = "neutral" | "info" | "brand" | "success" | "danger" | "warning";

/** What each state means to the person being paid. Sending a file to the bank isn't "paid". */
function statusOf(status: string, lastState: string | null, paidAt: Date | null): [string, Tone] {
  if (status === "paid") return [`Paid${paidAt ? ` ${formatInZone(paidAt, "UTC", "MMM d")}` : ""}`, "success"];
  if (status === "failed") return lastState === "returned" ? ["Payment returned · RGXM will retry", "danger"] : ["Payment didn't go through · RGXM will retry", "danger"];
  if (status === "exported") return [lastState === "submitted" ? "Sent to the bank" : "Being prepared for the bank", "brand"];
  if (status === "batched") return ["In a payment run", "brand"];
  if (status === "disputed") return ["Under review", "warning"];
  return ["Approved · awaiting payment", "info"];
}

const date = (d: string) => formatInZone(new Date(`${d}T12:00:00Z`), "UTC", "EEE MMM d, yyyy");

export default async function Page() {
  const viewer = await requireStaff();
  const [{ lines, reviews }, settings] = await Promise.all([getMyPayLines(viewer.staff!.id), getOrgSettings()]);
  const owed = lines.filter((r) => r.status !== "paid" && r.status !== "disputed");
  const year = new Date().getFullYear();
  const paidThisYear = lines.filter((r) => r.status === "paid" && r.paid_at && new Date(r.paid_at).getFullYear() === year);
  const currency = lines[0]?.currency ?? "CAD";
  const sum = (list: typeof lines) => list.reduce((n, r) => n + r.total_cents, 0);
  const terms = settings.paymentTerms?.approvedAt ? settings.paymentTerms : null;
  const openReviews = reviews.filter((r) => r.status === "open");

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-[22px] font-semibold">Payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">Each approved shift, allowance or bonus appears here with its fee, any tax and the total you&apos;re paid.</p>
        {terms?.description ? <p className="mt-2 text-sm text-muted-foreground">When you&apos;re paid: {terms.description}</p> : null}
      </div>
      {lines.length === 0 ? (
        <EmptyState icon={WalletIcon} title="No payments yet" description="After your first shift is approved, you'll see the amount and when it's paid." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Coming to you</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(sum(owed), currency)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Paid in {year}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(sum(paidThisYear), currency)}</p>
            </Card>
          </div>
          {openReviews.length ? (
            <Card className="grid gap-1 p-4 text-sm">
              <p className="font-medium">Your open review requests</p>
              {openReviews.map((r) => (
                <p key={r.id} className="text-muted-foreground">
                  {formatInZone(r.created_at, "America/Toronto", "MMM d")}: {r.message}
                </p>
              ))}
            </Card>
          ) : null}
          <Card className="divide-y">
            {lines.map((r) => {
              const [label, tone] = statusOf(r.status, r.last_state, r.paid_at);
              const hasOpenReview = openReviews.some((x) => x.payable_item_id === r.id);
              return (
                <div key={r.id} className="grid gap-2 px-4 py-3" data-testid="payment-row">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium">{date(r.service_date)}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {r.project_name} · {CATEGORY_LABEL[r.category] ?? r.category}
                      </p>
                    </div>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm tabular-nums">
                    <dt className="text-muted-foreground">
                      {r.category === "fee"
                        ? `${formatMinutes(r.payable_minutes)} × ${formatMoney(r.rate_cents, r.currency)}/h`
                        : r.category === "mileage"
                          ? `${r.quantity} km × $${Number(r.unit_rate).toFixed(2)}/km`
                          : (r.description ?? CATEGORY_LABEL[r.category])}
                    </dt>
                    <dd className="text-right">{formatMoney(r.base_cents, r.currency)}</dd>
                    {r.tax_status === "review_required" ? (
                      <>
                        <dt className="text-muted-foreground">Tax under review by RGXM Finance</dt>
                        <dd className="text-right text-muted-foreground">—</dd>
                      </>
                    ) : r.taxes.length ? (
                      r.taxes.map((t) => (
                        <div key={t.component} className="contents">
                          <dt className="text-muted-foreground">
                            {t.component} ({t.jurisdiction}) {formatRatePpm(t.ratePpm)}
                          </dt>
                          <dd className="text-right">{formatMoney(t.cents, r.currency)}</dd>
                        </div>
                      ))
                    ) : (
                      <>
                        <dt className="text-muted-foreground">No sales tax</dt>
                        <dd className="text-right">{formatMoney(0, r.currency)}</dd>
                      </>
                    )}
                    <dt className="font-medium">Total payable</dt>
                    <dd className="text-right font-semibold">{formatMoney(r.total_cents, r.currency)}</dd>
                  </dl>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{r.bill_number ? `Bill ${r.bill_number}` : "Not billed yet"}</span>
                    {hasOpenReview ? <span>Review requested</span> : <PayReviewRequest payableId={r.id} label="Tax details incorrect? Request a review." kind="tax" />}
                  </div>
                </div>
              );
            })}
          </Card>
        </>
      )}
      <Card className="grid gap-2 p-4">
        <p className="text-sm font-medium">Something wrong with a payment?</p>
        <PayReviewRequest payableId={null} label="Ask RGXM Finance to review it" kind="other" showKinds />
      </Card>
    </div>
  );
}
