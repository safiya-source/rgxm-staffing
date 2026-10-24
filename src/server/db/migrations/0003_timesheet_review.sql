ALTER TABLE "timesheets" ADD COLUMN "worked_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheets" ADD COLUMN "worked_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheets" ADD COLUMN "flags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheets" ADD COLUMN "supervisor_note" text;--> statement-breakpoint
ALTER TABLE "timesheets" ADD COLUMN "review_note" text;