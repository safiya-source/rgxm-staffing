// Sales-tax decision for one bill line (pure; unit-tested in tests/unit/tax-engine.test.ts).
//
// Automatic calculation only happens when every input is accountant-approved: the org switch,
// the compensation category's treatment, the project's service category, and an effective-dated
// rule for the event province. The rate comes from the EVENT province for qualifying onsite
// services, never from the contractor's address or GPS. Anything else is routed to Finance.
import { formatRatePpm, taxOnCents } from "./money";

export type RegistrationStatus = "yes" | "no" | "unsure" | "unknown";
export type VerificationStatus = "unverified" | "verified" | "rejected";
export type SupplyType = "onsite" | "offsite" | "mixed" | "multi_province";
export type GstHstTreatment = "taxable" | "not_taxable" | "review";

export type TaxRuleInput = {
  id: string;
  jurisdiction: string;
  component: string;
  ratePpm: number;
  serviceCategory: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
};

export type TaxContext = {
  autoTaxEnabled: boolean;
  project: { eventProvince: string | null; serviceCategory: string | null; supplyType: string };
  serviceCategory: { key: string; label: string; placeOfSupplyRule: string; approved: boolean; active: boolean } | null;
  registration: { status: RegistrationStatus; verification: VerificationStatus; effectiveDate: string | null; number: string | null };
  treatment: { gstHst: GstHstTreatment; approved: boolean } | null;
  rules: TaxRuleInput[];
};

export type TaxLine = {
  component: string;
  jurisdiction: string;
  ratePpm: number;
  taxableCents: number;
  taxCents: number;
  taxRuleId: string | null;
  serviceCategory: string | null;
  basis: string;
};

export type TaxDecision = {
  status: "calculated" | "no_tax" | "review_required";
  lines: TaxLine[];
  taxCents: number;
  basis: string;
  /** Short registration key stored with the line so later profile changes can be detected. */
  registrationSnapshot: string;
};

export const CATEGORY_LABEL: Record<string, string> = {
  fee: "Hourly fees",
  meal_breakfast: "Breakfast allowance",
  meal_lunch: "Lunch allowance",
  meal_dinner: "Dinner allowance",
  per_diem: "Full-day per diem",
  mileage: "Mileage",
  bonus: "Bonus",
  reimbursement: "Expense reimbursement",
  adjustment: "Adjustment",
};

/**
 * Reimbursement of an expense the contractor paid on RGXM's behalf (with a receipt) is repaid at cost
 * and never carries GST/HST, whatever the contractor's registration. Every other category follows the
 * accountant-approved treatment.
 */
export const NEVER_TAXED_CATEGORIES = ["reimbursement"] as const;
const NEVER_TAXED = new Set<string>(NEVER_TAXED_CATEGORIES);

export function registrationSnapshot(r: TaxContext["registration"]) {
  return `${r.status}:${r.verification}`;
}

function review(ctx: TaxContext, reason: string): TaxDecision {
  return { status: "review_required", lines: [], taxCents: 0, basis: `Finance review: ${reason}`, registrationSnapshot: registrationSnapshot(ctx.registration) };
}

/** Rules in force for a jurisdiction on a date. Category-specific rules replace generic ones per component. */
export function applicableRules(rules: TaxRuleInput[], jurisdiction: string, date: string, serviceCategory: string | null) {
  const live = rules.filter(
    (r) => r.status === "approved" && r.jurisdiction === jurisdiction && r.effectiveFrom <= date && (r.effectiveTo == null || r.effectiveTo >= date) && (r.serviceCategory == null || r.serviceCategory === serviceCategory),
  );
  const byComponent = new Map<string, TaxRuleInput>();
  for (const r of live) {
    const current = byComponent.get(r.component);
    // Prefer a category-specific rule, then the most recent effective date.
    if (!current || (r.serviceCategory && !current.serviceCategory) || (Boolean(r.serviceCategory) === Boolean(current.serviceCategory) && r.effectiveFrom > current.effectiveFrom)) {
      byComponent.set(r.component, r);
    }
  }
  return [...byComponent.values()].sort((a, b) => a.component.localeCompare(b.component));
}

export function decideTax(ctx: TaxContext, line: { category: string; amountCents: number; workDate: string }): TaxDecision {
  const snap = registrationSnapshot(ctx.registration);
  if (NEVER_TAXED.has(line.category)) {
    return { status: "no_tax", lines: [], taxCents: 0, basis: "No GST/HST: reimbursement at cost of an expense paid on RGXM's behalf (receipt on file).", registrationSnapshot: snap };
  }
  const reg = ctx.registration;
  if (reg.status === "unknown") return review(ctx, "the contractor hasn't said whether they're registered for GST/HST.");
  if (reg.status === "unsure") return review(ctx, "the contractor is unsure whether they're registered for GST/HST.");
  if (reg.verification === "rejected") return review(ctx, "Finance couldn't verify the contractor's GST/HST registration.");
  if (reg.verification !== "verified") return review(ctx, `the contractor's GST/HST status ("${reg.status}") hasn't been verified by Finance.`);
  if (reg.status === "no") {
    return { status: "no_tax", lines: [], taxCents: 0, basis: "No GST/HST: contractor not registered (verified by Finance).", registrationSnapshot: snap };
  }
  if (reg.effectiveDate && reg.effectiveDate > line.workDate) return review(ctx, `the GST/HST registration takes effect ${reg.effectiveDate}, after the work date ${line.workDate}.`);
  if (!ctx.autoTaxEnabled) return review(ctx, "automatic tax calculation is off until RGXM's accountant approves the tax rules.");
  const label = CATEGORY_LABEL[line.category] ?? line.category;
  if (!ctx.treatment || !ctx.treatment.approved || ctx.treatment.gstHst === "review") return review(ctx, `the tax treatment for ${label.toLowerCase()} hasn't been approved by the accountant.`);
  if (ctx.treatment.gstHst === "not_taxable") {
    return { status: "no_tax", lines: [], taxCents: 0, basis: `No GST/HST: accountant-approved treatment for ${label.toLowerCase()}.`, registrationSnapshot: snap };
  }
  const p = ctx.project;
  if (p.supplyType !== "onsite") {
    const what = { offsite: "offsite work", mixed: "a mixed supply", multi_province: "a multi-province contract" }[p.supplyType as Exclude<SupplyType, "onsite">] ?? `supply type "${p.supplyType}"`;
    return review(ctx, `the project is set up as ${what}, which isn't calculated automatically.`);
  }
  if (!p.eventProvince) return review(ctx, "the project has no event province.");
  const sc = ctx.serviceCategory;
  if (!p.serviceCategory || !sc) return review(ctx, "the project has no service category.");
  if (!sc.approved || !sc.active) return review(ctx, `the service category "${sc.label}" isn't approved.`);
  if (sc.placeOfSupplyRule !== "event_province") return review(ctx, `"${sc.label}" is set to always go to Finance.`);
  const rules = applicableRules(ctx.rules, p.eventProvince, line.workDate, sc.key);
  if (!rules.length) return review(ctx, `there's no approved tax rule for ${p.eventProvince} on ${line.workDate}.`);
  const lines: TaxLine[] = rules.map((r) => ({
    component: r.component,
    jurisdiction: r.jurisdiction,
    ratePpm: r.ratePpm,
    taxableCents: line.amountCents,
    taxCents: taxOnCents(line.amountCents, r.ratePpm),
    taxRuleId: r.id,
    serviceCategory: sc.key,
    basis: `${r.component} ${formatRatePpm(r.ratePpm)} (${r.jurisdiction}, rule effective ${r.effectiveFrom}): onsite "${sc.label}" in the event province; contractor registered${reg.number ? ` (${reg.number})` : ""}, verified by Finance.`,
  }));
  const taxCents = lines.reduce((n, l) => n + l.taxCents, 0);
  return {
    status: "calculated",
    lines,
    taxCents,
    basis: `Calculated for ${p.eventProvince} (event province), "${sc.label}": ${lines.map((l) => `${l.component} ${formatRatePpm(l.ratePpm)}`).join(" + ")}.`,
    registrationSnapshot: snap,
  };
}

/** Tax lines for an adjustment: the same components and rates as the line it corrects. */
export function mirrorTaxLines(original: Pick<TaxLine, "component" | "jurisdiction" | "ratePpm" | "taxRuleId" | "serviceCategory">[], amountCents: number, originalLabel: string): TaxLine[] {
  return original.map((l) => ({
    ...l,
    taxableCents: amountCents,
    taxCents: taxOnCents(amountCents, l.ratePpm),
    basis: `Adjustment to ${originalLabel}: same ${l.component} ${formatRatePpm(l.ratePpm)} (${l.jurisdiction}) as the original line.`,
  }));
}
