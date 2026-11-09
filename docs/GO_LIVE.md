# Going live on crew.rgxmagency.com

This is the checklist for the **production** site. It's separate from the demo staging site
(`rgxm-staffing.vercel.app`), which keeps its demo data and public demo password. **Never put real people's details in staging,
and never load demo data into production.**

What you end up with:

| | Production |
|---|---|
| Address | `https://crew.rgxmagency.com` |
| Emails from | `RGXM Crew <staffing@rgxmagency.com>` |
| Database & files | A new Supabase project in **Canada (Central)** |
| App | A second Vercel project that deploys the `production` branch |
| Email provider | Resend, with `rgxmagency.com` verified |

Allow about 1–2 hours, plus waiting time for DNS. You need admin access to the rgxmagency.com domain in Squarespace,
and to the Supabase, Vercel and GitHub accounts.

---

## Step 1 — Email: verify rgxmagency.com in Resend (~20 min + DNS wait)

1. Create an account at **resend.com**, ideally with a shared RGXM address rather than a personal one.
2. **Domains → Add domain** → `rgxmagency.com`. Choose region **North America (us-east-1)**.
3. Resend shows the DNS records to add (as of November 2026: a **TXT** record named `resend._domainkey`, and two
   **CNAME** records named `send` and `rsend`). The list can differ between accounts. Always add exactly what
   *your* Resend page shows. Leave **Enable receiving** switched off. Keep that page open.
4. In **Squarespace**: *Domains → rgxmagency.com → DNS → DNS Settings → Custom records → Add record*. Add each record
   exactly as Resend shows it:
   - **Host:** enter only the part Resend shows under *Name* (`resend._domainkey`, `send`, `rsend`).
     Squarespace adds `.rgxmagency.com` itself.
   - **Type:** as shown (TXT or CNAME). **Data/Value:** copy it with Resend's copy button. The DKIM value is long, so
     don't retype it.
   - Leave TTL at Squarespace's default.
   - **Don't change or delete your existing records**, such as the MX records for your normal inbox. Resend's records
     only add new names, so existing email isn't affected.
5. Back in Resend, click **Verify DNS records**. It can take from a few minutes to a few hours. Wait for **Verified**.
6. **API Keys → Create API key**: name `rgxm-production`, permission **Sending access**, domain `rgxmagency.com`.
   Copy it (starts with `re_`). You'll paste it into Vercel and GitHub. Don't email it or put it in a document.
7. Make sure **staffing@rgxmagency.com** can receive replies. Create it as a mailbox, alias or group in your email provider
   (Google Workspace / Microsoft 365), or replies from staff will bounce.
8. Check Resend's plan limits (emails per day/month) against how many staff you'll invite at once. Upgrade if you'll exceed them.

## Step 2 — Database & file storage: a new Supabase project in Canada (~15 min)

1. Supabase → **New project**: name `rgxm-production`, region **Canada (Central)**, a strong database password
   (save it in your password manager).
2. Recommended: the **Pro** plan (daily backups, no pausing). Consider the **Point-in-Time Recovery** add-on.
   Payroll history lives here.
3. **Connect** button → **Session pooler** connection string (port **5432**). Replace `[YOUR-PASSWORD]`. This is
   `PRODUCTION_DATABASE_URL` for GitHub.
4. Same page → **Transaction pooler** string (port **6543**). This is `DATABASE_URL` for Vercel.
5. *Project Settings → Database → SSL configuration → Download certificate*. Open the file in a text editor and copy
   everything, including the `-----BEGIN CERTIFICATE-----` lines. This is the CA certificate for both GitHub and Vercel.
6. **Storage → New bucket** `rgxm-private`, **Public bucket: off**.
7. *Project Settings → API Keys*: copy the **Project URL** and a **secret** key (`sb_secret_…`). These are `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` for Vercel. The secret key gives full access; only ever paste it into Vercel.

## Step 3 — GitHub: the production environment & first administrator (~15 min)

1. Repository → **Settings → Environments → New environment** → `production`.
   Under **Deployment branches and tags**, choose *Selected branches* and add `main`. Leave **Required reviewers**
   off: the scheduled runner uses this environment every 5 minutes, and it would stop at each run to wait for approval.
2. In that environment, add **secrets**:
   - `PRODUCTION_DATABASE_URL` = the session pooler URL (step 2.3)
   - `PRODUCTION_DATABASE_CA_CERT` = the certificate text (step 2.5)
   - `PRODUCTION_RESEND_API_KEY` = the Resend key (step 1.6)
   - `PRODUCTION_CRON_SECRET` = a new random value. On a Mac terminal: `openssl rand -hex 32`. Keep it for step 4.
3. *Settings → Secrets and variables → Actions → **Variables*** tab → New repository variable:
   `PRODUCTION_URL` = `https://crew.rgxmagency.com` (no trailing slash).
4. Create the release branch: on the repository's main page, open the branch menu, type `production`, and choose
   **Create branch production from main**.
5. **Actions → Production database → Run workflow**. Enter your work email and full name in the two boxes, then run it.
   It applies the database structure and emails you **"Your RGXM Crew invitation"**. Wait until step 5 to click the
   link: it expires in 24 hours, and the site must be live first. If it expires, run the workflow again without the boxes
   filled in, then use **Forgot password** on the sign-in page.

## Step 4 — Vercel: the production app (~20 min)

1. Vercel → **Add New → Project** → import the same GitHub repository again, and name it `rgxm-crew`. Don't change
   the staging project.
2. Before the first deploy, add these **Environment Variables** (Production environment):

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase **transaction** pooler URL (port 6543) |
| `DATABASE_CA_CERT` | the certificate text |
| `APP_URL` | `https://crew.rgxmagency.com` |
| `BETTER_AUTH_SECRET` | a new value from `openssl rand -base64 48` (**not** the staging one) |
| `MAIL_TRANSPORT` | `resend` |
| `RESEND_API_KEY` | the Resend key |
| `MAIL_FROM` | `RGXM Crew <staffing@rgxmagency.com>` |
| `STORAGE_DRIVER` | `supabase` |
| `SUPABASE_URL` | the Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the `sb_secret_…` key |
| `SUPABASE_STORAGE_BUCKET` | `rgxm-private` |
| `CRON_SECRET` | the same value as `PRODUCTION_CRON_SECRET` |
| `AUTH_IP_HEADERS` | `x-vercel-forwarded-for` |
| `AUTH_RATE_LIMIT` | `on` |

   Do **not** set `ALLOW_LOG_MAIL_IN_PRODUCTION` here.
3. Deploy. Then set the production branch to `production`: *Settings → Environments → Production → Branch Tracking* (older layout: *Settings → Git → Production Branch*), and redeploy from the
   **Deployments** tab. From now on, merging into `main` updates staging only, and production changes only when you release (step 7).
4. *Settings → Functions → Function Region*: choose the region closest to Canada (Central) that Vercel offers
   (Washington, D.C. `iad1` if there's no Canadian option). Data is stored in Canada either way. Mention to your privacy
   reviewer that requests are processed by Vercel in that region.
5. Plan: Vercel's free Hobby plan is for non-commercial use, so a business site should be on **Pro**.

## Step 5 — Domain: point crew.rgxmagency.com at Vercel (~10 min + DNS wait)

1. Vercel project → *Settings → Domains → Add* → `crew.rgxmagency.com`. Vercel shows a **CNAME** record to add.
2. Squarespace → *Domains → rgxmagency.com → DNS → Custom records → Add record*:
   **Type** CNAME, **Host** `crew`, **Data/Value** the target Vercel shows (e.g. `cname.vercel-dns.com` or a project-specific one).
3. Wait for Vercel to show **Valid Configuration**. Vercel issues the HTTPS certificate automatically.
4. Your main website at rgxmagency.com is unaffected.

## Step 6 — First sign-in & checks (~30 min)

1. Open the invitation email from step 3.5 → set a password → set up two-step verification (required for administrators).
2. *Settings → Organisation*: check the company name, time zone, overtime and break rules.
3. *Settings → Team & roles*: invite the team. **Talent → Import** your roster, or add people one by one.
4. Do these checks before inviting real staff:
   - [ ] `https://crew.rgxmagency.com/api/health` shows `{"status":"ok"}`.
   - [ ] Invite **yourself** as a staff member (use a personal email) with *Talent → person → Send portal invite*.
     The email arrives from staffing@rgxmagency.com, is **not in spam**, and the link opens profile set-up on your phone.
   - [ ] *Settings → Mail log* shows that email as **sent**, with `[link redacted]`.
   - [ ] Upload a brief to a test project and download it as that staff member.
   - [ ] **Actions → Production scheduled runner** shows green runs every few minutes.
   - [ ] A restore drill has been done and recorded (DEPLOYMENT.md §7).
   - [ ] The items under "Before using real data" in SECURITY.md are complete. In particular, the privacy notice
     has been reviewed by a lawyer, and the pay rules and export format have been signed off by your accountant.
5. Archive or delete your test project and test staff profile.
6. Then invite your crew: **Talent**, tick people, then **Send portal invite**. Start with a small pilot group for the first event.

## Step 7 — Releasing updates later

New work is merged into `main` and appears on staging first. To release it to production:

1. If the change includes a database migration (a new file in `src/server/db/migrations`), run
   **Actions → Production database** with the boxes empty **first**. Migrations are written to work with the
   previous version of the app.
2. GitHub → **Pull requests → New** → base `production` ← compare `main` → create and merge.
   Vercel deploys it to crew.rgxmagency.com.
3. To undo a bad release, use Vercel → Deployments → the previous production deployment → **Promote** (instant rollback).

## Releasing the contractor-compliance update (migration 0012)

This release changes day-to-day work, so plan it with the team. Full details are in docs/COMPLIANCE.md.

**Before merging the release PR:**

1. Run **Actions → Production database** (boxes empty). It applies `0012_compliance_foundation`. The migration
   only adds things and doesn't change any amount; the current app keeps working with it.
2. Tell everyone at RGXM that they'll be asked to set up two-step verification on their next visit. This now
   applies to every staff account, not only Admin and Finance.

**Straight after release:**

0. **Publish RGXM's documents.** Migration 0013 loads the Privacy Policy, Independent Contractor Agreement and
   Platform Terms of Use (source: `docs/legal/`) as drafts, and fills in the Privacy Officer, contact emails and
   30-day privacy response period from them. In **Settings → Contractors & legal**:
   - approve each of the three documents, recording who approved it;
   - confirm the payment terms ("Contractor Agreement §4" rule) with an approval reference;
   - in **Privacy & retention**, approve the 90-day location and 30-day email periods with the reference
     "Privacy Policy, effective Nov 9, 2026".

   From the moment a document is approved, contractors must accept it (at sign-up, or on the *My agreements*
   page) before they can be confirmed for new shifts. Publish when you're ready for that.

1. **Contractor approvals.** Bookings can't be confirmed for people without a recorded contractor-process
   approval. In Talent, select the current contractors and use **Record contractor approval** (approval date,
   plus the reference to the assessment you did). If you need a few days to do this, an Admin can temporarily
   switch off *Require RGXM contractor approval* in Settings → Contractors & legal.
2. **GST/HST answers.** New pay lines for anyone whose answer isn't verified by Finance go to **Finance tax
   review**, and those lines can't be batched until Finance decides. Two ways to clear them:
   - ask contractors to answer the GST/HST question in the portal, then verify each answer on their Talent page;
   - or decide individual lines under Payments → *Needs Finance tax review*.

   Pay lines approved before the release keep their old amounts and can still be batched.
3. **Bank files and accounting files are now separate.** Batches produce the bank file. QuickBooks bills come
   from Payments → **Accounting**. Record the bank submission and each payment's outcome, with bank evidence;
   exporting a file no longer counts as paid.
