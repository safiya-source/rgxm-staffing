"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { recordAudit } from "@/server/audit";
import { runAction, UserFacingError } from "@/server/actions";
import { db } from "@/server/db";
import { orgSettings } from "@/server/db/schema";
import * as onboarding from "@/server/domain/onboarding";
import { authorizeInternal } from "@/server/session";

const PATH = "/dashboard/settings/compliance";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optional = (v: string) => (v ? v : null);

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof onboarding.OnboardingError) throw new UserFacingError(err.message);
    throw err;
  }
}

async function updateSettings(actorId: string, action: string, values: Partial<typeof orgSettings.$inferInsert>, auditAfter: Record<string, unknown>, reason: string | null = null) {
  await db.transaction(async (tx) => {
    await tx.insert(orgSettings).values({ id: 1, ...values, updatedBy: actorId }).onConflictDoUpdate({ target: orgSettings.id, set: { ...values, updatedBy: actorId } });
    await recordAudit({ actorId, action, entityType: "org_settings", entityId: "1", after: auditAfter, reason }, tx);
  });
  revalidatePath(PATH);
}

const officerSchema = z.object({
  name: z.string().trim().max(120),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(200),
  supportEmail: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]),
  financeEmail: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]),
});

export async function savePrivacyOfficerAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("legal.manage");
    const v = officerSchema.parse({ name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone"), address: str(fd, "address"), supportEmail: str(fd, "supportEmail"), financeEmail: str(fd, "financeEmail") });
    await updateSettings(
      viewer.userId,
      "settings.privacy_officer",
      { privacyOfficerName: optional(v.name), privacyOfficerEmail: optional(v.email), privacyOfficerPhone: optional(v.phone), privacyOfficerAddress: optional(v.address), supportEmail: optional(v.supportEmail), financeEmail: optional(v.financeEmail) },
      { hasName: Boolean(v.name), hasEmail: Boolean(v.email), hasPhone: Boolean(v.phone), hasAddress: Boolean(v.address), hasSupportEmail: Boolean(v.supportEmail), hasFinanceEmail: Boolean(v.financeEmail) },
    );
    revalidatePath("/privacy");
    revalidatePath("/terms");
    revalidatePath("/contractor-agreement");
    return { ok: true, message: "Contacts saved." };
  });
}

export async function saveRequirementsAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("legal.manage");
    const requireContractorApproval = fd.get("requireContractorApproval") === "on";
    const requireMfaForStaff = fd.get("requireMfaForStaff") === "on";
    await updateSettings(viewer.userId, "settings.compliance_requirements", { requireContractorApproval, requireMfaForStaff }, { requireContractorApproval, requireMfaForStaff });
    revalidatePath("/dashboard", "layout");
    return { ok: true, message: "Requirements saved." };
  });
}

export async function saveDocumentAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("legal.manage");
    const id = str(fd, "documentId") || undefined;
    await guard(() =>
      onboarding.saveDraftDocument(
        viewer.userId,
        { kind: str(fd, "kind") as onboarding.LegalKind, version: str(fd, "version"), title: str(fd, "title"), body: str(fd, "body"), summaryOfChanges: optional(str(fd, "summaryOfChanges")), selfBilling: fd.get("selfBilling") === "on" },
        id,
      ),
    );
    revalidatePath(PATH);
    return { ok: true, message: id ? "Draft updated." : "Draft saved." };
  });
}

export async function approveDocumentAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("legal.manage");
    await guard(() => onboarding.approveDocument(viewer.userId, str(fd, "documentId"), str(fd, "reference")));
    revalidatePath(PATH);
    revalidatePath("/privacy");
    return { ok: true, message: "Published. Contractors will be asked to accept it." };
  });
}

export async function deleteDocumentAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("legal.manage");
    await guard(() => onboarding.deleteDraftDocument(viewer.userId, str(fd, "documentId")));
    revalidatePath(PATH);
    return { ok: true, message: "Draft deleted." };
  });
}

export async function saveConsentPurposeAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("legal.manage");
    await guard(() => onboarding.saveConsentPurpose(viewer.userId, { key: str(fd, "key"), label: str(fd, "label"), description: str(fd, "description") }));
    revalidatePath(PATH);
    return { ok: true, message: "Wording saved. It needs approval before contractors see it." };
  });
}

export async function setConsentPurposeAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("legal.manage");
    const active = str(fd, "active") === "true";
    await guard(() => onboarding.approveConsentPurpose(viewer.userId, str(fd, "key"), str(fd, "reference"), active));
    revalidatePath(PATH);
    return { ok: true, message: active ? "Approved and offered to contractors." : "No longer offered." };
  });
}

const intOrNull = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number({ message: "Enter a whole number" }).int().min(0).max(365).nullable());

export async function savePaymentTermsAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("legal.manage");
    const v = z
      .object({ dueRule: z.enum(["days_after_bill", "semi_monthly_agreement"]).default("days_after_bill"), cutoffDaysAfterPeriodEnd: intOrNull, dueDaysAfterBillDate: intOrNull, description: z.string().trim().max(500), approvalReference: z.string().trim().max(300) })
      .parse({ dueRule: str(fd, "dueRule") || undefined, cutoffDaysAfterPeriodEnd: str(fd, "cutoffDaysAfterPeriodEnd"), dueDaysAfterBillDate: str(fd, "dueDaysAfterBillDate"), description: str(fd, "description"), approvalReference: str(fd, "approvalReference") });
    const approved = v.approvalReference.length >= 5 && (v.dueRule === "semi_monthly_agreement" || v.dueDaysAfterBillDate != null);
    if (v.approvalReference && !approved) throw new UserFacingError("To approve terms, choose a due-date rule (and the days, if using days after the bill date) and a reference of at least a few words.");
    const terms = {
      dueRule: v.dueRule,
      cutoffDaysAfterPeriodEnd: v.cutoffDaysAfterPeriodEnd,
      dueDaysAfterBillDate: v.dueDaysAfterBillDate,
      description: optional(v.description),
      approvalReference: optional(v.approvalReference),
      approvedBy: approved ? viewer.userId : null,
      approvedAt: approved ? new Date().toISOString() : null,
    };
    await updateSettings(viewer.userId, "settings.payment_terms", { paymentTerms: terms }, { dueRule: terms.dueRule, cutoffDaysAfterPeriodEnd: terms.cutoffDaysAfterPeriodEnd, dueDaysAfterBillDate: terms.dueDaysAfterBillDate, approved }, terms.approvalReference);
    return { ok: true, message: approved ? "Payment terms approved. New bills will use them." : "Saved as not approved. Bills keep showing \"terms not approved\"." };
  });
}

export async function saveResponsePeriodAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("legal.manage");
    const days = z.preprocess((v) => (v === "" ? null : Number(v)), z.number({ message: "Enter a whole number of days" }).int().min(1).max(365).nullable()).parse(str(fd, "days"));
    const reference = str(fd, "reference");
    if (days != null && reference.length < 5) throw new UserFacingError("Record who decided this period (e.g. lawyer's advice of 2026-11-25).");
    await updateSettings(viewer.userId, "settings.privacy_response_days", { privacyRequestResponseDays: days }, { privacyRequestResponseDays: days }, optional(reference));
    revalidatePath("/dashboard/privacy");
    return { ok: true, message: days ? `New requests are due ${days} days after they're received.` : "No deadline will be set on new requests." };
  });
}
