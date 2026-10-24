ALTER TABLE "payment_batches" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- ─── Payment batches ─────────────────────────────────────────────────────────────
-- Batch membership and amounts are fixed once written. An item can only be deactivated
-- (removed from a draft batch, failed, or batch voided) so its payable can be re-batched.
CREATE OR REPLACE FUNCTION rgxm_guard_batch_items() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment batch items cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.payable_item_id IS DISTINCT FROM OLD.payable_item_id
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR (OLD.active = false AND NEW.active = true) THEN
    RAISE EXCEPTION 'payment batch items are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_batch_items_guard BEFORE UPDATE OR DELETE ON payment_batch_items
  FOR EACH ROW EXECUTE FUNCTION rgxm_guard_batch_items();
--> statement-breakpoint

-- Paid and void batches are final; totals and type never change after creation except
-- when items are removed from a draft.
CREATE OR REPLACE FUNCTION rgxm_guard_batches() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment batches cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'payment batch % is % and cannot change', OLD.reference, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.type IS DISTINCT FROM OLD.type OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.is_demo IS DISTINCT FROM OLD.is_demo
     OR (OLD.status <> 'draft' AND NEW.total_cents IS DISTINCT FROM OLD.total_cents) THEN
    RAISE EXCEPTION 'payment batch % details are fixed', OLD.reference USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_batches_guard BEFORE UPDATE OR DELETE ON payment_batches
  FOR EACH ROW EXECUTE FUNCTION rgxm_guard_batches();
--> statement-breakpoint

-- Exports are a record of what left the system: only marking one superseded (once) is allowed.
CREATE OR REPLACE FUNCTION rgxm_guard_exports() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment exports cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.superseded_at IS NOT NULL
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.format IS DISTINCT FROM OLD.format
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.row_count IS DISTINCT FROM OLD.row_count OR NEW.exported_by IS DISTINCT FROM OLD.exported_by
     OR (NEW.superseded_at IS NOT NULL AND (NEW.superseded_reason IS NULL OR length(trim(NEW.superseded_reason)) = 0)) THEN
    RAISE EXCEPTION 'payment exports are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_exports_guard BEFORE UPDATE OR DELETE ON payment_exports
  FOR EACH ROW EXECUTE FUNCTION rgxm_guard_exports();
--> statement-breakpoint

-- A payable must match its timesheet's approved hours at creation.
CREATE OR REPLACE FUNCTION rgxm_check_payable_minutes() RETURNS trigger AS $$
DECLARE ts_minutes integer;
BEGIN
  SELECT payable_minutes INTO ts_minutes FROM timesheets WHERE id = NEW.timesheet_id;
  IF ts_minutes IS DISTINCT FROM NEW.payable_minutes THEN
    RAISE EXCEPTION 'payable minutes (%) must equal the timesheet''s approved minutes (%)', NEW.payable_minutes, ts_minutes
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payable_items_minutes_check BEFORE INSERT ON payable_items
  FOR EACH ROW EXECUTE FUNCTION rgxm_check_payable_minutes();
--> statement-breakpoint
ALTER TABLE payment_batches ENABLE ROW LEVEL SECURITY;
