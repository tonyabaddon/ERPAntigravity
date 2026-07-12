# Warehouse Transfer (Two-Step) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a multi-tenant two-step warehouse-transfer feature (sender initiate → receiver confirm/partial/cancel) that replaces the legacy single-shot `transfer_warehouse` RPC and hardens against in-transit shrink via the existing `v_pengawasan_transfer_aging` fraud view.

**Architecture:** SECURITY DEFINER RPCs (`initiate_warehouse_transfer`, `receive_warehouse_transfer`, `cancel_warehouse_transfer`) owned by `vosi_rpc_owner`, tenant-scoped via `_resolve_tenant_id()`. New parent + child tables `warehouse_transfers` (composite PK `tenant_id, id`) and `warehouse_transfer_items`. Source `stock_levels` deducts at IN_TRANSIT; destination credits at RECEIVED. Loss on PARTIAL logged as audit-only `stock_movements` row (source=`transfer_loss`) — no double-deduct. FE: new module `src/components/warehouseTransfer/` with list, create, detail screens; legacy `WarehouseTransferModal.tsx` deleted; `StockManagerScreen` gets an `InTransitChip`.

**Tech Stack:** Supabase (Postgres 15, RLS + SECDEF), TypeScript + React, jsPDF (client-side surat jalan), Vitest, Chrome DevTools MCP.

**Spec:** `docs/superpowers/specs/2026-07-12-warehouse-transfer-two-step-design.md`

## Global Constraints

- **Terminology**: "Transfer" (never "Mutasi") per memory `warehouse_transfer_naming`. Doc-no prefix `TR-YYYY-MM-NNN`. Sidebar label "Transfer Gudang".
- **Status enum**: `IN_TRANSIT | RECEIVED | PARTIAL | CANCELLED` (uppercase). NO `initiated` / `disputed` — those existed only in the stub table.
- **PK shape**: composite `(tenant_id, id)` on `warehouse_transfers`; composite `(tenant_id, transfer_id, line_no)` on `warehouse_transfer_items`. Both `bigint IDENTITY`.
- **Migration slots**: **20261115000210 – 20261115000221** (12 slots claimed). Range 222-229 reserved for follow-up fixes without renumbering.
- **RLS**: every new table `ENABLE + FORCE ROW LEVEL SECURITY`, `REVOKE ALL FROM anon, PUBLIC`, `GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated`. `t_select_own` MUST include `vosi_rpc_owner` per memory `secdef_returning_gap`.
- **Idempotency**: `initiate_warehouse_transfer` accepts `p_client_request_id` — unique `(tenant_id, client_request_id)`. Duplicate returns the existing row without side-effects.
- **Ledger**: every stock delta goes through `stock_movements` (append-only). New enum values: `'transfer_loss'`, `'transfer_cancel_return'`. Existing `'transfer_out'` + `'transfer_in'` reused.
- **NO paid API** — PDF is client-side jsPDF (existing pattern from Bug 2b logo work). Cost impact zero.
- **NO approval workflow** per memory `no_approval_workflow` — receiver acts directly; owner override deferred to Phase 2.
- **NO WA** per memory `no_wa_owner_approval` — APP_INBOX only.
- **Design system**: newer canonical pattern from `OwnerDecisionInbox.tsx` (Tailwind emerald/slate, `rounded border-slate-200`, `font-semibold`). Not the older `#2d8a4e` + `rounded-3xl` from `WarehouseTransferModal.tsx`.
- **Stop-hook gates** (must be green before commit): `npm run lint`, `npm run audit:numinput`, `npm run audit:secdef-null-tenant`, `npx vitest run --changed`.
- **After every migration set** — run `mcp__plugin_supabase_supabase__get_advisors` and triage findings.

---

## File Structure

**DB migrations** (all `supabase/migrations/`):
- `20261115000210_drop_warehouse_transfers_stub.sql` — drop stub table + cascade-drop old aging view
- `20261115000211_warehouse_transfers_schema.sql` — new parent + child tables + doc_seq helper table
- `20261115000212_recreate_transfer_aging_view.sql` — v_pengawasan_transfer_aging against new schema
- `20261115000213_extend_stock_movement_source_enum.sql` — add `transfer_loss` + `transfer_cancel_return`
- `20261115000214_warehouse_transfers_rls.sql` — t_* policies inclusive of vosi_rpc_owner
- `20261115000215_initiate_warehouse_transfer.sql` — sender RPC
- `20261115000216_receive_warehouse_transfer.sql` — receiver RPC (full + partial + loss)
- `20261115000217_cancel_warehouse_transfer.sql` — sender cancel RPC
- `20261115000218_warehouse_transfer_read_rpcs.sql` — list, detail, in-transit read RPCs
- `20261115000219_legacy_transfer_warehouse_shim.sql` — rewrite legacy `transfer_warehouse` to proxy new RPCs
- `20261115000220_seed_warehouse_transfer_permissions.sql` — permissions row seed + backfill
- `20261115000221_smoke_test_warehouse_transfer.sql` — full-lifecycle SECDEF smoke test (RAISE EXCEPTION rollback)

**FE new — `src/components/warehouseTransfer/`:**
- `WarehouseTransferListScreen.tsx` — list + KPI + filters
- `WarehouseTransferCreateScreen.tsx` — sender form
- `WarehouseTransferDetailScreen.tsx` — view / receive / cancel
- `WarehouseTransferSKUPicker.tsx` — autocomplete + multi-line add
- `InTransitChip.tsx` — reusable "+N in-transit" indicator
- `__tests__/WarehouseTransferService.test.ts` — service unit tests
- `__tests__/WarehouseTransferCreateScreen.test.tsx` — sender form component test
- `__tests__/WarehouseTransferDetailScreen.test.tsx` — receiver flow component test
- `__tests__/InTransitChip.test.tsx` — chip rendering + hover
- `__tests__/CrossTenantIsolation.test.ts` — cross-tenant safety smoke

**FE new — `src/lib/`:**
- `warehouseTransferService.ts` — 6 async RPC wrappers + typed models
- `pdf/warehouseTransferPDF.ts` — jsPDF renderer for surat jalan

**FE new — `src/hooks/`:**
- `useInTransitBySKU.ts` — cache-per-warehouse `get_in_transit_by_warehouse` results

**FE modified:**
- `src/components/Sidebar.tsx` — add `warehouse-transfer` entry (category `inventory`) after `manajemen-gudang`
- `src/App.tsx` — add 3 routes (list, create, detail)
- `src/components/StockManagerScreen.tsx:76,393-397` — drop modal state + render, add `<InTransitChip>` in per-warehouse rows
- `src/components/OwnerDecisionInbox.tsx` — add aging-alerts panel sourced from `v_pengawasan_transfer_aging`
- `src/lib/pembelianService.ts:187-197` — delete `transferWarehouse` function; all callers already migrated
- `src/types.ts` (or module-local) — add `WarehouseTransfer`, `WarehouseTransferItem`, `WarehouseTransferStatus` types

**FE deleted:**
- `src/components/WarehouseTransferModal.tsx` (91 lines — sole file removal)

**Deploy config modified:**
- `scripts/apply-pending-migrations.sh` — append the 12 new migration filenames to the array

---

Task summary (26 tasks over 4 phases):

| Phase | Tasks | Deliverable |
|---|---|---|
| **A — DB foundation** | 1-12 | 12 migrations applied on local Supabase branch; smoke migration proves the full lifecycle |
| **B — FE service layer** | 13-15 | `warehouseTransferService.ts`, `useInTransitBySKU`, PDF renderer — unit tests green |
| **C — FE screens** | 16-23 | Sidebar entry, list / create / detail screens live, `InTransitChip` in StockManager, legacy modal deleted, Owner Inbox extended |
| **D — Ship & verify** | 24-26 | Local stage-1 verification, deploy, prod smoke on Toko Jaya Makmur, `progress.md` |

Detailed tasks follow below (Phase A first). Each task is self-contained: fresh reviewer can approve/reject one without reading its neighbors.

---

**NOTE ON PLAN LENGTH:** This plan places the 12 DB migration tasks (Phase A) inline below with full SQL. Phase B (FE services) and Phase C (FE screens) tasks reference the spec for the RPC contract and design mockups but include complete file paths, interfaces, and test skeletons. Phase D tasks include exact commands and expected output. If a subagent needs the full RPC body for a Phase A task, the spec section is cited by number in the task header.

---

## Phase A — Database foundation

### Task 1: Migration 210 — drop stub `warehouse_transfers` + cascade aging view

**Spec ref:** §4.1 (new schema), §7 slot 210.

**Files:**
- Create: `supabase/migrations/20261115000210_drop_warehouse_transfers_stub.sql`

**Interfaces:**
- Consumes: existing stub table + `v_pengawasan_transfer_aging` view (from `20260607000053_transfer_aging_view.sql`)
- Produces: clean slate — no `warehouse_transfers` table, no aging view (both recreated in tasks 2 + 3)

- [ ] **Step 1: Confirm stub is empty in prod-testing tenant**

Run via MCP:
```sql
SELECT COUNT(*) FROM public.warehouse_transfers;
```
Expected: `0`. If non-zero, stop and coordinate with founder — data preservation strategy needed before drop.

- [ ] **Step 2: Write migration**

```sql
-- 20261115000210_drop_warehouse_transfers_stub.sql
-- Drop stub warehouse_transfers table (from 20260607000053_transfer_aging_view.sql)
-- plus the aging view that depends on it. Both are recreated with new schema
-- in tasks 2 + 3.
--
-- Safety: assumes stub table has zero live rows. Verified pre-apply.

BEGIN;

DROP VIEW IF EXISTS public.v_pengawasan_transfer_aging CASCADE;
DROP TABLE IF EXISTS public.warehouse_transfers CASCADE;

COMMIT;
```

- [ ] **Step 3: Apply on local Supabase branch and verify**

Run via MCP `apply_migration`. Then:
```sql
SELECT to_regclass('public.warehouse_transfers') IS NULL AS table_gone,
       to_regclass('public.v_pengawasan_transfer_aging') IS NULL AS view_gone;
```
Expected: both `true`.

- [ ] **Step 4: Commit migration file**

```bash
git add supabase/migrations/20261115000210_drop_warehouse_transfers_stub.sql
git commit -m "chore(warehouse-transfer): drop stub table + cascade aging view (slot 210)

Task 1 of warehouse-transfer plan. Clears the stub schema so slot 211 can
create the real tables with tenant_id + warehouse_id uuid + full column set.
Spec: docs/superpowers/specs/2026-07-12-warehouse-transfer-two-step-design.md"
```

---

### Task 2: Migration 211 — create `warehouse_transfers` + items + doc_seq

**Spec ref:** §4.1, §4.2, §6.

**Files:**
- Create: `supabase/migrations/20261115000211_warehouse_transfers_schema.sql`

**Interfaces:**
- Consumes: `public.warehouses(id)` (Phase 1 warehouses), `public.stocks(sku)` FK, `auth.users(id)` FK
- Produces: tables `warehouse_transfers`, `warehouse_transfer_items`, `warehouse_transfer_doc_seq`; indexes as spec §4.1

- [ ] **Step 1: Write migration (schema exactly per spec §4.1 + §4.2 + doc_seq table)**

```sql
-- 20261115000211_warehouse_transfers_schema.sql
-- Two-step warehouse transfer parent + child tables + doc-number sequence.
-- Full spec: §4.1, §4.2, §6.

BEGIN;

-- ─── warehouse_transfers (parent) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.warehouse_transfers (
  tenant_id            uuid        NOT NULL,
  id                   bigint      NOT NULL GENERATED BY DEFAULT AS IDENTITY,
  doc_no               text        NOT NULL,
  from_warehouse_id    uuid        NOT NULL REFERENCES public.warehouses(id),
  to_warehouse_id      uuid        NOT NULL REFERENCES public.warehouses(id),
  sender_user_id       uuid        NOT NULL REFERENCES auth.users(id),
  receiver_user_id     uuid        NOT NULL REFERENCES auth.users(id),
  status               text        NOT NULL DEFAULT 'IN_TRANSIT',
  notes                text        NULL,
  client_request_id    text        NULL,
  initiated_at         timestamptz NOT NULL DEFAULT now(),
  received_at          timestamptz NULL,
  received_by_user_id  uuid        NULL REFERENCES auth.users(id),
  cancelled_at         timestamptz NULL,
  cancelled_by_user_id uuid        NULL REFERENCES auth.users(id),
  cancel_reason        text        NULL,
  total_qty_sent       int         NOT NULL,
  total_qty_received   int         NULL,
  total_loss_qty       int         NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, doc_no),
  UNIQUE (tenant_id, client_request_id),
  CHECK (from_warehouse_id <> to_warehouse_id),
  CHECK (status IN ('IN_TRANSIT','RECEIVED','PARTIAL','CANCELLED')),
  CHECK (total_qty_sent > 0),
  CHECK (
    (status = 'IN_TRANSIT' AND received_at IS NULL AND cancelled_at IS NULL) OR
    (status IN ('RECEIVED','PARTIAL') AND received_at IS NOT NULL AND cancelled_at IS NULL) OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND received_at IS NULL)
  ),
  CHECK (
    (status = 'RECEIVED' AND total_qty_received = total_qty_sent AND total_loss_qty IS NULL) OR
    (status = 'PARTIAL'  AND total_qty_received < total_qty_sent AND total_loss_qty = total_qty_sent - total_qty_received AND total_qty_received >= 0) OR
    (status IN ('IN_TRANSIT','CANCELLED') AND total_qty_received IS NULL AND total_loss_qty IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS warehouse_transfers_tenant_status_to
  ON public.warehouse_transfers (tenant_id, to_warehouse_id, status)
  WHERE status = 'IN_TRANSIT';

CREATE INDEX IF NOT EXISTS warehouse_transfers_tenant_initiated_at
  ON public.warehouse_transfers (tenant_id, initiated_at DESC);

CREATE INDEX IF NOT EXISTS warehouse_transfers_receiver_pending
  ON public.warehouse_transfers (tenant_id, receiver_user_id, status)
  WHERE status = 'IN_TRANSIT';

-- ─── warehouse_transfer_items (child) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.warehouse_transfer_items (
  tenant_id        uuid   NOT NULL,
  transfer_id      bigint NOT NULL,
  line_no          int    NOT NULL,
  sku              text   NOT NULL REFERENCES public.stocks(sku),
  qty_sent         int    NOT NULL CHECK (qty_sent > 0),
  qty_received     int    NULL CHECK (qty_received >= 0),
  loss_qty         int    NULL CHECK (loss_qty >= 0),
  loss_movement_id bigint NULL,
  PRIMARY KEY (tenant_id, transfer_id, line_no),
  FOREIGN KEY (tenant_id, transfer_id) REFERENCES public.warehouse_transfers (tenant_id, id) ON DELETE CASCADE,
  CHECK (qty_received IS NULL OR qty_received <= qty_sent),
  CHECK (
    (qty_received IS NULL AND loss_qty IS NULL) OR
    (qty_received = qty_sent AND loss_qty IS NULL) OR
    (qty_received < qty_sent AND loss_qty = qty_sent - qty_received)
  )
);

CREATE INDEX IF NOT EXISTS warehouse_transfer_items_sku
  ON public.warehouse_transfer_items (tenant_id, sku);

CREATE INDEX IF NOT EXISTS warehouse_transfer_items_transfer
  ON public.warehouse_transfer_items (tenant_id, transfer_id);

-- ─── warehouse_transfer_doc_seq (per-tenant per-month sequence) ──────────
CREATE TABLE IF NOT EXISTS public.warehouse_transfer_doc_seq (
  tenant_id uuid NOT NULL,
  year      int  NOT NULL,
  month     int  NOT NULL CHECK (month BETWEEN 1 AND 12),
  seq       int  NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year, month)
);

-- Helper: allocate next doc_no for (tenant_id, current year, current month).
-- Returns padded 3-digit sequence string (TR-YYYY-MM-NNN caller-formatted).
CREATE OR REPLACE FUNCTION public._next_warehouse_transfer_doc_no(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_year int := EXTRACT(YEAR  FROM now())::int;
  v_month int := EXTRACT(MONTH FROM now())::int;
  v_seq int;
BEGIN
  INSERT INTO public.warehouse_transfer_doc_seq (tenant_id, year, month, seq)
  VALUES (p_tenant_id, v_year, v_month, 1)
  ON CONFLICT (tenant_id, year, month) DO UPDATE
    SET seq = warehouse_transfer_doc_seq.seq + 1
  RETURNING seq INTO v_seq;

  RETURN format('TR-%s-%s-%s', v_year, lpad(v_month::text, 2, '0'), lpad(v_seq::text, 3, '0'));
END;
$$;

REVOKE ALL ON FUNCTION public._next_warehouse_transfer_doc_no(uuid) FROM PUBLIC, anon, authenticated;
-- Called only from other SECDEF RPCs (initiate). No direct grant.

COMMIT;
```

- [ ] **Step 2: Apply migration + smoke-check schema shape**

```sql
-- After apply, verify all objects exist:
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'
  AND table_name IN ('warehouse_transfers','warehouse_transfer_items','warehouse_transfer_doc_seq');
-- Expected: 3

SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public'
  AND indexname IN ('warehouse_transfers_tenant_status_to',
                    'warehouse_transfers_tenant_initiated_at',
                    'warehouse_transfers_receiver_pending',
                    'warehouse_transfer_items_sku',
                    'warehouse_transfer_items_transfer');
-- Expected: 5

SELECT COUNT(*) FROM pg_constraint WHERE conrelid='public.warehouse_transfers'::regclass AND contype='c';
-- Expected: 4 (status CHECK + total_qty_sent CHECK + timestamps CHECK + qty_math CHECK)
```

- [ ] **Step 3: Verify `_next_warehouse_transfer_doc_no` behavior**

```sql
DO $$
DECLARE
  v_test_tenant uuid := gen_random_uuid();
  v1 text; v2 text; v3 text;
BEGIN
  v1 := public._next_warehouse_transfer_doc_no(v_test_tenant);
  v2 := public._next_warehouse_transfer_doc_no(v_test_tenant);
  v3 := public._next_warehouse_transfer_doc_no(gen_random_uuid());  -- different tenant

  RAISE NOTICE 'v1=%, v2=%, v3=%', v1, v2, v3;
  ASSERT v1 LIKE 'TR-____-__-001', 'expected TR-YYYY-MM-001';
  ASSERT v2 LIKE 'TR-____-__-002', 'expected TR-YYYY-MM-002';
  ASSERT v3 LIKE 'TR-____-__-001', 'expected TR-YYYY-MM-001 for different tenant';

  -- Rollback the seq rows
  DELETE FROM public.warehouse_transfer_doc_seq WHERE tenant_id IN (v_test_tenant);
  RAISE EXCEPTION 'smoke test complete — rollback';
END $$;
```
Expected: `NOTICE` prints 3 valid doc_no; then transaction rolls back on the final `RAISE EXCEPTION`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000211_warehouse_transfers_schema.sql
git commit -m "feat(warehouse-transfer): schema — parent, items, doc_seq (slot 211)

Composite PK (tenant_id, id) partition-ready per spec §11. All CHECK
constraints enumerated per memory check_constraints_before_rpc_rewrite.
Helper _next_warehouse_transfer_doc_no is SECDEF, no direct grant."
```

---

### Task 3: Migration 212 — recreate `v_pengawasan_transfer_aging` view

**Spec ref:** §5.4, §7 slot 212.

**Files:**
- Create: `supabase/migrations/20261115000212_recreate_transfer_aging_view.sql`

**Interfaces:**
- Consumes: `warehouse_transfers` from Task 2
- Produces: `v_pengawasan_transfer_aging` view (GRANT SELECT to authenticated)

- [ ] **Step 1: Write migration**

```sql
-- 20261115000212_recreate_transfer_aging_view.sql
-- Recreate v_pengawasan_transfer_aging against the new warehouse_transfers
-- schema. Status filter changes from 'initiated' → 'IN_TRANSIT'.
-- Original view: 20260607000053_transfer_aging_view.sql (dropped in slot 210).

BEGIN;

CREATE OR REPLACE VIEW public.v_pengawasan_transfer_aging AS
SELECT
  wt.tenant_id,
  wt.id,
  wt.doc_no,
  wt.from_warehouse_id,
  wt.to_warehouse_id,
  wt.sender_user_id,
  wt.receiver_user_id,
  wt.total_qty_sent,
  wt.initiated_at,
  EXTRACT(EPOCH FROM (now() - wt.initiated_at)) / 3600.0 AS hours_pending
FROM public.warehouse_transfers wt
WHERE wt.status = 'IN_TRANSIT'
  AND wt.initiated_at < now() - INTERVAL '24 hours';

GRANT SELECT ON public.v_pengawasan_transfer_aging TO authenticated;

COMMIT;
```

- [ ] **Step 2: Apply + smoke**

```sql
SELECT COUNT(*) FROM public.v_pengawasan_transfer_aging;
-- Expected: 0 (no transfers yet)

SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='v_pengawasan_transfer_aging'
  ORDER BY ordinal_position;
-- Expected 10 columns: tenant_id, id, doc_no, from_warehouse_id, to_warehouse_id,
-- sender_user_id, receiver_user_id, total_qty_sent, initiated_at, hours_pending
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261115000212_recreate_transfer_aging_view.sql
git commit -m "feat(warehouse-transfer): recreate aging view on new schema (slot 212)

Fraud-control view surfaces IN_TRANSIT transfers > 24h. tenant_id column
lets consumers filter safely."
```

---

### Task 4: Migration 213 — extend `stock_movement_source` enum

**Spec ref:** §5.2.1 (loss), §5.3 (cancel return), §7 slot 213.

**Files:**
- Create: `supabase/migrations/20261115000213_extend_stock_movement_source_enum.sql`

**Interfaces:**
- Consumes: existing `stock_movement_source` enum type
- Produces: two new enum values `'transfer_loss'`, `'transfer_cancel_return'`

- [ ] **Step 1: Write migration (idempotent via `pg_enum` existence check)**

```sql
-- 20261115000213_extend_stock_movement_source_enum.sql
-- Extend stock_movement_source enum with two new values used by the
-- warehouse transfer flow.
-- - 'transfer_loss'          : audit-only row for PARTIAL receive; NOT re-applied to stock_levels
-- - 'transfer_cancel_return' : source stock_levels credit on sender cancel

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'stock_movement_source' AND e.enumlabel = 'transfer_loss'
  ) THEN
    ALTER TYPE public.stock_movement_source ADD VALUE 'transfer_loss';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'stock_movement_source' AND e.enumlabel = 'transfer_cancel_return'
  ) THEN
    ALTER TYPE public.stock_movement_source ADD VALUE 'transfer_cancel_return';
  END IF;
END $$;
```

- [ ] **Step 2: Apply + verify enum values**

```sql
SELECT enumlabel FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'stock_movement_source'
   AND enumlabel IN ('transfer_loss','transfer_cancel_return')
 ORDER BY enumlabel;
-- Expected 2 rows.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261115000213_extend_stock_movement_source_enum.sql
git commit -m "feat(warehouse-transfer): extend stock_movement_source enum (slot 213)"
```

---

### Task 5: Migration 214 — RLS policies for new tables

**Spec ref:** §12, memory `secdef_returning_gap`.

**Files:**
- Create: `supabase/migrations/20261115000214_warehouse_transfers_rls.sql`

**Interfaces:**
- Consumes: tables from Task 2
- Produces: `t_select_own` (inclusive of `vosi_rpc_owner`), `t_insert_own`, `t_update_own`, `t_delete_own` on both parent + child

- [ ] **Step 1: Write migration**

```sql
-- 20261115000214_warehouse_transfers_rls.sql
-- Standard t_* RLS policies for both new tables. t_select_own explicitly
-- includes vosi_rpc_owner so SECDEF RPCs' INSERT ... RETURNING clauses
-- succeed (memory: secdef_returning_gap).

BEGIN;

-- ─── warehouse_transfers ─────────────────────────────────────────────────
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='warehouse_transfers' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.warehouse_transfers', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "t_select_own" ON public.warehouse_transfers
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = _resolve_tenant_id() OR current_user = 'vosi_rpc_owner');

CREATE POLICY "t_insert_own" ON public.warehouse_transfers
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_update_own" ON public.warehouse_transfers
  FOR UPDATE TO authenticated
  USING  (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_delete_own" ON public.warehouse_transfers
  FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

ALTER TABLE public.warehouse_transfers ENABLE  ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfers FORCE   ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_transfers FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_transfers TO authenticated;

-- ─── warehouse_transfer_items ────────────────────────────────────────────
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='warehouse_transfer_items' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.warehouse_transfer_items', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "t_select_own" ON public.warehouse_transfer_items
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = _resolve_tenant_id() OR current_user = 'vosi_rpc_owner');

CREATE POLICY "t_insert_own" ON public.warehouse_transfer_items
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_update_own" ON public.warehouse_transfer_items
  FOR UPDATE TO authenticated
  USING  (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_delete_own" ON public.warehouse_transfer_items
  FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

ALTER TABLE public.warehouse_transfer_items ENABLE  ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfer_items FORCE   ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_transfer_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_transfer_items TO authenticated;

-- ─── warehouse_transfer_doc_seq (RPC-only, no client access) ─────────────
ALTER TABLE public.warehouse_transfer_doc_seq ENABLE  ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfer_doc_seq FORCE   ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_transfer_doc_seq FROM anon, authenticated, PUBLIC;
-- vosi_rpc_owner already has ownership as SECDEF caller.

COMMIT;
```

- [ ] **Step 2: Apply + verify policy presence**

```sql
SELECT tablename, policyname
  FROM pg_policies
 WHERE schemaname='public' AND tablename LIKE 'warehouse_transfer%'
 ORDER BY tablename, policyname;
-- Expected 8 rows: 4 policies × 2 tables.

SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class
 WHERE relname IN ('warehouse_transfers','warehouse_transfer_items','warehouse_transfer_doc_seq')
   AND relkind='r';
-- Expected: all 3 rows show t/t.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261115000214_warehouse_transfers_rls.sql
git commit -m "feat(warehouse-transfer): RLS policies (slot 214)

t_select_own inclusive of vosi_rpc_owner per memory secdef_returning_gap.
_guard_expiry_write() broken by design (memory: guard_expiry_write_broken_predicate)
so all writes go through SECDEF RPCs in tasks 6-8."
```

---

### Task 6: Migration 215 — `initiate_warehouse_transfer` RPC

**Spec ref:** §5.1.

**Files:**
- Create: `supabase/migrations/20261115000215_initiate_warehouse_transfer.sql`

**Interfaces:**
- Consumes: `warehouses`, `stock_levels`, `stocks`, `_resolve_tenant_id()`, `_next_warehouse_transfer_doc_no`, `_log_stock_movement`, `app_inbox` (verify column shape at implementation)
- Produces: `initiate_warehouse_transfer(uuid, uuid, uuid, text, text, jsonb) RETURNS jsonb`

- [ ] **Step 1: Write migration (RPC body per spec §5.1, error codes lifted)**

```sql
-- 20261115000215_initiate_warehouse_transfer.sql
-- Sender RPC. Full contract: spec §5.1.
-- Idempotency: p_client_request_id unique per tenant; duplicate → return existing.
-- Errors: TRANSFER_INVALID_WAREHOUSE, TRANSFER_INVALID_RECEIVER,
--         TRANSFER_EMPTY_ITEMS, TRANSFER_INSUFFICIENT_STOCK,
--         TRANSFER_DUPLICATE_REQUEST.

CREATE OR REPLACE FUNCTION public.initiate_warehouse_transfer(
  p_from_warehouse_id uuid,
  p_to_warehouse_id   uuid,
  p_receiver_user_id  uuid,
  p_notes             text,
  p_client_request_id text,
  p_items             jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant          uuid;
  v_sender          uuid;
  v_transfer_id     bigint;
  v_doc_no          text;
  v_total_qty       int := 0;
  v_line            record;
  v_line_no         int := 0;
  v_existing        record;
  v_avail_qty       int;
  v_from_wh_active  bool;
  v_to_wh_active    bool;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_sender := auth.uid();

  IF v_tenant IS NULL OR v_sender IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;

  -- Idempotency: return existing row if same client_request_id
  IF p_client_request_id IS NOT NULL THEN
    SELECT id, doc_no INTO v_existing
      FROM public.warehouse_transfers
     WHERE tenant_id = v_tenant AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RAISE LOG 'warehouse_transfer initiate_idempotent tenant=% client_request_id=% existing_id=%',
        v_tenant, p_client_request_id, v_existing.id;
      RETURN jsonb_build_object('transfer_id', v_existing.id, 'doc_no', v_existing.doc_no, 'idempotent', true);
    END IF;
  END IF;

  -- Validate from/to warehouses (same tenant, active, distinct)
  IF p_from_warehouse_id = p_to_warehouse_id THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: from and to must differ';
  END IF;

  SELECT is_active INTO v_from_wh_active FROM public.warehouses
    WHERE id = p_from_warehouse_id AND (tenant_id = v_tenant OR tenant_id IS NULL);
  IF NOT FOUND OR NOT v_from_wh_active THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: from % not in tenant or inactive', p_from_warehouse_id;
  END IF;

  SELECT is_active INTO v_to_wh_active FROM public.warehouses
    WHERE id = p_to_warehouse_id AND (tenant_id = v_tenant OR tenant_id IS NULL);
  IF NOT FOUND OR NOT v_to_wh_active THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: to % not in tenant or inactive', p_to_warehouse_id;
  END IF;

  -- Validate receiver (must be tenant member; permission check deferred to plan follow-up
  -- once permissions row is seeded in task 11)
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE id = p_receiver_user_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_RECEIVER: user % not in tenant', p_receiver_user_id;
  END IF;

  -- Validate items array
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS';
  END IF;

  -- Pre-compute total_qty for header row
  SELECT SUM((it->>'qty')::int) INTO v_total_qty
    FROM jsonb_array_elements(p_items) it;
  IF v_total_qty IS NULL OR v_total_qty <= 0 THEN
    RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS: total qty must be > 0';
  END IF;

  -- Lock all source stock_levels rows in one pass, validate qty
  FOR v_line IN
    SELECT (it->>'sku')::text AS sku, (it->>'qty')::int AS qty
      FROM jsonb_array_elements(p_items) it
  LOOP
    IF v_line.qty <= 0 THEN
      RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS: sku % qty must be > 0', v_line.sku;
    END IF;
    SELECT qty INTO v_avail_qty FROM public.stock_levels
     WHERE sku = v_line.sku AND warehouse_id = p_from_warehouse_id
     FOR UPDATE;
    IF NOT FOUND OR v_avail_qty < v_line.qty THEN
      RAISE EXCEPTION 'TRANSFER_INSUFFICIENT_STOCK: sku=% tersedia=% diminta=%',
        v_line.sku, COALESCE(v_avail_qty, 0), v_line.qty;
    END IF;
  END LOOP;

  -- Generate doc_no + INSERT parent row
  v_doc_no := public._next_warehouse_transfer_doc_no(v_tenant);

  INSERT INTO public.warehouse_transfers
    (tenant_id, doc_no, from_warehouse_id, to_warehouse_id,
     sender_user_id, receiver_user_id, status, notes,
     client_request_id, initiated_at, total_qty_sent)
  VALUES
    (v_tenant, v_doc_no, p_from_warehouse_id, p_to_warehouse_id,
     v_sender, p_receiver_user_id, 'IN_TRANSIT', p_notes,
     p_client_request_id, now(), v_total_qty)
  RETURNING id INTO v_transfer_id;

  -- INSERT items, deduct source stock_levels, log stock_movements
  FOR v_line IN
    SELECT (it->>'sku')::text AS sku, (it->>'qty')::int AS qty
      FROM jsonb_array_elements(p_items) it
  LOOP
    v_line_no := v_line_no + 1;

    INSERT INTO public.warehouse_transfer_items
      (tenant_id, transfer_id, line_no, sku, qty_sent)
    VALUES
      (v_tenant, v_transfer_id, v_line_no, v_line.sku, v_line.qty);

    UPDATE public.stock_levels
       SET qty = qty - v_line.qty, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = p_from_warehouse_id;

    PERFORM public._log_stock_movement(
      p_sku              => v_line.sku,
      p_warehouse        => NULL,  -- text field deprecated; warehouse_id below
      p_qty_delta        => -v_line.qty,
      p_qty_before       => NULL,
      p_source           => 'transfer_out'::public.stock_movement_source,
      p_related_doc_type => 'warehouse_transfer',
      p_related_doc_id   => v_transfer_id::text
    );
  END LOOP;

  -- App-inbox notify receiver (best-effort; skip on missing table for compat)
  BEGIN
    INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
    VALUES (v_tenant, p_receiver_user_id, 'TRANSFER_INCOMING',
            'warehouse_transfer', v_transfer_id::text,
            format('Transfer masuk %s dari gudang', v_doc_no), now());
  EXCEPTION WHEN undefined_table THEN
    NULL;  -- app_inbox not deployed yet; silently skip
  END;

  RAISE LOG 'warehouse_transfer initiated tenant=% id=% doc_no=% from=% to=% items=% sender=%',
    v_tenant, v_transfer_id, v_doc_no, p_from_warehouse_id, p_to_warehouse_id, v_line_no, v_sender;

  RETURN jsonb_build_object('transfer_id', v_transfer_id, 'doc_no', v_doc_no, 'idempotent', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_warehouse_transfer(uuid, uuid, uuid, text, text, jsonb) TO authenticated;
```

- [ ] **Step 2: Apply + verify function shape**

```sql
SELECT proname, prosecdef, provolatile
  FROM pg_proc
 WHERE proname = 'initiate_warehouse_transfer';
-- Expected: prosecdef=t, provolatile=v
```

- [ ] **Step 3: Note deferred check**

Post-implementation follow-up (added to §15 Q7): the receiver permission gate references seeded rows from Task 11. Until Task 11 lands, RPC only checks tenant membership. Fine for smoke migration order; final RPC in Task 11 tightens the check.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000215_initiate_warehouse_transfer.sql
git commit -m "feat(warehouse-transfer): initiate RPC (slot 215)

SECDEF, tenant-scoped. Idempotent via client_request_id. FOR UPDATE lock
on source stock_levels rows prevents double-transfer race. Deducts source
at IN_TRANSIT (destination waits until receive)."
```

---

### Task 7: Migration 216 — `receive_warehouse_transfer` RPC

**Spec ref:** §5.2, §5.2.1.

**Files:**
- Create: `supabase/migrations/20261115000216_receive_warehouse_transfer.sql`

**Interfaces:**
- Consumes: parent + items from Task 2, `stock_movements` enum from Task 4
- Produces: `receive_warehouse_transfer(bigint, jsonb) RETURNS jsonb`

- [ ] **Step 1: Write migration (per spec §5.2 revised; loss handled per §5.2.1 chosen model)**

```sql
-- 20261115000216_receive_warehouse_transfer.sql
-- Receiver RPC. Full contract: spec §5.2, §5.2.1.
-- Final status: RECEIVED (all lines full) or PARTIAL (any line short).

CREATE OR REPLACE FUNCTION public.receive_warehouse_transfer(
  p_transfer_id bigint,
  p_items       jsonb   -- [{"sku":"...","qty_received":N}, ...]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant       uuid;
  v_actor        uuid;
  v_xfer         record;
  v_p_item       record;
  v_line         record;
  v_qty_received int;
  v_loss_qty     int;
  v_total_recv   int := 0;
  v_total_loss   int := 0;
  v_line_count   int;
  v_p_count      int;
  v_final_status text;
  v_move_id      bigint;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_actor  := auth.uid();
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;

  -- Load + lock transfer
  SELECT * INTO v_xfer FROM public.warehouse_transfers
   WHERE tenant_id = v_tenant AND id = p_transfer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND: id=%', p_transfer_id;
  END IF;
  IF v_xfer.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'TRANSFER_WRONG_STATUS: current=%', v_xfer.status;
  END IF;
  IF v_xfer.receiver_user_id <> v_actor THEN
    RAISE EXCEPTION 'TRANSFER_NOT_RECEIVER: receiver=% actor=%', v_xfer.receiver_user_id, v_actor;
  END IF;

  -- Validate p_items covers every SKU (order-agnostic, count must match)
  SELECT COUNT(*) INTO v_line_count FROM public.warehouse_transfer_items
   WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id;
  SELECT jsonb_array_length(p_items) INTO v_p_count;
  IF v_line_count <> v_p_count THEN
    RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: expected % lines, got %', v_line_count, v_p_count;
  END IF;

  -- Iterate p_items → validate + apply
  FOR v_p_item IN
    SELECT (it->>'sku')::text AS sku, (it->>'qty_received')::int AS qty_received
      FROM jsonb_array_elements(p_items) it
  LOOP
    -- Match to line
    SELECT * INTO v_line FROM public.warehouse_transfer_items
     WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND sku = v_p_item.sku
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: sku % not in transfer', v_p_item.sku;
    END IF;
    IF v_p_item.qty_received < 0 OR v_p_item.qty_received > v_line.qty_sent THEN
      RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: sku % qty_received=% out of [0, %]',
        v_p_item.sku, v_p_item.qty_received, v_line.qty_sent;
    END IF;

    v_qty_received := v_p_item.qty_received;
    v_loss_qty := v_line.qty_sent - v_qty_received;
    v_total_recv := v_total_recv + v_qty_received;
    v_total_loss := v_total_loss + v_loss_qty;

    -- Lock + credit destination stock_levels
    UPDATE public.stock_levels
       SET qty = qty + v_qty_received, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = v_xfer.to_warehouse_id;
    IF NOT FOUND THEN
      -- Insert row if it doesn't exist yet (first time this SKU lands in dest warehouse)
      INSERT INTO public.stock_levels (sku, warehouse_id, qty)
      VALUES (v_line.sku, v_xfer.to_warehouse_id, v_qty_received);
    END IF;

    -- Ledger: transfer_in (positive delta at destination)
    PERFORM public._log_stock_movement(
      p_sku              => v_line.sku,
      p_warehouse        => NULL,
      p_qty_delta        => v_qty_received,
      p_qty_before       => NULL,
      p_source           => 'transfer_in'::public.stock_movement_source,
      p_related_doc_type => 'warehouse_transfer',
      p_related_doc_id   => p_transfer_id::text
    );

    -- Loss row (audit only — source already deducted at IN_TRANSIT; do NOT
    -- credit source back; do NOT re-deduct destination).
    IF v_loss_qty > 0 THEN
      -- Direct INSERT (NOT via _log_stock_movement) — helper does not accept
      -- warehouse_id, and post-insert UPDATE to set warehouse_id is blocked
      -- by trg_deny_sm_update. Pattern verified in 20261115000108_smoke_test_bug_fixes.sql
      -- (memory: smoke_test_bug_fixes Bug 2/3).
      INSERT INTO public.stock_movements
        (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
         source, related_doc_type, related_doc_id, actor_user_id, created_at)
      VALUES
        (v_line.sku, v_xfer.from_warehouse_id, NULL,
         -v_loss_qty, 0, -v_loss_qty,
         'transfer_loss'::public.stock_movement_source,
         'warehouse_transfer_loss', p_transfer_id::text, v_actor, now())
      RETURNING id INTO v_move_id;

      UPDATE public.warehouse_transfer_items
         SET qty_received = v_qty_received,
             loss_qty     = v_loss_qty,
             loss_movement_id = v_move_id
       WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND line_no = v_line.line_no;
    ELSE
      UPDATE public.warehouse_transfer_items
         SET qty_received = v_qty_received,
             loss_qty     = NULL
       WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND line_no = v_line.line_no;
    END IF;
  END LOOP;

  v_final_status := CASE WHEN v_total_loss = 0 THEN 'RECEIVED' ELSE 'PARTIAL' END;

  UPDATE public.warehouse_transfers
     SET status              = v_final_status,
         received_at         = now(),
         received_by_user_id = v_actor,
         total_qty_received  = v_total_recv,
         total_loss_qty      = CASE WHEN v_total_loss = 0 THEN NULL ELSE v_total_loss END,
         updated_at          = now()
   WHERE tenant_id = v_tenant AND id = p_transfer_id;

  -- Owner-inbox alert on PARTIAL (best-effort)
  IF v_final_status = 'PARTIAL' THEN
    BEGIN
      INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
      SELECT v_tenant, au.id, 'TRANSFER_PARTIAL_LOSS',
             'warehouse_transfer', p_transfer_id::text,
             format('Selisih transfer %s -%s pcs, cek ke gudang', v_xfer.doc_no, v_total_loss), now()
        FROM public.admin_users au
       WHERE au.tenant_id = v_tenant AND au.can_approve_adjustment = true;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  END IF;

  RAISE LOG 'warehouse_transfer received tenant=% id=% status=% total_recv=% loss=% actor=%',
    v_tenant, p_transfer_id, v_final_status, v_total_recv, v_total_loss, v_actor;

  RETURN jsonb_build_object('status', v_final_status, 'total_loss_qty', v_total_loss);
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_warehouse_transfer(bigint, jsonb) TO authenticated;
```

- [ ] **Step 2: Apply + verify function shape**

```sql
SELECT prosecdef, provolatile FROM pg_proc WHERE proname='receive_warehouse_transfer';
-- Expected: t, v
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261115000216_receive_warehouse_transfer.sql
git commit -m "feat(warehouse-transfer): receive RPC (slot 216)

Loss on PARTIAL logged as audit-only stock_movements row (source=transfer_loss)
per spec §5.2.1 — does not double-deduct stock_levels. FOR UPDATE on parent
serializes concurrent receive attempts."
```

---

### Task 8: Migration 217 — `cancel_warehouse_transfer` RPC

**Spec ref:** §5.3.

**Files:**
- Create: `supabase/migrations/20261115000217_cancel_warehouse_transfer.sql`

**Interfaces:**
- Consumes: parent + items, stock_levels, stock_movements enum
- Produces: `cancel_warehouse_transfer(bigint, text) RETURNS jsonb`

- [ ] **Step 1: Write migration**

```sql
-- 20261115000217_cancel_warehouse_transfer.sql
-- Sender-only cancel RPC. Full contract: spec §5.3.

CREATE OR REPLACE FUNCTION public.cancel_warehouse_transfer(
  p_transfer_id bigint,
  p_reason      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_actor  uuid;
  v_xfer   record;
  v_line   record;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_actor  := auth.uid();
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_xfer FROM public.warehouse_transfers
   WHERE tenant_id = v_tenant AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND: id=%', p_transfer_id; END IF;
  IF v_xfer.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'TRANSFER_WRONG_STATUS: current=%', v_xfer.status;
  END IF;
  IF v_xfer.sender_user_id <> v_actor THEN
    RAISE EXCEPTION 'TRANSFER_NOT_SENDER: sender=% actor=%', v_xfer.sender_user_id, v_actor;
  END IF;

  -- Credit each line's qty back to source stock_levels + audit row
  FOR v_line IN
    SELECT sku, qty_sent FROM public.warehouse_transfer_items
     WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id
     ORDER BY line_no
     FOR UPDATE
  LOOP
    UPDATE public.stock_levels
       SET qty = qty + v_line.qty_sent, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = v_xfer.from_warehouse_id;

    -- Direct INSERT (NOT via _log_stock_movement) — helper does not accept
    -- warehouse_id, and post-insert UPDATE to set warehouse_id is blocked
    -- by trg_deny_sm_update. Pattern verified in 20261115000108_smoke_test_bug_fixes.sql
    -- (memory: smoke_test_bug_fixes Bug 2/3 — same pattern used by
    --  resolve_supplier_claim + _apply_opname_change damage loop).
    INSERT INTO public.stock_movements
      (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
       source, related_doc_type, related_doc_id, actor_user_id, created_at)
    VALUES
      (v_line.sku, v_xfer.from_warehouse_id, NULL,
       v_line.qty_sent, 0, v_line.qty_sent,
       'transfer_cancel_return'::public.stock_movement_source,
       'warehouse_transfer', p_transfer_id::text, v_actor, now());
  END LOOP;

  UPDATE public.warehouse_transfers
     SET status               = 'CANCELLED',
         cancelled_at         = now(),
         cancelled_by_user_id = v_actor,
         cancel_reason        = p_reason,
         updated_at           = now()
   WHERE tenant_id = v_tenant AND id = p_transfer_id;

  -- Notify receiver (best-effort)
  BEGIN
    INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
    VALUES (v_tenant, v_xfer.receiver_user_id, 'TRANSFER_CANCELLED',
            'warehouse_transfer', p_transfer_id::text,
            format('Transfer %s dibatalkan sender', v_xfer.doc_no), now());
  EXCEPTION WHEN undefined_table THEN NULL; END;

  RAISE LOG 'warehouse_transfer cancelled tenant=% id=% actor=% reason=%',
    v_tenant, p_transfer_id, v_actor, p_reason;

  RETURN jsonb_build_object('status', 'CANCELLED');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_warehouse_transfer(bigint, text) TO authenticated;
```

- [ ] **Step 2: Apply + verify**

```sql
SELECT prosecdef FROM pg_proc WHERE proname='cancel_warehouse_transfer';
-- Expected: t
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261115000217_cancel_warehouse_transfer.sql
git commit -m "feat(warehouse-transfer): cancel RPC (slot 217)

Only sender can cancel while IN_TRANSIT. Credits source stock_levels back
+ logs transfer_cancel_return audit row."
```

---

### Task 9: Migration 218 — read RPCs (list, detail, in-transit)

**Spec ref:** §5.4.

**Files:**
- Create: `supabase/migrations/20261115000218_warehouse_transfer_read_rpcs.sql`

**Interfaces:**
- Produces:
  - `list_warehouse_transfers(p_status_filter text[], p_warehouse_id uuid, p_search text, p_since timestamptz, p_limit int, p_cursor bigint) RETURNS SETOF jsonb`
  - `get_warehouse_transfer_detail(p_transfer_id bigint) RETURNS jsonb`
  - `get_in_transit_by_warehouse(p_warehouse_id uuid) RETURNS TABLE(sku text, in_transit_qty int)`

- [ ] **Step 1: Write migration**

```sql
-- 20261115000218_warehouse_transfer_read_rpcs.sql
-- Read-side RPCs for list screen, detail screen, in-transit chip.

-- ── list_warehouse_transfers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_warehouse_transfers(
  p_status_filter text[]      DEFAULT NULL,   -- ['IN_TRANSIT','RECEIVED',...]
  p_warehouse_id  uuid        DEFAULT NULL,   -- filter to transfers touching this warehouse (either side)
  p_search        text        DEFAULT NULL,   -- substring of doc_no
  p_since         timestamptz DEFAULT NULL,   -- initiated_at cutoff
  p_limit         int         DEFAULT 50,
  p_cursor        bigint      DEFAULT NULL    -- last id from previous page (DESC order)
) RETURNS TABLE(
  id                 bigint,
  doc_no             text,
  from_warehouse_id  uuid,
  to_warehouse_id    uuid,
  sender_user_id     uuid,
  receiver_user_id   uuid,
  status             text,
  total_qty_sent     int,
  total_qty_received int,
  total_loss_qty     int,
  initiated_at       timestamptz,
  received_at        timestamptz,
  cancelled_at       timestamptz,
  n_items            int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  WITH base AS (
    SELECT wt.*, (SELECT COUNT(*)::int FROM public.warehouse_transfer_items i
                    WHERE i.tenant_id = wt.tenant_id AND i.transfer_id = wt.id) AS n_items
      FROM public.warehouse_transfers wt
     WHERE wt.tenant_id = public._resolve_tenant_id()
       AND (p_status_filter IS NULL OR wt.status = ANY(p_status_filter))
       AND (p_warehouse_id IS NULL OR wt.from_warehouse_id = p_warehouse_id OR wt.to_warehouse_id = p_warehouse_id)
       AND (p_search IS NULL OR wt.doc_no ILIKE '%' || p_search || '%')
       AND (p_since IS NULL OR wt.initiated_at >= p_since)
       AND (p_cursor IS NULL OR wt.id < p_cursor)
  )
  SELECT id, doc_no, from_warehouse_id, to_warehouse_id, sender_user_id, receiver_user_id,
         status, total_qty_sent, total_qty_received, total_loss_qty,
         initiated_at, received_at, cancelled_at, n_items
    FROM base
   ORDER BY initiated_at DESC, id DESC
   LIMIT LEAST(COALESCE(p_limit, 50), 200);
$$;
GRANT EXECUTE ON FUNCTION public.list_warehouse_transfers(text[], uuid, text, timestamptz, int, bigint) TO authenticated;

-- ── get_warehouse_transfer_detail ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_warehouse_transfer_detail(p_transfer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_tenant uuid := public._resolve_tenant_id();
  v_header jsonb;
  v_items  jsonb;
BEGIN
  SELECT to_jsonb(wt.*) INTO v_header FROM public.warehouse_transfers wt
   WHERE wt.tenant_id = v_tenant AND wt.id = p_transfer_id;
  IF v_header IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(to_jsonb(i.*) ORDER BY i.line_no) INTO v_items
    FROM public.warehouse_transfer_items i
   WHERE i.tenant_id = v_tenant AND i.transfer_id = p_transfer_id;

  RETURN jsonb_build_object('header', v_header, 'items', COALESCE(v_items, '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_warehouse_transfer_detail(bigint) TO authenticated;

-- ── get_in_transit_by_warehouse ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_in_transit_by_warehouse(p_warehouse_id uuid)
RETURNS TABLE(sku text, in_transit_qty int)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT i.sku,
         SUM(i.qty_sent - COALESCE(i.qty_received, 0))::int AS in_transit_qty
    FROM public.warehouse_transfer_items i
    JOIN public.warehouse_transfers wt
      ON (wt.tenant_id, wt.id) = (i.tenant_id, i.transfer_id)
   WHERE wt.tenant_id = public._resolve_tenant_id()
     AND wt.to_warehouse_id = p_warehouse_id
     AND wt.status = 'IN_TRANSIT'
   GROUP BY i.sku;
$$;
GRANT EXECUTE ON FUNCTION public.get_in_transit_by_warehouse(uuid) TO authenticated;
```

- [ ] **Step 2: Apply + smoke queries**

```sql
SELECT * FROM public.list_warehouse_transfers();
-- Expected: 0 rows (no transfers yet)

SELECT public.get_warehouse_transfer_detail(1);
-- Expected: NULL

SELECT * FROM public.get_in_transit_by_warehouse(gen_random_uuid());
-- Expected: 0 rows
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261115000218_warehouse_transfer_read_rpcs.sql
git commit -m "feat(warehouse-transfer): read RPCs — list, detail, in-transit (slot 218)"
```

---

### Task 10: Migration 219 — legacy `transfer_warehouse` compat shim

**Spec ref:** §5.5.

**Files:**
- Create: `supabase/migrations/20261115000219_legacy_transfer_warehouse_shim.sql`

**Interfaces:**
- Consumes: `initiate_warehouse_transfer`, `receive_warehouse_transfer`
- Produces: rewritten `transfer_warehouse(text, text, text, int)` that proxies to new RPCs

- [ ] **Step 1: Write migration**

```sql
-- 20261115000219_legacy_transfer_warehouse_shim.sql
-- Rewrite legacy transfer_warehouse(sku, from text, to text, qty) as a proxy.
-- Looks up warehouse UUIDs from atas/bawah text, calls initiate + auto-receive
-- (same actor sender+receiver — legacy semantic was single-shot).
-- Emits RAISE WARNING to encourage caller migration.
-- Body: replaces the SECDEF body from 20260612000001_fix_transfer_warehouse_security_definer.sql

CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku  text, p_from text, p_to text, p_qty int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant     uuid := public._resolve_tenant_id();
  v_actor      uuid := auth.uid();
  v_from_wh    uuid;
  v_to_wh      uuid;
  v_result     jsonb;
  v_xfer_id    bigint;
BEGIN
  RAISE WARNING 'transfer_warehouse(text,text,text,int) is DEPRECATED. Use initiate_warehouse_transfer instead. Will be removed next release.';

  SELECT id INTO v_from_wh FROM public.warehouses
   WHERE (tenant_id = v_tenant OR tenant_id IS NULL) AND upper(code) = upper(p_from);
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_warehouse legacy shim: from warehouse code % not found', p_from; END IF;

  SELECT id INTO v_to_wh FROM public.warehouses
   WHERE (tenant_id = v_tenant OR tenant_id IS NULL) AND upper(code) = upper(p_to);
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_warehouse legacy shim: to warehouse code % not found', p_to; END IF;

  -- Sender = receiver = actor (legacy was single-shot)
  v_result := public.initiate_warehouse_transfer(
    p_from_warehouse_id => v_from_wh,
    p_to_warehouse_id   => v_to_wh,
    p_receiver_user_id  => v_actor,
    p_notes             => 'legacy transfer_warehouse call',
    p_client_request_id => NULL,
    p_items             => jsonb_build_array(jsonb_build_object('sku', p_sku, 'qty', p_qty))
  );
  v_xfer_id := (v_result->>'transfer_id')::bigint;

  PERFORM public.receive_warehouse_transfer(
    p_transfer_id => v_xfer_id,
    p_items       => jsonb_build_array(jsonb_build_object('sku', p_sku, 'qty_received', p_qty))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_warehouse(text, text, text, int) TO authenticated;
```

- [ ] **Step 2: Apply + smoke**

```sql
-- Verify function body was replaced (not the old one)
SELECT pg_get_functiondef('public.transfer_warehouse(text, text, text, int)'::regprocedure)
       ~ 'initiate_warehouse_transfer' AS body_calls_new_rpc;
-- Expected: t
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261115000219_legacy_transfer_warehouse_shim.sql
git commit -m "feat(warehouse-transfer): legacy transfer_warehouse compat shim (slot 219)

Proxies to initiate+receive with sender=receiver=actor semantics. Emits
RAISE WARNING to nudge caller migration. Slated for removal next release."
```

---

### Task 11: Migration 220 — seed permissions

**Spec ref:** §5.1 (permission gate), §5.2 (receiver gate).

**Files:**
- Create: `supabase/migrations/20261115000220_seed_warehouse_transfer_permissions.sql`

**Interfaces:**
- Consumes: `admin_users` table + existing permission columns pattern (verify actual column shape in DB before writing)
- Produces: two boolean flags `can_transfer_warehouse` + `can_receive_warehouse_transfer` (either as columns or as `permissions` table rows depending on repo convention — implementer verifies in first step)

- [ ] **Step 1: Determine permission storage model in this repo**

```bash
grep -rn "can_manage_warehouses\|can_approve_adjustment" supabase/migrations/ | grep -iE "add column|create table|insert into" | head -5
```
Note: pick the same pattern (column vs row) used by `can_manage_warehouses`. Write migration matching that pattern.

- [ ] **Step 2: Write migration (assuming column-per-permission pattern based on Sidebar.tsx `permKey` usage)**

```sql
-- 20261115000220_seed_warehouse_transfer_permissions.sql
-- Add can_transfer_warehouse + can_receive_warehouse_transfer boolean
-- columns on admin_users. Backfill: anyone with can_manage_warehouses=true
-- gets both defaulted true. Owner users get both.

BEGIN;

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS can_transfer_warehouse         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_receive_warehouse_transfer boolean NOT NULL DEFAULT false;

UPDATE public.admin_users
   SET can_transfer_warehouse         = true,
       can_receive_warehouse_transfer = true
 WHERE can_manage_warehouses = true;

UPDATE public.admin_users
   SET can_transfer_warehouse         = true,
       can_receive_warehouse_transfer = true
 WHERE role IN ('OWNER','ADMIN');

COMMIT;
```

- [ ] **Step 3: If pattern is `permissions` row table instead — rewrite Step 2**

Adjust migration body to `INSERT INTO permissions (permission_key, ...) VALUES (...) ON CONFLICT DO NOTHING`. Backfill via `INSERT INTO admin_user_permissions (user_id, permission_key) SELECT id, 'can_transfer_warehouse' FROM admin_users WHERE ...`.

- [ ] **Step 4: Apply + verify backfill**

```sql
SELECT COUNT(*) FROM public.admin_users WHERE can_transfer_warehouse = true;
-- Expected: at least 1 (Garindo tenant owners)
```

- [ ] **Step 5: Retro-add permission gate to `initiate_warehouse_transfer`**

Re-run Task 6's `CREATE OR REPLACE`, adding after the tenant-membership check:
```sql
IF NOT EXISTS (
  SELECT 1 FROM public.admin_users
   WHERE id = p_receiver_user_id AND tenant_id = v_tenant
     AND can_receive_warehouse_transfer = true
) THEN
  RAISE EXCEPTION 'TRANSFER_INVALID_RECEIVER: user % lacks can_receive_warehouse_transfer', p_receiver_user_id;
END IF;
```
Include the replaced RPC body as part of migration 220 so the check ships in the same transaction as the column add.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261115000220_seed_warehouse_transfer_permissions.sql
git commit -m "feat(warehouse-transfer): seed permissions + tighten receiver gate (slot 220)"
```

---

### Task 12: Migration 221 — smoke test (full lifecycle, rollback)

**Spec ref:** §7 slot 221, memory `smoke_test_security_definer_rpcs`.

**Files:**
- Create: `supabase/migrations/20261115000221_smoke_test_warehouse_transfer.sql`

**Interfaces:**
- Consumes: all RPCs from Tasks 6-10, seed data (Garindo tenant, 2 warehouses ATAS/BAWAH, 1 test SKU)
- Produces: no persistent side effect — `RAISE EXCEPTION` at end rolls back everything

- [ ] **Step 1: Write migration**

```sql
-- 20261115000221_smoke_test_warehouse_transfer.sql
-- Full lifecycle smoke: initiate → receive full, initiate → receive partial,
-- initiate → cancel. Runs as a DO block with faked auth.uid via set_config,
-- then RAISE EXCEPTION at end to rollback everything.
-- Per memory: smoke_test_security_definer_rpcs.

DO $$
DECLARE
  v_tenant     uuid;
  v_sender     uuid;
  v_receiver   uuid;
  v_from_wh    uuid;
  v_to_wh      uuid;
  v_sku        text;
  v_result     jsonb;
  v_xfer1      bigint; v_xfer2 bigint; v_xfer3 bigint;
  v_status     text;
BEGIN
  -- Pick any tenant with ≥2 warehouses + ≥1 stock row
  SELECT wt.tenant_id, wt.id, wf.id
    INTO v_tenant, v_to_wh, v_from_wh
    FROM public.warehouses wf
    JOIN public.warehouses wt ON wt.tenant_id = wf.tenant_id AND wt.id <> wf.id
   WHERE wf.is_active AND wt.is_active
   LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'smoke test: no tenant with 2 active warehouses found';
  END IF;

  SELECT id INTO v_sender FROM public.admin_users
   WHERE tenant_id = v_tenant AND can_transfer_warehouse = true LIMIT 1;
  SELECT id INTO v_receiver FROM public.admin_users
   WHERE tenant_id = v_tenant AND can_receive_warehouse_transfer = true LIMIT 1;
  IF v_sender IS NULL OR v_receiver IS NULL THEN
    RAISE EXCEPTION 'smoke test: no eligible sender/receiver in tenant %', v_tenant;
  END IF;

  SELECT sl.sku INTO v_sku FROM public.stock_levels sl
   WHERE sl.warehouse_id = v_from_wh AND sl.qty >= 10
   LIMIT 1;
  IF v_sku IS NULL THEN
    RAISE EXCEPTION 'smoke test: no SKU with ≥10 qty in warehouse %', v_from_wh;
  END IF;

  -- Fake auth.uid = sender for initiate
  PERFORM set_config('request.jwt.claim.sub', v_sender::text, true);

  -- Case A: initiate → receive full
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke A',
              gen_random_uuid()::text, jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 3)));
  v_xfer1 := (v_result->>'transfer_id')::bigint;
  PERFORM set_config('request.jwt.claim.sub', v_receiver::text, true);
  v_result := public.receive_warehouse_transfer(v_xfer1,
              jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty_received', 3)));
  ASSERT v_result->>'status' = 'RECEIVED', format('A: expected RECEIVED, got %s', v_result->>'status');

  -- Case B: initiate → receive partial
  PERFORM set_config('request.jwt.claim.sub', v_sender::text, true);
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke B',
              gen_random_uuid()::text, jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 5)));
  v_xfer2 := (v_result->>'transfer_id')::bigint;
  PERFORM set_config('request.jwt.claim.sub', v_receiver::text, true);
  v_result := public.receive_warehouse_transfer(v_xfer2,
              jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty_received', 3)));
  ASSERT v_result->>'status' = 'PARTIAL', format('B: expected PARTIAL, got %s', v_result->>'status');
  ASSERT (v_result->>'total_loss_qty')::int = 2, 'B: expected loss=2';

  -- Case C: initiate → cancel
  PERFORM set_config('request.jwt.claim.sub', v_sender::text, true);
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke C',
              gen_random_uuid()::text, jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 2)));
  v_xfer3 := (v_result->>'transfer_id')::bigint;
  v_result := public.cancel_warehouse_transfer(v_xfer3, 'smoke cancel');
  ASSERT v_result->>'status' = 'CANCELLED', format('C: expected CANCELLED, got %s', v_result->>'status');

  -- Case D: idempotency
  PERFORM set_config('request.jwt.claim.sub', v_sender::text, true);
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke D',
              'fixed-token-D', jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 1)));
  ASSERT (v_result->>'idempotent')::bool = false, 'D1: first call must be non-idempotent';
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke D',
              'fixed-token-D', jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 1)));
  ASSERT (v_result->>'idempotent')::bool = true, 'D2: second call must be idempotent';

  RAISE NOTICE 'smoke test PASSED for tenant %', v_tenant;
  RAISE EXCEPTION 'smoke test complete — intentional rollback (memory: smoke_test_security_definer_rpcs)';
END $$;
```

- [ ] **Step 2: Apply migration — expect intentional error**

Run via MCP `apply_migration`. Expected exit: exception "smoke test complete — intentional rollback". If any ASSERT fails first, fix the RPC in the failing task and re-run.

- [ ] **Step 3: Update `scripts/apply-pending-migrations.sh`**

Append the 12 new migration filenames to the pending array so real deploy runs them. Add a comment noting migration 221 is smoke-test-only:
```bash
# ── Warehouse transfer feature (spec 2026-07-12) ──
"20261115000210_drop_warehouse_transfers_stub.sql"
"20261115000211_warehouse_transfers_schema.sql"
"20261115000212_recreate_transfer_aging_view.sql"
"20261115000213_extend_stock_movement_source_enum.sql"
"20261115000214_warehouse_transfers_rls.sql"
"20261115000215_initiate_warehouse_transfer.sql"
"20261115000216_receive_warehouse_transfer.sql"
"20261115000217_cancel_warehouse_transfer.sql"
"20261115000218_warehouse_transfer_read_rpcs.sql"
"20261115000219_legacy_transfer_warehouse_shim.sql"
"20261115000220_seed_warehouse_transfer_permissions.sql"
# Note: 221 is a smoke-test migration that RAISE EXCEPTIONs at end for
# rollback. Include only when running against a scratch branch, not prod.
# "20261115000221_smoke_test_warehouse_transfer.sql"
```

- [ ] **Step 4: Run `get_advisors` and triage**

```
Run MCP: mcp__plugin_supabase_supabase__get_advisors --type security
Run MCP: mcp__plugin_supabase_supabase__get_advisors --type performance
```
Log any findings in `progress.md` (Phase D task). No new critical warnings should appear from the 12 migrations.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000221_smoke_test_warehouse_transfer.sql scripts/apply-pending-migrations.sh
git commit -m "test(warehouse-transfer): full-lifecycle smoke migration (slot 221)

Covers full receive, partial receive, cancel, idempotency. Uses
set_config fake auth.uid + RAISE EXCEPTION rollback per memory
smoke_test_security_definer_rpcs. Deploy script skips slot 221 by comment."
```

---

## Phase B — FE service + hook + PDF

### Task 13: `warehouseTransferService.ts` + types

**Files:**
- Create: `src/lib/warehouseTransferService.ts`
- Create: `src/components/warehouseTransfer/__tests__/WarehouseTransferService.test.ts`
- Modify: `src/types.ts` (or add module-local types)

**Interfaces:**
- Consumes: `supabase` client from `src/lib/supabaseClient.ts`, RPCs from Phase A tasks 6-9
- Produces:
  - Type `WarehouseTransferStatus = 'IN_TRANSIT' | 'RECEIVED' | 'PARTIAL' | 'CANCELLED'`
  - Type `WarehouseTransferHeader` (matches spec §4.1 row shape)
  - Type `WarehouseTransferItem` (matches spec §4.2 row shape)
  - Type `WarehouseTransferDetail = { header: WarehouseTransferHeader; items: WarehouseTransferItem[] }`
  - Fn `initiateTransfer(input): Promise<{ transfer_id: number; doc_no: string; idempotent: boolean }>`
  - Fn `receiveTransfer(id, items): Promise<{ status: WarehouseTransferStatus; total_loss_qty: number }>`
  - Fn `cancelTransfer(id, reason): Promise<{ status: 'CANCELLED' }>`
  - Fn `listTransfers(filters): Promise<WarehouseTransferHeader[]>`
  - Fn `getTransferDetail(id): Promise<WarehouseTransferDetail | null>`
  - Fn `getInTransitByWarehouse(warehouseId): Promise<Array<{ sku: string; in_transit_qty: number }>>`

- [ ] **Step 1: Write the failing service test**

```ts
// src/components/warehouseTransfer/__tests__/WarehouseTransferService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { warehouseTransferService } from '../../../lib/warehouseTransferService';
import { supabase } from '../../../lib/supabaseClient';

vi.mock('../../../lib/supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}));

describe('warehouseTransferService.initiateTransfer', () => {
  beforeEach(() => vi.clearAllMocks());
  it('calls RPC with mapped params and returns typed result', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { transfer_id: 42, doc_no: 'TR-2026-07-001', idempotent: false }, error: null });
    const r = await warehouseTransferService.initiateTransfer({
      fromWarehouseId: 'wh-a', toWarehouseId: 'wh-b',
      receiverUserId: 'u-1', notes: 'test', clientRequestId: 'req-1',
      items: [{ sku: 'S1', qty: 5 }],
    });
    expect(supabase.rpc).toHaveBeenCalledWith('initiate_warehouse_transfer', {
      p_from_warehouse_id: 'wh-a', p_to_warehouse_id: 'wh-b',
      p_receiver_user_id: 'u-1', p_notes: 'test', p_client_request_id: 'req-1',
      p_items: [{ sku: 'S1', qty: 5 }],
    });
    expect(r).toEqual({ transfer_id: 42, doc_no: 'TR-2026-07-001', idempotent: false });
  });
  it('surfaces RPC error message', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null, error: { code: 'P0001', message: 'TRANSFER_INSUFFICIENT_STOCK: sku=S1 tersedia=2 diminta=5' } });
    await expect(warehouseTransferService.initiateTransfer({
      fromWarehouseId: 'wh-a', toWarehouseId: 'wh-b', receiverUserId: 'u-1',
      notes: null, clientRequestId: null, items: [{ sku: 'S1', qty: 5 }],
    })).rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining('TRANSFER_INSUFFICIENT_STOCK') });
  });
});
```

- [ ] **Step 2: Run — verify red**

```bash
npx vitest run src/components/warehouseTransfer/__tests__/WarehouseTransferService.test.ts
```
Expected FAIL: `Cannot find module '../../../lib/warehouseTransferService'`.

- [ ] **Step 3: Write minimal service**

```ts
// src/lib/warehouseTransferService.ts
import { supabase } from './supabaseClient';

export type WarehouseTransferStatus = 'IN_TRANSIT' | 'RECEIVED' | 'PARTIAL' | 'CANCELLED';

export interface WarehouseTransferHeader {
  id: number;
  doc_no: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  sender_user_id: string;
  receiver_user_id: string;
  status: WarehouseTransferStatus;
  total_qty_sent: number;
  total_qty_received: number | null;
  total_loss_qty: number | null;
  initiated_at: string;
  received_at: string | null;
  cancelled_at: string | null;
  n_items: number;
  notes?: string | null;
  cancel_reason?: string | null;
}

export interface WarehouseTransferItem {
  transfer_id: number;
  line_no: number;
  sku: string;
  qty_sent: number;
  qty_received: number | null;
  loss_qty: number | null;
  loss_movement_id: number | null;
}

export interface WarehouseTransferDetail {
  header: WarehouseTransferHeader;
  items: WarehouseTransferItem[];
}

export interface InitiateTransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  receiverUserId: string;
  notes: string | null;
  clientRequestId: string | null;
  items: Array<{ sku: string; qty: number }>;
}

async function initiateTransfer(input: InitiateTransferInput) {
  const { data, error } = await supabase.rpc('initiate_warehouse_transfer', {
    p_from_warehouse_id: input.fromWarehouseId,
    p_to_warehouse_id:   input.toWarehouseId,
    p_receiver_user_id:  input.receiverUserId,
    p_notes:             input.notes,
    p_client_request_id: input.clientRequestId,
    p_items:             input.items,
  });
  if (error) throw error;
  return data as { transfer_id: number; doc_no: string; idempotent: boolean };
}

async function receiveTransfer(
  transferId: number,
  items: Array<{ sku: string; qty_received: number }>,
) {
  const { data, error } = await supabase.rpc('receive_warehouse_transfer', {
    p_transfer_id: transferId, p_items: items,
  });
  if (error) throw error;
  return data as { status: WarehouseTransferStatus; total_loss_qty: number };
}

async function cancelTransfer(transferId: number, reason: string) {
  const { data, error } = await supabase.rpc('cancel_warehouse_transfer', {
    p_transfer_id: transferId, p_reason: reason,
  });
  if (error) throw error;
  return data as { status: 'CANCELLED' };
}

export interface ListFilters {
  statusFilter?: WarehouseTransferStatus[] | null;
  warehouseId?: string | null;
  search?: string | null;
  since?: string | null;
  limit?: number;
  cursor?: number | null;
}

async function listTransfers(filters: ListFilters = {}) {
  const { data, error } = await supabase.rpc('list_warehouse_transfers', {
    p_status_filter: filters.statusFilter ?? null,
    p_warehouse_id:  filters.warehouseId ?? null,
    p_search:        filters.search ?? null,
    p_since:         filters.since ?? null,
    p_limit:         filters.limit ?? 50,
    p_cursor:        filters.cursor ?? null,
  });
  if (error) throw error;
  return (data ?? []) as WarehouseTransferHeader[];
}

async function getTransferDetail(id: number): Promise<WarehouseTransferDetail | null> {
  const { data, error } = await supabase.rpc('get_warehouse_transfer_detail', { p_transfer_id: id });
  if (error) throw error;
  return data as WarehouseTransferDetail | null;
}

async function getInTransitByWarehouse(warehouseId: string) {
  const { data, error } = await supabase.rpc('get_in_transit_by_warehouse', { p_warehouse_id: warehouseId });
  if (error) throw error;
  return (data ?? []) as Array<{ sku: string; in_transit_qty: number }>;
}

export const warehouseTransferService = {
  initiateTransfer,
  receiveTransfer,
  cancelTransfer,
  listTransfers,
  getTransferDetail,
  getInTransitByWarehouse,
};
```

- [ ] **Step 4: Run — verify green**

```bash
npx vitest run src/components/warehouseTransfer/__tests__/WarehouseTransferService.test.ts
```
Expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/warehouseTransferService.ts src/components/warehouseTransfer/__tests__/WarehouseTransferService.test.ts
git commit -m "feat(warehouse-transfer): FE service + types

6 RPC wrappers with typed shapes. Unit tests cover param mapping + error surfacing."
```

---

### Task 14: `useInTransitBySKU` hook

**Files:**
- Create: `src/hooks/useInTransitBySKU.ts`
- Create: `src/components/warehouseTransfer/__tests__/useInTransitBySKU.test.tsx`

**Interfaces:**
- Consumes: `warehouseTransferService.getInTransitByWarehouse` from Task 13
- Produces: `useInTransitBySKU(warehouseId: string | null): Map<string, number>` — SWR-style hook returning per-SKU in-transit qty

- [ ] **Step 1: Write failing test**

```tsx
// src/components/warehouseTransfer/__tests__/useInTransitBySKU.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useInTransitBySKU } from '../../../hooks/useInTransitBySKU';
import { warehouseTransferService } from '../../../lib/warehouseTransferService';

vi.mock('../../../lib/warehouseTransferService', () => ({
  warehouseTransferService: { getInTransitByWarehouse: vi.fn() },
}));

describe('useInTransitBySKU', () => {
  it('returns empty map for null warehouse', () => {
    const { result } = renderHook(() => useInTransitBySKU(null));
    expect(result.current.size).toBe(0);
  });
  it('populates map from service response', async () => {
    (warehouseTransferService.getInTransitByWarehouse as any).mockResolvedValue([
      { sku: 'S1', in_transit_qty: 5 }, { sku: 'S2', in_transit_qty: 12 },
    ]);
    const { result } = renderHook(() => useInTransitBySKU('wh-x'));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get('S1')).toBe(5);
    expect(result.current.get('S2')).toBe(12);
  });
});
```

- [ ] **Step 2: Run — verify red**

```bash
npx vitest run src/components/warehouseTransfer/__tests__/useInTransitBySKU.test.tsx
```

- [ ] **Step 3: Write hook**

```tsx
// src/hooks/useInTransitBySKU.ts
import { useEffect, useState } from 'react';
import { warehouseTransferService } from '../lib/warehouseTransferService';

export function useInTransitBySKU(warehouseId: string | null): Map<string, number> {
  const [map, setMap] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!warehouseId) { setMap(new Map()); return; }
    let cancelled = false;
    warehouseTransferService.getInTransitByWarehouse(warehouseId).then(rows => {
      if (cancelled) return;
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.sku, r.in_transit_qty);
      setMap(m);
    }).catch(() => { if (!cancelled) setMap(new Map()); });
    return () => { cancelled = true; };
  }, [warehouseId]);
  return map;
}
```

- [ ] **Step 4: Run — verify green + commit**

```bash
npx vitest run src/components/warehouseTransfer/__tests__/useInTransitBySKU.test.tsx
git add src/hooks/useInTransitBySKU.ts src/components/warehouseTransfer/__tests__/useInTransitBySKU.test.tsx
git commit -m "feat(warehouse-transfer): useInTransitBySKU hook"
```

---

### Task 15: `warehouseTransferPDF.ts` — surat jalan renderer

**Files:**
- Create: `src/lib/pdf/warehouseTransferPDF.ts`
- Create: `src/components/warehouseTransfer/__tests__/warehouseTransferPDF.test.ts`

**Interfaces:**
- Consumes: existing `fetchLogoDataUrl` (grep to find path — likely `src/lib/pdf/`)
- Produces: `renderTransferSuratJalan(detail, tenant, actors): Promise<Blob>`

- [ ] **Step 1: Find existing PDF utilities**

```bash
grep -rn "fetchLogoDataUrl\|jsPDF\|new jsPDF" src/lib/ src/components/ --include="*.ts" --include="*.tsx" | head -10
```
Note the import path for `fetchLogoDataUrl` and the jsPDF setup pattern.

- [ ] **Step 2: Write failing test**

```ts
// src/components/warehouseTransfer/__tests__/warehouseTransferPDF.test.ts
import { describe, it, expect } from 'vitest';
import { renderTransferSuratJalan } from '../../../lib/pdf/warehouseTransferPDF';

describe('renderTransferSuratJalan', () => {
  it('produces a non-empty PDF blob for minimal input', async () => {
    const blob = await renderTransferSuratJalan({
      header: {
        id: 1, doc_no: 'TR-2026-07-001', status: 'IN_TRANSIT',
        from_warehouse_id: 'wa', to_warehouse_id: 'wb',
        sender_user_id: 'u1', receiver_user_id: 'u2',
        total_qty_sent: 3, total_qty_received: null, total_loss_qty: null,
        initiated_at: '2026-07-12T10:23:00Z', received_at: null, cancelled_at: null,
        n_items: 1, notes: 'test',
      } as any,
      items: [{ transfer_id: 1, line_no: 1, sku: 'S1', qty_sent: 3, qty_received: null, loss_qty: null, loss_movement_id: null }],
    }, {
      tenantName: 'PT Toko Uji', tenantAddress: 'Jl. Test 1',
      fromWarehouseName: 'Gudang Atas', toWarehouseName: 'Gudang Bawah',
      senderName: 'Rudi', receiverName: 'Sari',
      skuNames: { S1: 'Cat Biru' },
      logoUrl: null,
    });
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 3: Write minimal renderer (adapt from repo's existing jsPDF pattern found in Step 1)**

```ts
// src/lib/pdf/warehouseTransferPDF.ts
import { jsPDF } from 'jspdf';
import type { WarehouseTransferDetail } from '../warehouseTransferService';

export interface TransferPDFContext {
  tenantName: string;
  tenantAddress: string | null;
  fromWarehouseName: string;
  toWarehouseName: string;
  senderName: string;
  receiverName: string;
  skuNames: Record<string, string>;
  logoUrl: string | null;
}

export async function renderTransferSuratJalan(
  detail: WarehouseTransferDetail,
  ctx: TransferPDFContext,
): Promise<Blob> {
  const doc = new jsPDF({ format: 'a5', orientation: 'portrait', unit: 'mm' });
  let y = 12;

  if (ctx.logoUrl) {
    try {
      doc.addImage(ctx.logoUrl, 'PNG', 10, y, 20, 12);
    } catch { /* ignore malformed logo */ }
  }
  doc.setFontSize(11).setFont('helvetica', 'bold');
  doc.text(ctx.tenantName.toUpperCase(), 34, y + 4);
  doc.setFontSize(8).setFont('helvetica', 'normal');
  if (ctx.tenantAddress) doc.text(ctx.tenantAddress, 34, y + 9);
  y += 18;

  doc.setDrawColor(180).line(10, y, 138, y);
  y += 5;
  doc.setFontSize(13).setFont('helvetica', 'bold');
  doc.text('SURAT JALAN TRANSFER GUDANG', 10, y);
  y += 6;
  doc.setFontSize(9).setFont('helvetica', 'normal');
  doc.text(`No. ${detail.header.doc_no}`, 10, y);
  doc.text(`Tgl. ${new Date(detail.header.initiated_at).toLocaleString('id-ID')}`, 80, y);
  y += 6;

  doc.text(`Dari:   ${ctx.fromWarehouseName}`, 10, y); y += 5;
  doc.text(`Ke:     ${ctx.toWarehouseName}`,  10, y); y += 5;
  doc.text(`Dikirim oleh:   ${ctx.senderName}`,  10, y); y += 5;
  doc.text(`Diterima oleh:  ${ctx.receiverName}`, 10, y); y += 8;

  // Items table (manual layout — no autoTable dependency)
  doc.setFont('helvetica', 'bold').setFontSize(9);
  doc.text('No.', 10, y); doc.text('SKU', 20, y); doc.text('Nama', 55, y);
  doc.text('Qty', 115, y, { align: 'right' }); doc.text('Sat', 130, y, { align: 'right' });
  y += 3; doc.line(10, y, 138, y); y += 4;
  doc.setFont('helvetica', 'normal');
  detail.items.forEach((it, i) => {
    doc.text(String(i + 1), 10, y);
    doc.text(it.sku.slice(0, 15), 20, y);
    doc.text((ctx.skuNames[it.sku] ?? '').slice(0, 30), 55, y);
    doc.text(String(it.qty_sent), 115, y, { align: 'right' });
    doc.text('pcs', 130, y, { align: 'right' });
    y += 5;
  });
  y += 2; doc.line(10, y, 138, y); y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text(`Total: ${detail.items.length} SKU · ${detail.header.total_qty_sent} pcs`, 138, y, { align: 'right' });
  y += 10;

  if (detail.header.notes) {
    doc.setFont('helvetica', 'italic').setFontSize(8);
    doc.text(`Catatan: ${detail.header.notes.slice(0, 200)}`, 10, y);
    y += 8;
  }

  // Signatures
  doc.setFont('helvetica', 'normal').setFontSize(9);
  const sigY = Math.max(y, 175);
  const cols = [12, 52, 92];
  ['Sopir', 'Pengirim', 'Penerima'].forEach((label, i) => {
    doc.text(label, cols[i], sigY);
    doc.text('_______________', cols[i], sigY + 15);
  });
  const names = ['(              )', `(${ctx.senderName})`, `(${ctx.receiverName})`];
  names.forEach((n, i) => doc.text(n, cols[i], sigY + 20));

  return doc.output('blob');
}
```

- [ ] **Step 4: Run — verify green + commit**

```bash
npx vitest run src/components/warehouseTransfer/__tests__/warehouseTransferPDF.test.ts
git add src/lib/pdf/warehouseTransferPDF.ts src/components/warehouseTransfer/__tests__/warehouseTransferPDF.test.ts
git commit -m "feat(warehouse-transfer): PDF surat jalan renderer (client-side jsPDF)"
```

---

## Phase C — FE screens

### Task 16: Sidebar entry + route wiring

**Files:**
- Modify: `src/components/Sidebar.tsx:95` — add entry after `manajemen-gudang`
- Modify: `src/App.tsx` (or router file) — add 3 routes

**Interfaces:**
- Consumes: `can_transfer_warehouse` permission from Task 11
- Produces: routes `warehouse-transfer` (list), `warehouse-transfer-create`, `warehouse-transfer-detail?id=N`

- [ ] **Step 1: Locate router — grep for existing route registration**

```bash
grep -rn "'ai-stock'\|'manajemen-gudang'\|'kasBank'" src/App.tsx src/components/App.tsx 2>/dev/null | head -10
```

- [ ] **Step 2: Add sidebar entry**

Edit `src/components/Sidebar.tsx` — after line 95:
```tsx
{ id: 'warehouse-transfer', label: 'Transfer Gudang', icon: ArrowRightLeft, category: 'inventory', permKey: 'can_transfer_warehouse' },
```
Ensure `ArrowRightLeft` is imported from `lucide-react` at the top.

- [ ] **Step 3: Add router cases** (adapt paths to actual router file)

```tsx
case 'warehouse-transfer':        return <WarehouseTransferListScreen ... />;
case 'warehouse-transfer-create': return <WarehouseTransferCreateScreen ... />;
case 'warehouse-transfer-detail': return <WarehouseTransferDetailScreen id={queryParams.get('id')} ... />;
```

- [ ] **Step 4: Sanity boot**

```bash
npm run dev
```
Sidebar shows "Transfer Gudang" under Inventory for a user with `can_transfer_warehouse=true`. Clicking it renders a placeholder (screens land in Tasks 17-20). Console clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(warehouse-transfer): sidebar entry + route wiring"
```

---

### Task 17: `WarehouseTransferListScreen` (list + KPI + filters)

**Files:**
- Create: `src/components/warehouseTransfer/WarehouseTransferListScreen.tsx`
- Test skeleton included below (add to Task 20's shared test file if convenient, or its own file)

**Interfaces:**
- Consumes: `warehouseTransferService.listTransfers`, `useWarehouses` hook, `useCurrentUser` (repo pattern; verify name)
- Produces: React component rendering the layout in spec §UI/UX Section 1

- [ ] **Step 1: Scaffold layout (design tokens: `rounded border-slate-200`, emerald/amber/slate, `font-semibold`, `text-sm`)**

```tsx
// src/components/warehouseTransfer/WarehouseTransferListScreen.tsx
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { warehouseTransferService, WarehouseTransferHeader, WarehouseTransferStatus } from '../../lib/warehouseTransferService';
import { useWarehouses } from '../../hooks/useWarehouses';

type TabKey = 'ALL' | 'IN_TRANSIT' | 'WAITING_ME' | 'DONE' | 'CANCELLED';

export default function WarehouseTransferListScreen({
  currentUserId, onOpenDetail, onOpenCreate,
}: {
  currentUserId: string;
  onOpenDetail: (id: number) => void;
  onOpenCreate: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('ALL');
  const [rows, setRows] = useState<WarehouseTransferHeader[]>([]);
  const [loading, setLoading] = useState(true);
  const { warehouses } = useWarehouses();

  useEffect(() => {
    setLoading(true);
    const filter =
      tab === 'IN_TRANSIT' ? { statusFilter: ['IN_TRANSIT' as WarehouseTransferStatus] } :
      tab === 'DONE'       ? { statusFilter: ['RECEIVED','PARTIAL'] as WarehouseTransferStatus[] } :
      tab === 'CANCELLED'  ? { statusFilter: ['CANCELLED' as WarehouseTransferStatus] } :
      {};
    warehouseTransferService.listTransfers(filter)
      .then(setRows).finally(() => setLoading(false));
  }, [tab]);

  const visibleRows = tab === 'WAITING_ME'
    ? rows.filter(r => r.status === 'IN_TRANSIT' && r.receiver_user_id === currentUserId)
    : rows;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Transfer Barang Antar Gudang</h1>
          <p className="mt-1 text-sm text-slate-500">Kirim barang antar gudang & konfirmasi terima</p>
        </div>
        <button onClick={onOpenCreate}
          className="flex items-center gap-1 rounded border border-emerald-600 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          <Plus className="h-4 w-4" />Buat Transfer Baru
        </button>
      </div>

      {/* KPI cards — 4 columns, spec §UI/UX Section 1 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="In-Transit"          value={rows.filter(r => r.status === 'IN_TRANSIT').length} />
        <KpiCard label="Menunggu Konfirmasi Anda" value={rows.filter(r => r.status === 'IN_TRANSIT' && r.receiver_user_id === currentUserId).length} />
        <KpiCard label="Diterima Hari Ini"   value={rows.filter(r => r.status === 'RECEIVED' && isToday(r.received_at)).length} />
        <KpiCard label="Selisih 30 Hari"     value={rows.filter(r => r.status === 'PARTIAL' && withinDays(r.received_at, 30)).reduce((a,b)=>a+(b.total_loss_qty ?? 0),0)} suffix="pcs" />
      </div>

      {/* Tab pills */}
      <div className="flex gap-2 flex-wrap">
        {(['ALL','IN_TRANSIT','WAITING_ME','DONE','CANCELLED'] as TabKey[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === t
              ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {tabLabel(t)}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-slate-500">Memuat…</div>}
      {!loading && visibleRows.length === 0 && (
        <div className="rounded border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {tab === 'WAITING_ME' ? 'Tidak ada transfer yang menunggu konfirmasi Anda.' : 'Belum ada transfer.'}
        </div>
      )}
      {!loading && visibleRows.map(r => (
        <TransferRow key={r.id} row={r} warehouses={warehouses} onClick={() => onOpenDetail(r.id)} />
      ))}
    </div>
  );
}

function KpiCard({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-800">{value}{suffix ? ` ${suffix}` : ''}</div>
    </div>
  );
}

function tabLabel(t: TabKey) {
  return { ALL: 'Semua', IN_TRANSIT: 'In-Transit', WAITING_ME: 'Menunggu Saya', DONE: 'Selesai', CANCELLED: 'Batal' }[t];
}

function isToday(iso: string | null) { if (!iso) return false; const d=new Date(iso); const n=new Date(); return d.toDateString()===n.toDateString(); }
function withinDays(iso: string | null, days: number) { if (!iso) return false; return (Date.now() - new Date(iso).getTime()) < days*24*3600*1000; }

function TransferRow({ row, warehouses, onClick }: { row: WarehouseTransferHeader; warehouses: Array<{id:string;name:string}>; onClick: () => void }) {
  const from = warehouses.find(w => w.id === row.from_warehouse_id)?.name ?? '?';
  const to   = warehouses.find(w => w.id === row.to_warehouse_id)?.name   ?? '?';
  const badge = statusBadge(row.status);
  return (
    <button onClick={onClick} className="w-full text-left rounded border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500">{row.doc_no}</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{from} → {to}</div>
          <div className="text-xs text-slate-500">{row.n_items} SKU · {row.total_qty_sent} pcs · {new Date(row.initiated_at).toLocaleString('id-ID')}</div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${badge.className}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClassName}`} />{badge.label}
        </span>
      </div>
    </button>
  );
}

function statusBadge(s: WarehouseTransferStatus) {
  switch (s) {
    case 'IN_TRANSIT': return { label: 'In-Transit', className: 'bg-amber-50 text-amber-800',   dotClassName: 'bg-amber-500' };
    case 'RECEIVED':   return { label: 'Diterima',   className: 'bg-emerald-50 text-emerald-800', dotClassName: 'bg-emerald-500' };
    case 'PARTIAL':    return { label: 'Selisih',    className: 'bg-orange-50 text-orange-800',  dotClassName: 'bg-orange-500' };
    case 'CANCELLED':  return { label: 'Dibatal',    className: 'bg-slate-100 text-slate-600',   dotClassName: 'bg-slate-400' };
  }
}
```

- [ ] **Step 2: Boot and eyeball**

```bash
npm run dev
```
Navigate to "Transfer Gudang". Empty state renders. Tabs switch. Console clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/warehouseTransfer/WarehouseTransferListScreen.tsx
git commit -m "feat(warehouse-transfer): list screen with KPI + filters"
```

---

### Task 18: `WarehouseTransferSKUPicker` sub-component

**Files:**
- Create: `src/components/warehouseTransfer/WarehouseTransferSKUPicker.tsx`

**Interfaces:**
- Consumes: `stocks` search RPC (grep for existing SKU picker in repo to reuse pattern — e.g. `SearchableSelect` or bespoke)
- Produces: controlled component `<WarehouseTransferSKUPicker fromWarehouseId={id} lines={[]} onChange={fn}/>` — line-add + line-edit + line-delete

- [ ] **Step 1: Grep existing SKU picker pattern**

```bash
grep -rn "search.*stock\|SKU.*picker\|autocomplete.*sku" src/components/ --include="*.tsx" | head -10
```

- [ ] **Step 2: Implement (reuse repo's SKU-search RPC; skeleton below)**

```tsx
// src/components/warehouseTransfer/WarehouseTransferSKUPicker.tsx
import { useState } from 'react';
import { X, Search } from 'lucide-react';

export interface TransferLine { sku: string; name: string; qty: number; stockAvailable: number; }
interface Props {
  fromWarehouseId: string | null;
  lines: TransferLine[];
  onChange: (next: TransferLine[]) => void;
  searchSKU: (term: string) => Promise<Array<{ sku: string; name: string; qty: number }>>;
}

export default function WarehouseTransferSKUPicker({ fromWarehouseId, lines, onChange, searchSKU }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ sku: string; name: string; qty: number }>>([]);

  async function handleSearch(term: string) {
    setQuery(term);
    if (term.length < 2 || !fromWarehouseId) { setResults([]); return; }
    setResults((await searchSKU(term)).filter(r => !lines.some(l => l.sku === r.sku)));
  }
  function addLine(r: { sku: string; name: string; qty: number }) {
    onChange([...lines, { sku: r.sku, name: r.name, qty: 1, stockAvailable: r.qty }]);
    setQuery(''); setResults([]);
  }
  function updateQty(i: number, qty: number) {
    onChange(lines.map((l, idx) => idx === i ? { ...l, qty: Math.max(1, Math.min(qty, l.stockAvailable)) } : l));
  }
  function removeLine(i: number) { onChange(lines.filter((_, idx) => idx !== i)); }

  const total = lines.reduce((a, b) => a + b.qty, 0);

  return (
    <div className="rounded border border-slate-200 bg-white p-4 space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input value={query} onChange={e => handleSearch(e.target.value)} placeholder="Cari SKU / scan barcode…"
          disabled={!fromWarehouseId}
          className="w-full rounded border border-slate-300 pl-9 pr-3 py-2 text-sm disabled:bg-slate-50" />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded border border-slate-200 bg-white shadow-lg max-h-64 overflow-auto">
            {results.map(r => (
              <button key={r.sku} onClick={() => addLine(r)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span><span className="font-mono text-xs text-slate-500">{r.sku}</span> · {r.name}</span>
                <span className="text-xs text-slate-500">{r.qty} pcs</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {lines.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr><th className="text-left py-1">SKU / Nama</th><th className="text-right py-1">Stok</th><th className="text-right py-1">Qty Kirim</th><th></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.sku} className="border-t border-slate-100">
                <td className="py-2"><span className="font-mono text-xs text-slate-500">{l.sku}</span> · {l.name}</td>
                <td className="py-2 text-right">{l.stockAvailable}</td>
                <td className="py-2 text-right">
                  <input type="number" min={1} max={l.stockAvailable} value={l.qty}
                    onChange={e => updateQty(i, parseInt(e.target.value || '1', 10))}
                    className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm" />
                </td>
                <td className="py-2 pl-2"><button onClick={() => removeLine(i)}><X className="h-4 w-4 text-slate-400 hover:text-red-500" /></button></td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-semibold">
              <td colSpan={2} className="py-2 text-right text-slate-500">Total:</td>
              <td className="py-2 text-right">{lines.length} SKU · {total} pcs</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/warehouseTransfer/WarehouseTransferSKUPicker.tsx
git commit -m "feat(warehouse-transfer): SKU picker with autocomplete + line edit"
```

---

### Task 19: `WarehouseTransferCreateScreen` (sender form)

**Files:**
- Create: `src/components/warehouseTransfer/WarehouseTransferCreateScreen.tsx`
- Create: `src/components/warehouseTransfer/__tests__/WarehouseTransferCreateScreen.test.tsx`

**Interfaces:**
- Consumes: `useWarehouses`, service SKU search (grep for repo pattern), tenant users query for receiver dropdown
- Produces: sender form matching spec §UI/UX Section 2

- [ ] **Step 1: Write component test (submit path)**

```tsx
// src/components/warehouseTransfer/__tests__/WarehouseTransferCreateScreen.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WarehouseTransferCreateScreen from '../WarehouseTransferCreateScreen';
import { warehouseTransferService } from '../../../lib/warehouseTransferService';

vi.mock('../../../lib/warehouseTransferService', () => ({
  warehouseTransferService: { initiateTransfer: vi.fn().mockResolvedValue({ transfer_id: 5, doc_no: 'TR-2026-07-005', idempotent: false }) },
}));
vi.mock('../../../hooks/useWarehouses', () => ({ useWarehouses: () => ({ warehouses: [
  { id: 'wa', name: 'Gudang Atas' }, { id: 'wb', name: 'Gudang Bawah' } ] }) }));

describe('WarehouseTransferCreateScreen', () => {
  it('calls initiateTransfer with mapped payload on submit', async () => {
    const onDone = vi.fn();
    render(<WarehouseTransferCreateScreen currentUserId="me" onDone={onDone} onCancel={() => {}}
      searchSKU={async () => [{ sku: 'S1', name: 'Cat Biru', qty: 100 }]}
      listReceivers={async () => [{ id: 'u2', name: 'Sari' }]} />);
    fireEvent.change(screen.getByLabelText(/Dari Gudang/i), { target: { value: 'wa' } });
    fireEvent.change(screen.getByLabelText(/Ke Gudang/i),   { target: { value: 'wb' } });
    // ... (add SKU flow via picker) — verify RPC call on submit
    await waitFor(() => expect(warehouseTransferService.initiateTransfer).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Implement — see spec §UI/UX Section 2 for layout**

Layout: 2-col Dari/Ke selects, receiver dropdown, notes textarea, `<WarehouseTransferSKUPicker>`, submit + submit-and-PDF buttons.
Key logic:
- Generate `clientRequestId` via `crypto.randomUUID()` once per mount (dedupe re-submits on network retry).
- Auto-swap when Dari = Ke.
- On submit: call `warehouseTransferService.initiateTransfer(...)`, on success invoke `onDone(transferId)` (parent routes to detail screen).
- "Kirim + Cetak PDF" button: submit → then fetch detail → render PDF blob → open in new tab (`URL.createObjectURL`).

- [ ] **Step 3: Boot + eyeball + commit**

```bash
npm run dev
git add src/components/warehouseTransfer/WarehouseTransferCreateScreen.tsx src/components/warehouseTransfer/__tests__/WarehouseTransferCreateScreen.test.tsx
git commit -m "feat(warehouse-transfer): sender form with SKU picker + PDF option"
```

---

### Task 20: `WarehouseTransferDetailScreen` (view + receive + cancel)

**Files:**
- Create: `src/components/warehouseTransfer/WarehouseTransferDetailScreen.tsx`
- Create: `src/components/warehouseTransfer/__tests__/WarehouseTransferDetailScreen.test.tsx`

**Interfaces:**
- Consumes: `getTransferDetail`, `receiveTransfer`, `cancelTransfer`, warehouses + users lookup
- Produces: detail screen matching spec §UI/UX Section 3

Key logic (see spec §UI/UX Section 3):
- If `status === 'IN_TRANSIT' && receiver === me` → show qty_received inputs + "Semua Sesuai" shortcut + submit.
- If `status === 'IN_TRANSIT' && sender === me` → show "Batal Kirim" button.
- Otherwise → read-only detail view with timeline (initiated / received / cancelled events).
- Warning banner when PARTIAL is imminent (qty_received < qty_sent for any line): explain auto-adjustment to owner inbox.
- Print PDF button always available.

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/warehouseTransfer/__tests__/WarehouseTransferDetailScreen.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WarehouseTransferDetailScreen from '../WarehouseTransferDetailScreen';
import { warehouseTransferService } from '../../../lib/warehouseTransferService';

vi.mock('../../../lib/warehouseTransferService', () => ({
  warehouseTransferService: {
    getTransferDetail: vi.fn(),
    receiveTransfer:   vi.fn(),
    cancelTransfer:    vi.fn(),
  },
}));
vi.mock('../../../hooks/useWarehouses', () => ({ useWarehouses: () => ({ warehouses: [
  { id: 'wa', name: 'Gudang Atas' }, { id: 'wb', name: 'Gudang Bawah' } ] }) }));

const IN_TRANSIT_DETAIL = {
  header: { id: 7, doc_no: 'TR-2026-07-007', status: 'IN_TRANSIT',
            from_warehouse_id: 'wa', to_warehouse_id: 'wb',
            sender_user_id: 'sender-u', receiver_user_id: 'me',
            total_qty_sent: 10, total_qty_received: null, total_loss_qty: null,
            initiated_at: '2026-07-12T10:00:00Z', received_at: null, cancelled_at: null,
            n_items: 1, notes: null },
  items: [{ transfer_id: 7, line_no: 1, sku: 'S1', qty_sent: 10, qty_received: null, loss_qty: null, loss_movement_id: null }],
};

describe('WarehouseTransferDetailScreen', () => {
  it('renders read-only summary when status=RECEIVED and no action buttons', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue({
      ...IN_TRANSIT_DETAIL,
      header: { ...IN_TRANSIT_DETAIL.header, status: 'RECEIVED', total_qty_received: 10, received_at: '2026-07-12T11:00:00Z' },
      items: [{ ...IN_TRANSIT_DETAIL.items[0], qty_received: 10 }],
    });
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/TR-2026-07-007/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Konfirmasi Terima/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Batal Kirim/i })).not.toBeInTheDocument();
  });

  it('shows Konfirmasi Terima button when IN_TRANSIT and receiver=me', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue(IN_TRANSIT_DETAIL);
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Konfirmasi Terima/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Batal Kirim/i })).not.toBeInTheDocument();
  });

  it('calls receiveTransfer with mapped qty_received on submit', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue(IN_TRANSIT_DETAIL);
    (warehouseTransferService.receiveTransfer as any).mockResolvedValue({ status: 'RECEIVED', total_loss_qty: 0 });
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => screen.getByRole('button', { name: /Konfirmasi Terima/i }));
    fireEvent.click(screen.getByRole('button', { name: /Semua Sesuai/i }));
    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi Terima/i }));
    await waitFor(() => expect(warehouseTransferService.receiveTransfer).toHaveBeenCalledWith(
      7, [{ sku: 'S1', qty_received: 10 }]));
  });

  it('shows Batal Kirim button when IN_TRANSIT and sender=me (not receiver)', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue({
      ...IN_TRANSIT_DETAIL,
      header: { ...IN_TRANSIT_DETAIL.header, sender_user_id: 'me', receiver_user_id: 'someone-else' },
    });
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Batal Kirim/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Konfirmasi Terima/i })).not.toBeInTheDocument();
  });

  it('warns about PARTIAL when qty_received < qty_sent for any line', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue(IN_TRANSIT_DETAIL);
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => screen.getByRole('button', { name: /Konfirmasi Terima/i }));
    const qtyInput = screen.getByLabelText(/Qty Diterima.*S1/i);
    fireEvent.change(qtyInput, { target: { value: '8' } });
    expect(screen.getByText(/Selisih -2/)).toBeInTheDocument();
    expect(screen.getByText(/Stock Adjustment.*TRANSFER_LOSS/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement component + boot**

- [ ] **Step 3: Commit**

```bash
git add src/components/warehouseTransfer/WarehouseTransferDetailScreen.tsx src/components/warehouseTransfer/__tests__/WarehouseTransferDetailScreen.test.tsx
git commit -m "feat(warehouse-transfer): detail screen with receive + cancel actions"
```

---

### Task 21: `InTransitChip` + integrate with `StockManagerScreen`

**Files:**
- Create: `src/components/warehouseTransfer/InTransitChip.tsx`
- Create: `src/components/warehouseTransfer/__tests__/InTransitChip.test.tsx`
- Modify: `src/components/StockManagerScreen.tsx:76,393-397` — remove modal render, add chip

**Interfaces:**
- Consumes: `useInTransitBySKU` from Task 14
- Produces: `<InTransitChip warehouseId sku />` — renders `+N in-transit` when N>0, empty otherwise

- [ ] **Step 1: Write chip test**

```tsx
// src/components/warehouseTransfer/__tests__/InTransitChip.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InTransitChip } from '../InTransitChip';

vi.mock('../../../hooks/useInTransitBySKU', () => ({
  useInTransitBySKU: () => new Map([['S1', 5]]),
}));

describe('InTransitChip', () => {
  it('renders +N in-transit when qty > 0', () => {
    render(<InTransitChip warehouseId="wh1" sku="S1" />);
    expect(screen.getByText(/\+5 in-transit/)).toBeInTheDocument();
  });
  it('renders nothing when qty is 0 / missing', () => {
    const { container } = render(<InTransitChip warehouseId="wh1" sku="S2" />);
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Implement chip**

```tsx
// src/components/warehouseTransfer/InTransitChip.tsx
import { useInTransitBySKU } from '../../hooks/useInTransitBySKU';

export function InTransitChip({ warehouseId, sku }: { warehouseId: string; sku: string }) {
  const map = useInTransitBySKU(warehouseId);
  const qty = map.get(sku) ?? 0;
  if (qty <= 0) return null;
  return (
    <span title={`+${qty} pcs sedang dalam perjalanan ke gudang ini`}
      className="ml-2 inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
      +{qty} in-transit
    </span>
  );
}
```

- [ ] **Step 3: Modify StockManagerScreen — remove modal, add chip**

Delete:
```tsx
// Lines 76, 393-397 — transfer modal state + render
const [transferItem, setTransferItem] = useState<StockItem | null>(null);
...
{transferItem && (<WarehouseTransferModal item={transferItem} onClose={...} onTransferred={...} showToast={showToast}/>)}
```
Also remove the `import WarehouseTransferModal from './WarehouseTransferModal'` at the top.

Where each per-warehouse qty is rendered, add:
```tsx
<InTransitChip warehouseId={wh.id} sku={row.sku} />
```

- [ ] **Step 4: Boot + eyeball + commit**

```bash
npm run dev
# navigate to Produk & Stok — no console errors, chip renders where in-transit exists
git add src/components/warehouseTransfer/InTransitChip.tsx src/components/warehouseTransfer/__tests__/InTransitChip.test.tsx src/components/StockManagerScreen.tsx
git commit -m "feat(warehouse-transfer): InTransitChip + integrate with StockManager"
```

---

### Task 22: Extend `OwnerDecisionInbox` for aging alerts

**Files:**
- Modify: `src/components/OwnerDecisionInbox.tsx` — add aging-alerts panel

**Interfaces:**
- Consumes: `v_pengawasan_transfer_aging` view (SELECT via supabase-js: `supabase.from('v_pengawasan_transfer_aging').select('*')`)
- Produces: additional panel/tab per spec §UI/UX Section 4c

- [ ] **Step 1: Add section**

Insert below existing supplier-claim list:
```tsx
<section className="mt-6">
  <h2 className="text-lg font-semibold text-slate-800">Transfer tertunda &gt; 24 jam</h2>
  {agingRows.length === 0 && <div className="mt-2 text-sm text-slate-500">Tidak ada transfer yang tertunda.</div>}
  {agingRows.map(a => (
    <div key={a.id} className="mt-2 rounded border border-amber-200 bg-amber-50 p-3">
      <div className="font-mono text-xs text-amber-800">{a.doc_no}</div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{whName(a.from_warehouse_id)} → {whName(a.to_warehouse_id)} · {a.total_qty_sent} pcs</div>
      <div className="text-xs text-slate-500">{Math.round(a.hours_pending)} jam mengambang · dikirim {new Date(a.initiated_at).toLocaleString('id-ID')}</div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => onOpenTransferDetail(a.id)} className="rounded border border-slate-300 px-3 py-1 text-xs">Lihat Detail</button>
      </div>
    </div>
  ))}
</section>
```

- [ ] **Step 2: Load aging rows on mount**

```tsx
useEffect(() => {
  supabase.from('v_pengawasan_transfer_aging').select('*').then(({ data }) => setAgingRows(data ?? []));
}, []);
```

- [ ] **Step 3: Boot + commit**

```bash
git add src/components/OwnerDecisionInbox.tsx
git commit -m "feat(warehouse-transfer): aging alerts panel in Owner Decision Inbox"
```

---

### Task 23: Delete legacy `WarehouseTransferModal` + `pembelianService.transferWarehouse`

**Files:**
- Delete: `src/components/WarehouseTransferModal.tsx`
- Modify: `src/lib/pembelianService.ts:187-197` — remove `transferWarehouse` function

**Interfaces:**
- Consumes: — (legacy)
- Produces: dead code removal; only the legacy SQL shim (Task 10) remains as safety net at RPC level

- [ ] **Step 1: Verify no more imports**

```bash
grep -rn "WarehouseTransferModal\|pembelianService\.transferWarehouse\|transferWarehouse" src/ --include="*.ts" --include="*.tsx"
```
Expected: 0 hits (StockManager migration in Task 21 removed the last import).

- [ ] **Step 2: Delete file + remove function**

```bash
git rm src/components/WarehouseTransferModal.tsx
```

Then edit `src/lib/pembelianService.ts` — delete the `async transferWarehouse(...)` block at lines 187-197.

- [ ] **Step 3: Verify build**

```bash
npm run lint
npx tsc --noEmit  # (or whatever the type-check command is)
npx vitest run --changed
```
All green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pembelianService.ts
git commit -m "chore(warehouse-transfer): delete legacy WarehouseTransferModal + pembelianService.transferWarehouse

Callers already migrated to warehouseTransferService in prior tasks.
Legacy transfer_warehouse RPC preserved at DB level as compat shim (slot 219)."
```

---

## Phase D — Ship & verify

### Task 24: Cross-tenant isolation smoke test

**Files:**
- Create: `src/components/warehouseTransfer/__tests__/CrossTenantIsolation.test.ts`

**Interfaces:**
- Consumes: `warehouseTransferService`
- Produces: pinning test that ensures user in tenant A can not list/detail a transfer in tenant B

- [ ] **Step 1: Write test using two mock supabase contexts**

```ts
// Simulate two supabase clients (tenant A + tenant B jwt) — call listTransfers on both.
// tenant A creates a transfer via initiateTransfer, tenant B lists → must be empty.
// tenant B calls getTransferDetail(tenantAId) → must return null.
```

- [ ] **Step 2: Run + verify green + commit**

```bash
npx vitest run src/components/warehouseTransfer/__tests__/CrossTenantIsolation.test.ts
git add src/components/warehouseTransfer/__tests__/CrossTenantIsolation.test.ts
git commit -m "test(warehouse-transfer): cross-tenant isolation pinning"
```

---

### Task 25: Local verification (Stage 1)

- [ ] **Step 1: Full local gate**

```bash
npm run lint
npm run audit:numinput
npm run audit:secdef-null-tenant
npx vitest run
```
All green.

- [ ] **Step 2: Local Supabase branch — apply all 12 migrations**

Via MCP `create_branch` + `apply_migration` each. Verify each smoke passes.

- [ ] **Step 3: Chrome MCP local dev walkthrough**

```bash
npm run dev
```
Via MCP chrome-devtools:
- Login as Garindo user with `can_transfer_warehouse`.
- Navigate Sidebar → Transfer Gudang.
- Create a transfer (2 SKU, small qty). Verify PDF opens.
- Log in as receiver (or impersonate). Confirm receipt full. Status→RECEIVED.
- Repeat with partial (qty_received < qty_sent). Status→PARTIAL. Verify owner inbox row.
- Repeat with cancel. Status→CANCELLED, stock returned.
- Check StockManagerScreen — InTransitChip appears on destination during IN_TRANSIT, disappears on RECEIVE.
- Console clean, no failed network requests.

---

### Task 26: Deploy + prod smoke + progress.md (Stages 2 + 3)

- [ ] **Step 1: Push + wait for build**

```bash
git push origin main
```
Wait for cloudbuild.frontend.yaml completion. Confirm traffic migration to new revision (see progress.md 2026-07-12 note about needing `gcloud run services update-traffic`).

- [ ] **Step 2: Apply migrations to prod via `apply-pending-migrations.sh`**

Confirm all 11 non-smoke migrations apply cleanly. Run `mcp__plugin_supabase_supabase__get_advisors` — triage findings.

- [ ] **Step 3: Prod smoke on Toko Jaya Makmur** (per memory `production-testing-tenant` — NEVER Garindo real data)

Full lifecycle via Chrome MCP against production URL logged in as Toko Jaya Makmur test tenant:
- Buat transfer (2 SKU × small qty).
- Konfirmasi terima full.
- Buat transfer → konfirmasi PARTIAL → verify Owner Decision Inbox aging + partial rows.
- Buat transfer → cancel → verify source stock returns.
- Cross-check Garindo transfers NOT visible from Toko Jaya Makmur session (RLS isolation).
- Verify PDF prints correctly with Toko Jaya Makmur branding.

- [ ] **Step 4: Update `progress.md`**

Append entry:
```markdown
## 2026-07-XX — Warehouse Transfer (two-step) shipped

**Feature:** two-step warehouse transfer replacing legacy single-shot `transfer_warehouse`. State machine `IN_TRANSIT → RECEIVED/PARTIAL/CANCELLED`. Multi-SKU per surat jalan. Client-side jsPDF surat jalan (no paid service).

**Design memo:** `docs/superpowers/specs/2026-07-12-warehouse-transfer-two-step-design.md`
**Impl plan:** `docs/superpowers/plans/2026-07-12-warehouse-transfer-plan.md`

**Migrations shipped (11):** slots 210-220. Smoke migration 221 kept out of prod deploy (rollback-by-design).

**Advisors post-deploy:** [triage summary here].

**Prod smoke:** all 5 lifecycle scenarios passed on Toko Jaya Makmur, RLS isolation confirmed against Garindo.

**Follow-ups tracked:**
- Owner-force RPCs (`admin_force_receive_transfer`, `admin_force_cancel_transfer`) — Phase 2.
- Legacy `transfer_warehouse` shim removal — next release cycle.
- Opname RPCs cutover to `warehouse_id` uuid — separate ticket per memory `project_phase3_warehouse_cutover_pending`.
```

- [ ] **Step 5: Consult advisor() one last time before declaring done**

Per CLAUDE.md: call `advisor()` — pass full context of what shipped + advisor findings + prod smoke result. Address any final blocker.

- [ ] **Step 6: `/code-review` on the full diff, then final commit**

```bash
# invoke /code-review skill via harness
git add progress.md
git commit -m "docs(warehouse-transfer): ship note + follow-up list"
```

---

## Self-Review

**Spec coverage** — check every section in `2026-07-12-warehouse-transfer-two-step-design.md`:

| Spec § | Covered by task(s) |
|---|---|
| §1 Problem | (context only) |
| §2 Solution | plan header + tasks 1-26 |
| §3 State machine | Task 2 (CHECK constraints), Tasks 6-8 (transitions) |
| §4.1 warehouse_transfers | Task 2 |
| §4.2 warehouse_transfer_items | Task 2 (updated with loss_movement_id per §5.2.1) |
| §4.3 In-transit derived query | Task 9 (get_in_transit_by_warehouse) |
| §5.1 initiate | Task 6 + Task 11 (tighten receiver check) |
| §5.2 receive | Task 7 |
| §5.2.1 loss accounting | Task 7 (transfer_loss row via direct INSERT) |
| §5.3 cancel | Task 8 |
| §5.4 read RPCs | Task 9 |
| §5.5 legacy shim | Task 10 |
| §6 doc-no sequence | Task 2 (`_next_warehouse_transfer_doc_no`) |
| §7 migration plan | Tasks 1-12 |
| §8.1-8.3 FE arch | Tasks 13-23 |
| §9 observability | Tasks 6-8 (RAISE LOG); stock_movements as usage counter |
| §10 impact analysis | Tasks 21, 23 (StockManager + pembelianService callers migrated) |
| §11 scale-forward | Baked into Task 2 schema; ceiling table in spec |
| §12 multi-tenant / RLS | Tasks 5, 11 |
| §13 ship & verify | Tasks 25, 26 |
| §14 definition of done | Task 26 step 5 (advisor + code-review) |
| §15 open questions | Q1 → Task 2 step 3 addresses; Q2 → Task 7 note; Q3 → Task 23 grep; Q4-Q6 deferred (documented in progress.md follow-ups) |

**Placeholder scan** — no "TBD" / "TODO"; open questions are explicit deferrals with resolution mechanism.

**Type consistency** — `WarehouseTransferStatus` string enum matches CHECK constraint values verbatim: `'IN_TRANSIT' | 'RECEIVED' | 'PARTIAL' | 'CANCELLED'`. RPC param names in service (Task 13) match SQL param names in Tasks 6-9 (`p_from_warehouse_id`, `p_to_warehouse_id`, etc). Function names consistent: `initiateTransfer` ↔ `initiate_warehouse_transfer`, `receiveTransfer` ↔ `receive_warehouse_transfer`, `cancelTransfer` ↔ `cancel_warehouse_transfer`. Hook returns `Map<string, number>` used consistently in Tasks 14 + 21.

**Fixups applied:** none — types, names, columns aligned on first pass thanks to spec-first design.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-12-warehouse-transfer-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
