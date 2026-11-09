# Privacy operations runbook

How RGXM's Privacy Officer runs privacy in Crew: retention, legal holds, privacy requests, backups and
incidents. Periods and deadlines are RGXM's decisions, made with its lawyer. Crew doesn't assume statutory
numbers.

## Retention and scheduled deletion

**Settings → Privacy & retention** lists one policy per record category.

- **Set by RGXM:** every category except the three fixed ones below gets a retention period in days, or none
  ("keep until RGXM decides"). Each period needs an approval reference: who approved it and when.
- **Expired sessions and sign-in links:** always deleted when they expire.
- **Audit log:** never deleted. It is the accountability record, and Crew keeps personal details out of it
  automatically.
- **Work, pay, tax and bill records:** a *restricted archive*. Only Finance and Admins can see them, and
  they're never deleted automatically. When RGXM's approved period ends, deleting them is a manual,
  documented process (ask the developer to run it).
- **When it runs:** the scheduled runner (every 5 minutes in production) applies every category that has an
  approved period. The check-in location (90 days) and email-copy (30 days) periods ran before this register
  existed and keep running. Confirm or change them.
- **Deletion reports:** each run that removes or skips something is recorded on the same page, with counts.

## Legal holds

- **Placing a hold.** Place one on a person or a project when records may be needed for a dispute,
  investigation or legal process. While it's active:
  - scheduled deletion skips their records and counts the skips in the deletion report;
  - erasure (from a deletion request or the talent profile) is refused.
- **Releasing a hold** needs a reason. The next scheduled run then catches up.

## Privacy requests (access, correction, deletion)

All in **Privacy & incidents**.

1. **Log the request** when it arrives: who, how, when, and the linked contractor profile.
   - If RGXM has set a response period (Settings → Contractors & legal), the due date is calculated.
   - If not, there's no deadline and the screen says so. Set the period with your lawyer.
2. **Verify identity before disclosing or changing anything.** Record *how* you verified, for example "replied
   from the email on file and confirmed two recent shift dates". Never record ID numbers.
3. **Review every section** of the record:
   - profile and tax details;
   - internal notes;
   - evaluations;
   - messages;
   - files;
   - audit and email logs;
   - bookings, hours and payments.

   Tick each one off and note any redactions, for example information about other people.
4. **Access:** generate the access package.
   - It is a JSON file stored privately with a fingerprint. It contains everything Crew holds about the
     person, plus the notes, evaluations, file list and log entries for your review.
   - Download it, redact what's needed, and send the response through a secure channel. **Don't email it as a
     plain attachment.**
   - Record the method used.
5. **Correction:** make the change in the normal screens, for example the talent profile. Then record the
   response.
6. **Deletion:** recording the response runs the erasure.
   - **Refused** while there are upcoming shifts, unpaid pay or a legal hold.
   - **Kept:** work, pay and tax records (restricted archive), messages exchanged with RGXM, and the fact
     that erasure happened.
7. **Extensions:** record the new date, the reason, and that the requester was told.

Contractors can also download their own record any time from *My profile*.

## Backups and restores

Supabase takes the database backups. RGXM should confirm the following in Supabase and record it:

- **Backup type and retention:** daily backups, point-in-time recovery, and how long each is kept on RGXM's
  plan. Deleted personal data stays in backups until they expire. The privacy notice should say so; ask the
  lawyer.
- **Restore drill:** restore to a separate project at least once before launch, and then periodically. Record
  the date and the result.
- **After any restore:**
  1. Re-run the scheduled runner straight away (Settings has no button; the cron runs every 5 minutes). This
     re-applies retention periods to data that came back from the backup.
  2. **Re-apply erasures that happened after the backup was taken.** List them from the audit log (action
     `staff.anonymize`, or privacy requests responded to after the backup time) and erase those people again.
  3. Check legal holds are still correct.
  4. Record the restore in the incident register if it was caused by an incident.
- **File storage:** uploaded files are in a private Supabase Storage bucket. Check whether RGXM's plan backs
  up Storage separately and how long it keeps it.

## Vendors and data flows (verify and record)

| Vendor | What it holds or sees | Region | RGXM to confirm |
|---|---|---|---|
| Supabase | Database, file storage, backups, logs | Canada (Central) | Backup retention, log retention, support access, DPA |
| Vercel | Runs the app; request logs | US (Washington, D.C.) unless changed | Log retention, support access, DPA, function region |
| Resend | Outgoing emails (recipient, subject, body) | US | Retention of message content, DPA |
| GitHub | Code and CI; the release workflow connects to the database for migrations | US | Repository access list, Actions secrets |

Real contractor data must stay out of staging. Staging (`rgxm-staffing.vercel.app`) holds demo data only;
never copy production data into it.

## Incidents

Use **Privacy & incidents → Incidents** (Admins only), or record a reference to RGXM's own approved process.

- **What to record:** when it was detected, what happened (no unnecessary personal details), containment,
  roughly how many people are affected and which kinds of data, the risk assessment and its reasoning, when
  the Privacy Commissioner and individuals were notified (if they were), other notifications, and
  remediation.
- **Closing:** an incident can't be closed without a risk assessment and remediation.
- **Who decides:** whether there's a "real risk of significant harm", and who must be notified, is decided by
  the Privacy Officer with RGXM's lawyer, not by Crew.
