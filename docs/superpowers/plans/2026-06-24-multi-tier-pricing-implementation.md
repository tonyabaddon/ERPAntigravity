# Multi-Tier Pricing (Eceran + Grosir) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan multi-tier pricing (Eceran + Grosir) yang configurable via `modul_multi_tier_price`, sehingga toko tipe LTC Glodok (distributor B2B campur retail) bisa onboard tanpa custom code.

**Architecture:** Schema additif (kolom baru di `products`, `customers`, `tenant_settings`, transaction snapshots). Modul toggle = master switch via `cascadeMap`. Customer-driven auto-tier; bebas override di kasir + audit. Bulk CSV update grosir prices = atomic RPC + preview dialog.

**Tech Stack:** React + TypeScript + Tailwind, Supabase (Postgres + RPC SECURITY DEFINER), Vitest + RTL, jsdom env.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-24-multi-tier-pricing-design.md`. Every task implements a section; reference back when in doubt.
- Migration slot range: `20260901000001`–`20260901000099` (claimed; distant dari ongoing work per `project_parallel_terminals_worktree`).
- All DDL idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`).
- All RPC: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated`.
- Default `modul_multi_tier_price = FALSE` — Garindo & existing tests tidak boleh regress.
- TDD strict: RED test → run failing → implement → run passing → commit (per task, per behavior).
- Lint pass per task: `npm run lint` (tsc --noEmit clean).
- Tier values di seluruh codebase: literal `'eceran'` | `'grosir'` (no enum object). Konsisten dengan pattern existing `pajak_mode`.
- Tidak boleh expose tier di customer-facing print (SI/struk PDF) per spec §4.7.
- Soft-hide pada modul OFF: data tersimpan, UI hilang.
- Smoke RPC test pattern: pakai `set_config('request.jwt.claim.sub', ...)` + `RAISE EXCEPTION 'rollback'` di DO block, per `reference_smoke_test_security_definer_rpcs`.
- Setelah tiap task: update `progress.md` (per CLAUDE.md gotcha).

---

## File Structure

**Database migrations (slot 20260901xxxxxx) — REVISED 2026-06-24 (schema reality):**

Schema reality: product master = `stocks` (PK=sku text, not `products`). `customers.id` = text. Transaction items = JSONB array key inside `kasir_transactions.items` / `orders.items` (no `*_items` child tables). Plan migration list collapsed accordingly:

- `20260901000001_multi_tier_stocks_columns.sql` — stocks.price_grosir ✅ APPLIED
- `20260901000002_multi_tier_customers_columns.sql` — customers.default_pricing_tier ✅ APPLIED
- `20260901000003_multi_tier_tenant_settings_toggle.sql` — modul_multi_tier_price ✅ APPLIED
- `20260901000004_product_price_audit_table.sql` — audit ledger FK to stocks(sku) ✅ APPLIED
- `20260901000005_record_kasir_sale_tier.sql` — RPC patch (JSONB key)
- `20260901000006_create_tempo_invoice_tier.sql` — RPC patch (JSONB key)
- `20260901000007_bulk_update_grosir_price.sql` — RPC baru

Snapshot per-line tier disimpan sebagai JSONB key di `items` (pattern existing — sama dengan `master_price_at_sale`, `discount_*`). Tidak ada `*_items` table; tidak ada ALTER snapshot column.

**TypeScript types & cascadeMap:**
- `src/types.ts` — extend StockItem, Customer, DbTenantSettings, ModulSwitchKey, transaction line types
- `src/lib/pengaturan/cascadeMap.ts` — add FieldKey entries

**UI components (modify existing):**
- `src/components/pengaturan/ModulSwitchesPanel.tsx`
- `src/components/StockManagerScreen.tsx` (or sub-component yang menampilkan tabel produk)
- `src/components/PelangganScreen.tsx`
- `src/components/KasirScreen.tsx` (+ KasirInvoiceModal)
- `src/components/penjualan/Step2Items.tsx`

**UI components (new):**
- `src/components/produk/BulkUpdateGrosirSection.tsx` — CSV download/upload/preview/apply

**RPC wrappers (TS):**
- `src/lib/supabaseClient.ts` — extend `stockService.update`, add `bulkUpdateGrosirPrice` wrapper
- `src/lib/kasirService.ts` (or wherever record_kasir_sale wrapper lives) — accept tier per line
- `src/lib/piutangService.ts` (wrapper untuk createTempoInvoice) — accept tier per line

---

## Task Index

1. Schema migrations (products + customers + tenant_settings + snapshot + audit table)
2. TypeScript types + cascadeMap entries + lint
3. Pengaturan: `modul_multi_tier_price` toggle in ModulSwitchesPanel
4. Master Produk: dual price columns + warning + edit form
5. Master Customer: tier dropdown + filter + service wrapper
6. RPC `record_kasir_sale` patch (tier per line)
7. Kasir UI: pill toggle + auto-apply + re-compute
8. RPC `create_tempo_invoice` patch (tier per line)
9. Wizard Step 2: pill toggle + auto-apply + re-compute
10. RPC `bulk_update_grosir_price` + audit ledger writes
11. BulkUpdateGrosirSection component (template + parse + preview)
12. Wire bulk upload into StockManagerScreen + integration test sweep

---

### Task 1: Schema migrations (foundation)

**Files:**
- Create: `supabase/migrations/20260901000001_multi_tier_products_columns.sql`
- Create: `supabase/migrations/20260901000002_multi_tier_customers_columns.sql`
- Create: `supabase/migrations/20260901000003_multi_tier_tenant_settings_toggle.sql`
- Create: `supabase/migrations/20260901000004_multi_tier_snapshot_columns.sql`
- Create: `supabase/migrations/20260901000005_product_price_audit_table.sql`

**Interfaces:**
- Produces: 5 idempotent DDL files; column names `price_grosir`, `default_pricing_tier`, `modul_multi_tier_price`, `pricing_tier_used`; table `product_price_audit`.

- [ ] **Step 1: Write migration 20260901000001 (products)**

Create `supabase/migrations/20260901000001_multi_tier_products_columns.sql`:

```sql
-- Multi-tier pricing — add price_grosir column to products.
-- price (existing) tetap = harga eceran (backward-compat).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_grosir NUMERIC(14,2) NULL;

COMMENT ON COLUMN public.products.price_grosir IS
  'Harga jual tier grosir. NULL = fallback ke price (eceran) saat transaksi tier=grosir, dengan warning UI.';
```

- [ ] **Step 2: Write migration 20260901000002 (customers)**

Create `supabase/migrations/20260901000002_multi_tier_customers_columns.sql`:

```sql
-- Multi-tier pricing — add default_pricing_tier flag per customer.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS default_pricing_tier TEXT NOT NULL DEFAULT 'eceran';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_default_pricing_tier_check'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_default_pricing_tier_check
      CHECK (default_pricing_tier IN ('eceran','grosir'));
  END IF;
END $$;
```

- [ ] **Step 3: Write migration 20260901000003 (tenant_settings toggle)**

Create `supabase/migrations/20260901000003_multi_tier_tenant_settings_toggle.sql`:

```sql
-- Multi-tier pricing modul toggle. Default FALSE — existing tenant tidak berubah.
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS modul_multi_tier_price BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 4: Write migration 20260901000004 (snapshot columns)**

Create `supabase/migrations/20260901000004_multi_tier_snapshot_columns.sql`:

```sql
-- Multi-tier pricing — record which tier was used per line for audit.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS pricing_tier_used TEXT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_items_pricing_tier_used_check'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_pricing_tier_used_check
      CHECK (pricing_tier_used IS NULL OR pricing_tier_used IN ('eceran','grosir'));
  END IF;
END $$;

ALTER TABLE public.kasir_transaction_items
  ADD COLUMN IF NOT EXISTS pricing_tier_used TEXT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kasir_transaction_items_pricing_tier_used_check'
  ) THEN
    ALTER TABLE public.kasir_transaction_items
      ADD CONSTRAINT kasir_transaction_items_pricing_tier_used_check
      CHECK (pricing_tier_used IS NULL OR pricing_tier_used IN ('eceran','grosir'));
  END IF;
END $$;
```

- [ ] **Step 5: Write migration 20260901000005 (audit table)**

Create `supabase/migrations/20260901000005_product_price_audit_table.sql`:

```sql
-- Audit ledger for price changes (both manual edit + bulk CSV).
CREATE TABLE IF NOT EXISTS public.product_price_audit (
  id           BIGSERIAL PRIMARY KEY,
  product_id   UUID NOT NULL REFERENCES public.products(id),
  sku          TEXT NOT NULL,
  field        TEXT NOT NULL,
  old_value    NUMERIC(14,2),
  new_value    NUMERIC(14,2),
  source       TEXT NOT NULL,
  actor        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_price_audit_field_check'
  ) THEN
    ALTER TABLE public.product_price_audit
      ADD CONSTRAINT product_price_audit_field_check
      CHECK (field IN ('price','price_grosir'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_price_audit_source_check'
  ) THEN
    ALTER TABLE public.product_price_audit
      ADD CONSTRAINT product_price_audit_source_check
      CHECK (source IN ('manual_edit','bulk_csv','rpc'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_price_audit_sku_time
  ON public.product_price_audit(sku, created_at DESC);

ALTER TABLE public.product_price_audit ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'product_price_audit' AND policyname = 'authenticated read audit'
  ) THEN
    CREATE POLICY "authenticated read audit"
      ON public.product_price_audit FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

GRANT SELECT ON public.product_price_audit TO authenticated;
```

- [ ] **Step 6: Apply migrations via MCP + smoke verify**

Apply each migration in order via Supabase MCP `apply_migration` tool. Then smoke-verify each:

```sql
-- Smoke: verify columns/tables exist
SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name='price_grosir';
SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='default_pricing_tier';
SELECT column_name FROM information_schema.columns WHERE table_name='tenant_settings' AND column_name='modul_multi_tier_price';
SELECT column_name FROM information_schema.columns WHERE table_name='order_items' AND column_name='pricing_tier_used';
SELECT column_name FROM information_schema.columns WHERE table_name='kasir_transaction_items' AND column_name='pricing_tier_used';
SELECT to_regclass('public.product_price_audit') IS NOT NULL AS audit_exists;
```

Expected: 6 rows, all confirming presence.

- [ ] **Step 7: Verify Garindo tenant still default OFF**

```sql
SELECT modul_multi_tier_price FROM tenant_settings;
```

Expected: `false`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260901000001_multi_tier_products_columns.sql \
        supabase/migrations/20260901000002_multi_tier_customers_columns.sql \
        supabase/migrations/20260901000003_multi_tier_tenant_settings_toggle.sql \
        supabase/migrations/20260901000004_multi_tier_snapshot_columns.sql \
        supabase/migrations/20260901000005_product_price_audit_table.sql
git commit -m "feat(multi-tier): schema foundation (products.price_grosir, customers.default_pricing_tier, tenant_settings toggle, snapshots, audit table)"
```

- [ ] **Step 9: Update progress.md**

Append entry: "Task 1 DONE — 5 schema migrations applied, default OFF preserved."

---

### Task 2: TypeScript types + cascadeMap entries

**Files:**
- Modify: `src/types.ts` (StockItem, Customer-related types, DbTenantSettings, ModulSwitchKey, kasir/order item line types)
- Modify: `src/lib/pengaturan/cascadeMap.ts`

**Interfaces:**
- Consumes: schema columns from Task 1.
- Produces:
  - `StockItem.price_grosir?: number | null`
  - `Customer.default_pricing_tier?: 'eceran' | 'grosir'` (default `'eceran'`)
  - `DbTenantSettings.modul_multi_tier_price: boolean`
  - `ModulSwitchKey` extended with `'modul_multi_tier_price'`
  - cascadeMap `FieldKey` extended with `'tier_pill_kasir'`, `'tier_dropdown_customer'`, `'price_grosir_column'`, `'csv_bulk_grosir_button'`
  - `isFieldVisible` returns `settings.modul_multi_tier_price` for those keys

- [ ] **Step 1: Locate Customer + ModulSwitchKey definitions**

Run: `grep -n "Customer\|ModulSwitchKey\|DbTenantSettings" src/types.ts | head -40`
Expected: find the type declarations.

- [ ] **Step 2: Extend StockItem**

In `src/types.ts`, find the `StockItem` interface (around line 158-178 per earlier audit) and add a field after `price`:

```ts
price_grosir?: number | null;
```

- [ ] **Step 3: Extend Customer-related type**

Find Customer type (search `customer.*default_pricing_tier` adjacent). Add field:

```ts
default_pricing_tier?: 'eceran' | 'grosir';
```

If Customer type lives in a typed-as-DbCustomer struct, add same field there too. Use grep `interface .*Customer\|type .*Customer` to find all.

- [ ] **Step 4: Extend DbTenantSettings + ModulSwitchKey**

In `DbTenantSettings`:
```ts
modul_multi_tier_price: boolean;
```

In `ModulSwitchKey` union, append:
```ts
| 'modul_multi_tier_price'
```

- [ ] **Step 5: Extend transaction item line types**

Find `OrderItem`-ish and `KasirTransactionItem`-ish types. Add to both:
```ts
pricing_tier_used?: 'eceran' | 'grosir' | null;
```

- [ ] **Step 6: Extend cascadeMap FieldKey + isFieldVisible**

In `src/lib/pengaturan/cascadeMap.ts`:

```ts
export type FieldKey =
  | 'ppn_line' | 'pph_final_footnote'
  | 'tempo_chip' | 'allows_tempo_field' | 'credit_limit_field'
  | 'ongkir_field' | 'warehouse_picker'
  | 'rakit_buttons' | 'walkin_channel'
  | 'tier_pill_kasir' | 'tier_dropdown_customer'
  | 'price_grosir_column' | 'csv_bulk_grosir_button';
```

And in `isFieldVisible`, before `default:`:
```ts
case 'tier_pill_kasir':
case 'tier_dropdown_customer':
case 'price_grosir_column':
case 'csv_bulk_grosir_button':
  return settings.modul_multi_tier_price;
```

- [ ] **Step 7: Write cascadeImpactSummary for the new modul**

Find `cascadeImpactSummary` switch. Before `default:` add:

```ts
case 'modul_multi_tier_price':
  if ((stats.tierEnabledCustomerCount ?? 0) > 0)
    return { level: 'warn',
      message: `${stats.tierEnabledCustomerCount} customer ter-tag grosir akan kembali jadi harga eceran; data tetap tersimpan` };
  return { level: 'info', message: 'Belum ada customer grosir — aman dimatikan' };
```

Also extend `UsageStats` interface:
```ts
tierEnabledCustomerCount?: number;
```

- [ ] **Step 8: Write the failing test for cascadeMap**

Create `src/lib/pengaturan/cascadeMap.test.ts` (append if exists, otherwise create):

```ts
import { describe, it, expect } from 'vitest';
import { isFieldVisible, cascadeImpactSummary } from './cascadeMap';

describe('cascadeMap multi-tier pricing', () => {
  const onSettings = { modul_multi_tier_price: true } as any;
  const offSettings = { modul_multi_tier_price: false } as any;

  it('hides tier_pill_kasir when modul OFF', () => {
    expect(isFieldVisible('tier_pill_kasir', offSettings)).toBe(false);
  });
  it('shows tier_pill_kasir when modul ON', () => {
    expect(isFieldVisible('tier_pill_kasir', onSettings)).toBe(true);
  });
  it('shows price_grosir_column when modul ON', () => {
    expect(isFieldVisible('price_grosir_column', onSettings)).toBe(true);
  });
  it('shows csv_bulk_grosir_button when modul ON', () => {
    expect(isFieldVisible('csv_bulk_grosir_button', onSettings)).toBe(true);
  });
  it('cascadeImpactSummary warns when customers tagged grosir', () => {
    const summary = cascadeImpactSummary('modul_multi_tier_price' as any, { tierEnabledCustomerCount: 12 });
    expect(summary.level).toBe('warn');
    expect(summary.message).toMatch(/12 customer/);
  });
  it('cascadeImpactSummary info when no grosir customer', () => {
    const summary = cascadeImpactSummary('modul_multi_tier_price' as any, {});
    expect(summary.level).toBe('info');
  });
});
```

- [ ] **Step 9: Run test → RED**

Run: `npx vitest run src/lib/pengaturan/cascadeMap.test.ts`
Expected: tests FAIL (the new FieldKey not yet handled OR new ModulSwitchKey not recognized in summary).

(If test already passes because step 6/7 implemented, that's fine — TDD is a discipline tool, not theatre. Move to step 10.)

- [ ] **Step 10: Run test → GREEN**

Run: `npx vitest run src/lib/pengaturan/cascadeMap.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 11: Lint**

Run: `npm run lint`
Expected: PASS (tsc --noEmit clean).

- [ ] **Step 12: Commit + progress.md**

```bash
git add src/types.ts src/lib/pengaturan/cascadeMap.ts src/lib/pengaturan/cascadeMap.test.ts
git commit -m "feat(multi-tier): types + cascadeMap entries + tests"
```

Append progress.md: "Task 2 DONE — types + cascadeMap (6 tests PASS, lint clean)."

---

### Task 3: Pengaturan toggle — `modul_multi_tier_price` in ModulSwitchesPanel

**Files:**
- Modify: `src/components/pengaturan/ModulSwitchesPanel.tsx`
- Modify: `src/lib/pengaturan/pengaturanServices.ts` (kalau `updateModul` perlu register key — biasanya generic, cek dulu)
- Test: `src/components/pengaturan/ModulSwitchesPanel.test.tsx` (create if not exists, otherwise append)

**Interfaces:**
- Consumes: `ModulSwitchKey` includes `modul_multi_tier_price` (Task 2).
- Produces: UI toggle baru di Pengaturan → Modul & Jasa.

- [ ] **Step 1: Read current MODULS array**

Run: `grep -n "MODULS\s*=\s*\[" src/components/pengaturan/ModulSwitchesPanel.tsx`
Identify line of the array literal.

- [ ] **Step 2: Append modul entry**

In `MODULS` array (after `modul_diskon_tagihan`), append:

```ts
  { key: 'modul_multi_tier_price', icon: '💵', title: 'Modul Multi-Tier Pricing',
    description: 'Aktifkan harga grosir terpisah dari eceran. Customer dapat di-tag tier default; kasir bebas switch.' },
```

- [ ] **Step 3: Verify `tenantSettingsService.updateModul` accepts the new key**

Run: `grep -n "updateModul" src/lib/pengaturan/pengaturanServices.ts`
Read the function. If it's typed as `(key: ModulSwitchKey, value: boolean)` — Task 2 already extended the union, so no change needed.
If it does a hardcoded whitelist switch, add `'modul_multi_tier_price'` to it.

- [ ] **Step 4: Write the failing RTL test**

Create or append `src/components/pengaturan/ModulSwitchesPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ModulSwitchesPanel from './ModulSwitchesPanel';
import * as services from '../../lib/pengaturan/pengaturanServices';

vi.mock('../../lib/pengaturan/pengaturanServices', () => ({
  tenantSettingsService: {
    fetch: vi.fn(),
    updateModul: vi.fn(),
  },
}));

describe('ModulSwitchesPanel — multi-tier modul', () => {
  beforeEach(() => {
    (services as any).tenantSettingsService.fetch.mockResolvedValue({
      modul_kasir: true, modul_tempo: true, modul_pengiriman: true,
      modul_multi_warehouse: true, modul_akuntansi: true, modul_jasa_layanan: true,
      modul_bom_recipe: false, modul_diskon_kasir: false, modul_diskon_penjualan: false,
      modul_diskon_tagihan: false, modul_multi_tier_price: false,
    });
  });

  it('renders the Multi-Tier Pricing toggle row', async () => {
    render(<ModulSwitchesPanel showToast={vi.fn()} />);
    expect(await screen.findByText(/Multi-Tier Pricing/i)).toBeInTheDocument();
    expect(screen.getByText(/harga grosir terpisah/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test → RED → fix → GREEN**

Run: `npx vitest run src/components/pengaturan/ModulSwitchesPanel.test.tsx`
Expected: PASS after step 2.

- [ ] **Step 6: Lint + smoke (visual)**

Run: `npm run lint` → PASS.
(Manual smoke optional: `npm run dev`, navigate to Pengaturan → Modul & Jasa, scroll bawah, lihat row "Multi-Tier Pricing".)

- [ ] **Step 7: Commit + progress.md**

```bash
git add src/components/pengaturan/ModulSwitchesPanel.tsx \
        src/components/pengaturan/ModulSwitchesPanel.test.tsx \
        src/lib/pengaturan/pengaturanServices.ts
git commit -m "feat(multi-tier): modul toggle in Pengaturan ModulSwitchesPanel"
```

Append progress.md: "Task 3 DONE — Pengaturan toggle (RTL test PASS)."

---

### Task 4: Master Produk — dual price columns + warning + edit form

**Files:**
- Modify: `src/components/StockManagerScreen.tsx` (atau sub-component yg menampilkan tabel produk + edit form)
- Test: appropriate test file (RTL)

**Interfaces:**
- Consumes: `StockItem.price_grosir`, cascadeMap `'price_grosir_column'`.
- Produces: kolom & input grosir di Master Produk, hidden saat modul OFF.

- [ ] **Step 1: Locate table column definitions + edit form**

Run: `grep -n "harga\|price\|Harga" src/components/StockManagerScreen.tsx | head -30`
Identify:
- Column headers JSX
- Row cell rendering
- Edit form (kalau ada inline; bisa juga di modal terpisah `EditStockRow.tsx`)

- [ ] **Step 2: Fetch tenant_settings for visibility check**

Add at top of component (kalau belum):
```tsx
import { tenantSettingsService } from '../lib/pengaturan/pengaturanServices';
import { isFieldVisible } from '../lib/pengaturan/cascadeMap';

const [tenantSettings, setTenantSettings] = useState<DbTenantSettings | null>(null);
useEffect(() => {
  tenantSettingsService.fetch().then(setTenantSettings).catch(console.error);
}, []);
const showGrosir = tenantSettings ? isFieldVisible('price_grosir_column', tenantSettings) : false;
```

- [ ] **Step 3: Conditionally render Eceran/Grosir columns**

Where existing single "Harga" column lives, replace pattern:

```tsx
{showGrosir ? (
  <>
    <th className="...">Harga Eceran</th>
    <th className="...">Harga Grosir</th>
  </>
) : (
  <th className="...">Harga</th>
)}
```

For row cells:

```tsx
{showGrosir ? (
  <>
    <td>{formatRupiah(item.price)}</td>
    <td>
      {item.price_grosir == null
        ? <span className="text-amber-600 text-xs font-bold">⚠ Belum di-set</span>
        : formatRupiah(item.price_grosir)
      }
    </td>
  </>
) : (
  <td>{formatRupiah(item.price)}</td>
)}
```

- [ ] **Step 4: Add price_grosir input to edit form**

Find edit form. Add input (visible only `showGrosir`):

```tsx
{showGrosir && (
  <div>
    <label className="text-[11px] font-bold text-slate-500">Harga Grosir</label>
    <input type="number" value={editForm.price_grosir ?? ''}
      onChange={e => setEditForm({...editForm, price_grosir: e.target.value === '' ? null : Number(e.target.value)})}
      className="..." />
    {editForm.price_grosir != null && editForm.price_grosir > (editForm.price ?? 0) && (
      <p className="text-xs text-amber-600 mt-1">⚠ Harga grosir di atas eceran — tidak biasa. Pastikan benar.</p>
    )}
  </div>
)}
```

- [ ] **Step 5: Wire save handler**

In the existing save handler, include `price_grosir` in payload sent to `stockService.update` (or wherever).

Update `stockService.update` wrapper di `supabaseClient.ts` (cari) — add `price_grosir` to UPSERT payload. Audit log entry (source='manual_edit') untuk task ini optional (defer ke Task 10 dimana audit log RPC dibahas).

- [ ] **Step 6: Write the failing RTL test**

Create test (or append to existing `StockManagerScreen.test.tsx`):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
// ... appropriate imports + mocks ...

describe('StockManagerScreen — multi-tier columns', () => {
  it('hides Harga Grosir column when modul OFF', async () => {
    // Mock tenantSettingsService.fetch → { modul_multi_tier_price: false }
    render(<StockManagerScreen {...defaultProps} />);
    expect(await screen.findByText(/Harga/)).toBeInTheDocument();
    expect(screen.queryByText(/Harga Grosir/i)).not.toBeInTheDocument();
  });

  it('shows Eceran + Grosir columns when modul ON', async () => {
    // Mock tenantSettingsService.fetch → { modul_multi_tier_price: true }
    render(<StockManagerScreen {...defaultProps} />);
    expect(await screen.findByText(/Harga Eceran/i)).toBeInTheDocument();
    expect(await screen.findByText(/Harga Grosir/i)).toBeInTheDocument();
  });

  it('shows ⚠ Belum di-set when price_grosir is null and modul ON', async () => {
    // Mock with one item: price_grosir = null
    render(<StockManagerScreen {...propsWithNullGrosir} />);
    expect(await screen.findByText(/Belum di-set/i)).toBeInTheDocument();
  });
});
```

(Adapt mocks to actual props shape — read existing tests `*.test.tsx` for pattern.)

- [ ] **Step 7: Run test → RED → fix → GREEN**

Run: `npx vitest run src/components/StockManagerScreen.test.tsx` (or relevant)
Expected: 3/3 PASS.

- [ ] **Step 8: Lint**

Run: `npm run lint` → PASS.

- [ ] **Step 9: Commit + progress.md**

```bash
git add src/components/StockManagerScreen.tsx \
        src/components/StockManagerScreen.test.tsx \
        src/lib/supabaseClient.ts
git commit -m "feat(multi-tier): Master Produk dual price columns + warning + edit"
```

Append progress.md: "Task 4 DONE — Master Produk dual columns (3 RTL tests PASS)."

---

### Task 5: Master Customer — tier dropdown + filter

**Files:**
- Modify: `src/components/PelangganScreen.tsx`
- Modify: `src/lib/supabaseClient.ts` (customerService wrapper — add tier field)
- Test: `src/components/PelangganScreen.test.tsx` (create/append)

**Interfaces:**
- Consumes: `Customer.default_pricing_tier`, cascadeMap `'tier_dropdown_customer'`.
- Produces: dropdown saat create/edit; kolom + filter saat list.

- [ ] **Step 1: Locate customer form + list table**

Run: `grep -n "tier\|create.*customer\|edit.*customer" src/components/PelangganScreen.tsx | head -20`

- [ ] **Step 2: Fetch tenant_settings (kalau belum)**

Same pattern as Task 4 step 2: `tenantSettings` state + `showTierDropdown = isFieldVisible('tier_dropdown_customer', tenantSettings)`.

- [ ] **Step 3: Add tier dropdown to create/edit form**

```tsx
{showTierDropdown && (
  <div>
    <label className="text-[11px] font-bold text-slate-500">Tier Harga Default</label>
    <select value={form.default_pricing_tier ?? 'eceran'}
      onChange={e => setForm({...form, default_pricing_tier: e.target.value as 'eceran'|'grosir'})}
      className="...">
      <option value="eceran">Eceran (retail)</option>
      <option value="grosir">Grosir (reseller)</option>
    </select>
    <p className="text-[10px] text-slate-400 mt-1">Otomatis dipakai saat customer ini transaksi; kasir bebas switch.</p>
  </div>
)}
```

- [ ] **Step 4: Add tier column to list + filter chip**

In table header (kalau `showTierDropdown`): tambah `<th>Tier</th>`.
In row: `<td>{c.default_pricing_tier === 'grosir' ? <span className="badge-purple">Grosir</span> : <span className="badge-slate">Eceran</span>}</td>`.

Filter chip (above table):
```tsx
{showTierDropdown && (
  <div className="flex gap-2">
    <button onClick={() => setTierFilter('all')} className={tierFilter==='all'?'active':''}>Semua</button>
    <button onClick={() => setTierFilter('eceran')} className={tierFilter==='eceran'?'active':''}>Eceran</button>
    <button onClick={() => setTierFilter('grosir')} className={tierFilter==='grosir'?'active':''}>Grosir</button>
  </div>
)}
```

Filter list:
```tsx
const filtered = customers.filter(c =>
  tierFilter === 'all' || (c.default_pricing_tier ?? 'eceran') === tierFilter
);
```

- [ ] **Step 5: Wire customerService.upsert/save**

Cari di `supabaseClient.ts` wrapper customer save. Add `default_pricing_tier` to payload.

- [ ] **Step 6: Write the failing RTL test**

Create `src/components/PelangganScreen.test.tsx` (or append):

```tsx
describe('PelangganScreen — tier dropdown', () => {
  it('hides tier dropdown when modul OFF', async () => {
    // Mock modul_multi_tier_price: false
    render(<PelangganScreen ... />);
    expect(screen.queryByLabelText(/Tier Harga/i)).not.toBeInTheDocument();
  });

  it('shows tier dropdown with eceran default when modul ON', async () => {
    // Mock modul_multi_tier_price: true
    render(<PelangganScreen ... />);
    fireEvent.click(await screen.findByText(/Tambah Customer/i));
    const dropdown = await screen.findByLabelText(/Tier Harga/i);
    expect((dropdown as HTMLSelectElement).value).toBe('eceran');
  });

  it('filters customers by tier when modul ON', async () => {
    // Mock customers: 2 eceran, 1 grosir
    render(<PelangganScreen ... />);
    fireEvent.click(await screen.findByText(/Grosir/i));  // filter chip
    expect(screen.getAllByRole('row')).toHaveLength(2);  // header + 1 grosir
  });
});
```

- [ ] **Step 7: Run → GREEN, lint, commit**

```bash
npx vitest run src/components/PelangganScreen.test.tsx
npm run lint
git add src/components/PelangganScreen.tsx \
        src/components/PelangganScreen.test.tsx \
        src/lib/supabaseClient.ts
git commit -m "feat(multi-tier): customer tier dropdown + filter + persistence"
```

Append progress.md: "Task 5 DONE — Master Customer tier UI (3 RTL tests PASS)."

---

### Task 6: RPC `record_kasir_sale` — tier per line

**Files:**
- Create: `supabase/migrations/20260901000006_record_kasir_sale_tier.sql`
- Modify: `src/lib/supabaseClient.ts` (kasir wrapper) atau `src/lib/kasirService.ts`

**Interfaces:**
- Consumes: schema columns (Task 1), product master with `price_grosir` (Task 4).
- Produces: RPC `record_kasir_sale` menerima `pricing_tier_used` per line item; validates harga matches `price` or `COALESCE(price_grosir, price)` per tier.

- [ ] **Step 1: Read current RPC signature**

Find current `record_kasir_sale` definition via:
```sh
grep -n "CREATE OR REPLACE FUNCTION record_kasir_sale" supabase/migrations/2026080*.sql
```
Read latest variant — note its parameter count + payload structure (per discount task, 25-param). The current canonical lives in `20260801000004_record_kasir_sale_with_discount.sql`.

- [ ] **Step 2: Write migration 20260901000006**

Create `supabase/migrations/20260901000006_record_kasir_sale_tier.sql`. Pattern: CREATE OR REPLACE keeping same signature. Modify body to:
- Inside the per-line loop, read `v_item->>'pricing_tier_used'` into `v_tier_used` (text, nullable).
- Read tenant_settings.modul_multi_tier_price into `v_tier_modul_on`.
- If `v_tier_modul_on AND v_tier_used IS NOT NULL`:
  - Validate `v_tier_used IN ('eceran','grosir')`. Else RAISE EXCEPTION 'INVALID_TIER'.
  - Compute expected price: SELECT `CASE WHEN v_tier_used='grosir' THEN COALESCE(price_grosir, price) ELSE price END` from products WHERE sku=...
  - Validate `v_unit_price <= expected_price` (markup not allowed). Existing MARKUP_NOT_ALLOWED guard tetap berlaku; tier hanya mengubah baseline.
  - Validate `v_master_price_at_sale = expected_price` (snapshot konsisten). Else RAISE EXCEPTION 'TIER_PRICE_MISMATCH'.
- Persist `pricing_tier_used` ke INSERT statement `kasir_transaction_items`.

Skeleton (adapt to existing body):

```sql
CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  -- (... existing 25 params unchanged ...)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier_modul_on  boolean;
  v_tier_used      text;
  v_expected_price numeric;
  -- ... existing decls ...
BEGIN
  SELECT modul_multi_tier_price INTO v_tier_modul_on FROM tenant_settings LIMIT 1;

  -- ... existing pre-loop logic ...

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- ... existing per-line extract ...
    v_tier_used := v_item->>'pricing_tier_used';

    IF v_tier_modul_on AND v_tier_used IS NOT NULL THEN
      IF v_tier_used NOT IN ('eceran','grosir') THEN
        RAISE EXCEPTION 'INVALID_TIER: %', v_tier_used;
      END IF;
      SELECT CASE WHEN v_tier_used = 'grosir' THEN COALESCE(p.price_grosir, p.price) ELSE p.price END
        INTO v_expected_price
        FROM products p WHERE p.sku = v_item->>'sku';
      IF v_master_price IS DISTINCT FROM v_expected_price THEN
        RAISE EXCEPTION 'TIER_PRICE_MISMATCH: sku=%, tier=%, expected=%, got=%',
          v_item->>'sku', v_tier_used, v_expected_price, v_master_price;
      END IF;
    END IF;

    -- ... existing markup + discount validation ...

    INSERT INTO kasir_transaction_items (..., pricing_tier_used)
      VALUES (..., v_tier_used);
  END LOOP;

  -- ... rest unchanged ...
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(...) TO authenticated;
```

Match the exact param list of the existing function (do not change arity to avoid PostgREST cache invalidation issues; the current canonical is 25-param per Diskon Task 10).

- [ ] **Step 3: Apply migration via MCP**

Use `apply_migration` MCP tool.

- [ ] **Step 4: Smoke test — happy path (modul ON, tier=grosir)**

Use auth-faked smoke pattern (per `reference_smoke_test_security_definer_rpcs`):

```sql
DO $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '<existing-auth-uid>', true);
  -- Pre-condition: enable modul + ensure 1 product has price_grosir set
  UPDATE tenant_settings SET modul_multi_tier_price = TRUE;
  UPDATE products SET price_grosir = 800000 WHERE sku = '<existing-sku>';

  SELECT public.record_kasir_sale(
    -- (... matching 25-param call, items with pricing_tier_used='grosir' + master_price_at_sale=800000 ...)
  ) INTO v_result;

  RAISE NOTICE 'OK result=%', v_result;
  RAISE EXCEPTION 'rollback smoke';  -- triggers rollback per pattern
END $$;
```

Expected: NOTICE shows success result; final EXCEPTION rolls back.

- [ ] **Step 5: Smoke test — TIER_PRICE_MISMATCH**

Same pattern but pass `master_price_at_sale=900000` while expected=800000.
Expected: RAISE EXCEPTION 'TIER_PRICE_MISMATCH: ...'.

- [ ] **Step 6: Smoke test — INVALID_TIER**

Pass `pricing_tier_used='distributor'`.
Expected: RAISE EXCEPTION 'INVALID_TIER: distributor'.

- [ ] **Step 7: Smoke test — modul OFF ignores tier**

```sql
UPDATE tenant_settings SET modul_multi_tier_price = FALSE;
-- Pass pricing_tier_used='grosir' anyway.
-- Expected: succeeds (field ignored, stored as 'grosir' but no validation).
```

- [ ] **Step 8: Update TS wrapper**

In `src/lib/supabaseClient.ts` (or `kasirService.ts`), find `recordKasirSale` wrapper. Add `pricing_tier_used` to per-line payload type + pass-through:

```ts
export interface KasirLineItem {
  sku: string;
  qty: number;
  unit_price: number;
  master_price_at_sale: number;
  pricing_tier_used?: 'eceran' | 'grosir' | null;
  // ... existing fields (discount, etc.)
}
```

The supabase.rpc call simply forwards the items array; no extra param.

- [ ] **Step 9: Commit + progress.md**

```bash
git add supabase/migrations/20260901000006_record_kasir_sale_tier.sql \
        src/lib/supabaseClient.ts
git commit -m "feat(multi-tier): record_kasir_sale validates pricing_tier_used per line"
```

Append progress.md: "Task 6 DONE — record_kasir_sale tier-aware (4 smoke tests PASS)."

---

### Task 7: Kasir UI — pill toggle + auto-apply + re-compute

**Files:**
- Modify: `src/components/KasirScreen.tsx` (+ KasirInvoiceModal if it owns the cart)
- Test: `src/components/KasirScreen.test.tsx` (append)

**Interfaces:**
- Consumes: Task 6 RPC wrapper; cascadeMap `'tier_pill_kasir'`; `customer.default_pricing_tier`.
- Produces: UI pill toggle `[Eceran|Grosir]`; auto-apply on customer select; re-compute on tier switch; passes `pricing_tier_used` per line.

- [ ] **Step 1: Locate cart state in KasirScreen**

Run: `grep -n "cart\|unit_price\|customer" src/components/KasirScreen.tsx | head -30`

- [ ] **Step 2: Add tier state**

```tsx
const [activeTier, setActiveTier] = useState<'eceran' | 'grosir'>('eceran');
const showTierPill = tenantSettings ? isFieldVisible('tier_pill_kasir', tenantSettings) : false;
```

- [ ] **Step 3: Auto-apply on customer select**

Where customer is set, useEffect:

```tsx
useEffect(() => {
  if (!showTierPill) return;
  const customerTier = selectedCustomer?.default_pricing_tier ?? 'eceran';
  if (customerTier !== activeTier) setActiveTier(customerTier);
}, [selectedCustomer, showTierPill]);
```

- [ ] **Step 4: Re-compute cart on tier change**

```tsx
useEffect(() => {
  if (!showTierPill) return;
  setCart(prev => prev.map(line => {
    const product = productsBySku[line.sku];
    if (!product) return line;
    const newPrice = activeTier === 'grosir'
      ? (product.price_grosir ?? product.price)
      : product.price;
    return { ...line, unit_price: newPrice, master_price_at_sale: newPrice, pricing_tier_used: activeTier };
  }));
}, [activeTier, showTierPill]);
```

- [ ] **Step 5: Render pill toggle**

In cart header:

```tsx
{showTierPill && (
  <div className="flex gap-1 bg-slate-100 rounded-full p-1">
    <button onClick={() => setActiveTier('eceran')}
      className={`px-3 py-1 rounded-full text-xs font-bold ${activeTier==='eceran' ? 'bg-white shadow' : 'text-slate-500'}`}>
      Eceran
    </button>
    <button onClick={() => setActiveTier('grosir')}
      className={`px-3 py-1 rounded-full text-xs font-bold ${activeTier==='grosir' ? 'bg-white shadow' : 'text-slate-500'}`}>
      Grosir
    </button>
  </div>
)}
```

- [ ] **Step 6: Fallback warning on missing price_grosir**

Per line when `activeTier='grosir' && product.price_grosir == null`:

```tsx
{activeTier==='grosir' && product?.price_grosir == null && (
  <span className="text-amber-600 text-[10px]">⚠ Harga grosir belum di-set — pakai eceran</span>
)}
```

- [ ] **Step 7: Wire pricing_tier_used to submit**

Each cart line already has `pricing_tier_used: activeTier` from step 4. RPC wrapper consumes it.

- [ ] **Step 8: Failing RTL test**

In `KasirScreen.test.tsx` append:

```tsx
describe('KasirScreen — tier pill', () => {
  it('hides pill when modul OFF', async () => {
    // Mock tenant: modul_multi_tier_price=false
    render(<KasirScreen ... />);
    expect(screen.queryByRole('button', {name: /Eceran/i})).not.toBeInTheDocument();
  });

  it('renders pill with eceran active by default when modul ON', async () => {
    // Mock modul ON, walk-in (no customer)
    render(<KasirScreen ... />);
    const eceran = await screen.findByRole('button', {name: 'Eceran'});
    expect(eceran).toHaveClass('bg-white');
  });

  it('auto-applies grosir when customer.default_pricing_tier=grosir', async () => {
    // Mock modul ON, customer with tier=grosir
    render(<KasirScreen initialCustomer={{...mockCustomer, default_pricing_tier: 'grosir'}} ... />);
    const grosir = await screen.findByRole('button', {name: 'Grosir'});
    expect(grosir).toHaveClass('bg-white');
  });

  it('re-computes cart unit_price when switching tier', async () => {
    // Mock: 1 product price=100000, price_grosir=80000, in cart
    const {container} = render(<KasirScreen ... />);
    // initial: eceran → unit_price 100000
    expect(screen.getByText(/100\.000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Grosir'}));
    expect(await screen.findByText(/80\.000/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run → GREEN, lint, commit**

```bash
npx vitest run src/components/KasirScreen.test.tsx
npm run lint
git add src/components/KasirScreen.tsx src/components/KasirScreen.test.tsx
git commit -m "feat(multi-tier): kasir cart pill toggle + auto-apply + re-compute"
```

Append progress.md: "Task 7 DONE — Kasir pill toggle (4 RTL tests PASS)."

---

### Task 8: RPC `create_tempo_invoice` — tier per line

**Files:**
- Create: `supabase/migrations/20260901000007_create_tempo_invoice_tier.sql`
- Modify: `src/lib/piutangService.ts` (createTempoInvoice wrapper)

**Interfaces:**
- Consumes: schema (Task 1), tenant toggle.
- Produces: parallel to Task 6 but for `order_items`.

- [ ] **Step 1: Read current RPC**

Find latest variant: `20260801000005_create_tempo_invoice_with_discount.sql`.

- [ ] **Step 2: Write migration**

Same pattern as Task 6: read `pricing_tier_used` per line dari payload (`v_item->>'pricing_tier_used'`); validate vs tenant toggle + product price; persist ke `order_items.pricing_tier_used`.

(Adapt skeleton from Task 6 Step 2 to target order_items instead of kasir_transaction_items.)

- [ ] **Step 3: Apply via MCP**

- [ ] **Step 4: Smoke tests (4 — same patterns as Task 6)**

Happy + TIER_PRICE_MISMATCH + INVALID_TIER + modul-OFF-ignores.

- [ ] **Step 5: Update wrapper**

Adapt `createTempoInvoice` di `piutangService.ts`. Add `pricing_tier_used?` to line item type.

- [ ] **Step 6: Commit + progress.md**

```bash
git add supabase/migrations/20260901000007_create_tempo_invoice_tier.sql \
        src/lib/piutangService.ts
git commit -m "feat(multi-tier): create_tempo_invoice validates pricing_tier_used per line"
```

Append progress.md: "Task 8 DONE — create_tempo_invoice tier-aware (4 smoke tests PASS)."

---

### Task 9: Wizard Step 2 — pill toggle + auto-apply + re-compute

**Files:**
- Modify: `src/components/penjualan/Step2Items.tsx`
- Test: `src/components/penjualan/Step2Items.test.tsx` (append)

**Interfaces:**
- Consumes: Task 8 wrapper, cascadeMap `'tier_pill_kasir'` (same key reused — UX consistency).
- Produces: tier pill in Step 2; threads tier into payload sent to wizard submit.

- [ ] **Step 1: Locate Step 2 state**

Run: `grep -n "items\|unit_price" src/components/penjualan/Step2Items.tsx | head -20`

- [ ] **Step 2: Add activeTier prop / state**

Tier should flow from Step 1 (customer selected). Either:
- Wizard parent state has `activeTier`, passes down + handler.
- OR Step 2 reads `customer.default_pricing_tier` directly.

Choose: parent state. Add to wizard context:

```tsx
// Wizard parent
const [activeTier, setActiveTier] = useState<'eceran'|'grosir'>('eceran');
useEffect(() => {
  if (!showTierPill) return;
  const t = customer?.default_pricing_tier ?? 'eceran';
  if (t !== activeTier) setActiveTier(t);
}, [customer]);
```

- [ ] **Step 3: Step 2 renders pill + re-compute**

Same JSX + useEffect as Task 7 step 4-5, but adapted to wizard items state.

- [ ] **Step 4: Threads tier to submit payload**

Wherever Step 3 submits to `createTempoInvoice`, each item has `pricing_tier_used: activeTier`.

- [ ] **Step 5: Failing RTL test (3 cases)**

Same shape as Task 7 step 8:
- Hidden when modul OFF
- Auto-grosir when customer.default=grosir
- Re-compute on tier switch

- [ ] **Step 6: Run → GREEN, lint, commit**

```bash
git add src/components/penjualan/Step2Items.tsx src/components/penjualan/CatatPenjualanWizard.tsx \
        src/components/penjualan/Step2Items.test.tsx
git commit -m "feat(multi-tier): wizard Step 2 pill toggle + auto-apply + re-compute"
```

Append progress.md: "Task 9 DONE — Wizard Step 2 pill toggle (3 RTL tests PASS)."

---

### Task 10: RPC `bulk_update_grosir_price` + audit ledger writes

**Files:**
- Create: `supabase/migrations/20260901000008_bulk_update_grosir_price.sql`
- Modify: `src/lib/supabaseClient.ts` — add `bulkUpdateGrosirPrice` wrapper

**Interfaces:**
- Consumes: products + product_price_audit (Task 1); admin auth.
- Produces:
  - `bulk_update_grosir_price(p_rows jsonb) RETURNS jsonb` — payload `{rows:[{sku,price_grosir}]}`, returns `{applied, skipped:[{sku,reason}]}`.
  - TS wrapper `bulkUpdateGrosirPrice(rows): Promise<{applied:number; skipped:Array<{sku:string;reason:string}>}>`.

- [ ] **Step 1: Write migration**

Create `supabase/migrations/20260901000008_bulk_update_grosir_price.sql`:

```sql
CREATE OR REPLACE FUNCTION public.bulk_update_grosir_price(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       text;
  v_role        text;
  v_modul_on    boolean;
  v_row         jsonb;
  v_sku         text;
  v_new_price   numeric;
  v_product_id  uuid;
  v_old_price   numeric;
  v_applied     int := 0;
  v_skipped     jsonb := '[]'::jsonb;
BEGIN
  -- Auth: caller role check via admin_users
  SELECT au.name, au.role INTO v_actor, v_role
    FROM admin_users au
    WHERE au.auth_uid = auth.uid();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: unknown caller';
  END IF;
  IF v_role NOT IN ('Owner','Admin Stok','Admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: role % cannot bulk-update prices', v_role;
  END IF;

  SELECT modul_multi_tier_price INTO v_modul_on FROM tenant_settings LIMIT 1;
  IF NOT v_modul_on THEN
    RAISE EXCEPTION 'MODUL_OFF: modul_multi_tier_price is disabled';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows->'rows') LOOP
    v_sku := v_row->>'sku';

    -- Validate numeric
    BEGIN
      v_new_price := (v_row->>'price_grosir')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped || jsonb_build_object('sku', v_sku, 'reason', 'price_not_numeric');
      CONTINUE;
    END;

    IF v_new_price IS NULL OR v_new_price <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object('sku', v_sku, 'reason', 'price_not_numeric');
      CONTINUE;
    END IF;

    -- Lookup product
    SELECT id, price_grosir INTO v_product_id, v_old_price
      FROM products WHERE sku = v_sku;
    IF v_product_id IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('sku', v_sku, 'reason', 'sku_not_found');
      CONTINUE;
    END IF;

    -- Update + audit
    UPDATE products SET price_grosir = v_new_price WHERE id = v_product_id;
    INSERT INTO product_price_audit (product_id, sku, field, old_value, new_value, source, actor)
      VALUES (v_product_id, v_sku, 'price_grosir', v_old_price, v_new_price, 'bulk_csv', COALESCE(v_actor, 'unknown'));
    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_update_grosir_price(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_update_grosir_price(jsonb) TO authenticated;

COMMENT ON FUNCTION public.bulk_update_grosir_price IS
  'Bulk-update products.price_grosir from CSV upload. Returns {applied, skipped:[{sku, reason}]}. Atomic per-row update + audit ledger.';
```

- [ ] **Step 2: Apply migration via MCP**

- [ ] **Step 3: Smoke — happy path**

```sql
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '<owner-auth-uid>', true);
  UPDATE tenant_settings SET modul_multi_tier_price = TRUE;

  SELECT public.bulk_update_grosir_price(jsonb_build_object('rows',
    jsonb_build_array(
      jsonb_build_object('sku','<existing-sku-1>','price_grosir', 750000),
      jsonb_build_object('sku','<existing-sku-2>','price_grosir', 1200000)
    )
  )) INTO v_result;

  RAISE NOTICE 'result=%', v_result;
  -- expected: {"applied": 2, "skipped": []}
  RAISE EXCEPTION 'rollback smoke';
END $$;
```

- [ ] **Step 4: Smoke — mixed (1 success, 1 sku_not_found, 1 invalid)**

Expected: `{"applied": 1, "skipped": [{"sku":"X-999","reason":"sku_not_found"}, {"sku":"<sku>","reason":"price_not_numeric"}]}`.

- [ ] **Step 5: Smoke — FORBIDDEN role**

Use auth-uid of a Kasir-role user. Expected: `FORBIDDEN: role Kasir ...`.

- [ ] **Step 6: Smoke — MODUL_OFF**

Modul=FALSE; expect `MODUL_OFF` raise.

- [ ] **Step 7: TS wrapper**

In `src/lib/supabaseClient.ts`:

```ts
export interface BulkGrosirRow {
  sku: string;
  price_grosir: number;
}

export const productService = {
  // ... existing ...
  async bulkUpdateGrosirPrice(rows: BulkGrosirRow[]): Promise<{applied: number; skipped: Array<{sku: string; reason: string}>}> {
    const { data, error } = await supabase.rpc('bulk_update_grosir_price', { p_rows: { rows } });
    if (error) throw error;
    return data as { applied: number; skipped: Array<{sku: string; reason: string}> };
  },
};
```

(Atau letakkan di service yang sesuai konvensi proyek.)

- [ ] **Step 8: Commit + progress.md**

```bash
git add supabase/migrations/20260901000008_bulk_update_grosir_price.sql \
        src/lib/supabaseClient.ts
git commit -m "feat(multi-tier): bulk_update_grosir_price RPC + audit ledger + TS wrapper"
```

Append progress.md: "Task 10 DONE — bulk_update_grosir_price RPC (4 smoke tests PASS)."

---

### Task 11: `BulkUpdateGrosirSection` component — template + parse + preview

**Files:**
- Create: `src/components/produk/BulkUpdateGrosirSection.tsx`
- Create: `src/components/produk/BulkUpdateGrosirSection.test.tsx`

**Interfaces:**
- Consumes: `StockItem[]` (parent props), `productService.bulkUpdateGrosirPrice` (Task 10), `showToast`.
- Produces: standalone component with toolbar button + modal preview + apply handler.

- [ ] **Step 1: Skeleton component**

Create file:

```tsx
import React, { useRef, useState } from 'react';
import { Download, Upload, Check, X } from 'lucide-react';
import { StockItem } from '../../types';
import { productService } from '../../lib/supabaseClient';

interface Props {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onApplied: () => void;
}

type RowStatus = 'OK' | 'WARNING_ABOVE_ECERAN' | 'SKIP_SKU_NOT_FOUND' | 'SKIP_INVALID_FORMAT' | 'NO_CHANGE';
interface ParsedRow {
  sku: string;
  nama: string;
  price_eceran: number | null;
  price_grosir_lama: number | null;
  price_grosir_baru: number | null;
  status: RowStatus;
}

export default function BulkUpdateGrosirSection({ stockList, showToast, onApplied }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [confirmAbove, setConfirmAbove] = useState(false);
  const [applying, setApplying] = useState(false);

  const handleDownloadTemplate = () => {
    const header = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru';
    const csv = [header, ...stockList.map(s =>
      `${s.sku},"${s.name.replace(/"/g,'""')}",${s.price ?? ''},${s.price_grosir ?? ''},`
    )].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'template-harga-grosir.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const parseCsv = (text: string): ParsedRow[] => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const [, ...dataLines] = lines;  // skip header
    const skuMap = new Map(stockList.map(s => [s.sku, s]));
    return dataLines.map(line => {
      const cols = parseCsvLine(line);
      const [sku, , , , baruRaw] = cols;
      const product = skuMap.get(sku);
      const lama = product?.price_grosir ?? null;
      const eceran = product?.price ?? null;
      const baruStr = (baruRaw ?? '').trim();
      if (!product) {
        return { sku, nama: cols[1] ?? '', price_eceran: null, price_grosir_lama: null, price_grosir_baru: null, status: 'SKIP_SKU_NOT_FOUND' };
      }
      if (baruStr === '') {
        return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: null, status: 'NO_CHANGE' };
      }
      const baru = Number(baruStr);
      if (!isFinite(baru) || baru <= 0) {
        return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: null, status: 'SKIP_INVALID_FORMAT' };
      }
      if (baru === lama) {
        return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: baru, status: 'NO_CHANGE' };
      }
      if (eceran != null && baru > eceran) {
        return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: baru, status: 'WARNING_ABOVE_ECERAN' };
      }
      return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: baru, status: 'OK' };
    });
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRows(parseCsv(text));
    setConfirmAbove(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const summary = rows ? {
    toApply: rows.filter(r => r.status === 'OK' || r.status === 'WARNING_ABOVE_ECERAN').length,
    skipped: rows.filter(r => r.status.startsWith('SKIP')).length,
    warning: rows.filter(r => r.status === 'WARNING_ABOVE_ECERAN').length,
  } : null;

  const canApply = !!summary && summary.toApply > 0 && (summary.warning === 0 || confirmAbove);

  const handleApply = async () => {
    if (!rows || !canApply) return;
    setApplying(true);
    try {
      const payload = rows
        .filter(r => r.status === 'OK' || r.status === 'WARNING_ABOVE_ECERAN')
        .map(r => ({ sku: r.sku, price_grosir: r.price_grosir_baru as number }));
      const result = await productService.bulkUpdateGrosirPrice(payload);
      showToast(`✅ ${result.applied} produk diupdate, ${result.skipped.length} skipped`, 'success');
      setRows(null);
      onApplied();
    } catch (err: any) {
      showToast(`Gagal: ${err.message ?? 'unknown'}`, 'warning');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-bold text-[#012749] mb-2">Update Harga Grosir (CSV)</h3>
      <p className="text-xs text-slate-500 mb-4">Download template, isi kolom <code>price_grosir_baru</code>, lalu upload kembali. Preview sebelum apply.</p>
      <div className="flex gap-2">
        <button onClick={handleDownloadTemplate} className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-200">
          <Download className="w-3.5 h-3.5" /> Download Template
        </button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2 bg-[#012749] text-white text-xs font-bold rounded-lg hover:bg-[#01365e]">
          <Upload className="w-3.5 h-3.5" /> Upload CSV
        </button>
      </div>

      {rows && summary && (
        <div className="mt-4 border border-slate-200 rounded-xl">
          <div className="flex items-center justify-between p-3 bg-slate-50 border-b">
            <div className="text-xs font-bold text-slate-700">
              {summary.toApply} akan diupdate · {summary.skipped} skipped · {summary.warning} warning
            </div>
            <button onClick={() => setRows(null)} className="text-slate-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white border-b">
                <tr><th className="text-left p-2">SKU</th><th className="text-left p-2">Nama</th><th className="text-right p-2">Eceran</th><th className="text-right p-2">Grosir Lama</th><th className="text-right p-2">Grosir Baru</th><th className="text-left p-2">Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-2 font-mono">{r.sku}</td>
                    <td className="p-2">{r.nama}</td>
                    <td className="p-2 text-right">{r.price_eceran ?? '—'}</td>
                    <td className="p-2 text-right">{r.price_grosir_lama ?? '—'}</td>
                    <td className="p-2 text-right">{r.price_grosir_baru ?? '—'}</td>
                    <td className="p-2">{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-50 border-t flex items-center justify-between gap-3">
            {summary.warning > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={confirmAbove} onChange={e => setConfirmAbove(e.target.checked)} />
                Saya konfirmasi update harga grosir di atas eceran ({summary.warning} produk)
              </label>
            )}
            <button onClick={handleApply} disabled={!canApply || applying}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> {applying ? 'Menerapkan…' : 'Apply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusBadge(s: RowStatus) {
  const map: Record<RowStatus, {label: string; cls: string}> = {
    OK: { label: '✅ OK', cls: 'text-emerald-700 bg-emerald-50' },
    WARNING_ABOVE_ECERAN: { label: '⚠ Di atas eceran', cls: 'text-amber-700 bg-amber-50' },
    SKIP_SKU_NOT_FOUND: { label: '⚠ SKU tidak ada', cls: 'text-rose-700 bg-rose-50' },
    SKIP_INVALID_FORMAT: { label: '⚠ Bukan numeric', cls: 'text-rose-700 bg-rose-50' },
    NO_CHANGE: { label: '🔵 Tidak berubah', cls: 'text-slate-600 bg-slate-50' },
  };
  const { label, cls } = map[s];
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{label}</span>;
}

// Minimal CSV line parser handling quoted strings.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') { inQuote = true; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
```

- [ ] **Step 2: Write tests**

Create `src/components/produk/BulkUpdateGrosirSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BulkUpdateGrosirSection from './BulkUpdateGrosirSection';
import * as supabase from '../../lib/supabaseClient';

vi.mock('../../lib/supabaseClient', () => ({
  productService: { bulkUpdateGrosirPrice: vi.fn() },
}));

const stockList = [
  { sku: 'A-1', name: 'Produk A', price: 100000, price_grosir: 80000 } as any,
  { sku: 'A-2', name: 'Produk B', price: 50000, price_grosir: null } as any,
];

describe('BulkUpdateGrosirSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses CSV row marked OK', async () => {
    const showToast = vi.fn();
    render(<BulkUpdateGrosirSection stockList={stockList} showToast={showToast} onApplied={vi.fn()} />);
    const csv = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru\nA-1,"Produk A",100000,80000,75000\n';
    const file = new File([csv], 'x.csv', { type: 'text/csv' });
    const input = screen.getByRole('button', { name: /Upload CSV/i }).parentElement!.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/OK/)).toBeInTheDocument());
    expect(screen.getByText(/1 akan diupdate/)).toBeInTheDocument();
  });

  it('flags SKU not found', async () => {
    render(<BulkUpdateGrosirSection stockList={stockList} showToast={vi.fn()} onApplied={vi.fn()} />);
    const csv = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru\nX-999,?,?,?,50000\n';
    const file = new File([csv], 'x.csv', { type: 'text/csv' });
    const input = screen.getByRole('button', { name: /Upload CSV/i }).parentElement!.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/SKU tidak ada/i)).toBeInTheDocument());
  });

  it('flags grosir > eceran as WARNING and requires checkbox to apply', async () => {
    render(<BulkUpdateGrosirSection stockList={stockList} showToast={vi.fn()} onApplied={vi.fn()} />);
    const csv = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru\nA-1,"Produk A",100000,80000,150000\n';
    const file = new File([csv], 'x.csv', { type: 'text/csv' });
    const input = screen.getByRole('button', { name: /Upload CSV/i }).parentElement!.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/Di atas eceran/i)).toBeInTheDocument());
    const applyBtn = screen.getByRole('button', { name: /Apply/i }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/konfirmasi/i));
    expect(applyBtn.disabled).toBe(false);
  });

  it('calls RPC and shows success toast on apply', async () => {
    (supabase as any).productService.bulkUpdateGrosirPrice.mockResolvedValue({ applied: 1, skipped: [] });
    const showToast = vi.fn();
    const onApplied = vi.fn();
    render(<BulkUpdateGrosirSection stockList={stockList} showToast={showToast} onApplied={onApplied} />);
    const csv = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru\nA-1,"Produk A",100000,80000,75000\n';
    const file = new File([csv], 'x.csv', { type: 'text/csv' });
    const input = screen.getByRole('button', { name: /Upload CSV/i }).parentElement!.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await screen.findByText(/1 akan diupdate/);
    fireEvent.click(screen.getByRole('button', { name: /Apply/i }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/1 produk diupdate/), 'success'));
    expect(onApplied).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run → GREEN, lint**

```bash
npx vitest run src/components/produk/BulkUpdateGrosirSection.test.tsx
npm run lint
```

Expected: 4/4 PASS.

- [ ] **Step 4: Commit + progress.md**

```bash
git add src/components/produk/BulkUpdateGrosirSection.tsx \
        src/components/produk/BulkUpdateGrosirSection.test.tsx
git commit -m "feat(multi-tier): BulkUpdateGrosirSection component (CSV template + preview + apply)"
```

Append progress.md: "Task 11 DONE — BulkUpdateGrosirSection (4 RTL tests PASS)."

---

### Task 12: Wire bulk upload + integration test sweep

**Files:**
- Modify: `src/components/StockManagerScreen.tsx` — wire `BulkUpdateGrosirSection`
- Create: `tests/integration/multi-tier/_setup.ts`, `tests/integration/multi-tier/multi-tier.test.ts`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: integration coverage of E2E scenarios.

- [ ] **Step 1: Import + render in StockManagerScreen**

In `StockManagerScreen.tsx`, near top-toolbar area:

```tsx
import BulkUpdateGrosirSection from './produk/BulkUpdateGrosirSection';
// ...
{showGrosir && (
  <BulkUpdateGrosirSection
    stockList={stockList}
    showToast={showToast}
    onApplied={refreshStockList}
  />
)}
```

(`refreshStockList` = existing fetch function; rename to actual.)

- [ ] **Step 2: Write integration setup**

Create `tests/integration/multi-tier/_setup.ts` mirroring `tests/integration/diskon/_setup.ts` pattern. Loads `.env`, exports a Supabase service-role client + helper to enable/disable `modul_multi_tier_price`.

- [ ] **Step 3: Write integration tests**

Create `tests/integration/multi-tier/multi-tier.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { client, setModulTier } from './_setup';

describe('Multi-tier pricing integration', () => {
  beforeAll(async () => { await setModulTier(true); });
  afterAll(async () => { await setModulTier(false); });

  it('record_kasir_sale accepts pricing_tier_used=grosir', async () => {
    // ... call RPC with prepared product (price=100000, price_grosir=80000), 1 line tier=grosir, master=80000
    // expect: success
  });

  it('record_kasir_sale rejects TIER_PRICE_MISMATCH', async () => {
    // master=90000 while expected=80000
    // expect: error matches /TIER_PRICE_MISMATCH/
  });

  it('bulk_update_grosir_price applies + audit ledger entry', async () => {
    const r = await client.rpc('bulk_update_grosir_price', { p_rows: { rows: [{ sku: 'TEST-A', price_grosir: 77777 }] } });
    expect(r.data.applied).toBe(1);
    const { data: audit } = await client.from('product_price_audit').select('*').eq('sku', 'TEST-A').order('created_at', { ascending: false }).limit(1);
    expect(audit?.[0]?.new_value).toBe(77777);
  });

  it('modul OFF preserves data + hides nothing in DB', async () => {
    await setModulTier(false);
    // Verify price_grosir column still readable, customer.default_pricing_tier still readable
    const { data } = await client.from('products').select('price_grosir').limit(1);
    expect(data).toBeDefined();
  });
});
```

(Adapt prepared SKU + customer fixture per Garindo seed data.)

- [ ] **Step 4: Run integration tests**

```bash
npx vitest run tests/integration/multi-tier
```

Expected: 4/4 PASS.

- [ ] **Step 5: Full regression — unit + integration sweep**

```bash
npm test
npm run lint
```

Expected: unit suite still PASS (no regression on existing 410+ tests); lint clean.

- [ ] **Step 6: Manual smoke (founder)**

Run dev server: `npm run dev`. Verify scenarios:

1. Pengaturan → Modul & Jasa → toggle "Multi-Tier Pricing" ON.
2. Master Produk → kolom Eceran + Grosir muncul; pilih 1 produk; edit → isi Grosir → save.
3. Master Customer → tambah customer baru → set tier=grosir.
4. Kasir → pilih customer grosir → cart pill auto-Grosir; line item harga = price_grosir; switch ke Eceran → harga balik.
5. Wizard Penjualan TEMPO → Step 1 pilih customer grosir → Step 2 pill = Grosir; items harga grosir.
6. Master Produk → "Update Harga Grosir (CSV)" → Download Template → edit CSV → Upload → Preview → Apply → toast sukses → produk ter-update.
7. Toggle modul OFF → semua UI tier hilang; data tetap di DB.

- [ ] **Step 7: Commit + final progress.md**

```bash
git add src/components/StockManagerScreen.tsx \
        tests/integration/multi-tier/_setup.ts \
        tests/integration/multi-tier/multi-tier.test.ts
git commit -m "feat(multi-tier): wire BulkUpdateGrosirSection + E2E integration tests"
```

Append progress.md: "Task 12 DONE — Multi-tier pricing feature complete. Integration suite 4/4 PASS, manual smoke verified."

---

## Final Checklist (sebelum kasih PR)

- [ ] 8 migrations applied clean, idempotent rerun OK
- [ ] 5 RTL test files PASS (Pengaturan, Master Produk, Master Customer, Kasir, Wizard Step 2)
- [ ] 1 component test PASS (BulkUpdateGrosirSection)
- [ ] 4 smoke RPC tests untuk record_kasir_sale; 4 untuk create_tempo_invoice; 4 untuk bulk_update_grosir_price
- [ ] 4 integration tests PASS
- [ ] Full regression: unit + lint clean
- [ ] Manual founder smoke 7 scenarios passed
- [ ] progress.md updated per task
- [ ] Modul default OFF di tenant Garindo; tidak ada perubahan visible
- [x] Multi-tier shipped to dev DB via slot 20260901xxx. Garindo no-regression smoke PASS (4 scenarios).

---

## Notes / Risks (during execution)

- **Sequencing:** Tasks 1-2 must complete before any UI work; Tasks 6-7 (kasir) and 8-9 (wizard) bisa paralel kalau dipisah cabang.
- **Existing RPC changes:** Tasks 6 + 8 modify CRITICAL RPCs. Smoke test wajib sebelum apply ke prod-equivalent DB. Jangan skip rollback pattern di smoke.
- **CSV parser:** minimal implementation di Task 11 cukup untuk Phase 1 (RFC4180 subset: quoted fields + escaped quotes). Jangan ganti ke library kecuali test gagal.
- **TS wrapper sebaran:** `productService` / `kasirService` / `piutangService` letaknya di proyek ini tidak satu file — periksa konvensi sebelum nambah method.
- **Sub-component yang panjang:** kalau `StockManagerScreen.tsx` sudah besar (>500 baris) saat masuk Task 4, pertimbangkan split tabel produk ke sub-component baru di task tersebut. Tidak wajib.
