-- ============================================================================
-- Keep the bank's own description of each payment
--
-- transaction_reference holds only the short bank code (15-20 characters, e.g.
-- 033IPPC25262A4F6). The statement line the code came from — the payer's name,
-- their IBAN, the remittance route, who the money was "FOR" — was never
-- imported, so nothing in the database says which parent an unnamed transfer
-- belonged to. That text is the only record when a payment arrives from an
-- account whose name does not match the student's.
--
-- TEXT rather than VARCHAR: the sheet's longest narration is 272 characters
-- today, but a bank narration has no defined ceiling and truncating one loses
-- exactly the trailing detail (SRN, /REF/, purpose) that identifies the payer.
-- ============================================================================
USE classroom_app;

ALTER TABLE fee_transactions
  ADD COLUMN transaction_narration TEXT NULL AFTER transaction_reference;

ALTER TABLE fee_import_drafts
  ADD COLUMN transaction_narration TEXT NULL AFTER transaction_reference;
