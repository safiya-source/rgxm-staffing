import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as a from "@/server/domain/attendance";
import { anonymizeStaff, exportStaffData, purgeExpiredPersonalData } from "@/server/domain/privacy";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

let admin: { id: string };
let project: { projectId: string; locationId: string };

async function staffWithUser() {
  const u = await makeUser("staff");
  const p = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email, phone, city, classification) values ($1, 'Riley', 'Private', $2, '416-555-0000', 'Toronto', 'contractor') returning id", [
    u.id,
    `r.${crypto.randomUUID()}@example.test`,
  ]);
  await pool.query("insert into staff_sensitive (staff_id, legal_name, gst_hst_number, emergency_contact_name) values ($1, 'Riley Private', '123456789RT0001', 'Mum')", [p.id]);
  await pool.query("insert into availability_rules (staff_id, weekday, start_time, end_time) values ($1, 1, '09:00', '17:00')", [p.id]);
  await pool.query("insert into internal_notes (staff_id, author_id, body) values ($1, $2, 'Great with guests')", [p.id, admin.id]);
  return { userId: u.id, staffId: p.id };
}

beforeAll(async () => {
  admin = await makeUser();
  project = await makeProject();
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("retention", () => {
  it("clears old check-in coordinates and email bodies only, and nothing else can change", async () => {
    const who = await staffWithUser();
    const start = new Date(Date.now() - 200 * 86_400_000);
    const s = await makeShift(project, start.toISOString(), new Date(start.getTime() + 4 * 3_600_000).toISOString());
    const b = await book(s.id, who.staffId);
    const ev = await one<{ id: string }>(
      "insert into attendance_events (booking_id, type, occurred_at, method, latitude, longitude, accuracy_meters, within_geofence) values ($1, 'check_in', $2, 'self', 43.6, -79.3, 12, true) returning id",
      [b.id, start],
    );
    const fresh = await one<{ id: string }>("insert into attendance_events (booking_id, type, occurred_at, method, latitude, longitude) values ($1, 'check_out', now(), 'self', 43.6, -79.3) returning id", [b.id]);
    const mail = await one<{ id: string }>("insert into notification_deliveries (channel, to_address, subject, body_text, transport, created_at) values ('email', 'x@example.test', 'Hi', 'secret body', 'log', now() - interval '60 days') returning id");

    const res = await purgeExpiredPersonalData();
    expect(res.locations).toBeGreaterThanOrEqual(1);
    expect(await one("select latitude, longitude, accuracy_meters, within_geofence, occurred_at from attendance_events where id = $1", [ev.id])).toEqual({ latitude: null, longitude: null, accuracy_meters: null, within_geofence: true, occurred_at: start });
    expect((await one<{ latitude: number }>("select latitude from attendance_events where id = $1", [fresh.id])).latitude).toBe(43.6);
    expect(await one("select subject, body_text from notification_deliveries where id = $1", [mail.id])).toEqual({ subject: "Hi", body_text: null });

    // The append-only guard still blocks every other change.
    await expect(pool.query("update attendance_events set occurred_at = now() where id = $1", [ev.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("update attendance_events set latitude = 1 where id = $1", [ev.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from attendance_events where id = $1", [ev.id])).rejects.toThrow(/append-only/);
  });
});

describe("access and erasure", () => {
  it("exports a person's own record", async () => {
    const who = await staffWithUser();
    const data = await exportStaffData(who.staffId);
    expect(data.profile).toMatchObject({ firstName: "Riley", phone: "416-555-0000" });
    expect(data.availability.weekly).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("Great with guests"); // internal notes come via the privacy officer
  });

  it("erases personal details but keeps work, pay and tax identity; refuses while money is owed", async () => {
    const who = await staffWithUser();
    const start = new Date(Date.now() - 2 * 86_400_000);
    const end = new Date(start.getTime() + 4 * 3_600_000);
    const s = await makeShift(project, start.toISOString(), end.toISOString());
    const b = await book(s.id, who.staffId);
    const rgxm = { kind: "rgxm" as const, userId: admin.id };
    await a.recordAttendance(rgxm, b.id, { type: "check_in", occurredAt: start, note: "sheet" });
    await a.recordAttendance(rgxm, b.id, { type: "check_out", occurredAt: end, note: "sheet" });
    const t = await one<{ id: string }>("select id from timesheets where booking_id = $1", [b.id]);

    await expect(anonymizeStaff(admin.id, who.staffId, "x")).rejects.toThrow(/Record why/);
    await expect(anonymizeStaff(admin.id, who.staffId, "Email request 2026-10-20")).rejects.toThrow(/haven't been approved/);
    await a.approveTimesheet(admin.id, t.id);
    await expect(anonymizeStaff(admin.id, who.staffId, "Email request 2026-10-20")).rejects.toThrow(/hasn't been paid/);
    // Simulate payment having been completed elsewhere in the flow.
    await pool.query("update payable_items set status = 'batched' where timesheet_id = $1", [t.id]);
    await pool.query("update payable_items set status = 'exported' where timesheet_id = $1", [t.id]);
    await pool.query("update payable_items set status = 'paid' where timesheet_id = $1", [t.id]);

    await anonymizeStaff(admin.id, who.staffId, "Email request 2026-10-20");
    const p = await one<Record<string, unknown>>("select first_name, email, phone, city, status, anonymized_at from staff_profiles where id = $1", [who.staffId]);
    expect(p).toMatchObject({ first_name: "Former", phone: null, city: null, status: "archived" });
    expect(p.email).toMatch(/@invalid\.example$/);
    expect(await one("select legal_name, gst_hst_number, emergency_contact_name from staff_sensitive where staff_id = $1", [who.staffId])).toEqual({
      legal_name: "Riley Private",
      gst_hst_number: "123456789RT0001",
      emergency_contact_name: null,
    });
    expect((await one<{ n: number }>("select count(*)::int n from availability_rules where staff_id = $1", [who.staffId])).n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int n from internal_notes where staff_id = $1", [who.staffId])).n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int n from payable_items where staff_id = $1 and status = 'paid'", [who.staffId])).n).toBe(1);
    expect(await one("select status, name from users where id = $1", [who.userId])).toEqual({ status: "archived", name: "Former staff member" });
    await expect(anonymizeStaff(admin.id, who.staffId, "again please")).rejects.toThrow(/already/);
  });
});
