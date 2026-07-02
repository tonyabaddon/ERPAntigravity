# Sales-Side Dual-Write Close — Design

**Date:** 2026-07-02
**Status:** Design (approved, pending implementation plan)
**Author:** brainstorming session with tonywei
**Scope target:** Close all sales-side GL dual-write gaps + fix `record_pi` PASSTHROUGH/LUNAS accounting bugs + historical backfill for Juni-Juli 2026 data
**Prior art:** Phase 0b (kasir dual-write), Phase 0c (kasir HPP), Diskon feature, Sales Order (Penawaran), Piutang write-off UI

---

## 1. Goals & Non-Goals

### Goals

1. Every sales-side and LUNAS-at-create purchase-side transaction produces balanced journal entries in `journal_entries` / `journal_entry_lines`, consistent with the Phase 0b/0c kasir pattern.
2. Neraca (`1-1400` Piutang Usaha, `1-1510` Persediaan) and Laporan L-R (`4-1100` group, `4-1900` Diskon, `5-1100`/`5-1200` HPP, `5-3100` Kerugian Piutang) are accurate for periode 2026-06 and forward once backfill executes.
3. All new RPCs use **soft-fail** — GL error → log to `gl_dual_write_anomalies` + `RAISE WARNING`, business tx succeeds. Consistent with Phase 0b/0c.
4. PASSTHROUGH purchases route to correct COA (not `1-1510` which overstates Persediaan).
5. LUNAS-at-create purchase invoice books its payment leg by reusing `record_pembayaran` (which has Phase 0b dual-write). No more inline `pembayaran` synthesis.
6. Historical backfill restores Neraca/L-R consistency for Juni-Juli 2026 (all pre-fix data).
7. Accounting decisions follow SAK EMKM best practice explicitly (see §2.2 for decision log).

### Non-Goals

1. **Hard-fail migration** — GL correctness remains best-effort. Upgrading to tx-level enforcement is Phase 1 material.
2. **PKP handling** — Garindo is non-PKP. `2-1200` Hutang Pajak (PPN Keluaran) line is NOT emitted. Multi-tenant PKP is Phase 1.
3. **Multi-tenant `tenant_id` filter** — `p_tenant_id` in `_post_journal_entry` stays NULL. Sub-Project A prerequisite.
4. **Editing `record_kasir_sale`** — kasir side already complete via Phase 0b/0c.
5. **New COA structure** — reuse existing except **2 new accounts**: `5-1200 HPP Barang Passthrough` and `2-1150 Hutang Passthrough Accrued`.
6. **UI changes** — no user-facing changes. Anomaly log surfaced via existing `?screen=akuntansi` panel + MCP queries.
7. **Allowance method for bad debt** — direct write-off retained (SAK EMKM ¶12.7 explicit).
8. **`admin_adjust_journal` for backfill anomaly correction** — out of scope; noted as follow-up.

---

## 2. Accounting Decisions (Best Practice Justification)

### 2.1 Full decision matrix

| # | Decision | Chosen | SAK EMKM position | GAAP/IFRS position | Rationale |
|---|---|---|---|---|---|
| D-1 | Diskon Penjualan treatment | Gross-method with `4-1900` contra-revenue | Neither required; convention | Net-method preferred (IFRS 15/PSAK 72) | Consistent with kasir Phase 0b; common Indonesian MSME convention (Accurate/Jurnal.id both support); management-accounting value for diskon-given KPI |
| D-2 | Bad debt method | Direct write-off | ¶12.7 **explicitly allowed** | Allowance method required for GAAP compliance | Explicit SAK EMKM best practice for MSME; simpler operational (no estimation policy needed); migrate to allowance if tenant grows to SAK ETAP |
| D-3 | PASSTHROUGH HPP timing | **Full accrual** (sale-time HPP + accrued liability, reclassify at PI) | Neither required; permits shortcut | Matching principle requires same-period recognition | Garindo has monthly-close discipline (Year-End Close shipped); matching precision preserves L-R accuracy; upgrade from MSME shortcut worth ~+1 day work |
| D-4 | PASSTHROUGH SKU detection | `stocks.is_passthrough` boolean column + ProductForm toggle | N/A (data model) | N/A | Enables D-3 accrual branching at RPC time; heuristic backfill from PI history for existing rows |

### 2.2 Rejected alternatives

- **Net-method for Diskon** (D-1 alt): rejected because kasir side already gross; migrating kasir out of scope; MSME KPI visibility valuable.
- **Allowance method for bad debt** (D-2 alt): rejected because no estimation policy exists; adds cost without SAK EMKM benefit.
- **MSME shortcut for PASSTHROUGH** (D-3 alt): rejected because cross-period matching gaps would degrade Laporan L-R that Garindo already ships to founder.
- **Runtime pass-through detection via query** (D-4 alt): rejected because unreliable; a data model column is cleaner and correct-by-construction.

---

## 3. Per-Slice JE Shapes + COA Prerequisites

### 3.1 COA prerequisites (2 new accounts) + enum prerequisites (5 new source_type values)

Migration: `20260910000010_coa_seed_hpp_passthrough_and_accrued.sql`.

**New COA accounts:**

| Code | Name | Type / Subtype | Normal | Purpose |
|---|---|---|---|---|
| `5-1200` | HPP Barang Passthrough | BEBAN / HPP | DEBIT | Pass-through cost recognition (D-3 accrual sale-time + D-3 reclass PI-time) |
| `2-1150` | Hutang Passthrough Accrued | LIABILITAS / HUTANG | CREDIT | Interim liability between passthrough sale and PI receipt (D-3 full accrual) |

Both linked as children of `5-1000` and `2-1000` parent respectively via `parent_id`.

**New `journal_entry_source` enum values (verified against migration `20260715000006`):**

Existing enum has `KASIR_SALE`, `PEMBAYARAN`, `PI_TAGIHAN`, `TEMPO_WRITEOFF`, `BACKFILL`, etc. New values needed:

| Value | Used by | Rationale |
|---|---|---|
| `TEMPO_INVOICE_CREATE` | Slice A | Sale-side AR-creation; distinguishes from `KASIR_SALE` |
| `TEMPO_WRITEOFF_REVERT` | Slice D2 | Reversal of write-off; distinguishes from original `TEMPO_WRITEOFF` |
| `BACKFILL_TEMPO_INVOICE` | Slice E | Enables `LIKE 'BACKFILL_%'` rollback filter |
| `BACKFILL_PI_PASSTHROUGH` | Slice E | Same |
| `BACKFILL_PEMBAYARAN` | Slice E | Same |
| `BACKFILL_TEMPO_WRITEOFF` | Slice E | Same |

Slice B PASSTHROUGH JE reuses `PI_TAGIHAN` (confirmed used by Phase 0c `record_pi_dual_write` line 313).
Slice C payment leg reuses `PEMBAYARAN` (inherited from `record_pembayaran` Phase 0b logic).

Enum ALTER via `ALTER TYPE public.journal_entry_source ADD VALUE 'X'`. Bundled in migration `20260910000010`.

### 3.2 `stocks.is_passthrough` column (Slice D-4)

Migration: `20260910000011_stocks_is_passthrough_column.sql`.

```sql
ALTER TABLE public.stocks
  ADD COLUMN is_passthrough boolean NOT NULL DEFAULT false;

-- Heuristic backfill: any SKU that has appeared in PASSTHROUGH PI but never in STOCK PI
UPDATE public.stocks s SET is_passthrough = true
WHERE NOT EXISTS (
  SELECT 1 FROM public.purchase_invoice_items pii
  JOIN public.purchase_invoices pi ON pi.id = pii.purchase_invoice_id
  WHERE pii.sku = s.sku AND pi.type = 'STOCK'
) AND EXISTS (
  SELECT 1 FROM public.purchase_invoice_items pii
  JOIN public.purchase_invoices pi ON pi.id = pii.purchase_invoice_id
  WHERE pii.sku = s.sku AND pi.type = 'PASSTHROUGH'
);
```

ProductForm UI toggle wire-up: separate frontend PR (out of migration scope but tracked).

### 3.3 Slice A — `create_tempo_invoice` dual-write

**Trigger:** every successful `create_tempo_invoice(p_payload jsonb)` call after order + tempo_invoice insert.

**JE shape (per-line branch on `is_passthrough`):**

For non-passthrough lines (aggregate across all lines that are `NOT is_passthrough`):
```
D  1-1400  Piutang Usaha         v_total  (net of order discount)
D  4-1900  Diskon Penjualan      v_line_discount_total + v_order_discount_amt  (only if > 0)
D  5-1100  HPP Penjualan         v_hpp_stock_total  (FIFO consumption sum)
K  4-1140  Penjualan Tempo       v_recomputed_subtotal + v_line_discount_total  (GROSS revenue)
K  1-1510  Persediaan Barang     v_hpp_stock_total
```

For pass-through lines (aggregate across all lines that ARE `is_passthrough`):
```
D  5-1200  HPP Barang Passthrough    v_hpp_passthrough_total  (sale-time COGS accrual)
K  2-1150  Hutang Passthrough Accrued v_hpp_passthrough_total
```

Combined single JE with all legs; balance verified before post.

**HPP capture:** for non-passthrough lines, use existing `deduct_stock_fifo` return. For passthrough lines, use `stocks.harga_modal` as pass-through cost estimate (booked to accrued liability, reclassified at PI-time).

**Edge cases:**
- Zero discount → skip `4-1900` line.
- All lines pass-through → skip AR/Revenue/HPP-stock legs; only accrual pair.
- Mixed → both leg groups present in single balanced JE.

**Source metadata:** `source_type='TEMPO_INVOICE_CREATE'`, `source_ref_table='orders'`, `source_ref_id=<order.id>`.

### 3.4 Slice B — `record_pi` PASSTHROUGH COA swap + accrual reclass

**Trigger:** `record_pi` with `type='PASSTHROUGH'`.

**JE shape:**

If prior accrual outstanding for the linked customer order (matched via `purchase_invoices.order_id` — exact linkage guaranteed by `record_pi` PASSTHROUGH branch which `RAISE EXCEPTION 'order_id required for PASSTHROUGH'` at line 79-80 of migration `20260724000002`):
```
D  2-1150  Hutang Passthrough Accrued  v_subtotal  (reclassify)
K  2-1100  Hutang Usaha                v_subtotal  (real AP)
```

Else (no prior accrual — historical PI where sale predates Slice A shipment, or dual-write flag was off):
```
D  5-1200  HPP Barang Passthrough      v_subtotal
K  2-1100  Hutang Usaha                v_subtotal
```

**Accrual match resolution (exact, not heuristic):**

```sql
SELECT SUM(l.amount) FILTER (WHERE l.side = 'CREDIT') -
       SUM(l.amount) FILTER (WHERE l.side = 'DEBIT')
INTO v_accrual_balance
FROM journal_entries e
JOIN journal_entry_lines l ON l.entry_id = e.id
JOIN chart_of_accounts a ON a.id = l.account_id
WHERE e.source_ref_table = 'orders'
  AND e.source_ref_id    = v_order_id  -- from purchase_invoices.order_id
  AND a.account_code     = '2-1150';
```

If `v_accrual_balance >= v_subtotal` → reclass branch. Else non-accrual branch + log `PASSTHROUGH_ACCRUAL_UNMATCHED` info.

**Source metadata:** `source_type='PI_TAGIHAN'` (existing enum, per Phase 0c convention), `source_ref_table='purchase_invoices'`, `source_ref_id=<PI.id>`. Description distinguishes reclass vs non-accrual: `'PASSTHROUGH PI reclass accrual'` vs `'PASSTHROUGH PI (no prior accrual)'`.

### 3.5 Slice C — `record_pi` LUNAS-at-create payment leg (refactor)

**Trigger:** `record_pi` with `initial_status='LUNAS'`.

**Change:** replace inline `INSERT INTO pembayaran + pembayaran_items` with `PERFORM public.record_pembayaran(...)` call:

```sql
PERFORM public.record_pembayaran(
  jsonb_build_object(
    'supplier_id',      v_supplier_id,
    'payment_method',   payload->>'payment_method',
    'account_id',       payload->>'account_id',
    'account_label',    payload->>'account_label',
    'paid_at',          v_paid_at,
    'items',            jsonb_build_array(jsonb_build_object(
      'tagihan_id', v_pi_id,
      'amount',     v_subtotal
    ))
  )
);
```

Payment leg `D 2-1100 / K <cash>` books via Phase 0b logic. No duplicate dual-write here.

**Payload requirement:** LUNAS-at-create call must include `account_id` + `payment_method`. Implementation checks:
- Grep `src/lib/pembelianService.ts` for `initial_status: 'LUNAS'` payload construction; verify `payment_method` and `account_id` fields are present at the call site.
- Grep `src/components/pembelian/**/*.tsx` for the LUNAS toggle handler; verify the cash account picker is required-gated when LUNAS is selected.
- Backend guard: `record_pi` LUNAS branch raises `RAISE EXCEPTION 'LUNAS_REQUIRES_CASH_ACCOUNT'` if `account_id` NULL — fail hard here since silent no-op would leave AP overstated.

**Source metadata:** payment leg inherits `source_type='PEMBAYARAN'` from Phase 0b. PI header retains `PI_PASSTHROUGH`/`PI_STOCK` as before.

### 3.6 Slice D1 — `approve_tempo_write_off`

**Trigger:** successful approval of a `PIUTANG_WRITE_OFF` approval request.

**JE shape:**
```
D  5-3100  Kerugian Piutang (Write-off)  outstanding_amount
K  1-1400  Piutang Usaha                  outstanding_amount
```

**Source metadata:** `source_type='TEMPO_WRITEOFF'` (existing enum spelling, no underscore), `source_ref_table='approval_requests'`, `source_ref_id=<request.id>`.

**Edge cases:**
- `outstanding_amount = 0` → skip JE post; benign.
- Already-processed approval (idempotency) → check for existing entry by `source_ref_id`; skip if present.

### 3.7 Slice D2 — `revert_tempo_write_off`

**Trigger:** owner revert of previously-approved write-off (existing UI).

**JE shape (manual reverse — `_post_journal_entry` does NOT auto-swap D/C):**

```sql
-- Fetch original write-off entry ID
SELECT id, entry_number INTO v_orig_entry_id, v_orig_entry_number
FROM journal_entries
WHERE source_ref_table = 'approval_requests'
  AND source_ref_id    = v_request_id
  AND source_type      = 'TEMPO_WRITEOFF';

-- Post reversing entry with swapped lines
PERFORM public._post_journal_entry(
  p_entry_date          => CURRENT_DATE,
  p_source_type         => 'TEMPO_WRITEOFF_REVERT',
  p_description         => 'Revert write-off ' || v_orig_entry_number,
  p_lines               => jsonb_build_array(
    jsonb_build_object('account_code','1-1400','side','DEBIT', 'amount', v_outstanding),
    jsonb_build_object('account_code','5-3100','side','CREDIT','amount', v_outstanding)
  ),
  p_source_ref_table    => 'approval_requests',
  p_source_ref_id       => v_request_id,
  p_reverses_entry_id   => v_orig_entry_id
);
```

**Prereq:** `TEMPO_WRITEOFF_REVERT` added to `journal_entry_source` enum in migration `20260910000010` (see §3.1).

### 3.8 Verified constraints from code review

| # | Question | Finding | Impact |
|---|---|---|---|
| 1 | Stock deducted in-tx in `create_tempo_invoice`? | ✓ Yes (line 195) via `deduct_stock_fifo` | Revenue-at-invoice correct |
| 2 | DP payload accepted? | ✗ No — `v_total = AR` always | Slice A JE needs no `2-1500` retire leg |
| 3 | PASSTHROUGH SKU at tempo sale? | Edge case exists; `deduct_stock_fifo` fallback to `stocks.harga_modal` | D-4 flag + D-3 accrual handles cleanly |
| 4 | `record_pembayaran(payload jsonb)` signature | ✓ Confirmed — accepts full payload | Slice C `PERFORM` call safe |
| 5 | `_post_journal_entry.p_reverses_entry_id` auto-swap D/C? | ✗ No — only links `reversed_by_entry_id` | Slice D2 manually composes swapped lines |

---

## 4. Backfill Strategy (Slice E)

### 4.1 Principles

1. **Idempotent** — re-run safe; skip rows with existing matching JE.
2. **Chronological** — `p_entry_date` = original transaction date.
3. **Batched** — 500 rows per commit; surface progress via `RAISE NOTICE`.
4. **Anomaly-tolerant** — one failed row does not abort batch.
5. **Period-lock respect** — closed periods skip with `BACKFILL_PERIOD_CLOSED` anomaly; manual reopen if inclusion needed.
6. **Read-only preview** — `p_dry_run=true` writes to `_backfill_preview_je` temp table instead of `journal_entries`.

### 4.2 Backfill functions

Migration `20260910000015_backfill_sales_side_gl.sql` defines (does not execute) 4 functions:

```sql
_backfill_tempo_invoice_gl(p_from_date date, p_to_date date, p_batch int, p_dry_run boolean) RETURNS jsonb
_backfill_pi_passthrough_gl(...)      -- Slice B (includes reclass branch)
_backfill_pi_lunas_payment_gl(...)    -- Slice C
_backfill_tempo_write_off_gl(...)     -- Slice D1
```

Owner triggers execution via MCP `execute_sql` after dry-run review.

The reclass logic (D-3 accrual pair) lives inside `_backfill_pi_passthrough_gl` — after `_backfill_tempo_invoice_gl` runs and populates historical accruals, the PI-backfill's accrual-match query finds them and routes to reclass branch.

### 4.3 Execution order

Data dependencies require this sequence:

1. `_backfill_tempo_invoice_gl` — synthesize Slice A JE for all `orders WHERE payment_type='TEMPO'` in date range. Populates historical `2-1150` accruals for pass-through lines.
2. `_backfill_pi_passthrough_gl` — synthesize Slice B JE for `purchase_invoices WHERE type='PASSTHROUGH'`. Accrual-match logic (§3.4) finds step 1's accruals and routes to reclass branch when balance sufficient; else non-accrual branch.
3. `_backfill_pi_lunas_payment_gl` — synthesize Slice C payment leg for `purchase_invoices WHERE initial_status_at_create='LUNAS'`.
4. `_backfill_tempo_write_off_gl` — synthesize Slice D1 JE for `approval_requests WHERE type='PIUTANG_WRITE_OFF' AND status='APPROVED'`.

### 4.4 Dry-run preview

Each function accepts `p_dry_run boolean`. When true:
- Do NOT call `_post_journal_entry`
- INSERT into `_backfill_preview_je (source_row_id, planned_lines jsonb, planned_date date, reason text)`
- Return summary: `{"eligible": N, "skipped_period_closed": N, "skipped_already_journaled": N, "would_post": N}`

Workflow: run dry-run → review preview table → run production.

### 4.5 Anomaly categorization

`gl_dual_write_anomalies.error_code` values used during backfill:

- `BACKFILL_PERIOD_CLOSED` — target period tutup, skipped.
- `BACKFILL_COA_MISSING` — COA not seeded (should not happen after §3.1 migration).
- `BACKFILL_UNBALANCED` — computed JE fails balance check (data corruption indicator).
- `BACKFILL_ALREADY_JOURNALED` — INFO-level benign skip.
- `BACKFILL_PASSTHROUGH_AMBIGUOUS` — pass-through detection edge case (D-4 heuristic uncertain).

Owner reviews via existing `?screen=akuntansi` anomaly panel post-run.

### 4.6 Rollback

Distinct `source_type` values enable clean rollback:

```sql
DELETE FROM journal_entry_lines
  WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_type LIKE 'BACKFILL_%');
DELETE FROM journal_entries WHERE source_type LIKE 'BACKFILL_%';
```

Idempotent; no cascade impact on business rows.

---

## 5. Testing & Smoke Plan

### 5.1 Layer 1 — Unit tests (`backend-go/internal/db/*_test.go`)

| Slice | Test file (new) | Key assertions |
|---|---|---|
| A | `create_tempo_invoice_dual_write_test.go` | Happy path balance; diskon-zero skip; passthrough branch; flag-off no-op; missing COA soft-fail |
| B | `record_pi_passthrough_dual_write_test.go` | PASSTHROUGH books to `5-1200`; reclass when accrual outstanding; STOCK PI unchanged |
| C | Extend `record_pi_dual_write_test.go` | LUNAS-at-create routes to `record_pembayaran`; BELUM_LUNAS no payment leg; missing `account_id` soft-fail |
| D1 | `approve_tempo_write_off_test.go` | Approval books `D 5-3100 K 1-1400`; zero-outstanding skip; idempotent |
| D2 | `revert_tempo_write_off_test.go` | Reversed lines composed; `reversed_by_entry_id` populated; double-revert error |
| E | `backfill_sales_gl_test.go` | Dry-run non-destructive; second-run idempotent; closed-period skip; heuristic flag correctness |

Target: **35-40 new Go tests**. Follow existing `_setup.ts` fixture pattern.

### 5.2 Layer 2 — Vitest

- `pembelianService.ts`: verify LUNAS-at-create payload includes `account_id` + `payment_method` (was present per Phase 0b).
- `salesService.ts`: no expected change.

### 5.3 Layer 3 — DB smoke via Supabase MCP

DO-block per slice, use `RAISE EXCEPTION 'SMOKE_ROLLBACK'` at end to leave zero side effects. Prints JE lines for eye-check.

Template (Slice A):
```sql
DO $$ DECLARE v_order uuid; v_je jsonb; BEGIN
  PERFORM set_config('request.jwt.claim.sub', '<garindo-owner-uuid>', true);
  v_order := public.create_tempo_invoice(jsonb_build_object(
    'customer_id', '<known-customer-uuid>',
    'items', jsonb_build_array(jsonb_build_object(
      'sku', 'STICKER-TEST', 'qty', 1, 'unit_price', 10000
    )),
    'discount_amount_rp', 1000
  ));
  SELECT jsonb_agg(jsonb_build_object('code', a.account_code, 'side', l.side, 'amount', l.amount))
  INTO v_je
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN chart_of_accounts a ON a.id = l.account_id
  WHERE e.source_ref_id = v_order;
  RAISE NOTICE 'JE lines: %', v_je;
  RAISE EXCEPTION 'SMOKE_ROLLBACK';
END $$;
```

Analogous DO-blocks for B/C/D/E documented in implementation plan.

### 5.4 Layer 4 — Browser E2E via chrome-devtools MCP

Post-slice deploy, run in production Cloud Run:

1. `?screen=catat-penjualan` → 3-step wizard, tempo customer, 1 line + diskon → Simpan. Verify JE via MCP query.
2. `?screen=pembelian` → new PI PASSTHROUGH LUNAS → verify 2 JE (cost + payment).
3. `?screen=persetujuan` → approve pending tempo write-off → verify JE.
4. `?screen=akuntansi` → Laporan L-R Juni 2026 → cross-check `4-1140` sum matches tempo orders; HPP `5-1100 + 5-1200` matches order.hpp_total.

### 5.5 Layer 5 — Backfill validation

Post-backfill, existence check:

```sql
-- Every tempo order in period should have exactly 1 AR-creation JE
SELECT count(*) FROM orders o
WHERE o.payment_type = 'TEMPO' AND o.created_at >= '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries e
    WHERE e.source_ref_table = 'orders' AND e.source_ref_id = o.id
      AND e.source_type IN ('TEMPO_INVOICE_CREATE', 'BACKFILL_TEMPO_INVOICE')
  );
-- Expected: 0
```

Similar checks for PASSTHROUGH PI, LUNAS payment, write-off.

### 5.6 Per-slice success criteria (gate for next slice)

Ship slice N migration only after:
1. Unit tests 100% green
2. DO-block smoke: JE printed + balanced
3. Browser E2E: no console error + JE correct
4. `SELECT * FROM gl_dual_write_anomalies WHERE source_rpc='<rpc>' AND created_at > now() - interval '1h'` returns 0 unexpected rows

Backfill (E) additionally: validation queries return 0.

---

## 6. Rollout & Rollback

### 6.1 Migration order

```
20260910000010_coa_seed_hpp_passthrough_and_accrued.sql   (Slice A/B COA prereq)
20260910000011_stocks_is_passthrough_column.sql            (Slice D-4)
20260910000012_create_tempo_invoice_dual_write.sql         (Slice A)
20260910000013_record_pi_passthrough_and_lunas.sql         (Slices B + C bundled — same RPC)
20260910000014_tempo_write_off_pair_dual_write.sql         (Slices D1 + D2)
20260910000015_backfill_sales_side_gl.sql                  (Slice E — functions only, exec triggered manually)
```

Each migration cycle:
- Local Go test pass
- MCP `apply_migration` to prod DB
- DB smoke DO-block
- 1-2 day soak (watch anomaly log)
- Browser E2E via chrome-devtools MCP
- Promote next slice only when zero unexpected anomalies

**Estimated wall-clock:** ~2 minggu (2-3 hari per slice + backfill).

### 6.2 Feature flag

Existing `accounting_config.enable_dual_write_to_gl` boolean gates all new dual-write code paths (same as Phase 0b/0c). Emergency kill:
```sql
UPDATE accounting_config SET enable_dual_write_to_gl = false;
```

Exceptions (not gated by flag):
- Slice B PASSTHROUGH COA swap — data-integrity fix, always active
- Slice D-4 `is_passthrough` column — always active

### 6.3 Per-slice rollback

| Slice | Rollback | Data cleanup |
|---|---|---|
| COA seed (10) | `DELETE FROM chart_of_accounts WHERE account_code IN ('5-1200','2-1150')` (safe if no JE reference) | None |
| `is_passthrough` (11) | `ALTER TABLE stocks DROP COLUMN is_passthrough` | None (metadata-only) |
| Slice A (12) | Restore prior `create_tempo_invoice` from CAPTURED ORIGINAL BODY comment in migration header | `DELETE FROM journal_entries WHERE source_type='TEMPO_INVOICE_CREATE'` (distinct enum, safe) |
| Slice B+C (13) | Restore prior `record_pi` from header comment | **RPC-only rollback**; historical Slice B PI_TAGIHAN entries with `5-1200` debit stay booked (shared enum with Phase 0c STOCK PI — no clean filter). Manual reconciliation follow-up. |
| Slice D (14) | Restore prior approve + revert RPCs | `DELETE FROM journal_entries WHERE source_type IN ('TEMPO_WRITEOFF','TEMPO_WRITEOFF_REVERT')` (verify no legacy TEMPO_WRITEOFF entries first — should be 0 since D1 is the first write path) |
| Backfill (15) | `DELETE FROM journal_entries WHERE source_type LIKE 'BACKFILL_%'` | Distinct enum values enable clean filter |

Each slice migration includes predecessor's RPC body verbatim in header comment (Phase 0b/0c convention).

### 6.4 Monitoring

- Existing `?screen=akuntansi` anomaly panel — daily check for first week.
- Saved queries in `docs/superpowers/plans/2026-07-02-sales-dual-write-monitoring-queries.md`:
  - Anomaly rate per RPC per day
  - JE-to-source ratio (target 1:1)
  - Balance check per source_ref_id
- Anomaly rate spike ≥ 5/day for any RPC → investigate before continuing rollout.

### 6.5 Communication

- No user-facing change → no user comms.
- `progress.md` note per slice (per CLAUDE.md GOTCHA).
- Final reconciliation summary in `progress.md` when Slice E validated: pre-fix vs post-fix Neraca + L-R for Juni 2026.

### 6.6 Post-launch cleanup (follow-up, out of scope)

- Remove `TODO(Phase 0c sales dual-write)` markers from migrations `20260801000005`, `20260901000006`, `20260901000008`.
- Delete stale `record_kasir_sale_diskon_todo.sql` if it still exists (grep first).
- Update `docs/product/PRD.md` accounting section (one-line: "all sales-side GL dual-write shipped").
- Draft `admin_adjust_journal` SD RPC for anomaly correction workflow.

---

## 7. Open Questions (resolved during code review)

All previously-open questions closed:

- ✓ `record_pembayaran(payload jsonb)` signature — confirmed; Slice C `PERFORM` call safe.
- ✓ `_post_journal_entry.p_reverses_entry_id` behavior — does NOT auto-swap; Slice D2 manually composes.
- ✓ Stock deduction in-tx — confirmed line 195 of tier RPC.
- ✓ No DP payload — verified.

## 8. Follow-ups Explicitly Deferred

1. **PKP tenants** — `2-1200` PPN Keluaran line emission requires per-tenant PKP flag. Phase 1.
2. **Multi-tenant `tenant_id` filter** — depends on Sub-Project A infra.
3. **Allowance method for bad debt** — if tenant grows to SAK ETAP.
4. **Hard-fail dual-write** — Phase 1 upgrade to tx-level correctness enforcement.
5. **`admin_adjust_journal` SD RPC** — for backfill anomaly correction.
6. **ProductForm UI toggle for `is_passthrough`** — separate frontend PR after Slice D-4.

---

**End of design document.**
