# Akuntansi Phase 4 — Laporan Design Spec

**Date:** 2026-06-22
**Status:** Draft for user review
**Phase:** 4 of Akuntansi MSME roadmap (after Phase 0a foundation + Phase 1 Cash & Bank + Phase 3 Manual Entry + Phase 0d GL UI shipped)
**Mockup reference:** `docs/superpowers/mockups/2026-06-21-akuntansi-phase4-laporan.html`

---

## 1. Goal

Lengkapi loop akuntansi MSME dengan **laporan SAK EMKM yang printable** — Owner sekarang bisa generate Profit & Loss + Neraca format-akuntan untuk pelanggan eksternal (bank, BPJS, pelaporan pajak) langsung dari aplikasi tanpa export manual ke Excel.

## 2. Scope

### In-scope (4 sub-tabs di LaporanScreen)

1. **Tab "Performa"** (existing) — current sales analytics dashboard, tidak berubah
2. **Tab "Akuntansi"** (NEW) — sub-tabs untuk 4 laporan akuntansi:
   - **Mutasi** — table cross-account dari `journal_entry_lines` + `journal_entries` dengan multi-account filter + kategori derivation
   - **Laba Rugi (P&L)** — format SAK EMKM (Pendapatan → HPP → Laba Kotor → Beban Op → Laba Operasional → Lain-lain → Laba Sebelum Pajak → Pajak → Laba Neto)
   - **Neraca (Balance Sheet)** — format SAK EMKM (Aset Lancar + Aset Tetap | Liabilitas Lancar + Jk Panjang | Ekuitas) with verified balance equation
   - **Cash Flow Matrix** — pivot table 6 bulan trailing × kategori (Penjualan, Bayar Pembelian, Beban Operasional, Tarik Pribadi, dll)
3. **Export PDF SAK EMKM** untuk Laba Rugi + Neraca (client-side jspdf)
4. **Excel + CSV export** untuk semua tab → placeholder toast (Phase 5 atau later)

### Out-of-scope (defer)
- Saldo Trailing tab — overlaps dengan future dashboard widget
- Trial Balance sub-tab — sudah ada di Phase 0d AkuntansiScreen
- Excel + CSV export — placeholder only
- Custom date range UI (just preset periods for now)
- Comparative reports (this period vs last period) — defer
- Per-tenant multi-entity — defer (single-tenant Garindo)

## 3. Architecture

### Layout

```
LaporanScreen
├─ Top tabs: [Performa] [Akuntansi]
├─ Performa tab → existing dashboard (KpiCard + recharts)
└─ Akuntansi tab → 4 sub-tabs:
    ├─ Mutasi
    ├─ Laba Rugi
    ├─ Neraca
    └─ Cash Flow
```

### Data flow

All 4 sub-tabs read from existing Phase 0a infrastructure:
- `journal_entries` table (source_type, entry_date, source_ref_table)
- `journal_entry_lines` table (account_id, side, amount)
- `chart_of_accounts` table (type, subtype, name, code)
- NO new views or RPCs (client-side aggregation)

### File structure

```
src/components/
├─ LaporanScreen.tsx                          (MODIFY — wrap existing content in tab; add Akuntansi tab)
└─ laporan/akuntansi/                         (NEW dir)
   ├─ AkuntansiLaporanTab.tsx                 (CREATE — parent tab dengan sub-tab nav)
   ├─ MutasiTab.tsx                           (CREATE)
   ├─ LabaRugiTab.tsx                         (CREATE)
   ├─ NeracaTab.tsx                           (CREATE)
   └─ CashFlowTab.tsx                         (CREATE)
src/lib/akuntansi/
├─ reportQueries.ts                           (CREATE — fetchMutasi, fetchLabaRugi, fetchNeraca, fetchCashFlow)
└─ reportQueries.test.ts                      (CREATE)
src/lib/akuntansi/
├─ pdfExport.ts                               (CREATE — generateLabaRugiPDF, generateNeracaPDF using jspdf)
└─ pdfExport.test.ts                          (CREATE — snapshot test of PDF metadata)
tests/integration/akuntansi-phase4/
├─ _setup.ts                                  (CREATE)
├─ mutasi.test.ts                             (CREATE)
├─ laba-rugi.test.ts                          (CREATE)
└─ neraca.test.ts                             (CREATE)
```

## 4. Data Computation (client-side)

### 4.1 Mutasi

Read `journal_entry_lines` JOIN `journal_entries` JOIN `chart_of_accounts` filtered by:
- `account_id IN (selectedAccountIds)` — multi-select COA filter (default: all CASH-related accounts since this is "Mutasi Akun" = cash movement)
- `entry_date BETWEEN fromDate AND toDate`
- Optional direction filter (IN=DEBIT lines / OUT=CREDIT lines for DEBIT-normal cash accounts)
- Optional category filter (derived from `source_type`)

Category mapping from `source_type`:
- `KASIR_SALE` → "Penjualan"
- `PEMBAYARAN` → "Bayar Pembelian"
- `PIUTANG_PAYMENT` / `WALKIN_PAYMENT` → "Pelunasan Piutang"
- `KASIR_EXPENSE` → "Beban Operasional"
- `MANUAL_TRANSFER` → "Transfer Internal"
- `OWNER_DRAWING` → "Tarik Pribadi"
- `OWNER_TOPUP` → "Topup Owner"
- `WALLET_TOPUP` / `WALLET_SPEND` → "Wallet"
- `ADJUSTMENT` → "Penyesuaian"
- `OPENING_BALANCE` → "Saldo Awal"
- `TAX_ACCRUAL_PPH` → "Pajak"
- (others)

Summary row: Total IN, Total OUT, Net.

### 4.2 Laba Rugi (P&L)

Period = startDate..endDate (typically full month or custom range).

Aggregate `journal_entry_lines`:
- **Pendapatan**: `SUM(amount) WHERE coa.type='PENDAPATAN' AND side='CREDIT'` minus debit reversals
- **HPP**: `SUM(amount) WHERE coa.subtype='HPP' AND side='DEBIT'`
- **Beban Operasional**: `SUM(amount) WHERE coa.subtype='BEBAN_OPERASIONAL' AND side='DEBIT'`
- **Beban Non-Op**: subtype='BEBAN_NON_OPERASIONAL' (excluding pajak)
- **Pendapatan Lain-lain**: account_subtype='PENDAPATAN_LAIN'
- **Beban Pajak**: account_code = '5-3300' (PPh Final)

Compute:
- Pendapatan Bersih
- Laba Kotor = Pendapatan Bersih - HPP
- Laba Operasional = Laba Kotor - Total Beban Operasional
- Laba Sebelum Pajak = Laba Operasional + Pendapatan/(Beban) Lain-lain
- Laba Neto = Laba Sebelum Pajak - Beban Pajak

### 4.3 Neraca (Balance Sheet)

As-of date = endDate (default: today or end of selected month).

Cumulative balance per account `WHERE entry_date <= asOfDate` (similar pattern to `fetchTrialBalanceAsOf` from Phase 0d):
- **Aset Lancar**: account_subtype IN (BANK, KAS, E_WALLET, PIUTANG, PERSEDIAAN, DP_KELUAR)
- **Aset Tetap**: subtype IN (PERALATAN, KENDARAAN) minus AKUMULASI_PENYUSUTAN
- **Liabilitas Lancar**: type=LIABILITAS, subtype IN (HUTANG_USAHA, DP_MASUK, HUTANG_PPH)
- **Liabilitas Jk Panjang**: type=LIABILITAS, subtype=HUTANG_BANK_JKPANJANG
- **Ekuitas**: type=MODAL (Modal Owner, Laba Ditahan, Prive, plus Laba Tahun Berjalan computed from current year P&L)

Verify equation: Total Aset === Total Liabilitas + Total Ekuitas.

Laba Tahun Berjalan = sum of (Pendapatan - Beban) untuk year-to-date, computed inline.

### 4.4 Cash Flow Matrix

Pivot table: rows=kategori (from source_type), columns=6 months trailing (default last 6 incl. current), cells=net flow (kategori contribution to cash that month).

3 view modes:
- **Net**: net cash movement per kategori per bulan (debit cash - credit cash)
- **Gross IN**: total debit to cash accounts only (positive cash inflows)
- **Gross OUT**: total credit from cash accounts only

Cash accounts = `cash_accounts.coa_account_id` (joined to chart_of_accounts where type=ASET subtype IN (BANK, KAS, E_WALLET)).

Bottom row: NET CASH FLOW per month + 6-month total column.

## 5. PDF SAK EMKM Export

### Library: jspdf + jspdf-autotable

Use `jspdf` for PDF generation with `jspdf-autotable` plugin for clean tables.

### `generateLabaRugiPDF(input: LabaRugiData, options: PDFOptions): Blob`

Layout:
```
[Header centered]
PT GARINDO JAYA PANEL
NPWP: <from accounting_config>
Alamat: <from tenant_settings>

LAPORAN LABA RUGI
Periode 1-30 Juni 2026

[Body — table with autotable]
PENDAPATAN
  Penjualan Walkin              45.300.000
  Penjualan Marketplace         38.500.000
  ...
  Pendapatan Bersih            194.750.000

HPP
  HPP Penjualan              (125.300.000)

LABA KOTOR                      69.450.000

[... rest of P&L ...]

LABA NETO BULAN INI             35.540.000

[Footer]
Dicetak: 22 Juni 2026 15:30 WIB
Sistem Akuntansi: Garindo ERP

[Signature line]
Owner / Direktur
__________________
( ________________ )
```

### `generateNeracaPDF(input: NeracaData, options: PDFOptions): Blob`

Side-by-side layout:
- Left half: ASET (with sub-section Aset Lancar + Aset Tetap)
- Right half: LIABILITAS + EKUITAS

Confirmation row at bottom: `TOTAL ASET = TOTAL LIABILITAS + EKUITAS ✓`

Same header + footer pattern.

### PDFOptions
```typescript
interface PDFOptions {
  companyName: string;
  npwp: string | null;
  address: string | null;
  generatedAt: Date;
}
```

Read from `accounting_config` + `tenant_settings` on the fly.

## 6. UI Layout Details

### LaporanScreen modification

Add top tab strip:
```tsx
<div className="flex gap-2 mb-4">
  <button className={...}>Performa</button>
  <button className={...}>Akuntansi</button>
</div>
{tab === 'performa' && <ExistingDashboard />}
{tab === 'akuntansi' && <AkuntansiLaporanTab showToast={showToast} />}
```

### AkuntansiLaporanTab

Wrapper with 4 sub-tabs (pill-style per mockup top bar):
- Mutasi (List icon)
- Laba Rugi (TrendingUp icon)
- Neraca (Layout icon)
- Cash Flow (Droplet icon)

State management: active sub-tab + period filter (shared across sub-tabs where applicable).

### MutasiTab
- Header: title + Export PDF/Excel/CSV buttons (placeholder toasts)
- Filter row: Akun multi-select chip + Periode dropdown + Arah (IN/OUT/Semua) + Kategori
- Summary bar: Total IN, Total OUT, Net + "Include akun Pribadi" toggle
- Table: Tanggal | Akun | Kategori | Keterangan | IN | OUT
- Tfoot total + pagination

### LabaRugiTab
- Hero header gradient emerald `linear-gradient(135deg, #065f46, #047857)` text-center: PT Name + "Laporan Laba Rugi · Periode [range]"
- P&L body with grouped sub-sections + subtotal rows + final Laba Neto (large emerald)
- Info banner amber: "Format SAK EMKM sederhana..."
- Export buttons: **PDF SAK EMKM** (real, jspdf) + Excel (placeholder)

### NeracaTab
- Hero header gradient violet `linear-gradient(135deg, #6b21a8, #5b21b6)`: PT Name + "Neraca · Per [asOfDate]"
- Body grid 2-col: ASET (left) | LIABILITAS + EKUITAS (right)
- Confirmation banner amber: "Persamaan akuntansi terverifikasi: Aset = Liabilitas + Ekuitas ✓"
- Export buttons: **PDF SAK EMKM** + Excel

### CashFlowTab
- Header: title + 3 view-mode pills (Net / Gross IN / Gross OUT)
- Matrix table dengan sticky-left first column (kategori names)
- Current month column highlighted blue (`bg: #dbeafe`)
- Total column highlighted emerald (`bg: #d1fae5`)
- Footer NET CASH FLOW row aggregated

## 7. Validation Rules

| Field | Rule |
|---|---|
| Period filter | endDate >= startDate |
| Mutasi multi-select | at least 1 akun selected, else default to all cash accounts |
| PDF export | Only enabled when period has at least 1 entry |
| Neraca as-of | Default = today; user can set past date |

## 8. Error Handling

- Empty period → render placeholder "Belum ada transaksi"
- COA missing for category mapping → show as "Lainnya"
- PDF generation error → showToast "Gagal generate PDF" + console log
- Network errors → "Gagal memuat laporan"

## 9. Testing Strategy

### Unit tests (vitest)
- `reportQueries.test.ts` — 4 fetch functions with mocked supabase; verify SQL filters + aggregation correctness
- `pdfExport.test.ts` — snapshot test of jspdf output metadata (page count, header text) — light test

### Integration tests (vitest Pattern C)
- `mutasi.test.ts` — verify schema joins work + category derivation from source_type
- `laba-rugi.test.ts` — period filtering returns correct subset
- `neraca.test.ts` — as-of date filter works + balance equation holds for sample data

### Manual smoke (browser via Chrome DevTools MCP)
- Open Laporan → tab Akuntansi → 4 sub-tabs load
- Switch Mutasi multi-account filter → table updates
- P&L period change → numbers recompute
- Click "PDF SAK EMKM" on P&L → file downloads
- Click "PDF SAK EMKM" on Neraca → file downloads
- Cash Flow view mode toggle → numbers flip

## 10. Decisions Locked (brainstorm)

| Q | Decision |
|---|---|
| Architecture | Extend LaporanScreen with top tabs (Performa + Akuntansi). |
| Sub-tab scope | 4 tabs: Mutasi + P&L + Neraca + Cash Flow. Skip Saldo Trailing + Trial Balance dedup. |
| Export | PDF SAK EMKM for P&L + Neraca (real, client-side jspdf). Excel/CSV = placeholder toast. |

## 11. Effort Estimate

- Service layer + queries + unit tests: **1.5 hari**
- PDF export library (jspdf integration + 2 generators): **1.5 hari**
- 4 sub-tab components (Mutasi, P&L, Neraca, Cash Flow): **3 hari**
- LaporanScreen tab refactor + AkuntansiLaporanTab wrapper: **0.5 hari**
- Integration tests + smoke: **1 hari**

**Total: ~7.5 hari engineering** (target 1 minggu via subagent-driven dev).

## 12. Success Criteria

- [ ] LaporanScreen top tabs (Performa preserved + Akuntansi NEW)
- [ ] 4 sub-tabs functional: Mutasi/P&L/Neraca/Cash Flow
- [ ] P&L computes correctly: Pendapatan Bersih → Laba Kotor → Laba Operasional → Laba Neto
- [ ] Neraca balance equation verified (Aset = Liab + Ekuitas)
- [ ] PDF SAK EMKM downloads for P&L + Neraca dengan format akuntan-grade
- [ ] Cash Flow matrix 6 bulan trailing + 3 view modes (Net/Gross IN/Gross OUT)
- [ ] Mutasi multi-account filter + category derivation works
- [ ] tsc + tests + build OK
- [ ] No regression di Phase 0a / 0d / 1 / 3 / existing Laporan Performa

---

## Next Steps

1. User review spec — request changes kalau ada
2. Write implementation plan (10-11 tasks)
3. Execute via subagent-driven-development
