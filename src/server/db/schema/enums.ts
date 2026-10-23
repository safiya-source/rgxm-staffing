import { pgEnum } from "drizzle-orm/pg-core";

export const userKind = pgEnum("user_kind", ["internal", "staff"]);
export const internalRole = pgEnum("internal_role", [
  "admin",
  "project_manager",
  "staffing_coordinator",
  "finance",
]);
export const fieldRole = pgEnum("field_role", ["BA", "TL", "PA", "AM"]);
export const staffStatus = pgEnum("staff_status", ["active", "inactive", "suspended", "archived"]);
export const workerClassification = pgEnum("worker_classification", ["unset", "contractor", "employee"]);

export const projectStatus = pgEnum("project_status", [
  "draft",
  "staffing",
  "confirmed",
  "live",
  "completed",
  "reconciliation",
  "closed",
  "cancelled",
]);
export const shiftStatus = pgEnum("shift_status", ["draft", "open", "filled", "live", "completed", "cancelled"]);

export const bookingStatus = pgEnum("booking_status", [
  "draft",
  "offered",
  "interested",
  "declined",
  "awaiting_confirmation",
  "confirmed",
  "waitlisted",
  "cancelled",
  "completed",
  "no_show",
]);
export const offerResponseKind = pgEnum("offer_response_kind", ["interested", "unavailable", "more_info"]);

export const availabilityKind = pgEnum("availability_kind", ["available", "unavailable"]);

export const documentCategory = pgEnum("document_category", [
  "brand_guidelines",
  "event_brief",
  "training",
  "talking_points",
  "uniform",
  "site_map",
  "run_of_show",
  "emergency",
  "other",
]);

export const attendanceEventType = pgEnum("attendance_event_type", ["check_in", "check_out"]);
export const attendanceMethod = pgEnum("attendance_method", ["self", "supervisor", "admin", "offline_sync"]);

export const timesheetStatus = pgEnum("timesheet_status", [
  "not_started",
  "in_progress",
  "submitted",
  "needs_review",
  "supervisor_verified",
  "approved",
  "locked",
  "exported",
  "paid",
]);

export const payableStatus = pgEnum("payable_status", [
  "pending",
  "batched",
  "exported",
  "paid",
  "failed",
  "disputed",
  "void",
]);
export const batchType = pgEnum("batch_type", ["contractor", "payroll"]);
export const batchStatus = pgEnum("batch_status", ["draft", "approved", "exported", "paid", "void"]);

export const notificationChannel = pgEnum("notification_channel", ["in_app", "email", "sms"]);
export const deliveryStatus = pgEnum("delivery_status", ["queued", "sent", "logged", "suppressed", "failed"]);
export const outboxStatus = pgEnum("outbox_status", ["pending", "processing", "done", "failed"]);
