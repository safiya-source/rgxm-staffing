// Every new compliance, tax, payments and privacy screen renders for the role that uses it.
import { expect, test } from "@playwright/test";
import { pool, signInAsTeam, signInWithMagicLink } from "./helpers";

test.afterAll(async () => {
  await pool.end();
});

async function visit(page: import("@playwright/test").Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBeLessThan(400);
  await expect(page.getByRole("heading").first(), path).toBeVisible();
  await expect(page.getByText(/Something went wrong/i), path).toHaveCount(0);
}

test("admin screens for contractors, tax, privacy and incidents render", async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsTeam(page, "admin");
  for (const path of ["/dashboard/settings/compliance", "/dashboard/settings/tax", "/dashboard/settings/privacy", "/dashboard/privacy", "/dashboard/incidents"]) {
    await visit(page, path);
  }
  const staffId = (await pool.query("select id from staff_profiles where email = 'ba.demo@rgxm-demo.test'")).rows[0].id;
  await visit(page, `/dashboard/talent/${staffId}`);
  await expect(page.getByText(/Onboarding & compliance/).first()).toBeVisible();
  // No terms approved yet: the terms page isn't available to contractors.
  const projectId = (await pool.query("select id from projects where code = 'DEMO-ORE-2610'")).rows[0].id;
  await visit(page, `/dashboard/projects/${projectId}/compensation`);
  await visit(page, `/dashboard/projects/${projectId}/setup`);
});

test("finance screens render", async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsTeam(page, "finance");
  for (const path of ["/dashboard/payments", "/dashboard/payments/bills", "/dashboard/payments/accounting", "/dashboard/payments/reviews", "/dashboard/payments/t4a", "/dashboard/reports/finance"]) {
    await visit(page, path);
  }
});

test("contractor portal shows pay breakdown, terms and preferences", async ({ page }) => {
  await signInWithMagicLink(page, "ba.demo@rgxm-demo.test");
  for (const path of ["/portal/payments", "/portal/profile", "/portal/profile/tax", "/privacy"]) {
    await visit(page, path);
  }
  await expect(page.getByText(/Privacy Officer/).first()).toBeVisible();
  expect((await page.goto("/portal/terms"))?.status()).toBe(404);
});

test("coordinators can't open finance, legal or privacy screens", async ({ page }) => {
  await signInAsTeam(page, "coordinator");
  for (const path of ["/dashboard/settings/tax", "/dashboard/privacy", "/dashboard/incidents", "/dashboard/reports/finance"]) {
    await page.goto(path);
    await expect(page, path).not.toHaveURL(new RegExp(`${path}$`));
  }
});
