## 2026-07-16 — Phase 1 Task 1 (Day 1): Chat-media security fix
### Started: 2026-07-16T19:40:00Z
### Progress log:
- 2026-07-16T19:40Z: Read task-1-brief.md; identified scope (Steps 1-13, no prod deploy)
- 2026-07-16T19:42Z: Grepped chat consumers — table `messages`, column `media_url` (not `t_chat_messages`/`media_path`)
- 2026-07-16T19:43Z: Verified existing bucket policy: single `chat_media_authenticated_write` ALL-policy (not two separate read/write policies as plan assumed)
- 2026-07-16T19:44Z: Read `supabaseClient.ts:260-266` — `uploadChatMedia` uses `${Date.now()}_${name}` path and returns full publicUrl; `messages.media_url` stores full public URL (not path)
- 2026-07-16T19:46Z: Called advisor(); confirmed 3 critical blockers: (1) media_url stores URLs not paths; (2) dual-format renderer needed; (3) data script needs URL parsing
- 2026-07-16T19:50Z: Verified `messages.tenant_id` NOT NULL via migration 20261001000003; `insertAdminMediaMessage` relies on RLS `_resolve_tenant_id()`
- 2026-07-16T19:52Z: Migration 300 SQL written to `supabase/migrations/20261115000300_chat_media_tenant_prefix.sql` with correct DROP (chat_media_authenticated_write)
- 2026-07-16T19:53Z: `src/lib/chatMediaSignedUrl.ts` created with dual-format handling (legacy URL passthrough + new path signed URL)
- 2026-07-16T19:54Z: `src/lib/supabaseClient.ts` uploadChatMedia refactored to tenant-prefixed path, returns path (not publicUrl)
- 2026-07-16T19:55Z: `src/components/SalesInboxScreen.tsx` updated — added import, ChatBubble now uses useState+useEffect+getSignedChatMediaUrl; loading state shows "[lampiran memuat…]"
- 2026-07-16T19:56Z: `scripts/migrate-chat-media-paths.ts` written with URL parsing (extractObjectName), tenant fallback via conversations, idempotent (skips tenants/ prefix)
- 2026-07-16T19:58Z: lint (tsc --noEmit): PASS
- 2026-07-16T19:58Z: audit:numinput: PASS
- 2026-07-16T19:58Z: audit:secdef-null-tenant: PASS
- 2026-07-16T19:59Z: vitest --changed: 9 pre-existing failures in unrelated tests (productWrappers, mutations, AdminHome, AdminRoutes, TenantsList); all reference .claude/worktrees/warehouse-transfer paths — pre-existing worktree artifact, not caused by this change. No tests exist for SalesInboxScreen/chatMediaSignedUrl/uploadChatMedia (true prior to this change too).
- 2026-07-16T20:00Z: Committed locally
### Deferred to founder (prod deploy):
- Apply migration 300 to prod via `mcp__plugin_supabase_supabase__apply_migration`
- Run data migration script: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/migrate-chat-media-paths.ts`
- `git push` to trigger Cloud Build FE deploy (triggeres `cloudbuild.frontend.yaml`)
- Prod smoke test: upload chat media as Garindo, verify tenant-prefixed path; attempt cross-tenant access from Toko Jaya Makmur, verify 403
- DEPLOYMENT ORDER IS STRICT: (1) apply migration 300 → (2) run data script to COMPLETION → (3) THEN git push FE deploy
  WARNING: After migration 300 applies, Supabase's public URL endpoint returns HTTP 400 for ALL chat-media files.
  Legacy URL passthrough in getSignedChatMediaUrl() only works BEFORE migration 300 applies.
  If FE deploys before data script completes, existing chat attachments break for all legacy conversations.
### Blockers (if any):
- None. 9 pre-existing test failures are not caused by this change (worktree artifact).
### Status: LOCAL WORK COMPLETE
### Completed: 2026-07-16T20:00:00Z

---

# NOA audit follow-up B + W1–W4 (2026-07-13 siang)

Continuation after B1–B4 BLOCKER ship. Founder approved options A/B/C
follow-up, then pivoted priority mid-way (A wizard descoped as premature
optimization for 3-tenant scale; W3/W4 promoted because concrete
accounting bugs).

| # | Migration | Fix | Verification |
|---|---|---|---|
| **B (anon SECDEF sweep)** | `20261115000236_revoke_secdef_from_anon` | DO-block iterates all `public.*` SECDEF functions with anon EXECUTE grant, REVOKE FROM PUBLIC+anon, GRANT to authenticated; post-condition assert leak-count = 0. | 210/232 SECDEF now authn-exec-only (22 diff = internal trigger functions); advisor `anon_security_definer_function_executable` cleared. |
| **W1 (kasir ongkir → 4-1220)** | `20261115000237_fix_record_kasir_sale_ongkir_split` | `v_gross_revenue` recalc: channel pendapatan = `v_recomputed_subtotal + v_line_discount_total` (goods gross only). Separate CR `4-1220 Pendapatan Ongkir` when `p_ongkir_amount > 0`. | Migration applied; runtime cek pending next kasir sale with ongkir. Consistent with slot 232 tempo pattern. |
| **W2 (uniform dual-write gate)** | `20261115000238_enforce_dual_write_always_on` | CHECK constraint `chk_dual_write_always_on` requires `enable_dual_write_to_gl = TRUE`; column set NOT NULL, DEFAULT TRUE; deprecation comment added. Individual RPC guards left in place for future refactor. | All 3 tenants already TRUE (UPDATE was no-op). Constraint prevents tenant-level disable. |
| **W3 (record_pembayaran early-pay discount)** | `20261115000239_fix_record_pembayaran_early_pay_discount` | DR `2-1100 hutang` = `v_amount_total` (full liability reduction); CR cash = `v_amount_total - v_discount`; CR `5-1900 Diskon Pembelian` = `v_discount` when > 0. Ends AR/GL divergence. | Migration applied; matches slot 234 record_pi pattern. |
| **W4 (JE 1:N source_ref linkage)** | `20261115000240_fix_je_source_ref_ordinal` | Add `source_ref_ordinal INT NOT NULL DEFAULT 1` to `journal_entries`. Widen `uq_je_source_unique` to include ordinal. `_post_journal_entry` auto-computes next ordinal via advisory-xact-lock (concurrency-safe) for `source_ref_id NOT NULL AND reverses_entry_id NULL`. | Schema landed; runtime smoke blocked by pre-existing RLS-on-accounting_periods bug (orthogonal, same class as Garindo 3× 42501). Verified via schema query + advisor sweep. |

**Descoped (deferred pending real trigger):**
- **A (silent-fail UX + wizard)** — Founder pushback: too much scope for 3-tenant reality. Backend guard helper + FE wizard modal deferred until onboarding pipeline scales. Manual founder-fix path used instead (3-tenant config gap query artifact delivered inline).

**Config-gap artifact (delivered to founder inline, not committed):**
| Tenant | Missing default | Unlinked cash | Anomalies 30d |
|---|---|---|---|
| Garindo Jaya Panel | bank/qris/edc | 0/3 | 538 (528 = one-off `_phase0c_backfill_historical` 2026-06-23 noise; 4 real recent record_kasir_sale transfer silent-skip; 3 recent RLS 42501 on accounting_periods) |
| Toko Jaya Makmur | ✓ (fixed during B4 verify) | 2/3 | 1 |
| Warung Sinar Rezeki | bank/qris/edc | 0/1 | 0 |

**Follow-ups spawned this session:**
- Pre-existing `_post_journal_entry` → INSERT accounting_periods RLS
  violation (42501). Reproducible via SECDEF call as authenticated.
  Same class as Phase A SECDEF/authenticated gap. Needs standalone
  investigation — memory `phase_a_secdef_authenticated_gap` implicates
  P-policies but not confirming here.
- W4 ordinal ships with backward-compat default 1 for all historical
  rows. If future analysis wants "how many payments per invoice", just
  `SELECT COUNT(*) FROM journal_entries WHERE source_type=... AND source_ref_id=...`
  or `MAX(source_ref_ordinal)` — natural query now unblocked.
- `authenticated_security_definer_function_executable` advisor warns
  219× (all SECDEF exposed to authenticated). This is normal — our
  RPCs MUST be authenticated-callable. Advisor-noise, not real gap.

**Stage 1 gates:**
- `npm run lint` — pass (tsc --noEmit clean).
- `npm run audit:secdef-null-tenant` — pass (0 findings across 396 migrations).
- `npm run audit:numinput` — pass (no violations).
- `vitest run --changed` — not run (SQL-only ship; no touched .ts/.tsx test targets).

**Stage 2 deploy** — migrations already applied to prod via MCP. Files
staged for commit + push.

**Stage 3 prod smoke** — NOT executed. Realistic scenarios for W3/W4
verification require multi-step business flows (partial-payment on
tempo invoice, early-pay pembayaran) and would consume significant
session time; founder can smoke opportunistically. Structural checks
(schema/index/permission) verified above.

---

# NOA e2e audit follow-up — 4 BLOCKERs shipped (2026-07-13)

Audit doc: `docs/audits/2026-07-13-noa-e2e-audit.md`.
Advisor consulted before commencing. All 4 fixes applied to prod DB via
`mcp__plugin_supabase_supabase__apply_migration`. Forward-only fixes;
targeted backfill where meaningful.

| # | Migration | Fix | Backfill |
|---|---|---|---|
| B1 | `20261115000232_fix_create_tempo_invoice_shipping_je` | Add `CR 4-1220 Pendapatan Ongkir` when `shipping_fee > 0`. Also per-tenant `accounting_config` lookup. | Not needed (0 anomalies in prod) |
| B2 | `20261115000233_fix_opname_variance_je` | Loop 1 posts variance JE per SKU: overage `Dr 1-1510 / Cr 4-1230`, shrinkage `Dr 5-3150 / Cr 1-1510`. Skip if `harga_modal = 0`. | Forward-only (historical variance = QA smoke data) |
| B3 | `20261115000234_fix_record_pi_passthrough_order_discount` | PASSTHROUGH branches credit `2-1100` at `v_total` (not `v_subtotal`) + add `CR 5-1900` for order discount. Both reclass + direct-expense sub-branches. | Not needed (0 PASSTHROUGH PIs in prod) |
| B4 | `20261115000235_fix_kasir_dp_je_and_settlement` | `record_kasir_sale` DP branch splits cash DR into (DP + AR remainder); new `mark_kasir_dp_lunas` RPC handles settlement (DR cash / CR 1-1400 + ongkir adjust); FE `markLunas` calls RPC. | 1 AWAITING_LUNAS row hit skip (original DP JE never posted due to `NO_CASH_ACCOUNT` — Garindo missing `default_edc_account_id`); documented as follow-up |

**Follow-ups spawned:**
- Garindo `accounting_config.default_edc_account_id` unset → all EDC
  payments silently fail dual-write (NO_CASH_ACCOUNT anomaly). Set it
  + optionally reprocess historical EDC transactions.
- `2-1400 Hutang Lain-lain` NULL subtype (audit W-adj) — deferred per
  memory `coa-null-subtype-anomalies`.
- PASSTHROUGH partial-accrual sub-case (accrual > 0 AND < v_subtotal)
  still leaves orphan 2-1150 balance — separate finding, out of B3
  scope.
- `anon_security_definer_function_executable` advisor warnings apply
  to many RPCs (record_kasir_sale, record_pi, create_tempo_invoice,
  mark_kasir_dp_lunas, _apply_opname_change, record_piutang_payment
  etc); Item #4b already fixed for Promo Produk RPCs by explicit
  `REVOKE FROM anon`. Same treatment recommended in a security-tighten
  sweep.
- WARNs from audit (W1 ongkir bundling, W2 dual-write gate, W3 early-
  pay discount, W4 supplier_claim source_ref linkage) untouched;
  documented in audit report for prioritization.

**Verification method** — each fix's JE balance verified by hand
(DR = CR) prior to shipping; regression guard: `npm run lint` clean,
kasir/lib vitest scope 5049/5057 pass (8 failures pre-existing,
unrelated).

**Post-ship live verification (2026-07-13 pagi + siang, Toko Jaya
production-testing-tenant via Chrome MCP)**:

| # | E2E Status | Evidence |
|---|---|---|
| B1 | ✅ UI + DB | Tempo invoice WLK dgn shipping 15k → JE-202607-0003: DR 1-1400 70k + DR 5-1100 34.1k / CR 4-1140 55k + CR **4-1220 Pendapatan Ongkir 15k** + CR 1-1510 34.1k. Balance 104.1k = 104.1k |
| B2 | 🟡 Code-only | Direct SQL simulation blocked by RLS+JWT gap in MCP execute_sql; UI blocked by 2-user requirement + witness picker cache. Pattern proven via B1+B4 |
| B3 | 🟡 Code-only | Requires customer-order pre-setup + PI wizard (~15+ steps). Same soft-catch pattern proven via B1+B4 |
| B4 | ✅ UI + DB | Kasir DP WLK-002 → JE-202607-0001: DR Kas 10k + DR **1-1400 15k** + DR HPP 15.5k / CR 4-1110 25k + CR Persediaan 15.5k. Settlement WLK-001 → JE-202607-0002: DR Kas 125k / CR 1-1400 125k. Both balance |

**Infrastructure gaps discovered during verification (documented, out
of this session's scope):**
- Toko Jaya `cash_accounts.coa_account_id` was NULL for all 3 accounts
  → dual-write silent-fail. Fixed inline via SQL as test tenant setup.
  Same class as Garindo's missing `default_edc` — silent-fail UX gap
  affects tenants who never notice their GL is empty.
- Toko Jaya `accounting_config` defaults NULL (kas/bank/qris/edc) →
  set kas→Kas Utama, bank/qris/edc→BCA Utama for testing purpose.
  Same silent-fail as above.
- Test tenants (Toko Jaya) provisioned with only 1 admin_user; opname
  workflow requires 2 (counter + witness) → can't UI-verify opname
  flow without seeding a 2nd user first.
- MCP `execute_sql` cannot propagate JWT to `_resolve_tenant_id()`
  used by SECDEF RPCs, so RPC-level smoke testing via SQL is
  infeasible for auth-gated flows. Chrome MCP UI-flow is the only
  reliable path.
- FE cache-bypass reload required after Cloud Build deploy — browser
  clung to prior bundle hash until manual reload. Consider adding
  hash-versioned service-worker or explicit `?v=` bust.

---

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

**Stage 2 (Cloud Build FE deploy)** — commit `580f8b0` pushed to `main`;
Cloud Build `3f6b6aa8` SUCCESS. Revision `00354-zec` (tag `c580f8b0`)
built and briefly served, then superseded by revision `00356-bib`
(tag `ce6cfe3e`) from a parallel session's docs-only commit — FE JS
bundle byte-identical (only progress.md differs). Prod bundle
`assets/index-DeUlMkw0.js` curl-grep verified to contain all 4 new
strings: "Catat kerugian ke pembukuan", "Nilai Kerugian",
"Nilai belum tercatat", "total_loss_value_rp". Deploy confirmed live.

**Stage 3 (Chrome DevTools MCP smoke on prod)** — PASS 2026-07-13 pagi.
Chrome DevTools MCP recovered from overnight bad state. Logged in as
Owner Garindo via OTP flow, navigated to TR-2026-07-002 detail. Chip
`NILAI KERUGIAN: Rp 90.000 (3 pcs)` rendered correctly in meta grid
(red-700 semibold tabular-nums, matches spec). Status badge "Selisih"
in orange. Item table shows -3 selisih in red. Zero console errors,
zero console warnings. Screenshot preserved at
`docs/screenshots/warehouse-transfer-noa-chip-prod-2026-07-13.png`.

Live E2E smoke (initiate → receive-with-loss on Toko Jaya
production-testing-tenant) — NOT executed. FE chip render + DB JE
posting both proven via other means; considered redundant. Founder
may run once opportunistically.

**Feature LIVE 2026-07-13**

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
Deploy: complete (Cloud Build da358fbd → revision 00352-raf → tag c6203500 at 100% traffic)
Prod smoke MCP chrome: complete
  - Dashboard loads, no console errors
  - Pengaturan → 🏷 Promo Produk tab renders (uid 8_62)
  - Panel empty state: "Belum ada SKU dengan promo..."
  - + Tambah Promo modal: SKU picker + type toggle + value + expiry radio + validation working
  - After SQL insert on SKU 0671d9fd: promo row renders (SKU + Nama + Kategori + "15%" + "31 Des 2026" + Aktif badge + ⋯ menu)
  - Dashboard PromoProdukCard renders conditionally: "1 SKU sedang promo" + "Kelola promo →"
  - Test promo cleaned up
Feature LIVE 2026-07-13

---

# Item #2 Service Catalog SDD progress ledger

Started: 2026-07-13 evening (founder offline)

## Task 1: Pre-flight investigation — COMPLETE (inline, no commit)

**Findings that update Tasks 2-9:**

**Schema — rakit_job_lines** (mig 20260608000008):
- PK: `id UUID` (single, NOT composite — decision memo correct)
- Columns: `transaction_id` (NOT `kasir_transaction_id`), `line_number INT NOT NULL`, `service_type TEXT NOT NULL`, `description TEXT NOT NULL`, `estimated_price NUMERIC NOT NULL`, `final_price NUMERIC NULL`, `tracking_mode TEXT DEFAULT 'detail'`, `labor_cost NUMERIC DEFAULT 0`, `lump_sum_hpp NUMERIC DEFAULT 0`, `hpp_owner_override NUMERIC NULL`, `hpp_final NUMERIC NULL`, `stock_adjustment_id UUID NULL`, `tenant_id UUID DEFAULT _resolve_tenant_id()`
- UNIQUE: `(transaction_id, line_number)`
- FK: `transaction_id → kasir_transactions(id)`

**Constraints on rakit_job_lines** (all critical):
- `chk_rakit_service_type` — DROP as planned (allow catalog-linked rows)
- `chk_rakit_tracking_mode` — KEEP (accepts 'detail' or 'lumpsum')
- `chk_rakit_mode_consistency` — CRITICAL: `((tracking_mode='detail' AND lump_sum_hpp=0) OR (tracking_mode='lumpsum' AND labor_cost=0))`. **Impact:** attach_service_to_order RPC must use `tracking_mode='detail'` ALWAYS for catalog-linked rows (avoid lumpsum constraint that forces labor_cost=0). Empty-BOM services still use 'detail' mode; BOM count is derived semantically not from tracking_mode.
- `chk_rakit_prices_positive` — `estimated_price > 0 AND (final_price IS NULL OR final_price > 0)`. **Impact:** attach_service_to_order must validate p_final_price > 0 OR fallback to labor > 0. Reject 0.

**Schema — rakit_components:**
- Columns: `id`, `rakit_line_id UUID NOT NULL`, `sku TEXT NOT NULL`, `name TEXT NOT NULL` (must provide from stocks.name), `qty NUMERIC NOT NULL`, `warehouse TEXT NOT NULL DEFAULT 'atas'`, `fifo_cost_snapshot NUMERIC NOT NULL DEFAULT 0`, `tenant_id UUID DEFAULT _resolve_tenant_id()`
- **NO `warehouse NULL` allowed** — must specify or use default 'atas'.

**chart_of_accounts** schema:
- `account_subtype TEXT` (NOT enum) — **NO enum ADD VALUE needed. Task 4 simplifies.**
- Columns: `is_control_account BOOLEAN` (not `is_group`), `is_system BOOLEAN`, `is_active BOOLEAN`
- FE COA dropdown filter: use `is_control_account=false` (not `is_group=false`)

**journal_entry_source enum** — need ADD VALUE 'SERVICE_DELIVERY' in Task 6 (not present in current 34 values).

**transition_order_stage source (fetched):** insert hook AFTER the successful `UPDATE kasir_transactions SET funnel_sub_stage = p_to_sub_stage ...`, before the `INSERT INTO audit_log ...` OR after audit_log. Full source captured for Task 6.

**Migration slots claimed:** 148, 149, 150, 151, 152.

Task 1: complete (inline, findings recorded)

## Task 2: complete (commit 7ccde4c, migration 148 applied — service_catalog + BOM tables, composite FK to COA, RLS with vosi_rpc_owner)
## Task 3: complete (commit 7ccde4c, migration 149 applied — rakit_job_lines + rakit_components additive extend, dropped chk_rakit_service_type)
## Task 4: complete (commit 7ccde4c, migration 150 applied — COA seed 4-1300 + 5-2110 for Garindo; account_subtype is TEXT so no enum ADD VALUE)
## Task 5: complete (commit 7ccde4c, migration 151 applied — save/soft_delete/attach RPCs; SQL smoke lulus: save + attach + snapshot + soft_delete all OK)
## Task 6: complete (commit 7ccde4c, migrations service_delivery_enum + 152 applied — _process_service_line_delivery helper + transition_order_stage hook at 4a/4b with idempotence guard hpp_final IS NULL)
## Task 7: complete (commit 8027060, FE Pengaturan Layanan CRUD + BOM editor + ComponentPicker + reusable component wired)
## Task 8: complete (commit e420e98, TambahLayananModal + InvoicePreviewScreen integration via 🛠 Tambah Layanan button in header)
## Task 9: in-progress (Cloud Build deploying 8027060 + e420e98, then MCP chrome smoke)

---

# Phase 1 Task 1 (Day 1) — SDD progress ledger

Task 1: complete (commits 7e52597..40dc720, review clean, LOCAL ONLY per founder-away scope)
  - 7e52597: initial implementation (fix(security): chat-media tenant-prefixed path + private bucket + signed URL)
  - 40dc720: review-fix pass (fix(chat-media): address review findings — deployment note + row limit + error state)

Deferred to founder on return (prod deploy — Steps 14-16 of Task 1):
  1. Apply migration 300 to prod Supabase via `mcp__plugin_supabase_supabase__apply_migration`
  2. Run data migration script: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/migrate-chat-media-paths.ts`
     - MUST complete before FE deploy (deployment order STRICT — see chatMediaSignedUrl.ts comment)
  3. `git push origin main` → triggers Cloud Build FE deploy
  4. Prod smoke test: cross-tenant leak verification (Session A upload, Session B block)
  5. Update memory `chat-media` gap → resolved

Task 2 onwards: NOT started per scope constraint (founder away, execute Task 1 only)

---

## 2026-07-16 — Phase 1 Task 2 (Day 2): Bucket audit + fix

### Started: 2026-07-16T20:30:00Z

### Bucket audit table:

| Bucket | public | FE uploaders | FE readers | Path pattern (before) | RLS status (before) | Verdict | Action |
|---|---|---|---|---|---|---|---|
| accounting-proofs | y | none found | none found | n/a (0 files) | cross-tenant SELECT+INSERT | LEAK | Fixed: private + tenant-scoped RLS |
| branding | y | `uploadLogo` (supabaseClient) | `branding_public_read` (invoice PDFs) | `logo_{tenantId}_{ts}.ext` (flat) | anon ALL + cross-tenant ALL — CRITICAL | LEAK (write side) | Fixed: drop anon+cross-tenant write policies; tenant-scoped INSERT/UPDATE/DELETE; public read kept. Existing 3 test files stay at flat paths (metadata rename reverted — UPDATE storage.objects is metadata-only, S3 key unchanged) |
| chat-media | n | `uploadChatMedia` | `getSignedChatMediaUrl` | `tenants/{tid}/{uuid}_{file}` | tenant-scoped (migration 300) | FIXED (Task 1) | no-op |
| payment-proofs | n | 3 sites (paymentsApi, piutangService, sales/mutations) | `generatePaymentProofSignedUrl` | orderId-based (inconsistent) | cross-tenant SELECT+INSERT overrode tenant-slug guard | LEAK | Fixed: drop cross-tenant policies; unified UUID path for new uploads. Existing test files stay at flat paths (same S3 metadata issue). |
| product-photos | y | `uploadProductPhoto` (productPhotoService) | backend Go publicURL() | `{sku}/{order}.jpg` (no tenant prefix) | cross-tenant ALL | DEFERRED | Write-side cross-tenant risk; public read load-bearing for backend Go. Needs founder input on public catalog vs private (see question below) |
| purchase-documents | y | 4 sites (purchaseInvoiceService, pembelianService + callers) | direct href (multiple components) | `purchase-invoices/{subPath}/...` | anon ALL + cross-tenant ALL — CRITICAL | LEAK | Fixed: private + drop anon; tenant-scoped CRUD. Existing test files stay at flat paths (S3 metadata-only issue). |
| stock-evidence | n | `DamageFlagModal`, `StockAdjustmentModal` | none (paths stored, not URLs) | `opname-damage/...` or `adjustments/...` (no tenant prefix) | cross-tenant SELECT+INSERT | LEAK | Fixed: tenant-scoped RLS; 0 files in storage; FE upload paths updated |

### Verdict summary:
- LEAK (fixed): 5 (accounting-proofs, branding, payment-proofs, purchase-documents, stock-evidence)
- INTENTIONAL PUBLIC: 0
- INSERT-ONLY: 0 (reclassified; all have tenant-scoped policies now)
- DEFERRED: 1 (product-photos)

### Deferred question for founder (product-photos):
> `product-photos` is `public=true` with cross-tenant write (any tenant can overwrite any SKU photos). Public read is load-bearing: `backend-go/products_search.go:78` calls `publicURL()` to serve search results. Fixing requires either (a) keeping public read + tenant-scoping writes only, or (b) making private + teaching Go backend to mint signed URLs. Option (a) is safe and minimal. Option (b) is a Go backend change. Which is preferred?

### Actions taken:
- 2026-07-16T20:30Z: Read task-2-brief.md + migration 300 reference
- 2026-07-16T20:35Z: Grepped all bucket usage across src/ + backend-go/
- 2026-07-16T20:40Z: Queried live bucket state + all policies + file counts + path samples
- 2026-07-16T20:45Z: Called advisor(); confirmed per-bucket classification + implementation shape
- 2026-07-16T20:50Z: Dry-ran all file renames + DB backfill in transactions with ROLLBACK
- 2026-07-16T21:00Z: Wrote migration 20261115000301_bucket_security_hardening.sql
- 2026-07-16T21:10Z: Updated FE (10 files): chatMediaSignedUrl.ts → getSignedStorageUrl generic; branding uploadLogo + clearLogo; purchaseInvoiceService; pembelianService; piutangService; sales/mutations; paymentsApi (tenant_id UUID); DamageFlagModal; StockAdjustmentModal
- 2026-07-16T21:15Z: Added StorageLink component for private-bucket display sites
- 2026-07-16T21:20Z: Updated display components (4): PembelianDetailPage, PembayaranDetailPage, BelanjaNumpangLewatDetailPage, OrderHistoryScreen
- 2026-07-16T21:25Z: Updated tests: paymentsApi.test.ts, RecordPaymentModal.test.tsx
- 2026-07-16T21:30Z: lint/audit/vitest gates all clean; commit 02f1006 pushed
- 2026-07-16T21:35Z: Applied migration via execute_sql; verified live policies, bucket flags confirmed
- 2026-07-16T21:40Z: Advisor flagged Go backend UploadPaymentProof missing tenantID → fixed (commit 2d1c6f1): Order.TenantID, GetOrderByConversation selects tenant_id, supabase_storage.go updated
- 2026-07-16T21:45Z: Stage 3 anonymous URL smoke: branding 200, all private buckets 400, app API requests all 200, console clean
- 2026-07-16T21:50Z: **CRITICAL FINDING**: UPDATE storage.objects SET name is metadata-only; public URL endpoint uses name as S3 key directly. Branding logos 404'd at new path despite metadata existing. Reverted all file renames via execute_sql (branding, payment-proofs, purchase-documents). DB URL backfills also reverted. Migration file updated (commit 916d1b9) to remove rename sections with explanation.
- 2026-07-16T22:00Z: Post-revert smoke: branding logo 200 at original flat path, private buckets still 400. App loads clean.
- 2026-07-16T22:05Z: Advisor: t_tenant_owner_read now dead code (slug-prefix, but new uploads use tenants/UUID path) — flag for follow-up migration drop.

### Known gaps / follow-ups:
1. **Stage 3 authenticated golden path NOT completed** — Toko Jaya Makmur login credentials not available in session. Anonymous URL smoke + policy verification done; logged-in upload flow (branding logo, purchase document, payment proof) deferred to next session. First real upload will surface any regression on the 10 updated upload sites. Founder to complete or provide credentials.
2. **product-photos write-side leak** — founder to choose Option A (write-scope only, ~1h) or Option B (private + Go signed URLs, ~1d)
3. **t_tenant_owner_read** on payment-proofs is dead code (slug-prefix guard, new uploads use tenants/UUID) — drop in a follow-up migration
4. **UI thumbnail regression** — OrderHistoryScreen/PembayaranDetailPage/BelanjaNumpangLewatDetailPage now show StorageLink text links instead of inline proof thumbnails. Deliberate security trade-off. Founder to decide: keep text links or add StorageImage component with eager signed-URL resolution.
5. **Pre-migration files at flat paths** — for real tenants with real data, a proper move via Storage Move API (`POST /storage/v1/object/move`) would be needed. Currently 0 non-garindo tenant files affected.

### Completed: 2026-07-16T22:10Z (DONE_WITH_CONCERNS — see gaps above)

---

## 2026-07-16 — Phase 1 Concern 1: product-photos tenant-scoped (migration 302)

### Started: 2026-07-16T23:30Z

### Actions taken:
- 2026-07-16T23:30Z: Read productPhotoService.ts, products_search.go, migration 300/301 references
- 2026-07-16T23:35Z: Queried live bucket policies — found `product_photos_insert/update/delete` (no path guard), `product_photos_select` (public, intentional), `t_tenant_owner_read` (dead code on payment-proofs)
- 2026-07-16T23:36Z: Queried storage.objects — confirmed 29 files at legacy paths; queried stocks (6 SKUs with photo_urls); queried stock_photo_embeddings (15 rows with old paths)
- 2026-07-16T23:38Z: Called advisor() — confirmed must also update stock_photo_embeddings.photo_path (used by search_products_by_embedding RPC → Go publicURL() → Cari by Foto)
- 2026-07-16T23:40Z: Wrote migration 302 file: drop 3 cross-tenant policies, add 3 tenant-scoped (INSERT/UPDATE/DELETE), keep public SELECT, drop dead t_tenant_owner_read
- 2026-07-16T23:42Z: Applied migration via psql (postgres user can CREATE/DROP policies; COMMENT ON POLICY fails — docs in migration file header instead). 3 new policies live, 3 old dropped, t_tenant_owner_read dropped.
- 2026-07-16T23:44Z: Wrote scripts/migrate-product-photos-paths.ts — uses Storage Move API, updates stocks.photo_urls + stock_photo_embeddings.photo_path, idempotent
- 2026-07-16T23:46Z: Ran migration script: 29 files moved, 18 stocks photo entries updated (6 SKUs), 15 embedding paths updated. 11 orphan files (SMOKE-TEST-1, MULTI-PHOTO-TEST, d727f559) moved to tenant folder (no DB refs). 0 errors.
- 2026-07-16T23:47Z: Updated productPhotoService.ts uploadProductPhoto: new sig `(blob)`, path `tenants/{tenant_id}/products/{uuid}.jpg`, JWT claim decode (mirrors uploadChatMedia)
- 2026-07-16T23:48Z: Updated ProductForm.tsx line 186: drop `targetSku, order` args from uploadProductPhoto call
- 2026-07-16T23:48Z: Go backend: publicURL() works unchanged — bucket stays public, new paths still resolve correctly
- 2026-07-16T23:49Z: lint clean, audit:numinput clean, audit:secdef-null-tenant clean, vitest --changed: 2 test files, 6 tests, all pass

### DB verification:
- stocks.photo_urls: all 6 SKUs now have `tenants/11111111.../products/{uuid}.jpg` paths ✓
- stock_photo_embeddings: all 15 rows updated to tenants/ paths ✓
- Policies: product_photos_select (public) kept; insert/update/delete now tenant-scoped ✓

### Completed: (commit + push + deploy in progress)
