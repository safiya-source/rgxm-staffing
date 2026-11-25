// A one-time link for the browser to upload a file straight to storage, so large files (over the
// ~4.5 MB request limit on Vercel) don't pass through the app. The file is then checked and filed
// by the normal upload route (documents, versions, receipts), which only accepts staged files under
// the same project or contractor. Returns { direct: false } where direct upload isn't available.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { documents } from "@/server/db/schema";
import { RateLimitError, rateLimit } from "@/server/rate-limit";
import { UploadError } from "@/server/storage";
import { authorizeProject, ForbiddenError, getViewer } from "@/server/session";
import { assertSameSite, createDirectUpload, json, type UploadScope } from "../../upload-helpers";

const bodySchema = z.object({
  for: z.enum(["project", "document", "receipt"]),
  id: z.string().uuid().optional(),
  fileName: z.string().min(1).max(300),
  size: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    assertSameSite(request);
    const body = bodySchema.parse(await request.json());
    let scope: UploadScope;
    let userId: string;
    if (body.for === "receipt") {
      const viewer = await getViewer();
      if (!viewer || viewer.kind !== "staff" || !viewer.staff?.onboarded) return json(403, { error: "Please sign in." });
      scope = `staff:${viewer.staff.id}`;
      userId = viewer.userId;
    } else {
      if (!body.id) return json(400, { error: "Missing project." });
      let projectId = body.id;
      if (body.for === "document") {
        const [doc] = await db.select({ projectId: documents.projectId }).from(documents).where(eq(documents.id, body.id));
        if (!doc) return json(404, { error: "Not found" });
        projectId = doc.projectId;
      }
      const viewer = await authorizeProject("comms.manage", projectId);
      scope = `project:${projectId}`;
      userId = viewer.userId;
    }
    await rateLimit("upload", userId);
    const direct = await createDirectUpload(scope, body.fileName, body.size);
    return json(200, direct ? { direct: true, ...direct } : { direct: false });
  } catch (err) {
    if (err instanceof ForbiddenError) return json(403, { error: err.message });
    if (err instanceof RateLimitError) return json(429, { error: err.message });
    if (err instanceof UploadError) return json(400, { error: err.message });
    if (err instanceof z.ZodError) return json(400, { error: "Check the file." });
    console.error("[upload-sign]", err);
    return json(500, { error: "Upload failed. Please try again." });
  }
}
