# RGXM Staffing Platform — Discovery & Implementation Plan

Status: **Approved 2026-10-23** · M1–M3 delivered (see §14)

---

## 1. Product understanding

RGXM books temporary field staff (BA, TL, PA, AM) for experiential activations. Today the cycle runs on mass texts, WhatsApp, spreadsheets and individual contractor invoices. The platform replaces that with one system of record covering:

**Project → Shifts → Offers → Responses → Confirmed bookings → Briefs → Check-in/out → Timesheets → Supervisor verification → Final approval → Payable records → Payment batch → Export → Paid status visible to staff.**

Two surfaces share one backend:

- **RGXM Dashboard** (desktop-first) for Admin, Project Manager, Staffing Coordinator and Finance. A user can hold several roles.
- **Staff Portal** (mobile-first PWA) for field staff. Team Leads and Activation Managers get extra supervisor tools, but **only on projects where they're booked in that supervisory role**.

Rules that drive the design:
- People decide; the system only suggests. Interest ≠ booking. Suggestions ≠ rankings.
- Money and hours are append-only and auditable. Actual ≠ payable. Agreed rates are snapshotted onto each booking.
- Contractor and employee payment flows are kept separate. Classification is configured by RGXM and reviewed outside the platform.
- Seeded or demo data never sends a real message or creates a real payment.

---

## 2. Roles & permissions matrix

Legend: **F** full · **A** limited to assigned projects · **R** read-only · **—** none

| Capability | Sys Admin | Project Mgr | Staffing Coord | Finance | TL/AM (per project) | Field Staff (self) |
|---|---|---|---|---|---|---|
| Manage internal users & roles | F | — | — | — | — | — |
| System settings, integrations, pay policies | F | — | — | R | — | — |
| Create/edit projects | F | A (owner) | R | R | — | — |
| Locations, shifts, templates | F | A | A | R | R (their team) | — |
| Talent profiles (non-sensitive) | F | F | F | R | Names/contacts of their team | Own |
| Staff rates & pay classification | F | A (view, propose project rate) | R (view, can't edit defaults) | F | — | Own agreed rates |
| Emergency contacts | F | A (booked staff) | F | — | — | Own |
| Internal notes / evaluations | F | A | F | — | Submit evaluations for their team | — |
| Send offers / confirm / waitlist | F | A | A | — | — | Respond to own |
| Double-booking override | F | A (with reason) | — | — | — | — |
| Announcements / messages / briefs | F | A | A | — | Post to their team | Read, acknowledge, DM RGXM |
| Check-in / out | — | — | — | — | Own | Own |
| Timesheet: verify (supervisor) | — | — | — | — | Their team only, never their own | — |
| Timesheet: final approve payable hours | F | A (never own) | — | — | — | — |
| Post-approval correction | F | A (request) | — | F (approve) | — | Request |
| Payables, batches, export, mark paid | F | R (own projects) | — | F | — | View own statements |
| Budgets & cost reports | F | A | R (no rates) | F | — | — |
| Audit log | F | A (project scope) | — | F (financial scope) | — | — |

Enforced **server-side** in a single permission module (`can(user, action, resource)`), not just hidden in the UI. Separation-of-duties checks (no self-approval, supervisors can't approve their own hours) live in the domain layer and are covered by tests.

---

## 3. Primary user journeys

1. **PM sets up an activation:** creates the project (client, code, dates, budget) → adds locations (each has its own time zone) → defines staffing requirements per role/location → generates shifts in bulk from a date range and template → uploads briefs, marking which need acknowledgement.
2. **Coordinator staffs it:** opens open shifts → the eligible-talent panel filters by role, city, availability, conflicts, skills and rate → picks people individually, from saved lists, or all matches → sends offers with a deadline → a live board shows Offered, Interested, Declined, Info requested, No response → confirms N people (conflict check runs here) → moves the rest to a waitlist → if someone cancels, re-offers from the waitlist in one click.
3. **BA, first time:** gets an email link → magic-link sign-in, no password → short onboarding (name, phone, city, roles) → sees the offer → taps Interested → later gets a confirmation → shift appears in My Schedule → reads and acknowledges the brief.
4. **Event day:** the Home screen shows the next shift with a Check In button (active from 60 minutes before start; configurable) → optional one-time location capture at check-in → Check Out → review hours, add break, flag a discrepancy → submit.
5. **TL verifies:** Team view lists their staff's check-in/out, late arrivals and missed check-ins → recommends adjustments with a reason → submits as Supervisor Verified.
6. **PM approves:** reviews verified timesheets → approves payable hours. Approval creates an immutable payable item at the booking's agreed rate.
7. **Finance pays:** picks a pay period → selects approved payables, split by Contractor and Employee → creates a batch, which locks its items → exports CSV (the export is fingerprinted, and re-exporting is blocked unless explicitly voided) → marks Paid → staff see "Paid" with the date.
8. **PM closes out:** the project dashboard shows Budget, Committed (scheduled), Pending (unapproved actuals), Actual (approved), Variance, broken down by role, location and date → evaluations → Reconciliation → Closed.

---

## 4. Technology stack (recommended)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + React + TypeScript** | One codebase for both surfaces. Server Actions and route handlers keep secrets server-side. |
| UI | **Tailwind CSS + shadcn/ui (Radix)** | Accessible primitives and a fully owned design system. Accent colour set via CSS variable tokens. |
| Database | **PostgreSQL (Supabase, Canada region `ca-central-1`)** | Relational integrity, exclusion constraints for double-booking, RLS, Canadian data residency for PIPEDA. |
| Data access / migrations | **Drizzle ORM + drizzle-kit SQL migrations** | Typed queries, plain SQL migrations under version control, runs against any Postgres (local, CI, Supabase). |
| Auth | **Better Auth** (changed from Supabase Auth; see §14) | Magic link for staff. Email + password + TOTP MFA for internal users. Password reset and DB-backed rate limiting. Runs on the same Postgres, so local, CI and Supabase all behave identically. |
| Authorization | App permission layer + **Postgres RLS deny-by-default** | The browser never queries the DB directly. All reads and writes go through server code that checks permissions. RLS is a second line of defence. |
| File storage | **Supabase Storage, private buckets, short-lived signed URLs** | Briefs, resumes and photos are never public. |
| Background jobs | **pg-boss** (Postgres-backed queue) + **transactional outbox** | Jobs are idempotent (dedupe keys), retried with backoff and fail visibly. No extra infrastructure. |
| Email | **Resend** (or Postmark) behind a `Notifier` adapter | In dev and for demo data, mail goes to an in-app "Mail Log" and is never sent. |
| SMS | **Twilio adapter, off by default** (Phase 2) | Same interface as email. |
| PDF | `@react-pdf/renderer` | Payment statements and, later, self-billing documents. |
| Exports | CSV (native) + **ExcelJS** for .xlsx | |
| Validation | **Zod** shared between client and server | |
| Testing | **Vitest** (domain + DB integration on real Postgres) + **Playwright** (E2E acceptance scenario) | |
| Monitoring | **Sentry** (PII scrubbing on) | |
| Hosting | **Vercel** for the app + Supabase for data | Alternative if every byte must stay in Canada: a containerised deploy (Docker) to a Canadian region. The app is built to run either way. |

**Why not query Supabase from the browser?** The financial rules (rate snapshots, approval chains, batch locking) need to be enforced in one trusted place. Keeping all access server-side makes the authorization model auditable and testable. RLS still blocks anything that bypasses the app.

---

## 5. Architecture

```
Browser (Dashboard / Staff PWA)
   │  HTTPS, session cookie
   ▼
Next.js (App Router)
   ├─ app/(dashboard)/...      internal UI
   ├─ app/(portal)/...         staff PWA UI (manifest + service worker)
   ├─ Server Actions / API     ── Zod validation ── permission check
   ▼
Domain services (src/server/domain/*)   ← all business rules live here
   bookings · scheduling · timesheets · payables · batches · budgets
   │            │                    │
   ▼            ▼                    ▼
Postgres (Drizzle)        Outbox table ──► pg-boss worker ──► Notifier (Email/SMS)
 + audit_log (append-only)                                  ──► Export/PDF generators
 + RLS deny-by-default
Supabase Auth · Supabase Storage (private)
```

- **State machines** for Booking, Timesheet, PayableItem and Batch, each with explicit allowed transitions and the role allowed to make each one. Every transition writes a row to `audit_log` in the same DB transaction.
- **Outbox pattern:** domain writes insert `outbox_events` in the same transaction. The worker turns them into notifications with dedupe keys, so a retry never sends twice.
- **Time:** all instants are `timestamptz` (UTC). Each location has an IANA time zone. Display uses the location's zone. A shift is stored as `starts_at`/`ends_at` instants, which makes overnight and cross-midnight shifts simply `ends_at > starts_at`.
- **Money:** `bigint` cents everywhere, plus a `currency` code. Rates are cents per hour. Pay = `round_half_up(payable_minutes × rate_cents / 60)`, computed once and stored together with its inputs so it can be reproduced.

---

## 6. Data model (entity overview)

Core tables (PK = `uuid`; all have `created_at`, `updated_at`; soft-archive where history matters):

**Identity & access**
- `users` (1:1 with auth user) · `internal_roles` (user_id, role) — several per user
- `audit_log` (actor, action, entity_type, entity_id, before jsonb, after jsonb, reason, at) — append-only, enforced by trigger

**Talent**
- `staff_profiles` (user_id?, names, preferred_name, email, phone, city, province, service_area, status, experience_years, vehicle, travel_radius_km, classification `contractor|employee|unset`, tax_registered, gst_hst_number (restricted), is_demo)
- `staff_sensitive` (emergency contact, legal/business name) — separate table with tighter access
- `staff_roles` (staff_id, role `BA|TL|PA|AM`, qualified_at)
- `staff_rates` (staff_id, role, rate_cents, currency, effective_from, effective_to, set_by) — history is never overwritten
- `skills`, `languages`, `certifications` + join tables (certifications carry an expiry date)
- `availability_rules` (recurring weekday windows) · `availability_exceptions` (date-specific available/unavailable)
- `staff_lists` + `staff_list_members`
- `staff_documents` (resume, portfolio → storage key)
- `internal_notes` (staff_id, author, body) — internal only

**Projects & scheduling**
- `clients` · `projects` (code unique, client_id, campaign, owner_id, coordinator_id, dates, status, budget_cents, currency)
- `project_locations` (name, address, lat/lng, **timezone**, onsite contact)
- `staffing_requirements` (project, location, role, quantity, date range, default rate)
- `shift_templates`
- `shifts` (project, location, role, requirement_id?, starts_at, ends_at, headcount, rate_cents (default offered), break_policy_id, uniform, instructions, reporting_location, status)
- `project_rates` (project, staff?, role, rate_cents, approved_by) — authorised overrides

**Offers & bookings**
- `offers` (shift_id, staff_id, sent_at, deadline, offered_rate_cents, status) — unique (shift, staff)
- `offer_responses` (offer_id, response `interested|unavailable|more_info`, message, at)
- `bookings` (shift_id, staff_id, offer_id?, **agreed_rate_cents**, rate_source, status, override_reason?, override_by?, confirmed_at, cancelled_at, cancel_reason) — confirmed bookings guarded by a **Postgres exclusion constraint** on `(staff_id, tstzrange(starts_at, ends_at))`, except where `override_by` is set
- `waitlist_entries` (shift_id, staff_id, position)
- `supervisor_assignments` (project/shift, supervisor booking, team members)

**Comms & documents**
- `documents` (project, title, category, storage_key, requires_ack, version) · `document_acknowledgements` (document, staff, version, at)
- `announcements` (project, shift?, body, author) · `message_threads` / `messages` (DM: staff ↔ RGXM)
- `notifications` (user, type, payload, read_at, channel, dedupe_key unique) · `outbox_events`

**Attendance & time**
- `attendance_events` (booking_id, type `check_in|check_out`, occurred_at, recorded_at, method `self|supervisor|admin|offline_sync`, lat/lng/accuracy?, client_event_id unique) — append-only
- `timesheets` (booking_id unique, actual_start/end, actual_minutes, break_minutes, **payable_minutes**, status, submitted_at, verified_by, approved_by, locked_at)
- `timesheet_adjustments` (timesheet, field, old_value, new_value, reason, actor, stage, at) — append-only
- `break_policies` (configurable rules; default: none, so no automatic deduction)

**Money**
- `payable_items` (timesheet_id **unique**, staff, project, classification snapshot, payable_minutes, rate_cents, base_cents, premiums_cents, expenses_cents, tax_cents, total_cents, calc_version, status)
- `expense_claims` (Phase 2) · `payable_adjustments`
- `pay_periods` · `payment_batches` (period, type `contractor|payroll`, status, created_by, approved_by, export_fingerprint)
- `payment_batch_items` (batch, payable_item **unique while active**)
- `payment_exports` (batch, format, file_key, sha256, exported_by, at)
- `billing_documents` (Phase 2: self-billing/uploaded invoices; unique document number sequence)
- `evaluations` (Phase 2)

Key constraints:
- No double booking (exclusion constraint).
- One timesheet per booking. One payable per timesheet. A payable can be in only one active batch.
- Triggers block UPDATE/DELETE on audit, attendance and adjustment rows, and on payables once they're batched or paid.

---

## 7. MVP feature checklist (Phase 1)

- [ ] Auth: staff magic link; internal email/password + optional TOTP; password reset; invite internal users
- [ ] Internal roles (multi-role) + server-side permission layer + RLS baseline
- [ ] Staff self-registration + onboarding, profile edit, roles, availability
- [ ] Talent directory: search and filter (city, role, status, skills, languages, availability on a date, conflicts, rate range), saved lists, CSV import/export
- [ ] Rates with history; agreed-rate snapshot on booking
- [ ] Projects, clients, locations (time zones), staffing requirements
- [ ] Shifts: create, bulk-create over a date range, duplicate, overnight support, coverage indicators; list + week calendar view
- [ ] Eligible-talent suggestions (objective filters only) → send offers with deadline
- [ ] Staff respond (Interested / Unavailable / More info) → live response board
- [ ] Confirm bookings with conflict detection + authorised override; cancel; basic waitlist
- [ ] Staff portal PWA: Home, Opportunities, My Schedule, Payments, Profile (Messages = announcements in MVP)
- [ ] Check-in / check-out (optional location capture, offline queue with sync)
- [ ] Timesheets: staff review/correct/submit → TL/AM verify → PM final approve (separation of duties enforced)
- [ ] Payable calculation on approval
- [ ] Payment batches (contractor vs payroll), lock, CSV export with duplicate prevention, mark paid
- [ ] Project dashboard: requirements filled/unfilled, offers, attendance, committed vs actual vs budget
- [ ] In-app notifications + email via adapter (dev Mail Log; demo data suppressed)
- [ ] Audit log viewer
- [ ] Demo seed: the Cadbury Eaton Centre scenario (clearly labelled DEMO)
- [ ] Tests (see §10) + Playwright run of the full acceptance scenario

Phase 2 and 3 follow the brief. The schema above already reserves the tables, so they can be added without rework.

---

## 8. Phased implementation plan

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M1 — Foundation** | Repo, CI, design tokens, app shells (dashboard + portal), auth (both flows), roles & permission layer, full core schema + migrations, audit log, demo seed | Sign in as each demo persona and land on the correct shell. Permission tests pass. Migrations run cleanly on fresh Postgres. |
| **M2 — Talent & Projects** | Talent directory, profiles, rates history, availability, saved lists, CSV import/export, projects/locations/requirements, shifts + bulk creation + calendar | PM can build the Cadbury project with all shifts. Coordinator can find Toronto BAs available on Nov 12. |
| **M3 — Offers & Booking** | Eligibility suggestions, offers, staff responses, response board, confirm/override/cancel, waitlist, staff portal Home/Opportunities/Schedule, notifications + Mail Log | 30 offers sent → responses → 10 confirmed → rest waitlisted. Double-booking blocked without an override. |
| **M4 — Attendance & Timesheets** | Check-in/out (with offline queue), timesheet review/correct/submit, supervisor verify, final approval, adjustment trail | Event-day flow end to end. Self-approval impossible. Every change audited. |
| **M5 — Payments & Budget** | Payable calc, pay periods, batches, lock, CSV/XLSX export, duplicate-export protection, mark paid, staff payment view, project budget dashboard | Steps 12–17 of the acceptance test pass in Playwright. |
| **M6 — Hardening & Deployment docs** | Security review, rate limits, privacy notice/retention settings, account deactivation, deployment + admin onboarding guides | Checklist in §11 complete. Production readiness still requires RGXM's own review. |
| Phase 2 | Briefs + acknowledgements*, email automations + reminders, SMS, evaluations, budgets by role/location/date, reporting, self-billing PDFs (after accountant sign-off), QBO/Xero adapters | |

\*Brief upload and acknowledgement are steps 8–9 of the acceptance test, so I'll pull the basic version into **M3/M4** rather than leaving them in Phase 2.

---

## 9. First working milestone (M1) — definition

Deliverables:
1. Next.js + TS + Tailwind + shadcn project with lint, typecheck, Vitest, Playwright and a GitHub Actions CI workflow.
2. Design system: tokens (neutral palette + configurable `--accent`), typography, and core components (Button, Input, Select, Table, Badge/Status, Card, Dialog/Confirm, Sheet, Tabs, EmptyState, Skeleton, Toast).
3. Dashboard shell: sidebar nav (Overview, Projects, Schedule, Talent, Staffing Requests, Timesheets, Payments, Reports, Settings), global search placeholder wired to the talent/project search API, notification bell.
4. Portal shell: bottom tab nav, PWA manifest + service worker, installable.
5. Auth: magic-link sign-in for staff; password + MFA enrolment for internal users; role-based redirect.
6. The complete core schema (§6) as migrations, with constraints, indexes and audit triggers.
7. Permission module + tests.
8. Demo seed: RGXM internal users (one per role), ~60 Toronto-area demo staff (flagged `is_demo`), the Cadbury project skeleton.
9. A local dev setup that runs on plain Postgres with a local auth shim, so it works without a Supabase account. With a Supabase project configured, it uses Supabase Auth and Storage.

Pages for M2+ appear in the nav as clearly marked "Coming in M2" empty states. No fake data or fake success messages.

---

## 10. Testing strategy

- **Unit (pure domain):** pay calculation and rounding, overnight durations, DST transitions (Nov 2 2026 is the fall-back date in Toronto), break policy application, state-machine transitions, permission matrix.
- **Integration (real Postgres, per-test transaction):** double-booking constraint and override, duplicate payable/batch/export prevention, immutable-row triggers, rate snapshot after a rate change, approval separation of duties.
- **E2E (Playwright):** the full Cadbury acceptance scenario across PM, Coordinator, BA, TL and Finance personas.

---

## 11. Key risks

| Risk | Mitigation |
|---|---|
| **Worker misclassification** (CRA / Ontario ESA) | Classification is an explicit per-person field, defaulting to *unset*, which blocks payment until set. Employee and contractor flows are separate. A banner points to accountant/legal review. |
| **Self-billing tax validity** (GST/HST) | Phase 2, behind a feature flag. Requires a recorded self-billing agreement per contractor and accountant sign-off. Tax is only calculated when the contractor's registration number is on file. |
| **Ontario ESA obligations if staff are employees** (minimum shift pay / 3-hour rule, overtime, public holiday pay, eating periods) | The policy engine is configurable. Nothing is applied automatically until RGXM's advisors define the rules. The MVP calculates base pay only and flags shifts that may trigger these obligations. |
| **Privacy (PIPEDA)**, location data at check-in | Canadian data region, location collected only at the moment of check-in with explicit notice, configurable per project, retention settings. |
| Double payments | DB uniqueness constraints + batch locking + export fingerprints + idempotent jobs. |
| Low staff adoption | Magic-link auth, 3-tap responses, no passwords, clear Home screen. |
| Offline check-in disputes | Device time and server time both stored. Offline events marked as such and surfaced to supervisors. |
| Scope creep | Strict milestone exit criteria. Phase 2 kept out until the MVP flow passes end to end. |

---

## 12. Decisions requiring RGXM input

None of these block M1. Defaults shown in **bold** are what I'll build with unless told otherwise.

1. **Worker classification today:** are field staff currently treated as contractors, employees, or mixed? → **Support both; default each person to "unset"**
2. **Payable hours rounding:** → **to the exact minute** (alternatives: nearest 15 min, or round to the scheduled shift unless there's a discrepancy)
3. **Default break policy:** → **none (no automatic deductions)**; breaks entered or verified manually
4. **Pay cycle:** → **biweekly; periods 1st–15th and 16th–end of month**, configurable
5. **Hosting / data residency:** is Supabase `ca-central-1` + Vercel acceptable, or must the application tier also be hosted in Canada? → **Supabase ca-central-1 + Vercel**
6. **Accounting system in use:** QuickBooks Online or Xero? (MVP ships a CSV export shaped for whichever you use) → **generic CSV + QBO-style CSV**
7. **Branding:** logo files, accent colour, font preference → **neutral palette with a placeholder accent until assets arrive**
8. **Check-in location verification:** → **off by default, enabled per project, 300 m radius**
9. **Email sending domain** (e.g. `staffing@rgxm.ca`) and provider account → needed only for real sending (M3+); dev uses the Mail Log

---

## 13. Environment notes

- The working directory was empty. This is a new project, created in `/home/user/rgxm`.
- **This cloud container is temporary.** Work must be pushed to a GitHub repository to persist. Please create (or tell me) a repo, e.g. `rgxm/staffing-platform`, that I can push to.
- Local Postgres 16 and Docker are available, so I can build and test the full workflow here without external accounts. Supabase, Resend and Sentry keys are only needed for staging and production.

---

## 14. Implementation log

### Changes from the approved plan
- **Auth: Better Auth instead of Supabase Auth.** Better Auth stores identities in our own Postgres (Drizzle adapter), so local dev, CI and production share one code path with no auth "shim". It includes magic links, TOTP, backup codes and rate limiting. It still runs on Supabase Postgres, and Supabase remains the recommended database and storage host.
- **Next.js 16** (current stable) instead of 15. Cache Components / PPR are off because almost every page is per-user.
- **shadcn/ui components were written directly on Radix** (the shadcn registry was unreachable from the build environment). Same structure and conventions as shadcn output.
- **Bookings and offers are one table** (`bookings`). Each (shift, staff) row moves through the brief's booking statuses, with `offer_responses` and `booking_status_history` holding the trail. This keeps one row per person per shift and lets the database enforce no double-booking.

### Decisions adopted (defaults from §12, pending RGXM confirmation)
Classification defaults to *unset*; payable rounding to the minute; no automatic break deductions; semi-monthly pay periods; Supabase `ca-central-1` + Vercel; generic + QBO-style CSV; placeholder branding (`#E4572E` accent, editable in Settings); check-in location off by default with a 300 m radius.

### M1 — Foundation: delivered
- Full core schema (58 tables) and migrations, including `0001_integrity.sql` with DB-level business rules.
- Auth: staff magic link (self-registration), internal password + optional TOTP MFA, password reset, invitation by admin, deactivation with session revocation.
- Multi-role permission matrix with project scoping and separation-of-duties helpers; server-side guards for pages and actions.
- Dashboard shell: navigation by permission, global search (staff + projects), notification centre, user menu; Overview KPIs from live data.
- Settings: organisation branding and check-in defaults, team & roles, my security (MFA), audit log, mail log.
- Staff portal shell (PWA, installable, offline page): onboarding, home (next shift, to-dos, latest payment, all live queries), profile.
- Demo seed (Cadbury Eaton Centre scenario, Taco Bell two-location project, 60 GTA staff, saved lists).
- Tests: 39 unit + DB integrity tests (Vitest); 11 E2E tests across five personas on desktop and mobile (Playwright); GitHub Actions CI.

### M2 — Talent & Projects: delivered
- **Talent directory**: filter by role, city, skills, languages, unexpired certifications, saved list, project history, status, experience, vehicle, rate range (rate filters only for users who can see rates), availability on a date, and "no booking conflicts that day". URL-driven filters, pagination, bulk add-to-list, bulk/filtered CSV export (formula-injection safe, audited, rates only for `rates.view`).
- **Staff profiles**: create/edit; status changes with reasons; roles; skills/languages; certifications with expiry; default rates with full history (new rate closes the old one; confirmed bookings keep their snapshot); pay setup (classification, GST/HST registration with format check, legal/business name; tax details only for `rates.edit`); emergency contact (restricted; project managers only for people booked on their projects); internal notes; lists; upcoming/past shifts and reliability counts.
- **CSV import**: validate-then-commit with per-row errors, match by email, never erases data with blanks, adds roles/skills/languages, reuses lookups case-insensitively, rate columns ignored without `rates.edit`, 2,000-row cap.
- **Staff availability (portal)**: weekly pattern + date-specific available/unavailable entries.
- **Projects**: create/edit (inline new client), status transitions with reasons, locations (time zone locked once shifts exist; check-in location verification requires coordinates), staffing requirements, project team; overview with coverage by role × location, unfilled positions, pending offers, estimated cost vs budget.
- **Shifts**: bulk creation from a date range + weekdays (live preview incl. overnight "+1 day" and DST-length warnings, cost estimate), templates, edit (headcount can't drop below confirmed; reschedules that would double-book are rejected), duplicate to dates, publish drafts, cancel with reason (cancels active bookings, keeps history).
- **Schedule**: day/week/month across projects with project/role filters, coverage colours, unfilled-in-next-7-days list, drag-and-drop to move a shift in week view (permission-checked).
- Tests: 82 Vitest (incl. DST gap/fold, overnight, search filters, import rules, scheduling rules) and 21 Playwright E2E.

### Notes carried into M3
- A shift with no rate means "use each person's default rate"; M3's rate resolution must implement shift → project override → staff default, snapshotting the result at confirmation.
- Drag-and-drop exists in week view only; day/month are read-only.

### M3 — Offers & Booking: delivered
- **Booking state machine** (pure, unit-tested): only RGXM can confirm; interest ≠ booking; declined/cancelled rows are final and a re-offer creates a new row so history is kept. "Awaiting confirmation" is used as RGXM's shortlist.
- **Rate resolution** (rule 3): person-specific project override → shift rate → project role override → staff default. The offered rate is stored on the offer and becomes the agreed-rate snapshot at confirmation. Project rate overrides are managed on the project Setup tab (`rates.project_override`).
- **Offer builder**: qualified, active staff for a role with per-shift availability, conflicts, existing offers and resolved rate; filters; response deadline in the location's time zone; sends exactly the person × shift pairs shown.
- **Response board** (people × shift dates): offered / interested / question / shortlisted / confirmed / waitlist / declined, per-cell actions, bulk confirm, waitlist positions, release, withdraw, cancel with reason. Confirmation checks capacity under a row lock and double-booking; an overlap needs `booking.override_conflict` plus a reason (recorded on the booking and in the audit log); the DB exclusion constraint remains the backstop.
- **Staff portal**: Opportunities (interested / can't make it / ask a question, "interested in all"), My schedule (confirmed, briefs to review, recent cancellations, past), shift detail (where/when/report-to/uniform/instructions/agreed rate, briefs, announcements, message RGXM, "can't make this shift"), Messages (threads + announcements), Notifications with header badge.
- **Briefs & updates** project tab: private document uploads (20 MB, type + signature checked) through API routes with same-origin checks; authenticated downloads; required acknowledgement tracked per document version with who's still pending; new versions reset acknowledgements; announcements (important ones emailed).
- **Notifications**: transactional outbox → in-app notifications and email, each with a dedupe key so retries never double-send; SKIP LOCKED claiming, exponential backoff, failed after 5 attempts, stuck-event release. Processed right after the response via `after()`, plus `GET /api/cron/outbox` (Bearer `CRON_SECRET`) as the scheduled safety net. Shift edits/cancellations notify affected staff.
- Tests: 105 Vitest (state machine, rates, offers, responses, capacity, waitlist, conflict override, outbox idempotency/retry, document access and versioned acknowledgements) and 23 Playwright E2E incl. the offer → question → reply → confirm → brief → acknowledge flow across three personas.

### Deviations / notes
- **pg-boss was not needed**: the outbox processor above covers idempotent jobs with retry. Revisit if job volume grows.
- **Supabase Storage adapter** is written against Supabase's documented REST API but has not been exercised against a live project. Local disk storage is used in development and tests.
- SMS remains Phase 2 (shift reminders by email/in-app arrived in M4).

### M4 — Attendance & Timesheets: delivered
- **Check-in/out** from the staff Home screen and shift page. The window opens 60 minutes before the start (org setting) and closes at the scheduled end; check-out is allowed up to 12 hours after the end. Events are append-only, idempotent on a client event id, and stamped with server time when online.
- **Location** is requested only at the moment of tapping, and only where the venue has "require location at check-in" turned on. A position outside the geofence (or no position) is flagged for review, never blocked. Nothing is tracked in the background.
- **Offline**: a tap without a connection is kept on the phone (localStorage) with the device time, shown as "waiting to sync", and sent when the browser comes back online. Device times more than 2 minutes old are recorded as `offline_sync` and flagged. Future times and times older than 24 hours are rejected.
- **Timesheets** keep three layers separately (rule 9): actual (from check-in/out), worked (what the person or a reviewer says they worked) and payable (approved). Every change to worked times or breaks writes a `timesheet_adjustments` row with old value, new value, reason, stage and who made it. Changing a time needs a reason; times are compared to the minute.
- **Objective flags** for reviewers: late, left early, no check-in/out, recorded offline, outside venue radius, recorded by supervisor, times corrected, much longer than scheduled. Flags inform review; they never change pay on their own.
- **Workflow**: staff review and submit their hours (Hours to submit list and shift page). Team Leads verify BAs/PAs and AMs verify everyone except other AMs on the same project, location and local date (My team page), with an optional recommended adjustment, or send hours back with a note. Supervisors can record a check-in/out with a required note when someone couldn't. RGXM reviews in Dashboard → Timesheets (views: to approve, not submitted, approved, all; bulk approve), can adjust before approval, record attendance, send back, mark a no-show (only for started shifts without attendance) and approve.
- **Approval** (rule 7 + 8): nobody approves or verifies their own hours; approval needs the shift to have ended and worked times. Payable defaults to worked minus break (rounding from org settings); a different payable amount needs a reason. Approval completes the booking.
- **After approval** (rule 10): the database rejects changes to approved hours unless they come through the correction workflow (transaction-local `rgxm.hours_correction` flag), which bumps the version and records a `post_approval_correction` adjustment and audit entry. Locked, exported and paid timesheets cannot be changed at all.
- **Reminders** (`runSweeps`, run by the cron route before the outbox): a shift reminder for confirmed shifts starting within 24 hours, and a "submit your hours" reminder 30 minutes after a shift ends, each sent once (dedupe keys). Notifications for submitted, sent back and approved hours.
- Tests: 136 Vitest (incl. attendance rules, window/order, idempotent offline sync, geofence, adjustments, SoD, approval, correction guard, no-shows, sweeps) and 26 Playwright E2E incl. check-in with geofence flag → staff correction → Team Lead verification → PM approval, and an offline check-in that syncs.

### Notes carried into M5
- Approval does **not** yet create payable items; that happens in M5 (payables from approved timesheets with the agreed-rate snapshot, contractor vs employee flows, payment batches that lock timesheets).
- SMS reminders remain Phase 2. Service worker background sync is not used; the queue flushes when the app is open and online.
- Supervisor check-in is per person (no "check in whole team" bulk action yet).

### Next: M5 — Payments & Budget
