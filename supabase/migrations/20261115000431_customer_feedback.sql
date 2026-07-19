-- Migration slot 431. Sprint 4 Task 4.4: post-order feedback + customer_feedback table.
-- customers.id is TEXT (not UUID) — customer_id declared TEXT accordingly.
-- No delivered_at column on orders; use updated_at + status='COMPLETED' in poller.
-- orders.id is UUID — order_id UUID is correct.

CREATE TABLE IF NOT EXISTS public.customer_feedback (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID    NOT NULL REFERENCES public.tenants(id),
  customer_id TEXT    NOT NULL,
  order_id    UUID    NOT NULL,
  rating      INT     CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  approved_for_landing BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_tenant_rating
  ON public.customer_feedback (tenant_id, rating DESC);

ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY t_select_own ON public.customer_feedback
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

CREATE POLICY t_insert_own ON public.customer_feedback
  FOR INSERT TO vosi_rpc_owner
  WITH CHECK (tenant_id = public._resolve_tenant_id());

CREATE POLICY t_update_own ON public.customer_feedback
  FOR UPDATE TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

-- Track when feedback WA was sent to avoid re-sending.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS feedback_requested_at TIMESTAMPTZ;
