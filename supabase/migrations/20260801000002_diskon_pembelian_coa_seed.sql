-- 20260801000002 — Seed COA 5-1900 Diskon Pembelian (kontra HPP, normal credit).
-- Berpasangan dengan 4-1900 Diskon Penjualan (sudah seeded). Dipakai di
-- record_pi RPC patch (Task 12) untuk journal kontra-HPP saat ada diskon
-- supplier di Tagihan PI.

BEGIN;

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_subtype, normal_balance, is_control_account, is_system)
VALUES
  ('5-1900', 'Diskon Pembelian (kontra)', 'BEBAN', 'KONTRA', 'CREDIT', false, true)
ON CONFLICT (tenant_id, account_code) DO NOTHING;

COMMIT;
