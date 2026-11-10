import { expect, test } from "@playwright/test";
import { pool, signInWithMagicLink } from "./helpers";


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
  await signInWithMagicLink(page, "tl.demo@rgxm-demo.test");
  await page.getByRole("link", { name: "Update my availability" }).click();
  await expect(page.getByRole("heading", { name: "My availability" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Wednesday" }).click();
  await page.getByRole("button", { name: "Save weekly availability" }).click();
  await expect(page.getByText("Weekly availability saved.")).toBeVisible();

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
