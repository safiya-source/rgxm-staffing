// Upload a new version of a document. Staff must re-acknowledge the new version.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/server/db";
import { documents } from "@/server/db/schema";
import { CommsError, replaceDocument } from "@/server/domain/comms";
import { runOutbox } from "@/server/notify/run";
import { logError } from "@/server/observability";
import { RateLimitError, rateLimit } from "@/server/rate-limit";
import { UploadError } from "@/server/storage";
import { authorizeProject, ForbiddenError } from "@/server/session";
import { json, readUpload } from "../../../upload-helpers";

export async function POST(request: Request, ctx: RouteContext<"/api/documents/[id]/versions">) {
  const { id } = await ctx.params;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(404, { error: "Not found" });
    const [doc] = await db.select({ projectId: documents.projectId }).from(documents).where(eq(documents.id, id));
    if (!doc) return json(404, { error: "Not found" });
    const viewer = await authorizeProject("comms.manage", doc.projectId);
    await rateLimit("upload", viewer.userId);
    const { file } = await readUpload(request);
    const version = await replaceDocument(viewer.userId, id, file);
    after(() => runOutbox().catch((e) => logError(e, { where: "outbox" })));
    revalidatePath(`/dashboard/projects/${doc.projectId}/comms`);
    return json(201, { version });
  } catch (err) {
    if (err instanceof ForbiddenError) return json(403, { error: err.message });
    if (err instanceof RateLimitError) return json(429, { error: err.message });
    if (err instanceof UploadError || err instanceof CommsError) return json(400, { error: err.message });
    console.error("[upload]", err);
    return json(500, { error: "Upload failed. Please try again." });
  }
}
