// Restricted privacy/security incident register: detection, containment, risk assessment,
// notification decisions and remediation. If RGXM already has an approved incident process, this
// register can hold the reference to it; the legal tests (e.g. "real risk of significant harm")
// are assessed by RGXM's Privacy Officer and lawyer, not by Crew.
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { INCIDENT_RISK, INCIDENT_STATUSES, incidents } from "@/server/db/schema";

export class IncidentError extends Error {}

const blank = (v: unknown) => (typeof v === "string" && !v.trim() ? null : v);
const dateTime = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable().optional());

const createSchema = z.object({
  title: z.string().trim().min(5).max(160),
  category: z.enum(["unauthorized_access", "lost_or_stolen_device", "misdirected_email", "vendor_incident", "system_vulnerability", "other"]),
  detectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/),
  description: z.string().trim().min(10).max(4000),
});

export async function reportIncident(actorId: string, raw: z.input<typeof createSchema>) {
  const v = createSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('incident_seq')::text as n`)).rows as [{ n: string }];
    const [row] = await tx.insert(incidents).values({ ...v, reference: `INC-${v.detectedAt.slice(0, 4)}-${n.padStart(3, "0")}`, detectedAt: new Date(v.detectedAt), reportedBy: actorId }).returning();
    await recordAudit({ actorId, action: "incident.report", entityType: "incident", entityId: row!.id, after: { reference: row!.reference, category: v.category } }, tx);
    return row!;
  });
}

const updateSchema = z.object({
  affectedPeopleEstimate: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).nullable()),
  dataCategories: z.array(z.string().trim().min(1).max(60)).max(20),
  containment: z.preprocess(blank, z.string().trim().max(4000).nullable()),
  riskAssessment: z.enum(INCIDENT_RISK),
  riskRationale: z.preprocess(blank, z.string().trim().max(4000).nullable()),
  commissionerNotifiedAt: dateTime,
  individualsNotifiedAt: dateTime,
  otherNotifications: z.preprocess(blank, z.string().trim().max(2000).nullable()),
  remediation: z.preprocess(blank, z.string().trim().max(4000).nullable()),
  status: z.enum(INCIDENT_STATUSES),
});

export async function updateIncident(actorId: string, incidentId: string, raw: z.input<typeof updateSchema>) {
  const v = updateSchema.parse(raw);
  if (v.riskAssessment !== "undetermined" && !v.riskRationale) throw new IncidentError("Record the reasoning behind the risk assessment.");
  if (v.status === "closed" && v.riskAssessment === "undetermined") throw new IncidentError("Complete the risk assessment before closing.");
  if (v.status === "closed" && !v.remediation) throw new IncidentError("Record the remediation before closing.");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(incidents).where(eq(incidents.id, incidentId)).for("update");
    if (!before) throw new IncidentError("Incident not found.");
    if (before.status === "closed") throw new IncidentError("This incident is closed.");
    await tx
      .update(incidents)
      .set({
        ...v,
        commissionerNotifiedAt: v.commissionerNotifiedAt ? new Date(v.commissionerNotifiedAt) : null,
        individualsNotifiedAt: v.individualsNotifiedAt ? new Date(v.individualsNotifiedAt) : null,
        ...(v.status === "closed" ? { closedAt: new Date(), closedBy: actorId } : {}),
      })
      .where(eq(incidents.id, incidentId));
    await recordAudit({ actorId, action: "incident.update", entityType: "incident", entityId: incidentId, before: { status: before.status, risk: before.riskAssessment }, after: { status: v.status, risk: v.riskAssessment } }, tx);
  });
}

export async function listIncidents() {
  return db.select().from(incidents).orderBy(desc(incidents.detectedAt));
}

export async function getIncident(id: string) {
  const [row] = await db.select().from(incidents).where(eq(incidents.id, id));
  return row ?? null;
}
