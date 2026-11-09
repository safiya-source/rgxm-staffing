# Contractor compliance, tax and payments: what Crew does and what RGXM must decide

Crew handles **approved independent contractors** for non-construction event work: event staff, brand
ambassadors, load-in/setup staff and chefs. Employees go through a separate process; Crew has no payroll or
construction workflows.

This page covers four things:

- what the platform enforces;
- where each setting lives;
- which decisions belong to **RGXM**, its **accountant** or its **lawyer**;
- which features stay switched off until those decisions are recorded.

Crew never invents a policy. Every rate, treatment, retention period, deadline and document is data that
someone at RGXM enters and approves, with a reference to the approval.

> Status legend: **Built** = works now. **Waiting on decision** = built, but off or routed to a person until
> RGXM / the accountant / the lawyer records a decision. **Outside Crew** = must be done by RGXM or a vendor.

---

## 1. Contractor onboarding

| Requirement | How Crew does it | Status |
|---|---|---|
| Record approval for the contractor process (approver, date, optional assessment reference) | Talent → person → *Onboarding & compliance* → Record approval. Bulk approval is on the talent list. Revocation needs a reason; the history is kept (`contractor_approvals`). | Built |
| Approval required before accepting bookings | `confirmBooking` refuses without a current approval (Settings → Contractors & legal → *Require RGXM contractor approval*, on by default). | Built. **Before release, record approvals for current contractors** or confirmations will be refused. |
| Separate privacy acknowledgement, terms acceptance and optional consents | Three separate records: `staff_acceptances` (per document version), `staff_consent_events` (grant/withdraw history) and the approval above. | Built |
| Document versions, timestamps, acceptance history | `legal_documents` holds versioned drafts and approved versions. An approved version is frozen by a database trigger. A new version replaces the old one and must be accepted again. Acceptances are append-only. | Built. **Waiting on lawyer**: no approved privacy notice or contractor terms exist yet. Until one is approved, the portal shows the current draft notice and nothing blocks bookings. |
| Display the approved privacy notice and Privacy Officer contact | `/privacy` shows the approved version, or the draft marked "pending legal review" if none is approved. The Privacy Officer contact comes from Settings. | Built. **Waiting on RGXM**: appoint the Privacy Officer and enter their contact. |
| Optional profile fields clearly identified | Marked "(optional)" in the portal profile form. | Built |
| Optional consent choices | Only purposes approved by a lawyer and active are offered. One is seeded, inactive: "News and announcements from RGXM" (`marketing_email`). | **Waiting on lawyer** to approve the wording |
| Status evidence (e.g. WSIB) | Optional records: WSIB clearance, "coverage not required" confirmation, independent operator, business registration, insurance, other. Nothing requires them, and there is no blanket construction-clearance rule. | Built |

### RGXM's documents (added November 9, 2026)

- **Where the text lives:** `docs/legal/` holds the source text of the Privacy Policy (effective Nov 9, 2026),
  the Independent Contractor Agreement v1.0.0 and the Platform Terms of Use v1.0.0. Migration 0013 loads them
  into Crew as drafts for an administrator to approve.
- **Public pages:** they appear at `/privacy`, `/contractor-agreement` and `/terms`. Each page links to the
  others, lists the contacts and has a print/save button. The pages are also linked from sign-in and the
  portal profile.
- **Separate acceptances:** a contractor ticks each document separately. The wording follows the documents,
  for example "I agree to the Platform Terms of Use".
- **Contracting party:** for the Contractor Agreement, Crew records who it is with: the person, or a business
  plus the authorized representative accepting for it.
- **Contractor copies:** contractors keep a copy under *My profile → My agreements*: the exact version
  accepted, plus the acceptance record (contracting party, representative, version, date, record ID).
- **Shift pages:** each shift page shows the payment terms and the project's approved allowances, and links
  to the Contractor Agreement (§2 of the agreement).
- **Due dates:** they can follow the agreement's schedule. Work on the 1st–15th is due by month end; work on
  the 16th–end is due by the 15th of the next month.

## 2. Project-specific compensation

Each project has its own switches for meal allowances, per diems, mileage and bonuses (Project → Setup).
They are all **off by default**.

Initial rates (CAD):

| Item | Rate |
|---|---|
| Breakfast | $20 |
| Lunch | $25 |
| Dinner | $40 |
| Full-day per diem | $85 |
| Mileage | $0.73/km |
| Bonus | Any amount, with a reason |

You can change any of these per project.

- **Recorded per contractor, per work date and booked shift.** Each item is tied to a confirmed or completed
  booking.
- **No duplicates.**
  - A partial unique index allows one breakfast, one lunch, one dinner and one per diem per contractor per date,
    across all shifts and projects.
  - A trigger refuses a per diem combined with any meal allowance on the same date.
  - An advisory lock makes concurrent requests safe.
- **Mileage** records kilometres (up to 2 decimals), the trip date and the business purpose. The amount is
  `km × rate`, calculated with exact decimal arithmetic and rounded once to the cent (half up).
  For example, 123.45 km × $0.73 = $90.12.
- **Approval is required.** People with `compensation.approve` approve items: Admin, Finance, and the
  project's PM. Approval creates the item's own bill line.
- **Historical rates are kept.** Each item snapshots its rate and amount, and a trigger stops them changing.
  Later rate changes only affect new items.
- **Shown separately** in contractor statements, project budgets, payment batches, bank files, accounting
  exports and reports: hourly fees, meals/per diems, mileage, bonuses and taxes.
- **Tax and year-end treatment are set per category** (Settings → Tax & accounting → *Treatment by
  category*). Every category starts as "review", so **nothing assumes mileage or per diems are tax-free**.
  Tax is decided line by line; it is never added to the whole payment.

**Waiting on accountant:** sales-tax treatment and year-end treatment for each category.

## 3. GST/HST registration and automatic calculation

### Contractor side
- Contractors answer "Are you registered for GST/HST?" with **Yes / No / Unsure**. There is no tax-rate field
  anywhere.
- If they answer Yes, they also give:
  - the registered business name;
  - the registration number;
  - the date the registration took effect.
- Any change to the answer, the number or the date resets Finance's verification.
- **Finance verifies** each answer with evidence (Talent → person, permission `tax.verify_registration`).
  - Unknown, Unsure, unverified or rejected answers send every new line to **Finance review**.
  - A verified "No" means no tax.

### Calculation (`src/server/domain/tax-engine.ts`, unit-tested)
- **Project setup:** each project records its **event province**, **service category** and **supply type**
  (onsite / offsite / mixed / multi-province).
- **Tax is calculated automatically only if all of these hold:**
  - the org switch is on;
  - the category's treatment is accountant-approved and "taxable";
  - the service category is approved and set to "event province";
  - there is an approved, effective-dated rule for the event province on the work date;
  - the contractor is registered and verified, and their registration was in effect on the work date.
- **The event province decides the rate.** The contractor's address and live GPS are never inputs (there's a
  test for this).
- **Anything else goes to Finance:** offsite, mixed and multi-province work, unapproved categories, and
  missing rules. These lines show a **Finance review** status and **cannot be batched** until resolved.
- **Separate components:** GST, HST, QST and PST each get their own line, with the rate stored in parts per
  million (so 9.975% is exact).
- **What each bill line stores** (`payable_tax_lines`, append-only):
  - jurisdiction, component, rate, service category;
  - taxable amount, tax amount;
  - the rule used and the decision basis in words.
- **History is preserved.** Retiring a rule or changing a profile never changes a finalized line. Lines that no
  longer match the person's answer must be refreshed before batching.
- **Finance corrections before finalization:** Finance can redo a line's tax by choosing configured rules
  (never a free-typed rate), with an audited reason. After export or payment, corrections are linked
  adjustments.
- **Contractor invoices:** Finance records an invoice against a bill. Crew flags any difference from the
  expected tax or subtotal for review; it never changes anything automatically.
- **Contractor display:** each line shows the fee breakdown, tax name, jurisdiction, rate, tax amount and
  total. "Tax details incorrect? Request a review." opens a request to Finance.

**Blocked until the accountant approves:** service categories, tax rules, category treatments and the
rounding method (Crew rounds each component half-up to the cent per line). Then Finance turns on
*Automatic calculation* with the approval reference.

- **Until then**, every registered contractor's line goes to Finance review, and Finance decides each one.
- **Seeded as drafts:**
  - Ontario HST 13%, the rate Crew used before;
  - three service categories: onsite event staffing, load-in/setup, and chef services. Chef services is set to
    "always Finance".

> Existing payables keep their previous amounts. They are labelled `legacy_hst` / `legacy_none`, with a
> "Legacy" tax line where HST was added.

## 4. Bills, payments and approvals

| Record | Table | Notes |
|---|---|---|
| Approved work | `timesheets` (approved), `compensation_items` (approved) | Keeps booked rate, approved minutes, breaks, compensation and project |
| Bill lines | `payable_items` | One per shift fee / allowance / mileage / bonus / adjustment. Amounts, tax and allocation are immutable (trigger). |
| Bills | `bills` | One per contractor, numbered `CRW-B-000001`, **finalized when the bank file is exported**. Immutable; status open → paid. |
| Payment batches | `payment_batches` | Creator ≠ approver (app and DB check). |
| Bank payment attempts | `payment_batch_items` | `included → exported → submitted → settled / failed / returned / bank_cancelled` (plus `removed`, `voided`) with bank reference, evidence, reconciler and date |

- **One active batch per line.** A partial unique index plus row locks mean concurrent requests can't put the
  same line in two batches (tested with 4 parallel requests).
- **Approval is invalidated on change.** Approval fingerprints the recipients, amounts, payment details and
  lines. Any change before export cancels the approval: the batch goes back to draft and must be approved
  again. Removing a line from an approved batch does the same.
- **Exporting never settles.** Exported lines show "Sent to bank" at most. Settlement needs a date and bank
  evidence (for example a statement line), recorded per line or for the whole batch.
- **Manual reconciliation.** There is no bank integration, so reconciliation is manual and audited: Finance
  records the submission (date and bank reference), then each outcome.
- **Retries** go against the same bill and line, so a retry creates no new expense and no new accounting
  export.
- **Returns:** a settled line that the bank later returns goes to `returned`, and its line becomes payable
  again.
- **Crew void vs bank cancellation:**
  - a *Crew void* is only allowed before the file is submitted to the bank;
  - after submission, Finance records a *bank cancellation* with the bank's reference.
- **Corrections after export or payment** use linked adjustments or credits. These are new lines pointing at
  the original, with the same tax components. The original line and bill never change. A credit can only be
  paid out by netting it against other lines for the same person in a batch.
- **Contractor view:** contractors see their payment breakdown and can request a pay or tax review. Finance
  sees open requests under Payments → Reviews.
- **Cutoffs and due dates** come from RGXM-approved payment terms (Settings → Contractors & legal).
  - **Until terms are approved**, a bill's due date equals its bill date and is flagged "terms not approved".

## 5. Accounting exports and reports

- **Separate from bank files.** Accounting exports (Payments → Accounting) are separate from bank files.
  Bank files no longer include the QuickBooks layout.
- **Stable mappings.** Each contractor has a stable supplier reference (`CRW-S-000001`), plus an optional
  supplier ID from the accounting system. Bill numbers are stable.
- **Configurable** (Settings → Tax & accounting):
  - accounts per category;
  - tax codes per tax decision (`none`, `HST:ON`, `GST:QC+QST:QC`, …);
  - currency.
  - Bill dates and due dates come from the bill.
  - A tax decision with no configured code stops the export.
- **One row per line**, with project code and client (the allocation).
- **Duplicate protection.**
  - A bill can be in only one live export (unique index).
  - Finance marks each export *imported* or *rejected*. Rejecting one frees its bills for a new export.
- **Format not yet confirmed.** Until Finance ticks *validated with our accounting system*, accounting exports
  carry a warning. The column layout follows QuickBooks Online's bill import. **RGXM must test an import in
  its real system.**

**Reports** (Reports → Finance):

- project and client costs by category, with tax split into recoverable, non-recoverable and unconfirmed;
- budget variance;
- approved work not yet billed (including approved timesheets missing a line);
- outstanding bills;
- failed and returned payments;
- unreconciled items, including settlements recorded before bank evidence existed;
- the tax review queue.

Tax recoverability is a Settings choice per component, confirmed by the accountant. It starts as
"unconfirmed", and budgets count unconfirmed tax as a cost.

## 6. Year-end reporting

Payments → Year-end, plus a CSV for the accountant.

- **Settled payments only.** Built only from settled payments, by settlement date in Toronto. Returned payments
  appear as reversals in the year they were returned.
- **Kept separate:** fees, meal allowances, per diems, mileage, bonuses, adjustments, reversals and sales tax.
- **Box 048 candidates** exclude GST/HST/QST. Hourly fees are always candidates. Other categories count only if
  the accountant approved "box 048". Otherwise they are listed as "needs accountant decision".
- **Threshold flag:** set in Settings, default $500, to be confirmed by the accountant.
- **Inclusion decisions are recorded per person**, with a reason. Nobody is excluded automatically.
  Contractors with a business number are flagged "check incorporation", not excluded.
- **Tax identity:** Crew records only that the accountant has received the person's tax identity
  information. It refuses notes that look like a SIN and never stores SINs.
- **Snapshots** freeze the totals handed to the accountant (draft → handed off → filed). Later changes are
  flagged per person, and the year is marked for **amendment review**.

## 7. Location and privacy workflows

- **Location:**
  - collected only on venues set to require it, and only when the contractor taps check in or out;
  - never in the background;
  - explained before the browser asks for permission, including how long it is kept;
  - if it's denied or inaccurate, the shift is flagged for manual review; check-in and payment are never
    blocked.
- **Retention by category** (Settings → Privacy & retention):
  - **Set by RGXM:** check-in locations, email copies, inactive profiles, internal notes, evaluations,
    messages and uploaded files.
  - **Fixed:** expired sessions are always removed. Audit log is "not deletable" and minimised. Financial
    records are a "restricted archive", never deleted automatically.
  - **What runs:** only categories with an RGXM-approved period are deleted.
  - **Existing periods kept:** the two periods that existed before (90 days for locations, 30 days for
    email copies) keep running, labelled as not yet approved. **Confirm or change them.**
- **Legal holds** pause scheduled deletion and erasure for a person or a project.
- **Deletion reports** record every run.
- **Privacy requests** (Privacy & incidents): access, correction and deletion.
  - **Deadline:** set from RGXM's configured response period. With no period configured there is no deadline,
    and the screen says so.
  - **Before responding:** the requester's identity must be verified, and every section must be reviewed
    (profile, notes, evaluations, messages, files, logs, payments), with redaction notes.
  - **Access responses** are a private, fingerprinted access package that includes internal notes,
    evaluations, file list and audit entries for review. It's downloaded by the Privacy Officer, never
    emailed.
  - **Deletion responses** run the erasure. A legal hold refuses it.
- **Audit logs** replace personal details (names, emails, phones, addresses, tax numbers, coordinates,
  requester details) with `[redacted]` automatically.
- **Backups and restores:** see `docs/PRIVACY_OPERATIONS.md`.

## 8. Security

- **Two-step verification for all RGXM staff.** Every staff account must enrol, not only Admin and Finance
  (`requireMfaForStaff`, on by default). Contractors are out of scope.
- **Trusted devices** last 14 days, by opt-in at sign-in. A code is still needed for:
  - new or untrusted devices;
  - expired sessions;
  - **suspicious sign-ins**, meaning a network and browser combination the person hasn't used before. These
    revoke all remembered devices. Only salted hashes are stored.
- **Fresh authentication** (a code within the last 10 minutes) is needed for payment approval, export,
  submission, settlement, returns, adjustments, tax overrides, and changes to tax or payment details.
- **Unchanged and still in place** from earlier work:
  - server-side permission checks;
  - contractor isolation (tested);
  - private file downloads;
  - no real data in staging (it holds demo data only).
- **New permissions** (all least-privilege):
  - `contractor.approve`;
  - `legal.manage`;
  - `incidents.manage`;
  - `tax.configure`;
  - `tax.verify_registration`;
  - `accounting.manage`;
  - `compensation.configure`, `compensation.record`, `compensation.approve`;
  - `reports.finance`.

**Outside Crew (RGXM to do and record before launch):**

- verify actual vendor data flows, hosting regions, logs, backups and support access;
- run a backup restore test;
- get an independent security review and resolve material findings.

See `docs/SECURITY.md`.

## 9. Operational controls

- **Incident register** (Privacy & incidents → Incidents), restricted to admins. It records:
  - detection and containment;
  - estimated people affected and data categories;
  - the risk assessment and its rationale;
  - notification dates;
  - remediation.
  - An incident can't be closed without a risk assessment and remediation. If RGXM has its own approved
    process, record its reference here.
- **Email categories:**
  - *Essential* emails (about accepted work, pay, account or security) are always sent.
  - *Shift-opportunity* emails (offers) can be switched off by the contractor; the in-app notice still
    appears.
  - *Marketing* emails need recorded consent to an approved purpose. No marketing emails exist yet.
- **WSIB / status evidence** is optional per contractor (see §1).
- **Unsupported provincial setups** are flagged on the project and routed to Finance review rather than
  calculated.

---

## Migration

`0012_compliance_foundation` is **additive**:

- new tables and new nullable or defaulted columns;
- `payable_items.timesheet_id` loosened to nullable;
- updated triggers;
- seed rows;
- row-level security on the new tables.

It **backfills** without changing any amount:

- GST/HST answers: registered → Yes; not registered with tax details saved → No; otherwise Unknown;
- legacy tax labels and tax lines on existing payables;
- explicit states on existing batch items. Batches marked paid become settled, with evidence "Marked paid in
  Crew by Finance (before bank reconciliation was recorded)"; reports flag them;
- the old batch-level QuickBooks exports, marked `accounting_legacy`.

Release order:

1. Apply the migration to production (GitHub → *Production database* workflow).
2. Then merge the release PR (main → production).

The old code ignores the new columns, so the migration can go first safely.

## Decisions needed before switching things on

| Who | Decision | Where it's recorded |
|---|---|---|
| RGXM | Record contractor-process approvals for existing contractors (bulk on the Talent list), with the external assessment reference | Talent |
| RGXM | Appoint a Privacy Officer; enter their contact | Settings → Contractors & legal |
| Lawyer | Approve the privacy notice and contractor agreement / platform terms (paste the final text, record the review) | Settings → Contractors & legal |
| Lawyer | Approve optional consent wording (or leave none) | Settings → Contractors & legal |
| RGXM + lawyer | Retention period per category; privacy-request response period; confirm the existing 90/30-day periods | Settings → Privacy & retention / Contractors & legal |
| Accountant | Service categories and their place-of-supply rule; tax rules per province with dates; rounding; treatment per compensation category (GST/HST and year-end box); tax recoverability | Settings → Tax & accounting |
| Accountant | Accounts, tax codes and currency for the accounting import; test an import and tick "validated" | Settings → Tax & accounting |
| Accountant | Year-end threshold, box treatment, inclusion decisions per contractor | Settings → Tax & accounting; Payments → Year-end |
| RGXM | Payment cutoffs and due-date terms | Settings → Contractors & legal |
| Finance | Verify each contractor's GST/HST answer | Talent → person |
| RGXM | Vendor data-flow review, backup restore test, independent security review | docs/SECURITY.md checklist |
