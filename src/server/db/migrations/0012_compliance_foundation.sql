CREATE TABLE "accounting_export_bills" (
	"export_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "accounting_export_bills_export_id_bill_id_pk" PRIMARY KEY("export_id","bill_id")
);
--> statement-breakpoint
CREATE TABLE "accounting_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"format" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"bill_count" integer NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'generated' NOT NULL,
	"status_note" text,
	"status_changed_by" uuid,
	"status_changed_at" timestamp with time zone,
	"exported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_exports_reference_unique" UNIQUE("reference"),
	CONSTRAINT "accounting_exports_status" CHECK (status in ('generated', 'imported', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "accounting_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"supplier_ref" text NOT NULL,
	"display_name" text NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_suppliers_staffId_unique" UNIQUE("staff_id"),
	CONSTRAINT "accounting_suppliers_supplierRef_unique" UNIQUE("supplier_ref")
);
--> statement-breakpoint
CREATE TABLE "auth_step_ups" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_number" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"kind" text DEFAULT 'bill' NOT NULL,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"terms_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_from_batch_id" uuid,
	"finalized_by" uuid NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_billNumber_unique" UNIQUE("bill_number"),
	CONSTRAINT "bills_kind" CHECK (kind in ('bill', 'credit')),
	CONSTRAINT "bills_status" CHECK (status in ('open', 'paid', 'void')),
	CONSTRAINT "bills_total" CHECK ("bills"."total_cents" = "bills"."subtotal_cents" + "bills"."tax_cents")
);
--> statement-breakpoint
CREATE TABLE "compensation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"shift_id" uuid,
	"booking_id" uuid,
	"work_date" date NOT NULL,
	"category" text NOT NULL,
	"unit_rate" numeric(12, 4) NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"trip_date" date,
	"business_purpose" text,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"payable_item_id" uuid,
	CONSTRAINT "compensation_items_category" CHECK (category in ('meal_breakfast', 'meal_lunch', 'meal_dinner', 'per_diem', 'mileage', 'bonus')),
	CONSTRAINT "compensation_items_status" CHECK (status in ('pending', 'approved', 'rejected', 'void')),
	CONSTRAINT "compensation_items_amount" CHECK ("compensation_items"."amount_cents" >= 0 and "compensation_items"."quantity" > 0 and "compensation_items"."unit_rate" >= 0),
	CONSTRAINT "compensation_items_mileage" CHECK ("compensation_items"."category" <> 'mileage' or ("compensation_items"."trip_date" is not null and length(trim(coalesce("compensation_items"."business_purpose", ''))) > 0)),
	CONSTRAINT "compensation_items_bonus" CHECK ("compensation_items"."category" <> 'bonus' or length(trim(coalesce("compensation_items"."reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "compensation_tax_treatments" (
	"category" text PRIMARY KEY NOT NULL,
	"gst_hst" text DEFAULT 'review' NOT NULL,
	"year_end" text DEFAULT 'review' NOT NULL,
	"year_end_box" text,
	"notes" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reference" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_tax_treatments_category" CHECK (category in ('fee', 'meal_breakfast', 'meal_lunch', 'meal_dinner', 'per_diem', 'mileage', 'bonus', 'adjustment')),
	CONSTRAINT "compensation_tax_treatments_gst" CHECK (gst_hst in ('taxable', 'not_taxable', 'review')),
	CONSTRAINT "compensation_tax_treatments_year_end" CHECK (year_end in ('box_048', 'other_box', 'exclude', 'review'))
);
--> statement-breakpoint
CREATE TABLE "consent_purposes" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_on" date NOT NULL,
	"assessment_reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	CONSTRAINT "contractor_approvals_revoke_reason" CHECK ("contractor_approvals"."revoked_at" is null or length(trim(coalesce("contractor_approvals"."revoke_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "contractor_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text,
	"issued_on" date,
	"expires_on" date,
	"storage_key" text,
	"notes" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "contractor_evidence_kind" CHECK (kind in ('wsib_clearance', 'wsib_coverage_not_required', 'independent_operator', 'business_registration', 'insurance', 'other'))
);
--> statement-breakpoint
CREATE TABLE "contractor_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"bill_id" uuid,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"expected_subtotal_cents" bigint,
	"expected_tax_cents" bigint,
	"status" text NOT NULL,
	"storage_key" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	CONSTRAINT "contractor_invoices_status" CHECK (status in ('matched', 'variance_review', 'resolved', 'unmatched'))
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"affected_people_estimate" integer,
	"data_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"containment" text,
	"risk_assessment" text DEFAULT 'undetermined' NOT NULL,
	"risk_rationale" text,
	"commissioner_notified_at" timestamp with time zone,
	"individuals_notified_at" timestamp with time zone,
	"other_notifications" text,
	"remediation" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reported_by" uuid NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_reference_unique" UNIQUE("reference"),
	CONSTRAINT "incidents_risk" CHECK (risk_assessment in ('undetermined', 'real_risk_of_significant_harm', 'no_real_risk')),
	CONSTRAINT "incidents_status" CHECK (status in ('open', 'contained', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "known_sign_in_contexts" (
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_sign_in_contexts_user_id_fingerprint_pk" PRIMARY KEY("user_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"summary_of_changes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_documents_kind" CHECK (kind in ('privacy_notice', 'contractor_terms')),
	CONSTRAINT "legal_documents_status" CHECK (status in ('draft', 'approved', 'retired')),
	CONSTRAINT "legal_documents_approval" CHECK ("legal_documents"."status" = 'draft' or ("legal_documents"."approved_by" is not null and "legal_documents"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid,
	"project_id" uuid,
	"reason" text NOT NULL,
	"placed_by" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "legal_holds_scope" CHECK (("legal_holds"."staff_id" is not null) <> ("legal_holds"."project_id" is not null)),
	CONSTRAINT "legal_holds_release" CHECK ("legal_holds"."released_at" is null or length(trim(coalesce("legal_holds"."release_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "pay_review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"payable_item_id" uuid,
	"bill_id" uuid,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_review_requests_kind" CHECK (kind in ('tax', 'amount', 'hours', 'other')),
	CONSTRAINT "pay_review_requests_status" CHECK (status in ('open', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "payable_tax_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payable_item_id" uuid NOT NULL,
	"component" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"rate_ppm" integer NOT NULL,
	"taxable_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"tax_rule_id" uuid,
	"service_category" text,
	"basis" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payable_tax_lines_component" CHECK (component in ('GST', 'HST', 'QST', 'PST'))
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"kind" text NOT NULL,
	"staff_id" uuid,
	"requester_name" text NOT NULL,
	"requester_contact" text,
	"received_at" timestamp with time zone NOT NULL,
	"received_via" text,
	"details" text,
	"due_at" timestamp with time zone,
	"extended_due_at" timestamp with time zone,
	"extension_reason" text,
	"identity_verified_at" timestamp with time zone,
	"identity_verified_by" uuid,
	"identity_method" text,
	"status" text DEFAULT 'received' NOT NULL,
	"review_checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"redaction_notes" text,
	"response_summary" text,
	"response_storage_key" text,
	"response_sha256" text,
	"responded_at" timestamp with time zone,
	"response_method" text,
	"assigned_to" uuid,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_reference_unique" UNIQUE("reference"),
	CONSTRAINT "privacy_requests_kind" CHECK (kind in ('access', 'correction', 'deletion')),
	CONSTRAINT "privacy_requests_status" CHECK (status in ('received', 'verifying', 'in_review', 'responded', 'closed', 'refused', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "project_compensation_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"meals_enabled" boolean DEFAULT false NOT NULL,
	"per_diem_enabled" boolean DEFAULT false NOT NULL,
	"mileage_enabled" boolean DEFAULT false NOT NULL,
	"bonus_enabled" boolean DEFAULT false NOT NULL,
	"breakfast_cents" integer DEFAULT 2000 NOT NULL,
	"lunch_cents" integer DEFAULT 2500 NOT NULL,
	"dinner_cents" integer DEFAULT 4000 NOT NULL,
	"per_diem_cents" integer DEFAULT 8500 NOT NULL,
	"mileage_rate" numeric(8, 4) DEFAULT '0.7300' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"category" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"retention_days" integer,
	"action" text NOT NULL,
	"description" text,
	"approval_reference" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"affected" integer NOT NULL,
	"skipped_held" integer DEFAULT 0 NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"place_of_supply_rule" text DEFAULT 'finance_review' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_categories_rule" CHECK (place_of_supply_rule in ('event_province', 'finance_review'))
);
--> statement-breakpoint
CREATE TABLE "staff_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"method" text NOT NULL,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "staff_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"purpose_key" text NOT NULL,
	"purpose_version" integer NOT NULL,
	"granted" boolean NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"method" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_email_preferences" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"shift_opportunity_emails" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction" text NOT NULL,
	"component" text NOT NULL,
	"rate_ppm" integer NOT NULL,
	"service_category" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reference" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rules_component" CHECK (component in ('GST', 'HST', 'QST', 'PST')),
	CONSTRAINT "tax_rules_status" CHECK (status in ('draft', 'approved', 'retired')),
	CONSTRAINT "tax_rules_rate" CHECK ("tax_rules"."rate_ppm" between 0 and 500000),
	CONSTRAINT "tax_rules_dates" CHECK ("tax_rules"."effective_to" is null or "tax_rules"."effective_to" >= "tax_rules"."effective_from"),
	CONSTRAINT "tax_rules_approval" CHECK ("tax_rules"."status" = 'draft' or ("tax_rules"."approved_by" is not null and "tax_rules"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "year_end_recipients" (
	"year" smallint NOT NULL,
	"staff_id" uuid NOT NULL,
	"decision" text,
	"decision_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"identity_received_at" timestamp with time zone,
	"identity_recorded_by" uuid,
	"identity_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "year_end_recipients_year_staff_id_pk" PRIMARY KEY("year","staff_id"),
	CONSTRAINT "year_end_recipients_decision" CHECK ("year_end_recipients"."decision" is null or "year_end_recipients"."decision" in ('include', 'exclude')),
	CONSTRAINT "year_end_recipients_reason" CHECK ("year_end_recipients"."decision" is null or length(trim(coalesce("year_end_recipients"."decision_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "year_end_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" smallint NOT NULL,
	"version" integer NOT NULL,
	"summary" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handed_off_at" timestamp with time zone,
	"handed_off_by" uuid,
	"filed_at" timestamp with time zone,
	"filed_by" uuid,
	CONSTRAINT "year_end_snapshots_status" CHECK (status in ('draft', 'handed_off', 'filed'))
);
--> statement-breakpoint
ALTER TABLE "payable_items" ALTER COLUMN "timesheet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "privacy_officer_name" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "privacy_officer_email" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "privacy_officer_phone" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "require_mfa_for_staff" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "require_contractor_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "auto_tax_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "auto_tax_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "auto_tax_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "auto_tax_approval_reference" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "tax_recoverability" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "payment_terms" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "accounting_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "privacy_request_response_days" integer;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "year_end_threshold_cents" integer DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "category" text DEFAULT 'fee' NOT NULL;--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "compensation_item_id" uuid;--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "adjusts_payable_id" uuid;--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "quantity" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "unit_rate" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "tax_status" text DEFAULT 'calculated' NOT NULL;--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "tax_basis" text;--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "registration_snapshot" text;--> statement-breakpoint
ALTER TABLE "payable_items" ADD COLUMN "bill_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_batch_items" ADD COLUMN "state" text DEFAULT 'included' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_batch_items" ADD COLUMN "bank_reference" text;--> statement-breakpoint
ALTER TABLE "payment_batch_items" ADD COLUMN "evidence" text;--> statement-breakpoint
ALTER TABLE "payment_batch_items" ADD COLUMN "reconciled_by" uuid;--> statement-breakpoint
ALTER TABLE "payment_batch_items" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_batch_items" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD COLUMN "approval_fingerprint" text;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD COLUMN "bank_reference" text;--> statement-breakpoint
ALTER TABLE "payment_exports" ADD COLUMN "purpose" text DEFAULT 'bank' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "event_province" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "service_category" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "supply_type" text DEFAULT 'onsite' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "gst_registration_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "gst_registration_effective_date" date;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "gst_verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "gst_verified_by" uuid;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "gst_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "gst_verification_reference" text;--> statement-breakpoint
ALTER TABLE "accounting_export_bills" ADD CONSTRAINT "accounting_export_bills_export_id_accounting_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."accounting_exports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_export_bills" ADD CONSTRAINT "accounting_export_bills_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_exported_by_users_id_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_suppliers" ADD CONSTRAINT "accounting_suppliers_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_step_ups" ADD CONSTRAINT "auth_step_ups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_supplier_id_accounting_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."accounting_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_from_batch_id_payment_batches_id_fk" FOREIGN KEY ("created_from_batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD CONSTRAINT "compensation_items_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD CONSTRAINT "compensation_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD CONSTRAINT "compensation_items_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD CONSTRAINT "compensation_items_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD CONSTRAINT "compensation_items_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD CONSTRAINT "compensation_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_tax_treatments" ADD CONSTRAINT "compensation_tax_treatments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_tax_treatments" ADD CONSTRAINT "compensation_tax_treatments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_purposes" ADD CONSTRAINT "consent_purposes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_approvals" ADD CONSTRAINT "contractor_approvals_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_approvals" ADD CONSTRAINT "contractor_approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_approvals" ADD CONSTRAINT "contractor_approvals_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_evidence" ADD CONSTRAINT "contractor_evidence_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_evidence" ADD CONSTRAINT "contractor_evidence_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_evidence" ADD CONSTRAINT "contractor_evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_evidence" ADD CONSTRAINT "contractor_evidence_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_sign_in_contexts" ADD CONSTRAINT "known_sign_in_contexts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_review_requests" ADD CONSTRAINT "pay_review_requests_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_review_requests" ADD CONSTRAINT "pay_review_requests_payable_item_id_payable_items_id_fk" FOREIGN KEY ("payable_item_id") REFERENCES "public"."payable_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_review_requests" ADD CONSTRAINT "pay_review_requests_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_review_requests" ADD CONSTRAINT "pay_review_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_review_requests" ADD CONSTRAINT "pay_review_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payable_tax_lines" ADD CONSTRAINT "payable_tax_lines_payable_item_id_payable_items_id_fk" FOREIGN KEY ("payable_item_id") REFERENCES "public"."payable_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payable_tax_lines" ADD CONSTRAINT "payable_tax_lines_tax_rule_id_tax_rules_id_fk" FOREIGN KEY ("tax_rule_id") REFERENCES "public"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_identity_verified_by_users_id_fk" FOREIGN KEY ("identity_verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_compensation_settings" ADD CONSTRAINT "project_compensation_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_compensation_settings" ADD CONSTRAINT "project_compensation_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_acceptances" ADD CONSTRAINT "staff_acceptances_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_acceptances" ADD CONSTRAINT "staff_acceptances_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_acceptances" ADD CONSTRAINT "staff_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_acceptances" ADD CONSTRAINT "staff_acceptances_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_consent_events" ADD CONSTRAINT "staff_consent_events_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_consent_events" ADD CONSTRAINT "staff_consent_events_purpose_key_consent_purposes_key_fk" FOREIGN KEY ("purpose_key") REFERENCES "public"."consent_purposes"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_consent_events" ADD CONSTRAINT "staff_consent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_email_preferences" ADD CONSTRAINT "staff_email_preferences_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_service_category_service_categories_key_fk" FOREIGN KEY ("service_category") REFERENCES "public"."service_categories"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_recipients" ADD CONSTRAINT "year_end_recipients_staff_id_staff_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_recipients" ADD CONSTRAINT "year_end_recipients_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_recipients" ADD CONSTRAINT "year_end_recipients_identity_recorded_by_users_id_fk" FOREIGN KEY ("identity_recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_snapshots" ADD CONSTRAINT "year_end_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_snapshots" ADD CONSTRAINT "year_end_snapshots_handed_off_by_users_id_fk" FOREIGN KEY ("handed_off_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_snapshots" ADD CONSTRAINT "year_end_snapshots_filed_by_users_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_export_bills_live_uq" ON "accounting_export_bills" USING btree ("bill_id") WHERE "accounting_export_bills"."active";--> statement-breakpoint
CREATE INDEX "bills_staff_idx" ON "bills" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "compensation_items_project_idx" ON "compensation_items" USING btree ("project_id","work_date");--> statement-breakpoint
CREATE INDEX "compensation_items_staff_idx" ON "compensation_items" USING btree ("staff_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_items_daily_uq" ON "compensation_items" USING btree ("staff_id","work_date","category") WHERE "compensation_items"."category" in ('meal_breakfast', 'meal_lunch', 'meal_dinner', 'per_diem') and "compensation_items"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_approvals_current_uq" ON "contractor_approvals" USING btree ("staff_id") WHERE "contractor_approvals"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "contractor_evidence_staff_idx" ON "contractor_evidence" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_invoices_number_uq" ON "contractor_invoices" USING btree ("staff_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_version_uq" ON "legal_documents" USING btree ("kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_one_current_uq" ON "legal_documents" USING btree ("kind") WHERE "legal_documents"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "pay_review_requests_status_idx" ON "pay_review_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payable_tax_lines_payable_idx" ON "payable_tax_lines" USING btree ("payable_item_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_status_idx" ON "privacy_requests" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "retention_runs_ran_idx" ON "retention_runs" USING btree ("ran_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_acceptances_uq" ON "staff_acceptances" USING btree ("staff_id","document_id");--> statement-breakpoint
CREATE INDEX "staff_acceptances_staff_idx" ON "staff_acceptances" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "staff_consent_events_staff_idx" ON "staff_consent_events" USING btree ("staff_id","purpose_key","recorded_at");--> statement-breakpoint
CREATE INDEX "tax_rules_lookup_idx" ON "tax_rules" USING btree ("jurisdiction","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "year_end_snapshots_version_uq" ON "year_end_snapshots" USING btree ("year","version");--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_auto_tax_approved_by_users_id_fk" FOREIGN KEY ("auto_tax_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch_items" ADD CONSTRAINT "payment_batch_items_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD CONSTRAINT "staff_sensitive_gst_verified_by_users_id_fk" FOREIGN KEY ("gst_verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payable_items_compensation_uq" ON "payable_items" USING btree ("compensation_item_id") WHERE "payable_items"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "payable_items_bill_idx" ON "payable_items" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "payable_items_project_idx" ON "payable_items" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "payable_items" ADD CONSTRAINT "payable_items_fee_timesheet" CHECK ("payable_items"."category" <> 'fee' or "payable_items"."timesheet_id" is not null);--> statement-breakpoint

-- ═════════════════════ Hand-written part: constraints, backfills, triggers, seeds ═════════════════════
-- Everything below is additive. Existing payables, batches and exports keep their amounts; legacy
-- rows are labelled so reports can tell old calculations from new ones.

ALTER TABLE "payable_items" ADD CONSTRAINT "payable_items_category" CHECK (category in ('fee', 'meal_breakfast', 'meal_lunch', 'meal_dinner', 'per_diem', 'mileage', 'bonus', 'adjustment'));--> statement-breakpoint
ALTER TABLE "payable_items" ADD CONSTRAINT "payable_items_tax_status" CHECK (tax_status in ('calculated', 'no_tax', 'review_required', 'finance_override', 'legacy_hst', 'legacy_none'));--> statement-breakpoint
ALTER TABLE "payable_items" ADD CONSTRAINT "payable_items_bill_fk" FOREIGN KEY ("bill_id") REFERENCES "bills"("id");--> statement-breakpoint
ALTER TABLE "payable_items" ADD CONSTRAINT "payable_items_compensation_fk" FOREIGN KEY ("compensation_item_id") REFERENCES "compensation_items"("id");--> statement-breakpoint
ALTER TABLE "payable_items" ADD CONSTRAINT "payable_items_adjusts_fk" FOREIGN KEY ("adjusts_payable_id") REFERENCES "payable_items"("id");--> statement-breakpoint
ALTER TABLE "payable_items" ADD CONSTRAINT "payable_items_adjustment_link" CHECK (category <> 'adjustment' or adjusts_payable_id is not null);--> statement-breakpoint
ALTER TABLE "compensation_items" ADD CONSTRAINT "compensation_items_payable_fk" FOREIGN KEY ("payable_item_id") REFERENCES "payable_items"("id");--> statement-breakpoint
ALTER TABLE "payment_batch_items" ADD CONSTRAINT "payment_batch_items_state" CHECK (state in ('included', 'exported', 'submitted', 'settled', 'failed', 'returned', 'bank_cancelled', 'removed', 'voided'));--> statement-breakpoint
ALTER TABLE "payment_batch_items" ADD CONSTRAINT "payment_batch_items_settled_evidence" CHECK (state <> 'settled' or (paid_at is not null and length(trim(coalesce(evidence, ''))) > 0));--> statement-breakpoint
ALTER TABLE "payment_exports" ADD CONSTRAINT "payment_exports_purpose" CHECK (purpose in ('bank', 'accounting_legacy'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_supply_type" CHECK (supply_type in ('onsite', 'offsite', 'mixed', 'multi_province'));--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD CONSTRAINT "staff_sensitive_gst_status" CHECK (gst_registration_status in ('yes', 'no', 'unsure', 'unknown'));--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD CONSTRAINT "staff_sensitive_gst_verification" CHECK (gst_verification_status in ('unverified', 'verified', 'rejected'));--> statement-breakpoint
CREATE INDEX "payment_batch_items_state_idx" ON "payment_batch_items" USING btree ("state");--> statement-breakpoint

-- ─── Backfills ───────────────────────────────────────────────────────────────────
-- GST/HST: "registered" → yes. Not registered and tax details saved → no. Otherwise unknown
-- (never answered). Nobody is "verified" yet: Finance verifies going forward.
UPDATE staff_sensitive SET gst_registration_status = CASE
  WHEN tax_registered THEN 'yes'
  WHEN legal_name IS NOT NULL OR mailing_street IS NOT NULL OR business_number IS NOT NULL THEN 'no'
  ELSE 'unknown' END;
--> statement-breakpoint

-- Existing payables keep their amounts and are labelled as the older calculation.
UPDATE payable_items SET
  tax_status = CASE WHEN tax_cents > 0 THEN 'legacy_hst' ELSE 'legacy_none' END,
  tax_basis = CASE WHEN tax_cents > 0
    THEN 'Calculated before accountant-approved tax rules: 13% HST added because the contractor was marked GST/HST-registered (' || calc_version || ').'
    ELSE 'Calculated before accountant-approved tax rules: no tax added (' || calc_version || ').' END,
  unit = 'hour',
  quantity = round(payable_minutes::numeric / 60, 2),
  unit_rate = round(rate_cents::numeric / 100, 4);
--> statement-breakpoint
INSERT INTO payable_tax_lines (payable_item_id, component, jurisdiction, rate_ppm, taxable_cents, tax_cents, basis, created_at)
SELECT id, 'HST', 'ON', coalesce((calc_inputs -> 'hst' ->> 'rateBp')::int, 1300) * 100, base_cents, tax_cents,
  'Legacy: 13% HST for a contractor marked GST/HST-registered, before tax rules were configured.', created_at
FROM payable_items WHERE tax_cents > 0;
--> statement-breakpoint

-- Payment attempts: map the old active/paid/failure fields to explicit states. Batches that were
-- marked paid in Crew are recorded as settled on Finance's confirmation (the only evidence then).
UPDATE payment_batch_items i SET
  state = CASE
    WHEN b.status = 'void' AND NOT i.active THEN 'voided'
    WHEN NOT i.active AND i.failure_reason LIKE 'Removed:%' THEN 'removed'
    WHEN NOT i.active THEN 'failed'
    WHEN i.paid_at IS NOT NULL THEN 'settled'
    WHEN b.status IN ('exported', 'paid') THEN 'exported'
    ELSE 'included' END,
  evidence = CASE WHEN i.active AND i.paid_at IS NOT NULL THEN 'Marked paid in Crew by Finance (before bank reconciliation was recorded).' ELSE NULL END,
  reconciled_at = CASE WHEN i.active AND i.paid_at IS NOT NULL THEN b.paid_at ELSE NULL END
FROM payment_batches b WHERE b.id = i.batch_id;
--> statement-breakpoint
UPDATE payment_exports SET purpose = 'accounting_legacy' WHERE format = 'csv_qbo';
--> statement-breakpoint

-- ─── Payables: guards updated for the new columns ────────────────────────────────
CREATE OR REPLACE FUNCTION rgxm_check_payable_minutes() RETURNS trigger AS $$
DECLARE ts_minutes integer;
BEGIN
  IF NEW.timesheet_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT payable_minutes INTO ts_minutes FROM timesheets WHERE id = NEW.timesheet_id;
  IF ts_minutes IS DISTINCT FROM NEW.payable_minutes THEN
    RAISE EXCEPTION 'payable minutes (%) must equal the timesheet''s approved minutes (%)', NEW.payable_minutes, ts_minutes
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION rgxm_guard_payable_items() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payable_items cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ROW(NEW.timesheet_id, NEW.staff_id, NEW.project_id, NEW.classification, NEW.payable_minutes, NEW.rate_cents,
         NEW.base_cents, NEW.premiums_cents, NEW.expenses_cents, NEW.adjustments_cents, NEW.tax_cents, NEW.total_cents,
         NEW.calc_version, NEW.calc_inputs, NEW.category, NEW.compensation_item_id, NEW.adjusts_payable_id,
         NEW.quantity, NEW.unit, NEW.unit_rate, NEW.tax_status, NEW.tax_basis, NEW.registration_snapshot, NEW.service_date)
     IS DISTINCT FROM
     ROW(OLD.timesheet_id, OLD.staff_id, OLD.project_id, OLD.classification, OLD.payable_minutes, OLD.rate_cents,
         OLD.base_cents, OLD.premiums_cents, OLD.expenses_cents, OLD.adjustments_cents, OLD.tax_cents, OLD.total_cents,
         OLD.calc_version, OLD.calc_inputs, OLD.category, OLD.compensation_item_id, OLD.adjusts_payable_id,
         OLD.quantity, OLD.unit, OLD.unit_rate, OLD.tax_status, OLD.tax_basis, OLD.registration_snapshot, OLD.service_date) THEN
    RAISE EXCEPTION 'payable amounts are immutable (payable %)', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.bill_id IS NOT NULL AND NEW.bill_id IS DISTINCT FROM OLD.bill_id THEN
    RAISE EXCEPTION 'a payable stays on the bill it was finalized on (payable %)', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Paid lines can be disputed, or go back to failed when the bank returns the payment.
  IF OLD.status = 'paid' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('disputed', 'failed') THEN
    RAISE EXCEPTION 'paid payables can only move to disputed or failed (returned)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'void' AND (OLD.status IN ('exported', 'paid') OR OLD.bill_id IS NOT NULL) THEN
    RAISE EXCEPTION 'exported, paid or billed payables cannot be voided; use an adjustment' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ─── Append-only / frozen records ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rgxm_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payable_tax_lines_append_only BEFORE UPDATE OR DELETE ON payable_tax_lines FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();--> statement-breakpoint
CREATE TRIGGER staff_acceptances_append_only BEFORE UPDATE OR DELETE ON staff_acceptances FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();--> statement-breakpoint
CREATE TRIGGER staff_consent_events_append_only BEFORE UPDATE OR DELETE ON staff_consent_events FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();--> statement-breakpoint
CREATE TRIGGER retention_runs_append_only BEFORE UPDATE OR DELETE ON retention_runs FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();--> statement-breakpoint

-- Approved legal documents are frozen; they can only be retired.
CREATE OR REPLACE FUNCTION rgxm_guard_legal_documents() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'approved legal documents cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
       ROW(NEW.kind, NEW.version, NEW.title, NEW.body, NEW.approved_by, NEW.approved_at, NEW.effective_at)
       IS DISTINCT FROM ROW(OLD.kind, OLD.version, OLD.title, OLD.body, OLD.approved_by, OLD.approved_at, OLD.effective_at)
       OR (OLD.status = 'retired' AND NEW.status <> 'retired')
       OR (OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'retired'))) THEN
    RAISE EXCEPTION 'approved legal document % v% is frozen', OLD.kind, OLD.version USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER legal_documents_guard BEFORE UPDATE OR DELETE ON legal_documents FOR EACH ROW EXECUTE FUNCTION rgxm_guard_legal_documents();--> statement-breakpoint

-- Bills: amounts, numbers and parties never change; only the status moves (open → paid / void).
CREATE OR REPLACE FUNCTION rgxm_guard_bills() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bills cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ROW(NEW.bill_number, NEW.staff_id, NEW.supplier_id, NEW.kind, NEW.bill_date, NEW.due_date, NEW.currency,
         NEW.subtotal_cents, NEW.tax_cents, NEW.total_cents, NEW.is_demo, NEW.finalized_by, NEW.finalized_at, NEW.terms_snapshot)
     IS DISTINCT FROM
     ROW(OLD.bill_number, OLD.staff_id, OLD.supplier_id, OLD.kind, OLD.bill_date, OLD.due_date, OLD.currency,
         OLD.subtotal_cents, OLD.tax_cents, OLD.total_cents, OLD.is_demo, OLD.finalized_by, OLD.finalized_at, OLD.terms_snapshot) THEN
    RAISE EXCEPTION 'bill % is finalized; correct it with an adjustment', OLD.bill_number USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER bills_guard BEFORE UPDATE OR DELETE ON bills FOR EACH ROW EXECUTE FUNCTION rgxm_guard_bills();--> statement-breakpoint

-- Accounting exports: a record of what was sent to the books. Only the import status moves.
CREATE OR REPLACE FUNCTION rgxm_guard_accounting_exports() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'accounting exports cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ROW(NEW.reference, NEW.format, NEW.storage_key, NEW.sha256, NEW.row_count, NEW.bill_count, NEW.exported_by, NEW.config, NEW.is_demo)
     IS DISTINCT FROM ROW(OLD.reference, OLD.format, OLD.storage_key, OLD.sha256, OLD.row_count, OLD.bill_count, OLD.exported_by, OLD.config, OLD.is_demo)
     OR OLD.status = 'rejected' THEN
    RAISE EXCEPTION 'accounting export % is immutable', OLD.reference USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER accounting_exports_guard BEFORE UPDATE OR DELETE ON accounting_exports FOR EACH ROW EXECUTE FUNCTION rgxm_guard_accounting_exports();--> statement-breakpoint
CREATE OR REPLACE FUNCTION rgxm_guard_accounting_export_bills() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.export_id IS DISTINCT FROM OLD.export_id OR NEW.bill_id IS DISTINCT FROM OLD.bill_id OR (NOT OLD.active AND NEW.active) THEN
    RAISE EXCEPTION 'accounting export membership is fixed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER accounting_export_bills_guard BEFORE UPDATE OR DELETE ON accounting_export_bills FOR EACH ROW EXECUTE FUNCTION rgxm_guard_accounting_export_bills();--> statement-breakpoint

-- Year-end snapshots: the totals handed to the accountant never change.
CREATE OR REPLACE FUNCTION rgxm_guard_year_end_snapshots() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(NEW.year, NEW.version, NEW.summary, NEW.fingerprint, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.year, OLD.version, OLD.summary, OLD.fingerprint, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'year-end snapshots are frozen' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER year_end_snapshots_guard BEFORE UPDATE OR DELETE ON year_end_snapshots FOR EACH ROW EXECUTE FUNCTION rgxm_guard_year_end_snapshots();--> statement-breakpoint

-- Approved or decided compensation keeps its rate and amount.
CREATE OR REPLACE FUNCTION rgxm_guard_compensation_items() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'compensation items cannot be deleted; reject or void them' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ROW(NEW.staff_id, NEW.project_id, NEW.work_date, NEW.category, NEW.unit_rate, NEW.quantity, NEW.amount_cents, NEW.trip_date, NEW.requested_by)
     IS DISTINCT FROM ROW(OLD.staff_id, OLD.project_id, OLD.work_date, OLD.category, OLD.unit_rate, OLD.quantity, OLD.amount_cents, OLD.trip_date, OLD.requested_by) THEN
    RAISE EXCEPTION 'compensation amounts are fixed once recorded; void and re-enter instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('rejected', 'void') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'compensation item is % and final', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER compensation_items_guard BEFORE UPDATE OR DELETE ON compensation_items FOR EACH ROW EXECUTE FUNCTION rgxm_guard_compensation_items();--> statement-breakpoint

-- A full-day per diem and individual meal allowances can't both apply to one contractor and date.
-- The advisory lock serialises concurrent requests for the same person and date.
CREATE OR REPLACE FUNCTION rgxm_check_meal_per_diem() RETURNS trigger AS $$
DECLARE clash integer;
BEGIN
  IF NEW.category NOT IN ('per_diem', 'meal_breakfast', 'meal_lunch', 'meal_dinner') OR NEW.status NOT IN ('pending', 'approved') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.staff_id::text || ':' || NEW.work_date::text, 0));
  SELECT count(*) INTO clash FROM compensation_items
   WHERE staff_id = NEW.staff_id AND work_date = NEW.work_date AND id <> NEW.id AND status IN ('pending', 'approved')
     AND ((NEW.category = 'per_diem' AND category IN ('meal_breakfast', 'meal_lunch', 'meal_dinner'))
       OR (NEW.category <> 'per_diem' AND category = 'per_diem'));
  IF clash > 0 THEN
    RAISE EXCEPTION 'a full-day per diem and meal allowances cannot be combined for the same contractor and date'
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER compensation_items_meal_per_diem BEFORE INSERT OR UPDATE OF status, category ON compensation_items FOR EACH ROW EXECUTE FUNCTION rgxm_check_meal_per_diem();--> statement-breakpoint

-- ─── Stable numbering ────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS bill_number_seq START 1;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS supplier_ref_seq START 1;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS privacy_request_seq START 1;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS incident_seq START 1;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS accounting_export_seq START 1;--> statement-breakpoint

-- ─── Seeds (all unapproved: RGXM / accountant / lawyer approve them in Settings) ─────
INSERT INTO compensation_tax_treatments (category, gst_hst, year_end, notes) VALUES
  ('fee', 'review', 'review', 'Hourly fees. Proposed: GST/HST applies for registered contractors; box 048 fees for services before tax.'),
  ('meal_breakfast', 'review', 'review', NULL),
  ('meal_lunch', 'review', 'review', NULL),
  ('meal_dinner', 'review', 'review', NULL),
  ('per_diem', 'review', 'review', NULL),
  ('mileage', 'review', 'review', NULL),
  ('bonus', 'review', 'review', NULL),
  ('adjustment', 'review', 'review', 'Adjustments normally follow the line they correct.')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO service_categories (key, label, description, place_of_supply_rule) VALUES
  ('event_staff_onsite', 'Onsite event staffing', 'Event staff and brand ambassadors working at the event venue.', 'event_province'),
  ('load_in_setup', 'Load-in and setup', 'Load-in, setup and tear-down labour at the event venue (non-construction).', 'event_province'),
  ('chef_onsite', 'Chef services at the event', 'Chefs preparing or serving food at the event venue.', 'finance_review')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The rate Crew already used for Ontario. Draft until the accountant approves it.
INSERT INTO tax_rules (jurisdiction, component, rate_ppm, effective_from, status, notes)
VALUES ('ON', 'HST', 130000, '2010-07-01', 'draft', 'Ontario HST 13% (the rate Crew applied before tax rules). Needs accountant approval.');
--> statement-breakpoint
INSERT INTO retention_policies (category, label, retention_days, action, description) VALUES
  ('check_in_location', 'Check-in / check-out location', (SELECT location_retention_days FROM org_settings WHERE id = 1), 'clear_fields', 'Coordinates are cleared; the check-in time stays.'),
  ('email_copies', 'Copies of sent emails', (SELECT mail_log_retention_days FROM org_settings WHERE id = 1), 'clear_fields', 'Email bodies are cleared; the delivery record stays.'),
  ('expired_sessions', 'Expired sign-in sessions and links', 0, 'delete', 'Removed as soon as they expire (security housekeeping).'),
  ('inactive_profiles', 'Profiles of contractors no longer working with RGXM', NULL, 'anonymize', 'Personal details erased; work, pay and tax records kept.'),
  ('internal_notes', 'Internal notes about contractors', NULL, 'delete', NULL),
  ('evaluations', 'Post-event evaluations', NULL, 'delete', NULL),
  ('messages', 'Messages with contractors', NULL, 'delete', NULL),
  ('staff_files', 'Résumés, portfolios and other uploaded files', NULL, 'delete', NULL),
  ('audit_log', 'Audit log', NULL, 'not_deletable', 'Append-only accountability record. Kept with personal details minimised.'),
  ('financial_records', 'Work, pay, tax and bill records', NULL, 'restricted_archive', 'Never deleted automatically. Restricted to Finance and Admins.')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO consent_purposes (key, label, description, active) VALUES
  ('marketing_email', 'News and announcements from RGXM', 'Occasional emails about RGXM news and events that are not about your shifts or pay. You can change this any time.', false)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ─── Row-level security for the new tables (deny-by-default for API roles) ─────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legal_documents', 'staff_acceptances', 'consent_purposes', 'staff_consent_events', 'contractor_approvals',
    'contractor_evidence', 'staff_email_preferences', 'project_compensation_settings', 'compensation_items', 'service_categories',
    'tax_rules', 'compensation_tax_treatments', 'payable_tax_lines', 'accounting_suppliers', 'bills', 'accounting_exports',
    'accounting_export_bills', 'contractor_invoices', 'pay_review_requests', 'year_end_recipients', 'year_end_snapshots',
    'retention_policies', 'retention_runs', 'legal_holds', 'privacy_requests', 'incidents', 'auth_step_ups', 'known_sign_in_contexts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
  END IF;
END $$;
