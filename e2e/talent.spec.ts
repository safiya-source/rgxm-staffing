import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { pool, signInAsTeam } from "./helpers";


test("coordinator finds available Toronto BAs and saves them to a list", async ({ page }) => {
  await signInAsTeam(page, "coordinator");
  await page.goto("/dashboard/talent?role=BA&city=Toronto&availableOn=2026-11-14&noConflicts=1");
  await expect(page.getByRole("heading", { name: "Talent" })).toBeVisible();
  const rows = page.getByRole("row");
  expect(await rows.count()).toBeGreaterThan(5);

  // Coordinators can see rates but not edit them.
  await expect(page.getByRole("columnheader", { name: "Rates" })).toBeVisible();

  await page.getByRole("checkbox", { name: "Select all on this page" }).click();
  await page.getByLabel("Choose list").selectOption({ label: "Toronto Preferred BAs" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/Added \d+ (person|people)|Already on that list/)).toBeVisible();
});

test("search narrows results as you type", async ({ page }) => {
  await signInAsTeam(page, "coordinator");
  await page.goto("/dashboard/talent");
  await page.getByLabel("Search staff").fill("Priya");
  await expect(page).toHaveURL(/q=Priya/);
  await expect(page.getByRole("link", { name: "Priya Shah" })).toBeVisible();
  await page.getByRole("link", { name: "Priya Shah" }).click();
  await expect(page.getByRole("heading", { name: /Priya Shah/ })).toBeVisible();
  await expect(page.getByText("Usually available")).toBeVisible();
});

test("finance sets a new rate and the old one moves to history", async ({ page }) => {
  await signInAsTeam(page, "finance");
  await page.goto("/dashboard/talent?q=Jordan%20Lee");
  await page.getByRole("link", { name: "Jordan Lee" }).click();
  await page.getByRole("button", { name: "Set rate" }).click();
  await page.getByLabel("Hourly rate (CAD)").fill("26.75");
  await page.getByLabel("Reason (optional)").fill("E2E review");
  await page.getByRole("button", { name: "Save rate" }).click();
  await expect(page.getByText("$26.75/hr")).toBeVisible();
  await page.getByRole("button", { name: /History/ }).click();
  await expect(page.getByText(/BA \$\d+\.\d{2} ·/).first()).toBeVisible();
});

test("admin imports staff from CSV with a preview first", async ({ page }, info) => {
  const tag = Date.now();
  const file = info.outputPath("import.csv");
  writeFileSync(
    file,
    `first_name,last_name,email,city,roles,ba_rate\nCsv,Person${tag},csv.${tag}@rgxm-demo.test,Toronto,BA,24\nBad,Row,not-an-email,Toronto,BA,\n`,
  );
  await signInAsTeam(page, "admin");
  await page.goto("/dashboard/talent/import");
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText("1 new · 0 updates · 1 with errors (skipped)")).toBeVisible();
  await expect(page.getByText("Nothing has been saved yet.")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 rows" }).click();
  await expect(page.getByText("Imported: 1 new, 0 updated, 1 skipped with errors.")).toBeVisible();
  const { rows } = await pool.query("select count(*)::int n from staff_profiles where email = $1", [`csv.${tag}@rgxm-demo.test`]);
  expect(rows[0].n).toBe(1);
});

test("CSV export is limited to talent exporters and includes rates for them", async ({ page }) => {
  await signInAsTeam(page, "finance");
  const res = await page.request.get("/dashboard/talent/export?role=TL");
  expect(res.status()).toBe(403); // finance can view talent but not export it

  await page.context().clearCookies();
  await signInAsTeam(page, "coordinator");
  const csv = await (await page.request.get("/dashboard/talent/export?role=TL")).text();
  expect(csv.split("\n")[0]).toContain("ba_rate");
  expect(csv).toContain("Priya");
});
