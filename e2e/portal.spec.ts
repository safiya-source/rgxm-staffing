import { expect, test } from "@playwright/test";
import { pool, signInAsTeam, signInWithMagicLink } from "./helpers";


test("existing staff member signs in with a magic link", async ({ page }) => {
  await signInWithMagicLink(page, "ba.demo@rgxm-demo.test");
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { name: "Hi Jordan" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Schedule" })).toBeVisible();

  // Field staff can't reach the internal dashboard.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/portal/);
});

test("a new Brand Ambassador registers and completes onboarding", async ({ page }) => {
  const email = `new.ba.${Date.now()}@rgxm-demo.test`;
  await page.goto("/join");
  await expect(page.getByRole("heading", { name: "Work events with RGXM" })).toBeVisible();
  await signInWithMagicLink(page, email);
  await expect(page).toHaveURL(/\/portal\/onboarding/);

  await page.getByLabel("First name").fill("Morgan");
  await page.getByLabel("Last name").fill("Tester");
  await page.getByLabel("Mobile number").fill("416 555 0199");
  await page.getByLabel("City").fill("Toronto");
  await page.getByRole("checkbox", { name: /Brand Ambassador/ }).click();

  // Consent is required.
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByText("Please confirm you've read the Privacy Policy.")).toBeVisible();

  await page.getByRole("checkbox", { name: /privacy (notice|policy)/i }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();

  // Work details: optional questions straight after setup.
  await expect(page).toHaveURL(/\/portal\/onboarding\/work$/);
  await page.getByRole("radiogroup").nth(0).getByLabel("Yes").check();
  await page.getByRole("radiogroup").nth(1).getByLabel("No").check();
  await page.getByRole("radiogroup").nth(2).getByLabel("Yes").check();
  await page.getByLabel("How far are you willing to travel? (km)").fill("150");
  await page.getByLabel("Years of event experience").fill("4");
  await page.getByLabel("Languages you speak").fill("English, French");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // Then prompts for availability and tax details, both skippable.
  await expect(page).toHaveURL(/\/portal\/onboarding\/next$/);
  await expect(page.getByRole("link", { name: /Set your availability now/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Add tax details/ })).toBeVisible();
  await page.getByRole("link", { name: "Skip for now and go to Home" }).click();

  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { name: "Hi Morgan" })).toBeVisible();
  await expect(page.getByText("No upcoming shifts")).toBeVisible();

  const { rows } = await pool.query("select p.city, array_agg(r.role::text) roles from staff_profiles p join staff_roles r on r.staff_id = p.id where p.email = $1 group by p.city", [email]);
  expect(rows[0]).toMatchObject({ city: "Toronto", roles: ["BA"] });
  const work = await pool.query(
    "select has_drivers_licence, has_vehicle, willing_to_travel, travel_radius_km, experience_years, (select array_agg(l.name order by l.name) from staff_languages sl join languages l on l.id = sl.language_id where sl.staff_id = p.id) langs from staff_profiles p where p.email = $1",
    [email],
  );
  expect(work.rows[0]).toMatchObject({ has_drivers_licence: true, has_vehicle: false, willing_to_travel: true, travel_radius_km: 150, experience_years: 4, langs: ["English", "French"] });
});

test("staff set weekly availability and a day off", async ({ page }) => {
  // Start from an empty week so the taps below always turn parts on.
  await pool.query("delete from availability_rules where staff_id = (select id from staff_profiles where email = 'tl.demo@rgxm-demo.test')");
  await signInWithMagicLink(page, "tl.demo@rgxm-demo.test");
  await page.getByRole("link", { name: "Update my availability" }).click();
  await expect(page.getByRole("heading", { name: "My availability" })).toBeVisible();
  // Wednesday mornings and evenings; Saturday any time (picking a part turns "Open" back off).
  await page.getByRole("button", { name: "Wednesday Morning" }).click();
  await page.getByRole("button", { name: "Wednesday Evening" }).click();
  await page.getByRole("button", { name: "Saturday open availability" }).click();
  await page.getByRole("button", { name: "Saturday Morning" }).click();
  await expect(page.getByRole("button", { name: "Saturday open availability" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Saturday open availability" }).click();
  await page.getByRole("button", { name: "Save weekly availability" }).click();
  await expect(page.getByText("Weekly availability saved.")).toBeVisible();
  const { rows } = await pool.query(
    "select r.weekday, to_char(r.start_time, 'HH24:MI') s, to_char(r.end_time, 'HH24:MI') e from availability_rules r join staff_profiles p on p.id = r.staff_id where p.email = 'tl.demo@rgxm-demo.test' and r.weekday in (3, 6) order by 1, 2",
  );
  expect(rows).toEqual([
    { weekday: 3, s: "06:00", e: "12:00" },
    { weekday: 3, s: "17:00", e: "22:00" },
    { weekday: 6, s: "00:00", e: "23:59" },
  ]);

  await page.getByLabel("Date", { exact: true }).fill("2026-12-24");
  await page.getByRole("button", { name: "Add date" }).click();
  await expect(page.getByText("Thursday, Dec 24")).toBeVisible();
});

test("a contractor adds their tax details (no SIN is asked for)", async ({ page }) => {
  await signInWithMagicLink(page, "ba.demo@rgxm-demo.test");
  await page.goto("/portal/profile");
  await page.getByRole("link", { name: /Tax details/ }).click();
  await expect(page.getByRole("heading", { name: "Tax details" })).toBeVisible();
  await expect(page.getByLabel(/Social Insurance Number/)).toHaveCount(0);
  await page.getByLabel("Legal name").fill("Jordan Lee");
  // Contractors choose a registration status, never a tax rate.
  await expect(page.getByLabel(/rate/i)).toHaveCount(0);
  await page.getByRole("radio", { name: "No", exact: true }).check();
  await page.getByLabel("Street address").fill("100 Queen St W");
  await page.getByLabel("City", { exact: true }).fill("Toronto");
  await page.getByLabel("Province").selectOption("ON");
  await page.getByLabel("Postal code").fill("M5H 2N2");
  await page.getByRole("button", { name: "Save tax details" }).click();
  await expect(page.getByText("Tax details saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Street address")).toHaveValue("100 Queen St W");
});

test("a contractor claims an expense with a receipt, and RGXM approves it with no tax added", async ({ page, browser }) => {
  // Jordan needs a confirmed shift on the project to claim against.
  const projectId = (await pool.query("select id from projects where code = 'DEMO-CAD-2611'")).rows[0].id as string;
  const jordan = (await pool.query("select id from staff_profiles where email = 'ba.demo@rgxm-demo.test'")).rows[0].id as string;
  const shift = (await pool.query("select id from shifts where project_id = $1 and status <> 'cancelled' order by starts_at limit 1", [projectId])).rows[0].id as string;
  const existing = (await pool.query("select id from bookings where shift_id = $1 and staff_id = $2 and status in ('confirmed', 'completed')", [shift, jordan])).rows[0];
  if (!existing) {
    await pool.query(
      `insert into bookings (shift_id, staff_id, project_id, role, starts_at, ends_at, status, agreed_rate_cents, offered_rate_cents, rate_source, confirmed_at)
       select s.id, $2, s.project_id, s.role, s.starts_at, s.ends_at, 'confirmed', 2500, 2500, 'shift', now() from shifts s where s.id = $1
       on conflict do nothing`,
      [shift, jordan],
    );
  }
  const vendor = `E2E Hardware ${Date.now()}`;

  await signInWithMagicLink(page, "ba.demo@rgxm-demo.test");
  await page.goto("/portal/payments");
  await page.getByRole("link", { name: /Submit an expense for reimbursement/ }).click();
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
  await page.getByLabel("Project").selectOption({ label: "Cadbury Sampling Activation" });
  await page.getByLabel("Total paid (CAD)").fill("18.75");
  await page.getByLabel("Store or vendor").fill(vendor);
  await page.getByLabel("What was it for?").fill("Zip ties and tape for the banner");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("receipt")]);
  await page.getByLabel("Receipt").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Submit for reimbursement" }).click();
  await expect(page.getByText("Expense submitted. RGXM will review it.")).toBeVisible();
  await expect(page.getByText(`${vendor} · $18.75`)).toBeVisible();
  await expect(page.getByText("Waiting for RGXM").first()).toBeVisible();

  // RGXM sees it with the receipt and approves it.
  const rgxm = await (await browser.newContext()).newPage();
  await signInAsTeam(rgxm, "pm");
  await rgxm.goto(`/dashboard/projects/${projectId}/compensation`);
  const row = rgxm.getByRole("row").filter({ hasText: vendor });
  await expect(row.getByRole("link", { name: "View receipt" })).toBeVisible();
  const receipt = await rgxm.request.get(await row.getByRole("link", { name: "View receipt" }).getAttribute("href").then((h) => h!));
  expect(receipt.status()).toBe(200);
  expect(Buffer.from(await receipt.body())).toEqual(png);
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row.getByText("No tax")).toBeVisible();

  const item = (await pool.query("select c.status, p.tax_cents::int tax, p.total_cents::int total from compensation_items c join payable_items p on p.id = c.payable_item_id where c.vendor = $1", [vendor])).rows[0];
  expect(item).toEqual({ status: "approved", tax: 0, total: 1875 });
});
