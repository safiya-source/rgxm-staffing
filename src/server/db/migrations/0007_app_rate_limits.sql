CREATE TABLE "app_rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "app_rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE INDEX "app_rate_limits_window_idx" ON "app_rate_limits" USING btree ("window_start");--> statement-breakpoint
ALTER TABLE app_rate_limits ENABLE ROW LEVEL SECURITY;
