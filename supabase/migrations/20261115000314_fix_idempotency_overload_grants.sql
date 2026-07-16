-- Migration 314: Fix EXECUTE grants on all receive_purchase_order overloads
-- after migration 312 added the idempotency-key overload.
-- The 5-arg form (original) and 6-arg text-warehouse shim both need grants
-- re-confirmed so callers on any overload still work.

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, timestamptz, date, text, jsonb)
  TO authenticated, service_role, vosi_rpc_owner;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, timestamptz, date, text, jsonb, text)
  TO authenticated, service_role, vosi_rpc_owner;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, timestamptz, date, text, jsonb, uuid)
  TO authenticated, service_role, vosi_rpc_owner;
