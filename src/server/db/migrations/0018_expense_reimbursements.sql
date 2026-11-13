ALTER TABLE "compensation_items" DROP CONSTRAINT "compensation_items_category";--> statement-breakpoint
ALTER TABLE "compensation_tax_treatments" DROP CONSTRAINT "compensation_tax_treatments_category";--> statement-breakpoint
ALTER TABLE "compensation_items" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD COLUMN "receipt_key" text;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD COLUMN "receipt_name" text;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD COLUMN "receipt_content_type" text;--> statement-breakpoint
ALTER TABLE "compensation_items" ADD CONSTRAINT "compensation_items_reimbursement" CHECK ("compensation_items"."category" <> 'reimbursement' or ("compensation_items"."receipt_key" is not null and length(trim(coalesce("compensation_items"."business_purpose", ''))) > 0 and "compensation_items"."amount_cents" > 0));--> statement-breakpoint
ALTER TABLE "compensation_items" ADD CONSTRAINT "compensation_items_category" CHECK (category in ('meal_breakfast', 'meal_lunch', 'meal_dinner', 'per_diem', 'mileage', 'bonus', 'reimbursement'));--> statement-breakpoint
ALTER TABLE "compensation_tax_treatments" ADD CONSTRAINT "compensation_tax_treatments_category" CHECK (category in ('fee', 'meal_breakfast', 'meal_lunch', 'meal_dinner', 'per_diem', 'mileage', 'bonus', 'reimbursement', 'adjustment'));--> statement-breakpoint
-- Reimbursements are repaid at cost with no GST/HST (enforced in the tax engine). Year-end reporting is left for the accountant.
INSERT INTO compensation_tax_treatments (category, gst_hst, year_end, notes) VALUES
  ('reimbursement', 'not_taxable', 'review', 'Purchases a contractor made on RGXM''s behalf, repaid at cost with a receipt. Never taxed. Proposed year end: exclude (not income) — accountant to confirm.')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "payable_items" DROP CONSTRAINT IF EXISTS "payable_items_category";--> statement-breakpoint
ALTER TABLE "payable_items" ADD CONSTRAINT "payable_items_category" CHECK (category in ('fee', 'meal_breakfast', 'meal_lunch', 'meal_dinner', 'per_diem', 'mileage', 'bonus', 'reimbursement', 'adjustment'));
