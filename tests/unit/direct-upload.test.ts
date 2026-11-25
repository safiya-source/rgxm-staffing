import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDirectUpload, readUpload } from "@/app/api/upload-helpers";
import { storage, SupabaseStorage } from "@/server/storage";

const PDF = Buffer.from("%PDF-1.7\n% test\n");

function jsonRequest(body: unknown) {
  return new Request("http://localhost:3000/api/x", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
}

afterEach(() => vi.unstubAllGlobals());

describe("direct uploads", () => {
  it("asks Supabase for a one-time upload link and returns the full URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: "/object/upload/sign/rgxm-private/uploads/project/p1/u/deck.pdf?token=abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const s = new SupabaseStorage("https://proj.supabase.co/", "sb_secret_x", "rgxm-private");
    expect(await s.createUploadUrl("uploads/project/p1/u/deck.pdf")).toBe("https://proj.supabase.co/storage/v1/object/upload/sign/rgxm-private/uploads/project/p1/u/deck.pdf?token=abc");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/upload/sign/rgxm-private/uploads/project/p1/u/deck.pdf");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-upsert"]).toBe("false");
  });

  it("checks the name and size up front, and falls back to the app on local storage", async () => {
    await expect(createDirectUpload("project:p1", "deck.exe", 100)).rejects.toThrow(/Upload a PDF/);
    await expect(createDirectUpload("project:p1", "deck.pdf", 21 * 1024 * 1024)).rejects.toThrow(/20 MB/);
    expect(await createDirectUpload("project:p1", "TRAINING DECK_ TACO BELL.pdf", 6_000_000)).toBeNull();
  });

  it("reads a staged file for the same project only, with the other form fields", async () => {
    const key = `uploads/project/p1/${crypto.randomUUID()}/deck.pdf`;
    await storage().put(key, PDF, "application/pdf");
    const ok = await readUpload(jsonRequest({ stagedKey: key, fileName: "Deck.pdf", title: "Training Deck", requiresAck: "on" }), { scope: "project:p1" });
    expect(ok.file.data.equals(PDF)).toBe(true);
    expect(ok.file.name).toBe("Deck.pdf");
    expect(ok.form.get("title")).toBe("Training Deck");
    expect(ok.form.get("requiresAck")).toBe("on");
    expect(ok.stagedKey).toBe(key);
    await expect(readUpload(jsonRequest({ stagedKey: key, fileName: "Deck.pdf" }), { scope: "project:p2" })).rejects.toThrow(/doesn't belong/);
    await expect(readUpload(jsonRequest({ stagedKey: "uploads/project/p1/missing/deck.pdf", fileName: "Deck.pdf" }), { scope: "project:p1" })).rejects.toThrow(/didn't finish uploading/);
    await expect(
      readUpload(new Request("http://localhost:3000/api/x", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" }, body: "{}" }), { scope: "project:p1" }),
    ).rejects.toThrow(/Cross-site/);
  });
});
