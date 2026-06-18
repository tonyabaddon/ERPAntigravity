-- Phase 1B PR A — one-shot seed of store_settings + store_bank_accounts from
-- legacy company_settings + bank_config so the new Pengaturan cards open
-- with the user's existing data instead of blank defaults.
--
-- Idempotent:
--   * store_settings: only update when the row is still at migration-010
--     defaults (nama_toko='Sinar Elektrik' AND alamat_lengkap='') so a
--     subsequent Owner edit through the new card is never overwritten.
--   * store_bank_accounts: only insert rows from bank_config whose
--     (bank_name, account_number) pair isn't already present.

DO $$
DECLARE
  v_legacy_company record;
  v_default_nama text;
  v_default_alamat text;
BEGIN
  -- store_settings copy (skip if user has already edited the new card)
  SELECT company_name, address, phone INTO v_legacy_company FROM company_settings WHERE id = 1;
  SELECT nama_toko, alamat_lengkap INTO v_default_nama, v_default_alamat FROM store_settings WHERE id = 1;

  IF v_legacy_company IS NOT NULL
     AND v_default_nama = 'Sinar Elektrik'
     AND v_default_alamat = ''
  THEN
    UPDATE store_settings
    SET
      nama_toko = COALESCE(NULLIF(v_legacy_company.company_name, ''), nama_toko),
      alamat_lengkap = COALESCE(NULLIF(v_legacy_company.address, ''), alamat_lengkap),
      telp_wa = COALESCE(NULLIF(v_legacy_company.phone, ''), telp_wa),
      updated_at = NOW()
    WHERE id = 1;
  END IF;
END $$;

-- store_bank_accounts copy
INSERT INTO store_bank_accounts (bank_name, account_number, account_holder, is_active, sort_order)
SELECT
  bc.bank_name,
  bc.account_number,
  bc.account_name AS account_holder,
  bc.is_active,
  bc.id AS sort_order
FROM bank_config bc
WHERE NOT EXISTS (
  SELECT 1 FROM store_bank_accounts ba
  WHERE ba.bank_name = bc.bank_name
    AND ba.account_number = bc.account_number
);
