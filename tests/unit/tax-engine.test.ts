import { describe, expect, it } from "vitest";
import { dollarsToCents, formatRatePpm, multiplyToCents, normalizeKm, percentToPpm, taxOnCents } from "@/server/domain/money";
import { applicableRules, decideTax, mirrorTaxLines, type TaxContext, type TaxRuleInput } from "@/server/domain/tax-engine";

describe("decimal money", () => {
  it("multiplies km × rate exactly and rounds once to the cent", () => {
    expect(multiplyToCents("123.45", "0.73")).toBe(9012); // 90.1185 → 90.12
    expect(multiplyToCents("10", "0.7300")).toBe(730);
    expect(multiplyToCents("0.5", "0.73")).toBe(37); // 0.365 → 0.37 (half up)
    expect(multiplyToCents("0.1", "0.1")).toBe(1); // 0.01 exactly, no float drift
    // A floating-point version gets this one wrong (1.005 * 100 = 100.49999…).
    expect(dollarsToCents("1.005")).toBe(101);
  });
  it("computes tax in ppm, half away from zero for credits", () => {
    expect(taxOnCents(10000, 130000)).toBe(1300);
    expect(taxOnCents(2825, 130000)).toBe(367); // 367.25
    expect(taxOnCents(1000, 99750)).toBe(100); // 99.75 → 100 (QST 9.975%)
    expect(taxOnCents(-2825, 130000)).toBe(-367);
    expect(taxOnCents(-50, 100000)).toBe(-5);
  });
  it("formats and parses rates", () => {
    expect(formatRatePpm(130000)).toBe("13%");
    expect(formatRatePpm(99750)).toBe("9.975%");
    expect(percentToPpm("9.975")).toBe(99750);
    expect(() => percentToPpm("60")).toThrow();
  });
  it("validates kilometres", () => {
    expect(normalizeKm("12.5")).toBe("12.5");
    expect(() => normalizeKm("1.234")).toThrow();
    expect(() => normalizeKm("0")).toThrow();
    expect(() => normalizeKm("abc")).toThrow();
  });
});

const ON_HST: TaxRuleInput = { id: "r-on", jurisdiction: "ON", component: "HST", ratePpm: 130000, serviceCategory: null, effectiveFrom: "2010-07-01", effectiveTo: null, status: "approved" };

function ctx(over: Partial<TaxContext> = {}): TaxContext {
  return {
    autoTaxEnabled: true,
    project: { eventProvince: "ON", serviceCategory: "event_staff_onsite", supplyType: "onsite" },
    serviceCategory: { key: "event_staff_onsite", label: "Onsite event staffing", placeOfSupplyRule: "event_province", approved: true, active: true },
    registration: { status: "yes", verification: "verified", effectiveDate: "2020-01-01", number: "123456789RT0001" },
    treatment: { gstHst: "taxable", approved: true },
    rules: [ON_HST],
    ...over,
  };
}
const line = { category: "fee", amountCents: 20000, workDate: "2026-11-01" };

describe("tax decisions", () => {
  it("calculates from the event province for a verified, registered contractor", () => {
    const d = decideTax(ctx(), line);
    expect(d.status).toBe("calculated");
    expect(d.taxCents).toBe(2600);
    expect(d.lines).toEqual([expect.objectContaining({ component: "HST", jurisdiction: "ON", ratePpm: 130000, taxableCents: 20000, taxCents: 2600, taxRuleId: "r-on" })]);
    expect(d.basis).toContain("event province");
  });

  it("uses the event province even when the contractor lives elsewhere (address is never an input)", () => {
    const qc = [
      { ...ON_HST, id: "gst", jurisdiction: "QC", component: "GST", ratePpm: 50000 },
      { ...ON_HST, id: "qst", jurisdiction: "QC", component: "QST", ratePpm: 99750 },
    ];
    const d = decideTax(ctx({ project: { eventProvince: "QC", serviceCategory: "event_staff_onsite", supplyType: "onsite" }, rules: [ON_HST, ...qc] }), line);
    expect(d.lines.map((l) => [l.component, l.taxCents])).toEqual([
      ["GST", 1000],
      ["QST", 1995],
    ]);
    expect(d.taxCents).toBe(2995);
  });

  it("routes unknown, unsure, unverified and rejected registrations to Finance", () => {
    for (const registration of [
      { status: "unknown", verification: "unverified" },
      { status: "unsure", verification: "unverified" },
      { status: "yes", verification: "unverified" },
      { status: "no", verification: "unverified" },
      { status: "yes", verification: "rejected" },
    ] as const) {
      const d = decideTax(ctx({ registration: { ...registration, effectiveDate: null, number: null } }), line);
      expect(d.status, JSON.stringify(registration)).toBe("review_required");
      expect(d.taxCents).toBe(0);
    }
  });

  it("adds no tax for a verified non-registrant, whatever the other settings", () => {
    const d = decideTax(ctx({ autoTaxEnabled: false, registration: { status: "no", verification: "verified", effectiveDate: null, number: null } }), line);
    expect(d).toMatchObject({ status: "no_tax", taxCents: 0, lines: [] });
  });

  it("needs every approval before calculating", () => {
    expect(decideTax(ctx({ autoTaxEnabled: false }), line).status).toBe("review_required");
    expect(decideTax(ctx({ treatment: { gstHst: "taxable", approved: false } }), line).status).toBe("review_required");
    expect(decideTax(ctx({ treatment: { gstHst: "review", approved: true } }), line).status).toBe("review_required");
    expect(decideTax(ctx({ treatment: null }), line).status).toBe("review_required");
    expect(decideTax(ctx({ serviceCategory: { ...ctx().serviceCategory!, approved: false } }), line).status).toBe("review_required");
    expect(decideTax(ctx({ serviceCategory: { ...ctx().serviceCategory!, placeOfSupplyRule: "finance_review" } }), line).status).toBe("review_required");
    expect(decideTax(ctx({ rules: [{ ...ON_HST, status: "draft" }] }), line).status).toBe("review_required");
  });

  it("routes offsite, mixed and multi-province work and missing setup to Finance", () => {
    for (const supplyType of ["offsite", "mixed", "multi_province"]) {
      expect(decideTax(ctx({ project: { eventProvince: "ON", serviceCategory: "event_staff_onsite", supplyType } }), line).status).toBe("review_required");
    }
    expect(decideTax(ctx({ project: { eventProvince: null, serviceCategory: "event_staff_onsite", supplyType: "onsite" } }), line).status).toBe("review_required");
    expect(decideTax(ctx({ project: { eventProvince: "MB", serviceCategory: "event_staff_onsite", supplyType: "onsite" } }), line).basis).toContain("no approved tax rule for MB");
  });

  it("applies the accountant's per-category treatment instead of taxing everything", () => {
    const d = decideTax(ctx({ treatment: { gstHst: "not_taxable", approved: true } }), { ...line, category: "per_diem" });
    expect(d).toMatchObject({ status: "no_tax", taxCents: 0 });
    expect(d.basis).toContain("per diem");
  });

  it("never taxes allowances, per diems or mileage, even for a verified registrant with a taxable treatment", () => {
    for (const category of ["meal_breakfast", "meal_lunch", "meal_dinner", "per_diem", "mileage"]) {
      const d = decideTax(ctx({ treatment: { gstHst: "taxable", approved: true } }), { ...line, category });
      expect(d).toMatchObject({ status: "no_tax", taxCents: 0, lines: [] });
      expect(d.basis).toMatch(/only on hourly fees and bonuses/);
      // Not even routed to Finance when registration is unclear.
      expect(decideTax(ctx({ registration: { status: "unsure", verification: "unverified", effectiveDate: null, number: null } }), { ...line, category }).status).toBe("no_tax");
    }
    expect(decideTax(ctx({ treatment: { gstHst: "taxable", approved: true } }), { ...line, category: "bonus" }).status).toBe("calculated");
    expect(decideTax(ctx(), line).status).toBe("calculated");
  });

  it("respects effective dates and registration start dates", () => {
    const rules = [
      { ...ON_HST, id: "old", ratePpm: 120000, effectiveFrom: "2000-01-01", effectiveTo: "2025-12-31" },
      { ...ON_HST, id: "new", ratePpm: 130000, effectiveFrom: "2026-01-01" },
    ];
    expect(decideTax(ctx({ rules }), { ...line, workDate: "2025-06-01" }).lines[0]!.taxRuleId).toBe("old");
    expect(decideTax(ctx({ rules }), line).lines[0]!.taxRuleId).toBe("new");
    expect(decideTax(ctx({ registration: { ...ctx().registration, effectiveDate: "2026-11-02" } }), line).status).toBe("review_required");
  });

  it("prefers a category-specific rule over the general one", () => {
    const rules = [ON_HST, { ...ON_HST, id: "special", ratePpm: 50000, serviceCategory: "event_staff_onsite" }];
    expect(applicableRules(rules, "ON", "2026-11-01", "event_staff_onsite").map((r) => r.id)).toEqual(["special"]);
    expect(applicableRules(rules, "ON", "2026-11-01", "chef_onsite").map((r) => r.id)).toEqual(["r-on"]);
  });

  it("mirrors the original line's tax on adjustments, including credits", () => {
    const lines = mirrorTaxLines([{ component: "HST", jurisdiction: "ON", ratePpm: 130000, taxRuleId: "r", serviceCategory: null }], -1000, "line X");
    expect(lines[0]).toMatchObject({ taxableCents: -1000, taxCents: -130 });
  });
});
