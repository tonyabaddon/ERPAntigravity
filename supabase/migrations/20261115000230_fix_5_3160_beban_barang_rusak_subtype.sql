-- 20261115000230_fix_5_3160_beban_barang_rusak_subtype.sql
--
-- Fix pre-existing seed anomaly: `5-3160 Beban Barang Rusak` was seeded
-- at slot 100 (supplier_claims) with `account_subtype = NULL` while
-- every other BEBAN NON-OPERASIONAL sibling (`5-3100 Kerugian Piutang`,
-- `5-3150 Kerugian Selisih Stock Opname`) has
-- `account_subtype = 'BEBAN_NON_OPERASIONAL'`.
--
-- Impact of the anomaly: the Laba Rugi report groups accounts by
-- `account_subtype` for the "PENDAPATAN/(BEBAN) LAIN-LAIN" section.
-- Rows with NULL subtype fall outside all groups and are silently
-- omitted from the P&L. This masked opname-damage claims + warehouse-
-- transfer loss journal entries from appearing in reports even though
-- they were correctly posted to the ledger.
--
-- Verified 2026-07-13: after fixing 5-3160 subtype for Garindo,
-- JE-202607-0018 (Backfill kerugian selisih transfer TR-2026-07-002,
-- Rp 90.000) correctly appears in the P&L "Beban Lain-lain" section
-- and Laba Neto drops from 238.000 → 148.000.
--
-- Idempotent: WHERE `account_subtype IS NULL` guard.

BEGIN;

UPDATE public.chart_of_accounts
   SET account_subtype = 'BEBAN_NON_OPERASIONAL',
       updated_at      = now()
 WHERE account_code = '5-3160'
   AND account_subtype IS NULL;

COMMIT;
