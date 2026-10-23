import { describe, expect, it } from "vitest";
import { availabilityOnDate } from "@/lib/availability";
import { parseCsv, safeCell, toCsv } from "@/lib/csv";

describe("availabilityOnDate", () => {
  const rules = [{ weekday: 6, startTime: "08:00", endTime: "22:00" }]; // Saturdays

  it("uses the weekly pattern", () => {
    expect(availabilityOnDate(rules, [], "2026-11-14")).toBe("available"); // Saturday
    expect(availabilityOnDate(rules, [], "2026-11-13")).toBe("unknown"); // Friday
  });

  it("lets a date exception override the pattern", () => {
    expect(availabilityOnDate(rules, [{ date: "2026-11-14", kind: "unavailable", startTime: null, endTime: null }], "2026-11-14")).toBe("unavailable");
    expect(availabilityOnDate([], [{ date: "2026-11-13", kind: "available", startTime: null, endTime: null }], "2026-11-13")).toBe("available");
  });

  it("never treats missing data as unavailable", () => {
    expect(availabilityOnDate([], [], "2026-11-14")).toBe("unknown");
  });
});

describe("CSV", () => {
  it("neutralises spreadsheet formulas (CSV injection)", () => {
    expect(safeCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(safeCell("+1 416")).toBe("'+1 416");
    expect(safeCell("@sum")).toBe("'@sum");
    expect(safeCell("Toronto")).toBe("Toronto");
    expect(safeCell(null)).toBe("");
  });

  it("round-trips quoted values and normalises headers", () => {
    const csv = toCsv(["First Name", "notes"], [["Ana", 'Said "hi", left']]);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(["first_name", "notes"]);
    expect(parsed.rows[0]).toEqual({ first_name: "Ana", notes: 'Said "hi", left' });
  });

  it("strips a UTF-8 BOM from Excel exports", () => {
    expect(parseCsv("﻿email\nx@y.test\n").headers).toEqual(["email"]);
  });
});
