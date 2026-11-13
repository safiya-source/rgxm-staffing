// A contractor submits an expense for reimbursement with its receipt (multipart/form-data).
// Kept out of server actions so the upload size limit applies only here.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { ZodError } from "zod";
import { runOutbox } from "@/server/notify/run";
import { logError } from "@/server/observability";
import { CompensationError } from "@/server/domain/compensation";
import { submitExpense } from "@/server/domain/expenses";
import { RateLimitError, rateLimit } from "@/server/rate-limit";
import { UploadError } from "@/server/storage";
import { ForbiddenError, getViewer } from "@/server/session";
import { json, readUpload } from "../../upload-helpers";

export async function POST(request: Request) {
  try {
    const viewer = await getViewer();
    if (!viewer || viewer.kind !== "staff" || !viewer.staff?.onboarded) return json(403, { error: "Please sign in." });
    await rateLimit("upload", viewer.userId);
    const { form, file } = await readUpload(request);
    const id = await submitExpense(
      { userId: viewer.userId, staffId: viewer.staff.id },
      {
        projectId: String(form.get("projectId") ?? ""),
        bookingId: (form.get("bookingId") as string | null) || null,
        purchaseDate: String(form.get("purchaseDate") ?? ""),
        amount: String(form.get("amount") ?? ""),
        vendor: String(form.get("vendor") ?? ""),
        description: String(form.get("description") ?? ""),
      },
      file,
    );
    after(() => runOutbox().catch((e) => logError(e, { where: "outbox" })));
    revalidatePath("/portal/expenses");
    return json(201, { id });
  } catch (err) {
    if (err instanceof ForbiddenError) return json(403, { error: err.message });
    if (err instanceof RateLimitError) return json(429, { error: err.message });
    if (err instanceof ZodError) return json(400, { error: err.issues[0]?.message ?? "Check the form." });
    if (err instanceof UploadError || err instanceof CompensationError) return json(400, { error: err.message });
    console.error("[expense]", err);
    return json(500, { error: "Couldn't submit the expense. Please try again." });
  }
}
