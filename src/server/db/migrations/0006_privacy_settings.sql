ALTER TABLE "org_settings" ADD COLUMN "require_mfa_for_privileged" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "location_retention_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mail_log_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint

-- Attendance events stay append-only, with one exception for privacy retention: the
-- coordinates (and accuracy) may be cleared. Nothing else may change, and they can't be set again.
CREATE OR REPLACE FUNCTION rgxm_guard_attendance_events() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attendance_events is append-only; DELETE is not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.latitude IS NOT NULL OR NEW.longitude IS NOT NULL OR NEW.accuracy_meters IS NOT NULL
     OR (ROW(NEW.id, NEW.booking_id, NEW.type, NEW.occurred_at, NEW.recorded_at, NEW.method, NEW.recorded_by,
             NEW.within_geofence, NEW.client_event_id, NEW.note)
         IS DISTINCT FROM
         ROW(OLD.id, OLD.booking_id, OLD.type, OLD.occurred_at, OLD.recorded_at, OLD.method, OLD.recorded_by,
             OLD.within_geofence, OLD.client_event_id, OLD.note)) THEN
    RAISE EXCEPTION 'attendance_events is append-only; only clearing location for retention is permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER attendance_events_append_only ON attendance_events;
--> statement-breakpoint
CREATE TRIGGER attendance_events_append_only BEFORE UPDATE OR DELETE ON attendance_events
  FOR EACH ROW EXECUTE FUNCTION rgxm_guard_attendance_events();
--> statement-breakpoint
ALTER TABLE org_settings ADD CONSTRAINT org_settings_retention_range
  CHECK (location_retention_days BETWEEN 7 AND 3650 AND mail_log_retention_days BETWEEN 1 AND 3650);
