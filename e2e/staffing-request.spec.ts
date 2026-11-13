import { expect, test } from "@playwright/test";
import { pool, signInAsTeam } from "./helpers";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("PM creates a staffing request with a new project and venue, then lands on Send offers", async ({ page }) => {
  const name = `Quick Request ${Date.now().toString(36)}`;
  await signInAsTeam(page, "pm");
  await page.goto("/dashboard/staffing");
  await page.getByRole("link", { name: "New staffing request" }).first().click();
  await expect(page.getByRole("heading", { name: "New staffing request" })).toBeVisible();

  await page.getByRole("radio", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Client").selectOption({ label: "+ New client…" });
  await page.getByLabel("New client name").fill("Quick Client (test)");
  await page.getByLabel("Venue name").fill("Union Station");
  await page.getByLabel("City").fill("Toronto");
  await page.getByLabel("People per shift").fill("3");
  // A Team Lead on the same days, at their own rate.
  await page.getByRole("button", { name: "Add another role" }).click();
  await page.getByLabel("Role 2").selectOption({ label: "Team Lead" });
  await page.getByLabel("People per shift").nth(1).fill("1");
  await page.getByLabel("Hourly rate").nth(1).fill("32.50");
  await page.getByLabel("First day").fill(inDays(30));
  await page.getByLabel("Last day").fill(inDays(32));
  await expect(page.getByText("3 days × 4 people (3 BA + 1 TL) = 12 positions")).toBeVisible();
  // Allowances, mileage and a bonus, on top of the hourly rates.
  await page.getByRole("checkbox", { name: /Meal allowances/ }).click();
  await page.getByRole("checkbox", { name: "Lunch eligible" }).click(); // lunch is provided on site
  await page.getByRole("checkbox", { name: /^Mileage/ }).click();
  await page.getByRole("checkbox", { name: /^Bonus/ }).click();
  await page.getByLabel("Amount (CAD, optional)").fill("40");
  await page.getByLabel("When it's earned").fill("Per shift when the sampling target is met");
  await page.getByRole("button", { name: "Create & send offers" }).click();

  await expect(page).toHaveURL(/\/dashboard\/staffing\/[0-9a-f-]{36}\?group=BA/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send offers" })).toBeVisible();
  const p = (await pool.query("select status, (select count(*)::int from shifts s where s.project_id = p.id and s.status = 'open') as n from projects p where name = $1", [name])).rows[0];
  expect(p).toEqual({ status: "staffing", n: 6 });
  const tl = (await pool.query("select distinct s.rate_cents from shifts s join projects p on p.id = s.project_id where p.name = $1 and s.role = 'TL'", [name])).rows;
  expect(tl).toEqual([{ rate_cents: 3250 }]);
  const comp = (await pool.query("select c.meals_enabled, c.eligible_meals, c.mileage_enabled, c.per_diem_enabled, c.bonus_cents, c.bonus_conditions from project_compensation_settings c join projects p on p.id = c.project_id where p.name = $1", [name])).rows[0];
  expect(comp).toEqual({ meals_enabled: true, eligible_meals: ["meal_breakfast", "meal_dinner"], mileage_enabled: true, per_diem_enabled: false, bonus_cents: 4000, bonus_conditions: "Per shift when the sampling target is met" });
});

test("coordinators add shifts and venues to any project but can't create projects", async ({ page }) => {
  await signInAsTeam(page, "coordinator");
  await page.goto("/dashboard/staffing/new");
  await expect(page.getByRole("radio", { name: "New project" })).toHaveCount(0);
  await page.getByLabel("Project").selectOption({ label: "Cadbury Sampling Activation (DEMO-CAD-2611)" });
  // Shifts don't always happen at the main activation site, so coordinators can add a venue.
  await expect(page.getByLabel("Venue").locator("option", { hasText: "New venue" })).toHaveCount(1);
  // Allowances and bonuses are set by PMs and Admins.
  await expect(page.getByText("4. Allowances, mileage & bonus")).toHaveCount(0);
});

test("finance sets company default rates, which pre-fill new staffing requests", async ({ page, browser }) => {
  await signInAsTeam(page, "finance");
  await page.goto("/dashboard/settings");
  await page.getByLabel("Brand Ambassador (CAD / hour)").fill("26.50");
  await page.getByRole("button", { name: "Save rates" }).click();
  await expect(page.getByText("Default rates saved.")).toBeVisible();

  const pm = await (await browser.newContext()).newPage();
  try {
    await signInAsTeam(pm, "pm");
    await pm.goto("/dashboard/staffing/new");
    await pm.getByRole("radio", { name: "New project" }).click();
    await expect(pm.getByLabel("Hourly rate")).toHaveValue("26.50");
  } finally {
    await pool.query("update org_settings set default_rates = '{}'::jsonb where id = 1");
  }
});
