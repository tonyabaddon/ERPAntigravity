-- 20261115000224_drop_auth_fks_and_map_actor.sql
-- Discovered during Task 25 prod smoke: admin_users.id ≠ auth.users.id in this repo
-- (mapped by email, not id). My original FKs (slot 211) pointed *_user_id → auth.users,
-- but the RPC receiver-permission check uses admin_users.id. This caused FK violations
-- when the RPC INSERTed a mixed set (sender=auth.uid = auth.users.id, receiver=passed-in
-- admin_users.id).
--
-- Real convention (verified against stock_movements.actor_user_id): user-id columns have
-- NO FK constraints. Drop the 4 FKs. RPCs re-issued in slot 226 (below) map auth.uid()
-- → admin_users.id via email lookup so all four *_user_id columns consistently store
-- admin_users.id values.
--
-- NOTE: slot 224's RPC bodies were superseded within-session by slots 225 and 226
-- (progressive discovery of NOT NULL columns actor_role + evidence_urls). Consumers
-- replaying this migration ONLY need this file's DDL; the final RPC bodies live in
-- slot 226.

ALTER TABLE public.warehouse_transfers DROP CONSTRAINT IF EXISTS warehouse_transfers_sender_user_id_fkey;
ALTER TABLE public.warehouse_transfers DROP CONSTRAINT IF EXISTS warehouse_transfers_receiver_user_id_fkey;
ALTER TABLE public.warehouse_transfers DROP CONSTRAINT IF EXISTS warehouse_transfers_received_by_user_id_fkey;
ALTER TABLE public.warehouse_transfers DROP CONSTRAINT IF EXISTS warehouse_transfers_cancelled_by_user_id_fkey;
