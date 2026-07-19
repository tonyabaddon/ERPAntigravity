-- supabase/migrations/20261115000470_caleo_admin_bot.sql
-- Caleo Admin Bot tables + FAQ seed (backend-only)

-- No sentinel tenant row per Errata 4 — bot logs use hardcoded UUID only

CREATE TABLE IF NOT EXISTS public.caleo_admin_bot_faq (
  id TEXT PRIMARY KEY,
  keywords TEXT[] NOT NULL,
  response TEXT NOT NULL,
  next_step TEXT
);

CREATE TABLE IF NOT EXISTS public.caleo_admin_bot_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  first_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  faq_hits JSONB DEFAULT '[]'::JSONB,
  escalated_at TIMESTAMPTZ,
  demo_scheduled_at TIMESTAMPTZ,
  converted_to_signup_at TIMESTAMPTZ,
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_caleo_bot_analytics_first_msg
  ON public.caleo_admin_bot_analytics (first_message_at DESC);

-- Grant backend-only access (no RLS)
GRANT SELECT, INSERT, UPDATE ON public.caleo_admin_bot_faq TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.caleo_admin_bot_analytics TO service_role;

-- Seed FAQ entries (idempotent)
INSERT INTO public.caleo_admin_bot_faq (id, keywords, response, next_step) VALUES
  ('harga', ARRAY['harga','biaya','cost','berapa','price'],
    'Halo! Paket Caleo:\n\n📦 Starter — Rp 419K/bulan\n💼 Pro — Rp 664K/bulan\n✨ Premium + AI — Rp 2.990K/bulan\n\nSemua sudah hemat 50% via promo spesial (harga normal 2x). Detail lengkap: caleo.id/#promos',
    'schedule_demo'),
  ('setup', ARRAY['setup','onboarding','install','mulai'],
    'Setup Caleo cepat! Tim kami akan bantu migrasi data + training tim kamu dalam 1 minggu. Gratis konsultasi via chat WA sini. Mau kita atur jadwal demo?',
    'schedule_demo'),
  ('trial', ARRAY['trial','coba','gratis','refund'],
    'Kami kasih 14 hari refund guarantee — kalau tidak cocok, 100% uang kembali, no pertanyaan. Jadi hampir seperti free trial 2 minggu tapi kamu tetap akses full feature.',
    NULL),
  ('fitur_starter', ARRAY['starter','fitur starter','apa yg dapet starter'],
    'Paket Starter mencakup:\n✓ POS + Kasir\n✓ Inventory dasar\n✓ Multi-user (5 orang)\n✓ Laporan harian\n\nCocok untuk toko yang baru mulai digitalisasi.',
    NULL),
  ('fitur_pro', ARRAY['pro','fitur pro'],
    'Pro menambah dari Starter:\n✓ Multi-cabang\n✓ Purchase order + Piutang/Hutang\n✓ Laporan analytics\n✓ Multi-user (unlimited)\n✓ Email/SMS reminder\n\nCocok untuk toko growing / multi-lokasi.',
    NULL),
  ('fitur_premium', ARRAY['premium','ai','calista'],
    'Premium menambah semua fitur + AI Calista:\n✓ Website landing custom\n✓ Calista AI WhatsApp — jawab customer 24/7\n✓ WA reminder Piutang otomatis\n✓ Priority support\n\nCalista pakai LLM latest untuk auto-reply customer.',
    NULL),
  ('calista_ai', ARRAY['calista','chatbot','ai wa','gimana ai'],
    'Calista adalah AI WhatsApp yang jawab customer kamu 24/7. Dia paham:\n✓ Cek stok\n✓ Bikinkan invoice\n✓ Jelaskan produk\n✓ Follow-up otomatis\n\nContoh live? Chat aja kalimat "cek stok kabel" — Calista jawab (simulasi demo).',
    NULL),
  ('multi_channel', ARRAY['shopee','tokopedia','marketplace','ecommerce'],
    'Integrasi marketplace ada di roadmap Phase 3. Untuk MVP, sekarang fokus di POS + WA + AI. Kalau kamu punya toko marketplace, transaksi masih perlu diinput manual dulu. Sync API sedang direncanakan.',
    NULL),
  ('security', ARRAY['aman','security','data','privacy','pdp'],
    'Data kamu aman:\n✓ Backup harian otomatis\n✓ Encryption at-rest\n✓ RLS multi-tenant (data satu toko tidak bisa dilihat toko lain)\n✓ UU PDP compliant\n\nDetail teknis: caleo.id/#faq',
    NULL),
  ('integration_bank', ARRAY['bank','rekonsiliasi','qris','payment gateway'],
    'Rekonsiliasi bank manual sekarang (upload mutasi). Integrasi otomatis bank feed + payment gateway (QRIS/GoPay/OVO) ada di roadmap. ETA Q4 2026.',
    NULL),
  ('kantor', ARRAY['kantor','lokasi','alamat','ltc'],
    'Kantor kami di LTC Glodok Lt 3 Blok B-08, Jakarta Barat. Jam operasional Senin-Sabtu 08:00-17:00. Boleh mampir langsung untuk demo!',
    NULL),
  ('demo', ARRAY['demo','lihat demo','presentasi'],
    'Boleh! Bisa demo online via Zoom (30 menit) atau langsung ke kantor kami (LTC Glodok). Kasih tau jadwal yang pas ya. Founder Caleo yang jelaskan langsung.',
    'chat_founder'),
  ('kompetitor', ARRAY['mekari','jurnal','majoo','olsera','kompetitor'],
    'Caleo diferensiasi vs kompetitor:\n✓ AI native (bukan add-on)\n✓ Focus MSME retail (bukan enterprise)\n✓ Bahasa Indonesia + support lokal\n✓ Harga transparan\n\nHappy compare — kirim shortlist kompetitor kamu, kami jelasin bedanya.',
    NULL),
  ('migrasi_data', ARRAY['migrasi','migration','pindah data','dari mekari'],
    'Migrasi data dari sistem lama (Mekari/Jurnal/Excel/dll):\n✓ Import CSV mass\n✓ Team kami bantu setup 1 minggu\n✓ Data lama tetap kamu simpan sebagai backup\n\nNo data loss, no downtime.',
    NULL),
  ('kontak_founder', ARRAY['founder','owner','ngobrol','call'],
    'Boleh! Founder Caleo (Tony) siap ngobrol langsung. Let me connect you...',
    'chat_founder')
ON CONFLICT (id) DO NOTHING;
