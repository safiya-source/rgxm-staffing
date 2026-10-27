// Export file builders (pure apart from ExcelJS). Each format is a plain file Finance imports
// elsewhere; nothing here sends money. Demo batches are marked on every row and in the file name.
import ExcelJS from "exceljs";
import { toCsv } from "@/lib/csv";
import { centsToDecimal, minutesToDecimalHours, type BatchType } from "./pay-rules";

export const EXPORT_FORMATS = ["csv_generic", "csv_qbo", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  csv_generic: "CSV (generic)",
  csv_qbo: "CSV (QuickBooks-style bills)",
  xlsx: "Excel (.xlsx)",
};

export type ExportRow = {
  payableId: string;
  staffName: string;
  legalName: string | null;
  email: string | null;
  projectCode: string;
  projectName: string;
  serviceDate: string;
  role: string;
  payableMinutes: number;
  rateCents: number;
  totalCents: number;
  currency: string;
};

export type ExportBatch = { reference: string; type: BatchType; periodLabel: string | null; isDemo: boolean };

const DEMO_NOTE = "DEMO - DO NOT PAY";

function genericRows(batch: ExportBatch, rows: ExportRow[]) {
  const headers = ["Batch", "Type", "Pay period", "Payee", "Legal/business name", "Email", "Project code", "Project", "Service date", "Role", "Hours", "Rate", "Amount", "Currency", "Payable ID", "Note"];
  const data = rows.map((r) => [
    batch.reference,
    batch.type === "contractor" ? "Contractor" : "Employee",
    batch.periodLabel ?? "",
    r.staffName,
    r.legalName ?? "",
    r.email ?? "",
    r.projectCode,
    r.projectName,
    r.serviceDate,
    r.role,
    minutesToDecimalHours(r.payableMinutes),
    centsToDecimal(r.rateCents),
    centsToDecimal(r.totalCents),
    r.currency,
    r.payableId,
    batch.isDemo ? DEMO_NOTE : "",
  ]);
  return { headers, data };
}

/**
 * One bill line per shift, grouped into one bill per payee via "Bill No". Column names follow
 * QuickBooks Online's bill import; RGXM's accountant should confirm the expense account name.
 */
function qboRows(batch: ExportBatch, rows: ExportRow[], billDate: string) {
  const headers = ["Bill No", "Supplier", "Bill Date", "Due Date", "Account", "Line Description", "Line Amount", "Currency"];
  const payees = [...new Set(rows.map((r) => r.legalName || r.staffName))].sort();
  const data = rows.map((r) => {
    const payee = r.legalName || r.staffName;
    return [
      `${batch.reference}-${payees.indexOf(payee) + 1}`,
      payee,
      billDate,
      billDate,
      "Field staff - contractors",
      `${batch.isDemo ? `${DEMO_NOTE} · ` : ""}${r.projectCode} ${r.serviceDate} ${r.role} ${minutesToDecimalHours(r.payableMinutes)} h @ ${centsToDecimal(r.rateCents)}`,
      centsToDecimal(r.totalCents),
      r.currency,
    ];
  });
  return { headers, data };
}

export async function buildExport(format: ExportFormat, batch: ExportBatch, rows: ExportRow[], billDate: string) {
  if (format === "csv_qbo" && batch.type !== "contractor") throw new Error("The QuickBooks bills format is for contractor batches.");
  const base = `${batch.isDemo ? "DEMO-" : ""}${batch.reference}`;
  if (format === "csv_qbo") {
    const { headers, data } = qboRows(batch, rows, billDate);
    return { data: Buffer.from(`﻿${toCsv(headers, data)}`, "utf8"), fileName: `${base}-qbo.csv`, contentType: "text/csv; charset=utf-8", rowCount: data.length };
  }
  const { headers, data } = genericRows(batch, rows);
  if (format === "csv_generic") {
    return { data: Buffer.from(`﻿${toCsv(headers, data)}`, "utf8"), fileName: `${base}.csv`, contentType: "text/csv; charset=utf-8", rowCount: data.length };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "RGXM Staffing";
  // Fixed timestamps keep the file (and its fingerprint) reproducible for the same batch.
  wb.created = wb.modified = new Date(`${billDate}T00:00:00Z`);
  const ws = wb.addWorksheet(batch.isDemo ? "DEMO - DO NOT PAY" : batch.reference);
  ws.addRow(headers).font = { bold: true };
  for (const r of data) {
    // Numbers as numbers so totals work in Excel; text cells are written as text (no formulas).
    ws.addRow(r.map((v, i) => ([10, 11, 12].includes(i) ? Number(v) : v)));
  }
  ws.columns.forEach((c) => (c.width = 16));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { data: buf, fileName: `${base}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", rowCount: data.length };
}
