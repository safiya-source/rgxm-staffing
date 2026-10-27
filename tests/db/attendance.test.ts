import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as a from "@/server/domain/attendance";
import { runSweeps } from "@/server/notify/sweeps";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

const MIN = 60_000;
let rgxm: { id: string };
let project: { projectId: string; locationId: string };

async function staffMember(role = "BA") {
  const u = await makeUser("staff");
  const p = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Sam', 'Worker', $2) returning id", [
    u.id,
    `w.${crypto.randomUUID()}@example.test`,
  ]);
  await pool.query("insert into staff_roles (staff_id, role) values ($1, $2)", [p.id, role]);
  return { userId: u.id, staffId: p.id };
}

/** A confirmed booking on a shift starting `startOffsetMin` from now. */
async function booked(startOffsetMin: number, hours = 8, role = "BA", who?: { userId: string; staffId: string }) {
  const person = who ?? (await staffMember(role));
  const start = new Date(Date.now() + startOffsetMin * MIN);
  const s = await makeShift(project, start.toISOString(), new Date(start.getTime() + hours * 60 * MIN).toISOString(), role);
  const b = await book(s.id, person.staffId);
  return { ...person, bookingId: b.id, shiftId: s.id, start, end: new Date(start.getTime() + hours * 60 * MIN) };
}
const staffActor = (p: { userId: string; staffId: string }) => ({ kind: "staff" as const, userId: p.userId, staffId: p.staffId });
const timesheetOf = (bookingId: string) => one<Record<string, unknown> & { id: string }>("select * from timesheets where booking_id = $1", [bookingId]);

beforeAll(async () => {
  rgxm = await makeUser();
  project = await makeProject();
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("check-in and check-out", () => {
  it("enforces the check-in window and the order of events", async () => {
    const early = await booked(180);
    await expect(a.recordAttendance(staffActor(early), early.bookingId, { type: "check_in" })).rejects.toThrow(/opens 60 minutes before/);

    const p = await booked(30);
    await expect(a.recordAttendance(staffActor(p), p.bookingId, { type: "check_out" })).rejects.toThrow(/Check in first/);
    await a.recordAttendance(staffActor(p), p.bookingId, { type: "check_in" });
    await expect(a.recordAttendance(staffActor(p), p.bookingId, { type: "check_in" })).rejects.toThrow(/already checked in/);
    const t = await timesheetOf(p.bookingId);
    expect(t.status).toBe("in_progress");
    expect(t.actual_start).not.toBeNull();
    expect(t.worked_start).toEqual(t.actual_start);
  });

  it("won't let someone check in for another person's booking", async () => {
    const p = await booked(30);
    const other = await staffMember();
    await expect(a.recordAttendance(staffActor(other), p.bookingId, { type: "check_in" })).rejects.toThrow(/not found/);
  });

  it("syncs offline events once and flags them", async () => {
    const p = await booked(-30);
    const occurredAt = new Date(Date.now() - 20 * MIN);
    const first = await a.recordAttendance(staffActor(p), p.bookingId, { type: "check_in", occurredAt, clientEventId: `dev-${p.bookingId}` });
    const again = await a.recordAttendance(staffActor(p), p.bookingId, { type: "check_in", occurredAt, clientEventId: `dev-${p.bookingId}` });
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    const ev = await one("select method from attendance_events where booking_id = $1", [p.bookingId]);
    expect(ev.method).toBe("offline_sync");
    expect((await timesheetOf(p.bookingId)).flags).toContain("offline_entry");
  });

  it("rejects device times in the future", async () => {
    const p = await booked(10);
    await expect(a.recordAttendance(staffActor(p), p.bookingId, { type: "check_in", occurredAt: new Date(Date.now() + 10 * MIN) })).rejects.toThrow(/future/);
  });

  it("checks location only where the venue asks for it, and flags rather than blocks", async () => {
    await pool.query("update project_locations set require_location_at_check_in = true, latitude = 43.6544, longitude = -79.3807, geofence_meters = 300 where id = $1", [project.locationId]);
    try {
      const near = await booked(30);
      expect((await a.recordAttendance(staffActor(near), near.bookingId, { type: "check_in", location: { lat: 43.655, lng: -79.381, accuracy: 20 } })).withinGeofence).toBe(true);
      const far = await booked(30);
      expect((await a.recordAttendance(staffActor(far), far.bookingId, { type: "check_in", location: { lat: 43.7, lng: -79.4, accuracy: 20 } })).withinGeofence).toBe(false);
      expect((await timesheetOf(far.bookingId)).flags).toContain("outside_geofence");
      const none = await booked(30);
      expect((await a.recordAttendance(staffActor(none), none.bookingId, { type: "check_in" })).withinGeofence).toBe(false);
    } finally {
      await pool.query("update project_locations set require_location_at_check_in = false where id = $1", [project.locationId]);
    }
  });

  it("records nothing about location when the venue doesn't require it", async () => {
    const p = await booked(30);
    await a.recordAttendance(staffActor(p), p.bookingId, { type: "check_in", location: { lat: 43.7, lng: -79.4, accuracy: 5 } });
    const ev = await one("select latitude, longitude, within_geofence from attendance_events where booking_id = $1", [p.bookingId]);
    expect(ev).toEqual({ latitude: null, longitude: null, within_geofence: null });
  });
});

describe("timesheet review", () => {
  /** A finished shift with check-in/out recorded by RGXM (back-dated). */
  async function finished(opts: { lateMin?: number; role?: string; who?: { userId: string; staffId: string } } = {}) {
    const p = await booked(-10 * 60, 8, opts.role ?? "BA", opts.who);
    const actor = { kind: "rgxm" as const, userId: rgxm.id };
    await a.recordAttendance(actor, p.bookingId, { type: "check_in", occurredAt: new Date(p.start.getTime() + (opts.lateMin ?? 0) * MIN), note: "Paper sign-in sheet" });
    await a.recordAttendance(actor, p.bookingId, { type: "check_out", occurredAt: p.end, note: "Paper sign-in sheet" });
    const t = await timesheetOf(p.bookingId);
    return { ...p, timesheetId: t.id };
  }

  it("derives actual minutes and objective flags, and keeps actual separate from corrections", async () => {
    const p = await finished({ lateMin: 20 });
    let t = await timesheetOf(p.bookingId);
    expect(t.actual_minutes).toBe(460);
    expect(t.flags).toEqual(expect.arrayContaining(["late", "recorded_by_supervisor"]));

    await expect(a.staffEditTimesheet(p, p.timesheetId, { workedStart: p.start }, "")).rejects.toThrow(/reason/);
    await a.staffEditTimesheet(p, p.timesheetId, { workedStart: p.start, breakMinutes: 30 }, "Arrived on time; sign-in sheet was late");
    t = await timesheetOf(p.bookingId);
    expect(new Date(t.worked_start as string).getTime()).toBe(p.start.getTime());
    expect(t.actual_minutes).toBe(460); // actual untouched
    expect(t.flags).toContain("times_corrected");
    const adj = await pool.query("select field, old_value, new_value, stage from timesheet_adjustments where timesheet_id = $1 order by field", [p.timesheetId]);
    expect(adj.rows.map((r) => [r.field, r.stage])).toEqual([
      ["break_minutes", "staff_correction"],
      ["worked_start", "staff_correction"],
    ]);
    expect(adj.rows[0]).toMatchObject({ old_value: "0", new_value: "30" });
  });

  it("treats re-entering a recorded time to the minute as no change (no reason needed)", async () => {
    const p = await finished();
    const t = await timesheetOf(p.bookingId);
    const checkIn = new Date(Math.floor(new Date(t.worked_start as string).getTime() / MIN) * MIN);
    // Check-ins carry seconds; the form sends whole minutes.
    await pool.query("update timesheets set worked_start = $2, actual_start = $2 where id = $1", [p.timesheetId, new Date(checkIn.getTime() + 37_000)]);
    await a.staffEditTimesheet(p, p.timesheetId, { workedStart: checkIn, workedEnd: p.end }, "");
    const adj = await pool.query("select count(*)::int n from timesheet_adjustments where timesheet_id = $1", [p.timesheetId]);
    expect(adj.rows[0].n).toBe(0);
  });

  it("locks staff edits after submission and lets RGXM send it back", async () => {
    const p = await finished();
    await a.submitTimesheet(p, p.timesheetId);
    await expect(a.staffEditTimesheet(p, p.timesheetId, { breakMinutes: 15 }, "")).rejects.toThrow(/submitted/);
    await expect(a.sendBack({ kind: "rgxm", userId: rgxm.id }, p.timesheetId, " ")).rejects.toThrow(/what needs fixing/);
    await a.sendBack({ kind: "rgxm", userId: rgxm.id }, p.timesheetId, "Please add your meal break");
    await a.staffEditTimesheet(p, p.timesheetId, { breakMinutes: 30 }, "");
    await a.submitTimesheet(p, p.timesheetId);
    expect((await timesheetOf(p.bookingId)).status).toBe("submitted");
  });

  it("lets only the right on-site supervisor verify, never their own hours (rule 8)", async () => {
    const lead = await staffMember("TL");
    const member = await finished();
    // Team Lead confirmed on the same project, location and day.
    const leadShift = await booked(-10 * 60 - 30, 9, "TL", lead);
    const otherLead = await staffMember("TL");
    await booked(-10 * 60 + 2 * 24 * 60, 9, "TL", otherLead); // different day

    await a.submitTimesheet(member, member.timesheetId);
    await expect(a.supervisorVerify(otherLead, member.timesheetId, {})).rejects.toThrow(/don't supervise/);
    await a.supervisorVerify(lead, member.timesheetId, { changes: { breakMinutes: 15 }, reason: "Took a 15 minute break", note: "Great shift" });
    const t = await timesheetOf(member.bookingId);
    expect(t).toMatchObject({ status: "supervisor_verified", verified_by: lead.userId, break_minutes: 15 });
    const leadOwn = await a.ensureTimesheet(db, leadShift.bookingId);
    await expect(a.supervisorVerify(lead, leadOwn.id, {})).rejects.toThrow(/your own hours/);
  });

  it("approves payable hours, requires reasons for overrides, and completes the booking", async () => {
    const p = await finished();
    await a.staffEditTimesheet(p, p.timesheetId, { breakMinutes: 30 }, "");
    await expect(a.approveTimesheet(rgxm.id, p.timesheetId, { payableMinutes: 420 })).rejects.toThrow(/Explain/);
    await a.approveTimesheet(rgxm.id, p.timesheetId);
    const t = await timesheetOf(p.bookingId);
    expect(t).toMatchObject({ status: "approved", payable_minutes: 450, approved_by: rgxm.id });
    expect((await one("select status from bookings where id = $1", [p.bookingId])).status).toBe("completed");
  });

  it("stops anyone approving their own hours (rule 7)", async () => {
    const p = await finished();
    await expect(a.approveTimesheet(p.userId, p.timesheetId)).rejects.toThrow(/your own hours/);
  });

  it("won't approve before the shift ends or without times", async () => {
    const running = await booked(-60);
    await a.recordAttendance(staffActor(running), running.bookingId, { type: "check_in" });
    const t = await timesheetOf(running.bookingId);
    await expect(a.approveTimesheet(rgxm.id, t.id)).rejects.toThrow(/once the shift has ended/);

    const noTimes = await booked(-10 * 60);
    const empty = await a.ensureTimesheet(db, noTimes.bookingId);
    await expect(a.approveTimesheet(rgxm.id, empty.id)).rejects.toThrow(/missing/);
  });

  it("protects approved hours: direct edits fail, the correction workflow records everything (rule 10)", async () => {
    const p = await finished();
    await a.approveTimesheet(rgxm.id, p.timesheetId);
    await expect(pool.query("update timesheets set payable_minutes = 1 where id = $1", [p.timesheetId])).rejects.toThrow(/correction workflow/);
    await expect(a.rgxmAdjust(rgxm.id, p.timesheetId, { breakMinutes: 60 }, "late fix")).rejects.toThrow(/post-approval correction/);
    await expect(a.correctApprovedTimesheet(rgxm.id, p.timesheetId, { payableMinutes: 450, reason: "" })).rejects.toThrow(/reason/);
    await a.correctApprovedTimesheet(rgxm.id, p.timesheetId, { payableMinutes: 450, reason: "Unpaid meal break confirmed by AM" });
    const t = await timesheetOf(p.bookingId);
    expect(t).toMatchObject({ payable_minutes: 450, version: 2, status: "approved" });
    const adj = await one("select old_value, new_value, stage from timesheet_adjustments where timesheet_id = $1 and stage = 'post_approval_correction'", [p.timesheetId]);
    expect(adj).toEqual({ old_value: "480", new_value: "450", stage: "post_approval_correction" });

    await pool.query("update timesheets set status = 'locked' where id = $1", [p.timesheetId]);
    await expect(a.correctApprovedTimesheet(rgxm.id, p.timesheetId, { payableMinutes: 400, reason: "x" })).rejects.toThrow(/payment batch/);
    // Even with the correction flag set, locked hours can't change.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('rgxm.hours_correction', 'on', true)");
      await expect(client.query("update timesheets set payable_minutes = 1 where id = $1", [p.timesheetId])).rejects.toThrow(/locked/);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("marks no-shows only for started shifts without attendance", async () => {
    const future = await booked(120);
    await expect(a.markNoShow(rgxm.id, future.bookingId, "Didn't arrive")).rejects.toThrow(/hasn't started/);
    const missed = await booked(-120);
    await a.markNoShow(rgxm.id, missed.bookingId, "Didn't arrive, no answer");
    expect((await one("select status from bookings where id = $1", [missed.bookingId])).status).toBe("no_show");
    const attended = await finished();
    await expect(a.markNoShow(rgxm.id, attended.bookingId, "x")).rejects.toThrow();
  });
});

describe("sweeps", () => {
  it("creates timesheets after shifts end, flags missing check-ins, and reminds each person once", async () => {
    await pool.query("delete from outbox_events");
    const missed = await booked(-10 * 60);
    const soon = await booked(6 * 60);
    await runSweeps();
    await runSweeps();
    const t = await timesheetOf(missed.bookingId);
    expect(t.flags).toContain("missing_check_in");
    const events = await pool.query("select type, payload->>'bookingId' as booking from outbox_events where payload->>'bookingId' in ($1, $2) order by type", [missed.bookingId, soon.bookingId]);
    expect(events.rows).toEqual([
      { type: "shift.reminder", booking: soon.bookingId },
      { type: "timesheet.reminder", booking: missed.bookingId },
    ]);
  });
});
