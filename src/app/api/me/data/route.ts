// A staff member downloads their own record (PIPEDA access).
import { RateLimitError, rateLimit } from "@/server/rate-limit";
import { recordAudit } from "@/server/audit";
import { exportStaffData } from "@/server/domain/privacy";
import { getViewer } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer?.staff) return new Response("Not found", { status: 404 });
  try {
    await rateLimit("export.personal_data", viewer.userId);
  } catch (err) {
    if (err instanceof RateLimitError) return new Response(err.message, { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } });
    throw err;
  }
  const data = await exportStaffData(viewer.staff.id);
  await recordAudit({ actorId: viewer.userId, action: "privacy.self_export", entityType: "staff", entityId: viewer.staff.id });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="my-rgxm-data.json"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
