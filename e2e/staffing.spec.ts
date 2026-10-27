import { devices, expect, test } from "@playwright/test";
import { pool, signInAsTeam, signInWithMagicLink } from "./helpers";

// One shared scenario: steps 3–9 of the acceptance test on the seeded Cadbury project.
test.describe.configure({ mode: "serial" });

test("offer → interest → question → confirmation → brief acknowledgement", async ({ browser }) => {
  test.setTimeout(180_000);
  const [{ rows: project }] = [await pool.query("select id from projects where code = 'DEMO-CAD-2611'")];
  const projectId = project[0].id as string;
  // Start clean for Jordan Lee (ba.demo) on this project so the test can be re-run.
  const staff = (await pool.query("select id from staff_profiles where email = 'ba.demo@rgxm-demo.test'")).rows[0].id as string;
  await pool.query(
    "update bookings set status = 'cancelled', cancel_reason = 'E2E reset' where staff_id = $1 and project_id = $2 and status not in ('cancelled', 'declined')",
    [staff, projectId],
  );
  await pool.query("update documents set archived_at = now() where project_id = $1 and title = 'Cadbury event brief' and archived_at is null", [projectId]);

  // 1. Coordinator sends BA offers for all four days to Jordan.
  const rgxm = await (await browser.newContext()).newPage();
  await signInAsTeam(rgxm, "coordinator");
  await rgxm.goto(`/dashboard/staffing/${projectId}`);
  await rgxm.getByRole("link", { name: /^Brand Ambassador · Toronto Eaton Centre/ }).click();
  await expect(rgxm.getByRole("heading", { name: /Brand Ambassador · Toronto Eaton Centre/ })).toBeVisible();
  await rgxm.getByRole("button", { name: "Send offers" }).click();
  await rgxm.getByLabel("Filter candidates by name").fill("Jordan");
  await rgxm.getByRole("checkbox", { name: "Select Jordan Lee" }).click();
  await rgxm.getByRole("button", { name: /Send 4 offers to 1 person/ }).click();
  await expect(rgxm.getByText("Sent 4 offers to 1 person.")).toBeVisible();
  await expect(rgxm.getByRole("button", { name: /Jordan Lee, .*: Offered/ }).first()).toBeVisible();

  // An offer email was recorded (suppressed: demo address).
  await expect
    .poll(async () => (await pool.query("select count(*)::int n from notification_deliveries where to_address = 'ba.demo@rgxm-demo.test' and subject like '%shift offers%'")).rows[0].n)
    .toBeGreaterThan(0);

  // 2. Jordan responds on mobile: a question on one shift, interest in the rest.
  const staffCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const ba = await staffCtx.newPage();
  await signInWithMagicLink(ba, "ba.demo@rgxm-demo.test");
  await ba.goto("/portal/opportunities");
  await expect(ba.getByText("Cadbury Sampling Activation")).toBeVisible();
  await ba.getByRole("button", { name: "Need more info?" }).first().click();
  await ba.getByLabel("Your question").fill("Is there a place to store my bag?");
  await ba.getByRole("button", { name: "Send question" }).click();
  await expect(ba.getByText("Your question was sent to the RGXM team.")).toBeVisible();
  await ba.getByRole("button", { name: "I'm interested in all 4" }).click();
  await expect(ba.getByText(/Interested in 4 shifts/)).toBeVisible();
  await expect(ba.getByText("Interested · waiting for RGXM").first()).toBeVisible();

  // 3. Coordinator answers the question and confirms Jordan for all four days.
  await rgxm.goto(`/dashboard/staffing/${projectId}`);
  await rgxm.getByRole("link", { name: /Jordan Lee/ }).filter({ hasText: "store my bag" }).click();
  await rgxm.getByLabel("Reply").fill("Yes, there's a locked staff room on Level 1.");
  await rgxm.getByRole("button", { name: "Send reply" }).click();
  await expect(rgxm.getByLabel("Reply")).toHaveValue("");
  await expect(rgxm.getByRole("list").getByText("locked staff room").last()).toBeVisible();

  await rgxm.getByRole("checkbox", { name: "Select Jordan Lee" }).click();
  await rgxm.getByRole("button", { name: /Confirm 4 responses/ }).click();
  await expect(rgxm.getByText("Confirmed 4.")).toBeVisible();
  await expect(rgxm.getByRole("button", { name: /Jordan Lee, .*: Confirmed/ })).toHaveCount(4);
  const agreed = await pool.query("select distinct agreed_rate_cents from bookings where staff_id = $1 and project_id = $2 and status = 'confirmed'", [staff, projectId]);
  expect(agreed.rows).toEqual([{ agreed_rate_cents: 2500 }]);

  // 4. PM uploads a brief that requires acknowledgement.
  const pm = await (await browser.newContext()).newPage();
  await signInAsTeam(pm, "pm");
  await pm.goto(`/dashboard/projects/${projectId}/comms`);
  await pm.getByLabel("Title", { exact: true }).first().fill("Cadbury event brief");
  await pm.getByLabel("File").setInputFiles({ name: "brief.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% Cadbury brief\n") });
  await pm.getByRole("button", { name: "Upload" }).click();
  await expect(pm.getByText("Document uploaded.")).toBeVisible();
  await expect(pm.getByText(/0\/\d+ confirmed reading/)).toBeVisible();

  // 5. Jordan sees the booking, reads the reply, and acknowledges the brief.
  await ba.goto("/portal/schedule");
  await expect(ba.getByText("Briefs to review")).toBeVisible();
  await ba.getByRole("link", { name: /Cadbury event brief/ }).click();
  await ba.getByRole("checkbox", { name: /read and understood/ }).click();
  await ba.getByRole("button", { name: "Confirm" }).click();
  await expect(ba.getByText(/You confirmed you reviewed this/)).toBeVisible();

  await ba.goto("/portal/messages");
  await ba.getByRole("link", { name: /Cadbury Sampling Activation/ }).click();
  await expect(ba.getByText("locked staff room").last()).toBeVisible();

  await ba.goto("/portal/schedule");
  await ba.getByRole("link", { name: /Cadbury Sampling Activation · Brand Ambassador/ }).first().click();
  await expect(ba.getByText("Agreed rate")).toBeVisible();
  await expect(ba.getByText("$25.00/hour")).toBeVisible();
  await expect(ba.getByText("Reviewed")).toBeVisible();
  // Long addresses must wrap rather than make the page scroll sideways on phones.
  const [scrollWidth, clientWidth] = await ba.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  await pm.reload();
  await expect(pm.getByText(/1\/\d+ confirmed reading/)).toBeVisible();
});

test("finance cannot send offers", async ({ page }) => {
  await signInAsTeam(page, "finance");
  await page.goto("/dashboard/staffing");
  await expect(page).toHaveURL(/denied=1/);
});
