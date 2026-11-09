// Read models for Payments (dashboard) and the staff payment view.
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  accountingExportBills,
  accountingExports,
  accountingSuppliers,
  auditLog,
  bills,
  contractorInvoices,
  payableItems,
  payableTaxLines,
  paymentBatches,
  paymentBatchItems,
  paymentExports,
  payPeriods,
  projects,
  staffProfiles,
  staffSensitive,
  taxRules,
  users,
} from "@/server/db/schema";
import { batchTypeFor, esaHints, type Classification, type EsaHint } from "@/server/domain/pay-rules";

const staffName = sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`;

/** Approved payables not yet in a batch (or failed and waiting to be retried). */
export async function getReadyPayables(scope: string[] | null) {
  if (scope && !scope.length) return [];
  const rows = await db
    .select({
      id: payableItems.id,
      staffId: payableItems.staffId,
      staffName,
      currentClassification: staffProfiles.classification,
      classification: payableItems.classification,
      // Same test as createBatch: the line's basis no longer matches the person's pay details.
      hstChanged: sql<boolean>`(${payableItems.billId} is null and (
        (${payableItems.taxStatus} in ('legacy_hst', 'legacy_none') and ((${payableItems.taxCents} > 0) <> coalesce(${staffSensitive.taxRegistered}, false)))
        or (${payableItems.taxStatus} in ('calculated', 'no_tax', 'review_required') and ${payableItems.registrationSnapshot} is distinct from
            (coalesce(${staffSensitive.gstRegistrationStatus}, 'unknown') || ':' || coalesce(${staffSensitive.gstVerificationStatus}, 'unverified')))))`,
      category: payableItems.category,
      description: payableItems.description,
      baseCents: payableItems.baseCents,
      taxCents: payableItems.taxCents,
      taxStatus: payableItems.taxStatus,
      taxBasis: payableItems.taxBasis,
      billNumber: bills.billNumber,
      projectId: payableItems.projectId,
      projectCode: projects.code,
      projectName: projects.name,
      serviceDate: payableItems.serviceDate,
      payableMinutes: payableItems.payableMinutes,
      rateCents: payableItems.rateCents,
      totalCents: payableItems.totalCents,
      currency: payableItems.currency,
      status: payableItems.status,
      isDemo: sql<boolean>`(${projects.isDemo} or ${staffProfiles.isDemo})`,
      role: sql<string>`(${payableItems.calcInputs} ->> 'role')`,
      weekMinutes: sql<number>`(select coalesce(sum(p2.payable_minutes), 0)::int from ${payableItems} p2
        where p2.staff_id = ${payableItems.staffId} and p2.status <> 'void'
          and date_trunc('week', p2.service_date) = date_trunc('week', ${payableItems.serviceDate}))`,
    })
    .from(payableItems)
    .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
    .leftJoin(staffSensitive, eq(staffSensitive.staffId, payableItems.staffId))
    .leftJoin(bills, eq(bills.id, payableItems.billId))
    .innerJoin(projects, eq(projects.id, payableItems.projectId))
    .where(and(inArray(payableItems.status, ["pending", "failed"]), scope ? inArray(payableItems.projectId, scope) : undefined))
    .orderBy(asc(payableItems.serviceDate), asc(staffProfiles.lastName));
  return rows.map((r) => ({
    ...r,
    needsTaxReview: r.taxStatus === "review_required",
    batchType: r.classification === r.currentClassification && !r.hstChanged && r.taxStatus !== "review_required" ? batchTypeFor(r.classification as Classification) : null,
    needsClassification: r.taxStatus !== "review_required" && (r.classification === "unset" || r.classification !== r.currentClassification || r.hstChanged),
    hints: esaHints({ classification: r.classification as Classification, payableMinutes: r.payableMinutes, weekMinutes: r.weekMinutes }) as EsaHint[],
  }));
}
export type ReadyPayable = Awaited<ReturnType<typeof getReadyPayables>>[number];

export async function listBatches(limit = 50) {
  const creator = sql<string | null>`(select name from ${users} u where u.id = ${paymentBatches.createdBy})`;
  const approver = sql<string | null>`(select name from ${users} u where u.id = ${paymentBatches.approvedBy})`;
  return db
    .select({
      id: paymentBatches.id,
      reference: paymentBatches.reference,
      type: paymentBatches.type,
      status: paymentBatches.status,
      isDemo: paymentBatches.isDemo,
      totalCents: paymentBatches.totalCents,
      currency: paymentBatches.currency,
      createdAt: paymentBatches.createdAt,
      paidAt: paymentBatches.paidAt,
      period: payPeriods.label,
      createdBy: creator,
      approvedBy: approver,
      items: sql<number>`(select count(*)::int from ${paymentBatchItems} i where i.batch_id = ${paymentBatches.id} and (i.active or i.paid_at is not null))`,
    })
    .from(paymentBatches)
    .leftJoin(payPeriods, eq(payPeriods.id, paymentBatches.payPeriodId))
    .orderBy(desc(paymentBatches.createdAt))
    .limit(limit);
}

export async function getBatchDetail(batchId: string) {
  const [batch] = await db
    .select({ b: paymentBatches, period: payPeriods.label })
    .from(paymentBatches)
    .leftJoin(payPeriods, eq(payPeriods.id, paymentBatches.payPeriodId))
    .where(eq(paymentBatches.id, batchId));
  if (!batch) return null;
  const nameOf = async (id: string | null) => (id ? ((await db.select({ name: users.name }).from(users).where(eq(users.id, id)))[0]?.name ?? null) : null);
  const [items, exports, createdBy, approvedBy, invalidations] = await Promise.all([
    db
      .select({
        payableId: payableItems.id,
        staffName,
        projectCode: projects.code,
        serviceDate: payableItems.serviceDate,
        payableMinutes: payableItems.payableMinutes,
        rateCents: payableItems.rateCents,
        amountCents: paymentBatchItems.amountCents,
        currency: payableItems.currency,
        payableStatus: payableItems.status,
        active: paymentBatchItems.active,
        paidAt: paymentBatchItems.paidAt,
        failureReason: paymentBatchItems.failureReason,
        state: paymentBatchItems.state,
        bankReference: paymentBatchItems.bankReference,
        evidence: paymentBatchItems.evidence,
        returnedAt: paymentBatchItems.returnedAt,
        reconciledAt: paymentBatchItems.reconciledAt,
        category: payableItems.category,
        description: payableItems.description,
        baseCents: payableItems.baseCents,
        taxCents: payableItems.taxCents,
        billId: payableItems.billId,
        billNumber: bills.billNumber,
        role: sql<string>`(${payableItems.calcInputs} ->> 'role')`,
      })
      .from(paymentBatchItems)
      .innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId))
      .leftJoin(bills, eq(bills.id, payableItems.billId))
      .innerJoin(staffProfiles, eq(staffProfiles.id, payableItems.staffId))
      .innerJoin(projects, eq(projects.id, payableItems.projectId))
      .where(eq(paymentBatchItems.batchId, batchId))
      .orderBy(asc(staffProfiles.lastName), asc(payableItems.serviceDate)),
    db
      .select({ e: paymentExports, by: users.name })
      .from(paymentExports)
      .leftJoin(users, eq(users.id, paymentExports.exportedBy))
      .where(eq(paymentExports.batchId, batchId))
      .orderBy(desc(paymentExports.createdAt)),
    nameOf(batch.b.createdBy),
    nameOf(batch.b.approvedBy),
    db
      .select({ at: auditLog.createdAt, reason: auditLog.reason })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "payment_batch"), eq(auditLog.entityId, batchId), eq(auditLog.action, "batch.approval_invalidated")))
      .orderBy(desc(auditLog.createdAt)),
  ]);
  return { ...batch.b, period: batch.period, items, exports, createdByName: createdBy, approvedByName: approvedBy, invalidations };
}

/** A person's own payments: approved shifts and their payment status. */
export async function getStaffPayments(staffId: string) {
  return db
    .select({
      id: payableItems.id,
      projectName: projects.name,
      serviceDate: payableItems.serviceDate,
      payableMinutes: payableItems.payableMinutes,
      rateCents: payableItems.rateCents,
      totalCents: payableItems.totalCents,
      currency: payableItems.currency,
      status: payableItems.status,
      paidAt: sql<Date | null>`(select max(i.paid_at) from ${paymentBatchItems} i where i.payable_item_id = ${payableItems.id})`,
    })
    .from(payableItems)
    .innerJoin(projects, eq(projects.id, payableItems.projectId))
    .where(and(eq(payableItems.staffId, staffId), ne(payableItems.status, "void")))
    .orderBy(desc(payableItems.serviceDate))
    .limit(200);
}

// ─── Tax review, bills and accounting ────────────────────────────────────────────

/** Configured tax rules Finance can choose from when deciding a line's tax (never a free rate). */
export async function listChoosableTaxRules() {
  return db
    .select({ id: taxRules.id, jurisdiction: taxRules.jurisdiction, component: taxRules.component, ratePpm: taxRules.ratePpm, status: taxRules.status, serviceCategory: taxRules.serviceCategory, effectiveFrom: taxRules.effectiveFrom, effectiveTo: taxRules.effectiveTo })
    .from(taxRules)
    .where(ne(taxRules.status, "retired"))
    .orderBy(asc(taxRules.jurisdiction), asc(taxRules.component), desc(taxRules.effectiveFrom));
}
export type ChoosableTaxRule = Awaited<ReturnType<typeof listChoosableTaxRules>>[number];

export async function listBills(opts: { status?: string | null; limit?: number } = {}) {
  return db
    .select({
      id: bills.id,
      billNumber: bills.billNumber,
      kind: bills.kind,
      invoiceKind: bills.invoiceKind,
      contractorConfirmedAt: bills.contractorConfirmedAt,
      status: bills.status,
      billDate: bills.billDate,
      dueDate: bills.dueDate,
      termsApproved: sql<boolean>`coalesce((${bills.termsSnapshot} ->> 'approved')::boolean, false)`,
      totalCents: bills.totalCents,
      taxCents: bills.taxCents,
      currency: bills.currency,
      isDemo: bills.isDemo,
      supplier: accountingSuppliers.displayName,
      supplierRef: accountingSuppliers.supplierRef,
      staffId: bills.staffId,
      accounting: sql<string | null>`(select e.status || ' ' || e.reference from ${accountingExportBills} ab join ${accountingExports} e on e.id = ab.export_id where ab.bill_id = ${bills.id} and ab.active limit 1)`,
      openInvoices: sql<number>`(select count(*)::int from ${contractorInvoices} ci where ci.bill_id = ${bills.id} and ci.status in ('variance_review', 'unmatched'))`,
    })
    .from(bills)
    .innerJoin(accountingSuppliers, eq(accountingSuppliers.id, bills.supplierId))
    .where(opts.status ? eq(bills.status, opts.status) : undefined)
    .orderBy(desc(bills.billDate), desc(bills.billNumber))
    .limit(opts.limit ?? 200);
}

export async function getBillDetail(billId: string) {
  const [bill] = await db
    .select({ b: bills, supplier: accountingSuppliers, staffName })
    .from(bills)
    .innerJoin(accountingSuppliers, eq(accountingSuppliers.id, bills.supplierId))
    .innerJoin(staffProfiles, eq(staffProfiles.id, bills.staffId))
    .where(eq(bills.id, billId));
  if (!bill) return null;
  const lines = await db
    .select({
      id: payableItems.id,
      category: payableItems.category,
      description: payableItems.description,
      serviceDate: payableItems.serviceDate,
      quantity: payableItems.quantity,
      unit: payableItems.unit,
      unitRate: payableItems.unitRate,
      baseCents: payableItems.baseCents,
      taxCents: payableItems.taxCents,
      totalCents: payableItems.totalCents,
      status: payableItems.status,
      taxStatus: payableItems.taxStatus,
      taxBasis: payableItems.taxBasis,
      adjustsPayableId: payableItems.adjustsPayableId,
      projectCode: projects.code,
    })
    .from(payableItems)
    .innerJoin(projects, eq(projects.id, payableItems.projectId))
    .where(eq(payableItems.billId, billId))
    .orderBy(asc(payableItems.serviceDate), asc(payableItems.category));
  const ids = lines.map((l) => l.id);
  const [taxLines, adjustments, attempts, invoices, accounting] = await Promise.all([
    ids.length ? db.select().from(payableTaxLines).where(inArray(payableTaxLines.payableItemId, ids)) : Promise.resolve([]),
    ids.length
      ? db
          .select({ id: payableItems.id, adjustsPayableId: payableItems.adjustsPayableId, baseCents: payableItems.baseCents, taxCents: payableItems.taxCents, totalCents: payableItems.totalCents, status: payableItems.status, description: payableItems.description, billNumber: bills.billNumber, createdAt: payableItems.createdAt })
          .from(payableItems)
          .leftJoin(bills, eq(bills.id, payableItems.billId))
          .where(and(inArray(payableItems.adjustsPayableId, ids), ne(payableItems.status, "void")))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ payableId: paymentBatchItems.payableItemId, state: paymentBatchItems.state, batchId: paymentBatches.id, reference: paymentBatches.reference, paidAt: paymentBatchItems.paidAt, returnedAt: paymentBatchItems.returnedAt, bankReference: paymentBatchItems.bankReference, evidence: paymentBatchItems.evidence, failureReason: paymentBatchItems.failureReason, createdAt: paymentBatches.createdAt })
          .from(paymentBatchItems)
          .innerJoin(paymentBatches, eq(paymentBatches.id, paymentBatchItems.batchId))
          .where(inArray(paymentBatchItems.payableItemId, ids))
          .orderBy(asc(paymentBatches.createdAt))
      : Promise.resolve([]),
    db.select().from(contractorInvoices).where(eq(contractorInvoices.billId, billId)).orderBy(desc(contractorInvoices.createdAt)),
    db
      .select({ reference: accountingExports.reference, status: accountingExports.status, active: accountingExportBills.active, createdAt: accountingExports.createdAt })
      .from(accountingExportBills)
      .innerJoin(accountingExports, eq(accountingExports.id, accountingExportBills.exportId))
      .where(eq(accountingExportBills.billId, billId))
      .orderBy(desc(accountingExports.createdAt)),
  ]);
  return { ...bill.b, supplier: bill.supplier, staffName: bill.staffName, lines, taxLines, adjustments, attempts, invoices, accounting };
}
