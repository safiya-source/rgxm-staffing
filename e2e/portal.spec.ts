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
  await expect(page.getByText("Please confirm you've read the privacy notice.")).toBeVisible();

  await page.getByRole("checkbox", { name: /privacy notice/ }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { name: "Hi Morgan" })).toBeVisible();
  await expect(page.getByText("No upcoming shifts")).toBeVisible();

  const { rows } = await pool.query("select p.city, array_agg(r.role::text) roles from staff_profiles p join staff_roles r on r.staff_id = p.id where p.email = $1 group by p.city", [email]);
  expect(rows[0]).toMatchObject({ city: "Toronto", roles: ["BA"] });
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
