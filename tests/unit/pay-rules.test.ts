import { describe, expect, it } from "vitest";
import { buildExport, type ExportRow } from "@/server/domain/payment-exports";
import { basePayCents, batchTypeFor, dueDateFor, canMoveBatch, canMovePayable, centsToDecimal, esaHints, hstCents, minutesToDecimalHours, payPeriodFor } from "@/server/domain/pay-rules";

describe("base pay", () => {
  it("is minutes × rate, rounded half up to the cent", () => {
    expect(basePayCents(480, 2500)).toBe(20000); // 8 h × $25
    expect(basePayCents(1, 2500)).toBe(42); // 41.67 → 42
    expect(basePayCents(1, 1830)).toBe(31); // 30.5 → 31 (half up)
    expect(basePayCents(1, 1770)).toBe(30); // 29.5 → 30
    expect(basePayCents(437, 1999)).toBe(14559); // 14559.38 → 14559
    expect(basePayCents(0, 2500)).toBe(0);
  });
  it("rejects fractional or negative inputs", () => {
    expect(() => basePayCents(1.5, 2500)).toThrow();
    expect(() => basePayCents(60, -1)).toThrow();
  });
});

describe("pay periods (semi-monthly by default)", () => {
  it("splits each month at the 15th, including short and leap months", () => {
    expect(payPeriodFor("2026-11-12")).toEqual({ startsOn: "2026-11-01", endsOn: "2026-11-15", label: "Nov 1–15, 2026" });
    expect(payPeriodFor("2026-11-16")).toMatchObject({ startsOn: "2026-11-16", endsOn: "2026-11-30" });
    expect(payPeriodFor("2027-02-20")).toMatchObject({ endsOn: "2027-02-28" });
    expect(payPeriodFor("2028-02-29")).toMatchObject({ startsOn: "2028-02-16", endsOn: "2028-02-29" });
    expect(payPeriodFor("2026-12-31", "monthly")).toMatchObject({ startsOn: "2026-12-01", endsOn: "2026-12-31" });
  });
});

describe("classification and state machines", () => {
  it("keeps contractors and employees in separate batches and blocks unset", () => {
    expect(batchTypeFor("contractor")).toBe("contractor");
    expect(batchTypeFor("employee")).toBe("payroll");
    expect(batchTypeFor("unset")).toBeNull();
  });
  it("only allows the documented payable and batch transitions", () => {
    expect(canMovePayable("pending", "batched")).toBe(true);
    expect(canMovePayable("pending", "paid")).toBe(false);
    expect(canMovePayable("paid", "pending")).toBe(false);
    expect(canMovePayable("exported", "void")).toBe(false);
    expect(canMovePayable("failed", "batched")).toBe(true);
    expect(canMoveBatch("draft", "exported")).toBe(false);
    expect(canMoveBatch("approved", "exported")).toBe(true);
    expect(canMoveBatch("paid", "void")).toBe(false);
  });
  it("flags possible ESA review points for employees only, without changing pay", () => {
    expect(esaHints({ classification: "employee", payableMinutes: 150, weekMinutes: 150 })).toEqual(["under_3_hours"]);
    expect(esaHints({ classification: "employee", payableMinutes: 480, weekMinutes: 45 * 60 })).toEqual(["weekly_over_44"]);
    expect(esaHints({ classification: "contractor", payableMinutes: 150, weekMinutes: 50 * 60 })).toEqual([]);
  });
  it("calculates 13% HST rounded half up", () => {
    expect(hstCents(20000)).toBe(2600);
    expect(hstCents(1234)).toBe(160); // 160.42
    expect(hstCents(1250)).toBe(163); // 162.5 → 163
    expect(hstCents(0)).toBe(0);
  });
  it("formats export numbers without locale", () => {
    expect(centsToDecimal(123456)).toBe("1234.56");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(minutesToDecimalHours(435)).toBe("7.25");
    expect(minutesToDecimalHours(437)).toBe("7.28");
  });
});

describe("payment due dates", () => {
  it("follow the contractor agreement: 1st–15th due by month end, 16th–end due by the 15th of next month", () => {
    expect(dueDateFor("semi_monthly_agreement", { billDate: "2026-11-20", earliestServiceDate: "2026-11-03" })).toBe("2026-11-30");
    expect(dueDateFor("semi_monthly_agreement", { billDate: "2026-12-02", earliestServiceDate: "2026-11-16" })).toBe("2026-12-15");
    expect(dueDateFor("semi_monthly_agreement", { billDate: "2027-01-03", earliestServiceDate: "2026-12-31" })).toBe("2027-01-15");
    expect(dueDateFor("semi_monthly_agreement", { billDate: "2028-02-10", earliestServiceDate: "2028-02-15" })).toBe("2028-02-29");
    expect(dueDateFor("days_after_bill", { billDate: "2026-11-20", earliestServiceDate: "2026-11-03", days: 14 })).toBe("2026-12-04");
  });
});

describe("export files", () => {
  const row: ExportRow = {
    payableId: "p1",
    billNumber: null,
    category: "fee",
    description: "BA 8.00 h",
    staffName: "=HYPERLINK(\"x\")",
    legalName: null,
    email: "a@example.test",
    projectCode: "CAD-1",
    projectName: "Cadbury",
    serviceDate: "2026-11-12",
    role: "BA",
    payableMinutes: 480,
    rateCents: 2500,
    subtotalCents: 20000,
    hstCents: 0,
    gstHstNumber: null,
    totalCents: 20000,
    currency: "CAD",
  };
  it("writes a generic CSV with formula-safe cells and the demo marker", async () => {
    const f = await buildExport("csv_generic", { reference: "CON-20261101-1", type: "contractor", periodLabel: "Nov 1–15, 2026", isDemo: true }, [row], "2026-11-20");
    const text = f.data.toString("utf8");
    expect(f.fileName).toBe("DEMO-CON-20261101-1.csv");
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("DEMO - DO NOT PAY");
    expect(text).toContain("8.00,25.00,200.00,0.00,200.00,,CAD");
    expect(text).toContain("Hourly fees");
    expect(f.rowCount).toBe(1);
  });
  it("bank files never use the accounting (QuickBooks) format", async () => {
    await expect(buildExport("csv_qbo" as "xlsx", { reference: "CON-1", type: "contractor", periodLabel: null, isDemo: false }, [row], "2026-11-20")).rejects.toThrow(/Unsupported/);
  });
  it("puts tax in its own column and identifies the bill and category", async () => {
    const hst = { ...row, billNumber: "CRW-B-000042", hstCents: 2600, totalCents: 22600, gstHstNumber: "123456789RT0001" };
    const generic = (await buildExport("csv_generic", { reference: "CON-2", type: "contractor", periodLabel: null, isDemo: false }, [hst, { ...row, category: "mileage", description: "Mileage: 12 km", payableMinutes: 0, subtotalCents: 876, totalCents: 876 }], "2026-11-20")).data.toString("utf8");
    expect(generic).toContain("CON-2,CRW-B-000042");
    expect(generic).toContain("Hourly fees,BA 8.00 h,8.00,25.00,200.00,26.00,226.00,123456789RT0001,CAD");
    expect(generic).toContain("Mileage,Mileage: 12 km,,,8.76,0.00,8.76,,CAD");
  });
  it("writes an xlsx workbook", async () => {
    const f = await buildExport("xlsx", { reference: "CON-1", type: "contractor", periodLabel: null, isDemo: false }, [row], "2026-11-20");
    expect(f.data.subarray(0, 2).toString()).toBe("PK");
  });
});
