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
