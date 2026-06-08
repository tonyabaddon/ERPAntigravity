-- Phase 2, Task 9: price_change_requests + stock_price_history schemas.
--
-- Two tables with DIFFERENT mutability postures:
--
--   public.price_change_requests
--     The MUTABLE workflow row. Its lifecycle is the state machine
--     pending → approved | rejected | expired, driven by T10's
--     commit_approved_price_change RPC (which performs an UPDATE to flip
--     status + stamp decided_at/decided_by/committed_at). MUST stay
--     writable; we deliberately do NOT REVOKE UPDATE on this table.
--     One row per request, FK to approval_requests so the gating record is
--     never orphaned from the workflow record.
--
--   public.stock_price_history
--     The APPEND-ONLY audit log. Mirrors stock_movements' immutability
--     pattern (Foundational Decision #1 in the Phase 2 spec):
--       - REVOKE UPDATE,DELETE from PUBLIC / anon / authenticated (belt:
--         column-level privilege denial at the client-role layer).
--       - BEFORE UPDATE/DELETE trigger that RAISES 'append-only'
--         (suspenders: fires even under SECURITY DEFINER / service_role).
--     One row per committed price change. INSERTs come from T10's
--     commit_approved_price_change RPC; the 'seed' source is reserved for
--     tests and one-shot data migrations.
--
-- NUMBERING: this file is …015 (per task description) overriding the plan
-- body's …009 placeholder. Phase 2 has shifted numbering before (see the
-- …007 approval_requests header note); each task picks the next free slot
-- in the …007–…015 range to keep migrations strictly ordered.

-- ─────────────────────────────────────────────────────────────────────────
-- price_change_requests — MUTABLE workflow row.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.price_change_requests (
  id                  BIGSERIAL PRIMARY KEY,
  sku                 TEXT NOT NULL REFERENCES public.stocks(sku),
  field               TEXT NOT NULL CHECK (field IN ('price','harga_modal')),
  old_value           NUMERIC(15,2) NOT NULL,
  new_value           NUMERIC(15,2) NOT NULL CHECK (new_value >= 0),
  reason_note         TEXT NOT NULL,
  approval_request_id BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','expired')),
  requested_by        UUID NOT NULL,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ,
  decided_by          UUID,
  committed_at        TIMESTAMPTZ
);

CREATE INDEX idx_pcr_status ON public.price_change_requests(status, requested_at DESC);
CREATE INDEX idx_pcr_sku    ON public.price_change_requests(sku, requested_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- stock_price_history — APPEND-ONLY audit log.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.stock_price_history (
  id                 BIGSERIAL PRIMARY KEY,
  sku                TEXT NOT NULL REFERENCES public.stocks(sku),
  field              TEXT NOT NULL CHECK (field IN ('price','harga_modal')),
  old_value          NUMERIC(15,2) NOT NULL,
  new_value          NUMERIC(15,2) NOT NULL,
  source             TEXT NOT NULL CHECK (source IN ('approval','seed')),
  related_request_id BIGINT REFERENCES public.price_change_requests(id),
  actor_user_id      UUID NOT NULL,
  actor_role         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sph_sku_created ON public.stock_price_history(sku, created_at DESC);

-- Belt: column-level privilege REVOKE blocks anon + authenticated client
-- roles. SELECT is granted so the audit log is readable by the app.
REVOKE UPDATE, DELETE ON public.stock_price_history FROM PUBLIC;
REVOKE UPDATE, DELETE ON public.stock_price_history FROM anon;
REVOKE UPDATE, DELETE ON public.stock_price_history FROM authenticated;
GRANT  SELECT          ON public.stock_price_history TO authenticated;

-- Suspenders: trigger fires on UPDATE/DELETE even under service_role or a
-- SECURITY DEFINER function whose owner retains the REVOKEd privileges.
-- Mirrors the stock_movements deny_movement_mutation pattern from Phase 1.
CREATE OR REPLACE FUNCTION public.deny_price_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_price_history is append-only';
END $$;

CREATE TRIGGER trg_deny_sph_update BEFORE UPDATE ON public.stock_price_history
  FOR EACH ROW EXECUTE FUNCTION public.deny_price_history_mutation();
CREATE TRIGGER trg_deny_sph_delete BEFORE DELETE ON public.stock_price_history
  FOR EACH ROW EXECUTE FUNCTION public.deny_price_history_mutation();
