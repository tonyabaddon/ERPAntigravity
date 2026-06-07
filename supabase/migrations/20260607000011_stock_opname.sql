-- Stock Fraud Prevention Phase 2 Task 5: stock_opname_sessions +
-- stock_opname_counts schemas.
--
-- An "opname session" is a physical-count cycle: two staff members go to the
-- warehouse, count what's physically on the shelf, enter the counted_qty per
-- (sku, warehouse) row, and submit. The variance vs. the system-snapshot
-- becomes the proposed adjustment, gated by Owner approval before the Phase 1
-- ledger (_log_stock_movement) is written. Tasks 6-8 add the RPCs; this
-- migration only lays down the two satellite tables.
--
-- Two-person rule (chk_two_person):
--   counted_by_user_id and witnessed_by_user_id MUST differ. This is the
--   table-level guarantee that an opname always involves two physical humans.
--   start_opname_session (Task 6) raises a friendlier "different" error before
--   the CHECK fires, but the schema-level guard catches direct INSERTs too.
--
-- Snapshot pattern (system_qty_snapshot):
--   The system_qty_snapshot column is filled ONCE at session start by Task 6's
--   start_opname_session RPC, NOT live-recomputed from stocks. Rationale:
--   between session start and submit the counters are walking the warehouse;
--   if a sale fires in the same window the stocks number moves, but the
--   COUNTED number is what was physically there at session-start, so the
--   variance must be measured against the start-of-session snapshot. Any
--   in-window sale becomes a separate ledger entry; the opname variance only
--   sees what the counter actually saw.
--
-- Variance is a STORED generated column so callers (UI, RPC) read the diff
-- without a CASE expression and the value is guaranteed consistent with the
-- snapshot + counted_qty at all times. COALESCE(counted_qty, 0) lets the
-- column compute as 0 - snapshot for rows still awaiting entry, which is
-- semantically correct (a missing count is treated as "I saw zero").
--
-- variance_value (NUMERIC) is filled by Task 7's submit RPC using
-- harga_modal at submit time; we can't generate it here because harga_modal
-- lives on stocks (a separate table) and is mutable.

CREATE TYPE public.opname_type   AS ENUM ('full','per_kategori','per_sku_list');
CREATE TYPE public.opname_status AS ENUM ('in_progress','pending_owner','committed','rejected');

CREATE TABLE public.stock_opname_sessions (
  id                       BIGSERIAL PRIMARY KEY,
  opname_type              public.opname_type NOT NULL,
  scope_payload            JSONB NOT NULL,
  counted_by_user_id       UUID NOT NULL,
  witnessed_by_user_id     UUID NOT NULL,
  CONSTRAINT chk_two_person CHECK (counted_by_user_id <> witnessed_by_user_id),
  witness_acknowledged_at  TIMESTAMPTZ,
  status                   public.opname_status NOT NULL DEFAULT 'in_progress',
  variance_total_value     NUMERIC(15,2) NOT NULL DEFAULT 0,
  approval_request_id      BIGINT REFERENCES public.approval_requests(id),
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at             TIMESTAMPTZ,
  committed_at             TIMESTAMPTZ
);

CREATE INDEX idx_sos_status ON public.stock_opname_sessions(status, started_at DESC);

CREATE TABLE public.stock_opname_counts (
  session_id          BIGINT NOT NULL REFERENCES public.stock_opname_sessions(id) ON DELETE CASCADE,
  sku                 TEXT NOT NULL REFERENCES public.stocks(sku),
  warehouse           TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  system_qty_snapshot INTEGER NOT NULL,
  counted_qty         INTEGER,
  variance            INTEGER GENERATED ALWAYS AS
                       (COALESCE(counted_qty, 0) - system_qty_snapshot) STORED,
  variance_value      NUMERIC(15,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, sku, warehouse)
);

CREATE INDEX idx_soc_session ON public.stock_opname_counts(session_id);
