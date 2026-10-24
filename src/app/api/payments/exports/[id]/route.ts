// Download of a stored payment export (Finance/admin only). Every download is audited, and the
// bytes are checked against the fingerprint taken when the file was generated.
import { canAny } from "@/server/authz/permissions";
import { PaymentError, readExport } from "@/server/domain/payments";
import { getViewer, toActor } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/payments/exports/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (viewer.kind !== "internal" || !canAny(toActor(viewer), "payments.manage")) return new Response("Not found", { status: 404 });
  try {
    const file = await readExport(viewer.userId, id);
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.data.length),
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof PaymentError) return new Response(err.message, { status: 404 });
    throw err;
  }
}
