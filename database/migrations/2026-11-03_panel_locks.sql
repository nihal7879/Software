-- A lock per audience, instead of one for students only.
--
-- The single student switch left a hole the office found in use: a parent
-- dashboard shows the same hours, fees and attendance for the same child, so
-- locking students while figures were being corrected left the one audience
-- most likely to ask about them still reading the old numbers. Teachers are
-- added for the same reason — their screens carry hours taught.
--
-- Three rows, independent of each other. Both start unlocked, which is the
-- behaviour before this existed; the existing student_panel_locked row is
-- left exactly as it is.
USE classroom_app;

INSERT INTO app_settings (setting_key, setting_value, updated_by)
VALUES ('parent_panel_locked', '0', NULL)
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO app_settings (setting_key, setting_value, updated_by)
VALUES ('teacher_panel_locked', '0', NULL)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
