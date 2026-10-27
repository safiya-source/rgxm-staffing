# Deployment

The recommended setup (plan §12, decision 5) is **Supabase Postgres + private Storage in `ca-central-1`**
for data, and **Vercel** for the app. Any host that runs a Node 22 Next.js server and Postgres 16 works.

> **Status:** the app has been built and tested against local Postgres 16, local file storage and the "log"
> mail transport. The Supabase Storage adapter, the Resend adapter and a Vercel deployment have **not** been
> exercised yet. Do the first deployment to a staging environment and run the checks at the end of this guide
> before production.

## 1. Database (Supabase)

1. Create a Supabase project in **Canada (Central)**. On a paid plan, enable **Point-in-Time Recovery**.
2. Note two connection strings (the **Connect** button → Connection string):
   - **Session pooler** (port 5432; works over IPv4), used to run migrations.
   - **Transaction pooler** (port 6543), used by the app (`DATABASE_URL`). Many short-lived serverless functions need the pooler.
3. Download Supabase's SSL certificate (Project Settings → Database → SSL configuration) and set its contents
   as `DATABASE_CA_CERT`. The app then verifies the database server against it. Without it, the Postgres driver
   rejects Supabase's certificate, because it treats `sslmode=require` as full verification.
4. Run migrations with the session-pooler URL. Either use the **Staging database** GitHub Action
   (Actions tab; uses the `STAGING_DATABASE_URL` and `STAGING_DATABASE_CA_CERT` secrets), or run locally:
   ```bash
   DATABASE_URL="postgres://…:5432/postgres" DATABASE_CA_CERT="$(cat prod-ca.crt)" npm run db:migrate
   ```
   Migrations are plain SQL in `src/server/db/migrations` and are safe to re-run (already-applied ones are skipped).
   They enable row-level security on every table and revoke access for Supabase's `anon`/`authenticated` roles. The
   app connects as the database owner.
5. **Never run `npm run db:seed` against production.** It creates demo accounts with a shared password and
   turns off the two-step verification requirement.

## 2. File storage (Supabase Storage)

Create a **private** bucket (default name `rgxm-private`). Set `STORAGE_DRIVER=supabase`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET`. The service-role key is used server-side only. Files are
never public; downloads go through authenticated routes.

## 3. Email (Resend)

Verify a sending domain (e.g. `staffing@rgxm.ca`) in Resend, with SPF and DKIM. Set:
- `MAIL_TRANSPORT=resend`
- `RESEND_API_KEY`
- `MAIL_FROM="RGXM Staffing <staffing@rgxm.ca>"`

`MAIL_TRANSPORT=log` is refused in production unless `ALLOW_LOG_MAIL_IN_PRODUCTION=on`. Use that **only** for a
demo/staging site, because the Mail log then holds working sign-in links.

## 4. App (Vercel)

1. Import the GitHub repository. Framework: Next.js. Node 22.
2. Pick a function region close to the database.
3. Set environment variables (Production and Preview separately):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase transaction-pooler URL (port 6543) |
| `DATABASE_CA_CERT` | Supabase's SSL certificate (paste the PEM text) |
| `APP_URL` | `https://staffing.rgxm.ca` (the public URL; used for links and cookie security) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` (different per environment; rotating it signs everyone out) |
| `MAIL_TRANSPORT`, `RESEND_API_KEY`, `MAIL_FROM` | see above |
| `STORAGE_DRIVER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | see above |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `AUTH_IP_HEADERS` | `x-vercel-forwarded-for` on Vercel (`x-real-ip` behind nginx, `cf-connecting-ip` behind Cloudflare) |
| `AUTH_RATE_LIMIT` | `on` (`off` is refused in production) |

4. Deploy. The build runs with `NODE_ENV=production` and validates the environment at start-up. A missing or
   unsafe setting stops the build with a clear message.

## 5. Scheduled runner

`GET /api/cron/outbox` with `Authorization: Bearer $CRON_SECRET` does three things:
- sends queued notifications;
- runs reminders and post-shift timesheet checks;
- applies the privacy retention clean-up.

Schedule it **every minute** (5 minutes at most). With Vercel Cron, add a `vercel.json` like this:

```json
{ "crons": [{ "path": "/api/cron/outbox", "schedule": "* * * * *" }] }
```

Check Vercel's documentation for your plan's cron frequency and for how it sends `CRON_SECRET`. Any external
scheduler that can send the header works too.

### Staging (demo data)

A demo staging site uses the same setup with three differences:
- `MAIL_TRANSPORT=log` plus `ALLOW_LOG_MAIL_IN_PRODUCTION=on` (no email provider needed; sign-in links appear in Settings → Mail log);
- demo data loaded by the **Staging database** workflow (tick "Also load demo data");
- the **Staging scheduled runner** workflow calls the cron URL every 15 minutes once the repository variable
  `STAGING_URL` and the secret `STAGING_CRON_SECRET` are set.

Demo staging is for looking around only. Its sign-in password is public in the README, so never put real
people's data in it.

## 6. First administrator

On a fresh production database:

```bash
DATABASE_URL="…" APP_URL="https://staffing.rgxm.ca" BETTER_AUTH_SECRET="…" MAIL_TRANSPORT=resend RESEND_API_KEY="…" MAIL_FROM="…" \
  npm run admin:create -- --email you@rgxm.ca --name "Your Name"
```

This emails an invitation to set a password. It refuses to run if an active administrator already exists. Sign in,
set up two-step verification (required), check Settings → Organisation, then invite the team (see ADMIN_GUIDE.md).

## 7. Monitoring & backups

- **Logs:** server errors are single-line JSON (`"level":"error"`). Add a Vercel log drain to your alerting tool and alert on them.
- **Uptime:** monitor `GET /api/health` (200 `{"status":"ok"}`, 503 when the database is unreachable).
- **Backups:** Supabase takes daily backups, and PITR on paid plans. **Do a restore drill before go-live:**
  1. restore to a new project;
  2. point a staging deployment at it;
  3. sign in and open a recent timesheet and payment batch;
  4. record the date and result.
- **Storage files** (briefs, exports) are not in database backups. Turn on Supabase Storage backups, or copy the bucket on a schedule.

## 8. Go-live checks (staging first)

- [ ] `/api/health` returns ok; the response headers on `/sign-in` include a `Content-Security-Policy` with a nonce, and HSTS.
- [ ] An invited admin can set a password, is required to set up two-step verification, and can sign in with it.
- [ ] A staff member receives a real magic-link email and can sign in on a phone; the Mail log shows `[link redacted]`.
- [ ] Upload a brief and download it as a staff member (exercises Supabase Storage).
- [ ] The scheduled runner shows successful calls; a test announcement email arrives.
- [ ] Six rapid wrong passwords from one device are rate limited, while another device can still sign in
      (confirms `AUTH_IP_HEADERS`).
- [ ] A restore drill is recorded.
- [ ] SECURITY.md "Before using real data" items are complete.
