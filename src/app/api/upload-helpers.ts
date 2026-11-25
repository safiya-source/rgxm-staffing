import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/server/env";
import { ForbiddenError } from "@/server/session";
import { checkUploadName, MAX_UPLOAD_BYTES, storage, UploadError } from "@/server/storage";

/** Rejects cross-site requests (uploads and upload links are only for our own pages). */
export function assertSameSite(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env.APP_URL).origin) throw new ForbiddenError("Cross-site upload rejected.");
  // Browsers send Sec-Fetch-Site on every request; anything other than our own pages is refused.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw new ForbiddenError("Cross-site upload rejected.");
}

/**
 * Where direct uploads wait until the app checks and files them, per owner: a project
 * ("project:<id>", for RGXM uploads) or a contractor ("staff:<id>", for their receipts).
 */
export type UploadScope = `project:${string}` | `staff:${string}`;
const stagingPrefix = (scope: UploadScope) => `uploads/${scope.replace(":", "/")}/`;

/**
 * A one-time link for the browser to upload a file straight to storage (large files can't pass
 * through the app server on Vercel). Null when storage doesn't support it (local disk): the
 * browser then sends the file to the app as before.
 */
export async function createDirectUpload(scope: UploadScope, fileName: string, size: number) {
  const safeName = checkUploadName(fileName, size);
  const key = `${stagingPrefix(scope)}${randomUUID()}/${safeName}`;
  const url = await storage().createUploadUrl(key);
  return url ? { url, key } : null;
}

const stagedSchema = z.object({ stagedKey: z.string().min(1).max(500), fileName: z.string().min(1).max(300) }).passthrough();

/**
 * Reads the uploaded file: either a multipart form (small files, local development) or, after a
 * direct upload, JSON naming the staged file, which is fetched from storage and checked here like
 * any upload. Returns the other form fields too, and the staged key to clean up afterwards.
 */
export async function readUpload(request: Request, opts: { scope?: UploadScope } = {}) {
  assertSameSite(request);
  if ((request.headers.get("content-type") ?? "").startsWith("application/json")) {
    if (!opts.scope) throw new UploadError("Choose a file to upload.");
    const body = stagedSchema.parse(await request.json());
    if (!body.stagedKey.startsWith(stagingPrefix(opts.scope)) || body.stagedKey.includes("..")) throw new ForbiddenError("That upload doesn't belong here.");
    let data: Buffer;
    try {
      data = await storage().get(body.stagedKey);
    } catch {
      throw new UploadError("The file didn't finish uploading. Please try again.");
    }
    if (data.length > MAX_UPLOAD_BYTES) throw new UploadError("Files must be 20 MB or smaller.");
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) if (typeof v === "string" || typeof v === "boolean") form.set(k, typeof v === "boolean" ? (v ? "on" : "") : v);
    return { form, file: { name: body.fileName, data }, stagedKey: body.stagedKey };
  }
  // A declared length is required so oversized (or chunked, unsized) bodies are refused before reading.
  const declared = request.headers.get("content-length");
  const length = declared === null ? NaN : Number(declared);
  if (!Number.isFinite(length) || length <= 0) throw new UploadError("Upload size is missing. Please try again.");
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw new UploadError("Files must be 20 MB or smaller.");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new UploadError("Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("Files must be 20 MB or smaller.");
  return { form, file: { name: file.name, data: Buffer.from(await file.arrayBuffer()) }, stagedKey: null as string | null };
}

/** Removes a staged direct upload once it has been filed (or rejected). Failures are only logged. */
export async function discardStaged(key: string | null) {
  if (!key) return;
  await storage()
    .remove(key)
    .catch((e) => console.error("[upload] staged cleanup", e));
}

export const json = (status: number, body: unknown) => Response.json(body, { status });
