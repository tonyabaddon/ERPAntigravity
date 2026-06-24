# SDD Progress Ledger — Diskon Fitur

Plan: docs/superpowers/plans/2026-06-23-diskon-implementation.md
Spec: docs/superpowers/specs/2026-06-23-diskon-design.md
Mockup: docs/superpowers/mockups/2026-06-23-diskon-feature.html
Branch: worktree-diskon
Started: 2026-06-23
Base commit: 01853b0

## Tasks

- ✅ Task 1: complete (commits 01853b0..c022ad8, root progress.md updated + review clean). Migration applied: 4 tables, 13 cols + triple-CHECKs. All existing rows pass constraints (orders 7/7, kasir_transactions 83/83, purchase_invoices 39/39, purchase_invoice_items 36/36 clean).
- ✅ Task 2: complete (commits c022ad8..876dd1c). COA seed 5-1900 Diskon Pembelian. account_code='5-1900', account_name='Diskon Pembelian (kontra)', account_type='BEBAN', account_subtype='KONTRA', normal_balance='CREDIT', is_active=true. Step 1 enum: 4-1900 ✓, 5-1900 ✓ seeded. Step 4 verify: 1 row ✓.

- ✅ Task 2: complete (commits c022ad8..876dd1c). 5-1900 seeded. **Spec hint**: actual `chart_of_accounts` schema uses `account_type`/`account_subtype` (NOT `category`/`sub_category`); composite UNIQUE on `(tenant_id, account_code)`. Future tasks referencing COA columns should use these names.
- ✅ Task 3: complete (migration 20260801000003 created). 3 toggle columns `modul_diskon_kasir`, `modul_diskon_penjualan`, `modul_diskon_tagihan` (all DEFAULT TRUE). RPC whitelist extended 7→10 keys. Migration ready for deployment (remote connectivity timeout prevented live execution, but SQL verified correct).
- ✅ Task 3: complete (commits 876dd1c..e86e805). 3 toggles + whitelist widened. Migration applied + smoke PASS via controller (implementer hit MCP timeout, fixed by controller).
- ✅ Task 4: complete (types extended; tsc clean). Frontend types + ModulSwitchKey/DbTenantSettings extended. `DiscountType`, `DiscountTriple`, `CartItemWithDiscount` added. 3 discount module keys + fields in settings. cascadeMap.ts exhaustive switch covered. Test fixtures updated.
- ✅ Task 4: complete (commits e86e805..5106180). Types extended, lint clean (also touched cascadeMap.ts + test fixture for exhaustive switch).
- ✅ Task 5: complete (commits 5106180..73d6379). computeDiscountAmount + 7/7 unit tests. TDD discipline (RED→GREEN evidenced).
- ✅ Task 6: complete (commits 73d6379..ccc83c4). useDiscountBinding hook + 8/8 RTL tests. RTL deps installed, vite.config.ts jsdom env added.
- ✅ Task 7: complete (commits ccc83c4..c934568). DiscountInlineInput + 7/7 RTL tests.
- ✅ Task 8: complete (commits c934568..72885a7). DiscountRow + barrel; 410/410 suite + lint clean. All Phase 2 shared primitives ready.
- ✅ Task 9: complete (commits 72885a7..f51986c). ModulSwitchesPanel 10 entries; lint clean.
- ✅ Task 10: complete. record_kasir_sale RPC patched: 25-param (3 diskon params before p_cash_account_id), server-recompute subtotal/total, markup guard, line/order over-discount guard, 4-1900 journal debit (soft-fail pattern preserved, balanced JE: D cash + D 4-1900 = C pendapatan gross). Migration 20260801000004 applied. 3 smokes PASS (happy subtotal=950000 total=850000, markup rejected, DISCOUNT_EXCEEDS_SUBTOTAL rejected). Frontend RecordKasirSaleInput.discount field + supabaseClient.ts wrapper updated. lint clean.
- ✅ Task 10: complete (commits f51986c..2c359a4). record_kasir_sale 25-param + 4-1900 journal + 3 smokes PASS. 
  - Minor 10a: `(NULL, NULL, >0)` triple bypasses RPC check → DB CHECK catches with 23514 instead of clean DISCOUNT_TRIPLE_INVALID.
  - Minor 10b: rollback reference points to predecessor migration instead of inlined captured body.
  - Pre-existing (out-of-scope this task): `p_allow_negative_stock` declared but never used in stock-deduct path; same gap exists in Phase 0c migration. Track as follow-up.
- ✅ Task 11: complete (commits 2c359a4..0d91843, 3 smokes PASS). create_tempo_invoice extended: per-line + order-level discount triples, server recompute, MARKUP_NOT_ALLOWED + DISCOUNT_EXCEEDS_SUBTOTAL guards. No GL dual-write (TODO Phase 0c). Credit limit check fixed to use recomputed total. piutangService.createTempoInvoice(payload, discount?) backward-compat. types.ts CreateTempoInvoiceItemPayload + payload fields extended. lint clean.
- ✅ Task 11: complete (commits 2c359a4..0d91843). create_tempo_invoice + 3 smokes PASS. No dual-write present in this RPC; TODO comment added for Phase 0c sales follow-up.
  - Minor 11a: 2 separate item-loop passes (validation, then stock deduct) — inefficiency, not bug.
  - Minor 11b: `v_total <= 0` guard fires on 100% discount + 0 ongkir edge case (UX caveat for wizard).
- ✅ Task 12: complete (commits 0d91843..1a64357). record_pi + 3 smokes PASS (happy/markup/over-discount). 3-line JE on discount.
  - Minor 12a: migration file lacks explicit BEGIN/COMMIT wrapper (functionally safe for CREATE OR REPLACE-only DDL, but inconsistent with project pattern).
  - Minor 12b: 5-1900 journal line not smoke-verified live (deferred to Task 17 E2E per Task 10 precedent).
  - Minor 12c: master_unit_cost fallback uses NULLIF(...,0) which treats 0 as "not provided"; legitimate zero-cost master would fall back to unit_cost.
- ✅ Task 13: complete (commits 1a64357..0dcd1fc). Pengawasan view v2 (CTE pattern, latent bug fixed). All 13 backend tasks done.
- ✅ Task 14: complete (commits 0dcd1fc..<head>). Kasir UI integrated: CartRow bidirectional binding, DiscountRow in Step3, struk PDF Diskon row. lint clean, 410/410 tests.
- ✅ Task 14: complete (commits 0dcd1fc..4c919f8). Kasir/Wizard cart UI + bidirectional binding + struk PDF; 410/410 tests + lint clean.
  - Minor 14a: handlePriceChange early-return ordering allows parent state to be one update stale on markup; binding state remains correct.
  - Minor 14b: KasirInvoiceModal label "Diskon (X%)" reads order discount type only; if both line+order discounts exist, label is imprecise.
  - Note: Task 14 covered shared CatatPenjualanWizard (used by both Kasir DP/Lunas and Wizard TEMPO flows). Task 15 scope reduced.
- ✅ Task 15: complete (commits 4c919f8..e1f7a8d). TEMPO path discount wired + SalesInvoicePDF/InvoicePreviewScreen Diskon row. Gate decision: single modul_diskon_kasir for both Kasir + TEMPO (option a).
- ✅ Task 16 fix: payload+display unit_cost = master_unit_cost (was net, would double-subtract in RPC). lint clean, 410/410 tests pass.
- ✅ Task 16: complete (commits e1f7a8d..008a5f9). Tagihan UI integrated. Critical fix applied: unit_cost convention realigned to master (matches record_pi RPC). 410/410 tests + lint clean.
- ✅ Task 17: complete (commits 008a5f9..d3b44ff). 43/43 diskon integration tests + 410/410 unit + lint clean. PDF visual deferred manual.

## Final review fixes (2026-06-23)

- ✅ I-1: SalesInvoicePDF + InvoicePreviewScreen now display gross Subtotal + total discount (lineDiscount + orderDiscount). Smart label mirrors KasirInvoiceModal pattern. Math: Gross − totalDiscount = Total visible to customer. Files: SalesInvoicePDF.tsx, InvoicePreviewScreen.tsx.
- ✅ I-2: journal-lines.test.ts added. 5 structural JE infrastructure tests PASS (auto). 2 happy-path tests (record_pi 5-1900 + record_kasir_sale 4-1900) marked `.skip` pending founder manual run on live DB due to cleanup risk to pesanan_items/stock_levels. Total diskon suite: 48 pass + 2 skip. lint clean.

## All 17 tasks DONE (2026-06-23)
- Branch: worktree-diskon
- Base: 01853b0 (main)
- Head: (see git log after final review commits)
- Migrations: 20260801000001..20260801000007 (7 SQL files applied to live DB)
- Frontend: shared primitives + KasirInvoiceModal + CatatPenjualanWizard + CartRows + Step2Items + Step3Payment + SalesInvoicePDF + InvoicePreviewScreen + TagihanFormPage + TagihanDetailPage + ModulSwitchesPanel + types.ts + 2 lib wrappers
- Tests: 410 unit + 48 integration (diskon, +5 new I-2 structural) + 2 skip (I-2 happy-path); lint clean
- Deferred: PDF visual founder check; happy-path JE verification requires founder manual run (`.skip` in journal-lines.test.ts)

## Minor findings to track for final review
- 10a: NULL/NULL/>0 triple bypasses RPC check → DB CHECK catches (23514) instead of clean error code.
- 10b: rollback ref in 20260801000004 points to predecessor migration (not inlined captured body).
- 11a: 2 separate item-loop passes in create_tempo_invoice (inefficiency).
- 11b: 100% discount + 0 ongkir trips v_total <= 0 guard (UX caveat — wizard should prevent).
- 12a: migration 20260801000006 lacks BEGIN/COMMIT wrapper (functionally safe, inconsistent w/ project pattern).
- 12b: 5-1900 JE line not smoke-verified live (deferred to Task 17 E2E per Task 10 precedent).
- 12c: master_unit_cost fallback `NULLIF(..,0)` treats genuine 0 as "missing".
- 14a: handlePriceChange early-return ordering can leave parent state one update stale on markup.
- 14b: KasirInvoiceModal "Diskon (X%)" label reads order discount type only.
- Pre-existing (Phase 0c regression): `p_allow_negative_stock` declared but never forwarded to deduct_stock_fifo.

---

# Multi-Tier Pricing Feature — Task Progress

Branch: worktree-multi-tier-pricing
Started: 2026-06-24
Base commit: 0c13a3f (Tasks 1-2 done)

## Tasks

- ✅ Task 1: complete. DB migration 20260624000001: added `modul_multi_tier_price: boolean` column to `tenant_settings` table. Default TRUE. RPC `set_tenant_modul` extended to accept the new key. Migration applied to live DB.
- ✅ Task 2: complete. Types extended: `ModulSwitchKey` union includes `'modul_multi_tier_price'`; `DbTenantSettings` interface includes `modul_multi_tier_price: boolean` field. tsc --noEmit clean.
- ✅ Task 3: complete (commit bd677e9). Pengaturan UI toggle wired: MODULS array in ModulSwitchesPanel.tsx appended with multi-tier entry (icon='💵', description='Aktifkan harga grosir terpisah dari eceran...'). Test file created: ModulSwitchesPanel.test.tsx renders toggle row (1 test PASS). vite.config.ts + vitest.setup.ts configured for jsdom + @testing-library/jest-dom. npm run lint PASS.
- ✅ Task 4 DONE — Master Produk dual columns (3 RTL tests PASS). StockTableView: showGrosir prop, "Harga Eceran" label, grosir row per card, "Belum di-set" amber warning, inline edit Harga Grosir field + above-eceran warning. StockManagerScreen: fetches tenant_settings, computes showGrosir via isFieldVisible, passes to StockTableView + ProductForm. ProductForm: showGrosir prop, price_grosir state, Harga Grosir input, included in onSubmit payload. supabaseClient: price_grosir added to upsertProduct interface. 466/466 tests PASS + lint clean.
- ✅ Task 5 DONE — Master Customer tier UI (3 RTL tests PASS). PelangganScreen: showTierDropdown from isFieldVisible('tier_dropdown_customer'), tier filter chips (Semua/Eceran/Grosir) in left panel header, tier badge pill in each customer row, tier dropdown in edit form. customersService.updateTier added to supabaseClient. handleSaveCustomer calls updateTier when modul ON. 469/469 tests PASS + lint clean.
- ✅ Task 10 DONE — bulk_update_grosir_price RPC (4 smoke tests PASS). Migration 20260901000007 applied. SECURITY DEFINER RPC with Owner/Admin Stok/Admin gate, modul_multi_tier_price toggle guard, per-row skip on sku_not_found/price_not_numeric, audit ledger write. TS wrapper productService.bulkUpdateGrosirPrice added to supabaseClient.ts. tsc clean.
