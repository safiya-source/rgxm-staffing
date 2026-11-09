// Every new compliance, tax, payments and privacy screen renders for the role that uses it.
import { expect, test } from "@playwright/test";
import { pool, signInAsTeam, signInWithMagicLink } from "./helpers";

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
  // Unpublished documents say so (no dead links); the old portal URL forwards to the public page.
  await page.goto("/portal/terms");
  await expect(page).toHaveURL(/\/contractor-agreement$/);
  await expect(page.getByText(/hasn't published this document yet/)).toBeVisible();
});

test("coordinators can't open finance, legal or privacy screens", async ({ page }) => {
  await signInAsTeam(page, "coordinator");
  for (const path of ["/dashboard/settings/tax", "/dashboard/privacy", "/dashboard/incidents", "/dashboard/reports/finance"]) {
    await page.goto(path);
    await expect(page, path).not.toHaveURL(new RegExp(`${path}$`));
  }
});

test("once RGXM publishes its documents, a contractor accepts each one and keeps a copy", async ({ page }) => {
  test.setTimeout(120_000);
  // An admin approving the drafts loaded from docs/legal (done here directly for speed).
  const admin = (await pool.query("select id from users where email = 'admin@rgxm-demo.test'")).rows[0].id;
  await pool.query("update legal_documents set status = 'approved', approved_by = $1, approved_at = now(), effective_at = now(), approval_reference = 'e2e' where version in ('2026-11-09', '1.0.0') and status = 'draft'", [admin]);
  try {
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "RGXM Crew Platform Terms of Use" })).toBeVisible();
    await expect(page.getByRole("link", { name: "staffing@rgxmagency.com" }).first()).toBeVisible();
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "RGXM Crew Privacy Policy" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "7. How long we keep information" })).toBeVisible();

    await signInWithMagicLink(page, "ba.demo@rgxm-demo.test");
    await page.goto("/portal");
    await page.getByRole("link", { name: /review/i }).first().click();
    await expect(page).toHaveURL(/\/portal\/agreements/);
    await page.getByLabel("A business I'm authorized to sign for").check();
    await page.getByLabel("Business legal name").fill("Jordan Lee Events Inc.");
    await page.getByLabel(/authorized representative/).fill("Jordan Lee");
    await page.getByLabel(/I've read the RGXM Crew Privacy Policy/).check();
    await page.getByLabel(/I accept the RGXM Independent Contractor Agreement/).check();
    await page.getByLabel(/I agree to the Platform Terms of Use/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Thanks. That's recorded.")).toBeVisible();
    await page.getByRole("link", { name: /Independent Contractor Agreement.*View copy/ }).click();
    await expect(page).toHaveURL(/\/portal\/agreements\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Acceptance record" })).toBeVisible();
    await expect(page.getByText("Jordan Lee Events Inc.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Print or save a copy" })).toBeVisible();
    const rows = (await pool.query("select a.kind, a.acting_for, a.contracting_party, a.authorized_representative from staff_acceptances a join staff_profiles s on s.id = a.staff_id where s.email = 'ba.demo@rgxm-demo.test' order by a.kind")).rows;
    expect(rows).toEqual([
      { kind: "contractor_terms", acting_for: "business", contracting_party: "Jordan Lee Events Inc.", authorized_representative: "Jordan Lee" },
      { kind: "platform_terms", acting_for: null, contracting_party: null, authorized_representative: null },
      { kind: "privacy_notice", acting_for: null, contracting_party: null, authorized_representative: null },
    ]);
  } finally {
    // Other suites confirm bookings for people who haven't accepted; retire the e2e approvals.
    await pool.query("update legal_documents set status = 'retired' where approval_reference = 'e2e'");
  }
});
