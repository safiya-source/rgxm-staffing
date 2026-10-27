// Privacy officer export of one staff member's record, for an access request.
import { RateLimitError, rateLimit } from "@/server/rate-limit";
import { recordAudit } from "@/server/audit";
import { exportStaffData, PrivacyError } from "@/server/domain/privacy";
import { authorizeInternalRoute } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/staff/[id]/data">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const viewer = await authorizeInternalRoute("privacy.manage");
  if (!viewer) return new Response("Not found", { status: 404 });
  try {
    await rateLimit("export.personal_data", viewer.userId);
  } catch (err) {
    if (err instanceof RateLimitError) return new Response(err.message, { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } });
    throw err;
  }
  try {
    const data = await exportStaffData(id);
    await recordAudit({ actorId: viewer.userId, action: "privacy.export", entityType: "staff", entityId: id });
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="staff-${id.slice(0, 8)}-data.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof PrivacyError) return new Response("Not found", { status: 404 });
    throw err;
  }
}
