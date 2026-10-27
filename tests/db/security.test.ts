// Regression tests for the M6 security review findings.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as a from "@/server/domain/attendance";
import { respondToOffer, sendOffers } from "@/server/domain/bookings";
import { staffCanAccessDocument } from "@/server/domain/comms";
import { deleteLocation, deleteRequirement } from "@/server/domain/projects";
import { setStaffStatus } from "@/server/domain/talent";
import { rateLimit, RateLimitError } from "@/server/rate-limit";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

const HOUR = 3_600_000;
let admin: { id: string };

async function person(role = "BA") {
  const u = await makeUser("staff");
  const p = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Sec', 'Test', $2) returning id", [u.id, `s.${crypto.randomUUID()}@example.test`]);
  await pool.query("insert into staff_roles (staff_id, role) values ($1, $2)", [p.id, role]);
  return { userId: u.id, staffId: p.id };
}

beforeAll(async () => {
  admin = await makeUser();
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("rate limits", () => {
  it("allow up to the limit per window, then refuse", async () => {
    const subject = crypto.randomUUID();
    const t = new Date("2026-01-01T00:00:30Z");
    for (let i = 0; i < 5; i++) await rateLimit("export.personal_data", subject, t);
    await expect(rateLimit("export.personal_data", subject, t)).rejects.toBeInstanceOf(RateLimitError);
    // Other people and the next window are unaffected.
    await rateLimit("export.personal_data", crypto.randomUUID(), t);
    await rateLimit("export.personal_data", subject, new Date("2026-01-01T01:00:30Z"));
  });
});

describe("project scoping", () => {
  it("won't send offers for another project's shifts", async () => {
    const p1 = await makeProject();
    const p2 = await makeProject();
    const start = new Date(Date.now() + 72 * HOUR);
    const s2 = await makeShift(p2, start.toISOString(), new Date(start.getTime() + 4 * HOUR).toISOString());
    await pool.query("update shifts set status = 'open' where id = $1", [s2.id]);
    const who = await person();
    await expect(sendOffers(admin.id, { shiftIds: [s2.id], staffIds: [who.staffId], responseDeadline: null, projectId: p1.projectId })).rejects.toThrow(/aren't part of this project/);
  });

  it("won't delete another project's location or requirement (or their children)", async () => {
    const p1 = await makeProject();
    const p2 = await makeProject();
    const req = await one<{ id: string }>("insert into staffing_requirements (project_id, location_id, role, quantity) values ($1, $2, 'BA', 3) returning id", [p2.projectId, p2.locationId]);
    await expect(deleteLocation(admin.id, p1.projectId, p2.locationId)).rejects.toThrow(/not found on this project/);
    await expect(deleteRequirement(admin.id, p1.projectId, req.id)).rejects.toThrow(/not found on this project/);
    expect((await one<{ n: number }>("select count(*)::int n from staffing_requirements where id = $1", [req.id])).n).toBe(1);
  });
});

describe("on-site supervision", () => {
  it("only covers people on an overlapping shift at the same venue", async () => {
    const p = await makeProject();
    const day = new Date(Date.now() + 48 * HOUR);
    day.setUTCHours(13, 0, 0, 0);
    const morning = await makeShift(p, day.toISOString(), new Date(day.getTime() + 4 * HOUR).toISOString(), "TL");
    const evening = await makeShift(p, new Date(day.getTime() + 6 * HOUR).toISOString(), new Date(day.getTime() + 10 * HOUR).toISOString(), "BA");
    const overlap = await makeShift(p, new Date(day.getTime() + 1 * HOUR).toISOString(), new Date(day.getTime() + 5 * HOUR).toISOString(), "BA");
    const lead = await person("TL");
    await book(morning.id, lead.staffId);
    const late = await book(evening.id, (await person()).staffId);
    const sameTime = await book(overlap.id, (await person()).staffId);
    expect(await a.isSupervisorOf(db, lead.staffId, late.id)).toBe(false);
    expect(await a.isSupervisorOf(db, lead.staffId, sameTime.id)).toBe(true);
  });

  it("stops internal users recording attendance on their own booking", async () => {
    const p = await makeProject();
    const start = new Date(Date.now() - 2 * HOUR);
    const s = await makeShift(p, start.toISOString(), new Date(start.getTime() + 4 * HOUR).toISOString());
    const internal = await makeUser();
    const prof = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Also', 'Worker', $2) returning id", [internal.id, `w.${crypto.randomUUID()}@example.test`]);
    const b = await book(s.id, prof.id);
    await expect(a.recordAttendance({ kind: "rgxm", userId: internal.id }, b.id, { type: "check_in", occurredAt: start, note: "me" })).rejects.toThrow(/your own hours/);
  });
});

describe("staff access", () => {
  it("suspension ends portal access and blocks taking work", async () => {
    const p = await makeProject();
    const start = new Date(Date.now() + 72 * HOUR);
    const s = await makeShift(p, start.toISOString(), new Date(start.getTime() + 4 * HOUR).toISOString());
    const who = await person();
    const b = await book(s.id, who.staffId, { status: "offered", agreedRateCents: undefined });
    await pool.query("insert into sessions (token, user_id, expires_at) values ($1, $2, now() + interval '1 day')", [crypto.randomUUID(), who.userId]);
    await setStaffStatus(admin.id, who.staffId, "suspended", "Policy breach");
    expect((await one<{ status: string }>("select status from users where id = $1", [who.userId])).status).toBe("suspended");
    expect((await one<{ n: number }>("select count(*)::int n from sessions where user_id = $1", [who.userId])).n).toBe(0);
    await expect(respondToOffer(who, b.id, "interested", null)).rejects.toThrow(/isn't active/);
    await setStaffStatus(admin.id, who.staffId, "active", "Resolved");
    expect((await one<{ status: string }>("select status from users where id = $1", [who.userId])).status).toBe("active");
  });

  it("briefs stop being downloadable 30 days after the work", async () => {
    const p = await makeProject();
    const start = new Date(Date.now() - 40 * 24 * HOUR);
    const s = await makeShift(p, start.toISOString(), new Date(start.getTime() + 4 * HOUR).toISOString());
    const who = await person();
    await book(s.id, who.staffId, { status: "completed" });
    expect(await staffCanAccessDocument(who.staffId, { projectId: p.projectId, shiftId: null, archivedAt: null })).toBe(false);
  });
});
