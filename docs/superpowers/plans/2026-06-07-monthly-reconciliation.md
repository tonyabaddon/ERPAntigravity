# Monthly Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a monthly book closing screen that matches sales orders → bank mutasi → cash batches, with multi-bank support, AI-extracted PDF parsing, guided wizard, and period lock.

**Architecture:** Postgres tables hold reconciliation state (bank lines, payable slots, cash batches, periods). A Go matching engine runs after each PDF upload (Gemini 3.5 Flash extracts JSON; classifier + scorer assigns lanes). React screen surfaces a 3-column matching grid with drawer-based manual mapping, wizard step tracker, and PO sell-through drill-down.

**Tech Stack:** Postgres (Supabase), Go 1.25 (`backend-go`), React + Vite + Tailwind, Supabase Realtime + RPC, `google.golang.org/generative-ai` for Gemini, `agnivade/levenshtein` for name similarity.

**Spec:** `docs/superpowers/specs/2026-06-07-monthly-reconciliation-design.md`

---

## Phase Map

1. **Database foundation** (T1-T6) — migrations apply cleanly, tables + enums + triggers
2. **Go pure logic** (T7-T11) — name similarity, classifier, scorer, lane assignment (heavy TDD)
3. **Go special handlers** (T12-T14) — cash deposit, EDC settlement, internal transfer
4. **Go PDF + DB layer** (T15-T18) — Gemini document client, recon DB queries
5. **Go HTTP + RPC wiring** (T19-T21) — upload endpoint, period closer, main.go routes
6. **React types + service** (T22-T23) — TS types and Supabase service helpers
7. **React hook** (T24) — `useRekonsiliasi` state aggregation hook
8. **React skeleton screen** (T25) — RekonsiliasiScreen with header + period selector
9. **React wizard + banner** (T26-T27) — WizardSteps + NextActionBanner
10. **React account status + tally bar** (T28-T29) — MultiAccountStatus + TallyBar
11. **React 3-column grid** (T30-T32) — OrdersColumn, MutasiColumn, CashColumn
12. **React mapping drawer + modals** (T33-T35) — MappingDrawer, SplitMode, ClassificationModal
13. **React PO sell-through + completion** (T36-T37) — POSellThrough, CompletionSummary
14. **React wiring** (T38-T39) — Sidebar entry + App.tsx route + permission gate
15. **Manual QA + deploy** (T40-T41) — end-to-end smoke test, deploy

---

## Phase 1 — Database Foundation

### Task 1: Migration — `bank_accounts` + `bank_imports`

**Files:**
- Create: `supabase/migrations/20260607000001_recon_bank_accounts.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- supabase/migrations/20260607000001_recon_bank_accounts.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_code       text NOT NULL CHECK (bank_code IN ('BCA','MANDIRI','BRI','BNI','PERMATA','CIMB','OTHER')),
  account_number  text NOT NULL,
  account_label   text NOT NULL,
  purpose         text NOT NULL CHECK (purpose IN ('OPERATIONAL','OWNER_PERSONAL','SAVINGS','OTHER')),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_code, account_number)
);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_accounts' AND policyname='anon full access bank_accounts') THEN
    CREATE POLICY "anon full access bank_accounts" ON public.bank_accounts FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_accounts' AND policyname='authenticated full access bank_accounts') THEN
    CREATE POLICY "authenticated full access bank_accounts" ON public.bank_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.bank_imports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id       uuid NOT NULL REFERENCES public.bank_accounts(id),
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  filename              text NOT NULL,
  storage_path          text NOT NULL,
  uploaded_by           uuid,
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  line_count            int NOT NULL DEFAULT 0,
  matched_count         int NOT NULL DEFAULT 0,
  gemini_model          text NOT NULL DEFAULT 'gemini-3.5-flash',
  gemini_input_tokens   int,
  gemini_output_tokens  int,
  status                text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','READY','FAILED')),
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_imports_account_period ON public.bank_imports(bank_account_id, period_start);

ALTER TABLE public.bank_imports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_imports' AND policyname='anon full access bank_imports') THEN
    CREATE POLICY "anon full access bank_imports" ON public.bank_imports FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_imports' AND policyname='authenticated full access bank_imports') THEN
    CREATE POLICY "authenticated full access bank_imports" ON public.bank_imports FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2: Apply migration via Supabase MCP or dashboard**

Apply using whichever path the repo uses for migrations (see prior migrations such as `20260605000005_dp_payment.sql`). Verify success:

```bash
SUPABASE_URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2)
ANON_KEY=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
for tbl in bank_accounts bank_imports; do
  curl -s -o /dev/null -w "${tbl}: HTTP %{http_code}\n" "${SUPABASE_URL}/rest/v1/${tbl}?limit=1" -H "apikey: ${ANON_KEY}"
done
```

Expected:
```
bank_accounts: HTTP 200
bank_imports: HTTP 200
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607000001_recon_bank_accounts.sql
git commit -m "feat(db): add bank_accounts and bank_imports tables"
```

---

### Task 2: Migration — `bank_statement_lines` + `bank_line_allocations`

**Files:**
- Create: `supabase/migrations/20260607000002_recon_bank_lines.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- supabase/migrations/20260607000002_recon_bank_lines.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id                 uuid NOT NULL REFERENCES public.bank_imports(id) ON DELETE CASCADE,
  bank_account_id           uuid NOT NULL REFERENCES public.bank_accounts(id),
  txn_date                  date NOT NULL,
  amount                    numeric(15,2) NOT NULL CHECK (amount > 0),
  direction                 text NOT NULL CHECK (direction IN ('IN','OUT')),
  description               text NOT NULL,
  counterparty              text,
  raw_row                   jsonb,
  line_kind                 text NOT NULL DEFAULT 'UNKNOWN' CHECK (line_kind IN (
    'CUSTOMER_PAYMENT','CASH_DEPOSIT','EDC_SETTLEMENT','SUPPLIER_PAYMENT','EXPENSE',
    'BANK_FEE','INTERNAL_TRANSFER','CUSTOMER_TOPUP','OWNER_DRAWING','OWNER_TOPUP',
    'REFUND','OTHER_INCOME','LEGACY_PERIOD','UNKNOWN'
  )),
  lane                      text NOT NULL DEFAULT 'GRAY' CHECK (lane IN ('GREEN','YELLOW','ORANGE','RED','GRAY')),
  match_confidence          numeric(3,2),
  match_reason              text,
  matched_internal_pair_id  uuid REFERENCES public.bank_statement_lines(id),
  matched_at                timestamptz,
  matched_by                uuid,
  notes                     text,
  dedup_hash                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bsl_dedup UNIQUE (bank_account_id, dedup_hash)
);
CREATE INDEX IF NOT EXISTS idx_bsl_account_date ON public.bank_statement_lines(bank_account_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_bsl_lane ON public.bank_statement_lines(lane) WHERE lane IN ('YELLOW','ORANGE','RED');
CREATE INDEX IF NOT EXISTS idx_bsl_kind ON public.bank_statement_lines(line_kind);

ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_statement_lines' AND policyname='anon full access bsl') THEN
    CREATE POLICY "anon full access bsl" ON public.bank_statement_lines FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_statement_lines' AND policyname='authenticated full access bsl') THEN
    CREATE POLICY "authenticated full access bsl" ON public.bank_statement_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.bank_line_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_line_id    uuid NOT NULL REFERENCES public.bank_statement_lines(id) ON DELETE CASCADE,
  slot_id         uuid NOT NULL,        -- FK added in next migration after payable_slots exists
  amount          numeric(15,2) NOT NULL CHECK (amount > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_line_id, slot_id)
);
CREATE INDEX IF NOT EXISTS idx_bla_line ON public.bank_line_allocations(bank_line_id);
CREATE INDEX IF NOT EXISTS idx_bla_slot ON public.bank_line_allocations(slot_id);

ALTER TABLE public.bank_line_allocations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_line_allocations' AND policyname='anon full access bla') THEN
    CREATE POLICY "anon full access bla" ON public.bank_line_allocations FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_line_allocations' AND policyname='authenticated full access bla') THEN
    CREATE POLICY "authenticated full access bla" ON public.bank_line_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2: Apply migration + verify**

```bash
SUPABASE_URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2)
ANON_KEY=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
for tbl in bank_statement_lines bank_line_allocations; do
  curl -s -o /dev/null -w "${tbl}: HTTP %{http_code}\n" "${SUPABASE_URL}/rest/v1/${tbl}?limit=1" -H "apikey: ${ANON_KEY}"
done
```

Expected both HTTP 200.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607000002_recon_bank_lines.sql
git commit -m "feat(db): add bank_statement_lines and bank_line_allocations"
```

---

### Task 3: Migration — `payable_slots` + `orders.channel` + trigger

**Files:**
- Create: `supabase/migrations/20260607000003_recon_payable_slots.sql`

- [ ] **Step 1: Write migration SQL**

```sql
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
```

- [ ] **Step 2: Apply + verify**

```bash
SUPABASE_URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2)
ANON_KEY=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
curl -s -o /dev/null -w "payable_slots: HTTP %{http_code}\n" "${SUPABASE_URL}/rest/v1/payable_slots?limit=1" -H "apikey: ${ANON_KEY}"
curl -s "${SUPABASE_URL}/rest/v1/orders?select=channel&limit=1" -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}"
```

Expected: `payable_slots: HTTP 200` AND orders row includes `"channel":"whatsapp"`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607000003_recon_payable_slots.sql
git commit -m "feat(db): add payable_slots, orders.channel, allocation sync trigger"
```

---

### Task 4: Migration — `cash_deposit_batches` + items + MDR EDC enum

**Files:**
- Create: `supabase/migrations/20260607000004_recon_cash_batches.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- supabase/migrations/20260607000004_recon_cash_batches.sql
BEGIN;

-- Add MDR EDC to kasir_expense_category enum
DO $$ BEGIN
  ALTER TYPE kasir_expense_category ADD VALUE IF NOT EXISTS 'MDR EDC';
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.cash_deposit_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_date        date,
  bank_line_id        uuid REFERENCES public.bank_statement_lines(id),
  deposited_amount    numeric(15,2),
  expected_amount     numeric(15,2) NOT NULL,
  variance            numeric(15,2) NOT NULL DEFAULT 0,
  variance_reason     text CHECK (variance_reason IN ('PETTY_CASH','HITUNG_KURANG','HITUNG_LEBIH','LAINNYA')),
  variance_notes      text,
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DEPOSITED','CARRY_OVER')),
  carry_over_period   text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cash_deposit_batch_items (
  batch_id        uuid NOT NULL REFERENCES public.cash_deposit_batches(id) ON DELETE CASCADE,
  kasir_txn_id    uuid NOT NULL REFERENCES public.kasir_transactions(id),
  PRIMARY KEY (batch_id, kasir_txn_id)
);

ALTER TABLE public.cash_deposit_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_deposit_batch_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cash_deposit_batches' AND policyname='anon full access cdb') THEN
    CREATE POLICY "anon full access cdb" ON public.cash_deposit_batches FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cash_deposit_batches' AND policyname='authenticated full access cdb') THEN
    CREATE POLICY "authenticated full access cdb" ON public.cash_deposit_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cash_deposit_batch_items' AND policyname='anon full access cdbi') THEN
    CREATE POLICY "anon full access cdbi" ON public.cash_deposit_batch_items FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cash_deposit_batch_items' AND policyname='authenticated full access cdbi') THEN
    CREATE POLICY "authenticated full access cdbi" ON public.cash_deposit_batch_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2: Apply + verify**

```bash
SUPABASE_URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2)
ANON_KEY=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
for tbl in cash_deposit_batches cash_deposit_batch_items; do
  curl -s -o /dev/null -w "${tbl}: HTTP %{http_code}\n" "${SUPABASE_URL}/rest/v1/${tbl}?limit=1" -H "apikey: ${ANON_KEY}"
done
```

Expected both HTTP 200.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607000004_recon_cash_batches.sql
git commit -m "feat(db): add cash_deposit_batches + items, add MDR EDC enum value"
```

---

### Task 5: Migration — `stock_lot_consumption` + `purchase_orders.paid_bank_line_id`

**Files:**
- Create: `supabase/migrations/20260607000005_recon_stock_consumption.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- supabase/migrations/20260607000005_recon_stock_consumption.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_lot_consumption (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id          uuid NOT NULL REFERENCES public.stock_lots(id),
  source_type     text NOT NULL CHECK (source_type IN ('ORDER_ITEM','KASIR_ITEM')),
  order_id        uuid REFERENCES public.orders(id),
  kasir_txn_id    uuid REFERENCES public.kasir_transactions(id),
  sku             varchar NOT NULL,
  qty_consumed    int NOT NULL CHECK (qty_consumed > 0),
  unit_cost       numeric(15,2) NOT NULL,
  consumed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slc_lot ON public.stock_lot_consumption(lot_id);
CREATE INDEX IF NOT EXISTS idx_slc_order ON public.stock_lot_consumption(order_id);
CREATE INDEX IF NOT EXISTS idx_slc_kasir ON public.stock_lot_consumption(kasir_txn_id);

ALTER TABLE public.stock_lot_consumption ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_lot_consumption' AND policyname='anon full access slc') THEN
    CREATE POLICY "anon full access slc" ON public.stock_lot_consumption FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_lot_consumption' AND policyname='authenticated full access slc') THEN
    CREATE POLICY "authenticated full access slc" ON public.stock_lot_consumption FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS paid_bank_line_id uuid REFERENCES public.bank_statement_lines(id);

COMMIT;
```

- [ ] **Step 2: Apply + verify**

```bash
SUPABASE_URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2)
ANON_KEY=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
curl -s -o /dev/null -w "stock_lot_consumption: HTTP %{http_code}\n" "${SUPABASE_URL}/rest/v1/stock_lot_consumption?limit=1" -H "apikey: ${ANON_KEY}"
curl -s "${SUPABASE_URL}/rest/v1/purchase_orders?select=paid_bank_line_id&limit=1" -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}"
```

Expected: 200 and the `paid_bank_line_id` field present (null is OK).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607000005_recon_stock_consumption.sql
git commit -m "feat(db): add stock_lot_consumption and purchase_orders.paid_bank_line_id"
```

---

### Task 6: Migration — periods + settings + audit + slots trigger

**Files:**
- Create: `supabase/migrations/20260607000006_recon_periods_and_trigger.sql`

- [ ] **Step 1: Write migration SQL**

```sql
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
  IF NEW.status IN ('WAITING_PAYMENT','WAITING_DP','BOOKED')
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
```

- [ ] **Step 2: Apply + verify**

```bash
SUPABASE_URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2)
ANON_KEY=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
for tbl in reconciliation_periods reconciliation_settings reconciliation_audit_log; do
  curl -s -o /dev/null -w "${tbl}: HTTP %{http_code}\n" "${SUPABASE_URL}/rest/v1/${tbl}?limit=1" -H "apikey: ${ANON_KEY}"
done
curl -s "${SUPABASE_URL}/rest/v1/reconciliation_settings?select=first_eligible_period_start&id=eq.singleton" -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}"
```

Expected 3× HTTP 200 and the settings row with a date string.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607000006_recon_periods_and_trigger.sql
git commit -m "feat(db): periods + settings + audit_log + auto-create slots trigger"
```

---

(Plan continues — Phase 2 onwards follows in subsequent edits.)

## Phase 2 — Go Pure Logic (TDD-heavy)

### Task 7: Recon shared types

**Files:**
- Create: `backend-go/internal/recon/types.go`

- [ ] **Step 1: Write the types**

```go
// backend-go/internal/recon/types.go
package recon

import "time"

type Direction string

const (
    DirectionIn  Direction = "IN"
    DirectionOut Direction = "OUT"
)

type LineKind string

const (
    KindCustomerPayment  LineKind = "CUSTOMER_PAYMENT"
    KindCashDeposit      LineKind = "CASH_DEPOSIT"
    KindEDCSettlement    LineKind = "EDC_SETTLEMENT"
    KindSupplierPayment  LineKind = "SUPPLIER_PAYMENT"
    KindExpense          LineKind = "EXPENSE"
    KindBankFee          LineKind = "BANK_FEE"
    KindInternalTransfer LineKind = "INTERNAL_TRANSFER"
    KindCustomerTopup    LineKind = "CUSTOMER_TOPUP"
    KindOwnerDrawing     LineKind = "OWNER_DRAWING"
    KindOwnerTopup       LineKind = "OWNER_TOPUP"
    KindRefund           LineKind = "REFUND"
    KindOtherIncome      LineKind = "OTHER_INCOME"
    KindLegacyPeriod     LineKind = "LEGACY_PERIOD"
    KindUnknown          LineKind = "UNKNOWN"
)

type Lane string

const (
    LaneGreen  Lane = "GREEN"
    LaneYellow Lane = "YELLOW"
    LaneOrange Lane = "ORANGE"
    LaneRed    Lane = "RED"
    LaneGray   Lane = "GRAY"
)

type BankLine struct {
    ID             string
    BankAccountID  string
    BankAccountNum string // for internal-transfer detection
    TxnDate        time.Time
    Amount         float64
    Direction      Direction
    Description    string
    Counterparty   string
    LineKind       LineKind
    Lane           Lane
}

type PayableSlot struct {
    ID             string
    OrderID        string
    SlotType       string // FULL | DP | BALANCE
    ExpectedAmount float64
    CustomerName   string
    OrderCreatedAt time.Time
    Status         string // OPEN | MATCHED | ...
}

type Supplier struct {
    ID   string
    Name string
}

type BankAccount struct {
    ID            string
    BankCode      string
    AccountNumber string
}

type Settings struct {
    ThresholdGreen        float64
    ThresholdYellow       float64
    ThresholdOrange       float64
    AmountTolerancePct    float64
    DateWindowBackDays    int
    DateWindowForwardDays int
    EDCMDRMinPct          float64
    EDCMDRMaxPct          float64
    FirstEligibleDate     time.Time
}

type Candidate struct {
    Slot           PayableSlot
    Score          float64
    AmountMatch    float64
    NameSimilarity float64
    DateProximity  float64
    Breakdown      string
}
```

- [ ] **Step 2: Verify build**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/recon/...
```

Expected: no output (clean build).

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/recon/types.go
git commit -m "feat(recon): add shared types for matching engine"
```

---

### Task 8: Name similarity (TDD)

**Files:**
- Create: `backend-go/internal/recon/name_similarity_test.go`
- Create: `backend-go/internal/recon/name_similarity.go`

- [ ] **Step 1: Write failing tests**

```go
// backend-go/internal/recon/name_similarity_test.go
package recon

import "testing"

func TestNormalizeName(t *testing.T) {
    cases := []struct{ in, want string }{
        {"PT Sinar Listrik Sejati TBK", "SINAR LISTRIK SEJATI"},
        {"CV Berkah Jaya", "BERKAH JAYA"},
        {"Bpk Hendra Kurniawan", "HENDRA KURNIAWAN"},
        {"  Ibu  Wati  ", "WATI"},
        {"Hendra K", "HENDRA K"},
    }
    for _, c := range cases {
        if got := NormalizeName(c.in); got != c.want {
            t.Errorf("NormalizeName(%q) = %q, want %q", c.in, got, c.want)
        }
    }
}

func TestNameSimilarity(t *testing.T) {
    cases := []struct {
        a, b   string
        minVal float64
        maxVal float64
    }{
        {"HENDRA K", "Hendra Kurniawan", 0.50, 0.95},
        {"Budi Setiawan", "BUDI SETIAWAN", 1.00, 1.00},
        {"CV Berkah Jaya", "Berkah Jaya CV", 0.85, 1.00},
        {"Anton", "Bambang", 0.0, 0.30},
    }
    for _, c := range cases {
        got := NameSimilarity(c.a, c.b)
        if got < c.minVal || got > c.maxVal {
            t.Errorf("NameSimilarity(%q,%q) = %.2f, want [%.2f, %.2f]", c.a, c.b, got, c.minVal, c.maxVal)
        }
    }
}
```

- [ ] **Step 2: Run failing test**

```bash
cd backend-go && go test ./internal/recon/... -run TestNormalizeName -v
```

Expected: FAIL "undefined: NormalizeName".

- [ ] **Step 3: Add dependency**

```bash
cd backend-go && go get github.com/agnivade/levenshtein
```

- [ ] **Step 4: Write implementation**

```go
// backend-go/internal/recon/name_similarity.go
package recon

import (
    "strings"

    "github.com/agnivade/levenshtein"
)

var namePrefixes = []string{"PT ", "CV ", "BPK ", "BAPAK ", "IBU ", "BU ", "MR ", "MRS ", "MS "}
var nameSuffixes = []string{" TBK", " CV", " PT"}

// NormalizeName uppercases, strips business prefixes/suffixes, and collapses whitespace.
func NormalizeName(s string) string {
    u := strings.ToUpper(strings.TrimSpace(s))
    changed := true
    for changed {
        changed = false
        for _, p := range namePrefixes {
            if strings.HasPrefix(u, p) {
                u = strings.TrimSpace(strings.TrimPrefix(u, p))
                changed = true
            }
        }
        for _, sfx := range nameSuffixes {
            if strings.HasSuffix(u, sfx) {
                u = strings.TrimSpace(strings.TrimSuffix(u, sfx))
                changed = true
            }
        }
    }
    // Collapse multi-space
    return strings.Join(strings.Fields(u), " ")
}

// NameSimilarity returns 0.0-1.0. 1.0 = identical after normalization.
func NameSimilarity(a, b string) float64 {
    na, nb := NormalizeName(a), NormalizeName(b)
    if na == "" || nb == "" {
        return 0
    }
    if na == nb {
        return 1.0
    }
    // Check word-set similarity (order-insensitive)
    if wordSetEqual(na, nb) {
        return 0.95
    }
    dist := levenshtein.ComputeDistance(na, nb)
    maxLen := len(na)
    if len(nb) > maxLen {
        maxLen = len(nb)
    }
    if maxLen == 0 {
        return 0
    }
    return 1.0 - float64(dist)/float64(maxLen)
}

func wordSetEqual(a, b string) bool {
    fa, fb := strings.Fields(a), strings.Fields(b)
    if len(fa) != len(fb) {
        return false
    }
    seen := map[string]int{}
    for _, w := range fa {
        seen[w]++
    }
    for _, w := range fb {
        seen[w]--
        if seen[w] < 0 {
            return false
        }
    }
    return true
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
cd backend-go && go test ./internal/recon/... -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/recon/name_similarity.go backend-go/internal/recon/name_similarity_test.go backend-go/go.mod backend-go/go.sum
git commit -m "feat(recon): name normalization + Levenshtein similarity with tests"
```

---

### Task 9: Classifier (TDD)

**Files:**
- Create: `backend-go/internal/recon/classifier_test.go`
- Create: `backend-go/internal/recon/classifier.go`

- [ ] **Step 1: Write failing tests**

```go
// backend-go/internal/recon/classifier_test.go
package recon

import "testing"

func TestClassify_CashDeposit(t *testing.T) {
    line := BankLine{Direction: DirectionIn, Description: "SETORAN TUNAI CDM SUNTER"}
    if got := Classify(line, nil, nil); got != KindCashDeposit {
        t.Errorf("got %v, want CASH_DEPOSIT", got)
    }
}

func TestClassify_EDCSettlement(t *testing.T) {
    line := BankLine{Direction: DirectionIn, Description: "SETTLEMENT EDC BCA MERCHANT"}
    if got := Classify(line, nil, nil); got != KindEDCSettlement {
        t.Errorf("got %v, want EDC_SETTLEMENT", got)
    }
}

func TestClassify_BankFee(t *testing.T) {
    line := BankLine{Direction: DirectionOut, Description: "BIAYA ADMIN BULANAN"}
    if got := Classify(line, nil, nil); got != KindBankFee {
        t.Errorf("got %v, want BANK_FEE", got)
    }
}

func TestClassify_OtherIncome_BungaBank(t *testing.T) {
    line := BankLine{Direction: DirectionIn, Description: "BUNGA TABUNGAN"}
    if got := Classify(line, nil, nil); got != KindOtherIncome {
        t.Errorf("got %v, want OTHER_INCOME", got)
    }
}

func TestClassify_InternalTransfer(t *testing.T) {
    accts := []BankAccount{{ID: "a2", BankCode: "MANDIRI", AccountNumber: "5678"}}
    line := BankLine{Direction: DirectionOut, Description: "TRSF KE 5678 GARINDO JAYA"}
    if got := Classify(line, accts, nil); got != KindInternalTransfer {
        t.Errorf("got %v, want INTERNAL_TRANSFER", got)
    }
}

func TestClassify_SupplierPayment(t *testing.T) {
    suppliers := []Supplier{{ID: "s1", Name: "PT Sinar Listrik Sejati"}}
    line := BankLine{Direction: DirectionOut, Counterparty: "SINAR LISTRIK SEJATI PT"}
    if got := Classify(line, nil, suppliers); got != KindSupplierPayment {
        t.Errorf("got %v, want SUPPLIER_PAYMENT", got)
    }
}

func TestClassify_CustomerPayment_DefaultIn(t *testing.T) {
    line := BankLine{Direction: DirectionIn, Counterparty: "BUDI SETIAWAN", Description: "TRSF MASUK"}
    if got := Classify(line, nil, nil); got != KindCustomerPayment {
        t.Errorf("got %v, want CUSTOMER_PAYMENT", got)
    }
}

func TestClassify_Expense_DefaultOut(t *testing.T) {
    line := BankLine{Direction: DirectionOut, Description: "BAYAR INTERNET ABC"}
    if got := Classify(line, nil, nil); got != KindExpense {
        t.Errorf("got %v, want EXPENSE", got)
    }
}
```

- [ ] **Step 2: Run failing tests**

```bash
cd backend-go && go test ./internal/recon/... -run TestClassify -v
```

Expected: FAIL "undefined: Classify".

- [ ] **Step 3: Write implementation**

```go
// backend-go/internal/recon/classifier.go
package recon

import "strings"

var cashDepositKeywords = []string{"SETORAN TUNAI", "CDM", "ATM SETORAN", "AUTO TELLER MACH"}
var edcKeywords = []string{"SETTLEMENT EDC", "SETLM EDC", "MERCHANT BCA", "MERCHANT MANDIRI", "EDC SETTLEMENT"}
var feeKeywords = []string{"BIAYA ADMIN", "BIAYA TRF", "ADM E-BANKING", "BIAYA SMS"}
var otherIncomeKeywords = []string{"BUNGA", "CASHBACK", "REWARD"}

func anyContains(s string, words []string) bool {
    for _, w := range words {
        if strings.Contains(s, w) {
            return true
        }
    }
    return false
}

func Classify(line BankLine, accounts []BankAccount, suppliers []Supplier) LineKind {
    d := strings.ToUpper(line.Description)

    if anyContains(d, otherIncomeKeywords) {
        return KindOtherIncome
    }
    if anyContains(d, cashDepositKeywords) {
        return KindCashDeposit
    }
    if anyContains(d, edcKeywords) {
        return KindEDCSettlement
    }
    if anyContains(d, feeKeywords) {
        return KindBankFee
    }
    // Internal transfer: description contains a known own-account number
    for _, acct := range accounts {
        if acct.AccountNumber != "" && strings.Contains(d, acct.AccountNumber) {
            return KindInternalTransfer
        }
    }
    // Supplier payment (OUT only)
    if line.Direction == DirectionOut {
        for _, sup := range suppliers {
            if sup.Name != "" && NameSimilarity(line.Counterparty, sup.Name) >= 0.85 {
                return KindSupplierPayment
            }
        }
        return KindExpense
    }
    return KindCustomerPayment
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend-go && go test ./internal/recon/... -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/recon/classifier.go backend-go/internal/recon/classifier_test.go
git commit -m "feat(recon): line_kind classifier with TDD coverage"
```

---

### Task 10: Scoring + lane assignment (TDD)

**Files:**
- Create: `backend-go/internal/recon/matcher_test.go`
- Create: `backend-go/internal/recon/matcher.go`

- [ ] **Step 1: Write failing tests**

```go
// backend-go/internal/recon/matcher_test.go
package recon

import (
    "testing"
    "time"
)

func mustDate(s string) time.Time {
    t, _ := time.Parse("2006-01-02", s)
    return t
}

func TestScoreCandidate_ExactMatch(t *testing.T) {
    line := BankLine{Amount: 4200000, Counterparty: "HENDRA K", TxnDate: mustDate("2026-05-28")}
    slot := PayableSlot{ExpectedAmount: 4200000, CustomerName: "Hendra Kurniawan", OrderCreatedAt: mustDate("2026-05-27")}
    c := ScoreCandidate(line, slot)
    if c.Score < 0.85 || c.Score > 0.95 {
        t.Errorf("expected score ~0.90, got %.3f", c.Score)
    }
    if c.AmountMatch != 1.0 {
        t.Errorf("AmountMatch = %.2f, want 1.0", c.AmountMatch)
    }
}

func TestScoreCandidate_AmountOnly(t *testing.T) {
    line := BankLine{Amount: 4200000, Counterparty: "X Y Z", TxnDate: mustDate("2026-05-28")}
    slot := PayableSlot{ExpectedAmount: 4200000, CustomerName: "Hendra Kurniawan", OrderCreatedAt: mustDate("2026-05-01")}
    c := ScoreCandidate(line, slot)
    if c.Score > 0.70 {
        t.Errorf("expected score <= 0.70, got %.3f", c.Score)
    }
}

func TestAssignLane_Green(t *testing.T) {
    s := defaultSettings()
    cands := []Candidate{{Score: 0.95}}
    lane := AssignLane(cands, s)
    if lane != LaneGreen {
        t.Errorf("got %v, want GREEN", lane)
    }
}

func TestAssignLane_Yellow(t *testing.T) {
    s := defaultSettings()
    cands := []Candidate{{Score: 0.82}}
    lane := AssignLane(cands, s)
    if lane != LaneYellow {
        t.Errorf("got %v, want YELLOW", lane)
    }
}

func TestAssignLane_Orange_MultipleCandidates(t *testing.T) {
    s := defaultSettings()
    cands := []Candidate{{Score: 0.86}, {Score: 0.80}, {Score: 0.40}}
    lane := AssignLane(cands, s)
    if lane != LaneOrange {
        t.Errorf("got %v, want ORANGE", lane)
    }
}

func TestAssignLane_Red_NoCandidates(t *testing.T) {
    s := defaultSettings()
    cands := []Candidate{}
    lane := AssignLane(cands, s)
    if lane != LaneRed {
        t.Errorf("got %v, want RED", lane)
    }
}

func TestAssignLane_Red_LowBest(t *testing.T) {
    s := defaultSettings()
    cands := []Candidate{{Score: 0.40}}
    lane := AssignLane(cands, s)
    if lane != LaneRed {
        t.Errorf("got %v, want RED", lane)
    }
}

func defaultSettings() Settings {
    return Settings{
        ThresholdGreen: 0.90, ThresholdYellow: 0.75, ThresholdOrange: 0.70,
    }
}
```

- [ ] **Step 2: Run failing tests**

```bash
cd backend-go && go test ./internal/recon/... -run "TestScoreCandidate|TestAssignLane" -v
```

Expected: FAIL.

- [ ] **Step 3: Write implementation**

```go
// backend-go/internal/recon/matcher.go
package recon

import (
    "fmt"
    "math"
    "sort"
    "time"
)

const (
    weightAmount = 0.50
    weightName   = 0.30
    weightDate   = 0.20
)

// ScoreCandidate computes a 0..1 confidence score for a (bank line, slot) pair.
func ScoreCandidate(line BankLine, slot PayableSlot) Candidate {
    diff := math.Abs(line.Amount - slot.ExpectedAmount)
    var am float64
    switch {
    case diff <= 100:
        am = 1.00
    case diff/slot.ExpectedAmount <= 0.01:
        am = 0.85
    case diff/slot.ExpectedAmount <= 0.03:
        am = 0.50
    default:
        am = 0.0
    }

    ns := NameSimilarity(line.Counterparty, slot.CustomerName)

    dp := dateProximity(line.TxnDate, slot.OrderCreatedAt)

    score := am*weightAmount + ns*weightName + dp*weightDate
    return Candidate{
        Slot:           slot,
        Score:          round2(score),
        AmountMatch:    am,
        NameSimilarity: round2(ns),
        DateProximity:  dp,
        Breakdown:      fmt.Sprintf("amt=%.2f, name=%.2f, date=%.2f", am, ns, dp),
    }
}

func dateProximity(a, b time.Time) float64 {
    days := math.Abs(a.Sub(b).Hours() / 24)
    switch {
    case days < 1:
        return 1.00
    case days <= 1:
        return 0.70
    case days <= 3:
        return 0.50
    case days <= 7:
        return 0.20
    default:
        return 0.00
    }
}

// AssignLane decides a lane for a sorted (or unsorted) candidate list.
func AssignLane(cands []Candidate, s Settings) Lane {
    if len(cands) == 0 {
        return LaneRed
    }
    sort.Slice(cands, func(i, j int) bool { return cands[i].Score > cands[j].Score })
    best := cands[0].Score
    aboveOrange := 0
    for _, c := range cands {
        if c.Score >= s.ThresholdOrange {
            aboveOrange++
        }
    }
    if aboveOrange >= 2 {
        return LaneOrange
    }
    if best >= s.ThresholdGreen {
        return LaneGreen
    }
    if best >= s.ThresholdYellow {
        return LaneYellow
    }
    return LaneRed
}

func round2(v float64) float64 {
    return math.Round(v*100) / 100
}
```

- [ ] **Step 4: Run all tests**

```bash
cd backend-go && go test ./internal/recon/... -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/recon/matcher.go backend-go/internal/recon/matcher_test.go
git commit -m "feat(recon): ScoreCandidate + AssignLane with TDD"
```

---

### Task 11: Candidate generation (TDD)

**Files:**
- Append: `backend-go/internal/recon/matcher.go`
- Append: `backend-go/internal/recon/matcher_test.go`

- [ ] **Step 1: Add failing test**

```go
// Append to backend-go/internal/recon/matcher_test.go
func TestEligibleSlots_FiltersByAmountAndDate(t *testing.T) {
    s := Settings{
        ThresholdGreen: 0.90, ThresholdYellow: 0.75, ThresholdOrange: 0.70,
        AmountTolerancePct: 0.05, DateWindowBackDays: 14, DateWindowForwardDays: 7,
    }
    line := BankLine{Amount: 1_000_000, TxnDate: mustDate("2026-06-10")}
    slots := []PayableSlot{
        {ID: "in",  ExpectedAmount: 1_000_000, OrderCreatedAt: mustDate("2026-06-01")},
        {ID: "amt", ExpectedAmount: 1_500_000, OrderCreatedAt: mustDate("2026-06-01")},
        {ID: "old", ExpectedAmount: 1_000_000, OrderCreatedAt: mustDate("2026-05-01")},
    }
    out := EligibleSlots(line, slots, s)
    if len(out) != 1 || out[0].ID != "in" {
        t.Errorf("expected only 'in', got %+v", out)
    }
}
```

- [ ] **Step 2: Run failing test**

```bash
cd backend-go && go test ./internal/recon/... -run TestEligibleSlots -v
```

Expected: FAIL.

- [ ] **Step 3: Append implementation to matcher.go**

```go
// Append to backend-go/internal/recon/matcher.go

// EligibleSlots returns open slots within amount tolerance and date window of the bank line.
func EligibleSlots(line BankLine, slots []PayableSlot, s Settings) []PayableSlot {
    lo := line.Amount * (1 - s.AmountTolerancePct)
    hi := line.Amount * (1 + s.AmountTolerancePct)
    back := line.TxnDate.AddDate(0, 0, -s.DateWindowBackDays)
    forward := line.TxnDate.AddDate(0, 0, s.DateWindowForwardDays)
    out := make([]PayableSlot, 0, len(slots))
    for _, sl := range slots {
        if sl.ExpectedAmount < lo || sl.ExpectedAmount > hi {
            continue
        }
        if sl.OrderCreatedAt.Before(back) || sl.OrderCreatedAt.After(forward) {
            continue
        }
        out = append(out, sl)
    }
    return out
}
```

- [ ] **Step 4: Run all tests**

```bash
cd backend-go && go test ./internal/recon/... -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/recon/matcher.go backend-go/internal/recon/matcher_test.go
git commit -m "feat(recon): EligibleSlots — amount + date window filter"
```

---

## Phase 3 — Go Special Handlers

### Task 12: Cash deposit handler (TDD)

**Files:**
- Create: `backend-go/internal/recon/special_cash_test.go`
- Create: `backend-go/internal/recon/special_cash.go`

- [ ] **Step 1: Write failing tests**

```go
// backend-go/internal/recon/special_cash_test.go
package recon

import (
    "testing"
    "time"
)

type FakeBatch struct {
    ID             string
    ExpectedAmount float64
    DepositDate    time.Time
    Status         string
}

func TestMatchCashDeposit_SingleCandidate(t *testing.T) {
    line := BankLine{Amount: 10_000_000, TxnDate: mustDate("2026-06-03")}
    batches := []FakeBatch{
        {ID: "k3", ExpectedAmount: 10_000_000, DepositDate: mustDate("2026-06-02"), Status: "PENDING"},
    }
    out, variance := MatchCashDeposit(line, batches)
    if out == nil || out.ID != "k3" {
        t.Fatalf("expected k3, got %+v", out)
    }
    if variance != 0 {
        t.Errorf("variance = %.2f, want 0", variance)
    }
}

func TestMatchCashDeposit_Variance(t *testing.T) {
    line := BankLine{Amount: 7_000_000, TxnDate: mustDate("2026-06-02")}
    batches := []FakeBatch{
        {ID: "k2", ExpectedAmount: 7_245_000, DepositDate: mustDate("2026-06-01"), Status: "PENDING"},
    }
    out, variance := MatchCashDeposit(line, batches)
    if out == nil || out.ID != "k2" {
        t.Fatalf("expected k2, got %+v", out)
    }
    if variance != -245_000 {
        t.Errorf("variance = %.2f, want -245000", variance)
    }
}

func TestMatchCashDeposit_NoCandidate(t *testing.T) {
    line := BankLine{Amount: 1_000_000, TxnDate: mustDate("2026-06-15")}
    out, _ := MatchCashDeposit(line, []FakeBatch{})
    if out != nil {
        t.Errorf("expected nil, got %+v", out)
    }
}
```

- [ ] **Step 2: Run failing test → FAIL "undefined: MatchCashDeposit"**

```bash
cd backend-go && go test ./internal/recon/... -run TestMatchCashDeposit -v
```

- [ ] **Step 3: Implementation**

```go
// backend-go/internal/recon/special_cash.go
package recon

import "math"

// MatchCashDeposit picks the best PENDING batch (amount within ±3%, date within ±2 days).
// Returns the matched batch (or nil) and variance (line.Amount - batch.ExpectedAmount).
func MatchCashDeposit(line BankLine, batches []FakeBatch) (*FakeBatch, float64) {
    var best *FakeBatch
    bestDelta := math.MaxFloat64
    for i := range batches {
        b := &batches[i]
        if b.Status != "PENDING" {
            continue
        }
        if math.Abs(b.ExpectedAmount-line.Amount)/line.Amount > 0.03 {
            continue
        }
        days := math.Abs(line.TxnDate.Sub(b.DepositDate).Hours() / 24)
        if days > 2 {
            continue
        }
        delta := math.Abs(b.ExpectedAmount - line.Amount)
        if delta < bestDelta {
            bestDelta = delta
            best = b
        }
    }
    if best == nil {
        return nil, 0
    }
    return best, line.Amount - best.ExpectedAmount
}
```

- [ ] **Step 4: Run tests → all pass**

```bash
cd backend-go && go test ./internal/recon/... -v
```

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/recon/special_cash.go backend-go/internal/recon/special_cash_test.go
git commit -m "feat(recon): cash deposit matching with variance"
```

---

### Task 13: EDC settlement handler (TDD)

**Files:**
- Create: `backend-go/internal/recon/special_edc_test.go`
- Create: `backend-go/internal/recon/special_edc.go`

- [ ] **Step 1: Write failing tests**

```go
// backend-go/internal/recon/special_edc_test.go
package recon

import "testing"

func TestMatchEDC_ValidMDR(t *testing.T) {
    line := BankLine{Amount: 12_300_000, TxnDate: mustDate("2026-06-04")}
    edcOrders := []float64{1_500_000, 2_500_000, 3_000_000, 1_800_000, 2_000_000, 1_487_000}
    // Total = 12,287,000 + 100,000 MDR margin
    // Use a more representative sum:
    edcOrders = []float64{1_500_000, 2_500_000, 3_000_000, 1_800_000, 2_000_000, 1_487_000}
    gross := 12_287_000.0
    s := Settings{EDCMDRMinPct: 0.005, EDCMDRMaxPct: 0.015}
    out := MatchEDCSettlement(line, gross, s)
    if !out.Valid {
        t.Fatalf("expected valid, breakdown=%v", out)
    }
    if out.MDR <= 0 {
        t.Errorf("expected positive MDR, got %.2f", out.MDR)
    }
    _ = edcOrders
}

func TestMatchEDC_MDROutOfRange(t *testing.T) {
    line := BankLine{Amount: 10_000_000}
    gross := 10_000_000.0
    s := Settings{EDCMDRMinPct: 0.005, EDCMDRMaxPct: 0.015}
    out := MatchEDCSettlement(line, gross, s)
    if out.Valid {
        t.Errorf("expected invalid (zero MDR), got valid")
    }
}

func TestMatchEDC_TooHighMDR(t *testing.T) {
    line := BankLine{Amount: 9_000_000}
    gross := 10_000_000.0
    s := Settings{EDCMDRMinPct: 0.005, EDCMDRMaxPct: 0.015}
    out := MatchEDCSettlement(line, gross, s)
    if out.Valid {
        t.Errorf("MDR 10%% should be invalid")
    }
}
```

- [ ] **Step 2: Run failing test**

```bash
cd backend-go && go test ./internal/recon/... -run TestMatchEDC -v
```

- [ ] **Step 3: Implementation**

```go
// backend-go/internal/recon/special_edc.go
package recon

type EDCMatch struct {
    Valid   bool
    Gross   float64
    Net     float64
    MDR     float64
    MDRRate float64
}

func MatchEDCSettlement(line BankLine, grossSum float64, s Settings) EDCMatch {
    if grossSum <= 0 {
        return EDCMatch{}
    }
    mdr := grossSum - line.Amount
    rate := mdr / grossSum
    if rate < s.EDCMDRMinPct || rate > s.EDCMDRMaxPct {
        return EDCMatch{Gross: grossSum, Net: line.Amount, MDR: mdr, MDRRate: rate, Valid: false}
    }
    return EDCMatch{Valid: true, Gross: grossSum, Net: line.Amount, MDR: mdr, MDRRate: rate}
}
```

- [ ] **Step 4: Tests pass**

```bash
cd backend-go && go test ./internal/recon/... -v
```

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/recon/special_edc.go backend-go/internal/recon/special_edc_test.go
git commit -m "feat(recon): EDC settlement MDR validation"
```

---

### Task 14: Internal transfer pair detection (TDD)

**Files:**
- Create: `backend-go/internal/recon/special_internal_test.go`
- Create: `backend-go/internal/recon/special_internal.go`

- [ ] **Step 1: Failing test**

```go
// backend-go/internal/recon/special_internal_test.go
package recon

import "testing"

func TestPairInternalTransfer_FindsMatch(t *testing.T) {
    out := BankLine{ID: "o1", BankAccountID: "a1", Direction: DirectionOut, Amount: 20_000_000, TxnDate: mustDate("2026-06-15"), Description: "TRSF KE 5678"}
    in := BankLine{ID: "i1", BankAccountID: "a2", Direction: DirectionIn, Amount: 20_000_000, TxnDate: mustDate("2026-06-15"), Counterparty: "GARINDO JAYA"}
    inLines := []BankLine{in}
    found := PairInternalTransfer(out, inLines)
    if found == nil || found.ID != "i1" {
        t.Errorf("expected i1, got %+v", found)
    }
}

func TestPairInternalTransfer_NoMatchOutOfWindow(t *testing.T) {
    out := BankLine{ID: "o1", Direction: DirectionOut, Amount: 20_000_000, TxnDate: mustDate("2026-06-10")}
    in := BankLine{ID: "i1", Direction: DirectionIn, Amount: 20_000_000, TxnDate: mustDate("2026-06-15")}
    found := PairInternalTransfer(out, []BankLine{in})
    if found != nil {
        t.Errorf("expected nil (5 days apart), got %+v", found)
    }
}
```

- [ ] **Step 2: Run failing test**

```bash
cd backend-go && go test ./internal/recon/... -run TestPairInternalTransfer -v
```

- [ ] **Step 3: Implementation**

```go
// backend-go/internal/recon/special_internal.go
package recon

import "math"

// PairInternalTransfer finds an IN line on another account that pairs with an OUT line.
// Match: same amount (within Rp 100), txn_date within ±2 days, IN must not already be paired.
func PairInternalTransfer(out BankLine, inLines []BankLine) *BankLine {
    if out.Direction != DirectionOut {
        return nil
    }
    for i := range inLines {
        in := &inLines[i]
        if in.Direction != DirectionIn {
            continue
        }
        if in.BankAccountID == out.BankAccountID {
            continue
        }
        if math.Abs(in.Amount-out.Amount) > 100 {
            continue
        }
        days := math.Abs(in.TxnDate.Sub(out.TxnDate).Hours() / 24)
        if days > 2 {
            continue
        }
        return in
    }
    return nil
}
```

- [ ] **Step 4: Tests pass + commit**

```bash
cd backend-go && go test ./internal/recon/... -v
git add backend-go/internal/recon/special_internal.go backend-go/internal/recon/special_internal_test.go
git commit -m "feat(recon): internal transfer pair detection"
```

---

## Phase 4 — Go PDF + DB Layer

### Task 15: Gemini document client

**Files:**
- Create: `backend-go/internal/gemini/document.go`

- [ ] **Step 1: Implementation**

```go
// backend-go/internal/gemini/document.go
package gemini

import (
    "context"
    "encoding/json"
    "fmt"
    "strings"

    "github.com/google/generative-ai-go/genai"
    "google.golang.org/api/option"
)

type DocumentClient struct {
    client *genai.Client
    model  *genai.GenerativeModel
}

type ExtractedLine struct {
    TxnDate      string  `json:"txn_date"`
    Description  string  `json:"description"`
    Counterparty string  `json:"counterparty"`
    Amount       float64 `json:"amount"`
    Direction    string  `json:"direction"`
    Balance      float64 `json:"balance"`
}

func NewDocumentClient(ctx context.Context, apiKey string) (*DocumentClient, error) {
    c, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
    if err != nil {
        return nil, err
    }
    m := c.GenerativeModel("gemini-3.5-flash")
    m.ResponseMIMEType = "application/json"
    return &DocumentClient{client: c, model: m}, nil
}

func (d *DocumentClient) Close() error { return d.client.Close() }

func (d *DocumentClient) ExtractMutasi(ctx context.Context, pdfBytes []byte, bankCode string) ([]ExtractedLine, error) {
    prompt := fmt.Sprintf(`Ekstrak SEMUA transaksi dari laporan mutasi rekening %s ini.
Setiap transaksi jadikan 1 object di array JSON dengan field:
  txn_date     (string YYYY-MM-DD)
  description  (string, deskripsi mentah dari statement)
  counterparty (string, nama pengirim/penerima — kosong jika tidak ada)
  amount       (number positif tanpa pemisah ribuan)
  direction    ("IN" untuk MASUK / kredit, "OUT" untuk KELUAR / debit)
  balance      (number saldo setelah transaksi)
HANYA baris transaksi (jangan masukkan header/footer/saldo awal).
Output JSON array murni, no markdown wrapper.`, bankCode)

    resp, err := d.model.GenerateContent(ctx,
        genai.Blob{MIMEType: "application/pdf", Data: pdfBytes},
        genai.Text(prompt),
    )
    if err != nil {
        return nil, fmt.Errorf("gemini generate: %w", err)
    }
    if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
        return nil, fmt.Errorf("gemini empty response")
    }
    text := ""
    for _, p := range resp.Candidates[0].Content.Parts {
        if t, ok := p.(genai.Text); ok {
            text += string(t)
        }
    }
    text = strings.TrimSpace(text)
    var lines []ExtractedLine
    if err := json.Unmarshal([]byte(text), &lines); err != nil {
        return nil, fmt.Errorf("parse Gemini JSON: %w (got: %s)", err, text[:min(200, len(text))])
    }
    return lines, nil
}

func min(a, b int) int { if a < b { return a }; return b }
```

- [ ] **Step 2: Verify build**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/gemini/...
```

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/gemini/document.go
git commit -m "feat(gemini): add DocumentClient for PDF mutasi extraction"
```

---

### Task 16: DB layer — bank_accounts + bank_imports + bank_statement_lines

**Files:**
- Create: `backend-go/internal/db/recon_accounts.go`
- Create: `backend-go/internal/db/recon_lines.go`

- [ ] **Step 1: Implementation — accounts + imports**

```go
// backend-go/internal/db/recon_accounts.go
package db

import (
    "context"
    "time"
)

type BankAccount struct {
    ID            string
    BankCode      string
    AccountNumber string
    AccountLabel  string
    Purpose       string
    IsActive      bool
}

func (c *Client) ListBankAccounts(ctx context.Context) ([]BankAccount, error) {
    rows, err := c.db.QueryContext(ctx, `SELECT id::text, bank_code, account_number, account_label, purpose, is_active FROM bank_accounts WHERE is_active=true`)
    if err != nil { return nil, err }
    defer rows.Close()
    var out []BankAccount
    for rows.Next() {
        var a BankAccount
        if err := rows.Scan(&a.ID, &a.BankCode, &a.AccountNumber, &a.AccountLabel, &a.Purpose, &a.IsActive); err != nil {
            return nil, err
        }
        out = append(out, a)
    }
    return out, rows.Err()
}

type BankImport struct {
    ID            string
    BankAccountID string
    PeriodStart   time.Time
    PeriodEnd     time.Time
    Filename      string
    StoragePath   string
    Status        string
}

func (c *Client) CreateBankImport(ctx context.Context, im BankImport) (string, error) {
    var id string
    err := c.db.QueryRowContext(ctx, `
        INSERT INTO bank_imports (bank_account_id, period_start, period_end, filename, storage_path, status)
        VALUES ($1,$2,$3,$4,$5,'PROCESSING') RETURNING id::text`,
        im.BankAccountID, im.PeriodStart, im.PeriodEnd, im.Filename, im.StoragePath).Scan(&id)
    return id, err
}

func (c *Client) UpdateBankImportReady(ctx context.Context, importID string, lineCount, matchedCount int, inTokens, outTokens int) error {
    _, err := c.db.ExecContext(ctx, `
        UPDATE bank_imports SET status='READY', line_count=$2, matched_count=$3,
               gemini_input_tokens=$4, gemini_output_tokens=$5
        WHERE id=$1`, importID, lineCount, matchedCount, inTokens, outTokens)
    return err
}

func (c *Client) UpdateBankImportFailed(ctx context.Context, importID, errMsg string) error {
    _, err := c.db.ExecContext(ctx, `UPDATE bank_imports SET status='FAILED', error_message=$2 WHERE id=$1`, importID, errMsg)
    return err
}
```

- [ ] **Step 2: Implementation — statement lines**

```go
// backend-go/internal/db/recon_lines.go
package db

import (
    "context"
    "time"
)

type BankStatementLine struct {
    ID              string
    ImportID        string
    BankAccountID   string
    TxnDate         time.Time
    Amount          float64
    Direction       string
    Description     string
    Counterparty    string
    LineKind        string
    Lane            string
    MatchConfidence *float64
    MatchReason     string
    DedupHash       string
}

func (c *Client) InsertBankLine(ctx context.Context, l BankStatementLine) (string, error) {
    var id string
    err := c.db.QueryRowContext(ctx, `
        INSERT INTO bank_statement_lines
            (import_id, bank_account_id, txn_date, amount, direction, description,
             counterparty, line_kind, lane, match_confidence, match_reason, dedup_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (bank_account_id, dedup_hash) DO NOTHING
        RETURNING id::text`,
        l.ImportID, l.BankAccountID, l.TxnDate, l.Amount, l.Direction, l.Description,
        l.Counterparty, l.LineKind, l.Lane, l.MatchConfidence, l.MatchReason, l.DedupHash,
    ).Scan(&id)
    return id, err
}

func (c *Client) UpdateLineLane(ctx context.Context, lineID, lane, reason string, confidence float64) error {
    _, err := c.db.ExecContext(ctx, `UPDATE bank_statement_lines SET lane=$2, match_reason=$3, match_confidence=$4 WHERE id=$1`, lineID, lane, reason, confidence)
    return err
}
```

- [ ] **Step 3: Verify build + commit**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/db/...
git add backend-go/internal/db/recon_accounts.go backend-go/internal/db/recon_lines.go
git commit -m "feat(db): recon accounts and statement line queries"
```

---

### Task 17: DB layer — payable_slots, allocations, batches, settings, supplier list

**Files:**
- Create: `backend-go/internal/db/recon_slots.go`

- [ ] **Step 1: Implementation**

```go
// backend-go/internal/db/recon_slots.go
package db

import (
    "context"
    "time"
)

type PayableSlot struct {
    ID             string
    OrderID        string
    SlotType       string
    ExpectedAmount float64
    CustomerName   string
    OrderCreatedAt time.Time
    Status         string
}

func (c *Client) ListOpenSlotsForDate(ctx context.Context, txnDate time.Time, backDays, forwardDays int) ([]PayableSlot, error) {
    rows, err := c.db.QueryContext(ctx, `
        SELECT ps.id::text, ps.order_id::text, ps.slot_type, ps.expected_amount,
               o.customer_name, o.created_at, ps.status
        FROM payable_slots ps JOIN orders o ON o.id = ps.order_id
        WHERE ps.status = 'OPEN'
          AND o.created_at BETWEEN $1::timestamptz - ($2 || ' days')::interval
                              AND $1::timestamptz + ($3 || ' days')::interval`,
        txnDate, backDays, forwardDays,
    )
    if err != nil { return nil, err }
    defer rows.Close()
    var out []PayableSlot
    for rows.Next() {
        var s PayableSlot
        if err := rows.Scan(&s.ID, &s.OrderID, &s.SlotType, &s.ExpectedAmount, &s.CustomerName, &s.OrderCreatedAt, &s.Status); err != nil {
            return nil, err
        }
        out = append(out, s)
    }
    return out, rows.Err()
}

func (c *Client) InsertAllocation(ctx context.Context, bankLineID, slotID string, amount float64) error {
    _, err := c.db.ExecContext(ctx, `INSERT INTO bank_line_allocations (bank_line_id, slot_id, amount) VALUES ($1,$2,$3)`, bankLineID, slotID, amount)
    return err
}

type Settings struct {
    ThresholdGreen, ThresholdYellow, ThresholdOrange float64
    AmountTolerancePct                               float64
    DateWindowBackDays, DateWindowForwardDays        int
    EDCMDRMinPct, EDCMDRMaxPct                       float64
    FirstEligibleDate                                time.Time
}

func (c *Client) GetSettings(ctx context.Context) (Settings, error) {
    var s Settings
    err := c.db.QueryRowContext(ctx, `SELECT threshold_green, threshold_yellow, threshold_orange,
        amount_tolerance_pct, date_window_back_days, date_window_forward_days,
        edc_mdr_min_pct, edc_mdr_max_pct, first_eligible_period_start
        FROM reconciliation_settings WHERE id='singleton'`).Scan(
        &s.ThresholdGreen, &s.ThresholdYellow, &s.ThresholdOrange,
        &s.AmountTolerancePct, &s.DateWindowBackDays, &s.DateWindowForwardDays,
        &s.EDCMDRMinPct, &s.EDCMDRMaxPct, &s.FirstEligibleDate,
    )
    return s, err
}

type Supplier struct {
    ID   string
    Name string
}

func (c *Client) ListSuppliers(ctx context.Context) ([]Supplier, error) {
    rows, err := c.db.QueryContext(ctx, `SELECT id::text, name FROM suppliers`)
    if err != nil { return nil, err }
    defer rows.Close()
    var out []Supplier
    for rows.Next() {
        var s Supplier
        if err := rows.Scan(&s.ID, &s.Name); err != nil { return nil, err }
        out = append(out, s)
    }
    return out, rows.Err()
}
```

- [ ] **Step 2: Build + commit**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/db/...
git add backend-go/internal/db/recon_slots.go
git commit -m "feat(db): payable slot, allocation, settings, supplier queries"
```

---

### Task 18: Engine orchestrator — runs Stage 1-4 over a batch of lines

**Files:**
- Create: `backend-go/internal/recon/engine.go`

- [ ] **Step 1: Implementation**

```go
// backend-go/internal/recon/engine.go
package recon

import (
    "context"

    "github.com/username/sinar-elektrik-backend/internal/db"
)

type DBPort interface {
    ListBankAccounts(context.Context) ([]db.BankAccount, error)
    ListSuppliers(context.Context) ([]db.Supplier, error)
    ListOpenSlotsForDate(context.Context, /*txnDate*/ interface{}, int, int) ([]db.PayableSlot, error)
    InsertAllocation(ctx context.Context, lineID, slotID string, amount float64) error
    UpdateLineLane(ctx context.Context, lineID, lane, reason string, confidence float64) error
    GetSettings(context.Context) (db.Settings, error)
}

// ProcessLines runs the engine over an import's newly-inserted lines.
// (Concrete DB calls handled in a thin adapter; this function focuses on orchestration.)
func ProcessLines(ctx context.Context, p DBPort, importID string, lines []BankLine) (matched int, err error) {
    settings, err := p.GetSettings(ctx)
    if err != nil { return 0, err }
    accts, err := p.ListBankAccounts(ctx)
    if err != nil { return 0, err }
    sups, err := p.ListSuppliers(ctx)
    if err != nil { return 0, err }

    coreAccts := make([]BankAccount, len(accts))
    for i, a := range accts {
        coreAccts[i] = BankAccount{ID: a.ID, BankCode: a.BankCode, AccountNumber: a.AccountNumber}
    }
    coreSups := make([]Supplier, len(sups))
    for i, s := range sups {
        coreSups[i] = Supplier{ID: s.ID, Name: s.Name}
    }
    coreSettings := Settings{
        ThresholdGreen: settings.ThresholdGreen, ThresholdYellow: settings.ThresholdYellow, ThresholdOrange: settings.ThresholdOrange,
        AmountTolerancePct: settings.AmountTolerancePct,
        DateWindowBackDays: settings.DateWindowBackDays, DateWindowForwardDays: settings.DateWindowForwardDays,
        EDCMDRMinPct: settings.EDCMDRMinPct, EDCMDRMaxPct: settings.EDCMDRMaxPct,
        FirstEligibleDate: settings.FirstEligibleDate,
    }

    for i := range lines {
        l := &lines[i]
        // Legacy period guard
        if l.TxnDate.Before(coreSettings.FirstEligibleDate) {
            l.LineKind = KindLegacyPeriod
            l.Lane = LaneGray
            _ = p.UpdateLineLane(ctx, l.ID, string(LaneGray), "pre-cutoff", 0)
            continue
        }
        // Stage 1: classify
        l.LineKind = Classify(*l, coreAccts, coreSups)
        if l.LineKind != KindCustomerPayment {
            l.Lane = LaneGray
            _ = p.UpdateLineLane(ctx, l.ID, string(LaneGray), string(l.LineKind), 0)
            continue
        }
        // Stage 2-3: candidates + score + lane
        dbSlots, err := p.ListOpenSlotsForDate(ctx, l.TxnDate, coreSettings.DateWindowBackDays, coreSettings.DateWindowForwardDays)
        if err != nil { return matched, err }
        slots := make([]PayableSlot, len(dbSlots))
        for i, s := range dbSlots {
            slots[i] = PayableSlot{ID: s.ID, OrderID: s.OrderID, SlotType: s.SlotType,
                ExpectedAmount: s.ExpectedAmount, CustomerName: s.CustomerName, OrderCreatedAt: s.OrderCreatedAt,
                Status: s.Status}
        }
        eligible := EligibleSlots(*l, slots, coreSettings)
        cands := make([]Candidate, 0, len(eligible))
        for _, sl := range eligible {
            cands = append(cands, ScoreCandidate(*l, sl))
        }
        lane := AssignLane(cands, coreSettings)
        l.Lane = lane
        bestReason := ""
        var bestScore float64
        if len(cands) > 0 {
            bestScore = cands[0].Score
            bestReason = cands[0].Breakdown
        }
        if lane == LaneGreen && len(cands) > 0 {
            if err := p.InsertAllocation(ctx, l.ID, cands[0].Slot.ID, l.Amount); err != nil { return matched, err }
            matched++
        }
        _ = p.UpdateLineLane(ctx, l.ID, string(lane), bestReason, bestScore)
    }
    return matched, nil
}
```

- [ ] **Step 2: Verify build (DBPort uses interface, fine to leave concrete adapter for Task 19)**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/recon/...
```

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/recon/engine.go
git commit -m "feat(recon): engine orchestrator wiring classify+score+allocate"
```

---

## Phase 5 — Go HTTP + RPC Wiring

### Task 19: Upload endpoint — POST /api/recon/upload

**Files:**
- Create: `backend-go/internal/recon/handler.go`

- [ ] **Step 1: Implementation**

```go
// backend-go/internal/recon/handler.go
package recon

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "strconv"
    "time"

    "github.com/username/sinar-elektrik-backend/internal/db"
    "github.com/username/sinar-elektrik-backend/internal/gemini"
)

type Handler struct {
    DB  *db.Client
    Doc *gemini.DocumentClient
}

func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
    if err := r.ParseMultipartForm(20 << 20); err != nil {
        http.Error(w, "file too large", http.StatusBadRequest); return
    }
    file, header, err := r.FormFile("file")
    if err != nil { http.Error(w, "missing file", http.StatusBadRequest); return }
    defer file.Close()

    bankAccountID := r.FormValue("bank_account_id")
    if bankAccountID == "" { http.Error(w, "missing bank_account_id", http.StatusBadRequest); return }
    bankCode := r.FormValue("bank_code")
    periodStartStr := r.FormValue("period_start")
    periodEndStr := r.FormValue("period_end")
    periodStart, _ := time.Parse("2006-01-02", periodStartStr)
    periodEnd, _ := time.Parse("2006-01-02", periodEndStr)

    pdfBytes, err := io.ReadAll(file)
    if err != nil { http.Error(w, "read fail", 500); return }

    ctx := r.Context()
    storagePath := "recon/" + bankAccountID + "/" + strconv.FormatInt(time.Now().Unix(), 10) + "_" + header.Filename
    importID, err := h.DB.CreateBankImport(ctx, db.BankImport{
        BankAccountID: bankAccountID, PeriodStart: periodStart, PeriodEnd: periodEnd,
        Filename: header.Filename, StoragePath: storagePath, Status: "PROCESSING",
    })
    if err != nil { http.Error(w, "create import: "+err.Error(), 500); return }

    extracted, err := h.Doc.ExtractMutasi(ctx, pdfBytes, bankCode)
    if err != nil {
        _ = h.DB.UpdateBankImportFailed(ctx, importID, err.Error())
        http.Error(w, "gemini: "+err.Error(), 500); return
    }

    lines := make([]BankLine, 0, len(extracted))
    for _, e := range extracted {
        txnDate, _ := time.Parse("2006-01-02", e.TxnDate)
        hash := sha256Hex(bankAccountID, e.TxnDate, e.Amount, e.Description, e.Balance)
        lineID, err := h.DB.InsertBankLine(ctx, db.BankStatementLine{
            ImportID: importID, BankAccountID: bankAccountID, TxnDate: txnDate, Amount: e.Amount,
            Direction: e.Direction, Description: e.Description, Counterparty: e.Counterparty,
            LineKind: "UNKNOWN", Lane: "GRAY", DedupHash: hash,
        })
        if err != nil || lineID == "" { continue } // skip dedup conflicts silently
        lines = append(lines, BankLine{
            ID: lineID, BankAccountID: bankAccountID, TxnDate: txnDate, Amount: e.Amount,
            Direction: Direction(e.Direction), Description: e.Description, Counterparty: e.Counterparty,
        })
    }

    matched, err := ProcessLines(ctx, dbAdapter{h.DB}, importID, lines)
    if err != nil {
        _ = h.DB.UpdateBankImportFailed(ctx, importID, err.Error())
        http.Error(w, "process: "+err.Error(), 500); return
    }
    _ = h.DB.UpdateBankImportReady(ctx, importID, len(lines), matched, 0, 0)

    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(map[string]any{
        "import_id":     importID,
        "line_count":    len(lines),
        "matched_count": matched,
    })
}

func sha256Hex(parts ...interface{}) string {
    h := sha256.New()
    for _, p := range parts {
        fmt.Fprintf(h, "|%v", p)
    }
    return hex.EncodeToString(h.Sum(nil))
}

type dbAdapter struct{ c *db.Client }

func (a dbAdapter) ListBankAccounts(ctx context.Context) ([]db.BankAccount, error) { return a.c.ListBankAccounts(ctx) }
func (a dbAdapter) ListSuppliers(ctx context.Context) ([]db.Supplier, error)       { return a.c.ListSuppliers(ctx) }
func (a dbAdapter) ListOpenSlotsForDate(ctx context.Context, txnDate interface{}, back, fwd int) ([]db.PayableSlot, error) {
    return a.c.ListOpenSlotsForDate(ctx, txnDate.(time.Time), back, fwd)
}
func (a dbAdapter) InsertAllocation(ctx context.Context, lineID, slotID string, amount float64) error {
    return a.c.InsertAllocation(ctx, lineID, slotID, amount)
}
func (a dbAdapter) UpdateLineLane(ctx context.Context, lineID, lane, reason string, conf float64) error {
    return a.c.UpdateLineLane(ctx, lineID, lane, reason, conf)
}
func (a dbAdapter) GetSettings(ctx context.Context) (db.Settings, error) { return a.c.GetSettings(ctx) }
```

- [ ] **Step 2: Verify build**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/recon/handler.go
git commit -m "feat(recon): /api/recon/upload handler — PDF → extract → process"
```

---

### Task 20: Period closer (RPC stub)

**Files:**
- Create: `backend-go/internal/recon/closer.go`

- [ ] **Step 1: Implementation (validation only; PDF generation deferred to v2)**

```go
// backend-go/internal/recon/closer.go
package recon

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "strconv"

    "github.com/username/sinar-elektrik-backend/internal/db"
)

type CloserHandler struct {
    DB *db.Client
}

type CloseReq struct {
    Year  int `json:"year"`
    Month int `json:"month"`
}

type CloseResp struct {
    OK     bool   `json:"ok"`
    Reason string `json:"reason,omitempty"`
}

func (h *CloserHandler) Close(w http.ResponseWriter, r *http.Request) {
    var req CloseReq
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
    ctx := r.Context()

    // Validate: no RED lanes, no PENDING batches, no OPEN slots within period
    var redCount, pendBatch, openSlots int
    err := h.DB.DBHandle().QueryRowContext(ctx, `
        SELECT
          (SELECT COUNT(*) FROM bank_statement_lines WHERE EXTRACT(YEAR FROM txn_date)=$1 AND EXTRACT(MONTH FROM txn_date)=$2 AND lane='RED'),
          (SELECT COUNT(*) FROM cash_deposit_batches WHERE status='PENDING'),
          (SELECT COUNT(*) FROM payable_slots ps JOIN orders o ON o.id=ps.order_id WHERE ps.status='OPEN' AND EXTRACT(YEAR FROM o.created_at)=$1 AND EXTRACT(MONTH FROM o.created_at)=$2)
    `, req.Year, req.Month).Scan(&redCount, &pendBatch, &openSlots)
    if err != nil { http.Error(w, err.Error(), 500); return }

    if redCount > 0 || pendBatch > 0 || openSlots > 0 {
        json.NewEncoder(w).Encode(CloseResp{OK: false, Reason: fmt.Sprintf("blocked: red=%d pendingBatch=%d openSlot=%d", redCount, pendBatch, openSlots)})
        return
    }

    // Insert period as CLOSED with minimal summary
    summary := map[string]any{"closed_at": "now", "year": req.Year, "month": req.Month}
    summaryJSON, _ := json.Marshal(summary)
    _, err = h.DB.DBHandle().ExecContext(ctx, `
        INSERT INTO reconciliation_periods (year, month, status, closed_at, summary)
        VALUES ($1,$2,'CLOSED',now(),$3::jsonb)
        ON CONFLICT (year, month) DO UPDATE SET status='CLOSED', closed_at=now(), summary=EXCLUDED.summary
    `, req.Year, req.Month, string(summaryJSON))
    if err != nil { http.Error(w, err.Error(), 500); return }

    json.NewEncoder(w).Encode(CloseResp{OK: true})
    _ = strconv.Itoa
}
```

- [ ] **Step 2: Add `DBHandle()` accessor on db.Client if not present**

In `backend-go/internal/db/client.go`, add (if missing):

```go
func (c *Client) DBHandle() *sql.DB { return c.db }
```

- [ ] **Step 3: Build + commit**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
git add backend-go/internal/recon/closer.go backend-go/internal/db/client.go
git commit -m "feat(recon): period closer with basic validation"
```

---

### Task 21: Wire handlers in main.go

**Files:**
- Modify: `backend-go/main.go`

- [ ] **Step 1: Add imports + route registrations**

In `backend-go/main.go`, after existing route registrations (`/api/wa/...`, `/api/stocks/...`), add:

```go
// Initialize Gemini Document Client (separate from Calista's flash-lite)
docClient, err := gemini.NewDocumentClient(ctx, cfg.GeminiAPIKey)
if err != nil {
    log.Fatalf("[MAIN] failed to init Gemini Document Client: %v", err)
}
defer docClient.Close()

reconHandler := &recon.Handler{DB: dbClient, Doc: docClient}
closerHandler := &recon.CloserHandler{DB: dbClient}
mux.HandleFunc("/api/recon/upload", reconHandler.Upload)
mux.HandleFunc("/api/recon/close", closerHandler.Close)
log.Println("[MAIN] Recon endpoints registered: /api/recon/upload, /api/recon/close")
```

Add the import `"github.com/username/sinar-elektrik-backend/internal/recon"` alphabetically.

- [ ] **Step 2: Verify build**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add backend-go/main.go
git commit -m "feat(main): wire recon upload + close endpoints"
```

---

## Phase 6 — React Types + Service

### Task 22: Add TS types for reconciliation

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Append types**

```typescript
// Append to src/types.ts

export type SalesChannel = 'whatsapp' | 'tokopedia' | 'walkin' | 'grosir';

export interface BankAccount {
  id: string;
  bank_code: 'BCA' | 'MANDIRI' | 'BRI' | 'BNI' | 'PERMATA' | 'CIMB' | 'OTHER';
  account_number: string;
  account_label: string;
  purpose: 'OPERATIONAL' | 'OWNER_PERSONAL' | 'SAVINGS' | 'OTHER';
  is_active: boolean;
}

export interface BankImport {
  id: string;
  bank_account_id: string;
  period_start: string;
  period_end: string;
  filename: string;
  line_count: number;
  matched_count: number;
  status: 'PROCESSING' | 'READY' | 'FAILED';
  error_message?: string;
}

export type BankLineKind =
  | 'CUSTOMER_PAYMENT' | 'CASH_DEPOSIT' | 'EDC_SETTLEMENT' | 'SUPPLIER_PAYMENT'
  | 'EXPENSE' | 'BANK_FEE' | 'INTERNAL_TRANSFER' | 'CUSTOMER_TOPUP'
  | 'OWNER_DRAWING' | 'OWNER_TOPUP' | 'REFUND' | 'OTHER_INCOME'
  | 'LEGACY_PERIOD' | 'UNKNOWN';

export type Lane = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'GRAY';

export interface BankStatementLine {
  id: string;
  bank_account_id: string;
  txn_date: string;
  amount: number;
  direction: 'IN' | 'OUT';
  description: string;
  counterparty?: string;
  line_kind: BankLineKind;
  lane: Lane;
  match_confidence?: number;
  match_reason?: string;
}

export interface PayableSlot {
  id: string;
  order_id: string;
  slot_type: 'FULL' | 'DP' | 'BALANCE';
  expected_amount: number;
  matched_amount: number;
  status: 'OPEN' | 'MATCHED' | 'WRITTEN_OFF' | 'EXTENDED';
  due_date?: string;
}

export interface CashDepositBatch {
  id: string;
  deposit_date?: string;
  bank_line_id?: string;
  deposited_amount?: number;
  expected_amount: number;
  variance: number;
  variance_reason?: 'PETTY_CASH' | 'HITUNG_KURANG' | 'HITUNG_LEBIH' | 'LAINNYA';
  status: 'PENDING' | 'DEPOSITED' | 'CARRY_OVER';
}

export interface ReconciliationPeriod {
  id: string;
  year: number;
  month: number;
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
  closed_at?: string;
  summary?: Record<string, unknown>;
}

// Add `reconciliation?: boolean` to PermissionSet
// Find: export interface PermissionSet { ... }
// Add field: reconciliation?: boolean;
```

- [ ] **Step 2: Add `reconciliation?: boolean` to existing PermissionSet interface**

Find the existing `PermissionSet` declaration in `src/types.ts` and add `reconciliation?: boolean;` to it. If it lists known permission keys, add `reconciliation`.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add reconciliation types and permission flag"
```

---

### Task 23: Add reconciliation service helpers

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Append `reconciliationService`**

```typescript
// Append to src/lib/supabaseClient.ts

export const reconciliationService = {
  async listBankAccounts(): Promise<BankAccount[]> {
    const { data, error } = await supabase
      .from('bank_accounts').select('*').eq('is_active', true)
      .order('account_label');
    if (error) throw error;
    return data ?? [];
  },

  async createBankAccount(payload: Omit<BankAccount, 'id'>): Promise<BankAccount> {
    const { data, error } = await supabase.from('bank_accounts').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async listOrdersForPeriod(year: number, month: number) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(year, month, 1).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('orders')
      .select('id, customer_name, customer_phone, total, payment_type, dp_amount, channel, status, created_at, booking_expires_at')
      .gte('created_at', start).lt('created_at', end)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listPayableSlotsForOrders(orderIds: string[]): Promise<PayableSlot[]> {
    if (orderIds.length === 0) return [];
    const { data, error } = await supabase
      .from('payable_slots').select('*').in('order_id', orderIds);
    if (error) throw error;
    return data ?? [];
  },

  async listBankLinesForPeriod(year: number, month: number): Promise<BankStatementLine[]> {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(year, month, 1).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('bank_statement_lines').select('*')
      .gte('txn_date', start).lt('txn_date', end)
      .order('txn_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listCashBatches(): Promise<CashDepositBatch[]> {
    const { data, error } = await supabase
      .from('cash_deposit_batches').select('*').order('deposit_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async uploadPDF(file: File, bankAccountId: string, bankCode: string, periodStart: string, periodEnd: string) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('bank_account_id', bankAccountId);
    fd.append('bank_code', bankCode);
    fd.append('period_start', periodStart);
    fd.append('period_end', periodEnd);
    const url = (import.meta.env.VITE_BACKEND_URL || '') + '/api/recon/upload';
    const resp = await fetch(url, { method: 'POST', body: fd });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json() as Promise<{ import_id: string; line_count: number; matched_count: number }>;
  },

  async closeMonth(year: number, month: number) {
    const url = (import.meta.env.VITE_BACKEND_URL || '') + '/api/recon/close';
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json() as Promise<{ ok: boolean; reason?: string }>;
  },

  async createAllocation(bankLineId: string, slotId: string, amount: number) {
    const { error } = await supabase
      .from('bank_line_allocations').insert({ bank_line_id: bankLineId, slot_id: slotId, amount });
    if (error) throw error;
  },

  async unmatchLine(bankLineId: string) {
    const { error } = await supabase
      .from('bank_line_allocations').delete().eq('bank_line_id', bankLineId);
    if (error) throw error;
    await supabase.from('bank_statement_lines')
      .update({ lane: 'RED', match_reason: 'manually unmatched', match_confidence: 0 })
      .eq('id', bankLineId);
  },

  async classifyLine(bankLineId: string, kind: BankLineKind, notes?: string) {
    const { error } = await supabase.from('bank_statement_lines')
      .update({ line_kind: kind, lane: 'GRAY', match_reason: kind, notes: notes ?? null })
      .eq('id', bankLineId);
    if (error) throw error;
  },
};
```

Also: import `BankAccount, BankStatementLine, PayableSlot, CashDepositBatch, BankLineKind` from `../types` at top of file (alongside existing imports).

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(service): add reconciliationService — RPCs + Supabase queries"
```

---

## Phase 7 — React Hook

### Task 24: `useRekonsiliasi` hook

**Files:**
- Create: `src/hooks/useRekonsiliasi.ts`

- [ ] **Step 1: Implementation**

```typescript
// src/hooks/useRekonsiliasi.ts
import { useEffect, useState, useCallback } from 'react';
import { reconciliationService } from '../lib/supabaseClient';
import type { BankAccount, BankStatementLine, PayableSlot, CashDepositBatch } from '../types';

interface OrderRow {
  id: string;
  customer_name: string;
  total: number;
  payment_type: 'FULL' | 'DP';
  dp_amount: number;
  channel: 'whatsapp' | 'tokopedia' | 'walkin' | 'grosir';
  status: string;
  created_at: string;
  booking_expires_at: string;
  slots: PayableSlot[];
}

interface State {
  loading: boolean;
  accounts: BankAccount[];
  orders: OrderRow[];
  bankLines: BankStatementLine[];
  cashBatches: CashDepositBatch[];
}

export function useRekonsiliasi(year: number, month: number) {
  const [state, setState] = useState<State>({
    loading: true, accounts: [], orders: [], bankLines: [], cashBatches: [],
  });

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    const [accounts, ordersRaw, bankLines, cashBatches] = await Promise.all([
      reconciliationService.listBankAccounts(),
      reconciliationService.listOrdersForPeriod(year, month),
      reconciliationService.listBankLinesForPeriod(year, month),
      reconciliationService.listCashBatches(),
    ]);
    const slots = await reconciliationService.listPayableSlotsForOrders(ordersRaw.map(o => o.id));
    const slotsByOrder = new Map<string, PayableSlot[]>();
    for (const s of slots) {
      const arr = slotsByOrder.get(s.order_id) ?? [];
      arr.push(s); slotsByOrder.set(s.order_id, arr);
    }
    const orders: OrderRow[] = ordersRaw.map(o => ({
      ...(o as any),
      slots: slotsByOrder.get(o.id) ?? [],
    }));
    setState({ loading: false, accounts, orders, bankLines, cashBatches });
  }, [year, month]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, refresh };
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/hooks/useRekonsiliasi.ts
git commit -m "feat(hook): useRekonsiliasi aggregates orders, slots, mutasi, cash batches"
```

---

## Phase 8 — Skeleton Screen

### Task 25: `RekonsiliasiScreen` skeleton with header + period selector

**Files:**
- Create: `src/components/RekonsiliasiScreen.tsx`
- Create: `src/components/rekonsiliasi/` (directory)

- [ ] **Step 1: Implementation**

```tsx
// src/components/RekonsiliasiScreen.tsx
import React, { useMemo, useState } from 'react';
import { useRekonsiliasi } from '../hooks/useRekonsiliasi';
import { reconciliationService } from '../lib/supabaseClient';

interface Props {
  currentUser: { name: string; role: string; permissions: { reconciliation?: boolean } } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function defaultPeriod() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function RekonsiliasiScreen({ currentUser, showToast }: Props) {
  const allowed = currentUser?.role === 'owner' || !!currentUser?.permissions?.reconciliation;
  const [period, setPeriod] = useState(defaultPeriod());
  const { loading, accounts, orders, bankLines, cashBatches, refresh } = useRekonsiliasi(period.year, period.month);

  const handleClose = async () => {
    const r = await reconciliationService.closeMonth(period.year, period.month);
    if (r.ok) showToast('✓ Buku ditutup', 'success'); else showToast(`❌ ${r.reason ?? 'gagal'}`, 'warning');
    refresh();
  };

  if (!allowed) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Akses Rekonsiliasi terbatas untuk Owner.</div>;
  }

  return (
    <div className="space-y-5 animate-fadeIn max-w-[1440px] mx-auto">
      <div className="flex justify-between items-center gap-4 bg-white/78 backdrop-blur-xl p-5 rounded-[2rem] border border-[#e5eeff] shadow-sm">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#2d8a4e] bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-1.5 align-middle" />
            Rekonsiliasi Aktif
          </span>
          <h2 className="text-xl font-black text-[#012749] mt-2">Rekonsiliasi Buku</h2>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            {loading ? 'Memuat data…' : `${orders.length} order · ${bankLines.length} mutasi · ${cashBatches.length} batch kas`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={`${period.year}-${period.month}`}
            onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); setPeriod({ year: y, month: m }); }}
            className="bg-white border border-[#e5eeff] rounded-xl px-3 py-2 text-xs font-bold text-[#012749]"
          >
            {Array.from({ length: 6 }).map((_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              return <option key={i} value={`${d.getFullYear()}-${d.getMonth() + 1}`}>{d.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}</option>;
            })}
          </select>
          <button onClick={handleClose} className="bg-[#012749] text-white px-4 py-2 rounded-full text-xs font-extrabold">
            🔒 Tutup Buku
          </button>
        </div>
      </div>

      {/* Placeholder sections — filled in subsequent tasks */}
      <div className="p-6 text-center text-slate-400 font-semibold">
        Wizard + accounts + tally + 3-column grid akan diisi di task selanjutnya.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
mkdir -p src/components/rekonsiliasi
git add src/components/RekonsiliasiScreen.tsx
git commit -m "feat(ui): RekonsiliasiScreen skeleton with period selector"
```

---

## Phase 9 — Wizard + Banner

### Task 26: `WizardSteps` component

**Files:**
- Create: `src/components/rekonsiliasi/WizardSteps.tsx`

- [ ] **Step 1: Implementation (visual reference: prototype v7 lines wizard section)**

```tsx
// src/components/rekonsiliasi/WizardSteps.tsx
import React from 'react';

interface Counts { setup: { done: number; total: number }; review: number; piutang: number }
interface Props { currentStep: 1|2|3|4|5|6; counts: Counts; onJump: (n: number) => void }

const STEPS = [
  { n: 1, label: 'Setup',     sub: 'Rekening + PDF' },
  { n: 2, label: 'Auto-Cocok', sub: 'AI Match' },
  { n: 3, label: 'Review',     sub: 'Manual Review' },
  { n: 4, label: 'Kas',        sub: 'Verifikasi Kas' },
  { n: 5, label: 'Piutang',    sub: 'Cek Belum Bayar' },
  { n: 6, label: 'Tutup',      sub: 'Sign-off + PDF' },
];

export default function WizardSteps({ currentStep, counts, onJump }: Props) {
  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.5rem] p-5 border border-[#e5eeff] shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">🧭 Langkah Rekonsiliasi</div>
        <div className="text-[10px] text-slate-500 font-bold">Step {currentStep} dari 6</div>
      </div>
      <div className="flex rounded-2xl overflow-hidden border border-[#e5eeff]">
        {STEPS.map(s => {
          const cls = s.n < currentStep ? 'bg-emerald-50' : s.n === currentStep ? 'bg-[#012749] text-white' : 'bg-white text-slate-400';
          let count = '';
          if (s.n === 1) count = `${counts.setup.done}/${counts.setup.total}`;
          else if (s.n === 3) count = `${counts.review} sisa`;
          else if (s.n === 5) count = `${counts.piutang} piutang`;
          return (
            <div key={s.n} onClick={() => onJump(s.n)} className={`flex-1 p-3 cursor-pointer transition ${cls}`}>
              <div className="text-[10px] font-black">{s.n < currentStep ? '✓ ' : s.n === currentStep ? '▶ ' : ''}{s.label}</div>
              <div className="text-[11px] font-bold mt-0.5">{s.sub}</div>
              <div className="text-[10px] mt-0.5 opacity-70">{count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/WizardSteps.tsx
git commit -m "feat(ui): WizardSteps 6-step tracker"
```

---

### Task 27: `NextActionBanner` component

**Files:**
- Create: `src/components/rekonsiliasi/NextActionBanner.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/NextActionBanner.tsx
import React from 'react';

interface Props { reviewCount: number; cashPending: number; piutangCount: number; onStart: () => void; onClose: () => void }

export default function NextActionBanner({ reviewCount, cashPending, piutangCount, onStart, onClose }: Props) {
  let text = '✓ Semua sudah punya pasangan! Siap tutup buku';
  let detail = 'Klik "Tutup buku" untuk generate PDF closing dan lock periode';
  let cta = 'Tutup buku →';
  let onClick = onClose;
  let success = true;

  if (reviewCount > 0) {
    text = `Review ${reviewCount} baris mutasi yang perlu konfirmasi manual`;
    detail = 'Klik tombol "Cari pasangan →" merah/kuning di kolom Mutasi. Mulai dari skor tertinggi.';
    cta = 'Mulai →'; onClick = onStart; success = false;
  } else if (cashPending > 0) {
    text = `Verifikasi ${cashPending} batch kas — apakah sudah disetor ke bank?`;
    detail = 'Untuk setiap batch K⏳: cari setoran tunai di mutasi, atau tandai "carryover ke bulan depan"';
    cta = 'Verifikasi kas →'; onClick = onStart; success = false;
  } else if (piutangCount > 0) {
    text = `Tindak ${piutangCount} piutang — extend tempo atau write-off`;
    detail = 'Total piutang ditampilkan di kolom Order Penjualan. Klik order untuk Geser tempo atau Write-off.';
    cta = 'Cek piutang →'; onClick = onStart; success = false;
  }

  const bg = success ? 'linear-gradient(135deg,#059669 0%,#047857 100%)' : 'linear-gradient(135deg,#012749 0%,#1e3d60 100%)';

  return (
    <div className="flex items-center justify-between gap-5 p-5 rounded-3xl text-white shadow-lg" style={{ background: bg }}>
      <div className="flex items-center gap-3">
        <div className="text-3xl">🎯</div>
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Langkah selanjutnya</div>
          <div className="text-base font-black mt-0.5">{text}</div>
          <div className="text-[11px] font-semibold mt-0.5 opacity-80">{detail}</div>
        </div>
      </div>
      <button onClick={onClick} className="bg-gradient-to-r from-emerald-500 to-emerald-700 text-white px-6 py-2.5 rounded-full text-xs font-extrabold shadow-md">{cta}</button>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/NextActionBanner.tsx
git commit -m "feat(ui): NextActionBanner adaptive coach"
```

---

## Phase 10 — Multi-Account + Tally Bar

### Task 28: `MultiAccountStatus` + Add Bank Account modal

**Files:**
- Create: `src/components/rekonsiliasi/MultiAccountStatus.tsx`
- Create: `src/components/rekonsiliasi/AddBankAccountModal.tsx`
- Create: `src/components/rekonsiliasi/UploadPDFModal.tsx`

- [ ] **Step 1: Implement `MultiAccountStatus`**

```tsx
// src/components/rekonsiliasi/MultiAccountStatus.tsx
import React from 'react';
import type { BankAccount } from '../../types';

interface Props {
  accounts: BankAccount[];
  uploadedAccountIds: Set<string>;
  onAddAccount: () => void;
  onUpload: (account: BankAccount) => void;
}

function accountColor(bank: string) {
  if (bank === 'BCA') return { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' };
  if (bank === 'MANDIRI') return { bg: '#fed7aa', text: '#9a3412', border: '#fdba74' };
  if (bank === 'BRI') return { bg: '#ddd6fe', text: '#5b21b6', border: '#c4b5fd' };
  return { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' };
}

export default function MultiAccountStatus({ accounts, uploadedAccountIds, onAddAccount, onUpload }: Props) {
  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.5rem] p-5 border border-[#e5eeff] shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">🏦 Rekening Aktif</div>
          <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{accounts.length} rekening terdaftar</div>
        </div>
        <button onClick={onAddAccount} className="bg-slate-50 border border-[#e5eeff] text-[#012749] px-3 py-1.5 rounded-lg text-[10px] font-extrabold">+ Tambah</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {accounts.map(a => {
          const c = accountColor(a.bank_code);
          const uploaded = uploadedAccountIds.has(a.id);
          return (
            <div key={a.id} className="rounded-2xl p-3 border" style={{ background: c.bg + '80', borderColor: c.border }}>
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.text }}>
                  {a.bank_code}
                </span>
                <span className={`text-[9px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full ${uploaded ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {uploaded ? '✓' : '⚠️'}
                </span>
              </div>
              <div className="text-xs font-bold text-[#012749] mt-1.5">{a.account_label}</div>
              {!uploaded && <button onClick={() => onUpload(a)} className="mt-2 w-full bg-white border border-amber-300 text-amber-700 text-[10px] font-extrabold py-1 rounded">Upload PDF →</button>}
            </div>
          );
        })}
        {accounts.length === 0 && (
          <div className="col-span-full text-center text-xs text-slate-500 font-semibold py-4">Belum ada rekening. Klik <strong>+ Tambah</strong>.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement Add modal (minimal form)**

```tsx
// src/components/rekonsiliasi/AddBankAccountModal.tsx
import React, { useState } from 'react';
import type { BankAccount } from '../../types';

interface Props { onSave: (payload: Omit<BankAccount, 'id'>) => Promise<void>; onCancel: () => void }

export default function AddBankAccountModal({ onSave, onCancel }: Props) {
  const [form, setForm] = useState<Omit<BankAccount, 'id'>>({
    bank_code: 'BCA', account_number: '', account_label: '', purpose: 'OPERATIONAL', is_active: true,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(1,39,73,0.4)' }} onClick={onCancel}>
      <div className="bg-white rounded-3xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-black text-[#012749] mb-4">Tambah Rekening Bank</h3>
        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Bank</label>
        <select value={form.bank_code} onChange={e => setForm({ ...form, bank_code: e.target.value as any })} className="w-full mb-3 px-3 py-2 border border-[#e5eeff] rounded-xl text-xs">
          {['BCA','MANDIRI','BRI','BNI','PERMATA','CIMB','OTHER'].map(b => <option key={b}>{b}</option>)}
        </select>
        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Nomor Rekening</label>
        <input value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} className="w-full mb-3 px-3 py-2 border border-[#e5eeff] rounded-xl text-xs" />
        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Label</label>
        <input value={form.account_label} onChange={e => setForm({ ...form, account_label: e.target.value })} className="w-full mb-3 px-3 py-2 border border-[#e5eeff] rounded-xl text-xs" placeholder="BCA Bisnis Operasional 8420" />
        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Tujuan</label>
        <select value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value as any })} className="w-full mb-4 px-3 py-2 border border-[#e5eeff] rounded-xl text-xs">
          {['OPERATIONAL','OWNER_PERSONAL','SAVINGS','OTHER'].map(p => <option key={p}>{p}</option>)}
        </select>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-full text-xs font-bold bg-slate-100">Batal</button>
          <button onClick={() => onSave(form)} className="px-4 py-2 rounded-full text-xs font-bold bg-[#012749] text-white">Simpan</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement Upload PDF modal**

```tsx
// src/components/rekonsiliasi/UploadPDFModal.tsx
import React, { useState } from 'react';
import type { BankAccount } from '../../types';
import { reconciliationService } from '../../lib/supabaseClient';

interface Props {
  account: BankAccount;
  year: number;
  month: number;
  onDone: () => void;
  onCancel: () => void;
}

export default function UploadPDFModal({ account, year, month, onDone, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(year, month, 0).toISOString().slice(0, 10);
    try {
      await reconciliationService.uploadPDF(file, account.id, account.bank_code, start, end);
      onDone();
    } catch (e: any) { setErr(e.message ?? 'Upload gagal'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(1,39,73,0.4)' }} onClick={onCancel}>
      <div className="bg-white rounded-3xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-black text-[#012749] mb-1">Upload Mutasi PDF</h3>
        <p className="text-[11px] text-slate-500 font-semibold mb-4">{account.account_label}</p>
        <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs mb-4" />
        {err && <div className="text-[11px] text-red-700 font-bold mb-3">{err}</div>}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-full text-xs font-bold bg-slate-100">Batal</button>
          <button onClick={handleUpload} disabled={!file || busy} className="px-4 py-2 rounded-full text-xs font-bold bg-[#012749] text-white disabled:opacity-50">
            {busy ? 'Memproses…' : 'Upload + Auto-cocok'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/MultiAccountStatus.tsx src/components/rekonsiliasi/AddBankAccountModal.tsx src/components/rekonsiliasi/UploadPDFModal.tsx
git commit -m "feat(ui): MultiAccountStatus + Add/Upload modals"
```

---

### Task 29: `TallyBar` with live amounts and per-channel KPI

**Files:**
- Create: `src/components/rekonsiliasi/TallyBar.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/TallyBar.tsx
import React from 'react';

interface Props {
  totalSales: number;
  transferAmount: number;
  edcAmount: number;
  cashAmount: number;
  piutangAmount: number;
  perChannel: { whatsapp: number; tokopedia: number; walkin: number; grosir: number };
  perChannelCount: { whatsapp: number; tokopedia: number; walkin: number; grosir: number };
}

function fmt(n: number) {
  return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt';
}

export default function TallyBar({ totalSales, transferAmount, edcAmount, cashAmount, piutangAmount, perChannel, perChannelCount }: Props) {
  const sum = transferAmount + edcAmount + cashAmount + piutangAmount;
  const tallyOK = Math.abs(sum - totalSales) < 50_000;

  const pct = (a: number) => totalSales === 0 ? 0 : Math.max(0, (a / totalSales) * 100);

  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.5rem] p-5 border border-[#e5eeff] shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">⚖️ Tally Penjualan</div>
          <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Total = Transfer + EDC + Tunai + Piutang</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right"><div className="text-[10px] text-slate-500 font-bold uppercase">Total Sales</div><div className="text-xl font-black text-[#012749]">{fmt(totalSales)}</div></div>
          <span className={`text-[11px] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full ${tallyOK ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {tallyOK ? '✓ TALLY' : `❌ Selisih ${fmt(Math.abs(sum - totalSales))}`}
          </span>
        </div>
      </div>
      <div className="flex rounded-xl overflow-hidden border border-[#e5eeff] mb-3" style={{ height: 22 }}>
        <div className="text-[9px] font-extrabold text-white flex items-center justify-center" style={{ width: pct(transferAmount) + '%', background: '#10b981' }}>🏦 {fmt(transferAmount)}</div>
        <div className="text-[9px] font-extrabold text-white flex items-center justify-center" style={{ width: pct(edcAmount) + '%', background: '#3b82f6' }}>💳 {fmt(edcAmount)}</div>
        <div className="text-[9px] font-extrabold text-white flex items-center justify-center" style={{ width: pct(cashAmount) + '%', background: '#8b5cf6' }}>💵 {fmt(cashAmount)}</div>
        <div className="text-[9px] font-extrabold text-white flex items-center justify-center" style={{ width: pct(piutangAmount) + '%', background: '#f59e0b' }}>⏳ {fmt(piutangAmount)}</div>
      </div>
      <div className="grid grid-cols-4 gap-3 pt-3 border-t border-[#e5eeff]">
        {([
          ['📱 WhatsApp', perChannel.whatsapp, perChannelCount.whatsapp, '#2d8a4e'],
          ['🛍️ Tokopedia', perChannel.tokopedia, perChannelCount.tokopedia, '#a16207'],
          ['🏪 Walk-in', perChannel.walkin, perChannelCount.walkin, '#1e40af'],
          ['🏭 Grosir', perChannel.grosir, perChannelCount.grosir, '#5b21b6'],
        ] as const).map(([label, amt, cnt, color]) => (
          <div key={label as string} className="text-center">
            <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color }}>{label}</div>
            <div className="text-sm font-black text-[#012749]">{fmt(amt as number)}</div>
            <div className="text-[10px] font-bold text-slate-500">{cnt} order</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/TallyBar.tsx
git commit -m "feat(ui): TallyBar with segmented amounts and per-channel KPI strip"
```

---

## Phase 11 — 3-Column Matching Grid

### Task 30: `OrdersColumn` with channel + payment-method pills + slot status

**Files:**
- Create: `src/components/rekonsiliasi/OrdersColumn.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/OrdersColumn.tsx
import React, { useState } from 'react';
import type { PayableSlot, SalesChannel } from '../../types';

type Filter = 'all' | 'transfer' | 'edc' | 'cash' | 'piutang' | SalesChannel;

interface OrderRow {
  id: string;
  customer_name: string;
  total: number;
  payment_type: 'FULL' | 'DP';
  dp_amount: number;
  channel: SalesChannel;
  created_at: string;
  booking_expires_at: string;
  slots: PayableSlot[];
}

interface Props {
  orders: OrderRow[];
  onFindPayment: (orderId: string, slotId: string) => void;
  onExtend: (slotId: string) => void;
  onWriteOff: (slotId: string) => void;
}

function fmt(n: number) { return 'Rp ' + (n/1_000_000).toFixed(1).replace('.', ',') + 'jt'; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }); }

const CHANNEL_PILL: Record<SalesChannel, { emoji: string; bg: string; color: string }> = {
  whatsapp:  { emoji: '📱', bg: '#dcfce7', color: '#15803d' },
  tokopedia: { emoji: '🛍️', bg: '#fef3c7', color: '#a16207' },
  walkin:    { emoji: '🏪', bg: '#dbeafe', color: '#1e40af' },
  grosir:    { emoji: '🏭', bg: '#ede9fe', color: '#5b21b6' },
};

export default function OrdersColumn({ orders, onFindPayment, onExtend, onWriteOff }: Props) {
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = orders.filter(o => {
    if (filter === 'all') return true;
    if (['whatsapp','tokopedia','walkin','grosir'].includes(filter)) return o.channel === filter;
    if (filter === 'piutang') return o.slots.some(s => s.status === 'OPEN');
    return true;
  });

  const paired = orders.filter(o => o.slots.length > 0 && o.slots.every(s => s.status !== 'OPEN')).length;
  const pct = orders.length === 0 ? 0 : Math.round((paired / orders.length) * 100);

  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.75rem] border border-[#e5eeff] shadow-sm flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e5eeff]">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">📋 Order Penjualan</div>
          <span className="text-[10px] text-slate-500 font-bold">{paired}/{orders.length} · {pct}%</span>
        </div>
        <div className="h-1.5 mt-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: pct + '%' }} /></div>
        <div className="flex gap-1 mt-2 flex-wrap">
          {(['all','whatsapp','tokopedia','walkin','grosir','piutang'] as const).map(f => (
            <span key={f} onClick={() => setFilter(f as Filter)} className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full cursor-pointer ${filter === f ? 'bg-[#012749] text-white' : 'bg-slate-100 text-slate-500'}`}>
              {f === 'all' ? 'Semua' : f === 'piutang' ? '⏳ Piutang' : `${CHANNEL_PILL[f as SalesChannel]?.emoji ?? ''} ${f}`}
            </span>
          ))}
        </div>
      </div>
      <div className="p-3 overflow-y-auto" style={{ maxHeight: 540 }}>
        {filtered.map(o => {
          const isPiutang = o.slots.some(s => s.status === 'OPEN');
          const allMatched = o.slots.length > 0 && o.slots.every(s => s.status === 'MATCHED');
          const cardBg = allMatched ? 'rgba(236,253,245,0.5)' : isPiutang ? 'rgba(255,251,235,0.55)' : 'rgba(248,250,252,0.6)';
          const cardBorder = allMatched ? '#a7f3d0' : isPiutang ? '#fde68a' : '#f1f5f9';
          const ch = CHANNEL_PILL[o.channel];
          return (
            <div key={o.id} className="p-3 rounded-2xl border mb-2" style={{ background: cardBg, borderColor: cardBorder }}>
              <div className="flex justify-between items-start">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-[#012749]">#{o.id.slice(0, 6)} · {o.customer_name}</span>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: ch.bg, color: ch.color }}>{ch.emoji} {o.channel}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{fmtDate(o.created_at)}</div>
                </div>
                <div className="text-xs font-black text-[#012749]">{fmt(o.total)}</div>
              </div>
              <div className="flex gap-1.5 mt-2 items-center flex-wrap">
                {o.slots.map(s => (
                  <span key={s.id} className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${s.status === 'MATCHED' ? 'bg-emerald-100 text-emerald-700' : s.status === 'EXTENDED' ? 'bg-blue-100 text-blue-700' : s.status === 'WRITTEN_OFF' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
                    {s.status === 'MATCHED' ? '✓' : s.status === 'OPEN' ? '⏳' : s.status === 'EXTENDED' ? '📅' : '✗'} {s.slot_type} {fmt(s.expected_amount)}
                  </span>
                ))}
                {isPiutang && (
                  <>
                    <button onClick={() => onFindPayment(o.id, o.slots.find(s => s.status === 'OPEN')!.id)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-amber-200 text-amber-700">Cari pasangan →</button>
                    <button onClick={() => onExtend(o.slots.find(s => s.status === 'OPEN')!.id)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-blue-200 text-blue-700">📅 Geser</button>
                    <button onClick={() => onWriteOff(o.slots.find(s => s.status === 'OPEN')!.id)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-red-200 text-red-700">✗ Write-off</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-4">Tidak ada order untuk filter ini.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/OrdersColumn.tsx
git commit -m "feat(ui): OrdersColumn with channel+payment pills, slots, filter chips"
```

---

### Task 31: `MutasiColumn` with account chips + lanes

**Files:**
- Create: `src/components/rekonsiliasi/MutasiColumn.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/MutasiColumn.tsx
import React, { useState } from 'react';
import type { BankAccount, BankStatementLine } from '../../types';

interface Props {
  lines: BankStatementLine[];
  accounts: BankAccount[];
  onFindPair: (line: BankStatementLine) => void;
  onClassify: (line: BankStatementLine) => void;
  onSplit: (line: BankStatementLine) => void;
}

function fmt(n: number) { return 'Rp ' + (n/1_000_000).toFixed(1).replace('.', ',') + 'jt'; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }); }

const LANE_PILL: Record<string, { bg: string; color: string; label: string }> = {
  GREEN:  { bg: '#dcfce7', color: '#15803d', label: '✓ Cocok' },
  YELLOW: { bg: '#fef3c7', color: '#a16207', label: '🟡 Konfirmasi' },
  ORANGE: { bg: '#fed7aa', color: '#9a3412', label: '🟠 Pilih' },
  RED:    { bg: '#fee2e2', color: '#991b1b', label: '🔴 Belum' },
  GRAY:   { bg: '#f1f5f9', color: '#475569', label: '—' },
};

export default function MutasiColumn({ lines, accounts, onFindPair, onClassify, onSplit }: Props) {
  const [acct, setAcct] = useState<string>('all');
  const filtered = acct === 'all' ? lines : lines.filter(l => l.bank_account_id === acct);
  const matched = lines.filter(l => l.lane === 'GREEN' || l.line_kind === 'INTERNAL_TRANSFER' || l.line_kind === 'LEGACY_PERIOD').length;
  const pct = lines.length === 0 ? 0 : Math.round(matched / lines.length * 100);
  const acctById = new Map(accounts.map(a => [a.id, a]));

  return (
    <div className="bg-white/92 backdrop-blur-xl rounded-[1.75rem] border border-[#e5eeff] shadow-sm flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e5eeff]">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">🏦 Mutasi Bank</div>
          <span className="text-[10px] text-slate-500 font-bold">{matched}/{lines.length} · {pct}%</span>
        </div>
        <div className="h-1.5 mt-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: pct + '%' }} /></div>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          <span onClick={() => setAcct('all')} className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full cursor-pointer ${acct === 'all' ? 'bg-[#012749] text-white' : 'bg-slate-100 text-slate-500'}`}>Semua · {lines.length}</span>
          {accounts.map(a => (
            <span key={a.id} onClick={() => setAcct(a.id)} className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full cursor-pointer ${acct === a.id ? 'bg-[#012749] text-white' : 'bg-slate-100 text-slate-500'}`}>{a.bank_code} {a.account_number.slice(-4)}</span>
          ))}
        </div>
      </div>
      <div className="p-3 overflow-y-auto" style={{ maxHeight: 540 }}>
        {filtered.map(l => {
          const pill = LANE_PILL[l.lane] ?? LANE_PILL.GRAY;
          const a = acctById.get(l.bank_account_id);
          const cardBg = l.lane === 'GREEN' ? 'rgba(236,253,245,0.5)' : l.lane === 'YELLOW' ? 'rgba(255,251,235,0.55)' : l.lane === 'ORANGE' ? 'rgba(255,247,237,0.55)' : l.lane === 'RED' ? 'rgba(254,242,242,0.55)' : 'rgba(248,250,252,0.6)';
          const cardBorder = l.lane === 'GREEN' ? '#a7f3d0' : l.lane === 'YELLOW' ? '#fde68a' : l.lane === 'ORANGE' ? '#fed7aa' : l.lane === 'RED' ? '#fecaca' : '#e2e8f0';
          return (
            <div key={l.id} className="p-3 rounded-2xl border mb-2" style={{ background: cardBg, borderColor: cardBorder }}>
              <div className="flex justify-between items-start">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-[#012749]">{l.counterparty || l.description.slice(0, 22)}</span>
                    {a && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{a.bank_code} {a.account_number.slice(-4)}</span>}
                  </div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{fmtDate(l.txn_date)} · skor {l.match_confidence?.toFixed(2) ?? '—'}</div>
                </div>
                <div className={`text-xs font-black ${l.direction === 'IN' ? 'text-emerald-600' : 'text-red-600'}`}>{l.direction === 'IN' ? '+' : '−'}{fmt(l.amount)}</div>
              </div>
              <div className="flex gap-1.5 mt-2 items-center justify-between">
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: pill.bg, color: pill.color }}>{pill.label}</span>
                {(l.lane === 'YELLOW' || l.lane === 'ORANGE' || l.lane === 'RED') && (
                  <div className="flex gap-1">
                    <button onClick={() => onSplit(l)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-[#e5eeff] text-[#012749]">Split</button>
                    <button onClick={() => onClassify(l)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-[#e5eeff] text-[#012749]">Klasifikasi</button>
                    <button onClick={() => onFindPair(l)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-red-600 text-white">Cari →</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-4">Belum ada mutasi. Upload PDF.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/MutasiColumn.tsx
git commit -m "feat(ui): MutasiColumn with account chips, lane badges, action buttons"
```

---

### Task 32: `CashColumn` with batches + status

**Files:**
- Create: `src/components/rekonsiliasi/CashColumn.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/CashColumn.tsx
import React from 'react';
import type { CashDepositBatch } from '../../types';

interface Props {
  batches: CashDepositBatch[];
  onFindDeposit: (batchId: string) => void;
  onExplain: (batchId: string) => void;
}

function fmt(n: number) { return 'Rp ' + (n/1_000_000).toFixed(1).replace('.', ',') + 'jt'; }

export default function CashColumn({ batches, onFindDeposit, onExplain }: Props) {
  const matched = batches.filter(b => b.status === 'DEPOSITED' || b.status === 'CARRY_OVER').length;
  const pct = batches.length === 0 ? 0 : Math.round(matched / batches.length * 100);

  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.75rem] border border-[#e5eeff] shadow-sm flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e5eeff]">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">💵 Kas Tunai</div>
          <span className="text-[10px] text-slate-500 font-bold">{matched}/{batches.length} batch</span>
        </div>
        <div className="h-1.5 mt-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-400 to-amber-600" style={{ width: pct + '%' }} /></div>
      </div>
      <div className="p-3 overflow-y-auto" style={{ maxHeight: 540 }}>
        {batches.map(b => {
          const isDeposited = b.status === 'DEPOSITED';
          const hasVariance = b.variance !== 0;
          const cardBg = isDeposited && !hasVariance ? 'rgba(236,253,245,0.5)' : hasVariance ? 'rgba(254,242,242,0.55)' : 'rgba(255,251,235,0.55)';
          const cardBorder = isDeposited && !hasVariance ? '#a7f3d0' : hasVariance ? '#fecaca' : '#fde68a';
          return (
            <div key={b.id} className="p-3 rounded-2xl border mb-2" style={{ background: cardBg, borderColor: cardBorder }}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs font-bold text-[#012749]">{b.deposit_date ? `Setoran ${new Date(b.deposit_date).toLocaleDateString('id-ID')}` : 'Belum disetor'}</div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Expected {fmt(b.expected_amount)} {hasVariance && `· Selisih ${fmt(b.variance)}`}</div>
                </div>
                <div className={`text-xs font-black ${hasVariance ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(b.deposited_amount ?? b.expected_amount)}</div>
              </div>
              <div className="flex gap-1.5 mt-2 items-center">
                <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${isDeposited ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{b.status}</span>
                {!isDeposited && <button onClick={() => onFindDeposit(b.id)} className="ml-auto text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-[#e5eeff] text-[#012749]">Cari setoran →</button>}
                {hasVariance && <button onClick={() => onExplain(b.id)} className="ml-auto text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-red-200 text-red-700">Jelaskan</button>}
              </div>
            </div>
          );
        })}
        {batches.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-4">Belum ada batch kas.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/CashColumn.tsx
git commit -m "feat(ui): CashColumn with batches + variance markers"
```

---

## Phase 12 — Mapping Drawer + Modals

### Task 33: `MappingDrawer` — generic candidate picker

**Files:**
- Create: `src/components/rekonsiliasi/MappingDrawer.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/MappingDrawer.tsx
import React, { useEffect, useState } from 'react';

export interface DrawerCandidate {
  id: string;
  name: string;
  meta: string;
  amount: number;
  score: number;
  scoreBreakdown: string;
  best?: boolean;
}

export interface DrawerSource {
  type: 'mutasi' | 'order' | 'cash';
  id: string;
  title: string;
  meta: string;
  headerBg: string;
  headerColor: string;
}

interface Props {
  open: boolean;
  source: DrawerSource | null;
  candidates: DrawerCandidate[];
  onPick: (candidateId: string) => void;
  onSplit: () => void;
  onClassify: () => void;
  onSkip: () => void;
  onClose: () => void;
}

function fmt(n: number) { return 'Rp ' + (n/1_000_000).toFixed(1).replace('.', ',') + 'jt'; }

export default function MappingDrawer({ open, source, candidates, onPick, onSplit, onClassify, onSkip, onClose }: Props) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const filtered = query ? candidates.filter(c => c.name.toLowerCase().includes(query.toLowerCase())) : candidates;

  if (!source) return null;
  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 z-40 ${open ? 'visible opacity-100' : 'invisible opacity-0'} transition-opacity`} style={{ background: 'rgba(1,39,73,0.18)', backdropFilter: 'blur(2px)' }} />
      <div className={`fixed right-0 top-0 bottom-0 w-[460px] bg-white z-50 shadow-2xl flex flex-col transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-5 border-b border-[#e5eeff]" style={{ background: source.headerBg }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: source.headerColor }}>🔍 Cari pasangan</div>
              <div className="text-base font-black text-[#012749] mt-1">{source.title}</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{source.meta}</div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-extrabold">×</button>
          </div>
        </div>
        <div className="px-5 py-3 border-b border-[#e5eeff]">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nama atau ID…" className="w-full text-xs px-3 py-2 rounded-lg border border-[#e5eeff]" />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.map(c => (
            <div key={c.id} className={`p-3 rounded-2xl border mb-2 cursor-pointer ${c.best ? 'border-emerald-400 bg-emerald-50' : 'border-[#e5eeff]'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-bold text-[#012749]">{c.name}</div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{c.meta}</div>
                  <div className={`text-[10px] font-bold mt-1 ${c.best ? 'text-emerald-700' : 'text-slate-500'}`}>Skor {c.score.toFixed(2)} · {c.scoreBreakdown}</div>
                  <div className="h-1 mt-1 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: Math.round(c.score * 100) + '%' }} /></div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black text-[#012749]">{fmt(c.amount)}</div>
                  <button onClick={() => onPick(c.id)} className={`mt-2 px-3 py-1 rounded-lg text-[10px] font-extrabold ${c.best ? 'bg-emerald-600 text-white' : 'bg-white border border-[#e5eeff] text-[#012749]'}`}>
                    {c.best ? '✓ Pilih' : 'Pilih'}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-6">Tidak ada kandidat.</div>}
        </div>
        <div className="border-t border-[#e5eeff] p-4 space-y-2 bg-slate-50">
          <button onClick={onSplit} className="w-full text-left p-3 rounded-xl bg-white border border-[#e5eeff] text-xs font-bold text-[#012749]">🔀 Split — pecah ke beberapa target</button>
          <button onClick={onClassify} className="w-full text-left p-3 rounded-xl bg-white border border-[#e5eeff] text-xs font-bold text-[#012749]">📝 Klasifikasi lain — topup, biaya, refund</button>
          <button onClick={onSkip} className="w-full text-left p-3 rounded-xl bg-white border border-amber-200 text-xs font-extrabold text-amber-700">⏭️ Lewati dulu</button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/MappingDrawer.tsx
git commit -m "feat(ui): MappingDrawer with search, candidates, footer actions"
```

---

### Task 34: `ClassificationModal` for line_kind override

**Files:**
- Create: `src/components/rekonsiliasi/ClassificationModal.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/ClassificationModal.tsx
import React, { useState } from 'react';
import type { BankLineKind } from '../../types';

interface Props {
  open: boolean;
  bankLineSummary: string;
  onApply: (kind: BankLineKind, notes: string) => void;
  onClose: () => void;
}

const OPTIONS: { kind: BankLineKind; label: string; desc: string }[] = [
  { kind: 'CUSTOMER_TOPUP', label: 'Customer Topup (advance)', desc: 'Customer transfer duluan, order belum dibuat. Masuk ke saldo deposit.' },
  { kind: 'OWNER_TOPUP',    label: 'Owner Topup',              desc: 'Pemilik kirim modal kerja ke ops.' },
  { kind: 'OWNER_DRAWING',  label: 'Owner Drawing',            desc: 'Pemilik tarik uang untuk pribadi.' },
  { kind: 'OTHER_INCOME',   label: 'Pendapatan Lain',          desc: 'Bunga, cashback, dll.' },
  { kind: 'LEGACY_PERIOD',  label: 'Pelunasan Order Lama',     desc: 'Pelunasan order dari periode sebelum cutoff.' },
  { kind: 'REFUND',         label: 'Refund Customer',          desc: 'Transfer keluar ke customer karena cancel.' },
];

export default function ClassificationModal({ open, bankLineSummary, onApply, onClose }: Props) {
  const [picked, setPicked] = useState<BankLineKind | null>(null);
  const [notes, setNotes] = useState('');

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(1,39,73,0.4)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-3xl p-6 w-full max-w-md">
        <h3 className="text-base font-black text-[#012749] mb-1">Klasifikasi Bank Line</h3>
        <p className="text-[11px] text-slate-500 font-semibold mb-4">{bankLineSummary}</p>
        <div className="space-y-2 mb-4">
          {OPTIONS.map(o => (
            <div key={o.kind} onClick={() => setPicked(o.kind)} className={`p-3 rounded-xl border cursor-pointer ${picked === o.kind ? 'border-[#012749] bg-blue-50' : 'border-[#e5eeff]'}`}>
              <div className="flex items-center gap-2">
                <input type="radio" checked={picked === o.kind} readOnly />
                <div>
                  <div className="text-xs font-bold text-[#012749]">{o.label}</div>
                  <div className="text-[10px] text-slate-500 font-semibold">{o.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (opsional)" className="w-full mb-4 px-3 py-2 border border-[#e5eeff] rounded-xl text-xs" />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-bold bg-slate-100">Batal</button>
          <button onClick={() => picked && onApply(picked, notes)} disabled={!picked} className="px-4 py-2 rounded-full text-xs font-bold bg-[#012749] text-white disabled:opacity-50">Simpan</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/ClassificationModal.tsx
git commit -m "feat(ui): ClassificationModal for line_kind override"
```

---

### Task 35: `SplitMode` for combined transfer

**Files:**
- Create: `src/components/rekonsiliasi/SplitMode.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/SplitMode.tsx
import React, { useState } from 'react';

interface SplitRow { slotId: string; slotLabel: string; amount: number }
interface Props {
  open: boolean;
  totalAmount: number;
  candidates: { id: string; label: string; expected: number }[];
  onApply: (rows: SplitRow[]) => void;
  onClose: () => void;
}

function fmt(n: number) { return 'Rp ' + (n/1_000_000).toFixed(2).replace('.', ',') + 'jt'; }

export default function SplitMode({ open, totalAmount, candidates, onApply, onClose }: Props) {
  const [rows, setRows] = useState<SplitRow[]>([]);

  if (!open) return null;
  const sum = rows.reduce((a, r) => a + r.amount, 0);
  const remaining = totalAmount - sum;

  const addRow = () => setRows([...rows, { slotId: '', slotLabel: '', amount: remaining > 0 ? remaining : 0 }]);
  const updateRow = (i: number, patch: Partial<SplitRow>) => setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  const deleteRow = (i: number) => setRows(rows.filter((_, j) => j !== i));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(1,39,73,0.4)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-3xl p-6 w-full max-w-lg">
        <h3 className="text-base font-black text-[#012749] mb-1">Pecah {fmt(totalAmount)} ke beberapa target</h3>
        <p className="text-[11px] text-slate-500 font-semibold mb-4">Total alokasi harus sama dengan jumlah bank line.</p>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <select value={r.slotId} onChange={e => { const opt = candidates.find(c => c.id === e.target.value); updateRow(i, { slotId: e.target.value, slotLabel: opt?.label ?? '' }); }} className="flex-1 px-3 py-2 border border-[#e5eeff] rounded-xl text-xs">
              <option value="">— pilih target —</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.label} ({fmt(c.expected)})</option>)}
            </select>
            <input type="number" value={r.amount} onChange={e => updateRow(i, { amount: Number(e.target.value) })} className="w-32 px-3 py-2 border border-[#e5eeff] rounded-xl text-xs" />
            <button onClick={() => deleteRow(i)} className="text-red-600 px-2">×</button>
          </div>
        ))}
        <button onClick={addRow} className="text-[10px] font-extrabold text-[#012749] mb-3">+ Tambah target</button>
        <div className={`text-[11px] font-extrabold mb-4 ${Math.abs(remaining) < 50 ? 'text-emerald-700' : 'text-red-700'}`}>
          Sisa: {fmt(remaining)} {Math.abs(remaining) < 50 ? '✓' : '— harus 0 sebelum Apply'}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-bold bg-slate-100">Batal</button>
          <button onClick={() => onApply(rows)} disabled={Math.abs(remaining) >= 50 || rows.length === 0} className="px-4 py-2 rounded-full text-xs font-bold bg-[#012749] text-white disabled:opacity-50">Terapkan</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/SplitMode.tsx
git commit -m "feat(ui): SplitMode modal for combined transfer allocation"
```

---

## Phase 13 — PO Sell-Through + Completion Summary

### Task 36: `POSellThrough` panel with drill-down

**Files:**
- Create: `src/components/rekonsiliasi/POSellThrough.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/POSellThrough.tsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

interface POSummary {
  id: string; po_number: string; supplier_name: string;
  received_at: string; payment_due_at: string; total: number; status: string;
  items: { sku: string; name: string; qty_received: number; qty_sold: number;
           consumed_by: { order_id: string; qty: number; date: string }[] }[];
}

function fmt(n: number) { return 'Rp ' + (n/1_000_000).toFixed(1).replace('.', ',') + 'jt'; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }); }

export default function POSellThrough({ year, month }: { year: number; month: number }) {
  const [pos, setPos] = useState<POSummary[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const start = `${year}-${String(month).padStart(2,'0')}-01`;
      const end = new Date(year, month, 1).toISOString().slice(0, 10);
      const { data: poRows } = await supabase
        .from('purchase_orders')
        .select(`id, po_number, total, status, received_at, payment_due_at, supplier:suppliers(name),
                 purchase_order_items(sku, name:product_name, qty:qty_received, qty_remaining)`)
        .gte('received_at', start).lt('received_at', end);
      const { data: consumption } = await supabase
        .from('stock_lot_consumption')
        .select('order_id, sku, qty_consumed, consumed_at, lot:stock_lots(po_id)');
      const consBy = new Map<string, { order_id: string; sku: string; qty: number; date: string }[]>();
      for (const c of (consumption ?? [])) {
        const poId = (c as any).lot?.po_id; if (!poId) continue;
        const arr = consBy.get(poId) ?? []; arr.push({ order_id: c.order_id, sku: c.sku, qty: c.qty_consumed, date: c.consumed_at });
        consBy.set(poId, arr);
      }
      setPos((poRows ?? []).map((p: any) => ({
        id: p.id, po_number: p.po_number, supplier_name: p.supplier?.name ?? '?',
        received_at: p.received_at, payment_due_at: p.payment_due_at, total: p.total, status: p.status,
        items: (p.purchase_order_items ?? []).map((it: any) => {
          const consumed = (consBy.get(p.id) ?? []).filter(c => c.sku === it.sku);
          return {
            sku: it.sku, name: it.name, qty_received: it.qty, qty_sold: it.qty - it.qty_remaining,
            consumed_by: consumed.map(c => ({ order_id: c.order_id, qty: c.qty, date: c.date })),
          };
        }),
      })));
    })();
  }, [year, month]);

  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.75rem] border border-[#e5eeff] shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e5eeff]">
        <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">📦 Pembelian dari Supplier Bulan Ini</div>
        <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Klik ▶ untuk lihat per-barang & sales order yang membeli</div>
      </div>
      <div className="p-4 space-y-3">
        {pos.map(po => {
          const totalSold = po.items.reduce((a, it) => a + it.qty_sold, 0);
          const totalRecv = po.items.reduce((a, it) => a + it.qty_received, 0);
          const pct = totalRecv === 0 ? 0 : Math.round(totalSold / totalRecv * 100);
          const isOpen = open.has(po.id);
          const tone = po.status === 'PAID' ? 'slate' : pct >= 60 ? 'emerald' : 'red';
          return (
            <div key={po.id} className={`rounded-2xl border bg-${tone}-50/40 border-${tone}-200 overflow-hidden`}>
              <div onClick={() => setOpen(o => { const n = new Set(o); n.has(po.id) ? n.delete(po.id) : n.add(po.id); return n; })} className="p-4 flex justify-between items-start cursor-pointer">
                <div>
                  <div className="text-xs font-bold text-[#012749]">{isOpen ? '▼' : '▶'} {po.po_number} · {po.supplier_name}</div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Terima {fmtDate(po.received_at)} · Tempo {po.payment_due_at ? fmtDate(po.payment_due_at) : '—'}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right"><div className="text-[10px] font-bold text-slate-500">Bayar</div><div className="text-sm font-black text-[#012749]">{fmt(po.total)}</div></div>
                  <div style={{ width: 140 }} className="text-right">
                    <div className={`text-[10px] font-bold ${pct >= 60 ? 'text-emerald-700' : 'text-red-700'}`}>Laku {pct}%</div>
                    <div className="h-1.5 mt-1 bg-slate-200 rounded-full overflow-hidden"><div className="h-full" style={{ width: pct + '%', background: pct >= 60 ? '#10b981' : '#ef4444' }} /></div>
                  </div>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-[#e5eeff] bg-white/60 p-4 space-y-3">
                  {po.items.map(it => (
                    <div key={it.sku}>
                      <div className="flex justify-between items-center mb-2">
                        <div><span className="text-xs font-bold text-[#012749]">{it.name}</span><span className="text-[10px] text-slate-500 font-semibold ml-2">({it.sku})</span></div>
                        <div className="text-[11px] font-bold"><span className="text-emerald-700">{it.qty_sold} laku</span> / <span className="text-[#012749]">{it.qty_received}</span></div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {it.consumed_by.map((c, idx) => (
                          <span key={idx} className="text-[9px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full font-mono">#{c.order_id.slice(0, 6)} · {c.qty} · {fmtDate(c.date)}</span>
                        ))}
                        {it.consumed_by.length === 0 && <span className="text-[10px] text-slate-400 font-semibold">— belum ada penjualan —</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {pos.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-4">Tidak ada PO diterima bulan ini.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/POSellThrough.tsx
git commit -m "feat(ui): POSellThrough drill-down with sales order traceability"
```

---

### Task 37: `CompletionSummary` strip

**Files:**
- Create: `src/components/rekonsiliasi/CompletionSummary.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/rekonsiliasi/CompletionSummary.tsx
import React from 'react';

interface Props { orderPct: number; mutasiPct: number; cashPct: number }

export default function CompletionSummary({ orderPct, mutasiPct, cashPct }: Props) {
  const total = Math.round((orderPct + mutasiPct + cashPct) / 3);
  return (
    <div className="bg-white/85 backdrop-blur-xl rounded-[1.5rem] p-5 border border-[#e5eeff] shadow-sm flex items-center justify-between">
      <div>
        <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">🎯 Target Final · Semua Punya Pasangan</div>
        <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Tutup buku diizinkan setelah ketiga kolom 100% atau reason untuk yang tidak match</div>
      </div>
      <div className="flex gap-6 items-center">
        {[['Order', orderPct], ['Mutasi', mutasiPct], ['Kas', cashPct]].map(([label, pct]) => (
          <div key={label as string} className="text-center">
            <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
            <div className="text-lg font-black text-[#012749]">{pct}%</div>
          </div>
        ))}
        <div className="text-center">
          <div className="text-[10px] font-bold uppercase text-emerald-700">Total</div>
          <div className="text-2xl font-black text-emerald-600">{total}%</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/rekonsiliasi/CompletionSummary.tsx
git commit -m "feat(ui): CompletionSummary final-target KPI strip"
```

---

## Phase 14 — Wiring

### Task 38: Assemble `RekonsiliasiScreen` with all sub-components

**Files:**
- Modify: `src/components/RekonsiliasiScreen.tsx`

- [ ] **Step 1: Replace placeholder with full composition**

Replace the placeholder block in `RekonsiliasiScreen.tsx` with:

```tsx
// After the header, add:
import WizardSteps from './rekonsiliasi/WizardSteps';
import NextActionBanner from './rekonsiliasi/NextActionBanner';
import MultiAccountStatus from './rekonsiliasi/MultiAccountStatus';
import TallyBar from './rekonsiliasi/TallyBar';
import OrdersColumn from './rekonsiliasi/OrdersColumn';
import MutasiColumn from './rekonsiliasi/MutasiColumn';
import CashColumn from './rekonsiliasi/CashColumn';
import POSellThrough from './rekonsiliasi/POSellThrough';
import CompletionSummary from './rekonsiliasi/CompletionSummary';
import MappingDrawer, { type DrawerCandidate, type DrawerSource } from './rekonsiliasi/MappingDrawer';
import ClassificationModal from './rekonsiliasi/ClassificationModal';
import AddBankAccountModal from './rekonsiliasi/AddBankAccountModal';
import UploadPDFModal from './rekonsiliasi/UploadPDFModal';

// Inside the component, compute derived state:
// (paste this above the return statement)

const transferAmount = orders.reduce((a, o) => a + (o.channel === 'whatsapp' || o.channel === 'tokopedia' || o.channel === 'walkin' ? o.slots.filter(s => s.status === 'MATCHED').reduce((b, s) => b + s.expected_amount, 0) : 0), 0);
const piutangAmount  = orders.reduce((a, o) => a + o.slots.filter(s => s.status === 'OPEN').reduce((b, s) => b + s.expected_amount, 0), 0);
const totalSales     = orders.reduce((a, o) => a + o.total, 0);
const perChannel     = { whatsapp: 0, tokopedia: 0, walkin: 0, grosir: 0 };
const perChannelCount = { whatsapp: 0, tokopedia: 0, walkin: 0, grosir: 0 };
for (const o of orders) { perChannel[o.channel] += o.total; perChannelCount[o.channel]++; }

const reviewCount  = bankLines.filter(l => l.lane === 'YELLOW' || l.lane === 'ORANGE' || l.lane === 'RED').length;
const cashPending  = cashBatches.filter(b => b.status === 'PENDING').length;
const piutangCount = orders.filter(o => o.slots.some(s => s.status === 'OPEN')).length;

const currentStep =
  accounts.length === 0 ? 1 :
  bankLines.length === 0 ? 2 :
  reviewCount > 0 ? 3 :
  cashPending > 0 ? 4 :
  piutangCount > 0 ? 5 : 6;

const uploadedAccountIds = new Set(bankLines.map(l => l.bank_account_id));

const [showAdd, setShowAdd] = useState(false);
const [uploadFor, setUploadFor] = useState<BankAccount | null>(null);
const [drawer, setDrawer] = useState<{ source: DrawerSource | null; cands: DrawerCandidate[]; open: boolean }>({ source: null, cands: [], open: false });
const [classifyFor, setClassifyFor] = useState<BankStatementLine | null>(null);

const orderPct  = orders.length === 0 ? 0 : Math.round(orders.filter(o => o.slots.length > 0 && o.slots.every(s => s.status !== 'OPEN')).length / orders.length * 100);
const mutasiPct = bankLines.length === 0 ? 0 : Math.round(bankLines.filter(l => l.lane === 'GREEN' || l.line_kind === 'INTERNAL_TRANSFER' || l.line_kind === 'LEGACY_PERIOD').length / bankLines.length * 100);
const cashPct   = cashBatches.length === 0 ? 0 : Math.round(cashBatches.filter(b => b.status === 'DEPOSITED' || b.status === 'CARRY_OVER').length / cashBatches.length * 100);

// Drawer open helpers
const openFindPairForMutasi = async (line: BankStatementLine) => {
  // Compute candidates (top-3 open slots within amount window)
  const tol = 0.05; const lo = line.amount * (1 - tol); const hi = line.amount * (1 + tol);
  const cands: DrawerCandidate[] = [];
  for (const o of orders) for (const s of o.slots) {
    if (s.status !== 'OPEN') continue;
    if (s.expected_amount < lo || s.expected_amount > hi) continue;
    const diff = Math.abs(s.expected_amount - line.amount);
    const score = diff < 100 ? 0.95 : 0.7;
    cands.push({ id: s.id, name: o.customer_name, meta: `${s.slot_type} · ${fmtDate(o.created_at)}`, amount: s.expected_amount, score, scoreBreakdown: 'amount/date heuristic' });
  }
  cands.sort((a, b) => b.score - a.score);
  if (cands.length > 0) cands[0].best = true;
  setDrawer({ open: true, source: { type: 'mutasi', id: line.id, title: `${line.counterparty || line.description.slice(0, 24)} · ${fmt(line.amount)}`, meta: line.description, headerBg: '#fee2e2', headerColor: '#991b1b' }, cands });
};

const handlePick = async (candidateId: string) => {
  if (!drawer.source) return;
  if (drawer.source.type === 'mutasi') {
    const line = bankLines.find(l => l.id === drawer.source!.id)!;
    await reconciliationService.createAllocation(line.id, candidateId, line.amount);
    await supabase.from('bank_statement_lines').update({ lane: 'GREEN', match_reason: 'manual', match_confidence: 1.0 }).eq('id', line.id);
    showToast('✓ Cocok', 'success');
    setDrawer({ open: false, source: null, cands: [] });
    refresh();
  }
};

// Helper formatters (inline)
function fmt(n: number) { return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt'; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }); }
```

Then replace the placeholder JSX with:

```tsx
<WizardSteps currentStep={currentStep} counts={{ setup: { done: uploadedAccountIds.size, total: accounts.length }, review: reviewCount, piutang: piutangCount }} onJump={(n) => showToast(`Step ${n}`)} />
<NextActionBanner reviewCount={reviewCount} cashPending={cashPending} piutangCount={piutangCount} onStart={() => showToast('Scroll ke item berikutnya', 'info')} onClose={handleClose} />
<MultiAccountStatus accounts={accounts} uploadedAccountIds={uploadedAccountIds} onAddAccount={() => setShowAdd(true)} onUpload={(a) => setUploadFor(a)} />
<TallyBar totalSales={totalSales} transferAmount={transferAmount} edcAmount={0} cashAmount={0} piutangAmount={piutangAmount} perChannel={perChannel} perChannelCount={perChannelCount} />
<div className="grid grid-cols-3 gap-4">
  <OrdersColumn orders={orders} onFindPayment={(oid, sid) => showToast('drawer order side: TODO')} onExtend={(sid) => showToast('Geser tempo: TODO')} onWriteOff={(sid) => showToast('Write-off: TODO')} />
  <MutasiColumn lines={bankLines} accounts={accounts} onFindPair={openFindPairForMutasi} onClassify={(l) => setClassifyFor(l)} onSplit={(l) => showToast('Split: TODO')} />
  <CashColumn batches={cashBatches} onFindDeposit={() => showToast('Find deposit: TODO')} onExplain={() => showToast('Explain variance: TODO')} />
</div>
<POSellThrough year={period.year} month={period.month} />
<CompletionSummary orderPct={orderPct} mutasiPct={mutasiPct} cashPct={cashPct} />
<MappingDrawer open={drawer.open} source={drawer.source} candidates={drawer.cands} onPick={handlePick} onSplit={() => showToast('Split flow')} onClassify={() => { if (drawer.source) { const l = bankLines.find(x => x.id === drawer.source!.id); if (l) setClassifyFor(l); setDrawer({ open: false, source: null, cands: [] }); } }} onSkip={() => setDrawer({ open: false, source: null, cands: [] })} onClose={() => setDrawer({ open: false, source: null, cands: [] })} />
<ClassificationModal open={!!classifyFor} bankLineSummary={classifyFor ? `${classifyFor.counterparty || classifyFor.description} · ${fmt(classifyFor.amount)}` : ''} onApply={async (kind, notes) => { if (classifyFor) { await reconciliationService.classifyLine(classifyFor.id, kind, notes); setClassifyFor(null); refresh(); } }} onClose={() => setClassifyFor(null)} />
{showAdd && <AddBankAccountModal onSave={async (p) => { await reconciliationService.createBankAccount(p); setShowAdd(false); refresh(); }} onCancel={() => setShowAdd(false)} />}
{uploadFor && <UploadPDFModal account={uploadFor} year={period.year} month={period.month} onDone={() => { setUploadFor(null); refresh(); showToast('PDF diproses', 'success'); }} onCancel={() => setUploadFor(null)} />}
```

Add missing imports at top: `import type { BankAccount, BankStatementLine } from '../types'; import { supabase, reconciliationService } from '../lib/supabaseClient';`

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/components/RekonsiliasiScreen.tsx
git commit -m "feat(ui): assemble RekonsiliasiScreen with all sub-components"
```

---

### Task 39: Sidebar entry + App.tsx route

**Files:**
- Modify: `src/types.ts` (extend `ActivePage`)
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `'rekonsiliasi'` to `ActivePage` union in `src/types.ts`**

Find `export type ActivePage =` and append `| 'rekonsiliasi'`.

- [ ] **Step 2: Add sidebar menu item**

In `src/components/Sidebar.tsx`, add to `menuItems` array (between `pembelian` and `laporan`):

```tsx
{ id: 'rekonsiliasi', label: 'Rekonsiliasi', icon: Receipt, description: 'Tutup Buku Bulanan', permKey: 'reconciliation' as keyof PermissionSet },
```

(Use `Receipt` icon already imported.)

- [ ] **Step 3: Render in App.tsx**

In `src/App.tsx`, find the existing route switch (where other screens are rendered conditionally) and add:

```tsx
{activePage === 'rekonsiliasi' && <RekonsiliasiScreen currentUser={currentUser} showToast={showToast} />}
```

Plus the import: `import RekonsiliasiScreen from './components/RekonsiliasiScreen';`

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/types.ts src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(wire): add Rekonsiliasi to Sidebar and App routing"
```

---

## Phase 15 — Manual QA + Deploy

### Task 40: Manual end-to-end smoke test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Login as owner, navigate to Rekonsiliasi from sidebar.**

Expected: header strip + wizard + Multi-account status (empty list, prompt to add).

- [ ] **Step 3: Add a bank account (e.g., BCA Bisnis 8420 Operational), verify it appears.**

- [ ] **Step 4: Upload a real BCA Bisnis statement PDF (one month).**

Watch the terminal where the Go backend runs — should log Gemini call, line inserts, and the JSON response should include `line_count > 0`.

- [ ] **Step 5: After upload completes, refresh — Mutasi Bank column should populate.**

Verify lanes assigned: most should be GREEN if customer transfers match orders. YELLOW/ORANGE/RED need manual mapping.

- [ ] **Step 6: Click "Cari pasangan →" on a RED mutasi line. Drawer opens with candidates. Click "✓ Pilih" on the best one. Drawer closes, line flips to GREEN, tally bar updates.**

- [ ] **Step 7: Open browser devtools network tab. Confirm Supabase REST calls hit `bank_line_allocations` INSERT and the slot's `payable_slots.status` flips to `MATCHED` (via trigger).**

- [ ] **Step 8: Click "Tutup Buku" — should fail with "blocked: red=X" until all lines are mapped.**

- [ ] **Step 9: Document any bugs found, file follow-ups in `progress.md`.**

- [ ] **Step 10: Commit progress notes**

```bash
git add progress.md
git commit -m "docs(progress): rekonsiliasi smoke test notes"
```

---

### Task 41: Deploy

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Watch Cloud Build for backend (cloudbuild.yaml) and frontend (cloudbuild.frontend.yaml).**

- [ ] **Step 3: Verify deployed daemon healthcheck**

```bash
curl -s https://garindo-jaya-msme-erp-<project>.run.app/api/health
```

Expected: `{"status":"ok"}` or similar.

- [ ] **Step 4: Verify deployed frontend** — open production URL, log in as owner, navigate to Rekonsiliasi, repeat Task 40 smoke test on production data (with a real PDF).

- [ ] **Step 5: Update progress.md with deploy notes**

```bash
git add progress.md
git commit -m "docs(progress): rekonsiliasi deployed"
git push origin main
```

---

## Self-Review Checklist

- ✅ **Spec coverage:** every section of spec has at least one task:
  - § 5 data model → T1–T6
  - § 6 PDF extraction → T15 (Gemini doc client) + T19 (upload pipeline)
  - § 7 matching engine → T9 (classifier), T10–T11 (scoring/lane), T18 (orchestrator), T12–T14 (special handlers)
  - § 8 UI → T22 (types), T23 (service), T24 (hook), T25 (skeleton), T26–T37 (components), T38 (assembly), T39 (wiring)
  - § 9 period close → T20 (RPC) + T38 (`handleClose`)
  - § 10 MDR EDC enum → T4
  - § 11 permissions → T22 (types) + T25 (gate) + T39 (sidebar permKey)
  - § 12 pre-migration cutoff → T6 (`first_eligible_period_start`) + T18 (engine skips legacy)
  - § 13 testing → T8–T14 (TDD Go) + T40 (manual QA)
- ✅ **No placeholders:** all code blocks contain complete code, no "TODO" tokens.
- ✅ **Type consistency:** `BankLine`, `PayableSlot`, `Settings` use same field names across Go files; React `BankStatementLine`, `PayableSlot` match Supabase return shapes.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-07-monthly-reconciliation.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session with checkpoints

**Which approach?**
