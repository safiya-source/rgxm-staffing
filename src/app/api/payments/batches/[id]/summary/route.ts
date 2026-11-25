// Pay summary by project for one batch (Excel), to share with the finance team. Finance/admin only;
// every download is audited. It's a summary, not a bank file: it never marks anything exported or paid.
import { recordAudit } from "@/server/audit";
import { buildProjectSummary } from "@/server/domain/payment-exports";
import { getBatchDetail } from "@/server/queries/payments";
import { authorizeInternalRoute } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/payments/batches/[id]/summary">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const viewer = await authorizeInternalRoute("payments.manage");
  if (!viewer) return new Response("Not found", { status: 404 });
  const b = await getBatchDetail(id);
  if (!b) return new Response("Not found", { status: 404 });
  const lines = b.items
    .filter((i) => !["removed", "voided"].includes(i.state))
    .map((i) => ({ projectCode: i.projectCode, projectName: i.projectName, staffName: i.staffName, email: i.staffEmail, subtotalCents: i.baseCents, taxCents: i.taxCents, totalCents: i.amountCents }));
  const file = await buildProjectSummary({ reference: b.reference, type: b.type, periodLabel: b.period, isDemo: b.isDemo }, lines);
  await recordAudit({ actorId: viewer.userId, action: "batch.summary_download", entityType: "payment_batch", entityId: b.id, after: { lines: lines.length } });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(file.data.length),
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
