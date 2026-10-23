// Scheduled notification runner. Configure your scheduler (e.g. Vercel Cron, every minute) to call
// GET /api/cron/outbox with "Authorization: Bearer $CRON_SECRET".
import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runOutbox } from "@/server/notify/run";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expected = env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runOutbox(200);
  return Response.json(result);
}
