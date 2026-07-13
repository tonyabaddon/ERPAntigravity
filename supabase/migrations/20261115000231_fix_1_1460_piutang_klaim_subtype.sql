-- 20261115000231_fix_1_1460_piutang_klaim_subtype.sql
--
-- Fix pre-existing seed anomaly: `1-1460 Piutang Klaim Supplier` was
-- seeded at slot 100 (supplier_claims) with `account_subtype = NULL`
-- while sibling PIUTANG accounts have proper subtypes:
--   1-1400 Piutang Usaha         → PIUTANG_USAHA
--   1-1450 Piutang Lain-lain     → PIUTANG
--   1-1460 Piutang Klaim Supplier → NULL   ← anomaly
--
-- Impact of the anomaly (silent): Neraca report groups accounts by
-- `account_subtype` for the "Piutang" section. Rows with NULL subtype
-- fall outside all groups and are silently omitted from the balance
-- sheet Piutang aggregate. Same class of bug as 5-3160 fixed in slot
-- 230; caught during systematic sweep 2026-07-13.
--
-- At the time of this migration, 0 JE rows hit 1-1460 in any tenant,
-- so this fix is pure metadata prep — no historical data
-- reclassification. Prevents future silent-omission when opname damage
-- flow (slot 102 `_apply_opname_change_with_damage`) begins posting
-- Dr 1-1460 / Cr 1-1510 in production.
--
-- Idempotent: WHERE `account_subtype IS NULL` guard.
--
-- 2-1400 Hutang Lain-lain (LIABILITAS) has the same NULL-subtype
-- anomaly but is DEFERRED — no matching HUTANG_* subtype exists yet,
-- requires either creating a new HUTANG_LAINLAIN subtype or founder
-- decision on grouping. Not fixed in this migration.

BEGIN;

UPDATE public.chart_of_accounts
   SET account_subtype = 'PIUTANG',
       updated_at      = now()
 WHERE account_code = '1-1460'
   AND account_subtype IS NULL;

COMMIT;
