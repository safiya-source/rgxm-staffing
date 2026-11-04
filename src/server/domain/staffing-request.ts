// "New staffing request" shortcut: one form that creates whatever is missing (project, venue)
// and the published shifts, all in one transaction, so a failure never leaves a half-made project.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import { createProject, locationSchema, ProjectError, projectSchema, saveLocation } from "./projects";
import { bulkShiftSchema, createShifts } from "./shifts";

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** The shift part of the request: everything in a bulk shift except where it happens. */
export const requestShiftsSchema = bulkShiftSchema.omit({ locationId: true, publish: true, requirementId: true, breakPolicyId: true });

export const staffingRequestSchema = z.object({
  project: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), projectId: z.string().uuid() }),
    z.object({
      mode: z.literal("new"),
      name: z.string().trim().min(2, "Enter a project name").max(120),
      clientId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()),
      newClientName: z.preprocess(blankToNull, z.string().trim().max(120).nullable().optional()),
      code: z.preprocess(blankToNull, z.string().trim().nullable().optional()),
    }),
  ]),
  location: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), locationId: z.string().uuid() }),
    z.object({ mode: z.literal("new"), name: z.string(), address: z.unknown().optional(), city: z.unknown().optional(), timezone: z.string() }),
  ]),
  shifts: requestShiftsSchema,
});
export type StaffingRequestInput = z.infer<typeof staffingRequestSchema>;

/** A readable, unused project code from the name and first shift date, e.g. "OREO-2611". */
export async function suggestProjectCode(name: string, startDate: string) {
  const letters =
    name
      .normalize("NFD")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .filter((w) => w && !["the", "and", "of", "for", "a"].includes(w.toLowerCase()))
      .map((w, i, all) => (all.length === 1 ? w.slice(0, 6) : w.slice(0, i === 0 ? 4 : 1)))
      .join("")
      .toUpperCase()
      .slice(0, 8) || "PRJ";
  const yymm = /^\d{4}-\d{2}/.test(startDate) ? startDate.slice(2, 4) + startDate.slice(5, 7) : "";
  const base = [letters, yymm].filter(Boolean).join("-");
  for (let n = 1; n < 50; n++) {
    const code = n === 1 ? base : `${base}-${n}`;
    const [taken] = await db.select({ id: projects.id }).from(projects).where(eq(sql`upper(${projects.code})`, code));
    if (!taken) return code;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Creates the request. Callers check permissions first (project.create for a new project,
 * project.edit for a new venue, shift.manage for the shifts). Shifts are published so offers
 * can go out straight away. Returns where to send offers from.
 */
export async function createStaffingRequest(actorId: string, input: StaffingRequestInput) {
  const shifts = requestShiftsSchema.parse(input.shifts);
  const newProject =
    input.project.mode === "new"
      ? projectSchema.parse({
          name: input.project.name,
          code: input.project.code || (await suggestProjectCode(input.project.name, shifts.startDate)),
          clientId: input.project.clientId ?? null,
          newClientName: input.project.clientId ? null : (input.project.newClientName ?? null),
          // The project spans the shifts; it can be edited later.
          startDate: shifts.startDate,
          endDate: shifts.endDate,
        })
      : null;
  const newLocation = input.location.mode === "new" ? locationSchema.parse({ ...input.location, mode: undefined }) : null;

  return db.transaction(async (tx) => {
    const projectId = newProject ? await createProject(actorId, newProject, tx) : (input.project as { projectId: string }).projectId;
    if (newProject) {
      // A project created from a staffing request is already being staffed.
      await tx.update(projects).set({ status: "staffing" }).where(eq(projects.id, projectId));
      await recordAudit({ actorId, action: "project.status", entityType: "project", entityId: projectId, projectId, before: { status: "draft" }, after: { status: "staffing" }, reason: "Created from a staffing request" }, tx);
    }
    if (!newProject) {
      const [p] = await tx.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId));
      if (!p) throw new ProjectError("Project not found.");
      if (p.status === "closed" || p.status === "cancelled") throw new ProjectError(`This project is ${p.status}. Reopen it or start a new one.`);
    }
    const locationId = newLocation ? await saveLocation(actorId, projectId, null, newLocation, tx) : (input.location as { locationId: string }).locationId;
    const shiftIds = await createShifts(actorId, projectId, { ...shifts, locationId, publish: true }, tx);
    return { projectId, locationId, shiftIds, group: `${shifts.role}:${locationId}` };
  });
}
