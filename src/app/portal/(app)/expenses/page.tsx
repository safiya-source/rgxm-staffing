import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { utcToZoned } from "@/lib/time";
import { claimableProjects, myExpenses } from "@/server/domain/expenses";
import { requireStaff } from "@/server/session";
import { getOrgSettings } from "@/server/settings";
import { ExpenseForm } from "./expense-form";

export const metadata: Metadata = { title: "Expenses" };

const STATUS: Record<string, [string, "warning" | "success" | "danger" | "outline" | "info"]> = {
  pending: ["Waiting for RGXM", "warning"],
  approved: ["Approved", "success"],
  rejected: ["Not approved", "danger"],
  void: ["Withdrawn", "outline"],
};

export default async function ExpensesPage() {
  const viewer = await requireStaff();
  const staffId = viewer.staff!.id;
  const [shifts, claims, settings] = await Promise.all([claimableProjects(staffId), myExpenses(staffId), getOrgSettings()]);
  const today = utcToZoned(new Date(), settings.defaultTimezone).date;
  return (
    <div className="grid gap-5">
      <Link href="/portal/payments" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Payments
      </Link>
      <div>
        <h1 className="text-[22px] font-semibold">Expenses</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bought something for RGXM with your own money? Submit it with the receipt. Once RGXM approves it, you&apos;re paid back the full amount with your next payment. No
          GST/HST is added to reimbursements.
        </p>
      </div>
      <Card className="p-4">
        <ExpenseForm
          today={today}
          shifts={shifts.map((s) => ({ bookingId: s.bookingId, projectId: s.projectId, projectName: s.projectName, label: `${s.date} · ${FIELD_ROLE_NAMES[s.role as FieldRole] ?? s.role}` }))}
        />
      </Card>
      <section aria-labelledby="my-claims" className="grid gap-2">
        <h2 id="my-claims" className="text-sm font-medium text-muted-foreground">
          Your claims
        </h2>
        {claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing submitted yet.</p>
        ) : (
          <Card className="divide-y">
            {claims.map((c) => {
              const [label, tone] = c.paymentStatus === "paid" ? (["Paid back", "success"] as const) : (STATUS[c.status] ?? [c.status, "outline"]);
              return (
                <div key={c.id} className="grid gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-medium">
                      {c.vendor} · {formatMoney(c.amountCents)}
                    </span>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {c.purchaseDate} · {c.projectName}
                  </p>
                  <p className="text-sm">{c.description}</p>
                  {c.status === "rejected" && c.decisionNote ? <p className="text-sm text-destructive">RGXM: {c.decisionNote}</p> : null}
                  <a href={`/api/expenses/${c.id}/receipt`} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-2">
                    View receipt
                  </a>
                </div>
              );
            })}
          </Card>
        )}
      </section>
    </div>
  );
}
