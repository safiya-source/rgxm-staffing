// Authenticated document download. Internal users need project access; staff need a confirmed
// booking on the project (or the specific shift for shift-only documents).
import { eq } from "drizzle-orm";
import { canAny } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { documents } from "@/server/db/schema";
import { staffCanAccessDocument } from "@/server/domain/comms";
import { storage } from "@/server/storage";
import { getViewer, toActor } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]/file">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) return new Response("Not found", { status: 404 });

  const allowed =
    viewer.kind === "internal" ? canAny(toActor(viewer), "project.view") : Boolean(viewer.staff && (await staffCanAccessDocument(viewer.staff.id, doc)));
  if (!allowed) return new Response("Not found", { status: 404 });

  const data = await storage().get(doc.storageKey);
  const inline = new URL(request.url).searchParams.get("inline") === "1" && (doc.contentType === "application/pdf" || doc.contentType?.startsWith("image/"));
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.contentType ?? "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Inline PDFs/images are rendered by our own page; nothing else may frame them.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
    },
  });
}
