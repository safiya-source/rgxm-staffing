# Running the scheduled runner every minute (Supabase pg_cron)

Crew's reminders (24 hours before a shift, the check-in nudge ~10 minutes before, and the post-shift
timesheet prompt) and its notification queue are driven by `GET /api/cron/outbox`. It must be called
**every minute** for the check-in reminder to arrive on time.

The GitHub **Production scheduled runner** workflow is set to every 5 minutes, but GitHub throttles
scheduled workflows: in November 2026 it ran about once an hour. Keep it as a backup, and use Supabase's
`pg_cron` as the main scheduler. It's free, runs inside the production database project, and calls Crew
every minute.

The cron secret is stored in Supabase **Vault** (encrypted). It is never written into the code or a
migration.

## One-time setup (about 5 minutes)

1. Open the **production** Supabase project (`rgxm-production`) → **Database → Extensions**. Turn on
   **pg_cron** and **pg_net**.
2. Open **SQL Editor → New query**. Paste the block below. Replace `PASTE_THE_CRON_SECRET_HERE` with the
   same value as `CRON_SECRET` in Vercel (production) and `PRODUCTION_CRON_SECRET` in GitHub. Then **Run**.

```sql
-- Store the secret encrypted (run once; to change it later use vault.update_secret).
select vault.create_secret('PASTE_THE_CRON_SECRET_HERE', 'crew_cron_secret', 'Bearer token for Crew /api/cron/outbox');

-- Call Crew's scheduled runner every minute.
select cron.schedule(
  'crew-scheduled-runner',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://crew.rgxmagency.com/api/cron/outbox',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crew_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $$
);
```

3. Clear the editor before closing it, so the secret isn't left in a saved query.

## Check it works

After two or three minutes, run:

```sql
select status_code, created
from net._http_response
order by created desc
limit 5;
```

You should see `200` every minute. A `401` means the secret in Vault doesn't match Vercel's
`CRON_SECRET`. Fix it with:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'crew_cron_secret'),
  'THE_CORRECT_SECRET'
);
```

`select * from cron.job_run_details order by start_time desc limit 5;` shows whether each scheduled run
started.

## Pause or remove

```sql
select cron.unschedule('crew-scheduled-runner');
```

Running the runner more than once a minute (for example, pg_cron plus the GitHub backup) is safe. Every
reminder and notification has a dedupe key, so nobody gets a message twice.

## If you rotate CRON_SECRET

Update it in all three places: Vercel `CRON_SECRET`, GitHub `PRODUCTION_CRON_SECRET`, and the Vault
secret above.
