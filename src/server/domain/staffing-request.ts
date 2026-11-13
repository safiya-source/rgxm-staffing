// "New staffing request" shortcut: one form that creates whatever is missing (project, venue)
// and the published shifts, all in one transaction, so a failure never leaves a half-made project.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { FIELD_ROLE_NAMES } from "@/lib/roles";
import { isIsoDate, isLocalTime, MAX_BULK_SHIFTS } from "@/lib/time";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import { compensationSettingsSchema, saveCompensationSettings } from "./compensation";
import { createProject, locationSchema, ProjectError, projectSchema, saveLocation } from "./projects";
import { bulkShiftSchema, createShifts, shiftDetailsSchema } from "./shifts";

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** One role in the request, e.g. 10 Brand Ambassadors at $25. */
export const requestRoleSchema = bulkShiftSchema.pick({ role: true, headcount: true, rateCents: true });

/** One working day in the request, with its own times (an end at or before the start ends the next day). */
export const requestDaySchema = z
  .object({
    date: z.string().refine(isIsoDate, "Pick a date"),
    startTime: z.string().refine(isLocalTime, "Enter a start time"),
    endTime: z.string().refine(isLocalTime, "Enter an end time"),
  })
  .refine((d) => d.startTime !== d.endTime, "Start and end time can't be the same");

/**
 * The shift part of the request: the days (each with its own times), shared details for staff, and
 * one or more roles. Each role gets a shift on every day.
 */
export const requestShiftsSchema = shiftDetailsSchema
  .omit({ role: true, headcount: true, rateCents: true, requirementId: true, breakPolicyId: true })
  .extend({
    days: z
      .array(requestDaySchema)
      .min(1, "Add at least one day")
      .max(120)
      .superRefine((days, ctx) => {
        const seen = new Set<string>();
        for (const d of days) {
          const key = `${d.date} ${d.startTime}-${d.endTime}`;
          if (seen.has(key)) ctx.addIssue({ code: "custom", message: `${d.date} ${d.startTime}–${d.endTime} is listed twice.` });
          seen.add(key);
        }
      }),
    roles: z
      .array(requestRoleSchema)
      .min(1, "Add at least one role")
      .max(8)
      .superRefine((roles, ctx) => {
        const seen = new Set<string>();
        for (const r of roles) {
          if (seen.has(r.role)) ctx.addIssue({ code: "custom", message: `${FIELD_ROLE_NAMES[r.role]} is listed twice. Combine them into one line.` });
          seen.add(r.role);
        }
      }),
  })
  .superRefine((s, ctx) => {
    if (s.days.length * s.roles.length > MAX_BULK_SHIFTS) ctx.addIssue({ code: "custom", message: `That would create more than ${MAX_BULK_SHIFTS} shifts.` });
  });

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
  // Allowances, per diems, mileage and bonus for the project (saved to its compensation settings).
  compensation: compensationSettingsSchema.optional(),
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
  // `input` is already parsed (rates are in cents). Parsing again would convert the rates a second time.
  const shifts = input.shifts;
  const dates = shifts.days.map((d) => d.date).sort();
  const firstDay = dates[0]!;
  const lastDay = dates.at(-1)!;
  const newProject =
    input.project.mode === "new"
      ? projectSchema.parse({
          name: input.project.name,
          code: input.project.code || (await suggestProjectCode(input.project.name, firstDay)),
          clientId: input.project.clientId ?? null,
          newClientName: input.project.clientId ? null : (input.project.newClientName ?? null),
          // The project spans the shifts; it can be edited later.
          startDate: firstDay,
          endDate: lastDay,
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
    if (input.compensation) await saveCompensationSettings(actorId, projectId, input.compensation, tx);
    const { roles, days, ...details } = shifts;
    const shiftIds: string[] = [];
    for (const r of roles) {
      for (const d of [...days].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))) {
        const one = bulkShiftSchema.parse({ ...details, ...r, rateCents: undefined, locationId, startDate: d.date, endDate: d.date, weekdays: [], startTime: d.startTime, endTime: d.endTime, publish: true });
        shiftIds.push(...(await createShifts(actorId, projectId, { ...one, rateCents: r.rateCents }, tx)));
      }
    }
    return { projectId, locationId, shiftIds, roles: roles.length, group: `${roles[0]!.role}:${locationId}` };
  });
}
