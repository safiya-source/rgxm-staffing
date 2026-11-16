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

test("Send offers on the Staffing Requests list opens the offer form for that project", async ({ page }) => {
  await signInAsTeam(page, "coordinator");
  await page.goto("/dashboard/staffing");
  await page.getByRole("link", { name: /^Send offers for Cadbury/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/staffing\/[0-9a-f-]{36}\?offer=1$/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/^Send offers · /)).toBeVisible();
});

test("Book directly confirms someone straight away, without an offer", async ({ page }) => {
  const projectId = (await pool.query("select id from projects where code = 'DEMO-CAD-2611'")).rows[0].id as string;
  // An active, approved Brand Ambassador with no booking on this project yet.
  const { rows } = await pool.query(
    `select p.id, p.first_name || ' ' || p.last_name as name from staff_profiles p
       join staff_roles r on r.staff_id = p.id and r.role = 'BA'
      where p.status = 'active' and p.is_demo and p.email <> 'ba.demo@rgxm-demo.test'
        and exists (select 1 from contractor_approvals a where a.staff_id = p.id and a.revoked_at is null)
        and not exists (select 1 from bookings b where b.staff_id = p.id and b.project_id = $1 and b.status not in ('cancelled', 'declined'))
      order by p.last_name limit 1`,
    [projectId],
  );
  const who = rows[0] as { id: string; name: string };

  await signInAsTeam(page, "coordinator");
  await page.goto(`/dashboard/staffing/${projectId}`);
  await page.getByRole("link", { name: /^Brand Ambassador · Toronto Eaton Centre/ }).click();
  await page.getByRole("button", { name: "Book directly" }).click();
  await expect(page.getByRole("dialog").getByText(/already agreed this with/)).toBeVisible();
  // Only the first shift, so the count is predictable.
  const shiftBoxes = page.getByRole("dialog").locator("fieldset").first().getByRole("checkbox");
  const n = await shiftBoxes.count();
  for (let i = 1; i < n; i++) if (await shiftBoxes.nth(i).isChecked()) await shiftBoxes.nth(i).click();
  await page.getByLabel("Filter candidates by name").fill(who.name.split(" ")[0]!);
  await page.getByRole("checkbox", { name: `Select ${who.name}` }).click();
  await page.getByLabel("How was it agreed?").selectOption("in_person");
  await page.getByLabel("Note (optional)").fill("Walked in this morning");
  await page.getByRole("button", { name: /^Book 1 shift for 1 person$/ }).click();
  await expect(page.getByText(/Booked 1 shift for 1 person/)).toBeVisible();

  const b = (await pool.query("select status, (select reason from booking_status_history h where h.booking_id = b.id) reason from bookings b where staff_id = $1 and project_id = $2", [who.id, projectId])).rows;
  expect(b).toEqual([{ status: "confirmed", reason: "Booked directly: agreed in person (Walked in this morning)" }]);
});
