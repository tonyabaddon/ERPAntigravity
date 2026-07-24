-- Migration 20261115000515: backfill admin_users.permissions to 43-key shape
--
-- Root cause: 3-way divergence between PermissionSet interface (43 keys),
-- defaultPermissions() (12 keys), PERM_LABELS UI (12 keys). All 6 Owners in
-- prod DB have 33 keys (missing 6 Phase 1A piutang approvals + 4 renamed
-- legacy keys). NENG SEKAR (Staff Admin Toko) has 12 keys.
--
-- After this migration all admin_users rows have exactly 43 keys per
-- src/lib/permissions.ts PERMISSION_REGISTRY. Owner: all true. Non-Owner:
-- existing values preserved, missing filled per per-role default.
--
-- Idempotent: safe to re-run (rebuild from role + existing on each run).

DO $$
DECLARE
  v_owner_perms      jsonb;
  v_supervisor_perms jsonb;
  v_staff_perms      jsonb;
  v_finance_perms    jsonb;
  v_valid_keys       text[] := ARRAY[
    -- Modul Utama (10)
    'dashboard','salesInbox','laporan','aiStock','pelanggan','orderHistory',
    'userManagement','whatsappAi','notifications','settings',
    -- Pembelian (4)
    'pembelian','can_create_po','can_edit_po','can_witness_po_receipt',
    -- Stok Opname & Adjustment (7)
    'can_start_opname','can_witness_opname','can_commit_opname',
    'can_request_adjustment','can_approve_adjustment',
    'can_request_price_change','can_approve_price_change',
    -- Gudang (3)
    'can_manage_warehouses','can_initiate_transfer','can_receive_transfer',
    -- Kasir (9)
    'kasir','can_open_kasir_shift',
    'can_request_kasir_price_override','can_approve_kasir_price_override',
    'can_request_kasir_void','can_approve_kasir_void',
    'can_request_kasir_refund','can_approve_kasir_refund',
    'can_override_price_floor',
    -- Penjualan (1)
    'canConfigureSalesChannels',
    -- Piutang & Kredit (7)
    'piutang',
    'can_request_credit_activate','can_approve_credit_activate',
    'can_request_limit_change','can_approve_limit_change',
    'can_request_deactivate','can_approve_deactivate',
    -- Kontrol (2)
    'reconciliation','can_view_pengawasan'
  ];
BEGIN
  -- Bypass audit triggers if any exist on admin_users (defensive; matches
  -- migration 000513 backfill pattern for plans). Safe: authoritative rewrite.
  SET LOCAL session_replication_role = 'replica';

  -- Owner: all 43 = true
  v_owner_perms := (
    SELECT jsonb_object_agg(k, true) FROM unnest(v_valid_keys) AS k
  );

  -- Supervisor Gudang preset (see spec §6 default matrix)
  v_supervisor_perms := jsonb_build_object(
    'dashboard', true, 'salesInbox', false, 'laporan', true, 'aiStock', true,
    'pelanggan', false, 'orderHistory', false, 'userManagement', false,
    'whatsappAi', false, 'notifications', true, 'settings', false,
    'pembelian', true, 'can_create_po', true, 'can_edit_po', true,
    'can_witness_po_receipt', true,
    'can_start_opname', true, 'can_witness_opname', true,
    'can_commit_opname', false, 'can_request_adjustment', true,
    'can_approve_adjustment', false, 'can_request_price_change', false,
    'can_approve_price_change', false,
    'can_manage_warehouses', true, 'can_initiate_transfer', true,
    'can_receive_transfer', true,
    'kasir', false, 'can_open_kasir_shift', false,
    'can_request_kasir_price_override', false, 'can_approve_kasir_price_override', false,
    'can_request_kasir_void', false, 'can_approve_kasir_void', false,
    'can_request_kasir_refund', false, 'can_approve_kasir_refund', false,
    'can_override_price_floor', false,
    'canConfigureSalesChannels', false,
    'piutang', false,
    'can_request_credit_activate', false, 'can_approve_credit_activate', false,
    'can_request_limit_change', false, 'can_approve_limit_change', false,
    'can_request_deactivate', false, 'can_approve_deactivate', false,
    'reconciliation', false, 'can_view_pengawasan', false
  );

  -- Staff Admin Toko preset
  v_staff_perms := jsonb_build_object(
    'dashboard', true, 'salesInbox', true, 'laporan', true, 'aiStock', false,
    'pelanggan', true, 'orderHistory', true, 'userManagement', false,
    'whatsappAi', false, 'notifications', true, 'settings', false,
    'pembelian', true, 'can_create_po', false, 'can_edit_po', false,
    'can_witness_po_receipt', true,
    'can_start_opname', true, 'can_witness_opname', true,
    'can_commit_opname', false, 'can_request_adjustment', false,
    'can_approve_adjustment', false, 'can_request_price_change', true,
    'can_approve_price_change', false,
    'can_manage_warehouses', false, 'can_initiate_transfer', false,
    'can_receive_transfer', false,
    'kasir', true, 'can_open_kasir_shift', true,
    'can_request_kasir_price_override', true, 'can_approve_kasir_price_override', false,
    'can_request_kasir_void', true, 'can_approve_kasir_void', false,
    'can_request_kasir_refund', true, 'can_approve_kasir_refund', false,
    'can_override_price_floor', false,
    'canConfigureSalesChannels', false,
    'piutang', false,
    'can_request_credit_activate', true, 'can_approve_credit_activate', false,
    'can_request_limit_change', true, 'can_approve_limit_change', false,
    'can_request_deactivate', false, 'can_approve_deactivate', false,
    'reconciliation', false, 'can_view_pengawasan', false
  );

  -- Finance Manager preset
  v_finance_perms := jsonb_build_object(
    'dashboard', true, 'salesInbox', true, 'laporan', true, 'aiStock', false,
    'pelanggan', true, 'orderHistory', true, 'userManagement', false,
    'whatsappAi', false, 'notifications', true, 'settings', false,
    'pembelian', false, 'can_create_po', false, 'can_edit_po', false,
    'can_witness_po_receipt', false,
    'can_start_opname', false, 'can_witness_opname', false,
    'can_commit_opname', false, 'can_request_adjustment', false,
    'can_approve_adjustment', false, 'can_request_price_change', false,
    'can_approve_price_change', true,
    'can_manage_warehouses', false, 'can_initiate_transfer', false,
    'can_receive_transfer', false,
    'kasir', false, 'can_open_kasir_shift', false,
    'can_request_kasir_price_override', false, 'can_approve_kasir_price_override', false,
    'can_request_kasir_void', false, 'can_approve_kasir_void', false,
    'can_request_kasir_refund', false, 'can_approve_kasir_refund', true,
    'can_override_price_floor', false,
    'canConfigureSalesChannels', false,
    'piutang', true,
    'can_request_credit_activate', true, 'can_approve_credit_activate', true,
    'can_request_limit_change', true, 'can_approve_limit_change', true,
    'can_request_deactivate', true, 'can_approve_deactivate', true,
    'reconciliation', true, 'can_view_pengawasan', true
  );

  -- Update Owner rows: force all 43 = true
  UPDATE public.admin_users
  SET permissions = v_owner_perms
  WHERE role = 'Owner';

  -- Update Supervisor Gudang: preset || existing (existing wins on duplicates)
  UPDATE public.admin_users
  SET permissions = v_supervisor_perms || COALESCE(
    (SELECT jsonb_object_agg(k, v)
     FROM jsonb_each(COALESCE(permissions, '{}'::jsonb)) AS e(k, v)
     WHERE k = ANY(v_valid_keys)),
    '{}'::jsonb
  )
  WHERE role = 'Supervisor Gudang';

  -- Update Staff Admin Toko
  UPDATE public.admin_users
  SET permissions = v_staff_perms || COALESCE(
    (SELECT jsonb_object_agg(k, v)
     FROM jsonb_each(COALESCE(permissions, '{}'::jsonb)) AS e(k, v)
     WHERE k = ANY(v_valid_keys)),
    '{}'::jsonb
  )
  WHERE role = 'Staff Admin Toko';

  -- Update Finance Manager
  UPDATE public.admin_users
  SET permissions = v_finance_perms || COALESCE(
    (SELECT jsonb_object_agg(k, v)
     FROM jsonb_each(COALESCE(permissions, '{}'::jsonb)) AS e(k, v)
     WHERE k = ANY(v_valid_keys)),
    '{}'::jsonb
  )
  WHERE role = 'Finance Manager';

  RAISE NOTICE 'admin_users backfill: main updates complete';
END $$;

-- Verify: every admin_users row for known roles has exactly 43 keys.
DO $$
DECLARE
  v_bad_count int;
BEGIN
  SELECT count(*) INTO v_bad_count
  FROM public.admin_users
  WHERE role IN ('Owner', 'Supervisor Gudang', 'Staff Admin Toko', 'Finance Manager')
    AND (SELECT count(*) FROM jsonb_object_keys(permissions)) <> 43;

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'backfill_admin_permissions: % rows do not have 43 keys', v_bad_count;
  END IF;
  RAISE NOTICE 'admin_users backfill verified: all rows have 43 keys';
END $$;
