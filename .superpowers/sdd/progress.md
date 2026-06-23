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
