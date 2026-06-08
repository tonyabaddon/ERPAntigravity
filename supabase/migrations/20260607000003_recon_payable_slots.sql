-- supabase/migrations/20260607000003_recon_payable_slots.sql
BEGIN;

-- New enum for orders.channel (lowercase to match kasir_channel convention)
DO $$ BEGIN
  CREATE TYPE sales_channel AS ENUM ('whatsapp','tokopedia','walkin','grosir');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS channel sales_channel NOT NULL DEFAULT 'whatsapp';

CREATE TABLE IF NOT EXISTS public.payable_slots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  slot_type           text NOT NULL CHECK (slot_type IN ('FULL','DP','BALANCE')),
  expected_amount     numeric(15,2) NOT NULL,
  matched_amount      numeric(15,2) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MATCHED','WRITTEN_OFF','EXTENDED')),
  due_date            date,
  written_off_at      timestamptz,
  written_off_reason  text,
  extended_count      int NOT NULL DEFAULT 0,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ps_order ON public.payable_slots(order_id);
CREATE INDEX IF NOT EXISTS idx_ps_open ON public.payable_slots(status, due_date) WHERE status = 'OPEN';

ALTER TABLE public.payable_slots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payable_slots' AND policyname='anon full access payable_slots') THEN
    CREATE POLICY "anon full access payable_slots" ON public.payable_slots FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payable_slots' AND policyname='authenticated full access payable_slots') THEN
    CREATE POLICY "authenticated full access payable_slots" ON public.payable_slots FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Now we can add the FK from allocations to slots
ALTER TABLE public.bank_line_allocations
  ADD CONSTRAINT fk_bla_slot FOREIGN KEY (slot_id) REFERENCES public.payable_slots(id) ON DELETE CASCADE;

-- Sync slot matched_amount / status when allocations change
CREATE OR REPLACE FUNCTION public.sync_slot_after_allocation() RETURNS trigger AS $$
DECLARE
  affected uuid := COALESCE(NEW.slot_id, OLD.slot_id);
BEGIN
  WITH agg AS (
    SELECT slot_id, COALESCE(SUM(amount),0) AS total
    FROM public.bank_line_allocations WHERE slot_id = affected
    GROUP BY slot_id
  )
  UPDATE public.payable_slots ps SET
    matched_amount = COALESCE(agg.total, 0),
    status = CASE WHEN COALESCE(agg.total,0) >= ps.expected_amount THEN 'MATCHED' ELSE 'OPEN' END,
    updated_at = now()
  FROM agg
  WHERE ps.id = agg.slot_id;
  -- Handle delete that leaves no allocations
  IF NOT FOUND THEN
    UPDATE public.payable_slots SET matched_amount = 0, status = 'OPEN', updated_at = now()
    WHERE id = affected AND status = 'MATCHED';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_slot_after_allocation ON public.bank_line_allocations;
CREATE TRIGGER trg_sync_slot_after_allocation
AFTER INSERT OR DELETE OR UPDATE ON public.bank_line_allocations
FOR EACH ROW EXECUTE FUNCTION public.sync_slot_after_allocation();

COMMIT;
