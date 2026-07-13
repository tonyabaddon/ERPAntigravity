# NOA End-to-End Audit — 2026-07-13

**Scope**: All 20 live SECURITY DEFINER RPCs in prod DB that post to
`journal_entries` via `_post_journal_entry`. Reviewed against SAK EMKM
(Indonesian small-entity accounting standard) and general double-entry
best practice.

**Method**:
1. Enumerate posting flows via `pg_proc` where body contains
   `_post_journal_entry` (26 hits; 6 excluded as infrastructure /
   backfill helpers).
2. Extract JE topology per flow: trigger event, DR/CR accounts, amount
   basis, edge-case guards.
3. Compare each flow's topology against SAK EMKM section applicability
   + accounting first principles (debit=credit; correct account type;
   proper timing / matching).
4. Cross-check for silent-drift patterns (like the [[coa-null-subtype-
   anomalies]] class caught earlier this session).

**Verdict**: **4 BLOCKER + 4 WARN + 3 INFO** findings. GL correctness
is intact for common cash-basis kasir cash-and-carry, but multiple
common variants (DP, tempo with shipping, opname variance, passthrough
with order-discount) silently drift or fail-and-log. Not doomsday, but
material for a "billion-dollar-scale SaaS" trajectory — every one is a
tenant-visible integrity gap.

**How to read**:
- BLOCKER = active silent-drift or wrong data reaching prod. Fix in
  next iteration.
- WARN = semantic wrongness / weak categorization / cross-flow
  inconsistency. Fix before shipping new expansion.
- INFO = quality-of-life / documentation debt; safe to defer.

Rows use severity emoji only for skim-ability; text is authoritative.

---

## Summary matrix

| # | Flow | Severity | Finding (one-line) |
|---|---|---|---|
| B1 | `create_tempo_invoice` | 🔴 BLOCKER | shipping_fee not credited → JE unbalanced by shipping → silent GL drop |
| B2 | `_apply_opname_change` (variance loop) | 🔴 BLOCKER | opname variance mutates stock_levels + stock_movements but posts no JE → GL/stock permanent drift |
| B3 | `record_pi` PASSTHROUGH | 🔴 BLOCKER | Uses `v_subtotal` (pre-order-disc) for AP credit; drifts 2-1100 by order_discount every PASSTHROUGH PI |
| B4 | `record_kasir_sale` DP | 🔴 BLOCKER | DP orders post JE at full order total (cash + revenue) even though only DP amount received; overstates cash & revenue by (total − DP) |
| W1 | `record_kasir_sale` ongkir | 🟠 WARN | Ongkir bundled into channel revenue account; overstates product revenue; understates 4-1220 Pendapatan Ongkir |
| W2 | Cross-flow: dual-write gate | 🟠 WARN | Kasir/PI/tempo/pembayaran/piutang gate on `enable_dual_write_to_gl`; manual/cash/stock/period always post → mixed-state tenant if flag flipped off |
| W3 | `record_pembayaran` early-pay discount | 🟠 WARN | `discount_amount` reduces both AP + cash; no discount-received income account booked |
| W4 | `resolve_supplier_claim` DISPOSE reclass | 🟠 WARN | Semantic reuse of `5-3160 Beban Barang Rusak` OK, but `source_ref_id=NULL` breaks JE→claim linkage (relies on side-table `supplier_claim_events`) |
| I1 | `resolve_supplier_claim` CASHED | 🔵 INFO | `p_resolution_target_id` passed as raw `account_code` string vs UUID elsewhere — caller-contract asymmetry |
| I2 | `accrue_period_taxes` PPN | 🔵 INFO | No auto-PPN accrual mechanism; only PPh Final 0.5%. Non-PKP tenants OK; PKP need manual JE |
| I3 | `initiate/receive/cancel_warehouse_transfer` | 🔵 INFO | `source_ref_id=NULL`; linkage via `warehouse_transfers.*_journal_id`. Same pattern as supplier_claim; consistent internally but different from kasir/PI/etc which populate source_ref_id |

**Meta-finding (documented separately in memory `coa-null-subtype-anomalies`)**: NULL-subtype leaf CoA rows silently omit from Neraca/P&L grouping. Fixed 5-3160 + 1-1460 today; 2-1400 deferred.

---

## BLOCKER details

### B1 — `create_tempo_invoice` shipping unbalanced

**Flow**: Customer buys on tempo/credit; shopkeeper creates invoice
`orders.payment_type='TEMPO'` `.status='INVOICE_TEMPO'`; delivery
includes shipping fee charged to customer.

**Current JE construction** (slot 20260910000012):

Line | Side | Account | Amount
--- | --- | --- | ---
1 | DEBIT | 1-1400 Piutang Usaha | `v_total = subtotal − order_disc + shipping_fee`
2 | CREDIT | 4-1140 Penjualan Tempo | `recomputed_subtotal + line_discount_total`
3 (cond) | DEBIT | 4-1900 Diskon Penjualan (kontra) | `line_disc + order_disc`
4 (cond) | DEBIT | 5-1100 HPP Penjualan | `hpp_stock_total`
5 (cond) | CREDIT | 1-1510 Persediaan | `hpp_stock_total`
6 (cond) | DEBIT | 5-1200 HPP Passthrough | `hpp_passthrough_total`
7 (cond) | CREDIT | 2-1150 Hutang Passthrough | `hpp_passthrough_total`

**Math**: When `shipping_fee > 0`:
- Σ DEBIT − Σ CREDIT = `shipping_fee`
- `_post_journal_entry` validates `SUM(DEBIT) = SUM(CREDIT)` and RAISES
  `unbalanced_entry` on mismatch.
- Outer soft-catch (`EXCEPTION WHEN OTHERS`) swallows to
  `gl_dual_write_anomalies`, RAISE WARNING, order still saved.
- **Net effect**: every tempo invoice charged with shipping has
  ZERO JE in the ledger. Silent GL gap.

**Recommended fix**: add a shipping credit line. Options:
1. **CR `4-1220 Pendapatan Ongkir (margin)`** by `shipping_fee` — treats
   shipping as revenue (net margin). Fits when tenant charges customer
   more than actual carrier cost.
2. **CR `2-1500 Pendapatan Diterima Dimuka`** (or new
   `2-1160 Hutang Ongkir Kurir`) by `shipping_fee` — treats shipping
   as pass-through to carrier (liability until settled). Fits when
   tenant just passes carrier cost through.

Founder's typical MSME model (Garindo distributor) leans toward Option 2
(pass-through to Lalamove / driver). But this needs founder decision.

**Verification**: `gl_dual_write_anomalies` on prod DB — check if
`source_rpc='create_tempo_invoice'` rows contain `unbalanced_entry`
error codes. Would prove the drift is happening in the wild.

---

### B2 — `_apply_opname_change` variance loop posts no JE

**Flow**: Stock opname session commits after approval. Loop 1
processes rows with `variance <> 0` (physical count differs from
system count). Loop 2 processes rows with `damaged_qty > 0`.

**Current behavior**:
- **Loop 1 (variance)**: adjusts `stock_levels.qty += variance`, logs
  `stock_movements` with `source='opname_variance'`. **No JE posted.**
- **Loop 2 (damage)**: adjusts stock_levels, logs stock_movements,
  creates supplier_claim, **posts JE Dr 1-1460 / Cr 1-1510** (opname
  damage speculative claim). Correct.

**Problem — Loop 1**: variance is a real economic event.
- If `variance > 0` (real count > system): merchandise found → asset
  gain. GL should recognize: `Dr 1-1510 Persediaan / Cr 4-1230
  Keuntungan Selisih Stock Opname` (COA row exists — subtype
  PENDAPATAN_LAIN).
- If `variance < 0` (real count < system): merchandise missing →
  shrinkage / theft. GL should recognize: `Dr 5-3150 Kerugian Selisih
  Stock Opname / Cr 1-1510 Persediaan` (COA row exists — subtype
  BEBAN_NON_OPERASIONAL).

**Current state**: stock_levels drops by shrinkage, but neither
`5-3150` nor `1-1510` is journalized. Balance sheet `1-1510` stays
overstated. P&L never sees the loss. Same class of bug as [warehouse-
transfer PARTIAL] before this session's fix.

**Impact scale**: Any tenant that runs opname regularly (all do, this
is standard MSME practice). Every variance session drifts GL vs stock.
Silent — no error, no warning.

**Recommended fix**: extend Loop 1 (with a value-basis using
`COALESCE(stocks.harga_modal, 0)`):
```sql
IF v_variance > 0 THEN
  -- overage: Dr 1-1510 / Cr 4-1230
ELSE
  -- shrinkage: Dr 5-3150 / Cr 1-1510
END IF;
```
Skip JE if `harga_modal * ABS(variance) = 0` (matches opname-damage
pattern; caller can still commit at zero-cost basis without failure).

**Related memory**: [[coa-null-subtype-anomalies]] documents 5-3150
already has correct subtype BEBAN_NON_OPERASIONAL — no seed anomaly
here. Fix is purely in `_apply_opname_change` Loop 1 body.

---

### B3 — `record_pi` PASSTHROUGH drops order-level discount

**Flow**: Purchase invoice type=PASSTHROUGH. Attached to a customer
order (was recognized earlier at `create_tempo_invoice` time as
Dr 5-1200 HPP Passthrough / Cr 2-1150 Hutang Passthrough at gross).
When the actual supplier PI arrives, `record_pi` reclasses the accrual
to a real supplier payable.

**Current JE** (slot 20260910000013, PASSTHROUGH branch):

If `v_accrual_balance >= v_subtotal`:
```
DR 2-1150 Hutang Passthrough  v_subtotal   -- reclass
CR 2-1100 Hutang Usaha         v_subtotal
```

**Problem**: `v_subtotal = gross − line_discount` (before order-level
discount). But the actual `purchase_invoices.total = v_subtotal −
order_discount_amt = v_total`. And `record_pembayaran` later pays only
`v_total`.

Timeline:
| Event | 2-1150 | 2-1100 |
|---|---|---|
| `create_tempo_invoice` | +v_subtotal (gross accrual) | 0 |
| `record_pi` PASSTHROUGH | −v_subtotal | +v_subtotal ← WRONG |
| `record_pembayaran` | 0 | −v_total |
| **Residual after full payment** | **0** | **+order_discount_amt** ← DRIFT |

`2-1100 Hutang Usaha` retains a permanent phantom balance = order
discount for every PASSTHROUGH PI that ever had an order-level
discount. Never reconciles. This is a known documented limitation in
the file header comment (line 21-24), which the author labels
"pending full-accrual cutover" — but no cutover has shipped.

**Impact**: For B2B distributors who commonly negotiate order-level
discounts with suppliers, this compounds every PI. Reviewing AP aging
becomes noisy. Balance sheet AP overstated.

**Recommended fix**: split the PASSTHROUGH JE into gross + discount
contra, mirroring the STOCK branch:
```
DR 2-1150                  v_subtotal
CR 2-1100                  v_total          -- net
CR 5-1900 Diskon Pembelian order_discount_amt   -- contra
```
This properly credits Hutang Usaha at what will actually be paid, and
records the negotiated discount as a purchase-discount contra (same
account STOCK branch already uses).

Alternative: change `record_pi` to use `v_total` throughout PASSTHROUGH
branches — but that loses the discount recognition to the P&L. Not
recommended.

**Also fix** the direct-expense branch (accrual_balance < v_subtotal):
Same drift pattern applies. Use `v_total` for CR 2-1100 + optional
CR 5-1900 for discount.

---

### B4 — `record_kasir_sale` DP orders overstate cash + revenue

**Flow**: Kasir records a sale with `p_payment_type = 'DP'`. Customer
pays a down-payment (`p_dp_amount`) upfront; order set to
`AWAITING_LUNAS`; balance collected later via a follow-up call.

**Current JE** (slot 20260901000005):

```
DR v_cash_coa       v_recomputed_total   -- full order total (not DP)
CR v_pendapatan_coa v_gross_revenue      -- full revenue
DR 4-1900 (cond)    v_total_discount_rp
DR 5-1100 (cond)    hpp_total
CR 1-1510 (cond)    hpp_total
```

Where `v_recomputed_total = subtotal − order_disc + ongkir` — **the
FULL order total, not the DP amount received**.

**Problem**: If order total = Rp 1.000.000 and DP = Rp 500.000:
- Cash actually received: Rp 500.000
- Cash booked to GL: **Rp 1.000.000** (overstated by Rp 500.000)
- Revenue booked: **Rp 1.000.000** (recognized fully at order time,
  even though delivery/settlement pending)
- No `Dr 1-1400 Piutang / Cr Pendapatan` for the outstanding balance
- No `Dr Cash / Cr 2-1500 Pendapatan Diterima Dimuka (DP)` for DP-only
  timing

**Impact**:
- Cash account overstated → cash reconciliation breaks.
- Revenue recognized prematurely (cash basis violated, accrual
  premature).
- If customer defaults on remainder, no clean write-off path.
- Report distortion when many DP orders open at period-end.

**Recommended fix (staged)**:

Stage 1 (immediate, minimal risk) — book DP correctly:
```
When p_payment_type = 'DP':
  DR v_cash_coa       p_dp_amount           -- actual cash received
  CR 2-1500 Pendapatan Diterima Dimuka (DP)  p_dp_amount

When AWAITING_LUNAS remainder later collected via new RPC
`record_kasir_dp_lunas`:
  DR v_cash_coa                   remainder
  DR 2-1500                       p_dp_amount (reclass to revenue)
  CR v_pendapatan_coa             v_recomputed_total
  CR 4-1900 (kontra) if discount
  DR 5-1100 / CR 1-1510 (HPP)     (moved from DP time to lunas time)
```

Stage 2 (cleanup, later) — backfill historical DP orders. Complex
because delivered-then-DP-only orders exist; needs owner decision on
each.

**Verification query** to size the problem:
```sql
SELECT COUNT(*), SUM(total_amount) FROM kasir_transactions
 WHERE payment_type = 'DP';
```

---

## WARN details

### W1 — `record_kasir_sale` ongkir bundled into product revenue

`v_recomputed_total` includes `p_ongkir_amount`. `v_gross_revenue =
v_recomputed_total + v_total_discount_rp` — so ongkir amount lands in
the channel-mapped `Pendapatan Walkin / Marketplace / Grosir` account
instead of a dedicated `4-1220 Pendapatan Ongkir (margin)`.

**Effect**: Overstates product revenue by cumulative ongkir; understates
service revenue line item. Report readers can't distinguish product
sales from delivery income.

**Recommended fix**: extract ongkir as its own credit line
`CR 4-1220 p_ongkir_amount`, credit product revenue with
`v_gross_revenue − p_ongkir_amount`.

Similar consideration for `create_tempo_invoice` (which also has
`shipping_fee` in `v_total`) — but that RPC also has B1's shipping
imbalance bug, so both fixes converge in one migration.

---

### W2 — Dual-write gate inconsistency

Flows that gate on `accounting_config.enable_dual_write_to_gl`:
`record_kasir_sale`, `record_pi`, `create_tempo_invoice`,
`record_pembayaran`, `record_piutang_payment`, `approve_tempo_write_off`,
`revert_tempo_write_off`.

Flows that always post (no gate):
- Manual/cash: `record_internal_transfer`, `record_balance_adjustment`,
  `record_owner_drawing`, `record_wallet_spend`, `record_manual_expense`
- Stock: `_apply_opname_change`, `decide_supplier_claim`,
  `resolve_supplier_claim`, all 3 warehouse-transfer RPCs
- Period: `set_opening_balance`, `close_fiscal_year`,
  `accrue_period_taxes`

**Effect**: If a tenant flips `enable_dual_write_to_gl = false` (e.g.
during migration cutover or troubleshooting), sales/PI/AR stop
posting but manual entries + stock adjustments continue. Result: an
inconsistent partial ledger.

**Recommended fix**: apply the gate uniformly. Either:
- (a) All flows check `enable_dual_write_to_gl` — safer for staged
  rollout.
- (b) Drop the gate entirely — dual-write is now the design standard;
  the flag is legacy from Phase 0b when the feature was rolled behind
  a switch.

Recommend (b): the flag creates footguns without benefit at current
maturity. All 3 prod tenants currently have the flag `= true` anyway.

---

### W3 — `record_pembayaran` early-payment discount silent

`payload.discount_amount` reduces both `DR 2-1100` and `CR cash_coa`
by the discount value. No income/gain line booked.

**Effect**: If supplier grants a 2% early-payment discount on Rp 10jt
invoice, we pay Rp 9.8jt cash but the discount received (Rp 200k) is
not visible anywhere. AP is settled correctly; but the Rp 200k gain
lands nowhere.

**Debate**: SAK EMKM cash-basis MSMEs commonly treat this as
net-payment (no income recognition). Aggressive accrual/PSAK-full
approach would book: `DR 2-1100 v_amount_total / CR cash v_total_paid
/ CR 4-1230 Pendapatan Diskon (or similar) discount_amount`.

**Recommended**: for MSME founder context, leave as-is BUT add a
comment in the RPC noting the choice for future clarity. If Anda mau
recognize as other income, needs new COA `4-1240 Pendapatan Diskon
Pembelian Cepat` + one-line JE change.

---

### W4 — `resolve_supplier_claim` source_ref_id=NULL breaks linkage

Both `decide_supplier_claim` and `resolve_supplier_claim` pass
`source_ref_id=NULL, source_ref_table=NULL` for their reclass JEs,
citing "uq_je_source_unique conflict avoidance". Linkage stored in
side tables (`supplier_claim_events.journal_entry_id`,
`supplier_claims.resolution_journal_id`).

**Effect**: Journal-to-source drill-down from `journal_entries` alone
is broken for supplier_claim disposition JEs; requires joining
`supplier_claim_events` to reach the claim. Report readers hitting the
JE row cannot tell what claim it came from without cross-referencing.
Same pattern in warehouse_transfer RPCs (I3).

**Recommended**: relax `uq_je_source_unique` to allow (table, id) reuse
across `source_type`, then populate source_ref_id normally. Bigger
refactor; not blocking.

---

## INFO details

### I1 — `resolve_supplier_claim` CASHED contract asymmetry

`p_resolution_target_id text` is passed **verbatim as a COA
`account_code` string** (e.g. `'1-1110'`) rather than the cash_account
UUID pattern used by every other cash-facing flow.

**Effect**: Caller must know the COA hierarchy directly; can't just
pick a cash_account from the picker (which returns cash_accounts.id).
Historic legacy from when the RPC was first shipped.

**Recommended**: accept `p_resolution_target_id uuid` (cash_accounts.id),
resolve to COA internally. Small breaking-change for callers; version
via param name.

---

### I2 — No auto-PPN accrual

`accrue_period_taxes` only posts `TAX_ACCRUAL_PPH` (PPh Final 0.5%
UMKM). PPN Masukan / PPN Keluaran accounts are seeded conditionally
(commented in slot 002) for PKP tenants but no auto-accrual RPC.

**Impact**: Non-PKP MSME tenants (default) are unaffected. Any tenant
that upgrades to PKP status needs manual PPN entries via
`post_manual_journal_adjustment` — no automation.

**Recommended**: defer until first tenant becomes PKP. Track in
project memory.

---

### I3 — Warehouse-transfer source_ref_id NULL

`initiate/receive/cancel_warehouse_transfer` all pass
`source_ref_id=NULL`. Linkage via `warehouse_transfers.
{initiate,receive,cancel}_journal_id`. Same pattern as W4 for
supplier_claim.

**Effect**: Same drill-down break, but scoped to warehouse-transfer.
Design was intentional to match the supplier_claim pattern; internally
consistent.

**Recommended**: fix jointly with W4 in a general JE linkage refactor.

---

## Recommended remediation order

1. **B1 first** — smallest blast radius (only affects tempo w/
   shipping), highest severity (silent JE drop), fastest fix (one
   line + founder decision on account).
2. **B2 second** — GL/stock drift accumulates every opname session.
   Pattern is 1:1 copy from warehouse-transfer PARTIAL fix I just
   shipped.
3. **B4 third** — DP flow. Bigger blast (touches customer-facing
   AWAITING_LUNAS path) but very common transaction type; overstated
   cash affects tenant trust in reports.
4. **B3 fourth** — PASSTHROUGH drift. Documented as known limitation;
   less pressing but keeps AP subledger from ever reconciling to GL.
5. **W2 (dual-write gate)** — cheap; cleans up an accidental footgun.
6. **W1 + I3** — batch with any next tempo/kasir migration touching
   revenue line composition.
7. **W3, W4, I1, I2** — defer to when triggered by real use-case /
   next round of accounting UI work.

Each B* deserves an irreversible-decision memo per CLAUDE.md
`docs/superpowers/specs/YYYY-MM-DD-<slug>-decision.md` if we go for
the fix, since ledger contract changes are semi-reversible to
irreversible.

---

## Followups spawned from this audit

- Memory `coa-null-subtype-anomalies` (already written) — systematic
  hunt for NULL-subtype leaf accounts that silently omit from report
  grouping.
- Task 18 (existing) — `2-1400 Hutang Lain-lain` deferred subtype
  decision.
- Verify empirically via `gl_dual_write_anomalies` prod query how
  often B1 (tempo shipping) fires:
  ```sql
  SELECT COUNT(*), error_code, error_message
    FROM public.gl_dual_write_anomalies
   WHERE source_rpc = 'create_tempo_invoice'
     AND created_at > '2026-01-01'
   GROUP BY error_code, error_message;
  ```
- If B4 (DP) is common in prod: how many `kasir_transactions` with
  `payment_type='DP'` exist? Sizing determines backfill effort.

---

## Method footnote (why this audit is trustworthy)

- Extraction was done by a subagent with instructions to be
  descriptive-only (not judgmental) to keep bias out of raw topology.
- Each of the 4 BLOCKERs was cross-verified by direct code read of
  the live RPC body or the migration file that shipped the current
  logic. No claim rests on a single extraction step.
- Ancillary code paths (RLS policies, permission checks, stock
  movement audits) were deliberately excluded from scope — focus is
  the double-entry topology only.
- Reviewed against SAK EMKM section outlines as they apply to a
  cash-basis MSME with mixed accrual (Piutang Tempo, DP-received,
  Passthrough) — the founder's stated tenant model.

**Not covered**: PDF/report-side aggregation logic, dashboard KPI
computations, individual-transaction reversal correctness for
edge-case flows. These are separate audit passes if requested.
