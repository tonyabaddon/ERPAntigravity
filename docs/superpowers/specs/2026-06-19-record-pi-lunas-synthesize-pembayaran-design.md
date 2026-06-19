# `record_pi` LUNAS-at-create: synthesize `pembayaran` row

**Date:** 2026-06-19
**Status:** Design — approved approach A (Synthesize inside `record_pi`), awaiting user spec review before implementation plan.
**Scope:** Critical #5 from the end-to-end code review (see `progress.md` 2026-06-19 entry and PR #36 description).

## Problem

`record_pi` (Phase 2a, last replaced in migration `20260620000023_record_pi_cast_kasir_enum.sql`) takes a `initial_status` parameter. When the caller passes `'LUNAS'`, it short-circuits the normal "Tagihan first, Pembayaran later" flow by writing the Tagihan as LUNAS directly:

```sql
INSERT INTO purchase_invoices (..., paid_amount = v_subtotal, status = 'LUNAS', paid_at = now(), ...);
-- and a kasir expense row tied to the Tagihan
INSERT INTO kasir_transactions (..., description = 'TGH ' || v_pi_number || ' — ' || ...);
```

No `pembayaran` row is created. No `pembayaran_items` link. The Tagihan's `paid_amount` is set as a literal denormalised value.

**Why this is broken:**

The `pembayaran` + `pembayaran_items` tables are the source-of-truth for actual cash movement out of the business. Every consumer that joins through them — cash-flow forecasts, payment-method breakdowns, void-reversal accounting, per-account reconciliation, supplier statement reconciliation — silently skips LUNAS-at-create Tagihans. The migration `20260620000010_phase2_migrate_po_data.sql` correctly created Pembayaran rows for *legacy* PAID purchase_orders. The shortcut in current `record_pi` *re-introduces* the same orphan-Pembayaran data shape for any new LUNAS-at-create call.

**Why nobody's noticed yet:**

Prod scan (2026-06-19) returned 4 LUNAS Tagihans, all 4 with a matching `pembayaran_items` row — every existing LUNAS came from the migration 010 backfill, none from the shortcut. The TagihanFormPage UI does expose the path (`Bayar Sekarang` radio → `initial_status='LUNAS'`) so it's reachable in production, just not yet exercised.

```sql
-- scan that confirmed zero orphans:
SELECT
  COUNT(*) FILTER (WHERE pi.status = 'LUNAS' AND NOT EXISTS (
    SELECT 1 FROM pembayaran_items pti WHERE pti.tagihan_id = pi.id
  )) AS lunas_without_pembayaran
FROM purchase_invoices pi
WHERE pi.voided_at IS NULL;
-- => 0
```

## Goal

Every LUNAS Tagihan — past, present, future — has a corresponding `pembayaran` row with a `pembayaran_items` link, regardless of whether it was paid via the two-step flow (normal `record_pembayaran`) or via the LUNAS shortcut in `record_pi`. All downstream reports work uniformly.

## Non-goals

- **No UX change.** "Bayar Sekarang" radio stays. Operator still clicks Save once.
- **No `account_id` capture.** TagihanFormPage doesn't currently ask which bank account paid; synthesized Pembayaran will leave `account_id` and `account_label` NULL. If reports later demand per-account reconciliation for shortcut payments, add an account picker to TagihanFormPage in a separate spec (Approach C from brainstorm).
- **No backfill migration.** Prod scan returned zero orphan LUNAS Tagihans.
- **No change to `record_pembayaran`, `void_pembayaran`, or `_recompute_tagihan_status`.** They already handle the LUNAS state correctly when given a `pembayaran_items` row; the shortcut just needs to feed them one.

## Approach: synthesize `pembayaran` + `pembayaran_items` atomically inside `record_pi`

Rewrite `record_pi`'s LUNAS branch so that instead of writing `paid_amount = v_subtotal` directly, it:

1. Inserts the Tagihan as `BELUM_LUNAS` with `paid_amount = 0`.
2. Generates a `pembayaran_number` via `generate_pembayaran_number()`.
3. Inserts the `pembayaran` row with `supplier_id`, `paid_at = now()`, `payment_method`, `amount_total = v_subtotal`, `proof_url`, `notes`, and `created_by_user_id = auth.uid()`. Leaves `account_id` and `account_label` NULL.
4. Inserts the `pembayaran_items` row (`pembayaran_id = v_pembayaran_id, tagihan_id = v_pi_id, amount = v_subtotal`).
5. Calls `_recompute_tagihan_status(v_pi_id)` — the sum-of-truth function used by `record_pembayaran` and `void_pembayaran`. It flips the Tagihan to LUNAS, sets `paid_amount` and `paid_at` based on the new `pembayaran_items` sum.
6. Inserts ONE kasir expense row tied to the Pembayaran (description format: `'Pembayaran <PMB-num> — <supplier> (otomatis dari TGH <pi_number>)'`). The kasir write previously tied to the Tagihan in this branch is removed.

All six steps run in the same transaction (the existing `BEGIN; … COMMIT;` wrapping `CREATE OR REPLACE FUNCTION` already provides this — `record_pi` is `LANGUAGE plpgsql`, which is implicitly transactional when called via `SELECT … rpc(...)`).

### Kasir description format (decided)

`'Pembayaran <PMB-num> — <supplier> (otomatis dari TGH <pi_number>)'`

Reasoning: operator audit clarity. Synthesized Pembayarans differ from manually-recorded ones in two visible ways — `account_id` is NULL, and the operator never visited the Pembayaran form. The "otomatis dari" suffix tells the ledger reader immediately which Tagihan triggered the auto-payment, so they can correlate without having to query `pembayaran_items`.

### Migration bundling (decided)

The new migration **bundles** the over-receive guard from `20260628000003` (PR #36) into its `CREATE OR REPLACE FUNCTION record_pi` body. Reasoning:

- Migrations apply in filename order, so `_003` always runs before `_004`. After `_004` runs, the function body is whatever `_004` defined — defining a complete superset means no dependency on `_003` having run "first as intended".
- If `_003` is ever rolled back manually (some future incident), `_004`'s body still has the FOR UPDATE + delta-validate guard. Defense in depth.
- Larger diff per file is a non-issue for review.

## Files changed

| File | Change |
|---|---|
| `supabase/migrations/20260628000004_record_pi_lunas_synthesize_pembayaran.sql` | New. `CREATE OR REPLACE FUNCTION record_pi` with the bundled over-receive guard + new LUNAS branch (synthesize Pembayaran). |
| `tests/integration/tagihan-stock-rpcs.test.ts` | Add test: `record_pi initial_status=LUNAS creates pembayaran + pembayaran_items + recomputes Tagihan to LUNAS`. |
| `tests/integration/pembayaran-rpcs.test.ts` | Add test: `void_pembayaran on a synthesized Pembayaran reverses Tagihan to BELUM_LUNAS`. |
| `progress.md` | Append summary entry. |
| `src/components/pembelian/tagihan/TagihanFormPage.tsx` | **No change.** Behavior preserved. |
| `src/lib/*.ts` | **No change.** No frontend service touches the LUNAS shortcut directly. |
| `pembayaran` / `pembayaran_items` / `purchase_invoices` schemas | **No change.** Only `record_pi` body rewritten. |

## Data flow

```
TagihanFormPage  ── click "Bayar Sekarang" + Save ──>  record_pi(initial_status='LUNAS', payment_method, proof_url, notes, ...)
                                                            │
                                                            ▼ (single transaction)
                                                       ┌─────────────────────────────────────┐
                                                       │ INSERT purchase_invoices            │
                                                       │   status='BELUM_LUNAS', paid_amount=0│
                                                       │ INSERT pembayaran                   │
                                                       │   amount_total = subtotal           │
                                                       │ INSERT pembayaran_items             │
                                                       │   tagihan_id, amount = subtotal     │
                                                       │ _recompute_tagihan_status           │
                                                       │   → flips PI to LUNAS, paid_amount  │
                                                       │ INSERT kasir_transactions           │
                                                       │   description = 'Pembayaran PMB-... │
                                                       │     — supplier (otomatis dari TGH ...)│
                                                       └─────────────────────────────────────┘
                                                            │
                                                            ▼
                                                       Returns { pi_number, pi_id }
                                                       (NOT pembayaran_id — caller doesn't need it,
                                                        keeps RPC return shape backward compatible)
```

## Error handling

- All inserts in the same transaction. Any failure rolls back everything — no partial state possible.
- `generate_pembayaran_number()` race is a known minor issue (reviewer's Important #11, deferred). Under MSME load, two concurrent LUNAS-at-create from the same admin in the same millisecond would collide on `UNIQUE(pembayaran_number)`. Caller sees Postgres duplicate-key error; retry succeeds. Acceptable.
- If the synthesized `pembayaran` insert fails for any other reason (e.g. `payment_method` constraint), the entire `record_pi` call fails — caller is told. Tagihan is NOT created (since both inserts are in the same txn).

## Backward compatibility

- RPC signature unchanged: `record_pi(payload jsonb) RETURNS jsonb`.
- Return shape unchanged: `{ pi_number, pi_id }` (plus the duplicate-warning early-return). Synthesized `pembayaran_id` is *not* returned — frontend doesn't need it (the LUNAS path stays on TagihanFormPage and doesn't navigate to PembayaranDetail).
- **BELUM_LUNAS path (STOCK and PASSTHROUGH): zero change.** Same code path, no Pembayaran synthesis, no kasir write. Tagihan starts BELUM_LUNAS and the operator records payment later via `record_pembayaran`.
- **LUNAS path applies to BOTH `type='STOCK'` and `type='PASSTHROUGH'`.** Both currently use the broken shortcut; both will synthesize a Pembayaran under the new design. The synthesized kasir row preserves the per-type `expense_category` enum (`'Pembelian Stok'` for STOCK, `'Pembelian Pass-Through'` for PASSTHROUGH) but uses the same "otomatis dari TGH" description suffix for both.

## Testing

### Integration tests (require live `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`)

1. `tests/integration/tagihan-stock-rpcs.test.ts`:
   ```
   test('record_pi initial_status=LUNAS creates pembayaran + pembayaran_items + LUNAS status', async () => {
     const { data } = await sb.rpc('record_pi', {
       payload: {
         type: 'STOCK',
         supplier_id, pesanan_id,
         payment_method: 'TRANSFER',
         initial_status: 'LUNAS',
         items: [{ sku, product_name: 'X', qty: 1, unit_cost: 1000, sell_price: 0, pesanan_item_id }],
       },
     });
     const tagihanId = (data as any).pi_id;

     // Tagihan is LUNAS via _recompute_tagihan_status
     const { data: t } = await sb.from('purchase_invoices').select('status, paid_amount').eq('id', tagihanId).single();
     expect(t!.status).toBe('LUNAS');
     expect(Number(t!.paid_amount)).toBe(1000);

     // Exactly one pembayaran_items row links to this Tagihan, with full amount
     const { data: items } = await sb.from('pembayaran_items').select('amount, pembayaran_id').eq('tagihan_id', tagihanId);
     expect(items).toHaveLength(1);
     expect(Number(items![0].amount)).toBe(1000);

     // Pembayaran row exists with the right shape, account_id intentionally NULL
     const { data: pmb } = await sb.from('pembayaran').select('*').eq('id', items![0].pembayaran_id).single();
     expect(pmb!.supplier_id).toBe(supplier_id);
     expect(pmb!.account_id).toBeNull();
     expect(Number(pmb!.amount_total)).toBe(1000);

     // Exactly one kasir expense row references the synthesized PMB
     const { data: kasir } = await sb.from('kasir_transactions').select('description').like('description', `%${pmb!.pembayaran_number}%`);
     expect(kasir).toHaveLength(1);
     expect(kasir![0].description).toContain('otomatis dari');
   });
   ```

2. `tests/integration/pembayaran-rpcs.test.ts`:
   ```
   test('void_pembayaran on synthesized Pembayaran reverses Tagihan to BELUM_LUNAS', async () => {
     // 1. Create a Tagihan via LUNAS shortcut
     // 2. Look up the synthesized pembayaran_id via pembayaran_items
     // 3. void_pembayaran(pembayaran_id, reason)
     // 4. Assert Tagihan.status === 'BELUM_LUNAS', paid_amount === 0
     // 5. Assert reverse kasir entry inserted (negative subtotal)
   });
   ```

### Browser smoke (post-apply, manual)

- Pembelian → Pesanan → pick existing DRAFT/ORDERED → Buat Tagihan → fill items, select "Bayar Sekarang", TRANSFER, save → verify: Tagihan list shows LUNAS, Pembayaran list shows new PMB row with the supplier, kasir ledger has the "otomatis dari TGH" row.
- Pembayaran list → click the synthesized PMB row → Detail page shows it normally, with Void button → click Void with a reason → Tagihan flips back to BELUM_LUNAS.

## Deploy plan

1. Merge PR #36 first. Apply `20260628000001` / `_002` / `_003` to live Supabase via MCP.
2. Run prod scan again to confirm zero orphan LUNAS (defensive, in case anyone exercised the shortcut between scans).
3. Apply `20260628000004`.
4. Cloud Run frontend rebuild (no frontend change in this spec but the EditOrderModal change from PR #36 needs it).
5. Browser smoke as above.

## Risks

- **Migration apply order**: `_004` body bundles `_003`'s over-receive guard. If for some reason `_003` is not applied but `_004` is (e.g., admin manually skipped), the over-receive guard is still in place. If `_004` is rolled back, `_003` is still in place. No "I changed my mind about LUNAS but now over-receive is also gone" scenario.
- **`_recompute_tagihan_status` race**: if a second `record_pembayaran` lands between the synthesized `pembayaran_items` INSERT and the `_recompute_tagihan_status` call, both will compute slightly different `paid_amount` snapshots. But: `_recompute_tagihan_status` is sum-of-truth — last call wins, both will read the same final state. Idempotent. No correctness risk.
- **Synthesized PMB visible in Pembayaran list**: operators may be momentarily confused seeing a PMB row they didn't manually create. Mitigated by the kasir description suffix; can also add a small badge in PembayaranList Detail rows ("auto" pill) in a follow-up if user feedback demands.

## Open questions / decisions deferred

- Add an `AccountPicker` to TagihanFormPage's LUNAS branch (capture `account_id` on synthesize)? Deferred — wait for actual report demand. Adding it is a small isolated change later.
- Should `record_pi` return the synthesized `pembayaran_id` so frontend could optionally show "Lihat Pembayaran" link? Deferred — keep return shape minimal, frontend can query by tagihan_id when needed.
