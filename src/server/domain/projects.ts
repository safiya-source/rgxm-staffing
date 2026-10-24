// Projects, locations, staffing requirements and project team. Authorisation is done by callers.
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { FIELD_ROLES } from "@/lib/roles";
import { isIsoDate, isValidTimeZone } from "@/lib/time";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { clients, projectLocations, projectMembers, projects, shifts, staffingRequirements, users } from "@/server/db/schema";

export class ProjectError extends Error {}

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optDate = z.preprocess(blankToNull, z.string().refine(isIsoDate, "Invalid date").nullable().optional());
const optUuid = z.preprocess(blankToNull, z.string().uuid().nullable().optional());

/** "15000" or "15,000.50" dollars → cents. */
export const moneyToCents = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/[$,\s]/g, "");
    if (s === "") return null;
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return NaN;
    const [w, f = ""] = s.split(".");
    return Number(w) * 100 + Number(f.padEnd(2, "0"));
  },
  z.number({ message: "Enter an amount like 15000 or 15000.50" }).int().nonnegative().nullable(),
);

export { canTransitionProject, PROJECT_STATUSES, PROJECT_TRANSITIONS, type ProjectStatus } from "./project-status";
import { canTransitionProject, type ProjectStatus } from "./project-status";

export const projectSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a project name").max(120),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,30}$/, "Use letters, numbers and dashes, e.g. CAD-2611"),
    clientId: optUuid,
    newClientName: optText(120),
    campaignName: optText(120),
    description: optText(4000),
    ownerId: optUuid,
    coordinatorId: optUuid,
    startDate: optDate,
    endDate: optDate,
    budgetCents: moneyToCents.optional(),
    currency: z.enum(["CAD", "USD"]).default("CAD"),
    internalNotes: optText(4000),
    clientNotes: optText(4000),
  })
  .refine((p) => !p.startDate || !p.endDate || p.endDate >= p.startDate, { message: "End date is before start date", path: ["endDate"] });
export type ProjectInput = z.infer<typeof projectSchema>;

async function resolveClient(tx: Tx, input: ProjectInput) {
  if (input.newClientName) {
    const [existing] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(sql`lower(${clients.name})`, input.newClientName.toLowerCase()));
    if (existing) return existing.id;
    const [created] = await tx.insert(clients).values({ name: input.newClientName }).returning({ id: clients.id });
    return created!.id;
  }
  return input.clientId ?? null;
}

async function assertInternalUsers(tx: Tx, ids: (string | null | undefined)[]) {
  const wanted = ids.filter((x): x is string => Boolean(x));
  if (!wanted.length) return;
  const rows = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, wanted), eq(users.kind, "internal")));
  if (rows.length !== new Set(wanted).size) throw new ProjectError("Owner and coordinator must be RGXM team members.");
}

async function assertCodeFree(tx: Tx, code: string, exceptId?: string) {
  const [row] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
  if (row && row.id !== exceptId) throw new ProjectError(`Project code ${code} is already in use.`);
}

function projectValues(input: ProjectInput, clientId: string | null) {
  return {
    name: input.name,
    code: input.code,
    clientId,
    campaignName: input.campaignName ?? null,
    description: input.description ?? null,
    ownerId: input.ownerId ?? null,
    coordinatorId: input.coordinatorId ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    budgetCents: input.budgetCents ?? null,
    currency: input.currency,
    internalNotes: input.internalNotes ?? null,
    clientNotes: input.clientNotes ?? null,
  };
}

export async function createProject(actorId: string, input: ProjectInput) {
  return db.transaction(async (tx) => {
    await assertCodeFree(tx, input.code);
    await assertInternalUsers(tx, [input.ownerId, input.coordinatorId]);
    const clientId = await resolveClient(tx, input);
    const values = projectValues(input, clientId);
    const [created] = await tx
      .insert(projects)
      .values({ ...values, ownerId: values.ownerId ?? actorId, createdBy: actorId })
      .returning({ id: projects.id });
    await recordAudit({ actorId, action: "project.create", entityType: "project", entityId: created!.id, projectId: created!.id, after: values }, tx);
    return created!.id;
  });
}

export async function updateProject(actorId: string, projectId: string, input: ProjectInput) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!before) throw new ProjectError("Project not found.");
    await assertCodeFree(tx, input.code, projectId);
    await assertInternalUsers(tx, [input.ownerId, input.coordinatorId]);
    const clientId = await resolveClient(tx, input);
    const values = projectValues(input, clientId);
    await tx.update(projects).set(values).where(eq(projects.id, projectId));
    await recordAudit({ actorId, action: "project.update", entityType: "project", entityId: projectId, projectId, before, after: values }, tx);
  });
}

export async function setProjectStatus(actorId: string, projectId: string, to: ProjectStatus, reason: string | null) {
  await db.transaction(async (tx) => {
    const [p] = await tx.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId)).for("update");
    if (!p) throw new ProjectError("Project not found.");
    if (!canTransitionProject(p.status, to)) throw new ProjectError(`A ${p.status} project can't move to ${to}.`);
    if (to === "cancelled" && !reason) throw new ProjectError("Give a reason for cancelling.");
    await tx.update(projects).set({ status: to }).where(eq(projects.id, projectId));
    await recordAudit({ actorId, action: "project.status", entityType: "project", entityId: projectId, projectId, before: p, after: { status: to }, reason }, tx);
  });
}

// ─── Locations ──────────────────────────────────────────────────────────────

const optNumber = (min: number, max: number) => z.preprocess(blankToNull, z.coerce.number().min(min).max(max).nullable().optional());

export const locationSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  address: optText(200),
  city: optText(80),
  province: optText(2),
  timezone: z.string().refine(isValidTimeZone, "Choose a valid time zone"),
  latitude: optNumber(-90, 90),
  longitude: optNumber(-180, 180),
  geofenceMeters: z.preprocess(blankToNull, z.coerce.number().int().min(50).max(5000).nullable().optional()),
  requireLocationAtCheckIn: z.boolean().default(false),
  onsiteContactName: optText(120),
  onsiteContactPhone: optText(40),
  notes: optText(2000),
});
export type LocationInput = z.infer<typeof locationSchema>;

async function shiftCount(tx: Tx, where: ReturnType<typeof eq>) {
  const [r] = await tx.select({ n: count() }).from(shifts).where(and(where, ne(shifts.status, "cancelled")));
  return r?.n ?? 0;
}

export async function saveLocation(actorId: string, projectId: string, locationId: string | null, input: LocationInput) {
  if (input.requireLocationAtCheckIn && (input.latitude == null || input.longitude == null)) {
    throw new ProjectError("Add the venue's latitude and longitude to verify location at check-in.");
  }
  return db.transaction(async (tx) => {
    if (locationId) {
      const [before] = await tx
        .select()
        .from(projectLocations)
        .where(and(eq(projectLocations.id, locationId), eq(projectLocations.projectId, projectId)));
      if (!before) throw new ProjectError("Location not found.");
      if (before.timezone !== input.timezone && (await shiftCount(tx, eq(shifts.locationId, locationId))) > 0) {
        throw new ProjectError("This location already has shifts, so its time zone can't change.");
      }
      await tx.update(projectLocations).set(input).where(eq(projectLocations.id, locationId));
      await recordAudit({ actorId, action: "location.update", entityType: "project_location", entityId: locationId, projectId, before, after: input }, tx);
      return locationId;
    }
    const [created] = await tx.insert(projectLocations).values({ ...input, projectId }).returning({ id: projectLocations.id });
    await recordAudit({ actorId, action: "location.create", entityType: "project_location", entityId: created!.id, projectId, after: input }, tx);
    return created!.id;
  });
}

export async function deleteLocation(actorId: string, projectId: string, locationId: string) {
  await db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: projectLocations.id }).from(projectLocations).where(and(eq(projectLocations.id, locationId), eq(projectLocations.projectId, projectId)));
    if (!owned) throw new ProjectError("Location not found on this project.");
    const [anyShift] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.locationId, locationId)).limit(1);
    if (anyShift) throw new ProjectError("This location has shifts. Cancel or move them first.");
    await tx.delete(staffingRequirements).where(eq(staffingRequirements.locationId, locationId));
    const [before] = await tx
      .delete(projectLocations)
      .where(and(eq(projectLocations.id, locationId), eq(projectLocations.projectId, projectId)))
      .returning();
    await recordAudit({ actorId, action: "location.delete", entityType: "project_location", entityId: locationId, projectId, before }, tx);
  });
}

// ─── Staffing requirements ──────────────────────────────────────────────────

export const requirementSchema = z
  .object({
    locationId: optUuid,
    role: z.enum(FIELD_ROLES),
    quantity: z.coerce.number().int().min(1, "At least 1").max(500),
    defaultRateCents: moneyToCents.optional(),
    responsibilities: optText(2000),
    startDate: optDate,
    endDate: optDate,
  })
  .refine((r) => !r.startDate || !r.endDate || r.endDate >= r.startDate, { message: "End date is before start date", path: ["endDate"] });
export type RequirementInput = z.infer<typeof requirementSchema>;

export async function saveRequirement(actorId: string, projectId: string, requirementId: string | null, input: RequirementInput) {
  return db.transaction(async (tx) => {
    if (input.locationId) {
      const [loc] = await tx
        .select({ id: projectLocations.id })
        .from(projectLocations)
        .where(and(eq(projectLocations.id, input.locationId), eq(projectLocations.projectId, projectId)));
      if (!loc) throw new ProjectError("That location isn't part of this project.");
    }
    const values = { ...input, defaultRateCents: input.defaultRateCents ?? null };
    if (requirementId) {
      const [before] = await tx
        .update(staffingRequirements)
        .set(values)
        .where(and(eq(staffingRequirements.id, requirementId), eq(staffingRequirements.projectId, projectId)))
        .returning();
      if (!before) throw new ProjectError("Requirement not found.");
      await recordAudit({ actorId, action: "requirement.update", entityType: "staffing_requirement", entityId: requirementId, projectId, after: values }, tx);
      return requirementId;
    }
    const [created] = await tx
      .insert(staffingRequirements)
      .values({ ...values, projectId })
      .returning({ id: staffingRequirements.id });
    await recordAudit({ actorId, action: "requirement.create", entityType: "staffing_requirement", entityId: created!.id, projectId, after: values }, tx);
    return created!.id;
  });
}

export async function deleteRequirement(actorId: string, projectId: string, requirementId: string) {
  await db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: staffingRequirements.id }).from(staffingRequirements).where(and(eq(staffingRequirements.id, requirementId), eq(staffingRequirements.projectId, projectId)));
    if (!owned) throw new ProjectError("Requirement not found on this project.");
    // Shifts keep their own copy of role/rate, so they're detached rather than blocked.
    await tx.update(shifts).set({ requirementId: null }).where(and(eq(shifts.requirementId, requirementId), eq(shifts.projectId, projectId)));
    const [before] = await tx
      .delete(staffingRequirements)
      .where(and(eq(staffingRequirements.id, requirementId), eq(staffingRequirements.projectId, projectId)))
      .returning();
    await recordAudit({ actorId, action: "requirement.delete", entityType: "staffing_requirement", entityId: requirementId, projectId, before }, tx);
  });
}

// ─── Project team ───────────────────────────────────────────────────────────

export async function addProjectMember(actorId: string, projectId: string, userId: string) {
  await db.transaction(async (tx) => {
    await assertInternalUsers(tx, [userId]);
    await tx.insert(projectMembers).values({ projectId, userId }).onConflictDoNothing();
    await recordAudit({ actorId, action: "project.member_add", entityType: "project", entityId: projectId, projectId, after: { userId } }, tx);
  });
}

export async function removeProjectMember(actorId: string, projectId: string, userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    await recordAudit({ actorId, action: "project.member_remove", entityType: "project", entityId: projectId, projectId, after: { userId } }, tx);
  });
}
