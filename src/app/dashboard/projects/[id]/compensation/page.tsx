import type { Metadata } from "next";
import { ActionForm } from "@/components/app/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { canOnProject } from "@/server/authz/permissions";
import { compensableBookings, getCompensationSettings, listCompensation } from "@/server/domain/compensation";
import { CATEGORY_LABEL } from "@/server/domain/tax-engine";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { decideCompensationAction, voidCompensationAction } from "./actions";
import { RecordCompensationForm } from "./record-form";

export const metadata: Metadata = { title: "Allowances & bonuses" };

const STATUS_TONE = { pending: "warning", approved: "success", rejected: "danger", void: "outline" } as const;
const TAX_LABEL: Record<string, string> = { calculated: "Tax calculated", no_tax: "No tax", review_required: "Finance tax review", finance_override: "Set by Finance" };

export default async function CompensationPage({ params }: PageProps<"/dashboard/projects/[id]/compensation">) {
  const viewer = await requireInternal("project.view");
  const { id } = await params;
  const scope = (await loadProjectScopes([id])).get(id)!;
  const actor = toActor(viewer);
  const canRecord = canOnProject(actor, "compensation.record", scope);
  const canApprove = canOnProject(actor, "compensation.approve", scope);
  const [settings, items, bookings] = await Promise.all([getCompensationSettings(id), listCompensation(id), canRecord ? compensableBookings(id) : Promise.resolve([])]);
  const enabled = {
    meals: settings.mealsEnabled,
    perDiem: settings.perDiemEnabled,
    mileage: settings.mileageEnabled,
    bonus: settings.bonusEnabled,
  };
  const anyEnabled = Object.values(enabled).some(Boolean);

  return (
    <div className="grid gap-6">
      {canRecord ? (
        <Card>
          <CardHeader>
            <CardTitle>Record an allowance, mileage or bonus</CardTitle>
            <CardDescription>
              Each item is tied to one of the contractor&apos;s shifts and needs approval before it&apos;s paid. One breakfast, lunch and dinner allowance per contractor per
              day (across all shifts), and a full-day per diem can&apos;t be combined with meal allowances on the same day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {anyEnabled ? (
              <RecordCompensationForm
                projectId={id}
                enabled={enabled}
                bookings={bookings.map((b) => ({ value: `${b.bookingId}:${b.staffId}`, label: `${b.name} · ${b.role} · ${b.workDate}` }))}
                rates={{ breakfast: settings.breakfastCents, lunch: settings.lunchCents, dinner: settings.dinnerCents, perDiem: settings.perDiemCents, mileage: settings.mileageRate }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Nothing is switched on for this project yet. Turn categories on under Setup → Allowances, mileage &amp; bonuses.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Contractor</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No allowances, mileage or bonuses recorded.
                </TableCell>
              </TableRow>
            ) : (
              items.map((i) => (
                <TableRow key={i.id} className="align-top">
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell className="text-sm">{i.workDate}</TableCell>
                  <TableCell className="text-sm">
                    {CATEGORY_LABEL[i.category] ?? i.category}
                    <p className="text-xs text-muted-foreground">
                      {i.category === "mileage"
                        ? `${i.quantity} km × $${Number(i.unitRate).toFixed(2)}/km · trip ${i.tripDate} · ${i.businessPurpose}`
                        : i.category === "bonus"
                          ? i.reason
                          : `$${Number(i.unitRate).toFixed(2)} rate at the time`}
                    </p>
                    {i.decisionNote ? <p className="text-xs text-muted-foreground">Note: {i.decisionNote}</p> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(i.amountCents)}
                    {i.taxStatus ? <p className="text-xs text-muted-foreground">{TAX_LABEL[i.taxStatus] ?? i.taxStatus}{i.taxCents ? ` · +${formatMoney(i.taxCents)}` : ""}</p> : null}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[i.status as keyof typeof STATUS_TONE] ?? "neutral"}>{i.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="grid gap-2">
                      {i.status === "pending" && canApprove ? (
                        <>
                          <ActionForm action={decideCompensationAction} hidden={{ itemId: i.id, decision: "approve" }} submitLabel="Approve" />
                          <ActionForm action={decideCompensationAction} hidden={{ itemId: i.id, decision: "reject" }} submitLabel="Reject" variant="outline">
                            <Input name="note" placeholder="Reason" className="h-8 w-36" required />
                          </ActionForm>
                        </>
                      ) : null}
                      {(i.status === "pending" || i.status === "approved") && canRecord ? (
                        <ActionForm action={voidCompensationAction} hidden={{ itemId: i.id }} submitLabel="Void" variant="ghost">
                          <Input name="reason" placeholder="Why void it?" className="h-8 w-36" required />
                        </ActionForm>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
