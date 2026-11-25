// Browser-side file upload. Large files can't pass through the app server on Vercel (its request
// limit is about 4.5 MB), so the file goes straight to storage with a one-time link, and the app
// then checks and files it. Where direct upload isn't available (local development), the form is
// sent to the app as before. `form` must hold the file under "file" plus any other fields.

type Target = { for: "project" | "document" | "receipt"; id?: string };

/** Under Vercel's ~4.5 MB request limit, with room for the other form fields. */
const SMALL_ENOUGH_FOR_APP = 4 * 1024 * 1024;

async function readError(res: Response, fallback: string) {
  if (res.status === 413) return "That file is too large to upload. Files must be 20 MB or smaller.";
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export async function uploadWithFile(endpoint: string, target: Target, form: FormData, fallbackError = "Upload failed. Please try again.") {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload.");

  const sign = await fetch("/api/uploads/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, fileName: file.name, size: file.size }),
  });
  if (!sign.ok) throw new Error(await readError(sign, fallbackError));
  const link = (await sign.json()) as { direct: boolean; url?: string; key?: string };

  let res: Response;
  // Small files can still go through the app if the direct upload fails for any reason.
  const viaApp = file.size <= SMALL_ENOUGH_FOR_APP;
  let stored = false;
  if (link.direct && link.url && link.key) {
    const put = new FormData();
    put.append("cacheControl", "3600");
    put.append("", file);
    const sent = await fetch(link.url, { method: "PUT", body: put, headers: { "x-upsert": "false" } }).catch(() => null);
    stored = Boolean(sent?.ok);
    if (!stored && !viaApp) throw new Error("The file couldn't be uploaded. Check your connection and try again.");
  }
  if (stored && link.key) {
    const fields: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (k !== "file" && typeof v === "string") fields[k] = v;
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, stagedKey: link.key, fileName: file.name }),
    });
  } else {
    res = await fetch(endpoint, { method: "POST", body: form });
  }
  if (!res.ok) throw new Error(await readError(res, fallbackError));
  return res.json().catch(() => ({}));
}
