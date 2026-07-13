# Saldo Awal + Year-End Close (Item #5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship mid-year onboarding wizard (Saldo Awal) + annual year-end close mechanism, enabling MSME tenants to onboard mid-year with accurate financial reports and close books cleanly at fiscal year-end.

**Architecture:** 4 new tables (snapshots + AR/AP opening lines + year_end_close_events) + enum extension + 8 SECDEF RPCs. Wizard consumes RPCs. Reports (Neraca/Laba Rugi/Cash Flow) auto-integrate via GL. Piutang + Hutang aging services extend UNION with opening lines.

**Tech Stack:** Supabase PostgreSQL (SECDEF RPCs, RLS policies), React + TypeScript + Vite + Tailwind, existing recharts + PDF infrastructure.

**Spec:** [docs/superpowers/specs/2026-07-13-saldo-awal-year-end-close-design.md](../specs/2026-07-13-saldo-awal-year-end-close-design.md)

## Global Constraints

- All migrations idempotent (`IF NOT EXISTS`, `DO $$ IF NOT EXISTS` guards)
- All SECDEF RPCs owned by `vosi_rpc_owner`, `REVOKE ALL FROM PUBLIC`, `REVOKE EXECUTE FROM anon`, `GRANT EXECUTE TO authenticated`, tenant-scoped via `_resolve_tenant_id()`
- Migration slots: 140 (enum), 141 (tables), 142 (RPCs), 143 (aging integration)
- Font 13-14px UI body
- Bahasa Indonesia MSME akuntansi standar
- Rupiah format via `formatIDR()` from `src/lib/formatIDR.ts`
- Number inputs use `NumberInput` component (audit compliance)
- Reuse patterns from Item #4b PromoProdukPanel + `CatatPenjualanWizard` wizard shell
- Zero code change to Neraca/Laba Rugi/Cash Flow report queries (opening JE contributes naturally via GL)
- Advisor `get_advisors` after migration; anon REVOKE explicit
- Enum ADD VALUE requires separate transaction — mig 140 must post BEFORE mig 141-143 can use new values

---

### Task 1: Schema migrations — enum extension + 4 tables

**Files:**
- Create: `supabase/migrations/20261115000140_saldo_awal_enum_ext.sql`
- Create: `supabase/migrations/20261115000141_saldo_awal_tables.sql`

**Interfaces:**
- Consumes: existing `journal_entry_source` enum, `_resolve_tenant_id()`, `_is_platform_admin()`
- Produces:
  - Enum values `OPENING_BALANCE`, `YEAR_END_CLOSE` on `journal_entry_source`
  - Table `saldo_awal_snapshots (id, tenant_id, cutover_date, step_data JSONB, status, posted_je_id, posted_at, posted_by, reversed_*, created_*, updated_*)` with unique indexes per-tenant active/draft, RLS `p_select_own` + `p_platform_admin_readall`
  - Table `opening_ar_lines (id, tenant_id, snapshot_id, customer_id, customer_name, amount, original_due_date, invoice_ref, notes, created_at)` with FK CASCADE + index
  - Table `opening_ap_lines (similar for suppliers)` with FK CASCADE + index
  - Table `year_end_close_events (id, tenant_id, fiscal_year, net_income, posted_je_id, status, posted_at, posted_by, reversed_*, notes)` with unique per (tenant, fiscal_year, status='posted')

- [ ] **Step 1: Write mig 140 — enum extension only**

```sql
-- 20261115000140_saldo_awal_enum_ext.sql
-- Item #5: extend journal_entry_source enum for OPENING_BALANCE + YEAR_END_CLOSE.
-- Postgres requires ADD VALUE to be in own transaction; split from tables/RPCs.

ALTER TYPE public.journal_entry_source ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';
ALTER TYPE public.journal_entry_source ADD VALUE IF NOT EXISTS 'YEAR_END_CLOSE';
```

- [ ] **Step 2: Apply mig 140**

Use `mcp__plugin_supabase_supabase__apply_migration` (project_id: `ekhhojaezdfjfwuxyjkl`, name: `saldo_awal_enum_ext`, query: above).

- [ ] **Step 3: Write mig 141 — tables**

Full SQL from spec §4.2. All 4 tables with RLS enabled + policies.

- [ ] **Step 4: Apply mig 141**

- [ ] **Step 5: Verify tables + enum values**

```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid='public.journal_entry_source'::regtype
  AND enumlabel IN ('OPENING_BALANCE','YEAR_END_CLOSE');
-- expect 2 rows

SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN
  ('saldo_awal_snapshots','opening_ar_lines','opening_ap_lines','year_end_close_events');
-- expect 4 rows
```

- [ ] **Step 6: Run advisor check**

`mcp__plugin_supabase_supabase__get_advisors(project_id, type='security')` — verify no new critical findings related to new tables.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261115000140_saldo_awal_enum_ext.sql \
        supabase/migrations/20261115000141_saldo_awal_tables.sql
git commit -m "feat(item-5): schema for Saldo Awal + Year-End Close

Slot 140: enum ADD VALUE OPENING_BALANCE + YEAR_END_CLOSE.
Slot 141: 4 new tables with RLS + tenant-scope policies.
Idempotent, zero backfill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Backend RPCs — draft/preview/persediaan/post/reverse + state read

**Files:**
- Create: `supabase/migrations/20261115000142_saldo_awal_rpcs.sql`

**Interfaces:**
- Consumes: Task 1 tables + enum, existing `_resolve_tenant_id()`, `_current_user_id()`, `_post_journal_entry()`, existing `journal_entries` + `journal_entry_lines`
- Produces (6 RPCs from spec §5.1-§5.6):
  - `save_saldo_awal_draft(p_step_data JSONB, p_cutover_date DATE) → UUID`
  - `preview_saldo_awal_totals(p_step_data JSONB) → TABLE(total_assets, total_liab, total_equity, laba_ditahan_balancing NUMERIC)`
  - `get_persediaan_auto_value() → NUMERIC`
  - `post_saldo_awal_snapshot(p_snapshot_id UUID) → UUID`
  - `reverse_saldo_awal(p_snapshot_id UUID, p_reason TEXT) → UUID`
  - `get_saldo_awal_state() → TABLE(id UUID, cutover_date DATE, status TEXT, posted_je_id UUID, step_data JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`

- [ ] **Step 1: Write migration file with 6 RPCs**

For each RPC, follow the SECDEF pattern from Item #4b (`upsert_stock_promo`):

```sql
CREATE OR REPLACE FUNCTION public.save_saldo_awal_draft(
  p_step_data JSONB, p_cutover_date DATE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID; v_user UUID; v_snap_id UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_cutover_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'cutover_date harus hari ini atau sebelumnya';
  END IF;

  -- Upsert draft: delete existing draft, insert new
  DELETE FROM public.saldo_awal_snapshots
   WHERE tenant_id = v_tenant AND status = 'draft';

  INSERT INTO public.saldo_awal_snapshots
    (tenant_id, cutover_date, step_data, status, created_by, updated_by)
  VALUES (v_tenant, p_cutover_date, p_step_data, 'draft', v_user, v_user)
  RETURNING id INTO v_snap_id;

  RETURN v_snap_id;
END $$;

ALTER FUNCTION public.save_saldo_awal_draft(JSONB, DATE) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.save_saldo_awal_draft(JSONB, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_saldo_awal_draft(JSONB, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_saldo_awal_draft(JSONB, DATE) TO authenticated;

-- ... (repeat pattern for other 5 RPCs, per spec §5)
```

For `preview_saldo_awal_totals`:
```sql
CREATE OR REPLACE FUNCTION public.preview_saldo_awal_totals(p_step_data JSONB)
RETURNS TABLE(total_assets NUMERIC, total_liab NUMERIC, total_equity NUMERIC, laba_ditahan_balancing NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cash NUMERIC := 0; v_piutang NUMERIC := 0; v_persediaan NUMERIC := 0;
  v_aktiva_tetap NUMERIC := 0; v_aktiva_lain NUMERIC := 0;
  v_hutang NUMERIC := 0; v_kewajiban_lain NUMERIC := 0;
  v_modal NUMERIC := 0; v_prive NUMERIC := 0;
BEGIN
  -- Sum step1_cash.accounts[].opening_balance
  SELECT COALESCE(SUM((elem->>'opening_balance')::NUMERIC), 0) INTO v_cash
    FROM jsonb_array_elements(p_step_data->'step1_cash'->'accounts') AS elem;

  -- Step 2 piutang (aggregate mode reads aggregate_amount)
  v_piutang := COALESCE((p_step_data->'step2_aktiva'->'piutang'->>'aggregate_amount')::NUMERIC, 0);
  v_persediaan := COALESCE((p_step_data->'step2_aktiva'->'persediaan'->>'final_amount')::NUMERIC, 0);
  v_aktiva_tetap := COALESCE((p_step_data->'step2_aktiva'->'aktiva_tetap'->>'amount')::NUMERIC, 0);
  SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0) INTO v_aktiva_lain
    FROM jsonb_array_elements(p_step_data->'step2_aktiva'->'lain_lain') AS elem;

  v_hutang := COALESCE((p_step_data->'step3_kewajiban'->'hutang_usaha'->>'aggregate_amount')::NUMERIC, 0);
  SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0) INTO v_kewajiban_lain
    FROM jsonb_array_elements(p_step_data->'step3_kewajiban'->'lain_lain') AS elem;

  v_modal := COALESCE((p_step_data->'step4_ekuitas'->'modal_owner'->>'amount')::NUMERIC, 0);
  v_prive := COALESCE((p_step_data->'step4_ekuitas'->'prive'->>'amount')::NUMERIC, 0);

  total_assets := v_cash + v_piutang + v_persediaan + v_aktiva_tetap + v_aktiva_lain;
  total_liab := v_hutang + v_kewajiban_lain;
  -- Equity: Modal - Prive (prive contra) + Laba Ditahan (balancing)
  laba_ditahan_balancing := total_assets - total_liab - (v_modal - v_prive);
  total_equity := v_modal - v_prive + laba_ditahan_balancing;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.preview_saldo_awal_totals(JSONB) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.preview_saldo_awal_totals(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preview_saldo_awal_totals(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_saldo_awal_totals(JSONB) TO authenticated;
```

For `get_persediaan_auto_value`:
```sql
CREATE OR REPLACE FUNCTION public.get_persediaan_auto_value()
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant UUID; v_val NUMERIC;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN RETURN 0; END IF;
  SELECT COALESCE(SUM(stock * COALESCE(harga_modal, 0)), 0) INTO v_val
    FROM public.stocks WHERE tenant_id = v_tenant;
  RETURN v_val;
END $$;

ALTER FUNCTION public.get_persediaan_auto_value() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_persediaan_auto_value() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_persediaan_auto_value() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_persediaan_auto_value() TO authenticated;
```

For `post_saldo_awal_snapshot` — the largest RPC. Must:
1. Load snapshot + verify status='draft'
2. Read step_data JSONB
3. Compute preview totals + laba_ditahan_balancing
4. Build v_lines jsonb array with all debit/credit lines
5. Call `_post_journal_entry(entry_date, source_type, description, v_lines, source_ref_table, source_ref_id)` — verify signature at implementation time by reading existing calls (e.g. `record_kasir_sale` GL dual-write section)
6. Update snapshot with posted_je_id, posted_at, posted_by, status='posted'
7. Insert opening_ar_lines rows if step2_aktiva.piutang.mode='detail'
8. Insert opening_ap_lines rows if step3_kewajiban.hutang_usaha.mode='detail'
9. Return posted_je_id

Full implementation ~120 lines; see spec §5.4 for logic detail.

Implementer must verify actual COA codes exist (query `chart_of_accounts WHERE tenant_id = v_tenant`) — if standard COA codes (1-1010 Kas, 1-1210 Piutang Usaha, 3-1100 Modal Owner, 3-1200 Laba Ditahan) don't exist, either fail with clear error message OR use per-account resolution (need helper `_resolve_coa_by_name` or similar).

**Implementer decision at implementation time**: whether to hardcode standard COA codes or make configurable. Recommendation: assume standard COA exists (Garindo already has full COA), fail with clear error otherwise.

- [ ] **Step 2: Apply mig 142**

- [ ] **Step 3: SQL smoke test — rollback marker**

```sql
DO $$
DECLARE
  v_tenant UUID := '11111111-1111-1111-1111-111111111111'::uuid;
  v_owner  UUID := '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid;
  v_snap_id UUID; v_je_id UUID;
  v_totals RECORD;
  v_persediaan NUMERIC;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated', 'tenant_id', v_tenant::text)::text, true);

  -- Test get_persediaan_auto_value
  v_persediaan := public.get_persediaan_auto_value();
  RAISE NOTICE 'persediaan auto: %', v_persediaan;

  -- Test preview
  SELECT * INTO v_totals FROM public.preview_saldo_awal_totals(
    '{"step1_cash":{"accounts":[{"opening_balance":5000000}]},"step2_aktiva":{"piutang":{"mode":"aggregate","aggregate_amount":15000000},"persediaan":{"final_amount":500000000},"aktiva_tetap":{"amount":75000000},"lain_lain":[]},"step3_kewajiban":{"hutang_usaha":{"mode":"aggregate","aggregate_amount":8000000},"lain_lain":[]},"step4_ekuitas":{"modal_owner":{"amount":500000000},"prive":{"amount":0}}}'::jsonb);
  ASSERT v_totals.total_assets = 595000000;
  ASSERT v_totals.total_liab = 8000000;
  ASSERT v_totals.laba_ditahan_balancing = 87000000;

  -- Test draft save
  v_snap_id := public.save_saldo_awal_draft(
    '{"step1_cash":{"accounts":[]},"step2_aktiva":{"piutang":{"mode":"aggregate","aggregate_amount":0},"persediaan":{"final_amount":0},"aktiva_tetap":{"amount":0},"lain_lain":[]},"step3_kewajiban":{"hutang_usaha":{"mode":"aggregate","aggregate_amount":0},"lain_lain":[]},"step4_ekuitas":{"modal_owner":{"amount":0},"prive":{"amount":0}}}'::jsonb,
    '2026-06-30'::date);
  ASSERT (SELECT status FROM public.saldo_awal_snapshots WHERE id=v_snap_id) = 'draft';
  RAISE NOTICE 'draft saved: %', v_snap_id;

  -- Test state read
  ASSERT EXISTS (SELECT 1 FROM public.get_saldo_awal_state() WHERE id = v_snap_id);

  RAISE EXCEPTION 'rollback-marker: saldo awal RPC smoke complete';
END $$;
```

- [ ] **Step 4: Advisor + commit**

```bash
git add supabase/migrations/20261115000142_saldo_awal_rpcs.sql
git commit -m "feat(item-5): backend RPCs for Saldo Awal wizard

save_saldo_awal_draft, preview_saldo_awal_totals, get_persediaan_auto_value,
post_saldo_awal_snapshot (generates balanced JE), reverse_saldo_awal,
get_saldo_awal_state. All SECDEF STABLE|VOLATILE, tenant-scoped,
anon-revoked. SQL smoke passed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Backend RPCs — year-end close preview + post

**Files:**
- Extend: `supabase/migrations/20261115000142_saldo_awal_rpcs.sql` (append) OR create separate slot 142b — implementer choice, prefer append for atomicity

**Interfaces:**
- Consumes: Task 1 `year_end_close_events` table + `journal_entry_source` enum, existing `journal_entries` + `journal_entry_lines` + `chart_of_accounts`
- Produces:
  - `preview_year_end_close(p_fiscal_year INT) → TABLE(total_revenue NUMERIC, total_expense NUMERIC, net_income NUMERIC)`
  - `post_year_end_close(p_fiscal_year INT) → UUID`

- [ ] **Step 1: Write `preview_year_end_close`**

```sql
CREATE OR REPLACE FUNCTION public.preview_year_end_close(p_fiscal_year INT)
RETURNS TABLE(total_revenue NUMERIC, total_expense NUMERIC, net_income NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_start DATE; v_end DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    total_revenue := 0; total_expense := 0; net_income := 0;
    RETURN NEXT; RETURN;
  END IF;

  v_start := make_date(p_fiscal_year, 1, 1);
  v_end := make_date(p_fiscal_year, 12, 31);

  -- Sum revenue (COA code prefix '4-') and expense ('5-') balances for the year
  SELECT
    COALESCE(SUM(CASE WHEN coa.account_code LIKE '4-%' THEN jel.credit - jel.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.account_code LIKE '5-%' THEN jel.debit - jel.credit ELSE 0 END), 0)
  INTO total_revenue, total_expense
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.tenant_id = v_tenant
    AND je.entry_date BETWEEN v_start AND v_end
    AND je.is_posted = true;

  net_income := total_revenue - total_expense;
  RETURN NEXT;
END $$;

ALTER FUNCTION public.preview_year_end_close(INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.preview_year_end_close(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preview_year_end_close(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_year_end_close(INT) TO authenticated;
```

Column names (jel.debit / jel.credit / je.is_posted / jel.account_id / coa.account_code) — implementer must verify against actual schema. If naming differs (e.g. `amount` + `side='DEBIT|CREDIT'`), adapt query.

- [ ] **Step 2: Write `post_year_end_close`**

Similar structure. Load per-account balances, generate closing JE with per-account lines (revenue debited, expense credited, net → Laba Ditahan), insert year_end_close_events row.

- [ ] **Step 3: Apply migration**

- [ ] **Step 4: SQL smoke**

```sql
DO $$ 
DECLARE
  v_tenant UUID := '11111111-1111-1111-1111-111111111111'::uuid;
  v_owner UUID := '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid;
  v_preview RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated', 'tenant_id', v_tenant::text)::text, true);
  SELECT * INTO v_preview FROM public.preview_year_end_close(2026);
  RAISE NOTICE 'preview 2026: revenue=% expense=% ni=%', v_preview.total_revenue, v_preview.total_expense, v_preview.net_income;
  RAISE EXCEPTION 'rollback-marker: year-end close preview smoke complete';
END $$;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000142_saldo_awal_rpcs.sql
git commit -m "feat(item-5): year-end close preview + post RPCs" --amend
# OR separate commit if migration file split
```

---

### Task 4: Aging integration — extend piutang + hutang services

**Files:**
- Create: `supabase/migrations/20261115000143_aging_include_opening.sql`
- Modify: `src/lib/piutangService.ts` (or equivalent — verify at implementation time)
- Modify: purchase invoice service (locate via grep)

**Interfaces:**
- Consumes: Task 1 `opening_ar_lines` + `opening_ap_lines` tables, existing piutang/hutang queries
- Produces:
  - Backend RPC (if used by service): extend to UNION opening lines
  - FE service functions: return combined result set with `source: 'transaction' | 'opening'` marker

- [ ] **Step 1: Grep for existing aging queries**

```bash
grep -rn "piutang\|AR aging\|due_date.*status" src/lib/ --include="*.ts" | head
grep -rn "hutang\|AP aging\|purchase_invoice.*due" src/lib/ --include="*.ts" | head
```

Identify existing query points. Likely in `piutangService.ts` (referenced sidebar badge "1 faktur tempo overdue Piutang").

- [ ] **Step 2: Extend queries**

Add SELECT UNION for opening_ar_lines / opening_ap_lines. Aging bucket uses `original_due_date`. Filter WHERE snapshot posted + not reversed.

**Also extend `get_dashboard_maintenance_counts` (from Item #3 slot 130):**

```sql
-- Include opening_ar_lines in piutang overdue count/sum
-- Include opening_ap_lines in hutang overdue count/sum
CREATE OR REPLACE FUNCTION public.get_dashboard_maintenance_counts()
RETURNS TABLE(...)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$ 
... 
  -- Piutang overdue = existing kasir TEMPO count + opening_ar_lines count where overdue
  SELECT 
    COALESCE((existing_kasir_count) + (opening_ar_count), 0),
    COALESCE((existing_kasir_sum) + (opening_ar_sum), 0)
  INTO piutang_overdue_count, piutang_overdue_sum
  FROM ...;

  -- Similar for hutang
$$;
```

Actual implementation depends on the exact structure of the existing RPC.

- [ ] **Step 3: Modify FE services**

Extend TypeScript service functions to expect combined result. Aging report component consumes without change.

- [ ] **Step 4: SQL smoke + TS check**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000143_aging_include_opening.sql \
        src/lib/piutangService.ts <other-modified-services>
git commit -m "feat(item-5): aging services include opening AR/AP lines"
```

---

### Task 5: Frontend types + API client

**Files:**
- Create: `src/lib/saldoAwal/types.ts`
- Create: `src/lib/saldoAwal/api.ts`

**Interfaces:**
- Consumes: Task 2 + Task 3 RPCs
- Produces:
  - Types: `SaldoAwalSnapshot`, `SaldoAwalStepData`, `Step1Cash`, `Step2Aktiva`, `Step3Kewajiban`, `Step4Ekuitas`, `PreviewTotals`, `PersediaanAuto`, `YearEndClosePreview`, `OpeningARLine`, `OpeningAPLine`
  - API fns: `saveSaldoAwalDraft`, `previewSaldoAwalTotals`, `getPersediaanAutoValue`, `postSaldoAwalSnapshot`, `reverseSaldoAwal`, `getSaldoAwalState`, `previewYearEndClose`, `postYearEndClose`

- [ ] **Step 1: Write types.ts + api.ts**

```typescript
// types.ts
export interface Step1Cash {
  accounts: Array<{
    cash_account_id: string;
    cash_account_name: string;
    opening_balance: number;
    as_of: string;
  }>;
}

export type Step2PiutangMode = 'aggregate' | 'detail';

export interface Step2Aktiva {
  piutang: {
    mode: Step2PiutangMode;
    aggregate_amount: number;
    // detail lines stored separately in opening_ar_lines table
  };
  persediaan: {
    auto_computed_amount: number;
    manual_override: boolean;
    final_amount: number;
    override_reason: string | null;
  };
  aktiva_tetap: {
    amount: number;
    notes: string;
  };
  lain_lain: Array<{
    coa_code: string;
    coa_name: string;
    amount: number;
    notes: string;
  }>;
}

export interface Step3Kewajiban {
  hutang_usaha: {
    mode: Step2PiutangMode;
    aggregate_amount: number;
  };
  lain_lain: Array<{
    coa_code: string;
    coa_name: string;
    amount: number;
    notes: string;
  }>;
}

export interface Step4Ekuitas {
  modal_owner: { amount: number };
  prive: { amount: number };
  laba_ditahan_calculated: number | null;
}

export interface SaldoAwalStepData {
  wizard_version: 1;
  step1_cash: Step1Cash;
  step2_aktiva: Step2Aktiva;
  step3_kewajiban: Step3Kewajiban;
  step4_ekuitas: Step4Ekuitas;
}

export interface SaldoAwalSnapshot {
  id: string;
  cutover_date: string;
  status: 'draft' | 'posted' | 'reversed';
  posted_je_id: string | null;
  step_data: SaldoAwalStepData;
  created_at: string;
  updated_at: string;
}

export interface PreviewTotals {
  total_assets: number;
  total_liab: number;
  total_equity: number;
  laba_ditahan_balancing: number;
}

export interface YearEndClosePreview {
  total_revenue: number;
  total_expense: number;
  net_income: number;
}

// Client-side detail lines (persisted separately from step_data)
export interface OpeningARDetailLine {
  customer_id: string | null;
  customer_name: string;
  amount: number;
  original_due_date: string | null;
  invoice_ref: string | null;
  notes: string | null;
}

export interface OpeningAPDetailLine {
  supplier_id: string | null;
  supplier_name: string;
  amount: number;
  original_due_date: string | null;
  invoice_ref: string | null;
  notes: string | null;
}
```

```typescript
// api.ts
import { supabase } from '../supabaseClient';
import type { SaldoAwalStepData, SaldoAwalSnapshot, PreviewTotals, YearEndClosePreview } from './types';

export async function saveSaldoAwalDraft(step_data: SaldoAwalStepData, cutover_date: string): Promise<string> {
  const { data, error } = await supabase.rpc('save_saldo_awal_draft', {
    p_step_data: step_data, p_cutover_date: cutover_date,
  });
  if (error) throw error;
  return data as string;
}

export async function previewSaldoAwalTotals(step_data: SaldoAwalStepData): Promise<PreviewTotals> {
  const { data, error } = await supabase.rpc('preview_saldo_awal_totals', { p_step_data: step_data });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as PreviewTotals;
}

export async function getPersediaanAutoValue(): Promise<number> {
  const { data, error } = await supabase.rpc('get_persediaan_auto_value');
  if (error) throw error;
  return Number(data) || 0;
}

export async function postSaldoAwalSnapshot(snapshot_id: string): Promise<string> {
  const { data, error } = await supabase.rpc('post_saldo_awal_snapshot', { p_snapshot_id: snapshot_id });
  if (error) throw error;
  return data as string;
}

export async function reverseSaldoAwal(snapshot_id: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('reverse_saldo_awal', { p_snapshot_id: snapshot_id, p_reason: reason });
  if (error) throw error;
  return data as string;
}

export async function getSaldoAwalState(): Promise<SaldoAwalSnapshot | null> {
  const { data, error } = await supabase.rpc('get_saldo_awal_state');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as SaldoAwalSnapshot) : null;
}

export async function previewYearEndClose(fiscal_year: number): Promise<YearEndClosePreview> {
  const { data, error } = await supabase.rpc('preview_year_end_close', { p_fiscal_year: fiscal_year });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as YearEndClosePreview;
}

export async function postYearEndClose(fiscal_year: number): Promise<string> {
  const { data, error } = await supabase.rpc('post_year_end_close', { p_fiscal_year: fiscal_year });
  if (error) throw error;
  return data as string;
}
```

- [ ] **Step 2: Verify `npx tsc --noEmit` clean**

- [ ] **Step 3: Commit**

```bash
git add src/lib/saldoAwal/
git commit -m "feat(item-5): TypeScript types + API client for Saldo Awal"
```

---

### Task 6: Wizard shell + Step 1 (Kas & Bank)

**Files:**
- Create: `src/components/pengaturan/saldoAwal/SaldoAwalWizard.tsx` — shell + step router + preview panel
- Create: `src/components/pengaturan/saldoAwal/Step1KasBank.tsx`

**Interfaces:**
- Consumes: Task 5 API + types, existing cash_accounts service (grep for `cash_accounts` reads in Kas & Bank UI to find), existing NumberInput component
- Produces:
  - `<SaldoAwalWizard onDone={callback} initialSnapshot={...} />` — wizard shell with progress dots + Back/Next + preview panel + auto-save on step transition
  - `<Step1KasBank data onChange />` — Kas & Bank step

- [ ] **Step 1: Read `CatatPenjualanWizard.tsx` for wizard shell pattern reference**

- [ ] **Step 2: Write SaldoAwalWizard.tsx**

Progress dots component + step router (step index 1..4) + Preview panel (live-updating via previewSaldoAwalTotals) + auto-save on step change (via saveSaldoAwalDraft) + Back/Next buttons + cutover date picker at top.

- [ ] **Step 3: Write Step1KasBank.tsx**

Load `cash_accounts` for tenant (via existing service — grep for `cash_accounts` in `src/lib/`), render table with per-account NumberInput for opening_balance + date picker for as_of.

- [ ] **Step 4: Verify local dev**

`npm run dev`, navigate to Pengaturan → Akuntansi (once entry point wired in Task 12) → Wizard opens, Step 1 renders with Kas & Bank rows.

- [ ] **Step 5: Commit**

---

### Task 7: Wizard Step 2 (Aktiva) + Step 3 (Kewajiban) + Step 4 (Ekuitas + Preview + Submit)

**Files:**
- Create: `src/components/pengaturan/saldoAwal/Step2Aktiva.tsx`
- Create: `src/components/pengaturan/saldoAwal/Step3Kewajiban.tsx`
- Create: `src/components/pengaturan/saldoAwal/Step4EkuitasPreview.tsx`
- Create: `src/components/pengaturan/saldoAwal/CoAPicker.tsx` (reuse or wrap existing COA autocomplete)

**Interfaces:**
- Consumes: Task 5 API + types
- Produces: 3 step components + CoAPicker component

- [ ] **Step 1: Grep for existing COA autocomplete pattern**

Existing manual journal entry UI likely has COA picker. Grep `chart_of_accounts` in `src/components/`.

- [ ] **Step 2: Write CoAPicker.tsx**

Reusable dropdown with COA search (code + name), fires onChange with `{coa_code, coa_name}`.

- [ ] **Step 3: Write Step2Aktiva.tsx**

Sections:
- Piutang: mode toggle button → renders NumberInput for aggregate OR table for detail (Customer picker + amount + due_date + ref)
- Persediaan: display auto value from `getPersediaanAutoValue`, override toggle
- Aktiva Tetap: NumberInput + notes
- Collapsible "Akun Aktiva lain": table with CoAPicker + amount rows

- [ ] **Step 4: Write Step3Kewajiban.tsx**

Similar pattern:
- Hutang Usaha: mode toggle → aggregate OR detail (supplier picker + amount + due_date + ref)
- Collapsible "Kewajiban lain": table with CoAPicker + amount

- [ ] **Step 5: Write Step4EkuitasPreview.tsx**

- Modal Owner NumberInput
- Optional Prive NumberInput
- Laba Ditahan (auto-display from preview totals)
- Full Neraca preview table (via previewSaldoAwalTotals)
- Balance check indicator
- 2 confirmation checkboxes
- Submit button "Simpan & Post Saldo Awal" (disabled until checkboxes + balance ✓) → calls postSaldoAwalSnapshot → success toast + close wizard

- [ ] **Step 6: Verify TS + local dev**

- [ ] **Step 7: Commit**

---

### Task 8: Pengaturan → Akuntansi entry point + Saldo Awal panel state display

**Files:**
- Create: `src/components/pengaturan/SaldoAwalPanel.tsx` — main entry: shows current state (draft/posted/reversed) + button to open wizard + reverse action
- Modify: `src/components/PengaturanScreen.tsx` — add tab "Akuntansi" that renders SaldoAwalPanel

**Interfaces:**
- Consumes: Task 5 API + Task 7 SaldoAwalWizard
- Produces: Pengaturan tab "Akuntansi" with entry point

- [ ] **Step 1: Read PengaturanScreen.tsx to understand tab structure**

Item #4b + Item #3 already added tabs — follow same pattern (`PengaturanTab` type extension).

- [ ] **Step 2: Write SaldoAwalPanel.tsx**

- Fetch current state via `getSaldoAwalState`
- If NULL or reversed: show empty state "Belum ada Saldo Awal" + button "Buat Saldo Awal" → opens wizard
- If draft: show "Draft dalam progress, cutover [date]" + button "Lanjutkan" → opens wizard with initialSnapshot
- If posted: show "Saldo Awal terpost per [cutover_date]" + summary + button "Reverse & Edit" → confirmation modal → calls reverseSaldoAwal

- [ ] **Step 3: Add tab entry in PengaturanScreen**

Extend `PengaturanTab` type union with `'akuntansi'`, add tab button, add SaldoAwalPanel render.

- [ ] **Step 4: Verify TS + local dev**

- [ ] **Step 5: Commit**

---

### Task 9: Banner nudge di Laporan Akuntansi tab

**Files:**
- Create: `src/components/laporan/akuntansi/SaldoAwalBanner.tsx`
- Modify: `src/components/laporan/akuntansi/AkuntansiLaporanTab.tsx` — render banner at top

**Interfaces:**
- Consumes: Task 5 `getSaldoAwalState`
- Produces: dismissable banner component

- [ ] **Step 1: Write SaldoAwalBanner.tsx**

- Fetch state, hide if posted-not-reversed
- Show amber banner with message + CTA button "Set Saldo Awal →" (navigates to Pengaturan → Akuntansi via prop callback)
- Dismiss button stores flag in `sessionStorage` — banner hidden until reload

- [ ] **Step 2: Wire into AkuntansiLaporanTab**

Render `<SaldoAwalBanner onNavigate={props.onNavigate}/>` at top of tab content.

- [ ] **Step 3: Verify local dev**

- [ ] **Step 4: Commit**

---

### Task 10: Year-End Close button + confirmation modal

**Files:**
- Create: `src/components/laporan/akuntansi/YearEndCloseButton.tsx` — button + modal
- Modify: `src/components/laporan/akuntansi/AkuntansiLaporanTab.tsx` — render button in header

**Interfaces:**
- Consumes: Task 5 `previewYearEndClose`, `postYearEndClose`
- Produces: button that opens confirmation modal → calls postYearEndClose on submit

- [ ] **Step 1: Write YearEndCloseButton.tsx**

- Button in header with current fiscal year (default: last year OR current year if Dec 15+)
- On click: fetch previewYearEndClose(fiscal_year), open modal with preview data
- Modal: revenue + expense + net_income display + confirmation checkbox + Post button
- On post: call postYearEndClose(fiscal_year) → success toast + close modal + refresh page

- [ ] **Step 2: Wire into AkuntansiLaporanTab header**

- [ ] **Step 3: Verify local dev**

- [ ] **Step 4: Commit**

---

### Task 11: PDF export "Cetak Ringkasan Saldo Awal"

**Files:**
- Create: `src/components/pengaturan/saldoAwal/SaldoAwalPDF.tsx`
- Modify: `src/components/pengaturan/saldoAwal/Step4EkuitasPreview.tsx` — add "Cetak Ringkasan" button

**Interfaces:**
- Consumes: existing PDF infrastructure (grep for `@react-pdf/renderer` or similar; `SalesInvoicePDF.tsx` reference)
- Produces: printable PDF with full Neraca preview + wizard values

- [ ] **Step 1: Read `SalesInvoicePDF.tsx` as reference for PDF structure**

- [ ] **Step 2: Write SaldoAwalPDF.tsx**

PDF renders:
- Header: tenant name + logo + "Ringkasan Saldo Awal" + cutover date
- Section: Aktiva table (per COA)
- Section: Kewajiban table
- Section: Ekuitas table
- Footer: signature line for owner + accountant

- [ ] **Step 3: Add "Cetak Ringkasan" button in Step4EkuitasPreview**

Button triggers PDF download.

- [ ] **Step 4: Verify local dev**

- [ ] **Step 5: Commit**

---

### Task 12: Wire everything + regression check

**Files:**
- Verify: `src/components/laporan/akuntansi/AkuntansiLaporanTab.tsx` — banner + button rendered
- Verify: `src/components/PengaturanScreen.tsx` — Akuntansi tab wired
- Verify: All migrations applied
- Verify: TS clean, lint clean, build clean

- [ ] **Step 1: Run full TS + lint + audit + build**

```bash
npm run lint
npm run audit:numinput
npm run audit:secdef-null-tenant
npm run build
```

- [ ] **Step 2: Run advisor + smoke test**

- [ ] **Step 3: Update progress.md + memory `migration_slot_allocation`**

- [ ] **Step 4: Push + deploy + MCP chrome smoke**

Push to main → cloudbuild → verify tag URL → 100% traffic. MCP chrome check Pengaturan tab + Laporan Akuntansi banner + wizard flow.

- [ ] **Step 5: Final commit**

## After all tasks

- Advisor triage
- Update `progress.md` with Item #5 entry
- Update memory `migration_slot_allocation` (140-143 claimed)
- Deploy + MCP chrome smoke
- Final push
