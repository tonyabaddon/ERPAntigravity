-- Stock Fraud Prevention Phase 2 Task 2: stock_adjustments table.
--
-- The satellite payload table for the 'adjustment' approval flow. Every row in
-- public.stock_adjustments points (via approval_request_id) at the source-of-
-- truth row in public.approval_requests (Phase 2 Task 1). The adjustment row
-- carries the workflow-specific fields the generic JSONB payload doesn't model
-- as columns: SKU, warehouse, qty delta, reason code, and the evidence URLs
-- that the WhatsApp / app inbox capture flow uploads.
--
-- chk_evidence_for_loss: if reason_code is 'rusak' or 'hilang' the row MUST
-- carry at least one evidence URL. The other reasons (sampel, koreksi_input,
-- korjual_admin) tolerate an empty evidence_urls array because they describe
-- planned activities (sample-out, data-entry correction) rather than physical
-- loss events that demand a photo / receipt.
--
-- committed_movement_id is set by the Task 3 RPC (commit_approved_adjustment)
-- once the approval transitions to 'approved' and the FIFO ledger row is
-- written. Until then it stays NULL.
--
-- NUMBERING: This file is …008 because Phase 2 Task 1 took …007. The plan
-- originally proposed …007 for this file; we shift to keep the on-disk order
-- aligned with the task order.

CREATE TYPE public.stock_adjustment_reason AS ENUM (
  'rusak', 'hilang', 'sampel', 'koreksi_input', 'korjual_admin'
);

CREATE TABLE public.stock_adjustments (
  id                    BIGSERIAL PRIMARY KEY,
  sku                   TEXT NOT NULL REFERENCES public.stocks(sku),
  warehouse             TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  qty_delta             INTEGER NOT NULL CHECK (qty_delta <> 0),
  reason_code           public.stock_adjustment_reason NOT NULL,
  reason_note           TEXT,
  evidence_urls         TEXT[] NOT NULL DEFAULT '{}',
  requested_by          UUID NOT NULL,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approval_request_id   BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status                TEXT NOT NULL DEFAULT 'pending_approval'
                        CHECK (status IN ('pending_approval','approved','rejected','expired')),
  committed_at          TIMESTAMPTZ,
  committed_movement_id BIGINT REFERENCES public.stock_movements(id),
  -- cardinality() returns 0 for an empty array; array_length(arr, 1) returns
  -- NULL for an empty array, and `FALSE OR NULL` evaluates to NULL which a
  -- CHECK treats as passing. Do NOT "simplify" cardinality back to
  -- array_length unless you also wrap it in COALESCE(..., 0).
  CONSTRAINT chk_evidence_for_loss CHECK (
    reason_code NOT IN ('rusak','hilang') OR cardinality(evidence_urls) >= 1
  )
);

CREATE INDEX idx_sa_status     ON public.stock_adjustments(status, requested_at DESC);
CREATE INDEX idx_sa_approval   ON public.stock_adjustments(approval_request_id);
CREATE INDEX idx_sa_sku        ON public.stock_adjustments(sku, requested_at DESC);
