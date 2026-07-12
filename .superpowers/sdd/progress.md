# Warehouse-transfer accounting integration (NOA end-to-end, 2026-07-13)

**Motivation** — audit request from founder: check if warehouse-transfer NOA
(nomor akun / journal entry) recording is correct end-to-end. Investigation
found:
- `initiate_warehouse_transfer` / `receive_warehouse_transfer` /
  `cancel_warehouse_transfer` all mutate stock but never post to GL.
- On PARTIAL receive, `1-1510 Persediaan` becomes permanently overstated by
  `loss × harga_modal` because the write-off is never journalized.
- Mid-transit (IN_TRANSIT), `SUM(stock_levels × harga_modal) ≠ GL 1-1510`
  by `qty_sent × harga_modal` — period close mid-transit yields mismatched
  reports.

**Fix chosen (Option B — proper In-Transit account per SAK EMKM / PABU)**:
introduces contra-inventory account `1-1512 Persediaan Dalam Perjalanan`
and a transit-loss expense account. Semantic reuse: `5-3160 Beban Barang
Rusak` (existing from slot 100 supplier_claims) — my seed for a new name
was skipped by NOT EXISTS guard, which is correct behavior; the account
aggregates all physical-loss expenses (opname damage + transit loss).
Rationale: standard SAK EMKM practice groups similar physical-loss losses
under one expense account.

Journal-entry topology per lifecycle event:
| Event | JE lines |
|---|---|
| initiate | Dr 1-1512 In-Transit / Cr 1-1510 Persediaan |
| receive-full | Dr 1-1510 / Cr 1-1512 |
| receive-partial | Dr 1-1510 (recv) + Dr 5-3160 (loss) / Cr 1-1512 (sent) |
| receive-all-loss | Dr 5-3160 / Cr 1-1512 |
| cancel | Dr 1-1510 / Cr 1-1512 |

Value basis: `stocks.harga_modal` snapshotted per line at initiate time
(new `warehouse_transfer_items.harga_modal` column). Skip JE if amount=0
(mirrors opname damage pattern — a tenant with zero-cost SKU can still
transfer without failing).

**Migrations shipped** (slots 228 + 229):
- `20261115000228_warehouse_transfer_je_enum.sql` — adds
  `WAREHOUSE_TRANSFER` value to `journal_entry_source` enum (isolated
  because PG12+ disallows using new enum values in the same tx as ADD).
- `20261115000229_warehouse_transfer_je_posting.sql` — schema alter
  (traceability columns: `initiate_journal_id`, `receive_journal_id`,
  `cancel_journal_id`, `total_loss_value_rp` on `warehouse_transfers`;
  `harga_modal`, `loss_value_rp` on `warehouse_transfer_items`), COA
  seed for all tenants, CREATE OR REPLACE 3 RPCs with JE posting,
  DO $backfill$ block for historical PARTIAL rows.

**Backfill** — historical: 1 Garindo QA transfer (TR-2026-07-002, loss 3 pcs
× Rp 30.000 = Rp 90.000). Migration's DO $backfill$ block **silently
skipped** due to RLS-in-migration-context gotcha: `_post_journal_entry`
reads `accounting_periods` via RLS-filtered SELECT, which returns 0 rows
when `_resolve_tenant_id()` sees no auth GUC (migration runs as
non-authed role). Fixed by running a manual DO block that bypasses
`_post_journal_entry` and inserts directly into `journal_entries` +
`journal_entry_lines`. Posted **JE-202607-0018** with correct 2-line
Dr 5-3160 90k / Cr 1-1510 90k balance and linked back to
`wt.receive_journal_id` + `wt.total_loss_value_rp = 90000`.

Live path (real user JWT) is unaffected — the RLS block only triggers in
migration/MCP context. Kasir sale / pembelian / opname damage all use
`_post_journal_entry` in production and work fine, so the same pattern
here is safe.

**FE** — `WarehouseTransferDetailScreen` now:
- Meta grid: "Nilai Kerugian" cell on PARTIAL status showing
  `Rp X (N pcs)` in red-700 semibold; falls back to "Nilai belum tercatat
  (transaksi lama)" if `total_loss_value_rp` is NULL.
- Live warning banner (during receive input): shows
  `Selisih -N pcs (≈ Rp Y)` computed from `receivedQty × harga_modal`
  snapshot per line; copy updated from "Stock Adjustment TRANSFER_LOSS"
  to "Catat kerugian ke pembukuan".
- Types extended: `harga_modal`, `loss_value_rp` on
  `WarehouseTransferItem`; `total_loss_value_rp`,
  `initiate_journal_id`, `receive_journal_id`, `cancel_journal_id` on
  `WarehouseTransferHeader`.
- 3 tests updated / added covering PARTIAL chip, legacy fallback,
  live-Rp banner assertion.

**Stage 1 verification** — `npm run lint` clean, `audit:numinput` clean,
`audit:secdef-null-tenant` clean, `vitest run` on warehouse-transfer
scope 44/44 pass. Pre-existing unrelated failures in
`productWrappers.test.ts` and `AdminRoutes.test.tsx` (verified via git
stash to confirm not caused by this change).

**Stage 2** — migrations 228 + 229 applied to prod DB via
`mcp__plugin_supabase_supabase__apply_migration`. `get_advisors` shows
0 new advisories from this change (4 pre-existing false-positive matches
on `seed_stock_row.harga_modal` param name).

**Stage 3 (Chrome DevTools MCP smoke on prod)** — pending after
Cloud Build completes.

**Advisor** — consulted before implementation. 6 pre-flight checks all
validated against code and incorporated (per-tenant COA seed via NOT
EXISTS, enum add in separate slot 228, skip-JE-if-amount=0 pattern,
atomic BEGIN/COMMIT wrapping in migration 229, backfill limited to
PARTIAL — not CANCELLED which is a historical wash, direct
Dr 5-3160 / Cr 1-1510 for backfill JE).

---

# Item #4b Promo Produk — SDD progress ledger

Task 1: complete (commit 41a32c8, migration 120 applied, mig 121 dropped — kasir_transaction_items doesn't exist, promo_snapshot lives in items JSONB)
Task 2: complete (commit c2f1a75, upsert_stock_promo mig 122 applied + smoke passed)
Task 3: complete (commit c2f1a75, bulk_upsert_stock_promo mig 123 applied + smoke passed)
Task 4: complete (commit c2f1a75, list_active_promos + get_promo_summary mig 124 applied + smoke passed)
Task 5: SKIPPED (record_kasir_sale already handles per-line discount natively via items JSONB fields; promo_snapshot passes through v_item merge; no signature change needed)
Task 6: complete (commit bec5ce3, TS types + api client + computeLinePromoDiscount helper)
Task 7-8-11: complete (commit 39054f3, PromoProdukPanel + StockManager column + Dashboard card + PromoInlineEdit popover + kasir_discount label rename)
Task 9: complete (commit 6203500, useActivePromos hook + CatatPenjualanWizard + Step2Items + CartRows integration)
Task 10 (menu restructure): DEFERRED — full Diskon parent grouping not shipped; kept in ApprovalRulesPanel as "Diskon Nota (di kasir)"; deferred to next iteration
Advisor: complete (mig 126 revokes anon EXECUTE on all 4 new SECDEF RPCs; only 1 pre-existing ERROR unrelated to item-4b)
Deploy: pending Cloud Build da358fbd
Prod smoke MCP chrome: pending
