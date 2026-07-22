-- Rollback for pitch-deck demo seed applied 2026-07-11 to toko-jaya-makmur.
-- Run against project ekhhojaezdfjfwuxyjkl (ERP MSME AI Studio) via Supabase MCP or SQL editor.
-- Idempotent: multiple runs are safe.

BEGIN;

DELETE FROM public.leads
WHERE tenant_id = '22222222-2222-2222-2222-222222222222'
  AND id LIKE 'PITCH-LEAD-%';

DELETE FROM public.messages
WHERE conversation_id IN (
  'a1111111-1111-1111-1111-111111111111',
  'a2222222-2222-2222-2222-222222222222',
  'a3333333-3333-3333-3333-333333333333'
);

DELETE FROM public.conversations
WHERE tenant_id = '22222222-2222-2222-2222-222222222222'
  AND collected_data->>'pitch_demo_seed' = 'true';

DELETE FROM public.orders
WHERE tenant_id = '22222222-2222-2222-2222-222222222222'
  AND notes = 'pitch_demo_seed:order';

DELETE FROM public.kasir_transactions
WHERE tenant_id = '22222222-2222-2222-2222-222222222222'
  AND notes LIKE 'pitch_demo_seed%';

DELETE FROM public.whatsapp_numbers
WHERE id = 'wa_tjm_main';

-- Revert store_settings backfill (leave nama_toko + tenant_id alone)
UPDATE public.store_settings
SET alamat_lengkap = '', kota = '', telp_wa = '', email = NULL
WHERE tenant_id = '22222222-2222-2222-2222-222222222222';

-- Revert stocks.harga_modal to NULL (was NULL before seed)
UPDATE public.stocks
SET harga_modal = NULL
WHERE tenant_id = '22222222-2222-2222-2222-222222222222';

COMMIT;
