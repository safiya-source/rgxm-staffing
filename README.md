# RGXM Staffing Platform

Staffing, scheduling, attendance and payments for RGXM's experiential activations.

- **RGXM Dashboard** (`/dashboard`): desktop-first, for Admin, Project Manager, Staffing Coordinator and Finance.
- **Staff Portal** (`/portal`): a mobile-first installable web app (PWA) for field staff.

See [`docs/PLAN.md`](docs/PLAN.md) for the product plan, architecture, data model and milestones.

> **Status: Milestones 1–6.** Authentication, roles and permissions, the database with integrity rules,
> staff registration and availability, the talent database (search, profiles, rates history, lists,
> CSV import/export), projects (locations, requirements, team) and scheduling (bulk shifts, calendar,
> drag-and-drop), offers and booking (eligibility, responses, confirmation with conflict checks, waitlist),
> briefs with acknowledgement tracking, announcements, messaging and email/in-app notifications,
> check-in/out (optional location, offline queue) and timesheets (staff corrections, Team Lead/AM
> verification, approval with separation of duties, post-approval corrections), payables at the agreed
> rate, contractor/payroll batches with second-person approval, one-time fingerprinted CSV/XLSX exports,
> paid status for staff and project budgets all work. The platform never moves money; exports are
> imported elsewhere. Reports (Phase 2) are labelled as planned in the UI. **Not production-ready.**
> See "Before production" below.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui-style components on Radix ·
PostgreSQL 16 · Drizzle ORM · Better Auth (magic link, password, TOTP) · Zod · Vitest · Playwright

## Local setup

Requirements: Node 22+, PostgreSQL 16.

```bash
npm install
cp .env.example .env               # then set BETTER_AUTH_SECRET (openssl rand -base64 48)
createdb rgxm_dev && createdb rgxm_test
npm run db:migrate
npm run db:seed                    # demo data (safe: .test emails, flagged is_demo)
npm run dev                        # http://localhost:3000
```

### Demo accounts

| Who | Sign in |
|---|---|
| `admin@rgxm-demo.test` | Password `rgxm-demo-password` (System Administrator) |
| `pm@`, `coordinator@`, `finance@`, `ops@rgxm-demo.test` | Same password (one role each; `ops` has two) |
| `ba.demo@`, `tl.demo@rgxm-demo.test` | Field staff: request a magic link, then open it from **Settings → Mail log** (signed in as admin) or the dev-server console |

With `MAIL_TRANSPORT=log` (the default) no email ever leaves the system. Messages to demo recipients are always suppressed.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | Type and lint checks |
| `npm test` | Unit + database integration tests (rebuilds `rgxm_test`) |
| `npm run test:e2e` | Playwright end-to-end tests against the dev DB (seed it first) |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` / `db:seed` / `db:reset` | Apply migrations / seed demo data / drop and rebuild (dev only) |
| `npm run admin:create -- --email … --name …` | Create the first administrator on a fresh (unseeded) database |

To use a pre-installed Chromium for E2E: `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.
Set `AUTH_RATE_LIMIT=off` in `.env` for local E2E runs (it's rejected in production).
A local `npm run build` runs as production: use `AUTH_RATE_LIMIT=on ALLOW_LOG_MAIL_IN_PRODUCTION=on npm run build`
while `MAIL_TRANSPORT=log`.

## Project layout

```
src/
  app/(auth)/            sign-in, join, two-factor, password reset
  app/dashboard/         internal dashboard (server components + server actions)
  app/portal/            staff portal (PWA)
  components/ui/         design-system primitives
  server/auth/           Better Auth configuration
  server/authz/          permission matrix + separation-of-duties rules (pure, unit-tested)
  server/db/schema/      Drizzle schema (enums, auth, core)
  server/db/migrations/  SQL migrations, incl. 0001_integrity.sql (DB-level business rules)
  server/notify/         mailer (log / Resend) + templates
  server/session.ts      request identity, page guards and action guards
scripts/                 migrate, seed, reset, icon generation
tests/                   Vitest: unit + database integrity
e2e/                     Playwright
```

## Notifications

Domain changes queue events in `outbox_events` in the same transaction. They're processed right after
each request and by `GET /api/cron/outbox` (send `Authorization: Bearer $CRON_SECRET`; schedule it every
minute in production, e.g. Vercel Cron). Failed deliveries retry with backoff and show in the Mail log.

## Security model (summary)

- Browsers never query the database. All reads and writes go through server code that checks the permission
  matrix (`src/server/authz/permissions.ts`). Project-scoped grants are enforced per project.
- Row-level security is enabled on every table with no policies, so any role other than the app's owner role
  (e.g. Supabase `anon`/`authenticated`) is denied.
- Database triggers and constraints enforce no double-booking, immutable agreed rates and payables, append-only
  audit/attendance/adjustment history, a single live payable per timesheet, a single active batch per payable,
  a single live export per batch, and two-person batch approval.
- Field staff sign in by magic link only (hashed, single use, 15 minutes). Internal users need a password (12+ characters);
  two-step verification is required for Administrators and Finance. Internal accounts can't use magic links.
- Nonce-based Content Security Policy, rate limits on sign-in and sensitive actions, and privacy retention/erasure tools.
  Details in [`docs/SECURITY.md`](docs/SECURITY.md).
- Sign-in links are redacted from the stored mail log whenever real delivery is enabled.

## Before production

M1–M6 are built and tested, but the platform is **not production-ready** until RGXM completes the checklist in
[`docs/SECURITY.md`](docs/SECURITY.md#before-using-real-data-rgxm-to-complete):
- legal/privacy review;
- accountant sign-off on worker classification and export layouts;
- a Canadian-region deployment with a verified sending domain;
- backups with a restore drill;
- monitoring;
- an external security test.

Guides: [deployment](docs/DEPLOYMENT.md) · [administrators](docs/ADMIN_GUIDE.md) · [security & privacy](docs/SECURITY.md).
