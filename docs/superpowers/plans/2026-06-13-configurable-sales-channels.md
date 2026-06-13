# Configurable Sales Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ekstensi 14-channel canonical list dengan admin visibility toggle di PengaturanScreen, plus refactor 5 surface (PenjualanBaru/KasirScreen/OrderHistory/Recon/Dashboard) untuk dynamic channel handling + consolidasi 5 hardcode mapping + brand-logo icons.

**Architecture:** Hardcoded Postgres ENUM + TS union (D1), new `sales_channel_settings` table dengan admin toggle (default all-visible), React Context provider untuk subscribe realtime + share state ke semua konsumen. Single source of truth `CHANNEL_VISUAL` di `src/lib/salesChannels.ts`. 4-phase migration dengan backward-compat overlap (Phase A+B deploy → soak 1 hari → Phase C frontend → Phase D cleanup).

**Tech Stack:** Postgres (Supabase ≥15), TypeScript, React 19, Vite, Tailwind v4 (@theme block), Lucide-react icons, brand SVG logos di `public/icons/channels/`, Vitest untuk integration tests, supabase-js realtime.

**Spec reference:** `docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md`
**Mockup reference:** `.superpowers/brainstorm/47094-1781323973/content/06-all-mockups.html`

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `supabase/migrations/20260613XXXXXX_sales_channels_phase_a_schema.sql` | ENUM ADD VALUE × 10 each (kasir_channel + sales_channel), column rename `tokped_order_no → marketplace_order_no`, view alias, CREATE TABLE `sales_channel_settings` + RLS + indexes, helper `validate_sales_channel()` |
| `supabase/migrations/20260613XXXXXX_sales_channels_phase_b_rpcs.sql` | Seed 14 rows, refactor 3 RPC variants pakai helper + invoice prefix expansion, ALTER PUBLICATION supabase_realtime |
| `src/lib/salesChannels.ts` | Single source of truth: CHANNEL_VISUAL map, CHANNEL_GROUPS, CHANNEL_REQUIRES_ORDER_NO, CHANNEL_LOCKED, helper functions getVisibleChannels/getChannelDef/etc |
| `src/contexts/SalesChannelsContext.tsx` | Load `sales_channel_settings` sekali, subscribe realtime, expose `visibleChannels`/`visibleByGroup`/`toggleVisibility` ke semua konsumen |
| `src/components/icons/ChannelIcon.tsx` | Render brand SVG atau Lucide icon based on `iconType`. Accept `code` + size props |
| `src/components/pengaturan/SalesChannelConfigPanel.tsx` | UI tab "Kanal Penjualan" — list 14 channel grouped, toggle aktif/non-aktif, locked Walk-in |
| `public/icons/channels/*.svg` | Brand logo SVG: tokopedia, shopee, lazada, blibli, bukalapak, ralali, bhinneka, whatsapp, instagram (9 files) |
| `tests/integration/sales-channels.test.ts` | DB integration tests: ENUM accepts new values, RPC validation, sales_channel_settings RLS |

### Modified files
| Path | Change |
|---|---|
| `src/types.ts` | Expand `SalesChannel` union to 14 values, alias `KasirChannel = SalesChannel`, add `OrdersChannel = Extract<...>`, add `canConfigureSalesChannels` to PermissionSet |
| `src/lib/salesEntries.ts` | Drop `CHANNEL_LABEL`/`CHANNEL_BADGE_CLASS`, re-export from salesChannels |
| `src/lib/supabaseClient.ts` | Refactor 2 hardcoded bucket functions (line 509, 626) jadi shared `bucketByChannel` helper; widen channel types |
| `src/index.css` | Add brand color CSS variables di `@theme` block |
| `src/App.tsx` | Wrap dengan `<SalesChannelsProvider>`, widen `penjualanInitialChannel` type |
| `src/components/PengaturanScreen.tsx` | Add tab `'kanal-penjualan'` ke TabBar union + render SalesChannelConfigPanel |
| `src/components/penjualan/ChannelSelector.tsx` | Refactor jadi props-driven dengan group rendering |
| `src/components/PenjualanBaruScreen.tsx` | Rename `tokpedOrderNo → marketplaceOrderNo` state, drop 4 hardcode `channel === 'tokopedia'` checks (line 201, 242, 297, 351), conditional field via `CHANNEL_REQUIRES_ORDER_NO` |
| `src/components/KasirScreen.tsx` | Hapus 3 kartu cepat (line 429+), refactor `filter === 'online'` heuristic pakai `CHANNEL_GROUPS.marketplace.includes` |
| `src/components/OrderHistoryScreen.tsx` | Hybrid filter: dropdown group + dropdown spesifik dengan optgroup "Dinonaktifkan" |
| `src/components/RekonsiliasiScreen.tsx` | Hardcoded acc → dynamic `Map<SalesChannel, ...>` |
| `src/components/rekonsiliasi/TallyBar.tsx` | Map-based, hide-zero, sort DESC, brand colors |
| `src/components/rekonsiliasi/OrdersColumn.tsx` | Group + dropdown filter pattern |
| `src/hooks/useRekonsiliasi.ts` | Widen channel type to SalesChannel |
| `src/components/LaporanScreen.tsx` | Brand colors di Pie + bar chart, "Top 3 Kanal" insight card |
| `src/components/penjualan/SalesInvoicePDF.tsx` | Import label dari salesChannels (drop inline hash line 52) |
| `src/components/KasirInvoiceModal.tsx` | Import dari salesChannels (drop inline hash line 25-27) |
| `backend-go/internal/db/record_kasir_sale_test.go` | Add 1 test case channel baru (smoke check) |
| `progress.md` | Entry post-impl per CLAUDE.md gotcha |

---

## Phase A — Schema Groundwork

### Task 1: Pre-impl verification (manual psql)

**Files:** None (verification only)

- [ ] **Step 1: Verify Postgres version**

Run in Supabase SQL Editor:
```sql
SHOW server_version;
```
Expected: `≥ 15.0` (Supabase default)

- [ ] **Step 2: Verify `kasir_channel` ENUM current values**

Run:
```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'kasir_channel'::regtype ORDER BY enumsortorder;
```
Expected output: `walkin, tokopedia, grosir, whatsapp` (if `whatsapp` missing, note for Phase A to add)

- [ ] **Step 3: Verify `sales_channel` ENUM current values**

Run:
```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'sales_channel'::regtype ORDER BY enumsortorder;
```
Expected: `whatsapp, tokopedia, walkin, grosir`

- [ ] **Step 4: Verify `tokped_order_no` column exists**

Run:
```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'kasir_transactions' AND column_name = 'tokped_order_no';
```
Expected: 1 row returned. If 0, the rename is already done or column never existed.

- [ ] **Step 5: Verify no active warehouse Phase 3 cutover in flight**

Run:
```bash
git log --oneline -5 -- supabase/migrations/ | grep -i "warehouse\|cutover"
```
Expected: review commits — confirm warehouse Phase 3 (20260613000003) is either already deployed or not blocking.

- [ ] **Step 6: Document verification result**

Add a note to `progress.md` with:
```
- 2026-06-13 sales-channels pre-impl verify: PG=<version>, kasir_channel=[<values>], sales_channel=[<values>], tokped_order_no=<exists/missing>, warehouse Phase 3 status: <deployed/blocking>
```

### Task 2: Phase A migration — ENUM extension

**Files:**
- Create: `supabase/migrations/20260613000010_sales_channels_phase_a_schema.sql` (timestamp: pick next unused 6-digit suffix after warehouse migrations)

- [ ] **Step 1: Create migration file with ENUM ADD VALUE**

```sql
-- Phase A — Schema groundwork for configurable sales channels
-- Spec: docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md
-- Adds 10 new channels to both kasir_channel and sales_channel ENUMs.
-- Postgres requires each ADD VALUE in its own transaction (cannot rollback within tx).

-- kasir_channel: add 10 new values (whatsapp already present per Task 1 verify)
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'expo';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'shopee';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'lazada';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'blibli';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'bukalapak';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'ralali';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'bhinneka';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'website';

-- sales_channel: mirror same additions
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'expo';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'shopee';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'lazada';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'blibli';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'bukalapak';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'ralali';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'bhinneka';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'website';

COMMIT;
```

- [ ] **Step 2: Apply migration via Supabase CLI**

Run:
```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
supabase db push
```
Expected: migration applies cleanly.

- [ ] **Step 3: Verify ENUM values**

Run in Supabase SQL Editor:
```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'kasir_channel'::regtype ORDER BY enumsortorder;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'sales_channel'::regtype ORDER BY enumsortorder;
```
Expected: both ENUMs now have 14 values.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260613000010_sales_channels_phase_a_schema.sql
git commit -m "feat(sales-channels): phase A.1 — extend kasir_channel + sales_channel ENUMs (10 new values each)"
```

### Task 3: Phase A migration — column rename + backward-compat view

**Files:**
- Create: `supabase/migrations/20260613000011_sales_channels_phase_a_rename.sql`

- [ ] **Step 1: Create rename migration**

```sql
-- Phase A — Rename tokped_order_no to marketplace_order_no
-- View alias gives 1-week soak for frontend cutover (Phase C/D).

ALTER TABLE public.kasir_transactions
  RENAME COLUMN tokped_order_no TO marketplace_order_no;

-- Add a column comment so future readers understand the field semantics.
COMMENT ON COLUMN public.kasir_transactions.marketplace_order_no IS
  'Order number from the originating marketplace. Required when channel is one of: tokopedia, shopee, lazada, blibli, bukalapak, ralali, bhinneka. NULL for offline and direct channels.';

-- Backward-compat alias view — drop in Phase D after 1-week soak.
-- Lets legacy code that still SELECTs tokped_order_no continue working.
CREATE OR REPLACE VIEW public.kasir_transactions_legacy AS
  SELECT *,
    marketplace_order_no AS tokped_order_no
  FROM public.kasir_transactions;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

- [ ] **Step 3: Verify rename and view**

```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'kasir_transactions' AND column_name IN ('tokped_order_no', 'marketplace_order_no');
SELECT * FROM public.kasir_transactions_legacy LIMIT 1;
```
Expected: `marketplace_order_no` exists, `tokped_order_no` does NOT exist on table, but view returns rows with both column names.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260613000011_sales_channels_phase_a_rename.sql
git commit -m "feat(sales-channels): phase A.2 — rename tokped_order_no → marketplace_order_no + alias view"
```

### Task 4: Phase A migration — sales_channel_settings table

**Files:**
- Create: `supabase/migrations/20260613000012_sales_channels_phase_a_settings_table.sql`

- [ ] **Step 1: Create table + RLS migration**

```sql
-- Phase A — Admin visibility config table for sales channels.

CREATE TABLE IF NOT EXISTS public.sales_channel_settings (
  channel_code  TEXT PRIMARY KEY,
  is_visible    BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  tenant_id     UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES public.admin_users(id),
  CONSTRAINT sales_channel_settings_code_check CHECK (channel_code IN (
    'walkin','grosir','sales','expo',
    'tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka',
    'whatsapp','instagram','website'
  ))
);

CREATE INDEX IF NOT EXISTS idx_sales_channel_settings_tenant
  ON public.sales_channel_settings(tenant_id);

ALTER TABLE public.sales_channel_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_channel_settings' AND policyname = 'all_admins_read'
  ) THEN
    CREATE POLICY "all_admins_read" ON public.sales_channel_settings
      FOR SELECT USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_channel_settings' AND policyname = 'owners_admins_write'
  ) THEN
    CREATE POLICY "owners_admins_write" ON public.sales_channel_settings
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.admin_users
          WHERE id = auth.uid()
            AND (
              role = 'owner'
              OR (permissions::jsonb ->> 'canConfigureSalesChannels')::boolean = true
            )
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.sales_channel_settings IS
  'Per-tenant admin visibility config for the 14 canonical sales channels. is_visible=false hides channel from input selectors but does NOT hide historical data in recon/dashboard/laporan.';
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

- [ ] **Step 3: Verify table + RLS**

```sql
SELECT COUNT(*) FROM public.sales_channel_settings;  -- expect 0 (no seed yet)
SELECT policyname FROM pg_policies WHERE tablename = 'sales_channel_settings';
-- expect: all_admins_read, owners_admins_write
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260613000012_sales_channels_phase_a_settings_table.sql
git commit -m "feat(sales-channels): phase A.3 — sales_channel_settings table + RLS"
```

### Task 5: Phase A migration — validate helper function

**Files:**
- Create: `supabase/migrations/20260613000013_sales_channels_phase_a_helper.sql`

- [ ] **Step 1: Create helper function**

```sql
-- Phase A — Centralized channel whitelist validator.
-- Replaces inline `IF p_channel NOT IN (...)` checks in 3 record_kasir_sale variants.

CREATE OR REPLACE FUNCTION public.validate_sales_channel(p_channel TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_channel NOT IN (
    'walkin','grosir','sales','expo',
    'tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka',
    'whatsapp','instagram','website'
  ) THEN
    RAISE EXCEPTION 'invalid sales channel: % (expected one of 14 canonical channels)', p_channel;
  END IF;
END $$;

COMMENT ON FUNCTION public.validate_sales_channel(TEXT) IS
  'Raises exception if p_channel is not one of the 14 canonical sales channels. Called by record_kasir_sale RPC variants for input validation.';
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

- [ ] **Step 3: Smoke test helper**

```sql
SELECT public.validate_sales_channel('shopee');   -- expect: no output (void)
SELECT public.validate_sales_channel('invalid'); -- expect: ERROR "invalid sales channel"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260613000013_sales_channels_phase_a_helper.sql
git commit -m "feat(sales-channels): phase A.4 — validate_sales_channel helper fn"
```

---

## Phase B — Seed + RPC Updates + Realtime

### Task 6: Phase B migration — seed function + populate 14 rows

**Files:**
- Create: `supabase/migrations/20260613000020_sales_channels_phase_b_seed.sql`

- [ ] **Step 1: Create seed function + invoke**

```sql
-- Phase B — Seed 14 canonical channels with default visibility=true.
-- Idempotent: ON CONFLICT DO NOTHING so re-running doesn't disrupt admin edits.

CREATE OR REPLACE FUNCTION public.seed_sales_channel_settings()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.sales_channel_settings (channel_code, sort_order, is_visible) VALUES
    ('walkin', 10, true),
    ('grosir', 20, true),
    ('sales', 30, true),
    ('expo', 40, true),
    ('tokopedia', 50, true),
    ('shopee', 60, true),
    ('lazada', 70, true),
    ('blibli', 80, true),
    ('bukalapak', 90, true),
    ('ralali', 100, true),
    ('bhinneka', 110, true),
    ('whatsapp', 120, true),
    ('instagram', 130, true),
    ('website', 140, true)
  ON CONFLICT (channel_code) DO NOTHING;
END $$;

-- Invoke immediately for current single-tenant deployment (tenant_id IS NULL).
SELECT public.seed_sales_channel_settings();
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

- [ ] **Step 3: Verify 14 rows seeded**

```sql
SELECT channel_code, is_visible, sort_order FROM public.sales_channel_settings
  ORDER BY sort_order;
-- expect: 14 rows in canonical order, all is_visible=true
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260613000020_sales_channels_phase_b_seed.sql
git commit -m "feat(sales-channels): phase B.1 — seed 14 canonical channels with default visibility"
```

### Task 7: Phase B migration — refactor record_kasir_sale RPC variants

**Files:**
- Modify: `supabase/migrations/20260613000021_sales_channels_phase_b_rpcs.sql` (NEW — creates new versions of 3 RPCs)
- Reference: `supabase/migrations/20260610000001_record_kasir_sale_service_lines.sql` (most recent variant)

- [ ] **Step 1: Read current most-recent RPC version**

Run:
```bash
cat /Users/tonywei/IdeaProjects/ERPAntigravity/supabase/migrations/20260610000001_record_kasir_sale_service_lines.sql
```
Note the full signature + body — the migration will CREATE OR REPLACE the same signature.

- [ ] **Step 2: Create migration replacing all 3 RPC variants**

```sql
-- Phase B — Update record_kasir_sale variants to use validate_sales_channel helper
-- and expand invoice prefix CASE for 14 channels.
-- Variants: record_kasir_sale, record_kasir_sale_validate_subtype, record_kasir_sale_service_lines.

-- Variant 1: record_kasir_sale (base)
-- Replace inline whitelist with helper + extend invoice prefix CASE.
-- Copy the full signature + body from migration 20260609000001 and apply these changes:
--   - Remove the `IF p_channel NOT IN (...) THEN RAISE EXCEPTION ...` block.
--   - Replace with `PERFORM public.validate_sales_channel(p_channel);` near top.
--   - Extend the `v_invoice_prefix := CASE p_channel ...` block to include all 14 channels.

CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  -- [keep exact signature from 20260609000001]
  -- ... (copy full param list from existing migration)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- [keep all existing DECLAREs]
  v_invoice_prefix TEXT;
  v_counter        INT;
  v_invoice_number TEXT;
BEGIN
  -- Validate channel via centralized helper
  PERFORM public.validate_sales_channel(p_channel);

  -- [keep all existing validation: payment_method, customer find-or-create, FIFO, etc.]

  -- Invoice prefix per channel (14 cases)
  v_invoice_prefix := CASE p_channel
    WHEN 'walkin'    THEN 'WLK'
    WHEN 'grosir'    THEN 'GSR'
    WHEN 'sales'     THEN 'SLS'
    WHEN 'expo'      THEN 'EXP'
    WHEN 'tokopedia' THEN 'TPD'
    WHEN 'shopee'    THEN 'SHP'
    WHEN 'lazada'    THEN 'LZD'
    WHEN 'blibli'    THEN 'BLB'
    WHEN 'bukalapak' THEN 'BKL'
    WHEN 'ralali'    THEN 'RLI'
    WHEN 'bhinneka'  THEN 'BHN'
    WHEN 'whatsapp'  THEN 'WAM'
    WHEN 'instagram' THEN 'IGM'
    WHEN 'website'   THEN 'WEB'
  END;

  -- [keep rest of body unchanged]
END $$;

-- Variant 2: record_kasir_sale_validate_subtype
-- Same substitutions as variant 1 — copy from 20260609000003.
CREATE OR REPLACE FUNCTION public.record_kasir_sale_validate_subtype(
  -- [keep exact signature from 20260609000003]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice_prefix TEXT;
  -- [keep all existing]
BEGIN
  PERFORM public.validate_sales_channel(p_channel);
  -- [keep rest, substitute CASE block as above]
END $$;

-- Variant 3: record_kasir_sale_service_lines
-- Same substitutions — copy from 20260610000001.
CREATE OR REPLACE FUNCTION public.record_kasir_sale_service_lines(
  -- [keep exact signature from 20260610000001]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice_prefix TEXT;
  -- [keep all existing]
BEGIN
  PERFORM public.validate_sales_channel(p_channel);
  -- [keep rest, substitute CASE block as above]
END $$;
```

**Note for implementer**: The above is structural — fully copy each RPC body from its existing migration (20260609000001, 20260609000003, 20260610000001), then apply 3 changes per variant:
1. Drop the `IF p_channel NOT IN (...) THEN RAISE EXCEPTION ...` block, replace with `PERFORM public.validate_sales_channel(p_channel);` near top of body.
2. Replace the `v_invoice_prefix := CASE p_channel ...` block with the 14-channel version above.
3. **Rename param `p_tokped_order_no` → `p_marketplace_order_no`** (param name matches new column from Task 3). Update the INSERT statement column reference too (`marketplace_order_no` instead of `tokped_order_no`). All call sites in frontend will be updated in Task 19 to use the new param name. During Phase B+C overlap window, old frontend will still send `p_tokped_order_no` — kept supported via a thin compat wrapper IF backward-compat is critical, OR break atomically if migration is deployed alongside frontend.

- [ ] **Step 3: Apply migration**

```bash
supabase db push
```

- [ ] **Step 4: Smoke test each RPC accepts new channel**

```sql
-- Pick first variant — same logic for all 3:
SELECT public.record_kasir_sale(
  p_date := '2026-06-13'::date,
  p_channel := 'shopee',
  p_items := '[{"sku":"TEST-001","name":"Test Item","qty":1,"unit_price":1000,"hpp_per_unit":500,"subtotal":1000,"hpp_subtotal":500,"warehouse":"atas","warehouse_id":null}]'::jsonb,
  p_subtotal := 1000,
  p_payment_method := 'transfer',
  p_payment_type := 'FULL',
  p_dp_amount := 0,
  p_ongkir_amount := 0,
  p_total_amount := 1000,
  p_tokped_order_no := 'TEST-SHOPEE-001',  -- ✱ check whether RPC still uses old param name; rename if needed
  p_wa_phone := NULL,
  p_wa_chat_url := NULL,
  p_customer_name := 'QA-TEST-SHOPEE',
  p_customer_phone := '081234567890',
  p_customer_company := NULL,
  p_delivery_address := NULL,
  p_customer_id := NULL,
  p_dp_input_type := NULL,
  p_payment_subtype := NULL,
  p_notes := 'smoke test',
  p_created_by := NULL
);
-- expect: returns UUID, invoice_number starts with 'SHP-'
```

- [ ] **Step 5: Verify invoid prefix**

```sql
SELECT invoice_number FROM public.kasir_transactions
  WHERE customer_name = 'QA-TEST-SHOPEE' ORDER BY created_at DESC LIMIT 1;
-- expect: SHP-... format
```

- [ ] **Step 6: Cleanup smoke test**

```sql
DELETE FROM public.kasir_transactions WHERE customer_name = 'QA-TEST-SHOPEE';
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260613000021_sales_channels_phase_b_rpcs.sql
git commit -m "feat(sales-channels): phase B.2 — refactor 3 record_kasir_sale variants with validate helper + 14-channel invoice prefix"
```

### Task 8: Phase B migration — realtime publication

**Files:**
- Create: `supabase/migrations/20260613000022_sales_channels_phase_b_realtime.sql`

- [ ] **Step 1: Add table to realtime publication**

```sql
-- Phase B — Enable Supabase realtime for sales_channel_settings so admin
-- toggle in tab A is reflected in tab B's PenjualanBaru/etc within <2s.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sales_channel_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_channel_settings;
  END IF;
END $$;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

- [ ] **Step 3: Verify publication**

```sql
SELECT tablename FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime' AND tablename = 'sales_channel_settings';
-- expect: 1 row
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260613000022_sales_channels_phase_b_realtime.sql
git commit -m "feat(sales-channels): phase B.3 — enable supabase_realtime for sales_channel_settings"
```

### Task 9: Phase B integration tests

**Files:**
- Create: `tests/integration/sales-channels.test.ts`

- [ ] **Step 1: Write failing test for ENUM acceptance**

```typescript
/**
 * Integration tests for configurable sales channels (Phase A+B).
 * Spec: docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY/VITE_SUPABASE_ANON_KEY missing');
}

let supabase: SupabaseClient;
const TEST_PREFIX = `QA-CHAN-${Date.now()}`;
const ALL_CHANNELS = [
  'walkin','grosir','sales','expo',
  'tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka',
  'whatsapp','instagram','website',
] as const;

beforeAll(() => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
});

afterAll(async () => {
  // Cleanup any test rows
  await supabase.from('kasir_transactions').delete().like('customer_name', `${TEST_PREFIX}%`);
});

describe('Phase A — ENUM + table', () => {
  test('sales_channel_settings has 14 seeded rows', async () => {
    const { data, error } = await supabase
      .from('sales_channel_settings')
      .select('channel_code, is_visible, sort_order')
      .order('sort_order');
    expect(error).toBeNull();
    expect(data?.length).toBe(14);
    expect(data?.map(r => r.channel_code)).toEqual([...ALL_CHANNELS]);
    expect(data?.every(r => r.is_visible === true)).toBe(true);
  });

  test('validate_sales_channel rejects invalid channel', async () => {
    const { error } = await supabase.rpc('validate_sales_channel', { p_channel: 'invalid-foo' });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/invalid sales channel/i);
  });

  test('validate_sales_channel accepts all 14 channels', async () => {
    for (const ch of ALL_CHANNELS) {
      const { error } = await supabase.rpc('validate_sales_channel', { p_channel: ch });
      expect(error, `channel=${ch}`).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test, expect pass**

```bash
npm run test:integration -- sales-channels
```
Expected: all 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/sales-channels.test.ts
git commit -m "test(sales-channels): integration tests for Phase A+B schema"
```

---

## Phase C — Frontend Infrastructure

### Task 10: Update TypeScript types

**Files:**
- Modify: `src/types.ts` (line 397-398, line 6 PermissionSet)

- [ ] **Step 1: Replace SalesChannel/KasirChannel union + add OrdersChannel**

Edit `src/types.ts` line 397-398:

```typescript
// BEFORE
export type KasirChannel = 'walkin' | 'tokopedia' | 'grosir' | 'whatsapp';
export type SalesChannel = 'whatsapp' | 'walkin' | 'tokopedia' | 'grosir';

// AFTER
export type SalesChannel =
  | 'walkin' | 'grosir' | 'sales' | 'expo'
  | 'tokopedia' | 'shopee' | 'lazada' | 'blibli' | 'bukalapak' | 'ralali' | 'bhinneka'
  | 'whatsapp' | 'instagram' | 'website';

export type KasirChannel = SalesChannel;

// D16: narrower type for orders-flow only (matches CHECK constraint on orders.sales_channel)
export type OrdersChannel = Extract<SalesChannel, 'whatsapp' | 'walkin'>;
```

- [ ] **Step 2: Add canConfigureSalesChannels to PermissionSet**

Edit `src/types.ts` line ~50 (end of `PermissionSet` interface, before closing `}`):

```typescript
  // Sales channel admin (2026-06-13 spec)
  canConfigureSalesChannels?: boolean;
```

Edit `src/types.ts` line ~88 (end of `ALL_PERMISSIONS` const, before closing `}`):

```typescript
  canConfigureSalesChannels: true,
```

- [ ] **Step 3: Verify tsc compiles**

Run:
```bash
npm run lint
```
Expected: type errors only in files yang masih reference channel hardcode (DbOrder line 216 — leave that for later task).

- [ ] **Step 4: Update DbOrder.sales_channel type** (since orders table only accepts whatsapp/walkin)

Edit `src/types.ts` line 216:

```typescript
// BEFORE
sales_channel: 'whatsapp' | 'walkin';

// AFTER
sales_channel: OrdersChannel;  // CHECK constraint restricts to whatsapp/walkin
```

- [ ] **Step 5: Re-run lint**

```bash
npm run lint
```
Expected: clean (or warnings only in files yang akan di-touch tasks berikutnya — track tapi don't fail).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(sales-channels): expand SalesChannel union to 14, add OrdersChannel narrower type, canConfigureSalesChannels permission"
```

### Task 11: Add Tailwind brand color tokens

**Files:**
- Modify: `src/index.css` (Tailwind v4 `@theme` block)

- [ ] **Step 1: Add brand colors to @theme**

Edit `src/index.css` after line 16 (closing `}` of `@theme` — extend the block):

```css
@theme {
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  --color-primary: #1e3d60;
  --color-secondary: #2d8a4e;
  --color-on-surface: #0b1c30;
  --color-background-soft: #f8f9ff;

  --radius-default: 1rem;
  --radius-lg: 2rem;
  --radius-xl: 3rem;
  --radius-signature: 2rem;

  /* Sales channel brand colors (D17) — used as background for icon containers + chart segments + pill border */
  --color-channel-walkin:    #64748B;
  --color-channel-grosir:    #7C3AED;
  --color-channel-sales:     #D97706;
  --color-channel-expo:      #0D9488;
  --color-channel-tokopedia: #03AC0E;
  --color-channel-shopee:    #EE4D2D;
  --color-channel-lazada:    #0F146E;
  --color-channel-blibli:    #0095DA;
  --color-channel-bukalapak: #E31E52;
  --color-channel-ralali:    #1E3A8A;
  --color-channel-bhinneka:  #E63946;
  --color-channel-whatsapp:  #25D366;
  --color-channel-instagram: #E1306C;
  --color-channel-website:   #475569;
}
```

- [ ] **Step 2: Verify build picks up tokens**

Run:
```bash
npm run build
```
Expected: builds clean. Brand colors now usable as `bg-channel-shopee`, `text-channel-tokopedia`, etc.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(sales-channels): add 14 brand color tokens to Tailwind @theme"
```

### Task 12: Brand logo SVG assets

**Files:**
- Create: `public/icons/channels/tokopedia.svg`
- Create: `public/icons/channels/shopee.svg`
- Create: `public/icons/channels/lazada.svg`
- Create: `public/icons/channels/blibli.svg`
- Create: `public/icons/channels/bukalapak.svg`
- Create: `public/icons/channels/ralali.svg`
- Create: `public/icons/channels/bhinneka.svg`
- Create: `public/icons/channels/whatsapp.svg`
- Create: `public/icons/channels/instagram.svg`

- [ ] **Step 1: Collect brand SVGs**

For each brand, source the official SVG logo:
- **Tokopedia**: https://www.tokopedia.com/promo/brand-guidelines (or use simpleicons.org/icons/tokopedia)
- **Shopee**: simpleicons.org/icons/shopee
- **Lazada**: official brand kit
- **WhatsApp**: simpleicons.org/icons/whatsapp
- **Instagram**: simpleicons.org/icons/instagram
- **TikTok**: simpleicons.org/icons/tiktok (note: spec merges with Tokopedia, so just keep tokopedia.svg with combined branding)

For brands not in simple-icons (Blibli, Bukalapak, Ralali, Bhinneka): download official press-kit SVG or use a clean text-mark fallback.

For each SVG:
1. Normalize viewBox to `0 0 24 24` for consistency
2. Use single `<path fill="currentColor">` so the icon inherits brand color
3. Strip XML headers / unused elements

Example structure (`shopee.svg`):
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <title>Shopee</title>
  <path d="M12 .002C8.49.002 5.64 2.92 5.64 6.515h-3.27v15.484h19.26V6.515h-3.27c0-3.595-2.85-6.513-6.36-6.513zm0 1.84c2.55 0 4.62 2.09 4.62 4.673h-9.24c0-2.583 2.07-4.673 4.62-4.673z"/>
</svg>
```

- [ ] **Step 2: Verify files are loadable**

Start dev server and test direct URL:
```bash
npm run dev
```
Open http://localhost:3000/icons/channels/shopee.svg in browser — expect SVG renders.

- [ ] **Step 3: Add a sanity render test page (temporary)**

Create `public/icons/channels/_preview.html`:

```html
<!DOCTYPE html>
<html><body style="background:#f1f5f9;padding:24px;font-family:system-ui">
<h2>Channel brand logos preview</h2>
<div style="display:flex;gap:16px;flex-wrap:wrap">
  <div style="background:#03AC0E;width:48px;height:48px;border-radius:8px;display:flex;align-items:center;justify-content:center"><img src="tokopedia.svg" style="width:28px;height:28px;filter:brightness(0) invert(1)"></div>
  <div style="background:#EE4D2D;width:48px;height:48px;border-radius:8px;display:flex;align-items:center;justify-content:center"><img src="shopee.svg" style="width:28px;height:28px;filter:brightness(0) invert(1)"></div>
  <!-- ... add 7 more ... -->
</div>
</body></html>
```

Open http://localhost:3000/icons/channels/_preview.html — all 9 logos render white-on-brand-color background.

- [ ] **Step 4: Delete preview HTML after verification**

```bash
rm /Users/tonywei/IdeaProjects/ERPAntigravity/public/icons/channels/_preview.html
```

- [ ] **Step 5: Commit**

```bash
git add public/icons/channels/
git commit -m "feat(sales-channels): brand logo SVGs for 9 marketplace/social channels"
```

### Task 13: Create salesChannels.ts source of truth

**Files:**
- Create: `src/lib/salesChannels.ts`

- [ ] **Step 1: Write failing unit test**

Create `src/lib/salesChannels.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import {
  CHANNEL_VISUAL,
  CHANNEL_GROUPS,
  CHANNEL_REQUIRES_ORDER_NO,
  CHANNEL_LOCKED,
  getChannelDef,
} from './salesChannels';

describe('salesChannels', () => {
  test('CHANNEL_VISUAL has 14 entries with unique invoice prefix', () => {
    const codes = Object.keys(CHANNEL_VISUAL);
    expect(codes.length).toBe(14);
    const prefixes = codes.map(c => CHANNEL_VISUAL[c as keyof typeof CHANNEL_VISUAL].invoicePrefix);
    expect(new Set(prefixes).size).toBe(14);  // all unique
  });

  test('CHANNEL_GROUPS partitions 14 channels exactly once', () => {
    const allFromGroups = [
      ...CHANNEL_GROUPS.offline,
      ...CHANNEL_GROUPS.marketplace,
      ...CHANNEL_GROUPS.direct,
    ];
    expect(allFromGroups.length).toBe(14);
    expect(new Set(allFromGroups).size).toBe(14);
  });

  test('CHANNEL_REQUIRES_ORDER_NO matches marketplace group', () => {
    expect(Array.from(CHANNEL_REQUIRES_ORDER_NO).sort())
      .toEqual([...CHANNEL_GROUPS.marketplace].sort());
  });

  test('CHANNEL_LOCKED contains walkin only', () => {
    expect(Array.from(CHANNEL_LOCKED)).toEqual(['walkin']);
  });

  test('getChannelDef returns expected shape', () => {
    const def = getChannelDef('shopee');
    expect(def.code).toBe('shopee');
    expect(def.label).toBe('Shopee');
    expect(def.group).toBe('marketplace');
    expect(def.invoicePrefix).toBe('SHP');
    expect(def.requiresOrderNo).toBe(true);
  });

  test('whatsapp uses orders flow, others use kasir', () => {
    expect(CHANNEL_VISUAL.whatsapp.flow).toBe('orders');
    expect(CHANNEL_VISUAL.walkin.flow).toBe('kasir');
    expect(CHANNEL_VISUAL.shopee.flow).toBe('kasir');
  });
});
```

- [ ] **Step 2: Run test (expect fail — module doesn't exist)**

```bash
npx vitest run src/lib/salesChannels.test.ts
```
Expected: FAIL — `Cannot find module './salesChannels'`

- [ ] **Step 3: Create the module**

Create `src/lib/salesChannels.ts`:

```typescript
/**
 * Single source of truth for the 14 canonical sales channels.
 * Replaces the 5 scattered hardcoded maps (salesEntries CHANNEL_LABEL/BADGE_CLASS,
 * SalesInvoicePDF inline hash, KasirInvoiceModal inline hash, OrdersColumn CHANNEL_PILL).
 *
 * Spec: docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md
 */

import type { SalesChannel } from '../types';

export type ChannelGroup = 'offline' | 'marketplace' | 'direct';

export interface ChannelDef {
  code: SalesChannel;
  label: string;
  // D17: brand logo SVG (path under public/) or Lucide icon name
  iconType: 'svg' | 'lucide';
  iconAsset: string;
  group: ChannelGroup;
  invoicePrefix: string;
  flow: 'kasir' | 'orders';
  requiresOrderNo: boolean;
  brandColor: string;       // hex
  bgClass: string;          // Tailwind utility when pill active (soft tint)
  textClass: string;
  borderClass: string;
}

export const CHANNEL_VISUAL: Record<SalesChannel, ChannelDef> = {
  walkin: {
    code: 'walkin', label: 'Walk-in', iconType: 'lucide', iconAsset: 'Store',
    group: 'offline', invoicePrefix: 'WLK', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#64748B',
    bgClass: 'bg-slate-100', textClass: 'text-slate-700', borderClass: 'border-slate-500',
  },
  grosir: {
    code: 'grosir', label: 'Grosir', iconType: 'lucide', iconAsset: 'Warehouse',
    group: 'offline', invoicePrefix: 'GSR', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#7C3AED',
    bgClass: 'bg-violet-50', textClass: 'text-violet-700', borderClass: 'border-violet-600',
  },
  sales: {
    code: 'sales', label: 'Sales Lapangan', iconType: 'lucide', iconAsset: 'Briefcase',
    group: 'offline', invoicePrefix: 'SLS', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#D97706',
    bgClass: 'bg-amber-50', textClass: 'text-amber-700', borderClass: 'border-amber-600',
  },
  expo: {
    code: 'expo', label: 'Pameran / Expo', iconType: 'lucide', iconAsset: 'Tent',
    group: 'offline', invoicePrefix: 'EXP', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#0D9488',
    bgClass: 'bg-teal-50', textClass: 'text-teal-700', borderClass: 'border-teal-600',
  },
  tokopedia: {
    code: 'tokopedia', label: 'Tokopedia / TikTok Shop', iconType: 'svg', iconAsset: '/icons/channels/tokopedia.svg',
    group: 'marketplace', invoicePrefix: 'TPD', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#03AC0E',
    bgClass: 'bg-green-50', textClass: 'text-green-700', borderClass: 'border-green-600',
  },
  shopee: {
    code: 'shopee', label: 'Shopee', iconType: 'svg', iconAsset: '/icons/channels/shopee.svg',
    group: 'marketplace', invoicePrefix: 'SHP', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#EE4D2D',
    bgClass: 'bg-orange-50', textClass: 'text-orange-700', borderClass: 'border-orange-600',
  },
  lazada: {
    code: 'lazada', label: 'Lazada', iconType: 'svg', iconAsset: '/icons/channels/lazada.svg',
    group: 'marketplace', invoicePrefix: 'LZD', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#0F146E',
    bgClass: 'bg-indigo-50', textClass: 'text-indigo-700', borderClass: 'border-indigo-700',
  },
  blibli: {
    code: 'blibli', label: 'Blibli', iconType: 'svg', iconAsset: '/icons/channels/blibli.svg',
    group: 'marketplace', invoicePrefix: 'BLB', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#0095DA',
    bgClass: 'bg-sky-50', textClass: 'text-sky-700', borderClass: 'border-sky-600',
  },
  bukalapak: {
    code: 'bukalapak', label: 'Bukalapak', iconType: 'svg', iconAsset: '/icons/channels/bukalapak.svg',
    group: 'marketplace', invoicePrefix: 'BKL', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#E31E52',
    bgClass: 'bg-rose-50', textClass: 'text-rose-700', borderClass: 'border-rose-600',
  },
  ralali: {
    code: 'ralali', label: 'Ralali', iconType: 'svg', iconAsset: '/icons/channels/ralali.svg',
    group: 'marketplace', invoicePrefix: 'RLI', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#1E3A8A',
    bgClass: 'bg-blue-50', textClass: 'text-blue-800', borderClass: 'border-blue-800',
  },
  bhinneka: {
    code: 'bhinneka', label: 'Bhinneka', iconType: 'svg', iconAsset: '/icons/channels/bhinneka.svg',
    group: 'marketplace', invoicePrefix: 'BHN', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#E63946',
    bgClass: 'bg-red-50', textClass: 'text-red-700', borderClass: 'border-red-600',
  },
  whatsapp: {
    code: 'whatsapp', label: 'WhatsApp', iconType: 'svg', iconAsset: '/icons/channels/whatsapp.svg',
    group: 'direct', invoicePrefix: 'WAM', flow: 'orders', requiresOrderNo: false,
    brandColor: '#25D366',
    bgClass: 'bg-emerald-50', textClass: 'text-emerald-700', borderClass: 'border-emerald-600',
  },
  instagram: {
    code: 'instagram', label: 'Instagram DM', iconType: 'svg', iconAsset: '/icons/channels/instagram.svg',
    group: 'direct', invoicePrefix: 'IGM', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#E1306C',
    bgClass: 'bg-pink-50', textClass: 'text-pink-700', borderClass: 'border-pink-600',
  },
  website: {
    code: 'website', label: 'Website Sendiri', iconType: 'lucide', iconAsset: 'Globe',
    group: 'direct', invoicePrefix: 'WEB', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#475569',
    bgClass: 'bg-slate-100', textClass: 'text-slate-700', borderClass: 'border-slate-600',
  },
};

export const CHANNEL_GROUPS: Record<ChannelGroup, SalesChannel[]> = {
  offline:     ['walkin', 'grosir', 'sales', 'expo'],
  marketplace: ['tokopedia', 'shopee', 'lazada', 'blibli', 'bukalapak', 'ralali', 'bhinneka'],
  direct:      ['whatsapp', 'instagram', 'website'],
};

export const CHANNEL_REQUIRES_ORDER_NO: Set<SalesChannel> = new Set(CHANNEL_GROUPS.marketplace);

export const CHANNEL_LOCKED: Set<SalesChannel> = new Set(['walkin']);

export function getChannelDef(code: SalesChannel): ChannelDef {
  return CHANNEL_VISUAL[code];
}

export function isMarketplaceChannel(code: SalesChannel): boolean {
  return CHANNEL_GROUPS.marketplace.includes(code);
}

export function getGroupOf(code: SalesChannel): ChannelGroup {
  return getChannelDef(code).group;
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npx vitest run src/lib/salesChannels.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/salesChannels.ts src/lib/salesChannels.test.ts
git commit -m "feat(sales-channels): single source of truth — CHANNEL_VISUAL + helpers with unit tests"
```

### Task 14: Refactor salesEntries.ts to re-export

**Files:**
- Modify: `src/lib/salesEntries.ts` (line 54-66 — drop legacy maps)

- [ ] **Step 1: Replace CHANNEL_LABEL and CHANNEL_BADGE_CLASS with re-exports**

Edit `src/lib/salesEntries.ts`. Replace the entire block from line 54 to end-of-file:

```typescript
// BEFORE (line 54-66)
export const CHANNEL_LABEL: Record<SalesChannel, string> = {
  whatsapp:  'WhatsApp',
  walkin:    'Walk-in',
  tokopedia: 'Tokopedia',
  grosir:    'Grosir',
};

export const CHANNEL_BADGE_CLASS: Record<SalesChannel, string> = {
  whatsapp:  'bg-emerald-100 text-emerald-800',
  walkin:    'bg-slate-100 text-slate-700',
  tokopedia: 'bg-green-100 text-green-800',
  grosir:    'bg-amber-100 text-amber-800',
};

// AFTER
// CHANNEL_LABEL and CHANNEL_BADGE_CLASS are deprecated — use CHANNEL_VISUAL from salesChannels.
// These re-exports provide backward-compat for legacy callers; remove after Phase D cleanup.
import { CHANNEL_VISUAL } from './salesChannels';

export const CHANNEL_LABEL: Record<SalesChannel, string> = Object.fromEntries(
  Object.entries(CHANNEL_VISUAL).map(([code, def]) => [code, def.label])
) as Record<SalesChannel, string>;

export const CHANNEL_BADGE_CLASS: Record<SalesChannel, string> = Object.fromEntries(
  Object.entries(CHANNEL_VISUAL).map(([code, def]) => [code, `${def.bgClass} ${def.textClass}`])
) as Record<SalesChannel, string>;
```

- [ ] **Step 2: Verify tsc**

```bash
npm run lint
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/salesEntries.ts
git commit -m "refactor(sales-channels): salesEntries re-exports from salesChannels (drop legacy maps)"
```

### Task 15: Create SalesChannelsContext

**Files:**
- Create: `src/contexts/SalesChannelsContext.tsx`

- [ ] **Step 1: Create context provider**

```typescript
/**
 * Single React context that loads sales_channel_settings once, subscribes
 * to realtime updates, and exposes visibility state + toggle action to consumers.
 *
 * Spec: docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { SalesChannel } from '../types';
import { CHANNEL_GROUPS, CHANNEL_LOCKED, type ChannelGroup } from '../lib/salesChannels';

interface ChannelSetting {
  isVisible: boolean;
  sortOrder: number;
}

interface SalesChannelsCtxValue {
  settings: Record<SalesChannel, ChannelSetting>;
  visibleChannels: SalesChannel[];                              // sorted by sort_order
  visibleByGroup: Record<ChannelGroup, SalesChannel[]>;
  isLoading: boolean;
  toggleVisibility: (code: SalesChannel) => Promise<void>;
}

// Default state — used while loading or if Supabase unavailable.
// All channels visible by default; sort order matches CHANNEL_GROUPS canonical order.
const DEFAULT_SETTINGS: Record<SalesChannel, ChannelSetting> = (() => {
  const all = [...CHANNEL_GROUPS.offline, ...CHANNEL_GROUPS.marketplace, ...CHANNEL_GROUPS.direct];
  const out = {} as Record<SalesChannel, ChannelSetting>;
  all.forEach((code, idx) => { out[code] = { isVisible: true, sortOrder: (idx + 1) * 10 }; });
  return out;
})();

const SalesChannelsCtx = createContext<SalesChannelsCtxValue | null>(null);

export function SalesChannelsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<SalesChannel, ChannelSetting>>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  // Load initial settings
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    supabase
      .from('sales_channel_settings')
      .select('channel_code, is_visible, sort_order')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('SalesChannelsContext load error:', error);
          setIsLoading(false);
          return;
        }
        if (data) {
          const next = { ...DEFAULT_SETTINGS };
          data.forEach(row => {
            next[row.channel_code as SalesChannel] = {
              isVisible: row.is_visible,
              sortOrder: row.sort_order,
            };
          });
          setSettings(next);
        }
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Subscribe realtime — suffix UUID per spec to avoid multi-tab topic collision
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    const topic = `sales_channel_settings:${crypto.randomUUID()}`;
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'sales_channel_settings',
      }, payload => {
        const row = (payload.new ?? payload.old) as { channel_code?: string; is_visible?: boolean; sort_order?: number };
        if (!row?.channel_code) return;
        setSettings(prev => ({
          ...prev,
          [row.channel_code as SalesChannel]: {
            isVisible: row.is_visible ?? prev[row.channel_code as SalesChannel].isVisible,
            sortOrder: row.sort_order ?? prev[row.channel_code as SalesChannel].sortOrder,
          },
        }));
      })
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, []);

  const toggleVisibility = useCallback(async (code: SalesChannel): Promise<void> => {
    if (CHANNEL_LOCKED.has(code)) {
      throw new Error(`Channel ${code} is locked and cannot be hidden`);
    }
    if (!supabase) throw new Error('Supabase not configured');

    const current = settings[code].isVisible;
    // Optimistic update
    setSettings(prev => ({ ...prev, [code]: { ...prev[code], isVisible: !current } }));
    const { error } = await supabase
      .from('sales_channel_settings')
      .update({ is_visible: !current, updated_at: new Date().toISOString() })
      .eq('channel_code', code);
    if (error) {
      // Rollback on failure
      setSettings(prev => ({ ...prev, [code]: { ...prev[code], isVisible: current } }));
      throw error;
    }
  }, [settings]);

  const visibleChannels = useMemo(() => {
    return Object.entries(settings)
      .filter(([, s]) => s.isVisible)
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .map(([code]) => code as SalesChannel);
  }, [settings]);

  const visibleByGroup = useMemo<Record<ChannelGroup, SalesChannel[]>>(() => ({
    offline:     visibleChannels.filter(c => CHANNEL_GROUPS.offline.includes(c)),
    marketplace: visibleChannels.filter(c => CHANNEL_GROUPS.marketplace.includes(c)),
    direct:      visibleChannels.filter(c => CHANNEL_GROUPS.direct.includes(c)),
  }), [visibleChannels]);

  const value: SalesChannelsCtxValue = {
    settings, visibleChannels, visibleByGroup, isLoading, toggleVisibility,
  };

  return <SalesChannelsCtx.Provider value={value}>{children}</SalesChannelsCtx.Provider>;
}

export function useSalesChannels(): SalesChannelsCtxValue {
  const ctx = useContext(SalesChannelsCtx);
  if (!ctx) throw new Error('useSalesChannels must be used within SalesChannelsProvider');
  return ctx;
}
```

- [ ] **Step 2: Verify tsc**

```bash
npm run lint
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/contexts/SalesChannelsContext.tsx
git commit -m "feat(sales-channels): SalesChannelsContext — load + realtime + toggle"
```

### Task 16: Wrap App.tsx with provider

**Files:**
- Modify: `src/App.tsx` (line 58 — widen type; wrap root component)

- [ ] **Step 1: Add import**

Add at top of `src/App.tsx` after existing imports:

```typescript
import { SalesChannelsProvider } from './contexts/SalesChannelsContext';
```

- [ ] **Step 2: Widen penjualanInitialChannel type**

Edit line 58:

```typescript
// BEFORE
const [penjualanInitialChannel, setPenjualanInitialChannel] = useState<KasirChannel | undefined>(undefined);

// AFTER — KasirChannel is now an alias for the 14-value SalesChannel union, no change needed
// (this is a no-op after Task 10 — just verify the line still compiles)
```

- [ ] **Step 3: Wrap root JSX with provider**

Find the top-level return (likely wrapping a router/auth provider). Wrap everything inside an existing `<AuthProvider>` (or equivalent):

```tsx
// BEFORE
return (
  <AuthProvider>
    <div className="min-h-screen bg-slate-100">
      {/* ... routing ... */}
    </div>
  </AuthProvider>
);

// AFTER
return (
  <AuthProvider>
    <SalesChannelsProvider>
      <div className="min-h-screen bg-slate-100">
        {/* ... routing ... */}
      </div>
    </SalesChannelsProvider>
  </AuthProvider>
);
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(sales-channels): wrap App with SalesChannelsProvider"
```

### Task 17: Create ChannelIcon component

**Files:**
- Create: `src/components/icons/ChannelIcon.tsx`

- [ ] **Step 1: Create the icon renderer**

```typescript
/**
 * Renders the channel icon: brand SVG (loaded via <img>) for marketplace/social
 * channels, Lucide icon for non-brand channels.
 *
 * Usage: <ChannelIcon code="shopee" size={20} className="text-white" />
 */

import React from 'react';
import { Store, Warehouse, Briefcase, Tent, Globe, type LucideIcon } from 'lucide-react';
import { getChannelDef } from '../../lib/salesChannels';
import type { SalesChannel } from '../../types';

// Lucide icon registry — map ChannelDef.iconAsset string to component
const LUCIDE_REGISTRY: Record<string, LucideIcon> = {
  Store,
  Warehouse,
  Briefcase,
  Tent,
  Globe,
};

interface ChannelIconProps {
  code: SalesChannel;
  size?: number;        // pixel size, default 20
  className?: string;   // extra Tailwind classes (e.g. for tint via currentColor)
}

export default function ChannelIcon({ code, size = 20, className = '' }: ChannelIconProps) {
  const def = getChannelDef(code);
  if (def.iconType === 'lucide') {
    const Icon = LUCIDE_REGISTRY[def.iconAsset];
    if (!Icon) return null;
    return <Icon size={size} className={className} />;
  }
  // SVG asset — currentColor inheritance via CSS filter trick OR use inline SVG.
  // For simplicity here, render <img> with brand color via container background and
  // `filter: brightness(0) invert(1)` for white-on-color rendering.
  return (
    <img
      src={def.iconAsset}
      alt={def.label}
      style={{ width: size, height: size, filter: 'brightness(0) invert(1)' }}
      className={className}
    />
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/icons/ChannelIcon.tsx
git commit -m "feat(sales-channels): ChannelIcon component — SVG brand logo + Lucide fallback"
```

---

## Phase C — Frontend Screens (Input Side)

### Task 18: Refactor ChannelSelector — props-driven + group rendering

**Files:**
- Modify: `src/components/penjualan/ChannelSelector.tsx`

- [ ] **Step 1: Replace component implementation**

```typescript
import React from 'react';
import type { SalesChannel } from '../../types';
import { useSalesChannels } from '../../contexts/SalesChannelsContext';
import { getChannelDef, type ChannelGroup } from '../../lib/salesChannels';
import ChannelIcon from '../icons/ChannelIcon';

export interface ChannelSelectorProps {
  value: SalesChannel;
  onChange: (next: SalesChannel) => void;
}

const GROUP_LABEL: Record<ChannelGroup, string> = {
  offline: 'Offline',
  marketplace: 'Marketplace',
  direct: 'Direct Online',
};

const GROUP_ORDER: ChannelGroup[] = ['offline', 'marketplace', 'direct'];

export default function ChannelSelector({ value, onChange }: ChannelSelectorProps) {
  const { visibleByGroup } = useSalesChannels();

  return (
    <div>
      <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-3">
        Kanal Penjualan
      </label>
      {GROUP_ORDER.map(group => {
        const channels = visibleByGroup[group];
        if (channels.length === 0) return null;
        return (
          <div key={group} className="mb-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 pl-1">
              {GROUP_LABEL[group]}
            </div>
            <div className="flex gap-2 flex-wrap">
              {channels.map(code => {
                const def = getChannelDef(code);
                const isActive = value === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onChange(code)}
                    className={`px-4 py-2 rounded-full text-[13px] font-bold border flex items-center gap-1.5 transition ${
                      isActive
                        ? `${def.bgClass} ${def.textClass} ${def.borderClass} shadow-sm -translate-y-px`
                        : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className="w-5 h-5 rounded flex items-center justify-center"
                      style={{ background: isActive ? def.brandColor : 'transparent' }}
                    >
                      <ChannelIcon code={code} size={14} className={isActive ? '' : 'text-slate-400'} />
                    </span>
                    <span>{def.label}</span>
                    {code === 'whatsapp' && isActive && (
                      <span className="ml-1 text-[10px] bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded font-extrabold">MANUAL</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="text-[11px] text-slate-400 pl-1 mt-1">
        Atur kanal aktif di Pengaturan → Kanal Penjualan
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/ChannelSelector.tsx
git commit -m "refactor(sales-channels): ChannelSelector — props-driven, grouped, brand logo"
```

### Task 19: Update PenjualanBaruScreen — rename state + conditional fields

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx` (line 201, 242, 297, 351 — drop `channel === 'tokopedia'` hardcode)

- [ ] **Step 1: Rename state**

Find `const [tokpedOrderNo, setTokpedOrderNo] = useState('')` (likely near top of component) — replace:

```typescript
// BEFORE
const [tokpedOrderNo, setTokpedOrderNo] = useState('');

// AFTER
const [marketplaceOrderNo, setMarketplaceOrderNo] = useState('');
```

- [ ] **Step 2: Replace conditional check at line 351**

```tsx
// BEFORE
{channel === 'tokopedia' && (
  <div className="mt-4">
    <TokpedStrip value={tokpedOrderNo} onChange={setTokpedOrderNo} />
  </div>
)}

// AFTER
import { CHANNEL_REQUIRES_ORDER_NO } from '../lib/salesChannels';
// ...
{CHANNEL_REQUIRES_ORDER_NO.has(channel) && (
  <div className="mt-4">
    <MarketplaceOrderNoStrip value={marketplaceOrderNo} onChange={setMarketplaceOrderNo} />
  </div>
)}
```

- [ ] **Step 3: Rename TokpedStrip → MarketplaceOrderNoStrip**

If a separate `TokpedStrip` component exists in `src/components/penjualan/`, rename file and component. Update label inside from "No. Order Tokped" to "Nomor Order Marketplace *", placeholder to generic "Contoh: SHP-2406-12345 / INV/...".

If TokpedStrip is inline JSX, just update the label text and placeholder.

- [ ] **Step 4: Update validation logic at line 201**

```tsx
// BEFORE
if (channel === 'tokopedia' && !tokpedOrderNo.trim()) {
  showToast('No. Order Tokped wajib diisi.', 'warning');
  return;
}

// AFTER
if (CHANNEL_REQUIRES_ORDER_NO.has(channel) && !marketplaceOrderNo.trim()) {
  showToast('Nomor Order Marketplace wajib diisi.', 'warning');
  return;
}
```

- [ ] **Step 5: Update payload mapping line 242, 297**

```tsx
// BEFORE
tokped_order_no: channel === 'tokopedia' ? tokpedOrderNo : null,

// AFTER
marketplace_order_no: CHANNEL_REQUIRES_ORDER_NO.has(channel) ? marketplaceOrderNo : null,
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx src/components/penjualan/MarketplaceOrderNoStrip.tsx
git commit -m "refactor(sales-channels): PenjualanBaru — rename to marketplaceOrderNo, dynamic conditional via CHANNEL_REQUIRES_ORDER_NO"
```

### Task 20: KasirScreen — remove kartu cepat + refactor filter

**Files:**
- Modify: `src/components/KasirScreen.tsx` (line 187, 429+)

- [ ] **Step 1: Remove 3 kartu cepat**

Find the block around line 429 starting `{(['walkin', 'tokopedia', 'grosir'] as KasirChannel[]).map(ch => (...`. Delete this entire `.map` block including its parent container.

- [ ] **Step 2: Update import**

Add at top:
```typescript
import { CHANNEL_GROUPS } from '../lib/salesChannels';
```

- [ ] **Step 3: Refactor filter heuristic at line 187**

```typescript
// BEFORE
if (filter === 'online') return e._src === 'kasir' && (e.tx!.channel === 'tokopedia' || e.tx!.channel === 'grosir');

// AFTER (semantic shift: 'online' filter now means "marketplace group")
if (filter === 'online') return e._src === 'kasir' && CHANNEL_GROUPS.marketplace.includes(e.tx!.channel as SalesChannel);
```

- [ ] **Step 4: Update local CHANNEL_LABEL map (line 32-34) to remove hardcoded entries**

Find local label/badge maps at line 32-64. Replace with imports:
```typescript
import { CHANNEL_VISUAL } from '../lib/salesChannels';
// drop local CHANNEL_LABEL and CHANNEL_BADGE — use CHANNEL_VISUAL[code].label / bgClass
```

Update all reference sites in this file accordingly.

- [ ] **Step 5: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/KasirScreen.tsx
git commit -m "refactor(sales-channels): KasirScreen — drop 3 kartu cepat, group-based filter"
```

### Task 21: Update SalesInvoicePDF + KasirInvoiceModal

**Files:**
- Modify: `src/components/penjualan/SalesInvoicePDF.tsx` (line 52)
- Modify: `src/components/KasirInvoiceModal.tsx` (line 25-27, 107)

- [ ] **Step 1: SalesInvoicePDF — replace inline hash**

Edit line 52:

```typescript
// BEFORE
const channelLabel = {
  walkin: 'Walk-in', tokopedia: 'Tokopedia', grosir: 'Grosir', whatsapp: 'WhatsApp Manual',
}[transaction.channel ?? 'walkin'] ?? '';

// AFTER
import { CHANNEL_VISUAL } from '../../lib/salesChannels';
// ...
const channelLabel = CHANNEL_VISUAL[(transaction.channel ?? 'walkin') as SalesChannel].label;
```

- [ ] **Step 2: KasirInvoiceModal — replace inline hash**

Edit line 25-27:

```typescript
// BEFORE
const CHANNEL_LABEL = {
  walkin: 'Walk-in / Konter',
  tokopedia: 'Tokopedia',
  grosir: 'Grosir / Partai',
};
// ... line 107
{transaction.channel ? CHANNEL_LABEL[transaction.channel] : ''}

// AFTER
import { CHANNEL_VISUAL } from './../lib/salesChannels';
// remove local CHANNEL_LABEL const
// ... line 107
{transaction.channel ? CHANNEL_VISUAL[transaction.channel].label : ''}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/penjualan/SalesInvoicePDF.tsx src/components/KasirInvoiceModal.tsx
git commit -m "refactor(sales-channels): SalesInvoicePDF + KasirInvoiceModal — use CHANNEL_VISUAL"
```

---

## Phase D — Frontend Screens (Display Side)

### Task 22: Refactor supabaseClient bucket functions

**Files:**
- Modify: `src/lib/supabaseClient.ts` (line 509-535, 626-660 — 2 nearly-identical bucket fns)

- [ ] **Step 1: Add bucketByChannel helper at top of file**

Add after existing imports:

```typescript
import type { SalesChannel } from '../types';

/**
 * Bucket kasir income rows by date and channel.
 * Replaces 2 nearly-identical hardcoded bucket functions.
 *
 * Returns `Record<dateString, Record<channel, totalAmount>>`. Channels with zero
 * revenue on a date are omitted (the consumer fills zeros if needed for chart axes).
 */
function bucketByChannel(
  rows: Array<{ subtotal: number; channel?: string | null; date: string }>,
): Record<string, Partial<Record<SalesChannel, number>>> {
  const out: Record<string, Partial<Record<SalesChannel, number>>> = {};
  for (const row of rows) {
    const date = wibDateString(row.date);
    const ch = (row.channel ?? 'walkin') as SalesChannel;
    if (!out[date]) out[date] = {};
    out[date][ch] = (out[date][ch] ?? 0) + (row.subtotal ?? 0);
  }
  return out;
}
```

- [ ] **Step 2: Replace bucket at line 509-535**

Find the first hardcoded bucket function (around line 509-535). Replace:

```typescript
// BEFORE
const buckets: Record<string, { walkin: number; tokopedia: number; grosir: number; waai: number }> = {};
// ... 25 lines of bucket assembly ...

// AFTER
const buckets = bucketByChannel(rows);
const series = Object.entries(buckets).map(([date, byChannel]) => ({
  date,
  ...byChannel,
}));
```

Update downstream callers — they may receive any of the 14 channels now (consumer code should iterate keys instead of hardcoding 4).

- [ ] **Step 3: Replace bucket at line 626-660**

Same substitution as Step 2 — find the second nearly-identical block and replace with `bucketByChannel` call.

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: clean. Charts may visually break temporarily — fixed in Task 25.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "refactor(sales-channels): DRY 2 hardcoded bucket fns into bucketByChannel helper"
```

### Task 23: TallyBar + OrdersColumn refactor

**Files:**
- Modify: `src/components/rekonsiliasi/TallyBar.tsx`
- Modify: `src/components/rekonsiliasi/OrdersColumn.tsx`
- Modify: `src/components/RekonsiliasiScreen.tsx` (line 52, 57)
- Modify: `src/hooks/useRekonsiliasi.ts` (line 12)

- [ ] **Step 1: Widen useRekonsiliasi channel type**

Edit `src/hooks/useRekonsiliasi.ts` line 12:

```typescript
// BEFORE
channel: 'whatsapp' | 'tokopedia' | 'walkin' | 'grosir';

// AFTER
import type { SalesChannel } from '../types';
// ...
channel: SalesChannel;
```

- [ ] **Step 2: Refactor RekonsiliasiScreen accumulator**

Edit line 52, 57:

```typescript
// BEFORE
const acc = { whatsapp: 0, tokopedia: 0, walkin: 0, grosir: 0 };
// orders.forEach(o => { acc[o.channel] += o.total; });

// AFTER
const acc: Map<SalesChannel, { amount: number; count: number }> = new Map();
orders.forEach(o => {
  const cur = acc.get(o.channel) ?? { amount: 0, count: 0 };
  acc.set(o.channel, { amount: cur.amount + o.total, count: cur.count + 1 });
});
```

Similarly for the second occurrence around line 57.

- [ ] **Step 3: Update TallyBar to consume Map**

Replace `TallyBar.tsx` entirely:

```typescript
import React from 'react';
import type { SalesChannel } from '../../types';
import { getChannelDef } from '../../lib/salesChannels';
import { useSalesChannels } from '../../contexts/SalesChannelsContext';
import ChannelIcon from '../icons/ChannelIcon';

interface TallyBarProps {
  tally: Map<SalesChannel, { amount: number; count: number }>;
  totalAmount: number;
  totalCount: number;
}

export default function TallyBar({ tally, totalAmount, totalCount }: TallyBarProps) {
  const { settings } = useSalesChannels();
  // Hide-zero, sort by amount DESC
  const rows = Array.from(tally.entries())
    .filter(([, v]) => v.amount > 0)
    .sort(([, a], [, b]) => b.amount - a.amount);

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
        Belum ada transaksi di periode ini.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
        <div className="col-span-1">#</div>
        <div className="col-span-5">Kanal</div>
        <div className="col-span-3 text-right">Total</div>
        <div className="col-span-2 text-right">Trx</div>
        <div className="col-span-1 text-right">%</div>
      </div>
      {rows.map(([code, v], idx) => {
        const def = getChannelDef(code);
        const isHidden = !settings[code]?.isVisible;
        const pct = totalAmount > 0 ? Math.round((v.amount / totalAmount) * 100) : 0;
        return (
          <div key={code} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-slate-100 items-center hover:bg-slate-50">
            <div className="col-span-1 text-sm font-bold text-slate-400">{idx + 1}</div>
            <div className="col-span-5 flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                style={{ background: def.brandColor }}
              >
                <ChannelIcon code={code} size={16} />
              </div>
              <div>
                <div className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                  {def.label}
                  {isHidden && (
                    <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">DINONAKTIFKAN</span>
                  )}
                </div>
              </div>
            </div>
            <div className="col-span-3 text-right font-mono font-bold text-slate-800">Rp {v.amount.toLocaleString('id-ID')}</div>
            <div className="col-span-2 text-right text-sm text-slate-600">{v.count}</div>
            <div className="col-span-1 text-right text-xs font-semibold text-slate-500">{pct}%</div>
          </div>
        );
      })}
      <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50 border-t-2 border-slate-300 items-center">
        <div className="col-span-1"></div>
        <div className="col-span-5 text-sm font-extrabold text-slate-800">TOTAL</div>
        <div className="col-span-3 text-right font-mono font-extrabold text-slate-900">Rp {totalAmount.toLocaleString('id-ID')}</div>
        <div className="col-span-2 text-right text-sm font-bold text-slate-700">{totalCount}</div>
        <div className="col-span-1 text-right text-xs font-bold text-slate-500">100%</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update RekonsiliasiScreen to pass Map to TallyBar**

Find where `<TallyBar perChannel={...} perChannelCount={...} />` is rendered. Replace with:

```tsx
<TallyBar tally={acc} totalAmount={totalAmount} totalCount={totalCount} />
```

- [ ] **Step 5: Update OrdersColumn filter to hybrid (D14)**

Edit `OrdersColumn.tsx` — replace `Filter` type and pill rendering:

```typescript
import { CHANNEL_GROUPS, getChannelDef } from '../../lib/salesChannels';
import { useSalesChannels } from '../../contexts/SalesChannelsContext';
// ...

type FilterGroup = 'all' | 'offline' | 'marketplace' | 'direct' | 'piutang';
type Filter = FilterGroup | SalesChannel;

const filterMatches = (filter: Filter, channel: SalesChannel, isPiutang: boolean): boolean => {
  if (filter === 'all') return true;
  if (filter === 'piutang') return isPiutang;
  if (filter === 'offline' || filter === 'marketplace' || filter === 'direct') {
    return CHANNEL_GROUPS[filter].includes(channel);
  }
  return filter === channel;
};

// In JSX — render 5 group pills + dropdown
<div className="flex items-center gap-2 flex-wrap mb-2">
  {(['all','offline','marketplace','direct','piutang'] as const).map(g => (
    <button
      key={g}
      onClick={() => setFilter(g)}
      className={`px-3 py-1 text-xs font-bold rounded-full ${filter === g ? 'bg-[#012749] text-white' : 'bg-white text-slate-600 border border-slate-300'}`}
    >
      {g === 'all' ? '📋 Semua'
        : g === 'offline' ? '🏪 Offline'
        : g === 'marketplace' ? '🛍️ Marketplace'
        : g === 'direct' ? '💬 Direct'
        : '⏳ Piutang'}
    </button>
  ))}
  <select
    value={typeof filter === 'string' && !['all','offline','marketplace','direct','piutang'].includes(filter) ? filter : ''}
    onChange={e => e.target.value && setFilter(e.target.value as SalesChannel)}
    className="text-xs border border-slate-300 rounded-md px-2 py-1 bg-white"
  >
    <option value="">— pilih kanal spesifik —</option>
    {(Object.keys(CHANNEL_VISUAL) as SalesChannel[]).map(code => {
      const def = getChannelDef(code);
      const isHidden = !settings[code]?.isVisible;
      return <option key={code} value={code}>{def.label}{isHidden ? ' (non-aktif)' : ''}</option>;
    })}
  </select>
</div>
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/rekonsiliasi/TallyBar.tsx src/components/rekonsiliasi/OrdersColumn.tsx src/components/RekonsiliasiScreen.tsx src/hooks/useRekonsiliasi.ts
git commit -m "refactor(sales-channels): Recon — dynamic Map buckets, hide-zero TallyBar, hybrid filter"
```

### Task 24: OrderHistoryScreen — hybrid filter

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx` (line 59, 195, 438-445)

- [ ] **Step 1: Widen filter type + replace dropdown**

Edit `OrderHistoryScreen.tsx`:

```typescript
import { CHANNEL_GROUPS, CHANNEL_VISUAL, getChannelDef } from '../lib/salesChannels';
import { useSalesChannels } from '../contexts/SalesChannelsContext';
// ...

type ChannelFilterGroup = 'all' | 'offline' | 'marketplace' | 'direct';
type ChannelFilter = ChannelFilterGroup | SalesChannel;

// Replace existing useState
const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
const [specificChannel, setSpecificChannel] = useState<SalesChannel | ''>('');

const { settings } = useSalesChannels();
```

- [ ] **Step 2: Replace dropdown JSX line 438-445**

```tsx
{/* Group dropdown */}
<select
  value={channelFilter}
  onChange={e => { setChannelFilter(e.target.value as ChannelFilter); setSpecificChannel(''); }}
  className="w-full border rounded-lg px-3 py-2 text-sm bg-white font-semibold"
>
  <option value="all">Semua</option>
  <option value="offline">📋 Semua Offline</option>
  <option value="marketplace">🛍️ Semua Marketplace</option>
  <option value="direct">💬 Semua Direct</option>
</select>

{/* Specific dropdown — with optgroup for hidden channels */}
<select
  value={specificChannel}
  onChange={e => { setSpecificChannel(e.target.value as SalesChannel | ''); }}
  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
>
  <option value="">— pilih kanal spesifik —</option>
  {(['offline','marketplace','direct'] as const).map(group => {
    const visible = CHANNEL_GROUPS[group].filter(c => settings[c]?.isVisible);
    if (visible.length === 0) return null;
    return (
      <optgroup key={group} label={`${group === 'offline' ? 'Offline' : group === 'marketplace' ? 'Marketplace' : 'Direct'} (aktif)`}>
        {visible.map(code => <option key={code} value={code}>{getChannelDef(code).label}</option>)}
      </optgroup>
    );
  })}
  <optgroup label="Dinonaktifkan (untuk historical)">
    {(Object.keys(CHANNEL_VISUAL) as SalesChannel[])
      .filter(c => !settings[c]?.isVisible)
      .map(code => <option key={code} value={code}>{getChannelDef(code).label} (non-aktif)</option>)
    }
  </optgroup>
</select>
```

- [ ] **Step 3: Update filter logic**

Replace the filter predicate used by the orders list:

```typescript
const matchesChannel = (orderChannel: SalesChannel): boolean => {
  if (specificChannel) return orderChannel === specificChannel;
  if (channelFilter === 'all') return true;
  return CHANNEL_GROUPS[channelFilter].includes(orderChannel);
};
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(sales-channels): OrderHistory hybrid filter (group + spesifik dropdown with hidden optgroup)"
```

### Task 25: LaporanScreen brand colors + top-3 card

**Files:**
- Modify: `src/components/LaporanScreen.tsx` (line 43, 172-185)

- [ ] **Step 1: Map channel name → brand color**

```typescript
import { CHANNEL_VISUAL, getChannelDef } from '../lib/salesChannels';
import type { SalesChannel } from '../types';
// ...

// Helper: derive brand color from channel name
const colorForChannel = (name: string): string => {
  // channelTotals uses display labels; reverse-lookup by label
  const code = (Object.keys(CHANNEL_VISUAL) as SalesChannel[]).find(c => CHANNEL_VISUAL[c].label === name);
  return code ? CHANNEL_VISUAL[code].brandColor : '#94a3b8';
};
```

- [ ] **Step 2: Update Pie cells line 178**

```tsx
{channelTotals.map((c, i) => (
  <Cell key={i} fill={colorForChannel(c.name)} />
))}
```

- [ ] **Step 3: Add Top-3 insight card above the chart**

```tsx
{/* Top 3 Kanal */}
<div className="grid grid-cols-3 gap-3 mb-4">
  {channelTotals.slice(0, 3).map((c, idx) => (
    <div key={c.name} className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">#{idx + 1} Kanal</div>
      <div className="mt-1 font-extrabold text-sm text-slate-800">{c.name}</div>
      <div className="text-xs font-semibold text-slate-600">Rp {c.value.toLocaleString('id-ID')}</div>
    </div>
  ))}
</div>
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/LaporanScreen.tsx
git commit -m "feat(sales-channels): LaporanScreen — brand color Pie + Top-3 insight cards"
```

---

## Phase E — Pengaturan Tab

### Task 26: Create SalesChannelConfigPanel

**Files:**
- Create: `src/components/pengaturan/SalesChannelConfigPanel.tsx`

- [ ] **Step 1: Create config panel component**

```typescript
import React from 'react';
import { ToggleLeft, ToggleRight, Lock } from 'lucide-react';
import { useSalesChannels } from '../../contexts/SalesChannelsContext';
import { CHANNEL_GROUPS, CHANNEL_LOCKED, getChannelDef, type ChannelGroup } from '../../lib/salesChannels';
import ChannelIcon from '../icons/ChannelIcon';
import type { SalesChannel } from '../../types';

interface SalesChannelConfigPanelProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const GROUP_TITLE: Record<ChannelGroup, string> = {
  offline: 'Offline',
  marketplace: 'Marketplace',
  direct: 'Direct Online',
};

const GROUP_HINT: Record<ChannelGroup, string | null> = {
  offline: null,
  marketplace: 'Marketplace channel wajib isi "Nomor Order Marketplace" saat pencatatan.',
  direct: null,
};

export default function SalesChannelConfigPanel({ showToast }: SalesChannelConfigPanelProps) {
  const { settings, isLoading, toggleVisibility } = useSalesChannels();

  const visibleCount = Object.values(settings).filter(s => s.isVisible).length;

  const handleToggle = async (code: SalesChannel) => {
    if (CHANNEL_LOCKED.has(code)) {
      showToast('Walk-in adalah kanal default dan tidak bisa dinonaktifkan.', 'info');
      return;
    }
    try {
      await toggleVisibility(code);
    } catch (err) {
      console.error('toggleVisibility error:', err);
      showToast('Gagal mengubah status kanal.', 'warning');
    }
  };

  if (isLoading) {
    return <p className="text-sm text-gray-400 p-6">Memuat...</p>;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Intro */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🏷️</span>
          <h2 className="text-lg font-bold text-gray-800">Kanal Penjualan</h2>
        </div>
        <p className="text-xs text-gray-500 max-w-2xl">
          Pilih kanal yang akan muncul di form pencatatan penjualan. Data historis pada kanal yang dinonaktifkan tetap muncul di laporan & rekonsiliasi.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full text-xs font-bold text-emerald-700">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          {visibleCount} kanal aktif dari 14 · Perubahan tersimpan otomatis
        </div>
      </div>

      {/* Group sections */}
      {(['offline', 'marketplace', 'direct'] as ChannelGroup[]).map(group => (
        <div key={group}>
          <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest mb-3 pl-1">
            {GROUP_TITLE[group]}
          </div>
          {GROUP_HINT[group] && (
            <p className="text-[11px] text-slate-400 italic mb-2 pl-1">{GROUP_HINT[group]}</p>
          )}
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {CHANNEL_GROUPS[group].map(code => {
              const def = getChannelDef(code);
              const isVisible = settings[code]?.isVisible ?? true;
              const isLocked = CHANNEL_LOCKED.has(code);
              return (
                <div key={code} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: def.brandColor }}
                    >
                      <ChannelIcon code={code} size={18} />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-gray-800">{def.label}</div>
                      <div className="text-[11px] text-gray-400">
                        invoice {def.invoicePrefix}-… {def.flow === 'orders' && '· flow orders'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle(code)}
                    disabled={isLocked}
                    title={isLocked ? 'Walk-in tidak bisa dinonaktifkan' : ''}
                    className="flex items-center gap-2"
                  >
                    <span className={`text-[11px] font-bold uppercase tracking-wide ${
                      isLocked ? 'text-slate-500'
                      : isVisible ? 'text-emerald-700'
                      : 'text-slate-400'
                    }`}>
                      {isLocked ? 'Aktif (dikunci)' : isVisible ? 'Aktif' : 'Non-aktif'}
                    </span>
                    {isLocked
                      ? <Lock size={20} className="text-slate-400" />
                      : isVisible
                        ? <ToggleRight size={28} className="text-emerald-600" />
                        : <ToggleLeft size={28} className="text-slate-300" />
                    }
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="border-t border-gray-100 pt-4 text-[11px] text-gray-400">
        💡 Tip: Data historis pada kanal yang dinonaktifkan tetap muncul di Rekonsiliasi & Laporan. Visibility hanya filter input baru.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/pengaturan/SalesChannelConfigPanel.tsx
git commit -m "feat(sales-channels): SalesChannelConfigPanel — admin toggle UI"
```

### Task 27: Add tab to PengaturanScreen

**Files:**
- Modify: `src/components/PengaturanScreen.tsx` (line 9, 24-36, body render)

- [ ] **Step 1: Add to PengaturanTab type union**

Edit line 9:

```typescript
// BEFORE
type PengaturanTab = 'umum' | 'notifikasi' | 'whatsapp-ai';

// AFTER
type PengaturanTab = 'umum' | 'notifikasi' | 'whatsapp-ai' | 'kanal-penjualan';
```

- [ ] **Step 2: Conditionally include tab based on permission**

Edit lines 24-36:

```typescript
const tabs = useMemo<TabDef<PengaturanTab>[]>(() => {
  const perms = props.permissions;
  const isVisible = (key: keyof PermissionSet): boolean => {
    if (!perms) return true;
    const value = perms[key];
    if (typeof key === 'string' && key.startsWith('can')) return value === true;
    return value !== false;
  };
  const list: TabDef<PengaturanTab>[] = [{ id: 'umum', label: 'Umum' }];
  if (isVisible('notifications')) list.push({ id: 'notifikasi', label: 'Notifikasi' });
  if (isVisible('whatsappAi')) list.push({ id: 'whatsap-ai', label: 'WhatsApp AI' });
  if (isVisible('canConfigureSalesChannels')) list.push({ id: 'kanal-penjualan', label: 'Kanal Penjualan' });
  return list;
}, [props.permissions]);
```

- [ ] **Step 3: Render SalesChannelConfigPanel when tab active**

Add import at top:
```typescript
import SalesChannelConfigPanel from './pengaturan/SalesChannelConfigPanel';
```

Find the body render block where each tab content is conditionally rendered. Add:

```tsx
{activeTab === 'kanal-penjualan' && <SalesChannelConfigPanel showToast={showToast} />}
```

- [ ] **Step 4: Verify build + dev**

```bash
npm run dev
```
Open http://localhost:3000, navigate to Pengaturan, verify "Kanal Penjualan" tab appears with full list.

- [ ] **Step 5: Manual smoke test toggle realtime**

1. Open Pengaturan tab in tab 1
2. Open PenjualanBaru in tab 2
3. Toggle Lazada off in tab 1
4. Switch to tab 2 — verify Lazada pill disappears within <2s

- [ ] **Step 6: Commit**

```bash
git add src/components/PengaturanScreen.tsx
git commit -m "feat(sales-channels): add 'Kanal Penjualan' tab to PengaturanScreen with permission gating"
```

---

## Phase F — Backend Go test + Validation

### Task 28: Backend Go smoke test

**Files:**
- Modify: `backend-go/internal/db/record_kasir_sale_test.go`

- [ ] **Step 1: Read existing test pattern**

```bash
cat backend-go/internal/db/record_kasir_sale_test.go
```

- [ ] **Step 2: Add Shopee channel smoke test**

After the existing walkin test, add:

```go
func TestRecordKasirSale_ShopeeChannel_IssuesSHPInvoice(t *testing.T) {
  // Verifies that ENUM accepts new channel `shopee` and invoice prefix is `SHP-`.
  // This guards against regression if the helper validate_sales_channel is broken.

  ctx := context.Background()
  db := openTestDB(t)
  defer db.Close()

  testCustomerName := fmt.Sprintf("QA-SHP-%d", time.Now().Unix())
  invoiceID, err := db.RecordKasirSale(ctx, RecordKasirSaleInput{
    Date:               time.Now().Format("2006-01-02"),
    Channel:            "shopee",
    Items:              []KasirItem{{SKU: "TEST-001", Name: "Test", Qty: 1, UnitPrice: 1000, HppPerUnit: 500, Subtotal: 1000, HppSubtotal: 500, WarehouseID: nil}},
    Subtotal:           1000,
    PaymentMethod:      "transfer",
    PaymentType:        "FULL",
    TotalAmount:        1000,
    MarketplaceOrderNo: stringPtr("SHP-TEST-1"),
    CustomerName:       stringPtr(testCustomerName),
    CustomerPhone:      stringPtr("081234567890"),
  })
  require.NoError(t, err)
  require.NotZero(t, invoiceID)

  var invoiceNo string
  err = db.QueryRowContext(ctx,
    `SELECT invoice_number FROM public.kasir_transactions WHERE id=$1`, invoiceID,
  ).Scan(&invoiceNo)
  require.NoError(t, err)
  require.True(t, strings.HasPrefix(invoiceNo, "SHP-"), "expected SHP- prefix, got %s", invoiceNo)

  // Cleanup
  _, _ = db.ExecContext(ctx, `DELETE FROM public.kasir_transactions WHERE id=$1`, invoiceID)
}
```

- [ ] **Step 3: Run backend test**

```bash
cd backend-go && go test ./internal/db/... -run TestRecordKasirSale -v
```
Expected: existing walkin test passes AND new Shopee test passes.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/db/record_kasir_sale_test.go
git commit -m "test(sales-channels): backend Go — Shopee channel smoke test (SHP- invoice prefix)"
```

### Task 29: End-to-end validation

**Files:** None (manual + Playwright optional)

- [ ] **Step 1: DB validation tests**

```bash
npm run test:integration -- sales-channels
```
Expected: 3 tests pass (ENUM, helper, seed).

- [ ] **Step 2: Frontend smoke checklist**

Run `npm run dev` and verify each item:
- [ ] PenjualanBaru: 3 group pills render. Marketplace channel triggers "Nomor Order Marketplace" field.
- [ ] Header `📋 Catat Transaksi` → opens PenjualanBaru with `walkin` default selected (1-click path preserved).
- [ ] Pengaturan tab "Kanal Penjualan" visible. Toggle Lazada off → cross-tab PenjualanBaru loses Lazada pill within 2s.
- [ ] Walk-in toggle disabled state (Lock icon, no click effect).
- [ ] OrderHistory dropdown: Group + Specific render. Hidden channels appear under "Dinonaktifkan" optgroup.
- [ ] Recon: TallyBar hides zero rows, sorts DESC, brand color icons.
- [ ] Recon historical: hide Shopee → past period (Shopee active) still shows Shopee row with "DINONAKTIFKAN" badge.
- [ ] Dashboard: chart segments use brand colors. Top-3 insight cards populate.
- [ ] Laporan: Pie cells use brand colors.

- [ ] **Step 3: Permission test**

In Supabase dashboard or via SQL:
```sql
UPDATE public.admin_users SET permissions = jsonb_set(permissions::jsonb, '{canConfigureSalesChannels}', 'false')
  WHERE id = '<test-user-id>';
```
Re-login as test user — verify "Kanal Penjualan" tab is hidden.

- [ ] **Step 4: Persist verification result**

Add 1 paragraph to progress.md summarizing what was verified.

---

## Phase G — Cleanup + Documentation

### Task 30: Update progress.md

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Add entry per CLAUDE.md gotcha**

Append to `progress.md`:

```markdown
## 2026-06-13 — Configurable Sales Channels

**Goal**: Add 10 new sales channels (Shopee/Lazada/Blibli/Bukalapak/Ralali/Bhinneka/Sales Lapangan/Pameran/Instagram/Website) + admin visibility toggle in PengaturanScreen. Consolidate 5 scattered hardcode channel maps into single `salesChannels.ts`. Drop kartu cepat in KasirScreen for single-entry-point UX consistency. Brand SVG logos for 9 marketplace/social channels + Lucide icons for 5 non-brand channels.

**Spec**: `docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md`
**Plan**: `docs/superpowers/plans/2026-06-13-configurable-sales-channels.md`
**Mockup**: `.superpowers/brainstorm/47094-1781323973/content/06-all-mockups.html`

**Migration phases**:
- Phase A (5 migrations): ENUM extension × 2, column rename + view alias, sales_channel_settings table + RLS, validate_sales_channel helper
- Phase B (3 migrations): seed 14 channels (idempotent), refactor 3 record_kasir_sale variants with helper + 14-channel invoice prefix CASE, realtime publication
- Phase C (frontend): SalesChannelsContext + provider, refactor 14+ files, brand SVG assets
- Phase D (cleanup, 1 week soak): drop tokped_order_no view alias, remove legacy fallback paths

**Impact**: ~30 files touched. 5 hardcode-map consolidation cleanup bundled. +30 LOC saved from dashboard bucket DRY refactor.

**Verified**: DB integration tests pass, frontend smoke tested, backend Go test added, permission gating verified.
```

- [ ] **Step 2: Commit**

```bash
git add progress.md
git commit -m "docs(progress): configurable sales channels implementation complete"
```

### Task 31: Final review

- [ ] **Step 1: Run full test suite**

```bash
npm run test:integration && npx vitest run src/lib && cd backend-go && go test ./... && cd ..
```
Expected: all pass.

- [ ] **Step 2: Run lint + build**

```bash
npm run lint && npm run build
```
Expected: clean.

- [ ] **Step 3: Verify migrations applied in order**

```bash
ls supabase/migrations/2026061300* | sort
```
Expected: 8 new migration files in chronological order.

- [ ] **Step 4: Review acceptance criteria from spec**

Open `docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md` → Acceptance Criteria section. Walk through 15 items and confirm each is met.

- [ ] **Step 5: Final commit if any cleanup**

```bash
git status
git log --oneline -20
```

---

## Phase D Cleanup (1 week post-deploy)

### Task 32: Drop tokped_order_no view alias

**Files:**
- Create: `supabase/migrations/20260620XXXXXX_sales_channels_phase_d_cleanup.sql`

**When**: 1 week after Phase A/B/C deployed and verified stable.

- [ ] **Step 1: Create cleanup migration**

```sql
-- Phase D cleanup — drop backward-compat view alias 1 week post-deploy.
DROP VIEW IF EXISTS public.kasir_transactions_legacy;
```

- [ ] **Step 2: Apply + commit**

```bash
supabase db push
git add supabase/migrations/20260620XXXXXX_sales_channels_phase_d_cleanup.sql
git commit -m "feat(sales-channels): phase D cleanup — drop tokped_order_no view alias"
```
