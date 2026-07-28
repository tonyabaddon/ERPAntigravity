-- Slot 521 — backfill cash_accounts.coa_account_id for tenants with NULL rows.
--
-- Context: Toko Jaya Makmur has 2 cash_accounts (BCA Utama BANK, GoPay Merchant
-- E_WALLET) created outside the FE form (which calls resolveCoaAccountId at
-- create-time). These rows have coa_account_id = NULL, which causes
-- post_saldo_awal_snapshot (migration 20261115000147) to RAISE at:
--   `IF v_cash_coa IS NULL THEN RAISE EXCEPTION 'cash_account % tidak punya COA link'`
--
-- Prod scan 2026-07-27 (Supabase Management API):
--   SELECT t.slug, count(*) FROM cash_accounts ca JOIN tenants t ON t.id=ca.tenant_id
--    WHERE ca.coa_account_id IS NULL GROUP BY t.slug;
--   → toko-jaya-makmur: 2 rows. All real customer tenants: 0.
--
-- Backfill logic mirrors src/components/kasbank/AccountFormModal.tsx:72-127
--   - KAS → reuse tenant's 1-1110 Kas Toko
--   - BANK → next 1-12NN under 1-1200 (nextSuffix = 10 + child_count)
--   - E_WALLET → next 1-13NN under 1-1300 (same pattern)
--
-- Idempotent: skips rows already linked; safe to re-run.
-- Rollback: `UPDATE cash_accounts SET coa_account_id = NULL WHERE id IN (<ids>);
--            DELETE FROM chart_of_accounts WHERE account_code IN ('1-1210','1-1310')
--              AND tenant_id = '22222222-2222-2222-2222-222222222222';`
--   (Only apply if intentional revert; normal fix path never needs it.)

DO $$
DECLARE
  r RECORD;
  v_parent_id UUID;
  v_new_coa_id UUID;
  v_next_suffix INT;
  v_new_code TEXT;
  v_subtype TEXT;
  v_parent_code TEXT;
  v_child_prefix TEXT;
BEGIN
  FOR r IN
    SELECT id, tenant_id, account_type, internal_label
      FROM public.cash_accounts
     WHERE coa_account_id IS NULL
     ORDER BY tenant_id, account_type, sort_order
  LOOP
    IF r.account_type = 'KAS' THEN
      -- Reuse tenant's 1-1110 Kas Toko
      SELECT id INTO v_new_coa_id
        FROM public.chart_of_accounts
       WHERE tenant_id = r.tenant_id
         AND account_code = '1-1110'
         AND is_active = true;
      IF v_new_coa_id IS NULL THEN
        RAISE NOTICE 'skip cash_account % (tenant %): no 1-1110 Kas Toko COA', r.id, r.tenant_id;
        CONTINUE;
      END IF;
    ELSIF r.account_type IN ('BANK', 'E_WALLET') THEN
      v_parent_code := CASE r.account_type WHEN 'BANK' THEN '1-1200' ELSE '1-1300' END;
      v_child_prefix := CASE r.account_type WHEN 'BANK' THEN '1-12' ELSE '1-13' END;
      v_subtype := r.account_type;

      SELECT id INTO v_parent_id
        FROM public.chart_of_accounts
       WHERE tenant_id = r.tenant_id
         AND account_code = v_parent_code
         AND is_active = true;
      IF v_parent_id IS NULL THEN
        RAISE NOTICE 'skip cash_account % (tenant %): no parent COA %', r.id, r.tenant_id, v_parent_code;
        CONTINUE;
      END IF;

      -- nextSuffix = 10 + count (matches AccountFormModal.tsx:107 convention)
      SELECT 10 + count(*) INTO v_next_suffix
        FROM public.chart_of_accounts
       WHERE tenant_id = r.tenant_id
         AND parent_id = v_parent_id
         AND account_code LIKE v_child_prefix || '%';

      v_new_code := v_child_prefix || lpad(v_next_suffix::text, 2, '0');

      INSERT INTO public.chart_of_accounts (
        tenant_id, account_code, account_name, account_type,
        account_subtype, parent_id, normal_balance,
        is_system, is_active
      ) VALUES (
        r.tenant_id, v_new_code, r.internal_label, 'ASET',
        v_subtype, v_parent_id, 'DEBIT',
        false, true
      ) RETURNING id INTO v_new_coa_id;

      RAISE NOTICE 'created COA % (%) for cash_account % on tenant %',
        v_new_code, r.internal_label, r.id, r.tenant_id;
    ELSE
      RAISE NOTICE 'skip cash_account % (tenant %): unknown account_type %',
        r.id, r.tenant_id, r.account_type;
      CONTINUE;
    END IF;

    UPDATE public.cash_accounts
       SET coa_account_id = v_new_coa_id,
           updated_at = now()
     WHERE id = r.id;
  END LOOP;
END $$;

-- Verification: assert no rows left with NULL coa_account_id
DO $$
DECLARE v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining
    FROM public.cash_accounts
   WHERE coa_account_id IS NULL;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'backfill_cash_accounts_coa_link: % rows still NULL after backfill (may be tenants missing parent COAs — investigate NOTICES)', v_remaining;
  END IF;
  RAISE NOTICE 'backfill_cash_accounts_coa_link: OK — all cash_accounts linked';
END $$;
