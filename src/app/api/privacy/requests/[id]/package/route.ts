// Download of a privacy request's access package (Privacy Officer only). Contains personal
// information, so it is audited, never cached, and returned only to people with privacy.manage.
import { PrivacyOpsError, readAccessPackage } from "@/server/domain/privacy-ops";
import { authorizeInternalRoute } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/privacy/requests/[id]/package">) {
  const viewer = await authorizeInternalRoute("privacy.manage");
  if (!viewer) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    const file = await readAccessPackage(viewer.userId, id);
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof PrivacyOpsError) return new Response(err.message, { status: 404 });
    throw err;
  }
}
