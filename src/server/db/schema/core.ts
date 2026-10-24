// Application schema. Column names are derived as snake_case (see drizzle casing config).
// Conventions:
//  - money: bigint minor units (cents) + ISO currency; rates are cents per hour
//  - instants: timestamptz (UTC); local display uses the location's IANA time zone
//  - durations: integer minutes
//  - history-bearing rows are never hard-deleted; immutability is enforced by triggers
//    in the custom migration (see migrations/*_integrity.sql)
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import {
  attendanceEventType,
  attendanceMethod,
  availabilityKind,
  batchStatus,
  batchType,
  bookingStatus,
  deliveryStatus,
  documentCategory,
  fieldRole,
  internalRole,
  notificationChannel,
  offerResponseKind,
  outboxStatus,
  payableStatus,
  projectStatus,
  shiftStatus,
  staffStatus,
  timesheetStatus,
  workerClassification,
} from "./enums";

const id = () => uuid().primaryKey().defaultRandom();
const tstz = () => timestamp({ withTimezone: true });
const createdAt = () => tstz().notNull().defaultNow();
const updatedAt = () =>
  tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const cents = () => bigint({ mode: "number" });
const currency = () => text().notNull().default("CAD");
const userRef = () => uuid().references(() => users.id);

// ───────────────────────────── Organisation & access ─────────────────────────────

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: internalRole().notNull(),
    grantedBy: userRef(),
    grantedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const orgSettings = pgTable("org_settings", {
  id: smallint().primaryKey().default(1),
  orgName: text().notNull().default("RGXM"),
  accentColor: text().notNull().default("#E4572E"),
  defaultTimezone: text().notNull().default("America/Toronto"),
  defaultCurrency: currency(),
  checkInWindowMinutes: integer().notNull().default(60),
  checkInGeofenceMeters: integer().notNull().default(300),
  payPeriodRule: text().notNull().default("semi_monthly"),
  payableRounding: text().notNull().default("minute"),
  updatedAt: updatedAt(),
  updatedBy: userRef(),
});

export const clients = pgTable("clients", {
  id: id(),
  name: text().notNull(),
  billingContact: text(),
  notes: text(),
  isDemo: boolean().notNull().default(false),
  archivedAt: tstz(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Talent ─────────────────────────────

export const staffProfiles = pgTable(
  "staff_profiles",
  {
    id: id(),
    // Null until the person signs in; imported profiles link on first sign-in by email.
    userId: uuid()
      .unique()
      .references(() => users.id),
    firstName: text().notNull(),
    lastName: text().notNull(),
    preferredName: text(),
    email: text().notNull(),
    phone: text(),
    photoKey: text(),
    city: text(),
    province: text().default("ON"),
    serviceArea: text(),
    status: staffStatus().notNull().default("active"),
    experienceYears: smallint(),
    experienceSummary: text(),
    hasDriversLicence: boolean(),
    hasVehicle: boolean(),
    willingToTravel: boolean(),
    travelRadiusKm: integer(),
    preferredEventTypes: text().array().notNull().default(sql`'{}'::text[]`),
    preferredHours: text(),
    classification: workerClassification().notNull().default("unset"),
    onboardingCompletedAt: tstz(),
    isDemo: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("staff_profiles_email_uq").on(sql`lower(${t.email})`),
    index("staff_profiles_city_idx").on(t.city),
    index("staff_profiles_status_idx").on(t.status),
  ],
);

// Restricted fields kept apart so default queries never select them.
export const staffSensitive = pgTable("staff_sensitive", {
  staffId: uuid()
    .primaryKey()
    .references(() => staffProfiles.id, { onDelete: "cascade" }),
  legalName: text(),
  businessName: text(),
  businessNumber: text(),
  taxRegistered: boolean().notNull().default(false),
  gstHstNumber: text(),
  emergencyContactName: text(),
  emergencyContactPhone: text(),
  emergencyContactRelation: text(),
  // Tokenized reference from a payment provider; raw bank details are never stored.
  paymentProviderRef: text(),
  updatedAt: updatedAt(),
});

export const staffRoles = pgTable(
  "staff_roles",
  {
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    role: fieldRole().notNull(),
    qualifiedAt: createdAt(),
    verifiedBy: userRef(),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.role] })],
);

// Rate history: rows are closed (effective_to) and superseded, never edited in place.
export const staffRates = pgTable(
  "staff_rates",
  {
    id: id(),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
    role: fieldRole().notNull(),
    rateCents: integer().notNull(),
    currency: currency(),
    effectiveFrom: tstz().notNull().defaultNow(),
    effectiveTo: tstz(),
    setBy: userRef(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("staff_rates_lookup_idx").on(t.staffId, t.role, t.effectiveFrom),
    uniqueIndex("staff_rates_one_open_uq").on(t.staffId, t.role).where(sql`${t.effectiveTo} is null`),
    check("staff_rates_positive", sql`${t.rateCents} >= 0`),
  ],
);

export const skills = pgTable("skills", { id: id(), name: text().notNull().unique() });
export const languages = pgTable("languages", { id: id(), name: text().notNull().unique() });
export const certifications = pgTable("certifications", { id: id(), name: text().notNull().unique() });

export const staffSkills = pgTable(
  "staff_skills",
  {
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    skillId: uuid()
      .notNull()
      .references(() => skills.id),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.skillId] })],
);

export const staffLanguages = pgTable(
  "staff_languages",
  {
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    languageId: uuid()
      .notNull()
      .references(() => languages.id),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.languageId] })],
);

export const staffCertifications = pgTable(
  "staff_certifications",
  {
    id: id(),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    certificationId: uuid()
      .notNull()
      .references(() => certifications.id),
    issuedOn: date(),
    expiresOn: date(),
    documentKey: text(),
  },
  (t) => [index("staff_certs_staff_idx").on(t.staffId)],
);

// Weekly recurring availability preference (local time in the staff member's area).
export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: id(),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    weekday: smallint().notNull(), // 0 = Sunday
    startTime: time().notNull(),
    endTime: time().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("availability_rules_staff_idx").on(t.staffId),
    check("availability_rules_weekday", sql`${t.weekday} between 0 and 6`),
  ],
);

export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: id(),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    date: date().notNull(),
    kind: availabilityKind().notNull(),
    startTime: time(),
    endTime: time(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index("availability_exceptions_staff_date_idx").on(t.staffId, t.date)],
);

export const staffLists = pgTable("staff_lists", {
  id: id(),
  name: text().notNull(),
  description: text(),
  createdBy: userRef(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const staffListMembers = pgTable(
  "staff_list_members",
  {
    listId: uuid()
      .notNull()
      .references(() => staffLists.id, { onDelete: "cascade" }),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    addedBy: userRef(),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.staffId] })],
);

export const staffFiles = pgTable("staff_files", {
  id: id(),
  staffId: uuid()
    .notNull()
    .references(() => staffProfiles.id, { onDelete: "cascade" }),
  kind: text().notNull(), // resume | portfolio | other
  fileName: text().notNull(),
  storageKey: text().notNull(),
  contentType: text(),
  sizeBytes: integer(),
  uploadedBy: userRef(),
  createdAt: createdAt(),
});

export const internalNotes = pgTable(
  "internal_notes",
  {
    id: id(),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
    authorId: userRef().notNull(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("internal_notes_staff_idx").on(t.staffId)],
);

// ───────────────────────────── Projects & scheduling ─────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: id(),
    code: text().notNull().unique(),
    name: text().notNull(),
    clientId: uuid().references(() => clients.id),
    campaignName: text(),
    description: text(),
    ownerId: userRef(),
    coordinatorId: userRef(),
    startDate: date(),
    endDate: date(),
    status: projectStatus().notNull().default("draft"),
    budgetCents: cents(),
    currency: currency(),
    internalNotes: text(),
    clientNotes: text(),
    isDemo: boolean().notNull().default(false),
    createdBy: userRef(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_status_idx").on(t.status), index("projects_owner_idx").on(t.ownerId)],
);

// Additional internal users assigned to a project beyond owner/coordinator.
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const projectLocations = pgTable(
  "project_locations",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    name: text().notNull(),
    address: text(),
    city: text(),
    province: text(),
    timezone: text().notNull().default("America/Toronto"),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    geofenceMeters: integer(),
    requireLocationAtCheckIn: boolean().notNull().default(false),
    onsiteContactName: text(),
    onsiteContactPhone: text(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("project_locations_project_idx").on(t.projectId)],
);

export const breakPolicies = pgTable("break_policies", {
  id: id(),
  name: text().notNull(),
  // e.g. { "unpaidBreakMinutes": 30, "afterWorkedMinutes": 300 }. Never applied unless explicitly attached.
  rules: jsonb().notNull().default({}),
  description: text(),
  createdAt: createdAt(),
});

export const staffingRequirements = pgTable(
  "staffing_requirements",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    locationId: uuid().references(() => projectLocations.id),
    role: fieldRole().notNull(),
    quantity: integer().notNull(),
    defaultRateCents: integer(),
    responsibilities: text(),
    startDate: date(),
    endDate: date(),
    createdAt: createdAt(),
  },
  (t) => [
    index("staffing_requirements_project_idx").on(t.projectId),
    check("staffing_requirements_qty", sql`${t.quantity} > 0`),
  ],
);

// Authorised overrides of a staff member's default rate for a project.
export const projectRates = pgTable(
  "project_rates",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    role: fieldRole().notNull(),
    staffId: uuid().references(() => staffProfiles.id), // null = applies to everyone in the role
    rateCents: integer().notNull(),
    approvedBy: userRef().notNull(),
    approvedAt: createdAt(),
    revokedAt: tstz(),
  },
  (t) => [index("project_rates_lookup_idx").on(t.projectId, t.role)],
);

export const shiftTemplates = pgTable("shift_templates", {
  id: id(),
  name: text().notNull(),
  role: fieldRole().notNull(),
  localStartTime: time().notNull(),
  localEndTime: time().notNull(), // earlier than start = crosses midnight
  headcount: integer().notNull().default(1),
  rateCents: integer(),
  breakPolicyId: uuid().references(() => breakPolicies.id),
  uniform: text(),
  instructions: text(),
  createdBy: userRef(),
  createdAt: createdAt(),
});

export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    locationId: uuid()
      .notNull()
      .references(() => projectLocations.id),
    requirementId: uuid().references(() => staffingRequirements.id),
    role: fieldRole().notNull(),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    timezone: text().notNull(),
    headcount: integer().notNull().default(1),
    rateCents: integer(),
    currency: currency(),
    breakPolicyId: uuid().references(() => breakPolicies.id),
    reportingLocation: text(),
    onsiteContact: text(),
    uniform: text(),
    instructions: text(),
    status: shiftStatus().notNull().default("draft"),
    cancelledAt: tstz(),
    cancelledBy: userRef(),
    cancelReason: text(),
    createdBy: userRef(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("shifts_project_starts_idx").on(t.projectId, t.startsAt),
    index("shifts_location_idx").on(t.locationId),
    index("shifts_starts_idx").on(t.startsAt),
    check("shifts_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check("shifts_headcount", sql`${t.headcount} > 0`),
  ],
);

export const projectTeams = pgTable("project_teams", {
  id: id(),
  projectId: uuid()
    .notNull()
    .references(() => projects.id),
  locationId: uuid().references(() => projectLocations.id),
  name: text().notNull(),
  leadStaffId: uuid().references(() => staffProfiles.id),
  createdAt: createdAt(),
});

export const projectTeamMembers = pgTable(
  "project_team_members",
  {
    teamId: uuid()
      .notNull()
      .references(() => projectTeams.id, { onDelete: "cascade" }),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.staffId] })],
);

// ───────────────────────────── Offers & bookings ─────────────────────────────
// One row per (shift, staff) engagement, moving through the booking lifecycle
// draft → offered → interested/declined → awaiting_confirmation → confirmed/waitlisted → completed/no_show/cancelled.
// starts_at/ends_at are copied from the shift so the database can reject double-booking
// with an exclusion constraint (see migrations).

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    shiftId: uuid()
      .notNull()
      .references(() => shifts.id),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    role: fieldRole().notNull(),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    status: bookingStatus().notNull().default("draft"),
    offeredRateCents: integer(),
    // Snapshot fixed at confirmation; never recomputed from current rates.
    agreedRateCents: integer(),
    rateSource: text(), // default | project | shift | manual
    currency: currency(),
    responseDeadline: tstz(),
    waitlistPosition: integer(),
    offeredAt: tstz(),
    offeredBy: userRef(),
    respondedAt: tstz(),
    confirmedAt: tstz(),
    confirmedBy: userRef(),
    overrideBy: userRef(),
    overrideReason: text(),
    overrideAt: tstz(),
    cancelledAt: tstz(),
    cancelledBy: userRef(),
    cancelReason: text(),
    cancelledByStaff: boolean(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("bookings_active_uq")
      .on(t.shiftId, t.staffId)
      .where(sql`${t.status} not in ('cancelled', 'declined')`),
    index("bookings_staff_time_idx").on(t.staffId, t.startsAt),
    index("bookings_shift_status_idx").on(t.shiftId, t.status),
    index("bookings_project_idx").on(t.projectId),
    check(
      "bookings_override_reason",
      sql`${t.overrideBy} is null or (${t.overrideReason} is not null and length(trim(${t.overrideReason})) > 0)`,
    ),
    check(
      "bookings_confirmed_rate",
      sql`${t.status} not in ('confirmed', 'completed') or ${t.agreedRateCents} is not null`,
    ),
  ],
);

export const offerResponses = pgTable(
  "offer_responses",
  {
    id: id(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id),
    response: offerResponseKind().notNull(),
    message: text(),
    respondedBy: userRef(),
    createdAt: createdAt(),
  },
  (t) => [index("offer_responses_booking_idx").on(t.bookingId)],
);

export const bookingStatusHistory = pgTable(
  "booking_status_history",
  {
    id: id(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id),
    fromStatus: bookingStatus(),
    toStatus: bookingStatus().notNull(),
    actorId: userRef(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [index("booking_status_history_booking_idx").on(t.bookingId)],
);

// ───────────────────────────── Communications ─────────────────────────────

export const documents = pgTable(
  "documents",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    shiftId: uuid().references(() => shifts.id),
    title: text().notNull(),
    category: documentCategory().notNull().default("other"),
    fileName: text().notNull(),
    storageKey: text().notNull(),
    contentType: text(),
    sizeBytes: integer(),
    version: integer().notNull().default(1),
    requiresAck: boolean().notNull().default(false),
    uploadedBy: userRef(),
    archivedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index("documents_project_idx").on(t.projectId)],
);

export const documentAcknowledgements = pgTable(
  "document_acknowledgements",
  {
    id: id(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id),
    documentVersion: integer().notNull(),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
    acknowledgedAt: createdAt(),
  },
  (t) => [uniqueIndex("document_ack_uq").on(t.documentId, t.documentVersion, t.staffId)],
);

export const announcements = pgTable(
  "announcements",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    shiftId: uuid().references(() => shifts.id),
    title: text().notNull(),
    body: text().notNull(),
    important: boolean().notNull().default(false),
    authorId: userRef(),
    createdAt: createdAt(),
  },
  (t) => [index("announcements_project_idx").on(t.projectId, t.createdAt)],
);

// One conversation per staff member per project (or a general one when project is null).
export const messageThreads = pgTable(
  "message_threads",
  {
    id: id(),
    projectId: uuid().references(() => projects.id),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
    subject: text(),
    createdAt: createdAt(),
    lastMessageAt: tstz(),
    staffLastReadAt: tstz(),
    rgxmLastReadAt: tstz(),
  },
  (t) => [
    uniqueIndex("message_threads_staff_project_uq").on(t.staffId, sql`coalesce(${t.projectId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    index("message_threads_last_idx").on(t.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadId: uuid()
      .notNull()
      .references(() => messageThreads.id),
    authorId: userRef().notNull(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_thread_idx").on(t.threadId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    href: text(),
    payload: jsonb().notNull().default({}),
    // Prevents duplicate notifications when a job is retried.
    dedupeKey: text().unique(),
    readAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: id(),
    notificationId: uuid().references(() => notifications.id),
    channel: notificationChannel().notNull(),
    toAddress: text().notNull(),
    subject: text(),
    bodyText: text(),
    bodyHtml: text(),
    status: deliveryStatus().notNull().default("queued"),
    transport: text().notNull(), // log | resend | twilio
    providerMessageId: text(),
    error: text(),
    dedupeKey: text().unique(),
    createdAt: createdAt(),
    sentAt: tstz(),
  },
  (t) => [index("notification_deliveries_created_idx").on(t.createdAt)],
);

// Transactional outbox: written in the same transaction as the domain change, processed by the worker.
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    dedupeKey: text().unique(),
    status: outboxStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    availableAt: tstz().notNull().defaultNow(),
    lastError: text(),
    createdAt: createdAt(),
    claimedAt: tstz(),
    processedAt: tstz(),
  },
  (t) => [index("outbox_pending_idx").on(t.status, t.availableAt)],
);

// ───────────────────────────── Attendance & timesheets ─────────────────────────────

// Append-only. Corrections happen on the timesheet, never here.
export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: id(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id),
    type: attendanceEventType().notNull(),
    occurredAt: tstz().notNull(), // device/claimed time
    recordedAt: tstz().notNull().defaultNow(), // server receipt time
    method: attendanceMethod().notNull(),
    recordedBy: userRef(),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    accuracyMeters: doublePrecision(),
    withinGeofence: boolean(),
    // Client-generated idempotency key for offline sync.
    clientEventId: text().unique(),
    note: text(),
  },
  (t) => [index("attendance_events_booking_idx").on(t.bookingId, t.occurredAt)],
);

export const timesheets = pgTable(
  "timesheets",
  {
    id: id(),
    bookingId: uuid()
      .notNull()
      .unique()
      .references(() => bookings.id),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    shiftId: uuid()
      .notNull()
      .references(() => shifts.id),
    status: timesheetStatus().notNull().default("not_started"),
    // Three layers, never collapsed into one (rule 19):
    //  actual_*  — derived from attendance events; never edited by people
    //  worked_*  — the times under review (staff corrections, supervisor and RGXM adjustments)
    //  payable_minutes — what RGXM authorised for payment
    actualStart: tstz(),
    actualEnd: tstz(),
    actualMinutes: integer(),
    workedStart: tstz(),
    workedEnd: tstz(),
    breakMinutes: integer().notNull().default(0),
    payableMinutes: integer(),
    flags: text().array().notNull().default(sql`'{}'::text[]`),
    staffNote: text(),
    supervisorNote: text(),
    reviewNote: text(),
    submittedAt: tstz(),
    verifiedBy: userRef(),
    verifiedAt: tstz(),
    approvedBy: userRef(),
    approvedAt: tstz(),
    lockedAt: tstz(),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("timesheets_project_status_idx").on(t.projectId, t.status),
    index("timesheets_staff_idx").on(t.staffId),
    check("timesheets_minutes_nonneg", sql`coalesce(${t.payableMinutes}, 0) >= 0 and ${t.breakMinutes} >= 0`),
  ],
);

export const timesheetAdjustments = pgTable(
  "timesheet_adjustments",
  {
    id: id(),
    timesheetId: uuid()
      .notNull()
      .references(() => timesheets.id),
    field: text().notNull(),
    oldValue: text(),
    newValue: text(),
    reason: text().notNull(),
    stage: text().notNull(), // staff_correction | supervisor_recommendation | approval | post_approval_correction
    actorId: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("timesheet_adjustments_ts_idx").on(t.timesheetId)],
);

// ───────────────────────────── Money ─────────────────────────────

export const payPeriods = pgTable(
  "pay_periods",
  {
    id: id(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    label: text().notNull(),
    closedAt: tstz(),
  },
  (t) => [uniqueIndex("pay_periods_range_uq").on(t.startsOn, t.endsOn)],
);

export const payableItems = pgTable(
  "payable_items",
  {
    id: id(),
    timesheetId: uuid()
      .notNull()
      .references(() => timesheets.id),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    serviceDate: date().notNull(),
    classification: workerClassification().notNull(),
    payableMinutes: integer().notNull(),
    rateCents: integer().notNull(),
    baseCents: cents().notNull(),
    premiumsCents: cents().notNull().default(0),
    expensesCents: cents().notNull().default(0),
    adjustmentsCents: cents().notNull().default(0),
    taxCents: cents().notNull().default(0),
    totalCents: cents().notNull(),
    currency: currency(),
    // Version of the calculation routine + its inputs, so totals are reproducible.
    calcVersion: text().notNull(),
    calcInputs: jsonb().notNull(),
    status: payableStatus().notNull().default("pending"),
    createdBy: userRef(),
    createdAt: createdAt(),
    voidedAt: tstz(),
    voidedBy: userRef(),
    voidReason: text(),
  },
  (t) => [
    uniqueIndex("payable_items_timesheet_uq").on(t.timesheetId).where(sql`${t.status} <> 'void'`),
    index("payable_items_staff_idx").on(t.staffId),
    index("payable_items_status_idx").on(t.status),
  ],
);

export const expenseClaims = pgTable("expense_claims", {
  id: id(),
  staffId: uuid()
    .notNull()
    .references(() => staffProfiles.id),
  projectId: uuid()
    .notNull()
    .references(() => projects.id),
  bookingId: uuid().references(() => bookings.id),
  kind: text().notNull(), // reimbursement | allowance | per_diem | travel
  description: text().notNull(),
  amountCents: cents().notNull(),
  currency: currency(),
  receiptKey: text(),
  status: text().notNull().default("submitted"), // submitted | approved | rejected
  reviewedBy: userRef(),
  reviewedAt: tstz(),
  payableItemId: uuid().references(() => payableItems.id),
  createdAt: createdAt(),
});

export const paymentBatches = pgTable(
  "payment_batches",
  {
    id: id(),
    reference: text().notNull().unique(),
    type: batchType().notNull(),
    payPeriodId: uuid().references(() => payPeriods.id),
    status: batchStatus().notNull().default("draft"),
    // Demo payables only go into demo batches; their exports are marked "DEMO - DO NOT PAY".
    isDemo: boolean().notNull().default(false),
    totalCents: cents().notNull().default(0),
    currency: currency(),
    createdBy: userRef().notNull(),
    approvedBy: userRef(),
    approvedAt: tstz(),
    paidAt: tstz(),
    voidedAt: tstz(),
    voidReason: text(),
    createdAt: createdAt(),
  },
  (t) => [check("payment_batches_four_eyes", sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.createdBy}`)],
);

export const paymentBatchItems = pgTable(
  "payment_batch_items",
  {
    id: id(),
    batchId: uuid()
      .notNull()
      .references(() => paymentBatches.id),
    payableItemId: uuid()
      .notNull()
      .references(() => payableItems.id),
    amountCents: cents().notNull(),
    // Cleared when the batch is voided so the item can be re-batched.
    active: boolean().notNull().default(true),
    paidAt: tstz(),
    failureReason: text(),
  },
  (t) => [
    uniqueIndex("payment_batch_items_active_uq").on(t.payableItemId).where(sql`${t.active}`),
    index("payment_batch_items_batch_idx").on(t.batchId),
  ],
);

export const paymentExports = pgTable(
  "payment_exports",
  {
    id: id(),
    batchId: uuid()
      .notNull()
      .references(() => paymentBatches.id),
    format: text().notNull(), // csv_generic | csv_qbo | xlsx
    storageKey: text(),
    sha256: text().notNull(),
    rowCount: integer().notNull(),
    exportedBy: userRef().notNull(),
    createdAt: createdAt(),
    supersededAt: tstz(),
    supersededReason: text(),
  },
  (t) => [
    uniqueIndex("payment_exports_one_live_uq")
      .on(t.batchId, t.format)
      .where(sql`${t.supersededAt} is null`),
  ],
);

// Contractor self-billing documents or uploaded invoices (Phase 2 workflow; table reserved now).
export const billingDocuments = pgTable(
  "billing_documents",
  {
    id: id(),
    documentNumber: text().notNull().unique(),
    kind: text().notNull(), // self_billed | uploaded_invoice | payroll_statement
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
    batchId: uuid().references(() => paymentBatches.id),
    subtotalCents: cents().notNull(),
    taxCents: cents().notNull().default(0),
    totalCents: cents().notNull(),
    currency: currency(),
    storageKey: text(),
    snapshot: jsonb().notNull(),
    issuedAt: tstz(),
    voidedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index("billing_documents_staff_idx").on(t.staffId)],
);

// ───────────────────────────── Performance ─────────────────────────────

export const evaluations = pgTable(
  "evaluations",
  {
    id: id(),
    staffId: uuid()
      .notNull()
      .references(() => staffProfiles.id),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    bookingId: uuid().references(() => bookings.id),
    reviewerId: userRef().notNull(),
    punctuality: smallint(),
    reliability: smallint(),
    professionalism: smallint(),
    guestEngagement: smallint(),
    communication: smallint(),
    initiative: smallint(),
    overall: smallint(),
    feedback: text(),
    recommendRehire: boolean(),
    createdAt: createdAt(),
  },
  (t) => [
    index("evaluations_staff_idx").on(t.staffId),
    check(
      "evaluations_scale",
      sql`coalesce(${t.overall}, 3) between 1 and 5 and coalesce(${t.punctuality}, 3) between 1 and 5`,
    ),
  ],
);

// ───────────────────────────── Audit ─────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: userRef(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    projectId: uuid(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    ipAddress: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_project_idx").on(t.projectId),
    index("audit_log_created_idx").on(t.createdAt),
  ],
);
