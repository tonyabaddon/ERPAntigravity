# Diskon Manual Per-Transaksi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah fitur diskon manual (line + order level, % atau Rp) di Kasir, Penjualan wizard, dan Pembelian Tagihan PI; configurable via 3 toggle di Pengaturan; akuntansi auto-journal ke akun kontra; backward-compatible.

**Architecture:** Denormalize 3-kolom triple (`discount_type`, `discount_value`, `discount_amount_rp`) di tabel parent + tabel/JSONB item. Sales lines pakai JSONB (asimetri diterima). 2 entry paths (Path A = input eksplisit, Path B = edit Harga di Kasir/Wizard/Tagihan) konvergen ke representasi data sama; backend recompute server-side. Akuntansi via `_post_journal_entry` (Phase 0b/0c dual-write pattern) tambah baris kontra (4-1900 sales, 5-1900 purchase). Frontend: shared primitives di `src/components/ui/discount/`.

**Tech Stack:** Supabase Postgres + RPCs (SECURITY DEFINER, plpgsql), React 19 + TypeScript, Tailwind, Vitest, jsPDF.

## Global Constraints

- Slot migration: `20260801xxxxxx` series (jaga jarak dari Akuntansi Phase 0b/0c yang sudah landed s/d `20260724xxxxxx`).
- Founder memory yang HARUS dipertahankan:
  - `feedback_no_approval_workflow.md` — tanpa PIN gate.
  - `feedback_allow_negative_stock_preorder.md` — stock check tetap relax di Kasir.
  - `feedback_no_adhoc_customers.md` — customer flow tidak berubah.
  - `feedback_check_constraints_before_rpc_rewrite.md` — enumerate semua CHECK di tabel target sebelum patch RPC.
  - `feedback_font_sizing.md` — baris Diskon di PDF 11-12px.
  - `reference_smoke_test_security_definer_rpcs.md` — pattern smoke test (fake auth.uid + RAISE EXCEPTION rollback).
- Markup (typed > master): **reject** dengan `MARKUP_NOT_ALLOWED`. Tanpa cap %, tanpa field alasan.
- Triple-check constraint pattern di semua tabel impacted: `(type IS NULL AND value IS NULL AND amount_rp = 0)` OR `(type IS NOT NULL AND value IS NOT NULL AND amount_rp >= 0)`.
- Backward-compat: existing rows tanpa diskon → triple all NULL/0, validate passes. Existing JSONB items tanpa fields → frontend & view COALESCE.
- Spec ref: `docs/superpowers/specs/2026-06-23-diskon-design.md`.
- Mockup ref: `docs/superpowers/mockups/2026-06-23-diskon-feature.html`.
- Update `progress.md` setelah tiap task selesai (per project CLAUDE.md).

---

## File Structure

### New files
- `supabase/migrations/20260801000001_diskon_schema.sql` — ALTER 4 tables + triple-CHECK constraints.
- `supabase/migrations/20260801000002_diskon_pembelian_coa_seed.sql` — INSERT akun 5-1900.
- `supabase/migrations/20260801000003_tenant_settings_diskon_toggles.sql` — 3 boolean cols + extend `set_tenant_modul` whitelist.
- `supabase/migrations/20260801000004_record_kasir_sale_with_discount.sql` — RPC patch (signature + validation + journaling).
- `supabase/migrations/20260801000005_create_tempo_invoice_with_discount.sql` — RPC patch.
- `supabase/migrations/20260801000006_record_pi_with_discount.sql` — RPC patch.
- `supabase/migrations/20260801000007_pengawasan_kasir_discount_view_v2.sql` — view rewrite.
- `src/components/ui/discount/computeDiscountAmount.ts` — pure resolve function.
- `src/components/ui/discount/computeDiscountAmount.test.ts` — Vitest.
- `src/components/ui/discount/useDiscountBinding.ts` — bidirectional sync hook.
- `src/components/ui/discount/useDiscountBinding.test.ts` — Vitest.
- `src/components/ui/discount/DiscountInlineInput.tsx` — line-level input.
- `src/components/ui/discount/DiscountInlineInput.test.tsx` — Vitest + RTL.
- `src/components/ui/discount/DiscountRow.tsx` — order-level row.
- `src/components/ui/discount/DiscountRow.test.tsx` — Vitest + RTL.
- `src/components/ui/discount/index.ts` — barrel.

### Modified files
- `src/types.ts` — `DiscountType`, `DiscountTriple`, `ModulSwitchKey` extension, `DbTenantSettings` 3 new fields.
- `src/components/pengaturan/ModulSwitchesPanel.tsx` — append 3 entries to `MODULS`.
- `src/components/KasirScreen.tsx` — wire DiscountInlineInput + DiscountRow + toggle gate.
- `src/components/penjualan/CartRows.tsx` — line discount column + master price label.
- `src/components/penjualan/wizard/Step2Items.tsx` — pass discount handlers.
- `src/components/penjualan/wizard/Step3Payment.tsx` — DiscountRow for order discount.
- `src/components/penjualan/SalesInvoicePDF.tsx` — Diskon row in PDF.
- `src/components/KasirInvoiceModal.tsx` — Diskon row in receipt.
- `src/components/pembelian/tagihan/TagihanFormPage.tsx` — line + order discount UI.
- `src/components/pembelian/tagihan/TagihanDetailPage.tsx` — show discount in detail.
- `src/lib/supabaseClient.ts` — `recordKasirSale` signature extension.
- `src/lib/piutangService.ts` — `createTempoInvoice` payload extension.
- `progress.md` — log per-task completion.

---

## Task Index

1. Migration: Schema (ALTER 4 tables + triple-CHECK)
2. Migration: COA seed 5-1900 Diskon Pembelian
3. Migration: tenant_settings 3 toggles + whitelist extension
4. Frontend types extension
5. Pure function `computeDiscountAmount` + tests
6. Hook `useDiscountBinding` + tests
7. Component `<DiscountInlineInput>` + tests
8. Component `<DiscountRow>` + tests + barrel index
9. Pengaturan UI: ModulSwitchesPanel 3 toggle baru
10. RPC patch `record_kasir_sale` + smoke matrix
11. RPC patch `create_tempo_invoice` + smoke matrix
12. RPC patch `record_pi` + smoke matrix
13. Pengawasan view rewrite + regression smoke
14. Kasir UI: cart line discount + total bar + struk PDF
15. Wizard UI: Step 2 (line) + Step 3 (order) + invoice PDF
16. Tagihan PI UI: form + detail
17. Integration E2E + final regression sweep

---

### Task 1: Migration — Schema (ALTER 4 tables + triple-CHECK)

**Files:**
- Create: `supabase/migrations/20260801000001_diskon_schema.sql`

**Interfaces:**
- Consumes: existing tables `orders`, `kasir_transactions`, `purchase_invoices`, `purchase_invoice_items`.
- Produces: 4 tables masing-masing punya kolom `discount_type TEXT NULL`, `discount_value NUMERIC NULL`, `discount_amount_rp NUMERIC NOT NULL DEFAULT 0`. `purchase_invoice_items` extra: `master_unit_cost NUMERIC NOT NULL DEFAULT 0`. Setiap tabel punya `<table>_discount_triple_chk` CHECK constraint.

- [ ] **Step 1: Enumerate existing CHECK constraints on the 4 tables**

Run via MCP `execute_sql`:
```sql
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('public.orders'::regclass, 'public.kasir_transactions'::regclass,
                   'public.purchase_invoices'::regclass, 'public.purchase_invoice_items'::regclass)
  AND contype = 'c';
```
Expected: list of existing CHECK constraints. Note any that might conflict with adding NULL discount columns (e.g., `total >= 0`, `subtotal >= 0`). Confirm none reference future-required column names. Per `feedback_check_constraints_before_rpc_rewrite.md`.

- [ ] **Step 2: Write the migration file**

```sql
-- 20260801000001 — Diskon schema: 4 tables, triple kolom + triple-CHECK
--
-- Pattern: setiap tabel impacted dapat 3 kolom (discount_type, discount_value, discount_amount_rp)
-- + table-level CHECK menjaga konsistensi. purchase_invoice_items dapat tambahan
-- master_unit_cost snapshot (sales lines snapshot di JSONB, lihat shape di spec §4.3).

BEGIN;

-- ─── orders (order-level) ──────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN discount_type      TEXT    NULL,
  ADD COLUMN discount_value     NUMERIC NULL,
  ADD COLUMN discount_amount_rp NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_discount_type_chk
    CHECK (discount_type IS NULL OR discount_type IN ('PERCENT','AMOUNT')),
  ADD CONSTRAINT orders_discount_value_chk
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD CONSTRAINT orders_discount_amount_chk
    CHECK (discount_amount_rp >= 0),
  ADD CONSTRAINT orders_discount_triple_chk
    CHECK (
      (discount_type IS NULL AND discount_value IS NULL AND discount_amount_rp = 0)
      OR
      (discount_type IS NOT NULL AND discount_value IS NOT NULL)
    );

-- ─── kasir_transactions (order-level) ──────────────────────────────────
ALTER TABLE public.kasir_transactions
  ADD COLUMN discount_type      TEXT    NULL,
  ADD COLUMN discount_value     NUMERIC NULL,
  ADD COLUMN discount_amount_rp NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.kasir_transactions
  ADD CONSTRAINT kasir_transactions_discount_type_chk
    CHECK (discount_type IS NULL OR discount_type IN ('PERCENT','AMOUNT')),
  ADD CONSTRAINT kasir_transactions_discount_value_chk
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD CONSTRAINT kasir_transactions_discount_amount_chk
    CHECK (discount_amount_rp >= 0),
  ADD CONSTRAINT kasir_transactions_discount_triple_chk
    CHECK (
      (discount_type IS NULL AND discount_value IS NULL AND discount_amount_rp = 0)
      OR
      (discount_type IS NOT NULL AND discount_value IS NOT NULL)
    );

-- ─── purchase_invoices (order-level) ───────────────────────────────────
ALTER TABLE public.purchase_invoices
  ADD COLUMN discount_type      TEXT    NULL,
  ADD COLUMN discount_value     NUMERIC NULL,
  ADD COLUMN discount_amount_rp NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT pi_discount_type_chk
    CHECK (discount_type IS NULL OR discount_type IN ('PERCENT','AMOUNT')),
  ADD CONSTRAINT pi_discount_value_chk
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD CONSTRAINT pi_discount_amount_chk
    CHECK (discount_amount_rp >= 0),
  ADD CONSTRAINT pi_discount_triple_chk
    CHECK (
      (discount_type IS NULL AND discount_value IS NULL AND discount_amount_rp = 0)
      OR
      (discount_type IS NOT NULL AND discount_value IS NOT NULL)
    );

-- ─── purchase_invoice_items (line-level + master snapshot) ─────────────
ALTER TABLE public.purchase_invoice_items
  ADD COLUMN discount_type      TEXT    NULL,
  ADD COLUMN discount_value     NUMERIC NULL,
  ADD COLUMN discount_amount_rp NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN master_unit_cost   NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_invoice_items
  ADD CONSTRAINT pi_items_discount_type_chk
    CHECK (discount_type IS NULL OR discount_type IN ('PERCENT','AMOUNT')),
  ADD CONSTRAINT pi_items_discount_value_chk
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD CONSTRAINT pi_items_discount_amount_chk
    CHECK (discount_amount_rp >= 0),
  ADD CONSTRAINT pi_items_discount_triple_chk
    CHECK (
      (discount_type IS NULL AND discount_value IS NULL AND discount_amount_rp = 0)
      OR
      (discount_type IS NOT NULL AND discount_value IS NOT NULL)
    ),
  ADD CONSTRAINT pi_items_master_unit_cost_chk
    CHECK (master_unit_cost >= 0);

-- Backfill master_unit_cost from unit_cost for existing rows
UPDATE public.purchase_invoice_items SET master_unit_cost = unit_cost WHERE master_unit_cost = 0;

COMMIT;
```

- [ ] **Step 3: Apply migration via MCP**

Run via `mcp__plugin_supabase_supabase__apply_migration`:
- name: `20260801000001_diskon_schema`
- query: contents of the file above.

Expected: no error. If error mentions constraint conflict, investigate `Step 1` output.

- [ ] **Step 4: Verify columns exist + smoke insert**

```sql
-- Verify columns exist
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('orders','kasir_transactions','purchase_invoices','purchase_invoice_items')
  AND column_name LIKE 'discount_%' OR column_name = 'master_unit_cost'
ORDER BY table_name, column_name;
```
Expected: 12 + 1 = 13 rows.

- [ ] **Step 5: Verify existing rows still pass (no backfill required)**

```sql
SELECT 'orders' AS t, COUNT(*) AS rows_total,
       COUNT(*) FILTER (WHERE discount_amount_rp = 0 AND discount_type IS NULL) AS rows_clean
FROM public.orders
UNION ALL
SELECT 'kasir_transactions', COUNT(*), COUNT(*) FILTER (WHERE discount_amount_rp = 0 AND discount_type IS NULL) FROM public.kasir_transactions
UNION ALL
SELECT 'purchase_invoices', COUNT(*), COUNT(*) FILTER (WHERE discount_amount_rp = 0 AND discount_type IS NULL) FROM public.purchase_invoices
UNION ALL
SELECT 'purchase_invoice_items', COUNT(*), COUNT(*) FILTER (WHERE discount_amount_rp = 0 AND discount_type IS NULL) FROM public.purchase_invoice_items;
```
Expected: `rows_total == rows_clean` di tiap tabel (semua existing rows defaulted).

- [ ] **Step 6: Commit + update progress.md**

```bash
git add supabase/migrations/20260801000001_diskon_schema.sql progress.md
git commit -m "feat(diskon): Task 1 — schema migration (4 tables triple + master_unit_cost)"
```

Add a one-line entry to `progress.md` under the latest day's section: `- ✅ Diskon Task 1: schema migration applied (4 tables, 13 cols + triple-CHECKs).`

---

### Task 2: Migration — COA seed `5-1900 Diskon Pembelian`

**Files:**
- Create: `supabase/migrations/20260801000002_diskon_pembelian_coa_seed.sql`

**Interfaces:**
- Consumes: existing `public.chart_of_accounts` table seeded by `20260715000002_chart_of_accounts_seed.sql`.
- Produces: 1 new row di `chart_of_accounts` dengan code `5-1900`, name `Diskon Pembelian`, kategori KONTRA, normal credit.

- [ ] **Step 1: Inspect existing COA insert pattern (4-1900 row)**

```sql
SELECT code, name, category, sub_category, normal_balance, is_parent, is_active
FROM public.chart_of_accounts
WHERE code IN ('4-1900','5-1000','5-1100','5-1900');
```
Expected: see existing 4-1900 row + adjacent expense parent rows. Confirm 5-1900 does NOT exist yet.

- [ ] **Step 2: Write the seed migration**

```sql
-- 20260801000002 — Seed COA 5-1900 Diskon Pembelian (kontra HPP, normal credit).
-- Berpasangan dengan 4-1900 Diskon Penjualan (sudah seeded). Dipakai di
-- record_pi RPC patch (Task 12) untuk journal kontra-HPP saat ada diskon
-- supplier di Tagihan PI.

BEGIN;

INSERT INTO public.chart_of_accounts
  (code, name, category, sub_category, normal_balance, is_parent, is_active)
VALUES
  ('5-1900', 'Diskon Pembelian (kontra)', 'HPP', 'KONTRA', 'CREDIT', false, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
```

NOTE: `category` and `sub_category` values mengikuti 4-1900 pattern (lihat hasil Step 1 untuk validate). Kalau hasil Step 1 menunjukkan kolom values yang beda, sesuaikan.

- [ ] **Step 3: Apply via MCP**

Run `mcp__plugin_supabase_supabase__apply_migration` dengan name `20260801000002_diskon_pembelian_coa_seed` + content above.

- [ ] **Step 4: Verify seed**

```sql
SELECT code, name, category, sub_category, normal_balance, is_active
FROM public.chart_of_accounts WHERE code = '5-1900';
```
Expected: 1 row, `name = 'Diskon Pembelian (kontra)'`, `normal_balance = 'CREDIT'`, `is_active = true`.

- [ ] **Step 5: Commit + update progress.md**

```bash
git add supabase/migrations/20260801000002_diskon_pembelian_coa_seed.sql progress.md
git commit -m "feat(diskon): Task 2 — COA seed 5-1900 Diskon Pembelian"
```

Progress.md: `- ✅ Diskon Task 2: COA 5-1900 Diskon Pembelian seeded.`

---

### Task 3: Migration — `tenant_settings` 3 toggles + whitelist extension

**Files:**
- Create: `supabase/migrations/20260801000003_tenant_settings_diskon_toggles.sql`

**Interfaces:**
- Consumes: `public.tenant_settings` table (created `20260622000003`), `public.set_tenant_modul(TEXT, BOOLEAN)` RPC (created `20260622000007`).
- Produces: 3 new boolean cols `modul_diskon_kasir`, `modul_diskon_penjualan`, `modul_diskon_tagihan` (default TRUE). `set_tenant_modul` whitelist accepts 3 new keys.

- [ ] **Step 1: Verify current set_tenant_modul whitelist**

```sql
SELECT pg_get_functiondef('public.set_tenant_modul(TEXT, BOOLEAN)'::regprocedure);
```
Confirm whitelist currently contains 7 keys (kasir, tempo, pengiriman, multi_warehouse, akuntansi, jasa_layanan, bom_recipe). Whitelist must be widened to 10.

- [ ] **Step 2: Write migration**

```sql
-- 20260801000003 — tenant_settings: 3 toggle diskon + extend set_tenant_modul whitelist.
-- Default semua TRUE supaya backward-compat (UI baru langsung visible saat deploy).

BEGIN;

ALTER TABLE public.tenant_settings
  ADD COLUMN modul_diskon_kasir     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN modul_diskon_penjualan BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN modul_diskon_tagihan   BOOLEAN NOT NULL DEFAULT TRUE;

-- Extend set_tenant_modul whitelist
CREATE OR REPLACE FUNCTION public.set_tenant_modul(
  p_key TEXT,
  p_value BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_sql  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: pengaturan modul needs an authenticated caller';
  END IF;
  SELECT role INTO v_role FROM public.admin_users WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('Owner', 'Staff Admin Toko') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: pengaturan modul requires Owner or Staff Admin Toko, got %', COALESCE(v_role, '<null>');
  END IF;

  -- Whitelist guard — prevents arbitrary column injection via p_key.
  IF p_key NOT IN (
    'modul_kasir', 'modul_tempo', 'modul_pengiriman',
    'modul_multi_warehouse', 'modul_akuntansi',
    'modul_jasa_layanan', 'modul_bom_recipe',
    'modul_diskon_kasir', 'modul_diskon_penjualan', 'modul_diskon_tagihan'
  ) THEN
    RAISE EXCEPTION 'INVALID_MODUL_KEY: %', p_key;
  END IF;

  v_sql := format(
    'UPDATE public.tenant_settings SET %I = $1, updated_at = now(), updated_by = $2 WHERE tenant_id IS NULL',
    p_key
  );
  EXECUTE v_sql USING p_value, auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.set_tenant_modul(TEXT, BOOLEAN) TO authenticated;

COMMIT;
```

- [ ] **Step 3: Apply via MCP**

Run `mcp__plugin_supabase_supabase__apply_migration` dengan name `20260801000003_tenant_settings_diskon_toggles` + content.

- [ ] **Step 4: Verify columns + default values**

```sql
SELECT modul_diskon_kasir, modul_diskon_penjualan, modul_diskon_tagihan
FROM public.tenant_settings WHERE tenant_id IS NULL;
```
Expected: `(true, true, true)`.

- [ ] **Step 5: Smoke test whitelist (fake auth + rollback)**

Pakai pattern dari `reference_smoke_test_security_definer_rpcs.md`:

```sql
DO $$
DECLARE
  v_admin_id UUID;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  PERFORM public.set_tenant_modul('modul_diskon_kasir', false);
  PERFORM public.set_tenant_modul('modul_diskon_penjualan', false);
  PERFORM public.set_tenant_modul('modul_diskon_tagihan', false);

  -- Invalid key should still reject
  BEGIN
    PERFORM public.set_tenant_modul('modul_diskon_zzz', false);
    RAISE EXCEPTION 'Should have rejected invalid key';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'INVALID_MODUL_KEY%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'rollback';
END $$;
```
Expected: exception "rollback" (everything rolled back, no side effects).

- [ ] **Step 6: Commit + update progress.md**

```bash
git add supabase/migrations/20260801000003_tenant_settings_diskon_toggles.sql progress.md
git commit -m "feat(diskon): Task 3 — tenant_settings 3 toggle + whitelist extension"
```

Progress.md: `- ✅ Diskon Task 3: tenant_settings 3 toggle diskon + set_tenant_modul whitelist.`

---

### Task 4: Frontend types extension

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: existing `ModulSwitchKey` union, `DbTenantSettings` interface.
- Produces:
  - `export type DiscountType = 'PERCENT' | 'AMOUNT' | null;`
  - `export interface DiscountTriple { discount_type: DiscountType; discount_value: number | null; discount_amount_rp: number; }`
  - `ModulSwitchKey` extended with 3 keys.
  - `DbTenantSettings` extended with 3 fields.
  - `export interface CartItemWithDiscount extends DiscountTriple { master_price_at_sale: number; }` (sales JSONB line shape used by KasirItem and wizard CartItem).

- [ ] **Step 1: Add `DiscountType`, `DiscountTriple`, `CartItemWithDiscount`**

Edit `src/types.ts`, append at end of file (before final blank line):

```ts
// ─── Diskon (2026-06-23) ────────────────────────────────────────────────
export type DiscountType = 'PERCENT' | 'AMOUNT' | null;

export interface DiscountTriple {
  discount_type: DiscountType;
  discount_value: number | null;
  discount_amount_rp: number;
}

export interface CartItemWithDiscount extends DiscountTriple {
  master_price_at_sale: number;
}
```

- [ ] **Step 2: Extend `ModulSwitchKey` union**

Find at `src/types.ts:1262`:
```ts
export type ModulSwitchKey =
  | 'modul_kasir'
  | 'modul_tempo'
  | 'modul_pengiriman'
  | 'modul_multi_warehouse'
  | 'modul_akuntansi'
  | 'modul_jasa_layanan'
  | 'modul_bom_recipe';
```

Replace with:
```ts
export type ModulSwitchKey =
  | 'modul_kasir'
  | 'modul_tempo'
  | 'modul_pengiriman'
  | 'modul_multi_warehouse'
  | 'modul_akuntansi'
  | 'modul_jasa_layanan'
  | 'modul_bom_recipe'
  | 'modul_diskon_kasir'
  | 'modul_diskon_penjualan'
  | 'modul_diskon_tagihan';
```

- [ ] **Step 3: Extend `DbTenantSettings`**

Find at `src/types.ts:1271-1297` and append 3 fields after `modul_bom_recipe`:
```ts
  modul_bom_recipe: boolean;
  modul_diskon_kasir: boolean;
  modul_diskon_penjualan: boolean;
  modul_diskon_tagihan: boolean;
  pajak_mode: PajakMode;
```

- [ ] **Step 4: Run typecheck**

```bash
npm run lint
```
Expected: zero errors. If any existing consumer iterates `ModulSwitchKey` exhaustively (e.g., `cascadeImpactSummary` in `src/lib/pengaturan/cascadeMap.ts`), the typechecker will flag missing handling.

- [ ] **Step 5: If `cascadeMap.ts` has exhaustive switch on `ModulSwitchKey`, add 3 entries returning empty/passthrough**

```bash
grep -n "modul_bom_recipe\|ModulSwitchKey" /Users/tonywei/IdeaProjects/ERPAntigravity/src/lib/pengaturan/cascadeMap.ts
```
If exhaustive, append entries for `modul_diskon_kasir`/`modul_diskon_penjualan`/`modul_diskon_tagihan` matching the no-cascade pattern (returning `{ affectedMenus: [], affectedFields: [] }` or equivalent). Re-run `npm run lint`.

- [ ] **Step 6: Commit + update progress.md**

```bash
git add src/types.ts src/lib/pengaturan/cascadeMap.ts progress.md
git commit -m "feat(diskon): Task 4 — types DiscountType/DiscountTriple + ModulSwitchKey extension"
```

Progress.md: `- ✅ Diskon Task 4: frontend types + ModulSwitchKey/DbTenantSettings extended.`

---

### Task 5: Pure function `computeDiscountAmount` + tests

**Files:**
- Create: `src/components/ui/discount/computeDiscountAmount.ts`
- Create: `src/components/ui/discount/computeDiscountAmount.test.ts`

**Interfaces:**
- Consumes: `DiscountType` from `src/types.ts`.
- Produces: `export function computeDiscountAmount(value: number | null, type: DiscountType, base: number): number` — returns total Rp off, always ≥ 0, capped at base. Pure.

- [ ] **Step 1: Write the failing tests first**

Create `src/components/ui/discount/computeDiscountAmount.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { computeDiscountAmount } from './computeDiscountAmount';

describe('computeDiscountAmount', () => {
  test('null type returns 0', () => {
    expect(computeDiscountAmount(50, null, 1000)).toBe(0);
    expect(computeDiscountAmount(null, null, 1000)).toBe(0);
  });

  test('AMOUNT returns value clamped to base', () => {
    expect(computeDiscountAmount(50000, 'AMOUNT', 100000)).toBe(50000);
    expect(computeDiscountAmount(150000, 'AMOUNT', 100000)).toBe(100000); // capped
    expect(computeDiscountAmount(0, 'AMOUNT', 100000)).toBe(0);
  });

  test('PERCENT resolves to base × value / 100, clamped', () => {
    expect(computeDiscountAmount(10, 'PERCENT', 100000)).toBe(10000);
    expect(computeDiscountAmount(5, 'PERCENT', 200000)).toBe(10000);
    expect(computeDiscountAmount(100, 'PERCENT', 50000)).toBe(50000);
    expect(computeDiscountAmount(150, 'PERCENT', 50000)).toBe(50000); // capped
  });

  test('null value treated as 0', () => {
    expect(computeDiscountAmount(null, 'PERCENT', 1000)).toBe(0);
    expect(computeDiscountAmount(null, 'AMOUNT', 1000)).toBe(0);
  });

  test('NaN and negative values guarded', () => {
    expect(computeDiscountAmount(NaN, 'AMOUNT', 1000)).toBe(0);
    expect(computeDiscountAmount(-50, 'AMOUNT', 1000)).toBe(0);
    expect(computeDiscountAmount(-10, 'PERCENT', 1000)).toBe(0);
  });

  test('base ≤ 0 returns 0', () => {
    expect(computeDiscountAmount(50, 'AMOUNT', 0)).toBe(0);
    expect(computeDiscountAmount(10, 'PERCENT', -100)).toBe(0);
  });

  test('PERCENT result is rounded to nearest Rupiah (no fractional cents)', () => {
    // Decision: round to nearest integer (NUMERIC stored, but stable display).
    // 3% of 333 = 9.99 → 10. 1% of 123 = 1.23 → 1.
    expect(computeDiscountAmount(3, 'PERCENT', 333)).toBe(10);
    expect(computeDiscountAmount(1, 'PERCENT', 123)).toBe(1); // 1.23 → 1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test src/components/ui/discount/computeDiscountAmount.test.ts
```
Expected: FAIL with "Cannot find module './computeDiscountAmount'".

- [ ] **Step 3: Implement minimal function**

Create `src/components/ui/discount/computeDiscountAmount.ts`:
```ts
import type { DiscountType } from '../../../types';

/**
 * Resolve raw discount input (value + type) to a Rupiah amount.
 *
 * - `AMOUNT`: value adalah total Rp off the line/order; capped to `base`.
 * - `PERCENT`: value adalah persen terhadap `base`; rounded to nearest Rp.
 * - `null`/`NaN`/`< 0`: treated as no discount (returns 0).
 * - `base ≤ 0`: returns 0.
 */
export function computeDiscountAmount(
  value: number | null,
  type: DiscountType,
  base: number,
): number {
  if (type === null) return 0;
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  if (!Number.isFinite(base) || base <= 0) return 0;

  let raw: number;
  if (type === 'AMOUNT') {
    raw = value;
  } else {
    raw = Math.round((base * value) / 100);
  }
  return Math.min(raw, base);
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npm test src/components/ui/discount/computeDiscountAmount.test.ts
```
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/discount/computeDiscountAmount.ts src/components/ui/discount/computeDiscountAmount.test.ts progress.md
git commit -m "feat(diskon): Task 5 — computeDiscountAmount pure function + tests"
```

Progress.md: `- ✅ Diskon Task 5: computeDiscountAmount + 7 unit tests.`

---

### Task 6: Hook `useDiscountBinding` + tests

**Files:**
- Create: `src/components/ui/discount/useDiscountBinding.ts`
- Create: `src/components/ui/discount/useDiscountBinding.test.ts`

**Interfaces:**
- Consumes: `DiscountType` + `computeDiscountAmount` from Task 5.
- Produces:
  ```ts
  export interface DiscountBindingState extends DiscountTriple {
    typed_price: number; // = master_price − (discount_amount_rp / qty), rounded
  }
  export interface DiscountBindingApi {
    state: DiscountBindingState;
    setDiscountFromInput: (value: number | null, type: DiscountType) => void;
    setTypedPrice: (typedPrice: number) => void;
    toggleType: (next: DiscountType) => void;
  }
  export function useDiscountBinding(master_price: number, qty: number, initial?: Partial<DiscountTriple>): DiscountBindingApi;
  ```

- [ ] **Step 1: Write failing tests**

Create `src/components/ui/discount/useDiscountBinding.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDiscountBinding } from './useDiscountBinding';

describe('useDiscountBinding', () => {
  test('initial state with no discount: typed_price = master, amount = 0', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    expect(result.current.state.typed_price).toBe(100000);
    expect(result.current.state.discount_amount_rp).toBe(0);
    expect(result.current.state.discount_type).toBeNull();
  });

  test('setTypedPrice 80000 (master 100000, qty 5) → discount AMOUNT 100000 (20×5)', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setTypedPrice(80000); });
    expect(result.current.state.discount_type).toBe('AMOUNT');
    expect(result.current.state.discount_value).toBe(100000);
    expect(result.current.state.discount_amount_rp).toBe(100000);
    expect(result.current.state.typed_price).toBe(80000);
  });

  test('setTypedPrice higher than master rejected (state unchanged)', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setTypedPrice(120000); });
    expect(result.current.state.typed_price).toBe(100000); // master, no change
    expect(result.current.state.discount_amount_rp).toBe(0);
  });

  test('setDiscountFromInput PERCENT 10 (master 100000, qty 5) → amount 50000, typed 90000', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setDiscountFromInput(10, 'PERCENT'); });
    expect(result.current.state.discount_amount_rp).toBe(50000);
    expect(result.current.state.discount_value).toBe(10);
    expect(result.current.state.discount_type).toBe('PERCENT');
    expect(result.current.state.typed_price).toBe(90000);
  });

  test('setDiscountFromInput AMOUNT 50000 (master 100000, qty 5) → typed 90000', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setDiscountFromInput(50000, 'AMOUNT'); });
    expect(result.current.state.discount_amount_rp).toBe(50000);
    expect(result.current.state.typed_price).toBe(90000); // 100k - (50k / 5)
  });

  test('toggleType PERCENT→AMOUNT preserves Rupiah equivalent', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setDiscountFromInput(10, 'PERCENT'); });
    expect(result.current.state.discount_amount_rp).toBe(50000);
    act(() => { result.current.toggleType('AMOUNT'); });
    expect(result.current.state.discount_type).toBe('AMOUNT');
    expect(result.current.state.discount_value).toBe(50000);
    expect(result.current.state.discount_amount_rp).toBe(50000);
  });

  test('toggleType AMOUNT→PERCENT computes equivalent %', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setDiscountFromInput(50000, 'AMOUNT'); });
    act(() => { result.current.toggleType('PERCENT'); });
    expect(result.current.state.discount_type).toBe('PERCENT');
    // 50k / (100k * 5) * 100 = 10
    expect(result.current.state.discount_value).toBe(10);
    expect(result.current.state.discount_amount_rp).toBe(50000);
  });

  test('initial DiscountTriple respected', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5, {
      discount_type: 'AMOUNT', discount_value: 30000, discount_amount_rp: 30000,
    }));
    expect(result.current.state.discount_amount_rp).toBe(30000);
    expect(result.current.state.typed_price).toBe(94000); // 100k - 6k
  });
});
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
npm test src/components/ui/discount/useDiscountBinding.test.ts
```
Expected: FAIL "Cannot find module './useDiscountBinding'".

- [ ] **Step 3: Implement the hook**

Create `src/components/ui/discount/useDiscountBinding.ts`:
```ts
import { useState, useCallback, useMemo } from 'react';
import type { DiscountType, DiscountTriple } from '../../../types';
import { computeDiscountAmount } from './computeDiscountAmount';

export interface DiscountBindingState extends DiscountTriple {
  typed_price: number;
}

export interface DiscountBindingApi {
  state: DiscountBindingState;
  setDiscountFromInput: (value: number | null, type: DiscountType) => void;
  setTypedPrice: (typedPrice: number) => void;
  toggleType: (next: DiscountType) => void;
}

function deriveTypedPrice(masterPrice: number, qty: number, amountRp: number): number {
  if (qty <= 0) return masterPrice;
  return Math.round(masterPrice - amountRp / qty);
}

export function useDiscountBinding(
  master_price: number,
  qty: number,
  initial?: Partial<DiscountTriple>,
): DiscountBindingApi {
  const base = master_price * Math.max(0, qty);

  const [triple, setTriple] = useState<DiscountTriple>(() => ({
    discount_type: initial?.discount_type ?? null,
    discount_value: initial?.discount_value ?? null,
    discount_amount_rp: initial?.discount_amount_rp ?? 0,
  }));

  const typed_price = useMemo(
    () => deriveTypedPrice(master_price, qty, triple.discount_amount_rp),
    [master_price, qty, triple.discount_amount_rp],
  );

  const setDiscountFromInput = useCallback((value: number | null, type: DiscountType) => {
    if (type === null || value == null || !Number.isFinite(value) || value <= 0) {
      setTriple({ discount_type: null, discount_value: null, discount_amount_rp: 0 });
      return;
    }
    const amount = computeDiscountAmount(value, type, base);
    setTriple({ discount_type: type, discount_value: value, discount_amount_rp: amount });
  }, [base]);

  const setTypedPrice = useCallback((typedPrice: number) => {
    if (!Number.isFinite(typedPrice) || typedPrice < 0) return;
    if (typedPrice > master_price) return; // MARKUP_NOT_ALLOWED — silent ignore
    const perUnitOff = master_price - typedPrice;
    const lineTotal = perUnitOff * qty;
    if (lineTotal === 0) {
      setTriple({ discount_type: null, discount_value: null, discount_amount_rp: 0 });
      return;
    }
    setTriple({ discount_type: 'AMOUNT', discount_value: lineTotal, discount_amount_rp: lineTotal });
  }, [master_price, qty]);

  const toggleType = useCallback((next: DiscountType) => {
    if (next === triple.discount_type) return;
    if (next === null) {
      setTriple({ discount_type: null, discount_value: null, discount_amount_rp: 0 });
      return;
    }
    const amount = triple.discount_amount_rp;
    if (amount === 0 || base <= 0) {
      setTriple({ discount_type: next, discount_value: 0, discount_amount_rp: 0 });
      return;
    }
    const newValue = next === 'AMOUNT' ? amount : Math.round((amount / base) * 100);
    setTriple({ discount_type: next, discount_value: newValue, discount_amount_rp: amount });
  }, [triple.discount_type, triple.discount_amount_rp, base]);

  return {
    state: { ...triple, typed_price },
    setDiscountFromInput,
    setTypedPrice,
    toggleType,
  };
}
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
npm test src/components/ui/discount/useDiscountBinding.test.ts
```
Expected: 8 tests PASS. If `@testing-library/react` is missing, install:
```bash
npm install -D @testing-library/react @testing-library/dom
```
(Check package.json first — if RTL absent, this is the install.)

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/discount/useDiscountBinding.ts src/components/ui/discount/useDiscountBinding.test.ts package.json package-lock.json progress.md
git commit -m "feat(diskon): Task 6 — useDiscountBinding hook + bidirectional sync tests"
```

Progress.md: `- ✅ Diskon Task 6: useDiscountBinding hook + 8 unit tests (bidirectional sync).`

---

### Task 7: Component `<DiscountInlineInput>` + tests

**Files:**
- Create: `src/components/ui/discount/DiscountInlineInput.tsx`
- Create: `src/components/ui/discount/DiscountInlineInput.test.tsx`

**Interfaces:**
- Consumes: `DiscountType`, `DiscountTriple`.
- Produces:
  ```ts
  export interface DiscountInlineInputProps {
    value: number | null;
    type: DiscountType;
    base: number;
    onChange: (value: number | null, type: DiscountType) => void;
    disabled?: boolean;
  }
  export const DiscountInlineInput: React.FC<DiscountInlineInputProps>;
  ```
  Renders a small numeric input + segmented pill toggle [Rp | %]. Calls `onChange` on either input edit or toggle click. Toggle preserves Rupiah equivalent (computed inline).

- [ ] **Step 1: Write failing test**

Create `src/components/ui/discount/DiscountInlineInput.test.tsx`:
```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiscountInlineInput } from './DiscountInlineInput';

describe('DiscountInlineInput', () => {
  test('renders both Rp and % segments; null state has neither active', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={null} type={null} base={1000} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Rp' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '%' })).toBeTruthy();
  });

  test('clicking Rp when no type selected sets type to AMOUNT with current value (or 0)', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={null} type={null} base={1000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rp' }));
    expect(onChange).toHaveBeenCalledWith(0, 'AMOUNT');
  });

  test('typing into input emits onChange with current type (defaults AMOUNT if null)', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={null} type={null} base={1000} onChange={onChange} />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });
    expect(onChange).toHaveBeenCalledWith(50, 'AMOUNT');
  });

  test('toggle PERCENT→AMOUNT preserves Rp equivalent', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={10} type="PERCENT" base={1000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rp' }));
    // 10% of 1000 = 100. AMOUNT value should be 100.
    expect(onChange).toHaveBeenCalledWith(100, 'AMOUNT');
  });

  test('toggle AMOUNT→PERCENT preserves Rp equivalent', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={100} type="AMOUNT" base={1000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '%' }));
    expect(onChange).toHaveBeenCalledWith(10, 'PERCENT');
  });

  test('clearing input sets type to null', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={50} type="AMOUNT" base={1000} onChange={onChange} />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null, null);
  });

  test('disabled state prevents toggle click + input change', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={null} type={null} base={1000} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Rp' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
npm test src/components/ui/discount/DiscountInlineInput.test.tsx
```
Expected: FAIL "Cannot find module './DiscountInlineInput'".

- [ ] **Step 3: Implement component**

Create `src/components/ui/discount/DiscountInlineInput.tsx`:
```tsx
import React from 'react';
import type { DiscountType } from '../../../types';
import { computeDiscountAmount } from './computeDiscountAmount';

export interface DiscountInlineInputProps {
  value: number | null;
  type: DiscountType;
  base: number;
  onChange: (value: number | null, type: DiscountType) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const DiscountInlineInput: React.FC<DiscountInlineInputProps> = ({
  value, type, base, onChange, disabled, placeholder = '0',
}) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value.trim();
    if (raw === '') { onChange(null, null); return; }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) return;
    const nextType: DiscountType = type ?? 'AMOUNT';
    onChange(num, nextType);
  };

  const handleToggle = (next: DiscountType) => {
    if (disabled) return;
    if (next === type) return;
    if (next === null) { onChange(null, null); return; }
    const currentAmount = computeDiscountAmount(value, type, base);
    if (currentAmount === 0 || base <= 0) {
      onChange(0, next);
      return;
    }
    const newValue = next === 'AMOUNT' ? currentAmount : Math.round((currentAmount / base) * 100);
    onChange(newValue, next);
  };

  const display = value == null ? '' : String(value);
  const segPillCls = 'inline-flex border border-slate-300 rounded overflow-hidden bg-white';
  const btnBase = 'text-[11px] font-bold leading-none px-1.5 py-1 cursor-pointer';
  const btnActive = 'bg-orange-700 text-white';
  const btnIdle = 'bg-white text-slate-600 hover:bg-slate-100';
  const isRp = type === 'AMOUNT';
  const isPct = type === 'PERCENT';

  return (
    <div className="flex items-center gap-1 justify-end">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={display}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-16 text-right text-[12px] font-mono border rounded px-2 py-1 ${
          type ? 'border-orange-700 font-bold text-orange-700' : 'border-slate-200 text-slate-400'
        }`}
      />
      <span className={segPillCls}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleToggle('AMOUNT')}
          className={`${btnBase} ${isRp ? btnActive : btnIdle}`}
        >Rp</button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleToggle('PERCENT')}
          className={`${btnBase} ${isPct ? btnActive : btnIdle}`}
        >%</button>
      </span>
    </div>
  );
};
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
npm test src/components/ui/discount/DiscountInlineInput.test.tsx
```
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/discount/DiscountInlineInput.tsx src/components/ui/discount/DiscountInlineInput.test.tsx progress.md
git commit -m "feat(diskon): Task 7 — DiscountInlineInput component + tests"
```

Progress.md: `- ✅ Diskon Task 7: DiscountInlineInput + 7 RTL tests.`

---

### Task 8: Component `<DiscountRow>` + tests + barrel index

**Files:**
- Create: `src/components/ui/discount/DiscountRow.tsx`
- Create: `src/components/ui/discount/DiscountRow.test.tsx`
- Create: `src/components/ui/discount/index.ts`

**Interfaces:**
- Consumes: `DiscountType`, `DiscountInlineInput`, `computeDiscountAmount`.
- Produces:
  ```ts
  export interface DiscountRowProps {
    label?: string;            // default "Diskon Order"
    value: number | null;
    type: DiscountType;
    base: number;              // subtotal-after-line-discount
    onChange: (value: number | null, type: DiscountType) => void;
    disabled?: boolean;
  }
  export const DiscountRow: React.FC<DiscountRowProps>;
  ```
  Renders a flex row: label + DiscountInlineInput + computed Rp amount tooltip below.

- [ ] **Step 1: Write failing test**

Create `src/components/ui/discount/DiscountRow.test.tsx`:
```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiscountRow } from './DiscountRow';

describe('DiscountRow', () => {
  test('renders default label "Diskon Order"', () => {
    render(<DiscountRow value={null} type={null} base={1000} onChange={() => {}} />);
    expect(screen.getByText(/Diskon Order/i)).toBeTruthy();
  });

  test('renders custom label', () => {
    render(<DiscountRow label="Diskon Tagihan" value={null} type={null} base={1000} onChange={() => {}} />);
    expect(screen.getByText(/Diskon Tagihan/i)).toBeTruthy();
  });

  test('shows computed Rp amount when PERCENT selected', () => {
    render(<DiscountRow value={10} type="PERCENT" base={1000000} onChange={() => {}} />);
    expect(screen.getByText(/100\.000/)).toBeTruthy();
  });

  test('shows 0 when no discount selected', () => {
    render(<DiscountRow value={null} type={null} base={1000} onChange={() => {}} />);
    expect(screen.queryByText(/0/)).toBeTruthy();
  });

  test('forwards onChange', () => {
    const onChange = vi.fn();
    render(<DiscountRow value={null} type={null} base={1000} onChange={onChange} />);
    // input change tested in DiscountInlineInput; here just verify renders without errors
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npm test src/components/ui/discount/DiscountRow.test.tsx
```
Expected: FAIL module not found.

- [ ] **Step 3: Implement**

Create `src/components/ui/discount/DiscountRow.tsx`:
```tsx
import React from 'react';
import type { DiscountType } from '../../../types';
import { DiscountInlineInput } from './DiscountInlineInput';
import { computeDiscountAmount } from './computeDiscountAmount';

export interface DiscountRowProps {
  label?: string;
  value: number | null;
  type: DiscountType;
  base: number;
  onChange: (value: number | null, type: DiscountType) => void;
  disabled?: boolean;
}

function fmtRp(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

export const DiscountRow: React.FC<DiscountRowProps> = ({
  label = 'Diskon Order', value, type, base, onChange, disabled,
}) => {
  const amount = computeDiscountAmount(value, type, base);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center bg-orange-50 -mx-2 px-2 py-1.5 rounded">
        <span className="font-semibold text-orange-700 text-sm">⊖ {label}</span>
        <DiscountInlineInput
          value={value}
          type={type}
          base={base}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      <div className="flex justify-between text-[11px] text-orange-700">
        <span></span>
        <span className="font-mono">= − Rp {fmtRp(amount)}</span>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run — verify PASS**

```bash
npm test src/components/ui/discount/DiscountRow.test.tsx
```
Expected: 5 tests PASS.

- [ ] **Step 5: Create barrel `index.ts`**

```ts
export { computeDiscountAmount } from './computeDiscountAmount';
export { useDiscountBinding } from './useDiscountBinding';
export type { DiscountBindingState, DiscountBindingApi } from './useDiscountBinding';
export { DiscountInlineInput } from './DiscountInlineInput';
export type { DiscountInlineInputProps } from './DiscountInlineInput';
export { DiscountRow } from './DiscountRow';
export type { DiscountRowProps } from './DiscountRow';
```

- [ ] **Step 6: Run full discount test suite + lint**

```bash
npm test src/components/ui/discount
npm run lint
```
Expected: all PASS, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/discount/DiscountRow.tsx src/components/ui/discount/DiscountRow.test.tsx src/components/ui/discount/index.ts progress.md
git commit -m "feat(diskon): Task 8 — DiscountRow + barrel index"
```

Progress.md: `- ✅ Diskon Task 8: DiscountRow + index barrel. All shared primitives ready.`

---

### Task 9: Pengaturan UI — ModulSwitchesPanel 3 toggle baru

**Files:**
- Modify: `src/components/pengaturan/ModulSwitchesPanel.tsx`

**Interfaces:**
- Consumes: existing `MODULS` array, `DbTenantSettings` (extended Task 4), `tenantSettingsService.updateModul`.
- Produces: UI shows 3 additional rows below `modul_bom_recipe`. Toggle persisted via existing `set_tenant_modul` RPC (whitelist extended Task 3).

- [ ] **Step 1: Append 3 entries to `MODULS` array**

Edit `src/components/pengaturan/ModulSwitchesPanel.tsx`. Replace MODULS const (lines ~12-21):
```ts
const MODULS: Array<{ key: ModulSwitchKey; icon: string; title: string; description: string }> = [
  { key: 'modul_kasir',           icon: '⚙️', title: 'Modul Kasir / POS',         description: 'Meja kasir dengan struk thermal, drawer kas, scan barcode.' },
  { key: 'modul_tempo',           icon: '💳', title: 'Modul TEMPO / Piutang',     description: 'Pelanggan boleh ambil utang, bayar nanti.' },
  { key: 'modul_pengiriman',      icon: '🚚', title: 'Modul Pengiriman',          description: 'Tambah ongkir sebagai baris invoice.' },
  { key: 'modul_multi_warehouse', icon: '🏬', title: 'Modul Multi-warehouse',     description: 'Stok di lebih dari 1 gudang.' },
  { key: 'modul_akuntansi',       icon: '🧾', title: 'Modul Akuntansi',           description: 'Buku Besar, Trial Balance, Laporan SAK EMKM.' },
  { key: 'modul_jasa_layanan',    icon: '🛠️', title: 'Modul Jasa & Layanan',     description: 'Tawarkan jasa selain produk fisik (tenant-defined types).' },
  { key: 'modul_bom_recipe',      icon: '🍳', title: 'Modul Resep / BOM',         description: 'Produk dengan komposisi material (untuk F&B / manufaktur).' },
  { key: 'modul_diskon_kasir',    icon: '🏷️', title: 'Diskon di Kasir',           description: 'Kolom Diskon di cart + baris Diskon Order di total bar Kasir.' },
  { key: 'modul_diskon_penjualan',icon: '🏷️', title: 'Diskon di Penjualan',       description: 'Kolom Diskon di Step 2 + Diskon Order di Step 3 wizard Catat Penjualan.' },
  { key: 'modul_diskon_tagihan',  icon: '🏷️', title: 'Diskon di Tagihan PI',      description: 'Kolom Diskon per item + Diskon Tagihan di total Pembelian Tagihan.' },
];
```

- [ ] **Step 2: Run typecheck**

```bash
npm run lint
```
Expected: zero errors (Task 4 sudah extend ModulSwitchKey).

- [ ] **Step 3: Smoke test manual (dev server)**

```bash
npm run dev
```
Open `http://localhost:3000`, login as Owner, navigate Pengaturan → Modul. Verify: 10 toggles (7 lama + 3 baru), semua default ON. Klik toggle `Diskon di Kasir` → toast "ok" + state persisted. Refresh — toggle stays OFF.

Document the manual result in a one-line note in progress.md under this task: `- ✅ Diskon Task 9 manual: 10 toggle visible, persist OK across refresh.`

- [ ] **Step 4: Commit**

```bash
git add src/components/pengaturan/ModulSwitchesPanel.tsx progress.md
git commit -m "feat(diskon): Task 9 — ModulSwitchesPanel append 3 toggle diskon"
```

---

### Task 10: RPC patch `record_kasir_sale` + smoke matrix

**Files:**
- Create: `supabase/migrations/20260801000004_record_kasir_sale_with_discount.sql`
- Modify: `src/lib/supabaseClient.ts` (function `recordKasirSale` ~line 1396).

**Interfaces:**
- Consumes: existing 22-param `record_kasir_sale` (Phase 0b dual-write), `_post_journal_entry` helper, `_resolve_kasir_pendapatan_coa` helper.
- Produces:
  - New 25-param signature with `p_discount_type`, `p_discount_value`, `p_discount_amount_rp` inserted before `p_cash_account_id`.
  - Per-line validation: rejects `MARKUP_NOT_ALLOWED`, `EXCESSIVE_LINE_DISCOUNT`, `DISCOUNT_EXCEEDS_SUBTOTAL`.
  - Server recompute of `subtotal`, `total_amount`.
  - Journal: extra DEBIT line ke `4-1900` dengan `total_discount_rp = SUM(line.discount_amount_rp) + p_discount_amount_rp` (inside same `_post_journal_entry` call, soft-fail).
  - Frontend `recordKasirSale()` accepts `discount?: DiscountTriple` param.

- [ ] **Step 1: Capture current function body**

```sql
SELECT pg_get_functiondef('public.record_kasir_sale(date,text,jsonb,numeric,text,text,text,numeric,text,numeric,text,numeric,text,text,text,text,text,text,text,text,uuid,boolean)'::regprocedure);
```
Copy output → save inline as a comment block at top of migration file (rollback reference).

- [ ] **Step 2: Write migration with patched RPC**

Create `supabase/migrations/20260801000004_record_kasir_sale_with_discount.sql`:
```sql
-- 20260801000004 — record_kasir_sale: add diskon (3 params + JSONB shape + journal line)
--
-- Tambah 3 params (discount_type, discount_value, discount_amount_rp) sebelum
-- p_cash_account_id. p_items JSONB sekarang expect per-line discount fields
-- (master_price_at_sale, discount_*). Server recompute subtotal + total_amount.
-- Markup ditolak. Journal kontra 4-1900 di-append ke _post_journal_entry call.

BEGIN;

DROP FUNCTION IF EXISTS public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text, numeric,
  text, numeric, text, text, text, text, text, text, text, text, uuid, boolean
);

CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  p_date date,
  p_channel text,
  p_items jsonb,
  p_subtotal numeric,
  p_payment_method text,
  p_payment_subtype text,
  p_payment_type text,
  p_dp_amount numeric,
  p_dp_input_type text,
  p_ongkir_amount numeric,
  p_notes text,
  p_total_amount numeric,
  p_customer_name text,
  p_customer_phone text,
  p_customer_company text,
  p_delivery_address text,
  p_marketplace_order_no text,
  p_wa_phone text,
  p_wa_chat_url text,
  p_customer_id text,
  p_discount_type      TEXT    DEFAULT NULL,
  p_discount_value     NUMERIC DEFAULT NULL,
  p_discount_amount_rp NUMERIC DEFAULT 0,
  p_cash_account_id     UUID    DEFAULT NULL,
  p_allow_negative_stock BOOLEAN DEFAULT FALSE
) RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_kt              public.kasir_transactions;
  v_item            jsonb;
  v_line_discount_total NUMERIC := 0;
  v_total_discount_rp   NUMERIC;
  v_recomputed_subtotal NUMERIC := 0;
  v_recomputed_total    NUMERIC;
  v_master_price        NUMERIC;
  v_unit_price          NUMERIC;
  v_qty                 INT;
  v_line_amount         NUMERIC;
  -- ... copy existing locals from captured body in Step 1
BEGIN
  -- Validation: triple consistency for order-level
  IF (p_discount_type IS NULL) <> (p_discount_value IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: type/value must both be NULL or both set';
  END IF;
  IF p_discount_amount_rp < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_DISCOUNT';
  END IF;

  -- Per-line validation + recompute
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_master_price := COALESCE((v_item->>'master_price_at_sale')::numeric, (v_item->>'unit_price')::numeric);
    v_unit_price   := (v_item->>'unit_price')::numeric;
    v_qty          := (v_item->>'qty')::int;
    v_line_amount  := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);

    -- Markup guard: master >= unit_price
    IF v_master_price < v_unit_price THEN
      RAISE EXCEPTION 'MARKUP_NOT_ALLOWED: sku=% master=% unit_price=%',
        v_item->>'sku', v_master_price, v_unit_price;
    END IF;

    -- Excessive line discount
    IF v_line_amount > (v_unit_price * v_qty) THEN
      RAISE EXCEPTION 'EXCESSIVE_LINE_DISCOUNT: sku=% discount=% base=%',
        v_item->>'sku', v_line_amount, (v_unit_price * v_qty);
    END IF;

    v_line_discount_total := v_line_discount_total + v_line_amount;
    v_recomputed_subtotal := v_recomputed_subtotal + (v_unit_price * v_qty) - v_line_amount;
  END LOOP;

  -- Order-level discount must not exceed remaining subtotal
  IF p_discount_amount_rp > v_recomputed_subtotal THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_SUBTOTAL: order_discount=% subtotal_after_line=%',
      p_discount_amount_rp, v_recomputed_subtotal;
  END IF;

  v_recomputed_total := v_recomputed_subtotal - p_discount_amount_rp + COALESCE(p_ongkir_amount, 0);
  v_total_discount_rp := v_line_discount_total + COALESCE(p_discount_amount_rp, 0);

  -- ... existing body: validate customer_id, generate invoice_number, etc.
  -- (Implementer: paste the rest of the original body here, replacing usage of
  --  p_subtotal / p_total_amount with v_recomputed_subtotal / v_recomputed_total.
  --  Augment INSERT with discount_type/discount_value/discount_amount_rp columns.
  --  Augment _post_journal_entry call to include a debit line to 4-1900 sized
  --  v_total_discount_rp, inside the same dual-write block.)

  INSERT INTO public.kasir_transactions (
    -- ... existing cols ...
    discount_type, discount_value, discount_amount_rp
  ) VALUES (
    -- ... existing values, with subtotal=v_recomputed_subtotal, total_amount=v_recomputed_total ...
    p_discount_type, p_discount_value, COALESCE(p_discount_amount_rp, 0)
  )
  RETURNING * INTO v_kt;

  -- Dual-write GL (soft-fail). When invoking _post_journal_entry, pass a JSONB
  -- payload containing a 4-1900 debit line of v_total_discount_rp if v_total_discount_rp > 0.

  RETURN v_kt;
END $function$;

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text, numeric,
  text, numeric, text, text, text, text, text, text, text, text,
  text, numeric, numeric, uuid, boolean
) TO authenticated;

COMMIT;
```

**IMPLEMENTER NOTE**: ini skeleton — Anda HARUS copy seluruh body asli (Step 1 output) ke posisi "... existing body ..." dan splice:
1. `discount_type/value/amount_rp` ke INSERT column list + VALUES.
2. Replace `p_subtotal` → `v_recomputed_subtotal`, `p_total_amount` → `v_recomputed_total` di INSERT.
3. Di GL dual-write block (cek `enable_dual_write_to_gl` → `_post_journal_entry`), tambah debit line ke `4-1900` saat `v_total_discount_rp > 0`. Soft-fail pattern existing harus dipertahankan (catch → `gl_dual_write_anomalies` → `RAISE WARNING` → continue).

- [ ] **Step 3: Apply via MCP**

Run `mcp__plugin_supabase_supabase__apply_migration` dengan migration di atas.

- [ ] **Step 4: Smoke test — happy path AMOUNT**

Pakai pattern `reference_smoke_test_security_definer_rpcs.md`:

```sql
DO $$
DECLARE
  v_admin_id UUID;
  v_result public.kasir_transactions;
  v_je_count INT;
  v_je_debit_total NUMERIC;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  v_result := public.record_kasir_sale(
    p_date := CURRENT_DATE, p_channel := 'walkin',
    p_items := '[{"sku":"KBL-001","qty":10,"unit_price":100000,"master_price_at_sale":100000,"discount_type":"AMOUNT","discount_value":50000,"discount_amount_rp":50000}]'::jsonb,
    p_subtotal := 950000,  -- client says; server should recompute to same
    p_payment_method := 'CASH', p_payment_subtype := NULL, p_payment_type := 'LUNAS',
    p_dp_amount := 0, p_dp_input_type := NULL, p_ongkir_amount := 0,
    p_notes := 'smoke-test', p_total_amount := 950000,
    p_customer_name := 'TEST', p_customer_phone := NULL, p_customer_company := NULL,
    p_delivery_address := NULL, p_marketplace_order_no := NULL, p_wa_phone := NULL,
    p_wa_chat_url := NULL, p_customer_id := NULL,
    p_discount_type := 'AMOUNT', p_discount_value := 100000, p_discount_amount_rp := 100000,
    p_cash_account_id := NULL, p_allow_negative_stock := false
  );

  IF v_result.subtotal != 950000 OR v_result.total_amount != 850000 THEN
    RAISE EXCEPTION 'subtotal/total wrong: subtotal=% total=%', v_result.subtotal, v_result.total_amount;
  END IF;

  -- Check journal (only if dual-write enabled)
  IF EXISTS (SELECT 1 FROM public.accounting_config WHERE enable_dual_write_to_gl = true) THEN
    SELECT COUNT(*), SUM(CASE WHEN debit > 0 THEN debit ELSE 0 END)
      INTO v_je_count, v_je_debit_total
    FROM public.journal_entry_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.source_id::text = v_result.id::text;

    IF NOT EXISTS (
      SELECT 1 FROM public.journal_entry_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.source_id::text = v_result.id::text
        AND jl.account_code = '4-1900'
        AND jl.debit = 150000  -- 50k line + 100k order
    ) THEN
      RAISE EXCEPTION 'expected 4-1900 debit 150000 not found';
    END IF;
  END IF;

  RAISE EXCEPTION 'rollback';
END $$;
```
Expected: exception "rollback" — happy path passed.

- [ ] **Step 5: Smoke test — markup rejection**

```sql
DO $$
DECLARE v_admin_id UUID;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  BEGIN
    PERFORM public.record_kasir_sale(
      CURRENT_DATE, 'walkin',
      '[{"sku":"X","qty":1,"unit_price":120000,"master_price_at_sale":100000,"discount_amount_rp":0}]'::jsonb,
      120000, 'CASH', NULL, 'LUNAS', 0, NULL, 0, '', 120000,
      'TEST', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, 0, NULL, false
    );
    RAISE EXCEPTION 'should have rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MARKUP_NOT_ALLOWED%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'rollback';
END $$;
```
Expected: rollback. Markup rejected.

- [ ] **Step 6: Smoke test — DISCOUNT_EXCEEDS_SUBTOTAL**

```sql
DO $$
DECLARE v_admin_id UUID;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  BEGIN
    PERFORM public.record_kasir_sale(
      CURRENT_DATE, 'walkin',
      '[{"sku":"X","qty":1,"unit_price":100000,"master_price_at_sale":100000,"discount_amount_rp":0}]'::jsonb,
      100000, 'CASH', NULL, 'LUNAS', 0, NULL, 0, '', 100000,
      'TEST', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'AMOUNT', 200000, 200000, NULL, false
    );
    RAISE EXCEPTION 'should have rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'DISCOUNT_EXCEEDS_SUBTOTAL%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'rollback';
END $$;
```
Expected: rollback.

- [ ] **Step 7: Update frontend caller `recordKasirSale`**

Edit `src/lib/supabaseClient.ts:1396`. Add `discount` param to the wrapper and pass through to RPC:

```ts
// Before: existing recordKasirSale(...) signature
// After: add optional discount param.
export interface RecordKasirSaleDiscount {
  discount_type: 'PERCENT' | 'AMOUNT' | null;
  discount_value: number | null;
  discount_amount_rp: number;
}

// Inside the function body, where it calls supabase.rpc('record_kasir_sale', { ... }):
const { data, error } = await supabase.rpc('record_kasir_sale', {
  // ... existing params ...
  p_discount_type: discount?.discount_type ?? null,
  p_discount_value: discount?.discount_value ?? null,
  p_discount_amount_rp: discount?.discount_amount_rp ?? 0,
  p_cash_account_id: cashAccountId ?? null,
  p_allow_negative_stock: allowNegativeStock ?? false,
});
```

Note: read the current function signature in `src/lib/supabaseClient.ts:1385-1430` and splice the new optional `discount` arg + RPC param. Keep existing call sites backward-compat (default discount = undefined → all null/0).

- [ ] **Step 8: Run typecheck + tests**

```bash
npm run lint
npm test src/lib
```
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260801000004_record_kasir_sale_with_discount.sql src/lib/supabaseClient.ts progress.md
git commit -m "feat(diskon): Task 10 — record_kasir_sale RPC with discount (validation + journal 4-1900)"
```

Progress.md: `- ✅ Diskon Task 10: record_kasir_sale RPC patched + 3 smoke (happy/markup/over). Frontend caller updated.`

---

### Task 11: RPC patch `create_tempo_invoice` + smoke matrix

**Files:**
- Create: `supabase/migrations/20260801000005_create_tempo_invoice_with_discount.sql`
- Modify: `src/lib/piutangService.ts` (function `createTempoInvoice` around line 74).

**Interfaces:**
- Consumes: existing `create_tempo_invoice(p_payload jsonb)` (latest `20260630000003`).
- Produces: payload accepts new fields `discount_type`, `discount_value`, `discount_amount_rp`, and per-item `discount_*` + `master_price_at_sale`. Recompute server-side. Reject MARKUP / OVER_DISCOUNT. Journal extra debit to 4-1900 (if dual-write active for sales invoices — verify; if not, skip journal addition and add TODO note).

- [ ] **Step 1: Capture current body**

```sql
SELECT pg_get_functiondef('public.create_tempo_invoice(jsonb)'::regprocedure);
```
Save as comment block top of new migration file (rollback reference).

- [ ] **Step 2: Check if `create_tempo_invoice` already does GL dual-write**

```bash
grep -l "create_tempo_invoice" /Users/tonywei/IdeaProjects/ERPAntigravity/supabase/migrations/*phase0*.sql 2>/dev/null
grep -A30 "create_tempo_invoice" /Users/tonywei/IdeaProjects/ERPAntigravity/supabase/migrations/20260630000003_create_tempo_invoice_allow_negative_stock.sql | grep -i "dual_write\|_post_journal_entry"
```
Note result: if dual-write present, add 4-1900 line. If not, skip journal addition (will be wired when Phase 0c sales dual-write lands) and add a TODO comment in the migration body.

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260801000005_create_tempo_invoice_with_discount.sql`:
```sql
-- 20260801000005 — create_tempo_invoice: payload extended with discount triples.
--
-- Payload shape extension:
--   {
--     "items": [{ ..., "master_price_at_sale": N, "discount_type": ..., "discount_value": ..., "discount_amount_rp": ... }],
--     "discount_type": ..., "discount_value": ..., "discount_amount_rp": ...
--   }
-- Validation:
--   - Per-line: master_price_at_sale >= unit_price (MARKUP_NOT_ALLOWED).
--   - Per-line: discount_amount_rp <= unit_price * qty (EXCESSIVE_LINE_DISCOUNT).
--   - Order: discount_amount_rp <= subtotal - sum(line discounts) (DISCOUNT_EXCEEDS_SUBTOTAL).
-- Server recompute subtotal + total.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  -- ... existing locals from Step 1 capture ...
  v_item                jsonb;
  v_master              NUMERIC;
  v_unit_price          NUMERIC;
  v_qty                 INT;
  v_line_amount         NUMERIC;
  v_line_discount_total NUMERIC := 0;
  v_recomputed_subtotal NUMERIC := 0;
  v_order_discount_amt  NUMERIC := COALESCE((p_payload->>'discount_amount_rp')::numeric, 0);
  v_order_discount_type TEXT    := p_payload->>'discount_type';
  v_order_discount_val  NUMERIC := (p_payload->>'discount_value')::numeric;
BEGIN
  -- Triple consistency
  IF (v_order_discount_type IS NULL) <> (v_order_discount_val IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb))
  LOOP
    v_master      := COALESCE((v_item->>'master_price_at_sale')::numeric, (v_item->>'unit_price')::numeric);
    v_unit_price  := (v_item->>'unit_price')::numeric;
    v_qty         := (v_item->>'qty')::int;
    v_line_amount := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);

    IF v_master < v_unit_price THEN
      RAISE EXCEPTION 'MARKUP_NOT_ALLOWED: sku=%', v_item->>'sku';
    END IF;
    IF v_line_amount > (v_unit_price * v_qty) THEN
      RAISE EXCEPTION 'EXCESSIVE_LINE_DISCOUNT: sku=%', v_item->>'sku';
    END IF;
    v_line_discount_total := v_line_discount_total + v_line_amount;
    v_recomputed_subtotal := v_recomputed_subtotal + (v_unit_price * v_qty) - v_line_amount;
  END LOOP;

  IF v_order_discount_amt > v_recomputed_subtotal THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_SUBTOTAL: order_discount=% subtotal_after_line=%',
      v_order_discount_amt, v_recomputed_subtotal;
  END IF;

  -- ... existing body: build orders/invoice/items, with these substitutions:
  -- - INSERT into orders sets discount_type/value/amount_rp = v_order_discount_*.
  -- - subtotal = v_recomputed_subtotal.
  -- - total = v_recomputed_subtotal - v_order_discount_amt + ongkir.
  -- - items JSONB stored as-is from payload (which already has discount_* fields).
  -- TODO(Phase 0c sales dual-write): when create_tempo_invoice dual-writes GL,
  --      append debit to 4-1900 with (v_line_discount_total + v_order_discount_amt).

  -- ... return same JSONB shape as before ...
END $function$;

GRANT EXECUTE ON FUNCTION public.create_tempo_invoice(jsonb) TO authenticated;

COMMIT;
```

IMPLEMENTER NOTE: paste the original body inside; replace subtotal/total with recomputed; ensure `orders` INSERT writes the 3 discount cols + leaves `items` JSONB intact (frontend already shaped it).

- [ ] **Step 4: Apply via MCP**

`mcp__plugin_supabase_supabase__apply_migration` with the file.

- [ ] **Step 5: Smoke test — happy path PERCENT order-level**

```sql
DO $$
DECLARE
  v_admin_id UUID;
  v_result jsonb;
  v_order_id uuid;
  v_total numeric;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  v_result := public.create_tempo_invoice('{
    "customer_id": "REPLACE_WITH_REAL_CUSTOMER",
    "channel": "TOKOPEDIA",
    "items": [
      {"sku":"REPLACE","qty":10,"unit_price":100000,"master_price_at_sale":100000,"discount_amount_rp":0}
    ],
    "ongkir_amount": 0,
    "due_date": "2026-08-15",
    "discount_type": "PERCENT",
    "discount_value": 5,
    "discount_amount_rp": 50000
  }'::jsonb);

  v_order_id := (v_result->>'order_id')::uuid;
  SELECT total INTO v_total FROM public.orders WHERE id = v_order_id;
  IF v_total != 950000 THEN
    RAISE EXCEPTION 'total wrong: %', v_total;
  END IF;

  RAISE EXCEPTION 'rollback';
END $$;
```
NOTE: Substitute `customer_id` and `sku` with real values from the DB before running. Expected: rollback (test passed).

- [ ] **Step 6: Smoke — markup rejection**

```sql
DO $$
DECLARE v_admin_id UUID;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  BEGIN
    PERFORM public.create_tempo_invoice('{
      "customer_id":"REPLACE","channel":"TOKOPEDIA","ongkir_amount":0,"due_date":"2026-08-15",
      "items":[{"sku":"REPLACE","qty":1,"unit_price":120000,"master_price_at_sale":100000,"discount_amount_rp":0}]
    }'::jsonb);
    RAISE EXCEPTION 'should have rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MARKUP_NOT_ALLOWED%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'rollback';
END $$;
```
Expected: rollback. Substitute customer_id + sku with real values.

- [ ] **Step 6b: Smoke — order-discount exceeds subtotal**

```sql
DO $$
DECLARE v_admin_id UUID;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  BEGIN
    PERFORM public.create_tempo_invoice('{
      "customer_id":"REPLACE","channel":"TOKOPEDIA","ongkir_amount":0,"due_date":"2026-08-15",
      "items":[{"sku":"REPLACE","qty":1,"unit_price":100000,"master_price_at_sale":100000,"discount_amount_rp":0}],
      "discount_type":"AMOUNT","discount_value":200000,"discount_amount_rp":200000
    }'::jsonb);
    RAISE EXCEPTION 'should have rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'DISCOUNT_EXCEEDS_SUBTOTAL%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'rollback';
END $$;
```
Expected: rollback.

- [ ] **Step 7: Update frontend caller `createTempoInvoice`**

Edit `src/lib/piutangService.ts:74`. Add optional `discount?: DiscountTriple` arg to wrapper, splice into payload object before `supabase.rpc(...)`. Per-item discount fields already constructed by the wizard caller (Task 15).

- [ ] **Step 8: Run typecheck + tests**

```bash
npm run lint
npm test src/lib
```
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260801000005_create_tempo_invoice_with_discount.sql src/lib/piutangService.ts progress.md
git commit -m "feat(diskon): Task 11 — create_tempo_invoice payload + validation"
```

Progress.md: `- ✅ Diskon Task 11: create_tempo_invoice RPC patched + smoke.`

---

### Task 12: RPC patch `record_pi` + smoke matrix

**Files:**
- Create: `supabase/migrations/20260801000006_record_pi_with_discount.sql`

**Interfaces:**
- Consumes: existing `record_pi(payload jsonb)` (latest `20260724000002_phase0c_record_pi_dual_write.sql` — dual-write Phase 0c).
- Produces: payload with `discount_*` + per-item `discount_*` + `master_unit_cost`. Server validation + recompute. Journal: extra CREDIT line to `5-1900` sized total discount.

- [ ] **Step 1: Capture current body**

```sql
SELECT pg_get_functiondef('public.record_pi(jsonb)'::regprocedure);
```
Save inline (rollback reference).

- [ ] **Step 2: Check Phase 0c dual-write structure**

```bash
grep -n "_post_journal_entry\|enable_dual_write_to_gl\|account_code" /Users/tonywei/IdeaProjects/ERPAntigravity/supabase/migrations/20260724000002_phase0c_record_pi_dual_write.sql
```
Note the dual-write block structure. The new 5-1900 credit line must be appended in the same call.

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260801000006_record_pi_with_discount.sql`:
```sql
-- 20260801000006 — record_pi: payload + per-item discount; journal 5-1900 credit.
-- Validation identik dgn Kasir/Wizard: MARKUP_NOT_ALLOWED (master_unit_cost < unit_cost),
-- EXCESSIVE_LINE_DISCOUNT, DISCOUNT_EXCEEDS_SUBTOTAL.
-- Insert ke purchase_invoice_items dengan kolom baru: master_unit_cost, discount_*.
-- Insert ke purchase_invoices dengan order-level discount_*.
-- GL dual-write: append CREDIT line to 5-1900 (kontra HPP) sized total_discount_rp.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  -- ... existing locals captured at Step 1 ...
  v_item                jsonb;
  v_master_cost         NUMERIC;
  v_unit_cost           NUMERIC;
  v_qty                 INT;
  v_line_discount       NUMERIC;
  v_line_discount_total NUMERIC := 0;
  v_recomputed_subtotal NUMERIC := 0;
  v_order_discount_type TEXT    := payload->>'discount_type';
  v_order_discount_val  NUMERIC := (payload->>'discount_value')::numeric;
  v_order_discount_amt  NUMERIC := COALESCE((payload->>'discount_amount_rp')::numeric, 0);
  v_total_discount_rp   NUMERIC;
BEGIN
  IF (v_order_discount_type IS NULL) <> (v_order_discount_val IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
  LOOP
    v_master_cost   := COALESCE((v_item->>'master_unit_cost')::numeric, (v_item->>'unit_cost')::numeric);
    v_unit_cost     := (v_item->>'unit_cost')::numeric;
    v_qty           := (v_item->>'qty')::int;
    v_line_discount := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);

    IF v_master_cost < v_unit_cost THEN
      RAISE EXCEPTION 'MARKUP_NOT_ALLOWED: sku=%', v_item->>'sku';
    END IF;
    IF v_line_discount > (v_unit_cost * v_qty) THEN
      RAISE EXCEPTION 'EXCESSIVE_LINE_DISCOUNT: sku=%', v_item->>'sku';
    END IF;

    v_line_discount_total := v_line_discount_total + v_line_discount;
    v_recomputed_subtotal := v_recomputed_subtotal + (v_unit_cost * v_qty) - v_line_discount;
  END LOOP;

  IF v_order_discount_amt > v_recomputed_subtotal THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_SUBTOTAL';
  END IF;

  v_total_discount_rp := v_line_discount_total + v_order_discount_amt;

  -- ... existing body inserts purchase_invoices + purchase_invoice_items with:
  --   - pi.subtotal = v_recomputed_subtotal + v_order_discount_amt (= pre-order-discount; or omit if not needed)
  --     decision: pi.subtotal stays = SUM(unit_cost * qty) so it represents gross.
  --   - pi.total    = v_recomputed_subtotal - v_order_discount_amt
  --   - pi.discount_type/value/amount_rp from payload top-level
  --   - per-item INSERT includes master_unit_cost, discount_type, discount_value, discount_amount_rp.
  -- ... existing dual-write block at end:
  --   IF v_total_discount_rp > 0 THEN
  --     append a CREDIT journal line: account_code='5-1900', amount=v_total_discount_rp.
  --   END IF;

  -- ... return existing jsonb shape ...
END $function$;

GRANT EXECUTE ON FUNCTION public.record_pi(jsonb) TO authenticated;

COMMIT;
```

IMPLEMENTER NOTE: paste original body inside; substitute subtotal/total per comments; ensure INSERT statements include the new columns. For GL dual-write block (Phase 0c pattern), append a 5-1900 credit line of size `v_total_discount_rp` to the existing journal entry payload — soft-fail (catch / anomaly log).

- [ ] **Step 4: Apply via MCP** — `mcp__plugin_supabase_supabase__apply_migration`.

- [ ] **Step 5: Smoke — happy path STOCK PI with line + order discount**

```sql
DO $$
DECLARE
  v_admin_id UUID;
  v_result jsonb;
  v_pi_id uuid;
  v_total numeric;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  v_result := public.record_pi('{
    "type": "STOCK",
    "supplier_id": "REPLACE",
    "payment_method": "TEMPO",
    "payment_due_at": "2026-08-30",
    "items": [
      {"sku":"REPLACE","qty":50,"unit_cost":180000,"master_unit_cost":200000,
       "sell_price":250000,"discount_type":"AMOUNT","discount_value":1000000,"discount_amount_rp":1000000}
    ],
    "discount_type": "PERCENT", "discount_value": 3, "discount_amount_rp": 270000
  }'::jsonb);

  v_pi_id := (v_result->>'pi_id')::uuid;
  SELECT total INTO v_total FROM public.purchase_invoices WHERE id = v_pi_id;
  -- gross 50*180000 = 9_000_000 minus order 270k = 8_730_000
  IF v_total != 8730000 THEN RAISE EXCEPTION 'total wrong: %', v_total; END IF;

  -- 5-1900 credit check (if dual-write active)
  IF EXISTS (SELECT 1 FROM public.accounting_config WHERE enable_dual_write_to_gl = true) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.journal_entry_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.source_id::text = v_pi_id::text
        AND jl.account_code = '5-1900'
        AND jl.credit = 1270000   -- 1M line + 270k order
    ) THEN
      RAISE EXCEPTION '5-1900 credit 1270000 not found';
    END IF;
  END IF;

  RAISE EXCEPTION 'rollback';
END $$;
```
NOTE: substitute supplier_id + sku with real values. Expected: rollback.

- [ ] **Step 6: Smoke — markup rejection (master_unit_cost < unit_cost)**

```sql
DO $$
DECLARE v_admin_id UUID;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  BEGIN
    PERFORM public.record_pi('{
      "type":"STOCK","supplier_id":"REPLACE","payment_method":"CASH",
      "items":[{"sku":"REPLACE","qty":1,"unit_cost":220000,"master_unit_cost":200000,"sell_price":250000,"discount_amount_rp":0}]
    }'::jsonb);
    RAISE EXCEPTION 'should have rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MARKUP_NOT_ALLOWED%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'rollback';
END $$;
```
Expected: rollback.

- [ ] **Step 6b: Smoke — order-discount exceeds subtotal**

```sql
DO $$
DECLARE v_admin_id UUID;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE role = 'Owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  BEGIN
    PERFORM public.record_pi('{
      "type":"STOCK","supplier_id":"REPLACE","payment_method":"CASH",
      "items":[{"sku":"REPLACE","qty":1,"unit_cost":100000,"master_unit_cost":100000,"sell_price":150000,"discount_amount_rp":0}],
      "discount_type":"AMOUNT","discount_value":200000,"discount_amount_rp":200000
    }'::jsonb);
    RAISE EXCEPTION 'should have rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'DISCOUNT_EXCEEDS_SUBTOTAL%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'rollback';
END $$;
```
Expected: rollback.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260801000006_record_pi_with_discount.sql progress.md
git commit -m "feat(diskon): Task 12 — record_pi RPC + per-item discount + 5-1900 credit"
```

Progress.md: `- ✅ Diskon Task 12: record_pi RPC + smoke (happy STOCK + 2 rejections).`

---

### Task 13: Pengawasan view rewrite + regression smoke

**Files:**
- Create: `supabase/migrations/20260801000007_pengawasan_kasir_discount_view_v2.sql`

**Interfaces:**
- Consumes: `kasir_transactions` (with new discount cols + items JSONB with discount fields).
- Produces: `v_pengawasan_kasir_discount_7d` rewritten to sum explicit `discount_amount_rp` from items JSONB + top-level. Stable across `stocks.price` mutations.

- [ ] **Step 1: Write rewrite migration**

Create `supabase/migrations/20260801000007_pengawasan_kasir_discount_view_v2.sql`:
```sql
-- 20260801000007 — Pengawasan view v2: sum explicit discount_amount_rp.
-- Replaces derived-from-stocks.price calculation (latent bug: harga master
-- berubah → historical discount geser). New view reads JSONB snapshot.
-- Order-level discount dijumlah utuh ke cashier (tidak prorated per line).

BEGIN;

CREATE OR REPLACE VIEW public.v_pengawasan_kasir_discount_7d AS
WITH line_agg AS (
  SELECT
    kt.id AS kt_id,
    kt.created_by,
    COALESCE(SUM((kti.value->>'discount_amount_rp')::numeric), 0)::numeric  AS line_discount_total,
    COALESCE(SUM((kti.value->>'unit_price')::numeric * (kti.value->>'qty')::int), 0)::numeric AS gross_revenue
  FROM public.kasir_transactions kt
  LEFT JOIN LATERAL jsonb_array_elements(kt.items) AS kti(value) ON TRUE
  WHERE kt.type = 'income'
    AND kt.status IN ('PAID','COMPLETED')
    AND kt.created_at >= now() - INTERVAL '7 days'
  GROUP BY kt.id, kt.created_by
),
kt_agg AS (
  SELECT
    la.created_by,
    SUM(la.line_discount_total + COALESCE(kt.discount_amount_rp, 0))::numeric AS total_discount_rp,
    SUM(la.gross_revenue)::numeric AS total_revenue_rp
  FROM line_agg la
  JOIN public.kasir_transactions kt ON kt.id = la.kt_id
  GROUP BY la.created_by
)
SELECT
  kt_agg.created_by AS cashier_user_id,
  au.name           AS cashier_name,
  kt_agg.total_discount_rp,
  kt_agg.total_revenue_rp,
  CASE WHEN kt_agg.total_revenue_rp > 0
    THEN kt_agg.total_discount_rp / kt_agg.total_revenue_rp
    ELSE 0
  END AS discount_pct_of_revenue
FROM kt_agg
LEFT JOIN public.admin_users au ON au.id = kt_agg.created_by;

GRANT SELECT ON public.v_pengawasan_kasir_discount_7d TO authenticated;

COMMIT;
```

- [ ] **Step 2: Apply via MCP**.

- [ ] **Step 3: Regression smoke — view returns expected shape with mixed pre+post-migration data**

```sql
SELECT * FROM public.v_pengawasan_kasir_discount_7d LIMIT 5;
```
Expected: returns columns `cashier_user_id, cashier_name, total_discount_rp, total_revenue_rp, discount_pct_of_revenue` without error.

- [ ] **Step 4: Smoke — stocks.price change does NOT shift historical**

```sql
-- Pick a SKU + cashier with discount history; record current pengawasan number.
-- Mutate stocks.price by Rp 1.
-- Re-query view; verify same number.
SELECT cashier_name, total_discount_rp FROM public.v_pengawasan_kasir_discount_7d ORDER BY total_discount_rp DESC LIMIT 1;
-- Note the number, then update a stock price involved, then re-select.
-- Expected: number identical → latent bug fixed.
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260801000007_pengawasan_kasir_discount_view_v2.sql progress.md
git commit -m "feat(diskon): Task 13 — pengawasan view rewrite (explicit discount_amount_rp)"
```

Progress.md: `- ✅ Diskon Task 13: pengawasan view v2 — latent bug fixed.`

---

### Task 14: Kasir UI — cart line discount + total bar + struk PDF

**Files:**
- Modify: `src/components/KasirScreen.tsx`
- Modify: `src/components/KasirInvoiceModal.tsx`

**Interfaces:**
- Consumes: `DiscountInlineInput`, `DiscountRow`, `useDiscountBinding`, `computeDiscountAmount` from `src/components/ui/discount`. `tenantSettingsService` for toggle gate.
- Produces:
  - Each cart row in Kasir gets a Diskon column (DiscountInlineInput) wired via `useDiscountBinding(masterPrice, qty)`. Row's `unit_price` field stays editable; both paths converge.
  - Total bar gets DiscountRow above Total.
  - Invoice modal PDF shows "Diskon" row when `discount_amount_rp > 0`.
  - Hide UI when `tenant_settings.modul_diskon_kasir = false` (subscribe in useEffect; default visible).
  - On Simpan, pass `discount: { discount_type, discount_value, discount_amount_rp }` to `recordKasirSale`.

- [ ] **Step 1: Inspect current Kasir state shape**

```bash
grep -n "items\|cart\|setCart\|useState" /Users/tonywei/IdeaProjects/ERPAntigravity/src/components/KasirScreen.tsx | head -30
```
Note: where does Kasir hold cart state? Inline rows? Custom hook?

- [ ] **Step 2: Add discount UI to cart row**

Wherever each cart line is rendered (likely inside a `.map` of `items`), wrap the unit_price input with `useDiscountBinding`:

```tsx
// At top of file
import { DiscountInlineInput, useDiscountBinding } from './ui/discount';

// Inside row component (refactor inline if needed — extract <KasirCartRow item ... /> if rendering gets dense):
function KasirCartRow({ item, modulOn, onUpdate, ... }) {
  const binding = useDiscountBinding(item.master_price_at_sale, item.qty, {
    discount_type: item.discount_type,
    discount_value: item.discount_value,
    discount_amount_rp: item.discount_amount_rp,
  });

  // When user types in price input:
  const handlePriceChange = (v: number) => {
    binding.setTypedPrice(v);
    onUpdate({
      ...item,
      unit_price: item.master_price_at_sale, // stored as master
      discount_type: binding.state.discount_type,
      discount_value: binding.state.discount_value,
      discount_amount_rp: binding.state.discount_amount_rp,
    });
  };

  // When user changes discount:
  const handleDiscountChange = (value: number | null, type: DiscountType) => {
    binding.setDiscountFromInput(value, type);
    // setState via parent onUpdate (next render will reflect binding.state)
    onUpdate({
      ...item,
      unit_price: item.master_price_at_sale,
      discount_type: type,
      discount_value: value,
      discount_amount_rp: computeDiscountAmount(value, type, item.master_price_at_sale * item.qty),
    });
  };

  return (
    <tr>
      {/* ...product cell, qty cell... */}
      <td>
        <div className="text-[10px] text-slate-400 uppercase">List Rp {fmtRp(item.master_price_at_sale)}</div>
        <input
          type="number"
          value={binding.state.typed_price}
          onChange={(e) => handlePriceChange(Number(e.target.value))}
        />
      </td>
      {modulOn && (
        <td>
          <DiscountInlineInput
            value={binding.state.discount_value}
            type={binding.state.discount_type}
            base={item.master_price_at_sale * item.qty}
            onChange={handleDiscountChange}
          />
        </td>
      )}
      <td>Rp {fmtRp(item.master_price_at_sale * item.qty - binding.state.discount_amount_rp)}</td>
    </tr>
  );
}
```

Adapt to existing KasirScreen structure. If KasirScreen renders rows inline (not extracted), inline the binding-aware logic where the input lives.

- [ ] **Step 3: Add DiscountRow to total bar**

In the total area of Kasir (where Subtotal / Ongkir / Total render):
```tsx
{modulOn && (
  <DiscountRow
    label="Diskon Order"
    value={orderDiscountValue}
    type={orderDiscountType}
    base={subtotal} // subtotal AFTER line discounts
    onChange={(v, t) => { setOrderDiscountValue(v); setOrderDiscountType(t); }}
  />
)}
```

Add `orderDiscountValue` / `orderDiscountType` state with `useState<number | null>(null)` / `useState<DiscountType>(null)`. Recompute `total = subtotal - orderDiscountAmount + ongkir`.

- [ ] **Step 4: Gate UI on tenant_settings**

At top of KasirScreen:
```tsx
const [modulOn, setModulOn] = useState(true);
useEffect(() => {
  tenantSettingsService.fetch().then(s => setModulOn(s?.modul_diskon_kasir ?? true));
}, []);
```

- [ ] **Step 5: Pass discount to RPC on Simpan**

In the submit handler, pass:
```ts
await recordKasirSale({
  // ... existing args ...
  discount: {
    discount_type: orderDiscountType,
    discount_value: orderDiscountValue,
    discount_amount_rp: computeDiscountAmount(orderDiscountValue, orderDiscountType, subtotal),
  },
});
```
Also ensure `items` array (passed to RPC) includes per-line `master_price_at_sale`, `discount_type`, `discount_value`, `discount_amount_rp` — set on each cart row when adding/editing.

- [ ] **Step 6: Update `KasirInvoiceModal` PDF/struk**

Edit `src/components/KasirInvoiceModal.tsx`. After the items table, before TOTAL row, add (font 11px per `feedback_font_sizing.md`):
```tsx
{(transaction.discount_amount_rp > 0 || (transaction.items ?? []).some(i => i.discount_amount_rp > 0)) && (
  <div className="flex justify-between text-[11px] text-orange-700">
    <span>{transaction.discount_type === 'PERCENT' ? `Diskon Order (${transaction.discount_value}%)` : 'Diskon Order'}</span>
    <span>− Rp {fmtRp(transaction.discount_amount_rp + sumLineDiscounts(transaction.items))}</span>
  </div>
)}
```

- [ ] **Step 7: Run typecheck + tests**

```bash
npm run lint
npm test src
```

- [ ] **Step 8: Manual smoke — dev server**

```bash
npm run dev
```
- Open Kasir, add 3 items, edit Harga of one to lower (Path B). Verify Diskon column auto-fills.
- Add a % discount via DiscountInlineInput on another (Path A). Verify Harga auto-updates.
- Set Diskon Order to Rp 30k. Verify Total = subtotal − 30k.
- Klik Simpan. Verify success toast + invoice modal shows Diskon row.
- Verify backend: `SELECT * FROM kasir_transactions ORDER BY created_at DESC LIMIT 1;` shows discount cols populated.

Document in progress.md.

- [ ] **Step 9: Commit**

```bash
git add src/components/KasirScreen.tsx src/components/KasirInvoiceModal.tsx progress.md
git commit -m "feat(diskon): Task 14 — Kasir cart/total/struk + bidirectional binding"
```

Progress.md: `- ✅ Diskon Task 14: Kasir UI + struk PDF. Path A + Path B verified.`

---

### Task 15: Wizard UI — Step 2 + Step 3 + invoice PDF

**Files:**
- Modify: `src/components/penjualan/CartRows.tsx`
- Modify: `src/components/penjualan/wizard/Step2Items.tsx`
- Modify: `src/components/penjualan/wizard/Step3Payment.tsx`
- Modify: `src/components/penjualan/SalesInvoicePDF.tsx`
- Modify: `src/components/penjualan/InvoicePreviewScreen.tsx`

**Interfaces:**
- Consumes: same shared primitives as Task 14, plus `tenant_settings.modul_diskon_penjualan` toggle.
- Produces: identical UX to Kasir for line discount; order-level discount lives in Step 3 above Total; PDF shows Diskon row; payload passed to TEMPO RPC (Task 11) and `recordKasirSale` (Task 10) for DP/Lunas paths.

- [ ] **Step 1: Add Diskon column to `CartRows`**

Mirror Task 14 Step 2 pattern. Wherever the row renders (likely an `items.map` inside CartRows). Add `<DiscountInlineInput>` next to the price column, gated on `props.modulOn` (pass down from parent).

- [ ] **Step 2: Update `Step2Items.tsx` to fetch + pass `modulOn`**

```tsx
useEffect(() => {
  tenantSettingsService.fetch().then(s => setModulOn(s?.modul_diskon_penjualan ?? true));
}, []);

// pass modulOn={modulOn} to CartRows
```

- [ ] **Step 3: Add `DiscountRow` to `Step3Payment.tsx`**

Inside the total bar JSX:
```tsx
{modulOn && (
  <DiscountRow
    label="Diskon Order"
    value={orderDiscount.value}
    type={orderDiscount.type}
    base={subtotalAfterLine}
    onChange={(v, t) => onOrderDiscountChange({ value: v, type: t, amount_rp: computeDiscountAmount(v, t, subtotalAfterLine) })}
  />
)}
```

Lift `orderDiscount` state to the wizard's parent (`CatatPenjualanWizard.tsx`) so it persists across step navigation.

- [ ] **Step 4: Pass discount to RPC on submit**

In wizard submit handler:
- TEMPO path: include in `createTempoInvoice` payload's top-level + per-item.
- DP/Lunas path: pass via `recordKasirSale`'s `discount` arg.

- [ ] **Step 5: Update `SalesInvoicePDF.tsx`**

Add Diskon row (font 11px) before Total, similar to Task 14 Step 6.

- [ ] **Step 6: Update `InvoicePreviewScreen.tsx`**

Add same Diskon row in the on-screen preview.

- [ ] **Step 7: Lint + test**

```bash
npm run lint
npm test src
```

- [ ] **Step 8: Manual smoke**

```bash
npm run dev
```
Wizard flow: 3 items, line discount 10% on one, order discount Rp 50k, save TEMPO. Verify invoice PDF + DB row.

- [ ] **Step 9: Commit**

```bash
git add src/components/penjualan/CartRows.tsx src/components/penjualan/wizard/Step2Items.tsx src/components/penjualan/wizard/Step3Payment.tsx src/components/penjualan/SalesInvoicePDF.tsx src/components/penjualan/InvoicePreviewScreen.tsx progress.md
git commit -m "feat(diskon): Task 15 — Wizard Step 2/3 + invoice PDF preview"
```

Progress.md: `- ✅ Diskon Task 15: Wizard UI Step 2/3 + PDF.`

---

### Task 16: Tagihan PI UI — form + detail

**Files:**
- Modify: `src/components/pembelian/tagihan/TagihanFormPage.tsx`
- Modify: `src/components/pembelian/tagihan/TagihanDetailPage.tsx`

**Interfaces:**
- Consumes: shared primitives, `tenant_settings.modul_diskon_tagihan`.
- Produces: form has line discount column per item + order discount in total bar; detail page displays line + order discount.

- [ ] **Step 1: Inspect current TagihanFormPage structure**

```bash
grep -n "items\|unit_cost\|discount\|total" /Users/tonywei/IdeaProjects/ERPAntigravity/src/components/pembelian/tagihan/TagihanFormPage.tsx | head -30
```

- [ ] **Step 2: Wire line-level discount in items table**

Per item row in the form, add:
```tsx
<DiscountInlineInput
  value={item.discount_value}
  type={item.discount_type}
  base={item.unit_cost * item.qty}
  onChange={(v, t) => updateItem(i, {
    ...item,
    discount_type: t,
    discount_value: v,
    discount_amount_rp: computeDiscountAmount(v, t, item.unit_cost * item.qty),
    master_unit_cost: item.master_unit_cost ?? item.unit_cost,
  })}
  disabled={!modulOn}
/>
```

Display "List Rp …" label above unit_cost input (master cost reference).

- [ ] **Step 3: Add DiscountRow for order-level in form total bar**

```tsx
{modulOn && (
  <DiscountRow
    label="Diskon Tagihan"
    value={orderDiscountValue}
    type={orderDiscountType}
    base={subtotalAfterLine}
    onChange={(v, t) => { setOrderDiscountValue(v); setOrderDiscountType(t); }}
  />
)}
```

Recompute total: `subtotalAfterLine − orderDiscountAmount`.

- [ ] **Step 4: Pass discount to `record_pi` RPC on submit**

Build payload:
```ts
const payload = {
  // ... existing
  items: items.map(i => ({
    ...i,
    master_unit_cost: i.master_unit_cost ?? i.unit_cost,
  })),
  discount_type: orderDiscountType,
  discount_value: orderDiscountValue,
  discount_amount_rp: computeDiscountAmount(orderDiscountValue, orderDiscountType, subtotalAfterLine),
};
const { data, error } = await supabase.rpc('record_pi', { payload });
```

- [ ] **Step 5: Update TagihanDetailPage to show discount info**

```tsx
{pi.discount_amount_rp > 0 && (
  <div className="flex justify-between text-[12px] text-orange-700">
    <span>Diskon Tagihan{pi.discount_type === 'PERCENT' ? ` (${pi.discount_value}%)` : ''}</span>
    <span>− Rp {fmtRp(pi.discount_amount_rp)}</span>
  </div>
)}
{/* per-item discount inside items table — add column when any item has discount_amount_rp > 0 */}
```

- [ ] **Step 6: Lint + test + manual smoke**

```bash
npm run lint
npm test src
npm run dev
```
Manual: open Pembelian → Tagihan baru, input item dengan master Rp 200k qty 50, edit unit_cost ke 180k (Path B). Verify Diskon column auto-fill Rp 1M. Add order discount 3%. Verify total = 14M − 420k = 13.58M. Save. Verify DB row + journal 5-1900.

- [ ] **Step 7: Commit**

```bash
git add src/components/pembelian/tagihan/TagihanFormPage.tsx src/components/pembelian/tagihan/TagihanDetailPage.tsx progress.md
git commit -m "feat(diskon): Task 16 — Tagihan PI form + detail dengan diskon"
```

Progress.md: `- ✅ Diskon Task 16: Tagihan PI UI + 5-1900 journal verified.`

---

### Task 17: Integration E2E + final regression sweep

**Files:**
- Create: `tests/integration/diskon.spec.ts` (or extend existing pattern in `tests/integration/`).
- Modify: `progress.md`.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: integration test file exercising 4 end-to-end scenarios; full test suite green; manual checklist documented.

- [ ] **Step 1: Inspect existing integration test pattern**

```bash
ls /Users/tonywei/IdeaProjects/ERPAntigravity/tests/integration/ 2>/dev/null
head -50 /Users/tonywei/IdeaProjects/ERPAntigravity/tests/integration/*.ts 2>/dev/null | head -80
```

- [ ] **Step 2: Write integration test (kasir + tempo + PI happy paths)**

Create `tests/integration/diskon.spec.ts`:
```ts
import { describe, expect, test, beforeAll } from 'vitest';
import { supabase } from '../../src/lib/supabaseClient';

describe('Diskon — integration', () => {
  beforeAll(async () => {
    // Login as Owner (mirror existing pattern in tests/integration)
  });

  test('Kasir Path B: edit harga lower → discount auto-translated + journaled', async () => {
    // 1. Call recordKasirSale with items where master_price_at_sale > unit_price.
    // 2. Verify kasir_transactions row stored with discount_amount_rp > 0.
    // 3. (If dual-write active) Verify journal_entry_lines has 4-1900 debit.
  });

  test('Wizard TEMPO: order discount 5% saved, invoice PDF row visible', async () => {
    // 1. Call createTempoInvoice with order-level discount 5%.
    // 2. Verify orders.discount_* populated; orders.total reflects discount.
  });

  test('Tagihan PI: order discount 3% saved, journal 5-1900 credit', async () => {
    // 1. Call record_pi with order discount 3% AMOUNT.
    // 2. Verify purchase_invoices row + journal credit.
  });

  test('Pengaturan toggle OFF still accepts existing data', async () => {
    // 1. Set modul_diskon_kasir = false via set_tenant_modul.
    // 2. Call recordKasirSale with discount payload — should succeed (backward-compat).
    // 3. Set back to true.
  });
});
```

Fill in implementation per existing tests in `tests/integration/` (they show the test-fixture pattern for this project).

- [ ] **Step 3: Run integration suite**

```bash
npm run test:integration
```
Expected: 4 tests PASS.

- [ ] **Step 4: Run full unit test sweep**

```bash
npm test
npm run lint
```
Expected: green.

- [ ] **Step 5: PDF visual check (manual)**

Generate 3 sample invoices (Kasir struk, Sales invoice, PI doc if it has PDF) via dev server. Each transaction should include a discount > 0. Verify:
- Diskon row visible.
- Layout not broken.
- Font sizing 11-12px per `feedback_font_sizing.md`.
- Per-line discount reflected in unit price (already baked in master − discount_amount_rp / qty).

Save 3 screenshots to `docs/screenshots/diskon-kasir-struk.png`, `docs/screenshots/diskon-sales-invoice.png`, `docs/screenshots/diskon-pi-detail.png`.

- [ ] **Step 6: Founder smoke acceptance**

Run through the founder acceptance checklist (mockup Frame 8). Confirm each. Note any UX surprise in progress.md.

- [ ] **Step 7: Commit**

```bash
git add tests/integration/diskon.spec.ts docs/screenshots/diskon-*.png progress.md
git commit -m "test(diskon): Task 17 — integration E2E + visual PDF verification"
```

Progress.md: `- ✅ Diskon Task 17: integration 4/4 pass; PDF visual + founder smoke accepted. Feature shippable.`

---

## Spec Coverage Self-Review

| Spec section | Covered by task |
|---|---|
| §3 Architecture Overview | Task 1 (schema) + Tasks 10-12 (RPC validation) + Tasks 14-16 (UI) |
| §3.1 Bidirectional UX | Task 6 (hook) + Task 14 (Kasir) + Task 15 (Wizard) + Task 16 (Tagihan) |
| §4.1 Triple kolom + CHECK | Task 1 |
| §4.2 4 tables impacted | Task 1 |
| §4.3 JSONB shape | Task 1 (comment) + Tasks 10-11 (RPC validate JSONB shape) |
| §4.4 Subtotal/total formula | Tasks 10-12 (RPC recompute) + Tasks 14-16 (UI subtotal display) |
| §4.5 Pengaturan toggles | Task 3 (schema) + Task 4 (types) + Task 9 (UI) |
| §5.1 Kasir UI + RPC | Task 10 + Task 14 |
| §5.2 Wizard UI + RPC | Task 11 + Task 15 |
| §5.3 Tagihan PI UI + RPC | Task 12 + Task 16 |
| §5.4 Shared frontend | Tasks 5-8 |
| §5.5 Pengaturan panel | Task 9 |
| §6.0 Dual-write koordinasi | Task 10 (Kasir 4-1900) + Task 11 (TODO note) + Task 12 (PI 5-1900) |
| §6.1 Sales journal | Task 10 |
| §6.2 Pembelian journal | Task 12 |
| §6.3 Pembayaran existing | (no task — explicitly out-of-scope §2.2) |
| §7 Pengawasan view rewrite | Task 13 |
| §8 Testing | Tasks 5-8 (unit) + Tasks 10-12 (smoke matrix) + Task 13 (view regression) + Task 17 (integration + visual) |
| §9 Migration & rollout | Tasks 1-3 + 10-13 (slot 20260801xxxxxx) |
| §11 Founder memory | Global Constraints + Task 1 Step 1 (CHECK enumeration) + Task 14 Step 6 / Task 15 Step 5 (font) |

All in-scope items have at least one task. Out-of-scope items (per §2.2) are intentionally absent.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-23-diskon-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
