// Liveness/readiness check for uptime monitors and load balancers. Public, and deliberately says
// nothing about versions, configuration or data.
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { logError } from "@/server/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logError(err, { where: "health" });
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
