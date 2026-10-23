import Papa from "papaparse";

// Spreadsheet apps execute cells that start with these characters as formulas (CSV injection).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return FORMULA_PREFIX.test(s) ? `'${s}` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return Papa.unparse({ fields: headers, data: rows.map((r) => r.map(safeCell)) }, { newline: "\r\n" });
}

export function parseCsv(text: string) {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"),
    transform: (v) => v.trim(),
  });
  return { rows: result.data, headers: result.meta.fields ?? [], errors: result.errors };
}
