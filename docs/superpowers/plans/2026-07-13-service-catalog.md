# Service Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship BOM-backed Service Catalog for Custom Panel + Jasa Wiring — Garindo primary tenant, scalable across MSME.

**Architecture:** Tenant-scoped `service_catalog` + `service_catalog_bom` tables. BOM snapshot pattern (freeze at commit). Extend existing `rakit_job_lines` + `rakit_components` additively. Hook `transition_order_stage` at `3c → 4a` transition to trigger FIFO stock decrement + JE post.

**Tech Stack:** Postgres (Supabase) migrations, SECURITY DEFINER RPCs owned by `vosi_rpc_owner`, React 19 + TypeScript + Vite + Tailwind, jsPDF for invoice.

## Global Constraints

- All new RPCs: `SECURITY DEFINER` owned by `vosi_rpc_owner`, `SET search_path TO 'public'`, `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`
- New tables RLS policies MUST include `vosi_rpc_owner` in `t_select_own` (per memory `secdef_returning_gap`) — INSERT RETURNING pattern used
- Composite FK `(tenant_id, account_code)` for COA references — prevent cross-tenant leak
- No PK change on `rakit_job_lines` (deferred per decision memo)
- Reuse existing columns per spec Column Reuse Mapping — `labor_cost`, `tracking_mode`, `service_type` NOT re-added
- BOM snapshot frozen at `attach_service_to_order`; FIFO cost frozen at `transition to 4a`
- Idempotent migrations: `CREATE OR REPLACE`, `DROP IF EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`, guarded backfills
- Font sizing per memory: 13-14px base UI (Tailwind `text-[13px]` / `text-[14px]`)
- Bahasa Indonesia + MSME tone in all user-facing strings
- Migration slots: 148, 149, 150, 151, 152 (block 100+, session 3)
- Spec: `docs/superpowers/specs/2026-07-13-service-catalog-design.md` (revision 2)
- Decision memo: `docs/superpowers/specs/2026-07-13-service-catalog-decision.md`

---

## File Structure

**New migrations:**
- `supabase/migrations/20261115000148_service_catalog_tables.sql`
- `supabase/migrations/20261115000149_rakit_lines_extend.sql`
- `supabase/migrations/20261115000150_coa_seed_service_catalog.sql`
- `supabase/migrations/20261115000151_service_catalog_rpcs.sql`
- `supabase/migrations/20261115000152_transition_order_stage_hook.sql`

**New TS lib:**
- `src/lib/serviceCatalog/types.ts`
- `src/lib/serviceCatalog/api.ts`

**New FE components:**
- `src/components/pengaturan/LayananPanel.tsx` — Pengaturan tab entry point
- `src/components/pengaturan/layanan/ServiceCatalogList.tsx` — list view
- `src/components/pengaturan/layanan/ServiceCatalogEditModal.tsx` — create/edit modal
- `src/components/pengaturan/layanan/BOMEditor.tsx` — reusable BOM editor
- `src/components/pengaturan/layanan/ComponentPicker.tsx` — master stok picker
- `src/components/pesanan/TambahLayananModal.tsx` — sales flow attach service modal

**Modified files:**
- `src/components/PengaturanScreen.tsx` — add Layanan tab
- Sales tempo Buat Pesanan screen (name TBD Task 1 grep) — add `+ Tambah Layanan` button + integrate modal
- Invoice PDF renderer (name TBD Task 1 grep) — add itemized branch
- Laporan Performa screen (name TBD Task 1 grep) — add Layanan section

**Updated docs:**
- `docs/superpowers/plans/2026-07-13-service-catalog.md` (this file — updated in Task 1 with grep findings)
- `progress.md` — updated in Task 9 with ship confirmation

---

### Task 1: Pre-flight investigation + memory slot claim

**Goal:** Resolve 3 known unknowns before schema work + claim migration slots + verify grep targets.

**Files:**
- Update: `docs/superpowers/plans/2026-07-13-service-catalog.md` (this file — annotate discovered names)
- Update: memory `project_migration_slot_allocation.md`

**Interfaces:**
- Produces: exact names of (a) tempo verify/deliver RPC or confirmation it doesn't exist, (b) existing CHECK constraints on `rakit_job_lines` + `rakit_components`, (c) presence of `PENDAPATAN_JASA` + `BEBAN_TENAGA_KERJA` values in `account_subtype` enum, (d) exact name of Buat Pesanan tempo screen file, (e) exact name of invoice PDF renderer file, (f) exact name of Laporan Performa screen file.

- [ ] **Step 1: Grep for tempo verify/deliver RPC**

Run via Bash:
```bash
grep -rnE "CREATE (OR REPLACE )?FUNCTION.*(deliver|dispatch|complete_order|mark_order_delivered|verify_order)" \
  supabase/migrations/*.sql | head -20
```

Then check `transition_order_stage` in `supabase/migrations/20261115000201_sales_funnel_transition_adjacency.sql` — this is the funnel state machine.

Expected finding: `transition_order_stage(p_order_id, p_from_sub_stage, p_to_sub_stage, p_expected_version, p_reason)` — this IS the RPC to extend. No separate "verify_deliver" RPC exists.

Confirm by inspecting `sales_funnel_transitions` seed rows — look for transitions to `4a` / `4b` (delivery / pickup). These are the trigger points for stock decrement + JE post.

Record in plan comment: `-- Task 4 will extend transition_order_stage; JE trigger at (3c, 4a) or (3c, 4b)`.

- [ ] **Step 2: Enumerate constraints on rakit_job_lines + rakit_components**

Via MCP Supabase execute_sql (production Garindo project ekhhojaezdfjfwuxyjkl):
```sql
-- rakit_job_lines constraints
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.rakit_job_lines'::regclass
ORDER BY conname;

-- rakit_components constraints
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.rakit_components'::regclass
ORDER BY conname;

-- Partial indexes on both
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename IN ('rakit_job_lines', 'rakit_components')
ORDER BY tablename, indexname;
```

Expected from earlier grep:
- `chk_rakit_service_type CHECK (service_type IN ('jasa_rakit', 'jasa_custom_panel'))` — must DROP in Task 3
- `chk_rakit_tracking_mode CHECK (tracking_mode IN ('detail', 'lumpsum'))` — keep, our new rows use 'detail' or 'lumpsum'
- `chk_rakit_hpp_source` complex CHECK — inspect + confirm compatibility with new flow

Document all constraints in plan comment section. Any CHECK that would block new-row inserts needs relaxation in Task 3.

- [ ] **Step 3: Verify account_subtype enum values**

Via MCP execute_sql:
```sql
SELECT unnest(enum_range(NULL::account_subtype)) AS value ORDER BY value;
```

Look for `PENDAPATAN_JASA` and `BEBAN_TENAGA_KERJA`. Record which (if any) already exist — if either exists, skip its `ALTER TYPE ADD VALUE` in Task 4.

- [ ] **Step 4: Grep FE file names**

Via Bash:
```bash
# Buat Pesanan tempo screen
grep -rlE "Buat.*Pesanan|BuatPesanan|SalesLanding|createOrder" \
  src/components/ | head -10

# Invoice PDF renderer
grep -rlE "generateInvoicePDF|invoicePDF|renderInvoice" \
  src/lib/ src/components/ | head -10

# Laporan Performa screen
grep -rlE "LaporanPerforma|LaporanScreen|Performa" \
  src/components/ | head -10
```

Record exact file paths in plan comment (Tasks 6, 7, 8 reference these).

- [ ] **Step 5: Update memory `project_migration_slot_allocation`**

Read current memory file:
```bash
cat "/Users/tonywei/.claude/projects/-Users-tonywei-IdeaProjects-ERPAntigravity/memory/project_migration_slot_allocation.md"
```

Append: `Item #2 Service Catalog claims 148-152 (Task 2-4 use 148, 149, 150; Task 5 uses 151; Task 6 uses 152).`

- [ ] **Step 6: Commit findings**

```bash
git add docs/superpowers/plans/2026-07-13-service-catalog.md \
  "/Users/tonywei/.claude/projects/-Users-tonywei-IdeaProjects-ERPAntigravity/memory/project_migration_slot_allocation.md"
git commit -m "chore(plan): Item #2 Task 1 pre-flight findings

- transition_order_stage extend trigger: (3c→4a) and (3c→4b)
- rakit_job_lines constraints enumerated
- account_subtype enum values checked
- FE file paths grepped
- Migration slots 148-152 claimed

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Migration 148 — create service_catalog + service_catalog_bom tables

**Goal:** Ship base schema with RLS + composite FK to COA + indexes.

**Files:**
- Create: `supabase/migrations/20261115000148_service_catalog_tables.sql`

**Interfaces:**
- Produces: `service_catalog(id, tenant_id, name, description, category, default_labor_amount, default_include_material, invoice_display, revenue_coa_code, labor_cost_coa_code, is_active, created_at, updated_at, created_by, updated_by)` — UNIQUE (tenant_id, name), composite FK to chart_of_accounts (tenant_id, account_code) x2
- Produces: `service_catalog_bom(id, service_catalog_id, component_sku, default_qty, notes, sort_order)`

- [ ] **Step 1: Write migration file**

Create `supabase/migrations/20261115000148_service_catalog_tables.sql`:

```sql
-- 20261115000148_service_catalog_tables.sql
-- Item #2: Service Catalog base tables.
-- Tenant-scoped, composite FK to chart_of_accounts prevents cross-tenant leak.
-- RLS policies include vosi_rpc_owner in t_select_own per memory
-- secdef_returning_gap (save_service_catalog uses INSERT RETURNING).

CREATE TABLE IF NOT EXISTS public.service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  default_labor_amount NUMERIC(15,2) DEFAULT 0 CHECK (default_labor_amount >= 0),
  default_include_material BOOLEAN DEFAULT TRUE,
  invoice_display TEXT DEFAULT 'lump_sum'
    CHECK (invoice_display IN ('lump_sum', 'itemized')),
  revenue_coa_code TEXT NOT NULL,
  labor_cost_coa_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  CONSTRAINT service_catalog_tenant_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT service_catalog_revenue_coa_fk
    FOREIGN KEY (tenant_id, revenue_coa_code)
    REFERENCES public.chart_of_accounts (tenant_id, account_code),
  CONSTRAINT service_catalog_labor_coa_fk
    FOREIGN KEY (tenant_id, labor_cost_coa_code)
    REFERENCES public.chart_of_accounts (tenant_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_tenant_active
  ON public.service_catalog (tenant_id, is_active, category);

CREATE TABLE IF NOT EXISTS public.service_catalog_bom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_catalog_id UUID NOT NULL
    REFERENCES public.service_catalog(id) ON DELETE CASCADE,
  component_sku VARCHAR(50) NOT NULL REFERENCES public.stocks(sku),
  default_qty NUMERIC(15,4) NOT NULL CHECK (default_qty > 0),
  notes TEXT,
  sort_order INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_bom_service
  ON public.service_catalog_bom (service_catalog_id);

-- RLS: enable + policies
ALTER TABLE public.service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_catalog_bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_catalog_bom FORCE ROW LEVEL SECURITY;

-- t_select_own: authenticated tenant members + vosi_rpc_owner (for RETURNING)
DROP POLICY IF EXISTS t_select_own ON public.service_catalog;
CREATE POLICY t_select_own ON public.service_catalog FOR SELECT
  TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS t_write_own ON public.service_catalog;
CREATE POLICY t_write_own ON public.service_catalog FOR ALL
  TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id())
  WITH CHECK (tenant_id = public._resolve_tenant_id());

DROP POLICY IF EXISTS t_select_own ON public.service_catalog_bom;
CREATE POLICY t_select_own ON public.service_catalog_bom FOR SELECT
  TO authenticated, vosi_rpc_owner
  USING (
    EXISTS (
      SELECT 1 FROM public.service_catalog sc
      WHERE sc.id = service_catalog_bom.service_catalog_id
        AND (sc.tenant_id = public._resolve_tenant_id() OR public.is_platform_admin())
    )
  );

DROP POLICY IF EXISTS t_write_own ON public.service_catalog_bom;
CREATE POLICY t_write_own ON public.service_catalog_bom FOR ALL
  TO vosi_rpc_owner
  USING (
    EXISTS (
      SELECT 1 FROM public.service_catalog sc
      WHERE sc.id = service_catalog_bom.service_catalog_id
        AND sc.tenant_id = public._resolve_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_catalog sc
      WHERE sc.id = service_catalog_bom.service_catalog_id
        AND sc.tenant_id = public._resolve_tenant_id()
    )
  );

GRANT SELECT ON public.service_catalog TO authenticated;
GRANT SELECT ON public.service_catalog_bom TO authenticated;
GRANT ALL ON public.service_catalog TO vosi_rpc_owner;
GRANT ALL ON public.service_catalog_bom TO vosi_rpc_owner;

COMMENT ON TABLE public.service_catalog IS
  'Item #2: Tenant-configurable service master. Deprecates service_types.';
COMMENT ON TABLE public.service_catalog_bom IS
  'Item #2: BOM master per service catalog entry. Empty = labor-only mode.';
```

- [ ] **Step 2: Apply via MCP Supabase**

Use `mcp__plugin_supabase_supabase__apply_migration` with `name = "service_catalog_tables"` and the SQL body.

Expected: `{"success": true}`

- [ ] **Step 3: Smoke test — table + FK + RLS**

Via MCP execute_sql:
```sql
DO $$
DECLARE
  v_tenant UUID;
  v_service_id UUID;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'garindo';

  -- Impersonate garindo owner
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', (SELECT user_id FROM tenant_members WHERE tenant_id = v_tenant AND role = 'owner' LIMIT 1)::text,
      'role', 'authenticated',
      'tenant_id', v_tenant::text
    )::text,
    true
  );

  -- Insert should work (valid COA reference)
  INSERT INTO service_catalog (
    tenant_id, name, category, default_labor_amount,
    revenue_coa_code, labor_cost_coa_code
  ) VALUES (
    v_tenant, 'TEST-Service', 'Test',
    100000, '4-1100', '5-1100'
  ) RETURNING id INTO v_service_id;

  RAISE NOTICE 'Insert OK: %', v_service_id;

  -- Cross-tenant FK should fail
  BEGIN
    INSERT INTO service_catalog (
      tenant_id, name, category,
      revenue_coa_code, labor_cost_coa_code
    ) VALUES (
      v_tenant, 'TEST-Bad', 'Test',
      'NONEXISTENT-CODE', '5-1100'
    );
    RAISE EXCEPTION 'Cross-tenant FK check FAILED — insert should have raised';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'FK enforcement OK';
  END;

  RAISE EXCEPTION 'rollback smoke test';
END $$;
```

Expected: NOTICE messages then EXCEPTION rollback (state clean).

- [ ] **Step 4: Run get_advisors post-migration**

Use `mcp__plugin_supabase_supabase__get_advisors` with type=security and type=performance.

Expected: no new findings on service_catalog / service_catalog_bom. If any warnings, address (typically: index on tenant_id already covered by composite index).

- [ ] **Step 5: Commit + push**

```bash
git add supabase/migrations/20261115000148_service_catalog_tables.sql
git commit -m "feat(service-catalog): mig 148 base tables + RLS + composite FK

- service_catalog + service_catalog_bom tenant-scoped tables
- Composite FK (tenant_id, account_code) to chart_of_accounts
  prevents cross-tenant COA reference
- RLS policies include vosi_rpc_owner in t_select_own for
  INSERT RETURNING pattern (memory secdef_returning_gap)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

Expected: push succeeds, Cloud Build triggers (frontend build, not needed for schema-only change but harmless).

---

### Task 3: Migration 149 — extend rakit_job_lines + rakit_components

**Goal:** Additive extends + drop `chk_rakit_service_type` to accept catalog-linked rows.

**Files:**
- Create: `supabase/migrations/20261115000149_rakit_lines_extend.sql`

**Interfaces:**
- Consumes: `service_catalog(id)` from Task 2 for FK reference
- Produces: `rakit_job_lines.service_catalog_id UUID`, `rakit_job_lines.invoice_display_override TEXT`
- Produces: `rakit_components.service_catalog_bom_id UUID`

- [ ] **Step 1: Write migration**

Create `supabase/migrations/20261115000149_rakit_lines_extend.sql`:

```sql
-- 20261115000149_rakit_lines_extend.sql
-- Item #2: Additive extend of rakit_job_lines + rakit_components for
-- service catalog linkage. Reuse existing columns (labor_cost, tracking_mode,
-- service_type, fifo_cost_snapshot) per spec Column Reuse Mapping.

-- rakit_job_lines: add catalog linkage
ALTER TABLE public.rakit_job_lines
  ADD COLUMN IF NOT EXISTS service_catalog_id UUID
    REFERENCES public.service_catalog(id),
  ADD COLUMN IF NOT EXISTS invoice_display_override TEXT
    CHECK (invoice_display_override IS NULL OR
           invoice_display_override IN ('lump_sum', 'itemized'));

-- Relax service_type CHECK: allow any string (legacy hint only when
-- service_catalog_id IS NULL). New rows use 'jasa_custom_panel' as default
-- backward-compat value but semantics come from service_catalog_id FK.
ALTER TABLE public.rakit_job_lines DROP CONSTRAINT IF EXISTS chk_rakit_service_type;

-- Partial index for new catalog-linked queries
CREATE INDEX IF NOT EXISTS idx_rakit_job_lines_catalog
  ON public.rakit_job_lines (service_catalog_id)
  WHERE service_catalog_id IS NOT NULL;

-- rakit_components: add snapshot back-reference to BOM master (audit)
ALTER TABLE public.rakit_components
  ADD COLUMN IF NOT EXISTS service_catalog_bom_id UUID
    REFERENCES public.service_catalog_bom(id);

COMMENT ON COLUMN public.rakit_job_lines.service_catalog_id IS
  'Item #2: FK to service_catalog master. NULL for legacy pre-Item-#2 rows.';
COMMENT ON COLUMN public.rakit_job_lines.invoice_display_override IS
  'Item #2: per-order invoice display override. NULL = use catalog default.';
COMMENT ON COLUMN public.rakit_components.service_catalog_bom_id IS
  'Item #2: FK back to BOM master row snapshot came from. NULL for ad-hoc adds.';
```

- [ ] **Step 2: Apply via MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` name=`rakit_lines_extend`.

- [ ] **Step 3: Smoke test — new columns writable + old CHECK gone**

Via MCP execute_sql:
```sql
DO $$
DECLARE
  v_tenant UUID;
  v_service_id UUID;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'garindo';
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', (SELECT user_id FROM tenant_members WHERE tenant_id = v_tenant AND role = 'owner' LIMIT 1)::text,
      'role', 'authenticated',
      'tenant_id', v_tenant::text
    )::text,
    true
  );

  -- Create test service_catalog entry
  INSERT INTO service_catalog (tenant_id, name, revenue_coa_code, labor_cost_coa_code)
    VALUES (v_tenant, 'TEST-Extend-149', '4-1100', '5-1100')
    RETURNING id INTO v_service_id;

  -- Try insert into rakit_job_lines with new columns
  -- Note: need actual kasir_transactions FK — for smoke, skip real insert,
  -- just check ALTER worked via information_schema
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rakit_job_lines'
      AND column_name = 'service_catalog_id'
  ) THEN
    RAISE EXCEPTION 'service_catalog_id column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rakit_components'
      AND column_name = 'service_catalog_bom_id'
  ) THEN
    RAISE EXCEPTION 'service_catalog_bom_id column missing';
  END IF;

  -- Verify chk_rakit_service_type is gone
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rakit_job_lines'::regclass
      AND conname = 'chk_rakit_service_type'
  ) THEN
    RAISE EXCEPTION 'old CHECK still exists';
  END IF;

  RAISE NOTICE 'Schema extension OK';
  RAISE EXCEPTION 'rollback';
END $$;
```

Expected: NOTICE + rollback.

- [ ] **Step 4: get_advisors scan**

Use `mcp__plugin_supabase_supabase__get_advisors`. Expected: no new findings.

- [ ] **Step 5: Commit + push**

```bash
git add supabase/migrations/20261115000149_rakit_lines_extend.sql
git commit -m "feat(service-catalog): mig 149 extend rakit_job_lines + rakit_components

- rakit_job_lines: +service_catalog_id, +invoice_display_override
- rakit_components: +service_catalog_bom_id
- Drop chk_rakit_service_type (relax legacy enum, use FK for identity)
- Partial index on service_catalog_id

Reuses existing columns per spec Column Reuse Mapping:
labor_cost, tracking_mode, service_type, fifo_cost_snapshot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: Migration 150 — COA seed + subtype enum values

**Goal:** Add `PENDAPATAN_JASA` + `BEBAN_TENAGA_KERJA` enum values (if missing) + seed 4-1300 + 5-2110 accounts for Garindo tenant.

**Files:**
- Create: `supabase/migrations/20261115000150_coa_seed_service_catalog.sql`

**Interfaces:**
- Produces: `chart_of_accounts` rows `4-1300 Pendapatan Jasa Wiring` and `5-2110 Beban Tenaga Kerja Rakit` for tenant `garindo`
- Produces: `account_subtype` enum extended with `PENDAPATAN_JASA` and `BEBAN_TENAGA_KERJA` if not present

- [ ] **Step 1: Write migration**

Create `supabase/migrations/20261115000150_coa_seed_service_catalog.sql`:

```sql
-- 20261115000150_coa_seed_service_catalog.sql
-- Item #2: Add Pendapatan Jasa + Beban Tenaga Kerja Rakit COA accounts
-- for Garindo tenant. Idempotent via ON CONFLICT DO NOTHING.

-- Extend account_subtype enum (idempotent per Postgres 14+)
ALTER TYPE public.account_subtype ADD VALUE IF NOT EXISTS 'PENDAPATAN_JASA';
ALTER TYPE public.account_subtype ADD VALUE IF NOT EXISTS 'BEBAN_TENAGA_KERJA';

-- Note: ADD VALUE cannot be inside transaction with subsequent USE in same
-- migration. If subsequent INSERT below fails on unknown enum value,
-- Supabase migration tool will chunk this. Alternative: split into 2 migrations.
-- We use single migration and rely on Supabase's per-statement transaction
-- handling; if enum ADD VALUE needs to commit before INSERT USES it, use
-- pg_type::regtype refresh via SET LOCAL.

-- COA seed for Garindo tenant
INSERT INTO public.chart_of_accounts (
  tenant_id, account_code, account_name, account_type, account_subtype,
  normal_balance, is_group, is_active
)
SELECT
  t.id, '4-1300', 'Pendapatan Jasa Wiring', 'PENDAPATAN', 'PENDAPATAN_JASA'::public.account_subtype,
  'CREDIT', false, true
FROM public.tenants t
WHERE t.slug = 'garindo'
ON CONFLICT (tenant_id, account_code) DO NOTHING;

INSERT INTO public.chart_of_accounts (
  tenant_id, account_code, account_name, account_type, account_subtype,
  normal_balance, is_group, is_active
)
SELECT
  t.id, '5-2110', 'Beban Tenaga Kerja Rakit', 'BEBAN', 'BEBAN_TENAGA_KERJA'::public.account_subtype,
  'DEBIT', false, true
FROM public.tenants t
WHERE t.slug = 'garindo'
ON CONFLICT (tenant_id, account_code) DO NOTHING;
```

**Note on enum + insert in same migration:** Postgres 14+ allows `ADD VALUE IF NOT EXISTS`. If Supabase runs migration in single txn and enum value not visible to subsequent INSERT, split into 2 migrations (150a + 150b). Attempt single-file first; if apply fails on enum cast, split.

- [ ] **Step 2: Apply via MCP**

If Task 1 grep found enum values already present, only seed accounts. Otherwise apply full migration.

If apply fails on enum cast reference within same transaction, split file:
- `20261115000150a_service_subtype_enum.sql` (enum only)
- `20261115000150b_coa_seed_service_catalog.sql` (INSERTS)

- [ ] **Step 3: Smoke test COA rows**

```sql
SELECT account_code, account_name, account_type, account_subtype
FROM chart_of_accounts
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'garindo')
  AND account_code IN ('4-1300', '5-2110')
ORDER BY account_code;
```

Expected: 2 rows returned.

- [ ] **Step 4: Commit + push**

```bash
git add supabase/migrations/20261115000150*.sql
git commit -m "feat(service-catalog): mig 150 COA seed + subtype enum

- 4-1300 Pendapatan Jasa Wiring (Garindo)
- 5-2110 Beban Tenaga Kerja Rakit (Garindo)
- account_subtype enum: +PENDAPATAN_JASA, +BEBAN_TENAGA_KERJA

Idempotent via ON CONFLICT DO NOTHING + ADD VALUE IF NOT EXISTS.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: Migration 151 — 3 CRUD RPCs (save, soft_delete, attach)

**Goal:** SECDEF RPCs for service_catalog CRUD + attach service line to order (with BOM snapshot).

**Files:**
- Create: `supabase/migrations/20261115000151_service_catalog_rpcs.sql`

**Interfaces:**
- Consumes: `service_catalog`, `service_catalog_bom` (from Task 2), `rakit_job_lines`, `rakit_components` (from Task 3)
- Produces:
  - `save_service_catalog(p_data JSONB) RETURNS UUID`
  - `soft_delete_service_catalog(p_id UUID) RETURNS VOID`
  - `attach_service_to_order(p_order_id UUID, p_service_catalog_id UUID, p_qty NUMERIC, p_override_bom JSONB, p_override_labor NUMERIC, p_final_price NUMERIC) RETURNS UUID`

- [ ] **Step 1: Write migration**

Create `supabase/migrations/20261115000151_service_catalog_rpcs.sql`:

```sql
-- 20261115000151_service_catalog_rpcs.sql
-- Item #2: Service Catalog CRUD + attach-to-order RPCs.
-- All SECDEF owned by vosi_rpc_owner + REVOKE anon + GRANT authenticated.

-- =============================================================================
-- save_service_catalog(p_data JSONB) RETURNS UUID
-- =============================================================================
CREATE OR REPLACE FUNCTION public.save_service_catalog(p_data JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_id UUID;
  v_bom JSONB;
  v_item JSONB;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_id := NULLIF(p_data->>'id', '')::UUID;

  IF v_id IS NULL THEN
    INSERT INTO public.service_catalog (
      tenant_id, name, description, category,
      default_labor_amount, default_include_material,
      invoice_display, revenue_coa_code, labor_cost_coa_code,
      is_active, created_by, updated_by
    ) VALUES (
      v_tenant,
      p_data->>'name',
      NULLIF(p_data->>'description', ''),
      NULLIF(p_data->>'category', ''),
      COALESCE((p_data->>'default_labor_amount')::NUMERIC, 0),
      COALESCE((p_data->>'default_include_material')::BOOLEAN, TRUE),
      COALESCE(p_data->>'invoice_display', 'lump_sum'),
      p_data->>'revenue_coa_code',
      p_data->>'labor_cost_coa_code',
      COALESCE((p_data->>'is_active')::BOOLEAN, TRUE),
      v_user, v_user
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.service_catalog SET
      name = p_data->>'name',
      description = NULLIF(p_data->>'description', ''),
      category = NULLIF(p_data->>'category', ''),
      default_labor_amount = COALESCE((p_data->>'default_labor_amount')::NUMERIC, 0),
      default_include_material = COALESCE((p_data->>'default_include_material')::BOOLEAN, TRUE),
      invoice_display = COALESCE(p_data->>'invoice_display', 'lump_sum'),
      revenue_coa_code = p_data->>'revenue_coa_code',
      labor_cost_coa_code = p_data->>'labor_cost_coa_code',
      is_active = COALESCE((p_data->>'is_active')::BOOLEAN, TRUE),
      updated_at = now(),
      updated_by = v_user
    WHERE id = v_id AND tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'service_catalog % tidak ditemukan atau bukan tenant Anda', v_id;
    END IF;
  END IF;

  -- Replace BOM (idempotent: delete + reinsert)
  DELETE FROM public.service_catalog_bom WHERE service_catalog_id = v_id;

  v_bom := COALESCE(p_data->'bom', '[]'::JSONB);
  FOR v_item IN SELECT jsonb_array_elements(v_bom) LOOP
    INSERT INTO public.service_catalog_bom (
      service_catalog_id, component_sku, default_qty, notes, sort_order
    ) VALUES (
      v_id,
      v_item->>'component_sku',
      (v_item->>'default_qty')::NUMERIC,
      NULLIF(v_item->>'notes', ''),
      COALESCE((v_item->>'sort_order')::INT, 0)
    );
  END LOOP;

  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.save_service_catalog(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_service_catalog(JSONB) TO authenticated;
ALTER FUNCTION public.save_service_catalog(JSONB) OWNER TO vosi_rpc_owner;

-- =============================================================================
-- soft_delete_service_catalog(p_id UUID) RETURNS VOID
-- =============================================================================
CREATE OR REPLACE FUNCTION public.soft_delete_service_catalog(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_user UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  UPDATE public.service_catalog SET
    is_active = FALSE,
    updated_at = now(),
    updated_by = v_user
  WHERE id = p_id AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_catalog % tidak ditemukan', p_id;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.soft_delete_service_catalog(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_service_catalog(UUID) TO authenticated;
ALTER FUNCTION public.soft_delete_service_catalog(UUID) OWNER TO vosi_rpc_owner;

-- =============================================================================
-- attach_service_to_order(...) RETURNS UUID
-- =============================================================================
CREATE OR REPLACE FUNCTION public.attach_service_to_order(
  p_order_id UUID,
  p_service_catalog_id UUID,
  p_qty NUMERIC,
  p_override_bom JSONB DEFAULT NULL,
  p_override_labor NUMERIC DEFAULT NULL,
  p_final_price NUMERIC DEFAULT NULL,
  p_invoice_display_override TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_service RECORD;
  v_line_id UUID;
  v_labor NUMERIC;
  v_bom JSONB;
  v_item JSONB;
  v_tracking_mode TEXT;
  v_bom_line_count INT := 0;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'qty harus > 0, got %', p_qty;
  END IF;

  -- Validate service_catalog
  SELECT * INTO v_service
    FROM public.service_catalog
    WHERE id = p_service_catalog_id
      AND tenant_id = v_tenant
      AND is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_catalog % tidak ditemukan atau nonaktif', p_service_catalog_id;
  END IF;

  -- Validate order exists (kasir_transactions)
  IF NOT EXISTS (
    SELECT 1 FROM public.kasir_transactions
    WHERE id = p_order_id
      -- kasir_transactions tenant scoping is via existing RLS; leave to RLS
  ) THEN
    RAISE EXCEPTION 'order % tidak ditemukan', p_order_id;
  END IF;

  v_labor := COALESCE(p_override_labor, v_service.default_labor_amount, 0);

  -- Determine BOM to snapshot
  IF p_override_bom IS NOT NULL THEN
    v_bom := p_override_bom;
  ELSE
    -- Load master BOM × qty
    SELECT jsonb_agg(jsonb_build_object(
      'component_sku', b.component_sku,
      'qty', b.default_qty * p_qty,
      'service_catalog_bom_id', b.id
    ) ORDER BY b.sort_order)
    INTO v_bom
    FROM public.service_catalog_bom b
    WHERE b.service_catalog_id = p_service_catalog_id;
  END IF;

  v_bom := COALESCE(v_bom, '[]'::JSONB);
  v_bom_line_count := jsonb_array_length(v_bom);

  v_tracking_mode := CASE WHEN v_bom_line_count > 0 THEN 'detail' ELSE 'lumpsum' END;

  -- Insert rakit_job_lines
  -- Note: existing schema requires service_type NOT NULL and specific columns.
  -- Use 'jasa_custom_panel' as legacy hint; new logic keys off service_catalog_id.
  INSERT INTO public.rakit_job_lines (
    kasir_transaction_id, service_type, tracking_mode,
    labor_cost, lump_sum_hpp, hpp_owner_override,
    estimated_price, final_price,
    service_catalog_id, invoice_display_override,
    created_by
  ) VALUES (
    p_order_id, 'jasa_custom_panel', v_tracking_mode,
    v_labor, 0, FALSE,
    COALESCE(p_final_price, v_labor), COALESCE(p_final_price, v_labor),
    p_service_catalog_id, p_invoice_display_override,
    v_user
  ) RETURNING id INTO v_line_id;

  -- Insert BOM snapshot rows into rakit_components
  FOR v_item IN SELECT jsonb_array_elements(v_bom) LOOP
    INSERT INTO public.rakit_components (
      rakit_line_id, sku, qty, warehouse,
      service_catalog_bom_id
    ) VALUES (
      v_line_id,
      v_item->>'component_sku',
      (v_item->>'qty')::NUMERIC,
      NULL,  -- warehouse resolved at FIFO walk time
      NULLIF(v_item->>'service_catalog_bom_id', '')::UUID
    );
  END LOOP;

  RETURN v_line_id;
END $function$;

REVOKE ALL ON FUNCTION public.attach_service_to_order(UUID, UUID, NUMERIC, JSONB, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_service_to_order(UUID, UUID, NUMERIC, JSONB, NUMERIC, NUMERIC, TEXT) TO authenticated;
ALTER FUNCTION public.attach_service_to_order(UUID, UUID, NUMERIC, JSONB, NUMERIC, NUMERIC, TEXT) OWNER TO vosi_rpc_owner;
```

**NOTE:** `rakit_job_lines` schema from mig 20260608000008 — verify exact column list at Task 1. If column `kasir_transaction_id` differs or additional NOT NULL columns exist (e.g., `lump_sum_hpp`, `hpp_owner_override`, `estimated_price` etc), adjust INSERT accordingly. Task 1 output should confirm.

- [ ] **Step 2: Apply via MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` name=`service_catalog_rpcs`.

If INSERT INTO `rakit_job_lines` fails due to missing NOT NULL column, patch the migration to include required defaults (per Task 1 constraint enum).

- [ ] **Step 3: SQL smoke test — save + attach**

```sql
DO $$
DECLARE
  v_tenant UUID;
  v_owner UUID;
  v_service_id UUID;
  v_order_id UUID;
  v_line_id UUID;
  v_bom_count INT;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'garindo';
  SELECT user_id INTO v_owner FROM tenant_members WHERE tenant_id = v_tenant AND role = 'owner' LIMIT 1;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated', 'tenant_id', v_tenant::text)::text,
    true
  );

  -- Create service via RPC
  v_service_id := save_service_catalog(jsonb_build_object(
    'name', 'TEST-Wiring-Task5',
    'category', 'Wiring',
    'default_labor_amount', 500000,
    'default_include_material', true,
    'invoice_display', 'lump_sum',
    'revenue_coa_code', '4-1300',
    'labor_cost_coa_code', '5-2110',
    'bom', jsonb_build_array(
      jsonb_build_object('component_sku', (SELECT sku FROM stocks WHERE tenant_id = v_tenant LIMIT 1), 'default_qty', 2)
    )
  ));
  RAISE NOTICE 'save_service_catalog OK: %', v_service_id;

  -- Find an existing kasir_transactions order to attach to
  SELECT id INTO v_order_id FROM kasir_transactions WHERE tenant_id = v_tenant LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    v_line_id := attach_service_to_order(
      p_order_id := v_order_id,
      p_service_catalog_id := v_service_id,
      p_qty := 1,
      p_final_price := 1500000
    );
    RAISE NOTICE 'attach_service_to_order OK: %', v_line_id;

    SELECT COUNT(*) INTO v_bom_count FROM rakit_components WHERE rakit_line_id = v_line_id;
    RAISE NOTICE 'BOM snapshot rows: %', v_bom_count;
  ELSE
    RAISE NOTICE 'No kasir_transactions found for Garindo — skipping attach smoke';
  END IF;

  -- Soft delete
  PERFORM soft_delete_service_catalog(v_service_id);
  RAISE NOTICE 'soft_delete OK';

  RAISE EXCEPTION 'rollback smoke';
END $$;
```

Expected: NOTICE lines showing OK. Rollback at end.

- [ ] **Step 4: Cross-tenant isolation smoke**

```sql
DO $$
DECLARE
  v_tenant_a UUID;
  v_tenant_b UUID;
  v_owner_a UUID;
  v_service_id UUID;
  v_leaked_count INT;
BEGIN
  SELECT id INTO v_tenant_a FROM tenants WHERE slug = 'garindo';
  SELECT id INTO v_tenant_b FROM tenants WHERE slug != 'garindo' LIMIT 1;

  IF v_tenant_b IS NULL THEN
    RAISE NOTICE 'Only 1 tenant — cannot cross-tenant test. Skipping.';
    RAISE EXCEPTION 'skip';
  END IF;

  SELECT user_id INTO v_owner_a FROM tenant_members WHERE tenant_id = v_tenant_a AND role = 'owner' LIMIT 1;

  -- Create service as tenant A owner
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner_a::text, 'role', 'authenticated', 'tenant_id', v_tenant_a::text)::text,
    true
  );
  v_service_id := save_service_catalog(jsonb_build_object(
    'name', 'TEST-CrossTenant',
    'revenue_coa_code', '4-1100', 'labor_cost_coa_code', '5-1100',
    'bom', '[]'::jsonb
  ));

  -- Impersonate tenant B — should NOT see tenant A's service
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', (SELECT user_id FROM tenant_members WHERE tenant_id = v_tenant_b LIMIT 1)::text,
                       'role', 'authenticated', 'tenant_id', v_tenant_b::text)::text,
    true
  );

  SELECT COUNT(*) INTO v_leaked_count FROM service_catalog WHERE id = v_service_id;
  IF v_leaked_count > 0 THEN
    RAISE EXCEPTION 'RLS LEAK: tenant B sees tenant A service_catalog';
  END IF;

  RAISE NOTICE 'Cross-tenant isolation OK';
  RAISE EXCEPTION 'rollback';
END $$;
```

- [ ] **Step 5: get_advisors scan**

Use `mcp__plugin_supabase_supabase__get_advisors`.

- [ ] **Step 6: Commit + push**

```bash
git add supabase/migrations/20261115000151_service_catalog_rpcs.sql
git commit -m "feat(service-catalog): mig 151 CRUD + attach RPCs

- save_service_catalog(JSONB) — insert/update + BOM replace
- soft_delete_service_catalog(UUID) — is_active=false
- attach_service_to_order(...) — snapshot BOM into rakit_components

All SECDEF owned by vosi_rpc_owner, REVOKE anon, GRANT authenticated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: Migration 152 — extend transition_order_stage for stock decrement + JE post

**Goal:** Hook `transition_order_stage` at `3c → 4a` and `3c → 4b` (and `3a → 4a`, `3a → 4b` for komponen path with service line). When triggered, FIFO decrement snapshot components + post JE with revenue/labor/HPP split per service catalog COA mapping.

**Files:**
- Create: `supabase/migrations/20261115000152_transition_order_stage_hook.sql`

**Interfaces:**
- Consumes: `service_catalog`, `rakit_job_lines`, `rakit_components`, existing `stock_lots`, `chart_of_accounts`, `_post_journal_entry`, `deduct_stock_fifo`
- Produces: extended `transition_order_stage` that internally calls new helper `_process_service_line_delivery(p_order_id UUID, p_tenant UUID, p_user UUID) RETURNS JSONB`

- [ ] **Step 1: Read existing transition_order_stage source**

Via MCP execute_sql:
```sql
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname = 'transition_order_stage' LIMIT 1;
```

Copy the complete function body — the extension will `CREATE OR REPLACE` this function with the extra hook logic inserted at the right point (after transition is validated + committed to kasir_transactions.funnel_sub_stage, before RETURN).

- [ ] **Step 2: Write migration**

Create `supabase/migrations/20261115000152_transition_order_stage_hook.sql`:

```sql
-- 20261115000152_transition_order_stage_hook.sql
-- Item #2: Hook transition_order_stage at delivery transitions to trigger
-- FIFO stock decrement + JE post for service_catalog-linked service lines.
--
-- Trigger points: transitions where p_to_sub_stage IN ('4a', '4b')
--   3a → 4a  KOMPONEN normal path, delivery
--   3a → 4b  KOMPONEN normal path, pickup
--   3c → 4a  post-pelunasan, delivery
--   3c → 4b  post-pelunasan, pickup
--
-- Only fires when order has rakit_job_lines rows with service_catalog_id
-- IS NOT NULL. Legacy rows (service_catalog_id NULL) skip this hook — use
-- their existing kasir HPP path (record_kasir_sale HPP logic).

-- =============================================================================
-- Helper: _process_service_line_delivery
-- =============================================================================
CREATE OR REPLACE FUNCTION public._process_service_line_delivery(
  p_order_id UUID, p_tenant UUID, p_user UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line RECORD;
  v_comp RECORD;
  v_fifo_result JSONB;
  v_total_material_cost NUMERIC := 0;
  v_total_labor NUMERIC := 0;
  v_total_revenue NUMERIC := 0;
  v_je_lines JSONB := '[]'::jsonb;
  v_je_result JSONB;
  v_je_id UUID;
  v_service_lines_count INT := 0;
  v_order_date DATE;
  v_customer_debit_account TEXT;
  v_line_material_cost NUMERIC;
  v_line_labor NUMERIC;
  v_line_revenue NUMERIC;
  v_line_hpp NUMERIC;
BEGIN
  SELECT (created_at)::date INTO v_order_date
    FROM kasir_transactions WHERE id = p_order_id;

  -- For tempo B2B, debit account = 1-1400 Piutang Usaha (default)
  -- For kasir walk-in, debit account = 1-1100 Kas (existing pattern)
  -- Determine from kasir_transactions.payment_type
  SELECT CASE
    WHEN payment_type = 'TEMPO' THEN '1-1400'
    ELSE '1-1100'
  END INTO v_customer_debit_account
  FROM kasir_transactions WHERE id = p_order_id;

  -- Iterate service lines with catalog linkage
  FOR v_line IN
    SELECT rjl.*, sc.revenue_coa_code, sc.labor_cost_coa_code, sc.name AS service_name
    FROM rakit_job_lines rjl
    JOIN service_catalog sc ON sc.id = rjl.service_catalog_id
    WHERE rjl.kasir_transaction_id = p_order_id
      AND rjl.service_catalog_id IS NOT NULL
  LOOP
    v_service_lines_count := v_service_lines_count + 1;
    v_line_material_cost := 0;

    -- FIFO decrement each component
    FOR v_comp IN
      SELECT * FROM rakit_components
      WHERE rakit_line_id = v_line.id AND sku IS NOT NULL AND qty > 0
    LOOP
      v_fifo_result := public.deduct_stock_fifo(
        v_comp.sku, p_tenant, v_comp.qty, v_line.warehouse
      );

      -- Update snapshot with FIFO cost
      UPDATE rakit_components
        SET fifo_cost_snapshot = (v_fifo_result->>'total_cost')::NUMERIC / NULLIF(v_comp.qty, 0)
      WHERE id = v_comp.id;

      v_line_material_cost := v_line_material_cost + (v_fifo_result->>'total_cost')::NUMERIC;
    END LOOP;

    v_line_labor := COALESCE(v_line.labor_cost, 0);
    v_line_revenue := COALESCE(v_line.final_price, 0);
    v_line_hpp := v_line_material_cost + v_line_labor;

    -- Update rakit_job_lines with computed HPP
    UPDATE rakit_job_lines SET hpp_final = v_line_hpp WHERE id = v_line.id;

    v_total_material_cost := v_total_material_cost + v_line_material_cost;
    v_total_labor := v_total_labor + v_line_labor;
    v_total_revenue := v_total_revenue + v_line_revenue;

    -- Add revenue line to JE (per service revenue COA)
    IF v_line_revenue > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(
        jsonb_build_object(
          'account_code', v_line.revenue_coa_code,
          'side', 'CREDIT',
          'amount', v_line_revenue,
          'description', 'Pendapatan ' || v_line.service_name
        )
      );
    END IF;

    -- Add labor cost line to JE (per service labor COA)
    IF v_line_labor > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(
        jsonb_build_object(
          'account_code', v_line.labor_cost_coa_code,
          'side', 'DEBIT',
          'amount', v_line_labor,
          'description', 'Beban Tenaga Kerja ' || v_line.service_name
        )
      );
    END IF;

    -- Material HPP posts to 5-1100 (existing default)
    IF v_line_material_cost > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(
        jsonb_build_object(
          'account_code', '5-1100',
          'side', 'DEBIT',
          'amount', v_line_material_cost,
          'description', 'HPP material ' || v_line.service_name
        )
      );
    END IF;
  END LOOP;

  -- No service lines with catalog linkage — nothing to post
  IF v_service_lines_count = 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no service lines');
  END IF;

  -- Add customer debit + persediaan credit + labor credit (utang gaji)
  IF v_total_revenue > 0 THEN
    v_je_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_customer_debit_account,
        'side', 'DEBIT',
        'amount', v_total_revenue,
        'description', 'Piutang order ' || p_order_id::text
      )
    ) || v_je_lines;
  END IF;

  IF v_total_material_cost > 0 THEN
    v_je_lines := v_je_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '1-1500',
        'side', 'CREDIT',
        'amount', v_total_material_cost,
        'description', 'Persediaan konsumsi ' || p_order_id::text
      )
    );
  END IF;

  IF v_total_labor > 0 THEN
    v_je_lines := v_je_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2-2100',
        'side', 'CREDIT',
        'amount', v_total_labor,
        'description', 'Utang gaji tenaga kerja ' || p_order_id::text
      )
    );
  END IF;

  -- Post JE
  v_je_result := public._post_journal_entry(
    v_order_date,
    'SERVICE_DELIVERY'::journal_entry_source,
    'Pengiriman layanan order ' || p_order_id::text,
    v_je_lines,
    'kasir_transactions', p_order_id, p_tenant, NULL
  );

  v_je_id := (v_je_result->>'entry_id')::UUID;

  RETURN jsonb_build_object(
    'ok', true,
    'je_id', v_je_id,
    'total_revenue', v_total_revenue,
    'total_material_cost', v_total_material_cost,
    'total_labor', v_total_labor,
    'service_lines_count', v_service_lines_count
  );
END $function$;

REVOKE ALL ON FUNCTION public._process_service_line_delivery(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._process_service_line_delivery(UUID, UUID, UUID) TO authenticated;
ALTER FUNCTION public._process_service_line_delivery(UUID, UUID, UUID) OWNER TO vosi_rpc_owner;

-- =============================================================================
-- Extend journal_entry_source enum with SERVICE_DELIVERY value
-- =============================================================================
ALTER TYPE public.journal_entry_source ADD VALUE IF NOT EXISTS 'SERVICE_DELIVERY';

-- =============================================================================
-- Extend transition_order_stage: call helper at delivery transitions
-- =============================================================================
-- Read existing function body via Task 6 Step 1 grep.
-- After the state transition UPDATE (funnel_sub_stage set to p_to_sub_stage),
-- and BEFORE the RETURN success block, insert:
--
--   IF p_to_sub_stage IN ('4a', '4b') THEN
--     PERFORM public._process_service_line_delivery(
--       p_order_id, public._resolve_tenant_id(), v_actor
--     );
--   END IF;
--
-- Full extended function body (CREATE OR REPLACE):
-- <<paste from execute_sql Task 6 Step 1 with the IF block inserted before RETURN>>

-- Placeholder for full function — implementer subagent must fetch the current
-- body via execute_sql and paste with the hook block inserted at the correct
-- position (immediately after successful funnel_sub_stage UPDATE, before
-- the "ok: true" RETURN branch).
```

**Implementer note:** The full extended `transition_order_stage` body cannot be pasted here without live introspection at Task 6 execution time (function has been amended multiple times across migrations 20261115000201, 203, and possibly others). Implementer subagent MUST:
1. Run `SELECT pg_get_functiondef(...)` for current source
2. Locate the position after the successful `UPDATE kasir_transactions SET funnel_sub_stage = p_to_sub_stage` statement
3. Insert the hook `IF p_to_sub_stage IN ('4a', '4b') THEN ... END IF` block before the successful return path
4. Paste the full extended function body into the migration file

- [ ] **Step 3: Apply via MCP**

Two-part apply:
1. First apply the helper + enum + placeholder
2. Then run the introspection query
3. Amend migration file with full function body
4. Re-apply

Alternative: use `execute_sql` to run the introspection FIRST, then write the complete migration file with the full extended function body embedded, then apply.

Recommended flow:
```
a. Grep current transition_order_stage via execute_sql
b. Author the migration file with full CREATE OR REPLACE
c. Apply via apply_migration
```

- [ ] **Step 4: SQL smoke test — full delivery flow**

```sql
DO $$
DECLARE
  v_tenant UUID;
  v_owner UUID;
  v_service_id UUID;
  v_order_id UUID;
  v_line_id UUID;
  v_stock_before NUMERIC;
  v_stock_after NUMERIC;
  v_component_sku VARCHAR(50);
  v_component_qty NUMERIC := 2;
  v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'garindo';
  SELECT user_id INTO v_owner FROM tenant_members WHERE tenant_id = v_tenant AND role = 'owner' LIMIT 1;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated', 'tenant_id', v_tenant::text)::text,
    true
  );

  -- Pick a component with stock available
  SELECT sku, total_qty INTO v_component_sku, v_stock_before
  FROM stocks
  WHERE tenant_id = v_tenant AND total_qty > 10 LIMIT 1;

  -- Create service with BOM
  v_service_id := save_service_catalog(jsonb_build_object(
    'name', 'TEST-Delivery-Task6',
    'category', 'Test',
    'default_labor_amount', 500000,
    'revenue_coa_code', '4-1300',
    'labor_cost_coa_code', '5-2110',
    'bom', jsonb_build_array(
      jsonb_build_object('component_sku', v_component_sku, 'default_qty', v_component_qty)
    )
  ));

  -- Find (or skip if no) existing kasir_transactions in state 3a or 3c
  SELECT id INTO v_order_id FROM kasir_transactions
    WHERE tenant_id = v_tenant AND funnel_sub_stage IN ('3a', '3c') LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE NOTICE 'No orders in state 3a/3c for Garindo — creating one is too invasive for smoke; skip delivery test';
    RAISE EXCEPTION 'rollback';
  END IF;

  -- Attach service to order
  v_line_id := attach_service_to_order(
    p_order_id := v_order_id,
    p_service_catalog_id := v_service_id,
    p_qty := 1,
    p_final_price := 1500000
  );

  -- Transition to 4a — this should trigger _process_service_line_delivery
  v_result := transition_order_stage(
    p_order_id := v_order_id,
    p_from_sub_stage := (SELECT funnel_sub_stage FROM kasir_transactions WHERE id = v_order_id),
    p_to_sub_stage := '4a',
    p_expected_version := (SELECT version FROM kasir_transactions WHERE id = v_order_id)
  );

  RAISE NOTICE 'transition_order_stage result: %', v_result;

  -- Verify stock decremented
  SELECT total_qty INTO v_stock_after FROM stocks WHERE sku = v_component_sku;
  IF v_stock_after != v_stock_before - v_component_qty THEN
    RAISE EXCEPTION 'Stock not decremented: before=%, after=%, expected=%',
      v_stock_before, v_stock_after, v_stock_before - v_component_qty;
  END IF;
  RAISE NOTICE 'Stock decrement OK: % → %', v_stock_before, v_stock_after;

  -- Verify JE posted
  IF NOT EXISTS (
    SELECT 1 FROM journal_entries WHERE source_ref_id = v_order_id AND source_type = 'SERVICE_DELIVERY'
  ) THEN
    RAISE EXCEPTION 'JE not posted for service delivery';
  END IF;
  RAISE NOTICE 'JE post OK';

  RAISE EXCEPTION 'rollback smoke';
END $$;
```

- [ ] **Step 5: get_advisors scan**

- [ ] **Step 6: Commit + push**

```bash
git add supabase/migrations/20261115000152_transition_order_stage_hook.sql
git commit -m "feat(service-catalog): mig 152 delivery hook + JE post

- _process_service_line_delivery helper: FIFO decrement + JE post
  atomic per order
- transition_order_stage extended: fires helper at 4a/4b transitions
  when order has service_catalog-linked lines
- SERVICE_DELIVERY enum value added to journal_entry_source

JE structure per line:
  D <customer_debit>  (revenue total)
    C revenue_coa_code (per service)
  D 5-1100 HPP        (material)
    C 1-1500 Persediaan
  D labor_cost_coa_code
    C 2-2100 Utang Gaji

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 7: FE — TS types + API wrappers + Pengaturan Layanan CRUD tab + BOM editor

**Goal:** Foundation FE — Pengaturan tab with list/create/edit/delete + reusable BOM editor. Owner can setup catalog.

**Files:**
- Create: `src/lib/serviceCatalog/types.ts`
- Create: `src/lib/serviceCatalog/api.ts`
- Create: `src/components/pengaturan/LayananPanel.tsx`
- Create: `src/components/pengaturan/layanan/ServiceCatalogList.tsx`
- Create: `src/components/pengaturan/layanan/ServiceCatalogEditModal.tsx`
- Create: `src/components/pengaturan/layanan/BOMEditor.tsx`
- Create: `src/components/pengaturan/layanan/ComponentPicker.tsx`
- Modify: `src/components/PengaturanScreen.tsx` — register Layanan tab

**Interfaces:**
- Consumes: RPCs from Task 5 (`save_service_catalog`, `soft_delete_service_catalog`)
- Consumes: existing `stocks` table for BOM component picker + `chart_of_accounts` for COA dropdown
- Produces: `ServiceCatalogEntry`, `ServiceCatalogBOMItem`, `saveServiceCatalog(data)`, `listServiceCatalog()`, `deactivateServiceCatalog(id)`

- [ ] **Step 1: Write TS types**

Create `src/lib/serviceCatalog/types.ts`:

```typescript
export type InvoiceDisplay = 'lump_sum' | 'itemized';

export interface ServiceCatalogBOMItem {
  id?: string;
  component_sku: string;
  component_name?: string; // enriched from stocks on list
  default_qty: number;
  notes?: string | null;
  sort_order?: number;
}

export interface ServiceCatalogEntry {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  category: string | null;
  default_labor_amount: number;
  default_include_material: boolean;
  invoice_display: InvoiceDisplay;
  revenue_coa_code: string;
  labor_cost_coa_code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  bom: ServiceCatalogBOMItem[];
}

export type ServiceCatalogSavePayload = Omit<
  ServiceCatalogEntry,
  'id' | 'tenant_id' | 'created_at' | 'updated_at'
> & { id?: string | null };
```

- [ ] **Step 2: Write API wrappers**

Create `src/lib/serviceCatalog/api.ts`:

```typescript
import { supabase } from '../supabaseClient';
import type {
  ServiceCatalogEntry,
  ServiceCatalogSavePayload,
} from './types';

export async function saveServiceCatalog(
  data: ServiceCatalogSavePayload,
): Promise<string> {
  const { data: result, error } = await supabase.rpc('save_service_catalog', {
    p_data: data,
  });
  if (error) throw error;
  return result as string;
}

export async function deactivateServiceCatalog(id: string): Promise<void> {
  const { error } = await supabase.rpc('soft_delete_service_catalog', { p_id: id });
  if (error) throw error;
}

export async function listServiceCatalog(): Promise<ServiceCatalogEntry[]> {
  const { data, error } = await supabase
    .from('service_catalog')
    .select(`
      *,
      bom:service_catalog_bom (
        id, component_sku, default_qty, notes, sort_order
      )
    `)
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;

  // Enrich BOM component names from stocks
  const skus = new Set<string>();
  (data ?? []).forEach((s) => (s.bom ?? []).forEach((b: { component_sku: string }) => skus.add(b.component_sku)));
  const { data: stocksData } = skus.size > 0
    ? await supabase.from('stocks').select('sku, name').in('sku', Array.from(skus))
    : { data: [] };
  const skuToName = new Map<string, string>();
  (stocksData ?? []).forEach((s: { sku: string; name: string }) => skuToName.set(s.sku, s.name));

  return (data ?? []).map((s) => ({
    ...(s as ServiceCatalogEntry),
    bom: ((s as { bom?: unknown[] }).bom ?? []).map((b) => ({
      ...(b as ServiceCatalogEntry['bom'][number]),
      component_name: skuToName.get((b as { component_sku: string }).component_sku),
    })),
  })) as ServiceCatalogEntry[];
}
```

- [ ] **Step 3: Write ComponentPicker (reusable)**

Create `src/components/pengaturan/layanan/ComponentPicker.tsx`:

```typescript
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

interface StockOption {
  sku: string;
  name: string;
  category: string | null;
  total_qty: number;
}

interface Props {
  onPick: (sku: string, name: string) => void;
  onClose: () => void;
}

export default function ComponentPicker({ onPick, onClose }: Props) {
  const [items, setItems] = useState<StockOption[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('stocks')
        .select('sku, name, category, total_qty')
        .order('name');
      setItems((data ?? []) as StockOption[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-[#012749]">Pilih Komponen dari Stok</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>
        <div className="px-6 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau SKU…"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-2">
          {loading ? (
            <div className="text-center py-8 text-[13px] text-slate-500">Memuat…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-[13px] text-slate-500">
              Tidak ada komponen match.
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.sku}
                type="button"
                onClick={() => { onPick(item.sku, item.name); onClose(); }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg border-b border-slate-100 last:border-0"
              >
                <div className="text-[13px] font-semibold text-[#012749]">{item.name}</div>
                <div className="text-[11px] text-slate-500">
                  SKU: {item.sku} · Stok: {item.total_qty} {item.category ? `· ${item.category}` : ''}
                </div>
              </button>
            ))
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200">
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write BOMEditor (reusable)**

Create `src/components/pengaturan/layanan/BOMEditor.tsx`:

```typescript
import React, { useState } from 'react';
import type { ServiceCatalogBOMItem } from '../../../lib/serviceCatalog/types';
import ComponentPicker from './ComponentPicker';

interface Props {
  value: ServiceCatalogBOMItem[];
  onChange: (bom: ServiceCatalogBOMItem[]) => void;
  qtyLabel?: string; // "default_qty" (catalog) or "qty" (sales adjust)
}

export default function BOMEditor({ value, onChange, qtyLabel = 'Qty' }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function addItem(sku: string, name: string) {
    onChange([
      ...value,
      { component_sku: sku, component_name: name, default_qty: 1, notes: null, sort_order: value.length },
    ]);
  }

  function updateItem(idx: number, patch: Partial<ServiceCatalogBOMItem>) {
    onChange(value.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <div className="text-[12px] text-slate-500 border border-dashed border-slate-300 rounded-lg px-4 py-3 text-center">
          BOM kosong — layanan ini akan diperlakukan sebagai labor-only atau custom mode.
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">SKU / Nama</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600 w-24">{qtyLabel}</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Catatan</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {value.map((item, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[#012749]">{item.component_name ?? item.component_sku}</div>
                    <div className="text-[11px] text-slate-500">SKU: {item.component_sku}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={item.default_qty}
                      onChange={(e) => updateItem(idx, { default_qty: Number(e.target.value) })}
                      className="w-20 border border-slate-200 rounded px-2 py-1 text-right text-[13px]"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={item.notes ?? ''}
                      onChange={(e) => updateItem(idx, { notes: e.target.value || null })}
                      placeholder="opsional"
                      className="w-full border border-slate-200 rounded px-2 py-1 text-[13px]"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => removeItem(idx)} className="text-rose-500 hover:text-rose-700" title="Hapus">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="text-[13px] font-semibold text-[#012749] hover:opacity-80"
      >
        + Tambah Komponen dari Master Stok
      </button>
      {pickerOpen && <ComponentPicker onPick={addItem} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 5: Write ServiceCatalogEditModal**

Create `src/components/pengaturan/layanan/ServiceCatalogEditModal.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import type {
  ServiceCatalogEntry,
  ServiceCatalogSavePayload,
  ServiceCatalogBOMItem,
} from '../../../lib/serviceCatalog/types';
import { saveServiceCatalog } from '../../../lib/serviceCatalog/api';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import BOMEditor from './BOMEditor';

interface Props {
  initial: ServiceCatalogEntry | null;
  onDone: () => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface COAOption {
  account_code: string;
  account_name: string;
  account_type: string;
}

export default function ServiceCatalogEditModal({ initial, onDone, onCancel, showToast }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'Wiring');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [defaultLabor, setDefaultLabor] = useState(initial?.default_labor_amount ?? 0);
  const [defaultIncludeMaterial, setDefaultIncludeMaterial] = useState(initial?.default_include_material ?? true);
  const [invoiceDisplay, setInvoiceDisplay] = useState(initial?.invoice_display ?? 'lump_sum');
  const [revenueCoa, setRevenueCoa] = useState(initial?.revenue_coa_code ?? '4-1300');
  const [laborCoa, setLaborCoa] = useState(initial?.labor_cost_coa_code ?? '5-2110');
  const [bom, setBom] = useState<ServiceCatalogBOMItem[]>(initial?.bom ?? []);
  const [saving, setSaving] = useState(false);

  const [revenueCoaOptions, setRevenueCoaOptions] = useState<COAOption[]>([]);
  const [laborCoaOptions, setLaborCoaOptions] = useState<COAOption[]>([]);

  useEffect(() => {
    (async () => {
      const { data: rev } = await supabase.from('chart_of_accounts')
        .select('account_code, account_name, account_type')
        .eq('account_type', 'PENDAPATAN')
        .eq('is_active', true)
        .eq('is_group', false)
        .order('account_code');
      setRevenueCoaOptions((rev ?? []) as COAOption[]);

      const { data: exp } = await supabase.from('chart_of_accounts')
        .select('account_code, account_name, account_type')
        .eq('account_type', 'BEBAN')
        .eq('is_active', true)
        .eq('is_group', false)
        .order('account_code');
      setLaborCoaOptions((exp ?? []) as COAOption[]);
    })();
  }, []);

  async function handleSave() {
    if (!name.trim()) {
      showToast('Nama layanan wajib diisi', 'warning');
      return;
    }
    if (!revenueCoa || !laborCoa) {
      showToast('Akun Pendapatan dan Beban Labor wajib dipilih', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload: ServiceCatalogSavePayload = {
        id: initial?.id ?? null,
        name: name.trim(),
        category: category.trim() || null,
        description: description.trim() || null,
        default_labor_amount: defaultLabor,
        default_include_material: defaultIncludeMaterial,
        invoice_display: invoiceDisplay,
        revenue_coa_code: revenueCoa,
        labor_cost_coa_code: laborCoa,
        is_active: true,
        bom: bom.map((b, i) => ({ ...b, sort_order: i })),
      };
      await saveServiceCatalog(payload);
      showToast(`Layanan "${name}" berhasil disimpan`, 'success');
      onDone();
    } catch (err) {
      showToast(`Gagal simpan: ${extractErrorMessage(err)}`, 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-[#012749]">
            {initial ? 'Edit Layanan' : 'Tambah Layanan Baru'}
          </h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Nama + Kategori */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">Nama Layanan *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Wiring Panel MDB 3-fase 100A"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">Kategori</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Wiring"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
              />
            </div>
          </div>

          {/* Deskripsi */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1">Deskripsi (opsional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
            />
          </div>

          {/* Labor default + Include material */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">Labor Default (Rp)</label>
              <input
                type="number"
                value={defaultLabor}
                onChange={(e) => setDefaultLabor(Number(e.target.value))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">Include Material Default</label>
              <div className="flex gap-4 items-center pt-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" checked={defaultIncludeMaterial} onChange={() => setDefaultIncludeMaterial(true)} />
                  Ya
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" checked={!defaultIncludeMaterial} onChange={() => setDefaultIncludeMaterial(false)} />
                  Tidak (labor-only)
                </label>
              </div>
            </div>
          </div>

          {/* Invoice display */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1">Invoice Display</label>
            <div className="flex gap-4 items-center">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" checked={invoiceDisplay === 'lump_sum'} onChange={() => setInvoiceDisplay('lump_sum')} />
                Lump Sum (satu baris)
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" checked={invoiceDisplay === 'itemized'} onChange={() => setInvoiceDisplay('itemized')} />
                Itemized (show BOM)
              </label>
            </div>
          </div>

          {/* COA mapping */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">Akun Pendapatan *</label>
              <select
                value={revenueCoa}
                onChange={(e) => setRevenueCoa(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
              >
                {revenueCoaOptions.map((opt) => (
                  <option key={opt.account_code} value={opt.account_code}>
                    {opt.account_code} — {opt.account_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">Akun Beban Labor *</label>
              <select
                value={laborCoa}
                onChange={(e) => setLaborCoa(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
              >
                {laborCoaOptions.map((opt) => (
                  <option key={opt.account_code} value={opt.account_code}>
                    {opt.account_code} — {opt.account_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* BOM */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-2">BOM Komponen</label>
            <BOMEditor value={bom} onChange={setBom} qtyLabel="Qty default" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-between">
          <button onClick={onCancel} className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200">
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-[13px] font-bold bg-[#012749] text-white rounded-xl hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write ServiceCatalogList**

Create `src/components/pengaturan/layanan/ServiceCatalogList.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import type { ServiceCatalogEntry } from '../../../lib/serviceCatalog/types';
import { listServiceCatalog, deactivateServiceCatalog } from '../../../lib/serviceCatalog/api';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import { formatIDR } from '../../../lib/formatIDR';
import ServiceCatalogEditModal from './ServiceCatalogEditModal';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function ServiceCatalogList({ showToast }: Props) {
  const [items, setItems] = useState<ServiceCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ServiceCatalogEntry | null | 'new'>(null);

  async function load() {
    setLoading(true);
    try {
      setItems(await listServiceCatalog());
    } catch (err) {
      showToast(`Gagal memuat: ${extractErrorMessage(err)}`, 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleDeactivate(item: ServiceCatalogEntry) {
    if (!confirm(`Nonaktifkan "${item.name}"?`)) return;
    try {
      await deactivateServiceCatalog(item.id);
      showToast('Layanan dinonaktifkan', 'success');
      await load();
    } catch (err) {
      showToast(`Gagal: ${extractErrorMessage(err)}`, 'warning');
    }
  }

  const activeItems = items.filter((i) => i.is_active);
  const grouped = activeItems.reduce((acc, item) => {
    const cat = item.category ?? 'Lainnya';
    if (!acc.has(cat)) acc.set(cat, []);
    acc.get(cat)!.push(item);
    return acc;
  }, new Map<string, ServiceCatalogEntry[]>());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-[#012749]">Katalog Layanan</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Setup layanan yang bisa dijual — Wiring Panel, Custom Panel, Jasa dll. BOM link ke stok komponen.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="px-4 py-2 text-[13px] font-bold bg-[#012749] text-white rounded-xl hover:opacity-90"
        >
          + Tambah Layanan
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-[13px] text-slate-500">Memuat…</div>
      ) : activeItems.length === 0 ? (
        <div className="border border-dashed border-slate-300 rounded-xl px-6 py-8 text-center">
          <div className="text-4xl mb-2">🛠</div>
          <div className="text-[14px] font-bold text-slate-700 mb-1">Belum ada layanan</div>
          <div className="text-[12px] text-slate-500">
            Klik "+ Tambah Layanan" untuk setup layanan pertama.
          </div>
        </div>
      ) : (
        Array.from(grouped.entries()).map(([cat, catItems]) => (
          <div key={cat} className="space-y-2">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{cat}</div>
            <div className="space-y-2">
              {catItems.map((item) => (
                <div key={item.id} className="border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between hover:border-[#012749]/30">
                  <div>
                    <div className="text-[14px] font-bold text-[#012749]">{item.name}</div>
                    <div className="text-[12px] text-slate-500 mt-0.5">
                      Labor: {formatIDR(item.default_labor_amount)} · BOM: {item.bom.length} komponen · {item.invoice_display === 'lump_sum' ? 'Lump Sum' : 'Itemized'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(item)} className="px-3 py-1.5 text-[12px] font-semibold text-[#012749] hover:bg-slate-50 rounded-lg">Edit</button>
                    <button onClick={() => handleDeactivate(item)} className="px-3 py-1.5 text-[12px] font-semibold text-rose-600 hover:bg-rose-50 rounded-lg">Nonaktif</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editing !== null && (
        <ServiceCatalogEditModal
          initial={editing === 'new' ? null : editing}
          onDone={async () => { setEditing(null); await load(); }}
          onCancel={() => setEditing(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write LayananPanel + wire into PengaturanScreen**

Create `src/components/pengaturan/LayananPanel.tsx`:

```typescript
import React from 'react';
import ServiceCatalogList from './layanan/ServiceCatalogList';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function LayananPanel({ showToast }: Props) {
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-3">
        <h2 className="text-[16px] font-extrabold text-[#012749]">🛠 Layanan</h2>
        <p className="text-[13px] text-slate-500 mt-1">
          Katalog layanan yang bisa dijual — panel wiring, jasa custom, dst. BOM link ke stok komponen.
        </p>
      </div>
      <ServiceCatalogList showToast={showToast} />
    </div>
  );
}
```

Modify `src/components/PengaturanScreen.tsx`:
- Add tab entry `{ id: 'layanan', label: '🛠 Layanan' }` after `Approval` tab
- Import LayananPanel
- Render `<LayananPanel showToast={showToast} />` in tab content branch for `layanan`

Exact modification points TBD from grep in Task 1 — implementer subagent adjusts based on existing tab pattern (e.g., `Umum`, `Modul & Jasa`, `Approval`, `🏷 Promo Produk`, `🧾 Akuntansi` pattern already visible in earlier MCP snapshots).

- [ ] **Step 8: Lint + typecheck**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 9: Local smoke — dev server + browse to Pengaturan → Layanan**

```bash
npm run dev
```

Manually open `http://localhost:5173/?screen=settings` → click 🛠 Layanan tab → verify:
- Empty state renders with CTA
- Click + Tambah Layanan → modal opens with all fields
- COA dropdowns populate with existing Pendapatan + Beban accounts
- BOM editor: click + Tambah Komponen → picker opens, search works
- Save with 1 BOM item → toast success, list shows new entry
- Edit existing → modal pre-fills correctly
- Nonaktif → confirm dialog → entry disappears from list

- [ ] **Step 10: Commit + push**

```bash
git add src/lib/serviceCatalog/ src/components/pengaturan/LayananPanel.tsx \
        src/components/pengaturan/layanan/ src/components/PengaturanScreen.tsx
git commit -m "feat(service-catalog): FE Pengaturan Layanan CRUD + BOM editor

- Types + API wrappers for service_catalog RPCs
- Pengaturan → Layanan tab with list + CRUD modal
- Reusable BOM editor (used here + in sales flow Task 8)
- ComponentPicker with search over master stok

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

Cloud Build triggers → new tag URL deploys → verify tag URL smoke test passes → 100% traffic.

---

### Task 8: FE — Sales flow (Buat Pesanan tempo) integration

**Goal:** Add `+ Tambah Layanan` button to Buat Pesanan tempo. Modal picks service from catalog, auto-populates BOM (editable), sets labor + harga jual, submits via `attach_service_to_order`.

**Files:**
- Create: `src/components/pesanan/TambahLayananModal.tsx`
- Modify: existing Buat Pesanan tempo screen (path from Task 1 grep, e.g., `src/components/pesanan/BuatPesananTempoScreen.tsx`)

**Interfaces:**
- Consumes: `listServiceCatalog()` from Task 7 + `attach_service_to_order` RPC from Task 5 + `BOMEditor` from Task 7
- Produces: onSubmit callback returning `rakit_job_lines.id` — parent screen refreshes order lines

- [ ] **Step 1: Write TambahLayananModal**

Create `src/components/pesanan/TambahLayananModal.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { ServiceCatalogEntry, ServiceCatalogBOMItem } from '../../lib/serviceCatalog/types';
import { listServiceCatalog } from '../../lib/serviceCatalog/api';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import { formatIDR } from '../../lib/formatIDR';
import BOMEditor from '../pengaturan/layanan/BOMEditor';

interface Props {
  orderId: string;
  onDone: () => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function TambahLayananModal({ orderId, onDone, onCancel, showToast }: Props) {
  const [catalog, setCatalog] = useState<ServiceCatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [qty, setQty] = useState(1);
  const [labor, setLabor] = useState(0);
  const [finalPrice, setFinalPrice] = useState(0);
  const [bom, setBom] = useState<ServiceCatalogBOMItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const items = await listServiceCatalog();
      setCatalog(items.filter((i) => i.is_active));
    })();
  }, []);

  const selected = catalog.find((c) => c.id === selectedId) ?? null;

  // When service changes, auto-populate labor + BOM (× qty)
  useEffect(() => {
    if (!selected) return;
    setLabor(selected.default_labor_amount * qty);
    setBom(
      selected.bom.map((b) => ({
        ...b,
        default_qty: b.default_qty * qty,
      })),
    );
    setFinalPrice(selected.default_labor_amount * qty); // baseline; owner adjusts
  }, [selectedId]);

  // When qty changes, scale BOM + labor
  useEffect(() => {
    if (!selected) return;
    setLabor(selected.default_labor_amount * qty);
    setBom(
      selected.bom.map((b) => ({
        ...b,
        default_qty: b.default_qty * qty,
      })),
    );
  }, [qty]);

  async function handleSubmit() {
    if (!selectedId) {
      showToast('Pilih layanan dulu', 'warning');
      return;
    }
    setSaving(true);
    try {
      const overrideBom = bom.map((b) => ({
        component_sku: b.component_sku,
        qty: b.default_qty,
        service_catalog_bom_id: b.id ?? null,
      }));
      const { error } = await supabase.rpc('attach_service_to_order', {
        p_order_id: orderId,
        p_service_catalog_id: selectedId,
        p_qty: qty,
        p_override_bom: overrideBom,
        p_override_labor: labor,
        p_final_price: finalPrice,
      });
      if (error) throw error;
      showToast('Layanan ditambahkan ke pesanan', 'success');
      onDone();
    } catch (err) {
      showToast(`Gagal: ${extractErrorMessage(err)}`, 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-[#012749]">+ Tambah Layanan</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Service picker */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1">Pilih Layanan *</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
            >
              <option value="">— pilih —</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.category ? `[${c.category}] ` : ''}{c.name}
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <>
              {/* Qty */}
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1">Qty</label>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                  className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                />
              </div>

              {/* Labor */}
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1">Labor (Rp)</label>
                <input
                  type="number"
                  value={labor}
                  onChange={(e) => setLabor(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                />
                <div className="text-[11px] text-slate-400 mt-1">
                  Default catalog: {formatIDR(selected.default_labor_amount * qty)} — edit kalau perlu
                </div>
              </div>

              {/* Final price */}
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1">Harga Jual (Rp) *</label>
                <input
                  type="number"
                  value={finalPrice}
                  onChange={(e) => setFinalPrice(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                />
              </div>

              {/* BOM editor */}
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-2">
                  BOM Snapshot {bom.length === 0 && '(kosong = labor only)'}
                </label>
                <BOMEditor value={bom} onChange={setBom} qtyLabel="Qty" />
              </div>

              {/* HPP est */}
              <div className="border border-slate-200 rounded-lg bg-slate-50 p-3 text-[12px]">
                <div className="text-slate-500 mb-1">Estimasi (approx — actual HPP dari FIFO saat deliver):</div>
                <div className="font-semibold">
                  Labor: {formatIDR(labor)} · BOM: {bom.length} komponen · Total price: {formatIDR(finalPrice)}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-between">
          <button onClick={onCancel} className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200">Batal</button>
          <button
            onClick={handleSubmit}
            disabled={saving || !selectedId}
            className="px-5 py-2 text-[13px] font-bold bg-[#012749] text-white rounded-xl hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Tambah ke Pesanan'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire button into Buat Pesanan tempo screen**

File path from Task 1 grep. Assume `src/components/pesanan/BuatPesananTempoScreen.tsx` or similar.

Add near existing `+ Tambah Produk Stok` button:
```typescript
<button
  onClick={() => setLayananModalOpen(true)}
  className="px-4 py-2 text-[13px] font-semibold border border-slate-300 rounded-xl hover:bg-slate-50"
>
  + Tambah Layanan
</button>
```

Add state + modal render:
```typescript
const [layananModalOpen, setLayananModalOpen] = useState(false);
// ...
{layananModalOpen && orderId && (
  <TambahLayananModal
    orderId={orderId}
    onDone={async () => { setLayananModalOpen(false); await reloadOrderLines(); }}
    onCancel={() => setLayananModalOpen(false)}
    showToast={showToast}
  />
)}
```

Add rendering for service line items in the order line list (fetch `rakit_job_lines` joined with `service_catalog` for display name).

Implementer subagent adapts to existing screen structure per Task 1 grep. If screen already has a service line branch (via legacy `service_type` display), extend to prefer `service_catalog.name` when `service_catalog_id IS NOT NULL`.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

- [ ] **Step 4: Local smoke — dev server**

Manual test:
- Open Buat Pesanan tempo, click + Tambah Layanan
- Modal opens with catalog dropdown populated
- Pick "Wiring Panel MDB 100A" (setup in Task 7 smoke or via test data), qty 2
- BOM auto-populates ×2, labor auto-populates
- Adjust harga jual → 24jt
- Submit → toast success, order line list shows the service

- [ ] **Step 5: Commit + push**

```bash
git add src/components/pesanan/TambahLayananModal.tsx <buat-pesanan-screen>
git commit -m "feat(service-catalog): sales flow attach service line

- TambahLayananModal reuses BOMEditor from Task 7
- Service picker dropdown, qty scaling auto-updates BOM + labor
- attach_service_to_order RPC call with snapshot BOM

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 9: FE — Invoice PDF branches + Laporan Performa Layanan section + E2E MCP smoke + progress.md

**Goal:** Final FE — invoice PDF renders lump_sum + itemized branches per service config. Laporan Performa gets Layanan section. End-to-end MCP chrome smoke on Garindo prod. Progress.md updated.

**Files:**
- Modify: invoice PDF renderer (path from Task 1 grep)
- Modify: Laporan Performa screen (path from Task 1 grep)
- Modify: `progress.md`

- [ ] **Step 1: Extend invoice PDF renderer**

Locate existing invoice PDF renderer. Add branch:

```typescript
// After iterating regular product line items, iterate service lines:
const serviceLines = await fetchServiceLines(orderId); // rakit_job_lines join service_catalog

for (const line of serviceLines) {
  const display = line.invoice_display_override ?? line.service_catalog?.invoice_display ?? 'lump_sum';
  if (display === 'lump_sum') {
    // One row: name × qty = price
    autoTable.push([line.service_catalog.name, `${line.qty}`, formatIDR(line.final_price)]);
  } else {
    // Itemized: header + BOM component rows indented
    autoTable.push([line.service_catalog.name, '', '']);
    for (const comp of line.rakit_components) {
      autoTable.push([`  ${comp.name ?? comp.sku} × ${comp.qty}`, '', formatIDR(comp.qty * comp.fifo_cost_snapshot)]);
    }
    autoTable.push([`  Labor`, '', formatIDR(line.labor_cost)]);
    autoTable.push([`  Total`, '', formatIDR(line.final_price)]);
  }
}
```

Adapt to existing autoTable structure.

- [ ] **Step 2: Extend Laporan Performa**

Add new section "Layanan" that queries:
```sql
SELECT
  sc.name AS service_name,
  sc.category,
  COUNT(rjl.id) AS order_count,
  SUM(rjl.final_price) AS total_revenue,
  SUM(rjl.hpp_final) AS total_hpp,
  ROUND(100 * (SUM(rjl.final_price) - SUM(rjl.hpp_final)) / NULLIF(SUM(rjl.final_price), 0), 1) AS margin_pct
FROM rakit_job_lines rjl
JOIN service_catalog sc ON sc.id = rjl.service_catalog_id
JOIN kasir_transactions kt ON kt.id = rjl.kasir_transaction_id
WHERE rjl.service_catalog_id IS NOT NULL
  AND kt.created_at >= <period_start>
  AND kt.created_at <= <period_end>
GROUP BY sc.id, sc.name, sc.category
ORDER BY total_revenue DESC;
```

Render as table below existing Performa sections.

- [ ] **Step 3: Lint + typecheck**

```bash
npm run lint
```

- [ ] **Step 4: Commit invoice + reporting**

```bash
git add <invoice-pdf-file> <laporan-performa-file>
git commit -m "feat(service-catalog): invoice PDF branches + Laporan Layanan section

- Invoice PDF: lump_sum vs itemized per service config
- Laporan Performa: new Layanan section with revenue + HPP + margin per service

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 5: E2E MCP chrome smoke on Garindo prod**

Wait for Cloud Build to promote frontend to 100% traffic (`gcloud run services describe garindo-jaya-panel-msme-erp-frontend --region=asia-southeast1 --format="value(status.traffic)"` — check tag matches latest commit).

Via MCP chrome-devtools, on Garindo prod URL, logged in as tonywei.office (owner):

1. **Setup**: Pengaturan → 🛠 Layanan → Add 4 services:
   - Wiring Panel MDB 3-fase 100A (BOM: MCB + Busbar + Enclosure + Cable, labor Rp 1.5jt, lump_sum)
   - Wiring Panel MDB 3-fase 200A (similar BOM larger, labor Rp 2.5jt, lump_sum)
   - Jasa Wiring (Labor Only) — BOM kosong, labor Rp 75rb (per unit hint), lump_sum
   - Custom Panel Box (Ukuran Custom) — BOM kosong, labor Rp 0 default, lump_sum

2. **Scenario 1 quote**: Buat Pesanan tempo → customer PT Test → + Tambah Layanan → Wiring Panel MDB 100A × 2, labor Rp 3jt, harga Rp 24jt → submit → verify order line list shows service

3. **Scenario 2 quote**: another Pesanan → + Tambah Layanan → Jasa Wiring × 1, labor Rp 3jt, harga Rp 4.5jt → submit

4. **Scenario 3 quote**: another Pesanan → + Tambah Layanan → Custom Panel Box × 1 → BOM ad-hoc add 3 components → labor Rp 4.5jt, harga Rp 45jt → submit

5. **Deliver** (transition_order_stage → 4a): via existing UI → verify JE posted (query journal_entries WHERE source_ref_id = <order_id>) + stock decrement + hpp_final populated

6. **Invoice PDF**: download invoice → verify lump_sum rendering shows 1 line per service

7. **Laporan Performa** → Layanan section shows all 3 orders with revenue + HPP + margin

8. **Reverse**: revert 1 order → verify JE reversal + stock restore

9. **Cross-tenant SQL smoke** (from Task 5 Step 4) re-run on prod DB — confirm RLS

10. **get_advisors** final scan

- [ ] **Step 6: Update progress.md**

Append to `progress.md`:

```markdown
---

## 2026-07-13 — Item #2 Service Catalog SHIPPED

BOM-backed Custom Panel + Jasa Wiring re-architecture complete.

**Backend (migrations 148-152):**
- service_catalog + service_catalog_bom tables (tenant-scoped, composite FK
  to COA prevents cross-tenant leak)
- rakit_job_lines + rakit_components additive extends
- COA seed: 4-1300 Pendapatan Jasa Wiring, 5-2110 Beban TK Rakit
- RPCs: save_service_catalog, soft_delete_service_catalog,
  attach_service_to_order, extended transition_order_stage at 4a/4b
  transitions triggers _process_service_line_delivery helper (FIFO
  decrement + JE post atomic)

**Frontend:**
- Pengaturan → 🛠 Layanan tab (CRUD + BOM editor)
- Buat Pesanan tempo: + Tambah Layanan modal
- Invoice PDF: lump_sum + itemized branches
- Laporan Performa: Layanan section (revenue, HPP, margin per service)

**Garindo setup**: 4 default services created. E2E MCP smoke passed for all
3 scenarios (paket, labor-only, custom size). JE + stock + reporting benar.

**Deferred (backend siap, FE nyusul):**
- Kasir walk-in service line UI (backend siap via record_kasir_sale future extension)
- Include material per-order toggle UI
- Multi-warehouse component picking
- Historical rakit_job_lines backfill (opsional owner-driven)

**Irreversible decision shipped** (per memo
docs/superpowers/specs/2026-07-13-service-catalog-decision.md): BOM
snapshot pattern (freeze at commit). rakit_job_lines PK migration deferred
until 5M rows.
```

Commit:
```bash
git add progress.md
git commit -m "docs(progress): Item #2 Service Catalog SHIPPED — full E2E validated

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Self-Review Notes

**Spec coverage check:**
- Tables + RLS + composite FK — Task 2 ✓
- Extend rakit_job_lines + drop chk_rakit_service_type — Task 3 ✓
- COA seed + enum values — Task 4 ✓
- 3 CRUD RPCs — Task 5 ✓
- transition_order_stage hook + FIFO decrement + JE post — Task 6 ✓
- Pengaturan Layanan CRUD + BOM editor — Task 7 ✓
- Buat Pesanan tempo integration — Task 8 ✓
- Invoice PDF branches + Laporan Layanan section + E2E smoke + progress — Task 9 ✓
- Impact analysis section — captured in Task 1 ✓
- Historical rakit_job_lines policy (filter WHERE service_catalog_id IS NOT NULL) — Task 9 Step 2 query ✓
- Observability (RPC entry + error logs) — implicit in RPC RAISE EXCEPTION patterns; explicit logs deferred; add if founder pushes
- Cross-tenant isolation test — Task 5 Step 4 ✓
- REVOKE anon + GRANT authenticated — every RPC in Tasks 5, 6 ✓
- vosi_rpc_owner in t_select_own — Task 2 ✓

**Type consistency:**
- `ServiceCatalogEntry.bom` type = `ServiceCatalogBOMItem[]` — used consistently in Tasks 7, 8, 9
- `attach_service_to_order` signature `(order_id, service_catalog_id, qty, override_bom, override_labor, final_price, invoice_display_override)` — matches TS call in TambahLayananModal
- `_process_service_line_delivery(order_id, tenant_id, user_id)` — signature consistent Task 6

**Placeholders check:** searched for TBD/TODO — 3 known unknowns explicitly marked TBD (Task 1 grep targets: tempo verify RPC name, existing FE file paths). All resolved AT plan Task 1 execution, not left in later tasks.

**Right-sizing check:** 9 tasks, each with independently testable deliverable. Task 2 (base tables) is smallest; Task 6 (transition_order_stage extend) is largest but self-contained. Task 7 combines type/API/tab/list/modal/BOM editor because they must ship together for owner setup smoke to work.

**Known risks:**
- Task 4 enum ADD VALUE + INSERT USING enum in same migration might fail on transactional apply. Fallback: split into 150a + 150b files.
- Task 6 `transition_order_stage` body has been amended multiple times; implementer must fetch current source via `pg_get_functiondef` before authoring the extended version. Cannot pre-paste in this plan.
- Task 8 buat-pesanan-tempo screen path is from Task 1 grep; if screen structure differs significantly from assumed pattern, adapt.
