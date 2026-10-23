import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, latestLinkFor, pool, signInAsTeam } from "./helpers";


test("unauthenticated visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/sign-in/);
});

const personas = [
  { who: "admin", sees: ["Projects", "Talent", "Staffing Requests", "Timesheets", "Payments", "Reports"], hidden: [] },
  { who: "pm", sees: ["Projects", "Talent", "Staffing Requests", "Timesheets", "Payments"], hidden: [] },
  { who: "coordinator", sees: ["Projects", "Talent", "Staffing Requests", "Timesheets"], hidden: ["Payments"] },
  { who: "finance", sees: ["Projects", "Talent", "Timesheets", "Payments"], hidden: ["Staffing Requests"] },
] as const;

for (const p of personas) {
  test(`${p.who} signs in and sees the right navigation`, async ({ page }) => {
    await signInAsTeam(page, p.who);
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const label of p.sees) await expect(nav.getByRole("link", { name: label })).toBeVisible();
    for (const label of p.hidden) await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
  });
}

test("finance cannot open user management", async ({ page }) => {
  await signInAsTeam(page, "finance");
  await page.goto("/dashboard/settings/users");
  await expect(page).toHaveURL(/denied=1/);
  await expect(page.getByText("You don't have access to that page.")).toBeVisible();
});

test("wrong password is rejected", async ({ page }) => {
  await page.goto("/sign-in?tab=team");
  await page.getByLabel("Work email").fill("admin@rgxm-demo.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});

test("internal accounts never receive magic links", async ({ page }) => {
  const since = new Date();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("pm@rgxm-demo.test");
  await page.getByRole("button", { name: /sign-in link/i }).click();
  await expect(page).toHaveURL(/check-email/);
  await expect(latestLinkFor("pm@rgxm-demo.test", since)).rejects.toThrow();
});

test("admin invites a team member and the invitation is recorded", async ({ page }) => {
  const email = `new.pm.${Date.now()}@rgxm-demo.test`;
  await signInAsTeam(page, "admin");
  await page.goto("/dashboard/settings/users");
  await page.getByRole("button", { name: "Invite team member" }).click();
  await page.getByLabel("Full name").fill("Robin Okoro");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("checkbox", { name: /Project Manager/ }).click();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(email.replace(/\./g, "\\.")) }).getByText("Invited")).toBeVisible();

  await page.goto("/dashboard/settings/mail-log");
  await expect(page.getByText(`to ${email}`)).toBeVisible();
});

test("a deactivated team member can no longer sign in", async ({ page }) => {
  await pool.query("update users set status = 'inactive' where email = 'ops@rgxm-demo.test'");
  try {
    await page.goto("/sign-in?tab=team");
    await page.getByLabel("Work email").fill("ops@rgxm-demo.test");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);
  } finally {
    await pool.query("update users set status = 'active' where email = 'ops@rgxm-demo.test'");
  }
});
