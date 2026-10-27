import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { HistoryIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/format";
import { resolveGrant } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { auditLog, projectMembers, projects, users } from "@/server/db/schema";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const viewer = await requireInternal("audit.view");
  const grant = resolveGrant(viewer.roles, "audit.view");

  // Project-scoped viewers only see entries for projects they're assigned to.
  let scope = sql`true`;
  if (grant === "assigned") {
    const owned = await db
      .select({ id: projects.id })
      .from(projects)
      .where(or(eq(projects.ownerId, viewer.userId), eq(projects.coordinatorId, viewer.userId)));
    const member = await db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, viewer.userId));
    const ids = [...new Set([...owned, ...member].map((p) => p.id))];
    scope = ids.length ? inArray(auditLog.projectId, ids) : sql`false`;
  }

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      reason: auditLog.reason,
      createdAt: auditLog.createdAt,
      actor: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(scope)
    .orderBy(desc(auditLog.id))
    .limit(200);

  if (rows.length === 0) {
    return <EmptyState icon={HistoryIcon} title="No audit entries yet" description="Changes to people, projects, hours and payments are recorded here." />;
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">Most recent 200 entries. Entries can&apos;t be edited or deleted.</p>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When (Toronto)</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatInZone(r.createdAt, "America/Toronto", "MMM d, yyyy h:mm a")}</TableCell>
                <TableCell>{r.actor ?? "System"}</TableCell>
                <TableCell className="font-mono text-xs">{r.action}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.entityType}
                  {r.entityId ? <span className="ml-1 font-mono">{r.entityId.slice(0, 8)}</span> : null}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
