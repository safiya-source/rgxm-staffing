# Security & privacy

How RGXM Staffing protects people's data and money, what was reviewed in M6, and what still needs
RGXM's own review before real data goes in. **This is not a certification.** The platform has not
had an external penetration test or a legal/privacy review.

## Controls in place

### Identity and sessions
- **Field staff** sign in with single-use magic links (15 minutes). Only a hash of each link token is stored.
- **Internal users** are invited by an administrator. They sign in with a password (12+ characters), can't
  use magic links, and can turn on TOTP two-step verification (with backup codes).
- **Two-step verification is required for Administrators and Finance** (Settings → Organisation → Security & privacy).
  - Without it, they're sent to *My security* and every server action refuses.
  - So do the download routes (payment exports, documents, data exports).
  - They can't switch it off while it's required.
  - An administrator can reset another user's two-step setup after confirming who they are; this signs that user out.
  - Demo databases (seeded) turn the requirement off and show a warning banner.
- **Sessions** last 14 days and are refreshed daily.
- **Deactivating** a team member deletes their sessions immediately. **Suspending or archiving** a staff profile does the same.
- **Sign-in rate limits** (Better Auth, stored in Postgres):
  - 5 per minute for password, magic link and TOTP;
  - 5 per 5 minutes for password resets.
  - Set `AUTH_IP_HEADERS` (and optionally `AUTH_TRUSTED_PROXIES`) to match your host, so the limits key on the real client IP. See DEPLOYMENT.md.

### Authorisation
- **Server-side checks only.** Every page, server action and route handler checks the permission matrix
  (`src/server/authz/permissions.ts`) on the server. The browser never talks to the database.
  - Project-scoped roles (Project Managers, Coordinators) only act on projects they own, coordinate or are members of.
  - Server actions are public HTTP endpoints, so each one authorises itself.
- **Separation of duties:**
  - nobody verifies or approves their own hours, or records their own attendance as a supervisor or admin;
  - Team Leads and Activation Managers only verify people on an overlapping shift at the same venue;
  - payment batches need a second person to approve them (also a database check constraint).
- **Restricted fields:**
  - rates are only visible with `rates.view`;
  - legal/business name and GST/HST number only with `rates.edit`;
  - emergency contacts only to admins, and to PMs for people booked on their projects (read and write);
  - internal notes only with `talent.notes.view`.

### Data integrity (enforced by the database)
- No double-booking: exclusion constraint on confirmed bookings, unless an override with a reason is recorded.
- Agreed rates can't change after confirmation; rate history is never edited.
- Append-only:
  - audit log;
  - attendance events (the only change allowed is clearing coordinates for retention);
  - timesheet adjustments;
  - offer responses;
  - booking status history;
  - document acknowledgements.
- Approved hours change only through the recorded correction workflow, and never once they're in a payment batch.
- Payables:
  - amounts can't be edited or deleted;
  - there is one live payable per timesheet;
  - minutes must match the approved minutes.
- Payment batches and exports:
  - batch items can't be deleted, and paid or void batches are final;
  - there is one live export per batch, and each export file carries a SHA-256 fingerprint.
- Row-level security is on for every table with no policies. Any database role other than the app's own
  (e.g. Supabase `anon`/`authenticated`) is denied.

### Web security
- **Content Security Policy** per request, with a nonce (`script-src 'self' 'nonce-…' 'strict-dynamic'`; see `src/proxy.ts`).
  - Inline style attributes are allowed, because the UI uses them for progress bars and the brand colour.
- **Other headers:** HSTS, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin` referrer policy, and a
  `Permissions-Policy` limiting geolocation to this site.
- **Uploads** (20 MB):
  - checked by extension and file signature;
  - must come from this site (`Origin` / `Sec-Fetch-Site`) and declare their size;
  - stored privately under random keys.
- **Downloads** are always authenticated and served with `nosniff` and `no-store`.
- **CSV exports** are protected against formula injection, and **emails** are HTML-escaped.
- **App-level rate limits** (`src/server/rate-limit.ts`) cover:
  - messages, offer responses and check-ins;
  - sending offers;
  - uploads;
  - payment, talent and personal-data exports.

### Privacy (PIPEDA)
- Location is captured only at the moment of check-in/out, only where the venue requires it. It's never tracked in the background.
- **Retention** (configurable in Settings): check-in coordinates are cleared after 90 days, and stored email bodies after
  30 days. Expired sessions and sign-in tokens are deleted. The scheduled runner does this every time it runs.
- **Access:** staff download their own record from *My profile*. Administrators can export any person's record for
  an access request (*Talent → person → Privacy requests*).
- **Erasure:** an administrator can erase a former staff member's personal details on request.
  - It's refused while they have upcoming shifts, unapproved hours or unpaid pay.
  - It removes name, contact details, availability, skills, certifications, files, internal notes and evaluations,
    and signs them out.
  - It keeps bookings, hours, attendance times, payables, and their legal/tax identity (needed for tax records),
    plus messages exchanged with RGXM (business correspondence).
  - The audit log keeps an entry that the erasure happened. Earlier audit entries may still contain their name.
- Demo data uses reserved `.test` addresses, never sends email, and its payment exports are marked "DEMO - DO NOT PAY".

### Monitoring
- **Server errors** are logged as one JSON line each (`src/server/observability.ts`, `src/instrumentation.ts`), without
  request headers, cookies or bodies. Connect your host's log drain to an alerting tool.
- **`GET /api/health`** returns `{"status":"ok"}` (or 503) for uptime monitoring.
- **No third-party error-tracking SDK is installed.**

## M6 review

Two independent code reviews (authorisation/IDOR; input, auth, files and configuration) were run against the
codebase. Confirmed findings and their fixes:

| Finding | Fix |
|---|---|
| Offers could be sent for shifts of a project the user wasn't assigned to | Shifts must belong to the authorised project |
| Deleting a location/requirement could remove another project's requirements | Ownership checked before any change; child updates scoped to the project |
| PMs could edit any person's emergency contact | Same scope as viewing |
| Supervisors could verify people on a non-overlapping shift the same day | Shifts must overlap |
| Projects list and overview showed budget/pay totals beyond a PM's projects | Scoped to assigned projects; org-wide totals need the "all" grant |
| Any internal user could read or mark-read another project's staff messages | Requires `comms.manage` on the project |
| Staff could open a message thread on any project | Requires a booking on that project |
| Briefs downloadable by direct link indefinitely | Same 30-day window as the portal list |
| Internal users could record attendance on their own booking | Separation-of-duties check |
| MFA requirement not applied to download routes | Shared route guard |
| Suspending a staff profile didn't end their portal access | Account status and sessions follow the profile; suspended people can't accept or be confirmed for work |
| Rate-limit IP depended on proxy behaviour | `AUTH_IP_HEADERS` / `AUTH_TRUSTED_PROXIES` |
| Magic-link tokens stored in plain text | Stored hashed |
| Mail log could hold working sign-in links in production | `MAIL_TRANSPORT=log` refused in production unless explicitly allowed for demo/staging |
| Uploads without a declared size were buffered | Size required; `Sec-Fetch-Site` checked |
| CSP allowed inline scripts | Nonce-based CSP |
| `uuid` advisory (via ExcelJS) | Overridden to a fixed version |

Accepted for now:
- `npm audit` reports moderate advisories in `esbuild` via `drizzle-kit`. That's a development tool and isn't used
  by the running app.
- Password-reset and invitation links last 24 hours (single use), so new team members have time to accept.

## Before using real data (RGXM to complete)

- [ ] **Privacy officer:** legal/privacy review of the privacy notice (`/privacy`, marked draft), retention periods and the
      erasure scope. Appoint a privacy officer and publish their contact.
- [ ] **Accountant:** confirm worker classification (contractor vs employee) per person. Confirm the payroll and
      QuickBooks-style export layouts, and the ESA review points (3-hour rule, overtime, public holidays).
      GST/HST and self-billing are not implemented.
- [ ] **Hosting:** production deployment in a Canadian region (see DEPLOYMENT.md), with `NODE_ENV=production`,
      `MAIL_TRANSPORT=resend` and a verified sending domain.
- [ ] **Backups:** daily backups with point-in-time recovery enabled, and a restore drill performed and recorded.
- [ ] **Monitoring:** log drain and alerting connected; uptime check on `/api/health`.
- [ ] **Security test:** an external penetration test or security review of the deployed environment.
- [ ] **Staff accounts:** every Administrator and Finance user has two-step verification turned on (it's enforced),
      and the demo accounts don't exist in production (never run `db:seed` there).
