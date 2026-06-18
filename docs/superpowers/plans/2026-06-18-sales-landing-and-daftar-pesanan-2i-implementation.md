# Sales Landing + Daftar Pesanan (2-I) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Sales menu first page (landing dashboard with stats + tabs + urgent preview) and Daftar Pesanan funnel (Type Tabs Plus layout), with all click actions wired to atomic Supabase RPCs and payment proof verification (3 upload sources: WA Calista AI, admin manual, marketplace screenshot).

**Architecture:** Add `funnel_stage`/`funnel_sub_stage`/`order_type` columns to `kasir_transactions` with optimistic lock (`version`). Build React components under `src/components/sales/`. Stage transitions go through atomic Supabase RPCs that update state + log to `kasir_audit_logs` + check version. Payment proofs stored in Supabase Storage bucket `payment-proofs`. Realtime subscription on `kasir_transactions` keeps UI fresh.

**Tech Stack:** React + TypeScript (Vite), Tailwind CSS, Supabase (Postgres + Storage + Realtime), Vitest + React Testing Library.

**Scope:** Section 1 (Sales landing) + Section 2-I (Daftar Pesanan funnel) + payment proof verification. Out of scope: Catat Penjualan wizard updates, Pengaturan additions, Calista AI integration, PDF gap (covered by separate plans).

**Reference docs:**
- Parent spec: `docs/superpowers/specs/2026-06-15-order-confirmation-fulfillment-revamp-design.md`
- CP/RP extension: `docs/superpowers/specs/2026-06-16-rakit-custom-panel-funnel-integration-design.md`
- Mockup: `/tmp/fulfillment-mockup.html` (Section 1 + 2-I)

---

## File Structure

**NEW backend (Supabase migrations):**
- `supabase/migrations/20260618000001_funnel_stage_columns.sql` — add `funnel_stage`, `funnel_sub_stage`, `order_type`, `estimated_completion_days`, `estimated_completion_date`, `wip_started_at`, `delivery_method`, `version` columns + indexes
- `supabase/migrations/20260618000002_payment_proof_columns.sql` — add `pelunasan_proof_url`, `marketplace_proof_url` to `kasir_transactions`; create `payment-proofs` storage bucket
- `supabase/migrations/20260618000003_transition_order_stage_rpc.sql` — atomic RPC `transition_order_stage(p_order_id, p_from_sub_stage, p_to_sub_stage, p_expected_version, p_actor_user_id, p_reason)` with optimistic lock + audit log
- `supabase/migrations/20260618000004_sales_stats_rpc.sql` — RPC `get_sales_dashboard_stats()` returns urgent_count / tunggu_count / revenue_pending / completed_this_month
- `supabase/migrations/20260618000005_backfill_funnel_stage.sql` — backfill from existing `status` enum

**NEW types & queries:**
- `src/lib/sales/types.ts` — `OrderType`, `FunnelStage`, `FunnelSubStage`, `Order`, `StageTransition`
- `src/lib/sales/typeTabConfig.ts` — `TYPE_TAB_CFG` with filter logic
- `src/lib/sales/stageMapping.ts` — sub-stage labels, urgent flags, allowed transitions
- `src/lib/sales/quickActionMap.ts` — `getQuickAction(order)` returning label + target sub-stage
- `src/lib/sales/queries.ts` — Supabase fetch + realtime subscription
- `src/lib/sales/mutations.ts` — `transitionOrder()`, `uploadPaymentProof()`, `verifyPayment()`

**NEW components (Section 1 Sales Landing):**
- `src/components/sales/SalesLandingScreen.tsx` — main page
- `src/components/sales/StatsCards.tsx` — 4 stats cards
- `src/components/sales/SalesTabStrip.tsx` — Catat Penjualan / Daftar Pesanan tabs (navigation)
- `src/components/sales/UrgentOrdersPreview.tsx` — dashboard widget (3 urgent inline)

**NEW components (Section 2-I Daftar Pesanan):**
- `src/components/sales/DaftarPesananScreen.tsx` — main page (Section 2-I)
- `src/components/sales/SearchBar.tsx` — global search
- `src/components/sales/Toolbar.tsx` — search + reset + owner override
- `src/components/sales/TypeTabs.tsx` — Komponen / Workshop / Semua primary nav
- `src/components/sales/StageStrip.tsx` — 6-stage horizontal pills
- `src/components/sales/SubStageSection.tsx` — single sub-stage collapsible section
- `src/components/sales/OrderRow.tsx` — order row in flat list
- `src/components/sales/QuickActionPill.tsx` — quick action button
- `src/components/sales/ActionPanel.tsx` — expanded inline action panel
- `src/components/sales/TotalSummaryFooter.tsx` — footer summary

**NEW components (Payment proof):**
- `src/components/sales/PaymentProofThumbnail.tsx` — thumbnail in verify panel
- `src/components/sales/PaymentProofLightbox.tsx` — modal full-size viewer
- `src/components/sales/ProofUploadModal.tsx` — file picker for 3 sources

**MODIFIED files:**
- `src/components/Sidebar.tsx` — Sales menu link → SalesLandingScreen
- `src/App.tsx` (or routing) — add `/sales`, `/sales/daftar`, `/sales/catat` routes
- `src/types.ts` — re-export sales types

**NEW tests (co-located):**
- `src/lib/sales/__tests__/typeTabConfig.test.ts`
- `src/lib/sales/__tests__/quickActionMap.test.ts`
- `src/lib/sales/__tests__/mutations.test.ts`
- `src/components/sales/__tests__/StatsCards.test.tsx`
- `src/components/sales/__tests__/TypeTabs.test.tsx`
- `src/components/sales/__tests__/StageStrip.test.tsx`
- `src/components/sales/__tests__/OrderRow.test.tsx`
- `src/components/sales/__tests__/ActionPanel.test.tsx`
- `src/components/sales/__tests__/PaymentProofLightbox.test.tsx`

---

## Pre-flight Tasks

### Task 0: Worktree setup

**Files:**
- N/A (git operation)

- [ ] **Step 1: Verify clean working tree**

Run: `git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 2: Create feature branch from main**

Run:
```bash
git checkout main && git pull
git checkout -b feat/sales-landing-funnel-2i
```

Expected: `Switched to a new branch 'feat/sales-landing-funnel-2i'`

- [ ] **Step 3: Verify Node + npm versions**

Run: `node -v && npm -v`
Expected: Node v20+ and npm v10+

- [ ] **Step 4: Install fresh deps**

Run: `npm ci`
Expected: completes with no errors

- [ ] **Step 5: Run existing test suite baseline**

Run: `npm test -- --run`
Expected: all existing tests pass (record count for comparison)

---

## Milestone A: Database Schema & RPCs

### Task A1: Migration — funnel stage columns

**Files:**
- Create: `supabase/migrations/20260618000001_funnel_stage_columns.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260618000001_funnel_stage_columns.sql`:

```sql
-- Add funnel stage columns to kasir_transactions
DO $$ BEGIN
  CREATE TYPE order_type_enum AS ENUM ('KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_method_enum AS ENUM ('PICKUP', 'DELIVERY', 'MARKETPLACE_COURIER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE kasir_transactions
  ADD COLUMN IF NOT EXISTS order_type order_type_enum NOT NULL DEFAULT 'KOMPONEN',
  ADD COLUMN IF NOT EXISTS funnel_stage smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS funnel_sub_stage text NOT NULL DEFAULT '1a',
  ADD COLUMN IF NOT EXISTS estimated_completion_days int NULL,
  ADD COLUMN IF NOT EXISTS estimated_completion_date date NULL,
  ADD COLUMN IF NOT EXISTS wip_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS delivery_method delivery_method_enum NOT NULL DEFAULT 'PICKUP',
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_kasir_funnel_sub_stage ON kasir_transactions(funnel_sub_stage);
CREATE INDEX IF NOT EXISTS idx_kasir_order_type ON kasir_transactions(order_type);
CREATE INDEX IF NOT EXISTS idx_kasir_funnel_stage_active ON kasir_transactions(funnel_stage) WHERE funnel_stage BETWEEN 1 AND 4;

COMMENT ON COLUMN kasir_transactions.funnel_sub_stage IS 'e.g. 2a, 2b, 3f, 4d — see stageMapping.ts';
COMMENT ON COLUMN kasir_transactions.version IS 'Optimistic locking: incremented on every update; clients pass expected version';
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db reset` (or equivalent CI-aware: `supabase migration up`)
Expected: migration applied without errors

- [ ] **Step 3: Verify columns exist**

Run: `npx supabase db query "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='kasir_transactions' AND column_name IN ('order_type', 'funnel_stage', 'funnel_sub_stage', 'version');"`
Expected: 4 rows printed with correct types

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618000001_funnel_stage_columns.sql
git commit -m "feat(db): add funnel_stage + order_type + version columns to kasir_transactions"
```

### Task A2: Migration — payment proof columns + storage bucket

**Files:**
- Create: `supabase/migrations/20260618000002_payment_proof_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE kasir_transactions
  ADD COLUMN IF NOT EXISTS pelunasan_proof_url text NULL,
  ADD COLUMN IF NOT EXISTS marketplace_proof_url text NULL,
  ADD COLUMN IF NOT EXISTS proof_source text NULL CHECK (proof_source IS NULL OR proof_source IN ('WA_CALISTA', 'ADMIN_UPLOAD', 'MARKETPLACE_SCREENSHOT')),
  ADD COLUMN IF NOT EXISTS proof_uploaded_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS proof_uploaded_by uuid NULL REFERENCES auth.users(id);

INSERT INTO storage.buckets (id, name, public) VALUES ('payment-proofs', 'payment-proofs', false)
  ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload + view
CREATE POLICY "Authenticated users can upload payment proofs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs');

CREATE POLICY "Authenticated users can view payment proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs');
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase migration up`
Expected: no errors

- [ ] **Step 3: Verify bucket exists**

Run: `npx supabase db query "SELECT id, public FROM storage.buckets WHERE id='payment-proofs';"`
Expected: 1 row with `public=f`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618000002_payment_proof_columns.sql
git commit -m "feat(db): add payment proof columns + payment-proofs storage bucket"
```

### Task A3: Migration — atomic stage transition RPC

**Files:**
- Create: `supabase/migrations/20260618000003_transition_order_stage_rpc.sql`

- [ ] **Step 1: Write the RPC**

```sql
CREATE OR REPLACE FUNCTION transition_order_stage(
  p_order_id text,
  p_from_sub_stage text,
  p_to_sub_stage text,
  p_expected_version int,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_version int;
  v_current_sub_stage text;
  v_new_stage smallint;
BEGIN
  SELECT version, funnel_sub_stage INTO v_current_version, v_current_sub_stage
  FROM kasir_transactions WHERE id = p_order_id
  FOR UPDATE;

  IF v_current_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF v_current_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'current_version', v_current_version);
  END IF;
  IF v_current_sub_stage != p_from_sub_stage THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STAGE_MISMATCH', 'current_sub_stage', v_current_sub_stage);
  END IF;

  v_new_stage := CAST(SUBSTRING(p_to_sub_stage FROM '^[0-9]+') AS smallint);

  UPDATE kasir_transactions
  SET funnel_sub_stage = p_to_sub_stage,
      funnel_stage = v_new_stage,
      version = version + 1,
      updated_at = NOW(),
      wip_started_at = CASE WHEN p_to_sub_stage IN ('3a', '3f') AND wip_started_at IS NULL THEN NOW() ELSE wip_started_at END
  WHERE id = p_order_id;

  INSERT INTO kasir_audit_logs(transaction_id, event_type, actor_user_id, payload)
  VALUES (
    p_order_id,
    'stage_transition',
    p_actor_user_id,
    jsonb_build_object('from_sub_stage', p_from_sub_stage, 'to_sub_stage', p_to_sub_stage, 'reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true, 'new_version', v_current_version + 1, 'new_sub_stage', p_to_sub_stage);
END;
$$;
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase migration up`
Expected: no errors

- [ ] **Step 3: Smoke-test RPC**

Run:
```bash
npx supabase db query "INSERT INTO kasir_transactions(id, version, funnel_sub_stage, funnel_stage, order_type, delivery_method) VALUES ('test-rpc-1', 1, '2a', 2, 'KOMPONEN', 'PICKUP') ON CONFLICT (id) DO UPDATE SET version=1, funnel_sub_stage='2a';"
npx supabase db query "SELECT transition_order_stage('test-rpc-1', '2a', '2b', 1, NULL, 'smoke test');"
```
Expected: `{"ok": true, "new_version": 2, "new_sub_stage": "2b"}`

- [ ] **Step 4: Cleanup test row**

Run: `npx supabase db query "DELETE FROM kasir_transactions WHERE id='test-rpc-1';"`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260618000003_transition_order_stage_rpc.sql
git commit -m "feat(db): atomic transition_order_stage RPC with optimistic lock + audit log"
```

### Task A4: Migration — sales dashboard stats RPC

**Files:**
- Create: `supabase/migrations/20260618000004_sales_stats_rpc.sql`

- [ ] **Step 1: Write the RPC**

```sql
CREATE OR REPLACE FUNCTION get_sales_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_urgent_count int;
  v_tunggu_count int;
  v_revenue_pending bigint;
  v_completed_this_month int;
  v_revenue_this_month bigint;
BEGIN
  SELECT COUNT(*) INTO v_urgent_count
  FROM kasir_transactions
  WHERE funnel_sub_stage IN ('2b', '2d', '3a', '3b', '3c', '3f', '3g', '4b', '4d');

  SELECT COUNT(*) INTO v_tunggu_count
  FROM kasir_transactions
  WHERE funnel_sub_stage IN ('1a', '2a', '2c', '2e', '3d', '3e', '3h', '4a');

  SELECT COALESCE(SUM(total), 0) INTO v_revenue_pending
  FROM kasir_transactions WHERE funnel_stage BETWEEN 1 AND 4;

  SELECT COUNT(*), COALESCE(SUM(total), 0) INTO v_completed_this_month, v_revenue_this_month
  FROM kasir_transactions
  WHERE funnel_stage = 5 AND created_at >= date_trunc('month', NOW());

  RETURN jsonb_build_object(
    'urgent_count', v_urgent_count,
    'tunggu_count', v_tunggu_count,
    'revenue_pending', v_revenue_pending,
    'completed_this_month', v_completed_this_month,
    'revenue_this_month', v_revenue_this_month
  );
END;
$$;
```

- [ ] **Step 2: Apply + smoke-test**

Run:
```bash
npx supabase migration up
npx supabase db query "SELECT get_sales_dashboard_stats();"
```
Expected: returns JSON with all 5 keys (zero values OK on empty DB)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260618000004_sales_stats_rpc.sql
git commit -m "feat(db): get_sales_dashboard_stats RPC for Sales landing"
```

### Task A5: Migration — backfill existing transactions

**Files:**
- Create: `supabase/migrations/20260618000005_backfill_funnel_stage.sql`

- [ ] **Step 1: Write backfill**

```sql
-- Map legacy status enum to new funnel_sub_stage
UPDATE kasir_transactions
SET
  funnel_sub_stage = CASE status
    WHEN 'WIP' THEN '3a'
    WHEN 'PENDING_LOCK_APPROVAL' THEN '3g'
    WHEN 'AWAITING_LUNAS' THEN '3d'
    WHEN 'LUNAS' THEN '5a'
    WHEN 'PAID' THEN '5a'
    WHEN 'COMPLETED' THEN '5a'
    WHEN 'CANCELLED' THEN '6a'
    WHEN 'INVOICE_TEMPO' THEN '3a'
    ELSE funnel_sub_stage
  END,
  funnel_stage = CASE status
    WHEN 'WIP' THEN 3
    WHEN 'PENDING_LOCK_APPROVAL' THEN 3
    WHEN 'AWAITING_LUNAS' THEN 3
    WHEN 'LUNAS' THEN 5
    WHEN 'PAID' THEN 5
    WHEN 'COMPLETED' THEN 5
    WHEN 'CANCELLED' THEN 6
    WHEN 'INVOICE_TEMPO' THEN 3
    ELSE funnel_stage
  END
WHERE funnel_stage = 1 AND funnel_sub_stage = '1a' AND status IS NOT NULL;
```

- [ ] **Step 2: Apply + verify count**

Run:
```bash
npx supabase migration up
npx supabase db query "SELECT funnel_sub_stage, COUNT(*) FROM kasir_transactions GROUP BY funnel_sub_stage;"
```
Expected: distribution looks reasonable for environment (or empty on fresh DB)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260618000005_backfill_funnel_stage.sql
git commit -m "feat(db): backfill funnel_stage from legacy status enum"
```

---

## Milestone B: TypeScript Types & Stage Mapping

### Task B1: Sales types module

**Files:**
- Create: `src/lib/sales/types.ts`
- Test: `src/lib/sales/__tests__/types.test.ts`

- [ ] **Step 1: Write the test**

Create `src/lib/sales/__tests__/types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { OrderType, FunnelStage, FunnelSubStage, Order } from '../types';

describe('Sales types', () => {
  it('OrderType is enum of 3', () => {
    expectTypeOf<OrderType>().toEqualTypeOf<'KOMPONEN' | 'CUSTOM_PANEL' | 'RAKIT_PANEL'>();
  });
  it('FunnelStage is 1-6', () => {
    expectTypeOf<FunnelStage>().toEqualTypeOf<1 | 2 | 3 | 4 | 5 | 6>();
  });
  it('Order has required fields', () => {
    const o: Order = {
      id: 'a', customer: 'C', total: 100, channel: 'WhatsApp',
      order_type: 'KOMPONEN', funnel_stage: 2, funnel_sub_stage: '2a',
      delivery_method: 'PICKUP', version: 1, payment_type: 'FULL',
      status_label: 's', time_ago: '5m', stuck: false,
    };
    expectTypeOf(o.id).toEqualTypeOf<string>();
  });
});
```

- [ ] **Step 2: Run test (expect type fail)**

Run: `npm test -- src/lib/sales/__tests__/types.test.ts --run`
Expected: FAIL — module not found

- [ ] **Step 3: Implement types**

Create `src/lib/sales/types.ts`:

```typescript
export type OrderType = 'KOMPONEN' | 'CUSTOM_PANEL' | 'RAKIT_PANEL';
export type FunnelStage = 1 | 2 | 3 | 4 | 5 | 6;
export type FunnelSubStage =
  | '1a'
  | '2a' | '2b' | '2c' | '2d' | '2e'
  | '3a' | '3b' | '3c' | '3d' | '3e' | '3f' | '3g' | '3h'
  | '4a' | '4b' | '4d'
  | '5a'
  | '6a' | '6b';
export type DeliveryMethod = 'PICKUP' | 'DELIVERY' | 'MARKETPLACE_COURIER';
export type PaymentType = 'FULL' | 'DP' | 'TEMPO';
export type ProofSource = 'WA_CALISTA' | 'ADMIN_UPLOAD' | 'MARKETPLACE_SCREENSHOT';

export interface Order {
  id: string;
  customer: string;
  total: number;
  channel: string;
  order_type: OrderType;
  funnel_stage: FunnelStage;
  funnel_sub_stage: FunnelSubStage;
  delivery_method: DeliveryMethod;
  version: number;
  payment_type: PaymentType;
  payment_proof_url?: string;
  pelunasan_proof_url?: string;
  marketplace_proof_url?: string;
  proof_source?: ProofSource;
  estimated_completion_days?: number;
  hari_progress?: number;
  status_label: string;
  time_ago: string;
  stuck: boolean;
  stage_label_override?: string;
}

export interface SalesDashboardStats {
  urgent_count: number;
  tunggu_count: number;
  revenue_pending: number;
  completed_this_month: number;
  revenue_this_month: number;
}
```

- [ ] **Step 4: Run test to pass**

Run: `npm test -- src/lib/sales/__tests__/types.test.ts --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/types.ts src/lib/sales/__tests__/types.test.ts
git commit -m "feat(sales): TypeScript types for orders + funnel stages"
```

### Task B2: typeTabConfig module

**Files:**
- Create: `src/lib/sales/typeTabConfig.ts`
- Test: `src/lib/sales/__tests__/typeTabConfig.test.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { TYPE_TAB_CFG, TypeTab, filterOrdersByTypeTab } from '../typeTabConfig';
import type { Order } from '../types';

describe('typeTabConfig', () => {
  const orders: Order[] = [
    { id: '1', order_type: 'KOMPONEN' } as Order,
    { id: '2', order_type: 'CUSTOM_PANEL' } as Order,
    { id: '3', order_type: 'RAKIT_PANEL' } as Order,
  ];
  it('komponen tab keeps KOMPONEN only', () => {
    expect(filterOrdersByTypeTab(orders, 'komponen').map(o => o.id)).toEqual(['1']);
  });
  it('workshop tab keeps CP + RP', () => {
    expect(filterOrdersByTypeTab(orders, 'workshop').map(o => o.id)).toEqual(['2', '3']);
  });
  it('all tab keeps all', () => {
    expect(filterOrdersByTypeTab(orders, 'all').map(o => o.id)).toEqual(['1', '2', '3']);
  });
  it('config has 3 tabs with hints', () => {
    expect(Object.keys(TYPE_TAB_CFG)).toEqual(['komponen', 'workshop', 'all']);
    expect(TYPE_TAB_CFG.komponen.hint.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- typeTabConfig --run`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `src/lib/sales/typeTabConfig.ts`:

```typescript
import type { Order, OrderType, FunnelSubStage } from './types';

export type TypeTab = 'komponen' | 'workshop' | 'all';

interface TabConfig {
  label: string;
  hint: string;
  orderTypes: OrderType[] | null;
}

export const TYPE_TAB_CFG: Record<TypeTab, TabConfig> = {
  komponen: {
    label: '📦 Komponen',
    hint: 'Fast turnover · daily ops · pick from stock → ship/pickup',
    orderTypes: ['KOMPONEN'],
  },
  workshop: {
    label: '🛠️ Workshop',
    hint: 'Multi-day projects · custom panel & rakit panel · owner cost approval',
    orderTypes: ['CUSTOM_PANEL', 'RAKIT_PANEL'],
  },
  all: {
    label: 'Semua',
    hint: 'Lihat semua tipe digabung (escape valve · pakai kalau perlu)',
    orderTypes: null,
  },
};

export function filterOrdersByTypeTab(orders: Order[], tab: TypeTab): Order[] {
  const types = TYPE_TAB_CFG[tab].orderTypes;
  if (types === null) return orders;
  return orders.filter(o => types.includes(o.order_type));
}

export function subStageBelongsToTab(subStage: FunnelSubStage, tab: TypeTab): boolean {
  if (tab === 'all') return true;
  const komponenOnly: FunnelSubStage[] = ['3a', '3d'];
  const workshopOnly: FunnelSubStage[] = ['3f', '3g', '3h'];
  if (tab === 'komponen') return !workshopOnly.includes(subStage);
  if (tab === 'workshop') return !komponenOnly.includes(subStage);
  return true;
}
```

- [ ] **Step 4: Run (pass)**

Run: `npm test -- typeTabConfig --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/typeTabConfig.ts src/lib/sales/__tests__/typeTabConfig.test.ts
git commit -m "feat(sales): type tab config + filter helpers"
```

### Task B3: stageMapping module

**Files:**
- Create: `src/lib/sales/stageMapping.ts`
- Test: `src/lib/sales/__tests__/stageMapping.test.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { getSubStageMeta, SUB_STAGES, isUrgentSubStage } from '../stageMapping';

describe('stageMapping', () => {
  it('SUB_STAGES has 22 entries', () => {
    expect(SUB_STAGES.length).toBe(22);
  });
  it('getSubStageMeta returns urgent for 2b', () => {
    expect(getSubStageMeta('2b').actionType).toBe('urgent');
  });
  it('getSubStageMeta returns passive for 2c', () => {
    expect(getSubStageMeta('2c').actionType).toBe('passive');
  });
  it('3f belongs to CP/RP only', () => {
    expect(getSubStageMeta('3f').forTypes).toEqual(['CUSTOM_PANEL', 'RAKIT_PANEL']);
  });
  it('isUrgentSubStage works', () => {
    expect(isUrgentSubStage('2b')).toBe(true);
    expect(isUrgentSubStage('1a')).toBe(false);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- stageMapping --run`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `src/lib/sales/stageMapping.ts`:

```typescript
import type { FunnelSubStage, FunnelStage, OrderType } from './types';

export interface SubStageMeta {
  id: FunnelSubStage;
  stage: FunnelStage;
  name: string;
  icon: string;
  actionType: 'urgent' | 'passive';
  nextLabel: string;
  forTypes: OrderType[];
}

export const SUB_STAGES: SubStageMeta[] = [
  { id: '1a', stage: 1, name: 'Sedang Chat AI', icon: '💬', actionType: 'passive', nextLabel: 'AI handle · admin tidak perlu action', forTypes: ['KOMPONEN'] },
  { id: '2a', stage: 2, name: 'Tunggu Konfirmasi Customer', icon: '📩', actionType: 'passive', nextLabel: 'Tunggu customer balas Setuju', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '2b', stage: 2, name: 'Perlu Disetujui Admin', icon: '⚠️', actionType: 'urgent', nextLabel: 'Cek items + set ongkir + payment type', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '2c', stage: 2, name: 'Tunggu Customer Bayar', icon: '⏳', actionType: 'passive', nextLabel: 'SO terkirim · tunggu transfer', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '2d', stage: 2, name: 'Perlu Cek Bukti Transfer', icon: '⚡', actionType: 'urgent', nextLabel: 'Customer baru upload bukti · cek di sini', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '2e', stage: 2, name: 'Ditolak', icon: '❌', actionType: 'passive', nextLabel: 'Tunggu customer upload ulang atau pilih alternatif', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3a', stage: 3, name: 'Sedang Siapkan Barang', icon: '🔧', actionType: 'urgent', nextLabel: 'Kerjakan barang fisik di gudang', forTypes: ['KOMPONEN'] },
  { id: '3b', stage: 3, name: 'Perlu Cek Bukti Pelunasan', icon: '⚡', actionType: 'urgent', nextLabel: 'Customer baru bayar pelunasan · cek bukti', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3c', stage: 3, name: 'Barang Siap, Lanjut Kirim/Ambil', icon: '✓', actionType: 'urgent', nextLabel: 'Klik Barang Siap untuk lanjut pengiriman', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3d', stage: 3, name: 'DP done · Tunggu Pelunasan', icon: '💛', actionType: 'passive', nextLabel: 'Tunggu customer lunasi · bisa kirim reminder', forTypes: ['KOMPONEN'] },
  { id: '3e', stage: 3, name: 'Bukti Pelunasan Ditolak', icon: '❌', actionType: 'passive', nextLabel: 'Bukti baru ditolak · tunggu upload ulang', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3f', stage: 3, name: 'Sedang Dirakit / Fabrikasi', icon: '🛠️', actionType: 'urgent', nextLabel: 'Multi-hari · teknisi kerja · pantau progress', forTypes: ['CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3g', stage: 3, name: 'Tunggu Owner Cek Biaya Final', icon: '🔒', actionType: 'urgent', nextLabel: 'Admin submit biaya · owner review di Persetujuan', forTypes: ['CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3h', stage: 3, name: 'Biaya Final OK · Tunggu Pelunasan', icon: '💛', actionType: 'passive', nextLabel: 'Invoice pelunasan akurat sudah dikirim · tunggu transfer', forTypes: ['CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '4a', stage: 4, name: 'Sedang Dikirim', icon: '🚚', actionType: 'passive', nextLabel: 'Pantau · tracking sudah dikirim ke customer', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '4b', stage: 4, name: 'Siap Diambil di Toko', icon: '🏪', actionType: 'urgent', nextLabel: 'Saat customer datang, klik Sudah Diterima', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '4d', stage: 4, name: 'Ada Masalah Pengiriman', icon: '🆘', actionType: 'urgent', nextLabel: 'Hubungi customer + kurir · resolve', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '5a', stage: 5, name: 'Semua Pesanan Selesai', icon: '✓', actionType: 'passive', nextLabel: 'Selesai · download dokumen kapan saja', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '6a', stage: 6, name: 'Dibatalkan Customer', icon: '✗', actionType: 'passive', nextLabel: 'Customer batal · history', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '6b', stage: 6, name: 'Bukti Pembayaran Ditolak Final', icon: '✗', actionType: 'passive', nextLabel: 'Admin reject final · history', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
];

export const STAGE_NAMES: Record<FunnelStage, { icon: string; name: string }> = {
  1: { icon: '💬', name: 'Bertanya' },
  2: { icon: '💰', name: 'Konfirmasi & Belum Bayar' },
  3: { icon: '📦', name: 'Diproses' },
  4: { icon: '🚚', name: 'Dikirim / Siap Diambil' },
  5: { icon: '✓', name: 'Diterima' },
  6: { icon: '✗', name: 'Dibatalkan' },
};

export function getSubStageMeta(id: FunnelSubStage): SubStageMeta {
  const meta = SUB_STAGES.find(s => s.id === id);
  if (!meta) throw new Error(`Unknown sub-stage: ${id}`);
  return meta;
}

export function isUrgentSubStage(id: FunnelSubStage): boolean {
  return getSubStageMeta(id).actionType === 'urgent';
}

export function getSubStagesForStage(stage: FunnelStage): SubStageMeta[] {
  return SUB_STAGES.filter(s => s.stage === stage);
}
```

Note count: 1 + 5 + 8 + 3 + 1 + 2 = 20 (not 22). Fix test:

- [ ] **Step 4: Fix test expectation**

Update test:
```typescript
expect(SUB_STAGES.length).toBe(20);
```

- [ ] **Step 5: Run (pass)**

Run: `npm test -- stageMapping --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/stageMapping.ts src/lib/sales/__tests__/stageMapping.test.ts
git commit -m "feat(sales): stage + sub-stage metadata mapping"
```

### Task B4: quickActionMap module

**Files:**
- Create: `src/lib/sales/quickActionMap.ts`
- Test: `src/lib/sales/__tests__/quickActionMap.test.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { getQuickAction } from '../quickActionMap';
import type { Order } from '../types';

const baseOrder: Partial<Order> = {
  id: 'x', version: 1, order_type: 'KOMPONEN', delivery_method: 'PICKUP',
};

describe('quickActionMap', () => {
  it('2b returns Setujui targeting 2c', () => {
    const a = getQuickAction({ ...baseOrder, funnel_sub_stage: '2b' } as Order);
    expect(a?.label).toBe('Setujui');
    expect(a?.toSubStage).toBe('2c');
  });
  it('2d returns Verify targeting 3a', () => {
    expect(getQuickAction({ ...baseOrder, funnel_sub_stage: '2d' } as Order)?.toSubStage).toBe('3a');
  });
  it('3a komponen pickup returns Siap targeting 4b', () => {
    expect(getQuickAction({ ...baseOrder, funnel_sub_stage: '3a' } as Order)?.toSubStage).toBe('4b');
  });
  it('3a delivery returns Siap targeting 4a', () => {
    expect(getQuickAction({ ...baseOrder, funnel_sub_stage: '3a', delivery_method: 'DELIVERY' } as Order)?.toSubStage).toBe('4a');
  });
  it('5a returns null (no action)', () => {
    expect(getQuickAction({ ...baseOrder, funnel_sub_stage: '5a' } as Order)).toBeNull();
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- quickActionMap --run`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `src/lib/sales/quickActionMap.ts`:

```typescript
import type { Order, FunnelSubStage } from './types';

export interface QuickAction {
  label: string;
  toSubStage: FunnelSubStage;
  requiresProof?: boolean;
}

export function getQuickAction(order: Order): QuickAction | null {
  switch (order.funnel_sub_stage) {
    case '2b': return { label: 'Setujui', toSubStage: '2c' };
    case '2c': return { label: 'Reminder', toSubStage: '2c' };
    case '2d': return { label: 'Verify', toSubStage: '3a', requiresProof: true };
    case '3a': {
      const target: FunnelSubStage = order.delivery_method === 'PICKUP' ? '4b' : '4a';
      return { label: 'Siap', toSubStage: target };
    }
    case '3b': return { label: 'Verify Pelunasan', toSubStage: '3c', requiresProof: true };
    case '3c': {
      const target: FunnelSubStage = order.delivery_method === 'PICKUP' ? '4b' : '4a';
      return { label: 'Siap', toSubStage: target };
    }
    case '3d': return { label: 'Reminder', toSubStage: '3d' };
    case '3f': return { label: 'Selesai', toSubStage: '3g' };
    case '3g': return { label: 'Persetujuan', toSubStage: '3g' };
    case '3h': return { label: 'Reminder', toSubStage: '3h' };
    case '4a': return { label: 'Diterima', toSubStage: '5a' };
    case '4b': return { label: 'Diterima', toSubStage: '5a' };
    default: return null;
  }
}
```

- [ ] **Step 4: Run (pass)**

Run: `npm test -- quickActionMap --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/quickActionMap.ts src/lib/sales/__tests__/quickActionMap.test.ts
git commit -m "feat(sales): quickActionMap for inline pill buttons"
```

### Task B5: queries module — fetch orders + stats

**Files:**
- Create: `src/lib/sales/queries.ts`
- Test: `src/lib/sales/__tests__/queries.test.ts` (with mocked Supabase)

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchActiveOrders, fetchDashboardStats } from '../queries';

vi.mock('../../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [{ id: '1', customer: 'X' }], error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: { urgent_count: 4, tunggu_count: 8, revenue_pending: 1000000, completed_this_month: 142, revenue_this_month: 54000000 }, error: null }),
  },
}));

describe('queries', () => {
  it('fetchActiveOrders calls supabase.from', async () => {
    const orders = await fetchActiveOrders();
    expect(orders.length).toBe(1);
  });
  it('fetchDashboardStats returns stats', async () => {
    const s = await fetchDashboardStats();
    expect(s.urgent_count).toBe(4);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- queries --run`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `src/lib/sales/queries.ts`:

```typescript
import { supabase } from '../supabaseClient';
import type { Order, SalesDashboardStats } from './types';

export async function fetchActiveOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('kasir_transactions')
    .select('*')
    .in('funnel_stage', [1, 2, 3, 4])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Order[];
}

export async function fetchArchiveOrders(stage: 5 | 6, limit: number = 5): Promise<Order[]> {
  const { data, error } = await supabase
    .from('kasir_transactions')
    .select('*')
    .eq('funnel_stage', stage)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Order[];
}

export async function fetchDashboardStats(): Promise<SalesDashboardStats> {
  const { data, error } = await supabase.rpc('get_sales_dashboard_stats');
  if (error) throw error;
  return data as SalesDashboardStats;
}

export function subscribeOrders(callback: (order: Order) => void) {
  return supabase
    .channel('kasir-orders-funnel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kasir_transactions' }, (payload) => {
      callback(payload.new as Order);
    })
    .subscribe();
}
```

- [ ] **Step 4: Run (pass)**

Run: `npm test -- queries --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/queries.ts src/lib/sales/__tests__/queries.test.ts
git commit -m "feat(sales): fetch + realtime subscribe queries"
```

### Task B6: mutations module — transition + upload

**Files:**
- Create: `src/lib/sales/mutations.ts`
- Test: `src/lib/sales/__tests__/mutations.test.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { transitionOrder } from '../mutations';

vi.mock('../../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: { ok: true, new_version: 2, new_sub_stage: '2c' }, error: null }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

describe('mutations', () => {
  it('transitionOrder returns success result', async () => {
    const r = await transitionOrder({ id: 'o1', fromSubStage: '2b', toSubStage: '2c', expectedVersion: 1 });
    expect(r.ok).toBe(true);
    expect(r.newVersion).toBe(2);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- mutations --run`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `src/lib/sales/mutations.ts`:

```typescript
import { supabase } from '../supabaseClient';
import type { FunnelSubStage, ProofSource } from './types';

export interface TransitionResult {
  ok: boolean;
  code?: 'STALE_VERSION' | 'STAGE_MISMATCH' | 'NOT_FOUND';
  newVersion?: number;
  newSubStage?: FunnelSubStage;
  currentVersion?: number;
  currentSubStage?: FunnelSubStage;
}

export async function transitionOrder(params: {
  id: string;
  fromSubStage: FunnelSubStage;
  toSubStage: FunnelSubStage;
  expectedVersion: number;
  reason?: string;
}): Promise<TransitionResult> {
  const { data: userResp } = await supabase.auth.getUser();
  const actorId = userResp.user?.id ?? null;
  const { data, error } = await supabase.rpc('transition_order_stage', {
    p_order_id: params.id,
    p_from_sub_stage: params.fromSubStage,
    p_to_sub_stage: params.toSubStage,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: actorId,
    p_reason: params.reason ?? null,
  });
  if (error) throw error;
  return {
    ok: data.ok,
    code: data.code,
    newVersion: data.new_version,
    newSubStage: data.new_sub_stage,
    currentVersion: data.current_version,
    currentSubStage: data.current_sub_stage,
  };
}

export async function uploadPaymentProof(params: {
  orderId: string;
  file: File;
  source: ProofSource;
  field: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url';
}): Promise<string> {
  const filename = `${params.orderId}/${Date.now()}-${params.file.name}`;
  const { error: upErr } = await supabase.storage.from('payment-proofs').upload(filename, params.file);
  if (upErr) throw upErr;
  const { data: { publicUrl } } = supabase.storage.from('payment-proofs').getPublicUrl(filename);
  const { data: userResp } = await supabase.auth.getUser();
  const { error: updErr } = await supabase
    .from('kasir_transactions')
    .update({
      [params.field]: publicUrl,
      proof_source: params.source,
      proof_uploaded_at: new Date().toISOString(),
      proof_uploaded_by: userResp.user?.id ?? null,
    })
    .eq('id', params.orderId);
  if (updErr) throw updErr;
  return publicUrl;
}
```

- [ ] **Step 4: Run (pass)**

Run: `npm test -- mutations --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/mutations.ts src/lib/sales/__tests__/mutations.test.ts
git commit -m "feat(sales): transitionOrder + uploadPaymentProof mutations"
```

---

## Milestone C: Section 1 Sales Landing Components

### Task C1: StatsCards component

**Files:**
- Create: `src/components/sales/StatsCards.tsx`
- Test: `src/components/sales/__tests__/StatsCards.test.tsx`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsCards } from '../StatsCards';

describe('StatsCards', () => {
  it('renders 4 cards with values', () => {
    render(<StatsCards stats={{
      urgent_count: 4, tunggu_count: 8,
      revenue_pending: 18700000, completed_this_month: 142, revenue_this_month: 54000000,
    }} />);
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText(/Rp 18,7M|Rp 18.7M/)).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- StatsCards --run`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `src/components/sales/StatsCards.tsx`:

```tsx
import type { SalesDashboardStats } from '../../lib/sales/types';

interface Props { stats: SalesDashboardStats; }

function formatJuta(n: number): string {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`;
  return `Rp ${n}`;
}

export function StatsCards({ stats }: Props) {
  return (
    <div className="grid grid-cols-4 gap-3 mb-5">
      <div style={{ background: 'white', border: '1px solid #fde68a', borderRadius: 16, padding: '14px 16px', boxShadow: '0 2px 8px rgba(146,64,14,0.06)' }}>
        <div style={{ fontSize: 10, color: '#92400e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>⚡ Perlu Kerjakan</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#012749', marginTop: 2, lineHeight: 1, letterSpacing: '-0.02em' }}>{stats.urgent_count}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>pesanan urgent</div>
      </div>
      <div style={{ background: 'white', border: '1px solid #c7d7f5', borderRadius: 16, padding: '14px 16px', boxShadow: '0 2px 8px rgba(1,39,73,0.06)' }}>
        <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>⏳ Tunggu Customer</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#012749', marginTop: 2, lineHeight: 1, letterSpacing: '-0.02em' }}>{stats.tunggu_count}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>aktif passive</div>
      </div>
      <div style={{ background: 'white', border: '1px solid #c7d7f5', borderRadius: 16, padding: '14px 16px', boxShadow: '0 2px 8px rgba(1,39,73,0.06)' }}>
        <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>💰 Revenue Pending</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#2d8a4e', marginTop: 4, lineHeight: 1, fontFamily: 'ui-monospace,monospace', letterSpacing: '-0.02em' }}>{formatJuta(stats.revenue_pending)}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>belum dilunasi</div>
      </div>
      <div style={{ background: 'white', border: '1px solid #bbf7d0', borderRadius: 16, padding: '14px 16px', boxShadow: '0 2px 8px rgba(22,101,52,0.06)' }}>
        <div style={{ fontSize: 10, color: '#166534', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>✓ Selesai Bulan Ini</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#012749', marginTop: 2, lineHeight: 1, letterSpacing: '-0.02em' }}>{stats.completed_this_month}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>{formatJuta(stats.revenue_this_month)} total</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run (pass)**

Run: `npm test -- StatsCards --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/StatsCards.tsx src/components/sales/__tests__/StatsCards.test.tsx
git commit -m "feat(sales): StatsCards component for landing dashboard"
```

### Task C2: SalesTabStrip + UrgentOrdersPreview + SalesLandingScreen

**Files:**
- Create: `src/components/sales/SalesTabStrip.tsx`
- Create: `src/components/sales/UrgentOrdersPreview.tsx`
- Create: `src/components/sales/SalesLandingScreen.tsx`
- Test: `src/components/sales/__tests__/SalesLandingScreen.test.tsx`

- [ ] **Step 1: Write test for landing**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SalesLandingScreen } from '../SalesLandingScreen';

vi.mock('../../../lib/sales/queries', () => ({
  fetchDashboardStats: vi.fn().mockResolvedValue({ urgent_count: 4, tunggu_count: 8, revenue_pending: 1, completed_this_month: 142, revenue_this_month: 1 }),
  fetchActiveOrders: vi.fn().mockResolvedValue([]),
}));

describe('SalesLandingScreen', () => {
  it('renders heading + stats + tabs', async () => {
    render(<MemoryRouter><SalesLandingScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: /Sales/i })).toBeInTheDocument();
    expect(await screen.findByText('142')).toBeInTheDocument();
    expect(screen.getByText(/Catat Penjualan/i)).toBeInTheDocument();
    expect(screen.getByText(/Daftar Pesanan/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- SalesLandingScreen --run`
Expected: FAIL

- [ ] **Step 3: Implement SalesTabStrip**

Create `src/components/sales/SalesTabStrip.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';

interface Props { activeCount: number; }

export function SalesTabStrip({ activeCount }: Props) {
  const nav = useNavigate();
  return (
    <div className="flex items-end gap-1 border-b border-[#e5eeff] mb-5">
      <button onClick={() => nav('/sales/catat')} className="px-5 py-3 text-sm font-bold transition flex items-center gap-2" style={{ color: '#6b7280', borderBottom: '3px solid transparent' }}>
        📝 Catat Penjualan
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>→ wizard</span>
      </button>
      <button onClick={() => nav('/sales/daftar')} className="px-5 py-3 text-sm font-bold transition flex items-center gap-2" style={{ color: '#012749', borderBottom: '3px solid #012749' }}>
        📦 Daftar Pesanan
        <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, border: '1px solid #fde68a' }}>{activeCount} aktif</span>
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>→ funnel</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Implement UrgentOrdersPreview**

Create `src/components/sales/UrgentOrdersPreview.tsx`:

```tsx
import type { Order } from '../../lib/sales/types';
import { getSubStageMeta } from '../../lib/sales/stageMapping';
import { useNavigate } from 'react-router-dom';

interface Props { orders: Order[]; }

export function UrgentOrdersPreview({ orders }: Props) {
  const nav = useNavigate();
  const urgent = orders.filter(o => getSubStageMeta(o.funnel_sub_stage).actionType === 'urgent').slice(0, 3);
  return (
    <div style={{ background: 'white', border: '1px solid #e5eeff', borderRadius: 20, boxShadow: '0 2px 12px rgba(1,39,73,0.06)', overflow: 'hidden' }}>
      <div style={{ background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', padding: '12px 20px', borderBottom: '1px solid #fde68a', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>⚡ Perlu Kerjakan Sekarang · {urgent.length}</span>
        <button onClick={() => nav('/sales/daftar')} style={{ marginLeft: 'auto', fontSize: 12, color: '#012749', fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer' }}>Lihat semua →</button>
      </div>
      {urgent.map(o => (
        <div key={o.id} style={{ padding: '14px 20px', borderBottom: '1px solid #e5eeff', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: '#012749', fontSize: 14 }}>{o.customer}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{o.channel} · {getSubStageMeta(o.funnel_sub_stage).name}</div>
          </div>
          <div style={{ fontSize: 13, color: '#2d8a4e', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>Rp {o.total.toLocaleString('id-ID')}</div>
        </div>
      ))}
      {urgent.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>🎉 Semua sudah dikerjakan!</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement SalesLandingScreen**

Create `src/components/sales/SalesLandingScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchDashboardStats, fetchActiveOrders } from '../../lib/sales/queries';
import type { SalesDashboardStats, Order } from '../../lib/sales/types';
import { StatsCards } from './StatsCards';
import { SalesTabStrip } from './SalesTabStrip';
import { UrgentOrdersPreview } from './UrgentOrdersPreview';

export function SalesLandingScreen() {
  const [stats, setStats] = useState<SalesDashboardStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    fetchDashboardStats().then(setStats);
    fetchActiveOrders().then(setOrders);
  }, []);
  if (!stats) return <div className="p-8 text-gray-500">Loading…</div>;
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Operasional</div>
          <h1 className="text-3xl font-bold text-[#012749]" style={{ letterSpacing: '-0.02em' }}>Sales</h1>
          <p className="text-sm text-gray-600 mt-1">{today}</p>
        </div>
      </div>
      <StatsCards stats={stats} />
      <SalesTabStrip activeCount={orders.length} />
      <UrgentOrdersPreview orders={orders} />
    </div>
  );
}
```

- [ ] **Step 6: Run (pass)**

Run: `npm test -- SalesLandingScreen --run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/sales/SalesTabStrip.tsx src/components/sales/UrgentOrdersPreview.tsx src/components/sales/SalesLandingScreen.tsx src/components/sales/__tests__/SalesLandingScreen.test.tsx
git commit -m "feat(sales): SalesLandingScreen with stats + tabs + urgent preview"
```

---

## Milestone D: Section 2-I Daftar Pesanan Components

### Task D1: TypeTabs component

**Files:**
- Create: `src/components/sales/TypeTabs.tsx`
- Test: `src/components/sales/__tests__/TypeTabs.test.tsx`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TypeTabs } from '../TypeTabs';

describe('TypeTabs', () => {
  it('renders 3 tabs and calls onChange', () => {
    const onChange = vi.fn();
    render(<TypeTabs active="komponen" onChange={onChange} counts={{ komponen: 10, workshop: 5, all: 17 }} />);
    expect(screen.getByText(/📦 Komponen/)).toBeInTheDocument();
    expect(screen.getByText(/🛠️ Workshop/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Workshop/));
    expect(onChange).toHaveBeenCalledWith('workshop');
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- TypeTabs --run`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `src/components/sales/TypeTabs.tsx`:

```tsx
import { TYPE_TAB_CFG, type TypeTab } from '../../lib/sales/typeTabConfig';

interface Props {
  active: TypeTab;
  counts: Record<TypeTab, number>;
  onChange: (tab: TypeTab) => void;
}

export function TypeTabs({ active, counts, onChange }: Props) {
  return (
    <div style={{ background: 'linear-gradient(180deg, #ffffff 0%, #fafbff 100%)', padding: '20px 24px 0', borderBottom: '1px solid #e5eeff' }}>
      <div style={{ display: 'flex', gap: 32 }}>
        {(Object.entries(TYPE_TAB_CFG) as [TypeTab, typeof TYPE_TAB_CFG[TypeTab]][]).map(([key, cfg]) => {
          const isSel = key === active;
          return (
            <button key={key} onClick={() => onChange(key)} style={{
              background: 'transparent', padding: '10px 0 14px', fontSize: 15, cursor: 'pointer',
              color: isSel ? '#012749' : '#6b7280',
              fontWeight: isSel ? 700 : 600,
              borderBottom: isSel ? '3px solid #012749' : '3px solid transparent',
            }}>
              {cfg.label}
              <span style={{ fontSize: 12, color: isSel ? '#2d8a4e' : '#9ca3af', fontWeight: 700, marginLeft: 4 }}>· {counts[key]}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', padding: '8px 0 16px', minHeight: 30, fontStyle: 'italic' }}>{TYPE_TAB_CFG[active].hint}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run (pass)**

Run: `npm test -- TypeTabs --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/TypeTabs.tsx src/components/sales/__tests__/TypeTabs.test.tsx
git commit -m "feat(sales): TypeTabs primary navigation"
```

### Task D2: StageStrip component

**Files:**
- Create: `src/components/sales/StageStrip.tsx`
- Test: `src/components/sales/__tests__/StageStrip.test.tsx`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StageStrip } from '../StageStrip';

describe('StageStrip', () => {
  it('renders 6 stages with counts and triggers onChange', () => {
    const onChange = vi.fn();
    render(<StageStrip active={2} counts={{ 1: 3, 2: 7, 3: 10, 4: 3, 5: 142, 6: 5 }} onChange={onChange} />);
    expect(screen.getByText(/Bertanya/)).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Diproses/));
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- StageStrip --run`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `src/components/sales/StageStrip.tsx`:

```tsx
import { STAGE_NAMES } from '../../lib/sales/stageMapping';
import type { FunnelStage } from '../../lib/sales/types';

interface Props {
  active: FunnelStage;
  counts: Record<FunnelStage, number>;
  onChange: (stage: FunnelStage) => void;
}

export function StageStrip({ active, counts, onChange }: Props) {
  return (
    <div style={{ background: 'white', borderBottom: '1px solid #e5eeff', display: 'flex', gap: 6, padding: '14px 24px', overflowX: 'auto' }}>
      {([1, 2, 3, 4, 5, 6] as FunnelStage[]).map(n => {
        const count = counts[n] ?? 0;
        const isSel = n === active;
        return (
          <button key={n} onClick={() => onChange(n)} disabled={count === 0 && !isSel} style={{
            background: isSel ? '#012749' : 'white',
            color: isSel ? 'white' : (count > 0 ? '#012749' : '#9ca3af'),
            border: `1px solid ${isSel ? '#012749' : (count > 0 ? '#c7d7f5' : '#e5e7eb')}`,
            boxShadow: isSel ? '0 2px 8px rgba(1,39,73,0.2)' : 'none',
            opacity: count === 0 && !isSel ? 0.55 : 1,
            borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 700,
            whiteSpace: 'nowrap', cursor: count > 0 ? 'pointer' : 'default',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 14 }}>{STAGE_NAMES[n].icon}</span>
            <span>{n}. {STAGE_NAMES[n].name}</span>
            <span style={{
              background: isSel ? 'rgba(255,255,255,0.2)' : '#eff4ff',
              color: isSel ? 'white' : '#012749',
              padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 700,
            }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run (pass)**

Run: `npm test -- StageStrip --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/StageStrip.tsx src/components/sales/__tests__/StageStrip.test.tsx
git commit -m "feat(sales): StageStrip 6-stage horizontal pills"
```

### Task D3: OrderRow component

**Files:**
- Create: `src/components/sales/OrderRow.tsx`
- Create: `src/components/sales/QuickActionPill.tsx`
- Test: `src/components/sales/__tests__/OrderRow.test.tsx`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderRow } from '../OrderRow';
import type { Order } from '../../../lib/sales/types';

const order: Order = {
  id: 'abc123', customer: 'Jenny Setiawan', total: 380000, channel: 'WhatsApp',
  order_type: 'KOMPONEN', funnel_stage: 2, funnel_sub_stage: '2d',
  delivery_method: 'PICKUP', version: 1, payment_type: 'FULL',
  status_label: 'Bukti baru diupload', time_ago: '5 menit lalu', stuck: false,
};

describe('OrderRow', () => {
  it('renders customer + total + quick action', () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    render(<OrderRow order={order} expanded={false} typeTab="komponen" onToggle={onToggle} onQuickAction={onAction} />);
    expect(screen.getByText('Jenny Setiawan')).toBeInTheDocument();
    expect(screen.getByText('#abc123')).toBeInTheDocument();
    expect(screen.getByText(/Verify/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Verify/i));
    expect(onAction).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- OrderRow --run`
Expected: FAIL

- [ ] **Step 3: Implement QuickActionPill**

Create `src/components/sales/QuickActionPill.tsx`:

```tsx
interface Props { label: string; onClick: () => void; }

export function QuickActionPill({ label, onClick }: Props) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={{
      color: 'white', background: '#012749', fontSize: 12, fontWeight: 700,
      padding: '5px 12px', borderRadius: 999, border: 'none',
      boxShadow: '0 1px 3px rgba(1,39,73,0.2)', cursor: 'pointer',
    }}>{label}</button>
  );
}
```

- [ ] **Step 4: Implement OrderRow**

Create `src/components/sales/OrderRow.tsx`:

```tsx
import type { Order } from '../../lib/sales/types';
import type { TypeTab } from '../../lib/sales/typeTabConfig';
import { getQuickAction } from '../../lib/sales/quickActionMap';
import { QuickActionPill } from './QuickActionPill';

interface Props {
  order: Order;
  expanded: boolean;
  typeTab: TypeTab;
  onToggle: () => void;
  onQuickAction: (label: string, toSubStage: string) => void;
}

const CHANNEL_DISPLAY: Record<string, { icon: string; label: string }> = {
  WhatsApp: { icon: '📱', label: 'WA' },
  'Walk-in': { icon: '🏪', label: 'Walk-in' },
  Grosir: { icon: '📦', label: 'Grosir' },
  Tokopedia: { icon: '🛒', label: 'Tokopedia' },
  Shopee: { icon: '🛒', label: 'Shopee' },
};

function shortPaymentType(pt: string): string {
  const lower = pt.toLowerCase();
  if (lower.includes('lunas')) return 'Lunas';
  if (lower.includes('tempo')) return 'Tempo';
  if (lower.includes('dp')) {
    const match = pt.match(/(\d+)%/);
    return match ? `DP ${match[1]}%` : 'DP';
  }
  return pt.slice(0, 14);
}

export function OrderRow({ order, expanded, typeTab, onToggle, onQuickAction }: Props) {
  const action = getQuickAction(order);
  const ch = CHANNEL_DISPLAY[order.channel] ?? { icon: '📱', label: order.channel };
  const payment = shortPaymentType(order.payment_type);
  const showTypeBadge = typeTab === 'all';
  const typeLabel = order.order_type === 'CUSTOM_PANEL' ? 'Custom Panel' : order.order_type === 'RAKIT_PANEL' ? 'Rakit Panel' : 'Komponen';

  return (
    <div style={{ background: 'white', borderBottom: '1px solid #e5eeff' }}>
      <div onClick={onToggle} style={{ padding: '14px 24px 14px 60px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: '#012749', fontSize: 14 }}>{order.customer}</span>
              <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, color: '#9ca3af', marginLeft: 8 }}>#{order.id}</span>
              {showTypeBadge && (
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: '#eff4ff', color: '#012749', fontWeight: 600, marginLeft: 8, border: '1px solid #c7d7f5' }}>{typeLabel}</span>
              )}
              {order.stuck && (
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#fee2e2', color: '#b91c1c', fontWeight: 700, marginLeft: 8, border: '1px solid #fecaca' }}>stuck</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{ch.icon} {ch.label}</span>
              <span style={{ color: '#9ca3af' }}>·</span>
              <span style={{ background: '#eff4ff', color: '#012749', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: '1px solid #c7d7f5' }}>{payment}</span>
              <span style={{ color: '#9ca3af' }}>·</span>
              <span>{order.status_label}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: '#2d8a4e', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>Rp {order.total.toLocaleString('id-ID')}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{order.time_ago}</div>
          </div>
          {action && (
            <QuickActionPill label={action.label} onClick={() => onQuickAction(action.label, action.toSubStage)} />
          )}
          <span style={{ color: '#c7d7f5', fontSize: 12 }}>{expanded ? '▾' : '›'}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run (pass)**

Run: `npm test -- OrderRow --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/OrderRow.tsx src/components/sales/QuickActionPill.tsx src/components/sales/__tests__/OrderRow.test.tsx
git commit -m "feat(sales): OrderRow + QuickActionPill"
```

### Task D4: SubStageSection + DaftarPesananScreen skeleton

**Files:**
- Create: `src/components/sales/SubStageSection.tsx`
- Create: `src/components/sales/DaftarPesananScreen.tsx`
- Test: `src/components/sales/__tests__/DaftarPesananScreen.test.tsx`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DaftarPesananScreen } from '../DaftarPesananScreen';

vi.mock('../../../lib/sales/queries', () => ({
  fetchActiveOrders: vi.fn().mockResolvedValue([
    { id: 'o1', customer: 'X', total: 100, channel: 'WhatsApp', order_type: 'KOMPONEN', funnel_stage: 2, funnel_sub_stage: '2b', delivery_method: 'PICKUP', version: 1, payment_type: 'FULL', status_label: 's', time_ago: '5m', stuck: false }
  ]),
  fetchArchiveOrders: vi.fn().mockResolvedValue([]),
  subscribeOrders: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
}));

describe('DaftarPesananScreen', () => {
  it('renders type tabs + stage strip + at least one row', async () => {
    render(<DaftarPesananScreen />);
    expect(await screen.findByText(/Komponen/i)).toBeInTheDocument();
    expect(await screen.findByText(/Diproses|Konfirmasi/i)).toBeInTheDocument();
    expect(await screen.findByText('X')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- DaftarPesananScreen --run`
Expected: FAIL

- [ ] **Step 3: Implement SubStageSection**

Create `src/components/sales/SubStageSection.tsx`:

```tsx
import type { Order } from '../../lib/sales/types';
import type { TypeTab } from '../../lib/sales/typeTabConfig';
import type { SubStageMeta } from '../../lib/sales/stageMapping';
import { OrderRow } from './OrderRow';

interface Props {
  sub: SubStageMeta;
  orders: Order[];
  expanded: boolean;
  expandedRowId: string | null;
  typeTab: TypeTab;
  onToggleSection: () => void;
  onToggleRow: (id: string) => void;
  onQuickAction: (order: Order, toSubStage: string) => void;
}

export function SubStageSection({ sub, orders, expanded, expandedRowId, typeTab, onToggleSection, onToggleRow, onQuickAction }: Props) {
  const isUrgent = sub.actionType === 'urgent';
  const totalRp = orders.reduce((acc, o) => acc + o.total, 0);
  return (
    <>
      <div onClick={onToggleSection} style={{
        padding: '14px 24px', cursor: 'pointer',
        background: isUrgent ? 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)' : 'white',
        borderBottom: '1px solid #e5eeff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ color: isUrgent ? '#92400e' : '#6b7280', fontSize: 11, width: 14 }}>{expanded ? '▾' : '▸'}</span>
          <span style={{ fontSize: 13, fontWeight: isUrgent ? 700 : 600, color: '#012749' }}>{sub.name}</span>
          <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>· {orders.length}</span>
          {isUrgent && (
            <span style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginLeft: 10 }}>Perlu Kerjakan</span>
          )}
          {totalRp > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2d8a4e', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>Rp {(totalRp/1000).toLocaleString('id-ID', { maximumFractionDigits: 0 })}K</span>
          )}
        </div>
      </div>
      {expanded && (
        orders.length === 0
          ? <div style={{ padding: '20px 24px', textAlign: 'center', color: '#9ca3af', fontSize: 12, fontStyle: 'italic', background: '#fafbff' }}>Kosong 🎉</div>
          : orders.map(o => (
            <OrderRow
              key={o.id}
              order={o}
              expanded={expandedRowId === o.id}
              typeTab={typeTab}
              onToggle={() => onToggleRow(o.id)}
              onQuickAction={(_label, toSubStage) => onQuickAction(o, toSubStage)}
            />
          ))
      )}
    </>
  );
}
```

- [ ] **Step 4: Implement DaftarPesananScreen**

Create `src/components/sales/DaftarPesananScreen.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { fetchActiveOrders, fetchArchiveOrders, subscribeOrders } from '../../lib/sales/queries';
import type { Order, FunnelStage } from '../../lib/sales/types';
import { TYPE_TAB_CFG, filterOrdersByTypeTab, subStageBelongsToTab, type TypeTab } from '../../lib/sales/typeTabConfig';
import { SUB_STAGES, getSubStagesForStage, isUrgentSubStage } from '../../lib/sales/stageMapping';
import { transitionOrder } from '../../lib/sales/mutations';
import { TypeTabs } from './TypeTabs';
import { StageStrip } from './StageStrip';
import { SubStageSection } from './SubStageSection';

export function DaftarPesananScreen() {
  const [typeTab, setTypeTab] = useState<TypeTab>('komponen');
  const [stage, setStage] = useState<FunnelStage>(2);
  const [orders, setOrders] = useState<Order[]>([]);
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  useEffect(() => {
    fetchActiveOrders().then(setOrders);
    const sub = subscribeOrders(() => fetchActiveOrders().then(setOrders));
    return () => { sub.unsubscribe(); };
  }, []);

  // Auto-expand urgent sub-stages when stage/tab changes
  useEffect(() => {
    const next = new Set<string>();
    getSubStagesForStage(stage).forEach(s => {
      if (subStageBelongsToTab(s.id, typeTab) && isUrgentSubStage(s.id)) next.add(s.id);
    });
    setExpandedSubs(next);
  }, [stage, typeTab]);

  const filteredOrders = useMemo(() => filterOrdersByTypeTab(orders, typeTab), [orders, typeTab]);
  const ordersByStage = useMemo(() => {
    const m: Record<number, Order[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    filteredOrders.forEach(o => m[o.funnel_stage]?.push(o));
    return m;
  }, [filteredOrders]);

  const totalCounts = {
    komponen: orders.filter(o => o.order_type === 'KOMPONEN').length,
    workshop: orders.filter(o => o.order_type !== 'KOMPONEN').length,
    all: orders.length,
  };
  const stageCounts = { 1: ordersByStage[1].length, 2: ordersByStage[2].length, 3: ordersByStage[3].length, 4: ordersByStage[4].length, 5: ordersByStage[5].length, 6: ordersByStage[6].length } as Record<FunnelStage, number>;

  const subsForStage = getSubStagesForStage(stage).filter(s => subStageBelongsToTab(s.id, typeTab));

  async function handleQuickAction(order: Order, toSubStage: string) {
    const result = await transitionOrder({ id: order.id, fromSubStage: order.funnel_sub_stage, toSubStage: toSubStage as Order['funnel_sub_stage'], expectedVersion: order.version });
    if (!result.ok) {
      alert(`Gagal: ${result.code}. Refresh dan coba lagi.`);
      fetchActiveOrders().then(setOrders);
      return;
    }
    fetchActiveOrders().then(setOrders);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h2 className="text-2xl font-bold text-[#012749] mb-2">Daftar Pesanan</h2>
      <div style={{ background: 'white', borderRadius: 24, boxShadow: '0 2px 12px rgba(1,39,73,0.06)', border: '1px solid #e5eeff', overflow: 'hidden' }}>
        <TypeTabs active={typeTab} counts={totalCounts} onChange={setTypeTab} />
        <StageStrip active={stage} counts={stageCounts} onChange={setStage} />
        <div>
          {subsForStage.map(sub => (
            <SubStageSection
              key={sub.id}
              sub={sub}
              orders={ordersByStage[stage].filter(o => o.funnel_sub_stage === sub.id)}
              expanded={expandedSubs.has(sub.id)}
              expandedRowId={expandedRowId}
              typeTab={typeTab}
              onToggleSection={() => {
                const next = new Set(expandedSubs);
                if (next.has(sub.id)) next.delete(sub.id); else next.add(sub.id);
                setExpandedSubs(next);
              }}
              onToggleRow={(id) => setExpandedRowId(prev => prev === id ? null : id)}
              onQuickAction={handleQuickAction}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run (pass)**

Run: `npm test -- DaftarPesananScreen --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/SubStageSection.tsx src/components/sales/DaftarPesananScreen.tsx src/components/sales/__tests__/DaftarPesananScreen.test.tsx
git commit -m "feat(sales): DaftarPesananScreen skeleton with type tabs + stage strip + sub-stages"
```

---

## Milestone E: Payment Proof Verification

### Task E1: PaymentProofThumbnail + Lightbox

**Files:**
- Create: `src/components/sales/PaymentProofThumbnail.tsx`
- Create: `src/components/sales/PaymentProofLightbox.tsx`
- Test: `src/components/sales/__tests__/PaymentProofLightbox.test.tsx`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentProofLightbox } from '../PaymentProofLightbox';

describe('PaymentProofLightbox', () => {
  it('renders image and approve button', () => {
    const onApprove = vi.fn();
    const onClose = vi.fn();
    render(<PaymentProofLightbox proofUrl="https://example/p.jpg" orderId="abc" onApprove={onApprove} onReject={() => {}} onClose={onClose} />);
    expect(screen.getByAltText(/Bukti pembayaran/i)).toHaveAttribute('src', 'https://example/p.jpg');
    fireEvent.click(screen.getByText(/Bukti Benar/i));
    expect(onApprove).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- PaymentProofLightbox --run`
Expected: FAIL

- [ ] **Step 3: Implement Thumbnail**

Create `src/components/sales/PaymentProofThumbnail.tsx`:

```tsx
interface Props {
  proofUrl?: string;
  source?: 'WA_CALISTA' | 'ADMIN_UPLOAD' | 'MARKETPLACE_SCREENSHOT';
  onClick: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  WA_CALISTA: '📱 Dikirim via WhatsApp (Calista)',
  ADMIN_UPLOAD: '📤 Upload manual oleh admin',
  MARKETPLACE_SCREENSHOT: '🛒 Screenshot dari marketplace',
};

export function PaymentProofThumbnail({ proofUrl, source, onClick }: Props) {
  if (!proofUrl) return (
    <div style={{ padding: 16, textAlign: 'center', color: '#6b7280', fontSize: 12, background: '#f9fafb', borderRadius: 12 }}>Belum ada bukti</div>
  );
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <img src={proofUrl} alt="Bukti pembayaran (thumbnail)" style={{ width: 90, height: 120, objectFit: 'cover', borderRadius: 12, border: '2px solid #c7d7f5' }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#012749' }}>Bukti Pembayaran</div>
        <div style={{ fontSize: 10, color: '#6b7280' }}>{source ? SOURCE_LABEL[source] : '—'}</div>
        <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ marginTop: 4, fontSize: 12, color: '#2563eb', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>🔍 Lihat ukuran penuh →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement Lightbox**

Create `src/components/sales/PaymentProofLightbox.tsx`:

```tsx
interface Props {
  proofUrl: string;
  orderId: string;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onClose: () => void;
}

export function PaymentProofLightbox({ proofUrl, orderId, onApprove, onReject, onClose }: Props) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 16, backdropFilter: 'blur(8px)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, boxShadow: '0 25px 50px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', maxWidth: 900, width: '100%', maxHeight: '92vh' }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5eeff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#012749' }}>Bukti Pembayaran</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>Order #{orderId}</div>
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 999, background: '#f3f4f6', border: 'none', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <img src={proofUrl} alt="Bukti pembayaran (full)" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }} />
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e5eeff', display: 'flex', gap: 12, justifyContent: 'flex-end', background: '#fafbff' }}>
          <button onClick={() => { const r = window.prompt('Alasan tolak?') ?? ''; if (r.trim()) onReject(r); }} style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #fecaca', color: '#b91c1c', background: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>❌ Tolak Bukti</button>
          <button onClick={onApprove} style={{ padding: '8px 18px', borderRadius: 10, background: '#2d8a4e', color: 'white', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>✓ Bukti Benar · Approve</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run (pass)**

Run: `npm test -- PaymentProofLightbox --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/PaymentProofThumbnail.tsx src/components/sales/PaymentProofLightbox.tsx src/components/sales/__tests__/PaymentProofLightbox.test.tsx
git commit -m "feat(sales): payment proof thumbnail + lightbox modal"
```

### Task E2: ProofUploadModal — 3 upload sources

**Files:**
- Create: `src/components/sales/ProofUploadModal.tsx`
- Test: `src/components/sales/__tests__/ProofUploadModal.test.tsx`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProofUploadModal } from '../ProofUploadModal';

describe('ProofUploadModal', () => {
  it('shows 3 upload sources', () => {
    render(<ProofUploadModal orderId="x" field="payment_proof_url" onUploaded={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Upload Manual/i)).toBeInTheDocument();
    expect(screen.getByText(/Screenshot Marketplace/i)).toBeInTheDocument();
    expect(screen.getByText(/Calista/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `npm test -- ProofUploadModal --run`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `src/components/sales/ProofUploadModal.tsx`:

```tsx
import { useRef, useState } from 'react';
import { uploadPaymentProof } from '../../lib/sales/mutations';
import type { ProofSource } from '../../lib/sales/types';

interface Props {
  orderId: string;
  field: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url';
  onUploaded: (url: string) => void;
  onClose: () => void;
}

export function ProofUploadModal({ orderId, field, onUploaded, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ProofSource>('ADMIN_UPLOAD');
  const [busy, setBusy] = useState(false);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadPaymentProof({ orderId, file, source, field });
      onUploaded(url);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#012749', marginBottom: 4 }}>Upload Bukti Pembayaran</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>Order #{orderId}</div>
        <div style={{ marginBottom: 12, fontSize: 12, color: '#374151', fontWeight: 600 }}>Sumber bukti:</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <label style={{ display: 'flex', gap: 8, padding: 12, borderRadius: 10, border: `2px solid ${source === 'WA_CALISTA' ? '#012749' : '#e5eeff'}`, cursor: 'pointer' }}>
            <input type="radio" name="src" checked={source === 'WA_CALISTA'} onChange={() => setSource('WA_CALISTA')} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#012749' }}>📱 Dari WhatsApp (Calista AI)</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Customer kirim via WA, Calista auto-attach (otomatis, jarang perlu manual)</div>
            </div>
          </label>
          <label style={{ display: 'flex', gap: 8, padding: 12, borderRadius: 10, border: `2px solid ${source === 'ADMIN_UPLOAD' ? '#012749' : '#e5eeff'}`, cursor: 'pointer' }}>
            <input type="radio" name="src" checked={source === 'ADMIN_UPLOAD'} onChange={() => setSource('ADMIN_UPLOAD')} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#012749' }}>📤 Upload Manual oleh Admin</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Foto bukti dari WA owner, SMS, email, atau cash di toko</div>
            </div>
          </label>
          <label style={{ display: 'flex', gap: 8, padding: 12, borderRadius: 10, border: `2px solid ${source === 'MARKETPLACE_SCREENSHOT' ? '#012749' : '#e5eeff'}`, cursor: 'pointer' }}>
            <input type="radio" name="src" checked={source === 'MARKETPLACE_SCREENSHOT'} onChange={() => setSource('MARKETPLACE_SCREENSHOT')} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#012749' }}>🛒 Screenshot Marketplace</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Screenshot order detail dari Tokopedia/Shopee seller dashboard</div>
            </div>
          </label>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handlePick} disabled={busy} style={{ display: 'block', width: '100%', marginBottom: 12 }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 10, background: 'white', border: '1px solid #e5e7eb', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Batal</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run (pass)**

Run: `npm test -- ProofUploadModal --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/ProofUploadModal.tsx src/components/sales/__tests__/ProofUploadModal.test.tsx
git commit -m "feat(sales): ProofUploadModal with 3 upload sources (WA, manual, marketplace)"
```

### Task E3: Wire payment proof into DaftarPesananScreen

**Files:**
- Modify: `src/components/sales/DaftarPesananScreen.tsx`

- [ ] **Step 1: Add state + handlers**

In `DaftarPesananScreen.tsx` add:

```tsx
const [proofModal, setProofModal] = useState<{ url: string; orderId: string; version: number; expectedFromSub: string; toSub: string } | null>(null);
const [uploadModal, setUploadModal] = useState<{ orderId: string; field: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url' } | null>(null);
```

And modify `handleQuickAction`:

```tsx
async function handleQuickAction(order: Order, toSubStage: string) {
  const action = getQuickAction(order);
  if (action?.requiresProof) {
    const proofUrl = order.payment_proof_url ?? order.pelunasan_proof_url ?? order.marketplace_proof_url;
    if (!proofUrl) {
      setUploadModal({ orderId: order.id, field: order.funnel_sub_stage === '3b' ? 'pelunasan_proof_url' : 'payment_proof_url' });
      return;
    }
    setProofModal({ url: proofUrl, orderId: order.id, version: order.version, expectedFromSub: order.funnel_sub_stage, toSub: toSubStage });
    return;
  }
  const result = await transitionOrder({ id: order.id, fromSubStage: order.funnel_sub_stage, toSubStage: toSubStage as Order['funnel_sub_stage'], expectedVersion: order.version });
  if (!result.ok) { alert(`Gagal: ${result.code}.`); }
  fetchActiveOrders().then(setOrders);
}
```

And render the modals at bottom of JSX:

```tsx
{proofModal && (
  <PaymentProofLightbox
    proofUrl={proofModal.url}
    orderId={proofModal.orderId}
    onApprove={async () => {
      await transitionOrder({ id: proofModal.orderId, fromSubStage: proofModal.expectedFromSub as Order['funnel_sub_stage'], toSubStage: proofModal.toSub as Order['funnel_sub_stage'], expectedVersion: proofModal.version });
      setProofModal(null);
      fetchActiveOrders().then(setOrders);
    }}
    onReject={async (reason) => {
      await transitionOrder({ id: proofModal.orderId, fromSubStage: proofModal.expectedFromSub as Order['funnel_sub_stage'], toSubStage: '2e', expectedVersion: proofModal.version, reason });
      setProofModal(null);
      fetchActiveOrders().then(setOrders);
    }}
    onClose={() => setProofModal(null)}
  />
)}
{uploadModal && (
  <ProofUploadModal
    orderId={uploadModal.orderId}
    field={uploadModal.field}
    onUploaded={() => fetchActiveOrders().then(setOrders)}
    onClose={() => setUploadModal(null)}
  />
)}
```

Add imports for `PaymentProofLightbox`, `ProofUploadModal`, `getQuickAction`.

- [ ] **Step 2: Run all sales tests**

Run: `npm test -- src/components/sales --run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/sales/DaftarPesananScreen.tsx
git commit -m "feat(sales): wire payment proof lightbox + upload modal into DaftarPesananScreen"
```

---

## Milestone F: Routing + Sidebar wire-up

### Task F1: Wire routes + sidebar link

**Files:**
- Modify: `src/App.tsx` (or main routes file)
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add routes**

In `src/App.tsx` (assuming React Router):

```tsx
import { SalesLandingScreen } from './components/sales/SalesLandingScreen';
import { DaftarPesananScreen } from './components/sales/DaftarPesananScreen';

// inside <Routes>
<Route path="/sales" element={<SalesLandingScreen />} />
<Route path="/sales/daftar" element={<DaftarPesananScreen />} />
```

- [ ] **Step 2: Update Sidebar Sales link**

In `src/components/Sidebar.tsx` change the Sales menu item to navigate to `/sales`.

- [ ] **Step 3: Build & visual check**

Run: `npm run dev`
Open browser, click Sales sidebar item, see SalesLandingScreen, click Daftar Pesanan tab, see DaftarPesananScreen.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(sales): wire /sales and /sales/daftar routes + sidebar"
```

---

## Self-Review (run before handoff)

**Spec coverage check:**

- [x] Order type flag (3 types) — `types.ts` + `typeTabConfig.ts`
- [x] Channel × type × payment routing — partial (deferred to Catat Penjualan plan)
- [x] Stage 2-5 flow for CP/RP — `stageMapping.ts` + `quickActionMap.ts`
- [x] Stage 3 sub-stages restructure — `stageMapping.ts`
- [x] Cancel rule simplification — quickActionMap returns null for Stage 3+ (only reject path during proof verify)
- [x] Persetujuan deep-link — placeholder (out of scope this plan)
- [x] Payment proof 3 sources — `ProofUploadModal.tsx` + `mutations.ts`
- [x] Optimistic locking — `transition_order_stage` RPC + version column
- [x] Audit log — `kasir_audit_logs` insert in RPC
- [x] Native DS — inline styles use #012749 + #2d8a4e

**Gaps acknowledged (out of scope this plan):**
- Catat Penjualan wizard rewrite (separate plan)
- Pengaturan additions (separate plan)
- Calista AI integration (separate plan)
- PDF document generation (separate plan)
- Owner override modal (separate plan)
- Sales Inbox handoff (separate plan)
- WipListScreen deprecation (separate plan)
- Search + pagination + sticky + total footer (deferred to Milestone H — write tasks before execution if scope expands)

**Type consistency:** All `FunnelSubStage` literal types match between `types.ts`, `stageMapping.ts`, `quickActionMap.ts`, `mutations.ts`. RPC string format `'2a'`/`'3f'`/etc. consistent.

**Placeholder scan:** No TBD / TODO / "implement later" found in plan body.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-sales-landing-and-daftar-pesanan-2i-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
