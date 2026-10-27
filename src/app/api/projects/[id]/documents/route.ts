// Upload a briefing document to a project (multipart/form-data). Kept out of server actions
// so the 20 MB limit applies only here.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { CommsError, documentMetaSchema, uploadDocument } from "@/server/domain/comms";
import { runOutbox } from "@/server/notify/run";
import { logError } from "@/server/observability";
import { RateLimitError, rateLimit } from "@/server/rate-limit";
import { UploadError } from "@/server/storage";
import { authorizeProject, ForbiddenError } from "@/server/session";
import { json, readUpload } from "../../../upload-helpers";

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/documents">) {
  const { id } = await ctx.params;
  try {
    const viewer = await authorizeProject("comms.manage", id);
    await rateLimit("upload", viewer.userId);
    const { form, file } = await readUpload(request);
    const meta = documentMetaSchema.safeParse({
      title: form.get("title"),
      category: form.get("category"),
      requiresAck: form.get("requiresAck") === "on",
      shiftId: form.get("shiftId") || null,
    });
    if (!meta.success) return json(400, { error: meta.error.issues[0]?.message ?? "Check the form." });
    const documentId = await uploadDocument(viewer.userId, id, meta.data, file);
    after(() => runOutbox().catch((e) => logError(e, { where: "outbox" })));
    revalidatePath(`/dashboard/projects/${id}/comms`);
    return json(201, { documentId });
  } catch (err) {
    if (err instanceof ForbiddenError) return json(403, { error: err.message });
    if (err instanceof RateLimitError) return json(429, { error: err.message });
    if (err instanceof UploadError || err instanceof CommsError) return json(400, { error: err.message });
    console.error("[upload]", err);
    return json(500, { error: "Upload failed. Please try again." });
  }
}
