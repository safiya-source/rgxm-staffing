import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as b from "@/server/domain/bookings";
import * as comms from "@/server/domain/comms";
import { handlers } from "@/server/notify/handlers";
import { processOutbox } from "@/server/notify/outbox";
import { makeProject, makeShift, makeUser, one, pool } from "./fixtures";

let rgxm: { id: string };
let project: { projectId: string; locationId: string };
const future = (days: number, hour = 15) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

async function person(opts: { roles?: string[]; rate?: number | null; withAccount?: boolean } = {}) {
  const user = opts.withAccount === false ? null : await makeUser("staff");
  const p = await one<{ id: string }>(
    "insert into staff_profiles (user_id, first_name, last_name, email) values ($1, 'Pat', 'Tester', $2) returning id",
    [user?.id ?? null, `pat.${crypto.randomUUID()}@example.test`],
  );
  for (const role of opts.roles ?? ["BA"]) await pool.query("insert into staff_roles (staff_id, role) values ($1, $2)", [p.id, role]);
  if (opts.rate !== null) await pool.query("insert into staff_rates (staff_id, role, rate_cents) values ($1, 'BA', $2)", [p.id, opts.rate ?? 2600]);
  return { staffId: p.id, userId: user?.id ?? "" };
}

async function shift(day: number, opts: { rate?: number | null; headcount?: number; startHour?: number; hours?: number } = {}) {
  const start = future(day, opts.startHour ?? 15);
  const end = new Date(start.getTime() + (opts.hours ?? 8) * 3600_000);
  const s = await makeShift(project, start.toISOString(), end.toISOString());
  await pool.query("update shifts set status = 'open', rate_cents = $2, headcount = $3 where id = $1", [s.id, opts.rate === undefined ? 2500 : opts.rate, opts.headcount ?? 2]);
  return s.id;
}

const bookingOf = (shiftId: string, staffId: string) =>
  one<{ id: string; status: string; offered_rate_cents: number; agreed_rate_cents: number | null; rate_source: string }>(
    "select * from bookings where shift_id = $1 and staff_id = $2 order by created_at desc limit 1",
    [shiftId, staffId],
  );

beforeAll(async () => {
  rgxm = await makeUser();
  project = await makeProject();
  await pool.query("delete from outbox_events");
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("sending offers", () => {
  it("creates offers at the resolved rate and skips people who can't be offered", async () => {
    const s1 = await shift(10);
    const s2 = await shift(11, { rate: null });
    const ok = await person();
    const noRate = await person({ rate: null });
    const wrongRole = await person({ roles: ["PA"] });
    const res = await b.sendOffers(rgxm.id, { shiftIds: [s1, s2], staffIds: [ok.staffId, noRate.staffId, wrongRole.staffId], responseDeadline: future(9) });

    expect(res.created).toBe(3); // ok×2, noRate on s1 (shift rate)
    expect(res.skipped).toEqual(
      expect.arrayContaining([
        { staffId: noRate.staffId, shiftId: s2, reason: "no_rate" },
        { staffId: wrongRole.staffId, shiftId: s1, reason: "not_qualified" },
      ]),
    );
    expect(await bookingOf(s1, ok.staffId)).toMatchObject({ status: "offered", offered_rate_cents: 2500, rate_source: "shift" });
    expect(await bookingOf(s2, ok.staffId)).toMatchObject({ offered_rate_cents: 2600, rate_source: "default" });

    // Re-sending doesn't duplicate.
    const again = await b.sendOffers(rgxm.id, { shiftIds: [s1], staffIds: [ok.staffId], responseDeadline: null });
    expect(again.created).toBe(0);
    expect(again.skipped[0]!.reason).toBe("already_on_shift");
  });

  it("applies authorised project overrides before shift and default rates", async () => {
    const s = await shift(12);
    const p = await person();
    await b.setProjectRate(rgxm.id, project.projectId, { role: "BA", staffId: p.staffId, rateCents: 3100 });
    await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [p.staffId], responseDeadline: null });
    expect(await bookingOf(s, p.staffId)).toMatchObject({ offered_rate_cents: 3100, rate_source: "project_staff" });
  });

  it("refuses drafts, past deadlines and mixed projects", async () => {
    const s = await shift(13);
    await pool.query("update shifts set status = 'draft' where id = $1", [s]);
    const p = await person();
    await expect(b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [p.staffId], responseDeadline: null })).rejects.toThrow(/Publish drafts/);
    const open = await shift(14);
    await expect(b.sendOffers(rgxm.id, { shiftIds: [open], staffIds: [p.staffId], responseDeadline: new Date(Date.now() - 1000) })).rejects.toThrow(/past/);
    const other = await makeProject();
    const s2 = await makeShift(other, future(14).toISOString(), future(14, 20).toISOString());
    await pool.query("update shifts set status = 'open' where id = $1", [s2.id]);
    await expect(b.sendOffers(rgxm.id, { shiftIds: [open, s2.id], staffIds: [p.staffId], responseDeadline: null })).rejects.toThrow(/one project/);
  });
});

describe("responses and confirmation", () => {
  it("records interest without booking anyone, then confirms at the agreed rate", async () => {
    const s = await shift(20);
    const p = await person();
    await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [p.staffId], responseDeadline: null });
    const offer = await bookingOf(s, p.staffId);

    await expect(b.confirmBooking(rgxm.id, offer.id)).rejects.toThrow(/offered to confirmed/); // must respond first
    await b.respondToOffer(p, offer.id, "interested", null);
    expect((await bookingOf(s, p.staffId)).status).toBe("interested");

    // A later change to their default rate doesn't change the offer or the agreement.
    await pool.query("update staff_rates set effective_to = now() where staff_id = $1", [p.staffId]);
    await pool.query("insert into staff_rates (staff_id, role, rate_cents) values ($1, 'BA', 9900)", [p.staffId]);
    await b.confirmBooking(rgxm.id, offer.id);
    expect(await bookingOf(s, p.staffId)).toMatchObject({ status: "confirmed", agreed_rate_cents: 2500 });
  });

  it("won't let someone respond to another person's offer, or after the deadline", async () => {
    const s = await shift(21);
    const p = await person();
    const other = await person();
    await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [p.staffId], responseDeadline: new Date(Date.now() + 60_000) });
    const offer = await bookingOf(s, p.staffId);
    await expect(b.respondToOffer(other, offer.id, "interested", null)).rejects.toThrow(/not found/);
    await pool.query("update bookings set response_deadline = now() - interval '1 minute' where id = $1", [offer.id]);
    await expect(b.respondToOffer(p, offer.id, "interested", null)).rejects.toThrow(/closed/);
  });

  it("routes 'more info' questions to the project conversation and keeps the offer open", async () => {
    const s = await shift(22);
    const p = await person();
    await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [p.staffId], responseDeadline: null });
    const offer = await bookingOf(s, p.staffId);
    await expect(b.respondToOffer(p, offer.id, "more_info", "  ")).rejects.toThrow(/question/);
    await b.respondToOffer(p, offer.id, "more_info", "Is parking provided?");
    expect((await bookingOf(s, p.staffId)).status).toBe("offered");
    const msg = await one("select m.body from messages m join message_threads t on t.id = m.thread_id where t.staff_id = $1", [p.staffId]);
    expect(msg.body).toBe("Is parking provided?");
  });

  it("enforces headcount, then waitlists in order", async () => {
    const s = await shift(23, { headcount: 1 });
    const [a, c, d] = [await person(), await person(), await person()];
    await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [a.staffId, c.staffId, d.staffId], responseDeadline: null });
    for (const x of [a, c, d]) await b.respondToOffer(x, (await bookingOf(s, x.staffId)).id, "interested", null);

    await b.confirmBooking(rgxm.id, (await bookingOf(s, a.staffId)).id);
    expect((await one("select status from shifts where id = $1", [s])).status).toBe("filled");
    await expect(b.confirmBooking(rgxm.id, (await bookingOf(s, c.staffId)).id)).rejects.toThrow(/full \(1\/1\)/);

    await b.waitlist(rgxm.id, (await bookingOf(s, c.staffId)).id);
    await b.waitlist(rgxm.id, (await bookingOf(s, d.staffId)).id);
    const positions = await pool.query("select staff_id, waitlist_position from bookings where shift_id = $1 and status = 'waitlisted' order by waitlist_position", [s]);
    expect(positions.rows.map((r) => r.staff_id)).toEqual([c.staffId, d.staffId]);

    // The confirmed person drops out; the shift reopens and the first waitlisted person can be confirmed.
    await b.staffWithdraw(a, (await bookingOf(s, a.staffId)).id, "Family emergency");
    const dropped = await one("select status, cancelled_by_staff from bookings where shift_id = $1 and staff_id = $2", [s, a.staffId]);
    expect(dropped).toEqual({ status: "cancelled", cancelled_by_staff: true });
    expect((await one("select status from shifts where id = $1", [s])).status).toBe("open");
    await b.confirmBooking(rgxm.id, (await bookingOf(s, c.staffId)).id);
    expect(await bookingOf(s, c.staffId)).toMatchObject({ status: "confirmed" });
  });

  it("blocks double-booking unless overridden with a reason", async () => {
    const morning = await shift(24, { startHour: 13, hours: 6 });
    const evening = await shift(24, { startHour: 17, hours: 6 });
    const p = await person();
    await b.sendOffers(rgxm.id, { shiftIds: [morning, evening], staffIds: [p.staffId], responseDeadline: null });
    for (const s of [morning, evening]) await b.respondToOffer(p, (await bookingOf(s, p.staffId)).id, "interested", null);
    await b.confirmBooking(rgxm.id, (await bookingOf(morning, p.staffId)).id);

    const second = (await bookingOf(evening, p.staffId)).id;
    const err = await b.confirmBooking(rgxm.id, second).catch((e) => e);
    expect(err).toBeInstanceOf(b.ConflictError);
    expect((err as b.ConflictError).conflicts).toHaveLength(1);
    await expect(b.confirmBooking(rgxm.id, second, { override: { reason: " " } })).rejects.toThrow(/reason/);
    await b.confirmBooking(rgxm.id, second, { override: { reason: "Covering handover, approved by AM" } });
    const row = await one("select status, override_by, override_reason from bookings where id = $1", [second]);
    expect(row).toEqual({ status: "confirmed", override_by: rgxm.id, override_reason: "Covering handover, approved by AM" });
  });

  it("lets staff back out of interest before they're confirmed", async () => {
    const s = await shift(25);
    const p = await person();
    await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [p.staffId], responseDeadline: null });
    const offer = await bookingOf(s, p.staffId);
    await b.respondToOffer(p, offer.id, "interested", null);
    await b.staffWithdraw(p, offer.id, "Picked up another job");
    expect((await bookingOf(s, p.staffId)).status).toBe("declined");
    // A fresh offer can be made later; history is kept as a separate row.
    expect((await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [p.staffId], responseDeadline: null })).created).toBe(1);
  });
});

describe("notifications via the outbox", () => {
  it("delivers each notification once, even if processed twice", async () => {
    await pool.query("delete from outbox_events");
    const s = await shift(30);
    const p = await person();
    await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [p.staffId], responseDeadline: null });
    const first = await processOutbox(handlers);
    expect(first.done).toBeGreaterThan(0);
    expect(first.failed).toBe(0);
    // Simulate a retry of the same event.
    await pool.query("update outbox_events set status = 'pending'");
    await processOutbox(handlers);
    const n = await one("select count(*)::int n from notifications where user_id = $1 and type = 'offer'", [p.userId]);
    expect(n.n).toBe(1);
    const mail = await one<{ n: number; status: string }>(
      "select count(*)::int n, min(status::text) status from notification_deliveries where to_address = (select email from staff_profiles where id = $1)",
      [p.staffId],
    );
    expect(mail).toEqual({ n: 1, status: "suppressed" }); // .test address: never sent
  });

  it("emails people without accounts and retries failures with backoff", async () => {
    await pool.query("delete from outbox_events");
    const s = await shift(31);
    const noAccount = await person({ withAccount: false });
    await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [noAccount.staffId], responseDeadline: null });
    const res = await processOutbox({ "offer.sent": async () => Promise.reject(new Error("boom")) });
    expect(res.failed).toBe(1);
    const ev = await one("select status, attempts, last_error, available_at > now() as delayed from outbox_events limit 1");
    expect(ev).toMatchObject({ status: "pending", attempts: 1, last_error: "boom", delayed: true });
    await pool.query("update outbox_events set available_at = now()");
    await processOutbox(handlers);
    const mail = await one("select count(*)::int n from notification_deliveries where to_address = (select email from staff_profiles where id = $1)", [noAccount.staffId]);
    expect(mail.n).toBe(1);
  });
});

describe("briefing documents", () => {
  const pdf = Buffer.from("%PDF-1.4\n% test\n");
  beforeAll(async () => {
    project = await makeProject(); // isolate from bookings made by earlier tests
  });

  it("validates uploads by type and content", async () => {
    await expect(comms.uploadDocument(rgxm.id, project.projectId, { title: "Bad", category: "event_brief", requiresAck: false, shiftId: null }, { name: "x.exe", data: pdf })).rejects.toThrow(/Upload a/);
    await expect(
      comms.uploadDocument(rgxm.id, project.projectId, { title: "Fake", category: "event_brief", requiresAck: false, shiftId: null }, { name: "fake.pdf", data: Buffer.from("not a pdf") }),
    ).rejects.toThrow(/don't match/);
  });

  it("limits access to confirmed staff and tracks acknowledgement per version", async () => {
    const s = await shift(40);
    const confirmed = await person();
    const outsider = await person();
    await b.sendOffers(rgxm.id, { shiftIds: [s], staffIds: [confirmed.staffId, outsider.staffId], responseDeadline: null });
    await b.respondToOffer(confirmed, (await bookingOf(s, confirmed.staffId)).id, "interested", null);
    await b.confirmBooking(rgxm.id, (await bookingOf(s, confirmed.staffId)).id);

    const docId = await comms.uploadDocument(rgxm.id, project.projectId, { title: "Event brief", category: "event_brief", requiresAck: true, shiftId: null }, { name: "Brief v1.pdf", data: pdf });
    const doc = await one<{ project_id: string; shift_id: string | null; archived_at: Date | null; file_name: string }>("select * from documents where id = $1", [docId]);
    expect(doc.file_name).toBe("Brief-v1.pdf");
    expect(await comms.staffCanAccessDocument(confirmed.staffId, { projectId: doc.project_id, shiftId: null, archivedAt: null })).toBe(true);
    expect(await comms.staffCanAccessDocument(outsider.staffId, { projectId: doc.project_id, shiftId: null, archivedAt: null })).toBe(false);
    await expect(comms.acknowledgeDocument(outsider, docId)).rejects.toThrow(/not found/);

    await comms.acknowledgeDocument(confirmed, docId);
    await comms.acknowledgeDocument(confirmed, docId); // idempotent
    let listed = (await comms.listProjectDocuments(project.projectId)).find((d) => d.id === docId)!;
    expect(listed).toMatchObject({ audience: 1, acknowledged: 1 });

    expect(await comms.replaceDocument(rgxm.id, docId, { name: "Brief v2.pdf", data: pdf })).toBe(2);
    listed = (await comms.listProjectDocuments(project.projectId)).find((d) => d.id === docId)!;
    expect(listed).toMatchObject({ version: 2, audience: 1, acknowledged: 0 });
  });
});
