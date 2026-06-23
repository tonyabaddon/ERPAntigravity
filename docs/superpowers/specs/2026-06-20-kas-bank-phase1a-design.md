# Kas & Bank — Phase 1a Design Spec (Visibility)

**Tanggal:** 2026-06-20 (rev2: 2026-06-20)
**Status:** Draft — menunggu user review untuk lock requirements
**Roadmap:** `2026-06-20-kas-bank-roadmap.md`
**Mockup:** `docs/superpowers/mockups/2026-06-20-kas-bank-phase1a.html`

---

## 1. Goal

Owner buka modul Kas & Bank → langsung lihat saldo semua akun (Bank, Kas Toko, E-Wallet, Pribadi) + riwayat mutasi auto dari kasir/pembelian/piutang. **0 manual entry.** Banner peringatan kalau ada marketplace pending (akurat di Phase 1b).

**Success criteria:**
- Owner satu klik dari sidebar → halaman utama, lihat saldo terkini per akun
- Klik kartu → detail akun dengan riwayat 1 tahun historis (dari backfill)
- Setiap transaksi baru (kasir/pembelian/piutang) auto-update saldo dalam <1 detik (Postgres Realtime subscription)
- Akun pribadi tag "Pribadi", excluded dari total liquid bisnis

---

## 2. Locked decisions (dari brainstorm 2026-06-20)

1. Account picker saat input transaksi (cash kasir auto Kas Toko)
2. Akun pribadi muncul di list, badge "Pribadi", excluded dari laporan bisnis
3. Backfill semua data historis sejak Juni 2025, opening balance default 0
4. 3-way konsolidasi → 1 tabel `cash_accounts` (gabungan recon `bank_accounts` + `store_bank_accounts` + konsep baru)
5. Sidebar top-level "Kas & Bank" di group Keuangan
6. Marketplace sale: langsung IN + banner (akurasi di Phase 1b)
7. Account types: `BANK + KAS + E_WALLET`
8. Arsitektur: write-through ledger via RPC wrap

---

## 3. Out of scope Phase 1a

- Manual entry (Transfer Internal, Setor, Tarik, Penyesuaian) → Phase 2
- Settlement queue + confirm UI → Phase 1b
- Laporan PDF/Excel → Phase 3
- Recon matching ke cash_movements → Phase 4
- Auto bank feed → Phase 5
- Attachment per cash_movement → Phase 2 (bareng manual entry)
- Edit/delete cash_movement → tidak ada di Phase 1a (immutable; salah input owner pakai Penyesuaian di Phase 2)

---

## 4. Verified facts (rev2)

Sebelum lock data model, sudah di-verify ke source code:

| Fakta | Status |
|---|---|
| `kasir_transactions.id` type | **UUID** ✓ (migration 20260604000008:15) |
| `purchase_invoice_payments` table | Tidak ada — payment via `record_pembayaran` RPC (Pembelian Phase 2a) yang INSERT ke `pembayaran` + `pembayaran_links` |
| `markTempoInvoicePaid` | TypeScript function `src/lib/piutangService.ts:140`, direct UPDATE `orders` — **bukan RPC**. Perlu buat RPC baru. |
| `mark_pi_paid` RPC | Exists (migration 20260615000004) — **LEGACY**, sekarang flow pakai `record_pembayaran` |
| Kasir setor batch table name | **`cash_deposit_batches`** (bukan `cash_batches`) — migration 20260607000004 |
| Recon `bank_accounts` columns | `id uuid, bank_code text NOT NULL, account_number text NOT NULL, account_label text NOT NULL, purpose text NOT NULL, is_active boolean, created_at timestamptz` |
| Constraint nama (untuk DROP later) | `bank_accounts_bank_code_check`, `bank_accounts_purpose_check` (default Postgres naming dari inline CHECK; preserved across RENAME) |

---

## 5. Data model

### 5.1 `cash_accounts` (RENAME dari recon `bank_accounts` + ALTER)

```sql
-- Step 1: RENAME table (constraint names + FK refs preserved via OID)
ALTER TABLE public.bank_accounts RENAME TO cash_accounts;

-- Step 2: Drop NOT NULL on columns that should be nullable for KAS/E_WALLET
ALTER TABLE public.cash_accounts
  ALTER COLUMN bank_code DROP NOT NULL,
  ALTER COLUMN account_number DROP NOT NULL,
  ALTER COLUMN account_label DROP NOT NULL;  -- will rename to internal_label

-- Step 3: ADD new columns
ALTER TABLE public.cash_accounts
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'BANK'
    CHECK (account_type IN ('BANK','KAS','E_WALLET')),
  ADD COLUMN IF NOT EXISTS account_holder text,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS show_in_invoice boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS opening_balance numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance_date date NOT NULL DEFAULT '2025-06-01',
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS tenant_id uuid,   -- future-proof multi-tenant; default NULL = global
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Step 4: Rename account_label → internal_label
ALTER TABLE public.cash_accounts RENAME COLUMN account_label TO internal_label;

-- Step 5: Drop old CHECK constraints (names preserved from inline CHECK in original migration)
ALTER TABLE public.cash_accounts DROP CONSTRAINT IF EXISTS bank_accounts_bank_code_check;
ALTER TABLE public.cash_accounts DROP CONSTRAINT IF EXISTS bank_accounts_purpose_check;

-- Step 6: Add type-aware CHECK constraints
ALTER TABLE public.cash_accounts ADD CONSTRAINT cash_accounts_bank_code_check
  CHECK (
    (account_type = 'BANK' AND bank_code IN ('BCA','MANDIRI','BRI','BNI','PERMATA','CIMB','OTHER'))
    OR (account_type IN ('KAS','E_WALLET') AND bank_code IS NULL)
  );

ALTER TABLE public.cash_accounts ADD CONSTRAINT cash_accounts_account_number_check
  CHECK (
    (account_type = 'BANK' AND account_number IS NOT NULL)
    OR (account_type IN ('KAS','E_WALLET') AND account_number IS NULL)
  );

ALTER TABLE public.cash_accounts ADD CONSTRAINT cash_accounts_provider_check
  CHECK (
    (account_type = 'E_WALLET' AND provider IS NOT NULL)
    OR (account_type IN ('BANK','KAS') AND provider IS NULL)
  );

ALTER TABLE public.cash_accounts ADD CONSTRAINT cash_accounts_purpose_check
  CHECK (purpose IN ('OPERATIONAL','OWNER_PERSONAL','SAVINGS','PETTY_CASH','OTHER'));

ALTER TABLE public.cash_accounts ADD CONSTRAINT cash_accounts_internal_label_required
  CHECK (internal_label IS NOT NULL);  -- always required, all types

-- Step 7: Indexes
CREATE INDEX IF NOT EXISTS idx_cash_accounts_type_active ON public.cash_accounts(account_type, is_active);
CREATE INDEX IF NOT EXISTS idx_cash_accounts_purpose ON public.cash_accounts(purpose) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_cash_accounts_sort ON public.cash_accounts(sort_order) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_cash_accounts_tenant ON public.cash_accounts(tenant_id) WHERE tenant_id IS NOT NULL;

-- Step 8: updated_at trigger (reuse existing set_updated_at function)
CREATE TRIGGER cash_accounts_set_updated_at
BEFORE UPDATE ON public.cash_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### 5.2 `cash_movements` (NEW)

```sql
CREATE TYPE cash_movement_direction AS ENUM ('IN', 'OUT');

CREATE TYPE cash_movement_source AS ENUM (
  'KASIR_SALE',           -- record_kasir_sale (cash/transfer/qris/debit)
  'PIUTANG_PAYMENT',      -- record_piutang_payment (NEW RPC, Phase 1a)
  'PEMBAYARAN',           -- record_pembayaran (Pembelian Phase 2a RPC)
  'CASH_DEPOSIT_BATCH',   -- cash_deposit_batches.status=DEPOSITED transition
  'OPENING_BALANCE',      -- one-time per account at create
  'BACKFILL'              -- one-shot from historical data (migration)
);

CREATE TABLE public.cash_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.cash_accounts(id) ON DELETE RESTRICT,
  direction         cash_movement_direction NOT NULL,
  amount            numeric(15,2) NOT NULL CHECK (amount > 0),
  occurred_at       timestamptz NOT NULL,
  source_type       cash_movement_source NOT NULL,
  source_ref_table  text,             -- e.g., 'kasir_transactions', 'pembayaran', 'orders'
  source_ref_id     uuid,             -- FK by convention, not enforced (cross-table polymorphic)
  category          text,             -- free-form for Phase 1a (Phase 3 normalizes)
  description       text,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  tenant_id         uuid,              -- future-proof; default NULL = global
  -- Phase 1b additions (defined now to avoid re-migration):
  status            text NOT NULL DEFAULT 'CLEARED' CHECK (status IN ('CLEARED','PENDING')),
  cleared_at        timestamptz,
  -- Phase 4 additions:
  reconciled_at     timestamptz,
  bank_line_id      uuid              -- FK constraint added in Phase 4 to bank_statement_lines
);

-- Idempotency: prevent duplicate insert from same source event
CREATE UNIQUE INDEX uq_cash_movements_source
  ON public.cash_movements(source_type, source_ref_table, source_ref_id, direction)
  WHERE source_ref_id IS NOT NULL;

CREATE INDEX idx_cash_movements_account_occurred
  ON public.cash_movements(account_id, occurred_at DESC);
CREATE INDEX idx_cash_movements_status
  ON public.cash_movements(status) WHERE status = 'PENDING';
CREATE INDEX idx_cash_movements_reconciled
  ON public.cash_movements(account_id, reconciled_at)
  WHERE reconciled_at IS NULL AND status = 'CLEARED';
CREATE INDEX idx_cash_movements_tenant
  ON public.cash_movements(tenant_id) WHERE tenant_id IS NOT NULL;

-- RLS: deny-by-default; RPCs are SECURITY DEFINER
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read cash_movements" ON public.cash_movements
  FOR SELECT TO authenticated USING (true);
-- No insert/update/delete policies — only via SECURITY DEFINER RPCs

-- Add to Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_movements;
```

**Immutability:** Phase 1a tidak expose UPDATE/DELETE. RPC wraps INSERT only. Salah input → owner pakai Penyesuaian di Phase 2 (insert reversing movement, bukan delete).

### 5.3 `cash_account_balances` view

```sql
CREATE OR REPLACE VIEW public.cash_account_balances AS
SELECT
  a.id AS account_id,
  a.internal_label,
  a.account_type,
  a.purpose,
  a.tenant_id,
  a.opening_balance,
  COALESCE(SUM(
    CASE WHEN m.status = 'CLEARED' AND m.direction = 'IN'  THEN m.amount ELSE 0 END
  ), 0) AS total_in,
  COALESCE(SUM(
    CASE WHEN m.status = 'CLEARED' AND m.direction = 'OUT' THEN m.amount ELSE 0 END
  ), 0) AS total_out,
  COALESCE(SUM(
    CASE WHEN m.status = 'PENDING' AND m.direction = 'IN'  THEN m.amount ELSE 0 END
  ), 0) AS pending_in,
  a.opening_balance + COALESCE(SUM(
    CASE WHEN m.status = 'CLEARED' AND m.direction = 'IN'  THEN m.amount
         WHEN m.status = 'CLEARED' AND m.direction = 'OUT' THEN -m.amount
         ELSE 0 END
  ), 0) AS current_balance,
  MAX(m.occurred_at) AS last_movement_at,
  COUNT(*) FILTER (WHERE m.occurred_at >= date_trunc('month', now())) AS movements_this_month
FROM public.cash_accounts a
LEFT JOIN public.cash_movements m ON m.account_id = a.id
WHERE a.is_active = true
GROUP BY a.id, a.internal_label, a.account_type, a.purpose, a.tenant_id, a.opening_balance;
```

**Performance:** indexed JOIN; sufficient untuk 1 tenant + 1 tahun data (<1M rows). Materialize jika queries melambat (Phase 4+).

---

## 6. Migrations (rev2 — addresses critical issues)

Slot range: `20260701000001` onwards (avoid collision dengan Pembelian Phase 2b).

| # | File | Purpose |
|---|---|---|
| 1 | `20260701000001_consumer_refactor_to_cash_accounts.sql` | **PRE-WORK:** refactor consumer code (Invoice PDF, Pengaturan mutations, etc) to reference `cash_accounts` via VIEW shim alias `store_bank_accounts` — TEMPORARILY done in app code before schema move (see §6.6). This migration is a no-op SQL; the actual refactor lands in PR code. |
| 2 | `20260701000002_rename_bank_accounts_to_cash_accounts.sql` | RENAME table (constraint names + FK refs preserved via OID) |
| 3 | `20260701000003_cash_accounts_alter_nullable.sql` | DROP NOT NULL on bank_code, account_number, account_label |
| 4 | `20260701000004_cash_accounts_add_columns.sql` | ADD COLUMN account_type, account_holder, sort_order, show_in_invoice, opening_balance, opening_balance_date, provider, tenant_id, updated_at + rename account_label → internal_label + trigger |
| 5 | `20260701000005_cash_accounts_check_constraints.sql` | DROP old CHECK + ADD type-aware CHECK constraints |
| 6 | `20260701000006_cash_accounts_indexes.sql` | All indexes |
| 7 | `20260701000007_cash_movements_table.sql` | CREATE TABLE + enum types + indexes + RLS + Realtime publication |
| 8 | `20260701000008_cash_account_balances_view.sql` | CREATE VIEW |
| 9 | `20260701000009_migrate_store_bank_accounts.sql` | INSERT cash_accounts rows from store_bank_accounts (dedup by account_number; preserve account_holder, sort_order, is_active) |
| 10 | `20260701000010_drop_store_bank_accounts_table.sql` | DROP TABLE store_bank_accounts (consumer code sudah di-refactor di migration #1) — atomic with CREATE VIEW shim untuk backward-compat read-only |
| 11 | `20260701000011_seed_default_kas_toko.sql` | INSERT 1 row account_type=KAS, internal_label='Kas Toko' jika belum ada |
| 12 | `20260701000012_create_record_piutang_payment_rpc.sql` | NEW RPC untuk pelunasan piutang (replace direct UPDATE di markTempoInvoicePaid) |
| 13 | `20260701000013_create_wrap_cash_deposit_batch_rpc.sql` | NEW RPC untuk wrap `cash_deposit_batches` DEPOSITED transition (currently direct UPDATE) |
| 14 | `20260701000014_modify_record_kasir_sale_variants.sql` | Modify 3 record_kasir_sale variants to accept p_bank_account_id + INSERT cash_movements |
| 15 | `20260701000015_modify_record_pembayaran.sql` | Modify record_pembayaran to accept p_bank_account_id + INSERT cash_movements OUT |
| 16 | `20260701000016_backfill_cash_movements.sql` | One-shot backfill (batched LIMIT 10k per loop) dari kasir_transactions + pembayaran + tempo payments + cash_deposit_batches DEPOSITED |

### 6.1 Backfill batching strategy (migration #16)

Long-running INSERTs bisa lock table + risk OOM. Pakai PL/pgSQL loop dengan LIMIT batch:

```sql
DO $$
DECLARE
  v_default_bank_id uuid;
  v_kas_toko_id uuid;
  v_batch_size int := 10000;
  v_inserted int;
BEGIN
  SELECT id INTO v_default_bank_id FROM cash_accounts
    WHERE account_type='BANK' AND purpose='OPERATIONAL' AND is_active=true
    ORDER BY sort_order LIMIT 1;

  SELECT id INTO v_kas_toko_id FROM cash_accounts
    WHERE account_type='KAS' AND internal_label='Kas Toko' LIMIT 1;

  -- Backfill kasir cash sales → Kas Toko (batched)
  LOOP
    INSERT INTO public.cash_movements (account_id, direction, amount, occurred_at, source_type, source_ref_table, source_ref_id, category, description)
    SELECT
      v_kas_toko_id, 'IN', kt.subtotal, kt.created_at,
      'BACKFILL', 'kasir_transactions', kt.id,
      'KASIR_SALE_CASH',
      'Penjualan kasir cash #' || COALESCE(kt.invoice_number, kt.id::text)
    FROM public.kasir_transactions kt
    WHERE kt.type='income'
      AND kt.payment_method='cash'
      AND kt.created_at >= '2025-06-01'
      AND NOT EXISTS (
        SELECT 1 FROM cash_movements cm
        WHERE cm.source_type='BACKFILL'
          AND cm.source_ref_table='kasir_transactions'
          AND cm.source_ref_id=kt.id
          AND cm.direction='IN'
      )
    LIMIT v_batch_size;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    EXIT WHEN v_inserted = 0;
    COMMIT;  -- release locks between batches
    RAISE NOTICE 'Backfilled % kasir cash rows', v_inserted;
  END LOOP;

  -- Same pattern for: kasir non-cash → default_bank
  -- Same for: pembayaran (pembelian payment) → default_bank OUT
  -- Same for: orders (tempo paid) → default_bank IN
  -- Same for: cash_deposit_batches DEPOSITED → pair (Kas Toko OUT + default_bank IN)
END $$;
```

**Verification post-backfill:**
```sql
-- Compare sums
SELECT
  (SELECT SUM(amount) FROM cash_movements WHERE source_type='BACKFILL' AND source_ref_table='kasir_transactions') AS bf_kasir,
  (SELECT SUM(subtotal) FROM kasir_transactions WHERE type='income' AND created_at >= '2025-06-01') AS src_kasir;
-- Should match within rounding tolerance
```

Log discrepancies for owner review post-migration.

### 6.2 Consumer refactor sequence (issue #6 fix)

`store_bank_accounts` consumers harus di-refactor SEBELUM tabel di-drop. Order:

**Step 1 (kode app, PRE-migration):** edit consumer code to import dari `cash_accounts` (saat migration belum jalan, `cash_accounts` belum ada — pakai compatibility module yang detect schema state dan switch reads).

Actually simpler approach: **migration #9 INSERT data dulu**, **migration #10 keep table sebagai read-only view yang SELECT from cash_accounts**. Kode app tetap referensi `store_bank_accounts` baca dari view. Saat semua consumer di-refactor (tracked sebagai TODO post-Phase 1a), baru drop view.

Revised plan:
- Migration #9: INSERT data ke cash_accounts (dedup) — store_bank_accounts tetap exist
- Migration #10: DROP TABLE store_bank_accounts → CREATE VIEW store_bank_accounts AS SELECT ... FROM cash_accounts WHERE account_type='BANK' AND show_in_invoice=true
- **All writes via app to store_bank_accounts dropped sebelum migration #10 ship** — app code refactor di PR yang sama, hapus `createBankAccount`/`updateBankAccount`/`deleteBankAccount` di `pengaturan/mutations.ts`, replace dengan `createCashAccount`/etc yang target `cash_accounts` directly. RekeningBankCard.tsx UI redirect ke Kas & Bank module.
- Reads dari view: tetap aman karena view writable=false default, dan all writes sudah di-redirect.

### 6.3 Consumer code refactor list

PR Phase 1a harus modify:
- `src/lib/pengaturan/queries.ts` — `fetchBankAccounts()` → query `cash_accounts WHERE account_type='BANK' AND show_in_invoice=true`
- `src/lib/pengaturan/mutations.ts` — `createBankAccount/updateBankAccount/deleteBankAccount` → redirect ke `cash_accounts` directly (atau remove dan let Kas & Bank module handle)
- `src/components/pengaturan/RekeningBankCard.tsx` — replace CRUD UI dengan banner redirect (per spec section 7.6)
- 5 Invoice PDF consumers:
  - `src/lib/sales/pdf/common.ts` (or wherever bank account block rendered)
  - `src/components/InvoiceModal.tsx`
  - `src/components/KasirInvoiceModal.tsx`
  - `src/components/pembelian/PembelianDetailPage.tsx`
  - `src/components/StockManagerScreen.tsx`
  - All swap `companySettingsService.fetch()` + `store_bank_accounts` → `cash_accounts WHERE show_in_invoice=true AND is_active=true`
- `src/types.ts` — type `BankAccount` augment atau alias to new `CashAccount` type

---

## 7. RPC changes (write-through wraps)

### 7.1 `record_kasir_sale` (3 variants — modify in place)

3 sequential variants:
- `record_kasir_sale` base (migration 20260609000001)
- `record_kasir_sale` redefined (migration 20260609000003)
- `record_kasir_sale` redefined (migration 20260610000001)

Latest variant adalah signature otoritatif. Migration #14 `CREATE OR REPLACE` ulang dengan tambahan:
- Param baru: `p_bank_account_id uuid DEFAULT NULL`
- Validation: jika `payment_method != 'cash'`, raise `'bank_account_id_required'` kalau NULL
- Logic: `v_target_account_id := COALESCE(p_bank_account_id, (SELECT id FROM cash_accounts WHERE account_type='KAS' AND internal_label='Kas Toko' LIMIT 1))`
- Insert cash_movements row IN dengan source_type='KASIR_SALE', source_ref='kasir_transactions', direction='IN', status='CLEARED' (Phase 1b mengubah ke PENDING untuk marketplace)

### 7.2 NEW RPC: `record_piutang_payment`

Replace TS function `markTempoInvoicePaid`. Atomic operation:

```sql
CREATE OR REPLACE FUNCTION public.record_piutang_payment(
  p_order_id uuid,
  p_bank_account_id uuid,
  p_proof_url text DEFAULT NULL,
  p_verified_by uuid DEFAULT NULL  -- caller's admin_user id (legacy compat)
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_movement_id uuid;
BEGIN
  -- Lock order row
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.status <> 'INVOICE_TEMPO' THEN RAISE EXCEPTION 'order_not_open_tempo: status=%', v_order.status; END IF;

  -- Validate bank account exists + active + BANK or KAS
  IF NOT EXISTS (SELECT 1 FROM cash_accounts WHERE id=p_bank_account_id AND is_active=true AND account_type IN ('BANK','KAS')) THEN
    RAISE EXCEPTION 'bank_account_invalid';
  END IF;

  -- Update order
  UPDATE public.orders
    SET status='PAYMENT_VERIFIED',
        payment_verified_at=now(),
        verified_by=p_verified_by,
        full_proof_url=COALESCE(p_proof_url, full_proof_url)
    WHERE id=p_order_id;

  -- Insert cash_movement IN
  INSERT INTO public.cash_movements (account_id, direction, amount, occurred_at, source_type, source_ref_table, source_ref_id, category, description, created_by)
  VALUES (p_bank_account_id, 'IN', v_order.total, now(), 'PIUTANG_PAYMENT', 'orders', p_order_id, 'PIUTANG_PAYMENT',
          'Pelunasan piutang INV ' || COALESCE(v_order.invoice_number, p_order_id::text), auth.uid())
  RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object('ok', true, 'movement_id', v_movement_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_piutang_payment(uuid, uuid, text, uuid) TO authenticated;
```

Client: `src/lib/piutangService.ts:markTempoInvoicePaid` di-refactor jadi panggil RPC ini, signature ditambah `bankAccountId: string`.

### 7.3 `record_pembayaran` (Pembelian Phase 2a — modify)

Migration #15 `CREATE OR REPLACE` ulang dengan:
- Field tambahan di payload jsonb: `bank_account_id uuid` (validate non-null)
- Setelah INSERT `pembayaran` row, INSERT `cash_movements` OUT dengan source_type='PEMBAYARAN', source_ref='pembayaran', source_ref_id=<inserted pembayaran.id>, amount = pembayaran.total

Frontend: `src/components/pembelian/pembayaran/PembayaranFormPage.tsx` tambah dropdown akun, include di payload.

### 7.4 NEW RPC: `confirm_cash_deposit_batch`

Wrap `cash_deposit_batches` DEPOSITED transition (currently direct UPDATE). Migration #13:

```sql
CREATE OR REPLACE FUNCTION public.confirm_cash_deposit_batch(
  p_batch_id uuid,
  p_target_bank_account_id uuid,
  p_deposit_date date,
  p_deposited_amount numeric
) RETURNS jsonb
SECURITY DEFINER ...
AS $$
DECLARE
  v_kas_toko_id uuid;
  v_batch cash_deposit_batches;
BEGIN
  SELECT * INTO v_batch FROM cash_deposit_batches WHERE id=p_batch_id FOR UPDATE;
  IF v_batch.status='DEPOSITED' THEN RAISE EXCEPTION 'already_deposited'; END IF;

  SELECT id INTO v_kas_toko_id FROM cash_accounts WHERE account_type='KAS' AND internal_label='Kas Toko' LIMIT 1;

  UPDATE cash_deposit_batches SET
    status='DEPOSITED',
    deposit_date=p_deposit_date,
    deposited_amount=p_deposited_amount
    WHERE id=p_batch_id;

  -- Pair cash_movements: OUT Kas Toko, IN target bank
  INSERT INTO cash_movements (account_id, direction, amount, occurred_at, source_type, source_ref_table, source_ref_id, category, description)
  VALUES
    (v_kas_toko_id, 'OUT', p_deposited_amount, p_deposit_date, 'CASH_DEPOSIT_BATCH', 'cash_deposit_batches', p_batch_id, 'KASIR_BATCH', 'Setor kasir batch'),
    (p_target_bank_account_id, 'IN', p_deposited_amount, p_deposit_date, 'CASH_DEPOSIT_BATCH', 'cash_deposit_batches', p_batch_id, 'KASIR_BATCH', 'Setor kasir batch');

  RETURN jsonb_build_object('ok', true);
END;
$$;
```

Existing UI yang flip status: replace direct UPDATE → call RPC ini.

---

## 8. UI components

### 8.1 `src/components/kasbank/KasBankScreen.tsx` — halaman utama

(unchanged from rev1)

### 8.2 `src/components/kasbank/AccountDetailScreen.tsx`

(unchanged from rev1)

### 8.3 `src/components/kasbank/AccountFormModal.tsx`

(unchanged from rev1)

### 8.4 Picker integration — 3 modal modified

- `src/components/PenjualanBaruScreen.tsx` — tambah dropdown "Masuk ke akun" (visible kalau payment_method != cash)
- `src/components/pembelian/pembayaran/PembayaranFormPage.tsx` — tambah dropdown "Bayar dari akun"
- `src/components/piutang/CatatBayarModal.tsx` — tambah dropdown "Masuk ke akun"

State default: `localStorage.getItem('lastBankAccountId')`. Validate: ID exists + is_active + BANK type.

### 8.5 Sidebar + routing

Modify `src/components/Sidebar.tsx`: tambah entry "Kas & Bank" di group Keuangan, icon `account_balance_wallet`.
`src/App.tsx`: `case 'kasBank'` → `<KasBankScreen />`.
`src/lib/urlRoute.ts`: tambah `'kasBank'` ke `ActivePage` union.

### 8.6 Pengaturan refactor

Modify `src/components/pengaturan/RekeningBankCard.tsx`:
- Hapus form create/edit/delete UI
- Tampilkan banner: "Manajemen rekening bank dipindah ke menu **Kas & Bank**" + tombol "→ Buka Kas & Bank"
- List read-only akun BANK yang `show_in_invoice=true` untuk preview (data dari `cash_accounts` via view shim atau direct query)

### 8.7 Realtime subscription (clarified)

```tsx
// src/hooks/useCashAccountBalances.ts
function useCashAccountBalances() {
  const [balances, setBalances] = useState<AccountBalance[]>([]);

  useEffect(() => {
    // Initial fetch
    fetchBalances().then(setBalances);

    // Subscribe to cash_movements changes (any row → re-fetch all)
    const channel = supabase.channel('cash_movements_global')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cash_movements' },
          () => fetchBalances().then(setBalances))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return balances;
}
```

Debounce 200ms untuk avoid flicker dari burst inserts.

---

## 9. Permission model

Reuse existing `PermissionSet`:
- New permission flag: `canManageCashAccounts?: boolean` (default true di `ALL_PERMISSIONS`)
- "+ Tambah Akun", "Edit", "Toggle Active" gated by this flag (Owner-only di founder context)
- View saldo + riwayat: any authenticated user

---

## 10. Edge cases

| Case | Handling |
|---|---|
| Akun di-set `is_active=false`, ada cash_movement masuk | RPC tetap allow insert. UI hide akun dari list utama. Riwayat tetap accessible via direct URL. |
| Negative balance (sale dibatalkan, refund OUT > IN) | Allowed in Phase 1a (no constraint). UI tampilkan saldo merah. Phase 2 Penyesuaian bisa correct. |
| Akun di-delete | RESTRICT ON DELETE — gagal kalau ada cash_movements ref. Owner harus toggle is_active=false saja. |
| `opening_balance` salah input | Editable di AccountFormModal sampai akun first-used (no cash_movement yet). Setelah ada movement, opening_balance read-only — owner pakai Penyesuaian Phase 2. |
| Race condition: 2 user input kasir sale concurrent ke akun yang sama | UNIQUE constraint mencegah duplicate via source_ref. Saldo computed real-time dari view → eventually consistent (~200ms). |
| Backfill running saat user buka aplikasi | Migration runs offline (psql script via `apply-pending-migrations.sh`). User session refreshed setelah deploy. |
| Akun belum di-pilih saat record_kasir_sale non-cash | RPC raise `bank_account_id_required` error. UI catch error, show toast "Pilih akun bank dulu". |
| `record_piutang_payment` panggil saat akun pribadi dipilih | RPC validate akun type BANK atau KAS — Pribadi (purpose=OWNER_PERSONAL) tetap OK karena type=BANK. Acceptable: owner kadang terima pelunasan via rek pribadi (logged untuk audit). |
| Kas Toko default tidak ada (seed migration belum jalan) | RPC raise NULL dereference; migration order MUST seed Kas Toko before any RPC modification ships |

---

## 11. Testing strategy

**Unit (vitest):**
- `cash_accounts` form validation (account_type-conditional fields)
- Picker dropdown filtering (active + correct type)
- Balance view computation (sample data → expected output)
- `useCashAccountBalances` hook subscription cleanup

**Integration (vitest + Supabase):**
- Migration smoke: RENAME preserves FK, ADD COLUMNS, CHECK constraints enforce type-validity
- RPC `record_kasir_sale` insert cash_movement IN (3 variants)
- RPC `record_piutang_payment` insert cash_movement IN + UPDATE orders (atomic)
- RPC `record_pembayaran` insert cash_movement OUT
- RPC `confirm_cash_deposit_batch` insert pair OUT+IN
- Backfill idempotency (re-run migration → no duplicates via UNIQUE)
- Backfill batching: sum cash_movements matches source within tolerance

**E2E (Chrome MCP smoke):**
- Owner login → open Kas & Bank → see seeded accounts + balances
- Create new BANK account → appears in list
- Create new E_WALLET account → no bank_code field, provider visible
- Detail account → riwayat shows backfilled rows
- Submit kasir sale transfer with picker → balance increments real-time
- Pelunasan piutang with picker → balance updates
- Bayar pembelian with picker → balance decrements

---

## 12. Risk + mitigation

| Risk | Mitigation |
|---|---|
| Backfill amount mismatch (lost rows / RPC variant divergence) | Dry-run di staging Supabase project; compare `SUM(cash_movements)` vs source per source_type; log discrepancies for owner review |
| Migration RENAME breaks Recon module FK | RENAME preserves OID; smoke test Rekonsiliasi screen post-migration; verify via `pg_class.oid` pre/post |
| Consumer code masih reference `store_bank_accounts` setelah view shim | Grep PR for `from('store_bank_accounts')` + `INSERT INTO store_bank_accounts` references; CI fails if any remain |
| Backfill timeout (>10 min single transaction) | Batched LIMIT 10000 dengan COMMIT antara batches (see §6.1) |
| `verify_owner_pin` shared lockout dengan approval flow saat Penyesuaian Phase 2 | Defer ke Phase 2 — Phase 1a tidak gunakan PIN |
| Multi-tenant migration nanti — `tenant_id` NULL backfill | Column sudah ada (default NULL). Saat multi-tenant ship: 1 UPDATE per tenant + populate, then add NOT NULL constraint + RLS policy. |
| `cash_movements` table grows fast (>1M rows/yr) | Partitioning by `occurred_at` monthly di Phase 4. Phase 1a: indexed queries cover 1 tenant. |
| Soak break Invoice PDF rendering | Run vitest covering all 5 PDF consumers post-migration; rollback view shim if any breaks |
| Realtime subscription overload (10+ concurrent kasir sales) | Debounce 200ms; cap subscription per-user; monitor Supabase Realtime usage |

---

## 13. Open questions for user (updated)

**O1. Default akun untuk backfill non-cash transactions.**
- (a) Default ke BCA Operasional (purpose=OPERATIONAL pertama by sort_order), owner correct via Penyesuaian Phase 2
- (b) Tanyakan owner per channel pas onboarding modul
- (c) Tidak backfill akun BANK transactions, owner mulai dari hari modul ship

**O2. Per-channel default account.**
- (a) Phase 1a: no, owner pilih manual setiap input (default = last used)
- (b) Phase 1a: yes, tambah `default_bank_account_id` di `sales_channel_settings`
- (c) Phase 1a no, Phase 1b yes (bareng settlement timing config per channel)

**O3. Realtime saldo update strategy.**
- (a) Realtime subscription via Supabase channel (current spec)
- (b) Polling 30s (simpler, acceptable untuk MSME)
- (c) Hybrid: realtime untuk halaman utama, polling untuk detail

**O4. Akun pribadi inisial.**
- (a) Owner buat manual (no seed)
- (b) Auto-seed dengan placeholder "Pribadi Owner" type=BANK, owner edit kemudian

**O5. `cash_deposit_batches` target_bank_account_id field.** Saat ini tabel `cash_deposit_batches` tidak punya field target bank. RPC baru `confirm_cash_deposit_batch` minta param. Apakah Phase 1a:
- (a) Tambah field `target_bank_account_id` ke `cash_deposit_batches` schema (migration tambahan)
- (b) Pass param via RPC saja, tidak persist (current UI passes saat klik Confirm)
- (c) Drop cash_deposit_batches entirely, replace dengan Phase 2 Setor Kas manual

**O6. `show_in_invoice` default untuk migrasi data.**
- (a) Default true (preserve existing behavior — semua akun BANK yang ada di store/recon visible di invoice)
- (b) Default false, owner re-enable per akun (defensif, owner audit dulu)
- (c) Conditional: from store_bank_accounts = true; from recon bank_accounts dengan purpose=OPERATIONAL = true; OWNER_PERSONAL/SAVINGS = false

**O7. tenant_id readiness (NEW in rev2).** Kolom `tenant_id uuid NULL` sudah saya tambah di Phase 1a sebagai future-proof multi-tenant. Apakah:
- (a) OK as-is (NULL=global, populated saat multi-tenant Phase 1 ship)
- (b) Skip Phase 1a, tambah nanti via migration tambahan saat multi-tenant
- (c) Tambah sekarang + populate dengan tenant_id Garindo default (define Garindo tenant_id sekarang)

**O8. Consumer refactor sequencing (NEW in rev2).** `store_bank_accounts` tabel di-drop dan diganti VIEW shim setelah consumer code di-refactor. Sequencing:
- (a) Refactor consumer dulu (PR pre-migration), baru drop tabel (migration #10 di same PR)
- (b) Drop tabel + ship VIEW shim (read-only), consumer code refactor di PR follow-up minggu setelah
- (c) Dual-write: maintain both tabel + view simultaneously selama 1 minggu soak, drop physical tabel after

---

## 14. Estimate breakdown (rev2: 7-10 hari)

| Komponen | Estimasi |
|---|---|
| Migrations + backfill script + verification | 1.5-2 hari (rev2: tambah batching + tenant_id) |
| Consumer code refactor (5 Invoice PDF consumers + Pengaturan mutations) | 1 hari (rev2: NEW item — sebelumnya undercounted) |
| RPC wraps: 3 record_kasir_sale variants + record_piutang_payment NEW + record_pembayaran + confirm_cash_deposit_batch | 1.5 hari (rev2: tambah record_piutang_payment) |
| Frontend KasBankScreen + AccountDetail + realtime subscription | 1.5-2 hari |
| AccountFormModal (CRUD akun) | 0.5-1 hari |
| Picker integration (3 modal) | 1-1.5 hari |
| Sidebar + routing + Pengaturan redirect | 0.5 hari |
| E2E smoke + bug fixes + soak monitoring | 1 hari |

**Total: 7-10 hari** (rev2 upper bound +1 hari karena consumer refactor + RPC baru).

---

## 15. Revision history

- **rev1 (2026-06-20 morning):** Initial draft
- **rev2 (2026-06-20 afternoon):** Self-review catched 7 critical/important issues:
  - DROP NOT NULL pada bank_code + account_number sebelum CHECK update
  - `markTempoInvoicePaid` itu TS function bukan RPC → buat `record_piutang_payment` RPC baru
  - Verified `kasir_transactions.id` = UUID (assumption confirmed)
  - Constraint name preservation after RENAME documented explicitly
  - Backfill batched via PL/pgSQL loop dengan COMMIT antar batch
  - `store_bank_accounts` consumer refactor sequencing eksplisit (option a recommended)
  - `tenant_id` column tambah sekarang sebagai future-proof
  - Factual corrections: `cash_deposit_batches` (bukan cash_batches), `record_pembayaran` Phase 2a (bukan mark_pi_paid legacy)
  - 2 OQ baru (O7 tenant_id, O8 consumer refactor sequencing)
  - Estimate naik dari 7-9 → 7-10 hari karena consumer refactor + new RPC scope
