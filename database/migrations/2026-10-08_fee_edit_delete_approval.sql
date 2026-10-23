-- Changing or removing a recorded payment now waits for the super admin.
--
-- Money that has already been entered is the one thing nobody should be able to
-- quietly restate: an edit moves the amount, the date, or the hours it bought,
-- and a delete takes the hours away with it. Both show on a family's statement,
-- so both are parked and nothing is written until the super admin agrees.
--
-- `kind` is an ENUM, so the two new values have to be declared here before the
-- code can store them. Without this the INSERT fails outright in strict mode,
-- or — worse, with strict mode off — writes an empty string, and the request
-- sits in the queue forever as a kind nothing knows how to apply.
USE classroom_app;

ALTER TABLE approvals
  MODIFY COLUMN kind ENUM(
    'hours_add',
    'hours_deduct',
    'hours_edit',
    'hours_delete',
    'fee_entry',
    'fee_edit',    -- a recorded payment changed
    'fee_delete'   -- a recorded payment removed, and the hours it bought with it
  ) NOT NULL;
