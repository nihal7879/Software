-- Removing a student, through the same queue as the money.
--
-- Until now a student record could only be archived: status Inactive and the
-- login switched off. That is the right answer for a child who has left, and
-- the wrong one for a record that should never have existed — a duplicate
-- entered twice, a test row, a registration typed into the wrong name. Those
-- stay in every list and every search for ever, and the office has nothing to
-- do about it but explain them to each other.
--
-- So: a removal, soft as everything else here. The row is marked is_deleted and
-- stops appearing; nothing is erased, and it can be put back.
--
-- It goes through the super admin for the same reason a payment does. An
-- archive is reversible in one click by whoever did it; a removal takes the
-- record out of every list, and the person who would notice the mistake is the
-- one who can no longer find it.
USE classroom_app;

ALTER TABLE approvals
  MODIFY COLUMN kind ENUM(
    'hours_add','hours_deduct','hours_edit','hours_delete',
    'fee_entry','fee_edit','fee_delete',
    -- target_type/target_id name the student; the payload carries what was
    -- attached at the time of asking, so the super admin decides knowing
    -- whether this record has money and lectures behind it.
    'student_delete'
  ) NOT NULL;
