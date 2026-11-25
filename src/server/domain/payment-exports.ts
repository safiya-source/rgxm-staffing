// Bank payment file builders (pure apart from ExcelJS). Each format is a plain file Finance
// uploads to the bank; nothing here sends money, and generating a file never settles a payment.
// Accounting (bill) exports are separate: see accounting-exports.ts.
import ExcelJS from "exceljs";
import { toCsv } from "@/lib/csv";
import { centsToDecimal, minutesToDecimalHours, type BatchType } from "./pay-rules";
import { paySummaryRows, tallyByPerson, tallyByProject, tallySheetRows } from "./project-tally";
import { CATEGORY_LABEL } from "./tax-engine";

export const EXPORT_FORMATS = ["csv_generic", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_FORMAT_LABEL: Record<string, string> = {
  csv_generic: "Bank file (CSV)",
  xlsx: "Bank file (Excel)",
  // Older batches exported QuickBooks bills from the batch; kept for display only.
  csv_qbo: "QuickBooks-style bills (legacy)",
};

export type ExportRow = {
  payableId: string;
  billNumber: string | null;
  staffName: string;
  legalName: string | null;
  email: string | null;
  projectCode: string;
  projectName: string;
  serviceDate: string;
  category: string;
  description: string | null;
  role: string;
  payableMinutes: number;
  rateCents: number;
  /** Before tax. */
  subtotalCents: number;
  hstCents: number;
  gstHstNumber: string | null;
  totalCents: number;
  currency: string;
};

export type ExportBatch = { reference: string; type: BatchType; periodLabel: string | null; isDemo: boolean };

const DEMO_NOTE = "DEMO - DO NOT PAY";

function genericRows(batch: ExportBatch, rows: ExportRow[]) {
  const headers = ["Batch", "Bill number", "Pay period", "Payee", "Legal/business name", "Email", "Project code", "Project", "Service date", "Category", "Description", "Hours", "Rate", "Subtotal", "Tax", "Amount", "GST/HST number", "Currency", "Line ID", "Note"];
  const data = rows.map((r) => [
    batch.reference,
    r.billNumber ?? "",
    batch.periodLabel ?? "",
    r.staffName,
    r.legalName ?? "",
    r.email ?? "",
    r.projectCode,
    r.projectName,
    r.serviceDate,
    CATEGORY_LABEL[r.category] ?? r.category,
    r.description ?? "",
    r.category === "fee" ? minutesToDecimalHours(r.payableMinutes) : "",
    r.category === "fee" ? centsToDecimal(r.rateCents) : "",
    centsToDecimal(r.subtotalCents),
    centsToDecimal(r.hstCents),
    centsToDecimal(r.totalCents),
    r.gstHstNumber ?? "",
    r.currency,
    r.payableId,
    batch.isDemo ? DEMO_NOTE : "",
  ]);
  return { headers, data };
}

const NUMERIC_COLUMNS = new Set([11, 12, 13, 14, 15]);

export async function buildExport(format: ExportFormat, batch: ExportBatch, rows: ExportRow[], fileDate: string) {
  const base = `${batch.isDemo ? "DEMO-" : ""}${batch.reference}`;
  const { headers, data } = genericRows(batch, rows);
  if (format === "csv_generic") {
    return { data: Buffer.from(`﻿${toCsv(headers, data)}`, "utf8"), fileName: `${base}.csv`, contentType: "text/csv; charset=utf-8", rowCount: data.length };
  }
  if (format !== "xlsx") throw new Error(`Unsupported bank file format ${format}`);
  const wb = new ExcelJS.Workbook();
  wb.creator = "RGXM Crew";
  // Fixed timestamps keep the file (and its fingerprint) reproducible for the same batch.
  wb.created = wb.modified = new Date(`${fileDate}T00:00:00Z`);
  const ws = wb.addWorksheet(batch.isDemo ? "DEMO - DO NOT PAY" : batch.reference);
  ws.addRow(headers).font = { bold: true };
  for (const r of data) {
    // Numbers as numbers so totals work in Excel; text cells are written as text (no formulas).
    ws.addRow(r.map((v, i) => (NUMERIC_COLUMNS.has(i) && v !== "" ? Number(v) : v)));
  }
  ws.columns.forEach((c) => (c.width = 16));
  const tally = rows.map((r) => ({ projectCode: r.projectCode, projectName: r.projectName, staffName: r.staffName, email: r.email, subtotalCents: r.subtotalCents, taxCents: r.hstCents, totalCents: r.totalCents }));
  addPaySummarySheet(wb, tally, batch.isDemo);
  addProjectSheet(wb, tally, batch.isDemo);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { data: buf, fileName: `${base}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", rowCount: data.length };
}

/** A "By project" sheet: each contractor's total per project, with project subtotals. */
export function addProjectSheet(wb: ExcelJS.Workbook, lines: Parameters<typeof tallyByProject>[0], isDemo: boolean) {
  const ws = wb.addWorksheet(isDemo ? "By project (DEMO)" : "By project");
  const rows = tallySheetRows(tallyByProject(lines), (c) => Number(centsToDecimal(c)));
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    if (i === 0 || String(r[0] ?? "").endsWith("subtotal") || r[0] === "Batch total") row.font = { bold: true };
  });
  for (const col of [5, 6, 7]) ws.getColumn(col).numFmt = "#,##0.00";
  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 26;
  ws.getColumn(3).width = 32;
  for (const col of [4, 5, 6, 7]) ws.getColumn(col).width = 14;
  if (isDemo) ws.addRow(["DEMO - DO NOT PAY"]);
}

/** A "Pay summary" sheet: one row per contractor with their email and the total to send them. */
export function addPaySummarySheet(wb: ExcelJS.Workbook, lines: Parameters<typeof tallyByProject>[0], isDemo: boolean) {
  const ws = wb.addWorksheet(isDemo ? "Pay summary (DEMO)" : "Pay summary");
  const rows = paySummaryRows(tallyByPerson(lines), (c) => Number(centsToDecimal(c)));
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    if (i === 0 || r[0] === "Batch total") row.font = { bold: true };
  });
  for (const col of [3, 4, 5]) ws.getColumn(col).numFmt = "#,##0.00";
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 16;
  for (const col of [4, 5, 6]) ws.getColumn(col).width = 12;
  if (isDemo) ws.addRow(["DEMO - DO NOT PAY"]);
}

/** A standalone pay summary by project (Excel) to share with the finance team. Not a bank file. */
export async function buildProjectSummary(batch: ExportBatch, lines: Parameters<typeof tallyByProject>[0]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RGXM Crew";
  addPaySummarySheet(wb, lines, batch.isDemo);
  addProjectSheet(wb, lines, batch.isDemo);
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  return { data, fileName: `${batch.isDemo ? "DEMO-" : ""}${batch.reference}-by-project.xlsx` };
}
