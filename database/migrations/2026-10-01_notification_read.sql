-- The bell: notifications read inside the app, not only on a lock screen.
--
-- notification_log already holds one row per person per notice, so it is the
-- feed — nothing new has to be written. What it lacked was any idea of whether
-- the person has actually looked.
--
-- This matters more than it sounds. A push only reaches someone who turned
-- notifications on, on that device, and most will not; a row written as
-- 'no_device' used to be the end of the story. The same row now shows in the
-- bell the next time they open the app, so the news reaches everybody and the
-- push is only what makes it arrive sooner.
USE classroom_app;

-- When they saw it. Opening the bell marks everything showing as read, which is
-- what clears the count.
ALTER TABLE notification_log
  ADD COLUMN read_at DATETIME NULL AFTER status;

-- When they cleared it away. Separate from read_at because they are different
-- acts: reading is "I know", clearing is "take it off my list". Nothing is
-- deleted, here as everywhere — a cleared notice still answers "was the parent
-- told?" months later.
ALTER TABLE notification_log
  ADD COLUMN dismissed_at DATETIME NULL AFTER read_at;

-- The bell's two questions — "how many has this person not read" and "show me
-- the last twenty" — both read off this.
CREATE INDEX idx_notif_feed ON notification_log (user_id, dismissed_at, id);
