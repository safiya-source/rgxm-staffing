// Private file storage. Files are never publicly reachable: downloads go through an
// authenticated route that checks access first (see app/files/documents/[id]/route.ts).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/server/env";

export interface StorageAdapter {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Deletes a file. Missing files are not an error. */
  remove(key: string): Promise<void>;
}

function assertSafeKey(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..") || key.startsWith("/")) throw new Error(`Unsafe storage key: ${key}`);
}

class LocalStorage implements StorageAdapter {
  constructor(private root: string) {}
  private resolve(key: string) {
    assertSafeKey(key);
    return path.join(path.resolve(this.root), key);
  }
  async put(key: string, data: Buffer) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: "wx" }); // never overwrite: new versions get new keys
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async remove(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/**
 * Supabase Storage (private bucket) via its REST API with the service-role key, server-side only.
 * NOTE: implemented against Supabase's documented API but not yet exercised against a live project.
 */
class SupabaseStorage implements StorageAdapter {
  constructor(
    private url: string,
    private key: string,
    private bucket: string,
  ) {}
  private endpoint(key: string) {
    assertSafeKey(key);
    return `${this.url}/storage/v1/object/${this.bucket}/${key}`;
  }
  async put(key: string, data: Buffer, contentType: string) {
    const res = await fetch(this.endpoint(key), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": contentType, "x-upsert": "false" },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${await res.text()}`);
  }
  async get(key: string) {
    const res = await fetch(this.endpoint(key), { headers: { Authorization: `Bearer ${this.key}` } });
    if (!res.ok) throw new Error(`Storage download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  async remove(key: string) {
    const res = await fetch(this.endpoint(key), { method: "DELETE", headers: { Authorization: `Bearer ${this.key}` } });
    if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`);
  }
}

let adapter: StorageAdapter | undefined;
export function storage(): StorageAdapter {
  adapter ??=
    env.STORAGE_DRIVER === "supabase"
      ? new SupabaseStorage(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, env.SUPABASE_STORAGE_BUCKET)
      : new LocalStorage(env.STORAGE_LOCAL_DIR);
  return adapter;
}

// ─── Upload validation ──────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const TYPES: Record<string, { mime: string; magic?: (b: Buffer) => boolean }> = {
  pdf: { mime: "application/pdf", magic: (b) => b.subarray(0, 5).toString() === "%PDF-" },
  png: { mime: "image/png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  jpeg: { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  webp: { mime: "image/webp", magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  txt: { mime: "text/plain" },
};

export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

/** Checks size, extension and file signature. Returns a safe file name and the content type to store. */
export function validateUpload(fileName: string, data: Buffer) {
  if (data.length === 0) throw new UploadError("That file is empty.");
  if (data.length > MAX_UPLOAD_BYTES) throw new UploadError("Files must be 20 MB or smaller.");
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext];
  if (!type) throw new UploadError(`Upload a ${ALLOWED_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")} file.`);
  if (type.magic && !type.magic(data)) throw new UploadError("That file's contents don't match its type.");
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return { safeName: `${base || "file"}.${ext}`, contentType: type.mime };
}

export class UploadError extends Error {}
