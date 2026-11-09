import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatInZone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listPayReviews } from "@/server/domain/billing";
import { requireInternal } from "@/server/session";
import { resolvePayReviewAction } from "../actions";

export const metadata: Metadata = { title: "Pay reviews" };

const KIND: Record<string, string> = { tax: "Tax details", amount: "Amount", hours: "Hours", other: "Other" };

export default async function PayReviewsPage({ searchParams }: PageProps<"/dashboard/payments/reviews">) {
  await requireInternal("payments.manage");
  const sp = await searchParams;
  const status = sp.status === "resolved" ? "resolved" : "open";
  const rows = await listPayReviews(status);
  return (
    <>
      <Link href="/dashboard/payments" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Payments
      </Link>
      <PageHeader title="Pay reviews" description="Requests from contractors who think their pay or tax is wrong. Correct the line (tax decision or adjustment) if needed, then record the outcome here." />
      <nav aria-label="Filter" className="mb-4 flex gap-1.5">
        {(["open", "resolved"] as const).map((k) => (
          <Link
            key={k}
            href={`/dashboard/payments/reviews?status=${k}`}
            className={cn("rounded-full border px-3 py-1 text-sm capitalize", status === k ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent")}
          >
            {k}
          </Link>
        ))}
      </nav>
      <div className="grid gap-3">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No {status} requests.</p> : null}
        {rows.map(({ r, name, billNumber }) => (
          <Card key={r.id}>
            <CardContent className="grid gap-2 pt-6 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/talent/${r.staffId}`} className="font-medium hover:underline">
                  {name}
                </Link>
                <Badge tone="info">{KIND[r.kind] ?? r.kind}</Badge>
                {billNumber && r.billId ? (
                  <Link href={`/dashboard/payments/bills/${r.billId}`} className="text-xs text-muted-foreground hover:underline">
                    {billNumber}
                  </Link>
                ) : null}
                <span className="text-xs text-muted-foreground">{formatInZone(r.createdAt, "America/Toronto", "MMM d, yyyy h:mm a")}</span>
              </div>
              <p className="whitespace-pre-wrap">{r.message}</p>
              {r.resolution ? <p className="text-muted-foreground">Outcome: {r.resolution}</p> : null}
              {r.status === "open" ? (
                <ActionForm action={resolvePayReviewAction} hidden={{ requestId: r.id }} submitLabel="Mark resolved">
                  <Input name="resolution" placeholder="What was done (shared with the contractor)" aria-label="Outcome" className="h-9 min-w-80 flex-1" required />
                </ActionForm>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
