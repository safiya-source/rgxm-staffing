import { env } from "@/server/env";
import { ForbiddenError } from "@/server/session";
import { MAX_UPLOAD_BYTES, UploadError } from "@/server/storage";

/** Reads a single file from a multipart request with a size cap. Rejects cross-site requests. */
export async function readUpload(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env.APP_URL).origin) throw new ForbiddenError("Cross-site upload rejected.");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw new UploadError("Files must be 20 MB or smaller.");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new UploadError("Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("Files must be 20 MB or smaller.");
  return { form, file: { name: file.name, data: Buffer.from(await file.arrayBuffer()) } };
}

export const json = (status: number, body: unknown) => Response.json(body, { status });
