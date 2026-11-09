ALTER TABLE "project_compensation_settings" ADD COLUMN "eligible_meals" text[] DEFAULT '{meal_breakfast,meal_lunch,meal_dinner}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "project_compensation_settings" ADD COLUMN "bonus_cents" integer;--> statement-breakpoint
ALTER TABLE "project_compensation_settings" ADD COLUMN "bonus_conditions" text;--> statement-breakpoint
ALTER TABLE "project_compensation_settings" ADD COLUMN "notes" text;