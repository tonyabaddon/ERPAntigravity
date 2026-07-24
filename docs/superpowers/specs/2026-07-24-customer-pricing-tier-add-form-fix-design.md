# Customer Pricing Tier — Add-Form Fix (Phase 1a)

**Date:** 2026-07-24
**Author:** Claude (paired with founder)
**Status:** Design approved, awaiting spec review
**Scope:** Phase 1a of a 3-phase pricing-tier roadmap

---

## Roadmap context

| Phase | Scope | Session |
|---|---|---|
| **1a (this spec)** | Add-customer form exposes a `default_pricing_tier` control; edit form unified to pills | This one |
| **1b (separate)** | Owner-configurable **N tiers** via Pengaturan (drop 2-tier hardcoding — data-model change, irreversible-architectural memo required) | Next brainstorm |
| **2 (deferred)** | SKU-quantity tiering (e.g., beli >5 → harga special) | Later |

Phase 1a is the small, low-risk bleeding-stopper. It ships this week and unblocks tenants who need wholesale customers created correctly today. Phase 1b handles the deeper data-model work in its own memo.

---

## Problem

The `customers` table has a `default_pricing_tier` column (`TEXT NOT NULL DEFAULT 'eceran' CHECK IN ('eceran','grosir')`, migration 20260901000002). The sales-quotation wizard reads that column and auto-picks harga eceran vs harga grosir for each line item (`src/components/penjualan/CatatPenjualanWizard.tsx:139-181`).

But the add-customer form (`src/components/penjualan/wizard/NewCustomerInlineForm.tsx`) has **no tier field**. Every new customer silently gets the DB default `'eceran'`. Wholesale customers look retail until someone opens the edit modal and switches the tier dropdown — a control that's itself gated behind `modul_multi_tier_price` and easy to miss.

Result: on tenants with multi-tier enabled, wholesale customers are miscategorized at creation and quoted retail prices until manually corrected.

## Non-goals (Phase 1a)

- Configurable number of pricing tiers (Phase 1b).
- SKU-quantity-based tiers / volume discounts (Phase 2).
- Backend Go WA-onboarded customer path (`backend-go/internal/db/customers.go:22`) — untouched; keeps DB default `'eceran'`.
- Auto-fix / auto-migration of existing miscategorized customers (Phase 1a ships a read-only audit query only).
- New design tokens or new pill component variants.

## Solution

Add a `Harga:` segmented-pill control (`[ Eceran ][ Grosir ]`, Eceran preselected) to `NewCustomerInlineForm`, gated by the existing `modul_multi_tier_price` flag via `isFieldVisible('tier_dropdown_customer', tenantSettings)`. Pass the selected tier through `insertNewCustomer` into the `customers` insert row. Replace the existing dropdown in the edit modal (`PelangganScreen.tsx`) with the same pills for add/edit parity.

### UI

```
Nama:  [ Budi Santoso        ]
WA:    [ 0812xxxx             ]
Toko:  [ Toko Berkah          ]   ← optional
Alamat:[ Jl. Anggrek No. 5    ]   ← optional
Harga: [ Eceran ][ Grosir ]      ← only when modul_multi_tier_price = TRUE
       └─ Eceran preselected

[ Batal ]              [ Simpan ]
```

- Same visual on standalone Pelanggan modal and inline wizard form.
- Pill styling matches the existing kasir tier toggle (`tier_pill_kasir`) — no new design tokens.
- Label `Harga:` follows the existing form's label convention.

### Data flow

```
NewCustomerInlineForm
  state:  tier: 'eceran' | 'grosir'   (default 'eceran')
  gate:   isFieldVisible('tier_dropdown_customer', tenantSettings)
    ↓ on Simpan
insertNewCustomer({
  name, wa_number, company, address,
  default_pricing_tier?: 'eceran' | 'grosir'
})
    ↓
customers row insert: { ..., default_pricing_tier: args.default_pricing_tier ?? undefined }
    ↓ if undefined, DB default 'eceran' fires (existing behaviour)
```

Backward-compatible: when the modul is off, `insertNewCustomer` is called without the tier arg, the row omits the field, DB default fires. Zero surface change for tenants without multi-tier.

## Files to touch

| # | File | Change |
|---|---|---|
| 1 | `src/components/penjualan/wizard/NewCustomerInlineForm.tsx` | Add pills UI + state; pass tier to `insertNewCustomer` |
| 2 | `src/lib/customers/customerWrappers.ts` | `insertNewCustomer` accepts optional `default_pricing_tier`; row includes it |
| 3 | `src/components/PelangganScreen.tsx` | Replace tier dropdown with the same pills used in add form |
| 4 | `src/components/PelangganScreen.test.tsx` | Add tests: pills render when flag on, hidden when off, tier persists through save |
| 5 | `scripts/audit-misclassified-customer-tier.sql` | Read-only audit; run per-tenant, surface list to founder |
| 6 | `progress.md` | Log the fix + link to this spec |

No migration, no RPC change, no CHECK-constraint change. Only frontend + audit query.

## Regression risk

| Path | Behaviour before | Behaviour after |
|---|---|---|
| Tenant with `modul_multi_tier_price = FALSE` | No tier UI anywhere | No tier UI (unchanged) |
| Frontend add-customer form | Silently default eceran | User picks; default eceran when no pick |
| Frontend edit-customer form | Dropdown gated by flag | Pills gated by flag (visual only) |
| Backend Go WA-onboarded customer | DB default eceran | DB default eceran (unchanged) |
| Sales quotation auto-sync | Reads `customer.default_pricing_tier` | Same reader; now sees correct value from start |
| Kasir tier toggle | Reads `customer.default_pricing_tier` | Same reader; now correct from start |
| CHECK constraint on column | `IN ('eceran','grosir')` | Unchanged |

## Testing

### Stage 1 — Vitest (blocking)
1. `PelangganScreen.test.tsx`: pills render when `tenant_settings.modul_multi_tier_price = TRUE`, hidden when `FALSE`.
2. Tier state defaults to `'eceran'` on mount.
3. Selecting `'grosir'` + Simpan → `insertNewCustomer` called with `default_pricing_tier: 'grosir'`.
4. Existing `PelangganScreen.test.tsx` assertions still pass.

### Stage 3 — Manual smoke on Toko Jaya Makmur (prod-testing tenant)
1. Enable `modul_multi_tier_price` → add customer with tier=Grosir → open sales quotation for that customer → confirm line auto-picks `price_grosir` on product add.
2. Disable modul → confirm no tier UI in add/edit forms; kasir tier toggle also hidden (existing gate; regression check).
3. Backend Go WA-onboarded smoke: create a WA-triggered customer → confirm defaults to eceran (unchanged path).

### Audit query (post-ship, read-only)

```sql
-- Run per-tenant. Surfaces likely-misclassified wholesale customers.
SELECT id, name, company, allows_tempo, created_at
FROM public.customers
WHERE tenant_id = $1
  AND default_pricing_tier = 'eceran'
  AND (
    (company IS NOT NULL AND company <> '')
    OR allows_tempo = TRUE
  )
ORDER BY created_at DESC;
```

Not an auto-fix. Founder / tenant owner reviews the output and edits from PelangganScreen. UI badge for "review tier" is out of Phase 1a scope (Phase 1b territory).

## Impact analysis

1. **Direct importers of `NewCustomerInlineForm`** — 2:
   - `src/components/PelangganScreen.tsx` (opens in "+ Tambah Pelanggan" modal)
   - `src/components/penjualan/wizard/*` (inline in the sales wizard)
2. **Callers of `insertNewCustomer`** — 1 (`NewCustomerInlineForm.tsx:29`). No other paths.
3. **Tests that exercise the changed code** — `src/components/PelangganScreen.test.tsx` (existing).
4. **DB touchpoints** — direct client insert on `customers` (no RPC); reads `tenant_settings.modul_multi_tier_price` via `isFieldVisible`.
5. **Second write path** — `backend-go/internal/db/customers.go:22` (WA onboard). Left untouched; DB default fills tier.
6. **Verdict** — 1 primary call site, 2 render sites, 1 test file, 2 write paths (one changed, one unchanged by design). Plan covers all.

## Adversarial critique

- **Auto-default from `company` non-empty → grosir?** Rejected. Memory `no_fake_numbers` and `push_back_dont_follow` argue against silent smart-guesses on a price-impacting field. Explicit user choice, always default eceran.
- **CHECK constraint stays `IN ('eceran','grosir')`?** Yes — no schema change in 1a. Phase 1b will drop the CHECK and replace it with a per-tenant tier table.
- **Direct client insert without SECDEF?** Verified safe: `customers` is not `t_*`-prefixed; existing insert works in production today. `guard_expiry_write_broken_predicate` memory doesn't apply here.
- **Backend Go WA path skipped?** Deliberate. WA-onboarded customer entering as retail is correct default behaviour; tenant edits from Pelanggan Screen if the customer later reveals as wholesale. Wiring tier into the Go path is Phase 1b territory once tier configuration is dynamic anyway.
- **`isFieldVisible('tier_dropdown_customer')` reuse?** Verified maps to `modul_multi_tier_price` (`src/lib/pengaturan/cascadeMap.ts:30-47`). Same flag as the edit dropdown → guaranteed consistent visibility across add and edit forms.
- **Add and edit forms now use two different components?** Pills are a small standalone component reused in both. No duplicate state or logic.

## I verified

- `grep insertNewCustomer src/` = 1 call site (`NewCustomerInlineForm.tsx:29`) + 1 definition (`customerWrappers.ts:9`). No other create paths in the frontend.
- `grep INSERT INTO customers backend-go/` = 1 hit (`backend-go/internal/db/customers.go:22`) — the WA onboard path; sets only `id`, `tenant_id`, `wa_number`. Confirmed second write path exists and is intentional.
- `grep create_customer supabase/migrations/` = zero SECDEF RPC. Direct client insert is the only frontend write path.
- Migration `20260901000002_multi_tier_customers_columns.sql:3` — column exists with `DEFAULT 'eceran'` + `CHECK IN ('eceran','grosir')`.
- Migration `20260901000003_multi_tier_tenant_settings_toggle.sql:3` — `modul_multi_tier_price BOOLEAN NOT NULL DEFAULT FALSE`.
- `src/lib/pengaturan/cascadeMap.ts:30-47` — `isFieldVisible('tier_dropdown_customer', s)` returns `s.modul_multi_tier_price`.
- `src/components/penjualan/CatatPenjualanWizard.tsx:139-181` — reads `customer.default_pricing_tier` and auto-syncs the active tier toggle at line-add time.

## Confidence marking

- **[VERIFIED]** All findings under "I verified" above.
- **[VERIFIED]** Sales quotation and kasir tier toggle both read `customer.default_pricing_tier` today; correct value at create-time removes the need for manual overrides during quoting.
- **[REASONED]** Pill parity between add and edit reduces mental-model tax; consistent with design-system discipline. Not empirically measured.
- **[REASONED]** Backend Go WA path safe to leave — DB default fires; no functional regression. WA-onboarded customers are retail-by-default is the right semantic.
- **[REASONED]** Audit query heuristic (`company` non-empty OR `allows_tempo=true`) captures the plausible-wholesale signals available today. May produce false positives; tenant reviews manually.

## Definition of done (Phase 1a)

- All Stage 1 gates green: `npm run lint`, `npm run audit:numinput`, `npm run audit:secdef-null-tenant`, `npm run audit:csp-backend-allowlist`, `npx vitest run --changed`.
- Vitest tests added and green.
- Stage 3 manual smoke completed on Toko Jaya Makmur; both `modul=on` and `modul=off` paths verified.
- `progress.md` updated with WHAT + WHY, linking this spec.
- Audit query saved at `scripts/audit-misclassified-customer-tier.sql` and executed once for the founder's active tenants; output surfaced to founder (no auto-fix).
- No `advisor()` gate needed for the implementation step — diff is small (<100 lines, ≤4 files), reversible/tactical, no RLS/SECDEF change, no migration. Advisor was consulted during the design phase (this spec).

## Follow-ups (out of scope, tracked)

- **Phase 1b**: brainstorm session for owner-configurable N tiers. Requires irreversible-architectural memo covering: data model (normalized `product_prices` table vs JSONB vs N columns), tenant-scoped tier definitions (`tenant_pricing_tiers`), migration of existing 2-tier data, RPC surface changes, quotation UI generalization, kasir UI generalization.
- **Phase 2 (deferred)**: SKU-quantity-based tiers.
- **Audit follow-up**: after audit query runs, decide whether Phase 1b should include a UI badge/filter for likely-misclassified customers on the Pelanggan Screen list.
