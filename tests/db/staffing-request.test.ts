import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createStaffingRequest, suggestProjectCode } from "@/server/domain/staffing-request";
import { makeProject, makeUser, one, pool } from "./fixtures";

let pm: { id: string };
const shifts = { role: "BA" as const, startDate: "2027-03-10", endDate: "2027-03-12", weekdays: [], startTime: "10:00", endTime: "18:00", headcount: 2 };

beforeAll(async () => {
  pm = await makeUser();
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("new staffing request shortcut", () => {
  it("creates the project, venue and published shifts together", async () => {
    const name = `Shortcut Test ${crypto.randomUUID().slice(0, 6)}`;
    const res = await createStaffingRequest(pm.id, {
      project: { mode: "new", name, clientId: null, newClientName: "Shortcut Client", code: null },
      location: { mode: "new", name: "Union Station", city: "Toronto", address: "", timezone: "America/Toronto" },
      shifts,
    });
    expect(res.shiftIds).toHaveLength(3);
    const p = await one<{ status: string; owner_id: string; start_date: string; end_date: string; code: string }>(
      "select status, owner_id, start_date::text, end_date::text, code from projects where id = $1",
      [res.projectId],
    );
    expect(p).toMatchObject({ status: "staffing", owner_id: pm.id, start_date: "2027-03-10", end_date: "2027-03-12" });
    expect(p.code).toMatch(/^SHOR?T?.*-2703/);
    const s = await pool.query("select status, headcount, timezone from shifts where project_id = $1", [res.projectId]);
    expect(s.rows.every((r) => r.status === "open" && r.headcount === 2 && r.timezone === "America/Toronto")).toBe(true);
    expect(res.group).toBe(`BA:${res.locationId}`);
  });

  it("adds shifts to an existing project and venue", async () => {
    const p = await makeProject();
    const res = await createStaffingRequest(pm.id, {
      project: { mode: "existing", projectId: p.projectId },
      location: { mode: "existing", locationId: p.locationId },
      shifts: { ...shifts, role: "TL", weekdays: [3] }, // Wednesdays only: Mar 10
    });
    expect(res.shiftIds).toHaveLength(1);
    expect(res.projectId).toBe(p.projectId);
  });

  it("creates nothing when any part fails", async () => {
    const name = `Rollback Test ${crypto.randomUUID().slice(0, 6)}`;
    await expect(
      createStaffingRequest(pm.id, {
        project: { mode: "new", name, clientId: null, newClientName: null, code: null },
        location: { mode: "new", name: "Somewhere", city: "", address: "", timezone: "America/Toronto" },
        // Every day excluded: no matching dates, so shift creation fails after the project and venue were inserted.
        shifts: { ...shifts, startDate: "2027-03-10", endDate: "2027-03-10", weekdays: [0] },
      }),
    ).rejects.toThrow(/No dates match/);
    expect((await one<{ n: number }>("select count(*)::int n from projects where name = $1", [name])).n).toBe(0);
  });

  it("refuses an existing venue from a different project", async () => {
    const a = await makeProject();
    const b = await makeProject();
    await expect(
      createStaffingRequest(pm.id, { project: { mode: "existing", projectId: a.projectId }, location: { mode: "existing", locationId: b.locationId }, shifts }),
    ).rejects.toThrow(/isn't part of this project/);
  });

  it("suggests readable, unused project codes", async () => {
    const first = await suggestProjectCode("Oreo Holiday Sampling", "2026-12-05");
    expect(first).toBe("OREOHS-2612");
    await pool.query("insert into projects (code, name) values ($1, 'x')", [first]);
    expect(await suggestProjectCode("Oreo Holiday Sampling", "2026-12-05")).toBe("OREOHS-2612-2");
  });
});
