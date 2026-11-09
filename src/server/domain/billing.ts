// Accounting side of payments: bill exports for RGXM's books (separate from bank files), invoice
// comparison, and contractors' pay review requests.
//
// A bill can be in only one live accounting export (unique index), so the same bill can't be
// imported twice by accident. A failed or returned bank payment never touches the bill or its
// accounting export: the payment is retried against the same bill.
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { toCsv } from "@/lib/csv";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import {
  accountingExportBills,
  accountingExports,
  accountingSuppliers,
  bills,
  clients,
  contractorInvoices,
  orgSettings,
  payableItems,
  payableTaxLines,
  payReviewRequests,
  projects,
  staffProfiles,
} from "@/server/db/schema";
import { enqueue } from "@/server/notify/outbox";
import { storage } from "@/server/storage";
import { centsToDecimal } from "./pay-rules";
import { CATEGORY_LABEL } from "./tax-engine";

export class BillingError extends Error {}

export const ACCOUNTING_FORMATS = ["bills_csv"] as const;

/** Defaults shown until RGXM's accountant confirms the names in their system. */
export const DEFAULT_ACCOUNTS: Record<string, string> = {
  fee: "Field staff - contractors",
  meal_breakfast: "Contractor meal allowances",
  meal_lunch: "Contractor meal allowances",
  meal_dinner: "Contractor meal allowances",
  per_diem: "Contractor per diems",
  mileage: "Contractor mileage",
  bonus: "Contractor bonuses",
  adjustment: "Field staff - contractors",
};

/** Tax code per decision; keys are "none" or COMPONENT:JURISDICTION (e.g. "HST:ON", "GST:QC+QST:QC"). */
export const DEFAULT_TAX_CODES: Record<string, string> = { none: "Out of Scope", "HST:ON": "HST ON" };

export async function getAccountingConfig() {
  const [s] = await db.select({ c: orgSettings.accountingConfig, currency: orgSettings.defaultCurrency }).from(orgSettings).where(eq(orgSettings.id, 1));
  const c = s?.c ?? {};
  return {
    system: c.system ?? null,
    accounts: { ...DEFAULT_ACCOUNTS, ...(c.accounts ?? {}) },
    taxCodes: { ...DEFAULT_TAX_CODES, ...(c.taxCodes ?? {}) },
    currency: c.currency ?? s?.currency ?? "CAD",
    validatedAt: c.validatedAt ?? null,
    validatedBy: c.validatedBy ?? null,
  };
}

const configSchema = z.object({
  system: z.string().trim().max(80).nullable(),
  accounts: z.record(z.string(), z.string().trim().min(1).max(120)),
  taxCodes: z.record(z.string().regex(/^(none|[A-Z]{3}:[A-Z]{2}(\+[A-Z]{3}:[A-Z]{2})*)$/), z.string().trim().min(1).max(80)),
  currency: z.string().regex(/^[A-Z]{3}$/),
  validated: z.boolean(),
});

/** Saves account / tax code / currency mapping. "Validated" means RGXM tested an import in their system. */
export async function saveAccountingConfig(actorId: string, raw: z.input<typeof configSchema>) {
  const v = configSchema.parse(raw);
  await db.transaction(async (tx) => {
    const config = { system: v.system, accounts: v.accounts, taxCodes: v.taxCodes, currency: v.currency, validatedAt: v.validated ? new Date().toISOString() : null, validatedBy: v.validated ? actorId : null };
    await tx.update(orgSettings).set({ accountingConfig: config, updatedBy: actorId }).where(eq(orgSettings.id, 1));
    await recordAudit({ actorId, action: "settings.accounting_config", entityType: "org_settings", entityId: "1", after: config }, tx);
  });
}

function taxCodeKey(lines: { component: string; jurisdiction: string }[]) {
  return lines.length ? lines.map((l) => `${l.component}:${l.jurisdiction}`).sort().join("+") : "none";
}

/** Finalized bills that aren't in a live accounting export yet. */
export async function billsReadyForAccounting(opts: { demo?: boolean } = {}) {
  return db
    .select({ id: bills.id, billNumber: bills.billNumber, kind: bills.kind, billDate: bills.billDate, dueDate: bills.dueDate, totalCents: bills.totalCents, taxCents: bills.taxCents, status: bills.status, supplier: accountingSuppliers.displayName, isDemo: bills.isDemo })
    .from(bills)
    .innerJoin(accountingSuppliers, eq(accountingSuppliers.id, bills.supplierId))
    .where(and(eq(bills.isDemo, opts.demo ?? false), sql`${bills.status} <> 'void'`, notExists(db.select({ x: sql`1` }).from(accountingExportBills).where(and(eq(accountingExportBills.billId, bills.id), eq(accountingExportBills.active, true))))))
    .orderBy(asc(bills.billNumber));
}

/**
 * Generates an accounting import file for the given bills: one row per bill line, with the
 * project/client allocation, account and tax code from the configured mapping.
 */
export async function createAccountingExport(actorId: string, input: { billIds: string[] }) {
  if (!input.billIds.length) throw new BillingError("Select at least one bill.");
  const config = await getAccountingConfig();
  try {
    return await db.transaction(async (tx) => {
      const chosen = await tx.select().from(bills).where(inArray(bills.id, input.billIds)).orderBy(asc(bills.billNumber)).for("update");
      if (chosen.length !== new Set(input.billIds).size) throw new BillingError("Some bills weren't found.");
      if (new Set(chosen.map((b) => b.isDemo)).size > 1) throw new BillingError("Demo and real bills can't be exported together.");
      if (chosen.some((b) => b.status === "void")) throw new BillingError("Void bills can't be exported.");
      const lines = await tx
        .select({
          billId: payableItems.billId,
          lineId: payableItems.id,
          category: payableItems.category,
          description: payableItems.description,
          serviceDate: payableItems.serviceDate,
          baseCents: payableItems.baseCents,
          taxCents: payableItems.taxCents,
          projectCode: projects.code,
          projectName: projects.name,
          client: clients.name,
        })
        .from(payableItems)
        .innerJoin(projects, eq(projects.id, payableItems.projectId))
        .leftJoin(clients, eq(clients.id, projects.clientId))
        .where(inArray(payableItems.billId, input.billIds))
        .orderBy(asc(payableItems.serviceDate), asc(payableItems.category));
      const taxLines = lines.length ? await tx.select().from(payableTaxLines).where(inArray(payableTaxLines.payableItemId, lines.map((l) => l.lineId))) : [];
      const suppliers = await tx.select().from(accountingSuppliers).where(inArray(accountingSuppliers.id, chosen.map((b) => b.supplierId)));
      const headers = ["Bill No", "Supplier", "Supplier Ref", "Supplier ID", "Bill Date", "Due Date", "Account", "Line Description", "Line Amount", "Line Tax Code", "Line Tax Amount", "Currency", "Project", "Client", "Line ID"];
      const missingCodes = new Set<string>();
      const data: string[][] = [];
      for (const b of chosen) {
        const s = suppliers.find((x) => x.id === b.supplierId)!;
        for (const l of lines.filter((x) => x.billId === b.id)) {
          const key = taxCodeKey(taxLines.filter((t) => t.payableItemId === l.lineId));
          const code = config.taxCodes[key];
          if (!code) missingCodes.add(key);
          data.push([
            b.billNumber,
            s.displayName,
            s.supplierRef,
            s.externalId ?? "",
            b.billDate,
            b.dueDate,
            config.accounts[l.category] ?? DEFAULT_ACCOUNTS[l.category] ?? "",
            `${b.isDemo ? "DEMO - DO NOT IMPORT · " : ""}${l.projectCode} ${l.serviceDate} ${CATEGORY_LABEL[l.category] ?? l.category}${l.description ? ` · ${l.description}` : ""}`,
            centsToDecimal(l.baseCents),
            code ?? "",
            centsToDecimal(l.taxCents),
            b.currency,
            l.projectCode,
            l.client ?? "",
            l.lineId,
          ]);
        }
      }
      if (missingCodes.size) throw new BillingError(`Add an accounting tax code for: ${[...missingCodes].join(", ")} (Settings → Tax & accounting).`);
      const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('accounting_export_seq')::text as n`)).rows as [{ n: string }];
      const reference = `ACC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${n}`;
      const isDemo = chosen[0]!.isDemo;
      const file = Buffer.from(`﻿${toCsv(headers, data)}`, "utf8");
      const sha256 = createHash("sha256").update(file).digest("hex");
      const key = `accounting/${Date.now()}-${reference}${isDemo ? "-DEMO" : ""}.csv`;
      await storage().put(key, file, "text/csv; charset=utf-8");
      const [exp] = await tx
        .insert(accountingExports)
        .values({ reference, format: "bills_csv", storageKey: key, sha256, rowCount: data.length, billCount: chosen.length, isDemo, config: { accounts: config.accounts, taxCodes: config.taxCodes, system: config.system, validatedAt: config.validatedAt }, exportedBy: actorId })
        .returning();
      await tx.insert(accountingExportBills).values(chosen.map((b) => ({ exportId: exp!.id, billId: b.id })));
      await recordAudit({ actorId, action: "accounting.export", entityType: "accounting_export", entityId: exp!.id, after: { reference, bills: chosen.length, rows: data.length, sha256, validatedFormat: Boolean(config.validatedAt) } }, tx);
      return { exportId: exp!.id, reference, fileName: `${reference}${isDemo ? "-DEMO" : ""}.csv`, data: file, validatedFormat: Boolean(config.validatedAt) };
    });
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") throw new BillingError("Some of these bills are already in another accounting export.");
    throw err;
  }
}

/** Finance records the outcome of importing the file. A rejected file frees its bills for a new export. */
export async function setAccountingExportStatus(actorId: string, exportId: string, input: { status: "imported" | "rejected"; note: string }) {
  if (input.status === "rejected" && input.note.trim().length < 3) throw new BillingError("Say why the import was rejected.");
  await db.transaction(async (tx) => {
    const [exp] = await tx.select().from(accountingExports).where(eq(accountingExports.id, exportId)).for("update");
    if (!exp) throw new BillingError("Export not found.");
    if (exp.status !== "generated") throw new BillingError(`This export is already marked ${exp.status}.`);
    await tx.update(accountingExports).set({ status: input.status, statusNote: input.note.trim() || null, statusChangedBy: actorId, statusChangedAt: new Date() }).where(eq(accountingExports.id, exportId));
    if (input.status === "rejected") await tx.update(accountingExportBills).set({ active: false }).where(eq(accountingExportBills.exportId, exportId));
    await recordAudit({ actorId, action: `accounting.export_${input.status}`, entityType: "accounting_export", entityId: exportId, reason: input.note.trim() || null }, tx);
  });
}

export async function readAccountingExport(actorId: string, exportId: string) {
  const [exp] = await db.select().from(accountingExports).where(eq(accountingExports.id, exportId));
  if (!exp) throw new BillingError("Export not found.");
  const data = await storage().get(exp.storageKey);
  if (createHash("sha256").update(data).digest("hex") !== exp.sha256) throw new BillingError("The stored file doesn't match its fingerprint. Contact an administrator.");
  await recordAudit({ actorId, action: "accounting.export_download", entityType: "accounting_export", entityId: exportId });
  return { data, fileName: `${exp.reference}${exp.isDemo ? "-DEMO" : ""}.csv`, contentType: "text/csv; charset=utf-8" };
}

export async function listAccountingExports() {
  return db.select().from(accountingExports).orderBy(desc(accountingExports.createdAt)).limit(50);
}

// ─── Contractor invoices ─────────────────────────────────────────────────────────

const invoiceSchema = z.object({
  staffId: z.string().uuid(),
  billId: z.string().uuid().nullable(),
  invoiceNumber: z.string().trim().min(1).max(60),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subtotalCents: z.number().int(),
  taxCents: z.number().int().min(0),
});

/**
 * Records an invoice a contractor sent and compares it with the bill Crew calculated. Any
 * difference in tax (or subtotal) is flagged for Finance review; nothing is changed automatically.
 */
export async function recordContractorInvoice(actorId: string, raw: z.input<typeof invoiceSchema>) {
  const v = invoiceSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [bill] = v.billId ? await tx.select().from(bills).where(eq(bills.id, v.billId)) : [];
    if (v.billId && (!bill || bill.staffId !== v.staffId)) throw new BillingError("That bill isn't for this contractor.");
    const status = !bill ? "unmatched" : bill.taxCents === v.taxCents && bill.subtotalCents === v.subtotalCents ? "matched" : "variance_review";
    const [row] = await tx
      .insert(contractorInvoices)
      .values({ ...v, totalCents: v.subtotalCents + v.taxCents, expectedSubtotalCents: bill?.subtotalCents ?? null, expectedTaxCents: bill?.taxCents ?? null, status, recordedBy: actorId })
      .returning();
    await recordAudit({ actorId, action: "invoice.record", entityType: "contractor_invoice", entityId: row!.id, after: { billId: v.billId, status, taxCents: v.taxCents, expectedTaxCents: bill?.taxCents ?? null } }, tx);
    return row!;
  });
}

export async function resolveInvoiceVariance(actorId: string, invoiceId: string, note: string) {
  if (note.trim().length < 5) throw new BillingError("Record how the difference was resolved.");
  await db.transaction(async (tx) => {
    const [row] = await tx.update(contractorInvoices).set({ status: "resolved", resolvedBy: actorId, resolvedAt: new Date(), resolutionNote: note.trim() }).where(and(eq(contractorInvoices.id, invoiceId), inArray(contractorInvoices.status, ["variance_review", "unmatched"]))).returning();
    if (!row) throw new BillingError("Invoice not found or not under review.");
    await recordAudit({ actorId, action: "invoice.resolve", entityType: "contractor_invoice", entityId: invoiceId, reason: note.trim() }, tx);
  });
}

// ─── Pay review requests (contractor-initiated) ──────────────────────────────────

const reviewSchema = z.object({
  payableId: z.string().uuid().nullable(),
  kind: z.enum(["tax", "amount", "hours", "other"]),
  message: z.string().trim().min(5, "Tell us what looks wrong").max(1000),
});

/** "Tax details incorrect? Request a review." The contractor can only reference their own lines. */
export async function requestPayReview(staff: { userId: string; staffId: string }, raw: z.input<typeof reviewSchema>) {
  const v = reviewSchema.parse(raw);
  return db.transaction(async (tx) => {
    let billId: string | null = null;
    if (v.payableId) {
      const [p] = await tx.select({ staffId: payableItems.staffId, billId: payableItems.billId }).from(payableItems).where(eq(payableItems.id, v.payableId));
      if (!p || p.staffId !== staff.staffId) throw new BillingError("Payment line not found.");
      billId = p.billId;
    }
    const [open] = await tx.select({ id: payReviewRequests.id }).from(payReviewRequests).where(and(eq(payReviewRequests.staffId, staff.staffId), eq(payReviewRequests.status, "open"), v.payableId ? eq(payReviewRequests.payableItemId, v.payableId) : isNull(payReviewRequests.payableItemId)));
    if (open) throw new BillingError("You already have an open review request for this. RGXM Finance will get back to you.");
    const [row] = await tx.insert(payReviewRequests).values({ staffId: staff.staffId, payableItemId: v.payableId, billId, kind: v.kind, message: v.message, createdBy: staff.userId }).returning();
    await recordAudit({ actorId: staff.userId, action: "pay_review.request", entityType: "pay_review", entityId: row!.id, after: { kind: v.kind, payableId: v.payableId } }, tx);
    await enqueue(tx, { type: "pay_review.requested", payload: { requestId: row!.id }, dedupeKey: `pay_review.requested:${row!.id}` });
    return row!;
  });
}

export async function resolvePayReview(actorId: string, requestId: string, resolution: string) {
  if (resolution.trim().length < 5) throw new BillingError("Describe the outcome for the contractor.");
  await db.transaction(async (tx) => {
    const [row] = await tx.update(payReviewRequests).set({ status: "resolved", resolution: resolution.trim(), resolvedBy: actorId, resolvedAt: new Date() }).where(and(eq(payReviewRequests.id, requestId), eq(payReviewRequests.status, "open"))).returning();
    if (!row) throw new BillingError("Request not found or already resolved.");
    await recordAudit({ actorId, action: "pay_review.resolve", entityType: "pay_review", entityId: requestId, reason: resolution.trim() }, tx);
  });
}

export async function listPayReviews(status: "open" | "resolved" = "open") {
  return db
    .select({ r: payReviewRequests, name: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`, billNumber: bills.billNumber })
    .from(payReviewRequests)
    .innerJoin(staffProfiles, eq(staffProfiles.id, payReviewRequests.staffId))
    .leftJoin(bills, eq(bills.id, payReviewRequests.billId))
    .where(eq(payReviewRequests.status, status))
    .orderBy(desc(payReviewRequests.createdAt));
}
