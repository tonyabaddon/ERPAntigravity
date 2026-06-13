# Configurable Sales Channels — Validation Checklist

Once migrations applied to dev DB, walk through this checklist to verify the implementation.

## DB Migration Application

Apply migrations in order (these were created during implementation, NOT applied yet):

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
supabase db push
```

Expected: 7 new sales-channels migrations apply cleanly:

- `20260613000010_sales_channels_phase_a_schema.sql`
- `20260613000011_sales_channels_phase_a_rename.sql`
- `20260613000012_sales_channels_phase_a_settings_table.sql`
- `20260613000013_sales_channels_phase_a_helper.sql`
- `20260613000020_sales_channels_phase_b_seed.sql`
- `20260613000021_sales_channels_phase_b_rpcs.sql`
- `20260613000022_sales_channels_phase_b_realtime.sql`

## DB Validation Tests

```bash
npm run test:integration -- sales-channels
```

Expected: 3 tests pass:

- [ ] `sales_channel_settings` has 14 seeded rows
- [ ] `validate_sales_channel` rejects invalid channel
- [ ] `validate_sales_channel` accepts all 14 channels

## Frontend Smoke (manual)

```bash
npm run dev
```

Open http://localhost:3000 and verify:

### PenjualanBaru pill selector

- [ ] 3 group pills render (Offline / Marketplace / Direct Online)
- [ ] Marketplace channel selection triggers "Nomor Order Marketplace" field
- [ ] Default channel is walkin when arriving from header "Catat Transaksi" button

### Pengaturan tab "Kanal Penjualan"

- [ ] Tab visible to owner / admin with `canConfigureSalesChannels` permission
- [ ] List of 14 channels grouped (Offline / Marketplace / Direct)
- [ ] Walk-in has Lock icon + disabled toggle (cannot be hidden)
- [ ] Toggle a non-Walk-in channel — change persists across page reload

### Realtime sync (cross-tab)

- [ ] Open Pengaturan in tab A
- [ ] Open PenjualanBaru in tab B
- [ ] Toggle Lazada off in tab A
- [ ] Lazada pill disappears in tab B within <2s

### OrderHistory hybrid filter

- [ ] 2 dropdowns sejajar (Group + Specific)
- [ ] Group dropdown: 4 options (Semua, Semua Offline, Semua Marketplace, Semua Direct)
- [ ] Specific dropdown: `<optgroup>`s per group with active channels, + "Dinonaktifkan (untuk historical)" at end with hidden channels listed

### Recon TallyBar

- [ ] Hide-zero: channels without transactions don't appear
- [ ] Sort: rows ordered by total amount DESC
- [ ] Brand-color icon containers per channel
- [ ] Hidden channels with historical data appear with "DINONAKTIFKAN" badge

### Dashboard chart

- [ ] Brand colors render in chart segments
- [ ] Top-3 insight cards populate above chart

### Laporan

- [ ] Pie chart cells use brand colors
- [ ] Top-3 channel cards above chart

### Permission test

- [ ] User with `canConfigureSalesChannels=false` → "Kanal Penjualan" tab hidden
- [ ] Direct SQL UPDATE attempt by such user → RLS denies write

## Backend Go Test

```bash
cd backend-go && go test ./internal/db/... -run TestRecordKasirSale -v
```

Expected:

- [ ] Existing walkin test still passes
- [ ] New `TestRecordKasirSale_ShopeeChannel_IssuesSHPInvoice` passes — invoice prefix `SHP-`

## Known Concerns (to triage post-validation)

These regressions or rough edges were flagged during implementation:

- [ ] **Payment-method gradient bar** in RekonsiliasiScreen removed during TallyBar refactor (Task 23). If needed, add back as separate sub-component.
- [ ] **Dashboard chart series** still hardcoded 4 columns (Walk-in / Tokopedia / Grosir / WA AI) at output despite bucket helper supporting 14. Add task to expose all channels.
- [ ] **Channel labels** lost emoji prefix (e.g. "Walk-in" instead of the old "[shop] Walk-in") and "/Konter" suffix in invoice. `ChannelIcon` now renders separately; emoji-as-text was redundant. Verify with user if labels are OK.
- [ ] **Brand SVG logos** are text-mark placeholders ("S" for Shopee, "T" for Tokopedia, etc). Swap with official SVG before production.
- [ ] **Integration tests** still reference legacy `tokped_order_no` / `p_tokped_order_no`:
  - `tests/integration/sales-recording.test.ts` (4 refs)
  - `tests/integration/warehouses-phase2b-rpcs.test.ts` (2 refs)

  Update these to `marketplace_order_no` / `p_marketplace_order_no` before running `test:integration` against migrated DB.

## Post-Validation Cleanup (Phase H, 1 week post-deploy)

Once production has run stable for 1 week with the rename in place:

```sql
DROP VIEW IF EXISTS public.kasir_transactions_legacy;
```

Saved as migration `20260620XXXXXX_sales_channels_phase_d_cleanup.sql` — NOT yet created. Create when ready.
