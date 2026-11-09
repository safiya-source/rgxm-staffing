ALTER TABLE "org_settings" ADD COLUMN "legal_entity_name" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "legal_entity_address" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "invoice_kind" text DEFAULT 'rgxm_bill' NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "self_billing_acceptance_id" uuid;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "document" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "contractor_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "self_billing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_invoice_kind" CHECK (invoice_kind in ('self_billed', 'rgxm_bill'));--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_self_billing_basis" CHECK ("bills"."invoice_kind" <> 'self_billed' or "bills"."self_billing_acceptance_id" is not null);--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_self_billing_acceptance_fk" FOREIGN KEY ("self_billing_acceptance_id") REFERENCES "staff_acceptances"("id");--> statement-breakpoint

-- Bills / contractor invoices: the issued document is frozen. Only the status moves, and the
-- contractor's confirmation can be recorded once.
CREATE OR REPLACE FUNCTION rgxm_guard_bills() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bills cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ROW(NEW.bill_number, NEW.staff_id, NEW.supplier_id, NEW.kind, NEW.bill_date, NEW.due_date, NEW.currency,
         NEW.subtotal_cents, NEW.tax_cents, NEW.total_cents, NEW.is_demo, NEW.finalized_by, NEW.finalized_at, NEW.terms_snapshot,
         NEW.invoice_kind, NEW.self_billing_acceptance_id, NEW.document)
     IS DISTINCT FROM
     ROW(OLD.bill_number, OLD.staff_id, OLD.supplier_id, OLD.kind, OLD.bill_date, OLD.due_date, OLD.currency,
         OLD.subtotal_cents, OLD.tax_cents, OLD.total_cents, OLD.is_demo, OLD.finalized_by, OLD.finalized_at, OLD.terms_snapshot,
         OLD.invoice_kind, OLD.self_billing_acceptance_id, OLD.document)
     OR (OLD.contractor_confirmed_at IS NOT NULL AND NEW.contractor_confirmed_at IS DISTINCT FROM OLD.contractor_confirmed_at) THEN
    RAISE EXCEPTION 'bill % is finalized; correct it with an adjustment', OLD.bill_number USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Approved legal documents stay frozen, including whether they authorize self-billing.
CREATE OR REPLACE FUNCTION rgxm_guard_legal_documents() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'approved legal documents cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
       ROW(NEW.kind, NEW.version, NEW.title, NEW.body, NEW.approved_by, NEW.approved_at, NEW.effective_at, NEW.self_billing)
       IS DISTINCT FROM ROW(OLD.kind, OLD.version, OLD.title, OLD.body, OLD.approved_by, OLD.approved_at, OLD.effective_at, OLD.self_billing)
       OR (OLD.status = 'retired' AND NEW.status <> 'retired')
       OR (OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'retired'))) THEN
    RAISE EXCEPTION 'approved legal document % v% is frozen', OLD.kind, OLD.version USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

UPDATE org_settings SET
  legal_entity_name = coalesce(legal_entity_name, 'RGXM Inc.'),
  legal_entity_address = coalesce(legal_entity_address, 'Unit A - 6975 Pacific Circle, Mississauga, ON L5T 2H3')
WHERE id = 1;
--> statement-breakpoint

-- Contractor Agreement v1.0.1 adds section 7 (invoices prepared through Crew). The unapproved v1.0.0
-- draft is replaced; an already-approved v1.0.0 stays, and contractors accept v1.0.1 once it's approved.
DELETE FROM legal_documents WHERE kind = 'contractor_terms' AND version = '1.0.0' AND status = 'draft';
--> statement-breakpoint
INSERT INTO legal_documents (kind, version, title, body, summary_of_changes, status, self_billing)
VALUES ('contractor_terms', '1.0.1', 'RGXM Independent Contractor Agreement', $legal$This Agreement is between:

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

## 7. Invoices prepared through Crew

The Contractor authorizes RGXM Inc. to prepare and issue invoices on the Contractor’s behalf for services supplied to RGXM under this Agreement, using agreed assignment terms, approved work records, authorized additional compensation and applicable tax information.

RGXM will make each invoice available to the Contractor electronically. The Contractor will review the invoice and promptly report any discrepancy to safiya@rgxmagency.com. RGXM will investigate reported discrepancies and issue an appropriate correction or linked adjustment where required.

The Contractor does not need to prepare a separate invoice for services covered by this arrangement and will not issue a duplicate invoice for the same supply. Any exception must be agreed with RGXM Finance.

The Contractor must provide accurate business and tax-registration information and promptly notify RGXM of changes. Preparing an invoice on the Contractor’s behalf does not transfer the Contractor’s tax reporting or remittance obligations to RGXM.

An invoice records the amount payable and does not itself confirm payment. Invoice review or a correction request does not waive either party’s rights or justify withholding an undisputed amount beyond its agreed payment deadline.

## 8. Independent business relationship

The parties intend a contract for services rather than an employment relationship. The Contractor has no authority to bind RGXM or its clients unless expressly authorized.

This intention does not override the actual relationship or applicable law. Nothing in this Agreement waives employment standards, safety, human rights or other protections that legally apply.

If the arrangement requires a different legal treatment, the parties will cooperate to correct the process and records.

## 9. Safety, conduct and coverage

Both parties will comply with their applicable legal duties.

The Contractor will promptly report unsafe conditions and will not undertake work they are unqualified or unauthorized to perform. Nothing requires anyone to continue unsafe work or limits applicable reporting or work-refusal rights.

Harassment, discrimination, violence, theft and impairment that compromises safe performance are prohibited.

Before an assignment, RGXM will identify any required insurance, workers’ compensation evidence or role-specific certification. Required evidence must be relevant to the assignment.

The Contractor will notify RGXM of material changes affecting their ability to lawfully or safely perform accepted services.

## 10. Cancellation and inability to perform

A party unable to proceed will notify the other promptly and take reasonable steps to reduce disruption.

The assignment confirmation must state cancellation notice requirements and any cancellation payment. RGXM may not impose an undisclosed cancellation penalty.

If RGXM cancels after services have begun, it will pay for services performed, approved non-cancellable expenses and any applicable cancellation or minimum payment.

Unless expressly agreed in an accepted assignment confirmation, cancelling an assignment does not make future unperformed hours payable.

No automatic deduction or forfeiture of earned fees applies because of a cancellation, complaint or alleged loss.

## 11. Confidentiality and personal information

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

## 12. Materials, content and publicity

Each party retains ownership of materials and intellectual property it owned before the assignment.

The Contractor grants RGXM permission to use assignment records and ordinary operational materials supplied by the Contractor as reasonably necessary to administer and document the engagement.

If an assignment involves creating campaign content or other intellectual property, the assignment confirmation must specify the required ownership or licence terms before acceptance.

This Agreement does not authorize promotional use of the Contractor’s image, voice or likeness. Any such use requires a separate release describing the intended use.

The Contractor may not publish confidential campaign content or use RGXM/client branding without permission.

## 13. Ending the relationship

Either party may end this framework Agreement by written notice. Notices to RGXM may be sent to staffing@rgxmagency.com.

Ending this Agreement does not automatically cancel accepted assignments; those must be completed or cancelled under their applicable terms.

RGXM may immediately restrict site or platform access where reasonably necessary to address safety, security, fraud or serious misconduct concerns.

Ending access does not remove payment obligations for services already performed or prevent the Contractor from obtaining payment records or raising a dispute through an alternative contact.

Confidentiality, accrued payment obligations and provisions intended to continue survive termination.

## 14. Responsibility for losses

Each party remains responsible for losses caused by its own breach, negligence or wilful misconduct to the extent established under applicable law.

RGXM may not deduct an alleged loss from earned fees without a lawful basis and appropriate authorization or determination.

Neither party assumes the other’s statutory obligations merely by signing this Agreement.

## 15. Disputes and governing law

The parties will first attempt to resolve service or assignment disputes through staffing@rgxmagency.com, and financial disputes through safiya@rgxmagency.com.

Either party may seek urgent relief or contact an applicable regulator or tribunal without completing this informal process.

Subject to mandatory laws and jurisdictional rights, this Agreement is governed by Ontario law and applicable Canadian federal law. Proceedings may be brought before a court or tribunal with lawful jurisdiction.

No mandatory arbitration or class-action waiver is created by this Agreement.

## 16. General terms and electronic acceptance

This Agreement, accepted assignment confirmations and expressly incorporated documents form the agreement for the services.

Crew’s Platform Terms govern platform use. They do not override agreed fees, payment obligations or this Agreement’s service terms.

Changes to this Agreement apply prospectively after notice and acceptance. They do not retroactively alter completed work or accepted assignments without agreement.

If a provision is unenforceable, the remaining provisions continue to the extent legally possible.

Acceptance through an identified Crew account or another agreed electronic method records agreement to the version presented. Each party must be able to retain a copy.

RGXM contracting entity: RGXM Inc.

The Contractor’s legal name or entity, any authorized representative, the agreement version, and the acceptance date and record are recorded by Crew at acceptance and shown with the Contractor’s copy of this Agreement.$legal$,
  'Adds section 7: RGXM prepares invoices on your behalf through Crew (self-billing), so you don''t need to send your own invoices.', 'draft', true)
ON CONFLICT DO NOTHING;
