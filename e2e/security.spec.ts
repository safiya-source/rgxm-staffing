import { devices, expect, test } from "@playwright/test";
import { pool, signInAsTeam, signInWithMagicLink } from "./helpers";

// M6 hardening checks that only make sense in a real browser/server.
test.describe.configure({ mode: "serial" });

test("pages get a per-request nonce CSP and still work with it", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (execute|load)/i.test(m.text())) violations.push(m.text());
  });
  const first = await page.goto("/sign-in");
  const csp = first!.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  const second = await page.goto("/sign-in");
  expect(second!.headers()["content-security-policy"]).not.toBe(csp); // fresh nonce each request

  // The app hydrates and runs under the policy: sign in and use an interactive screen.
  await signInAsTeam(page, "coordinator");
  await page.goto("/dashboard/talent");
  await page.getByLabel(/Search/i).first().fill("Jordan");
  await expect(page.getByRole("link", { name: /Jordan Lee/ }).first()).toBeVisible();
  expect(violations).toEqual([]);
});

test("health check reports the database without revealing anything else", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("admins and Finance must set up two-step verification when required", async ({ browser }) => {
  await pool.query("update org_settings set require_mfa_for_privileged = true where id = 1");
  try {
    const fin = await (await browser.newContext()).newPage();
    await fin.goto("/sign-in?tab=team");
    await fin.getByLabel("Work email").fill("finance@rgxm-demo.test");
    await fin.getByLabel("Password").fill(process.env.DEMO_PASSWORD ?? "rgxm-demo-password");
    await fin.getByRole("button", { name: "Sign in" }).click();
    // Signing in lands on the dashboard, which sends them straight to set up two-step verification.
    await expect(fin).toHaveURL(/\/dashboard\/settings\/security\?required=1/);
    await fin.goto("/dashboard/payments");
    await expect(fin).toHaveURL(/\/dashboard\/settings\/security\?required=1/);
    await expect(fin.getByRole("alert").filter({ hasText: "two-step verification is required" })).toBeVisible();
    // Downloads apply the same rule.
    const exp = await pool.query("select id from payment_exports limit 1");
    if (exp.rows[0]) expect((await fin.request.get(`/api/payments/exports/${exp.rows[0].id}`)).status()).toBe(404);

    // Roles without money or access powers aren't affected.
    const coord = await (await browser.newContext()).newPage();
    await signInAsTeam(coord, "coordinator");
    await coord.goto("/dashboard/talent");
    await expect(coord).toHaveURL(/\/dashboard\/talent/);
  } finally {
    await pool.query("update org_settings set require_mfa_for_privileged = false where id = 1");
  }
});

test("staff can download their own data", async ({ browser }) => {
  const page = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await signInWithMagicLink(page, "ba.demo@rgxm-demo.test");
  await page.goto("/portal/profile");
  await expect(page.getByRole("link", { name: "Download a copy of my data" })).toBeVisible();
  const res = await page.request.get("/api/me/data");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain("my-rgxm-data.json");
  const data = await res.json();
  expect(data.profile.email).toBe("ba.demo@rgxm-demo.test");
  expect(Array.isArray(data.bookings)).toBe(true);
  // Another person's export isn't reachable from the staff portal.
  const other = (await pool.query("select id from staff_profiles where email = 'tl.demo@rgxm-demo.test'")).rows[0].id;
  expect((await page.request.get(`/api/staff/${other}/data`)).status()).toBe(404);
});
