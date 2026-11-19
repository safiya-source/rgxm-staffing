import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as b from "@/server/domain/bookings";
import { applyForShift, listOpenShifts } from "@/server/domain/job-board";
import { makeProject, makeShift, makeUser, one, pool } from "./fixtures";

let rgxm: { id: string };
let project: { projectId: string; locationId: string };
const future = (days: number, hour = 15) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

async function person(roles = ["BA"], rate: number | null = null) {
  const user = await makeUser("staff");
  const p = await one<{ id: string }>("insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Jo', 'Board', $2) returning id", [user.id, `jo.${crypto.randomUUID()}@example.test`]);
  for (const role of roles) await pool.query("insert into staff_roles (staff_id, role) values ($1, $2)", [p.id, role]);
  if (rate != null) await pool.query("insert into staff_rates (staff_id, role, rate_cents) values ($1, 'BA', $2)", [p.id, rate]);
  await pool.query("insert into contractor_approvals (staff_id, approved_by, approved_on) values ($1, $2, current_date)", [p.id, rgxm.id]);
  return { staffId: p.id, userId: user.id };
}

async function openShift(days: number, opts: { headcount?: number; role?: string; status?: string } = {}) {
  const start = future(days);
  const s = await makeShift(project, start.toISOString(), new Date(start.getTime() + 6 * 3600_000).toISOString(), opts.role ?? "BA");
  await pool.query("update shifts set status = $2, headcount = $3 where id = $1", [s.id, opts.status ?? "open", opts.headcount ?? 1]);
  return s.id;
}

beforeAll(async () => {
  rgxm = await makeUser();
  project = await makeProject();
  await pool.query("update projects set status = 'staffing' where id = $1", [project.projectId]);
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("job board", () => {
  it("shows published shifts with open spots in the person's roles, at the rate that would apply to them", async () => {
    const ba = await openShift(3);
    const pa = await openShift(3, { role: "PA" });
    const draft = await openShift(4, { status: "draft" });
    const me = await person(["BA"], 3000);
    const ids = (await listOpenShifts(me.staffId)).map((s) => s.shiftId);
    expect(ids).toContain(ba);
    expect(ids).not.toContain(pa);
    expect(ids).not.toContain(draft);
    expect((await listOpenShifts(me.staffId)).find((s) => s.shiftId === ba)).toMatchObject({ rateCents: 3000, spotsLeft: 1 });

    // Hidden projects don't show; neither does a shift someone was already offered.
    await pool.query("update projects set show_on_job_board = false where id = $1", [project.projectId]);
    const hidden = (await listOpenShifts(me.staffId)).map((s) => s.shiftId);
    await pool.query("update projects set show_on_job_board = true where id = $1", [project.projectId]);
    expect(hidden).not.toContain(ba);
    await b.sendOffers(rgxm.id, { shiftIds: [ba], staffIds: [me.staffId], responseDeadline: null });
    expect((await listOpenShifts(me.staffId)).map((s) => s.shiftId)).not.toContain(ba);
  });

  it("records interest (not a booking), notifies the team, and refuses duplicates, other roles and full shifts", async () => {
    const s = await openShift(5);
    const me = await person();
    const res = await applyForShift(me, s, "I can stay late");
    const row = await one<{ status: string; offered_rate_cents: number; rate_source: string; offered_at: Date | null }>("select status, offered_rate_cents, rate_source, offered_at from bookings where id = $1", [res.bookingId]);
    expect(row).toMatchObject({ status: "interested", offered_rate_cents: 2500, rate_source: "shift", offered_at: null });
    const h = await one<{ reason: string }>("select reason from booking_status_history where booking_id = $1", [res.bookingId]);
    expect(h.reason).toBe("Applied from the job board");
    expect((await one<{ n: number }>("select count(*)::int n from outbox_events where type = 'offer.response' and payload->>'bookingId' = $1 and payload->>'source' = 'job_board'", [res.bookingId])).n).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int n from messages m join message_threads t on t.id = m.thread_id where t.staff_id = $1", [me.staffId])).n).toBe(1);
    await expect(applyForShift(me, s, null)).rejects.toThrow(/already responded/);

    const pa = await openShift(6, { role: "PA" });
    await expect(applyForShift(me, pa, null)).rejects.toThrow(/isn't on your profile/);

    // RGXM confirms the applicant through the normal flow; the shift is then full for others.
    await b.confirmBooking(rgxm.id, res.bookingId);
    const other = await person();
    expect((await listOpenShifts(other.staffId)).map((x) => x.shiftId)).not.toContain(s);
    await expect(applyForShift(other, s, null)).rejects.toThrow(/isn't open any more|full/);
  });
});
