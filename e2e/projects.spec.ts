import { expect, test } from "@playwright/test";
import { pool, signInAsTeam } from "./helpers";


test("PM builds a project: details, location, requirement, then a run of shifts", async ({ page }) => {
  const code = `E2E-${Date.now() % 1_000_000}`;
  await signInAsTeam(page, "pm");

  await page.goto("/dashboard/projects/new");
  await page.getByLabel("Project name").fill("E2E Pop-up");
  await page.getByLabel("Project code").fill(code);
  await page.getByLabel("Client", { exact: true }).selectOption("__new");
  await page.getByLabel("New client name").fill("E2E Client");
  await page.getByLabel("Start date").fill("2026-12-10");
  await page.getByLabel("End date").fill("2026-12-12");
  await page.getByLabel("Staffing budget").fill("5000");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: /E2E Pop-up/ })).toBeVisible();
  await expect(page.getByText("Setup checklist")).toBeVisible();

  // Location
  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await page.getByRole("button", { name: "Add location" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Union Station");
  await page.getByRole("button", { name: "Save location" }).click();
  await expect(page.getByText("Union Station")).toBeVisible();

  // Requirement
  await page.getByRole("button", { name: "Add requirement" }).click();
  await page.getByLabel("People").fill("4");
  await page.getByLabel("Default hourly rate (CAD)").fill("25");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Brand Ambassador" })).toBeVisible();

  // Shifts: 3 days, overnight on purpose to check the "next day" handling.
  await page.getByRole("link", { name: "Shifts", exact: true }).click();
  await page.getByRole("button", { name: "Create shifts" }).click();
  await page.getByLabel("From requirement").selectOption({ index: 1 });
  await page.getByLabel("First date").fill("2026-12-10");
  await page.getByLabel("Last date").fill("2026-12-12");
  await page.getByLabel("Start time").fill("20:00");
  await page.getByLabel("End time").fill("02:00");
  await expect(page.getByText("Ends the next day")).toBeVisible();
  await expect(page.getByText(/3 shifts · 12 positions · 72h scheduled · est\. \$1,800\.00/)).toBeVisible();
  await page.getByRole("button", { name: "Create 3 shifts" }).click();
  await expect(page.getByText("Created 3 shifts.")).toBeVisible();
  await expect(page.getByText("+1 day").first()).toBeVisible();
  await expect(page.locator("[data-slot=badge]", { hasText: "0/4 filled" })).toHaveCount(3);

  // Overview reflects positions and cost against budget.
  await page.getByRole("link", { name: "Overview", exact: true }).last().click();
  await expect(page.getByText("Scheduled positions")).toBeVisible();
  await expect(page.getByText("36% of $5,000.00 budget")).toBeVisible();

  const { rows } = await pool.query(
    "select s.starts_at from shifts s join projects p on p.id = s.project_id where p.code = $1 order by s.starts_at limit 1",
    [code],
  );
  expect((rows[0].starts_at as Date).toISOString()).toBe("2026-12-11T01:00:00.000Z"); // 8pm EST
});

test("schedule calendar shows seeded Cadbury shifts with coverage", async ({ page }) => {
  await signInAsTeam(page, "coordinator");
  await page.goto("/dashboard/schedule?view=week&date=2026-11-12");
  await expect(page.getByRole("heading", { name: "Nov 9 – Nov 15, 2026" })).toBeVisible();
  await expect(page.getByRole("link", { name: /10:00am BA 0\/10/ }).first()).toBeVisible();
  await page.getByRole("link", { name: "month" }).click();
  await expect(page.getByRole("heading", { name: "November 2026" })).toBeVisible();
});

test("finance can view projects but not create or edit them", async ({ page }) => {
  await signInAsTeam(page, "finance");
  await page.goto("/dashboard/projects");
  await expect(page.getByRole("link", { name: "Cadbury Sampling Activation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);
  await page.getByRole("link", { name: "Cadbury Sampling Activation" }).click();
  await expect(page.getByRole("button", { name: /Move to/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Shifts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create shifts" })).toHaveCount(0);
});
