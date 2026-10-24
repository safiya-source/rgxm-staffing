-- Hours protection (rules 9–11):
--  * exported or paid: hours never change
--  * approved or locked: hours change only inside the authorised correction workflow, which sets
--    the transaction-local flag rgxm.hours_correction = 'on' and records a timesheet_adjustment
CREATE OR REPLACE FUNCTION rgxm_guard_timesheets() RETURNS trigger AS $$
DECLARE
  hours_changed boolean := NEW.payable_minutes IS DISTINCT FROM OLD.payable_minutes
    OR NEW.break_minutes IS DISTINCT FROM OLD.break_minutes
    OR NEW.worked_start IS DISTINCT FROM OLD.worked_start
    OR NEW.worked_end IS DISTINCT FROM OLD.worked_end
    OR NEW.actual_start IS DISTINCT FROM OLD.actual_start
    OR NEW.actual_end IS DISTINCT FROM OLD.actual_end;
BEGIN
  IF hours_changed AND OLD.status IN ('exported', 'paid') THEN
    RAISE EXCEPTION 'timesheet % is % and its hours cannot change', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF hours_changed AND OLD.status IN ('approved', 'locked')
     AND coalesce(current_setting('rgxm.hours_correction', true), '') <> 'on' THEN
    RAISE EXCEPTION 'timesheet % is %; use the correction workflow to change its hours', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'locked' AND hours_changed THEN
    RAISE EXCEPTION 'timesheet % is locked in a payment batch', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
