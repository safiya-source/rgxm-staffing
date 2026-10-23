import { expect, type Page } from "@playwright/test";
import "dotenv/config";
import { Pool } from "pg";

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "rgxm-demo-password";
// Shared by every spec in the worker; allowExitOnIdle lets the worker exit without an explicit end().
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, allowExitOnIdle: true });

export async function signInAsTeam(page: Page, who: string) {
  await page.goto("/sign-in?tab=team");
  await page.getByLabel("Work email").fill(`${who}@rgxm-demo.test`);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Reads the newest sign-in link captured by the mail log (MAIL_TRANSPORT=log / demo suppression). */
export async function latestLinkFor(email: string, since: Date): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query<{ body_text: string }>(
      "select body_text from notification_deliveries where lower(to_address) = lower($1) and created_at >= $2 order by created_at desc limit 1",
      [email, since],
    );
    const match = rows[0]?.body_text.match(/https?:\/\/\S+/);
    if (match) return match[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No link emailed to ${email}`);
}

export async function signInWithMagicLink(page: Page, email: string) {
  const since = new Date(Date.now() - 1000);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /sign-in link/i }).click();
  await expect(page).toHaveURL(/check-email/);
  await page.goto(await latestLinkFor(email, since));
}
