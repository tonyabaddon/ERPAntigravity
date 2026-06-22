# Akuntansi Phase 3 Manual Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bekali Owner dengan 6 modal manual journal entry di AccountDetailScreen sehingga GL bisa diisi end-to-end tanpa nunggu Phase 0b dual-write.

**Architecture:** 5 SECURITY DEFINER PostgreSQL RPCs wrap `_post_journal_entry` (dari Phase 0a) untuk Transfer Internal / Owner Drawing / Penyesuaian Saldo (PIN) / Wallet Spend / Manual Expense. Frontend menambah `+ Aksi` dropdown context-aware di AccountDetailScreen top-right + 5 modal components + 1 JournalEntryPreview shared component. PIN flow atomic — RPC verify-then-post di backend.

**Tech Stack:** PostgreSQL 15 (Supabase), React 18 + TypeScript, Tailwind v4, lucide-react, vitest.

## Global Constraints

- All RPC SECURITY DEFINER + GRANT EXECUTE TO authenticated + role-gate `_assert_owner_active()` (kecuali Wallet Top-Up/Spend boleh staff_admin_toko juga — non-PIN actions).
- All amounts > 0 enforce di RPC level (raise `INVALID_AMOUNT`).
- Period validation delegated ke existing `_check_period_open(date)` di `_post_journal_entry`.
- `source_type` enum value reuse existing (MANUAL_TRANSFER / OWNER_DRAWING / ADJUSTMENT / WALLET_SPEND / KASIR_EXPENSE) — **NO new enum value added.**
- Negative balance ALLOWED — UI warn only, backend tidak block.
- Reason min 10 char wajib di Penyesuaian (audit).
- Description min 3 char wajib di Manual Expense.
- Source ≠ destination CHECK di Transfer Internal.
- PIN verify atomic dalam `record_balance_adjustment` RPC — raw PIN dikirim sebagai param ke RPC, jangan 2-call (race window).
- All Indonesian-friendly error messages match existing pattern dari Phase 0a.
- Tailwind v4 `@theme` tokens — primary #1e3d60 (sidebar), pill button `rounded-full`, sub-card `border-#c7d7f5 bg-#fafbff`.
- Design-system aligned dengan mockup `docs/superpowers/mockups/2026-06-21-akuntansi-phase3-manual-entry.html` — pixel-equivalent untuk colors + spacing.
- Migration timestamp slot `20260722*` (no overlap dengan parallel session ranges).
- TypeScript strict — zero `any` di service + types layer.
- Tests via vitest, integration tests pakai pattern `set_config('request.jwt.claim.sub', uid)` + `RAISE EXCEPTION 'rollback'`.

## File Structure

**Backend:**
- `supabase/migrations/20260722000001_post_manual_journal_rpcs.sql` (CREATE) — 5 RPCs + 2 helpers
- `supabase/migrations/20260722000002_accounting_proofs_bucket.sql` (CREATE) — storage bucket + RLS

**Frontend:**
- `src/lib/akuntansi/manualEntry.ts` (CREATE) — RPC wrappers + types
- `src/lib/akuntansi/manualEntry.test.ts` (CREATE) — unit tests
- `src/lib/akuntansi/coaQueries.ts` (CREATE) — beban categories + adjustment counterparts
- `src/lib/akuntansi/coaQueries.test.ts` (CREATE) — unit tests
- `src/components/akuntansi/manual/JournalEntryPreview.tsx` (CREATE) — shared D/K preview
- `src/components/akuntansi/manual/AksiDropdown.tsx` (CREATE) — context-aware menu
- `src/components/akuntansi/manual/ManualTransferModal.tsx` (CREATE) — 3 variants
- `src/components/akuntansi/manual/OwnerDrawingModal.tsx` (CREATE)
- `src/components/akuntansi/manual/BalanceAdjustmentModal.tsx` (CREATE) — PIN integrated
- `src/components/akuntansi/manual/WalletSpendModal.tsx` (CREATE)
- `src/components/akuntansi/manual/ManualExpenseModal.tsx` (CREATE)
- `src/components/kasbank/AccountDetailScreen.tsx` (MODIFY) — wire AksiDropdown + modal state

**Tests:**
- `tests/integration/akuntansi-phase3/_setup.ts` (CREATE)
- `tests/integration/akuntansi-phase3/internal-transfer.test.ts` (CREATE)
- `tests/integration/akuntansi-phase3/owner-drawing.test.ts` (CREATE)
- `tests/integration/akuntansi-phase3/balance-adjustment.test.ts` (CREATE)
- `tests/integration/akuntansi-phase3/wallet-spend.test.ts` (CREATE)
- `tests/integration/akuntansi-phase3/manual-expense.test.ts` (CREATE)

**Docs:**
- `progress.md` (MODIFY) — final entry per CLAUDE.md gotcha

---

## Task Breakdown

### Task 1: Migration — 5 RPCs + helpers + smoke tests

**Files:**
- Create: `supabase/migrations/20260722000001_post_manual_journal_rpcs.sql`
- Create: `supabase/migrations/20260722000002_accounting_proofs_bucket.sql`

**Interfaces produced:**
- `_resolve_cash_coa(p_cash_account_id uuid) RETURNS uuid` (internal helper)
- `_assert_owner_active()` — raises `INSUFFICIENT_ROLE` kalau bukan Owner+Aktif
- `record_internal_transfer(p_from_cash_id uuid, p_to_cash_id uuid, p_amount numeric, p_entry_date date, p_notes text, p_proof_url text, p_source_subtype text DEFAULT 'TRANSFER') RETURNS jsonb` — returns `{ok, entry_id, entry_number}`
- `record_owner_drawing(p_from_cash_id uuid, p_amount numeric, p_entry_date date, p_reason text, p_personal_memo text) RETURNS jsonb`
- `record_balance_adjustment(p_cash_account_id uuid, p_direction text, p_amount numeric, p_counterpart_coa_id uuid, p_reason text, p_pin text, p_entry_date date) RETURNS jsonb`
- `record_wallet_spend(p_wallet_cash_id uuid, p_beban_coa_id uuid, p_amount numeric, p_entry_date date, p_order_id uuid, p_notes text) RETURNS jsonb`
- `record_manual_expense(p_beban_coa_id uuid, p_source_cash_id uuid, p_amount numeric, p_entry_date date, p_description text, p_proof_url text) RETURNS jsonb`

**Notes:**
- `p_source_subtype` di `record_internal_transfer` distinguishes 'TRANSFER' / 'CASH_DEPOSIT' / 'WALLET_TOPUP' — written to entry.description prefix (not enum since source_type column shared)
- All RPCs validate: amount > 0, date valid, sumber/destination IDs valid, COA active
- Adjustment: verify_owner_pin pakai RPC existing (line ~125 of 20260613000010_owner_pin.sql atau search)
- All RPCs delegate atomic post ke `_post_journal_entry`

- [ ] **Step 1: Write the failing smoke test (DO block via MCP execute_sql)**

Test 1 — record_internal_transfer happy path:
```sql
DO $$
DECLARE
  v_owner uuid := (SELECT user_id FROM admin_users WHERE role='Owner' AND status='Aktif' LIMIT 1);
  v_kas uuid;
  v_bank uuid;
  v_result jsonb;
BEGIN
  SELECT id INTO v_kas FROM cash_accounts WHERE account_type='KAS' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.record_internal_transfer(v_kas, v_kas, 100000, CURRENT_DATE, 'smoke', null, 'TRANSFER');
  RAISE EXCEPTION 'should have failed: source=destination, got %', v_result;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%SAME_ACCOUNT%' OR SQLERRM LIKE '%source%destination%' THEN
    RAISE NOTICE 'PASS: SAME_ACCOUNT enforced';
  ELSE RAISE; END IF;
END $$;
```

Run via MCP `execute_sql`. Expected: PASS notice.

- [ ] **Step 2: Implement migration file**

Write `supabase/migrations/20260722000001_post_manual_journal_rpcs.sql`:

```sql
-- =================================================================
-- Phase 3 Manual Journal Entry RPCs
-- 5 SECURITY DEFINER wrappers for owner-initiated manual GL posts
-- =================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Helper: _resolve_cash_coa
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._resolve_cash_coa(p_cash_account_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v_coa uuid;
BEGIN
  SELECT coa_account_id INTO v_coa
  FROM public.cash_accounts WHERE id = p_cash_account_id AND is_active = true;
  IF v_coa IS NULL THEN
    RAISE EXCEPTION 'CASH_ACCOUNT_NOT_FOUND: %', p_cash_account_id USING ERRCODE='P0002';
  END IF;
  RETURN v_coa;
END $$;

-- ---------------------------------------------------------------------
-- Helper: _assert_owner_active
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_owner_active()
RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ) THEN RAISE EXCEPTION 'INSUFFICIENT_ROLE: Owner+Aktif required'; END IF;
END $$;

-- ---------------------------------------------------------------------
-- RPC 1: record_internal_transfer
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_internal_transfer(
  p_from_cash_id uuid, p_to_cash_id uuid, p_amount numeric,
  p_entry_date date, p_notes text, p_proof_url text,
  p_source_subtype text DEFAULT 'TRANSFER'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_coa uuid; v_to_coa uuid; v_desc text;
BEGIN
  PERFORM _assert_owner_active();
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_from_cash_id = p_to_cash_id THEN RAISE EXCEPTION 'SAME_ACCOUNT: source = destination'; END IF;
  v_from_coa := _resolve_cash_coa(p_from_cash_id);
  v_to_coa := _resolve_cash_coa(p_to_cash_id);
  v_desc := CASE p_source_subtype
    WHEN 'CASH_DEPOSIT' THEN 'Setor Kas ke Bank'
    WHEN 'WALLET_TOPUP' THEN 'Top-Up Wallet'
    ELSE 'Transfer Internal'
  END;
  IF p_notes IS NOT NULL AND length(p_notes) > 0 THEN v_desc := v_desc || ' — ' || p_notes; END IF;
  RETURN _post_journal_entry(
    p_entry_date, 'MANUAL_TRANSFER'::journal_entry_source, v_desc,
    jsonb_build_array(
      jsonb_build_object('account_id', v_to_coa, 'side', 'DEBIT', 'amount', p_amount, 'description', p_notes),
      jsonb_build_object('account_id', v_from_coa, 'side', 'CREDIT', 'amount', p_amount, 'description', p_notes)
    ),
    'cash_accounts', p_from_cash_id, NULL, NULL
  );
END $$;

-- [... include all 5 RPCs ...]

GRANT EXECUTE ON FUNCTION public.record_internal_transfer(uuid, uuid, numeric, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_owner_drawing(uuid, numeric, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_balance_adjustment(uuid, text, numeric, uuid, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_wallet_spend(uuid, uuid, numeric, date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_expense(uuid, uuid, numeric, date, text, text) TO authenticated;

COMMIT;
```

(Implementer: complete all 5 RPCs following the same pattern. For `record_balance_adjustment`, call `verify_owner_pin(p_pin)` before posting; raise `INVALID_PIN` on false. For `record_owner_drawing`, line 1 debit COA = result of `SELECT id FROM chart_of_accounts WHERE account_code='3-3000'` — verify code di seed; for `record_wallet_spend` and `record_manual_expense`, verify p_beban_coa_id has `account_type='BEBAN' AND is_active=true`.)

- [ ] **Step 3: Apply migration via MCP `apply_migration`**

Expected: `{success: true}`.

- [ ] **Step 4: Smoke test all 5 RPCs end-to-end via MCP `execute_sql`**

Per RPC:
1. Test happy path: post journal entry, verify journal_entries row + 2 lines + balance
2. Test validation: amount=0 → INVALID_AMOUNT, missing IDs → CASH_ACCOUNT_NOT_FOUND
3. Test role gate: temporary fake non-owner auth.uid → INSUFFICIENT_ROLE

Each smoke test ends with `RAISE EXCEPTION 'rollback'` to zero side effects.

- [ ] **Step 5: Write storage bucket migration**

`supabase/migrations/20260722000002_accounting_proofs_bucket.sql`:
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('accounting-proofs', 'accounting-proofs', true, 5242880, ARRAY['image/jpeg','image/png','application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- RLS: authenticated can upload/read own org files
-- (reuse pattern from payment-proofs bucket)
```

Apply via MCP `apply_migration`.

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/20260722000001_post_manual_journal_rpcs.sql supabase/migrations/20260722000002_accounting_proofs_bucket.sql
git commit -m "feat(akuntansi): Phase 3 Task 1 — 5 manual entry RPCs + accounting-proofs bucket"
```

---

### Task 2: TypeScript service + types

**Files:**
- Create: `src/lib/akuntansi/manualEntry.ts`
- Create: `src/lib/akuntansi/manualEntry.test.ts`

**Interfaces consumed:**
- All 5 RPCs from Task 1
- `supabase` client (`src/lib/supabaseClient.ts`)

**Interfaces produced:**
- `recordInternalTransfer(input: InternalTransferInput): Promise<PostResult>`
- `recordOwnerDrawing(input: OwnerDrawingInput): Promise<PostResult>`
- `recordBalanceAdjustment(input: BalanceAdjustmentInput): Promise<PostResult>`
- `recordWalletSpend(input: WalletSpendInput): Promise<PostResult>`
- `recordManualExpense(input: ManualExpenseInput): Promise<PostResult>`
- Type definitions in same file

```typescript
export interface PostResult { ok: true; entry_id: string; entry_number: string }

export interface InternalTransferInput {
  fromCashId: string; toCashId: string; amount: number;
  entryDate: string; notes?: string | null; proofUrl?: string | null;
  sourceSubtype?: 'TRANSFER' | 'CASH_DEPOSIT' | 'WALLET_TOPUP';
}

export interface OwnerDrawingInput {
  fromCashId: string; amount: number; entryDate: string;
  reason: string; personalMemo?: string | null;
}

export type AdjustmentDirection = 'UP' | 'DOWN';
export interface BalanceAdjustmentInput {
  cashAccountId: string; direction: AdjustmentDirection;
  amount: number; counterpartCoaId: string;
  reason: string; pin: string; entryDate: string;
}

export interface WalletSpendInput {
  walletCashId: string; bebanCoaId: string; amount: number;
  entryDate: string; orderId?: string | null; notes?: string | null;
}

export interface ManualExpenseInput {
  bebanCoaId: string; sourceCashId: string; amount: number;
  entryDate: string; description: string; proofUrl?: string | null;
}
```

- [ ] **Step 1: Write failing unit tests**

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { recordInternalTransfer } from './manualEntry';

vi.mock('./supabaseClient', () => ({
  supabase: { rpc: vi.fn() }
}));

describe('recordInternalTransfer', () => {
  it('calls record_internal_transfer RPC with correct args', async () => {
    const { supabase } = await import('./supabaseClient');
    (supabase.rpc as any).mockResolvedValue({ data: { ok: true, entry_id: 'X', entry_number: 'JE-1' }, error: null });
    const result = await recordInternalTransfer({ fromCashId: 'A', toCashId: 'B', amount: 100, entryDate: '2026-06-22' });
    expect(supabase.rpc).toHaveBeenCalledWith('record_internal_transfer', {
      p_from_cash_id: 'A', p_to_cash_id: 'B', p_amount: 100, p_entry_date: '2026-06-22',
      p_notes: null, p_proof_url: null, p_source_subtype: 'TRANSFER'
    });
    expect(result.entry_number).toBe('JE-1');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL** — `npx vitest run src/lib/akuntansi/manualEntry.test.ts`

- [ ] **Step 3: Implement service file**

```typescript
import { supabase } from '../supabaseClient';
// ... type definitions ...

export async function recordInternalTransfer(input: InternalTransferInput): Promise<PostResult> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('record_internal_transfer', {
    p_from_cash_id: input.fromCashId, p_to_cash_id: input.toCashId,
    p_amount: input.amount, p_entry_date: input.entryDate,
    p_notes: input.notes ?? null, p_proof_url: input.proofUrl ?? null,
    p_source_subtype: input.sourceSubtype ?? 'TRANSFER',
  });
  if (error) throw new Error(error.message);
  return data as PostResult;
}
// ... 4 more similar wrappers ...
```

- [ ] **Step 4: Run tests pass** — all 5 wrappers tested

- [ ] **Step 5: Run tsc clean** — `npx tsc --noEmit`

- [ ] **Step 6: Commit**

---

### Task 3: COA queries (beban categories + adjustment counterparts)

**Files:**
- Create: `src/lib/akuntansi/coaQueries.ts`
- Create: `src/lib/akuntansi/coaQueries.test.ts`

**Interfaces consumed:** `supabase` client

**Interfaces produced:**
- `fetchBebanCategories(): Promise<Array<{id: string, account_code: string, account_name: string}>>`
- `fetchAdjustmentCounterparts(): Promise<Array<{id, account_code, account_name, account_type}>>`

`fetchBebanCategories` returns active `BEBAN_OPERASIONAL` subtype only.
`fetchAdjustmentCounterparts` returns active PENDAPATAN + BEBAN accounts (for upward/downward corrections).

- [ ] **Step 1: Write failing test**
- [ ] **Step 2: Implement queries**
- [ ] **Step 3: Tests pass + tsc clean**
- [ ] **Step 4: Commit**

---

### Task 4: JournalEntryPreview shared component

**Files:**
- Create: `src/components/akuntansi/manual/JournalEntryPreview.tsx`

**Interfaces produced:**
```typescript
interface JEPreviewLine {
  accountCode: string; accountName: string;
  debit: number; credit: number;
}
interface JournalEntryPreviewProps {
  lines: JEPreviewLine[];
  caption?: string;
}
export default function JournalEntryPreview(props: JournalEntryPreviewProps): JSX.Element;
```

Render per mockup section 2/4/6 `.je-preview`:
- Background: `linear-gradient(135deg, #fef3c7, #fde68a)` 
- Border: `#fbbf24`
- Header: eye icon + "Journal Entry Preview" + balanced/imbalanced chip
- Table: `# | Akun | Debit | Kredit` (monospace code)
- Footer: Total D vs Total K
- Balance check: kalau D===K → "✓ Balanced" green chip; kalau tidak → "⚠ Imbalanced" rose chip

- [ ] **Step 1: Write component**
- [ ] **Step 2: Verify visual match mockup (manual check via Storybook-equivalent: temporary playground page atau visual diff)**
- [ ] **Step 3: tsc clean + lint**
- [ ] **Step 4: Commit**

---

### Task 5: AksiDropdown context-aware menu

**Files:**
- Create: `src/components/akuntansi/manual/AksiDropdown.tsx`

**Interfaces consumed:** `CashAccountBalance` from `src/lib/kasbank/types`

**Interfaces produced:**
```typescript
type AksiAction =
  | 'transfer' | 'setor_bank' | 'tarik_pribadi'
  | 'penyesuaian' | 'wallet_topup' | 'wallet_spend'
  | 'manual_expense' | 'edit_akun';

interface AksiDropdownProps {
  account: CashAccountBalance;
  onAction: (action: AksiAction) => void;
}
```

Menu items per `account_type`:
- BANK: Transfer Internal, Setor dari Kas, Tarik Pribadi, Catat Pengeluaran, Penyesuaian (PIN), Edit Akun
- KAS: Setor ke Bank, Tarik Pribadi, Catat Pengeluaran, Penyesuaian (PIN), Edit Akun
- E_WALLET: Top-Up dari Bank, Catat Spending, Penyesuaian (PIN), Edit Akun

Click-outside closes. Icons per mockup section 1 (arrow-right-left for transfer, arrow-up for deposit, scale for adjustment, etc).

- [ ] **Step 1: Write component**
- [ ] **Step 2: tsc + lint**
- [ ] **Step 3: Commit**

---

### Task 6: ManualTransferModal (3 variants)

**Files:**
- Create: `src/components/akuntansi/manual/ManualTransferModal.tsx`

**Interfaces consumed:**
- `fetchCashAccountBalances` from kasbank service
- `recordInternalTransfer` from manualEntry service
- `JournalEntryPreview`

**Variants:**
- `'transfer'` — free pick from + to (any cash account)
- `'cash_deposit'` — source locked = current KAS account, destination = Bank only
- `'wallet_topup'` — source = Bank only, destination locked = current E-Wallet

**Interfaces produced:**
```typescript
interface ManualTransferModalProps {
  open: boolean;
  variant: 'transfer' | 'cash_deposit' | 'wallet_topup';
  sourceAccount: CashAccountBalance;  // locked/initial source
  onClose: () => void;
  onPosted: () => void;
  showToast: ToastFn;
}
```

Form fields: from (dropdown / locked), to (dropdown / filtered by variant), amount (Rp formatted), date (default today), notes, optional proof upload.

JE Preview live update as user fills form.

Submit button calls `recordInternalTransfer` with `sourceSubtype` per variant.

- [ ] **Step 1: Write modal**
- [ ] **Step 2: Visual sanity match mockup section 2 + 3 (Setor Kas) + 5a (Top-Up)**
- [ ] **Step 3: tsc + lint**
- [ ] **Step 4: Commit**

---

### Task 7: OwnerDrawingModal

**Files:**
- Create: `src/components/akuntansi/manual/OwnerDrawingModal.tsx`

**Interfaces produced:**
```typescript
interface OwnerDrawingModalProps {
  open: boolean;
  sourceAccount: CashAccountBalance;
  onClose: () => void;
  onPosted: () => void;
  showToast: ToastFn;
}
```

Fields: from (locked = sourceAccount), to-personal optional dropdown (cash accounts purpose='OWNER_PERSONAL'), amount, reason textarea.

JE Preview shows D 3-3000 Prive, K source COA.

Submit calls `recordOwnerDrawing` (personalMemo = personal account label kalau dipilih, else null).

- [ ] **Step 1: Write modal**
- [ ] **Step 2: tsc + lint**
- [ ] **Step 3: Commit**

---

### Task 8: BalanceAdjustmentModal (PIN integrated)

**Files:**
- Create: `src/components/akuntansi/manual/BalanceAdjustmentModal.tsx`

**Interfaces consumed:**
- `fetchAdjustmentCounterparts` from coaQueries
- `recordBalanceAdjustment` from manualEntry
- `OwnerPinPad` from `src/components/approval/OwnerPinPad.tsx`

**Interfaces produced:**
```typescript
interface BalanceAdjustmentModalProps {
  open: boolean;
  cashAccount: CashAccountBalance;
  onClose: () => void;
  onPosted: () => void;
  showToast: ToastFn;
}
```

Fields: direction toggle (+ Tambah / − Kurangi), amount, counterpart account dropdown (from coaQueries), reason textarea (min 10 char), JE preview live, OwnerPinPad embedded.

PIN submitted as raw to `recordBalanceAdjustment` — RPC verifies atomically.

Error handling: `INVALID_PIN` → toast + clear PIN, `PIN_LOCKED` → toast countdown.

- [ ] **Step 1: Write modal**
- [ ] **Step 2: tsc + lint**
- [ ] **Step 3: Commit**

---

### Task 9: WalletSpendModal

**Files:**
- Create: `src/components/akuntansi/manual/WalletSpendModal.tsx`

**Interfaces produced:**
```typescript
interface WalletSpendModalProps {
  open: boolean;
  walletAccount: CashAccountBalance;
  onClose: () => void;
  onPosted: () => void;
  showToast: ToastFn;
}
```

Fields: wallet (locked = walletAccount), kategori spending (dropdown — hardcoded list maps ke beban COA: Lalamove ongkir → 5-2500, dst), link to order (optional, fetch from orders WHERE status IN ('INVOICE','INVOICE_TEMPO')), amount, notes.

Submit calls `recordWalletSpend`.

- [ ] **Step 1: Write modal**
- [ ] **Step 2: tsc + lint**
- [ ] **Step 3: Commit**

---

### Task 10: ManualExpenseModal

**Files:**
- Create: `src/components/akuntansi/manual/ManualExpenseModal.tsx`

**Interfaces produced:**
```typescript
interface ManualExpenseModalProps {
  open: boolean;
  sourceAccount: CashAccountBalance;
  onClose: () => void;
  onPosted: () => void;
  showToast: ToastFn;
}
```

Fields: kategori beban (dropdown from coaQueries `fetchBebanCategories`), sumber dana (dropdown all active cash accounts, default = sourceAccount), amount, description (min 3 char), proof upload (optional).

JE Preview: D kategori, K sumber dana.

Submit calls `recordManualExpense`.

- [ ] **Step 1: Write modal**
- [ ] **Step 2: tsc + lint**
- [ ] **Step 3: Commit**

---

### Task 11: Wire into AccountDetailScreen

**Files:**
- Modify: `src/components/kasbank/AccountDetailScreen.tsx`

**Interfaces consumed:** All 5 modal components + AksiDropdown

Add to AccountDetailScreen state:
```typescript
const [aksi, setAksi] = useState<AksiAction | null>(null);
```

Add to hero header top-right (or below 4-stat row):
```tsx
<AksiDropdown account={balance!} onAction={setAksi} />
```

Render each modal conditionally:
```tsx
{aksi === 'transfer' && <ManualTransferModal open variant="transfer" sourceAccount={balance!} onClose={() => setAksi(null)} onPosted={handlePosted} ... />}
{aksi === 'setor_bank' && <ManualTransferModal open variant="cash_deposit" .../>}
// ... etc
```

`handlePosted` reloads ledger + closes modal + shows success toast.

- [ ] **Step 1: Modify AccountDetailScreen**
- [ ] **Step 2: tsc + lint + visual check di browser**
- [ ] **Step 3: Commit**

---

### Task 12: Integration tests

**Files:**
- Create: `tests/integration/akuntansi-phase3/_setup.ts`
- Create: `tests/integration/akuntansi-phase3/internal-transfer.test.ts`
- Create: `tests/integration/akuntansi-phase3/owner-drawing.test.ts`
- Create: `tests/integration/akuntansi-phase3/balance-adjustment.test.ts`
- Create: `tests/integration/akuntansi-phase3/wallet-spend.test.ts`
- Create: `tests/integration/akuntansi-phase3/manual-expense.test.ts`

Pattern mirror `tests/integration/akuntansi-phase1/_setup.ts`. Each test:
1. Setup: create temp cash_accounts via service-role client
2. Call RPC
3. Verify journal_entries + journal_entry_lines inserted
4. Verify balance reflected in cash_account_balances view
5. Cleanup

Plus negative tests:
- amount=0 → INVALID_AMOUNT
- non-owner auth → INSUFFICIENT_ROLE
- closed period date → PERIOD_CLOSED (from `_check_period_open`)
- PIN wrong 3× → PIN_LOCKED (adjustment only)

- [ ] **Step 1: Write _setup.ts helper**
- [ ] **Step 2: Write 5 test files**
- [ ] **Step 3: Run all integration tests pass** — `npx vitest run tests/integration/akuntansi-phase3`
- [ ] **Step 4: Commit**

---

### Task 13: Final validation + progress.md

**Files:**
- Modify: `progress.md` (per CLAUDE.md gotcha)

**Steps:**
- [ ] **Step 1: Run full test suite** — `npm test --run`
- [ ] **Step 2: Run tsc full** — `npx tsc --noEmit`
- [ ] **Step 3: Run build** — `npm run build`
- [ ] **Step 4: Browser smoke (via Chrome DevTools MCP)**:
  - Open Kas & Bank → klik BCA Operasional → "+ Aksi" → Transfer Internal 100rb ke Mandiri → verify Riwayat update
  - Penyesuaian + PIN happy path
  - Catat Pengeluaran → beban gaji + Kas → Rp 500rb → verify Riwayat
- [ ] **Step 5: Append entry ke progress.md**

```markdown
## 2026-06-22 — Akuntansi Phase 3 Manual Entry COMPLETE (13 tasks)

5 RPCs deployed + tested. 6 modal components live di AccountDetailScreen. PIN flow atomic via verify_owner_pin inside record_balance_adjustment.

**Tasks:** [list 13 task commit hashes]
**Migrations:** 20260722000001 + 20260722000002
**UI deliverable:** [list 7 new component files + 1 modified]
**Verification:** [test counts]

**Next:** Phase 0d (GL UI — Buku Besar / Trial Balance / COA Management) atau Phase 4 Laporan.
```

- [ ] **Step 6: Commit final entry**

---

## Verification matrix

| Layer | Method | Pass criterion |
|---|---|---|
| RPC happy path | MCP execute_sql DO block | journal_entries + lines posted, balanced |
| RPC validation | MCP execute_sql DO block | Each negative test raises expected exception |
| Service layer | vitest unit | All RPC wrappers tested |
| COA queries | vitest unit | Returns correct filtered rows |
| UI render | tsc + manual browser | Components mount without console errors |
| End-to-end | Chrome DevTools MCP | 3+ manual flows succeed (transfer/adjustment/expense) |
| Regression | npm test --run | All pre-existing tests still pass |

## Pre-flight notes

- Worktree: `.claude/worktrees/akuntansi-phase3` on branch `worktree-akuntansi-phase3`
- Migration slot `20260722*` claimed — no parallel session overlap
- Ledger file: `.superpowers/sdd/progress.md` (auto-managed by skill)
