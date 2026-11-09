// Contractor invoices prepared by RGXM under the self-billing arrangement (Independent Contractor
// Agreement §7, from v1.0.1), and RGXM's internal bills for contractors who haven't accepted it.
//
// Invoices are RECORDS, not approvals: when RGXM approves a timesheet (or an allowance, mileage
// claim or bonus), Crew issues the contractor's invoice for that work automatically. Nobody has to
// issue, send or confirm it, and payment never waits for it. Contractors can view and print their
// invoices and report a discrepancy. An issued invoice is frozen (its full printed content is in
// `bills.document`, protected by a trigger); later corrections are linked adjustment lines that get
// their own invoice. Contractors without self-billing get an internal bill when they're paid.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { accountingSuppliers, bills, legalDocuments, orgSettings, payableItems, payableTaxLines, projects, staffAcceptances, staffProfiles, staffSensitive } from "@/server/db/schema";
import { utcToZoned } from "@/lib/time";
import { dueDateFor } from "./pay-rules";
import { CATEGORY_LABEL } from "./tax-engine";

export class InvoiceError extends Error {}

export const SELF_BILLING_STATEMENT = "Prepared by RGXM Inc. on behalf of the supplier under an agreed self-billing arrangement.";

export function torontoToday(now = new Date()) {
  return utcToZoned(now, "America/Toronto").date;
}

/** RGXM-approved terms, or null when none are approved (due date then equals the bill date and is flagged). */
export async function approvedPaymentTerms(tx: Tx | typeof db) {
  const [s] = await tx.select({ terms: orgSettings.paymentTerms }).from(orgSettings).where(eq(orgSettings.id, 1));
  const t = s?.terms ?? {};
  if (!t.approvedAt) return null;
  if ((t.dueRule ?? "days_after_bill") === "days_after_bill" && t.dueDaysAfterBillDate == null) return null;
  return t;
}

async function ensureSupplier(tx: Tx, staffId: string) {
  const [existing] = await tx.select().from(accountingSuppliers).where(eq(accountingSuppliers.staffId, staffId));
  if (existing) return existing;
  const [person] = await tx
    .select({ name: sql<string>`coalesce(${staffSensitive.businessName}, ${staffSensitive.legalName}, ${staffProfiles.firstName} || ' ' || ${staffProfiles.lastName})` })
    .from(staffProfiles)
    .leftJoin(staffSensitive, eq(staffSensitive.staffId, staffProfiles.id))
    .where(eq(staffProfiles.id, staffId));
  const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('supplier_ref_seq')::text as n`)).rows as [{ n: string }];
  const [row] = await tx.insert(accountingSuppliers).values({ staffId, supplierRef: `CRW-S-${n.padStart(6, "0")}`, displayName: person!.name }).returning();
  return row!;
}

/**
 * The contractor's self-billing authorization: their most recent Contractor Agreement acceptance,
 * if that version includes the self-billing clause. Accepting a later version without it ends it.
 */
export async function selfBillingAuthorization(tx: Tx | typeof db, staffId: string) {
  const [latest] = await tx
    .select({ acceptanceId: staffAcceptances.id, version: staffAcceptances.version, acceptedAt: staffAcceptances.acceptedAt, selfBilling: legalDocuments.selfBilling, party: staffAcceptances.contractingParty })
    .from(staffAcceptances)
    .innerJoin(legalDocuments, eq(legalDocuments.id, staffAcceptances.documentId))
    .where(and(eq(staffAcceptances.staffId, staffId), eq(staffAcceptances.kind, "contractor_terms")))
    .orderBy(desc(staffAcceptances.acceptedAt))
    .limit(1);
  return latest?.selfBilling ? latest : null;
}

type Supplier = { name: string; legalName: string | null; businessName: string | null; address: string | null; gstHstNumber: string | null; businessNumber: string | null };

/** What a self-billed invoice must show about the supplier; returns what's missing. */
export function missingSupplierDetails(s: Supplier, taxed: boolean) {
  return [!(s.legalName || s.businessName) && "legal or business name", !s.address && "mailing address", taxed && !s.gstHstNumber && "GST/HST registration number"].filter((x): x is string => Boolean(x));
}

async function supplierDetails(tx: Tx | typeof db, staffId: string): Promise<Supplier> {
  const [r] = await tx
    .select({ first: staffProfiles.firstName, last: staffProfiles.lastName, s: staffSensitive })
    .from(staffProfiles)
    .leftJoin(staffSensitive, eq(staffSensitive.staffId, staffProfiles.id))
    .where(eq(staffProfiles.id, staffId));
  const s = r?.s;
  const address = s && s.mailingStreet && s.mailingCity && s.mailingProvince && s.mailingPostalCode ? `${s.mailingStreet}, ${s.mailingCity}, ${s.mailingProvince} ${s.mailingPostalCode.replace(/^(.{3})(.{3})$/, "$1 $2")}` : null;
  return {
    name: s?.businessName ?? s?.legalName ?? `${r?.first ?? ""} ${r?.last ?? ""}`.trim(),
    legalName: s?.legalName ?? null,
    businessName: s?.businessName ?? null,
    address,
    gstHstNumber: s?.gstRegistrationStatus === "yes" ? (s.gstHstNumber ?? null) : null,
    businessNumber: s?.businessNumber ?? null,
  };
}

/** The printed lines: project, event location, description, quantities and tax per line. */
async function documentLines(tx: Tx | typeof db, lineIds: string[]) {
  const { rows } = await tx.execute<{
    id: string;
    service_date: string;
    category: string;
    description: string | null;
    quantity: string | null;
    unit: string | null;
    unit_rate: string | null;
    base_cents: string;
    tax_cents: string;
    project_code: string;
    project_name: string;
    location_name: string | null;
    location_address: string | null;
    adjusts_bill: string | null;
  }>(sql`
    select p.id, p.service_date::text, p.category, p.description, p.quantity::text, p.unit, p.unit_rate::text, p.base_cents, p.tax_cents,
      pr.code as project_code, pr.name as project_name, l.name as location_name,
      nullif(concat_ws(', ', l.address, l.city, l.province), '') as location_address, ob.bill_number as adjusts_bill
    from payable_items p
    join projects pr on pr.id = p.project_id
    left join timesheets t on t.id = p.timesheet_id
    left join compensation_items ci on ci.id = p.compensation_item_id
    left join payable_items op on op.id = p.adjusts_payable_id
    left join bills ob on ob.id = op.bill_id
    left join timesheets ot on ot.id = op.timesheet_id
    left join compensation_items oci on oci.id = op.compensation_item_id
    left join shifts sh on sh.id = coalesce(t.shift_id, ci.shift_id, ot.shift_id, oci.shift_id)
    left join project_locations l on l.id = sh.location_id
    where p.id in ${lineIds}
    order by p.service_date, p.category, p.id`);
  const taxes = await tx.select().from(payableTaxLines).where(inArray(payableTaxLines.payableItemId, lineIds));
  return rows.map((r) => ({
    id: r.id,
    date: r.service_date,
    category: r.category,
    categoryLabel: CATEGORY_LABEL[r.category] ?? r.category,
    description: r.description,
    project: { code: r.project_code, name: r.project_name },
    location: r.location_name ? { name: r.location_name, address: r.location_address } : null,
    quantity: r.quantity,
    unit: r.unit,
    unitRate: r.unit_rate,
    amountCents: Number(r.base_cents),
    taxCents: Number(r.tax_cents),
    adjustsInvoice: r.adjusts_bill,
    taxes: taxes.filter((t) => t.payableItemId === r.id).map((t) => ({ component: t.component, jurisdiction: t.jurisdiction, ratePpm: t.ratePpm, taxableCents: Number(t.taxableCents), taxCents: Number(t.taxCents) })),
  }));
}

export type InvoiceDocument = Awaited<ReturnType<typeof buildDocument>>;

async function buildDocument(tx: Tx | typeof db, input: { number: string; kind: "self_billed" | "rgxm_bill"; issueDate: string; dueDate: string; terms: { approved: boolean; description: string | null }; staffId: string; lineIds: string[]; currency: string; selfBilling: { version: string; acceptedAt: string } | null }) {
  const [settings] = await tx.select({ name: orgSettings.legalEntityName, address: orgSettings.legalEntityAddress }).from(orgSettings).where(eq(orgSettings.id, 1));
  const supplier = await supplierDetails(tx, input.staffId);
  const lines = await documentLines(tx, input.lineIds);
  const taxMap = new Map<string, { component: string; jurisdiction: string; ratePpm: number; taxableCents: number; taxCents: number }>();
  for (const l of lines)
    for (const t of l.taxes) {
      const key = `${t.component}:${t.jurisdiction}:${t.ratePpm}`;
      const e = taxMap.get(key) ?? { component: t.component, jurisdiction: t.jurisdiction, ratePpm: t.ratePpm, taxableCents: 0, taxCents: 0 };
      e.taxableCents += t.taxableCents;
      e.taxCents += t.taxCents;
      taxMap.set(key, e);
    }
  const subtotal = lines.reduce((n, l) => n + l.amountCents, 0);
  const tax = lines.reduce((n, l) => n + l.taxCents, 0);
  const dates = lines.map((l) => l.date).sort();
  return {
    title:
      input.kind === "self_billed"
        ? `${subtotal + tax < 0 ? "Contractor Credit Note" : "Contractor Invoice"} — Prepared by RGXM on behalf of ${supplier.name}`
        : `${subtotal + tax < 0 ? "Credit" : "Bill"} from ${supplier.name}`,
    kind: input.kind,
    number: input.number,
    issueDate: input.issueDate,
    serviceDates: { from: dates[0] ?? input.issueDate, to: dates[dates.length - 1] ?? input.issueDate },
    dueDate: input.dueDate,
    terms: input.terms,
    supplier,
    customer: { name: settings?.name ?? "RGXM Inc.", address: settings?.address ?? null },
    lines,
    taxes: [...taxMap.values()].sort((a, b) => a.component.localeCompare(b.component)),
    subtotalCents: subtotal,
    taxCents: tax,
    totalCents: subtotal + tax,
    currency: input.currency,
    statement: input.kind === "self_billed" ? SELF_BILLING_STATEMENT : null,
    selfBilling: input.selfBilling,
  };
}

/**
 * Finalizes one invoice (or internal bill) for a contractor's lines. Self-billed when the contractor
 * authorized it and the supplier details an invoice needs are on file; otherwise an internal bill.
 */
export async function createBill(tx: Tx, input: { staffId: string; lineIds: string[]; actorId: string; batch?: { id: string; currency: string; isDemo: boolean } }) {
  const lines = await tx
    .select({ id: payableItems.id, serviceDate: payableItems.serviceDate, baseCents: payableItems.baseCents, taxCents: payableItems.taxCents, currency: payableItems.currency, billId: payableItems.billId, projectDemo: projects.isDemo, staffDemo: staffProfiles.isDemo })
    .from(payableItems)
    .innerJoin(projects, eq(projects.id, payableItems.projectId))
    .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
    .where(and(inArray(payableItems.id, input.lineIds), eq(payableItems.staffId, input.staffId)));
  if (lines.length !== new Set(input.lineIds).size || lines.some((l) => l.billId)) throw new InvoiceError("Some lines are already on an invoice.");
  const currency = input.batch?.currency ?? lines[0]!.currency;
  const isDemo = input.batch?.isDemo ?? lines.some((l) => l.projectDemo || l.staffDemo);
  const terms = await approvedPaymentTerms(tx);
  const issueDate = torontoToday();
  const earliest = lines.map((l) => l.serviceDate).sort()[0]!;
  const dueDate = terms ? dueDateFor(terms.dueRule ?? "days_after_bill", { billDate: issueDate, earliestServiceDate: earliest, days: terms.dueDaysAfterBillDate }) : issueDate;
  const auth = await selfBillingAuthorization(tx, input.staffId);
  const supplier = await supplierDetails(tx, input.staffId);
  const taxed = lines.some((l) => l.taxCents !== 0);
  const kind = auth && missingSupplierDetails(supplier, taxed).length === 0 ? "self_billed" : "rgxm_bill";
  const supplierRow = await ensureSupplier(tx, input.staffId);
  const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('bill_number_seq')::text as n`)).rows as [{ n: string }];
  const number = `CRW-B-${n.padStart(6, "0")}`;
  const termsSnapshot = terms
    ? { approved: true, dueRule: terms.dueRule ?? "days_after_bill", dueDaysAfterBillDate: terms.dueDaysAfterBillDate ?? null, description: terms.description ?? null, approvalReference: terms.approvalReference ?? null }
    : { approved: false, note: "No RGXM-approved payment terms; due date set to the bill date." };
  const document = await buildDocument(tx, {
    number,
    kind,
    issueDate,
    dueDate,
    terms: { approved: Boolean(terms), description: terms?.description ?? null },
    staffId: input.staffId,
    lineIds: input.lineIds,
    currency,
    selfBilling: kind === "self_billed" && auth ? { version: auth.version, acceptedAt: auth.acceptedAt.toISOString() } : null,
  });
  const subtotal = lines.reduce((s, l) => s + l.baseCents, 0);
  const tax = lines.reduce((s, l) => s + l.taxCents, 0);
  const [bill] = await tx
    .insert(bills)
    .values({
      billNumber: number,
      staffId: input.staffId,
      supplierId: supplierRow.id,
      kind: subtotal + tax >= 0 ? "bill" : "credit",
      billDate: issueDate,
      dueDate,
      termsSnapshot,
      currency,
      subtotalCents: subtotal,
      taxCents: tax,
      totalCents: subtotal + tax,
      isDemo,
      invoiceKind: kind,
      selfBillingAcceptanceId: kind === "self_billed" ? auth!.acceptanceId : null,
      document,
      createdFromBatchId: input.batch?.id ?? null,
      finalizedBy: input.actorId,
    })
    .returning();
  await tx.update(payableItems).set({ billId: bill!.id }).where(inArray(payableItems.id, input.lineIds));
  await recordAudit({ actorId: input.actorId, action: kind === "self_billed" ? "invoice.issue" : "bill.finalize", entityType: "bill", entityId: bill!.id, after: { billNumber: number, lines: input.lineIds.length, totalCents: bill!.totalCents, batchId: input.batch?.id ?? null, invoiceKind: kind } }, tx);
  return bill!;
}

/**
 * Issues the self-billed invoice for a newly approved line, if the contractor accepted self-billing
 * and the details an invoice must show are on file. Lines waiting for a Finance tax decision are
 * invoiced once Finance decides (the decision creates a new line).
 */
export async function autoInvoice(tx: Tx, line: { id: string; staffId: string; classification: string; taxStatus: string; taxCents: number; billId: string | null }, actorId: string) {
  if (line.billId || line.taxStatus === "review_required" || line.classification !== "contractor") return null;
  const auth = await selfBillingAuthorization(tx, line.staffId);
  if (!auth) return null;
  if (missingSupplierDetails(await supplierDetails(tx, line.staffId), line.taxCents !== 0).length) return null;
  return createBill(tx, { staffId: line.staffId, lineIds: [line.id], actorId });
}

/**
 * Catches up: issues invoices for a contractor's approved lines that weren't invoiced yet, e.g. after
 * they accept the self-billing clause or add their mailing address. One invoice per line.
 */
export async function invoicePendingLines(staffId: string, actorId: string) {
  const lines = await db
    .select()
    .from(payableItems)
    .where(and(eq(payableItems.staffId, staffId), inArray(payableItems.status, ["pending", "batched", "failed"]), isNull(payableItems.billId)))
    .orderBy(asc(payableItems.serviceDate));
  let issued = 0;
  for (const l of lines) {
    const bill = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(payableItems).where(eq(payableItems.id, l.id)).for("update");
      return locked ? autoInvoice(tx, locked, actorId) : null;
    });
    if (bill) issued++;
  }
  return issued;
}

/** Lines approved for self-billing contractors that can't be invoiced yet because details are missing. */
export async function invoiceDetailsMissing(staffId: string) {
  if (!(await selfBillingAuthorization(db, staffId))) return [];
  const [reg] = await db.select({ status: staffSensitive.gstRegistrationStatus }).from(staffSensitive).where(eq(staffSensitive.staffId, staffId));
  return missingSupplierDetails(await supplierDetails(db, staffId), reg?.status === "yes");
}

/** One invoice for display: the frozen document plus live status and linked adjustments. */
export async function getInvoice(billId: string, opts: { staffId?: string } = {}) {
  const [b] = await db.select().from(bills).where(eq(bills.id, billId));
  if (!b || (opts.staffId && b.staffId !== opts.staffId)) return null;
  const adjustments = await db
    .select({ billNumber: bills.billNumber, billId: bills.id, amountCents: payableItems.totalCents })
    .from(payableItems)
    .innerJoin(bills, eq(bills.id, payableItems.billId))
    .where(inArray(payableItems.adjustsPayableId, db.select({ id: payableItems.id }).from(payableItems).where(eq(payableItems.billId, billId))));
  return { bill: b, document: b.document as InvoiceDocument | Record<string, never>, adjustments };
}

export async function listMyInvoices(staffId: string) {
  return db
    .select({ id: bills.id, billNumber: bills.billNumber, billDate: bills.billDate, dueDate: bills.dueDate, totalCents: bills.totalCents, currency: bills.currency, status: bills.status, kind: bills.kind, confirmedAt: bills.contractorConfirmedAt })
    .from(bills)
    .where(and(eq(bills.staffId, staffId), eq(bills.invoiceKind, "self_billed")))
    .orderBy(desc(bills.billDate), desc(bills.billNumber));
}
