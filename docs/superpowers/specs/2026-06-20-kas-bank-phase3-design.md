# Kas & Bank — Phase 3 Design Spec (Laporan)

**Tanggal:** 2026-06-20
**Status:** Draft — menunggu user review untuk lock requirements
**Roadmap:** `2026-06-20-kas-bank-roadmap.md`
**Depends on:** Phase 1a (data model + balance view) + Phase 2 (manual entry + categories)

---

## 1. Goal

Owner akhir bulan tinggal kirim PDF ke akuntan eksternal. Owner mau review keputusan: bisa pivot uang masuk vs keluar per kategori per bulan.

**Success criteria:**
- Laporan mutasi per akun (PDF + Excel + CSV) periode arbitrary
- Laporan saldo akhir bulanan per akun (trailing 12 bulan)
- Cash flow report bulanan: matriks `category × month` untuk IN dan OUT
- Multi-account select untuk laporan gabungan
- Filter exclude akun pribadi default (toggle untuk include kalau owner mau)

---

## 2. Locked decisions (carry-over + new)

From Phase 2:
- `category` text di cash_movements sudah terisi dari source events (KASIR_SALE, PI_PAYMENT, MANUAL_TRANSFER, dll)
- Owner pribadi accounts ditag purpose='OWNER_PERSONAL'

New di Phase 3:
- Mount laporan di sidebar Laporan existing (jadi tab/sub-menu, bukan top-level Kas & Bank)
- PDF pakai pattern existing (`jsPDF + jspdf-autotable`, header branded ala Invoice PDF)
- Excel pakai `exceljs` (already in deps? check before lock)
- Default periode: bulan ini
- Default exclude akun pribadi (toggle "Include akun pribadi" di filter)

---

## 3. Out of scope Phase 3

- P&L / Neraca / Arus Kas formal akuntansi → roadmap Phase 1 multi-tenant separate spec
- Email auto-send laporan ke akuntan → Phase 4+
- Custom report builder → YAGNI
- Drill-down dari cash flow matrix ke individual movements → Phase 4 nice-to-have

---

## 4. Data model

No new tables. Phase 3 read-only on `cash_movements` + `cash_accounts` + `cash_account_balances`.

### 4.1 Helper view: `cash_movements_categorized`

```sql
CREATE OR REPLACE VIEW public.cash_movements_categorized AS
SELECT
  m.*,
  a.internal_label AS account_label,
  a.account_type,
  a.purpose,
  -- Normalize category: derive bucket from source_type + category text
  CASE
    WHEN m.source_type = 'KASIR_SALE' THEN 'Penjualan'
    WHEN m.source_type = 'PIUTANG_PAYMENT' THEN 'Pelunasan Piutang'
    WHEN m.source_type = 'PI_PAYMENT' THEN 'Bayar Pembelian'
    WHEN m.source_type = 'MANUAL_TRANSFER' THEN 'Transfer Internal'
    WHEN m.source_type = 'MANUAL_DEPOSIT' THEN 'Setor Kas'
    WHEN m.source_type = 'CASH_BATCH_DEPOSIT' THEN 'Setor Kasir'
    WHEN m.source_type = 'OWNER_DRAWING' THEN 'Tarik Pribadi'
    WHEN m.source_type = 'OWNER_TOPUP' THEN 'Setor dari Owner'
    WHEN m.source_type = 'ADJUSTMENT' THEN 'Penyesuaian'
    WHEN m.source_type = 'WALLET_TOPUP' THEN 'Top-Up Wallet'
    WHEN m.source_type = 'WALLET_SPEND' THEN 'Spending Wallet'
    WHEN m.source_type = 'OPENING_BALANCE' THEN 'Saldo Awal'
    WHEN m.source_type = 'BACKFILL' THEN 'Backfill Historis'
    ELSE 'Lainnya'
  END AS category_bucket
FROM public.cash_movements m
JOIN public.cash_accounts a ON a.id = m.account_id
WHERE m.status = 'CLEARED';  -- exclude PENDING from reports
```

### 4.2 Helper view: `monthly_account_balances` (trailing 12)

```sql
CREATE OR REPLACE VIEW public.monthly_account_balances AS
WITH months AS (
  SELECT generate_series(
    date_trunc('month', now() - interval '11 months'),
    date_trunc('month', now()),
    interval '1 month'
  )::date AS month_start
),
expanded AS (
  SELECT a.id AS account_id, a.internal_label, a.account_type, a.purpose, a.opening_balance, m.month_start
  FROM public.cash_accounts a CROSS JOIN months m
  WHERE a.is_active = true
)
SELECT
  e.*,
  e.opening_balance + COALESCE((
    SELECT SUM(CASE WHEN cm.direction='IN' THEN cm.amount ELSE -cm.amount END)
    FROM public.cash_movements cm
    WHERE cm.account_id = e.account_id
      AND cm.status = 'CLEARED'
      AND cm.occurred_at <= e.month_start + interval '1 month' - interval '1 second'
  ), 0) AS month_end_balance
FROM expanded e;
```

### 4.3 Helper view: `cash_flow_matrix`

```sql
CREATE OR REPLACE VIEW public.cash_flow_matrix AS
SELECT
  date_trunc('month', occurred_at)::date AS month,
  category_bucket,
  direction,
  SUM(amount) AS total_amount,
  COUNT(*) AS event_count
FROM public.cash_movements_categorized
WHERE status = 'CLEARED'
GROUP BY month, category_bucket, direction;
```

---

## 5. UI components

### 5.1 Mount in sidebar Laporan

Update `src/components/LaporanScreen.tsx` tambah tab "Kas & Bank":
- Tab structure existing: "Penjualan", "Pembelian", "Inventory" + NEW "Kas & Bank"
- Atau buat dedicated screen `LaporanKasBankScreen.tsx` dan mount sebagai sub-route

### 5.2 NEW: `src/components/laporan/kasbank/LaporanKasBankScreen.tsx`

3 tab: Mutasi, Saldo Trailing, Cash Flow.

**Tab Mutasi:**
- Filter bar: account multi-select, periode (preset: bulan ini, 30 hari, custom), include pribadi toggle
- Table: occurred_at, account, description, category, direction, amount, status
- Footer: total IN, total OUT, net
- Ekspor buttons: PDF, Excel, CSV

**Tab Saldo Trailing:**
- Chart line/bar: month-end balance per akun (trailing 12 bulan)
- Table: kolom = bulan, baris = akun, cell = saldo akhir
- Ekspor buttons: PDF, Excel

**Tab Cash Flow:**
- Matrix table: rows = category_bucket, columns = month, cells = total IN / total OUT (or net)
- Toggle: gross IN, gross OUT, net
- Default: 6 bulan terakhir
- Ekspor buttons: PDF, Excel

### 5.3 PDF generation

`src/lib/laporan/kasbank/`:
- `mutasiPdf.ts` — generate `generateMutasiPdf(filter, movements, accounts, settings) → { blob, filename }`
- `saldoTrailingPdf.ts`
- `cashFlowPdf.ts`

Layout: header branded (logo, nama toko, periode), table autotable, footer signature block.

### 5.4 Excel generation

`src/lib/laporan/kasbank/excelExport.ts`:
- Pakai `exceljs` library (check `package.json` first)
- Multi-sheet workbook: 1 sheet per akun (untuk Mutasi), atau 1 sheet pivot (untuk Cash Flow)
- Formatting: header bold, freeze top row, autofilter
- Number format: Rupiah (#,##0;(#,##0))

### 5.5 CSV generation

Plain CSV, escape commas + quotes. Use existing utility if available.

---

## 6. Edge cases

| Case | Handling |
|---|---|
| Periode mencakup data sebelum opening_balance_date | Saldo awal = 0 untuk periode tersebut (data backfill cover) |
| Akun deleted (is_active=false) di tengah periode | Tampilkan di laporan dengan label "(Tidak Aktif)" |
| 12 bulan trailing tapi akun baru dibuat 3 bulan lalu | Display 9 bulan awal saldo = NULL atau "—" (bukan 0) |
| Movement dengan category_bucket = NULL | Bucket ke "Lainnya" |
| Owner export 1 tahun data dengan 100k+ rows | Excel: chunk render; PDF: warning ">10k rows, gunakan Excel untuk performance" |
| Multi-account select dengan beda currency (future) | Phase 3 single IDR only — skip |
| User pilih akun pribadi + akun bisnis sekaligus | Show separate sections per akun in PDF; total terpisah |

---

## 7. Testing strategy

**Unit:**
- View `cash_movements_categorized` correct categorization per source_type
- monthly_account_balances handles empty period
- cash_flow_matrix pivot correctness

**Integration:**
- Backfilled data + new movements → laporan correct total
- Multi-account filter
- PDF blob size > 5kb (sanity check)

**E2E:**
- Owner click "Ekspor PDF" → file downloads, open dan terbaca
- Cash flow matrix angka match dengan manual sum

---

## 8. Risk + mitigation

| Risk | Mitigation |
|---|---|
| Performance: 1 tahun data + 5 akun + cash flow matrix = slow query | Index existing sudah cover; if slow, materialize view + nightly refresh |
| Excel export browser memory cap | Chunk rendering 10k rows per chunk; warning UI for huge exports |
| PDF font kecil (Indonesian context, banyak text) | Per [[feedback_font_sizing]]: PDF data 11-12px minimum |
| Category bucket mapping incomplete (new source_type added in future) | Default to 'Lainnya' bucket; flag in dev logs |
| Akun pribadi accidentally included in akuntan laporan | Default toggle OFF; owner explicit opt-in; PDF header tag "(termasuk pribadi)" |

---

## 9. Open questions for user

**O1. Format laporan untuk akuntan eksternal.** Akuntan biasa pakai format standar? Apakah PDF kita harus mirip:
- (a) Format custom kita sendiri (mockup ala Mekari Jurnal)
- (b) Mirror format SAK ETAP simplified (saldo awal, IN, OUT, saldo akhir)
- (c) Tanyakan ke akuntan dulu sebelum lock

**O2. Excel library.** Saat ini codebase punya `exceljs`?
- Check: `package.json` dependencies — kalau ada, pakai
- Kalau tidak ada: install vs avoid (xlsx alternative lighter tapi license issue)
- (a) Install exceljs
- (b) Pakai xlsx-js-style (alternative)
- (c) Skip Excel di Phase 3, CSV only

**O3. Drill-down dari cash flow matrix.** Owner klik cell "Penjualan Juni Rp 25jt" — apakah:
- (a) Static (no drill-down) — keep simple
- (b) Drill ke list movements yg contribute
- (c) Drill ke OrderHistory filtered

**O4. Periode default.** Saat owner buka laporan:
- (a) Bulan ini
- (b) Bulan lalu (untuk laporan retrospektif)
- (c) 30 hari trailing

**O5. Save filter preference.** Owner sering pakai filter yang sama. Apakah:
- (a) localStorage save last filter
- (b) Database save per-user (tambah `user_report_preferences` table)
- (c) Manual setiap kali

**O6. Auto-email ke akuntan.** Akuntan rutin minta laporan bulanan. Apakah Phase 3 sertakan:
- (a) No auto-email (current spec)
- (b) Optional: tambah email recipient di Pengaturan, tombol "Email Laporan" di UI
- (c) Cron job auto-generate tanggal 1 setiap bulan + email

**O7. Chart library.** Untuk Tab Saldo Trailing.
- (a) Tidak ada chart, hanya tabel
- (b) Recharts (existing di codebase?)
- (c) Chart.js
- (d) Custom SVG sederhana

---

## 10. Estimate (3-4 hari)

| Komponen | Estimasi |
|---|---|
| Helper views (categorized, monthly_balances, cash_flow_matrix) + tests | 0.5 hari |
| PDF generators (3) + common header/footer | 1-1.5 hari |
| Excel generator + multi-sheet handling | 0.5-1 hari |
| CSV utility | 0.25 hari |
| LaporanKasBankScreen UI dengan 3 tab | 1 hari |
| Filter bar + chart (saldo trailing) | 0.5 hari |
| E2E smoke + akuntan handoff review | 0.5 hari |

Total: **3-4 hari**.
