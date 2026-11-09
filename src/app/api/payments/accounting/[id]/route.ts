// Download of a stored accounting (bill) export. Finance/admin only, rate-limited, audited, and
// checked against the fingerprint taken when the file was generated.
import { RateLimitError, rateLimit } from "@/server/rate-limit";
import { BillingError, readAccountingExport } from "@/server/domain/billing";
import { authorizeInternalRoute } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/payments/accounting/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const viewer = await authorizeInternalRoute("accounting.manage");
  if (!viewer) return new Response("Not found", { status: 404 });
  try {
    await rateLimit("export.payments", viewer.userId);
  } catch (err) {
    if (err instanceof RateLimitError) return new Response(err.message, { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } });
    throw err;
  }
  try {
    const file = await readAccountingExport(viewer.userId, id);
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
    if (err instanceof BillingError) return new Response(err.message, { status: 404 });
    throw err;
  }
}
