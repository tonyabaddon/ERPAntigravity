-- 20261115000140_saldo_awal_enum_ext.sql
-- Item #5: extend journal_entry_source enum for OPENING_BALANCE + YEAR_END_CLOSE.
-- Postgres requires ADD VALUE to be in own transaction; split from tables/RPCs.

ALTER TYPE public.journal_entry_source ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';
ALTER TYPE public.journal_entry_source ADD VALUE IF NOT EXISTS 'YEAR_END_CLOSE';
