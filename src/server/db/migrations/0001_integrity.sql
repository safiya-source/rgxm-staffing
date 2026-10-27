-- Database-level integrity rules that must hold no matter which code path writes the data.
-- Application services enforce the same rules first and return friendly errors; these are the backstop.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- ─── No double-booking ───────────────────────────────────────────────────────────
-- A staff member cannot hold two confirmed/completed bookings whose times overlap,
-- unless the booking carries an explicit authorised override (override_by set).
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('confirmed', 'completed') AND override_by IS NULL);
--> statement-breakpoint

ALTER TABLE bookings ADD CONSTRAINT bookings_time_order CHECK (ends_at > starts_at);
--> statement-breakpoint

-- Keep booking times in step with their shift. If a schedule change would create a
-- double-booking, the exclusion constraint rejects the whole update.
CREATE OR REPLACE FUNCTION rgxm_sync_booking_times() RETURNS trigger AS $$
BEGIN
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    UPDATE bookings
       SET starts_at = NEW.starts_at, ends_at = NEW.ends_at, updated_at = now()
     WHERE shift_id = NEW.id
       AND status NOT IN ('cancelled', 'declined', 'completed', 'no_show');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER shifts_sync_booking_times AFTER UPDATE OF starts_at, ends_at ON shifts
  FOR EACH ROW EXECUTE FUNCTION rgxm_sync_booking_times();
--> statement-breakpoint

-- The agreed rate is a snapshot: once a booking is confirmed it cannot be changed.
CREATE OR REPLACE FUNCTION rgxm_guard_agreed_rate() RETURNS trigger AS $$
BEGIN
  IF OLD.agreed_rate_cents IS NOT NULL
     AND NEW.agreed_rate_cents IS DISTINCT FROM OLD.agreed_rate_cents
     AND OLD.status IN ('confirmed', 'completed', 'no_show') THEN
    RAISE EXCEPTION 'agreed_rate_cents is fixed once a booking is confirmed (booking %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER bookings_guard_agreed_rate BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION rgxm_guard_agreed_rate();
--> statement-breakpoint

-- ─── Append-only tables ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rgxm_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER attendance_events_append_only BEFORE UPDATE OR DELETE ON attendance_events
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER timesheet_adjustments_append_only BEFORE UPDATE OR DELETE ON timesheet_adjustments
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER offer_responses_append_only BEFORE UPDATE OR DELETE ON offer_responses
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER booking_status_history_append_only BEFORE UPDATE OR DELETE ON booking_status_history
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER document_acknowledgements_append_only BEFORE UPDATE OR DELETE ON document_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER payment_exports_no_delete BEFORE DELETE ON payment_exports
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER payment_batch_items_no_delete BEFORE DELETE ON payment_batch_items
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER bookings_no_delete BEFORE DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER shifts_no_delete BEFORE DELETE ON shifts
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint
CREATE TRIGGER timesheets_no_delete BEFORE DELETE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION rgxm_append_only();
--> statement-breakpoint

-- ─── Rate history ────────────────────────────────────────────────────────────────
-- Rates are superseded, never edited: only closing an open row (setting effective_to) is allowed.
CREATE OR REPLACE FUNCTION rgxm_guard_staff_rates() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'staff_rates history cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.effective_to IS NOT NULL
     OR NEW.rate_cents IS DISTINCT FROM OLD.rate_cents
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'staff_rates rows are immutable; insert a new rate instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER staff_rates_guard BEFORE UPDATE OR DELETE ON staff_rates
  FOR EACH ROW EXECUTE FUNCTION rgxm_guard_staff_rates();
--> statement-breakpoint

-- ─── Payables ────────────────────────────────────────────────────────────────────
-- Calculated amounts never change after creation. Corrections are made by voiding
-- (before payment) and recreating, or via a separate adjustment payable after payment.
CREATE OR REPLACE FUNCTION rgxm_guard_payable_items() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payable_items cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.timesheet_id IS DISTINCT FROM OLD.timesheet_id
     OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.payable_minutes IS DISTINCT FROM OLD.payable_minutes
     OR NEW.rate_cents IS DISTINCT FROM OLD.rate_cents
     OR NEW.base_cents IS DISTINCT FROM OLD.base_cents
     OR NEW.premiums_cents IS DISTINCT FROM OLD.premiums_cents
     OR NEW.expenses_cents IS DISTINCT FROM OLD.expenses_cents
     OR NEW.adjustments_cents IS DISTINCT FROM OLD.adjustments_cents
     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
     OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.calc_version IS DISTINCT FROM OLD.calc_version
     OR NEW.calc_inputs IS DISTINCT FROM OLD.calc_inputs THEN
    RAISE EXCEPTION 'payable amounts are immutable (payable %)', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'paid' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'disputed' THEN
    RAISE EXCEPTION 'paid payables can only move to disputed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'void' AND OLD.status IN ('exported', 'paid') THEN
    RAISE EXCEPTION 'exported or paid payables cannot be voided' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payable_items_guard BEFORE UPDATE OR DELETE ON payable_items
  FOR EACH ROW EXECUTE FUNCTION rgxm_guard_payable_items();
--> statement-breakpoint

-- Hours on an exported or paid timesheet are frozen.
CREATE OR REPLACE FUNCTION rgxm_guard_timesheets() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('exported', 'paid')
     AND (NEW.payable_minutes IS DISTINCT FROM OLD.payable_minutes
          OR NEW.break_minutes IS DISTINCT FROM OLD.break_minutes
          OR NEW.actual_start IS DISTINCT FROM OLD.actual_start
          OR NEW.actual_end IS DISTINCT FROM OLD.actual_end) THEN
    RAISE EXCEPTION 'timesheet % is % and its hours cannot change', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER timesheets_guard BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION rgxm_guard_timesheets();
--> statement-breakpoint

-- ─── Row-level security baseline ────────────────────────────────────────────────
-- The application connects as the table owner and enforces authorisation in its service layer.
-- RLS is enabled with no policies so that any other role (e.g. Supabase's anon/authenticated
-- roles exposed through its REST API) is denied by default.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\_\_%' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO org_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
