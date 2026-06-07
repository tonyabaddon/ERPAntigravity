-- supabase/migrations/20260607000006_recon_periods_and_trigger.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.reconciliation_periods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year                int NOT NULL,
  month               int NOT NULL CHECK (month BETWEEN 1 AND 12),
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSING','CLOSED')),
  opened_at           timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  closed_by           uuid,
  summary             jsonb,
  pdf_storage_path    text,
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS public.reconciliation_settings (
  id                          text PRIMARY KEY DEFAULT 'singleton',
  threshold_green             numeric(3,2) NOT NULL DEFAULT 0.90,
  threshold_yellow            numeric(3,2) NOT NULL DEFAULT 0.75,
  threshold_orange            numeric(3,2) NOT NULL DEFAULT 0.70,
  amount_tolerance_pct        numeric(3,2) NOT NULL DEFAULT 0.05,
  date_window_back_days       int NOT NULL DEFAULT 14,
  date_window_forward_days    int NOT NULL DEFAULT 7,
  edc_mdr_min_pct             numeric(5,4) NOT NULL DEFAULT 0.0050,
  edc_mdr_max_pct             numeric(5,4) NOT NULL DEFAULT 0.0150,
  first_eligible_period_start date NOT NULL DEFAULT (date_trunc('month', now() + INTERVAL '1 month'))::date,
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.reconciliation_settings (id) VALUES ('singleton')
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.reconciliation_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id    uuid REFERENCES public.reconciliation_periods(id),
  table_name   text NOT NULL,
  row_id       uuid NOT NULL,
  action       text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','MATCH','UNMATCH','WRITE_OFF','EXTEND')),
  before_data  jsonb,
  after_data   jsonb,
  edited_by    uuid,
  edited_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ral_period ON public.reconciliation_audit_log(period_id, edited_at DESC);

ALTER TABLE public.reconciliation_periods   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reconciliation_periods' AND policyname='anon full access rp') THEN
    CREATE POLICY "anon full access rp" ON public.reconciliation_periods FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reconciliation_periods' AND policyname='authenticated full access rp') THEN
    CREATE POLICY "authenticated full access rp" ON public.reconciliation_periods FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reconciliation_settings' AND policyname='anon full access rs') THEN
    CREATE POLICY "anon full access rs" ON public.reconciliation_settings FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reconciliation_settings' AND policyname='authenticated full access rs') THEN
    CREATE POLICY "authenticated full access rs" ON public.reconciliation_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reconciliation_audit_log' AND policyname='anon read only ral') THEN
    CREATE POLICY "anon read only ral" ON public.reconciliation_audit_log FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reconciliation_audit_log' AND policyname='authenticated full access ral') THEN
    CREATE POLICY "authenticated full access ral" ON public.reconciliation_audit_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Auto-create payable_slots when order enters a payment-collection state.
CREATE OR REPLACE FUNCTION public.create_slots_for_order() RETURNS trigger AS $$
DECLARE
  cutoff date;
BEGIN
  SELECT first_eligible_period_start INTO cutoff FROM public.reconciliation_settings WHERE id='singleton';
  IF NEW.created_at::date < cutoff THEN RETURN NEW; END IF;

  -- Trigger only on first transition into a payment-collection state
  IF NEW.status IN ('WAITING_PAYMENT','WAITING_DP')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NOT EXISTS (SELECT 1 FROM public.payable_slots WHERE order_id = NEW.id)
  THEN
    IF NEW.payment_type = 'DP' THEN
      INSERT INTO public.payable_slots (order_id, slot_type, expected_amount, due_date)
      VALUES
        (NEW.id, 'DP',      NEW.dp_amount,           COALESCE(NEW.booking_expires_at::date, NEW.created_at::date + INTERVAL '2 days')),
        (NEW.id, 'BALANCE', NEW.total - NEW.dp_amount, NULL);
    ELSE
      INSERT INTO public.payable_slots (order_id, slot_type, expected_amount, due_date)
      VALUES (NEW.id, 'FULL', NEW.total, COALESCE(NEW.booking_expires_at::date, NEW.created_at::date + INTERVAL '2 days'));
    END IF;
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_create_slots ON public.orders;
CREATE TRIGGER trg_orders_create_slots
AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.create_slots_for_order();

COMMIT;
