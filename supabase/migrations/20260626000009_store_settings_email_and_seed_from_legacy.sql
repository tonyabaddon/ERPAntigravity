-- 20260626000009_store_settings_email_and_seed_from_legacy.sql
--
-- Legacy Pengaturan cleanup PR: store_settings becomes the sole source of
-- truth for company identity displayed on invoices, opname slips, and
-- purchase invoices. The legacy company_settings table stays for non-
-- display settings only (costing_method, opname_require_witness).
--
-- 1) Add `email` column to store_settings — the (lama) Profil Perusahaan
--    section had email; new IdentitasTokoCard didn't. Adding it here so
--    consumers don't lose access to the field after migration.
-- 2) One-shot copy from company_settings.email → store_settings.email when
--    store_settings.email is still NULL (idempotent like migration 016).

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS email text NULL;

UPDATE public.store_settings ss
   SET email = cs.email
  FROM public.company_settings cs
 WHERE cs.id = 1
   AND ss.id = 1
   AND ss.email IS NULL
   AND cs.email IS NOT NULL
   AND length(trim(cs.email)) > 0;
