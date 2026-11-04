import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { consumeInvitation, inviteStaff, sendInvitation } from "@/server/domain/invitations";
import { env } from "@/server/env";
import { makeStaff, makeUser, one, pool } from "./fixtures";

let admin: { id: string };

beforeAll(async () => {
  admin = await makeUser();
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

/** Sends the queued invitation and returns the token from the (logged) email. */
async function issue(staffId: string) {
  const inv = await one<{ id: string }>("select id from staff_invitations where staff_id = $1 and revoked_at is null and accepted_at is null order by created_at desc limit 1", [staffId]);
  await sendInvitation(inv.id);
  const mail = await one<{ body_text: string }>("select body_text from notification_deliveries where dedupe_key = $1", [`staff.invite:${inv.id}`]);
  const token = /\/invite\?token=([A-Za-z0-9_-]+)/.exec(mail.body_text)?.[1];
  expect(token).toBeTruthy();
  return { invitationId: inv.id, token: token! };
}

function accept(token: string) {
  return auth.handler(
    new Request(`${env.APP_URL}/api/auth/staff-invite/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: env.APP_URL, "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ token }),
    }),
  );
}

describe("staff invitations", () => {
  it("invite only real, active people who aren't in the portal yet, and not twice in a day", async () => {
    const fresh = await makeStaff();
    const demo = await makeStaff();
    await pool.query("update staff_profiles set is_demo = true where id = $1", [demo.id]);
    const suspended = await makeStaff();
    await pool.query("update staff_profiles set status = 'suspended' where id = $1", [suspended.id]);
    const joined = await makeStaff();
    const u = await makeUser("staff");
    await pool.query("update staff_profiles set user_id = $1 where id = $2", [u.id, joined.id]);

    const r = await inviteStaff(admin.id, [fresh.id, demo.id, suspended.id, joined.id]);
    expect(r.invited).toEqual([fresh.id]);
    expect(Object.fromEntries(r.skipped.map((s) => [s.staffId, s.reason]))).toEqual({ [demo.id]: "demo", [suspended.id]: "not_active", [joined.id]: "already_joined" });
    const events = await pool.query("select payload from outbox_events where type = 'staff.invite' and payload->>'invitationId' in (select id::text from staff_invitations where staff_id = $1)", [fresh.id]);
    expect(events.rowCount).toBe(1);

    expect((await inviteStaff(admin.id, [fresh.id])).skipped).toEqual([{ staffId: fresh.id, reason: "recently_invited" }]);
    // Resending replaces the earlier invitation.
    expect((await inviteStaff(admin.id, [fresh.id], { resend: true })).invited).toEqual([fresh.id]);
    const rows = (await pool.query("select revoked_at is not null as revoked from staff_invitations where staff_id = $1 order by created_at", [fresh.id])).rows;
    expect(rows).toEqual([{ revoked: true }, { revoked: false }]);
  });

  it("email a single-use link (only its hash is stored) that signs the person in", async () => {
    const person = await makeStaff();
    await inviteStaff(admin.id, [person.id]);
    const { invitationId, token } = await issue(person.id);
    const stored = await one<{ token_hash: string; expires_at: Date }>("select token_hash, expires_at from staff_invitations where id = $1", [invitationId]);
    expect(stored.token_hash).not.toContain(token);
    expect(stored.expires_at.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3_600_000);

    // Sending again (an outbox retry) is a no-op, so the emailed link keeps working.
    await sendInvitation(invitationId);
    expect((await one<{ token_hash: string }>("select token_hash from staff_invitations where id = $1", [invitationId])).token_hash).toBe(stored.token_hash);

    const res = await accept(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/rgxm\.session_token=/);
    const linked = await one<{ user_id: string; kind: string; email_verified: boolean }>(
      "select p.user_id, u.kind, u.email_verified from staff_profiles p join users u on u.id = p.user_id where p.id = $1",
      [person.id],
    );
    expect(linked).toMatchObject({ kind: "staff", email_verified: true });

    // Used once; a second use fails.
    expect((await accept(token)).status).toBe(400);
    expect(await consumeInvitation(token)).toBeNull();
  });

  it("refuse expired links and team (internal) accounts", async () => {
    const late = await makeStaff();
    await inviteStaff(admin.id, [late.id]);
    const a = await issue(late.id);
    await pool.query("update staff_invitations set expires_at = now() - interval '1 minute' where id = $1", [a.invitationId]);
    expect(await consumeInvitation(a.token)).toBeNull();

    const internal = await makeUser("internal");
    const email = (await one<{ email: string }>("select email from users where id = $1", [internal.id])).email;
    const p = await one<{ id: string }>("insert into staff_profiles (first_name, last_name, email) values ('Team', 'Member', $1) returning id", [email]);
    await inviteStaff(admin.id, [p.id]);
    const b = await issue(p.id);
    expect(await consumeInvitation(b.token)).toBeNull();
    // Refused without using up the invitation.
    expect((await one<{ accepted_at: Date | null }>("select accepted_at from staff_invitations where id = $1", [b.invitationId])).accepted_at).toBeNull();
  });
});
