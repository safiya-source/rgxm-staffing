ALTER TABLE "message_threads" ADD COLUMN "staff_last_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_threads" ADD COLUMN "rgxm_last_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "message_threads_staff_project_uq" ON "message_threads" USING btree ("staff_id",coalesce("project_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "message_threads_last_idx" ON "message_threads" USING btree ("last_message_at");