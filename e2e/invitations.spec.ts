import { expect, test } from "@playwright/test";
import { latestLinkFor, pool, signInAsTeam } from "./helpers";

test("an invited person sets up their profile from the email link", async ({ page, browser }) => {
  const email = `invitee.${Date.now()}@example.test`;
  const { rows } = await pool.query<{ id: string }>(
    "insert into staff_profiles (first_name, last_name, email, city) values ('Ivy', 'Invitee', $1, 'Toronto') returning id",
    [email],
  );
  const staffId = rows[0]!.id;
  const since = new Date(Date.now() - 1000);

  await signInAsTeam(page, "coordinator");
  await page.goto(`/dashboard/talent/${staffId}`);
  await expect(page.getByText("Not invited to the portal yet")).toBeVisible();
  await page.getByRole("button", { name: "Send portal invite" }).click();
  await expect(page.getByText("Invitation sent to 1 person.")).toBeVisible();

  const link = await latestLinkFor(email, since);
  expect(link).toMatch(/\/invite\?token=/);
  await page.reload();
  await expect(page.getByText(/Invited \w+ \d+ · hasn't accepted yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend invite" })).toBeVisible();

  // The invitee opens the link on their own device.
  const ctx = await browser.newContext();
  const phone = await ctx.newPage();
  await phone.goto(link);
  await expect(phone.getByRole("heading", { name: /invited to work with RGXM/ })).toBeVisible();
  await phone.getByRole("button", { name: "Set up my profile" }).click();
  await expect(phone).toHaveURL(/\/portal\/onboarding/);

  // The link only works once.
  const other = await (await browser.newContext()).newPage();
  await other.goto(link);
  await other.getByRole("button", { name: "Set up my profile" }).click();
  await expect(other.getByText("This invitation has expired or was already used.")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Uses the staff portal")).toBeVisible();
  await ctx.close();
});
