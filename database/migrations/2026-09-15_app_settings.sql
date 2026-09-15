-- Institute-wide switches an admin can flip from Settings, without a code change.
--
-- The first is `student_panel_locked`: while it is '1', students can sign in but
-- their dashboard and data pages (hours, fees, lectures) are locked — they can
-- still complete their profile and change their password. It starts locked:
-- student accounts are being handed out before the dashboards are opened.
USE classroom_app;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(80)  PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_by    INT          NULL,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO app_settings (setting_key, setting_value) VALUES ('student_panel_locked', '1')
  ON DUPLICATE KEY UPDATE setting_value = setting_value;
