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
  await page.getByLabel("First day").fill(inDays(30));
  await page.getByLabel("Last day").fill(inDays(32));
  await expect(page.getByText("3 shifts × 3 people = 9 positions")).toBeVisible();
  await page.getByRole("button", { name: "Create & send offers" }).click();

  await expect(page).toHaveURL(/\/dashboard\/staffing\/[0-9a-f-]{36}\?group=BA/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send offers" })).toBeVisible();
  const p = (await pool.query("select status, (select count(*)::int from shifts s where s.project_id = p.id and s.status = 'open') as n from projects p where name = $1", [name])).rows[0];
  expect(p).toEqual({ status: "staffing", n: 3 });
});

test("coordinators add shifts to their own projects but can't create projects or venues", async ({ page }) => {
  await signInAsTeam(page, "coordinator");
  await page.goto("/dashboard/staffing/new");
  await expect(page.getByRole("radio", { name: "New project" })).toHaveCount(0);
  await page.getByLabel("Project").selectOption({ label: "Cadbury Sampling Activation (DEMO-CAD-2611)" });
  await expect(page.getByLabel("Venue").locator("option", { hasText: "New venue" })).toHaveCount(0);
});
