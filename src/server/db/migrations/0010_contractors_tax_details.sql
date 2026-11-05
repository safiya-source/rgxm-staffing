ALTER TABLE "staff_profiles" ALTER COLUMN "classification" SET DEFAULT 'contractor';--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "sin_encrypted" text;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "sin_last3" text;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "mailing_street" text;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "mailing_city" text;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "mailing_province" text;--> statement-breakpoint
ALTER TABLE "staff_sensitive" ADD COLUMN "mailing_postal_code" text;--> statement-breakpoint
-- RGXM engages all field staff as independent contractors.
UPDATE "staff_profiles" SET "classification" = 'contractor' WHERE "classification" <> 'contractor';
