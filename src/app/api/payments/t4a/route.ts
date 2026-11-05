// Year-end T4A summary download (Finance/admin only). Contains names, addresses and pay totals, so it
// is rate-limited, audited, never cached, and only reachable by people who manage payments.
import { RateLimitError, rateLimit } from "@/server/rate-limit";
import { buildT4aCsv } from "@/server/domain/t4a";
import { authorizeInternalRoute } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await authorizeInternalRoute("payments.manage");
  if (!viewer) return new Response("Not found", { status: 404 });
  const year = Number(new URL(request.url).searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return new Response("Choose a year", { status: 400 });
  try {
    await rateLimit("export.t4a", viewer.userId);
  } catch (err) {
    if (err instanceof RateLimitError) return new Response(err.message, { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } });
    throw err;
  }
  const file = await buildT4aCsv(viewer.userId, year);
  return new Response(file.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
