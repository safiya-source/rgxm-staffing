# Administrator guide

For RGXM's System Administrators. It covers setting up the team, the settings that matter, and routine
privacy and security tasks. Deployment is in DEPLOYMENT.md; the security model is in SECURITY.md.

## First day

1. **Sign in** from the invitation email and set a password of at least 12 characters.
2. **Set up two-step verification.** It's required for Administrators and Finance: you're taken to
   *Settings → My security* until it's on. Store the backup codes somewhere safe.
3. **Settings → Organisation:**
   - organisation name and accent colour;
   - check-in window and venue radius;
   - **Security & privacy**: two-step requirement (keep it on), and how long check-in locations and email copies are kept.
4. **Settings → Team & roles → Invite** each team member with their role(s):

| Role | Can |
|---|---|
| System Administrator | Everything, including users, settings, privacy requests and the mail log |
| Project Manager | Create projects. Manage shifts, briefs and offers on **their** projects. Approve hours on their projects (never their own). See those projects' budgets and payables |
| Staffing Coordinator | Talent directory, offers and bookings, communications on their projects. Import and export talent. No pay totals |
| Finance | Rates and pay setup, payables, payment batches, exports, mark paid, post-approval corrections |

   "Their projects" means projects where the person is the owner, the coordinator, or a project member
   (*Project → Setup → Team*). Give people the fewest roles they need.

5. **Field staff** don't need invitations. They join with a magic link at `/join` (or are imported by a
   Coordinator) and sign in with links sent to their email.

## Routine tasks

- **Someone leaves the team:** *Team & roles → ⋯ → Deactivate*. They're signed out immediately and their history is kept.
  At least one active administrator must remain.
- **Lost authenticator:** confirm who they are (phone or video call), then *Team & roles → ⋯ → Reset two-step verification*.
  They're signed out and set it up again at next sign-in. You can't reset your own; ask another administrator.
- **Suspend a field staff member:** *Talent → person → Status → Suspended*. This signs them out, blocks portal access,
  and stops them accepting offers or being confirmed. *Inactive* only means "not taking work"; they can still see
  their schedule and pay.
- **Pay classification:** each person is *unset* until Finance (or an admin) sets *contractor* or *employee*
  (*Talent → person → Pay setup*). People who are unset can't be paid. After classifying someone with approved
  hours, use *Payments → Refresh classifications*.
- **Audit log** (*Settings → Audit log*): who did what and when, including sign-ins, approvals, payment batches,
  exports, downloads, setting changes and privacy actions. It can't be edited.
- **Mail log** (*Settings → Mail log*): every email the system sent or suppressed, and delivery failures.
  Bodies are cleared after the retention period, and sign-in links are always redacted when real email is on.

## Privacy requests (PIPEDA)

RGXM's privacy officer is responsible for responding. Record the request (date, channel, how you verified the
person) before acting.

- **Access request:**
  - staff can download their own data from *My profile*;
  - for a fuller copy, open *Talent → person → Privacy requests → Download their data*;
  - internal notes and evaluations aren't in the export; review them and add them by hand if appropriate.
- **Correction:** edit the profile. Every change is in the audit log.
- **Deletion / withdrawal of consent:**
  1. Make sure they have no upcoming shifts, unapproved hours or unpaid pay. The system refuses until they don't.
  2. Use *Talent → person → Privacy requests → Erase personal details*, and enter the request details as the reason.
  3. Name, contact details, availability, skills, files, notes and evaluations are removed, and they're signed out.
  4. Work, pay and tax records stay, as the law requires. Messages with RGXM are kept as business correspondence.
  5. It can't be undone.
- **Retention** runs automatically: check-in locations are cleared after the configured days, and stored email
  bodies after theirs.

## Payments (Finance)

1. Approved hours appear in *Payments → Ready to pay*, split into **Contractors** and **Employees (payroll)**.
2. Create a batch (optionally for one pay period). This locks those hours.
3. **A second person** (Finance or admin) approves the batch.
4. Generate the export once: generic CSV, QuickBooks-style bills CSV (contractors) or Excel. Import it into your
   accounting or payroll system. The platform never sends money.
5. After paying, **Mark paid** with the date, and tick any payments that bounced (with a reason) so they can go
   into a later batch. Staff see "Paid" and get a notification.
6. Need a new file because the first was rejected and **not** used? Void the export with a reason, then generate
   again. If a batch was built wrongly and not paid, void the batch.

Payroll exports carry gross hours and pay only. Deductions and vacation pay are calculated by your payroll provider.
Items flagged "check the 3-hour rule" or "check overtime" are for review only; pay isn't changed automatically.

## Demo data

Seeded demo environments have the `@rgxm-demo.test` accounts, show "Demo" badges, never send email, and mark
demo payment exports "DEMO - DO NOT PAY". The two-step requirement is off there, and a banner in Settings says so.
Never seed a production database.
