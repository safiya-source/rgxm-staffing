// Contractor compliance, tax, billing, reporting, privacy-operations and security tables.
// Statuses are text with CHECK constraints (not Postgres enums) so new states can be added in a
// migration without the "unsafe use of new enum value" restriction.
// Policies (tax rules, treatments, retention periods, documents) are data that RGXM, its
// accountant or its lawyer approve; nothing here hard-codes those decisions.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { bookings, payableItems, paymentBatches, projects, shifts, staffProfiles } from "./core";

const id = () => uuid().primaryKey().defaultRandom();
const tstz = () => timestamp({ withTimezone: true });
const createdAt = () => tstz().notNull().defaultNow();
const updatedAt = () =>
  tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const cents = () => bigint({ mode: "number" });
const userRef = () => uuid().references(() => users.id);
const staffRef = () =>
  uuid()
    .notNull()
    .references(() => staffProfiles.id);
const oneOf = (col: string, values: readonly string[]) => sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(", ")})`);

// ───────────────────────────── Onboarding & consent ─────────────────────────────

// contractor_terms = the Independent Contractor Agreement; platform_terms = the Platform Terms of Use.
export const LEGAL_DOCUMENT_KINDS = ["privacy_notice", "contractor_terms", "platform_terms"] as const;
export const LEGAL_DOCUMENT_STATUSES = ["draft", "approved", "retired"] as const;

/** Versioned privacy notice and contractor agreement / platform terms. Approved versions are frozen. */
export const legalDocuments = pgTable(
  "legal_documents",
  {
    id: id(),
    kind: text().notNull(),
    version: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    summaryOfChanges: text(),
    // Contractor agreement versions that authorize RGXM to prepare invoices on the contractor's behalf.
    selfBilling: boolean().notNull().default(false),
    status: text().notNull().default("draft"),
    effectiveAt: tstz(),
    approvedBy: userRef(),
    approvedAt: tstz(),
    // e.g. "Reviewed by <firm>, email of 2026-11-20". Who approved outside Crew.
    approvalReference: text(),
    createdBy: userRef(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("legal_documents_version_uq").on(t.kind, t.version),
    uniqueIndex("legal_documents_one_current_uq").on(t.kind).where(sql`${t.status} = 'approved'`),
    check("legal_documents_kind", oneOf("kind", LEGAL_DOCUMENT_KINDS)),
    check("legal_documents_status", oneOf("status", LEGAL_DOCUMENT_STATUSES)),
    check("legal_documents_approval", sql`${t.status} = 'draft' or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`),
  ],
);

/** Append-only acceptance history (privacy acknowledgement, terms acceptance). */
export const staffAcceptances = pgTable(
  "staff_acceptances",
  {
    id: id(),
    staffId: staffRef(),
    documentId: uuid()
      .notNull()
      .references(() => legalDocuments.id),
    kind: text().notNull(),
    version: text().notNull(),
    acceptedAt: createdAt(),
    userId: userRef(),
    // portal_onboarding | portal_update | recorded_by_rgxm
    method: text().notNull(),
    // Contractor agreement only: who the contracting party is (the person, or a business they
    // represent) and the person accepting on the business's behalf.
    actingFor: text(),
    contractingParty: text(),
    authorizedRepresentative: text(),
    recordedBy: userRef(),
  },
  (t) => [uniqueIndex("staff_acceptances_uq").on(t.staffId, t.documentId), index("staff_acceptances_staff_idx").on(t.staffId)],
);

/** Optional consent choices. Only approved, active purposes are offered to contractors. */
export const consentPurposes = pgTable("consent_purposes", {
  key: text().primaryKey(),
  label: text().notNull(),
  description: text().notNull(),
  version: integer().notNull().default(1),
  active: boolean().notNull().default(false),
  approvedBy: userRef(),
  approvedAt: tstz(),
  approvalReference: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Append-only: each grant or withdrawal of an optional consent. The latest row per purpose wins. */
export const staffConsentEvents = pgTable(
  "staff_consent_events",
  {
    id: id(),
    staffId: staffRef(),
    purposeKey: text()
      .notNull()
      .references(() => consentPurposes.key),
    purposeVersion: integer().notNull(),
    granted: boolean().notNull(),
    recordedAt: createdAt(),
    userId: userRef(),
    method: text().notNull(),
  },
  (t) => [index("staff_consent_events_staff_idx").on(t.staffId, t.purposeKey, t.recordedAt)],
);

/** RGXM's approval of the person for the contractor process (assessment done outside Crew). */
export const contractorApprovals = pgTable(
  "contractor_approvals",
  {
    id: id(),
    staffId: staffRef(),
    approvedBy: userRef().notNull(),
    approvedOn: date().notNull(),
    assessmentReference: text(),
    notes: text(),
    createdAt: createdAt(),
    revokedAt: tstz(),
    revokedBy: userRef(),
    revokeReason: text(),
  },
  (t) => [
    uniqueIndex("contractor_approvals_current_uq").on(t.staffId).where(sql`${t.revokedAt} is null`),
    check("contractor_approvals_revoke_reason", sql`${t.revokedAt} is null or length(trim(coalesce(${t.revokeReason}, ''))) > 0`),
  ],
);

export const CONTRACTOR_EVIDENCE_KINDS = [
  "wsib_clearance",
  "wsib_coverage_not_required",
  "independent_operator",
  "business_registration",
  "insurance",
  "other",
] as const;

/** Status evidence (e.g. WSIB, business registration, insurance). Optional; nothing requires it. */
export const contractorEvidence = pgTable(
  "contractor_evidence",
  {
    id: id(),
    staffId: staffRef(),
    kind: text().notNull(),
    reference: text(),
    issuedOn: date(),
    expiresOn: date(),
    storageKey: text(),
    notes: text(),
    verifiedBy: userRef(),
    verifiedAt: tstz(),
    createdBy: userRef(),
    createdAt: createdAt(),
    removedAt: tstz(),
    removedBy: userRef(),
  },
  (t) => [index("contractor_evidence_staff_idx").on(t.staffId), check("contractor_evidence_kind", oneOf("kind", CONTRACTOR_EVIDENCE_KINDS))],
);

/** Contractor email preferences (shift-opportunity emails can be switched off; essential ones can't). */
export const staffEmailPreferences = pgTable("staff_email_preferences", {
  staffId: uuid()
    .primaryKey()
    .references(() => staffProfiles.id),
  shiftOpportunityEmails: boolean().notNull().default(true),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Project compensation ─────────────────────────────

export const COMPENSATION_CATEGORIES = ["meal_breakfast", "meal_lunch", "meal_dinner", "per_diem", "mileage", "bonus"] as const;
export const PAYABLE_CATEGORIES = ["fee", ...COMPENSATION_CATEGORIES, "adjustment"] as const;
export const COMPENSATION_STATUSES = ["pending", "approved", "rejected", "void"] as const;

/** Per-project switches and rates for allowances, mileage and bonuses (all off by default). */
export const projectCompensationSettings = pgTable("project_compensation_settings", {
  projectId: uuid()
    .primaryKey()
    .references(() => projects.id),
  mealsEnabled: boolean().notNull().default(false),
  perDiemEnabled: boolean().notNull().default(false),
  mileageEnabled: boolean().notNull().default(false),
  bonusEnabled: boolean().notNull().default(false),
  breakfastCents: integer().notNull().default(2000),
  lunchCents: integer().notNull().default(2500),
  dinnerCents: integer().notNull().default(4000),
  perDiemCents: integer().notNull().default(8500),
  // Dollars per km, exact decimal.
  mileageRate: numeric({ precision: 8, scale: 4 }).notNull().default("0.7300"),
  updatedBy: userRef(),
  updatedAt: updatedAt(),
});

/**
 * One allowance, mileage claim or bonus for one contractor and work date. The rate and amount are
 * snapshotted when recorded; approval creates the payable (bill line).
 */
export const compensationItems = pgTable(
  "compensation_items",
  {
    id: id(),
    staffId: staffRef(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    shiftId: uuid().references(() => shifts.id),
    bookingId: uuid().references(() => bookings.id),
    workDate: date().notNull(),
    category: text().notNull(),
    // Meal / per diem amount or km rate used, as an exact decimal (dollars).
    unitRate: numeric({ precision: 12, scale: 4 }).notNull(),
    // 1 for allowances and bonuses; kilometres for mileage.
    quantity: numeric({ precision: 12, scale: 2 }).notNull().default("1"),
    amountCents: cents().notNull(),
    tripDate: date(),
    businessPurpose: text(),
    reason: text(),
    status: text().notNull().default("pending"),
    requestedBy: userRef().notNull(),
    requestedAt: createdAt(),
    decidedBy: userRef(),
    decidedAt: tstz(),
    decisionNote: text(),
    payableItemId: uuid(),
  },
  (t) => [
    index("compensation_items_project_idx").on(t.projectId, t.workDate),
    index("compensation_items_staff_idx").on(t.staffId, t.workDate),
    // One breakfast/lunch/dinner/per diem per contractor per date, across all shifts and projects.
    uniqueIndex("compensation_items_daily_uq")
      .on(t.staffId, t.workDate, t.category)
      .where(sql`${t.category} in ('meal_breakfast', 'meal_lunch', 'meal_dinner', 'per_diem') and ${t.status} in ('pending', 'approved')`),
    check("compensation_items_category", oneOf("category", COMPENSATION_CATEGORIES)),
    check("compensation_items_status", oneOf("status", COMPENSATION_STATUSES)),
    check("compensation_items_amount", sql`${t.amountCents} >= 0 and ${t.quantity} > 0 and ${t.unitRate} >= 0`),
    check(
      "compensation_items_mileage",
      sql`${t.category} <> 'mileage' or (${t.tripDate} is not null and length(trim(coalesce(${t.businessPurpose}, ''))) > 0)`,
    ),
    check("compensation_items_bonus", sql`${t.category} <> 'bonus' or length(trim(coalesce(${t.reason}, ''))) > 0`),
  ],
);

// ───────────────────────────── Tax configuration ─────────────────────────────

export const TAX_COMPONENTS = ["GST", "HST", "QST", "PST"] as const;
export const RULE_STATUSES = ["draft", "approved", "retired"] as const;

/** Service categories RGXM bills contractors' work under. Only approved ones are used for tax. */
export const serviceCategories = pgTable(
  "service_categories",
  {
    key: text().primaryKey(),
    label: text().notNull(),
    description: text(),
    // event_province: place of supply is the event province (qualifying onsite services);
    // finance_review: always routed to Finance.
    placeOfSupplyRule: text().notNull().default("finance_review"),
    active: boolean().notNull().default(true),
    approvedBy: userRef(),
    approvedAt: tstz(),
    approvalReference: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check("service_categories_rule", oneOf("place_of_supply_rule", ["event_province", "finance_review"]))],
);

/** Effective-dated sales-tax rates per jurisdiction (and optionally per service category). */
export const taxRules = pgTable(
  "tax_rules",
  {
    id: id(),
    jurisdiction: text().notNull(),
    component: text().notNull(),
    // Parts per million: 13% = 130000, 9.975% = 99750.
    ratePpm: integer().notNull(),
    serviceCategory: text().references(() => serviceCategories.key),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    status: text().notNull().default("draft"),
    approvedBy: userRef(),
    approvedAt: tstz(),
    approvalReference: text(),
    notes: text(),
    createdBy: userRef(),
    createdAt: createdAt(),
  },
  (t) => [
    index("tax_rules_lookup_idx").on(t.jurisdiction, t.effectiveFrom),
    check("tax_rules_component", oneOf("component", TAX_COMPONENTS)),
    check("tax_rules_status", oneOf("status", RULE_STATUSES)),
    check("tax_rules_rate", sql`${t.ratePpm} between 0 and 500000`),
    check("tax_rules_dates", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
    check("tax_rules_approval", sql`${t.status} = 'draft' or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`),
  ],
);

export const GST_HST_TREATMENTS = ["taxable", "not_taxable", "review"] as const;
export const YEAR_END_TREATMENTS = ["box_048", "other_box", "exclude", "review"] as const;

/** Accountant-approved sales-tax and year-end treatment for each compensation category. */
export const compensationTaxTreatments = pgTable(
  "compensation_tax_treatments",
  {
    category: text().primaryKey(),
    gstHst: text().notNull().default("review"),
    yearEnd: text().notNull().default("review"),
    yearEndBox: text(),
    notes: text(),
    approvedBy: userRef(),
    approvedAt: tstz(),
    approvalReference: text(),
    updatedBy: userRef(),
    updatedAt: updatedAt(),
  },
  () => [
    check("compensation_tax_treatments_category", oneOf("category", PAYABLE_CATEGORIES)),
    check("compensation_tax_treatments_gst", oneOf("gst_hst", GST_HST_TREATMENTS)),
    check("compensation_tax_treatments_year_end", oneOf("year_end", YEAR_END_TREATMENTS)),
  ],
);

/** The tax decision stored on each bill line: one row per component (e.g. GST and QST). Immutable. */
export const payableTaxLines = pgTable(
  "payable_tax_lines",
  {
    id: id(),
    payableItemId: uuid()
      .notNull()
      .references(() => payableItems.id),
    component: text().notNull(),
    jurisdiction: text().notNull(),
    ratePpm: integer().notNull(),
    taxableCents: cents().notNull(),
    taxCents: cents().notNull(),
    taxRuleId: uuid().references(() => taxRules.id),
    serviceCategory: text(),
    basis: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("payable_tax_lines_payable_idx").on(t.payableItemId), check("payable_tax_lines_component", oneOf("component", TAX_COMPONENTS))],
);

// ───────────────────────────── Bills & accounting ─────────────────────────────

/** Stable supplier mapping for the accounting system (one per contractor). */
export const accountingSuppliers = pgTable(
  "accounting_suppliers",
  {
    id: id(),
    staffId: uuid()
      .notNull()
      .unique()
      .references(() => staffProfiles.id),
    supplierRef: text().notNull().unique(),
    // The name the accounting system knows them by, fixed when first mapped (Finance can update).
    displayName: text().notNull(),
    // The supplier/vendor id in RGXM's accounting system, once Finance has matched it.
    externalId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

export const BILL_STATUSES = ["open", "paid", "void"] as const;

/**
 * An accounting bill (or vendor credit) for one contractor: its lines are payables. Created when a
 * payment batch is approved; a failed bank payment is retried against the same bill.
 */
export const bills = pgTable(
  "bills",
  {
    id: id(),
    billNumber: text().notNull().unique(),
    staffId: staffRef(),
    supplierId: uuid()
      .notNull()
      .references(() => accountingSuppliers.id),
    kind: text().notNull().default("bill"),
    billDate: date().notNull(),
    dueDate: date().notNull(),
    termsSnapshot: jsonb().notNull().default({}),
    currency: text().notNull().default("CAD"),
    subtotalCents: cents().notNull(),
    taxCents: cents().notNull(),
    totalCents: cents().notNull(),
    isDemo: boolean().notNull().default(false),
    status: text().notNull().default("open"),
    // self_billed: a "Contractor Invoice — Prepared by RGXM on behalf of" the contractor, under the
    // self-billing arrangement they accepted; rgxm_bill: RGXM's internal record (contractor invoices separately).
    invoiceKind: text().notNull().default("rgxm_bill"),
    selfBillingAcceptanceId: uuid(),
    // Everything printed on the document, frozen at issue (supplier, customer, lines, tax, terms).
    document: jsonb().notNull().default({}),
    contractorConfirmedAt: tstz(),
    createdFromBatchId: uuid().references(() => paymentBatches.id),
    finalizedBy: userRef().notNull(),
    finalizedAt: createdAt(),
  },
  (t) => [
    index("bills_staff_idx").on(t.staffId),
    check("bills_kind", oneOf("kind", ["bill", "credit"])),
    check("bills_status", oneOf("status", BILL_STATUSES)),
    check("bills_total", sql`${t.totalCents} = ${t.subtotalCents} + ${t.taxCents}`),
    check("bills_invoice_kind", oneOf("invoice_kind", ["self_billed", "rgxm_bill"])),
    check("bills_self_billing_basis", sql`${t.invoiceKind} <> 'self_billed' or ${t.selfBillingAcceptanceId} is not null`),
  ],
);

export const ACCOUNTING_EXPORT_STATUSES = ["generated", "imported", "rejected"] as const;

/** Accounting (bill) exports, separate from bank payment files. */
export const accountingExports = pgTable(
  "accounting_exports",
  {
    id: id(),
    reference: text().notNull().unique(),
    format: text().notNull(),
    storageKey: text().notNull(),
    sha256: text().notNull(),
    rowCount: integer().notNull(),
    billCount: integer().notNull(),
    isDemo: boolean().notNull().default(false),
    config: jsonb().notNull().default({}),
    status: text().notNull().default("generated"),
    statusNote: text(),
    statusChangedBy: userRef(),
    statusChangedAt: tstz(),
    exportedBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  () => [check("accounting_exports_status", oneOf("status", ACCOUNTING_EXPORT_STATUSES))],
);

/** Which bills went in which accounting export. A bill can be in only one live export. */
export const accountingExportBills = pgTable(
  "accounting_export_bills",
  {
    exportId: uuid()
      .notNull()
      .references(() => accountingExports.id),
    billId: uuid()
      .notNull()
      .references(() => bills.id),
    active: boolean().notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.exportId, t.billId] }),
    uniqueIndex("accounting_export_bills_live_uq").on(t.billId).where(sql`${t.active}`),
  ],
);

/** Invoices contractors send RGXM, compared with the bill Crew calculated. */
export const contractorInvoices = pgTable(
  "contractor_invoices",
  {
    id: id(),
    staffId: staffRef(),
    billId: uuid().references(() => bills.id),
    invoiceNumber: text().notNull(),
    invoiceDate: date().notNull(),
    subtotalCents: cents().notNull(),
    taxCents: cents().notNull(),
    totalCents: cents().notNull(),
    expectedSubtotalCents: cents(),
    expectedTaxCents: cents(),
    status: text().notNull(),
    storageKey: text(),
    recordedBy: userRef().notNull(),
    createdAt: createdAt(),
    resolvedBy: userRef(),
    resolvedAt: tstz(),
    resolutionNote: text(),
  },
  (t) => [
    uniqueIndex("contractor_invoices_number_uq").on(t.staffId, t.invoiceNumber),
    check("contractor_invoices_status", oneOf("status", ["matched", "variance_review", "resolved", "unmatched"])),
  ],
);

/** A contractor's request to review their pay or tax ("Tax details incorrect? Request a review."). */
export const payReviewRequests = pgTable(
  "pay_review_requests",
  {
    id: id(),
    staffId: staffRef(),
    payableItemId: uuid().references(() => payableItems.id),
    billId: uuid().references(() => bills.id),
    kind: text().notNull(),
    message: text().notNull(),
    status: text().notNull().default("open"),
    resolution: text(),
    resolvedBy: userRef(),
    resolvedAt: tstz(),
    createdBy: userRef(),
    createdAt: createdAt(),
  },
  (t) => [
    index("pay_review_requests_status_idx").on(t.status, t.createdAt),
    check("pay_review_requests_kind", oneOf("kind", ["tax", "amount", "hours", "other"])),
    check("pay_review_requests_status", oneOf("status", ["open", "resolved"])),
  ],
);

// ───────────────────────────── Year-end ─────────────────────────────

/** Per contractor and year: inclusion decision and whether the accountant has their tax identity. */
export const yearEndRecipients = pgTable(
  "year_end_recipients",
  {
    year: smallint().notNull(),
    staffId: staffRef(),
    decision: text(),
    decisionReason: text(),
    decidedBy: userRef(),
    decidedAt: tstz(),
    // The accountant confirmed they have what they need (e.g. SIN). Crew never stores the SIN.
    identityReceivedAt: tstz(),
    identityRecordedBy: userRef(),
    identityNote: text(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.year, t.staffId] }),
    check("year_end_recipients_decision", sql`${t.decision} is null or ${t.decision} in ('include', 'exclude')`),
    check("year_end_recipients_reason", sql`${t.decision} is null or length(trim(coalesce(${t.decisionReason}, ''))) > 0`),
  ],
);

/** Frozen copy of the year-end review totals handed to the accountant. */
export const yearEndSnapshots = pgTable(
  "year_end_snapshots",
  {
    id: id(),
    year: smallint().notNull(),
    version: integer().notNull(),
    summary: jsonb().notNull(),
    fingerprint: text().notNull(),
    status: text().notNull().default("draft"),
    note: text(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    handedOffAt: tstz(),
    handedOffBy: userRef(),
    filedAt: tstz(),
    filedBy: userRef(),
  },
  (t) => [
    uniqueIndex("year_end_snapshots_version_uq").on(t.year, t.version),
    check("year_end_snapshots_status", oneOf("status", ["draft", "handed_off", "filed"])),
  ],
);

// ───────────────────────────── Privacy operations ─────────────────────────────

/** Retention period per record category. Deletion runs only for periods RGXM has set. */
export const retentionPolicies = pgTable("retention_policies", {
  category: text().primaryKey(),
  label: text().notNull(),
  retentionDays: integer(),
  // delete | clear_fields | anonymize | restricted_archive | not_deletable
  action: text().notNull(),
  description: text(),
  approvalReference: text(),
  approvedBy: userRef(),
  approvedAt: tstz(),
  updatedBy: userRef(),
  updatedAt: updatedAt(),
});

/** Deletion report: what each scheduled run removed or skipped. */
export const retentionRuns = pgTable(
  "retention_runs",
  {
    id: id(),
    ranAt: createdAt(),
    category: text().notNull(),
    affected: integer().notNull(),
    skippedHeld: integer().notNull().default(0),
    detail: jsonb().notNull().default({}),
  },
  (t) => [index("retention_runs_ran_idx").on(t.ranAt)],
);

/** Legal hold: stops scheduled deletion and erasure for a person or project. */
export const legalHolds = pgTable(
  "legal_holds",
  {
    id: id(),
    staffId: uuid().references(() => staffProfiles.id),
    projectId: uuid().references(() => projects.id),
    reason: text().notNull(),
    placedBy: userRef().notNull(),
    placedAt: createdAt(),
    releasedBy: userRef(),
    releasedAt: tstz(),
    releaseReason: text(),
  },
  (t) => [
    check("legal_holds_scope", sql`(${t.staffId} is not null) <> (${t.projectId} is not null)`),
    check("legal_holds_release", sql`${t.releasedAt} is null or length(trim(coalesce(${t.releaseReason}, ''))) > 0`),
  ],
);

export const PRIVACY_REQUEST_KINDS = ["access", "correction", "deletion"] as const;
export const PRIVACY_REQUEST_STATUSES = ["received", "verifying", "in_review", "responded", "closed", "refused", "withdrawn"] as const;

/** Access, correction and deletion requests, worked by the privacy officer. */
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: id(),
    reference: text().notNull().unique(),
    kind: text().notNull(),
    staffId: uuid().references(() => staffProfiles.id),
    requesterName: text().notNull(),
    requesterContact: text(),
    receivedAt: tstz().notNull(),
    receivedVia: text(),
    details: text(),
    // Set from RGXM's configured response period; null until RGXM configures one.
    dueAt: tstz(),
    extendedDueAt: tstz(),
    extensionReason: text(),
    identityVerifiedAt: tstz(),
    identityVerifiedBy: userRef(),
    identityMethod: text(),
    status: text().notNull().default("received"),
    // { notes: {reviewed, note}, evaluations: ..., messages: ..., files: ..., logs: ..., payments: ... }
    reviewChecklist: jsonb().notNull().default({}),
    redactionNotes: text(),
    responseSummary: text(),
    responseStorageKey: text(),
    responseSha256: text(),
    respondedAt: tstz(),
    responseMethod: text(),
    assignedTo: userRef(),
    closedAt: tstz(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("privacy_requests_status_idx").on(t.status, t.receivedAt),
    check("privacy_requests_kind", oneOf("kind", PRIVACY_REQUEST_KINDS)),
    check("privacy_requests_status", oneOf("status", PRIVACY_REQUEST_STATUSES)),
  ],
);

export const INCIDENT_RISK = ["undetermined", "real_risk_of_significant_harm", "no_real_risk"] as const;
export const INCIDENT_STATUSES = ["open", "contained", "closed"] as const;

/** Restricted privacy/security incident register. Avoid personal details in free text. */
export const incidents = pgTable(
  "incidents",
  {
    id: id(),
    reference: text().notNull().unique(),
    title: text().notNull(),
    category: text().notNull(),
    detectedAt: tstz().notNull(),
    description: text().notNull(),
    affectedPeopleEstimate: integer(),
    dataCategories: text().array().notNull().default(sql`'{}'::text[]`),
    containment: text(),
    riskAssessment: text().notNull().default("undetermined"),
    riskRationale: text(),
    commissionerNotifiedAt: tstz(),
    individualsNotifiedAt: tstz(),
    otherNotifications: text(),
    remediation: text(),
    status: text().notNull().default("open"),
    reportedBy: userRef().notNull(),
    closedBy: userRef(),
    closedAt: tstz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check("incidents_risk", oneOf("risk_assessment", INCIDENT_RISK)),
    check("incidents_status", oneOf("status", INCIDENT_STATUSES)),
  ],
);

// ───────────────────────────── Security ─────────────────────────────

/** Fresh two-step verification per session, for payment approval and payment-detail changes. */
export const authStepUps = pgTable("auth_step_ups", {
  sessionId: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  verifiedAt: tstz().notNull(),
});

/** Network/browser contexts an internal user has signed in from (hashed; no raw IPs). */
export const knownSignInContexts = pgTable(
  "known_sign_in_contexts",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fingerprint: text().notNull(),
    firstSeenAt: createdAt(),
    lastSeenAt: tstz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fingerprint] })],
);
