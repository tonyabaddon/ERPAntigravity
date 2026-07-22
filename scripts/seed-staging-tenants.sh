#!/usr/bin/env bash
# One-shot seed: create 3 staging tenants mirroring the 3 prod tenants.
#
# Idempotent: skips tenants that already exist.
# Founder is the owner for all 3; playwright-toko-owner is added as
# a secondary tenant_user on toko-jaya-makmur-staging for E2E tests.
#
# NOTE: Bypasses public.provision_tenant() because that RPC has a latent
# permission gap since mig 507 (P3-05) — vosi_rpc_owner cannot read
# auth.users (schema auth not granted USAGE). Follow-up: either move
# ownership back to postgres or add auth.users grants via supabase_admin.
# This seed inlines the same INSERTs + calls _seed_tenant_accounting to
# match provision_tenant's side effects.
#
# Runs everything in one Supabase Management API call (single DO block)
# to minimise pool exhaustion risk.

set -euo pipefail
source .env
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ekhhojaezdfjfwuxyjkl}"

read -r -d '' QUERY <<'SQL' || true
DO $$
DECLARE
  v_founder_id uuid;
  v_toko_owner_id uuid;
  v_tenant_id uuid;
  v_slug text;
  v_owner_perms jsonb := '{"aiStock":true,"laporan":true,"pipeline":true,"settings":true,"dashboard":true,"pelanggan":true,"salesInbox":true,"whatsappAi":true,"can_edit_po":true,"orderHistory":true,"can_create_po":true,"notifications":true,"userManagement":true,"can_start_opname":true,"can_commit_opname":true,"can_witness_opname":true,"can_view_pengawasan":true,"can_open_kasir_shift":true,"can_receive_transfer":true,"can_initiate_transfer":true,"can_manage_warehouses":true,"can_approve_adjustment":true,"can_approve_kasir_void":true,"can_request_adjustment":true,"can_request_kasir_void":true,"can_witness_po_receipt":true,"can_approve_kasir_refund":true,"can_approve_price_change":true,"can_override_price_floor":true,"can_request_kasir_refund":true,"can_request_price_change":true,"can_approve_kasir_price_override":true,"can_request_kasir_price_override":true}'::jsonb;
  v_seed jsonb := '[
    {"slug":"garindo-staging","name":"Garindo Jaya Panel (Staging)","owner_name":"Owner Garindo","owner_email":"owner+garindo-staging@caleo.id"},
    {"slug":"toko-jaya-makmur-staging","name":"Toko Jaya Makmur (Staging)","owner_name":"Owner Toko","owner_email":"owner+toko-staging@caleo.id"},
    {"slug":"warung-sinar-rezeki-staging","name":"Warung Sinar Rezeki (Staging)","owner_name":"Owner Warung","owner_email":"owner+warung-staging@caleo.id"}
  ]'::jsonb;
  v_row jsonb;
  v_now timestamptz := now();
  v_expires timestamptz := now() + interval '12 months';
BEGIN
  SELECT id INTO v_founder_id FROM auth.users WHERE email = 'tonywei.office@gmail.com';
  SELECT id INTO v_toko_owner_id FROM auth.users WHERE email = 'playwright-toko-owner@caleo.id';
  IF v_founder_id IS NULL THEN RAISE EXCEPTION 'founder not found in auth.users'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_seed) LOOP
    v_slug := v_row->>'slug';
    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) THEN
      RAISE NOTICE 'SKIP % (exists)', v_slug;
      CONTINUE;
    END IF;

    INSERT INTO public.tenants (slug, name, status, created_by, environment)
    VALUES (v_slug, v_row->>'name', 'ACTIVE', v_founder_id, 'staging')
    RETURNING id INTO v_tenant_id;

    INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at, updated_by)
    VALUES (v_tenant_id, 'STARTER', v_now, v_expires, v_founder_id);

    INSERT INTO public.tenant_users (tenant_id, user_id, role, status)
    VALUES (v_tenant_id, v_founder_id, 'owner', 'ACTIVE');

    INSERT INTO public.admin_users (id, name, email, role, status, tenant_id, permissions)
    VALUES (v_founder_id, v_row->>'owner_name', v_row->>'owner_email', 'Owner', 'Aktif', v_tenant_id, v_owner_perms)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.store_settings (tenant_id, nama_toko, updated_at)
    VALUES (v_tenant_id, v_row->>'name', v_now);

    -- Inline _seed_tenant_accounting (SECDEF flips to vosi_rpc_owner and hits RLS on template).
    -- Running here as postgres → BYPASSRLS.
    IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE tenant_id = v_tenant_id) THEN
      INSERT INTO public.chart_of_accounts (
        tenant_id, account_code, account_name, account_type, account_subtype,
        is_control_account, normal_balance, is_active, is_system, description
      )
      SELECT v_tenant_id, account_code, account_name, account_type, account_subtype,
             is_control_account, normal_balance, is_active, is_system, description
      FROM public.chart_of_accounts
      WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;

      UPDATE public.chart_of_accounts child
      SET parent_id = parent_new.id
      FROM public.chart_of_accounts child_src
      JOIN public.chart_of_accounts parent_src
        ON parent_src.id = child_src.parent_id
        AND parent_src.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
      JOIN public.chart_of_accounts parent_new
        ON parent_new.account_code = parent_src.account_code
        AND parent_new.tenant_id = v_tenant_id
      WHERE child.tenant_id = v_tenant_id
        AND child_src.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
        AND child_src.account_code = child.account_code
        AND child_src.parent_id IS NOT NULL;

      DECLARE
        v_kas_coa_id uuid;
        v_kas_cash_acct_id uuid;
      BEGIN
        SELECT id INTO v_kas_coa_id
        FROM public.chart_of_accounts
        WHERE tenant_id = v_tenant_id AND account_code = '1-1110';
        IF v_kas_coa_id IS NULL THEN
          RAISE EXCEPTION 'COA 1-1110 missing after copy for tenant %', v_tenant_id;
        END IF;

        INSERT INTO public.cash_accounts (
          tenant_id, account_type, internal_label, purpose,
          show_in_invoice, sort_order, is_active, coa_account_id
        ) VALUES (
          v_tenant_id, 'KAS', 'Kas Toko', 'PETTY_CASH',
          true, 0, true, v_kas_coa_id
        ) RETURNING id INTO v_kas_cash_acct_id;

        INSERT INTO public.accounting_config (
          tenant_id, ppn_mode, ppn_rate_pct, pph_mode, pph_rate_pct,
          fiscal_year_start_month, enable_dual_write_to_gl,
          enable_strict_period_close, default_kas_account_id
        ) VALUES (
          v_tenant_id, 'NON_PKP', 11.00, 'UMKM_FINAL_0_5', 0.50,
          1, true, false, v_kas_cash_acct_id
        );
      END;
    END IF;
    RAISE NOTICE 'CREATED % (id=%)', v_slug, v_tenant_id;
  END LOOP;

  -- Add playwright-toko-owner as second member of toko-jaya-makmur-staging (for E2E)
  IF v_toko_owner_id IS NOT NULL THEN
    SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'toko-jaya-makmur-staging';
    IF v_tenant_id IS NOT NULL THEN
      INSERT INTO public.tenant_users (tenant_id, user_id, role, status)
      VALUES (v_tenant_id, v_toko_owner_id, 'owner', 'ACTIVE')
      ON CONFLICT DO NOTHING;
      RAISE NOTICE 'ADDED playwright-toko-owner to toko-jaya-makmur-staging';
    END IF;
  END IF;
END $$;
SQL

PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'name':'seed_staging_tenants','query':sys.stdin.read()}))" <<< "$QUERY")

for i in $(seq 1 20); do
  R=$(curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/migrations" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "$PAYLOAD")
  if [[ "$R" == *"remaining connection slots"* ]]; then
    echo "attempt $i pool exhausted, sleeping"; sleep 20
  else
    echo "SEED RESULT: $R"
    break
  fi
done

echo ""
echo "Verifying:"
for i in $(seq 1 20); do
  V=$(curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/migrations" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d '{"name":"verify_seed","query":"SELECT t.slug, t.environment, au.email, tu.role FROM public.tenant_users tu JOIN public.tenants t ON t.id = tu.tenant_id JOIN auth.users au ON au.id = tu.user_id WHERE t.environment = '"'"'staging'"'"' ORDER BY t.slug, au.email;"}')
  if [[ "$V" == *"remaining connection slots"* ]]; then
    sleep 20
  else
    echo "$V" | python3 -c "import json,sys; [print(f\"{r['slug']} | env={r['environment']} | user={r['email']} | role={r['role']}\") for r in json.load(sys.stdin, strict=False)]"
    break
  fi
done
