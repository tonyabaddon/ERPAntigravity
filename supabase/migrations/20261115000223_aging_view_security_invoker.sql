-- 20261115000223_aging_view_security_invoker.sql
-- FIX: v_pengawasan_transfer_aging must run as security_invoker to inherit
-- the caller's RLS on warehouse_transfers. Without this, the view runs as
-- postgres (its owner) and bypasses tenant_id filtering — cross-tenant leak.
-- Advisor flagged as ERROR after slot 212 recreate + slot 210 drop dropped
-- the previous invoker flag. Discovered post-Task 25 apply.

ALTER VIEW public.v_pengawasan_transfer_aging SET (security_invoker = true);
