// A receipt for an expense claim. The contractor who submitted it can see it, and so can RGXM
// people who record, approve or pay that project's allowances and expenses.
import { canOnProject } from "@/server/authz/permissions";
import { receiptFor } from "@/server/domain/expenses";
import { getViewer, loadProjectScopes, toActor } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/expenses/[id]/receipt">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  const r = await receiptFor(id);
  if (!r) return new Response("Not found", { status: 404 });

  let allowed = false;
  if (viewer.kind === "staff") allowed = viewer.staff?.id === r.staffId;
  else {
    const scope = (await loadProjectScopes([r.projectId])).get(r.projectId);
    const actor = toActor(viewer);
    allowed = Boolean(scope && (["compensation.record", "compensation.approve", "payments.view"] as const).some((p) => canOnProject(actor, p, scope)));
  }
  if (!allowed) return new Response("Not found", { status: 404 });

  const data = await r.data();
  const inline = new URL(request.url).searchParams.get("download") !== "1";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": r.contentType ?? "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${(r.name ?? "receipt").replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
    },
  });
}
