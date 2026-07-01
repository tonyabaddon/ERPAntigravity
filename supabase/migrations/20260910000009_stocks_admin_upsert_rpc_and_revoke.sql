-- 20260910000009 — stocks: admin_upsert_product SD RPC + column-grant revoke
--                   for value-bearing columns
--
-- Closes the loop opened by TestStocksDirectUpdate_AsAuthenticated_Fails
-- (approvals_test.go:1289) — the test that expects direct UPDATE stocks.price
-- to fail with "permission denied" when the caller is `authenticated`. Prior
-- state: authenticated had column-level UPDATE grants on every column
-- including price / harga_modal / stock_atas / stock_bawah / price_grosir,
-- so the direct UPDATE succeeded.
--
-- DESIGN
--
-- Client-side stocks mutations that touch value-bearing columns are moved
-- to a single SECURITY DEFINER RPC gated on Owner + Staff Admin Toko role:
--
--   admin_upsert_product(p_input jsonb, p_actor_user_id uuid DEFAULT NULL)
--
-- INSERT-or-UPDATE via `ON CONFLICT (sku) DO UPDATE`. Accepts a jsonb
-- payload so callers can supply any subset of columns; missing fields use
-- COALESCE with existing values on update (preserves current partial-update
-- semantics of client `.upsert()`).
--
-- Callers migrated in this PR:
--   src/lib/supabaseClient.ts:
--     - productService.upsertProduct       (line ~1242 — ProductForm save)
--     - stockService.bulkUpsert            (line ~1220 — CSV bulk upload)
--     - stockService.updateHargaModal      (line ~1200 — inline HM edit)
--   src/lib/products/productWrappers.ts:
--     - insertNewProduct                   (line 24  — wizard inline create)
--   src/components/pembelian/bnl/SkuPickerWithInlineCreate.tsx:
--     - handleCreate                       (line 34 — BNL inline create)
--
-- Two client sites are NOT migrated because they don't touch protected
-- columns and so remain safe under the column-grant revoke:
--   src/lib/supabaseClient.ts:
--     - `.update({name, category, status, specs, updated_at})` at ~line 157
--     - `.delete()` at ~line 179 (DELETE grant retained — separate follow-up
--       if we want to force delete through an RPC too)
--
-- The revoke is targeted at value-bearing columns only. Column-level UPDATE
-- grants remain for the safe columns (name / category / subcategory / brand
-- / unit / status / specs / description / photo_urls / min_stock_per_product
-- / initial_stock_approved / updated_at) so the .update({name...}) path at
-- supabaseClient.ts:157 continues to work.

-- ────────────────────────────────────────────────────────────────────────
-- 1. admin_upsert_product SD RPC
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_upsert_product(
  p_input          jsonb,
  p_actor_user_id  uuid DEFAULT NULL
)
RETURNS public.stocks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  uuid := COALESCE(p_actor_user_id, auth.uid());
  v_role   text;
  v_sku    text;
  v_row    public.stocks;
BEGIN
  -- Role gate
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'admin_upsert_product requires auth.uid() or p_actor_user_id';
  END IF;
  SELECT role INTO v_role FROM public.admin_users WHERE id = v_actor;
  IF v_role NOT IN ('Owner', 'Staff Admin Toko') THEN
    RAISE EXCEPTION 'admin_upsert_product requires Owner or Staff Admin Toko role (actor=% role=%)',
      v_actor, COALESCE(v_role, '<missing>');
  END IF;

  -- Auto-generate SKU when not supplied (matches insertNewProduct behavior).
  v_sku := COALESCE(NULLIF(p_input->>'sku', ''), substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.stocks (
    sku, name, category, subcategory, brand, unit, unit_alt, unit_alt_factor,
    price, price_grosir, harga_modal, stock, stock_atas, stock_bawah, status,
    specs, description, min_stock_per_product, photo_urls,
    initial_stock_approved, updated_at
  )
  VALUES (
    v_sku,
    p_input->>'name',
    p_input->>'category',
    NULLIF(p_input->>'subcategory',''),
    NULLIF(p_input->>'brand',''),
    COALESCE(NULLIF(p_input->>'unit',''), 'pcs'),
    NULLIF(p_input->>'unit_alt',''),
    NULLIF(p_input->>'unit_alt_factor','')::int,
    NULLIF(p_input->>'price','')::numeric,
    NULLIF(p_input->>'price_grosir','')::numeric,
    NULLIF(p_input->>'harga_modal','')::numeric,
    COALESCE(NULLIF(p_input->>'stock','')::int, 0),
    COALESCE(NULLIF(p_input->>'stock_atas','')::int, 0),
    COALESCE(NULLIF(p_input->>'stock_bawah','')::int, 0),
    COALESCE(NULLIF(p_input->>'status',''), 'Sinkron'),
    COALESCE(p_input->'specs', '{}'::jsonb),
    NULLIF(p_input->>'description',''),
    NULLIF(p_input->>'min_stock_per_product','')::int,
    COALESCE(p_input->'photo_urls', '[]'::jsonb),
    COALESCE(NULLIF(p_input->>'initial_stock_approved','')::bool, true),
    now()
  )
  ON CONFLICT (sku) DO UPDATE SET
    name                     = COALESCE(EXCLUDED.name,                     public.stocks.name),
    category                 = COALESCE(EXCLUDED.category,                 public.stocks.category),
    subcategory              = COALESCE(EXCLUDED.subcategory,              public.stocks.subcategory),
    brand                    = COALESCE(EXCLUDED.brand,                    public.stocks.brand),
    unit                     = COALESCE(EXCLUDED.unit,                     public.stocks.unit),
    unit_alt                 = COALESCE(EXCLUDED.unit_alt,                 public.stocks.unit_alt),
    unit_alt_factor          = COALESCE(EXCLUDED.unit_alt_factor,          public.stocks.unit_alt_factor),
    price                    = COALESCE(EXCLUDED.price,                    public.stocks.price),
    price_grosir             = COALESCE(EXCLUDED.price_grosir,             public.stocks.price_grosir),
    harga_modal              = COALESCE(EXCLUDED.harga_modal,              public.stocks.harga_modal),
    status                   = COALESCE(EXCLUDED.status,                   public.stocks.status),
    specs                    = COALESCE(EXCLUDED.specs,                    public.stocks.specs),
    description              = COALESCE(EXCLUDED.description,              public.stocks.description),
    min_stock_per_product    = COALESCE(EXCLUDED.min_stock_per_product,    public.stocks.min_stock_per_product),
    photo_urls               = COALESCE(EXCLUDED.photo_urls,               public.stocks.photo_urls),
    initial_stock_approved   = COALESCE(EXCLUDED.initial_stock_approved,   public.stocks.initial_stock_approved),
    -- Note: stock_atas / stock_bawah / stock intentionally NOT updated on
    -- conflict. Master stock qty flows through the ledger (decrement_stock,
    -- seed_stock_row, opname RPCs), never via the product-details upsert.
    updated_at               = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_product(jsonb, uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 2. REVOKE column-level UPDATE grants for value-bearing columns
-- ────────────────────────────────────────────────────────────────────────
-- Anon and authenticated can no longer directly UPDATE these columns via
-- PostgREST. All updates route through admin_upsert_product (or existing
-- approval-flow RPCs like commit_approved_price_change / commit_opname /
-- receive_purchase_order / decrement_stock / etc., which run as postgres
-- owner and bypass grants).
--
-- Safe columns (name, category, subcategory, brand, unit, unit_alt,
-- unit_alt_factor, status, specs, description, photo_urls,
-- min_stock_per_product, initial_stock_approved, updated_at) keep their
-- UPDATE grants — supabaseClient.ts:157 `.update({name, category, status,
-- specs, updated_at})` continues to work.

-- Postgres privilege gotcha: a table-level UPDATE grant coexists with (does
-- not narrow via) column-level REVOKE. If we only column-REVOKE, the
-- REVOKEs are toothless. Same gotcha migration 20260607000017 originally
-- solved with REVOKE-then-column-GRANT; that dance was undone by a later
-- broad `GRANT UPDATE ON stocks TO authenticated`. Redoing surgically:

REVOKE UPDATE ON public.stocks FROM PUBLIC, anon, authenticated;

GRANT UPDATE (
  name, category, subcategory, brand, unit, unit_alt, unit_alt_factor,
  status, specs, description, min_stock_per_product, photo_urls,
  initial_stock_approved, updated_at
) ON public.stocks TO authenticated;

GRANT UPDATE (
  name, category, status, specs, updated_at
) ON public.stocks TO anon;

-- ────────────────────────────────────────────────────────────────────────
-- 3. What this migration does NOT do (documented follow-ups)
-- ────────────────────────────────────────────────────────────────────────
--
-- - REVOKE INSERT + DELETE from anon, authenticated: kept until all client
--   INSERT/DELETE paths are migrated. INSERT sites are already migrated
--   in the same PR (productWrappers + SkuPickerWithInlineCreate now use
--   admin_upsert_product); DELETE (supabaseClient.ts:179 productService
--   .deleteProduct) is not migrated in this PR. Follow-up: create
--   admin_delete_product RPC + REVOKE DELETE grant.
--
-- - Split admin_upsert_product into insert-only vs update-only variants:
--   a single upsert RPC keeps the call sites simple. If we ever need
--   different role gates for create vs edit, we split then.
--
-- - Sub-Project A tenant_id filter: the INSERT / DO UPDATE does not set
--   tenant_id on stocks (column doesn't exist yet). When Sub-Project A
--   ships, extend admin_upsert_product to set tenant_id from
--   public.current_tenant_id() on INSERT.
