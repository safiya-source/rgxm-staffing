ALTER TABLE "legal_documents" DROP CONSTRAINT "legal_documents_kind";--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "privacy_officer_address" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "support_email" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "finance_email" text;--> statement-breakpoint
ALTER TABLE "staff_acceptances" ADD COLUMN "acting_for" text;--> statement-breakpoint
ALTER TABLE "staff_acceptances" ADD COLUMN "contracting_party" text;--> statement-breakpoint
ALTER TABLE "staff_acceptances" ADD COLUMN "authorized_representative" text;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_kind" CHECK (kind in ('privacy_notice', 'contractor_terms', 'platform_terms'));--> statement-breakpoint
ALTER TABLE "staff_acceptances" ADD CONSTRAINT "staff_acceptances_acting_for" CHECK (acting_for is null or acting_for in ('self', 'business'));--> statement-breakpoint
ALTER TABLE "staff_acceptances" ADD CONSTRAINT "staff_acceptances_party" CHECK (kind <> 'contractor_terms' or method = 'recorded_by_rgxm' or length(trim(coalesce(contracting_party, ''))) > 0);--> statement-breakpoint

-- RGXM's documents (source: docs/legal/*.md), loaded as DRAFTS. An administrator approves each one in
-- Settings → Contractors & legal, recording the approval; from then on contractors must accept it.
INSERT INTO legal_documents (kind, version, title, body, summary_of_changes, status)
VALUES ('privacy_notice', '2026-11-09', 'RGXM Crew Privacy Policy', $legal$## 1. About RGXM Crew

RGXM Crew is operated by RGXM Inc., located at Unit A - 6975 Pacific Circle, Mississauga, ON L5T 2H3 (“RGXM,” “we,” “us”).

We use Crew to manage contractor profiles, event opportunities, bookings, attendance, approved work and contractor payment preparation. This policy explains how we collect, use, share, protect and retain personal information in connection with Crew.

## 2. Information we collect

### Profile and contact information

We collect your name, preferred name, email address, mobile number, city, province, work roles, experience, availability, willingness to travel, and whether you have a driver’s licence or vehicle.

You may choose to provide a profile photo, résumé, certifications and emergency contact. Please inform your emergency contact before providing their information and provide only what is requested.

### Bookings, work and payment records

We collect shift offers and responses, bookings, check-in and check-out times, submitted and approved hours, breaks, agreed rates, adjustments, payment amounts and payment status.

Where applicable, records may also include approved meal allowances, per diems, mileage, bonuses and associated supporting information.

### Tax and business information

We collect your legal name, business name, mailing address, business number and GST/HST or other applicable tax registration information. We may verify registration information using government services.

Crew does not collect or store Social Insurance Numbers. Where required for tax reporting, our accountant collects that information directly through a separate process.

### Communications and internal records

We keep communications between you and RGXM, relevant internal notes, post-event evaluations and records of administrative actions.

We also collect technical information needed to operate and secure Crew, such as sign-in times, IP addresses, browser information and activity logs.

### Location at check-in or check-out

For activations that require location verification, Crew requests your device location when you initiate check-in or check-out. We use it to help confirm that you are at the activation site.

Crew does not continuously track your location or collect background location.

You control device permission through your browser or device settings. If location cannot be provided or appears inaccurate, contact staffing@rgxmagency.com or your assignment contact for assistance.

## 3. How we use information

We use personal information to:

- Create and manage your contractor profile.
- Assess suitability and availability for event opportunities.
- Offer shifts and administer bookings.
- Coordinate event work and communicate operational information.
- Verify attendance and review submitted hours.
- Calculate and approve compensation, applicable taxes and adjustments.
- Prepare payment files and accounting records, track payment status and support tax reporting.
- Review performance and suitability for future assignments.
- Respond to questions, disputes and privacy requests.
- Secure the platform, investigate incidents and maintain accountability.
- Meet legal obligations and establish, exercise or defend legal claims.

If we propose a materially different use requiring consent, we will explain that use and obtain the required consent before proceeding.

## 4. Your choices

We identify optional information where it is requested. Choosing not to provide optional information does not prevent you from creating a profile, although particular assignments may require relevant qualifications or information.

Some information is necessary to administer bookings, verify work, prepare payments or meet legal obligations. If you decline to provide it, we will explain any resulting limitations.

You may contact us to withdraw consent to processing that relies on consent, subject to legal or contractual restrictions and reasonable notice. We will explain the consequences. Withdrawal does not require us to delete records we must lawfully retain.

## 5. Who receives information

Authorized RGXM staff access information according to their responsibilities. Rates, tax information and other sensitive records are restricted to those who need them.

We use service providers to host Crew, store information, deliver email and support our operations. Our accountant, professional advisors and payment or banking providers may receive information needed to perform their services.

Contractors do not have access to other contractors’ profiles, rates or tax information.

We may also disclose information where required or permitted by law, including to respond to lawful requests or protect legal rights.

## 6. Where information is processed

Crew’s primary database and file storage are hosted through Supabase in its Canada Central/Montréal region.

Some service providers process information outside Canada. These include Vercel for website hosting and request processing and Resend for email delivery, which involve processing in the United States.

Information processed outside Canada may be subject to the laws of that jurisdiction, including lawful access by courts, law enforcement or government authorities.

We remain responsible for personal information under our control and use contractual and other safeguards appropriate to the services provided.

## 7. How long we keep information

We retain information for the purposes described in this policy and to meet applicable legal, accounting and dispute-resolution requirements.

Our retention schedule includes:

- **Check-in/check-out coordinates:** Deleted after 90 days. Attendance times may remain as work records.
- **Routine copies of sent email bodies:** Deleted after 30 days. Substantive communications needed for bookings, payments or disputes may be retained separately.
- **Work, payment and tax records:** Generally retained for at least six years from the end of the relevant tax year, or longer where required.
- **Profiles, résumés, certifications and availability:** Retained while needed for the contractor relationship and according to our inactive-profile schedule.
- **Messages, evaluations, notes and audit logs:** Retained according to their operational, security or legal purpose.

We may suspend deletion where information is needed for an outstanding request, dispute, investigation or legal obligation.

When information is no longer required, we delete it or render it appropriately anonymous. Deleted information may remain in restricted backups until those backups expire under our backup schedule.

## 8. Access, correction and deletion

You may request access to personal information we hold about you, ask us to correct inaccurate information or request deletion by contacting Safiya Abbadi at safiya@rgxmagency.com.

Where available, you can also update profile information or download information through Crew. These features do not limit your ability to contact us about other records.

We may need to verify your identity before responding. We review requests under applicable law and explain any permitted exceptions, redactions or retained records.

Closing an account or requesting deletion does not automatically remove financial records, evidence of transactions or other information we must retain. We will explain what remains and why.

Under PIPEDA, we generally respond to access requests within 30 calendar days, subject to permitted extensions.

For account closure or platform support, contact staffing@rgxmagency.com. Account closure and deletion of personal information are separate processes; a closure request does not automatically delete all records.

## 9. Security

We use administrative, technical and physical safeguards appropriate to the information, including access restrictions and security controls.

No online system can guarantee absolute security. Please protect your account credentials and promptly report suspected unauthorized access to staffing@rgxmagency.com.

Do not send Social Insurance Numbers, bank credentials or other sensitive financial information by ordinary email.

## 10. Cookies and similar technologies

Crew uses Supabase, Vercel, and GitHub to support sign-in, session management and security.

## 11. Changes to this policy

We may update this policy as our practices change. We will post the revised policy with its effective date and provide additional notice or obtain consent where required.

## 12. Contact and complaints

For privacy questions, access or correction requests, deletion requests or complaints, contact:

Safiya Abbadi, Privacy Officer
RGXM Inc.
Unit A - 6975 Pacific Circle
Mississauga, ON L5T 2H3
Email: safiya@rgxmagency.com

For platform support or account closure: staffing@rgxmagency.com.

We will review privacy concerns and respond through our privacy complaint process.

You may also contact the Office of the Privacy Commissioner of Canada or the applicable provincial privacy regulator.$legal$, 'First published version.', 'draft')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO legal_documents (kind, version, title, body, summary_of_changes, status)
VALUES ('contractor_terms', '1.0.0', 'RGXM Independent Contractor Agreement', $legal$This Agreement is between:

RGXM Inc., of Unit A - 6975 Pacific Circle, Mississauga, ON L5T 2H3 (“RGXM”); and

the individual or business identified as the contracting party in the acceptance record (“Contractor”).

If accepting for a business, the person accepting confirms that they are authorized to bind that business.

## 1. Purpose and assignments

RGXM engages contractors to provide services for non-construction event projects, including event staffing, brand representation, event setup and load-in, culinary services and related work.

This Agreement establishes general terms. Each accepted assignment is a separate engagement governed by this Agreement and its written assignment confirmation.

RGXM is not required to offer assignments, and the Contractor is not required to accept them. No minimum hours, income or ongoing engagement is guaranteed.

The Contractor may provide services to other clients, subject to confidentiality obligations and commitments already accepted.

## 2. Assignment confirmation

Before acceptance, each assignment confirmation will identify:

- The contracting party and assigned service provider.
- Services, location, date and expected hours.
- Agreed hourly rate or other fee.
- Applicable payment terms.
- Any approved travel, mileage, meal allowances, per diem or bonus.
- Required qualifications, equipment, clothing and site instructions.
- Applicable cancellation terms and any minimum fee or guaranteed hours.

Material changes to an accepted assignment require agreement. Neither party may retroactively change the agreed rate for work already performed.

An assignment confirmation overrides this Agreement only where it expressly identifies the provision being varied. Mandatory legal rights remain unaffected.

## 3. Performance of services

The Contractor will:

- Perform accepted services competently and professionally.
- Maintain qualifications and authorizations required for the services.
- Meet agreed attendance and service commitments.
- Follow lawful site-access, safety, security, food-handling and client-brand requirements communicated for the assignment.
- Promptly report delays, inability to attend, hazards, incidents and material service issues.
- Submit accurate work and compensation records.

Subject to agreed deliverables and lawful site requirements, the Contractor is responsible for their methods of performing the services.

A proposed substitute must be approved in advance where qualifications, security, client commitments or site access require approval. RGXM will not unreasonably withhold approval of a suitably qualified substitute where substitution is appropriate to the assignment. The parties must document who is supplying and being paid for the services.

## 4. Fees, time records and payment

The Contractor will submit accurate records of work, breaks and other approved compensation through Crew or an agreed alternative.

Only breaks actually taken and agreed to be unpaid may be deducted. Attendance records, including GPS information, are evidence for review and are not the sole basis for determining payment.

RGXM will review submissions promptly. Any adjustment will include a reason and remain visible in the record. The Contractor may dispute an adjustment by contacting safiya@rgxmagency.com.

RGXM’s processing periods are the 1st–15th and 16th–last day of each month. Undisputed amounts are payable by the last day of each month and by the 15th day of each month.

RGXM’s client paying late or failing to pay does not excuse RGXM from paying amounts owed under this Agreement.

If part of a submission is disputed, RGXM will pay the undisputed portion when due and work with the Contractor to resolve the balance. Missed administrative cutoffs do not extinguish an otherwise valid payment entitlement.

Payments are in Canadian dollars unless agreed otherwise.

## 5. Meals, per diems, mileage and bonuses

These payments apply only where expressly authorized in the assignment confirmation or subsequently approved in writing.

Unless the assignment states otherwise, authorized rates are:

- **Breakfast allowance:** $20
- **Lunch allowance:** $25
- **Dinner allowance:** $40
- **Full-day per diem:** $85
- **Mileage:** $0.73 per approved kilometre

A full-day per diem cannot be combined with individual meal allowances for the same day. The same meal cannot be claimed more than once across assignments.

The assignment confirmation must specify eligible meals or days, including how provided meals affect eligibility.

Mileage requires approval of the eligible trip or route and an accurate kilometre record. Ordinary commuting is not reimbursable unless expressly approved.

A bonus applies only when its amount or calculation and eligibility conditions have been communicated and approved. Once earned under those conditions, it forms part of the amount payable.

Other expenses require advance written approval, including any documentation requirements.

Tax and reporting treatment follows applicable law. Describing a payment as an allowance, reimbursement, mileage payment or bonus does not make it tax-free.

## 6. Taxes and supporting information

The Contractor will provide accurate legal, business and applicable tax-registration information and promptly report changes.

Applicable GST/HST or other sales tax will be added where legally required. The parties will cooperate to resolve differences between an invoice and Crew’s calculated tax before finalization.

The Contractor is responsible for their own tax filings and remittances to the extent required by law. RGXM remains responsible for obligations legally imposed on RGXM, including applicable information reporting and any required withholding.

Crew does not collect Social Insurance Numbers. Where needed for reporting, the Contractor will provide required tax identity information through the separate secure process designated by RGXM or its accountant.

Tax and payment questions should be directed to safiya@rgxmagency.com. Social Insurance Numbers and sensitive banking information must not be sent by ordinary email.

## 7. Independent business relationship

The parties intend a contract for services rather than an employment relationship. The Contractor has no authority to bind RGXM or its clients unless expressly authorized.

This intention does not override the actual relationship or applicable law. Nothing in this Agreement waives employment standards, safety, human rights or other protections that legally apply.

If the arrangement requires a different legal treatment, the parties will cooperate to correct the process and records.

## 8. Safety, conduct and coverage

Both parties will comply with their applicable legal duties.

The Contractor will promptly report unsafe conditions and will not undertake work they are unqualified or unauthorized to perform. Nothing requires anyone to continue unsafe work or limits applicable reporting or work-refusal rights.

Harassment, discrimination, violence, theft and impairment that compromises safe performance are prohibited.

Before an assignment, RGXM will identify any required insurance, workers’ compensation evidence or role-specific certification. Required evidence must be relevant to the assignment.

The Contractor will notify RGXM of material changes affecting their ability to lawfully or safely perform accepted services.

## 9. Cancellation and inability to perform

A party unable to proceed will notify the other promptly and take reasonable steps to reduce disruption.

The assignment confirmation must state cancellation notice requirements and any cancellation payment. RGXM may not impose an undisclosed cancellation penalty.

If RGXM cancels after services have begun, it will pay for services performed, approved non-cancellable expenses and any applicable cancellation or minimum payment.

Unless expressly agreed in an accepted assignment confirmation, cancelling an assignment does not make future unperformed hours payable.

No automatic deduction or forfeiture of earned fees applies because of a cancellation, complaint or alleged loss.

## 10. Confidentiality and personal information

The Contractor will protect non-public client, campaign, event, business and personal information obtained through the engagement and use it only to perform the services.

This does not restrict information already lawfully public, independently obtained or developed, or disclosures required by law. It does not prohibit obtaining professional advice or reporting misconduct to an appropriate authority.

The Contractor will not retain or disclose attendee lists, credentials, contractor records or other personal information except as authorized.

RGXM handles the Contractor’s personal information as described in the Crew Privacy Policy. Optional uses requiring consent will be addressed separately.

Privacy questions and requests may be directed to:

Safiya Abbadi, Privacy Officer
RGXM Inc.
Unit A - 6975 Pacific Circle
Mississauga, ON L5T 2H3
safiya@rgxmagency.com

## 11. Materials, content and publicity

Each party retains ownership of materials and intellectual property it owned before the assignment.

The Contractor grants RGXM permission to use assignment records and ordinary operational materials supplied by the Contractor as reasonably necessary to administer and document the engagement.

If an assignment involves creating campaign content or other intellectual property, the assignment confirmation must specify the required ownership or licence terms before acceptance.

This Agreement does not authorize promotional use of the Contractor’s image, voice or likeness. Any such use requires a separate release describing the intended use.

The Contractor may not publish confidential campaign content or use RGXM/client branding without permission.

## 12. Ending the relationship

Either party may end this framework Agreement by written notice. Notices to RGXM may be sent to staffing@rgxmagency.com.

Ending this Agreement does not automatically cancel accepted assignments; those must be completed or cancelled under their applicable terms.

RGXM may immediately restrict site or platform access where reasonably necessary to address safety, security, fraud or serious misconduct concerns.

Ending access does not remove payment obligations for services already performed or prevent the Contractor from obtaining payment records or raising a dispute through an alternative contact.

Confidentiality, accrued payment obligations and provisions intended to continue survive termination.

## 13. Responsibility for losses

Each party remains responsible for losses caused by its own breach, negligence or wilful misconduct to the extent established under applicable law.

RGXM may not deduct an alleged loss from earned fees without a lawful basis and appropriate authorization or determination.

Neither party assumes the other’s statutory obligations merely by signing this Agreement.

## 14. Disputes and governing law

The parties will first attempt to resolve service or assignment disputes through staffing@rgxmagency.com, and financial disputes through safiya@rgxmagency.com.

Either party may seek urgent relief or contact an applicable regulator or tribunal without completing this informal process.

Subject to mandatory laws and jurisdictional rights, this Agreement is governed by Ontario law and applicable Canadian federal law. Proceedings may be brought before a court or tribunal with lawful jurisdiction.

No mandatory arbitration or class-action waiver is created by this Agreement.

## 15. General terms and electronic acceptance

This Agreement, accepted assignment confirmations and expressly incorporated documents form the agreement for the services.

Crew’s Platform Terms govern platform use. They do not override agreed fees, payment obligations or this Agreement’s service terms.

Changes to this Agreement apply prospectively after notice and acceptance. They do not retroactively alter completed work or accepted assignments without agreement.

If a provision is unenforceable, the remaining provisions continue to the extent legally possible.

Acceptance through an identified Crew account or another agreed electronic method records agreement to the version presented. Each party must be able to retain a copy.

RGXM contracting entity: RGXM Inc.

The Contractor’s legal name or entity, any authorized representative, the agreement version, and the acceptance date and record are recorded by Crew at acceptance and shown with the Contractor’s copy of this Agreement.$legal$, 'First published version.', 'draft')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO legal_documents (kind, version, title, body, summary_of_changes, status)
VALUES ('platform_terms', '1.0.0', 'RGXM Crew Platform Terms of Use', $legal$These Terms govern access to RGXM Crew at crew.rgxmagency.com, operated by RGXM Inc., of Unit A - 6975 Pacific Circle, Mississauga, ON L5T 2H3 (“RGXM,” “we,” “us”).

“You” means the person using the account and, where applicable, the business they are authorized to represent.

## 1. Purpose and relationship to other documents

Crew supports contractor profiles, event opportunities, assignment acceptance, attendance, work approval and payment administration.

Your Independent Contractor Agreement and accepted assignment confirmations govern services and compensation. These Terms govern platform use.

If these Terms conflict with an agreed service or payment term, the Independent Contractor Agreement and assignment confirmation prevail. The Privacy Policy explains how personal information is handled.

Creating an account does not guarantee approval, assignments, hours or income.

## 2. Accounts and eligibility

Provide accurate information and use the account only for yourself or a business you are authorized to represent.

Do not create duplicate accounts to bypass restrictions or allow another person to perform work using your identity. Approved substitutes must follow RGXM’s assignment process.

Keep contact, qualification, business and tax-registration information current.

Use a strong password, protect sign-in credentials and promptly report suspected unauthorized access to staffing@rgxmagency.com. Follow any security verification reasonably required for your account.

## 3. Opportunities and booking acceptance

Review the role, location, time, rate, required qualifications and compensation conditions before accepting an assignment.

A displayed opportunity is not a confirmed booking until the stated acceptance/confirmation process is complete.

Once confirmed, changes follow the Independent Contractor Agreement and assignment terms. A platform update alone does not retroactively change an agreed rate.

## 4. Accurate submissions and review

Submit truthful attendance, hours, breaks, mileage, allowances, qualifications and supporting information.

Do not submit duplicate claims, claim another person’s work, falsify location or manipulate approval records.

You may review your records and request correction. RGXM will retain appropriate adjustment history.

Crew may calculate proposed fees and taxes, but errors can occur. Report financial discrepancies to safiya@rgxmagency.com and platform issues to staffing@rgxmagency.com.

A software calculation does not replace applicable law or the parties’ agreement.

## 5. Tax information

Identify whether you are registered for GST/HST and provide accurate registration details where applicable.

Crew uses approved rules and project information to calculate applicable tax. You do not select an unrestricted tax percentage.

If you believe the calculation is incorrect, request Finance review at safiya@rgxmagency.com before finalization or submit the relevant invoice and explanation.

Tax registration, platform calculations and payment statements do not constitute individualized tax advice.

## 6. Location features

Certain activations request device location when you initiate check-in or check-out. Crew does not continuously track your location.

Review the location notice before granting permission. Browser permission can be managed through your device settings.

If permission is denied, GPS is inaccurate or your device fails, contact staffing@rgxmagency.com or the assignment contact for an alternative attendance-review process.

Location failure alone does not determine your payment entitlement.

The Privacy Policy describes location handling and retention.

## 7. Payment information and records

Crew prepares and records payments; it does not itself transfer funds.

“Exported” or “submitted” does not necessarily mean funds have reached your account. Payment status is subject to reconciliation and correction.

Submit banking information only through RGXM’s designated secure process. Do not put bank credentials, Social Insurance Numbers or payment-card details into messages, general attachments or ordinary email.

Report payment-detail changes through the approved verification process. Contact safiya@rgxmagency.com for instructions without including sensitive financial information in the email.

## 8. Acceptable use

You must not:

- Access another person’s account or information without authorization.
- Attempt to bypass permissions or security controls.
- Introduce malware or deliberately disrupt the platform.
- Scrape or bulk-download information without authorization.
- Upload unlawful material or content you lack permission to provide.
- Use Crew to harass, threaten, discriminate against or impersonate others.
- Publish confidential client, campaign or personal information.
- Use platform information for unrelated solicitation or marketing.

Report suspected security weaknesses privately to staffing@rgxmagency.com. Do not test against real contractor data or disrupt services without written authorization.

## 9. Uploaded materials and platform ownership

You retain rights in your profile photo, résumé and other materials you upload.

You grant RGXM a limited permission to host, store, reproduce and process those materials to operate Crew and administer the contractor relationship, consistent with the Privacy Policy and your choices.

Uploading a photo does not grant permission for advertising or unrelated public promotion.

RGXM and its licensors retain rights in Crew’s software, design and platform materials. You receive permission to use Crew for its intended purpose while your access remains authorized.

## 10. Communications and electronic records

Crew may deliver assignment confirmations, operational notices, payment information and agreement records electronically through the platform or your provided contact details.

Keep your contact information current and review notices relating to accepted assignments.

Marketing preferences are handled separately where applicable. Accepting these Terms does not by itself provide blanket marketing consent.

You may retain copies of accepted agreements and payment records. Contact staffing@rgxmagency.com if you cannot access a required record.

## 11. Availability and errors

Crew may be unavailable during maintenance, outages or security incidents.

If an outage prevents time submission, check-in, acceptance or a correction request, email staffing@rgxmagency.com promptly. For urgent assignment matters, also use the contact method provided in the assignment confirmation.

An outage does not cancel earned compensation or remove rights under an accepted agreement. RGXM will provide a reasonable alternative process.

## 12. Restriction and account closure

RGXM may restrict access where reasonably necessary to investigate suspected misuse, protect information or address safety or security concerns.

Where appropriate and lawful, RGXM will explain the restriction and provide a review contact.

You may request account closure through staffing@rgxmagency.com. Closure does not automatically cancel accepted assignments, erase required records or discharge amounts owed by either party.

RGXM will provide an alternative route to request payment records and resolve outstanding matters. Payment questions may be directed to safiya@rgxmagency.com.

## 13. Privacy

Personal information is handled under the Crew Privacy Policy.

Do not upload unnecessary sensitive information or personal information about others without an appropriate basis.

For privacy questions, access or correction requests, deletion requests or complaints, contact:

Safiya Abbadi, Privacy Officer
RGXM Inc.
Unit A - 6975 Pacific Circle
Mississauga, ON L5T 2H3
safiya@rgxmagency.com

## 14. Responsibility and legal rights

Each party remains responsible for its own conduct under applicable law.

These Terms do not exclude RGXM’s payment obligations, excuse fraud or wilful misconduct, or waive rights and duties that cannot lawfully be excluded.

They do not impose automatic financial penalties for account suspension or permit unilateral forfeiture of earned compensation.

## 15. Changes to these Terms

RGXM may update these Terms prospectively. Material changes will be brought to your attention and acceptance requested where appropriate.

Updated Terms do not retroactively change agreed assignment fees or completed work. If you decline updated Terms, contact staffing@rgxmagency.com about outstanding assignments, payments and access to records.

## 16. Governing law and contact

Subject to mandatory laws and jurisdictional rights, these Terms are governed by Ontario law and applicable Canadian federal law.

Operator: RGXM Inc.
Business address: Unit A - 6975 Pacific Circle, Mississauga, ON L5T 2H3
Platform support and account closure: staffing@rgxmagency.com
Finance and payments: safiya@rgxmagency.com
Privacy Officer: Safiya Abbadi — safiya@rgxmagency.com

By selecting “I agree to the Platform Terms of Use,” you confirm that you have had an opportunity to review and retain the version presented.$legal$, 'First published version.', 'draft')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Contacts and periods stated in those documents (only where not set yet).
UPDATE org_settings SET
  privacy_officer_name = coalesce(privacy_officer_name, 'Safiya Abbadi, Privacy Officer'),
  privacy_officer_email = coalesce(privacy_officer_email, 'safiya@rgxmagency.com'),
  privacy_officer_address = coalesce(privacy_officer_address, 'RGXM Inc., Unit A - 6975 Pacific Circle, Mississauga, ON L5T 2H3'),
  support_email = coalesce(support_email, 'staffing@rgxmagency.com'),
  finance_email = coalesce(finance_email, 'safiya@rgxmagency.com'),
  privacy_request_response_days = coalesce(privacy_request_response_days, 30)
WHERE id = 1;
--> statement-breakpoint
-- Payment schedule from the Independent Contractor Agreement §4, pre-filled but NOT approved: an
-- administrator confirms it in Settings (bills show "terms not approved" until then).
UPDATE org_settings SET payment_terms = jsonb_build_object(
  'dueRule', 'semi_monthly_agreement',
  'description', 'Processing periods are the 1st–15th and the 16th–last day of each month. Undisputed amounts for the 1st–15th are payable by the last day of that month; for the 16th–last day, by the 15th of the following month (Independent Contractor Agreement v1.0.0, section 4).'
) WHERE id = 1 AND payment_terms = '{}'::jsonb;
