import { devices, expect, test } from "@playwright/test";
import { pool, signInAsTeam, signInWithMagicLink } from "./helpers";

// M4 acceptance: check-in/out on the phone, staff submits hours, Team Lead verifies,
// PM approves; separation of duties holds throughout.
test.describe.configure({ mode: "serial" });

const LOCATION = "E2E Pop-up (geofenced)";

/** Retire this spec's shifts and bookings (cancelled rows don't count toward double-booking or staffing screens). */
async function retireTestShifts() {
  await pool.query(
    `update bookings set status = 'cancelled', cancel_reason = 'E2E reset', cancelled_at = now()
      where status in ('confirmed', 'completed') and shift_id in (select s.id from shifts s join project_locations l on l.id = s.location_id where l.name = $1)`,
    [LOCATION],
  );
  await pool.query("update shifts set status = 'cancelled' where location_id in (select id from project_locations where name = $1) and status <> 'cancelled'", [LOCATION]);
}

test.afterAll(retireTestShifts);

async function setUpLiveShift() {
  const projectId = (await pool.query("select id from projects where code = 'DEMO-CAD-2611'")).rows[0].id as string;
  const staff = async (email: string) => (await pool.query("select id from staff_profiles where email = $1", [email])).rows[0].id as string;
  const [jordan, priya] = [await staff("ba.demo@rgxm-demo.test"), await staff("tl.demo@rgxm-demo.test")];

  await retireTestShifts();

  let location = (await pool.query("select id from project_locations where project_id = $1 and name = $2", [projectId, LOCATION])).rows[0]?.id as string | undefined;
  if (!location) {
    location = (
      await pool.query(
        `insert into project_locations (project_id, name, address, city, province, timezone, latitude, longitude, geofence_meters, require_location_at_check_in)
         values ($1, $2, '220 Yonge St', 'Toronto', 'ON', 'America/Toronto', 43.6544, -79.3807, 200, true) returning id`,
        [projectId, LOCATION],
      )
    ).rows[0].id as string;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const ids: Record<string, string> = {};
    for (const [role, staffId, rate] of [
      ["BA", jordan, 2500],
      ["TL", priya, 3000],
    ] as const) {
      const shift = (
        await client.query(
          `insert into shifts (project_id, location_id, role, starts_at, ends_at, timezone, rate_cents, status, instructions)
           values ($1, $2, $3, date_trunc('minute', now()) - interval '60 minutes', date_trunc('minute', now()) + interval '3 hours', 'America/Toronto', $4, 'filled', 'E2E attendance')
           returning id, starts_at, ends_at`,
          [projectId, location, role, rate],
        )
      ).rows[0];
      ids[role] = (
        await client.query(
          `insert into bookings (shift_id, staff_id, project_id, role, starts_at, ends_at, status, agreed_rate_cents, offered_rate_cents, rate_source, confirmed_at)
           values ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $7, 'shift', now()) returning id`,
          [shift.id, staffId, projectId, role, shift.starts_at, shift.ends_at, rate],
        )
      ).rows[0].id as string;
    }
    await client.query("commit");
    return { projectId, ba: ids.BA!, tl: ids.TL! };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

test("check-in/out → submit hours → Team Lead verifies → PM approves", async ({ browser }) => {
  test.setTimeout(180_000);
  const { ba: baBooking, tl: tlBooking } = await setUpLiveShift();

  // 1. Jordan checks in and out from home. The phone reports a position ~1 km from the venue.
  const baCtx = await browser.newContext({ ...devices["Pixel 7"], geolocation: { latitude: 43.6629, longitude: -79.3957 }, permissions: ["geolocation"] });
  const ba = await baCtx.newPage();
  await signInWithMagicLink(ba, "ba.demo@rgxm-demo.test");
  await ba.goto("/portal");
  await expect(ba.getByText(LOCATION)).toBeVisible();
  await expect(ba.getByText(/only taken at that moment/)).toBeVisible();
  await ba.getByRole("button", { name: "Check in" }).click();
  await expect(ba.getByText("You're checked in. Have a great shift!")).toBeVisible();
  await expect(ba.getByText(/away from the venue/)).toBeVisible();
  await expect(ba.getByText(/^Checked in at/)).toBeVisible();

  const ev = await pool.query("select method, within_geofence, latitude from attendance_events where booking_id = $1", [baBooking]);
  expect(ev.rows).toEqual([{ method: "self", within_geofence: false, latitude: 43.6629 }]);

  await ba.getByRole("button", { name: "Check out" }).click();
  await expect(ba.getByText("Checked out. Please review your hours.")).toBeVisible();

  // 2. Jordan reviews hours on the shift page: adds a break and submits.
  await ba.goto(`/portal/shifts/${baBooking}`);
  await expect(ba.getByLabel("Started")).not.toHaveValue("");
  // Submitting the times exactly as recorded needs no reason; here Jordan arrived on time but checked in late.
  const scheduledStart = (await pool.query("select to_char(starts_at at time zone 'America/Toronto', 'HH24:MI') t from bookings where id = $1", [baBooking])).rows[0].t as string;
  const checkout = await ba.getByLabel("Finished").inputValue();
  if (checkout === scheduledStart) throw new Error("unexpected: check-out equals scheduled start");
  await ba.getByLabel("Started").fill(scheduledStart);
  await ba.getByRole("button", { name: "Submit hours" }).click();
  await expect(ba.getByText("Tell us briefly why the times changed.")).toBeVisible();
  await ba.getByLabel("Why did the times change?").fill("Was on site at the start, forgot to tap in");
  await ba.getByLabel("Note for RGXM (optional)").fill("Left early, agreed with Priya.");
  await ba.getByRole("button", { name: "Submit hours" }).click();
  await expect(ba.getByText("Hours submitted. Thanks!")).toBeVisible();
  await expect(ba.getByText("Submitted for review.", { exact: false })).toBeVisible();

  // 3. Priya (Team Lead) sees Jordan on her team; her own shift isn't there (no self-verification).
  const tlCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const tl = await tlCtx.newPage();
  await signInWithMagicLink(tl, "tl.demo@rgxm-demo.test");
  await tl.goto("/portal");
  await tl.getByRole("link", { name: /My team/ }).click();
  const card = tl.getByTestId("team-member").filter({ hasText: "Jordan Lee" }).filter({ hasText: LOCATION });
  await expect(card).toBeVisible();
  await expect(card.getByText("Outside venue radius")).toBeVisible();
  await expect(card.getByText("Times corrected")).toBeVisible();
  expect(await tl.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(tl.getByTestId("team-member").filter({ hasText: "Priya Shah" })).toHaveCount(0);
  await card.getByRole("button", { name: "Verify hours" }).click();
  await tl.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(tl.getByText("Verified and sent to RGXM for approval.")).toBeVisible();

  // Priya's own hours: a Team Lead can't verify themselves, and no AM is on this shift.
  await tl.goto(`/portal/shifts/${tlBooking}`);
  await expect(tl.getByRole("button", { name: "Check in" })).toBeVisible();

  // 4. The shift ends (simulated), then the PM approves Jordan's hours.
  await pool.query("update shifts set ends_at = date_trunc('minute', now()) - interval '1 minute' where id = (select shift_id from bookings where id = $1)", [baBooking]);
  const pm = await (await browser.newContext()).newPage();
  await signInAsTeam(pm, "pm");
  await pm.goto("/dashboard/timesheets");
  await pm.goto(`/dashboard/timesheets/${baBooking}`);
  await expect(pm.getByText("Verified by supervisor").first()).toBeVisible();
  await pm.getByRole("button", { name: "Approve" }).click();
  await expect(pm.getByText(/approved/i).first()).toBeVisible();
  await expect
    .poll(async () => (await pool.query("select t.status, b.status as booking from timesheets t join bookings b on b.id = t.booking_id where t.booking_id = $1", [baBooking])).rows[0])
    .toEqual({ status: "approved", booking: "completed" });
  // Actual (check-in/out) and payable hours are stored separately; the staff correction is in the adjustment history.
  const ts = (await pool.query("select actual_minutes, payable_minutes from timesheets where booking_id = $1", [baBooking])).rows[0];
  expect(ts.payable_minutes).toBeGreaterThanOrEqual(60);
  expect(ts.actual_minutes).toBeLessThan(ts.payable_minutes);
  const adj = await pool.query("select field, stage, reason from timesheet_adjustments a join timesheets t on t.id = a.timesheet_id where t.booking_id = $1", [baBooking]);
  expect(adj.rows).toContainEqual({ field: "worked_start", stage: "staff_correction", reason: "Was on site at the start, forgot to tap in" });

  // Every change on the way is in the history: staff edit, supervisor verification, approval.
  const hist = await pool.query(
    "select a.action from audit_log a join timesheets t on t.id::text = a.entity_id::text where t.booking_id = $1 order by a.created_at",
    [baBooking],
  );
  expect(hist.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["timesheet.submitted", "timesheet.supervisor_verified", "timesheet.approved"]));

  // 5. Jordan sees the approved hours.
  await ba.goto(`/portal/shifts/${baBooking}`);
  await expect(ba.getByText(/Approved for/)).toBeVisible();
});

test("approval isn't offered before the shift ends", async ({ browser }) => {
  // Separation of duties (no approving your own or a supervised-by-you timesheet) is covered in tests/db/attendance.test.ts.
  const { ba } = await setUpLiveShift();
  const page = await (await browser.newContext()).newPage();
  await signInAsTeam(page, "coordinator");
  await page.goto(`/dashboard/timesheets/${ba}`);
  await expect(page.getByText("Jordan Lee").first()).toBeVisible();
  // Shift hasn't ended yet, so approval isn't offered to anyone.
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("an offline check-in is kept on the phone and syncs when back online", async ({ browser }) => {
  const { ba: booking } = await setUpLiveShift();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], geolocation: { latitude: 43.6544, longitude: -79.3807 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  await signInWithMagicLink(page, "ba.demo@rgxm-demo.test");
  await page.goto("/portal");
  await expect(page.getByRole("button", { name: "Check in" })).toBeVisible();

  await ctx.setOffline(true);
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Saved on this phone. Waiting to sync.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check out" })).toBeVisible();
  expect((await pool.query("select count(*)::int n from attendance_events where booking_id = $1", [booking])).rows[0].n).toBe(0);

  await ctx.setOffline(false);
  await expect(page.getByText("Check-in synced.")).toBeVisible();
  await expect(page.getByText("Saved on this phone. Waiting to sync.")).toHaveCount(0);
  const ev = await pool.query("select type, within_geofence, client_event_id is not null as has_client_id from attendance_events where booking_id = $1", [booking]);
  expect(ev.rows).toEqual([{ type: "check_in", within_geofence: true, has_client_id: true }]);
});
