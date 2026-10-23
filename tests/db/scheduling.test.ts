import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as projects from "@/server/domain/projects";
import * as shifts from "@/server/domain/shifts";
import { book, makeStaff, makeUser, one, pool } from "./fixtures";

let actor: { id: string };
let projectId: string;
let torontoId: string;
let vancouverId: string;

const baseShift = { role: "BA" as const, headcount: 2, rateCents: "25.00" };

beforeAll(async () => {
  actor = await makeUser();
  projectId = await projects.createProject(
    actor.id,
    projects.projectSchema.parse({ name: "Scheduling test", code: `SCH-${Date.now() % 1e6}`, newClientName: "Test Client", budget: "1000" }),
  );
  torontoId = await projects.saveLocation(actor.id, projectId, null, projects.locationSchema.parse({ name: "Eaton Centre", timezone: "America/Toronto" }));
  vancouverId = await projects.saveLocation(actor.id, projectId, null, projects.locationSchema.parse({ name: "Pacific Centre", timezone: "America/Vancouver" }));
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("projects", () => {
  it("rejects duplicate project codes and validates money", async () => {
    const code = (await one("select code from projects where id = $1", [projectId])).code;
    await expect(projects.createProject(actor.id, projects.projectSchema.parse({ name: "Again", code }))).rejects.toThrow(/already in use/);
    expect(projects.projectSchema.safeParse({ name: "X project", code: "OK-1", budgetCents: "12.345" }).success).toBe(false);
    expect(projects.projectSchema.parse({ name: "X project", code: "ok-1", budgetCents: "15,000.50" })).toMatchObject({ code: "OK-1", budgetCents: 1500050 });
  });

  it("only allows defined status transitions", async () => {
    await expect(projects.setProjectStatus(actor.id, projectId, "closed", null)).rejects.toThrow(/can't move to closed/);
    await projects.setProjectStatus(actor.id, projectId, "staffing", null);
    await expect(projects.setProjectStatus(actor.id, projectId, "cancelled", null)).rejects.toThrow(/reason/);
    expect(projects.canTransitionProject("live", "completed")).toBe(true);
    expect(projects.canTransitionProject("draft", "live")).toBe(false);
  });
});

describe("bulk shift creation", () => {
  it("creates one shift per date in the location's time zone", async () => {
    const ids = await shifts.createShifts(
      actor.id,
      projectId,
      shifts.bulkShiftSchema.parse({ ...baseShift, locationId: vancouverId, startDate: "2026-11-12", endDate: "2026-11-14", startTime: "10:00", endTime: "18:00" }),
    );
    expect(ids).toHaveLength(3);
    const first = await one<{ starts_at: Date; timezone: string; rate_cents: number; status: string }>(
      "select starts_at, timezone, rate_cents, status from shifts where id = $1",
      [ids[0]],
    );
    expect(first.starts_at.toISOString()).toBe("2026-11-12T18:00:00.000Z"); // 10:00 PST
    expect(first).toMatchObject({ timezone: "America/Vancouver", rate_cents: 2500, status: "open" });
  });

  it("supports overnight shifts and draft creation", async () => {
    const [id] = await shifts.createShifts(
      actor.id,
      projectId,
      shifts.bulkShiftSchema.parse({ ...baseShift, locationId: torontoId, startDate: "2026-11-20", endDate: "2026-11-20", startTime: "22:00", endTime: "06:00", publish: false }),
    );
    const s = await one<{ starts_at: Date; ends_at: Date; status: string }>("select starts_at, ends_at, status from shifts where id = $1", [id]);
    expect(s.starts_at.toISOString()).toBe("2026-11-21T03:00:00.000Z");
    expect(s.ends_at.toISOString()).toBe("2026-11-21T11:00:00.000Z");
    expect(s.status).toBe("draft");
    expect(await shifts.publishShifts(actor.id, projectId, [id!])).toBe(1);
  });

  it("refuses a location from another project", async () => {
    const other = await projects.createProject(actor.id, projects.projectSchema.parse({ name: "Other", code: `OTH-${Date.now() % 1e6}` }));
    const loc = await projects.saveLocation(actor.id, other, null, projects.locationSchema.parse({ name: "Elsewhere", timezone: "America/Toronto" }));
    await expect(
      shifts.createShifts(actor.id, projectId, shifts.bulkShiftSchema.parse({ ...baseShift, locationId: loc, startDate: "2026-11-12", endDate: "2026-11-12", startTime: "10:00", endTime: "18:00" })),
    ).rejects.toThrow(/isn't part of this project/);
  });
});

describe("editing shifts", () => {
  async function oneShift(date: string, start = "10:00", end = "18:00") {
    const [id] = await shifts.createShifts(
      actor.id,
      projectId,
      shifts.bulkShiftSchema.parse({ ...baseShift, locationId: torontoId, startDate: date, endDate: date, startTime: start, endTime: end }),
    );
    return id!;
  }
  const update = (id: string, patch: Partial<shifts.ShiftUpdateInput>) =>
    shifts.updateShift(actor.id, id, shifts.shiftUpdateSchema.parse({ ...baseShift, date: "2026-12-01", startTime: "10:00", endTime: "18:00", ...patch }));

  it("won't drop headcount below the number already confirmed", async () => {
    const id = await oneShift("2026-12-01");
    await book(id, (await makeStaff()).id);
    await book(id, (await makeStaff()).id);
    await expect(update(id, { headcount: 1 })).rejects.toThrow(/2 people are already confirmed/);
  });

  it("explains a reschedule that would double-book someone", async () => {
    const person = await makeStaff();
    const a = await oneShift("2026-12-02", "10:00", "14:00");
    const b = await oneShift("2026-12-02", "15:00", "19:00");
    await book(a, person.id);
    await book(b, person.id);
    await expect(update(b, { date: "2026-12-02", startTime: "13:00", endTime: "19:00" })).rejects.toThrow(/double-book/);
  });

  it("moves a shift to another date keeping local times across DST", async () => {
    const id = await oneShift("2026-10-30", "10:00", "18:00"); // EDT
    await shifts.moveShiftToDate(actor.id, id, "2026-11-06"); // EST
    const s = await one<{ starts_at: Date }>("select starts_at from shifts where id = $1", [id]);
    expect(s.starts_at.toISOString()).toBe("2026-11-06T15:00:00.000Z");
  });

  it("duplicates a shift onto other dates without copying bookings", async () => {
    const id = await oneShift("2026-12-03");
    await book(id, (await makeStaff()).id);
    expect(await shifts.duplicateShift(actor.id, id, ["2026-12-04", "2026-12-05", "2026-12-05"])).toBe(2);
    const copies = await pool.query(
      "select s.id, (select count(*)::int from bookings b where b.shift_id = s.id) n from shifts s where s.project_id = $1 and s.starts_at::date in ('2026-12-04', '2026-12-05')",
      [projectId],
    );
    expect(copies.rows).toHaveLength(2);
    expect(copies.rows.every((r) => r.n === 0)).toBe(true);
  });

  it("cancels a shift and its active bookings, keeping history", async () => {
    const id = await oneShift("2026-12-06");
    const b = await book(id, (await makeStaff()).id);
    await expect(shifts.cancelShift(actor.id, id, "  ")).rejects.toThrow(/reason/);
    expect(await shifts.cancelShift(actor.id, id, "Client postponed")).toBe(1);
    expect((await one("select status from shifts where id = $1", [id])).status).toBe("cancelled");
    const booking = await one("select status, cancel_reason from bookings where id = $1", [b.id]);
    expect(booking).toMatchObject({ status: "cancelled", cancel_reason: "Shift cancelled: Client postponed" });
    const hist = await one("select from_status, to_status from booking_status_history where booking_id = $1", [b.id]);
    expect(hist).toEqual({ from_status: "confirmed", to_status: "cancelled" });
    await expect(update(id, {})).rejects.toThrow(/cancelled shift can't be edited/);
  });
});

describe("locations", () => {
  it("won't change the time zone or delete a location that has shifts", async () => {
    await expect(
      projects.saveLocation(actor.id, projectId, torontoId, projects.locationSchema.parse({ name: "Eaton Centre", timezone: "America/Halifax" })),
    ).rejects.toThrow(/time zone can't change/);
    await expect(projects.deleteLocation(actor.id, projectId, torontoId)).rejects.toThrow(/has shifts/);
  });

  it("requires coordinates before enabling check-in location verification", async () => {
    await expect(
      projects.saveLocation(actor.id, projectId, null, projects.locationSchema.parse({ name: "Geo", timezone: "America/Toronto", requireLocationAtCheckIn: true })),
    ).rejects.toThrow(/latitude and longitude/);
  });
});

describe("cost estimates", () => {
  it("multiplies headcount × scheduled hours × rate in integer cents", () => {
    const s = { headcount: 10, startsAt: new Date("2026-11-12T15:00:00Z"), endsAt: new Date("2026-11-12T23:00:00Z"), rateCents: 2500 };
    expect(shifts.estimateShiftCents(s)).toBe(200000);
    expect(shifts.estimateShiftCents({ ...s, headcount: 1, endsAt: new Date("2026-11-12T15:20:00Z"), rateCents: 2501 })).toBe(834);
    expect(shifts.estimateShiftCents({ ...s, rateCents: null })).toBeNull();
  });
});
