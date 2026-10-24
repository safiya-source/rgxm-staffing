// Read models for Payments (dashboard) and the staff payment view.
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { payableItems, paymentBatches, paymentBatchItems, paymentExports, payPeriods, projects, staffProfiles, users } from "@/server/db/schema";
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
    .innerJoin(projects, eq(projects.id, payableItems.projectId))
    .where(and(inArray(payableItems.status, ["pending", "failed"]), scope ? inArray(payableItems.projectId, scope) : undefined))
    .orderBy(asc(payableItems.serviceDate), asc(staffProfiles.lastName));
  return rows.map((r) => ({
    ...r,
    batchType: r.classification === r.currentClassification ? batchTypeFor(r.classification as Classification) : null,
    needsClassification: r.classification === "unset" || r.classification !== r.currentClassification,
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
  const [items, exports, createdBy, approvedBy] = await Promise.all([
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
        role: sql<string>`(${payableItems.calcInputs} ->> 'role')`,
      })
      .from(paymentBatchItems)
      .innerJoin(payableItems, eq(payableItems.id, paymentBatchItems.payableItemId))
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
  ]);
  return { ...batch.b, period: batch.period, items, exports, createdByName: createdBy, approvedByName: approvedBy };
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
