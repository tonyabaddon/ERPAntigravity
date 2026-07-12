-- Migration: supplier_claims schema (Item #1 rev 3)
--
-- Introduces unified supplier_claims model spanning opname damage,
-- PO receipt damage, and ad-hoc stock adjustment damage.
--
-- Workflow: admin flags rusak at opname → AWAITING_OWNER_DECISION → owner
-- decides Dispose (DISPOSED) or Klaim (PENDING → supplier response outcomes).
--
-- Speculative Option A accounting: opname commit books to 1-1460 Piutang
-- Klaim Supplier. Owner Dispose decision reclassifies to 5-3160 Beban.
--
-- Spec: docs/superpowers/specs/2026-07-12-opname-damage-supplier-claims-design.md
-- Plan: docs/superpowers/plans/2026-07-12-opname-damage-supplier-claims-plan.md
--
-- Additive schema only. No behavior change until RPCs land in slot 101.
-- Note: no explicit BEGIN/COMMIT — MCP apply_migration wraps the file; also
-- ALTER TYPE ADD VALUE inside an outer transaction becomes visible only after
-- commit in PostgreSQL, so structuring statements as autonomous is safer.

-- =====================================================================
-- 1. Enum extensions
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname='journal_entry_source' AND e.enumlabel='SUPPLIER_CLAIM') THEN
    ALTER TYPE public.journal_entry_source ADD VALUE 'SUPPLIER_CLAIM';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname='stock_movement_source' AND e.enumlabel='opname_damage') THEN
    ALTER TYPE public.stock_movement_source ADD VALUE 'opname_damage';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname='stock_movement_source' AND e.enumlabel='supplier_claim_return') THEN
    ALTER TYPE public.stock_movement_source ADD VALUE 'supplier_claim_return';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname='approval_request_type' AND e.enumlabel='resolve_supplier_claim') THEN
    ALTER TYPE public.approval_request_type ADD VALUE 'resolve_supplier_claim';
  END IF;
END $$;

-- =====================================================================
-- 2. supplier_claims table
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.supplier_claims (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id),
  -- supplier_id is NULLABLE: unknown at opname commit; owner sets when picking Klaim disposition.
  supplier_id           UUID NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  sku                   TEXT NOT NULL,
  -- warehouse is TEXT ('atas'/'bawah') pre-Phase 3 cutover, matching stock_adjustments convention.
  warehouse             TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  unit_cost             NUMERIC(15,2) NOT NULL CHECK (unit_cost >= 0),
  currency_code         TEXT NOT NULL DEFAULT 'IDR',
  -- source_type identifies where the claim originated.
  source_type           TEXT NOT NULL
                          CHECK (source_type IN ('PO_RECEIPT','STOCK_OPNAME','STOCK_ADJUSTMENT')),
  -- source_ref_id is TEXT to accommodate both UUID (PO item) and BIGINT (opname session, adjustment).
  source_ref_id         TEXT NOT NULL,
  damage_notes          TEXT,
  evidence_urls         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Lifecycle: AWAITING_OWNER_DECISION → (DISPOSED | PENDING) → (PENDING outcomes)
  status                TEXT NOT NULL DEFAULT 'AWAITING_OWNER_DECISION'
                          CHECK (status IN (
                            'AWAITING_OWNER_DECISION',
                            'DISPOSED',
                            'PENDING',
                            'RESOLVED_REPLACED',
                            'RESOLVED_CREDITED',
                            'RESOLVED_CASHED',
                            'REJECTED'
                          )),
  -- Populated when owner decides Klaim (transition to PENDING).
  owner_decision_at     TIMESTAMPTZ,
  owner_decided_by      UUID REFERENCES auth.users(id),
  owner_decision_notes  TEXT,
  -- Populated on resolve (external supplier response, PENDING → RESOLVED_* / REJECTED).
  resolution_amount     NUMERIC(15,2),
  -- resolution_target_id is TEXT: account code for CASHED, purchase_invoice UUID for CREDITED.
  resolution_target_id  TEXT,
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES auth.users(id),
  resolution_journal_id UUID REFERENCES public.journal_entries(id),
  resolution_notes      TEXT,
  -- Approval workflow linkage (owner PIN or APP_INBOX for high-value resolves).
  approval_request_id   BIGINT REFERENCES public.approval_requests(id),
  -- Journal posted at opname commit (speculative Option A: Dr 1-1460 / Cr 1-1510).
  create_journal_id     UUID REFERENCES public.journal_entries(id),
  -- Idempotency for RPC retries.
  idempotency_key       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL REFERENCES auth.users(id),
  -- Klaim path requires supplier_id (enforced at PENDING and later states, not AWAITING/DISPOSED).
  CONSTRAINT klaim_states_require_supplier
    CHECK (status IN ('AWAITING_OWNER_DECISION','DISPOSED') OR supplier_id IS NOT NULL),
  -- Owner decision fields populated when leaving AWAITING_OWNER_DECISION.
  CONSTRAINT decided_states_require_owner_stamp
    CHECK (status = 'AWAITING_OWNER_DECISION' OR owner_decision_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_supplier_claims_tenant_status
  ON public.supplier_claims(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_claims_supplier_status
  ON public.supplier_claims(supplier_id, status) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_claims_source
  ON public.supplier_claims(source_type, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_supplier_claims_awaiting_decision
  ON public.supplier_claims(tenant_id, created_at) WHERE status = 'AWAITING_OWNER_DECISION';

-- Uniqueness per source (idempotent auto-create protection).
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_claims_po_source
  ON public.supplier_claims(source_ref_id) WHERE source_type='PO_RECEIPT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_claims_opname_source
  ON public.supplier_claims(source_ref_id, sku, warehouse) WHERE source_type='STOCK_OPNAME';
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_claims_adj_source
  ON public.supplier_claims(source_ref_id) WHERE source_type='STOCK_ADJUSTMENT';

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_claims_idempotency
  ON public.supplier_claims(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- =====================================================================
-- 3. supplier_claim_events audit trail
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.supplier_claim_events (
  id               BIGSERIAL PRIMARY KEY,
  claim_id         UUID NOT NULL REFERENCES public.supplier_claims(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL
                     CHECK (event_type IN (
                       'CREATED',
                       'OWNER_DECIDED_DISPOSE',
                       'OWNER_DECIDED_KLAIM',
                       'APPROVAL_REQUESTED',
                       'APPROVAL_GRANTED',
                       'RESOLVED',
                       'VOIDED'
                     )),
  actor_user_id    UUID,
  payload          JSONB,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  tenant_id        UUID NOT NULL,
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_claim_events_claim
  ON public.supplier_claim_events(claim_id, at);
CREATE INDEX IF NOT EXISTS idx_supplier_claim_events_tenant
  ON public.supplier_claim_events(tenant_id, at DESC);

-- =====================================================================
-- 4. RLS
-- =====================================================================

ALTER TABLE public.supplier_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_claim_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_claim_events FORCE ROW LEVEL SECURITY;

-- Read: authenticated users see their tenant's claims. Uses _resolve_tenant_id() helper per codebase convention.
DROP POLICY IF EXISTS p_select_own ON public.supplier_claims;
CREATE POLICY p_select_own ON public.supplier_claims
  FOR SELECT TO authenticated
  USING (tenant_id = public._resolve_tenant_id());

DROP POLICY IF EXISTS p_select_own_events ON public.supplier_claim_events;
CREATE POLICY p_select_own_events ON public.supplier_claim_events
  FOR SELECT TO authenticated
  USING (tenant_id = public._resolve_tenant_id());

-- Block direct writes; all writes must go through SECDEF RPCs owned by vosi_rpc_owner
-- (per memory: guard_expiry_write_broken_predicate + secdef_returning_gap).
DROP POLICY IF EXISTS p_no_direct_write ON public.supplier_claims;
CREATE POLICY p_no_direct_write ON public.supplier_claims
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS p_no_direct_write_events ON public.supplier_claim_events;
CREATE POLICY p_no_direct_write_events ON public.supplier_claim_events
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- SECDEF ownership: vosi_rpc_owner needs both USING and WITH CHECK true so
-- INSERT ... RETURNING inside SECDEF RPCs works (per memory: secdef_returning_gap).
DROP POLICY IF EXISTS t_select_own_secdef ON public.supplier_claims;
CREATE POLICY t_select_own_secdef ON public.supplier_claims TO vosi_rpc_owner
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS t_select_own_secdef_events ON public.supplier_claim_events;
CREATE POLICY t_select_own_secdef_events ON public.supplier_claim_events TO vosi_rpc_owner
  USING (true) WITH CHECK (true);

-- Platform admin readall (matches pattern applied to 79 tables per phase_a_secdef_authenticated_gap memory).
DROP POLICY IF EXISTS p_platform_admin_readall ON public.supplier_claims;
CREATE POLICY p_platform_admin_readall ON public.supplier_claims
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS p_platform_admin_readall_events ON public.supplier_claim_events;
CREATE POLICY p_platform_admin_readall_events ON public.supplier_claim_events
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- =====================================================================
-- 5. Column additions on stock_opname_counts (admin damage capture)
-- =====================================================================

ALTER TABLE public.stock_opname_counts
  ADD COLUMN IF NOT EXISTS damaged_qty INTEGER NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  ADD COLUMN IF NOT EXISTS damage_notes TEXT,
  ADD COLUMN IF NOT EXISTS damage_evidence_urls TEXT[];

-- Cannot flag more damage than counted (or, if counted is NULL, can only flag 0).
-- CHECK uses IS NOT DISTINCT FROM safe comparison: passes when damaged_qty=0
-- (no flag), fails when damaged_qty>0 AND (counted_qty IS NULL OR damaged_qty>counted_qty).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'damaged_qty_within_counted'
       AND table_name = 'stock_opname_counts'
  ) THEN
    ALTER TABLE public.stock_opname_counts ADD CONSTRAINT damaged_qty_within_counted
      CHECK (damaged_qty = 0 OR (counted_qty IS NOT NULL AND damaged_qty <= counted_qty));
  END IF;
END $$;

-- =====================================================================
-- 6. Column additions on stock_adjustments (ad-hoc rusak KLAIM disposition path)
-- =====================================================================

ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS damage_disposition TEXT
    CHECK (damage_disposition IS NULL OR damage_disposition IN ('DISPOSE','KLAIM_SUPPLIER')),
  ADD COLUMN IF NOT EXISTS damage_supplier_id UUID REFERENCES public.suppliers(id),
  ADD COLUMN IF NOT EXISTS supplier_claim_id UUID REFERENCES public.supplier_claims(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'klaim_requires_supplier'
       AND table_name = 'stock_adjustments'
  ) THEN
    ALTER TABLE public.stock_adjustments ADD CONSTRAINT klaim_requires_supplier
      CHECK (damage_disposition IS DISTINCT FROM 'KLAIM_SUPPLIER' OR damage_supplier_id IS NOT NULL);
  END IF;
END $$;

-- =====================================================================
-- 7. Column addition on purchase_order_items (link to claim record)
-- =====================================================================

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS supplier_claim_id UUID REFERENCES public.supplier_claims(id);

-- damage_status remains TEXT with app-level convention. Valid app-level values:
--   'NONE' | 'PENDING_RETURN' | 'RETURNED' | 'REPLACED'
--   | 'RESOLVED_CREDITED' | 'RESOLVED_CASHED' | 'REJECTED'
-- TypeScript union enforces (src/lib/supplierClaims/types.ts).

-- =====================================================================
-- 8. Feature flag on accounting_config (record_pi PO damage split, default off)
-- =====================================================================

ALTER TABLE public.accounting_config
  ADD COLUMN IF NOT EXISTS enable_pi_damage_split BOOLEAN NOT NULL DEFAULT false;

-- =====================================================================
-- 9. Per-tenant COA seed for 1-1460 and 5-3160
--    Matches pattern from 20261115000053_seed_tenant_accounting_on_provision.sql
-- =====================================================================

DO $$
DECLARE
  v_tenant       RECORD;
  v_parent_1400  UUID;
  v_parent_5300  UUID;
BEGIN
  FOR v_tenant IN SELECT id FROM public.tenants LOOP
    -- Look up parent 1-1400 (Piutang Usaha group).
    SELECT id INTO v_parent_1400
      FROM public.chart_of_accounts
     WHERE tenant_id = v_tenant.id AND account_code = '1-1400';

    -- Look up parent 5-3100 (Beban Non-Operasional / Kerugian group).
    SELECT id INTO v_parent_5300
      FROM public.chart_of_accounts
     WHERE tenant_id = v_tenant.id AND account_code = '5-3100';

    -- 1-1460 Piutang Klaim Supplier (asset suspense for pending klaim value)
    INSERT INTO public.chart_of_accounts (
      tenant_id, account_code, account_name, account_type,
      parent_id, is_control_account, normal_balance, is_active, is_system
    ) VALUES (
      v_tenant.id, '1-1460', 'Piutang Klaim Supplier', 'ASET',
      v_parent_1400, false, 'DEBIT', true, true
    ) ON CONFLICT (tenant_id, account_code) DO NOTHING;

    -- 5-3160 Beban Barang Rusak (damage loss for dispose / rejected claims / variances)
    INSERT INTO public.chart_of_accounts (
      tenant_id, account_code, account_name, account_type,
      parent_id, is_control_account, normal_balance, is_active, is_system
    ) VALUES (
      v_tenant.id, '5-3160', 'Beban Barang Rusak', 'BEBAN',
      v_parent_5300, false, 'DEBIT', true, true
    ) ON CONFLICT (tenant_id, account_code) DO NOTHING;
  END LOOP;
END $$;
