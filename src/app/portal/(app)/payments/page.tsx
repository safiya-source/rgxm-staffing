import { WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatInZone, formatMinutes, formatMoney } from "@/lib/format";
import { getStaffPayments } from "@/server/queries/payments";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Payments" };

// What each status means to the person being paid.
const STATUS: Record<string, [string, "neutral" | "info" | "brand" | "success" | "danger" | "warning"]> = {
  pending: ["Approved · awaiting payment", "info"],
  batched: ["In a payment run", "brand"],
  exported: ["Being paid", "brand"],
  paid: ["Paid", "success"],
  failed: ["Payment issue · RGXM will contact you", "danger"],
  disputed: ["Under review", "warning"],
};

export default async function Page() {
  const viewer = await requireStaff();
  const rows = await getStaffPayments(viewer.staff!.id);
  const owed = rows.filter((r) => r.status !== "paid" && r.status !== "disputed");
  const year = new Date().getFullYear();
  const paidThisYear = rows.filter((r) => r.status === "paid" && r.paidAt && new Date(r.paidAt).getFullYear() === year);
  const currency = rows[0]?.currency ?? "CAD";
  const sum = (list: typeof rows) => list.reduce((n, r) => n + r.totalCents, 0);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-[22px] font-semibold">Payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pay for each shift appears here once RGXM approves your hours.</p>
      </div>
      {rows.length === 0 ? (
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
          <Card className="divide-y">
            {rows.map((r) => {
              const [label, tone] = STATUS[r.status] ?? [r.status, "neutral"];
              return (
                <div key={r.id} className="grid gap-1 px-4 py-3" data-testid="payment-row">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium">{formatInZone(new Date(`${r.serviceDate}T12:00:00Z`), "UTC", "EEE MMM d, yyyy")}</p>
                      <p className="truncate text-sm text-muted-foreground">{r.projectName}</p>
                    </div>
                    <p className="font-semibold tabular-nums">{formatMoney(r.totalCents, r.currency)}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground tabular-nums">
                      {formatMinutes(r.payableMinutes)} × {formatMoney(r.rateCents, r.currency)}/h
                    </span>
                    <Badge tone={tone}>
                      {label}
                      {r.status === "paid" && r.paidAt ? ` ${formatInZone(r.paidAt, "UTC", "MMM d")}` : ""}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </Card>
          <p className="text-xs text-muted-foreground">Questions about a payment? Message RGXM from the Messages tab.</p>
        </>
      )}
    </div>
  );
}
