// Database-level guarantees: these hold even if application code has a bug.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { book, makeProject, makeShift, makeStaff, makeUser, one, pool } from "./fixtures";

let project: { projectId: string; locationId: string };
let admin: { id: string };

beforeAll(async () => {
  project = await makeProject();
  admin = await makeUser();
});
afterAll(async () => pool.end());

describe("double-booking (rule 4)", () => {
  it("rejects overlapping confirmed bookings for the same person", async () => {
    const staff = await makeStaff();
    const a = await makeShift(project, "2026-11-12T14:00:00Z", "2026-11-12T22:00:00Z");
    const b = await makeShift(project, "2026-11-12T20:00:00Z", "2026-11-13T02:00:00Z");
    await book(a.id, staff.id);
    await expect(book(b.id, staff.id)).rejects.toThrow(/bookings_no_overlap/);
  });

  it("allows back-to-back shifts that touch but don't overlap", async () => {
    const staff = await makeStaff();
    const a = await makeShift(project, "2026-11-13T14:00:00Z", "2026-11-13T18:00:00Z");
    const b = await makeShift(project, "2026-11-13T18:00:00Z", "2026-11-13T22:00:00Z");
    await book(a.id, staff.id);
    await expect(book(b.id, staff.id)).resolves.toHaveProperty("id");
  });

  it("does not count offers or interest as bookings (rule 5)", async () => {
    const staff = await makeStaff();
    const a = await makeShift(project, "2026-11-14T14:00:00Z", "2026-11-14T22:00:00Z");
    const b = await makeShift(project, "2026-11-14T15:00:00Z", "2026-11-14T23:00:00Z");
    await book(a.id, staff.id, { status: "interested" });
    await expect(book(b.id, staff.id, { status: "offered" })).resolves.toHaveProperty("id");
  });

  it("permits an overlap only with an explicit, reasoned override", async () => {
    const staff = await makeStaff();
    const a = await makeShift(project, "2026-11-15T14:00:00Z", "2026-11-15T22:00:00Z");
    const b = await makeShift(project, "2026-11-15T21:00:00Z", "2026-11-15T23:00:00Z");
    await book(a.id, staff.id);
    await expect(book(b.id, staff.id, { overrideBy: admin.id })).rejects.toThrow(/bookings_override_reason/);
    await expect(book(b.id, staff.id, { overrideBy: admin.id, overrideReason: "Covering handover" })).resolves.toHaveProperty("id");
  });

  it("handles overnight shifts that cross midnight", async () => {
    const staff = await makeStaff();
    // 9pm → 5am Toronto time (EST): 02:00Z → 10:00Z next day.
    const overnight = await makeShift(project, "2026-11-20T02:00:00Z", "2026-11-20T10:00:00Z");
    const morning = await makeShift(project, "2026-11-20T09:00:00Z", "2026-11-20T15:00:00Z");
    await book(overnight.id, staff.id);
    await expect(book(morning.id, staff.id)).rejects.toThrow(/bookings_no_overlap/);
  });

  it("rejects a shift whose end is not after its start", async () => {
    await expect(makeShift(project, "2026-11-21T22:00:00Z", "2026-11-21T14:00:00Z")).rejects.toThrow(/shifts_time_order/);
  });

  it("re-checks conflicts when a shift is rescheduled", async () => {
    const staff = await makeStaff();
    const a = await makeShift(project, "2026-11-22T14:00:00Z", "2026-11-22T18:00:00Z");
    const b = await makeShift(project, "2026-11-22T19:00:00Z", "2026-11-22T23:00:00Z");
    await book(a.id, staff.id);
    const booking = await book(b.id, staff.id);
    await expect(
      pool.query("update shifts set starts_at = '2026-11-22T17:00:00Z' where id = $1", [b.id]),
    ).rejects.toThrow(/bookings_no_overlap/);
    // A non-conflicting move propagates to the booking.
    await pool.query("update shifts set starts_at = '2026-11-22T18:30:00Z' where id = $1", [b.id]);
    const row = await one<{ starts_at: Date }>("select starts_at from bookings where id = $1", [booking.id]);
    expect(row.starts_at.toISOString()).toBe("2026-11-22T18:30:00.000Z");
  });
});

describe("agreed rates", () => {
  it("cannot change the agreed rate on a confirmed booking", async () => {
    const staff = await makeStaff();
    const s = await makeShift(project, "2026-11-25T14:00:00Z", "2026-11-25T22:00:00Z");
    const b = await book(s.id, staff.id, { agreedRateCents: 2500 });
    await expect(pool.query("update bookings set agreed_rate_cents = 3000 where id = $1", [b.id])).rejects.toThrow(/fixed once a booking is confirmed/);
  });

  it("requires an agreed rate before a booking can be confirmed", async () => {
    const staff = await makeStaff();
    const s = await makeShift(project, "2026-11-26T14:00:00Z", "2026-11-26T22:00:00Z");
    const b = await book(s.id, staff.id, { status: "interested" });
    await expect(pool.query("update bookings set status = 'confirmed' where id = $1", [b.id])).rejects.toThrow(/bookings_confirmed_rate/);
  });

  it("keeps rate history: rows are superseded, never edited", async () => {
    const staff = await makeStaff();
    const r = await one<{ id: string }>("insert into staff_rates (staff_id, role, rate_cents) values ($1, 'BA', 2500) returning id", [staff.id]);
    await expect(pool.query("update staff_rates set rate_cents = 2700 where id = $1", [r.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("delete from staff_rates where id = $1", [r.id])).rejects.toThrow(/cannot be deleted/);
    // Only one open rate per role at a time.
    await expect(pool.query("insert into staff_rates (staff_id, role, rate_cents) values ($1, 'BA', 2700)", [staff.id])).rejects.toThrow(/staff_rates_one_open_uq/);
    await pool.query("update staff_rates set effective_to = now() where id = $1", [r.id]);
    await expect(pool.query("insert into staff_rates (staff_id, role, rate_cents) values ($1, 'BA', 2700)", [staff.id])).resolves.toBeTruthy();
  });
});

describe("history is preserved (rules 9, 11, 18)", () => {
  it("never deletes bookings or shifts", async () => {
    const staff = await makeStaff();
    const s = await makeShift(project, "2026-11-27T14:00:00Z", "2026-11-27T22:00:00Z");
    const b = await book(s.id, staff.id);
    await expect(pool.query("delete from bookings where id = $1", [b.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from shifts where id = $1", [s.id])).rejects.toThrow(/append-only/);
  });

  it("makes audit, attendance and adjustment records append-only", async () => {
    const audit = await one<{ id: number }>("insert into audit_log (action, entity_type) values ('test', 'test') returning id");
    await expect(pool.query("update audit_log set action = 'x' where id = $1", [audit.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from audit_log where id = $1", [audit.id])).rejects.toThrow(/append-only/);

    const staff = await makeStaff();
    const s = await makeShift(project, "2026-11-28T14:00:00Z", "2026-11-28T22:00:00Z");
    const b = await book(s.id, staff.id);
    const ev = await one<{ id: string }>(
      "insert into attendance_events (booking_id, type, occurred_at, method) values ($1, 'check_in', now(), 'self') returning id",
      [b.id],
    );
    await expect(pool.query("update attendance_events set occurred_at = now() - interval '1 hour' where id = $1", [ev.id])).rejects.toThrow(/append-only/);
  });

  it("dedupes offline check-ins by client event id", async () => {
    const staff = await makeStaff();
    const s = await makeShift(project, "2026-11-29T14:00:00Z", "2026-11-29T22:00:00Z");
    const b = await book(s.id, staff.id);
    const insert = () =>
      pool.query(
        "insert into attendance_events (booking_id, type, occurred_at, method, client_event_id) values ($1, 'check_in', now(), 'offline_sync', 'device-abc-1')",
        [b.id],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });
});

describe("payables and batches (rules 16, 17)", () => {
  let day = 1;
  async function makeTimesheet() {
    const staff = await makeStaff();
    const date = `2026-12-${String(day++).padStart(2, "0")}`;
    const s = await makeShift(project, `${date}T14:00:00Z`, `${date}T22:00:00Z`);
    const b = await book(s.id, staff.id);
    const ts = await one<{ id: string }>(
      "insert into timesheets (booking_id, staff_id, project_id, shift_id, status, payable_minutes) values ($1, $2, $3, $4, 'approved', 480) returning id",
      [b.id, staff.id, project.projectId, s.id],
    );
    return { staffId: staff.id, timesheetId: ts.id };
  }
  const payable = (t: { staffId: string; timesheetId: string }) =>
    one<{ id: string }>(
      `insert into payable_items (timesheet_id, staff_id, project_id, service_date, classification, payable_minutes, rate_cents, base_cents, total_cents, calc_version, calc_inputs)
       values ($1, $2, $3, '2026-12-01', 'contractor', 480, 2500, 20000, 20000, 'v1', '{}') returning id`,
      [t.timesheetId, t.staffId, project.projectId],
    );

  it("creates at most one live payable per timesheet", async () => {
    const t = await makeTimesheet();
    const p = await payable(t);
    await expect(payable(t)).rejects.toThrow(/payable_items_timesheet_uq/);
    // Voiding (before export) allows a corrected payable to replace it.
    await pool.query("update payable_items set status = 'void', void_reason = 'hours corrected' where id = $1", [p.id]);
    await expect(payable(t)).resolves.toHaveProperty("id");
  });

  it("never changes calculated amounts", async () => {
    const p = await payable(await makeTimesheet());
    await expect(pool.query("update payable_items set total_cents = 1 where id = $1", [p.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("delete from payable_items where id = $1", [p.id])).rejects.toThrow(/cannot be deleted/);
  });

  it("cannot void exported or paid payables", async () => {
    const p = await payable(await makeTimesheet());
    await pool.query("update payable_items set status = 'paid' where id = $1", [p.id]);
    await expect(pool.query("update payable_items set status = 'void' where id = $1", [p.id])).rejects.toThrow();
    await expect(pool.query("update payable_items set status = 'pending' where id = $1", [p.id])).rejects.toThrow(/only move to disputed/);
  });

  it("keeps a payable in only one active batch and requires a second approver", async () => {
    const p = await payable(await makeTimesheet());
    const creator = await makeUser();
    const batch = (ref: string) =>
      one<{ id: string }>("insert into payment_batches (reference, type, created_by) values ($1, 'contractor', $2) returning id", [ref, creator.id]);
    const b1 = await batch(`B-${Date.now()}-1`);
    const b2 = await batch(`B-${Date.now()}-2`);
    await pool.query("insert into payment_batch_items (batch_id, payable_item_id, amount_cents) values ($1, $2, 20000)", [b1.id, p.id]);
    await expect(
      pool.query("insert into payment_batch_items (batch_id, payable_item_id, amount_cents) values ($1, $2, 20000)", [b2.id, p.id]),
    ).rejects.toThrow(/payment_batch_items_active_uq/);
    await expect(pool.query("update payment_batches set approved_by = created_by where id = $1", [b1.id])).rejects.toThrow(/four_eyes/);
  });

  it("allows only one live export per batch and format", async () => {
    const creator = await makeUser();
    const b = await one<{ id: string }>("insert into payment_batches (reference, type, created_by) values ($1, 'payroll', $2) returning id", [`B-${Date.now()}-x`, creator.id]);
    const exp = () =>
      pool.query("insert into payment_exports (batch_id, format, sha256, row_count, exported_by) values ($1, 'csv_generic', 'abc', 1, $2)", [b.id, creator.id]);
    await exp();
    await expect(exp()).rejects.toThrow(/payment_exports_one_live_uq/);
  });

  it("freezes hours on exported timesheets", async () => {
    const t = await makeTimesheet();
    await pool.query("update timesheets set status = 'exported' where id = $1", [t.timesheetId]);
    await expect(pool.query("update timesheets set payable_minutes = 600 where id = $1", [t.timesheetId])).rejects.toThrow(/cannot change/);
  });
});
