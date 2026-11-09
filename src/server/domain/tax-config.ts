// Tax configuration that RGXM's accountant approves (service categories, effective-dated rules,
// per-category treatment, the automatic-calculation switch), Finance verification of contractors'
// GST/HST registration, and loading the context the tax engine needs for one bill line.
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { PROVINCE_CODES } from "@/lib/provinces";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import {
  compensationTaxTreatments,
  GST_HST_TREATMENTS,
  orgSettings,
  PAYABLE_CATEGORIES,
  projects,
  serviceCategories,
  staffSensitive,
  TAX_COMPONENTS,
  taxRules,
  YEAR_END_TREATMENTS,
} from "@/server/db/schema";
import { percentToPpm } from "./money";
import type { GstHstTreatment, RegistrationStatus, TaxContext, VerificationStatus } from "./tax-engine";

export class TaxConfigError extends Error {}

type Conn = Tx | typeof db;
const reference = z.string().trim().min(3, "Record who approved it and where (e.g. accountant's email of 2026-11-20).").max(300);

// ─── Loading ────────────────────────────────────────────────────────────────────

export async function loadTaxContext(tx: Conn, input: { staffId: string; projectId: string; category: string }): Promise<TaxContext> {
  const [settings] = await tx.select({ autoTaxEnabled: orgSettings.autoTaxEnabled }).from(orgSettings).where(eq(orgSettings.id, 1));
  const [project] = await tx
    .select({ eventProvince: projects.eventProvince, serviceCategory: projects.serviceCategory, supplyType: projects.supplyType })
    .from(projects)
    .where(eq(projects.id, input.projectId));
  if (!project) throw new TaxConfigError("Project not found.");
  const [sc] = project.serviceCategory ? await tx.select().from(serviceCategories).where(eq(serviceCategories.key, project.serviceCategory)) : [];
  const [reg] = await tx
    .select({
      status: staffSensitive.gstRegistrationStatus,
      verification: staffSensitive.gstVerificationStatus,
      effectiveDate: staffSensitive.gstRegistrationEffectiveDate,
      number: staffSensitive.gstHstNumber,
    })
    .from(staffSensitive)
    .where(eq(staffSensitive.staffId, input.staffId));
  const [treatment] = await tx.select().from(compensationTaxTreatments).where(eq(compensationTaxTreatments.category, input.category));
  const rules = project.eventProvince ? await tx.select().from(taxRules).where(eq(taxRules.jurisdiction, project.eventProvince)) : [];
  return {
    autoTaxEnabled: settings?.autoTaxEnabled ?? false,
    project: { eventProvince: project.eventProvince, serviceCategory: project.serviceCategory, supplyType: project.supplyType },
    serviceCategory: sc ? { key: sc.key, label: sc.label, placeOfSupplyRule: sc.placeOfSupplyRule, approved: Boolean(sc.approvedAt), active: sc.active } : null,
    registration: {
      status: (reg?.status ?? "unknown") as RegistrationStatus,
      verification: (reg?.verification ?? "unverified") as VerificationStatus,
      effectiveDate: reg?.effectiveDate ?? null,
      number: reg?.number ?? null,
    },
    treatment: treatment ? { gstHst: treatment.gstHst as GstHstTreatment, approved: Boolean(treatment.approvedAt) } : null,
    rules: rules.map((r) => ({ id: r.id, jurisdiction: r.jurisdiction, component: r.component, ratePpm: r.ratePpm, serviceCategory: r.serviceCategory, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, status: r.status })),
  };
}

export async function getTaxSetup() {
  const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.id, 1));
  const [categories, rules, treatments] = await Promise.all([
    db.select().from(serviceCategories).orderBy(asc(serviceCategories.label)),
    db.select().from(taxRules).orderBy(asc(taxRules.jurisdiction), asc(taxRules.component), asc(taxRules.effectiveFrom)),
    db.select().from(compensationTaxTreatments),
  ]);
  const order = PAYABLE_CATEGORIES as readonly string[];
  treatments.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return {
    autoTaxEnabled: settings?.autoTaxEnabled ?? false,
    autoTaxApprovedAt: settings?.autoTaxApprovedAt ?? null,
    autoTaxApprovalReference: settings?.autoTaxApprovalReference ?? null,
    taxRecoverability: settings?.taxRecoverability ?? {},
    categories,
    rules,
    treatments,
  };
}

// ─── Service categories ───────────────────────────────────────────────────────

const categorySchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{3,40}$/, "Use lowercase letters, numbers and underscores"),
  label: z.string().trim().min(3).max(80),
  description: z.string().trim().max(400).optional().nullable(),
  placeOfSupplyRule: z.enum(["event_province", "finance_review"]),
});

/** Creates or edits a service category. Editing clears its approval. */
export async function saveServiceCategory(actorId: string, raw: z.input<typeof categorySchema>) {
  const v = categorySchema.parse(raw);
  await db.transaction(async (tx) => {
    await tx
      .insert(serviceCategories)
      .values({ ...v, description: v.description ?? null })
      .onConflictDoUpdate({ target: serviceCategories.key, set: { label: v.label, description: v.description ?? null, placeOfSupplyRule: v.placeOfSupplyRule, approvedAt: null, approvedBy: null, approvalReference: null } });
    await recordAudit({ actorId, action: "tax.service_category_save", entityType: "service_category", entityId: v.key, after: v }, tx);
  });
}

export async function approveServiceCategory(actorId: string, key: string, rawReference: string) {
  const ref = reference.parse(rawReference);
  await db.transaction(async (tx) => {
    const [row] = await tx.update(serviceCategories).set({ approvedBy: actorId, approvedAt: new Date(), approvalReference: ref }).where(eq(serviceCategories.key, key)).returning();
    if (!row) throw new TaxConfigError("Service category not found.");
    await recordAudit({ actorId, action: "tax.service_category_approve", entityType: "service_category", entityId: key, after: { placeOfSupplyRule: row.placeOfSupplyRule }, reason: ref }, tx);
  });
}

// ─── Tax rules ──────────────────────────────────────────────────────────────────

const ruleSchema = z.object({
  jurisdiction: z.enum(PROVINCE_CODES),
  component: z.enum(TAX_COMPONENTS),
  ratePercent: z.string().trim().min(1, "Enter the rate"),
  serviceCategory: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the start date"),
  effectiveTo: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  notes: z.string().trim().max(400).optional().nullable(),
});

/** Adds a draft rule. Rules are never edited: add a new one and retire the old. */
export async function createTaxRule(actorId: string, raw: z.input<typeof ruleSchema>) {
  const v = ruleSchema.parse(raw);
  let ratePpm: number;
  try {
    ratePpm = percentToPpm(v.ratePercent);
  } catch (e) {
    throw new TaxConfigError((e as Error).message);
  }
  if (v.effectiveTo && v.effectiveTo < v.effectiveFrom) throw new TaxConfigError("The end date is before the start date.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(taxRules)
      .values({ jurisdiction: v.jurisdiction, component: v.component, ratePpm, serviceCategory: v.serviceCategory ?? null, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo ?? null, notes: v.notes ?? null, createdBy: actorId })
      .returning();
    await recordAudit({ actorId, action: "tax.rule_create", entityType: "tax_rule", entityId: row!.id, after: { jurisdiction: v.jurisdiction, component: v.component, ratePpm, from: v.effectiveFrom, to: v.effectiveTo ?? null } }, tx);
    return row!;
  });
}

export async function approveTaxRule(actorId: string, ruleId: string, rawReference: string) {
  const ref = reference.parse(rawReference);
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(taxRules).where(eq(taxRules.id, ruleId)).for("update");
    if (!r) throw new TaxConfigError("Rule not found.");
    if (r.status !== "draft") throw new TaxConfigError("Only draft rules can be approved.");
    // Two approved rules for the same component, place and category must not overlap in time.
    const others = await tx
      .select()
      .from(taxRules)
      .where(and(eq(taxRules.jurisdiction, r.jurisdiction), eq(taxRules.component, r.component), eq(taxRules.status, "approved"), r.serviceCategory ? eq(taxRules.serviceCategory, r.serviceCategory) : isNull(taxRules.serviceCategory)));
    const overlaps = others.some((o) => o.effectiveFrom <= (r.effectiveTo ?? "9999-12-31") && r.effectiveFrom <= (o.effectiveTo ?? "9999-12-31"));
    if (overlaps) throw new TaxConfigError("An approved rule already covers part of these dates. Retire it or give it an end date first.");
    await tx.update(taxRules).set({ status: "approved", approvedBy: actorId, approvedAt: new Date(), approvalReference: ref }).where(eq(taxRules.id, ruleId));
    await recordAudit({ actorId, action: "tax.rule_approve", entityType: "tax_rule", entityId: ruleId, reason: ref }, tx);
  });
}

export async function retireTaxRule(actorId: string, ruleId: string, reason: string) {
  if (!reason.trim()) throw new TaxConfigError("Give a reason.");
  await db.transaction(async (tx) => {
    const [r] = await tx.update(taxRules).set({ status: "retired" }).where(eq(taxRules.id, ruleId)).returning();
    if (!r) throw new TaxConfigError("Rule not found.");
    await recordAudit({ actorId, action: "tax.rule_retire", entityType: "tax_rule", entityId: ruleId, reason }, tx);
  });
}

// ─── Treatments per compensation category ───────────────────────────────────────

const treatmentSchema = z.object({
  category: z.enum(PAYABLE_CATEGORIES),
  gstHst: z.enum(GST_HST_TREATMENTS),
  yearEnd: z.enum(YEAR_END_TREATMENTS),
  yearEndBox: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(20).nullable().optional()),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** Records a proposed treatment. Any change clears the accountant approval. */
export async function saveTreatment(actorId: string, raw: z.input<typeof treatmentSchema>) {
  const v = treatmentSchema.parse(raw);
  if (v.yearEnd === "other_box" && !v.yearEndBox) throw new TaxConfigError("Enter the box number for this category.");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(compensationTaxTreatments).where(eq(compensationTaxTreatments.category, v.category));
    const values = { gstHst: v.gstHst, yearEnd: v.yearEnd, yearEndBox: v.yearEnd === "other_box" ? (v.yearEndBox ?? null) : v.yearEnd === "box_048" ? "048" : null, notes: v.notes ?? null, updatedBy: actorId };
    const changed = !before || before.gstHst !== values.gstHst || before.yearEnd !== values.yearEnd || before.yearEndBox !== values.yearEndBox;
    await tx
      .insert(compensationTaxTreatments)
      .values({ category: v.category, ...values })
      .onConflictDoUpdate({ target: compensationTaxTreatments.category, set: { ...values, ...(changed ? { approvedAt: null, approvedBy: null, approvalReference: null } : {}) } });
    await recordAudit({ actorId, action: "tax.treatment_save", entityType: "tax_treatment", entityId: v.category, before: before ? { gstHst: before.gstHst, yearEnd: before.yearEnd } : null, after: { gstHst: values.gstHst, yearEnd: values.yearEnd, yearEndBox: values.yearEndBox } }, tx);
  });
}

export async function approveTreatment(actorId: string, category: string, rawReference: string) {
  const ref = reference.parse(rawReference);
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(compensationTaxTreatments).where(eq(compensationTaxTreatments.category, category)).for("update");
    if (!t) throw new TaxConfigError("Category not found.");
    if (t.gstHst === "review" && t.yearEnd === "review") throw new TaxConfigError("Choose a treatment before approving it.");
    await tx.update(compensationTaxTreatments).set({ approvedBy: actorId, approvedAt: new Date(), approvalReference: ref }).where(eq(compensationTaxTreatments.category, category));
    await recordAudit({ actorId, action: "tax.treatment_approve", entityType: "tax_treatment", entityId: category, after: { gstHst: t.gstHst, yearEnd: t.yearEnd, yearEndBox: t.yearEndBox }, reason: ref }, tx);
  });
}

/** Switches automatic calculation on (needs the accountant's sign-off reference) or off. */
export async function setAutoTax(actorId: string, enabled: boolean, rawReference: string | null) {
  const ref = enabled ? reference.parse(rawReference ?? "") : (rawReference?.trim() || null);
  await db.transaction(async (tx) => {
    if (enabled) {
      const [approvedRule] = await tx.select({ id: taxRules.id }).from(taxRules).where(eq(taxRules.status, "approved")).limit(1);
      if (!approvedRule) throw new TaxConfigError("Approve at least one tax rule first.");
    }
    await tx
      .update(orgSettings)
      .set(enabled ? { autoTaxEnabled: true, autoTaxApprovedBy: actorId, autoTaxApprovedAt: new Date(), autoTaxApprovalReference: ref } : { autoTaxEnabled: false, updatedBy: actorId })
      .where(eq(orgSettings.id, 1));
    await recordAudit({ actorId, action: enabled ? "tax.auto_on" : "tax.auto_off", entityType: "org_settings", entityId: "1", reason: ref }, tx);
  });
}

const recoverabilitySchema = z.record(z.enum(TAX_COMPONENTS), z.enum(["recoverable", "non_recoverable", "unconfirmed"]));

/** Whether RGXM recovers each tax component (input tax credits), as confirmed by the accountant. */
export async function setTaxRecoverability(actorId: string, raw: Record<string, string>) {
  const v = recoverabilitySchema.parse(raw);
  await db.transaction(async (tx) => {
    await tx.update(orgSettings).set({ taxRecoverability: v, updatedBy: actorId }).where(eq(orgSettings.id, 1));
    await recordAudit({ actorId, action: "tax.recoverability", entityType: "org_settings", entityId: "1", after: v }, tx);
  });
}

// ─── Registration verification (Finance) ─────────────────────────────────────────

/** Finance records that a contractor's GST/HST answer was checked (or couldn't be), with evidence. */
export async function verifyGstRegistration(actorId: string, staffId: string, input: { outcome: "verified" | "rejected"; reference: string }) {
  const ref = input.reference.trim();
  if (ref.length < 3) throw new TaxConfigError("Record the evidence (e.g. CRA GST/HST registry lookup on 2026-11-09, confirmation number).");
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(staffSensitive).where(eq(staffSensitive.staffId, staffId)).for("update");
    if (!s) throw new TaxConfigError("This contractor hasn't answered the GST/HST question yet.");
    if (s.gstRegistrationStatus === "unknown" || s.gstRegistrationStatus === "unsure") {
      throw new TaxConfigError("Ask the contractor to confirm whether they're registered (Yes or No) before verifying.");
    }
    if (input.outcome === "verified" && s.gstRegistrationStatus === "yes" && !s.gstHstNumber) throw new TaxConfigError("A registration number is needed to verify a registered contractor.");
    await tx.update(staffSensitive).set({ gstVerificationStatus: input.outcome, gstVerifiedBy: actorId, gstVerifiedAt: new Date(), gstVerificationReference: ref }).where(eq(staffSensitive.staffId, staffId));
    await recordAudit({ actorId, action: `staff.gst_${input.outcome}`, entityType: "staff_profile", entityId: staffId, after: { status: s.gstRegistrationStatus, outcome: input.outcome } }, tx);
  });
}
