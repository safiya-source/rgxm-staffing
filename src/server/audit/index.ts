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

// Pass the surrounding transaction so the audit row commits (or rolls back) with the change.
export async function recordAudit(entry: AuditEntry, tx: Tx | typeof db = db) {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    projectId: entry.projectId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
  });
}
