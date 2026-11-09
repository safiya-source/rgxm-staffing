// Year-end review totals for RGXM's accountant (T4A preparation).
//
// Built only from SETTLED (bank-reconciled) payments, grouped by the settlement date's calendar year
// in Toronto. Fees, meals/per diems, mileage, bonuses, sales tax, reversals (returned payments) and
// adjustments are kept separate. Box 048 "candidate" fees exclude GST/HST/QST; other categories
// count toward box 048 only where the accountant approved that treatment, and are otherwise listed
// as "needs accountant decision". Nobody is excluded automatically (incorporated contractors
// included): inclusion/exclusion is a recorded decision. Crew never stores SINs; it only records
// that the accountant has received the person's tax identity information.
//
// Snapshots freeze what was handed to the accountant; later changes to the live totals are
// flagged for amendment review.
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { toCsv } from "@/lib/csv";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { compensationTaxTreatments, orgSettings, staffProfiles, staffSensitive, yearEndRecipients, yearEndSnapshots } from "@/server/db/schema";
import { centsToDecimal } from "./pay-rules";
import { CATEGORY_LABEL } from "./tax-engine";

export class YearEndError extends Error {}

/** Default flag threshold; RGXM's accountant confirms it (Settings → Tax & accounting). */
export const T4A_THRESHOLD_CENTS = 500_00;

const GROUPS = { fee: "fees", meal_breakfast: "meals", meal_lunch: "meals", meal_dinner: "meals", per_diem: "perDiems", mileage: "mileage", bonus: "bonuses" } as const;
type Group = (typeof GROUPS)[keyof typeof GROUPS];

function checkYear(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new YearEndError("Invalid year");
}

type Amounts = { fees: number; meals: number; perDiems: number; mileage: number; bonuses: number; adjustments: number; reversals: number; tax: number; reversedTax: number; netPaid: number };
const zero = (): Amounts => ({ fees: 0, meals: 0, perDiems: 0, mileage: 0, bonuses: 0, adjustments: 0, reversals: 0, tax: 0, reversedTax: 0, netPaid: 0 });

/**
 * Settled lines with settlement date in the year, plus reversals (payments returned in the year).
 * Adjustment lines are attributed to the category of the line they correct for box 048 purposes.
 */
async function yearLines(year: number) {
  const { rows } = await db.execute<{
    staff_id: string;
    category: string;
    original_category: string | null;
    base_cents: number;
    tax_cents: number;
    kind: "paid" | "reversal";
  }>(sql`
    select p.staff_id, p.category, op.category as original_category, p.base_cents::int as base_cents, p.tax_cents::int as tax_cents, 'paid' as kind
    from payment_batch_items i
    join payment_batches b on b.id = i.batch_id
    join payable_items p on p.id = i.payable_item_id
    left join payable_items op on op.id = p.adjusts_payable_id
    where b.type = 'contractor' and not b.is_demo and i.state in ('settled', 'returned') and i.paid_at is not null
      and extract(year from (i.paid_at at time zone 'America/Toronto')) = ${year}
    union all
    select p.staff_id, p.category, op.category, -p.base_cents::int, -p.tax_cents::int, 'reversal'
    from payment_batch_items i
    join payment_batches b on b.id = i.batch_id
    join payable_items p on p.id = i.payable_item_id
    left join payable_items op on op.id = p.adjusts_payable_id
    where b.type = 'contractor' and not b.is_demo and i.state = 'returned' and i.returned_at is not null
      and extract(year from (i.returned_at at time zone 'America/Toronto')) = ${year}
  `);
  return rows.map((r) => ({ ...r, base_cents: Number(r.base_cents), tax_cents: Number(r.tax_cents) }));
}

export async function getYearEndReview(year: number) {
  checkYear(year);
  const [lines, treatments, people, decisions, [settings], latestSnapshot] = await Promise.all([
    yearLines(year),
    db.select().from(compensationTaxTreatments),
    db
      .select({
        staffId: staffProfiles.id,
        firstName: staffProfiles.firstName,
        lastName: staffProfiles.lastName,
        email: staffProfiles.email,
        legalName: staffSensitive.legalName,
        businessName: staffSensitive.businessName,
        businessNumber: staffSensitive.businessNumber,
        gstHstNumber: staffSensitive.gstHstNumber,
        mailingStreet: staffSensitive.mailingStreet,
        mailingCity: staffSensitive.mailingCity,
        mailingProvince: staffSensitive.mailingProvince,
        mailingPostalCode: staffSensitive.mailingPostalCode,
      })
      .from(staffProfiles)
      .leftJoin(staffSensitive, eq(staffSensitive.staffId, staffProfiles.id)),
    db.select().from(yearEndRecipients).where(eq(yearEndRecipients.year, year)),
    db.select({ threshold: orgSettings.yearEndThresholdCents }).from(orgSettings).where(eq(orgSettings.id, 1)),
    latestSnapshotFor(year),
  ]);
  const threshold = settings?.threshold ?? T4A_THRESHOLD_CENTS;
  const treatment = (category: string) => {
    if (category === "fee") return { box048: true, decided: true };
    const t = treatments.find((x) => x.category === category);
    if (!t?.approvedAt || t.yearEnd === "review") return { box048: false, decided: false };
    return { box048: t.yearEnd === "box_048", decided: true };
  };
  const byStaff = new Map<string, { a: Amounts; candidate: number; undecided: Map<string, number> }>();
  for (const l of lines) {
    const entry = byStaff.get(l.staff_id) ?? { a: zero(), candidate: 0, undecided: new Map<string, number>() };
    byStaff.set(l.staff_id, entry);
    const a = entry.a;
    if (l.kind === "reversal") {
      a.reversals += l.base_cents;
      a.reversedTax += l.tax_cents;
    } else if (l.category === "adjustment") {
      a.adjustments += l.base_cents;
      a.tax += l.tax_cents;
    } else {
      a[GROUPS[l.category as keyof typeof GROUPS] as Group] += l.base_cents;
      a.tax += l.tax_cents;
    }
    a.netPaid += l.base_cents + l.tax_cents;
    // Box 048 candidate: before tax; adjustments follow the line they correct; reversals reduce it.
    const effective = l.category === "adjustment" ? (l.original_category ?? "fee") : l.category;
    const t = treatment(effective);
    if (t.box048) entry.candidate += l.base_cents;
    else if (!t.decided) entry.undecided.set(effective, (entry.undecided.get(effective) ?? 0) + l.base_cents);
  }
  const snapshotRows = new Map<string, string>(((latestSnapshot?.summary as { rows?: { staffId: string; fingerprint: string }[] } | undefined)?.rows ?? []).map((r) => [r.staffId, r.fingerprint]));
  const rows = [...byStaff.entries()]
    .map(([staffId, e]) => {
      const p = people.find((x) => x.staffId === staffId)!;
      const d = decisions.find((x) => x.staffId === staffId);
      const missing = [!p.legalName && "legal name", !(p.mailingStreet && p.mailingCity && p.mailingProvince && p.mailingPostalCode) && "mailing address"].filter((x): x is string => Boolean(x));
      const undecided = [...e.undecided.entries()].filter(([, v]) => v !== 0).map(([category, cents]) => ({ category, label: CATEGORY_LABEL[category] ?? category, cents }));
      const fingerprint = createHash("sha256").update(JSON.stringify([e.a, e.candidate, undecided])).digest("hex").slice(0, 16);
      return {
        staffId,
        name: p.legalName ?? `${p.firstName} ${p.lastName}`,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        legalName: p.legalName,
        businessName: p.businessName,
        businessNumber: p.businessNumber,
        gstHstNumber: p.gstHstNumber,
        mailingStreet: p.mailingStreet,
        mailingCity: p.mailingCity,
        mailingProvince: p.mailingProvince,
        mailingPostalCode: p.mailingPostalCode,
        ...e.a,
        box048CandidateCents: e.candidate,
        undecided,
        overThreshold: e.candidate > threshold,
        // A business number suggests a business (possibly incorporated); the accountant decides.
        possiblyIncorporated: Boolean(p.businessNumber),
        decision: (d?.decision ?? null) as "include" | "exclude" | null,
        decisionReason: d?.decisionReason ?? null,
        identityReceivedAt: d?.identityReceivedAt ?? null,
        missing,
        fingerprint,
        changedSinceSnapshot: latestSnapshot ? snapshotRows.get(staffId) !== fingerprint : false,
        // Back-compat names used by older screens.
        feesCents: e.a.fees,
        hstCents: e.a.tax,
        totalCents: e.a.netPaid,
        slipRequired: e.candidate > threshold,
      };
    })
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  const removed = latestSnapshot ? [...snapshotRows.keys()].filter((id) => !byStaff.has(id)) : [];
  return { year, threshold, rows, latestSnapshot, amendmentReview: Boolean(latestSnapshot && latestSnapshot.status !== "draft" && (rows.some((r) => r.changedSinceSnapshot) || removed.length)), removedSinceSnapshot: removed };
}
export type YearEndRow = Awaited<ReturnType<typeof getYearEndReview>>["rows"][number];

/** Back-compat: the rows only. */
export async function getT4aSummary(year: number) {
  return (await getYearEndReview(year)).rows;
}
export type T4aRow = YearEndRow;

async function latestSnapshotFor(year: number) {
  const [s] = await db.select().from(yearEndSnapshots).where(eq(yearEndSnapshots.year, year)).orderBy(desc(yearEndSnapshots.version)).limit(1);
  return s ?? null;
}

// ─── Decisions and identity tracking ─────────────────────────────────────────────

export async function setYearEndDecision(actorId: string, year: number, staffId: string, input: { decision: "include" | "exclude" | null; reason: string }) {
  checkYear(year);
  if (input.decision && input.reason.trim().length < 5) throw new YearEndError("Record the reason (e.g. the accountant's advice).");
  await db.transaction(async (tx) => {
    const values = { decision: input.decision, decisionReason: input.decision ? input.reason.trim() : null, decidedBy: input.decision ? actorId : null, decidedAt: input.decision ? new Date() : null };
    await tx.insert(yearEndRecipients).values({ year, staffId, ...values }).onConflictDoUpdate({ target: [yearEndRecipients.year, yearEndRecipients.staffId], set: values });
    await recordAudit({ actorId, action: "year_end.decision", entityType: "staff", entityId: staffId, after: { year, decision: input.decision }, reason: input.reason.trim() || null }, tx);
  });
}

/** Records that the accountant has (or no longer has) the tax identity information they need. Never the SIN itself. */
export async function setIdentityReceived(actorId: string, year: number, staffId: string, received: boolean, note: string | null) {
  checkYear(year);
  if (note && /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/.test(note)) throw new YearEndError("Don't enter a SIN or other ID number here; just note that the accountant received it.");
  await db.transaction(async (tx) => {
    const values = { identityReceivedAt: received ? new Date() : null, identityRecordedBy: actorId, identityNote: note?.trim() || null };
    await tx.insert(yearEndRecipients).values({ year, staffId, ...values }).onConflictDoUpdate({ target: [yearEndRecipients.year, yearEndRecipients.staffId], set: values });
    await recordAudit({ actorId, action: "year_end.identity_received", entityType: "staff", entityId: staffId, after: { year, received } }, tx);
  });
}

// ─── Snapshots and hand-off ──────────────────────────────────────────────────────

/** Freezes the current review totals as the next version for the year. */
export async function createYearEndSnapshot(actorId: string, year: number, note: string | null) {
  const review = await getYearEndReview(year);
  const summary = {
    year,
    threshold: review.threshold,
    createdAt: new Date().toISOString(),
    rows: review.rows.map((r) => ({
      staffId: r.staffId,
      name: r.name,
      businessNumber: r.businessNumber,
      fees: r.fees,
      meals: r.meals,
      perDiems: r.perDiems,
      mileage: r.mileage,
      bonuses: r.bonuses,
      adjustments: r.adjustments,
      reversals: r.reversals,
      tax: r.tax,
      reversedTax: r.reversedTax,
      netPaid: r.netPaid,
      box048CandidateCents: r.box048CandidateCents,
      undecided: r.undecided,
      decision: r.decision,
      identityReceived: Boolean(r.identityReceivedAt),
      fingerprint: r.fingerprint,
    })),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(summary.rows)).digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`year_end:${year}`}, 0))`);
    const [{ v }] = (await tx.execute<{ v: number }>(sql`select coalesce(max(version), 0)::int + 1 as v from year_end_snapshots where year = ${year}`)).rows as [{ v: number }];
    const [row] = await tx.insert(yearEndSnapshots).values({ year, version: v, summary, fingerprint, note: note?.trim() || null, createdBy: actorId }).returning();
    await recordAudit({ actorId, action: "year_end.snapshot", entityType: "year_end", entityId: String(year), after: { version: v, recipients: summary.rows.length, fingerprint } }, tx);
    return row!;
  });
}

export async function setSnapshotStatus(actorId: string, snapshotId: string, status: "handed_off" | "filed") {
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(yearEndSnapshots).where(eq(yearEndSnapshots.id, snapshotId)).for("update");
    if (!s) throw new YearEndError("Snapshot not found.");
    if (status === "handed_off" && s.status !== "draft") throw new YearEndError("Already handed off.");
    if (status === "filed" && s.status !== "handed_off") throw new YearEndError("Hand it off to the accountant first.");
    await tx
      .update(yearEndSnapshots)
      .set(status === "handed_off" ? { status, handedOffAt: new Date(), handedOffBy: actorId } : { status, filedAt: new Date(), filedBy: actorId })
      .where(eq(yearEndSnapshots.id, snapshotId));
    await recordAudit({ actorId, action: `year_end.${status}`, entityType: "year_end", entityId: String(s.year), after: { version: s.version } }, tx);
  });
}

export async function listSnapshots(year: number) {
  return db.select({ id: yearEndSnapshots.id, version: yearEndSnapshots.version, status: yearEndSnapshots.status, note: yearEndSnapshots.note, createdAt: yearEndSnapshots.createdAt, handedOffAt: yearEndSnapshots.handedOffAt, filedAt: yearEndSnapshots.filedAt, fingerprint: yearEndSnapshots.fingerprint }).from(yearEndSnapshots).where(and(eq(yearEndSnapshots.year, year))).orderBy(desc(yearEndSnapshots.version));
}

/** The CSV for the accountant (they add SINs). Every download is audited. */
export async function buildT4aCsv(actorId: string, year: number) {
  const review = await getYearEndReview(year);
  const headers = [
    "Recipient legal name",
    "Business name",
    "SIN (accountant to add)",
    "Business number",
    "Street",
    "City",
    "Province",
    "Postal code",
    "Box 048 candidate: fees before GST/HST",
    "Fees",
    "Meal allowances",
    "Per diems",
    "Mileage",
    "Bonuses",
    "Adjustments",
    "Reversals (returned payments)",
    "Sales tax paid (GST/HST/QST)",
    "Sales tax reversed",
    "Net paid",
    "Needs accountant decision",
    `Over threshold (${centsToDecimal(review.threshold)})`,
    "Inclusion decision",
    "Decision reason",
    "Tax identity received by accountant",
    "Business number on file (check incorporation)",
    "Missing details",
    "Changed since last snapshot",
    "Email",
  ];
  const data = review.rows.map((r) => [
    r.legalName ?? `${r.firstName} ${r.lastName}`,
    r.businessName ?? "",
    "",
    r.businessNumber ?? "",
    r.mailingStreet ?? "",
    r.mailingCity ?? "",
    r.mailingProvince ?? "",
    r.mailingPostalCode ?? "",
    centsToDecimal(r.box048CandidateCents),
    centsToDecimal(r.fees),
    centsToDecimal(r.meals),
    centsToDecimal(r.perDiems),
    centsToDecimal(r.mileage),
    centsToDecimal(r.bonuses),
    centsToDecimal(r.adjustments),
    centsToDecimal(r.reversals),
    centsToDecimal(r.tax),
    centsToDecimal(r.reversedTax),
    centsToDecimal(r.netPaid),
    r.undecided.map((u) => `${u.label} ${centsToDecimal(u.cents)}`).join("; "),
    r.overThreshold ? "Yes" : "No",
    r.decision ?? "Not decided",
    r.decisionReason ?? "",
    r.identityReceivedAt ? "Yes" : "No",
    r.possiblyIncorporated ? "Yes" : "No",
    r.missing.join("; "),
    r.changedSinceSnapshot ? "Yes" : "No",
    r.email,
  ]);
  await recordAudit({ actorId, action: "t4a.export", entityType: "report", entityId: `t4a-${year}`, after: { year, recipients: review.rows.length } });
  return { csv: `﻿${toCsv(headers, data)}`, fileName: `RGXM-year-end-review-${year}.csv`, count: review.rows.length };
}
