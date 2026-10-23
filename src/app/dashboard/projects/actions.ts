"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runAction, UserFacingError } from "@/server/actions";
import { db } from "@/server/db";
import { documents, shifts } from "@/server/db/schema";
import * as comms from "@/server/domain/comms";
import { kickOutbox } from "@/server/notify/run";
import * as projects from "@/server/domain/projects";
import * as shiftsDomain from "@/server/domain/shifts";
import { authorizeInternal, authorizeProject, ForbiddenError } from "@/server/session";

const uuid = z.string().uuid();

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof projects.ProjectError || err instanceof shiftsDomain.ShiftError || err instanceof comms.CommsError) throw new UserFacingError(err.message);
    throw err;
  }
}

function projectFromForm(fd: FormData) {
  return projects.projectSchema.parse({
    name: fd.get("name"),
    code: fd.get("code"),
    clientId: fd.get("clientId") === "__new" ? null : fd.get("clientId"),
    newClientName: fd.get("clientId") === "__new" ? fd.get("newClientName") : null,
    campaignName: fd.get("campaignName"),
    description: fd.get("description"),
    ownerId: fd.get("ownerId"),
    coordinatorId: fd.get("coordinatorId"),
    startDate: fd.get("startDate"),
    endDate: fd.get("endDate"),
    budgetCents: fd.get("budget"),
    currency: fd.get("currency") || "CAD",
    internalNotes: fd.get("internalNotes"),
    clientNotes: fd.get("clientNotes"),
  });
}

export async function createProjectAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | undefined;
  const result = await runAction(async (): Promise<ActionResult> => {
    const viewer = await authorizeInternal("project.create");
    id = await guard(() => projects.createProject(viewer.userId, projectFromForm(fd)));
    return { ok: true };
  });
  if (result.ok && id) redirect(`/dashboard/projects/${id}`);
  return result;
}

export async function updateProjectAction(projectId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("project.edit", uuid.parse(projectId));
    await guard(() => projects.updateProject(viewer.userId, projectId, projectFromForm(fd)));
    revalidatePath(`/dashboard/projects/${projectId}`, "layout");
    return { ok: true, message: "Project saved." };
  });
}

export async function setProjectStatusAction(projectId: string, status: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("project.edit", uuid.parse(projectId));
    const to = z.enum(projects.PROJECT_STATUSES).parse(status);
    await guard(() => projects.setProjectStatus(viewer.userId, projectId, to, reason.trim() || null));
    revalidatePath(`/dashboard/projects/${projectId}`, "layout");
    return { ok: true, message: "Status updated." };
  });
}

export async function saveLocationAction(projectId: string, locationId: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("project.edit", uuid.parse(projectId));
    const input = projects.locationSchema.parse({
      name: fd.get("name"),
      address: fd.get("address"),
      city: fd.get("city"),
      province: fd.get("province"),
      timezone: fd.get("timezone"),
      latitude: fd.get("latitude"),
      longitude: fd.get("longitude"),
      geofenceMeters: fd.get("geofenceMeters"),
      requireLocationAtCheckIn: fd.get("requireLocationAtCheckIn") === "on",
      onsiteContactName: fd.get("onsiteContactName"),
      onsiteContactPhone: fd.get("onsiteContactPhone"),
      notes: fd.get("notes"),
    });
    await guard(() => projects.saveLocation(viewer.userId, projectId, locationId ? uuid.parse(locationId) : null, input));
    revalidatePath(`/dashboard/projects/${projectId}`, "layout");
    return { ok: true, message: "Location saved." };
  });
}

export async function deleteLocationAction(projectId: string, locationId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("project.edit", uuid.parse(projectId));
    await guard(() => projects.deleteLocation(viewer.userId, projectId, uuid.parse(locationId)));
    revalidatePath(`/dashboard/projects/${projectId}`, "layout");
    return { ok: true, message: "Location removed." };
  });
}

export async function saveRequirementAction(projectId: string, requirementId: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("project.edit", uuid.parse(projectId));
    const input = projects.requirementSchema.parse({
      locationId: fd.get("locationId"),
      role: fd.get("role"),
      quantity: fd.get("quantity"),
      defaultRateCents: fd.get("rate"),
      responsibilities: fd.get("responsibilities"),
      startDate: fd.get("startDate"),
      endDate: fd.get("endDate"),
    });
    await guard(() => projects.saveRequirement(viewer.userId, projectId, requirementId ? uuid.parse(requirementId) : null, input));
    revalidatePath(`/dashboard/projects/${projectId}`, "layout");
    return { ok: true, message: "Requirement saved." };
  });
}

export async function deleteRequirementAction(projectId: string, requirementId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("project.edit", uuid.parse(projectId));
    await guard(() => projects.deleteRequirement(viewer.userId, projectId, uuid.parse(requirementId)));
    revalidatePath(`/dashboard/projects/${projectId}`, "layout");
    return { ok: true, message: "Requirement removed." };
  });
}

export async function addMemberAction(projectId: string, userId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("project.edit", uuid.parse(projectId));
    await guard(() => projects.addProjectMember(viewer.userId, projectId, uuid.parse(userId)));
    revalidatePath(`/dashboard/projects/${projectId}`, "layout");
    return { ok: true, message: "Team member added." };
  });
}

export async function removeMemberAction(projectId: string, userId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("project.edit", uuid.parse(projectId));
    await guard(() => projects.removeProjectMember(viewer.userId, projectId, uuid.parse(userId)));
    revalidatePath(`/dashboard/projects/${projectId}`, "layout");
    return { ok: true, message: "Team member removed." };
  });
}

// ─── Shifts ─────────────────────────────────────────────────────────────────

async function authorizeShift(shiftId: string) {
  const [s] = await db.select({ projectId: shifts.projectId }).from(shifts).where(eq(shifts.id, uuid.parse(shiftId)));
  if (!s) throw new ForbiddenError("Shift not found.");
  const viewer = await authorizeProject("shift.manage", s.projectId);
  return { viewer, projectId: s.projectId };
}

function revalidateSchedules(projectId: string) {
  kickOutbox();
  revalidatePath(`/dashboard/projects/${projectId}`, "layout");
  revalidatePath("/dashboard/schedule");
}

export async function createShiftsAction(projectId: string, input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const viewer = await authorizeProject("shift.manage", uuid.parse(projectId));
    const parsed = shiftsDomain.bulkShiftSchema.parse(input);
    const ids = await guard(() => shiftsDomain.createShifts(viewer.userId, projectId, parsed));
    revalidateSchedules(projectId);
    return { ok: true, message: `Created ${ids.length} shift${ids.length === 1 ? "" : "s"}.`, data: { count: ids.length } };
  });
}

export async function updateShiftAction(shiftId: string, input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { viewer, projectId } = await authorizeShift(shiftId);
    const parsed = shiftsDomain.shiftUpdateSchema.parse(input);
    await guard(() => shiftsDomain.updateShift(viewer.userId, shiftId, parsed));
    revalidateSchedules(projectId);
    return { ok: true, message: "Shift updated." };
  });
}

export async function moveShiftAction(shiftId: string, date: string): Promise<ActionResult> {
  return runAction(async () => {
    const { viewer, projectId } = await authorizeShift(shiftId);
    await guard(() => shiftsDomain.moveShiftToDate(viewer.userId, shiftId, z.string().parse(date)));
    revalidateSchedules(projectId);
    return { ok: true, message: "Shift moved." };
  });
}

export async function duplicateShiftAction(shiftId: string, dates: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const { viewer, projectId } = await authorizeShift(shiftId);
    const n = await guard(() => shiftsDomain.duplicateShift(viewer.userId, shiftId, z.array(z.string()).parse(dates)));
    revalidateSchedules(projectId);
    return { ok: true, message: `Created ${n} cop${n === 1 ? "y" : "ies"}.` };
  });
}

export async function cancelShiftAction(shiftId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const { viewer, projectId } = await authorizeShift(shiftId);
    const n = await guard(() => shiftsDomain.cancelShift(viewer.userId, shiftId, reason));
    revalidateSchedules(projectId);
    return { ok: true, message: n ? `Shift cancelled. ${n} booking${n === 1 ? "" : "s"} cancelled with it.` : "Shift cancelled." };
  });
}

export async function publishShiftsAction(projectId: string, shiftIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("shift.manage", uuid.parse(projectId));
    const n = await guard(() => shiftsDomain.publishShifts(viewer.userId, projectId, z.array(uuid).parse(shiftIds)));
    revalidateSchedules(projectId);
    return { ok: true, message: `Published ${n} shift${n === 1 ? "" : "s"}.` };
  });
}

export async function createTemplateAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("shift.manage");
    await guard(() => shiftsDomain.createTemplate(viewer.userId, shiftsDomain.templateSchema.parse(input)));
    revalidatePath("/dashboard/projects", "layout");
    return { ok: true, message: "Template saved." };
  });
}

export async function deleteTemplateAction(templateId: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("shift.manage");
    await guard(() => shiftsDomain.deleteTemplate(viewer.userId, uuid.parse(templateId)));
    revalidatePath("/dashboard/projects", "layout");
    return { ok: true, message: "Template deleted." };
  });
}

// ─── Communications ─────────────────────────────────────────────────────────

export async function postAnnouncementAction(projectId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeProject("comms.manage", uuid.parse(projectId));
    const input = comms.announcementSchema.parse({ title: fd.get("title"), body: fd.get("body"), important: fd.get("important") === "on" });
    await guard(() => comms.postAnnouncement(viewer.userId, projectId, input));
    kickOutbox();
    revalidatePath(`/dashboard/projects/${projectId}/comms`);
    return { ok: true, message: "Announcement posted to confirmed staff." };
  });
}

export async function archiveDocumentAction(documentId: string): Promise<ActionResult> {
  return runAction(async () => {
    const [doc] = await db.select({ projectId: documents.projectId }).from(documents).where(eq(documents.id, uuid.parse(documentId)));
    if (!doc) throw new ForbiddenError("Document not found.");
    const viewer = await authorizeProject("comms.manage", doc.projectId);
    await guard(() => comms.archiveDocument(viewer.userId, documentId));
    revalidatePath(`/dashboard/projects/${doc.projectId}/comms`);
    return { ok: true, message: "Document removed. Staff can no longer see it." };
  });
}
