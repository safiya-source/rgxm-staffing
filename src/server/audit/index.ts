import { db, type Tx } from "@/server/db";
import { auditLog } from "@/server/db/schema";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

// Personal details are never copied into the audit log: the entity id identifies the person, and
// these fields are replaced with "[redacted]" wherever they appear in before/after.
const PERSONAL_KEYS = new Set(
  [
    "email", "phone", "firstName", "lastName", "preferredName", "fullName", "legalName", "businessName", "name",
    "address", "street", "mailingStreet", "mailingCity", "mailingPostalCode", "postalCode", "emergencyContactName",
    "emergencyContactPhone", "emergencyContactRelation", "sin", "dateOfBirth", "gstHstNumber", "businessNumber",
    "latitude", "longitude", "ipAddress", "userAgent", "requesterName", "requesterContact",
  ].map((k) => k.toLowerCase()),
);

export function minimizePersonalData(value: unknown, depth = 0): unknown {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => minimizePersonalData(v, depth + 1));
  if (typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, PERSONAL_KEYS.has(k.toLowerCase()) && v != null ? "[redacted]" : minimizePersonalData(v, depth + 1)]));
  }
  return value;
}

// Pass the surrounding transaction so the audit row commits (or rolls back) with the change.
export async function recordAudit(entry: AuditEntry, tx: Tx | typeof db = db) {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    projectId: entry.projectId ?? null,
    before: minimizePersonalData(entry.before ?? null),
    after: minimizePersonalData(entry.after ?? null),
    reason: entry.reason ?? null,
  });
}
