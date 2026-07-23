-- Migration 20261115000513: sync plans pricing dengan caleo.id landing
--
-- Landing tunjukkan promo: HEMAT 39% untuk komit 6-bulan, HEMAT 50% untuk komit 12-bulan.
-- DB sebelumnya cuma punya price_annual = Rp 1.2jt / 3.6jt / 9jt yang gak match landing.
--
-- Add price_6mo column (total Rp untuk komit 6 bulan) supaya TenantWizard bisa render
-- instruksi pembayaran sesuai durasi yang dipilih owner (6 vs 12 bulan).
--
-- Landing screenshot verified 2026-07-23:
--   STARTER: 6-bln 509k/bln × 6 = 3.054k · 12-bln 419k/bln × 12 = 5.028k
--   PRO:     6-bln 807k/bln × 6 = 4.842k · 12-bln 664k/bln × 12 = 7.968k
--   PREMIUM: 6-bln 3.630k/bln × 6 = 21.780k · 12-bln 2.990k/bln × 12 = 35.880k
--
-- Also rename PREMIUM name to "Premium AI" (match landing).

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_6mo NUMERIC(15,2);

UPDATE public.plans SET
  price_6mo    = 3054000,
  price_annual = 5028000
WHERE code = 'STARTER';

UPDATE public.plans SET
  price_6mo    = 4842000,
  price_annual = 7968000
WHERE code = 'PRO';

UPDATE public.plans SET
  price_6mo    = 21780000,
  price_annual = 35880000,
  name         = 'Premium AI'
WHERE code = 'PREMIUM';
