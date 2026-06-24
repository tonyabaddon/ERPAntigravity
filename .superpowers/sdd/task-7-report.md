# Task 7 Report — Kasir Pill Toggle + Auto-Apply + Re-Compute

**Status:** DONE

**Files modified:**
- `src/lib/supabaseClient.ts` — added `price_grosir?: number | null` to `SupabaseStockItem` (was missing → TS errors)
- `src/components/penjualan/CatatPenjualanWizard.tsx` — `activeTier`/`tenantSettings` state, auto-apply on customer change, re-compute cart on tier switch, tier-aware `addItem`, pass props to Step2Items
- `src/components/penjualan/wizard/Step2Items.tsx` — tier pill `[Eceran|Grosir]` in cart header, pass activeTier/showTierPill to CartRows
- `src/components/penjualan/CartRows.tsx` — per-line amber warning when grosir active but price_grosir is null

**Files created:**
- `src/components/penjualan/wizard/Step2Items.test.tsx` — 7 RTL tests

**Test summary:** 476/476 PASS (469 baseline + 7 new Task 7 tests)

**Concerns:** 
- Tests placed in Step2Items (not KasirScreen) because KasirScreen is a transaction log, not the cart component.
- Re-compute zeroes stale per-line discounts on tier switch (safe: operator must re-enter if needed).
