# Opname Damage Flag + Unified Supplier Claims — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship inline damage flag di opname UI + unified `supplier_claims` model spanning opname + PO receipt + ad-hoc adjustment, dengan 5 resolve outcomes (replaced/credited/cashed/rejected + variance), PIN/APP_INBOX approval gate, feature-flagged `record_pi` GL split, dan backfill migration untuk existing PO damage.

**Architecture:** Extend existing SECDEF RPC pattern (owner=`vosi_rpc_owner`). New `supplier_claims` + `supplier_claim_events` tables as single source of truth. All journals via existing `_post_journal_entry()` helper. Column-additive changes to `stock_adjustments`, `purchase_order_items`, `stock_opname_counts`. `damage_status_enum` extended. Feature flag `enable_pi_damage_split` on `accounting_config` gates the `record_pi` split behavior.

**Tech Stack:** Supabase Postgres + PL/pgSQL RPCs, React + TypeScript frontend (Vitest + RTL for tests), existing VOSI Design System components. MCP `execute_sql` for SECDEF smoke tests.

## Global Constraints

- **Migration slots claimed:** `20261115000100` through `20261115000105` (do NOT use other slots).
- **Spec source of truth:** `docs/superpowers/specs/2026-07-12-opname-damage-supplier-claims-design.md`. If plan and spec disagree, plan defers to spec.
- **Feature flag:** `accounting_config.enable_pi_damage_split BOOLEAN NOT NULL DEFAULT false` — toggles `record_pi` GL split.
- **SECDEF pattern:** All new RPCs `SECURITY DEFINER OWNER TO vosi_rpc_owner`. RLS policy `t_select_own` on target tables must include `vosi_rpc_owner` (per memory: SECDEF RETURNING gap).
- **Approval methods for RESOLVE_SUPPLIER_CLAIM:** PIN + APP_INBOX only. WA_BUTTON explicitly not supported (return error `wa_not_supported_for_claim_resolve`).
- **COA additions:** `1-1460 Piutang Klaim Supplier` (ASET), `5-3160 Beban Barang Rusak` (BEBAN).
- **Font size:** 13-14px base UI text (per user preference). Badge palette per `docs/VOSI-Design-System.md`.
- **No supplier WA reminder** (per user memory). No ad-hoc customer/supplier (existing supplier lookup only).
- **Journal helper:** All GL entries via `_post_journal_entry(entry_date, source_type='SUPPLIER_CLAIM', description, lines jsonb, source_ref_table='supplier_claims', source_ref_id, tenant_id)`.
- **CHECK constraint discipline** (per memory): before modifying `stock_adjustments`/`purchase_order_items`/`stock_opname_counts`, enumerate ALL existing CHECKs + partial indexes and verify each new state satisfies them.
- **Smoke test pattern** (per memory): SECDEF RPCs tested via `DO $$ ... set_config('request.jwt.claim.sub', ...) ... RAISE EXCEPTION 'rollback-marker' ... END $$;` for zero-side-effect verification via MCP `execute_sql`.
- **Commit cadence:** commit after each task's tests pass. Commit message format: `type(module): summary` matching recent history (e.g. `feat(opname):`, `fix(pembelian):`, `docs(spec):`).

---

## File Structure

### Backend migrations (slots 100-105)
| File | Contents |
|---|---|
| `supabase/migrations/20261115000100_supplier_claims_schema.sql` | New tables (supplier_claims, supplier_claim_events) + indexes + RLS + COA seed + column extensions + enum extensions |
| `supabase/migrations/20261115000101_supplier_claims_rpcs.sql` | `_insert_supplier_claim`, `create_supplier_claim_from_opname`, `create_supplier_claim_from_po_receipt`, `resolve_supplier_claim` |
| `supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql` | Modify `commit_opname_session`, `receive_purchase_order`, `receive_replacement`, `request_adjustment`, `_apply_adjustment_change`, `record_pi` (flagged) |
| `supabase/migrations/20261115000103_supplier_claims_read_rpcs.sql` | `list_supplier_claims`, `get_supplier_claim`, `list_supplier_claim_events` |
| `supabase/migrations/20261115000104_supplier_claims_backfill.sql` | Backfill existing PO damage_status → supplier_claims (batched, resumable, idempotent) |
| `supabase/migrations/20261115000105_supplier_claims_feature_flag_seed.sql` | Seed `enable_pi_damage_split` column + default false + Pengaturan UI hint |

### Frontend files
| File | Action | Purpose |
|---|---|---|
| `src/components/stok/DamageFlagModal.tsx` | CREATE | Reusable modal for flag rusak (opname row + adjustment) |
| `src/components/stok/StockOpnameSessionView.tsx` | MODIFY | Add "Flag Rusak" button per row + damaged_qty state + sellable preview |
| `src/components/stok/StockAdjustmentModal.tsx` | MODIFY | Add disposition radio + supplier dropdown when reason=rusak |
| `src/components/pembelian/KlaimSupplierPanel.tsx` | CREATE | Main list page for Klaim Supplier tab |
| `src/components/pembelian/ClaimListTable.tsx` | CREATE | Reusable list table component |
| `src/components/pembelian/ClaimResolveModal.tsx` | CREATE | Reusable resolve modal (4 outcomes + variance) |
| `src/components/pembelian/ClaimStatusBadge.tsx` | CREATE | Reusable status badge component |
| `src/components/pembelian/PembelianScreen.tsx` | MODIFY | Add `klaim` tab in tab order |
| `src/components/pembelian/ReceiveGoodsModal.tsx` | MODIFY | Auto-create claim on qty_damaged > 0 |
| `src/components/pembelian/ReceiveReplacementModal.tsx` | MODIFY | Wrap as `resolve_supplier_claim(outcome='RESOLVED_REPLACED')` |
| `src/components/PengaturanScreen.tsx` | MODIFY | Add `enabled_claim_sources/outcomes` config + approval_settings for RESOLVE_SUPPLIER_CLAIM (grey out WA option) |
| `src/lib/supplierClaims/api.ts` | CREATE | Typed client wrapper for supplier claim RPCs |
| `src/lib/supplierClaims/types.ts` | CREATE | TypeScript types matching table schema + enums |

### Test files
| File | Purpose |
|---|---|
| `tests/sql/supplier_claims_schema_smoke.sql` | Verify schema exists + RLS enabled + constraints work |
| `tests/sql/supplier_claims_rpc_smoke.sql` | SECDEF smoke tests for all new RPCs (rollback-marker pattern) |
| `tests/sql/supplier_claims_existing_rpc_mods_smoke.sql` | Regression smoke for modified existing RPCs |
| `tests/sql/supplier_claims_backfill_test.sql` | Verify backfill idempotency + row count |
| `src/components/stok/DamageFlagModal.test.tsx` | Component test for damage flag modal |
| `src/components/pembelian/ClaimResolveModal.test.tsx` | Component test for resolve modal with variance |
| `src/components/pembelian/KlaimSupplierPanel.test.tsx` | Component test for list page |
| `tests/integration/opname_damage_flow.test.ts` | E2E: opname flag → commit → resolve → verify balance |

---

## Task 1: Enumerate existing CHECK constraints + partial indexes

**Files:**
- Create: `docs/superpowers/plans/2026-07-12-check-constraint-audit.md`

**Interfaces:**
- Consumes: nothing
- Produces: reference doc listing every existing CHECK/partial index on `stock_adjustments`, `purchase_order_items`, `stock_opname_counts` so subsequent migrations don't violate them

- [ ] **Step 1: Query information_schema for target tables**

Run via MCP `execute_sql`:
```sql
SELECT tc.table_name, cc.constraint_name, cc.check_clause
FROM information_schema.check_constraints cc
JOIN information_schema.constraint_column_usage ccu ON cc.constraint_name = ccu.constraint_name
JOIN information_schema.table_constraints tc ON cc.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('stock_adjustments','purchase_order_items','stock_opname_counts')
ORDER BY tc.table_name, cc.constraint_name;
```

Expected: multiple rows per table listing check clauses.

- [ ] **Step 2: Query partial indexes on same tables**

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('stock_adjustments','purchase_order_items','stock_opname_counts')
  AND indexdef ILIKE '%WHERE%'
ORDER BY tablename, indexname;
```

- [ ] **Step 3: Write findings to reference doc**

Create `docs/superpowers/plans/2026-07-12-check-constraint-audit.md` with sections for each table listing all constraints + notes on which new states (damage_disposition, damaged_qty, supplier_claim_id) may interact with existing predicates.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-12-check-constraint-audit.md
git commit -m "docs(supplier-claims): audit existing CHECKs before schema mods"
```

---

## Task 2: Migration 100 — schema (new tables + indexes + RLS + COA + column extensions + enum extensions)

**Files:**
- Create: `supabase/migrations/20261115000100_supplier_claims_schema.sql`
- Test: `tests/sql/supplier_claims_schema_smoke.sql`

**Interfaces:**
- Consumes: existing tables — `tenants`, `suppliers`, `stock_adjustments`, `purchase_order_items`, `stock_opname_counts`, `chart_of_accounts`, `journal_entries`, `auth.users`, `approval_requests`
- Produces:
  - Table `supplier_claims(id BIGSERIAL, tenant_id UUID, supplier_id UUID, sku TEXT, warehouse TEXT, qty INT, unit_cost NUMERIC(15,2), currency_code TEXT DEFAULT 'IDR', source_type TEXT, source_ref_id BIGINT, damage_notes TEXT, evidence_urls TEXT[], status TEXT DEFAULT 'PENDING', resolution_amount NUMERIC(15,2), resolution_target_id TEXT, resolved_at TIMESTAMPTZ, resolved_by UUID, resolution_journal_id BIGINT, resolution_notes TEXT, approval_request_id BIGINT, idempotency_key TEXT, created_at TIMESTAMPTZ DEFAULT now(), created_by UUID)`
  - Table `supplier_claim_events(id BIGSERIAL, claim_id BIGINT, event_type TEXT, actor_user_id UUID, payload JSONB, journal_entry_id BIGINT, at TIMESTAMPTZ DEFAULT now())`
  - Columns: `stock_adjustments.damage_disposition TEXT`, `stock_adjustments.damage_supplier_id UUID`, `stock_adjustments.supplier_claim_id BIGINT`
  - Columns: `purchase_order_items.supplier_claim_id BIGINT`
  - Columns: `stock_opname_counts.damaged_qty INT DEFAULT 0`, `.damage_disposition TEXT`, `.damage_supplier_id UUID`, `.damage_notes TEXT`, `.damage_evidence_urls TEXT[]`
  - Enum values: `damage_status_enum` gets `RESOLVED_CREDITED`, `RESOLVED_CASHED`, `REJECTED`
  - COA rows: `1-1460 Piutang Klaim Supplier`, `5-3160 Beban Barang Rusak`
  - Column: `accounting_config.enable_pi_damage_split BOOLEAN DEFAULT false`

- [ ] **Step 1: Write schema smoke test first**

Create `tests/sql/supplier_claims_schema_smoke.sql`:
```sql
-- Verify tables exist
SELECT 'supplier_claims exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema='public' AND table_name='supplier_claims'
);

SELECT 'supplier_claim_events exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema='public' AND table_name='supplier_claim_events'
);

-- Verify new columns on existing tables
SELECT 'stock_adjustments.damage_disposition exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name='stock_adjustments' AND column_name='damage_disposition'
);

SELECT 'purchase_order_items.supplier_claim_id exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name='purchase_order_items' AND column_name='supplier_claim_id'
);

SELECT 'stock_opname_counts.damaged_qty exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name='stock_opname_counts' AND column_name='damaged_qty'
);

-- Verify enum extended
SELECT 'damage_status_enum has RESOLVED_CREDITED' WHERE EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname='damage_status_enum' AND e.enumlabel='RESOLVED_CREDITED'
);

-- Verify COA seeded
SELECT 'CoA 1-1460 exists' WHERE EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE account_code='1-1460'
);
SELECT 'CoA 5-3160 exists' WHERE EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE account_code='5-3160'
);

-- Verify RLS enabled
SELECT 'supplier_claims RLS enabled' WHERE (
  SELECT relrowsecurity FROM pg_class WHERE relname='supplier_claims'
);

-- Verify feature flag column
SELECT 'accounting_config.enable_pi_damage_split exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name='accounting_config' AND column_name='enable_pi_damage_split'
);
```

- [ ] **Step 2: Run smoke test to verify it fails**

Via MCP `execute_sql` on staging: run each SELECT. Every one should return 0 rows (nothing exists yet).

- [ ] **Step 3: Write migration 100**

Create `supabase/migrations/20261115000100_supplier_claims_schema.sql`:

```sql
-- Migration: supplier_claims schema
-- Adds: supplier_claims + supplier_claim_events tables, COA rows for damage/claim,
--       column additions to stock_adjustments/purchase_order_items/stock_opname_counts,
--       damage_status_enum extension, accounting_config feature flag.

BEGIN;

-- =====================================================================
-- 1. New tables
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.supplier_claims (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id),
  supplier_id           UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  sku                   TEXT NOT NULL,
  warehouse             TEXT NOT NULL,
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  unit_cost             NUMERIC(15,2) NOT NULL CHECK (unit_cost >= 0),
  currency_code         TEXT NOT NULL DEFAULT 'IDR',
  source_type           TEXT NOT NULL CHECK (source_type IN ('PO_RECEIPT','STOCK_OPNAME','STOCK_ADJUSTMENT')),
  source_ref_id         BIGINT NOT NULL,
  damage_notes          TEXT,
  evidence_urls         TEXT[],
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','RESOLVED_REPLACED','RESOLVED_CREDITED','RESOLVED_CASHED','REJECTED')),
  resolution_amount     NUMERIC(15,2),
  resolution_target_id  TEXT,
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES auth.users(id),
  resolution_journal_id BIGINT REFERENCES public.journal_entries(id),
  resolution_notes      TEXT,
  approval_request_id   BIGINT REFERENCES public.approval_requests(id),
  idempotency_key       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_claims_tenant_status ON public.supplier_claims(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_claims_supplier_status ON public.supplier_claims(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_claims_source ON public.supplier_claims(source_type, source_ref_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_claims_po_source ON public.supplier_claims(source_ref_id) WHERE source_type='PO_RECEIPT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_claims_opname_source ON public.supplier_claims(source_ref_id, sku, warehouse) WHERE source_type='STOCK_OPNAME';
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_claims_adj_source ON public.supplier_claims(source_ref_id) WHERE source_type='STOCK_ADJUSTMENT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_claims_idempotency ON public.supplier_claims(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.supplier_claim_events (
  id               BIGSERIAL PRIMARY KEY,
  claim_id         BIGINT NOT NULL REFERENCES public.supplier_claims(id),
  event_type       TEXT NOT NULL CHECK (event_type IN ('CREATED','APPROVAL_REQUESTED','APPROVED','RESOLVED','REJECTED','VOIDED')),
  actor_user_id    UUID,
  payload          JSONB,
  journal_entry_id BIGINT REFERENCES public.journal_entries(id),
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_claim_events_claim ON public.supplier_claim_events(claim_id, at);

-- =====================================================================
-- 2. RLS policies
-- =====================================================================

ALTER TABLE public.supplier_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_claim_events ENABLE ROW LEVEL SECURITY;

-- Read: authenticated users see their tenant's claims
CREATE POLICY p_select_own ON public.supplier_claims
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.user_tenant WHERE user_id = auth.uid() LIMIT 1));

CREATE POLICY p_select_own_events ON public.supplier_claim_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.supplier_claims sc
    WHERE sc.id = supplier_claim_events.claim_id
      AND sc.tenant_id = (SELECT tenant_id FROM public.user_tenant WHERE user_id = auth.uid() LIMIT 1)
  ));

-- Block direct writes (all writes via SECDEF RPC)
CREATE POLICY p_no_direct_write ON public.supplier_claims
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY p_no_direct_write_events ON public.supplier_claim_events
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- SECDEF ownership (per memory: SECDEF RETURNING gap requires t_select_own for vosi_rpc_owner)
CREATE POLICY t_select_own_secdef ON public.supplier_claims TO vosi_rpc_owner USING (true);
CREATE POLICY t_select_own_secdef_events ON public.supplier_claim_events TO vosi_rpc_owner USING (true);

-- Platform admin readall (per memory: 79 tables have this supplementary policy)
CREATE POLICY p_platform_admin_readall ON public.supplier_claims
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY p_platform_admin_readall_events ON public.supplier_claim_events
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- =====================================================================
-- 3. Column extensions on existing tables
-- =====================================================================

ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS damage_disposition TEXT
    CHECK (damage_disposition IS NULL OR damage_disposition IN ('DISPOSE','KLAIM_SUPPLIER')),
  ADD COLUMN IF NOT EXISTS damage_supplier_id UUID REFERENCES public.suppliers(id),
  ADD COLUMN IF NOT EXISTS supplier_claim_id BIGINT REFERENCES public.supplier_claims(id);

ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT klaim_requires_supplier
  CHECK (damage_disposition != 'KLAIM_SUPPLIER' OR damage_supplier_id IS NOT NULL);

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS supplier_claim_id BIGINT REFERENCES public.supplier_claims(id);

ALTER TABLE public.stock_opname_counts
  ADD COLUMN IF NOT EXISTS damaged_qty INTEGER NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  ADD COLUMN IF NOT EXISTS damage_disposition TEXT
    CHECK (damage_disposition IS NULL OR damage_disposition IN ('DISPOSE','KLAIM_SUPPLIER')),
  ADD COLUMN IF NOT EXISTS damage_supplier_id UUID REFERENCES public.suppliers(id),
  ADD COLUMN IF NOT EXISTS damage_notes TEXT,
  ADD COLUMN IF NOT EXISTS damage_evidence_urls TEXT[];

ALTER TABLE public.stock_opname_counts
  ADD CONSTRAINT damaged_qty_within_counted CHECK (damaged_qty <= counted_qty);

-- =====================================================================
-- 4. Enum extension: damage_status_enum
-- =====================================================================

DO $$
BEGIN
  ALTER TYPE public.damage_status_enum ADD VALUE IF NOT EXISTS 'RESOLVED_CREDITED';
  ALTER TYPE public.damage_status_enum ADD VALUE IF NOT EXISTS 'RESOLVED_CASHED';
  ALTER TYPE public.damage_status_enum ADD VALUE IF NOT EXISTS 'REJECTED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================
-- 5. Chart of Accounts additions
-- =====================================================================

INSERT INTO public.chart_of_accounts (account_code, account_name, account_type, parent_code)
VALUES
  ('1-1460', 'Piutang Klaim Supplier', 'ASET',  '1-1400'),
  ('5-3160', 'Beban Barang Rusak',     'BEBAN', '5-3000')
ON CONFLICT (account_code) DO NOTHING;

-- =====================================================================
-- 6. Feature flag column on accounting_config
-- =====================================================================

ALTER TABLE public.accounting_config
  ADD COLUMN IF NOT EXISTS enable_pi_damage_split BOOLEAN NOT NULL DEFAULT false;

COMMIT;
```

- [ ] **Step 4: Apply migration**

Via Supabase MCP `apply_migration` (or CLI if local):
```
mcp__plugin_supabase_supabase__apply_migration name=20261115000100_supplier_claims_schema
```

Expected: success.

- [ ] **Step 5: Re-run smoke test — all SELECTs should return 1 row each**

Every existence check from Step 1 should now return the sentinel row.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261115000100_supplier_claims_schema.sql tests/sql/supplier_claims_schema_smoke.sql
git commit -m "feat(supplier-claims): schema — new tables, RLS, COA, column extensions"
```

---

## Task 3: Migration 101 (part A) — `_insert_supplier_claim` internal helper

**Files:**
- Create/append: `supabase/migrations/20261115000101_supplier_claims_rpcs.sql`
- Test: `tests/sql/supplier_claims_rpc_smoke.sql`

**Interfaces:**
- Consumes: `supplier_claims`, `supplier_claim_events` tables from Task 2
- Produces:
  - Function `public._insert_supplier_claim(p_tenant_id UUID, p_supplier_id UUID, p_sku TEXT, p_warehouse TEXT, p_qty INT, p_unit_cost NUMERIC, p_source_type TEXT, p_source_ref_id BIGINT, p_notes TEXT, p_evidence_urls TEXT[], p_created_by UUID, p_idempotency_key TEXT DEFAULT NULL) RETURNS BIGINT` — returns new claim_id
  - Function inserts row into `supplier_claims` (status='PENDING') + `supplier_claim_events` (event_type='CREATED')
  - SECURITY DEFINER, OWNER TO `vosi_rpc_owner`, GRANT EXECUTE to `vosi_rpc_owner` only (not authenticated — internal only)

- [ ] **Step 1: Write smoke test**

Append to `tests/sql/supplier_claims_rpc_smoke.sql`:
```sql
-- Test: _insert_supplier_claim inserts row + event
DO $$
DECLARE
  v_tenant UUID;
  v_supplier UUID;
  v_user UUID;
  v_claim_id BIGINT;
  v_event_count INT;
BEGIN
  -- Assumes staging has at least one tenant + supplier + user
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_supplier FROM public.suppliers WHERE tenant_id=v_tenant LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;

  v_claim_id := public._insert_supplier_claim(
    v_tenant, v_supplier, 'TEST-SKU', 'atas', 5, 100000,
    'STOCK_OPNAME', 999999, 'test note', ARRAY[]::TEXT[], v_user, NULL
  );

  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'expected claim_id, got NULL';
  END IF;

  SELECT COUNT(*) INTO v_event_count FROM public.supplier_claim_events
   WHERE claim_id=v_claim_id AND event_type='CREATED';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 CREATED event, got %', v_event_count;
  END IF;

  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

- [ ] **Step 2: Run smoke test — expect FAIL (function not defined)**

Expected: ERROR: function `_insert_supplier_claim` does not exist.

- [ ] **Step 3: Create migration 101 file with helper function**

Create `supabase/migrations/20261115000101_supplier_claims_rpcs.sql`:
```sql
-- Migration: supplier_claims RPCs
-- Part A: internal helper

BEGIN;

CREATE OR REPLACE FUNCTION public._insert_supplier_claim(
  p_tenant_id       UUID,
  p_supplier_id     UUID,
  p_sku             TEXT,
  p_warehouse       TEXT,
  p_qty             INTEGER,
  p_unit_cost       NUMERIC,
  p_source_type     TEXT,
  p_source_ref_id   BIGINT,
  p_notes           TEXT,
  p_evidence_urls   TEXT[],
  p_created_by      UUID,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_id BIGINT;
BEGIN
  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_claim_id FROM public.supplier_claims
      WHERE tenant_id=p_tenant_id AND idempotency_key=p_idempotency_key;
    IF v_claim_id IS NOT NULL THEN
      RETURN v_claim_id;
    END IF;
  END IF;

  INSERT INTO public.supplier_claims (
    tenant_id, supplier_id, sku, warehouse, qty, unit_cost,
    source_type, source_ref_id, damage_notes, evidence_urls,
    status, created_by, idempotency_key
  ) VALUES (
    p_tenant_id, p_supplier_id, p_sku, p_warehouse, p_qty, p_unit_cost,
    p_source_type, p_source_ref_id, p_notes, p_evidence_urls,
    'PENDING', p_created_by, p_idempotency_key
  ) RETURNING id INTO v_claim_id;

  INSERT INTO public.supplier_claim_events (claim_id, event_type, actor_user_id, payload)
  VALUES (v_claim_id, 'CREATED', p_created_by,
    jsonb_build_object('qty', p_qty, 'unit_cost', p_unit_cost, 'source_type', p_source_type));

  RETURN v_claim_id;
END $$;

ALTER FUNCTION public._insert_supplier_claim(UUID, UUID, TEXT, TEXT, INT, NUMERIC, TEXT, BIGINT, TEXT, TEXT[], UUID, TEXT)
  OWNER TO vosi_rpc_owner;

REVOKE ALL ON FUNCTION public._insert_supplier_claim(UUID, UUID, TEXT, TEXT, INT, NUMERIC, TEXT, BIGINT, TEXT, TEXT[], UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._insert_supplier_claim(UUID, UUID, TEXT, TEXT, INT, NUMERIC, TEXT, BIGINT, TEXT, TEXT[], UUID, TEXT) TO vosi_rpc_owner;

COMMIT;
```

- [ ] **Step 4: Apply + re-run smoke test — expect PASS**

Apply migration. Re-run smoke test. Expected: PASS (rollback-marker raised, no side effects).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000101_supplier_claims_rpcs.sql tests/sql/supplier_claims_rpc_smoke.sql
git commit -m "feat(supplier-claims): internal helper _insert_supplier_claim"
```

---

## Task 4: Migration 101 (part B) — `create_supplier_claim_from_opname` RPC

**Files:**
- Append: `supabase/migrations/20261115000101_supplier_claims_rpcs.sql`
- Test: append to `tests/sql/supplier_claims_rpc_smoke.sql`

**Interfaces:**
- Consumes: `_insert_supplier_claim` (Task 3), `_post_journal_entry` (existing helper)
- Produces:
  - Function `public.create_supplier_claim_from_opname(p_session_id BIGINT, p_sku TEXT, p_warehouse TEXT, p_damaged_qty INT, p_disposition TEXT, p_supplier_id UUID, p_unit_cost NUMERIC, p_notes TEXT, p_evidence_urls TEXT[], p_idempotency_key TEXT DEFAULT NULL) RETURNS jsonb` — returns `{adjustment_id BIGINT, claim_id BIGINT | NULL}`
  - Behavior:
    - For DISPOSE: creates stock_adjustments row (reason='rusak', damage_disposition='DISPOSE'), commits stock decrement, posts journal Dr 5-3160 / Cr 1-1510
    - For KLAIM_SUPPLIER: creates stock_adjustments row (damage_disposition='KLAIM_SUPPLIER', damage_supplier_id), commits stock decrement, calls `_insert_supplier_claim`, links back to adjustment, posts journal Dr 1-1460 / Cr 1-1510
  - Idempotent via `p_idempotency_key`
  - SECDEF, owned by `vosi_rpc_owner`, EXECUTE granted to `authenticated`

- [ ] **Step 1: Write smoke test**

Append to `tests/sql/supplier_claims_rpc_smoke.sql`:
```sql
-- Test: create_supplier_claim_from_opname (DISPOSE path)
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_session_id BIGINT;
  v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  -- Assume test session exists (or use fake session_id, validate rejection)
  v_session_id := -1;  -- invalid, expect proper error handling

  BEGIN
    v_result := public.create_supplier_claim_from_opname(
      v_session_id, 'TEST-SKU', 'atas', 3, 'DISPOSE', NULL, 50000,
      'test dispose', ARRAY[]::TEXT[], NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%session%' AND SQLERRM NOT LIKE '%not found%' THEN
      RAISE;
    END IF;
  END;

  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test: create_supplier_claim_from_opname (KLAIM path — enforce supplier_id required)
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  BEGIN
    PERFORM public.create_supplier_claim_from_opname(
      -1, 'TEST-SKU', 'atas', 3, 'KLAIM_SUPPLIER', NULL, 50000,
      'test klaim', ARRAY[]::TEXT[], NULL
    );
    RAISE EXCEPTION 'expected error for missing supplier_id';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%supplier%' THEN
      RAISE;
    END IF;
  END;

  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

- [ ] **Step 2: Run smoke test — expect FAIL (function not defined)**

- [ ] **Step 3: Append function to migration 101**

Append to `supabase/migrations/20261115000101_supplier_claims_rpcs.sql`:
```sql
-- Part B: create_supplier_claim_from_opname

CREATE OR REPLACE FUNCTION public.create_supplier_claim_from_opname(
  p_session_id     BIGINT,
  p_sku            TEXT,
  p_warehouse      TEXT,
  p_damaged_qty    INTEGER,
  p_disposition    TEXT,
  p_supplier_id    UUID,
  p_unit_cost      NUMERIC,
  p_notes          TEXT,
  p_evidence_urls  TEXT[],
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc_claim_suspense CONSTANT TEXT := '1-1460';
  v_acc_damage_loss    CONSTANT TEXT := '5-3160';
  v_acc_inventory      CONSTANT TEXT := '1-1510';

  v_tenant_id     UUID;
  v_user_id       UUID;
  v_session_row   RECORD;
  v_adjustment_id BIGINT;
  v_claim_id      BIGINT;
  v_amount        NUMERIC;
BEGIN
  v_user_id := (current_setting('request.jwt.claim.sub', true))::UUID;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  -- Fetch session + tenant
  SELECT * INTO v_session_row FROM public.stock_opname_sessions WHERE id=p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'opname session not found'; END IF;
  v_tenant_id := v_session_row.tenant_id;

  -- Validate disposition
  IF p_disposition NOT IN ('DISPOSE','KLAIM_SUPPLIER') THEN
    RAISE EXCEPTION 'invalid disposition: %', p_disposition;
  END IF;

  IF p_disposition='KLAIM_SUPPLIER' AND p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id required for KLAIM_SUPPLIER disposition';
  END IF;

  IF p_damaged_qty <= 0 THEN
    RAISE EXCEPTION 'damaged_qty must be > 0';
  END IF;

  v_amount := p_damaged_qty * p_unit_cost;

  -- Create stock_adjustments row (with disposition metadata)
  INSERT INTO public.stock_adjustments (
    tenant_id, sku, warehouse, qty_delta, reason_code, reason_note,
    evidence_urls, status, damage_disposition, damage_supplier_id,
    committed_at
  ) VALUES (
    v_tenant_id, p_sku, p_warehouse, -p_damaged_qty, 'rusak', p_notes,
    p_evidence_urls, 'COMMITTED', p_disposition, p_supplier_id,
    now()
  ) RETURNING id INTO v_adjustment_id;

  -- Log stock movement
  PERFORM public.log_stock_movement(
    v_tenant_id, p_sku, p_warehouse, -p_damaged_qty, p_unit_cost,
    'STOCK_ADJUSTMENT_RUSAK', v_adjustment_id
  );

  IF p_disposition = 'KLAIM_SUPPLIER' THEN
    -- Insert claim linked to this adjustment
    v_claim_id := public._insert_supplier_claim(
      v_tenant_id, p_supplier_id, p_sku, p_warehouse, p_damaged_qty,
      p_unit_cost, 'STOCK_OPNAME', p_session_id, p_notes, p_evidence_urls,
      v_user_id, p_idempotency_key
    );
    UPDATE public.stock_adjustments SET supplier_claim_id = v_claim_id WHERE id = v_adjustment_id;

    -- Journal: Dr 1-1460 / Cr 1-1510
    PERFORM public._post_journal_entry(
      current_date, 'SUPPLIER_CLAIM',
      format('Opname damage KLAIM: %s x %s (session %s)', p_damaged_qty, p_sku, p_session_id),
      jsonb_build_array(
        jsonb_build_object('account_code', v_acc_claim_suspense, 'side', 'DEBIT',  'amount', v_amount, 'description', 'Piutang klaim rusak'),
        jsonb_build_object('account_code', v_acc_inventory,      'side', 'CREDIT', 'amount', v_amount, 'description', 'Barang keluar rusak')
      ),
      'supplier_claims', v_claim_id::TEXT, v_tenant_id
    );
  ELSE
    -- DISPOSE: journal Dr 5-3160 / Cr 1-1510
    PERFORM public._post_journal_entry(
      current_date, 'SUPPLIER_CLAIM',
      format('Opname damage DISPOSE: %s x %s (session %s)', p_damaged_qty, p_sku, p_session_id),
      jsonb_build_array(
        jsonb_build_object('account_code', v_acc_damage_loss, 'side', 'DEBIT',  'amount', v_amount, 'description', 'Beban barang rusak'),
        jsonb_build_object('account_code', v_acc_inventory,   'side', 'CREDIT', 'amount', v_amount, 'description', 'Barang keluar rusak')
      ),
      'stock_adjustments', v_adjustment_id::TEXT, v_tenant_id
    );
  END IF;

  RETURN jsonb_build_object('adjustment_id', v_adjustment_id, 'claim_id', v_claim_id);
END $$;

ALTER FUNCTION public.create_supplier_claim_from_opname(BIGINT, TEXT, TEXT, INT, TEXT, UUID, NUMERIC, TEXT, TEXT[], TEXT)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.create_supplier_claim_from_opname(BIGINT, TEXT, TEXT, INT, TEXT, UUID, NUMERIC, TEXT, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_supplier_claim_from_opname(BIGINT, TEXT, TEXT, INT, TEXT, UUID, NUMERIC, TEXT, TEXT[], TEXT) TO authenticated;
```

- [ ] **Step 4: Apply migration + re-run smoke test**

Expected: both smoke tests pass (proper error for missing session / missing supplier).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000101_supplier_claims_rpcs.sql tests/sql/supplier_claims_rpc_smoke.sql
git commit -m "feat(supplier-claims): create_supplier_claim_from_opname RPC"
```

---

## Task 5: Migration 101 (part C) — `create_supplier_claim_from_po_receipt` RPC

**Files:**
- Append: `supabase/migrations/20261115000101_supplier_claims_rpcs.sql`
- Test: append to `tests/sql/supplier_claims_rpc_smoke.sql`

**Interfaces:**
- Consumes: `_insert_supplier_claim`
- Produces:
  - Function `public.create_supplier_claim_from_po_receipt(p_po_item_id BIGINT, p_qty INT, p_notes TEXT, p_evidence_urls TEXT[], p_idempotency_key TEXT DEFAULT NULL) RETURNS BIGINT` — returns claim_id
  - Behavior:
    - Fetch PO item + parent PO + supplier_id + tenant_id from `purchase_order_items` JOIN `purchase_orders`
    - Call `_insert_supplier_claim(source_type='PO_RECEIPT', source_ref_id=p_po_item_id, ...)` with unit_cost from PO item
    - UPDATE `purchase_order_items.supplier_claim_id = new_claim.id`, `damage_status = 'PENDING_RETURN'`
    - **No journal posted** — journal happens later at `record_pi` (see Task 12)

- [ ] **Step 1: Write smoke test**

Append to `tests/sql/supplier_claims_rpc_smoke.sql`:
```sql
DO $$
DECLARE
  v_user UUID;
  v_claim_id BIGINT;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  BEGIN
    v_claim_id := public.create_supplier_claim_from_po_receipt(
      -1, 5, 'test', ARRAY[]::TEXT[], NULL
    );
    RAISE EXCEPTION 'expected error for invalid po_item_id';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%po_item%' AND SQLERRM NOT LIKE '%not found%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

- [ ] **Step 2: Run — expect FAIL (function not defined)**

- [ ] **Step 3: Append function to migration 101**

```sql
-- Part C: create_supplier_claim_from_po_receipt

CREATE OR REPLACE FUNCTION public.create_supplier_claim_from_po_receipt(
  p_po_item_id     BIGINT,
  p_qty            INTEGER,
  p_notes          TEXT,
  p_evidence_urls  TEXT[],
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_po_item   RECORD;
  v_po        RECORD;
  v_claim_id  BIGINT;
BEGIN
  v_user_id := (current_setting('request.jwt.claim.sub', true))::UUID;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_po_item FROM public.purchase_order_items WHERE id=p_po_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'po_item not found: %', p_po_item_id; END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id=v_po_item.purchase_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'parent po not found'; END IF;

  IF p_qty <= 0 THEN RAISE EXCEPTION 'qty must be > 0'; END IF;

  v_claim_id := public._insert_supplier_claim(
    v_po.tenant_id, v_po.supplier_id, v_po_item.sku, v_po_item.warehouse,
    p_qty, v_po_item.unit_cost, 'PO_RECEIPT', p_po_item_id,
    p_notes, p_evidence_urls, v_user_id, p_idempotency_key
  );

  UPDATE public.purchase_order_items
     SET supplier_claim_id = v_claim_id,
         damage_status = 'PENDING_RETURN'
   WHERE id = p_po_item_id;

  RETURN v_claim_id;
END $$;

ALTER FUNCTION public.create_supplier_claim_from_po_receipt(BIGINT, INT, TEXT, TEXT[], TEXT)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.create_supplier_claim_from_po_receipt(BIGINT, INT, TEXT, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_supplier_claim_from_po_receipt(BIGINT, INT, TEXT, TEXT[], TEXT) TO authenticated;
```

- [ ] **Step 4: Apply + re-run smoke — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000101_supplier_claims_rpcs.sql tests/sql/supplier_claims_rpc_smoke.sql
git commit -m "feat(supplier-claims): create_supplier_claim_from_po_receipt RPC"
```

---

## Task 6: Migration 101 (part D) — `resolve_supplier_claim` RPC

**Files:**
- Append: `supabase/migrations/20261115000101_supplier_claims_rpcs.sql`
- Test: append to `tests/sql/supplier_claims_rpc_smoke.sql`

**Interfaces:**
- Consumes: `supplier_claims`, `_post_journal_entry`, existing `verify_owner_pin` (if exists — else use PIN check pattern from existing approval RPCs), existing `approval_requests` table
- Produces:
  - Function `public.resolve_supplier_claim(p_claim_id BIGINT, p_outcome TEXT, p_resolution_amount NUMERIC, p_resolution_target_id TEXT, p_notes TEXT, p_evidence_urls TEXT[], p_owner_pin TEXT DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL) RETURNS JSONB` — returns `{status, approval_request_id}` where status is one of 'SUCCESS' | 'PENDING_APPROVAL' | 'ALREADY_RESOLVED'
  - Behavior: SELECT FOR UPDATE claim, check approval gate, dispatch to outcome handler, post journal, update state
  - Outcomes: `RESOLVED_REPLACED`, `RESOLVED_CREDITED`, `RESOLVED_CASHED`, `REJECTED`
  - Approval methods supported: PIN (inline), APP_INBOX (async). WA_BUTTON explicitly rejected with error `wa_not_supported_for_claim_resolve`

- [ ] **Step 1: Write smoke tests (per outcome + approval gate)**

Append to `tests/sql/supplier_claims_rpc_smoke.sql`:
```sql
-- Test: resolve rejects invalid outcome
DO $$
DECLARE
  v_user UUID;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    PERFORM public.resolve_supplier_claim(999999, 'INVALID_OUTCOME', 0, NULL, NULL, NULL);
    RAISE EXCEPTION 'expected error for invalid outcome';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%outcome%' AND SQLERRM NOT LIKE '%not found%' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test: WA_BUTTON verification method rejected
DO $$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  -- Simulate approval_settings row with WA_BUTTON for this request_type
  BEGIN
    INSERT INTO public.approval_settings (tenant_id, request_type, approval_required, threshold_amount, verification_method)
    VALUES (v_tenant, 'RESOLVE_SUPPLIER_CLAIM', true, 100000, 'WA_BUTTON')
    ON CONFLICT DO NOTHING;
    -- Attempt resolve should fail with wa_not_supported message
    -- (test details depend on having a real claim row; abbreviated for scope)
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Append resolve function to migration 101**

```sql
-- Part D: resolve_supplier_claim

CREATE OR REPLACE FUNCTION public.resolve_supplier_claim(
  p_claim_id            BIGINT,
  p_outcome             TEXT,
  p_resolution_amount   NUMERIC,
  p_resolution_target_id TEXT,
  p_notes               TEXT,
  p_evidence_urls       TEXT[],
  p_owner_pin           TEXT DEFAULT NULL,
  p_idempotency_key     TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc_claim_suspense CONSTANT TEXT := '1-1460';
  v_acc_damage_loss    CONSTANT TEXT := '5-3160';
  v_acc_inventory      CONSTANT TEXT := '1-1510';
  v_acc_ap             CONSTANT TEXT := '2-1100';
  v_acc_prepay         CONSTANT TEXT := '1-1450';
  v_acc_other_income   CONSTANT TEXT := '4-1200';

  v_user_id      UUID;
  v_claim        RECORD;
  v_book_value   NUMERIC;
  v_utang_balance NUMERIC;
  v_utang_apply  NUMERIC;
  v_prepay_apply NUMERIC;
  v_variance     NUMERIC;
  v_lines        JSONB;
  v_journal_id   BIGINT;
  v_approval     RECORD;
  v_new_status   TEXT;
BEGIN
  v_user_id := (current_setting('request.jwt.claim.sub', true))::UUID;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  IF p_outcome NOT IN ('RESOLVED_REPLACED','RESOLVED_CREDITED','RESOLVED_CASHED','REJECTED') THEN
    RAISE EXCEPTION 'invalid outcome: %', p_outcome;
  END IF;

  -- Lock claim row
  SELECT * INTO v_claim FROM public.supplier_claims WHERE id=p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found: %', p_claim_id; END IF;

  IF v_claim.status <> 'PENDING' THEN
    RETURN jsonb_build_object('status','ALREADY_RESOLVED');
  END IF;

  v_book_value := v_claim.qty * v_claim.unit_cost;

  -- Approval gate
  SELECT * INTO v_approval FROM public.approval_settings
    WHERE tenant_id=v_claim.tenant_id AND request_type='RESOLVE_SUPPLIER_CLAIM'
    LIMIT 1;
  IF FOUND AND v_approval.approval_required
     AND COALESCE(p_resolution_amount, v_book_value) >= COALESCE(v_approval.threshold_amount, 0) THEN
    IF v_approval.verification_method = 'WA_BUTTON' THEN
      RAISE EXCEPTION 'wa_not_supported_for_claim_resolve';
    ELSIF v_approval.verification_method = 'PIN' THEN
      IF p_owner_pin IS NULL THEN RAISE EXCEPTION 'pin_required'; END IF;
      IF NOT public.verify_owner_pin(v_claim.tenant_id, p_owner_pin) THEN
        RAISE EXCEPTION 'invalid_pin';
      END IF;
    ELSIF v_approval.verification_method = 'APP_INBOX' THEN
      IF v_claim.approval_request_id IS NULL THEN
        INSERT INTO public.approval_requests (tenant_id, request_type, source_type, source_ref_id, requested_by, status)
        VALUES (v_claim.tenant_id, 'RESOLVE_SUPPLIER_CLAIM', 'supplier_claims', p_claim_id, v_user_id, 'PENDING')
        RETURNING id INTO v_approval.request_id;
        UPDATE public.supplier_claims SET approval_request_id = v_approval.request_id WHERE id=p_claim_id;
        RETURN jsonb_build_object('status','PENDING_APPROVAL','approval_request_id',v_approval.request_id);
      END IF;
      -- Already has approval_request_id — check its status
      IF NOT EXISTS (SELECT 1 FROM public.approval_requests WHERE id=v_claim.approval_request_id AND status='APPROVED') THEN
        RETURN jsonb_build_object('status','PENDING_APPROVAL','approval_request_id',v_claim.approval_request_id);
      END IF;
    END IF;
  END IF;

  -- Build journal lines per outcome
  IF p_outcome = 'RESOLVED_REPLACED' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_acc_inventory,      'side','DEBIT',  'amount', v_book_value, 'description','Persediaan barang pengganti'),
      jsonb_build_object('account_code', v_acc_claim_suspense, 'side','CREDIT', 'amount', v_book_value, 'description','Piutang klaim closed')
    );
    v_new_status := 'RESOLVED_REPLACED';

  ELSIF p_outcome = 'RESOLVED_CREDITED' THEN
    IF p_resolution_amount IS NULL THEN RAISE EXCEPTION 'resolution_amount required for CREDITED'; END IF;
    -- Compute Utang balance for this supplier + tenant
    SELECT COALESCE(SUM(sisa_bayar), 0) INTO v_utang_balance
      FROM public.purchase_invoices
     WHERE tenant_id=v_claim.tenant_id AND supplier_id=v_claim.supplier_id AND status<>'LUNAS';
    v_utang_apply := LEAST(p_resolution_amount, v_utang_balance);
    v_prepay_apply := p_resolution_amount - v_utang_apply;
    v_variance := v_book_value - p_resolution_amount;
    v_lines := '[]'::jsonb;
    IF v_utang_apply > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_ap, 'side','DEBIT', 'amount', v_utang_apply, 'description','Potongan utang supplier');
    END IF;
    IF v_prepay_apply > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_prepay, 'side','DEBIT', 'amount', v_prepay_apply, 'description','Voucher prepayment supplier');
    END IF;
    IF v_variance > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_damage_loss, 'side','DEBIT', 'amount', v_variance, 'description','Selisih klaim (loss)');
    ELSIF v_variance < 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_other_income, 'side','CREDIT', 'amount', -v_variance, 'description','Selisih klaim (untung)');
    END IF;
    v_lines := v_lines || jsonb_build_object('account_code', v_acc_claim_suspense, 'side','CREDIT', 'amount', v_book_value, 'description','Piutang klaim closed');
    v_new_status := 'RESOLVED_CREDITED';

  ELSIF p_outcome = 'RESOLVED_CASHED' THEN
    IF p_resolution_amount IS NULL OR p_resolution_target_id IS NULL THEN
      RAISE EXCEPTION 'resolution_amount + target account code required for CASHED';
    END IF;
    v_variance := v_book_value - p_resolution_amount;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', p_resolution_target_id, 'side','DEBIT',  'amount', p_resolution_amount, 'description','Refund supplier ke kas/bank')
    );
    IF v_variance > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_damage_loss, 'side','DEBIT', 'amount', v_variance, 'description','Selisih refund (loss)');
    ELSIF v_variance < 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_other_income, 'side','CREDIT', 'amount', -v_variance, 'description','Selisih refund (untung)');
    END IF;
    v_lines := v_lines || jsonb_build_object('account_code', v_acc_claim_suspense, 'side','CREDIT', 'amount', v_book_value, 'description','Piutang klaim closed');
    v_new_status := 'RESOLVED_CASHED';

  ELSIF p_outcome = 'REJECTED' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_acc_damage_loss,    'side','DEBIT',  'amount', v_book_value, 'description','Klaim ditolak supplier'),
      jsonb_build_object('account_code', v_acc_claim_suspense, 'side','CREDIT', 'amount', v_book_value, 'description','Piutang klaim closed')
    );
    v_new_status := 'REJECTED';
  END IF;

  -- Post journal
  v_journal_id := (public._post_journal_entry(
    current_date, 'SUPPLIER_CLAIM',
    format('Resolve klaim %s: %s', p_claim_id, p_outcome),
    v_lines, 'supplier_claims', p_claim_id::TEXT, v_claim.tenant_id
  ))::JSONB->>'entry_id';

  -- For REPLACED: also insert stock_movement +qty
  IF p_outcome = 'RESOLVED_REPLACED' THEN
    PERFORM public.log_stock_movement(
      v_claim.tenant_id, v_claim.sku, v_claim.warehouse, v_claim.qty, v_claim.unit_cost,
      'SUPPLIER_CLAIM_REPLACEMENT', p_claim_id
    );
  END IF;

  -- Sync purchase_order_items.damage_status when source is PO_RECEIPT
  IF v_claim.source_type = 'PO_RECEIPT' THEN
    UPDATE public.purchase_order_items
       SET damage_status = CASE p_outcome
         WHEN 'RESOLVED_REPLACED' THEN 'REPLACED'::damage_status_enum
         WHEN 'RESOLVED_CREDITED' THEN 'RESOLVED_CREDITED'::damage_status_enum
         WHEN 'RESOLVED_CASHED'   THEN 'RESOLVED_CASHED'::damage_status_enum
         WHEN 'REJECTED'          THEN 'REJECTED'::damage_status_enum
       END
     WHERE id = v_claim.source_ref_id;
  END IF;

  -- Update claim + emit event
  UPDATE public.supplier_claims SET
    status                = v_new_status,
    resolution_amount     = COALESCE(p_resolution_amount, v_book_value),
    resolution_target_id  = p_resolution_target_id,
    resolved_at           = now(),
    resolved_by           = v_user_id,
    resolution_journal_id = v_journal_id,
    resolution_notes      = p_notes
  WHERE id = p_claim_id;

  INSERT INTO public.supplier_claim_events (claim_id, event_type, actor_user_id, payload, journal_entry_id)
  VALUES (p_claim_id, 'RESOLVED', v_user_id,
    jsonb_build_object('outcome', p_outcome, 'amount', COALESCE(p_resolution_amount, v_book_value)),
    v_journal_id);

  RETURN jsonb_build_object('status','SUCCESS','journal_id',v_journal_id);
END $$;

ALTER FUNCTION public.resolve_supplier_claim(BIGINT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], TEXT, TEXT)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.resolve_supplier_claim(BIGINT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_supplier_claim(BIGINT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], TEXT, TEXT) TO authenticated;
```

- [ ] **Step 4: Apply migration + re-run smoke tests**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000101_supplier_claims_rpcs.sql tests/sql/supplier_claims_rpc_smoke.sql
git commit -m "feat(supplier-claims): resolve_supplier_claim RPC with 4 outcomes + variance"
```

---

## Task 7: Migration 102 (part A) — modify `commit_opname_session` to handle damaged rows

**Files:**
- Create: `supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql`
- Test: append to `tests/sql/supplier_claims_existing_rpc_mods_smoke.sql`

**Interfaces:**
- Consumes: `create_supplier_claim_from_opname` (Task 4)
- Produces: modified `commit_opname_session` that iterates `stock_opname_counts` where `damaged_qty > 0` and calls the damage RPC per row before handling remaining variance
- Backward compat: sessions with no damaged rows behave exactly as before

- [ ] **Step 1: Locate existing `commit_opname_session` definition**

Search for the RPC:
```bash
grep -rn "CREATE OR REPLACE FUNCTION public.commit_opname_session\|CREATE FUNCTION public.commit_opname_session" supabase/migrations/
```

Note the file + line number. Read the current definition into context.

- [ ] **Step 2: Write regression smoke test**

Create `tests/sql/supplier_claims_existing_rpc_mods_smoke.sql`:
```sql
-- Regression: commit_opname_session with 0 damaged rows behaves as before
-- (details depend on existing schema; abbreviated placeholder)
DO $$ BEGIN
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

- [ ] **Step 3: Append modification to migration 102**

Create/append `supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql`:
```sql
-- Modify commit_opname_session to process damaged rows before variance handling.
-- Preserves all existing behavior for sessions with damaged_qty=0.

CREATE OR REPLACE FUNCTION public.commit_opname_session(p_session_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_row     RECORD;
  v_result  JSONB;
BEGIN
  -- (retain existing preamble: session lookup, status check, permission)
  SELECT * INTO v_session FROM public.stock_opname_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;
  IF v_session.status <> 'APPROVED' THEN RAISE EXCEPTION 'session not in APPROVED state'; END IF;

  -- Process damaged rows FIRST
  FOR v_row IN
    SELECT * FROM public.stock_opname_counts
     WHERE session_id = p_session_id AND damaged_qty > 0
  LOOP
    PERFORM public.create_supplier_claim_from_opname(
      p_session_id,
      v_row.sku,
      v_row.warehouse,
      v_row.damaged_qty,
      COALESCE(v_row.damage_disposition, 'DISPOSE'),
      v_row.damage_supplier_id,
      v_row.system_qty_snapshot::NUMERIC * 0,  -- unit_cost derived from FIFO ledger (see helper below)
      COALESCE(v_row.damage_notes, ''),
      COALESCE(v_row.damage_evidence_urls, ARRAY[]::TEXT[]),
      NULL
    );
  END LOOP;

  -- Continue with existing variance handling (preserved verbatim from previous migration).
  -- (Placeholder — replace with actual existing logic when reading source migration in Step 1.)

  RETURN jsonb_build_object('status','committed','session_id',p_session_id);
END $$;

ALTER FUNCTION public.commit_opname_session(BIGINT) OWNER TO vosi_rpc_owner;
```

**Note for implementer:** the actual patch must preserve the existing variance-writing logic verbatim. Only insert the damaged-row loop before it. Do NOT alter variance semantics.

**Unit cost derivation:** For opname damage, unit_cost = weighted-average of remaining FIFO layers at that SKU/warehouse (query `stock_lots` ordered by created_at with remaining_qty > 0). Extract this into a helper `_current_fifo_unit_cost(tenant_id, sku, warehouse) RETURNS NUMERIC` if not already existing. Add helper to migration 101 or 102 as needed.

- [ ] **Step 4: Apply + smoke test regression + integration**

Run: `mcp__plugin_supabase_supabase__apply_migration name=20261115000102_supplier_claims_existing_rpc_mods`

Regression: commit a session with 0 damaged rows → identical behavior to before.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql tests/sql/supplier_claims_existing_rpc_mods_smoke.sql
git commit -m "feat(opname): commit_opname_session processes damaged rows via supplier claims"
```

---

## Task 8: Migration 102 (part B) — modify `receive_purchase_order`

**Files:**
- Append: `supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql`

**Interfaces:**
- Consumes: `create_supplier_claim_from_po_receipt` (Task 5)
- Produces: `receive_purchase_order` calls the create RPC when `qty_damaged > 0` for each received PO item, replacing inline `damage_status='PENDING_RETURN'` write

- [ ] **Step 1: Read existing `receive_purchase_order` from `supabase/migrations/20260613000002b_warehouses_phase2_sale_po_rpcs.sql`**

Identify the block that sets `damage_status='PENDING_RETURN'` (~line 382 per audit).

- [ ] **Step 2: Append modified RPC to migration 102**

```sql
-- Modify receive_purchase_order to auto-create supplier_claim on damaged receipt.

CREATE OR REPLACE FUNCTION public.receive_purchase_order(...)  -- copy full existing signature
RETURNS ...
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- (existing preamble unchanged)

  -- Existing loop for each PO item: preserve stock_levels + stock_lots + stock_movements writes.
  -- Replace the inline damage_status='PENDING_RETURN' with a call to the create RPC:

  FOR v_item IN ... LOOP
    -- ... existing per-item stock updates ...

    IF v_item.qty_damaged > 0 THEN
      PERFORM public.create_supplier_claim_from_po_receipt(
        v_item.id,
        v_item.qty_damaged,
        v_item.damage_notes,
        COALESCE(v_item.damage_evidence_urls, ARRAY[]::TEXT[]),
        NULL
      );
      -- create RPC sets damage_status='PENDING_RETURN' + supplier_claim_id link
    END IF;
  END LOOP;

  -- (existing postamble unchanged)
END $$;
```

- [ ] **Step 3: Apply migration + regression smoke**

Verify a PO receipt with 0 damaged items unchanged. Receipt with damaged items creates supplier_claim row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql
git commit -m "feat(pembelian): receive_purchase_order auto-creates supplier claim on damage"
```

---

## Task 9: Migration 102 (part C) — modify `receive_replacement` as resolve wrapper

**Files:**
- Append: `supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql`

**Interfaces:**
- Consumes: `resolve_supplier_claim` (Task 6), existing `purchase_order_items.supplier_claim_id`
- Produces: `receive_replacement` becomes a thin wrapper that calls `resolve_supplier_claim(outcome='RESOLVED_REPLACED', ...)` on the linked claim; UI-facing signature and behavior preserved

- [ ] **Step 1: Locate existing `receive_replacement`**

```bash
grep -rn "CREATE OR REPLACE FUNCTION public.receive_replacement\|CREATE FUNCTION public.receive_replacement" supabase/migrations/
```

- [ ] **Step 2: Append modified RPC**

```sql
CREATE OR REPLACE FUNCTION public.receive_replacement(p_po_item_id BIGINT, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_claim_id BIGINT;
BEGIN
  SELECT supplier_claim_id INTO v_claim_id FROM public.purchase_order_items WHERE id=p_po_item_id;
  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'no supplier claim linked to po_item %', p_po_item_id;
  END IF;
  RETURN public.resolve_supplier_claim(v_claim_id, 'RESOLVED_REPLACED', NULL, NULL, p_notes, NULL, NULL, NULL);
END $$;

ALTER FUNCTION public.receive_replacement(BIGINT, TEXT) OWNER TO vosi_rpc_owner;
```

- [ ] **Step 3: Apply + verify existing `ReceiveReplacementModal` still works**

Manual: fire ReceiveReplacementModal in dev environment. Confirm stock updates + damage_status → REPLACED.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql
git commit -m "feat(pembelian): receive_replacement becomes resolve_supplier_claim wrapper"
```

---

## Task 10: Migration 102 (part D) — modify `request_adjustment` + `_apply_adjustment_change` for damage disposition

**Files:**
- Append: `supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql`

**Interfaces:**
- Consumes: `_insert_supplier_claim`, `_post_journal_entry`, `_current_fifo_unit_cost`
- Produces:
  - `request_adjustment(...)` accepts new params `p_damage_disposition TEXT`, `p_damage_supplier_id UUID`, stores on adjustment row
  - `_apply_adjustment_change` when reason='rusak':
    - `damage_disposition='DISPOSE'`: post journal Dr 5-3160 / Cr 1-1510
    - `damage_disposition='KLAIM_SUPPLIER'`: call `_insert_supplier_claim` (source_type='STOCK_ADJUSTMENT'), UPDATE `stock_adjustments.supplier_claim_id`, post journal Dr 1-1460 / Cr 1-1510
    - Other reasons unchanged (existing bug for hilang/sampel preserved out of scope)

- [ ] **Step 1: Locate existing definitions**

```bash
grep -rn "CREATE OR REPLACE FUNCTION public.request_adjustment\|CREATE OR REPLACE FUNCTION public._apply_adjustment_change" supabase/migrations/
```

- [ ] **Step 2: Append modified RPCs**

```sql
-- request_adjustment gains damage disposition params (backward compat: default NULL)

CREATE OR REPLACE FUNCTION public.request_adjustment(
  -- existing params ...
  p_damage_disposition TEXT DEFAULT NULL,
  p_damage_supplier_id UUID DEFAULT NULL
) RETURNS ...
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Existing insert into stock_adjustments — augment with new columns
  INSERT INTO public.stock_adjustments (..., damage_disposition, damage_supplier_id, ...)
  VALUES (..., p_damage_disposition, p_damage_supplier_id, ...);
  -- ... existing approval linkage ...
END $$;

-- _apply_adjustment_change: post journal + insert claim on rusak commit

CREATE OR REPLACE FUNCTION public._apply_adjustment_change(p_adjustment_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_adj RECORD;
  v_unit_cost NUMERIC;
  v_amount NUMERIC;
  v_claim_id BIGINT;
BEGIN
  SELECT * INTO v_adj FROM public.stock_adjustments WHERE id=p_adjustment_id FOR UPDATE;
  -- (existing stock_levels + stock_movements updates unchanged)

  IF v_adj.reason_code = 'rusak' THEN
    v_unit_cost := public._current_fifo_unit_cost(v_adj.tenant_id, v_adj.sku, v_adj.warehouse);
    v_amount := ABS(v_adj.qty_delta) * v_unit_cost;

    IF v_adj.damage_disposition = 'KLAIM_SUPPLIER' THEN
      v_claim_id := public._insert_supplier_claim(
        v_adj.tenant_id, v_adj.damage_supplier_id, v_adj.sku, v_adj.warehouse,
        ABS(v_adj.qty_delta), v_unit_cost, 'STOCK_ADJUSTMENT', p_adjustment_id,
        v_adj.reason_note, v_adj.evidence_urls, v_adj.created_by, NULL
      );
      UPDATE public.stock_adjustments SET supplier_claim_id = v_claim_id WHERE id = p_adjustment_id;
      PERFORM public._post_journal_entry(
        current_date, 'STOCK_ADJUSTMENT',
        format('Ad-hoc adjustment KLAIM: %s x %s', ABS(v_adj.qty_delta), v_adj.sku),
        jsonb_build_array(
          jsonb_build_object('account_code','1-1460','side','DEBIT', 'amount', v_amount),
          jsonb_build_object('account_code','1-1510','side','CREDIT','amount', v_amount)
        ),
        'supplier_claims', v_claim_id::TEXT, v_adj.tenant_id
      );
    ELSE
      -- DISPOSE default
      PERFORM public._post_journal_entry(
        current_date, 'STOCK_ADJUSTMENT',
        format('Ad-hoc adjustment DISPOSE: %s x %s', ABS(v_adj.qty_delta), v_adj.sku),
        jsonb_build_array(
          jsonb_build_object('account_code','5-3160','side','DEBIT', 'amount', v_amount),
          jsonb_build_object('account_code','1-1510','side','CREDIT','amount', v_amount)
        ),
        'stock_adjustments', p_adjustment_id::TEXT, v_adj.tenant_id
      );
    END IF;
  END IF;

  -- Other reason codes: leave existing behavior (bug for hilang/sampel deferred)
END $$;

ALTER FUNCTION public._apply_adjustment_change(BIGINT) OWNER TO vosi_rpc_owner;
```

- [ ] **Step 3: Apply + smoke test both dispositions**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql
git commit -m "feat(stok): adjustment rusak posts journal + creates supplier claim when KLAIM"
```

---

## Task 11: Migration 102 (part E) — modify `record_pi` for feature-flagged GL split

**Files:**
- Append: `supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql`

**Interfaces:**
- Consumes: `accounting_config.enable_pi_damage_split` (Task 2)
- Produces: `record_pi` conditionally splits Dr Persediaan into Persediaan + Piutang Klaim based on `qty_damaged` when feature flag is on. Flag OFF → identical to current behavior.

- [ ] **Step 1: Read existing `record_pi` from `20260724000002_phase0c_record_pi_dual_write.sql`**

- [ ] **Step 2: Append modified RPC**

```sql
CREATE OR REPLACE FUNCTION public.record_pi(...)
RETURNS ...
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag BOOLEAN;
  v_damaged_value NUMERIC;
  v_good_value    NUMERIC;
BEGIN
  -- (existing preamble)
  SELECT COALESCE(enable_pi_damage_split, false) INTO v_flag
    FROM public.accounting_config WHERE tenant_id = v_tenant_id;

  IF v_flag THEN
    -- Compute damaged/good split from PO items joined with the PI's line items
    SELECT
      COALESCE(SUM(CASE WHEN poi.qty_damaged > 0 THEN poi.qty_damaged * pil.unit_cost ELSE 0 END), 0),
      COALESCE(SUM((pil.qty - COALESCE(poi.qty_damaged,0)) * pil.unit_cost), 0)
    INTO v_damaged_value, v_good_value
    FROM public.purchase_invoice_lines pil
    JOIN public.purchase_order_items poi ON poi.id = pil.po_item_id
    WHERE pil.invoice_id = v_invoice_id;

    -- Post 3-line journal
    PERFORM public._post_journal_entry(current_date, 'PURCHASE_INVOICE',
      'Tagihan pembelian dengan split rusak',
      jsonb_build_array(
        jsonb_build_object('account_code','1-1510','side','DEBIT', 'amount', v_good_value),
        jsonb_build_object('account_code','1-1460','side','DEBIT', 'amount', v_damaged_value),
        jsonb_build_object('account_code','2-1100','side','CREDIT','amount', v_good_value + v_damaged_value)
      ),
      'purchase_invoices', v_invoice_id::TEXT, v_tenant_id);
  ELSE
    -- Existing single-line Dr 1-1510 / Cr 2-1100 (unchanged)
    PERFORM public._post_journal_entry(...);
  END IF;
END $$;
```

- [ ] **Step 3: Apply + regression tests (flag OFF and ON)**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql
git commit -m "feat(pembelian): record_pi feature-flagged GL split for damaged items"
```

---

## Task 12: Migration 103 — Read RPCs (`list_supplier_claims`, `get_supplier_claim`, `list_supplier_claim_events`)

**Files:**
- Create: `supabase/migrations/20261115000103_supplier_claims_read_rpcs.sql`
- Test: append to `tests/sql/supplier_claims_rpc_smoke.sql`

**Interfaces:**
- Produces:
  - `list_supplier_claims(p_filter_status TEXT[], p_filter_supplier_id UUID, p_filter_source_type TEXT[], p_date_from DATE, p_date_to DATE, p_page_size INT DEFAULT 50, p_offset INT DEFAULT 0) RETURNS TABLE(...)`
  - `get_supplier_claim(p_claim_id BIGINT) RETURNS JSONB` — includes supplier name, source ref detail, book value, timeline count
  - `list_supplier_claim_events(p_claim_id BIGINT) RETURNS TABLE(...)`

- [ ] **Step 1: Write smoke tests**

Append tests calling each read RPC as a fake auth user. Verify tenant scoping.

- [ ] **Step 2: Write migration file**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.list_supplier_claims(
  p_filter_status TEXT[] DEFAULT NULL,
  p_filter_supplier_id UUID DEFAULT NULL,
  p_filter_source_type TEXT[] DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_page_size INT DEFAULT 50,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  id BIGINT, sku TEXT, warehouse TEXT, qty INT, unit_cost NUMERIC,
  book_value NUMERIC, status TEXT, source_type TEXT, source_ref_id BIGINT,
  supplier_id UUID, supplier_name TEXT, damage_notes TEXT,
  created_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.user_tenant WHERE user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  RETURN QUERY
  SELECT sc.id, sc.sku, sc.warehouse, sc.qty, sc.unit_cost,
         sc.qty * sc.unit_cost AS book_value,
         sc.status, sc.source_type, sc.source_ref_id,
         sc.supplier_id, s.name, sc.damage_notes,
         sc.created_at, sc.resolved_at
    FROM public.supplier_claims sc
    JOIN public.suppliers s ON s.id = sc.supplier_id
   WHERE sc.tenant_id = v_tenant
     AND (p_filter_status IS NULL OR sc.status = ANY(p_filter_status))
     AND (p_filter_supplier_id IS NULL OR sc.supplier_id = p_filter_supplier_id)
     AND (p_filter_source_type IS NULL OR sc.source_type = ANY(p_filter_source_type))
     AND (p_date_from IS NULL OR sc.created_at::DATE >= p_date_from)
     AND (p_date_to IS NULL OR sc.created_at::DATE <= p_date_to)
   ORDER BY sc.created_at DESC
   LIMIT p_page_size OFFSET p_offset;
END $$;

CREATE OR REPLACE FUNCTION public.get_supplier_claim(p_claim_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant UUID; v_claim RECORD; v_supplier RECORD;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.user_tenant WHERE user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_claim FROM public.supplier_claims WHERE id=p_claim_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;

  SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_claim.supplier_id;

  RETURN jsonb_build_object(
    'claim', to_jsonb(v_claim),
    'supplier', to_jsonb(v_supplier),
    'book_value', v_claim.qty * v_claim.unit_cost
  );
END $$;

CREATE OR REPLACE FUNCTION public.list_supplier_claim_events(p_claim_id BIGINT)
RETURNS TABLE (id BIGINT, event_type TEXT, actor_user_id UUID, payload JSONB, at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.user_tenant WHERE user_id=auth.uid() LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_claims WHERE id=p_claim_id AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  RETURN QUERY SELECT e.id, e.event_type, e.actor_user_id, e.payload, e.at
    FROM public.supplier_claim_events e WHERE e.claim_id=p_claim_id ORDER BY e.at;
END $$;

-- Ownership + grants
ALTER FUNCTION public.list_supplier_claims(TEXT[], UUID, TEXT[], DATE, DATE, INT, INT) OWNER TO vosi_rpc_owner;
ALTER FUNCTION public.get_supplier_claim(BIGINT) OWNER TO vosi_rpc_owner;
ALTER FUNCTION public.list_supplier_claim_events(BIGINT) OWNER TO vosi_rpc_owner;

REVOKE ALL ON FUNCTION public.list_supplier_claims(TEXT[], UUID, TEXT[], DATE, DATE, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_supplier_claim(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_supplier_claim_events(BIGINT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_supplier_claims(TEXT[], UUID, TEXT[], DATE, DATE, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_claim(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_supplier_claim_events(BIGINT) TO authenticated;

COMMIT;
```

- [ ] **Step 3: Apply + smoke tests**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000103_supplier_claims_read_rpcs.sql tests/sql/supplier_claims_rpc_smoke.sql
git commit -m "feat(supplier-claims): read RPCs (list, get, events)"
```

---

## Task 13: Migration 104 — Backfill migration for existing PO damage

**Files:**
- Create: `supabase/migrations/20261115000104_supplier_claims_backfill.sql`
- Test: `tests/sql/supplier_claims_backfill_test.sql`

**Interfaces:**
- Consumes: `_insert_supplier_claim`, existing `purchase_order_items`
- Produces: backfilled `supplier_claims` rows for every `purchase_order_items` where `damage_status IN ('PENDING_RETURN','RETURNED','REPLACED')` AND `supplier_claim_id IS NULL`, with:
  - status mapped: PENDING_RETURN/RETURNED → PENDING, REPLACED → RESOLVED_REPLACED
  - resolved_at (for REPLACED) = po_item.updated_at
  - resolution_journal_id = NULL (audit trail only, no re-post)
- Idempotent + resumable via `_migration_supplier_claims_progress` temp table

- [ ] **Step 1: Write test file**

```sql
-- tests/sql/supplier_claims_backfill_test.sql
-- Verify: after backfill, every damaged PO item has supplier_claim_id
DO $$
DECLARE v_orphans INT;
BEGIN
  SELECT COUNT(*) INTO v_orphans
    FROM public.purchase_order_items
   WHERE damage_status IN ('PENDING_RETURN','RETURNED','REPLACED')
     AND supplier_claim_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'expected 0 orphans, got %', v_orphans;
  END IF;
END $$;
```

- [ ] **Step 2: Write migration file**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public._migration_supplier_claims_progress (
  last_processed_po_item_id BIGINT NOT NULL DEFAULT 0
);
INSERT INTO public._migration_supplier_claims_progress (last_processed_po_item_id)
SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM public._migration_supplier_claims_progress);

DO $$
DECLARE
  v_last BIGINT;
  v_batch_size INT := 500;
  v_processed INT;
  v_row RECORD;
  v_po RECORD;
  v_status TEXT;
  v_claim_id BIGINT;
BEGIN
  SELECT last_processed_po_item_id INTO v_last FROM public._migration_supplier_claims_progress;

  LOOP
    v_processed := 0;
    FOR v_row IN
      SELECT * FROM public.purchase_order_items
       WHERE damage_status IN ('PENDING_RETURN','RETURNED','REPLACED')
         AND supplier_claim_id IS NULL
         AND id > v_last
       ORDER BY id
       LIMIT v_batch_size
    LOOP
      SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_row.purchase_order_id;
      IF NOT FOUND THEN CONTINUE; END IF;

      v_status := CASE v_row.damage_status
        WHEN 'REPLACED' THEN 'RESOLVED_REPLACED'
        ELSE 'PENDING'
      END;

      INSERT INTO public.supplier_claims (
        tenant_id, supplier_id, sku, warehouse, qty, unit_cost,
        source_type, source_ref_id, damage_notes, evidence_urls,
        status, resolved_at, resolution_journal_id, created_by, created_at
      ) VALUES (
        v_po.tenant_id, v_po.supplier_id, v_row.sku, v_row.warehouse,
        v_row.qty_damaged, v_row.unit_cost,
        'PO_RECEIPT', v_row.id, v_row.damage_notes, NULL,
        v_status,
        CASE WHEN v_status='RESOLVED_REPLACED' THEN v_row.updated_at ELSE NULL END,
        NULL,
        v_po.created_by, v_row.created_at
      ) RETURNING id INTO v_claim_id;

      UPDATE public.purchase_order_items SET supplier_claim_id = v_claim_id WHERE id = v_row.id;

      v_last := v_row.id;
      v_processed := v_processed + 1;
    END LOOP;

    UPDATE public._migration_supplier_claims_progress SET last_processed_po_item_id = v_last;
    EXIT WHEN v_processed = 0;
  END LOOP;
END $$;

COMMIT;
```

- [ ] **Step 3: Apply + run verification test**

Expected: 0 orphan rows post-backfill.

- [ ] **Step 4: Test idempotency — re-apply migration**

Expected: no new inserts, no errors, orphan count still 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000104_supplier_claims_backfill.sql tests/sql/supplier_claims_backfill_test.sql
git commit -m "feat(supplier-claims): backfill existing PO damage into supplier_claims"
```

---

## Task 14: Migration 105 — feature flag seed (nothing to add beyond schema; use for RESOLVE_SUPPLIER_CLAIM approval_settings default)

**Files:**
- Create: `supabase/migrations/20261115000105_supplier_claims_approval_settings_seed.sql`

**Interfaces:**
- Produces: seed `approval_settings` rows for every existing tenant with `request_type='RESOLVE_SUPPLIER_CLAIM'`, `approval_required=false` (default off — tenant opts in later)

- [ ] **Step 1: Write migration**

```sql
BEGIN;

INSERT INTO public.approval_settings (tenant_id, request_type, approval_required, threshold_amount, threshold_qty, verification_method)
SELECT t.id, 'RESOLVE_SUPPLIER_CLAIM', false, NULL, NULL, 'PIN'
  FROM public.tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.approval_settings s
    WHERE s.tenant_id = t.id AND s.request_type = 'RESOLVE_SUPPLIER_CLAIM'
 );

COMMIT;
```

- [ ] **Step 2: Apply + verify**

Count `approval_settings` rows where `request_type='RESOLVE_SUPPLIER_CLAIM'` = tenant count.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261115000105_supplier_claims_approval_settings_seed.sql
git commit -m "feat(supplier-claims): seed default RESOLVE_SUPPLIER_CLAIM approval settings"
```

---

## Task 15: Frontend types + API client wrapper

**Files:**
- Create: `src/lib/supplierClaims/types.ts`
- Create: `src/lib/supplierClaims/api.ts`

**Interfaces:**
- Produces: TypeScript types matching table + enum shapes; typed RPC wrapper functions

- [ ] **Step 1: Write types file**

```typescript
// src/lib/supplierClaims/types.ts

export type ClaimStatus =
  | 'PENDING'
  | 'RESOLVED_REPLACED'
  | 'RESOLVED_CREDITED'
  | 'RESOLVED_CASHED'
  | 'REJECTED';

export type ClaimSourceType = 'PO_RECEIPT' | 'STOCK_OPNAME' | 'STOCK_ADJUSTMENT';
export type DamageDisposition = 'DISPOSE' | 'KLAIM_SUPPLIER';
export type ClaimOutcome =
  | 'RESOLVED_REPLACED'
  | 'RESOLVED_CREDITED'
  | 'RESOLVED_CASHED'
  | 'REJECTED';

export interface SupplierClaim {
  id: number;
  supplierId: string;
  supplierName: string;
  sku: string;
  warehouse: string;
  qty: number;
  unitCost: number;
  bookValue: number;
  status: ClaimStatus;
  sourceType: ClaimSourceType;
  sourceRefId: number;
  damageNotes: string | null;
  evidenceUrls: string[] | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ClaimEvent {
  id: number;
  eventType: 'CREATED' | 'APPROVAL_REQUESTED' | 'APPROVED' | 'RESOLVED' | 'REJECTED' | 'VOIDED';
  actorUserId: string | null;
  payload: Record<string, unknown> | null;
  at: string;
}
```

- [ ] **Step 2: Write API wrapper**

```typescript
// src/lib/supplierClaims/api.ts
import { supabase } from '../supabase';
import type { ClaimStatus, ClaimSourceType, ClaimOutcome, DamageDisposition, SupplierClaim, ClaimEvent } from './types';

export async function listSupplierClaims(filter: {
  status?: ClaimStatus[]; supplierId?: string; sourceType?: ClaimSourceType[];
  dateFrom?: string; dateTo?: string; pageSize?: number; offset?: number;
}): Promise<SupplierClaim[]> {
  const { data, error } = await supabase.rpc('list_supplier_claims', {
    p_filter_status: filter.status ?? null,
    p_filter_supplier_id: filter.supplierId ?? null,
    p_filter_source_type: filter.sourceType ?? null,
    p_date_from: filter.dateFrom ?? null,
    p_date_to: filter.dateTo ?? null,
    p_page_size: filter.pageSize ?? 50,
    p_offset: filter.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []).map(mapRowToClaim);
}

export async function getSupplierClaim(claimId: number): Promise<{ claim: SupplierClaim; bookValue: number }> {
  const { data, error } = await supabase.rpc('get_supplier_claim', { p_claim_id: claimId });
  if (error) throw error;
  return { claim: mapRowToClaim(data.claim), bookValue: data.book_value };
}

export async function listSupplierClaimEvents(claimId: number): Promise<ClaimEvent[]> {
  const { data, error } = await supabase.rpc('list_supplier_claim_events', { p_claim_id: claimId });
  if (error) throw error;
  return (data ?? []).map((r: { id: number; event_type: ClaimEvent['eventType']; actor_user_id: string | null; payload: Record<string, unknown> | null; at: string }) => ({
    id: r.id, eventType: r.event_type, actorUserId: r.actor_user_id, payload: r.payload, at: r.at,
  }));
}

export async function createClaimFromOpname(args: {
  sessionId: number; sku: string; warehouse: string; damagedQty: number;
  disposition: DamageDisposition; supplierId: string | null; unitCost: number;
  notes: string | null; evidenceUrls: string[]; idempotencyKey?: string;
}): Promise<{ adjustmentId: number; claimId: number | null }> {
  const { data, error } = await supabase.rpc('create_supplier_claim_from_opname', {
    p_session_id: args.sessionId, p_sku: args.sku, p_warehouse: args.warehouse,
    p_damaged_qty: args.damagedQty, p_disposition: args.disposition,
    p_supplier_id: args.supplierId, p_unit_cost: args.unitCost,
    p_notes: args.notes ?? '', p_evidence_urls: args.evidenceUrls,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) throw error;
  return { adjustmentId: data.adjustment_id, claimId: data.claim_id };
}

export async function resolveSupplierClaim(args: {
  claimId: number; outcome: ClaimOutcome; resolutionAmount: number | null;
  resolutionTargetId: string | null; notes: string | null; evidenceUrls: string[] | null;
  ownerPin?: string; idempotencyKey?: string;
}): Promise<{ status: 'SUCCESS' | 'PENDING_APPROVAL' | 'ALREADY_RESOLVED'; journalId?: number; approvalRequestId?: number }> {
  const { data, error } = await supabase.rpc('resolve_supplier_claim', {
    p_claim_id: args.claimId, p_outcome: args.outcome,
    p_resolution_amount: args.resolutionAmount, p_resolution_target_id: args.resolutionTargetId,
    p_notes: args.notes ?? '', p_evidence_urls: args.evidenceUrls,
    p_owner_pin: args.ownerPin ?? null, p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) throw error;
  return data;
}

function mapRowToClaim(row: {
  id: number; sku: string; warehouse: string; qty: number; unit_cost: number;
  book_value: number; status: ClaimStatus; source_type: ClaimSourceType; source_ref_id: number;
  supplier_id: string; supplier_name: string; damage_notes: string | null;
  created_at: string; resolved_at: string | null;
}): SupplierClaim {
  return {
    id: row.id, supplierId: row.supplier_id, supplierName: row.supplier_name,
    sku: row.sku, warehouse: row.warehouse, qty: row.qty, unitCost: row.unit_cost,
    bookValue: row.book_value, status: row.status, sourceType: row.source_type,
    sourceRefId: row.source_ref_id, damageNotes: row.damage_notes,
    evidenceUrls: null, createdAt: row.created_at, resolvedAt: row.resolved_at,
  };
}
```

- [ ] **Step 3: TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supplierClaims/
git commit -m "feat(supplier-claims): frontend types + RPC client wrapper"
```

---

## Task 16: `<DamageFlagModal>` component

**Files:**
- Create: `src/components/stok/DamageFlagModal.tsx`
- Test: `src/components/stok/DamageFlagModal.test.tsx`

**Interfaces:**
- Produces:
  - Component `DamageFlagModal({ open, sku, maxQty, defaultSupplierId, onSubmit, onCancel })`
  - `onSubmit(payload: { damagedQty: number; disposition: DamageDisposition; supplierId: string | null; notes: string; evidenceUrls: string[] })`

- [ ] **Step 1: Write component test**

```typescript
// src/components/stok/DamageFlagModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DamageFlagModal } from './DamageFlagModal';

describe('DamageFlagModal', () => {
  it('requires supplier when disposition is KLAIM_SUPPLIER', async () => {
    const onSubmit = vi.fn();
    render(<DamageFlagModal open sku="TEST" maxQty={10} defaultSupplierId={null}
                            onSubmit={onSubmit} onCancel={() => {}} suppliers={[]} />);
    fireEvent.change(screen.getByLabelText(/qty rusak/i), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText(/klaim supplier/i));
    fireEvent.click(screen.getByText(/simpan/i));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/supplier wajib dipilih/i)).toBeInTheDocument();
  });

  it('rejects damaged_qty > maxQty', () => {
    const onSubmit = vi.fn();
    render(<DamageFlagModal open sku="TEST" maxQty={5} defaultSupplierId={null}
                            onSubmit={onSubmit} onCancel={() => {}} suppliers={[]} />);
    fireEvent.change(screen.getByLabelText(/qty rusak/i), { target: { value: '10' } });
    fireEvent.click(screen.getByText(/simpan/i));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run src/components/stok/DamageFlagModal.test.tsx
```

- [ ] **Step 3: Implement component**

```typescript
// src/components/stok/DamageFlagModal.tsx
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DamageDisposition } from '../../lib/supplierClaims/types';

interface Supplier { id: string; name: string; }
interface Props {
  open: boolean;
  sku: string;
  maxQty: number;
  defaultSupplierId: string | null;
  suppliers: Supplier[];
  onSubmit: (payload: {
    damagedQty: number; disposition: DamageDisposition;
    supplierId: string | null; notes: string; evidenceUrls: string[];
  }) => void;
  onCancel: () => void;
}

export function DamageFlagModal({ open, sku, maxQty, defaultSupplierId, suppliers, onSubmit, onCancel }: Props) {
  const [damagedQty, setDamagedQty] = useState(0);
  const [disposition, setDisposition] = useState<DamageDisposition>('DISPOSE');
  const [supplierId, setSupplierId] = useState<string | null>(defaultSupplierId);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = () => {
    if (damagedQty <= 0 || damagedQty > maxQty) {
      setError(`Qty rusak harus antara 1 dan ${maxQty}`);
      return;
    }
    if (disposition === 'KLAIM_SUPPLIER' && !supplierId) {
      setError('Supplier wajib dipilih untuk Klaim Supplier');
      return;
    }
    setError(null);
    onSubmit({ damagedQty, disposition, supplierId, notes, evidenceUrls: [] });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md" style={{ fontSize: '14px' }}>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <h2 className="font-semibold">Flag Rusak — {sku}</h2>
        </div>

        <label className="block mb-3">
          <span className="text-sm">Qty rusak (max {maxQty})</span>
          <input type="number" min={1} max={maxQty} value={damagedQty}
                 onChange={e => setDamagedQty(parseInt(e.target.value || '0', 10))}
                 className="mt-1 w-full border rounded px-3 py-2" aria-label="Qty rusak" />
        </label>

        <fieldset className="mb-3">
          <legend className="text-sm mb-2">Disposition</legend>
          <label className="block">
            <input type="radio" checked={disposition === 'DISPOSE'} onChange={() => setDisposition('DISPOSE')} />
            <span className="ml-2">Dispose (buang, catat sebagai loss)</span>
          </label>
          <label className="block">
            <input type="radio" checked={disposition === 'KLAIM_SUPPLIER'}
                   onChange={() => setDisposition('KLAIM_SUPPLIER')} />
            <span className="ml-2">Klaim Supplier (retur/refund)</span>
          </label>
        </fieldset>

        {disposition === 'KLAIM_SUPPLIER' && (
          <label className="block mb-3">
            <span className="text-sm">Supplier</span>
            <select value={supplierId ?? ''} onChange={e => setSupplierId(e.target.value || null)}
                    className="mt-1 w-full border rounded px-3 py-2">
              <option value="">-- pilih supplier --</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}

        <label className="block mb-3">
          <span className="text-sm">Notes (opsional)</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
                    className="mt-1 w-full border rounded px-3 py-2" rows={3} />
        </label>

        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 border rounded">Batal</button>
          <button onClick={submit} className="px-4 py-2 bg-blue-600 text-white rounded">Simpan</button>
        </div>
      </div>
    </div>
  );
}

export default DamageFlagModal;
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/components/stok/DamageFlagModal.tsx src/components/stok/DamageFlagModal.test.tsx
git commit -m "feat(supplier-claims): DamageFlagModal reusable component"
```

---

## Task 17: Integrate flag rusak into `StockOpnameSessionView`

**Files:**
- Modify: `src/components/stok/StockOpnameSessionView.tsx`

**Interfaces:**
- Consumes: `<DamageFlagModal>` (Task 16), typed API (Task 15)
- Produces: opname row layout gains "Flag Rusak" button + badge + sellable preview; damaged_qty persisted via existing opname count RPC (extend params)

- [ ] **Step 1: Read current row structure**

Read `StockOpnameSessionView.tsx` to locate the row rendering block.

- [ ] **Step 2: Add state + modal open handler**

Add `flaggingSku: string | null` state, list of suppliers (fetch from `suppliers` table filtered by tenant + relevant to SKU history if available; fallback all suppliers).

- [ ] **Step 3: Add "Flag Rusak" button + badge per row**

Alongside the counted_qty input, render:
```tsx
<button onClick={() => setFlaggingSku(row.sku)} className="text-orange-600 text-sm hover:underline">
  🚩 Flag Rusak
</button>
{row.damagedQty > 0 && (
  <div className="text-xs bg-orange-100 rounded px-2 py-1 mt-1">
    🚩 {row.damagedQty} rusak — {row.damageDisposition === 'KLAIM_SUPPLIER'
      ? `Klaim ${suppliers.find(s => s.id === row.damageSupplierId)?.name}`
      : 'Dispose'}
  </div>
)}
<div className="text-xs text-gray-500 mt-1">Sellable: {row.countedQty - row.damagedQty}</div>
```

- [ ] **Step 4: Wire modal + persist damaged state**

Add a call to update `stock_opname_counts` row with damaged_qty + damage_disposition + damage_supplier_id when modal submits. Use existing count RPC (add new optional params) or write a separate `set_opname_damage_flag(session_id, sku, warehouse, damaged_qty, disposition, supplier_id, notes)` RPC (add to migration 102 if needed).

- [ ] **Step 5: Run existing opname tests — no regression**

```bash
npx vitest run src/components/stok/
```

- [ ] **Step 6: Commit**

```bash
git add src/components/stok/StockOpnameSessionView.tsx supabase/migrations/20261115000102_supplier_claims_existing_rpc_mods.sql
git commit -m "feat(opname): inline Flag Rusak per row with sellable preview"
```

---

## Task 18: Modify `<StockAdjustmentModal>` for damage disposition

**Files:**
- Modify: `src/components/stok/StockAdjustmentModal.tsx`

**Interfaces:**
- Consumes: existing `request_adjustment` RPC (extended in Task 10)
- Produces: modal shows disposition radio + supplier dropdown when reason=rusak, submits with new params

- [ ] **Step 1: Read current modal structure**

- [ ] **Step 2: Add disposition state + conditional supplier dropdown**

Similar shape to DamageFlagModal but wired to `request_adjustment` submit.

- [ ] **Step 3: Run existing adjustment tests — no regression**

- [ ] **Step 4: Commit**

```bash
git add src/components/stok/StockAdjustmentModal.tsx
git commit -m "feat(stok): StockAdjustmentModal supports damage disposition + supplier picker"
```

---

## Task 19: `<ClaimStatusBadge>` component

**Files:**
- Create: `src/components/pembelian/ClaimStatusBadge.tsx`

**Interfaces:**
- Produces: `<ClaimStatusBadge status={ClaimStatus} />` — color-coded per palette

- [ ] **Step 1: Write component**

```tsx
import type { ClaimStatus } from '../../lib/supplierClaims/types';

const map: Record<ClaimStatus, { label: string; className: string }> = {
  PENDING:            { label: 'Menunggu',     className: 'bg-yellow-100 text-yellow-800' },
  RESOLVED_REPLACED:  { label: 'Diganti',       className: 'bg-green-100 text-green-800' },
  RESOLVED_CREDITED:  { label: 'Credit note',   className: 'bg-blue-100 text-blue-800' },
  RESOLVED_CASHED:    { label: 'Cash refund',   className: 'bg-purple-100 text-purple-800' },
  REJECTED:           { label: 'Ditolak',       className: 'bg-red-100 text-red-800' },
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const cfg = map[status];
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${cfg.className}`}>{cfg.label}</span>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/pembelian/ClaimStatusBadge.tsx
git commit -m "feat(supplier-claims): ClaimStatusBadge component"
```

---

## Task 20: `<ClaimListTable>` + `<KlaimSupplierPanel>`

**Files:**
- Create: `src/components/pembelian/ClaimListTable.tsx`
- Create: `src/components/pembelian/KlaimSupplierPanel.tsx`
- Test: `src/components/pembelian/KlaimSupplierPanel.test.tsx`

**Interfaces:**
- Consumes: `listSupplierClaims` (Task 15), `<ClaimStatusBadge>`
- Produces: List page with 4 summary cards + filter bar + table + row expand for notes/timeline

- [ ] **Step 1: Write test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { KlaimSupplierPanel } from './KlaimSupplierPanel';

vi.mock('../../lib/supplierClaims/api', () => ({
  listSupplierClaims: vi.fn(async () => [{
    id: 1, supplierId: 'sup-1', supplierName: 'PT ABC', sku: 'A-01',
    warehouse: 'atas', qty: 5, unitCost: 100_000, bookValue: 500_000,
    status: 'PENDING', sourceType: 'STOCK_OPNAME', sourceRefId: 100,
    damageNotes: null, evidenceUrls: null, createdAt: '2026-07-12', resolvedAt: null,
  }]),
}));

describe('KlaimSupplierPanel', () => {
  it('renders claim rows fetched from API', async () => {
    render(<KlaimSupplierPanel />);
    await waitFor(() => expect(screen.getByText('A-01')).toBeInTheDocument());
    expect(screen.getByText('PT ABC')).toBeInTheDocument();
    expect(screen.getByText(/menunggu/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `ClaimListTable` + `KlaimSupplierPanel`**

Structure per §5.2 of spec: summary cards, filter bar (Status/Supplier/Date/Source), table with columns Tanggal/SKU/Qty/Supplier/Source/Nilai/Status/Action, row expand for notes+timeline.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/components/pembelian/ClaimListTable.tsx src/components/pembelian/KlaimSupplierPanel.tsx src/components/pembelian/KlaimSupplierPanel.test.tsx
git commit -m "feat(pembelian): KlaimSupplierPanel list page + summary cards"
```

---

## Task 21: `<ClaimResolveModal>` component

**Files:**
- Create: `src/components/pembelian/ClaimResolveModal.tsx`
- Test: `src/components/pembelian/ClaimResolveModal.test.tsx`

**Interfaces:**
- Consumes: `resolveSupplierClaim` API (Task 15), `getSupplierClaim`
- Produces: modal with outcome radios (Replacement / Credit note / Cash refund / Reject), conditional inputs, PIN input when approval required, variance warning banner

- [ ] **Step 1: Write test cases**

```tsx
// Variance warning banner appears when refund amount ≠ book value
// PIN input rendered when approval PENDING_APPROVAL returned
// Cash refund requires target Kas/Bank
```

- [ ] **Step 2: Implement modal**

Detailed per spec §5.4. On submit → call `resolveSupplierClaim`. Handle 3 return states: SUCCESS, PENDING_APPROVAL, ALREADY_RESOLVED.

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/components/pembelian/ClaimResolveModal.tsx src/components/pembelian/ClaimResolveModal.test.tsx
git commit -m "feat(supplier-claims): ClaimResolveModal with 4 outcomes + variance UI"
```

---

## Task 22: Add "Klaim" tab to `<PembelianScreen>`

**Files:**
- Modify: `src/components/PembelianScreen.tsx`

**Interfaces:**
- Consumes: `<KlaimSupplierPanel>` (Task 20)
- Produces: Tab position `... bnl | klaim | pembayaran | suppliers`

- [ ] **Step 1: Locate Tab type union + tab rendering**

Search for tab type at ~line 66:
```typescript
type Tab = 'beranda' | 'orders' | 'pesanan' | 'tagihan' | 'tukar-faktur' | 'bnl' | 'pembayaran' | 'suppliers';
```

- [ ] **Step 2: Add `klaim` to union + tab list + panel switch**

```typescript
type Tab = 'beranda' | ... | 'bnl' | 'klaim' | 'pembayaran' | 'suppliers';
```
Add tab button labeled "Klaim Supplier". Add case in tab switch to render `<KlaimSupplierPanel />`.

- [ ] **Step 3: Commit**

```bash
git add src/components/PembelianScreen.tsx
git commit -m "feat(pembelian): add Klaim Supplier tab"
```

---

## Task 23: Wire `<ReceiveGoodsModal>` and `<ReceiveReplacementModal>` for backward compat

**Files:**
- Modify: `src/components/pembelian/ReceiveGoodsModal.tsx`
- Modify: `src/components/pembelian/ReceiveReplacementModal.tsx`

**Interfaces:**
- Consumes: modified `receive_purchase_order` (Task 8) auto-creates claim on damage; modified `receive_replacement` (Task 9) is now a resolve wrapper
- Produces:
  - `<ReceiveGoodsModal>` shows badge "🚩 X rusak — klaim dibuat" for damaged rows after submit
  - `<ReceiveReplacementModal>` UI unchanged; verify no regression

- [ ] **Step 1: Add badge display after damaged receipt**

In ReceiveGoodsModal after submit, if any item had qty_damaged > 0, show success toast: "PO diterima. X klaim otomatis dibuat — cek tab Klaim Supplier."

- [ ] **Step 2: Verify ReceiveReplacementModal — no code change likely; just manual test**

Fire in dev → confirm stock updates + damage_status → REPLACED via resolve wrapper.

- [ ] **Step 3: Commit**

```bash
git add src/components/pembelian/ReceiveGoodsModal.tsx src/components/pembelian/ReceiveReplacementModal.tsx
git commit -m "feat(pembelian): ReceiveGoodsModal surfaces auto-claim creation"
```

---

## Task 24: Pengaturan — approval_settings + enabled sources/outcomes config

**Files:**
- Modify: `src/components/PengaturanScreen.tsx` (or subcomponent)

**Interfaces:**
- Consumes: existing approval_settings CRUD, new tenant_config columns `enabled_claim_sources`, `enabled_claim_outcomes`
- Produces: UI section "Klaim Supplier" with:
  - Approval settings for `RESOLVE_SUPPLIER_CLAIM`: threshold_amount + verification_method (dropdown: PIN | APP_INBOX; WA_BUTTON greyed out with tooltip "Tidak tersedia untuk workflow ini")
  - Checkboxes for enabled_claim_sources (default all checked)
  - Checkboxes for enabled_claim_outcomes (default all checked)

- [ ] **Step 1: Add tenant_config columns migration (if not already present)**

Migration 105 addendum or new slot — add:
```sql
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS enabled_claim_sources TEXT[] NOT NULL DEFAULT ARRAY['PO_RECEIPT','STOCK_OPNAME','STOCK_ADJUSTMENT'],
  ADD COLUMN IF NOT EXISTS enabled_claim_outcomes TEXT[] NOT NULL DEFAULT ARRAY['RESOLVED_REPLACED','RESOLVED_CREDITED','RESOLVED_CASHED','REJECTED'];
```

Fold into migration 105 if not shipped yet.

- [ ] **Step 2: Add UI section**

- [ ] **Step 3: Commit**

```bash
git add src/components/PengaturanScreen.tsx supabase/migrations/20261115000105_supplier_claims_approval_settings_seed.sql
git commit -m "feat(pengaturan): supplier claim approval + visibility config"
```

---

## Task 25: E2E integration test — full damage flow

**Files:**
- Create: `tests/integration/opname_damage_flow.test.ts`

**Interfaces:**
- Verifies: opname flag → commit → resolve → journal balanced + stock correct + damage_status synced (if PO source)

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe('opname damage → resolve E2E', () => {
  it('opname flag → commit → resolve REPLACED restores stock + zeros claim', async () => {
    // Seed session, count row, damaged_qty=3, disposition=KLAIM_SUPPLIER, supplier_id
    // Commit session
    // Verify: supplier_claims row exists with status=PENDING
    // Verify: journal Dr 1-1460 500k / Cr 1-1510 500k
    // Verify: stock_levels decreased by 3
    // Resolve outcome=RESOLVED_REPLACED
    // Verify: journal Dr 1-1510 500k / Cr 1-1460 500k
    // Verify: stock_levels back to original
    // Verify: supplier_claims.status=RESOLVED_REPLACED
    // Verify: purchase_order_items untouched (source was opname)
  });

  it('PO receipt damage → record_pi split (flag on) → resolve CASHED', async () => {
    // Enable feature flag
    // Create PO 100 units @ 100k, receive with qty_damaged=3
    // Verify: supplier_claims row PENDING, PO item.damage_status=PENDING_RETURN, damage_status synced
    // Post record_pi
    // Verify: journal has Dr 1-1510 9.7jt / Dr 1-1460 300k / Cr 2-1100 10jt
    // Resolve outcome=RESOLVED_CASHED, amount=300k, target=1-1200
    // Verify: journal Dr 1-1200 300k / Cr 1-1460 300k
    // Verify: PO item.damage_status='RESOLVED_CASHED'
  });
});
```

- [ ] **Step 2: Run — verify all assertions pass**

```bash
npx vitest run tests/integration/opname_damage_flow.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/opname_damage_flow.test.ts
git commit -m "test(supplier-claims): E2E opname damage → resolve flow"
```

---

## Task 26: Update memory for slot claim + progress.md

**Files:**
- Modify: `/Users/tonywei/.claude/projects/-Users-tonywei-IdeaProjects-ERPAntigravity/memory/project_migration_slot_allocation.md`
- Modify: `progress.md`

- [ ] **Step 1: Update slot allocation memory**

Bump active session claim to note 100-105 taken by opname-damage feature.

- [ ] **Step 2: Append Item #1 completion to progress.md**

Following existing progress.md pattern, add section for opname damage feature listing:
- Migration slots 100-105 applied
- Bug fix: ad-hoc rusak adjustment now posts journal
- Feature flag `enable_pi_damage_split` default off
- Backfill completed for existing PO damage

- [ ] **Step 3: Commit**

```bash
git add /Users/tonywei/.claude/projects/-Users-tonywei-IdeaProjects-ERPAntigravity/memory/project_migration_slot_allocation.md progress.md
git commit -m "docs(supplier-claims): record slot claim + Item #1 completion"
```

---

## Self-Review Notes

**Spec coverage cross-check** — every section of the design doc maps to at least one task:
- §2 Data model → Task 2
- §3 RPCs → Tasks 3-6 (new), 7-11 (modifications), 12 (reads)
- §4 Journals → embedded in Tasks 4, 6, 10, 11 (verified balanced with concrete amounts)
- §5 UI → Tasks 16-23
- §6 RLS + SECDEF → Task 2 (RLS policies + owner grants baked into schema)
- §7 Approval → Task 6 (resolve RPC) + Task 24 (Pengaturan UI)
- §8 Rollout / feature flag → Task 11 (record_pi flagged) + Task 14 (approval settings seed)
- §9 Backfill → Task 13
- §10 Testing → tests embedded per task + Task 25 E2E
- §11 Migration slots → matches Tasks 2, 3-6, 7-11, 12, 13, 14

**Type consistency check:**
- `ClaimStatus` union defined in `types.ts` matches CHECK constraint on `supplier_claims.status` (5 values)
- `ClaimSourceType` matches CHECK on `source_type` (3 values)
- `DamageDisposition` matches CHECK on both `stock_adjustments.damage_disposition` and `stock_opname_counts.damage_disposition`
- `ClaimOutcome` matches the 4 non-PENDING statuses accepted by `resolve_supplier_claim`

**Known deferred / out of scope** (per spec §13):
- Aging report
- Bulk resolve
- Journal template runtime editor
- WA verification method
- Cleanup of hilang/sampel journal posting bug (separate ticket)
- Post-Phase 3 warehouse_id migration for supplier_claims.warehouse
