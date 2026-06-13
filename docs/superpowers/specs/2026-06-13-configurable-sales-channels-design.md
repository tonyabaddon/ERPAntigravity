# Configurable Sales Channels — Design Spec

**Date**: 2026-06-13
**Status**: Draft → awaiting user review
**Owner**: tonywei
**Domain**: ERPAntigravity (electrical components MSME — Glory Jaya Panel)

## Problem

Sales channel saat ini hardcoded di 5+ tempat di codebase:

- Postgres ENUM `kasir_channel` (`walkin, tokopedia, grosir`) dan `sales_channel` (`whatsapp, tokopedia, walkin, grosir`)
- TypeScript types `KasirChannel` & `SalesChannel`
- RPC whitelist di `record_kasir_sale` (3 variant) — `IF p_channel NOT IN ('walkin', 'tokopedia', 'grosir', 'whatsapp')`
- Invoice prefix `CASE` per channel
- UI maps `CHANNEL_LABEL` & `CHANNEL_BADGE_CLASS` di `salesEntries.ts`
- Inline `{walkin: 'Walk-in', tokopedia: 'Tokopedia', ...}` hash di 4 file berbeda (SalesInvoicePDF, KasirInvoiceModal, KasirScreen, OrdersColumn)
- Recon screen bucket hardcode `{whatsapp, tokopedia, walkin, grosir}`
- Dashboard chart bucket hardcode `{walkin, tokopedia, grosir, waai}` (× 2 nearly-identical functions)

**Akibat**: setiap kali bisnis butuh tag penjualan dari marketplace baru (Shopee, Lazada, TikTok Shop, dll), butuh modifikasi 10+ tempat — terlalu mahal untuk perubahan label.

**Use case langsung**: operator butuh mencatat penjualan manual dari Shopee, Lazada, TikTok Shop, Blibli, Bukalapak, Ralali, Bhinneka, plus channel direct seperti Instagram DM dan Website Sendiri. Marketplace integration belum dibangun — semua via manual input dulu.

## Goals

1. Mendukung 14 channel kanonik yang relevan untuk MSME electrical/hardware Indonesia, lengkap dari pre-deploy.
2. Admin bisa toggle visibility per-channel via menu Pengaturan tanpa engineering work.
3. Historical data (recon, dashboard, laporan) tetap menampilkan semua channel yang pernah ada transaksi — visibility cuma filter input-time.
4. UI/UX konsisten dengan existing design system (TabBar, pill selector, ToggleLeft/Right, palette Tailwind).
5. Selesaikan code smell lama: konsolidasi 5 tempat hardcode channel-label jadi satu source of truth.

## Non-Goals

- Marketplace API integration (manual input only untuk MVP).
- User-driven add/remove channel dari UI — kalau muncul marketplace baru (mis. TikTok Pay), tambah via 1 PR kecil (ENUM ADD VALUE + seed row).
- Per-channel kompleks behavior baru (commission tracking, settlement matching, dll) — hanya label visibility.
- Multi-tenant rollout penuh (table siap tenant_id, tapi single-tenant deployment pakai NULL dulu).

## Decisions Locked

Via brainstorming dialogue:

| # | Decision | Rationale |
|---|---|---|
| D1 | Channel hardcoded di code (Postgres ENUM + TS union), bukan user-creatable table | Pre-defined comprehensive list lebih simple; future-add tetap 1 PR kecil |
| D2 | "Nomor Order Marketplace" field wajib untuk semua marketplace channel | Konsistensi UX antar marketplace; semua marketplace kasih order number |
| D3 | Website Sendiri pakai kasir flow (immediate paid), bukan orders flow | Tabel orders punya state machine khusus untuk WhatsApp consult-style |
| D4 | Drop kartu cepat di KasirScreen, single header button entry → pill selector | 9+ kartu = clutter; mengikuti keputusan navy-button removal sebelumnya |
| D5 | Tokopedia & TikTok Shop = 1 channel | GoTo acquisition; operasional sudah merged |
| D6 | 14 channel total (4 offline + 7 marketplace + 3 direct) | User-confirmed dari Indonesian marketplace audit |
| D7 | Recon screen: per-channel detail, hide-zero, sort by amount DESC | Setiap marketplace setor ke rekening berbeda — granular tally untuk matching deposit |
| D8 | Dashboard: stacked bar chart dengan brand color asli marketplace + top-3 insight cards | Instant-readable, sesuai mental model owner |
| D9 | Admin visibility toggle di tab baru "Kanal Penjualan" di PengaturanScreen | Sesuai pola existing (bank, WA recipient, company settings) |
| D10 | Default semua 14 channel visible saat seed; admin hide manual yang tidak dipakai | Surprise-free; reconciliator yang pakai Shopee dari day 1 langsung lihat option-nya |
| D11 | Walk-in locked (tidak bisa di-hide) | Fallback channel; UI disabled toggle + RLS server check |
| D12 | Visibility filter berlaku untuk INPUT only — historical recon/dashboard/laporan tetap full | Audit-grade integrity |

## Channel Canonical List

| # | Code | Label UI | Group | Invoice Prefix | Flow | Order No. Required | Brand Color (hex) |
|---|---|---|---|---|---|---|---|
| 1 | `walkin` | Walk-in | Offline | `WLK` | kasir | — | #64748B (slate-500) |
| 2 | `grosir` | Grosir | Offline | `GSR` | kasir | — | #7C3AED (violet-600) |
| 3 | `sales` | Sales Lapangan | Offline | `SLS` | kasir | — | #D97706 (amber-600) |
| 4 | `expo` | Pameran / Expo | Offline | `EXP` | kasir | — | #0D9488 (teal-600) |
| 5 | `tokopedia` | Tokopedia / TikTok Shop | Marketplace | `TPD` | kasir | ✓ | #03AC0E |
| 6 | `shopee` | Shopee | Marketplace | `SHP` | kasir | ✓ | #EE4D2D |
| 7 | `lazada` | Lazada | Marketplace | `LZD` | kasir | ✓ | #0F146E |
| 8 | `blibli` | Blibli | Marketplace | `BLB` | kasir | ✓ | #0095DA |
| 9 | `bukalapak` | Bukalapak | Marketplace | `BKL` | kasir | ✓ | #E31E52 |
| 10 | `ralali` | Ralali | Marketplace | `RLI` | kasir | ✓ | #1E3A8A |
| 11 | `bhinneka` | Bhinneka | Marketplace | `BHN` | kasir | ✓ | #E63946 |
| 12 | `whatsapp` | WhatsApp | Direct | `WAM` | **orders** | — | #25D366 |
| 13 | `instagram` | Instagram DM | Direct | `IGM` | kasir | — | #E1306C |
| 14 | `website` | Website Sendiri | Direct | `WEB` | kasir | — | #475569 (slate-600) |

**Channel baru ditambah ke ENUM (10 nilai)**: `shopee, lazada, blibli, bukalapak, ralali, bhinneka, sales, expo, instagram, website`.

Tokopedia stay; label UI diubah jadi "Tokopedia / TikTok Shop".

**Precondition check pada impl**: pastikan `kasir_channel` ENUM sudah punya value `'whatsapp'`. Kalau belum (cek dengan `\dT+ kasir_channel`), Phase A juga harus `ALTER TYPE kasir_channel ADD VALUE 'whatsapp'`. RPC `record_kasir_sale` saat ini cast `p_channel::public.kasir_channel` dengan whatsapp accepted, jadi kemungkinan sudah ada — verify saat implementasi.

## Architecture & Data Model

### Postgres

**ENUM extension** (Phase A migration, atomic via separate transactions):

```sql
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'shopee';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'lazada';
-- ... × 10 baru
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'shopee';
-- ... mirror × 10 baru
```

**Column rename** (kasir_transactions):

```sql
ALTER TABLE kasir_transactions RENAME COLUMN tokped_order_no TO marketplace_order_no;
-- 1 minggu soak: create view alias backward-compat
CREATE OR REPLACE VIEW kasir_transactions_legacy AS
  SELECT *, marketplace_order_no AS tokped_order_no FROM kasir_transactions;
```

**New table** `sales_channel_settings`:

```sql
CREATE TABLE sales_channel_settings (
  channel_code  TEXT PRIMARY KEY,
  is_visible    BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  tenant_id     UUID,                          -- NULL untuk single-tenant
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES admin_users(id),
  CHECK (channel_code IN (
    'walkin','grosir','sales','expo',
    'tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka',
    'whatsapp','instagram','website'
  ))
);

CREATE INDEX idx_sales_channel_settings_tenant ON sales_channel_settings(tenant_id);

ALTER PUBLICATION supabase_realtime ADD TABLE sales_channel_settings;

ALTER TABLE sales_channel_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_admins_read" ON sales_channel_settings
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "owners_admins_write" ON sales_channel_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND (role = 'owner' OR permissions->>'canConfigureSalesChannels' = 'true')
    )
  );
```

**Helper function** for RPC validation (kill duplication):

```sql
CREATE OR REPLACE FUNCTION validate_sales_channel(p_channel TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_channel NOT IN (
    'walkin','grosir','sales','expo',
    'tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka',
    'whatsapp','instagram','website'
  ) THEN
    RAISE EXCEPTION 'invalid channel: % (expected one of 14 canonical channels)', p_channel;
  END IF;
END $$;
```

**RPC updates** (Phase B):
- `record_kasir_sale`, `record_kasir_sale_validate_subtype`, `record_kasir_sale_service_lines` — replace inline whitelist dengan `PERFORM validate_sales_channel(p_channel)`. Expand invoice prefix `CASE` ke 14 cabang.
- `orders.sales_channel` CHECK constraint stay `('whatsapp', 'walkin')` — marketplace TIDAK masuk orders table.

**Seed function** (idempotent, re-runnable saat channel baru ditambah):

```sql
CREATE OR REPLACE FUNCTION seed_sales_channel_settings()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sales_channel_settings (channel_code, sort_order, is_visible) VALUES
    ('walkin', 10, true),
    ('grosir', 20, true),
    ('sales', 30, true),
    ('expo', 40, true),
    ('tokopedia', 50, true),
    ('shopee', 60, true),
    ('lazada', 70, true),
    ('blibli', 80, true),
    ('bukalapak', 90, true),
    ('ralali', 100, true),
    ('bhinneka', 110, true),
    ('whatsapp', 120, true),
    ('instagram', 130, true),
    ('website', 140, true)
  ON CONFLICT (channel_code) DO NOTHING;
END $$;

SELECT seed_sales_channel_settings();
```

### TypeScript

**`src/types.ts`**:

```ts
export type SalesChannel =
  | 'walkin' | 'grosir' | 'sales' | 'expo'
  | 'tokopedia' | 'shopee' | 'lazada' | 'blibli' | 'bukalapak' | 'ralali' | 'bhinneka'
  | 'whatsapp' | 'instagram' | 'website';

export type KasirChannel = SalesChannel;  // alias — semua nilai overlap
```

**New file `src/lib/salesChannels.ts`** (single source of truth):

```ts
export type ChannelGroup = 'offline' | 'marketplace' | 'direct';

export interface ChannelDef {
  code: SalesChannel;
  label: string;
  emoji: string;
  group: ChannelGroup;
  invoicePrefix: string;
  flow: 'kasir' | 'orders';
  requiresOrderNo: boolean;
  brandColor: string;       // hex
  bgClass: string;          // Tailwind utility kalau aktif
  textClass: string;
  borderClass: string;
}

// Illustration — 14 entry total at implementation
export const CHANNEL_VISUAL: Record<SalesChannel, ChannelDef> = {
  walkin: {
    code: 'walkin', label: 'Walk-in', emoji: '🏪', group: 'offline',
    invoicePrefix: 'WLK', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#64748B',
    bgClass: 'bg-slate-100', textClass: 'text-slate-700', borderClass: 'border-slate-300',
  },
  // ... 13 more entries with full ChannelDef shape
};

export const CHANNEL_GROUPS: Record<ChannelGroup, SalesChannel[]> = {
  offline:     ['walkin', 'grosir', 'sales', 'expo'],
  marketplace: ['tokopedia', 'shopee', 'lazada', 'blibli', 'bukalapak', 'ralali', 'bhinneka'],
  direct:      ['whatsapp', 'instagram', 'website'],
};

export const CHANNEL_REQUIRES_ORDER_NO: Set<SalesChannel> =
  new Set(CHANNEL_GROUPS.marketplace);

export const CHANNEL_LOCKED: Set<SalesChannel> = new Set(['walkin']);
```

**Tailwind config** — add brand colors:

```js
theme: {
  extend: {
    colors: {
      channel: {
        tokopedia: '#03AC0E',
        shopee:    '#EE4D2D',
        // ... 14 brand colors
      },
    },
  },
},
```

### React Context

**`src/contexts/SalesChannelsContext.tsx`** — load `sales_channel_settings` sekali, subscribe realtime:

```ts
interface SalesChannelsCtx {
  settings: Record<SalesChannel, { isVisible: boolean; sortOrder: number }>;
  visibleChannels: SalesChannel[];        // urut sort_order
  visibleByGroup: Record<ChannelGroup, SalesChannel[]>;
  toggleVisibility: (code: SalesChannel) => Promise<void>;
  isLoading: boolean;
}
```

Wrap App.tsx dengan `<SalesChannelsProvider>` setelah `<AuthProvider>`. Hindari 14+ komponen masing-masing query.

## UI/UX

### Pengaturan → Tab "Kanal Penjualan"

Tambah ke `PengaturanScreen.tsx` tabs union: `'umum' | 'notifikasi' | 'whatsapp-ai' | 'kanal-penjualan'`. Permission gating via `canConfigureSalesChannels` flag (default true untuk owner/admin).

Layout (pakai existing design system):

```
KANAL PENJUALAN
Pilih kanal yang muncul di form pencatatan. Data historis tetap
tampil meskipun kanal di-non-aktifkan.

━━ Offline ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏪 Walk-in              [████] Aktif (locked, disabled)
🏭 Grosir               [████] Aktif        ToggleRight
💼 Sales Lapangan       [░░░░] Non-aktif    ToggleLeft
🎪 Pameran / Expo       [░░░░] Non-aktif    ToggleLeft

━━ Marketplace ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛍️ Tokopedia / TikTok   [████] Aktif        ToggleRight
🟠 Shopee               [████] Aktif        ToggleRight
... × 7 marketplace

━━ Direct Online ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 WhatsApp Manual      [████] Aktif        ToggleRight
📷 Instagram DM         [░░░░] Non-aktif    ToggleLeft
🌐 Website Sendiri      [████] Aktif        ToggleRight

Perubahan tersimpan otomatis · 9 kanal aktif dari 14
```

- Auto-save on toggle (no save button).
- Locked Walk-in: disabled state + tooltip "Walk-in adalah kanal default dan tidak bisa dinonaktifkan".
- Footer counter "X aktif dari 14" untuk awareness.
- Font: `text-[13px]` body, `text-[11px]` uppercase labels (sesuai existing design tokens).

### PenjualanBaruScreen — Pill Selector

Refactor `ChannelSelector.tsx` jadi props-driven (`channels: ChannelDef[]`). Group rendering dengan section divider `border-t border-slate-200/60`.

```
KANAL PENJUALAN
┌─ Offline ─────────────────────────────────────────────┐
│ [🏪 Walk-in] [🏭 Grosir] [💼 Sales Lapangan]          │
│ [🎪 Pameran/Expo]                                      │
└────────────────────────────────────────────────────────┘
┌─ Marketplace ─────────────────────────────────────────┐
│ [🛍️ Tokopedia/TikTok] [🟠 Shopee] [🔵 Lazada]         │
│ [🟦 Blibli] [🔴 Bukalapak] [🔧 Ralali] [💻 Bhinneka]  │
└────────────────────────────────────────────────────────┘
┌─ Direct Online ───────────────────────────────────────┐
│ [💬 WhatsApp] [📷 Instagram DM] [🌐 Website]          │
└────────────────────────────────────────────────────────┘

(saat channel marketplace aktif:)
NOMOR ORDER MARKETPLACE *
[__________________________________________]

(saat channel WhatsApp manual aktif:)
NO. WHATSAPP PEMBELI
[__________________________________________]
```

- Pill aktif: `rounded-full` + brand color background dari `CHANNEL_VISUAL[code].bgClass`.
- Default `initialChannel='walkin'` saat header button → 1-klik path tersering tidak regress.
- Conditional field via `CHANNEL_REQUIRES_ORDER_NO.has(channel)`.
- Hapus state `tokpedOrderNo` → `marketplaceOrderNo`. Hapus 4 tempat `channel === 'tokopedia'` hardcode.

### KasirScreen

- **Hapus 3 kartu cepat** (Walk-in/Tokopedia/Grosir) di right panel — line 429+ `KasirScreen.tsx`.
- Header `📋 Catat Transaksi` button stay sebagai single entry.
- Filter dropdown line 187 (`filter === 'online'` heuristic check `channel === 'tokopedia' || channel === 'grosir'`) refactor pakai `CHANNEL_GROUPS.marketplace.includes(...)`.

### OrderHistoryScreen

Filter dropdown line 438-445: hardcoded `<option value="tokopedia">` × 4 → dynamic loop atas `visibleChannels`. Tambah opsi group filter:

```
Filter Kanal:
  [Semua]
  [Semua Offline]
  [Semua Marketplace]
  [Semua Direct]
  --- Individual ---
  [🏪 Walk-in]
  [🛍️ Tokopedia/TikTok]
  ...
```

### RekonsiliasiScreen + TallyBar + OrdersColumn

- Hapus hardcoded acc `{whatsapp, tokopedia, walkin, grosir}` di `RekonsiliasiScreen.tsx:52, 57`.
- Refactor jadi:

```ts
type ChannelTally = Map<SalesChannel, { amount: number; count: number }>;
```

- TallyBar render: hide-zero, sort by `amount DESC`. Brand color emoji + badge dari `CHANNEL_VISUAL`.
- OrdersColumn filter pills: `'all' | 'piutang' | ChannelGroup` (5 pills, scalable) sebagai default; expand individual channel sebagai sub-filter on demand.

```
┌─ Tally per Kanal · 13 Juni 2026 ────────────────────┐
│ 🛍️ Tokopedia/TikTok    Rp 12.450.000   (8 trx)     │
│ 🟠 Shopee              Rp  8.200.000   (5 trx)     │
│ 🏪 Walk-in             Rp  6.150.000   (12 trx)    │
│ 🔵 Lazada              Rp  3.800.000   (2 trx)     │
│ 💬 WhatsApp Manual     Rp  2.500.000   (1 trx)     │
│ 🏭 Grosir              Rp  1.200.000   (1 trx)     │
│ ─────────────────────────────────────────           │
│ TOTAL                  Rp 34.300.000   (29 trx)    │
└─────────────────────────────────────────────────────┘
```

### Dashboard

`supabaseClient.ts:509, 626` punya 2 hardcoded bucket functions yang nearly identical. Refactor jadi single helper `bucketByChannel(rows, channels)` yang return `Record<dateString, Record<SalesChannel, number>>`. Hapus +30 LOC duplikasi.

Visualization:
- Stacked bar chart harian (7/30/90 hari) dengan brand colors via `bg-channel-{code}` Tailwind utility.
- 3 insight cards di atas chart:
  1. "Kanal Tertinggi Periode Ini" — channel #1 + persentase
  2. "Marketplace Total" — sum 7 marketplace + count trx
  3. "Offline Total" — sum 4 offline + count trx

### LaporanScreen

`channelTotals: Array<{name, value}>` sudah dynamic-friendly. Tambah:
- Brand colors di `<Pie>` cells (line 178) dan stacked bar fill.
- "Top 3 Kanal" insight card pakai `channelTotals.slice(0,3)`.

### SalesInvoicePDF & KasirInvoiceModal

Inline channel-label hash dihapus, import dari `salesChannels.ts`:

```ts
// Sebelum (SalesInvoicePDF.tsx:52)
const channelLabel = { walkin: 'Walk-in', tokopedia: 'Tokopedia', grosir: 'Grosir', whatsapp: 'WhatsApp Manual' }[transaction.channel];

// Sesudah
import { CHANNEL_VISUAL } from '@/lib/salesChannels';
const channelLabel = CHANNEL_VISUAL[transaction.channel ?? 'walkin'].label;
```

## Impact Audit — Semua Files Touched

### Migrations (new)
- `20260613XXXXXX_sales_channels_phase_a_schema.sql` (XXXXXX timestamp at impl time, per existing convention)
- `20260613XXXXXX_sales_channels_phase_b_rpcs.sql`

### Frontend baru
- `src/lib/salesChannels.ts` (CHANNEL_VISUAL, CHANNEL_GROUPS, helpers)
- `src/contexts/SalesChannelsContext.tsx`
- `src/components/pengaturan/SalesChannelConfigPanel.tsx`

### Frontend modified
- `src/types.ts` — SalesChannel/KasirChannel union expand + alias
- `src/lib/salesEntries.ts` — drop CHANNEL_LABEL/CHANNEL_BADGE_CLASS, re-export dari salesChannels
- `src/lib/supabaseClient.ts` — line 509, 626 refactor; line 350, 1385 type widen
- `src/components/penjualan/ChannelSelector.tsx` — props-driven, group rendering
- `src/components/PenjualanBaruScreen.tsx` — rename tokpedOrderNo → marketplaceOrderNo, drop 4 hardcode checks
- `src/components/KasirScreen.tsx` — drop kartu cepat, group-based filter
- `src/components/OrderHistoryScreen.tsx` — dynamic filter dropdown + group options
- `src/components/RekonsiliasiScreen.tsx` — dynamic Map buckets
- `src/components/rekonsiliasi/TallyBar.tsx` — Map-based, hide-zero, sort DESC
- `src/components/rekonsiliasi/OrdersColumn.tsx` — group-based filter pills
- `src/hooks/useRekonsiliasi.ts` — channel type widen
- `src/components/LaporanScreen.tsx` — brand colors + top-3 card
- `src/components/penjualan/SalesInvoicePDF.tsx` — import dari salesChannels
- `src/components/KasirInvoiceModal.tsx` — import dari salesChannels
- `src/components/PengaturanScreen.tsx` — tab kanal-penjualan
- `src/App.tsx` — wrap SalesChannelsProvider, widen penjualanInitialChannel type
- `tailwind.config.js` — extend brand colors

### Backend Go
- `backend-go/internal/db/record_kasir_sale_test.go` — tambah 1 test case channel baru (smoke check). Existing walkin test stay valid.

### Not impacted (sanity-check)
- Pollers (followup, heartbeat) — "channel" di sini = Postgres NOTIFY, beda konsep.
- Approval system — `decision_channel` = `'owner_pin' | 'wa_button'`, beda.
- WhatsAppAi screen — `wa-numbers-update` realtime, tidak related.
- Stock/PO/Warehouse modules — channel-agnostic.

## Migration Plan

### Phase A — Schema groundwork
1. `ALTER TYPE kasir_channel ADD VALUE` × 10
2. `ALTER TYPE sales_channel ADD VALUE` × 10
3. `ALTER TABLE kasir_transactions RENAME COLUMN tokped_order_no TO marketplace_order_no`
4. Backward-compat view alias (1 minggu)
5. `CREATE TABLE sales_channel_settings` + RLS + indexes
6. `CREATE FUNCTION validate_sales_channel(text)`

### Phase B — Seed & RPC
7. `SELECT seed_sales_channel_settings()` — populate 14 row
8. `CREATE OR REPLACE FUNCTION record_kasir_sale(...)` (3 variants) — pakai helper + expand invoice prefix
9. `ALTER PUBLICATION supabase_realtime ADD TABLE sales_channel_settings`

### Phase C — Frontend deploy
10. New `CHANNEL_VISUAL` + `SalesChannelsProvider` deployed
11. Tab "Kanal Penjualan" available
12. Feature flag `enable_configurable_channels=true`

### Phase D — Cleanup (1 minggu soak)
13. Drop `tokped_order_no` view alias
14. Hapus legacy hardcoded fallback paths

**Sequencing rationale**: Phase A+B backward-compat dengan existing frontend (yang masih hardcode 4 channel). Old frontend ignore baris `sales_channel_settings` baru, RPC whitelist sekarang lebih permissive. Zero-downtime rollout.

**Rollback strategy**: Feature flag `enable_configurable_channels=false` → frontend revert ke 4-channel hardcoded. ENUM values baru tetap di DB (tidak bisa di-drop), tapi tidak terpakai.

## Validation Test Plan

### Pre-deploy DB (psql)
- Insert kasir_transactions untuk tiap 14 channel → semua sukses
- Insert dengan channel invalid (`'foo'`) → reject dengan pesan jelas
- `record_kasir_sale` dengan marketplace channel tanpa `marketplace_order_no` → reject
- `record_kasir_sale` dengan offline channel + marketplace_order_no terisi → diabaikan/null
- Invoice prefix unik per 14 channel

### Frontend smoke (manual / Playwright)
- PenjualanBaru: pill grouping render 3 group benar, marketplace pills show order-no field
- Default `initialChannel='walkin'` saat header button — masih 1-klik
- PengaturanScreen tab "Kanal Penjualan": toggle Lazada off → buka PenjualanBaru tab lain → Lazada hilang dalam <2s (realtime)
- Walk-in toggle disabled (locked state)
- OrderHistory filter dropdown: cuma visible channels + opsi group "Semua Marketplace"
- Recon tally: hide-zero confirmed (channel tanpa transaksi tidak muncul)
- Recon historical: hide Shopee di settings → recon untuk last week (saat Shopee aktif) tetap tampilkan Shopee row
- Dashboard chart: brand colors render, top-3 insight card akurat
- Laporan: stacked bar + donut + top-3 konsisten dengan dashboard

### Permission
- User dengan `canConfigureSalesChannels=false` → tab tidak muncul
- Direct API call tanpa permission → RLS reject

### Backend Go
- `record_kasir_sale_test.go` existing walkin test pass
- Tambah 1 test case shopee → assert insert sukses + invoice prefix `SHP-...`

## Observability

- Sentry breadcrumb saat channel toggle: `{channel, is_visible, user_id}`
- Audit panel "Sales channel config — last 30 days toggle activity" untuk trace anomaly
- Weekly notification: "Kanal aktif dipakai bulan ini: X dari Y configured" — suggest hide untuk yang 0 transaksi

## Open Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Operator hide Walk-in tidak sengaja | Low | Locked state UI + RLS check di server |
| Frontend deploy sebelum migration applied | Medium | Phase A+B → soak 1 hari → Phase C; feature flag rollback |
| Historical recon broken karena rename kolom | Low | View alias 1 minggu; dual-read fallback frontend |
| Realtime channel topic collision (issue dulu di approvals) | Medium | Suffix topic dengan random token per subscriber, pattern existing |
| Brand color buruk di dark mode | Low | Cek `dark:` variants saat implementasi |
| ENUM ADD VALUE tidak rollback-able PG <12 | Low | Supabase ≥15, aman; documented as known constraint |

## Improvement Bundle (Bundled Code Smell Cleanup)

Refactor ini sekalian menyelesaikan dua isu lama:

1. **5 tempat hardcode mapping channel→label** (`salesEntries.ts`, `SalesInvoicePDF.tsx`, `KasirInvoiceModal.tsx`, `KasirScreen.tsx`, `OrdersColumn.tsx`) → konsolidasi ke `CHANNEL_VISUAL` di `salesChannels.ts`. Future-add channel = 1 file edit.
2. **2 nearly-identical bucket functions** di `supabaseClient.ts:509, 626` → DRY-up jadi `bucketByChannel(rows, channels)`. Hapus +30 LOC duplikasi.

## Out of Scope (future work)

- Marketplace API integration (Shopee/Tokopedia OAuth, webhook untuk auto-import order)
- Per-channel commission/settlement tracking
- Per-channel reporting period dengan custom date ranges
- Salesperson / event metadata field untuk Sales Lapangan & Pameran (saat ini pakai notes)
- Multi-tenant rollout dengan per-tenant channel customization
- User-driven channel add via UI (kalau diperlukan, ENUM ADD VALUE perlu DDL — out of scope untuk runtime config)

## Acceptance Criteria

1. 14 channel kanonik visible di Pengaturan tab dengan toggle per-channel.
2. PenjualanBaru pill selector render 3 group benar; marketplace channel trigger "Nomor Order Marketplace" field.
3. Walk-in tidak bisa di-hide via UI maupun API.
4. Toggle visibility di Pengaturan → effect realtime <2s di tab lain.
5. Historical recon/dashboard/laporan tetap tampilkan channel yang di-hide kalau ada datanya.
6. Migration Phase A+B backward-compat — existing frontend tetap jalan.
7. No regression di walk-in 1-klik flow.
8. Test suite full pass (DB tests + frontend smoke + backend Go).
9. Code smell improvement bundle delivered (5 hardcode tempat konsolidasi + DRY bucket function).
10. progress.md entry updated post-implementasi (per CLAUDE.md gotcha).
