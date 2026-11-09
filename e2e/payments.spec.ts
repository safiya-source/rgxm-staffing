import { devices, expect, test } from "@playwright/test";
import { pool, signInAsTeam, signInWithMagicLink } from "./helpers";

// M5 acceptance (steps 12–17): approved hours → contractor batch → second-person approval →
// export (once) → mark paid → staff see "Paid"; project budget shows the actual cost.
test.describe.configure({ mode: "serial" });

/** A fresh approved 5-hour shift for Jordan on the finished Oreo demo project, ready to pay. */
async function approvedPayable() {
  const { rows } = await pool.query(
    `select p.id as project_id, l.id as location_id, s.id as staff_id, s.user_id
       from projects p join project_locations l on l.project_id = p.id, staff_profiles s
      where p.code = 'DEMO-ORE-2610' and s.email = 'ba.demo@rgxm-demo.test'`,
  );
  const ctx = rows[0];
  // A past slot (from September 2026) after Jordan's previous test bookings, so reruns never overlap.
  const last = (
    await pool.query("select max(ends_at) as t from bookings where staff_id = $1 and starts_at >= '2026-09-01' and starts_at < '2026-10-01'", [ctx.staff_id])
  ).rows[0].t as Date | null;
  const start = new Date((last ?? new Date(Date.UTC(2026, 8, 1, 0, 0))).getTime() + 3_600_000);
  const end = new Date(start.getTime() + 5 * 3_600_000);
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Jordan isn't GST/HST-registered for this test, so the payable needs no HST.
    await client.query("update staff_sensitive set tax_registered = false, gst_hst_number = null, gst_registration_status = 'no', gst_verification_status = 'verified' where staff_id = $1", [ctx.staff_id]);
    const shift = (
      await client.query(
        `insert into shifts (project_id, location_id, role, starts_at, ends_at, timezone, rate_cents, status)
         values ($1, $2, 'BA', $3, $4, 'America/Toronto', 2400, 'completed') returning id`,
        [ctx.project_id, ctx.location_id, start, end],
      )
    ).rows[0];
    const booking = (
      await client.query(
        `insert into bookings (shift_id, staff_id, project_id, role, starts_at, ends_at, status, agreed_rate_cents, offered_rate_cents)
         values ($1, $2, $3, 'BA', $4, $5, 'completed', 2400, 2400) returning id`,
        [shift.id, ctx.staff_id, ctx.project_id, start, end],
      )
    ).rows[0];
    const ts = (
      await client.query(
        `insert into timesheets (booking_id, staff_id, project_id, shift_id, status, worked_start, worked_end, payable_minutes, approved_at)
         values ($1, $2, $3, $4, 'approved', $5, $6, 300, now()) returning id`,
        [booking.id, ctx.staff_id, ctx.project_id, shift.id, start, end],
      )
    ).rows[0];
    const payable = (
      await client.query(
        `insert into payable_items (timesheet_id, staff_id, project_id, service_date, classification, payable_minutes, rate_cents, base_cents, total_cents, calc_version, calc_inputs, tax_status, registration_snapshot)
         values ($1, $2, $3, (($4::timestamptz) at time zone 'America/Toronto')::date, 'contractor', 300, 2400, 12000, 12000, 'lines-tax-v3', '{"role":"BA"}', 'no_tax', 'no:verified') returning id`,
        [ts.id, ctx.staff_id, ctx.project_id, start],
      )
    ).rows[0];
    await client.query("commit");
    return { payableId: payable.id as string, timesheetId: ts.id as string, projectId: ctx.project_id as string };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

test("finance batches, a second person approves, export once, mark paid, staff see it", async ({ browser }) => {
  test.setTimeout(180_000);
  const { payableId, timesheetId, projectId } = await approvedPayable();

  // 1. Finance creates a contractor batch from the demo payables.
  const fin = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await signInAsTeam(fin, "finance");
  await fin.goto("/dashboard/payments");
  const section = fin.getByRole("region", { name: "Contractors · demo data" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("checkbox", { name: /Select Jordan Lee/ }).first()).toBeChecked();
  await section.getByRole("button", { name: /Create batch/ }).click();
  await expect(fin).toHaveURL(/\/dashboard\/payments\/batches\//);
  const batchUrl = fin.url();
  await expect(fin.getByText(/You created it, so you can't approve it/)).toBeVisible();
  await expect.poll(async () => (await pool.query("select status from timesheets where id = $1", [timesheetId])).rows[0].status).toBe("locked");

  // 2. An admin (second person) approves it.
  const admin = await (await browser.newContext()).newPage();
  await signInAsTeam(admin, "admin");
  await admin.goto(batchUrl);
  await admin.getByRole("button", { name: "Approve batch" }).click();
  await admin.getByRole("button", { name: "Confirm" }).click();
  await expect(admin.getByText("Batch approved. It can now be exported.")).toBeVisible();

  // 3. Finance exports once; the file is marked as demo and includes our payable.
  await fin.reload();
  const downloadPromise = fin.waitForEvent("download");
  await fin.getByRole("button", { name: "Generate bank file" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^DEMO-CON-.*\.csv$/);
  const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  expect(text).toContain(payableId);
  expect(text).toContain("DEMO - DO NOT PAY");
  await fin.reload();
  await expect(fin.getByRole("button", { name: "Generate bank file" })).toHaveCount(0);
  // Exporting never marks anything paid.
  expect((await pool.query("select status from payable_items where id = $1", [payableId])).rows[0].status).toBe("exported");
  await expect(fin.getByTitle("SHA-256 fingerprint")).toBeVisible();

  // 4. Finance records the payment.
  await fin.getByLabel("Bank evidence").fill("Demo statement, line 1");
  await fin.getByRole("button", { name: "Record settlement" }).click();
  await fin.getByRole("button", { name: "Record settlement" }).last().click();
  await expect(fin.getByText(/Settlement recorded/)).toBeVisible();
  const p = (await pool.query("select status from payable_items where id = $1", [payableId])).rows[0];
  expect(p.status).toBe("paid");
  expect((await pool.query("select status from timesheets where id = $1", [timesheetId])).rows[0].status).toBe("paid");

  // 5. Jordan sees the payment as paid, and got a notification.
  const ba = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await signInWithMagicLink(ba, "ba.demo@rgxm-demo.test");
  await ba.goto("/portal/payments");
  await expect(ba.getByTestId("payment-row").filter({ hasText: "Oreo Cookie Truck" }).filter({ hasText: /Paid/ }).first()).toBeVisible();
  await expect
    .poll(async () => (await pool.query("select count(*)::int n from notifications n join staff_profiles s on s.user_id = n.user_id where s.email = 'ba.demo@rgxm-demo.test' and n.type = 'payment.paid'")).rows[0].n)
    .toBeGreaterThan(0);

  // 6. The PM sees the actual cost on the project budget.
  const pm = await (await browser.newContext()).newPage();
  await signInAsTeam(pm, "pm");
  await pm.goto(`/dashboard/projects/${projectId}/budget`);
  await expect(pm.getByText("Actual fees (approved)")).toBeVisible();
  await expect(pm.getByText("Approved costs by category")).toBeVisible();
  await expect(pm.getByRole("cell", { name: "Brand Ambassador" })).toBeVisible();
});

test("coordinators can't see payments or budgets", async ({ page }) => {
  await signInAsTeam(page, "coordinator");
  await page.goto("/dashboard/payments");
  await expect(page).toHaveURL(/denied=1/);
  const projectId = (await pool.query("select id from projects where code = 'DEMO-ORE-2610'")).rows[0].id;
  await page.goto(`/dashboard/projects/${projectId}`);
  await expect(page.getByRole("link", { name: "Budget" })).toHaveCount(0);
  const res = await page.request.get("/api/payments/exports/00000000-0000-0000-0000-000000000000");
  expect(res.status()).toBe(404);
});

test("finance sees the T4A summary and the talent tax details", async ({ page }) => {
  await signInAsTeam(page, "finance");
  await page.goto("/dashboard/payments");
  await page.getByRole("link", { name: "Year-end" }).first().click();
  await expect(page.getByRole("heading", { name: /Year-end review \d{4}/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download CSV for accountant" })).toBeVisible();
  // Demo payments are never included.
  await expect(page.getByText(/Jordan Lee/)).toHaveCount(0);

  await page.goto("/dashboard/talent?q=Jordan%20Lee");
  await page.getByRole("link", { name: "Jordan Lee" }).click();
  await expect(page.getByRole("heading", { name: "Pay & tax details" })).toBeVisible();
  await expect(page.getByText("Independent contractor").first()).toBeVisible();
});
