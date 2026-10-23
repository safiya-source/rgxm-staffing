"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { FIELD_ROLES } from "@/lib/roles";
import { isIsoDate } from "@/lib/time";
import { runAction, UserFacingError } from "@/server/actions";
import { canAny } from "@/server/authz/permissions";
import * as talent from "@/server/domain/talent";
import { authorizeInternal, toActor } from "@/server/session";

const uuid = z.string().uuid();

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof talent.TalentError) throw new UserFacingError(err.message);
    throw err;
  }
}

function profileFromForm(formData: FormData) {
  return talent.staffProfileSchema.parse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    preferredName: formData.get("preferredName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    city: formData.get("city"),
    province: formData.get("province"),
    serviceArea: formData.get("serviceArea"),
    experienceYears: formData.get("experienceYears"),
    experienceSummary: formData.get("experienceSummary"),
    hasDriversLicence: formData.get("hasDriversLicence") ?? "",
    hasVehicle: formData.get("hasVehicle") ?? "",
    willingToTravel: formData.get("willingToTravel") ?? "",
    travelRadiusKm: formData.get("travelRadiusKm"),
    preferredHours: formData.get("preferredHours"),
  });
}

export async function createStaffAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id: string | undefined;
  const result = await runAction(async (): Promise<ActionResult> => {
    const viewer = await authorizeInternal("talent.edit");
    const input = profileFromForm(formData);
    const roles = z.array(z.enum(FIELD_ROLES)).parse(formData.getAll("roles"));
    id = await guard(() => talent.createStaff(viewer.userId, input, roles));
    return { ok: true };
  });
  if (result.ok && id) redirect(`/dashboard/talent/${id}`);
  return result;
}

export async function updateStaffAction(staffId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    await guard(() => talent.updateStaff(viewer.userId, uuid.parse(staffId), profileFromForm(formData)));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Profile saved." };
  });
}

export async function setStaffStatusAction(staffId: string, status: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    const s = z.enum(["active", "inactive", "suspended", "archived"]).parse(status);
    if ((s === "suspended" || s === "archived") && !reason.trim()) throw new UserFacingError("Give a reason for this change.");
    await guard(() => talent.setStaffStatus(viewer.userId, uuid.parse(staffId), s, reason.trim() || null));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Status updated." };
  });
}

export async function setStaffRolesAction(staffId: string, roles: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    await guard(() => talent.setStaffRoles(viewer.userId, uuid.parse(staffId), z.array(z.enum(FIELD_ROLES)).parse(roles)));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Roles updated." };
  });
}

export async function setStaffTagsAction(staffId: string, skillIds: string[], languageIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    await guard(() => talent.setStaffTags(viewer.userId, uuid.parse(staffId), z.array(uuid).parse(skillIds), z.array(uuid).parse(languageIds)));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Skills and languages updated." };
  });
}

export async function addCertificationAction(staffId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    const date = z.preprocess((v) => (v ? v : null), z.string().refine(isIsoDate, "Invalid date").nullable());
    const input = z
      .object({ certificationId: uuid, issuedOn: date, expiresOn: date })
      .parse({ certificationId: formData.get("certificationId"), issuedOn: formData.get("issuedOn"), expiresOn: formData.get("expiresOn") });
    await guard(() => talent.addCertification(viewer.userId, uuid.parse(staffId), input));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Certification added." };
  });
}

export async function removeCertificationAction(staffId: string, staffCertificationId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    await guard(() => talent.removeCertification(viewer.userId, uuid.parse(staffId), uuid.parse(staffCertificationId)));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Certification removed." };
  });
}

export async function setRateAction(staffId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("rates.edit");
    const role = z.enum(FIELD_ROLES).parse(formData.get("role"));
    const cents = talent.parseDollarsToCents(String(formData.get("rate") ?? ""));
    if (cents === null || Number.isNaN(cents)) {
      return { ok: false, error: "Enter an hourly rate like 25 or 27.50.", fieldErrors: { rate: ["Invalid rate"] } };
    }
    const note = String(formData.get("note") ?? "").trim() || null;
    await guard(() => talent.setStaffRate(viewer.userId, uuid.parse(staffId), role, cents, note));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Rate saved. Existing bookings keep their agreed rate." };
  });
}

export async function setClassificationAction(staffId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("rates.edit");
    const text = (k: string) => String(formData.get(k) ?? "").trim() || null;
    const input = {
      classification: z.enum(["unset", "contractor", "employee"]).parse(formData.get("classification")),
      taxRegistered: formData.get("taxRegistered") === "on",
      gstHstNumber: text("gstHstNumber"),
      legalName: text("legalName"),
      businessName: text("businessName"),
    };
    await guard(() => talent.setClassification(viewer.userId, uuid.parse(staffId), input));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Pay setup saved." };
  });
}

export async function setEmergencyContactAction(staffId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    if (!canAny(toActor(viewer), "talent.emergency.view")) throw new UserFacingError("You can't edit emergency contacts.");
    const text = (k: string) => String(formData.get(k) ?? "").trim() || null;
    const phone = text("phone");
    if (phone && !talent.phoneSchema.safeParse(phone).success) {
      return { ok: false, error: "Enter a valid phone number.", fieldErrors: { phone: ["Invalid phone"] } };
    }
    await guard(() => talent.setEmergencyContact(viewer.userId, uuid.parse(staffId), { name: text("name"), phone, relation: text("relation") }));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Emergency contact saved." };
  });
}

export async function addNoteAction(staffId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.notes.view");
    await guard(() => talent.addInternalNote(viewer.userId, uuid.parse(staffId), String(formData.get("body") ?? "")));
    revalidatePath(`/dashboard/talent/${staffId}`);
    return { ok: true, message: "Note added." };
  });
}

// ─── Lists ──────────────────────────────────────────────────────────────────

export async function createListAction(_prev: ActionResult, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    const id = await guard(() =>
      talent.createList(viewer.userId, String(formData.get("name") ?? ""), String(formData.get("description") ?? "").trim() || null),
    );
    revalidatePath("/dashboard/talent", "layout");
    return { ok: true, message: "List created.", data: { id } };
  });
}

export async function deleteListAction(listId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    await guard(() => talent.deleteList(viewer.userId, uuid.parse(listId)));
    revalidatePath("/dashboard/talent", "layout");
    return { ok: true, message: "List deleted. The people in it weren't changed." };
  });
}

export async function addToListAction(listId: string, staffIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    const added = await guard(() => talent.addToList(viewer.userId, uuid.parse(listId), z.array(uuid).max(500).parse(staffIds)));
    revalidatePath("/dashboard/talent", "layout");
    return { ok: true, message: added === 0 ? "Already on that list." : `Added ${added} ${added === 1 ? "person" : "people"}.` };
  });
}

export async function removeFromListAction(listId: string, staffIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.edit");
    await guard(() => talent.removeFromList(viewer.userId, uuid.parse(listId), z.array(uuid).max(500).parse(staffIds)));
    revalidatePath("/dashboard/talent", "layout");
    return { ok: true, message: "Removed from list." };
  });
}

// ─── Import ─────────────────────────────────────────────────────────────────

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export type ImportPreview = Awaited<ReturnType<typeof talent.previewImport>>;

export async function previewImportAction(csvText: string): Promise<ActionResult<ImportPreview>> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.import");
    if (csvText.length > MAX_IMPORT_BYTES) throw new UserFacingError("That file is larger than 2 MB.");
    const preview = await guard(() => talent.previewImport(csvText, { canEditRates: canAny(toActor(viewer), "rates.edit") }));
    // Don't send parsed rows back; the client only needs line numbers, actions and errors.
    return {
      ok: true,
      data: { ...preview, results: preview.results.map(({ line, email, action, errors }) => ({ line, email, action, errors })) },
    };
  });
}

export async function commitImportAction(csvText: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("talent.import");
    if (csvText.length > MAX_IMPORT_BYTES) throw new UserFacingError("That file is larger than 2 MB.");
    const counts = await guard(() => talent.commitImport(viewer.userId, csvText, { canEditRates: canAny(toActor(viewer), "rates.edit") }));
    revalidatePath("/dashboard/talent", "layout");
    return {
      ok: true,
      message: `Imported: ${counts.create} new, ${counts.update} updated${counts.error ? `, ${counts.error} skipped with errors` : ""}.`,
    };
  });
}
