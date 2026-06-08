-- Phase 2 / Task 12 — Extend admin_users.permissions JSONB with 19 action-
-- level keys + add the three PIN-state columns + enable pgcrypto.
--
-- Design (spec Foundational Decision #5):
--   The existing `admin_users.permissions` JSONB already carries the 11
--   sidebar keys (dashboard, kasir, userManagement, ...). Rather than add
--   a parallel `action_permissions` column, we extend the SAME jsonb with
--   the 19 action-level keys via the `||` merge operator. One column, one
--   source of truth, one UI section in User Management ("Akses Aksi").
--   `||` merges right-side keys into the existing object; pre-existing
--   sidebar keys are preserved untouched (no name clashes).
--
-- The PIN columns back T13's verify_owner_pin RPC (bcrypt + per-Owner
-- lockout). Per Foundational Decision #6 the lockout counter sits on the
-- Owner's own row — multi-karyawan fumbles all increment the same row.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS approval_pin_hash  TEXT,
  ADD COLUMN IF NOT EXISTS pin_failed_count   INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until   TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Seed action-permission defaults per role (spec table at line 489-499 + the
-- phase-3/4 forward-looking keys per Foundational Decision #5).
--
-- Owner = ALL 19 keys true (locked-on for can_approve_* and can_commit_*
-- and can_view_pengawasan at the UI layer; we still seed them true here so
-- backend RPC gates pass for Owner).
-- ---------------------------------------------------------------------------
UPDATE public.admin_users
   SET permissions = permissions || jsonb_build_object(
     'can_request_adjustment',            true,
     'can_approve_adjustment',            true,
     'can_start_opname',                  true,
     'can_witness_opname',                true,
     'can_commit_opname',                 true,
     'can_request_price_change',          true,
     'can_approve_price_change',          true,
     'can_witness_po_receipt',            true,
     'can_open_kasir_shift',              true,
     'can_request_kasir_price_override',  true,
     'can_approve_kasir_price_override',  true,
     'can_request_kasir_void',            true,
     'can_approve_kasir_void',            true,
     'can_request_kasir_refund',          true,
     'can_approve_kasir_refund',          true,
     'can_override_price_floor',          true,
     'can_initiate_transfer',             true,
     'can_receive_transfer',              true,
     'can_view_pengawasan',               true
   )
 WHERE role = 'Owner';

-- Staff Admin Toko = front-line cashier+admin user. Can request (but not
-- approve) every fraud-gated action, open shifts, witness opname / PO
-- receipts, and initiate / receive transfers.
UPDATE public.admin_users
   SET permissions = permissions || jsonb_build_object(
     'can_request_adjustment',            true,
     'can_witness_opname',                true,
     'can_request_price_change',          true,
     'can_witness_po_receipt',            true,
     'can_open_kasir_shift',              true,
     'can_request_kasir_price_override',  true,
     'can_request_kasir_void',            true,
     'can_request_kasir_refund',          true,
     'can_initiate_transfer',             true,
     'can_receive_transfer',              true
   )
 WHERE role IN ('Staff Admin Toko', 'Staff Admin');

-- Supervisor Gudang = warehouse supervisor. Owns opname (start + witness),
-- can request adjustments / price changes, drives transfers (initiate +
-- receive) and witnesses PO receipts.
UPDATE public.admin_users
   SET permissions = permissions || jsonb_build_object(
     'can_request_adjustment',     true,
     'can_start_opname',           true,
     'can_witness_opname',         true,
     'can_request_price_change',   true,
     'can_witness_po_receipt',     true,
     'can_initiate_transfer',      true,
     'can_receive_transfer',       true
   )
 WHERE role = 'Supervisor Gudang';

-- Finance Manager = read-heavy approver-of-nothing in Phase 2. Can witness
-- opname (independent check on counts) and request price changes; everything
-- else (approve, kasir actions, transfers) stays default-false.
UPDATE public.admin_users
   SET permissions = permissions || jsonb_build_object(
     'can_witness_opname',         true,
     'can_request_price_change',   true
   )
 WHERE role = 'Finance Manager';
