# Akuntansi Phase 0b Dual-Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Populate GL dengan transaksi bisnis riil. Bundle picker M4 + dual-write 3 RPCs + soft-fail anomaly log.

**Architecture:** 4 migrations (anomaly table + 3 RPC mods). Shared CashAccountPicker frontend. New service `dualWrite.ts`. Soft-fail via `BEGIN/EXCEPTION` wrapping `_post_journal_entry` calls. Feature flag `enable_dual_write_to_gl` (already exists in accounting_config) controls activation.

**Tech Stack:** PostgreSQL 15 (Supabase), React 18 + TypeScript strict, Tailwind v4, lucide-react, vitest.

## Global Constraints

- TypeScript strict, zero `any` in new files
- All NEW RPCs SECURITY DEFINER + GRANT EXECUTE TO authenticated; existing RPCs preserve current role gating
- Soft-fail pattern: wrap `_post_journal_entry` in BEGIN/EXCEPTION; business RPC NEVER rolls back from GL fail; anomaly INSERT must succeed
- Feature flag check: `IF (SELECT enable_dual_write_to_gl FROM accounting_config LIMIT 1) THEN ... END IF` — skip dual-write entirely if false
- Migration slot `20260723*`
- Match design tokens (CashAccountPicker uses sub-card, rounded pill button)
- `record_kasir_sale` signature stability: ADD `p_cash_account_id` as optional param at end (DEFAULT NULL) — preserve backward compat for all existing callers
- `record_pembayaran` signature unchanged — leverages existing `payload.account_id`
- `markTempoInvoicePaid` deprecated; CatatBayarModal calls new `recordPiutangPayment` service
- Indonesian-friendly error messages
- COA mapping for Pendapatan per channel: WALK_IN→4-1110, MARKETPLACE_*→4-1120, GROSIR/WHOLESALE→4-1130, TEMPO→4-1140
- Don't break existing 379 tests

## File Structure

**Backend (4 migrations):**
- `supabase/migrations/20260723000001_phase0b_dual_write_infra.sql` (CREATE) — anomaly table + accounting_config defaults + orders.cash_account_id
- `supabase/migrations/20260723000002_phase0b_record_kasir_sale_dual_write.sql` (CREATE) — modify record_kasir_sale
- `supabase/migrations/20260723000003_phase0b_record_pembayaran_dual_write.sql` (CREATE) — modify record_pembayaran
- `supabase/migrations/20260723000004_phase0b_record_piutang_payment_rpc.sql` (CREATE) — NEW record_piutang_payment

**Service layer:**
- `src/lib/akuntansi/dualWrite.ts` (CREATE) — recordPiutangPayment wrapper
- `src/lib/akuntansi/dualWrite.test.ts` (CREATE)
- `src/lib/piutangService.ts` (MODIFY) — deprecate markTempoInvoicePaid

**UI:**
- `src/components/akuntansi/CashAccountPicker.tsx` (CREATE) — shared dropdown component
- `src/components/penjualan/PenjualanBaruScreen.tsx` (MODIFY) — render picker conditionally
- `src/components/pembelian/PembayaranFormPage.tsx` (MODIFY) — verify/wire picker
- `src/components/piutang/PiutangScreen.tsx` (MODIFY) — CatatBayarModal picker + new RPC call

**Tests:**
- `tests/integration/akuntansi-phase0b/_setup.ts` (CREATE)
- `tests/integration/akuntansi-phase0b/kasir-sale-dual-write.test.ts` (CREATE)
- `tests/integration/akuntansi-phase0b/pembayaran-dual-write.test.ts` (CREATE)
- `tests/integration/akuntansi-phase0b/piutang-payment.test.ts` (CREATE)

**Docs:**
- `progress.md` (MODIFY) — final entry

---

## Task Breakdown

### Task 1: Migration 1 — dual_write_infra (anomaly table + config columns + orders.cash_account_id)

**File:** `supabase/migrations/20260723000001_phase0b_dual_write_infra.sql`

**Contents:**
```sql
BEGIN;

-- 1. Anomaly log table
CREATE TABLE IF NOT EXISTS public.gl_dual_write_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source_rpc text NOT NULL,
  source_ref_table text NOT NULL,
  source_ref_id uuid NOT NULL,
  error_code text,
  error_message text NOT NULL,
  attempted_payload jsonb NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolution_notes text
);

CREATE INDEX idx_gl_anomalies_unresolved ON gl_dual_write_anomalies (created_at DESC) WHERE resolved_at IS NULL;

-- No RLS — service-role only writes; future Phase 0c will add Owner read policy

-- 2. accounting_config defaults
ALTER TABLE public.accounting_config
  ADD COLUMN IF NOT EXISTS default_kas_account_id uuid REFERENCES cash_accounts(id),
  ADD COLUMN IF NOT EXISTS default_bank_account_id uuid REFERENCES cash_accounts(id),
  ADD COLUMN IF NOT EXISTS default_qris_account_id uuid REFERENCES cash_accounts(id),
  ADD COLUMN IF NOT EXISTS default_edc_account_id uuid REFERENCES cash_accounts(id);

-- Seed Garindo defaults: Kas Toko is the only existing cash_account, set as default_kas + default_bank (single-bank fallback)
UPDATE public.accounting_config
SET 
  default_kas_account_id = (SELECT id FROM cash_accounts WHERE account_type='KAS' AND is_active=true LIMIT 1),
  default_bank_account_id = (SELECT id FROM cash_accounts WHERE account_type='BANK' AND is_active=true LIMIT 1)
WHERE tenant_id IS NULL;

-- 3. orders.cash_account_id (destination for piutang payment)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cash_account_id uuid REFERENCES cash_accounts(id);

COMMIT;
```

- [ ] **Step 1**: Write migration
- [ ] **Step 2**: Apply via MCP `apply_migration`
- [ ] **Step 3**: Verify via execute_sql: gl_dual_write_anomalies exists; accounting_config has 4 new columns; orders.cash_account_id exists
- [ ] **Step 4**: Commit `feat(akuntansi): Phase 0b Task 1 — dual_write_infra (anomaly table + defaults + orders col)`

---

### Task 2: Migration 2 — record_kasir_sale dual-write

**File:** `supabase/migrations/20260723000002_phase0b_record_kasir_sale_dual_write.sql`

CRITICAL: Verify exact signature of current `record_kasir_sale` via:
```sql
SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname='record_kasir_sale';
```

Then CREATE OR REPLACE with `p_cash_account_id uuid DEFAULT NULL` appended.

**Body modifications:**
1. After existing INSERT to kasir_transactions (capture v_kasir_tx)
2. Check `enable_dual_write_to_gl` from accounting_config
3. If true: BEGIN/EXCEPTION block:
   - Resolve cash_account_id: explicit OR default by payment_method
   - Resolve cash_account_coa via cash_accounts.coa_account_id
   - Resolve pendapatan_coa via channel mapping (WALK_IN→4-1110, etc)
   - Call `_post_journal_entry(p_date, 'KASIR_SALE', description, lines, 'kasir_transactions', v_kasir_tx.id, NULL, NULL)`
4. EXCEPTION: INSERT anomaly + RAISE WARNING

**Helper function** `_resolve_kasir_pendapatan_coa(p_channel text) RETURNS text` — returns COA code:
```sql
CASE 
  WHEN p_channel = 'WALK_IN' THEN '4-1110'
  WHEN p_channel LIKE 'MARKETPLACE_%' THEN '4-1120'
  WHEN p_channel IN ('GROSIR', 'WHOLESALE') THEN '4-1130'
  WHEN p_channel = 'TEMPO' THEN '4-1140'
  ELSE '4-1110'
END
```

- [ ] **Step 1**: Verify current `record_kasir_sale` signature + body
- [ ] **Step 2**: Write modified migration with full CREATE OR REPLACE
- [ ] **Step 3**: Apply
- [ ] **Step 4**: Smoke test via execute_sql DO block:
   - Set enable_dual_write_to_gl=true
   - Call record_kasir_sale with payment_method='cash' (NULL p_cash_account_id) → verify GL entry created via Kas Toko default
   - Call with payment_method='transfer' + explicit p_cash_account_id → verify GL entry uses picker selection
   - Call after closing accounting_period (period closed) → verify anomaly logged + business success
   - Rollback all via RAISE EXCEPTION 'rollback'
- [ ] **Step 5**: Commit

---

### Task 3: Migration 3 — record_pembayaran dual-write

**File:** `supabase/migrations/20260723000003_phase0b_record_pembayaran_dual_write.sql`

CRITICAL: Verify current `record_pembayaran(payload jsonb)` signature + verify `payload.account_id` is indeed a `cash_accounts.id` reference (read existing migration `20260620000006`).

CREATE OR REPLACE with dual-write block:
1. After existing INSERTs (pembayaran + pembayaran_items + purchase_invoices UPDATE)
2. Check enable_dual_write_to_gl
3. If true: BEGIN/EXCEPTION:
   - account_id from payload (must be present)
   - Resolve cash_account_coa
   - For each pembayaran_item: per-supplier-invoice grouping by tagihan_id:
     - D 2-1100 Hutang Usaha (per supplier invoice)
     - K resolve_cash_coa(account_id) total
   - Actually simpler: single JE per pembayaran transaction:
     - D 2-1100 Hutang Usaha (total)
     - K resolve_cash_coa(account_id) (total minus discount)
     - K 4-1200 Pendapatan Discount (kalau ada discount_amount)
4. Call `_post_journal_entry(...)` with `source_ref_table='pembayaran', source_ref_id=v_pembayaran.id`

- [ ] **Step 1**: Read `20260620000006_phase2_rpcs_pembayaran.sql` for exact RPC body
- [ ] **Step 2**: Write modified migration
- [ ] **Step 3**: Apply
- [ ] **Step 4**: Smoke test: payload with account_id → verify GL D Hutang Usaha K Bank
- [ ] **Step 5**: Commit

---

### Task 4: Migration 4 — record_piutang_payment NEW RPC

**File:** `supabase/migrations/20260723000004_phase0b_record_piutang_payment_rpc.sql`

CREATE FUNCTION (NEW, doesn't exist yet):

```sql
CREATE OR REPLACE FUNCTION public.record_piutang_payment(
  p_order_id uuid,
  p_cash_account_id uuid,
  p_proof_url text,
  p_verified_by_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_cash_coa text;
  v_je_result jsonb;
  v_je_id uuid;
  v_dual_write boolean;
BEGIN
  -- 1. Auth check (any authenticated user can record payment per existing flow)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- 2. Load order with lock
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- 3. Validate state
  IF v_order.status != 'INVOICE_TEMPO' THEN
    RAISE EXCEPTION 'INVALID_STATE: hanya invoice tempo yang bisa dicatat lunas (status=%)', v_order.status;
  END IF;
  IF v_order.payment_type != 'TEMPO' THEN
    RAISE EXCEPTION 'NOT_TEMPO_INVOICE';
  END IF;
  IF p_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'CASH_ACCOUNT_REQUIRED: Pilih akun penerima pembayaran';
  END IF;

  -- 4. UPDATE orders
  UPDATE orders
  SET status = 'PAYMENT_VERIFIED',
      cash_account_id = p_cash_account_id,
      payment_verified_at = now(),
      verified_by = p_verified_by_user_id,
      full_proof_url = COALESCE(p_proof_url, full_proof_url)
  WHERE id = p_order_id;

  -- 5. Dual-write to GL (soft-fail)
  SELECT enable_dual_write_to_gl INTO v_dual_write FROM accounting_config WHERE tenant_id IS NULL LIMIT 1;
  IF v_dual_write THEN
    BEGIN
      SELECT account_code INTO v_cash_coa
      FROM cash_accounts ca
      JOIN chart_of_accounts coa ON coa.id = ca.coa_account_id
      WHERE ca.id = p_cash_account_id;

      v_je_result := _post_journal_entry(
        CURRENT_DATE,
        'PIUTANG_PAYMENT'::journal_entry_source,
        'Pelunasan piutang ' || COALESCE(v_order.id::text, ''),
        jsonb_build_array(
          jsonb_build_object('account_id', v_cash_coa, 'side', 'DEBIT', 'amount', v_order.total, 'description', 'Pelunasan'),
          jsonb_build_object('account_id', '1-1400', 'side', 'CREDIT', 'amount', v_order.total, 'description', 'Piutang Usaha')
        ),
        'orders', p_order_id, NULL, NULL
      );
      v_je_id := (v_je_result->>'entry_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO gl_dual_write_anomalies (source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload)
      VALUES (
        'record_piutang_payment',
        'orders',
        p_order_id,
        SQLSTATE,
        SQLERRM,
        jsonb_build_object('order_id', p_order_id, 'cash_account_id', p_cash_account_id, 'amount', v_order.total)
      );
      RAISE WARNING 'GL dual-write failed for piutang_payment: %', SQLERRM;
      v_je_id := NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'je_entry_id', v_je_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_piutang_payment(uuid, uuid, text, uuid) TO authenticated;
```

- [ ] **Step 1**: Write migration
- [ ] **Step 2**: Apply
- [ ] **Step 3**: Smoke test happy + negative (invalid state, missing cash_account, period closed)
- [ ] **Step 4**: Commit

---

### Task 5: TS service `dualWrite.ts` + tests

**Files:**
- Create `src/lib/akuntansi/dualWrite.ts`
- Create `src/lib/akuntansi/dualWrite.test.ts`

```typescript
export interface PiutangPaymentInput {
  orderId: string;
  cashAccountId: string;
  proofUrl: string | null;
  verifiedByUserId: string;
}

export interface PiutangPaymentResult {
  ok: true;
  order_id: string;
  je_entry_id: string | null;
}

export async function recordPiutangPayment(input: PiutangPaymentInput): Promise<PiutangPaymentResult> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('record_piutang_payment', {
    p_order_id: input.orderId,
    p_cash_account_id: input.cashAccountId,
    p_proof_url: input.proofUrl,
    p_verified_by_user_id: input.verifiedByUserId,
  });
  if (error) throw new Error(error.message);
  return data as PiutangPaymentResult;
}
```

Unit tests: happy path + error propagation.

- [ ] **Step 1**: Write + tests
- [ ] **Step 2**: tsc + tests pass
- [ ] **Step 3**: Commit

---

### Task 6: CashAccountPicker shared component

**File:** `src/components/akuntansi/CashAccountPicker.tsx`

Read existing cash account fetch pattern from `src/lib/kasbank/service.ts` (`fetchCashAccountBalances`). Reuse the data structure.

```typescript
export interface CashAccountPickerProps {
  value: string | null;
  onChange: (cashAccountId: string | null) => void;
  paymentMethod?: 'cash' | 'transfer' | 'qris' | 'edc';
  purposeFilter?: 'business-only' | 'all';
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  showBalance?: boolean;
}

export default function CashAccountPicker(props: CashAccountPickerProps): React.ReactElement;
```

Render: `<select>` styled per design tokens. Option format: `{type_emoji} {account_code} {internal_label}{showBalance ? ' · ' + formatRp(balance) : ''}`.

Filter logic:
- `paymentMethod='cash'` → `account_type='KAS'`
- `paymentMethod='transfer'|'qris'|'edc'` → `account_type='BANK'`
- `paymentMethod` undefined → all types (BANK/KAS/E_WALLET)
- `purposeFilter='business-only'` → exclude `purpose='OWNER_PERSONAL'`

- [ ] **Step 1**: Write component
- [ ] **Step 2**: tsc clean
- [ ] **Step 3**: Commit

---

### Task 7: PenjualanBaruScreen integration

**File:** `src/components/penjualan/PenjualanBaruScreen.tsx` (MODIFY)

Find the payment method radio/dropdown. After it:
- Render `<CashAccountPicker paymentMethod={paymentMethod} purposeFilter="business-only" required={paymentMethod !== 'cash'} value={cashAccountId} onChange={setCashAccountId} />`
- Pass `cashAccountId` (or null when cash) to `record_kasir_sale` RPC call

Find where `record_kasir_sale` is called (likely in penjualanService or similar). Add `p_cash_account_id` arg.

- [ ] **Step 1**: Locate payment_method UI + RPC call site
- [ ] **Step 2**: Wire picker + pass param
- [ ] **Step 3**: tsc + build OK
- [ ] **Step 4**: Commit

---

### Task 8: PembayaranFormPage verification + wire if needed

**File:** `src/components/pembelian/PembayaranFormPage.tsx` (MODIFY if needed)

The page might already have account_id wired (per existing record_pembayaran payload). Verify:
- If existing implementation uses inline `<select>` → REPLACE with shared CashAccountPicker
- If existing uses a different pattern → leave alone, just verify account_id flows correctly to RPC

- [ ] **Step 1**: Read current implementation
- [ ] **Step 2**: Refactor to shared picker (if practical, else skip)
- [ ] **Step 3**: tsc clean
- [ ] **Step 4**: Commit (may be no-op if already wired correctly)

---

### Task 9: PiutangScreen CatatBayarModal — picker + new RPC

**File:** `src/components/piutang/PiutangScreen.tsx` (MODIFY)

In `CatatBayarModal`:
- Add `cashAccountId` state
- Render `<CashAccountPicker purposeFilter="business-only" required value={cashAccountId} onChange={setCashAccountId} label="Masuk ke akun *" />`
- In `handleConfirm`: replace `markTempoInvoicePaid(orderId, proofUrl, currentUserId)` with `recordPiutangPayment({orderId, cashAccountId, proofUrl, verifiedByUserId: currentUserId})`
- Validate cashAccountId present before submit

- [ ] **Step 1**: Modify CatatBayarModal
- [ ] **Step 2**: Update service import
- [ ] **Step 3**: tsc + build OK
- [ ] **Step 4**: Commit

---

### Task 10: Integration tests (3 files) + enable dual-write flag

**Files:**
- `tests/integration/akuntansi-phase0b/_setup.ts` (CREATE)
- `tests/integration/akuntansi-phase0b/kasir-sale-dual-write.test.ts`
- `tests/integration/akuntansi-phase0b/pembayaran-dual-write.test.ts`
- `tests/integration/akuntansi-phase0b/piutang-payment.test.ts`

Pattern C per Phase 3/0d/4 precedent. Each test verifies:
- RPC exists
- Schema joins work
- Anomaly table receives writes when GL fails (mock by referencing closed period)

PLUS: enable feature flag via MCP execute_sql:
```sql
UPDATE accounting_config SET enable_dual_write_to_gl = true WHERE tenant_id IS NULL;
```

- [ ] **Step 1**: Write tests
- [ ] **Step 2**: Run vitest pass
- [ ] **Step 3**: Enable flag in production accounting_config
- [ ] **Step 4**: Commit

---

### Task 11: Final validation + progress.md

- [ ] **Step 1**: `npm test --run` → all PASS
- [ ] **Step 2**: `npx tsc --noEmit` → clean
- [ ] **Step 3**: `npm run build` → OK
- [ ] **Step 4**: MCP browser smoke (optional):
   - Create a test cash sale → verify Trial Balance shows revenue + cash entry
   - Create a test tempo payment → verify Piutang account reduces, Cash increases
- [ ] **Step 5**: Append progress.md entry
- [ ] **Step 6**: Commit `docs(progress): Akuntansi Phase 0b dual-write COMPLETE`

---

## Verification matrix

| Layer | Method | Pass criterion |
|---|---|---|
| RPC modifications | MCP execute_sql DO blocks | Each RPC posts GL when flag on |
| Soft-fail | DO block with closed period | Anomaly logged + business txn succeeds |
| Picker UI | tsc + build | Renders without errors |
| Integration tests | vitest Pattern C | Schema + RPC deployment verified |
| Regression | npm test --run | 379+ existing tests pass |
| Production flag | execute_sql UPDATE | enable_dual_write_to_gl = true |

## Pre-flight notes

- Worktree: `.claude/worktrees/akuntansi-phase0b` on branch `worktree-akuntansi-phase0b`
- Migration slot `20260723*`
- IMPORTANT: subagents MUST verify `git branch --show-current` = `worktree-akuntansi-phase0b` BEFORE git add (per Phase 0d Task 2 anomaly precedent)
- After all 11 tasks: MERGE to main + DEPLOY via Cloud Run + PROMOTE traffic + ENABLE flag
