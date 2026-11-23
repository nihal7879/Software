-- The institute's own three fee messages, replacing the first wording.
--
-- These are the texts the office actually sends parents on WhatsApp, given to
-- us in full on 2026-11-23. The earlier set opened "greetings from Stem
-- Vision"; these open "greetings for the day" and refer to the attached
-- lecture summary, which is what the office pastes alongside the statement.
--
-- Three things in them the template engine did not previously support:
--
--   [[ ... ]]     a clause kept only when the student has actually gone past
--                 the package. At exactly zero hours there is nothing to have
--                 exceeded, so "and has exceeded 0 hours" drops out instead
--                 of being rendered with a zero in it.
--
--   {amount}      what THIS family pays, read off their most recent fee
--   {pkg_hours}   transaction. The institute sells 4200/30, 2100/15, 1900/15
--                 and 4200/35; quoting one figure to everyone would send a
--                 parent on 2100 a bill for 4200. A student who has never
--                 paid - a new joiner's first renewal - falls back to the
--                 house package in the two settings below.
--
--   {n_after}     what remains of a fresh package once the overdraft comes
--                 off it, using that same family's package size. Never
--                 negative: a parent owing more than a whole package is told
--                 nothing remains, not handed a minus number.
--
-- The bank block in reminder_signature is appended to every message and is
-- left exactly as it was.

-- The fallback package, used only for a student with no payment history.
INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('reminder_package_hours', '30'),
  ('reminder_package_amount', '4200')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- 1. Running low: 5 hours or fewer left, but still above zero.
UPDATE app_settings SET setting_value =
'Dear parent, greetings for the day. Please find attached the summary of lectures taken by {name}.

Please note that {name} is left with {n} hours of lectures in the existing package. We request you to renew the package of AED {amount} for {pkg_hours} hours.'
WHERE setting_key = 'reminder_text_first';

-- 2. Package finished: zero, down to just under zero.
UPDATE app_settings SET setting_value =
'Dear parent, greetings for the day. Please find attached the summary of lectures taken by {name}.

Please note that {name} has completed all the hours of the existing package[[, and has exceeded {n} hours of lectures]]. We request you to renew the package of AED {amount} for {pkg_hours} hours.[[ Kindly note that the exceeded hours will be adjusted in the new package.]]'
WHERE setting_key = 'reminder_text_0';

-- 3. Overdrawn: two hours beyond the package or worse.
UPDATE app_settings SET setting_value =
'Dear parent, greetings for the day. Please find attached the summary of lectures taken by {name}.

Please note that {name} has exceeded {n} hours of lectures beyond the package, for which payment is still pending. We request you to renew the package of AED {amount} for {pkg_hours} hours at the earliest. Kindly note that the previous {n} hours will be adjusted in this package renewal, so {n_after} hours will remain in the new package.'
WHERE setting_key = 'reminder_text_over';

-- There is no fourth conversation. A student nine hours beyond the package is
-- asked the same thing, in the same words, as one two hours beyond it. The
-- "firmer wording" tier and the threshold that chose it are gone, so these
-- two rows are now dead weight that would confuse the next person to read
-- app_settings.
DELETE FROM app_settings WHERE setting_key IN ('reminder_text_over_5', 'reminder_harden_at');
