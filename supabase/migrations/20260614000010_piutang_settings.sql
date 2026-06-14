-- supabase/migrations/20260614000010_piutang_settings.sql
-- Phase 1A: per-tenant Piutang configuration. Pre-Layer-A: one row with
-- sentinel tenant_id. Layer A migration backfills sentinel → Garindo's
-- real tenant_id. New tenants each get their own row at provision time.

CREATE TABLE IF NOT EXISTS public.piutang_settings (
  tenant_id                uuid PRIMARY KEY
                                DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  reminder_offsets         int[]       NOT NULL DEFAULT '{-3,0,3,7,14}',
  wa_send_rate_per_minute  int         NOT NULL DEFAULT 3,
  wa_template_followup     text        NOT NULL DEFAULT
    'Halo {customer_name}, mohon konfirmasi terkait invoice {invoice_no} senilai {total} yang {tempo_phrase}. Terima kasih.',
  term_days_allowed        int[]       NOT NULL DEFAULT '{7,14,30,60,90}',
  aging_buckets            int[]       NOT NULL DEFAULT '{30,60,90}',
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Seed the sentinel row so SELECT queries from the frontend always return data.
INSERT INTO public.piutang_settings (tenant_id)
  VALUES ('00000000-0000-0000-0000-000000000000'::uuid)
  ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE public.piutang_settings ENABLE ROW LEVEL SECURITY;

-- Pre-Layer-A policies: anon SELECT, authenticated UPDATE only.
-- Layer A will tighten to filter by current_setting('app.current_tenant_id').
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'piutang_settings' AND policyname = 'anon_select_piutang_settings'
  ) THEN
    CREATE POLICY "anon_select_piutang_settings" ON public.piutang_settings
      FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'piutang_settings' AND policyname = 'authenticated_update_piutang_settings'
  ) THEN
    CREATE POLICY "authenticated_update_piutang_settings" ON public.piutang_settings
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
