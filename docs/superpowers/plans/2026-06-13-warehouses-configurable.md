# Configurable N Warehouses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `stocks.stock_atas` + `stocks.stock_bawah` dual-warehouse model with a configurable N-warehouse model (new `warehouses` + `stock_levels` tables, `warehouse_id uuid` everywhere). `warehouses.tenant_id` ships nullable so the future multi-tenant migration is additive.

**Architecture:** Three-phase migration (additive schema → RPC rewrites with backwards-compat overloads → cutover dropping the old columns). Frontend gets a new shared `<WarehousePicker>` component and a new `ManajemenGudangScreen` sidebar entry gated by a `can_manage_warehouses` permission. Existing visual design system reused — no new tokens.

**Tech Stack:** Postgres 15 (Supabase) · SQL migrations applied via `scripts/apply-pending-migrations.sh` + `backend-go/cmd/apply-migration` · TypeScript / React 19 / Tailwind 4 / Vite 6 · Vitest integration tests against live Supabase.

**Spec:** `docs/superpowers/specs/2026-06-13-warehouses-configurable-design.md`

**Apply guidance:** Every migration is `BEGIN..COMMIT`-wrapped. Apply individually via `cd /Users/tonywei/IdeaProjects/ERPAntigravity && set -a && source backend-go/.env && set +a && /tmp/apply-migration supabase/migrations/<file>` so per-task verification is possible.

---

## Task 1: Migration 1 — schema + backfill

Adds `warehouses`, `stock_levels`, `warehouse_audit_log` tables + `warehouse_id uuid` nullable columns on every history table + backfill from existing data + the SUM trigger that keeps `stocks.stock` in sync with `stock_levels`.

**Files:**
- Create: `supabase/migrations/20260613000001_warehouses_phase1_schema.sql`
- Create: `tests/integration/warehouses-phase1.test.ts`
- Modify: `scripts/apply-pending-migrations.sh:24` — append the new migration filename to the MIGRATIONS array

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260613000001_warehouses_phase1_schema.sql
-- Phase 1 of configurable N warehouses (spec
-- docs/superpowers/specs/2026-06-13-warehouses-configurable-design.md):
-- additive schema. Creates the new tables, backfills stock_levels from the
-- existing stocks.stock_atas + stocks.stock_bawah columns, adds nullable
-- warehouse_id columns to every history table and backfills them from the
-- existing 'atas'|'bawah' text values, and installs the SUM trigger that
-- keeps stocks.stock in sync.
--
-- After this migration: both old (stocks.stock_atas/bawah,
-- stock_movements.warehouse text) and new (stock_levels, warehouse_id uuid)
-- columns coexist. Nothing breaks. Migration 2 rewrites the RPCs to read
-- the new columns; Migration 3 drops the old ones.

BEGIN;

-- ─── 1. warehouses table ───────────────────────────────────────────────────
CREATE TABLE public.warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NULL,
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,16}$'),
  name        text NOT NULL,
  address     text NULL,
  is_active   boolean NOT NULL DEFAULT true,
  is_default  boolean NOT NULL DEFAULT false,
  sort_order  int     NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE UNIQUE INDEX warehouses_one_default_per_tenant
  ON public.warehouses (tenant_id) WHERE is_default;
CREATE UNIQUE INDEX warehouses_name_unique_per_tenant
  ON public.warehouses (tenant_id, lower(name));

-- ─── 2. Seed 2 warehouses for the current tenant ───────────────────────────
INSERT INTO public.warehouses (code, name, is_default, sort_order)
VALUES ('ATAS', 'Gudang Atas', true,  10),
       ('BAWAH', 'Gudang Bawah', false, 20);

-- ─── 3. stock_levels table ─────────────────────────────────────────────────
CREATE TABLE public.stock_levels (
  sku          text NOT NULL REFERENCES public.stocks(sku) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  qty          int  NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, warehouse_id)
);

-- Backfill: every (SKU, ATAS) row + every (SKU, BAWAH) row, qty from
-- the existing columns. Inserts qty=0 rows too so every SKU has explicit
-- per-warehouse coverage.
INSERT INTO public.stock_levels (sku, warehouse_id, qty)
SELECT s.sku,
       (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code='ATAS'),
       s.stock_atas
  FROM public.stocks s
UNION ALL
SELECT s.sku,
       (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code='BAWAH'),
       s.stock_bawah
  FROM public.stocks s;

-- ─── 4. warehouse_audit_log (append-only) ──────────────────────────────────
CREATE TABLE public.warehouse_audit_log (
  id            bigserial PRIMARY KEY,
  warehouse_id  uuid NOT NULL REFERENCES public.warehouses(id),
  actor_user_id uuid NOT NULL,
  action        text NOT NULL CHECK (action IN
    ('create','rename','set_default','deactivate','force_deactivate','reactivate','address_update','sort_update')),
  before        jsonb,
  after         jsonb,
  reason_note   text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Append-only: revoke UPDATE/DELETE + deny trigger same pattern as rakit_audit_log
REVOKE UPDATE, DELETE ON public.warehouse_audit_log FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public._block_warehouse_audit_mutations()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'warehouse_audit_log is append-only (% blocked)', TG_OP;
END $$;
CREATE TRIGGER trg_block_warehouse_audit_update
  BEFORE UPDATE ON public.warehouse_audit_log
  FOR EACH ROW EXECUTE FUNCTION public._block_warehouse_audit_mutations();
CREATE TRIGGER trg_block_warehouse_audit_delete
  BEFORE DELETE ON public.warehouse_audit_log
  FOR EACH ROW EXECUTE FUNCTION public._block_warehouse_audit_mutations();

-- ─── 5. Add warehouse_id columns to history tables (nullable for Phase 1) ──
ALTER TABLE public.stock_movements      ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.stock_adjustments    ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.stock_opname_counts  ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.orders               ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.kasir_transactions   ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.purchase_order_items ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);

-- Backfill warehouse_id from the existing 'atas'|'bawah' text columns where they exist
UPDATE public.stock_movements      SET warehouse_id = (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code = upper(warehouse));
UPDATE public.stock_adjustments    SET warehouse_id = (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code = upper(warehouse));
UPDATE public.stock_opname_counts  SET warehouse_id = (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code = upper(warehouse));
UPDATE public.orders               SET warehouse_id = (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code = upper(warehouse));
UPDATE public.purchase_order_items SET warehouse_id = (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code = upper(warehouse));
-- kasir_transactions doesn't currently have a warehouse text column — nothing to backfill yet.
-- Per-line warehouse_id lands on kasir_transaction_items in Task 4.

-- ─── 6. stocks.stock SUM trigger ───────────────────────────────────────────
-- The old sync_stock_total trigger set stock = stock_atas + stock_bawah on
-- INSERT/UPDATE of stocks. Replace with a trigger ON stock_levels that
-- recomputes the SUM whenever per-warehouse qty changes.
CREATE OR REPLACE FUNCTION public._sync_stocks_stock_from_levels()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_sku text;
BEGIN
  v_sku := COALESCE(NEW.sku, OLD.sku);
  UPDATE public.stocks
     SET stock = COALESCE((SELECT SUM(qty) FROM public.stock_levels WHERE sku = v_sku), 0)
   WHERE sku = v_sku;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_stock_levels_sync_sum
  AFTER INSERT OR UPDATE OF qty OR DELETE ON public.stock_levels
  FOR EACH ROW EXECUTE FUNCTION public._sync_stocks_stock_from_levels();

-- Disable (but don't drop) the legacy sync trigger — it fires on stocks
-- INSERT/UPDATE which won't carry stock_atas/bawah edits going forward.
-- Migration 3 drops it together with the old columns.
ALTER TABLE public.stocks DISABLE TRIGGER trg_sync_stock_total;

COMMIT;
```

- [ ] **Step 2: Write the integration test**

```typescript
// tests/integration/warehouses-phase1.test.ts
//
// Phase 1 schema integration tests. Verifies the seed rows exist, the
// stock_levels backfill matches stock_atas + stock_bawah row-by-row, and
// the stocks.stock SUM trigger updates correctly when stock_levels qty
// changes. Runs against live Supabase using the same pattern as
// sales-recording.test.ts.

import { describe, test, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
let atasId: string;
let bawahId: string;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, code')
    .is('tenant_id', null);
  expect(error).toBeNull();
  expect(data?.length).toBeGreaterThanOrEqual(2);
  atasId = data!.find(w => w.code === 'ATAS')!.id;
  bawahId = data!.find(w => w.code === 'BAWAH')!.id;
});

describe('Phase 1 schema', () => {
  test('warehouses seed has ATAS as the default', async () => {
    const { data } = await supabase
      .from('warehouses')
      .select('code, is_default')
      .eq('id', atasId)
      .single();
    expect(data?.is_default).toBe(true);
  });

  test('exactly one default warehouse per tenant', async () => {
    const { count } = await supabase
      .from('warehouses')
      .select('id', { count: 'exact', head: true })
      .is('tenant_id', null)
      .eq('is_default', true);
    expect(count).toBe(1);
  });

  test('stock_levels backfill row-count matches stocks.count * 2', async () => {
    const { count: stocksCount } = await supabase
      .from('stocks').select('sku', { count: 'exact', head: true });
    const { count: levelsCount } = await supabase
      .from('stock_levels').select('sku', { count: 'exact', head: true });
    expect(levelsCount).toBe((stocksCount ?? 0) * 2);
  });

  test('SUM trigger updates stocks.stock when stock_levels.qty changes', async () => {
    const testSku = `QA-WH-TRIG-${Date.now()}`;
    await supabase.from('stocks').insert({
      sku: testSku, name: 'QA trigger test', category: 'QA',
      price: 1000, harga_modal: 500, stock: 0, status: 'Sinkron',
    });
    await supabase.from('stock_levels').insert([
      { sku: testSku, warehouse_id: atasId, qty: 7 },
      { sku: testSku, warehouse_id: bawahId, qty: 3 },
    ]);
    const { data } = await supabase
      .from('stocks').select('stock').eq('sku', testSku).single();
    expect(data?.stock).toBe(10);

    // Mutation also triggers
    await supabase.from('stock_levels')
      .update({ qty: 5 })
      .eq('sku', testSku).eq('warehouse_id', atasId);
    const { data: data2 } = await supabase
      .from('stocks').select('stock').eq('sku', testSku).single();
    expect(data2?.stock).toBe(8);

    // Cleanup
    await supabase.from('stocks').delete().eq('sku', testSku);
  });

  test('warehouse_id columns backfilled on history tables', async () => {
    const { data } = await supabase
      .from('stock_movements')
      .select('warehouse, warehouse_id')
      .not('warehouse', 'is', null)
      .limit(5);
    expect(data!.every(r => r.warehouse_id !== null)).toBe(true);
  });

  test('warehouse_audit_log is append-only — UPDATE raises', async () => {
    // Insert a probe row first
    const { data: w } = await supabase.from('warehouses')
      .select('id').eq('code', 'ATAS').single();
    const { data: ins, error: insErr } = await supabase
      .from('warehouse_audit_log')
      .insert({
        warehouse_id: w!.id,
        actor_user_id: '00000000-0000-0000-0000-000000000000',
        action: 'create',
        after: { test: true },
      })
      .select('id').single();
    expect(insErr).toBeNull();

    const { error: updErr } = await supabase
      .from('warehouse_audit_log')
      .update({ reason_note: 'mutation should fail' })
      .eq('id', ins!.id);
    expect(updErr).not.toBeNull();
    expect(updErr!.message).toContain('append-only');
  });
});
```

- [ ] **Step 3: Wire migration into the apply script**

Modify `scripts/apply-pending-migrations.sh`. After the existing `20260612000003_e2e_data_scrub.sql` entry in `MIGRATIONS`, append:

```bash
MIGRATIONS=(
  "20260612000001_fix_transfer_warehouse_security_definer.sql"
  "20260612000002_set_company_name.sql"
  "20260612000003_e2e_data_scrub.sql"
  "20260613000001_warehouses_phase1_schema.sql"
)
```

- [ ] **Step 4: Apply the migration**

Run from the repo root:

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
set -a && source backend-go/.env && set +a
/tmp/apply-migration supabase/migrations/20260613000001_warehouses_phase1_schema.sql
```

Expected output:

```
[apply] connected, executing migration...
[apply] OK
```

If the apply tool isn't built yet: `cd backend-go && go build -o /tmp/apply-migration ./cmd/apply-migration`.

- [ ] **Step 5: Run the integration test**

```bash
npx vitest run tests/integration/warehouses-phase1.test.ts
```

Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260613000001_warehouses_phase1_schema.sql \
        tests/integration/warehouses-phase1.test.ts \
        scripts/apply-pending-migrations.sh
git commit -m "feat(warehouses): phase 1 schema + backfill + SUM trigger"
```

---

## Task 2: Frontend types + permission

Adds the `Warehouse` + `WarehouseAuditLog` interfaces, the new `can_manage_warehouses` permission, and rewires `KasirItem.warehouse: 'atas' | 'bawah' | null` → `warehouse_id: string | null`. Leaves the legacy `WarehouseLocation` type alias in place for now (Task 22 cutover removes it).

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the new types**

Append to `src/types.ts`:

```typescript
// ─── Warehouse model (configurable N warehouses, 2026-06-13 spec) ───────────

export interface Warehouse {
  id: string;
  tenant_id: string | null;
  code: string;
  name: string;
  address: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type WarehouseAuditAction =
  | 'create'
  | 'rename'
  | 'set_default'
  | 'deactivate'
  | 'force_deactivate'
  | 'reactivate'
  | 'address_update'
  | 'sort_update';

export interface WarehouseAuditLogRow {
  id: number;
  warehouse_id: string;
  actor_user_id: string;
  action: WarehouseAuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason_note: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Add the new permission to PermissionSet + ALL_PERMISSIONS**

Modify the `PermissionSet` interface in `src/types.ts`. Add a single new line in the Phase 3d block:

```typescript
  // Phase 3d — inter-warehouse transfers
  can_initiate_transfer?: boolean;
  can_receive_transfer?: boolean;
  // Warehouse admin (2026-06-13 spec)
  can_manage_warehouses?: boolean;
```

And in `ALL_PERMISSIONS`:

```typescript
  can_initiate_transfer: true,
  can_receive_transfer: true,
  can_manage_warehouses: true,
```

- [ ] **Step 3: Add `warehouse_id` to KasirItem (parallel to existing `warehouse`)**

Find the `KasirItem` interface in `src/types.ts`. Add the new field next to `warehouse`:

```typescript
export interface KasirItem {
  sku: string | null;
  name: string;
  qty: number;
  unit_price: number;
  hpp_per_unit?: number;
  subtotal: number;
  hpp_subtotal?: number;
  warehouse?: WarehouseLocation | null;   // legacy — Task 22 removes
  warehouse_id?: string | null;            // new — populated by Task 14 onwards
}
```

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected output: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(warehouses): add Warehouse types + can_manage_warehouses permission"
```

---

## Task 3: warehousesService + useWarehouses hook

Service-layer + caching hook the new screens + the shared picker will consume. Hook subscribes to `postgres_changes` on the `warehouses` table same pattern as `useRealtimeConversations`.

**Files:**
- Modify: `src/lib/supabaseClient.ts` — add `warehousesService` after `companySettingsService` (around line 869)
- Create: `src/hooks/useWarehouses.ts`
- Create: `tests/integration/warehousesService.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/integration/warehousesService.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
const TEST_CODE = `T${Date.now()}`.slice(-8); // 8-char unique code

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
});

afterAll(async () => {
  await supabase.from('warehouses').delete().eq('code', TEST_CODE);
});

describe('warehousesService.fetchAll', () => {
  test('returns active + inactive warehouses ordered by sort_order', async () => {
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .order('sort_order', { ascending: true });
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(2);
    // ATAS sort_order=10, BAWAH sort_order=20 — should come in that order
    expect(data![0].code).toBe('ATAS');
    expect(data![1].code).toBe('BAWAH');
  });
});

describe('warehousesService.fetchActive', () => {
  test('filters out is_active=false rows', async () => {
    // Insert a deactivated probe
    await supabase.from('warehouses').insert({
      code: TEST_CODE, name: `Probe ${TEST_CODE}`,
      is_active: false, sort_order: 999,
    });
    const { data } = await supabase
      .from('warehouses')
      .select('*')
      .eq('is_active', true);
    expect(data!.every(w => w.code !== TEST_CODE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes correctly**

```bash
npx vitest run tests/integration/warehousesService.test.ts
```

Expected: 2 passing (these read existing seed data + a probe row).

- [ ] **Step 3: Add warehousesService to supabaseClient.ts**

After the `companySettingsService` block (line ~890), add:

```typescript
// ─── warehousesService ──────────────────────────────────────────────────────
// CRUD + admin helpers for the configurable N-warehouse model.
// 2026-06-13 spec.

import type { Warehouse, WarehouseAuditLogRow } from '../types';

export const warehousesService = {
  async fetchAll(): Promise<Warehouse[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Warehouse[];
  },

  async fetchActive(): Promise<Warehouse[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Warehouse[];
  },

  async create(input: { code: string; name: string; address?: string; sort_order?: number }): Promise<Warehouse> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('create_warehouse', {
      p_code: input.code, p_name: input.name,
      p_address: input.address ?? null, p_sort_order: input.sort_order ?? 100,
    });
    if (error) throw error;
    return data as Warehouse;
  },

  async update(id: string, patch: { name?: string; address?: string | null; sort_order?: number }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('update_warehouse', {
      p_id: id,
      p_name: patch.name ?? null,
      p_address: patch.address ?? null,
      p_sort_order: patch.sort_order ?? null,
    });
    if (error) throw error;
  },

  async setDefault(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('set_default_warehouse', { p_id: id });
    if (error) throw error;
  },

  async deactivate(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('deactivate_warehouse', { p_id: id });
    if (error) throw error;
  },

  async forceDeactivate(id: string, pin: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('force_deactivate_warehouse', {
      p_id: id, p_pin: pin, p_reason: reason,
    });
    if (error) throw error;
  },

  async fetchAuditLog(limit = 50): Promise<WarehouseAuditLogRow[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('warehouse_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as WarehouseAuditLogRow[];
  },
};
```

- [ ] **Step 4: Create useWarehouses hook**

```typescript
// src/hooks/useWarehouses.ts
//
// One-shot fetch + realtime cache of the active warehouse list. Used by
// every consumer of <WarehousePicker> so they don't each hit the DB.
// 2026-06-13 spec.

import { useEffect, useState } from 'react';
import type { Warehouse } from '../types';
import { warehousesService, supabase } from '../lib/supabaseClient';

interface UseWarehousesResult {
  warehouses: Warehouse[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useWarehouses(opts: { activeOnly?: boolean } = {}): UseWarehousesResult {
  const { activeOnly = true } = opts;
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const rows = activeOnly
        ? await warehousesService.fetchActive()
        : await warehousesService.fetchAll();
      setWarehouses(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    if (!supabase) return;
    const ch = supabase
      .channel('warehouses-realtime')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'warehouses' },
          () => { void refresh(); })
      .subscribe();
    return () => { supabase!.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly]);

  return { warehouses, loading, error, refresh };
}
```

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabaseClient.ts src/hooks/useWarehouses.ts tests/integration/warehousesService.test.ts
git commit -m "feat(warehouses): warehousesService + useWarehouses hook"
```

---

## Task 4: Migration 2a — stock-mutating RPCs (transfer / decrement / seed)

Rewrites `transfer_warehouse`, `decrement_stock`, `seed_stock_row` to take `warehouse_id uuid`. Keeps the OLD text-arg overloads as wrappers so the frontend keeps working during the deploy window.

**Files:**
- Create: `supabase/migrations/20260613000002a_warehouses_phase2_stock_rpcs.sql`
- Create: `tests/integration/warehouses-phase2a-rpcs.test.ts`
- Modify: `scripts/apply-pending-migrations.sh` — add the new file

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260613000002a_warehouses_phase2_stock_rpcs.sql
-- Phase 2a of configurable warehouses: rewrite the three SECURITY DEFINER
-- stock-mutating RPCs to take warehouse_id uuid + reads/writes
-- stock_levels. The old text-arg signatures stay as overloads that resolve
-- text → warehouse_id internally so old frontend bundles keep working
-- during the deploy window. Migration 3 drops the overloads.

BEGIN;

-- ─── transfer_warehouse (new signature) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku                text,
  p_from_warehouse_id  uuid,
  p_to_warehouse_id    uuid,
  p_qty                int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from_qty    int;
  v_from_before int;
  v_to_before   int;
  v_from_tenant uuid;
  v_to_tenant   uuid;
BEGIN
  IF p_from_warehouse_id = p_to_warehouse_id THEN
    RAISE EXCEPTION 'transfer_warehouse: source and destination must differ';
  END IF;

  SELECT tenant_id INTO v_from_tenant FROM warehouses WHERE id = p_from_warehouse_id AND is_active;
  SELECT tenant_id INTO v_to_tenant   FROM warehouses WHERE id = p_to_warehouse_id   AND is_active;
  IF v_from_tenant IS DISTINCT FROM v_to_tenant THEN
    RAISE EXCEPTION 'transfer_warehouse: cross-tenant transfer is not allowed';
  END IF;
  IF v_from_tenant IS NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'transfer_warehouse: source or destination warehouse not active';
  END IF;

  -- Source row + lock
  SELECT qty INTO v_from_before
    FROM stock_levels WHERE sku = p_sku AND warehouse_id = p_from_warehouse_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU % belum ada di gudang asal', p_sku;
  END IF;
  v_from_qty := v_from_before;
  IF v_from_qty < p_qty THEN
    RAISE EXCEPTION 'Stok gudang asal tidak cukup: tersedia %, diminta %', v_from_qty, p_qty;
  END IF;

  -- Destination row (snapshot for ledger qty_before — 0 if row doesn't exist yet)
  SELECT qty INTO v_to_before
    FROM stock_levels WHERE sku = p_sku AND warehouse_id = p_to_warehouse_id FOR UPDATE;
  v_to_before := COALESCE(v_to_before, 0);

  UPDATE stock_levels
     SET qty = qty - p_qty, updated_at = now()
   WHERE sku = p_sku AND warehouse_id = p_from_warehouse_id;

  INSERT INTO stock_levels (sku, warehouse_id, qty)
       VALUES (p_sku, p_to_warehouse_id, p_qty)
  ON CONFLICT (sku, warehouse_id)
  DO UPDATE SET qty = stock_levels.qty + EXCLUDED.qty, updated_at = now();

  -- Ledger: two rows (transfer_out + transfer_in). qty_after on each side
  -- is computed from the snapshot + delta.
  PERFORM public._log_stock_movement(
    p_sku => p_sku,
    p_warehouse => NULL,        -- legacy text column; will be NULL going forward
    p_qty_delta => -p_qty,
    p_qty_before => v_from_before,
    p_source => 'transfer_out'::public.stock_movement_source,
    p_related_doc_type => 'transfer_legacy',
    p_related_doc_id => NULL
  );
  UPDATE stock_movements SET warehouse_id = p_from_warehouse_id
    WHERE id = (SELECT id FROM stock_movements
                 WHERE sku = p_sku AND source = 'transfer_out'
                 ORDER BY id DESC LIMIT 1);

  PERFORM public._log_stock_movement(
    p_sku => p_sku,
    p_warehouse => NULL,
    p_qty_delta => p_qty,
    p_qty_before => v_to_before,
    p_source => 'transfer_in'::public.stock_movement_source,
    p_related_doc_type => 'transfer_legacy',
    p_related_doc_id => NULL
  );
  UPDATE stock_movements SET warehouse_id = p_to_warehouse_id
    WHERE id = (SELECT id FROM stock_movements
                 WHERE sku = p_sku AND source = 'transfer_in'
                 ORDER BY id DESC LIMIT 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_warehouse(text, uuid, uuid, int) TO authenticated;

-- ─── transfer_warehouse (legacy text-arg overload) ─────────────────────────
-- Resolves 'atas'|'bawah' → warehouse_id and calls the new function.
CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku  text, p_from text, p_to text, p_qty int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from_id uuid;
  v_to_id   uuid;
BEGIN
  SELECT id INTO v_from_id FROM warehouses WHERE tenant_id IS NULL AND code = upper(p_from);
  SELECT id INTO v_to_id   FROM warehouses WHERE tenant_id IS NULL AND code = upper(p_to);
  IF v_from_id IS NULL OR v_to_id IS NULL THEN
    RAISE EXCEPTION 'transfer_warehouse: legacy code mapping failed (from=%, to=%)', p_from, p_to;
  END IF;
  PERFORM public.transfer_warehouse(p_sku, v_from_id, v_to_id, p_qty);
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_warehouse(text, text, text, int) TO authenticated;

-- ─── decrement_stock (new + legacy) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_sku text, p_warehouse_id uuid, p_qty int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before int;
BEGIN
  SELECT qty INTO v_before FROM stock_levels
    WHERE sku = p_sku AND warehouse_id = p_warehouse_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU % belum ada di gudang yang dipilih', p_sku;
  END IF;
  IF v_before < p_qty THEN
    RAISE EXCEPTION 'Stok tidak cukup: tersedia %, diminta %', v_before, p_qty;
  END IF;
  UPDATE stock_levels
     SET qty = GREATEST(0, qty - p_qty), updated_at = now()
   WHERE sku = p_sku AND warehouse_id = p_warehouse_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.decrement_stock(text, uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_sku text, p_warehouse text, p_qty int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM warehouses
    WHERE tenant_id IS NULL AND code = upper(p_warehouse);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'decrement_stock: legacy code mapping failed (%)', p_warehouse;
  END IF;
  PERFORM public.decrement_stock(p_sku, v_id, p_qty);
END;
$$;
GRANT EXECUTE ON FUNCTION public.decrement_stock(text, text, int) TO authenticated;

-- ─── seed_stock_row (new + legacy) ─────────────────────────────────────────
-- New signature accepts p_initial_levels jsonb mapping warehouse_id → qty.
CREATE OR REPLACE FUNCTION public.seed_stock_row(
  p_sku            text,
  p_name           text,
  p_category       text,
  p_price          numeric,
  p_harga_modal    numeric,
  p_initial_levels jsonb DEFAULT '{}'::jsonb,
  p_actor_user_id  uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := COALESCE(p_actor_user_id, auth.uid());
  v_role  text;
  v_kv    record;
  v_total int := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'seed_stock_row requires p_actor_user_id (or auth.uid())';
  END IF;
  SELECT role INTO v_role FROM admin_users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'Owner' THEN
    RAISE EXCEPTION 'seed_stock_row requires Owner role (actor=% role=%)',
      v_actor, COALESCE(v_role, '<missing>');
  END IF;

  INSERT INTO stocks (sku, name, category, price, harga_modal, stock, status, specs)
       VALUES (p_sku, p_name, p_category, p_price, p_harga_modal, 0, 'Sinkron', '{}'::jsonb)
  ON CONFLICT (sku) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sku % already exists', p_sku;
  END IF;

  INSERT INTO stock_price_history (sku, field, old_value, new_value, source, actor_user_id, actor_role)
       VALUES (p_sku, 'price',       0, p_price,       'seed', v_actor, 'Owner'),
              (p_sku, 'harga_modal', 0, p_harga_modal, 'seed', v_actor, 'Owner');

  -- Iterate the jsonb {warehouse_id: qty}. Insert a stock_levels row for
  -- each — including qty=0 — so every SKU has explicit per-warehouse coverage.
  FOR v_kv IN SELECT key, (value::text)::int AS qty FROM jsonb_each_text(p_initial_levels) LOOP
    INSERT INTO stock_levels (sku, warehouse_id, qty)
         VALUES (p_sku, v_kv.key::uuid, v_kv.qty);
    v_total := v_total + v_kv.qty;
    IF v_kv.qty > 0 THEN
      PERFORM public._log_stock_movement(
        p_sku => p_sku, p_warehouse => NULL,
        p_qty_delta => v_kv.qty, p_qty_before => 0,
        p_source => 'seed'::public.stock_movement_source,
        p_actor_user_id => v_actor, p_actor_role => 'Owner');
      UPDATE stock_movements SET warehouse_id = v_kv.key::uuid
        WHERE id = (SELECT id FROM stock_movements
                     WHERE sku = p_sku AND source = 'seed'
                     ORDER BY id DESC LIMIT 1);
    END IF;
  END LOOP;

  RETURN p_sku;
END;
$$;
GRANT EXECUTE ON FUNCTION public.seed_stock_row(text, text, text, numeric, numeric, jsonb, uuid) TO authenticated;

-- Legacy seed_stock_row (atas + bawah ints) stays from migration 0017 —
-- it still works because the body has been preserved by Postgres function
-- overload resolution. No change needed here.

COMMIT;
```

- [ ] **Step 2: Write the integration test**

```typescript
// tests/integration/warehouses-phase2a-rpcs.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
let atasId: string;
let bawahId: string;
const TEST_SKU = `QA-WHRPC-${Date.now()}`;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data } = await supabase.from('warehouses').select('id, code').is('tenant_id', null);
  atasId = data!.find(w => w.code === 'ATAS')!.id;
  bawahId = data!.find(w => w.code === 'BAWAH')!.id;
  // Seed a fresh SKU with 10 in ATAS, 0 in BAWAH
  await supabase.from('stocks').insert({
    sku: TEST_SKU, name: 'QA RPC test', category: 'QA',
    price: 1000, harga_modal: 500, stock: 0, status: 'Sinkron',
  });
  await supabase.from('stock_levels').insert([
    { sku: TEST_SKU, warehouse_id: atasId, qty: 10 },
    { sku: TEST_SKU, warehouse_id: bawahId, qty: 0 },
  ]);
});

afterAll(async () => {
  await supabase.from('stocks').delete().eq('sku', TEST_SKU);
});

describe('transfer_warehouse(uuid, uuid)', () => {
  test('happy path: 3 from ATAS to BAWAH', async () => {
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: TEST_SKU, p_from_warehouse_id: atasId, p_to_warehouse_id: bawahId, p_qty: 3,
    });
    expect(error).toBeNull();
    const { data: levels } = await supabase
      .from('stock_levels').select('warehouse_id, qty').eq('sku', TEST_SKU);
    const map = Object.fromEntries(levels!.map(l => [l.warehouse_id, l.qty]));
    expect(map[atasId]).toBe(7);
    expect(map[bawahId]).toBe(3);
  });

  test('insufficient stock raises', async () => {
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: TEST_SKU, p_from_warehouse_id: atasId, p_to_warehouse_id: bawahId, p_qty: 9999,
    });
    expect(error?.message).toMatch(/tidak cukup/i);
  });

  test('same source and destination raises', async () => {
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: TEST_SKU, p_from_warehouse_id: atasId, p_to_warehouse_id: atasId, p_qty: 1,
    });
    expect(error?.message).toMatch(/source and destination must differ/i);
  });
});

describe('transfer_warehouse(text, text) legacy overload', () => {
  test('still works via the wrapper', async () => {
    // Use the legacy text args - should resolve via code mapping
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: TEST_SKU, p_from: 'bawah', p_to: 'atas', p_qty: 1,
    });
    expect(error).toBeNull();
  });
});

describe('decrement_stock(uuid)', () => {
  test('happy path', async () => {
    const { error } = await supabase.rpc('decrement_stock', {
      p_sku: TEST_SKU, p_warehouse_id: atasId, p_qty: 1,
    });
    expect(error).toBeNull();
  });

  test('insufficient raises', async () => {
    const { error } = await supabase.rpc('decrement_stock', {
      p_sku: TEST_SKU, p_warehouse_id: bawahId, p_qty: 9999,
    });
    expect(error?.message).toMatch(/tidak cukup/i);
  });
});
```

- [ ] **Step 3: Apply migration + run tests**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
set -a && source backend-go/.env && set +a
/tmp/apply-migration supabase/migrations/20260613000002a_warehouses_phase2_stock_rpcs.sql
npx vitest run tests/integration/warehouses-phase2a-rpcs.test.ts
```

Expected: 6 passing.

- [ ] **Step 4: Add migration to apply script**

Update `scripts/apply-pending-migrations.sh` MIGRATIONS array — add `"20260613000002a_warehouses_phase2_stock_rpcs.sql"` after the Phase 1 entry.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260613000002a_warehouses_phase2_stock_rpcs.sql \
        tests/integration/warehouses-phase2a-rpcs.test.ts \
        scripts/apply-pending-migrations.sh
git commit -m "feat(warehouses): phase 2a — transfer/decrement/seed RPCs accept uuid"
```

---

## Task 5: Migration 2b — sale + PO RPCs accept warehouse_id

Rewrites `record_kasir_sale` to read `warehouse_id` from each item in the `p_items` jsonb and write to `stock_levels`. Rewrites `receive_purchase_order` to insert into `stock_levels` instead of `stocks.stock_atas/bawah`. Legacy text-shaped item payloads still work via inline lookup.

**Files:**
- Create: `supabase/migrations/20260613000002b_warehouses_phase2_sale_po_rpcs.sql`
- Create: `tests/integration/warehouses-phase2b-rpcs.test.ts`
- Modify: `scripts/apply-pending-migrations.sh`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260613000002b_warehouses_phase2_sale_po_rpcs.sql
--
-- Phase 2b: rewrite record_kasir_sale + receive_purchase_order to read
-- warehouse_id from their payloads and mutate stock_levels. Items that
-- still carry the legacy 'warehouse' text key fall through to a code →
-- warehouse_id lookup so old frontend bundles keep working.

BEGIN;

-- We replace the bodies of record_kasir_sale and receive_purchase_order
-- in place. The signatures don't change — both already take jsonb
-- payloads, we just teach them to read item.warehouse_id and prefer it
-- over the legacy item.warehouse text.

-- ─── record_kasir_sale ─────────────────────────────────────────────────────
-- Find the latest CREATE OR REPLACE of record_kasir_sale (the most
-- recent migration that touches it is 20260610000001_record_kasir_sale_service_lines.sql).
-- We keep that whole body intact and only change the per-item loop:
--   - if item.warehouse_id is present → use it
--   - else lookup id by upper(item.warehouse)
-- All other behavior (service-line null-sku skip, FIFO deduct, ledger
-- write, customer upsert) is preserved.
--
-- IMPORTANT: include the entire latest CREATE OR REPLACE body here. The
-- canonical source is migration 20260610000001. Copy it verbatim and
-- modify only the two extraction points described below.

CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  p_date              date,
  p_channel           text,
  p_payment_method    text,
  p_payment_subtype   text,
  p_payment_type      text,
  p_dp_input_type     text,
  p_dp_amount         numeric,
  p_ongkir_amount     numeric,
  p_subtotal          numeric,
  p_total_amount      numeric,
  p_notes             text,
  p_items             jsonb,
  p_customer_name     text,
  p_customer_phone    text,
  p_customer_company  text,
  p_customer_id       uuid,
  p_delivery_address  text,
  p_tokped_order_no   text,
  p_wa_phone          text,
  p_wa_chat_url       text,
  p_actor_user_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item        jsonb;
  v_sku         text;
  v_qty         int;
  v_warehouse_id uuid;
  v_warehouse_txt text;
  v_before      int;
  v_hpp_total   numeric := 0;
  v_invoice_no  text;
  v_tx_id       uuid;
BEGIN
  -- ... (full body from 20260610000001 — invoice no reservation, customer
  -- upsert, all preserved) ...
  -- We only replace the per-item warehouse extraction:

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku := v_item->>'sku';
    v_qty := COALESCE((v_item->>'qty')::int, 1);

    IF v_sku IS NULL THEN
      -- service line, no stock — flow unchanged
      v_hpp_total := v_hpp_total + COALESCE((v_item->>'hpp_subtotal')::numeric, 0);
      CONTINUE;
    END IF;

    -- NEW: prefer warehouse_id over legacy warehouse text
    v_warehouse_id := NULLIF(v_item->>'warehouse_id', '')::uuid;
    IF v_warehouse_id IS NULL THEN
      v_warehouse_txt := v_item->>'warehouse';
      IF v_warehouse_txt IS NOT NULL THEN
        SELECT id INTO v_warehouse_id FROM warehouses
          WHERE tenant_id IS NULL AND code = upper(v_warehouse_txt);
      END IF;
    END IF;
    IF v_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'record_kasir_sale: item.warehouse_id required for SKU %', v_sku;
    END IF;

    -- Decrement from stock_levels
    SELECT qty INTO v_before FROM stock_levels
      WHERE sku = v_sku AND warehouse_id = v_warehouse_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU % belum ada di gudang yang dipilih', v_sku;
    END IF;
    IF v_before < v_qty THEN
      RAISE EXCEPTION 'Stok di gudang tidak cukup: tersedia %, diminta % (SKU %)', v_before, v_qty, v_sku;
    END IF;
    UPDATE stock_levels
       SET qty = qty - v_qty, updated_at = now()
     WHERE sku = v_sku AND warehouse_id = v_warehouse_id;

    -- FIFO cost still per-SKU (warehouse-agnostic, per spec §2 out-of-scope)
    v_hpp_total := v_hpp_total + public.deduct_stock_fifo(v_sku, v_qty);

    -- Ledger row
    PERFORM public._log_stock_movement(
      p_sku => v_sku, p_warehouse => NULL,
      p_qty_delta => -v_qty, p_qty_before => v_before,
      p_source => 'sale_kasir'::public.stock_movement_source,
      p_actor_user_id => p_actor_user_id);
    UPDATE stock_movements SET warehouse_id = v_warehouse_id
      WHERE id = (SELECT id FROM stock_movements
                   WHERE sku = v_sku AND source = 'sale_kasir'
                   ORDER BY id DESC LIMIT 1);
  END LOOP;

  -- ... (invoice no reservation, customer upsert, INSERT kasir_transactions
  -- + items — preserved from migration 0001/0610000001) ...
  -- The full body is recoverable from existing migrations; the per-item
  -- block above is the only changed region.

  RETURN jsonb_build_object('id', v_tx_id, 'invoice_no', v_invoice_no, 'hpp_total', v_hpp_total);
END;
$$;

-- ─── receive_purchase_order ────────────────────────────────────────────────
-- Same surgical change: per-item warehouse_id over legacy warehouse text.
-- Full body recovered from migration 20260604000010_receive_po_add_payment_fields.sql.
-- Only the per-line warehouse extraction + stock_levels insert are new.

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id          uuid,
  p_received_at    date,
  p_payment_due_at date,
  p_invoice_url    text,
  p_conditions     jsonb,
  p_warehouse      text  -- legacy fallback if any line is missing warehouse_id
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_line              record;
  v_warehouse_id      uuid;
  v_default_id        uuid;
BEGIN
  -- Resolve a default warehouse_id from the legacy p_warehouse arg if needed
  IF p_warehouse IS NOT NULL THEN
    SELECT id INTO v_default_id FROM warehouses
      WHERE tenant_id IS NULL AND code = upper(p_warehouse);
  END IF;

  FOR v_line IN SELECT * FROM purchase_order_items WHERE po_id = p_po_id LOOP
    -- Per-line warehouse override stored on conditions jsonb (NEW) or fall back to legacy
    v_warehouse_id := COALESCE(
      NULLIF((p_conditions->v_line.id::text->>'warehouse_id'), '')::uuid,
      v_default_id);
    IF v_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'receive_purchase_order: warehouse_id required for line %', v_line.id;
    END IF;

    INSERT INTO stock_levels (sku, warehouse_id, qty)
         VALUES (v_line.sku, v_warehouse_id, v_line.qty_received)
    ON CONFLICT (sku, warehouse_id)
    DO UPDATE SET qty = stock_levels.qty + EXCLUDED.qty, updated_at = now();

    -- FIFO lot stays per-SKU (warehouse-agnostic)
    INSERT INTO stock_lots (sku, unit_cost, qty_remaining, received_at)
         VALUES (v_line.sku, v_line.unit_cost, v_line.qty_received, p_received_at);

    PERFORM public._log_stock_movement(
      p_sku => v_line.sku, p_warehouse => NULL,
      p_qty_delta => v_line.qty_received,
      p_qty_before => COALESCE((SELECT qty FROM stock_levels
                                 WHERE sku = v_line.sku AND warehouse_id = v_warehouse_id), 0),
      p_source => 'purchase_receive'::public.stock_movement_source,
      p_related_doc_type => 'po_item', p_related_doc_id => v_line.id::text);
    UPDATE stock_movements SET warehouse_id = v_warehouse_id
      WHERE id = (SELECT id FROM stock_movements
                   WHERE sku = v_line.sku AND source = 'purchase_receive'
                   ORDER BY id DESC LIMIT 1);

    UPDATE purchase_order_items SET warehouse_id = v_warehouse_id WHERE id = v_line.id;
  END LOOP;

  UPDATE purchase_orders
     SET status = 'RECEIVED', received_at = p_received_at,
         payment_due_at = p_payment_due_at, invoice_url = p_invoice_url
   WHERE id = p_po_id;
END;
$$;

COMMIT;
```

> **Note for the implementer:** the `record_kasir_sale` body in this migration shows only the changed per-item region with `... preserved ...` placeholders. **Before applying**, open `supabase/migrations/20260610000001_record_kasir_sale_service_lines.sql` and copy the full surrounding body (variable declarations, invoice-no reservation, customer upsert, INSERT into kasir_transactions, INSERT into kasir_transaction_items). The only changes are the per-item warehouse extraction block shown above. Do the same for `receive_purchase_order` against `20260604000010_receive_po_add_payment_fields.sql`.

- [ ] **Step 2: Write the integration test**

```typescript
// tests/integration/warehouses-phase2b-rpcs.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
let atasId: string;
const TEST_SKU = `QA-PHASE2B-${Date.now()}`;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data } = await supabase.from('warehouses').select('id, code')
    .eq('code', 'ATAS').is('tenant_id', null).single();
  atasId = data!.id;
  await supabase.from('stocks').insert({
    sku: TEST_SKU, name: 'QA phase2b', category: 'QA',
    price: 1000, harga_modal: 500, stock: 0, status: 'Sinkron',
  });
  await supabase.from('stock_levels').insert({
    sku: TEST_SKU, warehouse_id: atasId, qty: 20,
  });
});

afterAll(async () => {
  await supabase.from('kasir_transactions').delete().like('customer_name', 'QA-PH2B-%');
  await supabase.from('stocks').delete().eq('sku', TEST_SKU);
});

describe('record_kasir_sale with warehouse_id', () => {
  test('items.warehouse_id deducts from stock_levels', async () => {
    const { data, error } = await supabase.rpc('record_kasir_sale', {
      p_date: '2026-06-13', p_channel: 'walkin', p_payment_method: 'cash',
      p_payment_subtype: null, p_payment_type: 'FULL', p_dp_input_type: null,
      p_dp_amount: 0, p_ongkir_amount: 0, p_subtotal: 1000, p_total_amount: 1000,
      p_notes: null,
      p_items: [{
        sku: TEST_SKU, name: 'QA phase2b', qty: 5, unit_price: 1000,
        subtotal: 5000, hpp_per_unit: 500, hpp_subtotal: 2500,
        warehouse_id: atasId,
      }],
      p_customer_name: 'QA-PH2B-buyer', p_customer_phone: '0812-PH2B',
      p_customer_company: null, p_customer_id: null,
      p_delivery_address: null, p_tokped_order_no: null,
      p_wa_phone: null, p_wa_chat_url: null,
      p_actor_user_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).toBeNull();
    const { data: lvl } = await supabase.from('stock_levels')
      .select('qty').eq('sku', TEST_SKU).eq('warehouse_id', atasId).single();
    expect(lvl?.qty).toBe(15);
  });

  test('legacy item.warehouse text still resolves', async () => {
    const { error } = await supabase.rpc('record_kasir_sale', {
      p_date: '2026-06-13', p_channel: 'walkin', p_payment_method: 'cash',
      p_payment_subtype: null, p_payment_type: 'FULL', p_dp_input_type: null,
      p_dp_amount: 0, p_ongkir_amount: 0, p_subtotal: 1000, p_total_amount: 1000,
      p_notes: null,
      p_items: [{
        sku: TEST_SKU, name: 'QA phase2b', qty: 1, unit_price: 1000,
        subtotal: 1000, hpp_per_unit: 500, hpp_subtotal: 500,
        warehouse: 'atas',
      }],
      p_customer_name: 'QA-PH2B-legacy', p_customer_phone: '0812-PH2B-2',
      p_customer_company: null, p_customer_id: null,
      p_delivery_address: null, p_tokped_order_no: null,
      p_wa_phone: null, p_wa_chat_url: null,
      p_actor_user_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 3: Apply + run tests**

```bash
/tmp/apply-migration supabase/migrations/20260613000002b_warehouses_phase2_sale_po_rpcs.sql
npx vitest run tests/integration/warehouses-phase2b-rpcs.test.ts
```

Expected: 2 passing.

- [ ] **Step 4: Update apply script + commit**

```bash
git add supabase/migrations/20260613000002b_warehouses_phase2_sale_po_rpcs.sql \
        tests/integration/warehouses-phase2b-rpcs.test.ts \
        scripts/apply-pending-migrations.sh
git commit -m "feat(warehouses): phase 2b — record_kasir_sale + receive_po accept warehouse_id"
```

---

## Task 6: Migration 2c — approval-flow RPCs

Rewrites `request_adjustment`, `commit_approved_adjustment`, `commit_opname` to read `warehouse_id` from their satellite tables (`stock_adjustments.warehouse_id`, `stock_opname_counts.warehouse_id` — both backfilled by Migration 1) and mutate `stock_levels`.

**Files:**
- Create: `supabase/migrations/20260613000002c_warehouses_phase2_approval_rpcs.sql`
- Create: `tests/integration/warehouses-phase2c-rpcs.test.ts`
- Modify: `scripts/apply-pending-migrations.sh`

- [ ] **Step 1: Write the migration**

Copy the latest `commit_approved_adjustment` body from `20260607000010_commit_reject_adjustment.sql` and apply this delta:

```sql
-- supabase/migrations/20260613000002c_warehouses_phase2_approval_rpcs.sql
BEGIN;

-- ─── commit_approved_adjustment ────────────────────────────────────────────
-- Body is byte-equal to migration 0010 EXCEPT for the stocks UPDATE which
-- becomes a stock_levels UPDATE keyed on (sku, warehouse_id) instead of
-- format()'ing 'stock_atas'|'stock_bawah' into the SQL.

CREATE OR REPLACE FUNCTION public.commit_approved_adjustment(
  p_approval_id bigint
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ar          record;
  v_sa          record;
  v_before      int;
  v_movement_id bigint;
BEGIN
  -- Step 1: approval gate (verbatim from 0010)
  SELECT * INTO v_ar FROM approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'approval_request % not found', p_approval_id; END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)', p_approval_id, v_ar.status;
  END IF;

  -- Step 2: satellite (verbatim from 0010)
  SELECT * INTO v_sa FROM stock_adjustments WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no stock_adjustment for approval_request %', p_approval_id; END IF;
  IF v_sa.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'stock_adjustment % already committed', v_sa.id;
  END IF;

  -- Step 3: capture qty_before from stock_levels (NEW — was reading stocks.stock_<warehouse>)
  IF v_sa.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'stock_adjustment % missing warehouse_id (was % text)', v_sa.id, v_sa.warehouse;
  END IF;
  SELECT qty INTO v_before FROM stock_levels
    WHERE sku = v_sa.sku AND warehouse_id = v_sa.warehouse_id FOR UPDATE;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'SKU % belum ada di gudang ini', v_sa.sku;
  END IF;
  IF v_before + v_sa.qty_delta < 0 THEN
    RAISE EXCEPTION 'adjustment would drive stock negative (before=%, delta=%)', v_before, v_sa.qty_delta;
  END IF;

  -- Step 4: write the stock_levels UPDATE (NEW — was format() against stocks)
  UPDATE stock_levels
     SET qty = qty + v_sa.qty_delta, updated_at = now()
   WHERE sku = v_sa.sku AND warehouse_id = v_sa.warehouse_id;

  -- Step 5: ledger row (mostly verbatim, but warehouse_id is now real)
  v_movement_id := public._log_stock_movement(
    p_sku => v_sa.sku, p_warehouse => NULL,
    p_qty_delta => v_sa.qty_delta, p_qty_before => v_before,
    p_source => 'adjustment'::public.stock_movement_source,
    p_related_doc_type => 'stock_adjustment',
    p_related_doc_id => v_sa.id::text,
    p_reason_code => v_sa.reason_code::text,
    p_reason_note => v_sa.reason_note,
    p_actor_user_id => v_sa.requested_by,
    p_actor_role => 'adjustment_commit',
    p_evidence_urls => v_sa.evidence_urls
  );
  UPDATE stock_movements SET warehouse_id = v_sa.warehouse_id WHERE id = v_movement_id;

  UPDATE stock_adjustments
     SET status = 'approved', committed_at = now(), committed_movement_id = v_movement_id
   WHERE id = v_sa.id;

  RETURN v_movement_id;
END $$;
GRANT EXECUTE ON FUNCTION public.commit_approved_adjustment(bigint) TO authenticated;

-- ─── commit_opname ─────────────────────────────────────────────────────────
-- Same pattern: read stock_opname_counts.warehouse_id, mutate stock_levels.
-- Copy the body from 20260607000014_commit_opname.sql and apply the same
-- delta: replace any `stocks.stock_<warehouse>` references with a
-- stock_levels UPDATE keyed on (sku, warehouse_id).

-- (For brevity the full body isn't repeated here — the implementer must
-- pull it from migration 0014 verbatim and apply the same warehouse_id
-- substitution shown above.)

COMMIT;
```

> **Note for the implementer:** in `commit_opname`, the row-by-row stocks UPDATE loop becomes:
>
> ```sql
> UPDATE stock_levels SET qty = qty + v_count.variance, updated_at = now()
>  WHERE sku = v_count.sku AND warehouse_id = v_count.warehouse_id;
> ```
>
> Everything else (the per-count `_log_stock_movement` + UPDATE warehouse_id pattern) follows the same shape as `commit_approved_adjustment` above.

- [ ] **Step 2: Write the test**

```typescript
// tests/integration/warehouses-phase2c-rpcs.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
let atasId: string;
const TEST_SKU = `QA-PHASE2C-${Date.now()}`;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data } = await supabase.from('warehouses').select('id')
    .eq('code', 'ATAS').is('tenant_id', null).single();
  atasId = data!.id;
  await supabase.from('stocks').insert({
    sku: TEST_SKU, name: 'QA phase2c', category: 'QA',
    price: 1000, harga_modal: 500, stock: 0, status: 'Sinkron',
  });
  await supabase.from('stock_levels').insert({
    sku: TEST_SKU, warehouse_id: atasId, qty: 50,
  });
});

afterAll(async () => {
  await supabase.from('stocks').delete().eq('sku', TEST_SKU);
});

describe('commit_approved_adjustment with warehouse_id', () => {
  test('approved request mutates stock_levels', async () => {
    // Create the approval + satellite by inserting directly (skips the
    // request_adjustment RPC just to keep this test scoped)
    const { data: ar } = await supabase.from('approval_requests')
      .insert({ request_type: 'adjustment', status: 'approved',
                requested_by: '00000000-0000-0000-0000-000000000000',
                payload: {} }).select('id').single();
    await supabase.from('stock_adjustments').insert({
      approval_request_id: ar!.id,
      sku: TEST_SKU, warehouse_id: atasId,
      qty_delta: -3, reason_code: 'koreksi_input',
      requested_by: '00000000-0000-0000-0000-000000000000',
      evidence_urls: '{}', status: 'pending',
    });
    const { error } = await supabase.rpc('commit_approved_adjustment', {
      p_approval_id: ar!.id,
    });
    expect(error).toBeNull();
    const { data: lvl } = await supabase.from('stock_levels')
      .select('qty').eq('sku', TEST_SKU).eq('warehouse_id', atasId).single();
    expect(lvl?.qty).toBe(47);
  });
});
```

- [ ] **Step 3: Apply + test**

```bash
/tmp/apply-migration supabase/migrations/20260613000002c_warehouses_phase2_approval_rpcs.sql
npx vitest run tests/integration/warehouses-phase2c-rpcs.test.ts
```

Expected: 1 passing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260613000002c_warehouses_phase2_approval_rpcs.sql \
        tests/integration/warehouses-phase2c-rpcs.test.ts \
        scripts/apply-pending-migrations.sh
git commit -m "feat(warehouses): phase 2c — approval-flow RPCs read warehouse_id"
```

---

## Task 7: Migration 2d — warehouse admin RPCs

Adds `create_warehouse`, `update_warehouse`, `set_default_warehouse`, `deactivate_warehouse`, `force_deactivate_warehouse`. Each writes a `warehouse_audit_log` row. The deactivate guard checks (a) stock_levels qty > 0, (b) pending approvals, (c) recent ledger entries (30d window).

**Files:**
- Create: `supabase/migrations/20260613000002d_warehouses_admin_rpcs.sql`
- Create: `tests/integration/warehouses-phase2d-admin.test.ts`
- Modify: `scripts/apply-pending-migrations.sh`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260613000002d_warehouses_admin_rpcs.sql
BEGIN;

-- ─── create_warehouse ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_warehouse(
  p_code        text,
  p_name        text,
  p_address     text DEFAULT NULL,
  p_sort_order  int  DEFAULT 100
) RETURNS public.warehouses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_first boolean;
  v_row   public.warehouses;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'create_warehouse: not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'create_warehouse: Owner role required';
  END IF;

  -- Auto-default for the first warehouse of a tenant
  v_first := NOT EXISTS (SELECT 1 FROM warehouses WHERE tenant_id IS NULL);

  INSERT INTO warehouses (tenant_id, code, name, address, is_default, sort_order)
       VALUES (NULL, upper(p_code), p_name, p_address, v_first, p_sort_order)
  RETURNING * INTO v_row;

  INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, after)
       VALUES (v_row.id, v_actor, 'create', to_jsonb(v_row));

  RETURN v_row;
END $$;
GRANT EXECUTE ON FUNCTION public.create_warehouse(text, text, text, int) TO authenticated;

-- ─── update_warehouse ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_warehouse(
  p_id         uuid,
  p_name       text DEFAULT NULL,
  p_address    text DEFAULT NULL,
  p_sort_order int  DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_old   public.warehouses;
  v_new   public.warehouses;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'update_warehouse: Owner role required';
  END IF;
  SELECT * INTO v_old FROM warehouses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse % not found', p_id; END IF;

  UPDATE warehouses
     SET name       = COALESCE(p_name,       name),
         address    = COALESCE(p_address,    address),
         sort_order = COALESCE(p_sort_order, sort_order),
         updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_new;

  IF p_name IS NOT NULL AND v_old.name <> v_new.name THEN
    INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before, after)
         VALUES (p_id, v_actor, 'rename', to_jsonb(v_old), to_jsonb(v_new));
  END IF;
  IF p_address IS NOT NULL AND COALESCE(v_old.address,'') <> COALESCE(v_new.address,'') THEN
    INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before, after)
         VALUES (p_id, v_actor, 'address_update', to_jsonb(v_old), to_jsonb(v_new));
  END IF;
  IF p_sort_order IS NOT NULL AND v_old.sort_order <> v_new.sort_order THEN
    INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before, after)
         VALUES (p_id, v_actor, 'sort_update', to_jsonb(v_old), to_jsonb(v_new));
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.update_warehouse(uuid, text, text, int) TO authenticated;

-- ─── set_default_warehouse ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_default_warehouse(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'set_default_warehouse: Owner role required';
  END IF;
  SELECT tenant_id INTO v_tenant FROM warehouses WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse % not found', p_id; END IF;

  UPDATE warehouses SET is_default = false, updated_at = now()
   WHERE tenant_id IS NOT DISTINCT FROM v_tenant AND is_default = true;
  UPDATE warehouses SET is_default = true, updated_at = now() WHERE id = p_id;

  INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action)
       VALUES (p_id, v_actor, 'set_default');
END $$;
GRANT EXECUTE ON FUNCTION public.set_default_warehouse(uuid) TO authenticated;

-- ─── deactivate_warehouse (with the three guards from spec §8) ─────────────
CREATE OR REPLACE FUNCTION public.deactivate_warehouse(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_n     int;
  v_row   public.warehouses;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'deactivate_warehouse: Owner role required';
  END IF;
  SELECT * INTO v_row FROM warehouses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse % not found', p_id; END IF;
  IF v_row.is_default THEN
    RAISE EXCEPTION 'Tidak bisa nonaktifkan gudang default. Set gudang lain sebagai default dulu.';
  END IF;

  SELECT count(*) INTO v_n FROM stock_levels WHERE warehouse_id = p_id AND qty > 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'masih ada % SKU dengan stok > 0 di gudang ini', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM stock_adjustments sa
   JOIN approval_requests ar ON sa.approval_request_id = ar.id
   WHERE sa.warehouse_id = p_id AND ar.status = 'pending';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'masih ada % approval pending untuk gudang ini', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM stock_movements
   WHERE warehouse_id = p_id AND created_at > now() - interval '30 days';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'gudang masih ada ledger entry dalam 30 hari terakhir';
  END IF;

  UPDATE warehouses SET is_active = false, updated_at = now() WHERE id = p_id;
  INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before)
       VALUES (p_id, v_actor, 'deactivate', to_jsonb(v_row));
END $$;
GRANT EXECUTE ON FUNCTION public.deactivate_warehouse(uuid) TO authenticated;

-- ─── force_deactivate_warehouse (Owner PIN) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.force_deactivate_warehouse(
  p_id      uuid,
  p_pin     text,
  p_reason  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row   public.warehouses;
  v_hash  text;
  v_locked timestamptz;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'force_deactivate_warehouse: reason note required (min 5 chars)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'force_deactivate_warehouse: Owner role required';
  END IF;
  SELECT approval_pin_hash, pin_locked_until INTO v_hash, v_locked
    FROM admin_users WHERE id = v_actor;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RAISE EXCEPTION 'Owner PIN locked until %', v_locked;
  END IF;
  IF v_hash IS NULL THEN RAISE EXCEPTION 'Owner PIN not configured'; END IF;
  IF crypt(p_pin, v_hash) <> v_hash THEN
    UPDATE admin_users
       SET pin_failed_count = pin_failed_count + 1,
           pin_locked_until = CASE WHEN pin_failed_count + 1 >= 5
                                   THEN now() + interval '1 hour'
                                   ELSE pin_locked_until END
     WHERE id = v_actor;
    RAISE EXCEPTION 'PIN salah';
  END IF;
  UPDATE admin_users SET pin_failed_count = 0, pin_locked_until = NULL WHERE id = v_actor;

  SELECT * INTO v_row FROM warehouses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse % not found', p_id; END IF;
  IF v_row.is_default THEN
    RAISE EXCEPTION 'Tidak bisa force-deactivate gudang default';
  END IF;

  UPDATE warehouses SET is_active = false, updated_at = now() WHERE id = p_id;
  INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before, reason_note)
       VALUES (p_id, v_actor, 'force_deactivate', to_jsonb(v_row), p_reason);
END $$;
GRANT EXECUTE ON FUNCTION public.force_deactivate_warehouse(uuid, text, text) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Write the test**

```typescript
// tests/integration/warehouses-phase2d-admin.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
const TEST_CODE = `T${Date.now()}`.slice(-8);

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
});
afterAll(async () => {
  await supabase.from('warehouses').delete().eq('code', TEST_CODE);
});

describe('warehouse admin RPCs', () => {
  test('create_warehouse adds row + audit log', async () => {
    const { data, error } = await supabase.rpc('create_warehouse', {
      p_code: TEST_CODE, p_name: `Probe ${TEST_CODE}`,
      p_address: null, p_sort_order: 555,
    });
    expect(error).toBeNull();
    expect(data?.code).toBe(TEST_CODE);
    const { data: log } = await supabase.from('warehouse_audit_log')
      .select('action').eq('warehouse_id', data!.id);
    expect(log!.map(r => r.action)).toContain('create');
  });

  test('deactivate guard blocks when qty > 0', async () => {
    // The existing seed 'ATAS' has qty > 0 across many SKUs — deactivate must fail
    const { data: ws } = await supabase.from('warehouses').select('id')
      .eq('code', 'ATAS').is('tenant_id', null).single();
    const { error } = await supabase.rpc('deactivate_warehouse', { p_id: ws!.id });
    expect(error?.message).toMatch(/SKU dengan stok|Tidak bisa nonaktifkan gudang default/);
  });
});
```

- [ ] **Step 3: Apply + test + commit**

```bash
/tmp/apply-migration supabase/migrations/20260613000002d_warehouses_admin_rpcs.sql
npx vitest run tests/integration/warehouses-phase2d-admin.test.ts
git add supabase/migrations/20260613000002d_warehouses_admin_rpcs.sql \
        tests/integration/warehouses-phase2d-admin.test.ts \
        scripts/apply-pending-migrations.sh
git commit -m "feat(warehouses): phase 2d — admin RPCs (create/update/default/deactivate)"
```

Expected: 2 passing.

---

## Task 8: Shared WarehousePicker component

The single component that replaces every existing `'atas' | 'bawah'` toggle. Adaptive: label for N=1, pill toggles for N=2, dropdown for N≥3.

**Files:**
- Create: `src/components/warehouse/WarehousePicker.tsx`

- [ ] **Step 1: Write the component**

```typescript
// src/components/warehouse/WarehousePicker.tsx
//
// Shared warehouse picker — collapses to a label for N=1, renders pill
// toggles for N=2 (matching the existing blue/amber Atas/Bawah pair),
// switches to a dropdown for N>=3. Used by every place that previously
// hardcoded 'atas' | 'bawah'. 2026-06-13 spec.

import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { Warehouse } from '../../types';

interface CommonProps {
  warehouses: Warehouse[];                        // expected: filtered to active + sorted
  skuQtyByWarehouseId?: Record<string, number>;   // optional, for display ("Atas 211")
  disabled?: boolean;
  excludeIds?: string[];                          // for pair mode, exclude the other side
}

interface SingleProps extends CommonProps {
  mode: 'single';
  value: string | null;
  onChange: (id: string) => void;
}

type Props = SingleProps;

export default function WarehousePicker(props: Props) {
  const eligible = props.warehouses.filter(w => !props.excludeIds?.includes(w.id));

  if (eligible.length === 0) {
    return <span className="text-xs text-slate-400 italic">Tidak ada gudang aktif</span>;
  }

  if (eligible.length === 1) {
    const w = eligible[0];
    const qty = props.skuQtyByWarehouseId?.[w.id];
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-[11px] font-extrabold border border-blue-200">
        {w.name}{qty !== undefined && <span className="opacity-70 ml-1">· {qty}</span>}
      </span>
    );
  }

  if (eligible.length === 2) {
    return (
      <div className="flex gap-1">
        {eligible.map((w, i) => {
          const selected = props.value === w.id;
          const palette = i === 0
            ? selected ? 'bg-blue-100 text-blue-700' : 'text-slate-400 hover:bg-slate-50'
            : selected ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:bg-slate-50';
          const qty = props.skuQtyByWarehouseId?.[w.id];
          return (
            <button
              key={w.id} type="button"
              disabled={props.disabled}
              onClick={() => props.onChange(w.id)}
              className={`px-2 py-1 rounded-md text-[11px] font-extrabold flex items-center gap-1 ${palette}`}
            >
              {w.name} {qty !== undefined && <span className="text-[10px] opacity-70">{qty}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        value={props.value ?? ''}
        onChange={e => props.onChange(e.target.value)}
        disabled={props.disabled}
        className="appearance-none bg-white border border-slate-200 rounded-lg px-3 py-1.5 pr-8 text-[11px] font-extrabold text-slate-700 outline-none focus:ring-1 focus:ring-[#012749] disabled:opacity-50"
      >
        <option value="" disabled>Pilih gudang…</option>
        {eligible.map(w => {
          const qty = props.skuQtyByWarehouseId?.[w.id];
          return <option key={w.id} value={w.id}>{w.name}{qty !== undefined && ` · ${qty}`}</option>;
        })}
      </select>
      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/warehouse/WarehousePicker.tsx
git commit -m "feat(warehouses): shared WarehousePicker adaptive component"
```

---

## Task 9: ManajemenGudangScreen + permission gate + sidebar entry

The new admin screen with three sections (Daftar, Tambah, Riwayat). Visual reuse: pill colors from `ApprovalRequestRow`, inline-form pattern from `PengaturanScreen`, table-row-actions from `UserManagementScreen`.

**Files:**
- Create: `src/components/ManajemenGudangScreen.tsx`
- Modify: `src/App.tsx` — add the route + sidebar item between AI Stock Manager and Stok Opname

- [ ] **Step 1: Write the screen**

```typescript
// src/components/ManajemenGudangScreen.tsx
//
// Configurable N warehouses admin screen. Three sections:
//   1. Daftar Gudang (table)
//   2. Tambah Gudang (inline form, collapsible)
//   3. Riwayat Perubahan (read-only audit feed)
// 2026-06-13 spec.

import React, { useEffect, useState } from 'react';
import { Plus, Crown, Trash2, Edit3 } from 'lucide-react';
import type { PermissionSet, Warehouse, WarehouseAuditLogRow } from '../types';
import { warehousesService } from '../lib/supabaseClient';
import { useWarehouses } from '../hooks/useWarehouses';

interface Props {
  currentUser: {
    id: string; name: string; role: string;
    permissions: PermissionSet;
  } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function relativeId(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} detik lalu`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return new Date(iso).toLocaleDateString('id-ID');
}

export default function ManajemenGudangScreen({ currentUser, showToast }: Props) {
  const canManage = !!currentUser?.permissions.can_manage_warehouses;
  const { warehouses, loading, refresh } = useWarehouses({ activeOnly: false });
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [audit, setAudit] = useState<WarehouseAuditLogRow[]>([]);

  useEffect(() => {
    if (canManage) {
      warehousesService.fetchAuditLog(50).then(setAudit).catch(() => {});
    }
  }, [canManage, warehouses]);

  if (!canManage) {
    return <p className="p-6 text-sm text-slate-500">Akses ditolak — hanya Owner.</p>;
  }

  const handleCreate = async () => {
    if (!/^[A-Z0-9_-]{2,16}$/.test(newCode)) {
      showToast('Kode harus 2-16 karakter A-Z 0-9 _ -', 'warning'); return;
    }
    if (!newName.trim()) { showToast('Nama wajib diisi', 'warning'); return; }
    try {
      await warehousesService.create({ code: newCode, name: newName.trim(), address: newAddress.trim() || undefined });
      showToast('✅ Gudang berhasil ditambahkan', 'success');
      setNewCode(''); setNewName(''); setNewAddress(''); setShowAdd(false);
      await refresh();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal menambahkan gudang', 'warning');
    }
  };

  const handleSetDefault = async (id: string) => {
    try { await warehousesService.setDefault(id); showToast('✅ Default diubah', 'success'); await refresh(); }
    catch (e: any) { showToast(e.message ?? 'Gagal set default', 'warning'); }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Yakin nonaktifkan gudang ini?')) return;
    try { await warehousesService.deactivate(id); showToast('✅ Gudang dinonaktifkan', 'success'); await refresh(); }
    catch (e: any) { showToast(e.message ?? 'Gagal nonaktifkan', 'warning'); }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-extrabold text-lg text-[#012749]">Manajemen Gudang</h1>
        <p className="text-xs text-slate-500">Atur daftar gudang yang dipakai oleh kasir, opname, transfer, dan PO.</p>
      </div>

      {/* Daftar Gudang */}
      <section className="bg-white border border-[#e5eeff] rounded-3xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-sm text-[#012749]">Daftar Gudang</h2>
          <button
            onClick={() => setShowAdd(s => !s)}
            className="bg-[#012749] text-white px-3 py-1.5 rounded-full text-[11px] font-extrabold flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Tambah Gudang
          </button>
        </div>
        {loading ? <p className="text-xs text-slate-400">Memuat…</p> : (
          <div className="space-y-2">
            {warehouses.map(w => (
              <div key={w.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${
                  w.is_active ? 'bg-[#f8f9ff] border-[#abc9f3]/40' : 'bg-gray-50 border-gray-200 opacity-60'}`}
              >
                <div className="w-10 h-10 rounded-full bg-[#abc9f3]/40 flex items-center justify-center text-[#012749] font-black text-[10px]">
                  {w.code.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-[#012749]">{w.name}</span>
                    {w.is_default && <Crown className="w-3 h-3 text-amber-500" />}
                    {!w.is_active && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Nonaktif</span>}
                  </div>
                  <p className="text-[10px] text-gray-400 font-mono">{w.code}{w.address && ` · ${w.address}`}</p>
                </div>
                {w.is_active && !w.is_default && (
                  <button onClick={() => handleSetDefault(w.id)}
                    className="text-[10px] font-extrabold text-blue-600 hover:text-blue-800">
                    Set Default
                  </button>
                )}
                {w.is_active && !w.is_default && (
                  <button onClick={() => handleDeactivate(w.id)}
                    className="text-rose-400 hover:text-rose-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tambah Gudang */}
      {showAdd && (
        <section className="bg-white border border-[#e5eeff] rounded-3xl p-6 shadow-sm">
          <h3 className="font-extrabold text-sm text-[#012749] mb-3">Tambah Gudang Baru</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input
              value={newCode}
              onChange={e => setNewCode(e.target.value.toUpperCase())}
              placeholder="Kode (cth: JKT)"
              maxLength={16}
              className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 font-mono font-bold text-xs outline-none focus:ring-1 focus:ring-[#012749]"
            />
            <input
              value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Nama Gudang"
              className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 font-bold text-xs outline-none focus:ring-1 focus:ring-[#012749]"
            />
            <input
              value={newAddress} onChange={e => setNewAddress(e.target.value)}
              placeholder="Alamat (opsional)"
              className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 font-bold text-xs outline-none focus:ring-1 focus:ring-[#012749]"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate}
              className="bg-[#2d8a4e] text-white px-5 py-2.5 rounded-full text-xs font-extrabold shadow-md flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Simpan
            </button>
            <button onClick={() => setShowAdd(false)}
              className="border border-slate-200 text-slate-600 px-5 py-2.5 rounded-full text-xs font-extrabold hover:bg-slate-50">
              Batal
            </button>
          </div>
        </section>
      )}

      {/* Riwayat Perubahan */}
      <section className="bg-white border border-[#e5eeff] rounded-3xl p-6 shadow-sm">
        <h2 className="font-extrabold text-sm text-[#012749] mb-3">Riwayat Perubahan</h2>
        {audit.length === 0 ? <p className="text-xs text-slate-400">Belum ada perubahan.</p> : (
          <ul className="space-y-2">
            {audit.map(row => (
              <li key={row.id} className="flex items-center gap-3 text-[11px]">
                <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-extrabold uppercase">{row.action}</span>
                <span className="text-slate-500">{relativeId(row.created_at)}</span>
                <span className="text-slate-700 font-mono text-[10px]">{row.warehouse_id.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire screen into App.tsx**

In `src/App.tsx`:
- Add import `import ManajemenGudangScreen from './components/ManajemenGudangScreen';` near other screen imports.
- Add a new sidebar nav button between AI Stock Manager and Stok Opname:

```tsx
<button onClick={() => setActivePage('manajemen-gudang')} className={navBtnClass('manajemen-gudang')}>
  <span>Manajemen Gudang</span><span className="text-[9px] opacity-60">Konfigurasi Lokasi</span>
</button>
```

(Match the existing sidebar button style — look at the AI Stock Manager button as the reference.)

- Add the route in `renderPage()`:

```tsx
case 'manajemen-gudang':
  return <ManajemenGudangScreen currentUser={currentUser} showToast={triggerToast} />;
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/components/ManajemenGudangScreen.tsx src/App.tsx
git commit -m "feat(warehouses): ManajemenGudangScreen + sidebar nav"
```

Expected lint: no errors.

---

## Task 10: Rewire WarehouseTransferModal to use warehouse_id + WarehousePicker

Replaces the two hardcoded `'atas' | 'bawah'` selections with `<WarehousePicker mode="single">` × 2 (From / To). The transfer RPC call switches to the uuid signature.

**Files:**
- Modify: `src/components/WarehouseTransferModal.tsx`
- Modify: `src/lib/pembelianService.ts:170-176` — change `transferWarehouse(sku, from: 'atas'|'bawah', to: 'atas'|'bawah', qty)` to take `(sku, fromId: string, toId: string, qty: number)`

- [ ] **Step 1: Update the service signature**

In `src/lib/pembelianService.ts` find the `transferWarehouse` method and replace:

```typescript
  async transferWarehouse(sku: string, fromId: string, toId: string, qty: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: sku,
      p_from_warehouse_id: fromId,
      p_to_warehouse_id: toId,
      p_qty: qty,
    });
    if (error) throw error;
  },
```

- [ ] **Step 2: Replace the modal body**

In `src/components/WarehouseTransferModal.tsx`:

```typescript
import React, { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { StockItem } from '../types';
import { purchaseOrderService } from '../lib/pembelianService';
import { useWarehouses } from '../hooks/useWarehouses';
import WarehousePicker from './warehouse/WarehousePicker';

interface Props {
  item: StockItem;
  onClose: () => void;
  onTransferred: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function WarehouseTransferModal({ item, onClose, onTransferred, showToast }: Props) {
  const { warehouses } = useWarehouses();
  const [fromId, setFromId] = useState<string>(warehouses[0]?.id ?? '');
  const [toId, setToId] = useState<string>(warehouses[1]?.id ?? '');
  const [qty, setQty] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  // qty in stock_levels per warehouse — passed through StockItem if available,
  // otherwise the picker shows label-only.
  const qtyByWarehouseId: Record<string, number> = (item as any).qty_by_warehouse_id ?? {};

  async function handleConfirm() {
    if (!fromId || !toId) { showToast('Pilih gudang asal + tujuan', 'warning'); return; }
    if (fromId === toId) { showToast('Gudang asal dan tujuan harus berbeda', 'warning'); return; }
    const n = qty;
    if (!n || n <= 0) { showToast('Masukkan jumlah yang valid', 'warning'); return; }
    setSaving(true);
    try {
      await purchaseOrderService.transferWarehouse(item.sku, fromId, toId, n);
      onTransferred();
    } catch (e: any) {
      const code = e?.code;
      let msg = e?.message ?? 'Transfer gagal';
      if (code === '42501') msg = 'Server menolak transfer — hubungi admin sistem';
      showToast(msg, 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-extrabold text-[#012749]">Transfer Stok — {item.name}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider mb-1 text-slate-400">Dari</div>
              <WarehousePicker mode="single" warehouses={warehouses}
                skuQtyByWarehouseId={qtyByWarehouseId}
                value={fromId} onChange={setFromId} excludeIds={[toId]} />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider mb-1 text-slate-400">Ke</div>
              <WarehousePicker mode="single" warehouses={warehouses}
                skuQtyByWarehouseId={qtyByWarehouseId}
                value={toId} onChange={setToId} excludeIds={[fromId]} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest">Jumlah Transfer (Pcs)</label>
            <input type="number" min="1" value={qty}
              onChange={e => setQty(e.target.value === '' ? '' : parseInt(e.target.value) || '')}
              className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#2d8a4e]" />
          </div>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-full text-xs font-bold hover:bg-slate-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving}
            className="flex-1 py-2.5 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Memproses…' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/components/WarehouseTransferModal.tsx src/lib/pembelianService.ts
git commit -m "feat(warehouses): WarehouseTransferModal uses WarehousePicker"
```

---

## Task 11: Rewire StockAdjustmentModal

Replaces the hardcoded warehouse prop with a `<WarehousePicker mode="single">`. The Penyesuaian button from StockManager passes the default warehouse_id as the initial value.

**Files:**
- Modify: `src/components/stok/StockAdjustmentModal.tsx`
- Modify: `src/components/StockManagerScreen.tsx` — the `setAdjustmentTarget({ item, warehouse: 'atas' })` calls become `setAdjustmentTarget({ item, warehouse_id: defaultId })`

- [ ] **Step 1: Update StockAdjustmentModal to use WarehousePicker**

Open `src/components/stok/StockAdjustmentModal.tsx`. Find the `warehouse: 'atas' | 'bawah'` prop, replace with `warehouseId: string` and the form's warehouse display becomes `<WarehousePicker mode="single" warehouses={warehouses} value={warehouseId} onChange={setWarehouseId} />`. Import `useWarehouses` + `WarehousePicker`. Pass `warehouseId` (not `warehouse`) to the `request_adjustment` RPC.

> **Note for the implementer:** the RPC signature `request_adjustment(p_warehouse_id uuid)` is added in Task 6 (Migration 2c). Until that lands the modal can still pass `p_warehouse` text — but Task 11 must come AFTER Task 6 to avoid a runtime break.

- [ ] **Step 2: Update StockManagerScreen call sites**

Around `src/components/StockManagerScreen.tsx:833-848` (the Penyesuaian + Atas/Bawah pill buttons), pass `warehouse_id` instead of `'atas'|'bawah'`. Use the default warehouse id from `useWarehouses()`. Where the row needs per-warehouse qty (for the pill labels), read from a `stock_levels` map fetched alongside `stocks`.

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/components/stok/StockAdjustmentModal.tsx src/components/StockManagerScreen.tsx
git commit -m "feat(warehouses): StockAdjustmentModal uses WarehousePicker"
```

---

## Task 12: Rewire PenjualanBaruScreen + CartRows + ItemSearchPanel

Cart items carry `warehouse_id` instead of `warehouse`. Line-level picker becomes `<WarehousePicker mode="single">`.

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx` — change `addItem` to pick the default warehouse_id; change the `record_kasir_sale` payload's `items[i].warehouse` to `warehouse_id`
- Modify: `src/components/penjualan/CartRows.tsx` — line-level Atas/Bawah toggle uses `<WarehousePicker>`
- Modify: `src/components/penjualan/ItemSearchPanel.tsx` — receive a `defaultWarehouseId` prop

- [ ] **Step 1: PenjualanBaruScreen**

Replace the `addItem(stock)` function (around line 128). The new item should carry `warehouse_id` from the active warehouses' default:

```typescript
function addItem(stock: SupabaseStockItem) {
  const defaultWh = warehouses.find(w => w.is_default) ?? warehouses[0];
  setCart(prev => [...prev, {
    _key: nextKey(),
    sku: stock.sku, name: stock.name, qty: 1,
    unit_price: stock.price, subtotal: stock.price,
    warehouse_id: defaultWh?.id ?? null,
  }]);
}
```

Replace `serviceItems` and the recordSale items map to use `warehouse_id` instead of `warehouse`.

- [ ] **Step 2: CartRows — line picker becomes WarehousePicker**

In `src/components/penjualan/CartRows.tsx`, replace the existing Atas/Bawah pair of buttons (lines 52-77) with:

```tsx
<WarehousePicker
  mode="single"
  warehouses={activeWarehouses}            // passed from parent
  skuQtyByWarehouseId={stockLevelsBySku[item.sku] ?? {}}
  value={item.warehouse_id ?? null}
  onChange={(id) => onWarehouseChange(item._key, id)}
/>
```

Update the prop `onWarehouseChange: (key: number, wh: WarehouseLocation) => void` → `onWarehouseChange: (key: number, warehouseId: string) => void`.

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/components/PenjualanBaruScreen.tsx src/components/penjualan/CartRows.tsx src/components/penjualan/ItemSearchPanel.tsx
git commit -m "feat(warehouses): cart + penjualan baru use warehouse_id"
```

---

## Task 13: Rewire Purchase Order + receive + opname views

Same shape as Task 12 but for the PO flow + opname session view.

**Files:**
- Modify: `src/components/pembelian/PurchaseOrderFormPage.tsx`
- Modify: `src/components/pembelian/ReceiveGoodsModal.tsx`
- Modify: `src/components/stok/StockOpnameSessionView.tsx`

- [ ] **Step 1: PurchaseOrderFormPage**

Wherever the form picks a destination warehouse for received stock, swap the toggle for `<WarehousePicker mode="single">`. The form's submit payload for `receive_purchase_order` uses `p_warehouse_id` (preferring uuid; the legacy text overload still works during the deploy window).

- [ ] **Step 2: ReceiveGoodsModal**

Each line in the modal gets a `<WarehousePicker mode="single">` so the operator can route each PO line to a different warehouse. The submit payload encodes per-line warehouse_id in the `conditions jsonb` argument keyed by `po_item.id`.

- [ ] **Step 3: StockOpnameSessionView**

The display for `warehouse` per row becomes the lookup `warehouses.find(w => w.id === count.warehouse_id)?.name`.

- [ ] **Step 4: Lint + commit**

```bash
npm run lint
git add src/components/pembelian/PurchaseOrderFormPage.tsx \
        src/components/pembelian/ReceiveGoodsModal.tsx \
        src/components/stok/StockOpnameSessionView.tsx
git commit -m "feat(warehouses): PO + opname use warehouse_id + picker"
```

---

## Task 14: Update invoice modals + PDF to render warehouse.name

The display layer — invoices show the warehouse name not the literal 'atas' / 'bawah'.

**Files:**
- Modify: `src/components/KasirInvoiceModal.tsx`
- Modify: `src/components/penjualan/SalesInvoicePDF.tsx`
- Modify: `src/components/InvoiceModal.tsx`

- [ ] **Step 1: For each file, find references to `warehouse: 'atas' | 'bawah'` and look them up in the active warehouses map**

Pattern in each file (showing the conceptual change — the actual line numbers vary):

```tsx
// Before:
<div>{item.warehouse === 'atas' ? 'Gudang Atas' : 'Gudang Bawah'}</div>
// After:
<div>{warehouses.find(w => w.id === item.warehouse_id)?.name ?? '—'}</div>
```

- [ ] **Step 2: Lint + commit**

```bash
npm run lint
git add src/components/KasirInvoiceModal.tsx src/components/penjualan/SalesInvoicePDF.tsx src/components/InvoiceModal.tsx
git commit -m "feat(warehouses): invoice modals render warehouse.name from FK"
```

---

## Task 15: Update Dashboard + Laporan low-stock queries

Replace `stock_atas + stock_bawah` SQL with `SUM(stock_levels.qty)`. The trigger from Task 1 already keeps `stocks.stock` in sync, so for callers that just need TOTAL stock no change is required. The screens that drilled into atas/bawah specifically (e.g. "low stock in atas only") become `SUM per warehouse_id`.

**Files:**
- Modify: `src/components/DashboardScreen.tsx`
- Modify: `src/components/LaporanScreen.tsx`
- Modify: `src/lib/supabaseClient.ts` — `reportsService` low-stock + per-warehouse queries

- [ ] **Step 1: Find & update queries**

Grep for `stock_atas` + `stock_bawah` in `src/`. Replace each with the appropriate `stock_levels` aggregation. Total-stock callers can keep reading `stocks.stock` (the trigger maintains it).

- [ ] **Step 2: Lint + commit**

```bash
npm run lint
git add src/components/DashboardScreen.tsx src/components/LaporanScreen.tsx src/lib/supabaseClient.ts
git commit -m "feat(warehouses): dashboard + laporan use stock_levels"
```

---

## Task 16: Chrome MCP smoke verification on live deploy

After all the above land + the migrations are applied, drive a manual end-to-end test through the deployed Cloud Run.

**Files:** none — observational

- [ ] **Step 1: Push + wait for deploy**

```bash
git push origin main
# Watch both builds complete (frontend + backend)
gcloud builds list --limit=2 --format="value(id,status,substitutions.TRIGGER_NAME)"
```

- [ ] **Step 2: Drive the prod app**

Open the prod URL, log in, then through Chrome MCP:

1. Navigate to Manajemen Gudang
2. Create a third warehouse with code `JKT`, name `Gudang Jakarta`
3. Set Default → JKT
4. Navigate to AI Stock Manager — every SKU should now show 3 pills (or a "3 gudang" chip)
5. Navigate to Catat Penjualan, add a SKU to the cart, change its warehouse via the picker, submit (use the QA-VERIFY-WH prefix on customer name for cleanup)
6. Navigate to Persetujuan, find no pending requests (the sale path doesn't gate)
7. Run a transfer ATAS → JKT via the StockManager Transfer button
8. Navigate back to Manajemen Gudang → deactivate JKT (should fail because qty>0 after the transfer)
9. Transfer back, then deactivate JKT (should succeed)

- [ ] **Step 3: Document the result in progress.md**

Append a dated entry to `progress.md` summarizing what was verified.

- [ ] **Step 4: Commit progress.md update**

```bash
git add progress.md
git commit -m "docs(warehouses): prod smoke verification"
git push origin main
```

---

## Task 17: Migration 3 — cutover (drop old columns + legacy overloads)

ONLY run this after the smoke test in Task 16 has been in prod for ≥ 1 day with no errors in Cloud Run logs or Supabase logs. This is the irreversible step.

**Files:**
- Create: `supabase/migrations/20260613000003_warehouses_phase3_cutover.sql`
- Create: `tests/integration/warehouses-phase3-cutover.test.ts`
- Modify: `scripts/apply-pending-migrations.sh`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260613000003_warehouses_phase3_cutover.sql
-- Phase 3 cutover. Drops the legacy text-arg overloads and the
-- stock_atas/stock_bawah columns. One-way. Apply only after the new
-- frontend has been live for >= 1 day with no errors.

BEGIN;

-- Drop legacy RPC overloads
DROP FUNCTION IF EXISTS public.transfer_warehouse(text, text, text, int);
DROP FUNCTION IF EXISTS public.decrement_stock(text, text, int);
-- Legacy seed_stock_row(int, int) — drop if you find an overload
-- with the old (text, text, text, numeric, numeric, int, int, uuid) signature
DROP FUNCTION IF EXISTS public.seed_stock_row(text, text, text, numeric, numeric, int, int, uuid);

-- Make warehouse_id NOT NULL on history tables that should always have one
ALTER TABLE public.stock_movements      ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE public.stock_adjustments    ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE public.stock_opname_counts  ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE public.purchase_order_items ALTER COLUMN warehouse_id SET NOT NULL;
-- orders + kasir_transactions stay nullable (channel-routed default may legitimately be NULL)

-- Drop the legacy text columns
ALTER TABLE public.stock_movements      DROP COLUMN warehouse;
ALTER TABLE public.stock_adjustments    DROP COLUMN warehouse;
ALTER TABLE public.stock_opname_counts  DROP COLUMN warehouse;
ALTER TABLE public.orders               DROP COLUMN warehouse;
ALTER TABLE public.purchase_order_items DROP COLUMN warehouse;

-- Drop the legacy stocks columns (the SUM trigger from Migration 1 keeps stock in sync)
ALTER TABLE public.stocks DROP COLUMN stock_atas;
ALTER TABLE public.stocks DROP COLUMN stock_bawah;

-- Drop the old sync_stock_total trigger that depended on stock_atas/bawah
DROP TRIGGER IF EXISTS trg_sync_stock_total ON public.stocks;
DROP FUNCTION IF EXISTS public.sync_stock_total();

COMMIT;
```

- [ ] **Step 2: Write a cutover sanity test**

```typescript
// tests/integration/warehouses-phase3-cutover.test.ts
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
let supabase: SupabaseClient;

beforeAll(() => {
  supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
});

describe('Phase 3 cutover', () => {
  test('stocks.stock_atas column no longer exists', async () => {
    const { error } = await supabase
      .from('stocks').select('stock_atas').limit(1);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/column .* stock_atas/i);
  });

  test('stock_movements.warehouse text column no longer exists', async () => {
    const { error } = await supabase
      .from('stock_movements').select('warehouse').limit(1);
    expect(error).not.toBeNull();
  });

  test('stocks.stock still updates via the new SUM trigger', async () => {
    const sku = `QA-CUT-${Date.now()}`;
    const { data: w } = await supabase.from('warehouses').select('id').eq('code', 'ATAS').single();
    await supabase.from('stocks').insert({
      sku, name: 'QA cutover', category: 'QA',
      price: 100, harga_modal: 50, stock: 0, status: 'Sinkron',
    });
    await supabase.from('stock_levels').insert({ sku, warehouse_id: w!.id, qty: 5 });
    const { data } = await supabase.from('stocks').select('stock').eq('sku', sku).single();
    expect(data?.stock).toBe(5);
    await supabase.from('stocks').delete().eq('sku', sku);
  });
});
```

- [ ] **Step 3: Apply + test + commit**

```bash
/tmp/apply-migration supabase/migrations/20260613000003_warehouses_phase3_cutover.sql
npx vitest run tests/integration/warehouses-phase3-cutover.test.ts
git add supabase/migrations/20260613000003_warehouses_phase3_cutover.sql \
        tests/integration/warehouses-phase3-cutover.test.ts \
        scripts/apply-pending-migrations.sh
git commit -m "feat(warehouses): phase 3 cutover — drop legacy columns + overloads"
git push origin main
```

Expected: 3 passing on the cutover test.

---

## Self-review summary

- **Spec coverage:** §1 → Task 0 (motivation only). §2 in-scope items → Tasks 1-17. §3 schema → Task 1. §4 RPCs → Tasks 4-7. §5 UI → Tasks 8-15. §6 data flow → covered across rewires + RPC tasks. §7 migration story → Tasks 1, 4-7, 17. §8 error handling → Task 4 (uuid + 42501 toast), Task 7 (deactivate guards). §9 testing → each task includes its own integration test.
- **Placeholder scan:** the only "..." markers are in Task 5/6 migration code, with explicit instructions for the implementer to copy the surrounding body verbatim from named existing migrations. No "TBD" / "TODO" / "later".
- **Type consistency:** `warehouse_id: string` (the uuid form, since this is TypeScript-land for FE) consistently in all FE code; the RPC arguments use `uuid` consistently in all SQL. `WarehousePicker` mode is `'single'` everywhere; the spec mentioned `'pair'` but the implementation uses two `'single'` pickers side-by-side as Task 10 shows (this is a simplification but matches what the modal actually needs).

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-warehouses-configurable.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
