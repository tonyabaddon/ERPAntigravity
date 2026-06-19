# `record_pi` LUNAS-at-create Synthesize Pembayaran — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Critical #5 from the end-to-end code review — every LUNAS Tagihan must have a `pembayaran` + `pembayaran_items` row so downstream reports (cash-flow, payment-method, void-reversal) work uniformly regardless of whether the Tagihan was created via two-step (`record_pi` BELUM_LUNAS → `record_pembayaran`) or via the one-click "Bayar Sekarang" shortcut.

**Architecture:** Single CREATE OR REPLACE FUNCTION migration that rewrites `record_pi`'s LUNAS branch to inline-insert a `pembayaran` row + `pembayaran_items(tagihan_id, amount)` link, then call the existing `_recompute_tagihan_status` to flip the Tagihan to LUNAS via sum-of-truth. The kasir expense row moves from "tied to TGH" to "tied to PMB" with a `(otomatis dari TGH <pi_number>)` suffix for ledger traceability. The new migration also bundles the over-receive guard from `20260628000003` (last-writer-wins) so the two are deploy-order-independent. No schema change, no frontend change, no data backfill (prod scan confirmed zero orphans).

**Tech Stack:** Postgres (Supabase) plpgsql RPC, `_recompute_tagihan_status` (existing sum-of-truth helper), vitest integration tests against live Supabase REST API.

**Spec reference:** `docs/superpowers/specs/2026-06-19-record-pi-lunas-synthesize-pembayaran-design.md`

---

## File Structure

| File | Role |
|---|---|
| `supabase/migrations/20260628000004_record_pi_lunas_synthesize_pembayaran.sql` | NEW. Single CREATE OR REPLACE FUNCTION wrapping the new `record_pi` body. Bundles over-receive guard from `_003`. |
| `tests/integration/tagihan-stock-rpcs.test.ts` | MODIFY. Append new test case asserting LUNAS shortcut creates pembayaran + pembayaran_items + LUNAS Tagihan + auto kasir row with "otomatis dari" description. |
| `tests/integration/pembayaran-rpcs.test.ts` | MODIFY. Append new test case asserting `void_pembayaran` on a synthesized Pembayaran reverses the Tagihan to BELUM_LUNAS. |
| `progress.md` | MODIFY. Append entry summarising the fix. |

No other files. No frontend code touched. No schema changes (only RPC body replaced).

---

## Pre-Flight

### Task 0: Verify branch + worktree state

**Files:** none

- [ ] **Step 1: Confirm working in the right worktree**

Run: `git -C .claude/worktrees/code-review-fixes status --short && git -C .claude/worktrees/code-review-fixes log --oneline -3`

Expected: branch `fix/code-review-critical`, tip is the spec commit (`9992553 docs(specs): record_pi LUNAS-at-create synthesize pembayaran`), no uncommitted changes.

If the branch is wrong or the worktree is dirty, stop and resolve before continuing. All work for this plan happens in `.claude/worktrees/code-review-fixes/`.

- [ ] **Step 2: Re-confirm zero orphan LUNAS Tagihans in prod**

Re-run the scan to make sure nothing happened between spec write and implementation that would require a backfill:

```sql
SELECT
  COUNT(*) FILTER (WHERE pi.status = 'LUNAS' AND NOT EXISTS (
    SELECT 1 FROM pembayaran_items pti WHERE pti.tagihan_id = pi.id
  )) AS lunas_without_pembayaran
FROM purchase_invoices pi
WHERE pi.voided_at IS NULL;
```

Run via Supabase MCP `execute_sql` with `project_id = ekhhojaezdfjfwuxyjkl`.

Expected: `lunas_without_pembayaran: 0`.

If non-zero, STOP. Either backfill those rows first (one-shot SQL to synthesize a Pembayaran for each orphan) or add a backfill section to this plan.

---

## Task 1: Write the failing integration test for LUNAS synthesis

**Files:**
- Modify: `tests/integration/tagihan-stock-rpcs.test.ts` (append a new `describe` block at end of file, before the final closing `});` if there is one)

- [ ] **Step 1: Open the existing test file and read it**

Run: `cat tests/integration/tagihan-stock-rpcs.test.ts`

Expected: file with `beforeAll` setting up `supplierId`, `sku`, `pesananId`, `pesananItemId` and a `describe('record_pi type=STOCK', () => { ... })` block with 3 tests.

The new test will reuse those same fixtures. Append a new test inside the same `describe` block.

- [ ] **Step 2: Add the new test case**

Locate the closing `});` of the `describe('record_pi type=STOCK', () => { ... })` block (currently around line 48). INSERT the new test BEFORE that closing `});`:

```ts
  test('initial_status=LUNAS synthesizes pembayaran + pembayaran_items + flips Tagihan to LUNAS', async () => {
    // Use a separate Pesanan so we don't interfere with state from earlier tests
    // in this file (which already partially-receive against pesananItemId).
    const { data: psn2 } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'ORDERED',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 7777 }] },
    });
    const psn2Id = (psn2 as any).pesanan_id;
    const { data: items2 } = await sb.from('pesanan_items').select('id').eq('pesanan_id', psn2Id);
    const pesananItem2Id = items2![0].id;

    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        type: 'STOCK',
        supplier_id: supplierId,
        pesanan_id: psn2Id,
        payment_method: 'TRANSFER',
        initial_status: 'LUNAS',
        notes: 'integration test LUNAS shortcut',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 7777, sell_price: 0, pesanan_item_id: pesananItem2Id }],
      },
    });
    expect(error).toBeNull();
    const tagihanId = (data as any).pi_id;

    // Tagihan flipped to LUNAS via _recompute_tagihan_status (sum-of-truth)
    const { data: t } = await sb.from('purchase_invoices')
      .select('status, paid_amount, paid_at')
      .eq('id', tagihanId).single();
    expect(t!.status).toBe('LUNAS');
    expect(Number(t!.paid_amount)).toBe(7777);
    expect(t!.paid_at).not.toBeNull();

    // Exactly one pembayaran_items row links to this Tagihan with full amount
    const { data: pi_items } = await sb.from('pembayaran_items')
      .select('amount, pembayaran_id')
      .eq('tagihan_id', tagihanId);
    expect(pi_items).toHaveLength(1);
    expect(Number(pi_items![0].amount)).toBe(7777);

    // Synthesized Pembayaran row exists with the right shape; account_id intentionally NULL
    const { data: pmb } = await sb.from('pembayaran')
      .select('pembayaran_number, supplier_id, account_id, account_label, amount_total, payment_method, status')
      .eq('id', pi_items![0].pembayaran_id).single();
    expect(pmb!.supplier_id).toBe(supplierId);
    expect(pmb!.account_id).toBeNull();
    expect(pmb!.account_label).toBeNull();
    expect(Number(pmb!.amount_total)).toBe(7777);
    expect(pmb!.payment_method).toBe('TRANSFER');
    expect(pmb!.status).toBe('LUNAS');
    expect(pmb!.pembayaran_number).toMatch(/^PMB-\d{4}-\d{2}-\d{3}$/);

    // Exactly one kasir expense row references the synthesized PMB and includes the "otomatis dari" suffix
    const { data: kasir } = await sb.from('kasir_transactions')
      .select('description, expense_category, subtotal')
      .like('description', `%${pmb!.pembayaran_number}%`);
    expect(kasir).toHaveLength(1);
    expect(kasir![0].description).toContain('otomatis dari TGH');
    expect(kasir![0].expense_category).toBe('Pembelian Stok');
    expect(Number(kasir![0].subtotal)).toBe(7777);
  });
```

- [ ] **Step 3: Run the new test to verify it FAILS against current prod RPC**

Run:
```bash
SUPABASE_URL=<staging-or-prod-url> SUPABASE_SERVICE_KEY=<service-key> \
  npx vitest run tests/integration/tagihan-stock-rpcs.test.ts -t "initial_status=LUNAS synthesizes" --no-file-parallelism
```

Expected: TEST FAILS. The current production `record_pi` (migration `20260620000023`) writes `paid_amount` directly without creating `pembayaran`/`pembayaran_items`, so the assertion `expect(pi_items).toHaveLength(1)` will fail with `received: 0`. This is the RED phase of TDD — proves the test actually exercises the bug.

If the test passes against current prod: something is wrong with the test setup or someone already deployed a fix. Stop and investigate before continuing.

---

## Task 2: Write the migration

**Files:**
- Create: `supabase/migrations/20260628000004_record_pi_lunas_synthesize_pembayaran.sql`

- [ ] **Step 1: Read the current `record_pi` source-of-truth body**

Run: `cat supabase/migrations/20260620000023_record_pi_cast_kasir_enum.sql`

Then: `cat supabase/migrations/20260628000003_pesanan_items_overreceive_guard.sql`

Confirm the two bodies you need to merge: `_023` is the LUNAS shortcut you're rewriting; `_003` adds the FOR UPDATE + delta validation that needs to be preserved (bundled into the new migration per spec decision).

- [ ] **Step 2: Write the new migration file**

Create `supabase/migrations/20260628000004_record_pi_lunas_synthesize_pembayaran.sql` with:

```sql
-- 20260628000004_record_pi_lunas_synthesize_pembayaran.sql
--
-- Closes Critical #5 from the end-to-end code review (see
-- docs/superpowers/specs/2026-06-19-record-pi-lunas-synthesize-pembayaran-design.md
-- and progress.md 2026-06-19 entry).
--
-- BEFORE this migration, record_pi's LUNAS branch wrote:
--   purchase_invoices.paid_amount = subtotal     (denormalised, no audit trail)
--   purchase_invoices.status = 'LUNAS'           (set directly, not via sum-of-truth)
--   kasir_transactions (description tied to TGH, no PMB reference)
-- and crucially, NO pembayaran / pembayaran_items rows. Every consumer that
-- joins through pembayaran_items (cash-flow forecasts, payment-method
-- breakdowns, void-reversal accounting, per-account reconciliation) silently
-- skipped LUNAS-at-create Tagihans.
--
-- AFTER this migration, the LUNAS branch:
--   1. Inserts the Tagihan as BELUM_LUNAS with paid_amount=0
--   2. Generates a pembayaran_number via generate_pembayaran_number()
--   3. INSERTs a pembayaran row (account_id NULL since TagihanFormPage doesn't
--      capture one today; can be added later via Approach C upgrade)
--   4. INSERTs the pembayaran_items link
--   5. Calls _recompute_tagihan_status to flip the Tagihan to LUNAS via the
--      same sum-of-truth path that record_pembayaran/void_pembayaran use
--   6. INSERTs a single kasir expense row tied to the Pembayaran, with
--      description suffix '(otomatis dari TGH <pi_number>)' so the operator
--      can trace synthesized rows in the ledger
--
-- This migration also BUNDLES the over-receive guard from 20260628000003
-- (FOR UPDATE on pesanan_items + delta validation). Reason: CREATE OR
-- REPLACE FUNCTION is last-writer-wins, so the new body must be a complete
-- superset to remain deploy-order-independent.
--
-- No data backfill needed: prod scan 2026-06-19 returned 0 orphan LUNAS
-- Tagihans (all 4 historical LUNAS rows came from migration 010 backfill
-- and already have pembayaran_items links).

BEGIN;

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_type text;
  v_pi_number text;
  v_pi_id uuid;
  v_supplier_id uuid;
  v_order_id uuid;
  v_pesanan_id uuid;
  v_supplier_invoice_number text;
  v_ignore_dup boolean;
  v_existing_pi text;
  v_initial_status text;
  v_payment_due_at date;
  v_paid_at timestamptz;
  v_subtotal numeric := 0;
  v_supplier_name text;
  v_ref_label text;
  v_item jsonb;
  v_pesanan_item_id uuid;
  v_sku varchar;
  v_qty int;
  v_unit_cost numeric;
  v_warehouse_id uuid;
  v_pi_qty_ordered int;
  v_pi_qty_received int;
  v_pembayaran_id uuid;
  v_pembayaran_number text;
BEGIN
  v_type := COALESCE(payload->>'type', 'PASSTHROUGH');
  v_supplier_id := (payload->>'supplier_id')::uuid;
  v_supplier_invoice_number := payload->>'supplier_invoice_number';
  v_ignore_dup := COALESCE((payload->>'ignore_duplicate_warning')::boolean, false);
  v_initial_status := COALESCE(payload->>'initial_status', 'BELUM_LUNAS');

  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required';
  END IF;

  IF v_type = 'PASSTHROUGH' THEN
    v_order_id := (payload->>'order_id')::uuid;
    IF v_order_id IS NULL THEN RAISE EXCEPTION 'order_id required for PASSTHROUGH'; END IF;
  ELSIF v_type = 'STOCK' THEN
    v_pesanan_id := (payload->>'pesanan_id')::uuid;
    IF v_pesanan_id IS NULL THEN
      RAISE EXCEPTION 'pesanan_id required for type=STOCK. Buat Pesanan dulu, atau pakai Belanja Numpang Lewat untuk pass-through customer.';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid type: %', v_type;
  END IF;

  IF v_supplier_invoice_number IS NOT NULL AND NOT v_ignore_dup THEN
    SELECT pi_number INTO v_existing_pi FROM public.purchase_invoices
    WHERE supplier_id = v_supplier_id
      AND supplier_invoice_number = v_supplier_invoice_number
      AND voided_at IS NULL LIMIT 1;
    IF v_existing_pi IS NOT NULL THEN
      RETURN jsonb_build_object('warning','duplicate_supplier_invoice','existing_pi',v_existing_pi);
    END IF;
  END IF;

  v_pi_number := public.generate_pi_number();

  -- payment_due_at is only required when the Tagihan starts BELUM_LUNAS.
  -- For LUNAS-at-create, payment is happening *now*, so no due date matters.
  IF v_initial_status = 'LUNAS' THEN
    v_paid_at := now();
  ELSE
    v_payment_due_at := (payload->>'payment_due_at')::date;
    IF v_payment_due_at IS NULL THEN
      RAISE EXCEPTION 'payment_due_at required for BELUM_LUNAS';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;

  -- ALWAYS insert the Tagihan as BELUM_LUNAS with paid_amount=0. If
  -- initial_status='LUNAS', we flip it to LUNAS via _recompute_tagihan_status
  -- AFTER inserting the synthesized pembayaran_items row. This keeps a single
  -- code path for the LUNAS state machine (sum-of-truth), regardless of
  -- whether the Pembayaran was created here or via record_pembayaran later.
  INSERT INTO public.purchase_invoices (
    pi_number, type, supplier_id, order_id, pesanan_id, purchase_date,
    supplier_invoice_number, supplier_invoice_photo_url,
    payment_method, payment_due_at, paid_at, payment_proof_url,
    subtotal, total, status, paid_amount, notes, created_by_user_id
  ) VALUES (
    v_pi_number, v_type, v_supplier_id, v_order_id, v_pesanan_id,
    COALESCE((payload->>'purchase_date')::date, CURRENT_DATE),
    v_supplier_invoice_number,
    payload->>'supplier_invoice_photo_url',
    payload->>'payment_method',
    v_payment_due_at, NULL, payload->>'payment_proof_url',
    v_subtotal, v_subtotal, 'BELUM_LUNAS', 0,
    payload->>'notes', auth.uid()
  ) RETURNING id INTO v_pi_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_sku := v_item->>'sku';
    v_qty := (v_item->>'qty')::int;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    v_pesanan_item_id := NULLIF(v_item->>'pesanan_item_id','')::uuid;
    v_warehouse_id := NULLIF(v_item->>'warehouse_id','')::uuid;

    INSERT INTO public.purchase_invoice_items (
      pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal, pesanan_item_id
    ) VALUES (
      v_pi_id, v_sku, v_item->>'product_name',
      v_qty, v_unit_cost, (v_item->>'sell_price')::numeric,
      v_qty * v_unit_cost, v_pesanan_item_id
    );

    IF v_type = 'STOCK' THEN
      -- Over-receive guard (bundled from 20260628000003). Lock + delta-validate
      -- BEFORE mutating any side-effects so two concurrent Tagihan submissions
      -- for the same pesanan_item_id serialize correctly.
      IF v_pesanan_item_id IS NOT NULL THEN
        SELECT qty, qty_received_total
          INTO v_pi_qty_ordered, v_pi_qty_received
          FROM public.pesanan_items
         WHERE id = v_pesanan_item_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'PESANAN_ITEM_NOT_FOUND: %', v_pesanan_item_id;
        END IF;
        IF v_pi_qty_received + v_qty > v_pi_qty_ordered THEN
          RAISE EXCEPTION 'OVER_RECEIVE: sku=% pesanan_item=% qty_ordered=% qty_already_received=% qty_in_this_tagihan=% (would exceed by %)',
            v_sku, v_pesanan_item_id,
            v_pi_qty_ordered, v_pi_qty_received, v_qty,
            (v_pi_qty_received + v_qty) - v_pi_qty_ordered;
        END IF;
      END IF;

      INSERT INTO public.stock_lots (sku, source_id, source_type, unit_cost, qty_received, qty_remaining, received_at)
      VALUES (v_sku, v_pi_id, 'TAGIHAN', v_unit_cost, v_qty, v_qty, now());

      IF v_warehouse_id IS NOT NULL THEN
        INSERT INTO public.stock_levels (sku, warehouse_id, qty)
        VALUES (v_sku, v_warehouse_id, v_qty)
        ON CONFLICT (sku, warehouse_id) DO UPDATE
          SET qty = stock_levels.qty + EXCLUDED.qty;
      END IF;

      IF v_pesanan_item_id IS NOT NULL THEN
        UPDATE public.pesanan_items SET qty_received_total = qty_received_total + v_qty
        WHERE id = v_pesanan_item_id;
      END IF;
    END IF;
  END LOOP;

  IF v_type = 'STOCK' AND v_pesanan_id IS NOT NULL THEN
    PERFORM public.set_pesanan_closed_if_fulfilled(v_pesanan_id);
  END IF;

  -- LUNAS-at-create: synthesize a Pembayaran + pembayaran_items + kasir row.
  -- All in the same transaction as the Tagihan INSERT above; if any step
  -- fails the entire record_pi call rolls back.
  IF v_initial_status = 'LUNAS' THEN
    v_pembayaran_number := public.generate_pembayaran_number();

    INSERT INTO public.pembayaran (
      pembayaran_number, supplier_id, paid_at, payment_method,
      account_id, account_label,
      amount_total, discount_amount, proof_url, notes, created_by_user_id
    ) VALUES (
      v_pembayaran_number, v_supplier_id, v_paid_at, payload->>'payment_method',
      NULL, NULL,
      v_subtotal, 0, payload->>'payment_proof_url', payload->>'notes', auth.uid()
    ) RETURNING id INTO v_pembayaran_id;

    INSERT INTO public.pembayaran_items (pembayaran_id, tagihan_id, tukar_faktur_id, amount)
    VALUES (v_pembayaran_id, v_pi_id, NULL, v_subtotal);

    -- Sum-of-truth: this flips purchase_invoices to LUNAS, sets paid_amount,
    -- sets paid_at. Same call record_pembayaran and void_pembayaran use.
    PERFORM public._recompute_tagihan_status(v_pi_id);

    -- Kasir expense row tied to the synthesized PMB. Description suffix
    -- '(otomatis dari TGH <pi_number>)' tells the operator this came from
    -- the one-click LUNAS shortcut rather than a manual Pembayaran entry.
    SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
    INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
    VALUES (
      'expense',
      (v_paid_at AT TIME ZONE 'Asia/Jakarta')::date,
      (CASE v_type WHEN 'STOCK' THEN 'Pembelian Stok' ELSE 'Pembelian Pass-Through' END)::public.kasir_expense_category,
      'Pembayaran ' || v_pembayaran_number || ' — ' || COALESCE(v_supplier_name,'')
        || ' (otomatis dari TGH ' || v_pi_number || ')',
      v_subtotal,
      0
    );
  END IF;

  RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
END;
$$;

COMMIT;
```

- [ ] **Step 3: Sanity-check the migration file syntactically**

Run: `wc -l supabase/migrations/20260628000004_record_pi_lunas_synthesize_pembayaran.sql`

Expected: ~180 lines. If it's much shorter, your editor truncated; re-write.

Run: `grep -c "^BEGIN;\|^COMMIT;" supabase/migrations/20260628000004_record_pi_lunas_synthesize_pembayaran.sql`

Expected: `2` (one BEGIN, one COMMIT).

Run: `grep -c "CREATE OR REPLACE FUNCTION public.record_pi" supabase/migrations/20260628000004_record_pi_lunas_synthesize_pembayaran.sql`

Expected: `1`.

---

## Task 3: Apply migration to live Supabase

**Files:** none

- [ ] **Step 1: Apply via Supabase MCP**

Use the MCP tool `mcp__plugin_supabase_supabase__apply_migration`:

```
project_id: ekhhojaezdfjfwuxyjkl
name: 20260628000004_record_pi_lunas_synthesize_pembayaran
query: <paste the full SQL body, without BEGIN/COMMIT — the MCP tool wraps in a transaction>
```

Note: if the MCP wraps in a transaction itself, drop the `BEGIN;`/`COMMIT;` from the body passed in. Otherwise paste verbatim.

Expected: success response. The MCP returns the migration row id; the function is replaced atomically.

If you do not have MCP access, request the user to apply via Supabase Studio SQL editor or via `apply-pending-migrations.sh`.

- [ ] **Step 2: Verify the function body actually changed**

Run via MCP `execute_sql`:

```sql
SELECT pg_get_functiondef('public.record_pi(jsonb)'::regprocedure);
```

Expected: the returned function body contains the literal string `otomatis dari TGH`. If it doesn't, the migration didn't apply — re-check.

---

## Task 4: Re-run the LUNAS test — expect PASS

**Files:** none

- [ ] **Step 1: Run the test again**

Run:
```bash
SUPABASE_URL=<staging-or-prod-url> SUPABASE_SERVICE_KEY=<service-key> \
  npx vitest run tests/integration/tagihan-stock-rpcs.test.ts -t "initial_status=LUNAS synthesizes" --no-file-parallelism
```

Expected: TEST PASSES. All four assertion groups (Tagihan flipped to LUNAS, pembayaran_items count + amount, Pembayaran row shape with NULL account_id, kasir row with "otomatis dari TGH" suffix) succeed.

If it still fails, the migration didn't apply OR the test setup has a bug. Diff the function body via `pg_get_functiondef` vs the migration file and resolve.

- [ ] **Step 2: Run the existing tests in the same file too, to confirm no regression**

Run:
```bash
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  npx vitest run tests/integration/tagihan-stock-rpcs.test.ts --no-file-parallelism
```

Expected: all 4 tests in the file (3 existing + 1 new) pass. The 3 existing tests target the BELUM_LUNAS path which is unchanged — they should still pass.

---

## Task 5: Write the void-reversal test

**Files:**
- Modify: `tests/integration/pembayaran-rpcs.test.ts` (append new test at end of `describe('record_pembayaran', () => { ... })` block)

- [ ] **Step 1: Open the file and locate the closing `});` of the `describe` block**

Run: `cat tests/integration/pembayaran-rpcs.test.ts`

Expected: file with `beforeAll` creating `supplierId, tagihanId, tagihanTotal` and a `describe('record_pembayaran', () => { ... })` block with 3 tests.

- [ ] **Step 2: Insert the new test BEFORE the closing `});` of the `describe`**

```ts
  test('void_pembayaran on synthesized (LUNAS-shortcut) Pembayaran reverses Tagihan to BELUM_LUNAS', async () => {
    // Create a Tagihan via LUNAS shortcut — this synthesizes a Pembayaran inline
    const sku2 = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
    const { data: psn3 } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'ORDERED',
        items: [{ sku: sku2, product_name: 'X', qty: 1, unit_cost: 3333 }] },
    });
    const psn3Id = (psn3 as any).pesanan_id;
    const { data: items3 } = await sb.from('pesanan_items').select('id').eq('pesanan_id', psn3Id);
    const { data: tgh } = await sb.rpc('record_pi', {
      payload: {
        type: 'STOCK',
        supplier_id: supplierId,
        pesanan_id: psn3Id,
        payment_method: 'CASH',
        initial_status: 'LUNAS',
        items: [{ sku: sku2, product_name: 'X', qty: 1, unit_cost: 3333, sell_price: 0, pesanan_item_id: items3![0].id }],
      },
    });
    const synthTagihanId = (tgh as any).pi_id;

    // Look up the synthesized Pembayaran via the join
    const { data: link } = await sb.from('pembayaran_items')
      .select('pembayaran_id').eq('tagihan_id', synthTagihanId).single();
    const synthPmbId = link!.pembayaran_id;

    // Pre-void sanity
    const { data: tPre } = await sb.from('purchase_invoices').select('status, paid_amount').eq('id', synthTagihanId).single();
    expect(tPre!.status).toBe('LUNAS');
    expect(Number(tPre!.paid_amount)).toBe(3333);

    // Void it
    const { error: voidErr } = await sb.rpc('void_pembayaran', {
      p_pembayaran_id: synthPmbId,
      p_reason: 'integration test reversal of synthesized PMB',
    });
    expect(voidErr).toBeNull();

    // Tagihan back to BELUM_LUNAS, paid_amount=0
    const { data: tPost } = await sb.from('purchase_invoices').select('status, paid_amount').eq('id', synthTagihanId).single();
    expect(tPost!.status).toBe('BELUM_LUNAS');
    expect(Number(tPost!.paid_amount)).toBe(0);

    // Reverse kasir entry inserted (negative subtotal, description prefix 'VOID Pembayaran')
    const { data: pmb } = await sb.from('pembayaran').select('pembayaran_number').eq('id', synthPmbId).single();
    const { data: reverseKasir } = await sb.from('kasir_transactions')
      .select('subtotal, description')
      .like('description', `%VOID Pembayaran ${pmb!.pembayaran_number}%`);
    expect(reverseKasir).toHaveLength(1);
    expect(Number(reverseKasir![0].subtotal)).toBeLessThan(0);
  });
```

- [ ] **Step 3: Run the new test**

Run:
```bash
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  npx vitest run tests/integration/pembayaran-rpcs.test.ts -t "void_pembayaran on synthesized" --no-file-parallelism
```

Expected: PASS. The `void_pembayaran` RPC was unchanged — it iterates over `pembayaran_items` rows and calls `_recompute_tagihan_status` for each. Because the synthesized Pembayaran has a `pembayaran_items` row, the same reversal logic applies cleanly.

If it fails: most likely `void_pembayaran` is missing a step that the synthesized PMB needs. Read the failure carefully — the existing `void_pembayaran` should NOT need any change per the spec. If it does, surface as a follow-up; do not modify in this plan.

- [ ] **Step 4: Run all tests in `pembayaran-rpcs.test.ts` to confirm no regression**

Run:
```bash
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  npx vitest run tests/integration/pembayaran-rpcs.test.ts --no-file-parallelism
```

Expected: all 4 tests pass (3 existing + 1 new).

---

## Task 6: Update `progress.md`

**Files:**
- Modify: `progress.md` (insert new entry at the top, BEFORE the existing "2026-06-19 — Code-review hotfix batch" entry)

- [ ] **Step 1: Insert a new entry at the top of `progress.md`**

The file starts with `# ERP Antigravity — Implementation Progress` followed by `## 2026-06-19 — Code-review hotfix batch …`. Insert the new entry BETWEEN those two lines:

```markdown
## 2026-06-19 — Critical #5 fix: record_pi LUNAS-at-create now synthesizes pembayaran

Closes the silent-data-fork gap recorded in the end-to-end code review. Before this change `record_pi` with `initial_status='LUNAS'` wrote `purchase_invoices.paid_amount` directly + a kasir expense, but created no `pembayaran` / `pembayaran_items` row. Every report joining through `pembayaran_items` (cash-flow forecasts, payment-method breakdowns, void-reversal accounting, per-account reconciliation) silently skipped LUNAS-at-create Tagihans. Prod scan at the time of the fix found 0 orphan rows (all 4 historical LUNAS Tagihans had been created by the legacy-PO migration 010 which DID write pembayaran rows), so no backfill was needed — but the bug surface was live and reachable from the "Bayar Sekarang" radio in TagihanFormPage.

**Migration `20260628000004_record_pi_lunas_synthesize_pembayaran.sql`:** rewrites `record_pi` so the LUNAS branch always inserts the Tagihan as `BELUM_LUNAS` first, then generates a `pembayaran_number`, inserts `pembayaran` (with `account_id = NULL` — TagihanFormPage doesn't capture an account today; Approach C upgrade can add an `AccountPicker` later), inserts `pembayaran_items(tagihan_id, amount=subtotal)`, calls `_recompute_tagihan_status` (the same sum-of-truth helper `record_pembayaran` and `void_pembayaran` use) to flip the Tagihan to LUNAS, and inserts a single kasir expense row tied to the synthesized PMB with description suffix `(otomatis dari TGH <pi_number>)` for ledger traceability. All inserts run in the same transaction so any failure rolls back the entire `record_pi` call. The migration also bundles the over-receive guard from `20260628000003` per the spec's last-writer-wins decision — `_004`'s body is a complete superset, deploy-order-independent.

**Frontend: zero change.** The "Bayar Sekarang" radio in `TagihanFormPage.tsx` keeps single-click UX. RPC signature + return shape (`{ pi_number, pi_id }`) unchanged.

**Integration tests added:**
- `tests/integration/tagihan-stock-rpcs.test.ts` — `initial_status=LUNAS synthesizes pembayaran + pembayaran_items + flips Tagihan to LUNAS` (asserts every row shape including kasir description).
- `tests/integration/pembayaran-rpcs.test.ts` — `void_pembayaran on synthesized (LUNAS-shortcut) Pembayaran reverses Tagihan to BELUM_LUNAS` (proves void path works against synthesized rows with no change to `void_pembayaran`).

**Spec + plan:**
- `docs/superpowers/specs/2026-06-19-record-pi-lunas-synthesize-pembayaran-design.md`
- `docs/superpowers/plans/2026-06-19-record-pi-lunas-synthesize-pembayaran-plan.md`

**Deferred:** captures one of the open questions from the spec — add an `AccountPicker` to TagihanFormPage's LUNAS branch so synthesized Pembayarans can capture `account_id`. Will land as a separate UI-only PR if reports demand per-account reconciliation for shortcut payments.
```

- [ ] **Step 2: Verify the file still parses correctly**

Run: `head -10 progress.md`

Expected: starts with `# ERP Antigravity — Implementation Progress`, then a blank line, then `## 2026-06-19 — Critical #5 fix: …`, then the body.

---

## Task 7: Commit everything

**Files:**
- Modify (already staged in earlier steps, restage to be safe): `tests/integration/tagihan-stock-rpcs.test.ts`, `tests/integration/pembayaran-rpcs.test.ts`, `progress.md`
- Create (already staged): `supabase/migrations/20260628000004_record_pi_lunas_synthesize_pembayaran.sql`

- [ ] **Step 1: Stage the changes explicitly**

Run from worktree root (`.claude/worktrees/code-review-fixes`):

```bash
git add \
  supabase/migrations/20260628000004_record_pi_lunas_synthesize_pembayaran.sql \
  tests/integration/tagihan-stock-rpcs.test.ts \
  tests/integration/pembayaran-rpcs.test.ts \
  progress.md
git status --short
```

Expected output: 4 staged entries (M tagihan-stock-rpcs.test.ts, M pembayaran-rpcs.test.ts, M progress.md, A 20260628000004_record_pi_lunas_synthesize_pembayaran.sql), nothing else.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(critical-5): record_pi LUNAS-at-create now synthesizes pembayaran

Closes Critical #5 from the end-to-end code review. Before this change
record_pi with initial_status='LUNAS' wrote purchase_invoices.paid_amount
+ kasir row directly but created no pembayaran / pembayaran_items row.
Every report joining through pembayaran_items silently skipped LUNAS-at-
create Tagihans (cash-flow forecasts, payment-method breakdowns, void-
reversal accounting, per-account reconciliation).

Migration 20260628000004 rewrites record_pi's LUNAS branch to:
  1. Insert Tagihan as BELUM_LUNAS with paid_amount=0
  2. Generate pembayaran_number via generate_pembayaran_number()
  3. Insert pembayaran (account_id NULL — TagihanFormPage doesn't capture
     one today; Approach C upgrade can add an AccountPicker later)
  4. Insert pembayaran_items(tagihan_id, amount=subtotal)
  5. PERFORM _recompute_tagihan_status to flip Tagihan to LUNAS via the
     same sum-of-truth helper record_pembayaran/void_pembayaran use
  6. Insert single kasir expense tied to the synthesized PMB with
     description suffix '(otomatis dari TGH <pi_number>)' for ledger
     traceability

All inserts run in the same transaction so any failure rolls back the
entire record_pi call. Migration also bundles the over-receive guard
from 20260628000003 per the spec's last-writer-wins decision — _004's
body is a complete superset, deploy-order-independent.

Frontend: zero change. 'Bayar Sekarang' radio in TagihanFormPage keeps
single-click UX. RPC signature + return shape unchanged.

Integration tests added:
- tagihan-stock-rpcs.test.ts: 'initial_status=LUNAS synthesizes ...'
- pembayaran-rpcs.test.ts: 'void_pembayaran on synthesized ... reverses'

No data backfill: prod scan returned 0 orphan LUNAS Tagihans.

Spec:  docs/superpowers/specs/2026-06-19-record-pi-lunas-synthesize-pembayaran-design.md
Plan:  docs/superpowers/plans/2026-06-19-record-pi-lunas-synthesize-pembayaran-plan.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify the commit landed cleanly**

```bash
git log --oneline -3
git show --stat HEAD
```

Expected: top commit is `fix(critical-5): record_pi LUNAS-at-create now synthesizes pembayaran`; the previous two are `docs(specs): record_pi LUNAS-at-create synthesize pembayaran` and `fix(critical): 4 Critical findings from end-to-end code review`. The `git show --stat` should list the 4 expected paths.

---

## Task 8: Post-implementation smoke

**Files:** none

- [ ] **Step 1: Browser smoke (manual, against deployed frontend OR local dev)**

Open `https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/?screen=pembelian` (or local dev at `:3000/?screen=pembelian`).

1. Tabs: Pembelian → Pesanan → "Buat Pesanan" → fill supplier=GTA, sku=TEST-IMM, qty=1, unit_cost=4321 → save.
2. Open the newly-created Pesanan detail → "Mark Ordered".
3. "Buat Tagihan" from Pesanan detail → qty=1 (auto-filled) → supplier invoice number `BAYAR-SEKARANG-SMOKE-001` → **select "Bayar Sekarang" radio** (not "Bayar Nanti") → payment_method=TRANSFER → save.
4. **Pesanan list:** the Pesanan should be CLOSED (auto via `set_pesanan_closed_if_fulfilled`).
5. **Tagihan list:** the new Tagihan should show status `● Lunas`, paid_amount = total.
6. **Pembayaran list:** there should be a NEW Pembayaran row this minute, supplier=GTA, amount=4321. Click Detail.
7. **Pembayaran detail:** shows 1 linked Tagihan (the one you just created). Method=TRANSFER. account_label is empty/dash (expected — NULL).
8. **Kasir Harian (today):** the expense ledger has a row with description matching `Pembayaran PMB-2026-06-NNN — GTA (otomatis dari TGH PI-2026-06-NNN)`, subtotal=4321.

- [ ] **Step 2: Cleanup**

If you don't want the smoke artifacts in prod data, the smoke row is tagged via the supplier_invoice_number `BAYAR-SEKARANG-SMOKE-001`. Trace and delete in order: kasir row → pembayaran_items → pembayaran → purchase_invoice_items → purchase_invoices → pesanan_items → pesanan. Or just leave them in place — the `SMOKE-001` tag makes them easy to filter later. Supabase MCP `execute_sql` with `project_id=ekhhojaezdfjfwuxyjkl`.

- [ ] **Step 3: Push if not done yet**

The branch `fix/code-review-critical` is already pushed (from PR #36). This new commit just needs:

```bash
git push origin fix/code-review-critical
```

The PR #36 description should be edited to mention that Critical #5 was added in a follow-up commit, or this commit can move to a separate PR. Per the brainstorm decision, it's fine to keep them on the same branch — both fixes are bug fixes, both are atomic, the reviewer can review the spec + plan + impl together.

---

## Self-review checklist (run after writing the plan)

1. **Spec coverage:**
   - ✓ "Insert Tagihan as BELUM_LUNAS first" → Task 2 Step 2 (the INSERT clause uses 'BELUM_LUNAS', paid_amount=0 unconditionally).
   - ✓ "Generate pembayaran_number" → Task 2 Step 2 (`v_pembayaran_number := public.generate_pembayaran_number()`).
   - ✓ "Insert pembayaran with NULL account" → Task 2 Step 2.
   - ✓ "Insert pembayaran_items" → Task 2 Step 2.
   - ✓ "Call _recompute_tagihan_status" → Task 2 Step 2.
   - ✓ "Insert single kasir row with 'otomatis dari' suffix" → Task 2 Step 2.
   - ✓ "Bundle over-receive guard from _003" → Task 2 Step 2 (FOR UPDATE block preserved).
   - ✓ "STOCK + PASSTHROUGH both use synthesis" → Task 2 Step 2 (the LUNAS branch sits outside the STOCK-only `IF` and uses `CASE v_type` for expense_category).
   - ✓ "No backfill" → Task 0 Step 2 (verification only).
   - ✓ "No frontend change" → no task touches `src/`.
   - ✓ "Tests added" → Task 1 + Task 5.
   - ✓ "Deploy: re-scan, then apply" → Task 0 Step 2 + Task 3.

2. **Placeholder scan:** no TBDs, no "implement later", every step has exact commands or full code.

3. **Type consistency:** all function names (`generate_pembayaran_number`, `_recompute_tagihan_status`, `set_pesanan_closed_if_fulfilled`, `void_pembayaran`) are used identically across the spec, plan, and migration body. All column names checked against migrations `_001`/`_002`/`_006`.

4. **Ambiguity check:** the order of inserts (Tagihan first → over-receive guard if STOCK → pembayaran → pembayaran_items → _recompute_tagihan_status → kasir) is explicit in Task 2 Step 2. The LUNAS branch is OUTSIDE the STOCK-only `IF` so it applies to both type variants.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-06-19-record-pi-lunas-synthesize-pembayaran-plan.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (Tasks 1, 2, 3, 4, 5, 6, 7, 8 each as their own dispatch). I review between tasks. Fast iteration; main-thread context stays clean. Best when the plan has clean inter-task boundaries (this one does).

**2. Inline Execution** — Execute tasks in this session using `executing-plans`. Batch checkpoints between Task 4 (after migration applied + tests pass) and Task 7 (after commit). Keeps everything in one place; risks context bloat as test output accumulates.

Which approach?
