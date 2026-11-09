// Bank payment file builders (pure apart from ExcelJS). Each format is a plain file Finance
// uploads to the bank; nothing here sends money, and generating a file never settles a payment.
// Accounting (bill) exports are separate: see accounting-exports.ts.
import ExcelJS from "exceljs";
import { toCsv } from "@/lib/csv";
import { centsToDecimal, minutesToDecimalHours, type BatchType } from "./pay-rules";
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
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { data: buf, fileName: `${base}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", rowCount: data.length };
}
