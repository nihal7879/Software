-- The teacher lock, split into the three things a teacher does.
--
-- One switch for the whole teacher app took all nine teachers' screens away
-- at once, which is not what the office wanted: they want the hours on the
-- dashboard held back while teaching — and entering classes — carries on.
--
-- teacher_panel_locked is left in place, untouched. It is what a database
-- without this migration falls back to, and the API still writes it when the
-- whole teacher app is locked from the old switch.
--
-- Seeded the way the office asked on 5 November 2026: the dashboard keeps
-- whatever the old switch said, My Students and Lecture Entry open.
INSERT INTO app_settings (setting_key, setting_value, updated_by)
SELECT 'teacher_dashboard_locked',
       COALESCE((SELECT setting_value FROM app_settings s WHERE s.setting_key = 'teacher_panel_locked'), '0'),
       NULL
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO app_settings (setting_key, setting_value, updated_by)
VALUES ('teacher_students_locked', '0', NULL)
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO app_settings (setting_key, setting_value, updated_by)
VALUES ('teacher_lecture_locked', '0', NULL)
ON DUPLICATE KEY UPDATE setting_key = setting_key;

SELECT setting_key, setting_value FROM app_settings
 WHERE setting_key LIKE '%_locked' ORDER BY setting_key;
