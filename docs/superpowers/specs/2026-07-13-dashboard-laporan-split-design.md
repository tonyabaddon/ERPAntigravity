# Dashboard vs Laporan — Metric Split + Owner-Value Reports Redesign (Item #3)

**Status:** Draft
**Date:** 2026-07-13
**Founder pain point:** Dashboard dan Laporan tampilkan metric yang sama → owner bingung "cari data di mana". Laporan Performa juga kurang optimal — banyak metric tapi tidak semua kasih owner keputusan beda.

---

## 1. Ringkasan

**Reshuffle Dashboard menjadi single "action items" surface** (semua role sama), delete 3 KPI + 2 chart yang duplicate dengan Laporan, tambah 4 maintenance/queue cards yang auto-hide when N=0.

**Redesign Laporan Performa tab** dengan fokus real owner value: tambah Gross Profit KPI + period-over-period delta, tambah Slow-Moving Stock section, tambah Top Customer section, tambah Profit per Channel view. Remove AI Efficiency KPI + Chat AI/Manual chart (technical, non-decision-driving).

**Laporan Akuntansi tab tidak diubah** (sudah lengkap: Mutasi + Laba Rugi + Neraca + Cash Flow).

## 2. Mental model split (locked)

| Screen | Purpose | Time frame | Frequency owner buka |
|--------|---------|------------|---------------------|
| **Dashboard** | "Ada apa yang perlu di-action?" | Today snapshot | 20× / hari |
| **Laporan → Performa** | "Bagaimana performa bisnis?" | Period 7/30/90d | 1× / minggu |
| **Laporan → Akuntansi** | "Laporan keuangan formal" | Period + custom date | 1× / bulan |

Zero overlap. Setiap screen job jelas.

## 3. Scope

### 3.1 In scope MVP

**Dashboard reshuffle:**
- Delete: Total Omset KPI, Pesanan Terproses KPI, AI Efficiency KPI, Revenue per Channel chart, Chat AI vs Manual chart
- Keep: Stok tipis KPI (rename to card style), Pre-order 7d card, Log AI activity, Promo Produk card (Item #4b existing)
- Add: Header "Selamat pagi, {name}" + Today strip (revenue + count for `date = CURRENT_DATE`)
- Add 4 maintenance cards (all auto-hide when N=0):
  - Persetujuan pending (deep link → Approval Inbox)
  - Piutang overdue (deep link → Piutang)
  - Hutang supplier overdue (deep link → Pembelian → Tagihan)
  - Fulfillment antrean (deep link → Daftar Pesanan)
  - Sales Inbox unread (deep link → Sales Inbox)

**Laporan Performa redesign (Full 6 layers):**
1. Add Gross Profit KPI (`sum(subtotal) - sum(hpp_total)` per period) + margin % display
2. Add period-over-period delta indicators on 4 KPI cards (▲/▼ colored)
3. Remove AI Efficiency KPI + Chat AI vs Manual chart
4. Add Produk Slow-Moving table (SKUs with stok > 0 AND low/zero sales in period, with stagnation age)
5. Add Top 10 Customer table (aggregate `kasir_transactions.customer_id` by revenue, click → Pelanggan detail)
6. Add Profit per Channel visualization (revenue - hpp aggregated by channel — donut or bar)

**Cross-cutting:**
- Both screens use existing period toggle logic (Laporan) or fixed today (Dashboard)
- No new schema; all queries against existing tables
- Multi-tenant: RLS filters tenant_id automatically; new tenants get zero data → cards auto-hide

### 3.2 Out of scope (deferred)

- Year-over-year comparison at Laporan level
- Sales rep productivity dashboard
- Supplier reliability analytics
- Detail drill-down modals per KPI card
- Customer dormancy alerts (last purchase >30d) — deferred to future customer analytics iteration
- Aging piutang breakdown at Laporan (Piutang page already has it)
- Cash flow overview at Laporan (existing Akuntansi Cash Flow sub-tab suffices)
- Cross-tenant platform admin analytics
- Dashboard drill-down modal experiences
- Customizable Dashboard per user preference
- Real-time push updates for card counts (poll on mount, refresh on navigation only)

### 3.3 Bahasa + design system

- Bahasa Indonesia MSME tone
- Font 13-14px UI (per feedback `font_sizing`)
- Reuse existing card patterns from `PromoProdukCard.tsx` (auto-hide, badge, deep link CTA)
- Rupiah format via `formatIDR()` helper
- Badge palette: emerald (aktif/positif) / amber (warning) / rose (overdue/negatif) / slate (netral)
- Delta indicators: ▲ hijau untuk positif, ▼ merah untuk negatif, `text-emerald-600` / `text-rose-600`
- Icons: lucide-react (existing convention)

## 4. Terminology

- **KPI (Key Performance Indicator)**: metric cards in Laporan Performa (Total Omset, Gross Profit, dll)
- **Action card**: maintenance/queue card in Dashboard yang bisa di-click ke deep link (Persetujuan, Fulfillment, dll)
- **Delta**: perbedaan % periode current vs previous, ditampilkan sebagai arrow + %
- **Slow-mover**: SKU dengan stock > 0 dan penjualan periode = rendah (definisi threshold di §5.4)
- **Overdue** (piutang / hutang): due_date < now() AND status ≠ paid/verified
- **Gross Profit**: revenue - COGS (dari `kasir_transactions.subtotal - kasir_transactions.hpp_total`)
- **Fulfillment antrean**: `kasir_transactions.status IN ('AWAITING_LUNAS','WIP','READY_TO_SHIP')` (subject to actual status enum)

## 5. Design detail

### 5.1 Dashboard AFTER

**File modification**: `src/components/DashboardScreen.tsx`

**Layout:**
```
Header: "Selamat pagi, {name}" (existing)
        Hari ini: Rp X · Y transaksi     ← NEW today strip

━━━ Perlu Perhatian ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔔 Persetujuan pending: N        [Inbox →]
🏷 Promo Produk: X SKU aktif · Y exp 7d   (existing Item #4b card)
💰 Piutang overdue: N faktur · Rp Z    [Piutang →]
💸 Hutang supplier overdue: N · Rp Z   [Tagihan →]

━━━ Antrean Kerja ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Fulfillment antrean: N pesanan       [Daftar Pesanan →]
💬 Sales Inbox: N chat belum di-jawab   [Sales Inbox →]

━━━ Monitoring Stok ━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Stok tipis: N SKU (existing)        [Produk & Stok →]
📅 Pre-order 7d (existing)             (existing card)

━━━ Aktivitas Sistem ━━━━━━━━━━━━━━━━━━━━━━━━━━
Detak jantung AI log (existing, unchanged)
```

**Cards to DELETE:**
- Total Omset KPI card
- Pesanan Terproses KPI card
- Otomasi Balasan AI KPI card
- Revenue per Channel chart panel
- Interaksi Balasan Chat Otomatis chart panel
- Period toggle (7d/30d/90d) — no longer needed on Dashboard

**Cards to KEEP:**
- Header greeting
- Komoditas Stok Tipis (reformatted as card row with other maintenance cards)
- Pre-order fulfillments card
- Promo Produk card (Item #4b existing)
- Detak Jantung Log AI

**Auto-hide pattern (per PromoProdukCard reference):**
- Card returns `null` when its primary count = 0
- Prevents clutter for empty tenants
- Same pattern applies to all 4 new maintenance cards

### 5.2 Today strip

**Placement**: right below "Selamat pagi" greeting, above "Perlu Perhatian" section.

**Content**:
```
Hari ini: Rp 2.400.000 · 3 transaksi
```

**Data source**:
```sql
SELECT
  COALESCE(SUM(total_amount), 0)::NUMERIC AS revenue_today,
  COUNT(*)::INT AS count_today
FROM public.kasir_transactions
WHERE tenant_id = _resolve_tenant_id()
  AND date = CURRENT_DATE
  AND status IN ('PAID','AWAITING_LUNAS','COMPLETED');
```

**Refresh**: on mount, on navigate back. Not realtime.

**Font**: 13px, muted color slate-600. Compact.

### 5.3 New Dashboard action cards

Each card follows this shape (reuse `PromoProdukCard.tsx` as template):

```tsx
interface ActionCardProps {
  icon: ReactNode;
  title: string;
  count: number;                   // if 0, return null (auto-hide)
  detailText: string;              // e.g., "Rp 15.4jt total"
  ctaLabel: string;
  onCtaClick: () => void;
  badgeVariant?: 'amber' | 'rose' | 'emerald' | 'slate';
}
```

#### Card 1: Persetujuan pending

- **Data source**:
  ```sql
  SELECT COUNT(*)::INT
  FROM public.approval_requests
  WHERE tenant_id = _resolve_tenant_id()
    AND status = 'pending';
  ```
- **Title**: "Persetujuan pending"
- **Detail**: `{N} permintaan menunggu approval`
- **CTA**: "Buka Inbox →" → `onNavigate('approval-inbox')` or route to persetujuan
- **Badge**: amber (attention needed)

#### Card 2: Piutang overdue

- **Data source**:
  ```sql
  SELECT
    COUNT(*)::INT AS overdue_count,
    COALESCE(SUM(remaining_amount_rp), 0)::NUMERIC AS overdue_sum
  FROM public.piutang_faktur
  WHERE tenant_id = _resolve_tenant_id()
    AND due_date < CURRENT_DATE
    AND status IN ('OPEN','PARTIALLY_PAID');
  ```
  Actual table name / status enum to verify at plan time.
- **Title**: "Piutang overdue"
- **Detail**: `{N} faktur · Rp {sum}`
- **CTA**: "Buka Piutang →"
- **Badge**: rose (financial risk)

#### Card 3: Hutang supplier overdue

- **Data source**: aggregate against tagihan/purchase_invoice table:
  ```sql
  SELECT
    COUNT(*)::INT AS overdue_count,
    COALESCE(SUM(remaining_rp), 0)::NUMERIC AS overdue_sum
  FROM public.purchase_tagihan
  WHERE tenant_id = _resolve_tenant_id()
    AND due_date < CURRENT_DATE
    AND status IN ('unpaid','partial');
  ```
  Actual table / status enum verified at plan time.
- **Title**: "Hutang supplier overdue"
- **Detail**: `{N} tagihan · Rp {sum}`
- **CTA**: "Buka Tagihan →"
- **Badge**: rose

#### Card 4: Fulfillment antrean

- **Data source**:
  ```sql
  SELECT COUNT(*)::INT
  FROM public.kasir_transactions
  WHERE tenant_id = _resolve_tenant_id()
    AND status IN ('AWAITING_LUNAS','WIP','READY_TO_SHIP');
  ```
  Confirm status enum values at plan time.
- **Title**: "Fulfillment antrean"
- **Detail**: `{N} pesanan siap kirim / lunas / WIP`
- **CTA**: "Buka Daftar Pesanan →"
- **Badge**: emerald or slate (work queue, not urgent alarm)

#### Card 5: Sales Inbox unread

- **Data source**: existing conversation table (sudah dipakai untuk Sales Inbox sidebar badge):
  ```sql
  SELECT COUNT(*)::INT
  FROM public.conversations
  WHERE tenant_id = _resolve_tenant_id()
    AND has_unread_customer = true
    AND status = 'active';  -- or equivalent
  ```
  Reuse whatever the sidebar `9+` badge uses.
- **Title**: "Sales Inbox"
- **Detail**: `{N} chat belum di-balas`
- **CTA**: "Buka Sales Inbox →"
- **Badge**: amber

### 5.4 Laporan Performa AFTER

**File modification**: `src/components/LaporanScreen.tsx`

**KPI row (4 cards, replacing existing 4):**

| KPI | Value formula | Delta calculation |
|-----|---------------|-------------------|
| Total Omset | `SUM(subtotal)` in current period | `((current - previous) / previous) * 100`, ± % + arrow |
| **Gross Profit** *(NEW)* | `SUM(subtotal - hpp_total)` in current period | same delta pattern + margin %: `(gross_profit / revenue) * 100` |
| Pesanan Terproses | `COUNT(*)` in current period | same delta |
| Nilai Rata-rata (AOV) | `SUM(subtotal) / COUNT(*)` | same delta |

**Delta rendering**:
```
▲ +12%  (green if positive, red if negative, gray if flat/no prev data)
vs {period} sebelumnya
```

**REMOVED**: Otomasi AI KPI card. No replacement.

**Analisis Kanal section**:
- Top 3 Kanal cards (existing, retain)
- Revenue per Channel stacked bar (existing, retain)
- **Replace existing donut** with Profit per Channel donut or bar:
  ```sql
  SELECT
    channel,
    SUM(subtotal) AS revenue,
    SUM(subtotal - hpp_total) AS gross_profit,
    CASE WHEN SUM(subtotal) > 0
      THEN SUM(subtotal - hpp_total) * 100.0 / SUM(subtotal)
      ELSE 0
    END AS margin_pct
  FROM public.kasir_transactions
  WHERE tenant_id = _resolve_tenant_id()
    AND date >= period_start
    AND date <= period_end
    AND status NOT IN ('CANCELLED','REJECTED')
  GROUP BY channel
  ORDER BY gross_profit DESC;
  ```

**Analisis Produk section**:
- Produk Terlaris (existing, retain)
- **NEW: Produk Slow-Moving table** — beside "Terlaris":
  ```
  SKU · Nama                  Stok · Terjual periode  Umur Stagnasi
  MCB-legacy-1                42 · 0 unit             60+ hari 💀
  Kabel-brand-X               15 · 1 unit             45 hari ⚠
  Panel-old                   8 · 0 unit              30 hari ⚠
  ```
  Data source:
  ```sql
  WITH sales_in_period AS (
    SELECT item->>'sku' AS sku, SUM((item->>'qty')::INT) AS qty_sold
    FROM public.kasir_transactions,
         jsonb_array_elements(items) AS item
    WHERE tenant_id = _resolve_tenant_id()
      AND date >= period_start
      AND status NOT IN ('CANCELLED','REJECTED')
      AND item->>'sku' IS NOT NULL
    GROUP BY 1
  )
  SELECT
    s.sku,
    s.name,
    s.stock,
    COALESCE(sip.qty_sold, 0) AS qty_sold,
    CURRENT_DATE - COALESCE(
      (SELECT MAX(date) FROM kasir_transactions kt,
              jsonb_array_elements(kt.items) AS it
       WHERE kt.tenant_id = s.tenant_id
         AND it->>'sku' = s.sku
         AND kt.status NOT IN ('CANCELLED','REJECTED')),
      s.updated_at::date
    ) AS days_stagnant
  FROM public.stocks s
  LEFT JOIN sales_in_period sip ON sip.sku = s.sku
  WHERE s.tenant_id = _resolve_tenant_id()
    AND s.stock > 0
    AND (
      COALESCE(sip.qty_sold, 0) = 0
      OR (s.stock > 0 AND sip.qty_sold IS NOT NULL AND sip.qty_sold < s.stock * 0.1)  -- threshold: sold < 10% of current stock
    )
  ORDER BY days_stagnant DESC NULLS LAST
  LIMIT 20;
  ```
  Threshold definition (subject to founder refinement):
  - **"Dead" (💀)**: sold=0 in period AND days_stagnant ≥ 45
  - **"Slow" (⚠)**: sold<10% of stock in period OR days_stagnant ≥ 30
  - **"Active"**: sold ≥ 10% of stock — not listed
  - Cap query to top 20 by days_stagnant to prevent overwhelming table.

**Analisis Customer section** (NEW):
- Top 10 Customer table:
  ```
  Customer               Total Belanja    # Transaksi    Terakhir Beli
  Ali Distributor        Rp 45.000.000    12x            3 hari lalu
  Toko Sinar             Rp 22.000.000    8x             15 hari lalu ⚠
  Pak Budi (walk-in)     Rp 18.000.000    5x             2 hari lalu
  ```
  Data source:
  ```sql
  SELECT
    kt.customer_id,
    kt.customer_name,
    kt.customer_company,
    SUM(kt.subtotal)::NUMERIC AS total_revenue,
    COUNT(*)::INT AS transaction_count,
    MAX(kt.date) AS last_purchase_date,
    (CURRENT_DATE - MAX(kt.date))::INT AS days_since_last
  FROM public.kasir_transactions kt
  WHERE kt.tenant_id = _resolve_tenant_id()
    AND kt.date >= period_start
    AND kt.date <= period_end
    AND kt.status NOT IN ('CANCELLED','REJECTED')
    AND kt.customer_id IS NOT NULL  -- exclude anon walk-ins? or include with customer_name as fallback
  GROUP BY kt.customer_id, kt.customer_name, kt.customer_company
  ORDER BY total_revenue DESC
  LIMIT 10;
  ```
  - Click row → deep link to `Pelanggan → detail(customer_id)` (existing screen)
  - Warning icon ⚠ jika `days_since_last > 14` (dormant signal within period)

**REMOVED from Laporan Performa**:
- AI Efficiency KPI (was #4 KPI card)
- Chat AI vs Manual chart panel

### 5.5 Backend RPCs / queries

**Preferred approach**: use client-side supabase queries via `supabase.from('kasir_transactions').select(...).match(...).aggregate(...)` where possible. Add SECDEF RPC only when the query is complex (multi-table aggregate, JSONB unnest) or must be centralized for tenant safety.

**Candidate new RPCs** (add at plan time as needed):

1. `get_dashboard_maintenance_counts()` → returns `{approval_pending, piutang_overdue_count, piutang_overdue_sum, hutang_overdue_count, hutang_overdue_sum, fulfillment_queue_count, sales_inbox_unread}` — single-round-trip for Dashboard maintenance cards
2. `get_today_snapshot()` → returns `{revenue_today, count_today}` — today strip
3. `get_period_summary_with_delta(p_period TEXT)` → returns current period + previous period aggregates for KPI delta
4. `get_slow_moving_stock(p_period_days INT)` → returns slow-mover table
5. `get_top_customers(p_period_days INT, p_limit INT)` → returns top customer table
6. `get_profit_per_channel(p_period_days INT)` → returns per-channel revenue + profit + margin

All new RPCs: `SECURITY DEFINER STABLE`, owned by `vosi_rpc_owner`, GRANT EXECUTE TO authenticated (REVOKE FROM anon).

Alternative: If any of the above can be done with existing `reportsService` extended methods, prefer that over new RPC. Decide at plan time based on query complexity.

## 6. Multi-tenant + scalability

### 6.1 Existing tenants

- Zero migration for existing tenants — all queries against existing tables via RLS
- New RPCs (if any) apply universally; no per-tenant seed needed
- Cards auto-hide when N=0 → empty tenants see minimal Dashboard, gracefully

### 6.2 New tenants (onboarding)

- Tenant baru dengan 0 data → semua card di Dashboard hidden except "Selamat pagi" header
- Laporan Performa → semua KPI = 0, chart empty, table empty state message
- Zero setup burden

### 6.3 Query scalability

- All 5 maintenance count queries + today strip = 6 SELECTs per Dashboard mount. Parallelizable via `Promise.allSettled`.
- Each query: filter by `tenant_id` (indexed), aggregate over subset. For tenant 100K transaksi: sub-100ms with proper indexing.
- Existing indexes support most queries:
  - `kasir_transactions(tenant_id, date)` — used for today strip + period aggregates
  - `kasir_transactions(tenant_id, status)` — used for fulfillment queue
  - `approval_requests(tenant_id, status)` — used for pending approval count
- Additional indexes needed (verify at plan time; add if missing):
  - `piutang_faktur(tenant_id, due_date, status)`
  - `purchase_tagihan(tenant_id, due_date, status)`
  - `conversations(tenant_id, has_unread_customer, status)`

### 6.4 Storage curve

- Zero net add. No new tables. No new columns.
- Read-only feature: no data grows beyond existing sale/purchase activity.

### 6.5 Cost curve

- No new paid API. No new service upgrade.
- Query load per Dashboard mount: ~6 queries per user session start.
- For Garindo (~10 users) → ~60 queries per day per user × 20 mounts/day = 1200 queries/day → trivial.
- **$/tenant/month impact: ~$0**.

### 6.6 Reversibility

- **Semi-reversible**: cards can be removed/re-added by editing 1 file each. New RPCs droppable (data untouched).
- Not architectural — no PK shape, no partitioning, no signature change to existing hot RPCs.

## 7. Edge cases + validation

| # | Skenario | Handling |
|---|----------|----------|
| 1 | Tenant baru, 0 kasir_transactions | Today strip render "Rp 0 · 0 transaksi". All maintenance cards hidden. |
| 2 | Previous period 0 (baru tenant) | Delta = "—" (em dash) atau "Belum ada data periode sebelumnya" |
| 3 | Approval, Piutang, Hutang, Fulfillment all N=0 | All cards hidden. Dashboard tampil header + Pre-order + Stok tipis + Log AI. Bersih. |
| 4 | Kasir cancelled sale kemarin (edit) | Delta might swing; queries filter `status NOT IN ('CANCELLED','REJECTED')` untuk konsistensi |
| 5 | Sale dengan `customer_id=null` (walk-in tanpa customer) | Top Customer table exclude atau show as "Anonymous" group aggregated |
| 6 | SKU dengan stock=0 tapi ada di sale historis | Slow-mover table exclude (WHERE stock > 0) — no false positive |
| 7 | Overdue but partial payment made | Piutang overdue count still includes; sum uses `remaining_amount_rp` not full amount |
| 8 | Very large tenant (100K SKU) di slow-mover query | Query cap `LIMIT 20` prevent overwhelming UI + slow rendering |
| 9 | Customer with same name multiple transaksi | Aggregate by customer_id, tampilkan latest name/company; if customer_id null, aggregate by (customer_name, customer_phone) tuple |
| 10 | Historical period comparison edge (today = period start) | Previous period = same length before period start; if period includes future dates, cap to today |

## 8. Smoke tests + rollback

### 8.1 Stage 1 — Local verification

1. `npm run lint`, `npm run audit:numinput`, `npm run audit:secdef-null-tenant` clean
2. `npx vitest run --changed` — no existing test files touched (if any test file matches Dashboard/Laporan, run it)
3. UI check via `npm run dev`:
   - Dashboard: renders greeting + today strip + auto-hide cards (verify with empty + populated states via SQL test data)
   - Laporan Performa: 4 KPIs including Gross Profit + delta arrows, slow-mover table, top customer table, profit per channel chart
   - Laporan Akuntansi: unchanged (regression check)
4. Console clean, network 200

### 8.2 SQL smoke — rollback-marker pattern

Per memory `smoke_test_security_definer_rpcs`. For each new RPC (if added), test:
- Owner user + tenant_id set via JWT claims
- Verify returned data shape
- End with `RAISE EXCEPTION 'rollback-marker: X smoke complete'`

### 8.3 Stage 2 — Deploy prod

- `git push main` → cloudbuild.frontend.yaml → Cloud Run --no-traffic → tag URL smoke → 100% traffic

### 8.4 Stage 3 — Prod smoke MCP chrome

- Login as owner (Garindo tenant)
- Dashboard: verify greeting, today strip populated, cards render conditionally (some 0 → hidden, some >0 → shown)
- Laporan Performa: switch periods 7d → 30d → 90d, verify KPI + delta updates, tables refresh
- Regression: Laporan Akuntansi tab still works (Mutasi + Laba Rugi + Neraca + Cash Flow)
- Regression: Existing Dashboard cards (Pre-order, Promo Produk, Log AI) still render correctly
- Console clean

### 8.5 Rollback plan

- **Frontend bug pasca-deploy**: revert Cloud Run revision to previous tag → 100% traffic previous → no DB impact
- **New RPC bug**: `DROP FUNCTION` (if any). Client-side queries only revert via FE revert.
- **DB regression**: none — no schema change, no data modification

## 9. Observability

Per CLAUDE.md requirement:
- **Entry log** at Dashboard mount: `{tenant_id, user_id, feature: 'dashboard', action: 'mount'}`
- **Entry log** at Laporan mount: `{tenant_id, user_id, feature: 'laporan_performa', action: 'mount', period}`
- **Error log** per RPC error branch: `{tenant_id, feature, error_code, error_message}`
- **Usage counter (query-based)**:
  - Adoption per tenant: `SELECT COUNT(DISTINCT user_id) FROM audit_log WHERE feature='laporan_performa' GROUP BY tenant_id`
  - No new metric infra needed

## 10. Success criteria

Feature dikatakan berhasil kalau:

1. Owner Garindo buka Dashboard: **tidak lihat metric duplicate** dengan Laporan. Fokus pada action items.
2. Owner Garindo buka Laporan Performa: **lihat Gross Profit + delta vs previous** di KPI row.
3. Owner Garindo bisa identify **slow-moving stock** dalam 5 detik.
4. Owner Garindo bisa identify **top customer** untuk periode.
5. Owner Garindo bisa compare **profit per channel** (bukan cuma revenue).
6. Multi-tenant: bikin tenant test baru, verify Dashboard bersih (semua card hidden), Laporan menampilkan "Belum ada data" gracefully.
7. Advisor check post-deployment: no critical finding.
8. Regression zero: existing Pre-order, Promo Produk, Log AI, Akuntansi tab tetap kerja.

---

## 11. Migration slot allocation

Depend on new RPCs added at plan time. Kalau ada, klaim slot `20261115000130+` (block 130-149 free per memory `migration_slot_allocation`).

---

## 12. Reversibility rating

**Reversibility**: **Reversible / tactical** — semua UI changes revert-able via single-commit revert; new RPCs (jika ada) droppable dengan zero data loss; existing schema tidak diubah.

Per CLAUDE.md: no advisor memo required (not irreversible). Advisor call tetap dipanggil pre-commit sesuai trigger diff-size (~10 files, ~500 lines).

---

**End of spec.**
