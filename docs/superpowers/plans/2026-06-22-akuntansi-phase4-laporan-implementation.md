# Akuntansi Phase 4 Laporan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4 sub-tabs Akuntansi di LaporanScreen — Mutasi, Laba Rugi (P&L), Neraca, Cash Flow Matrix — plus PDF SAK EMKM export untuk P&L + Neraca.

**Architecture:** LaporanScreen wrapped dengan top tabs (Performa existing + Akuntansi new). AkuntansiLaporanTab sebagai parent dengan 4 sub-tab pills. All data computed client-side dari journal_entries + journal_entry_lines + chart_of_accounts (zero schema changes). PDF via jspdf + jspdf-autotable.

**Tech Stack:** React 18 + TypeScript strict, Tailwind v4, lucide-react, vitest, jspdf, jspdf-autotable.

## Global Constraints

- TypeScript strict, zero `any` in new files
- All data fetched client-side (no new RPCs, no new views)
- PDF generation client-side using jspdf — install via `npm install jspdf jspdf-autotable`
- Match design tokens: `--color-primary: #1e3d60`, `#012749`, `#c7d7f5`, `#fafbff`, rounded-full pill, lucide-react icons
- Indonesian number formatting `new Intl.NumberFormat('id-ID')`, currency for hero totals only
- Sub-tab pattern mirror Phase 0d (AccountDetailScreen border-b-2 emerald-600 active)
- Existing `LaporanScreen` ("Laporan Performa" sales dashboard) MUST be preserved as the "Performa" top tab
- Period default = current month (1st to today); user can change via dropdown (Bulan ini / 30 hari / Tahun ini / Custom)
- Cash accounts for Cash Flow Matrix = joined via `cash_accounts.coa_account_id`
- COA category mapping (from source_type) consistent across Mutasi + Cash Flow

## File Structure

**Service layer:**
- `src/lib/akuntansi/reportQueries.ts` (CREATE) — fetchMutasi, fetchLabaRugi, fetchNeraca, fetchCashFlow
- `src/lib/akuntansi/reportQueries.test.ts` (CREATE)
- `src/lib/akuntansi/pdfExport.ts` (CREATE) — generateLabaRugiPDF, generateNeracaPDF
- `src/lib/akuntansi/pdfExport.test.ts` (CREATE)

**UI:**
- `src/components/LaporanScreen.tsx` (MODIFY) — add top tab + wrap existing as "Performa" tab
- `src/components/laporan/akuntansi/AkuntansiLaporanTab.tsx` (CREATE) — parent with 4 sub-tabs
- `src/components/laporan/akuntansi/MutasiTab.tsx` (CREATE)
- `src/components/laporan/akuntansi/LabaRugiTab.tsx` (CREATE)
- `src/components/laporan/akuntansi/NeracaTab.tsx` (CREATE)
- `src/components/laporan/akuntansi/CashFlowTab.tsx` (CREATE)

**Tests:**
- `tests/integration/akuntansi-phase4/_setup.ts` (CREATE)
- `tests/integration/akuntansi-phase4/laba-rugi.test.ts` (CREATE)
- `tests/integration/akuntansi-phase4/neraca.test.ts` (CREATE)

**Docs:**
- `progress.md` (MODIFY)
- `package.json` (MODIFY) — add jspdf + jspdf-autotable deps

---

## Task Breakdown

### Task 1: Install jspdf deps + scaffold pdfExport module

**Files:**
- Modify: `package.json` — add `jspdf` + `jspdf-autotable`
- Create: `src/lib/akuntansi/pdfExport.ts` (skeleton with types)

**Interfaces produced:**
```typescript
export interface PDFCompanyInfo {
  companyName: string;
  npwp: string | null;
  address: string | null;
}

export interface PDFGenerationOptions {
  company: PDFCompanyInfo;
  generatedAt: Date;
  fileName?: string;
}

export interface LabaRugiData {
  periodLabel: string;  // "Periode 1-30 Juni 2026"
  startDate: string;
  endDate: string;
  pendapatan: Array<{ code: string; name: string; amount: number }>;
  diskonPenjualan: number;
  pendapatanBersih: number;
  hpp: Array<{ code: string; name: string; amount: number }>;
  labaKotor: number;
  bebanOperasional: Array<{ code: string; name: string; amount: number }>;
  totalBebanOp: number;
  labaOperasional: number;
  pendapatanLainLain: Array<{ code: string; name: string; amount: number }>;
  bebanLainLain: Array<{ code: string; name: string; amount: number }>;
  labaSebelumPajak: number;
  bebanPajak: number;
  labaNeto: number;
}

export interface NeracaData {
  asOfDate: string;
  asOfLabel: string;  // "Per 30 Juni 2026"
  asetLancar: Array<{ code: string; name: string; amount: number }>;
  totalAsetLancar: number;
  asetTetap: Array<{ code: string; name: string; amount: number }>;
  akumulasiPenyusutan: number;
  totalAsetTetap: number;
  totalAset: number;
  liabilitasLancar: Array<{ code: string; name: string; amount: number }>;
  totalLiabLancar: number;
  liabilitasJkPanjang: Array<{ code: string; name: string; amount: number }>;
  totalLiabJkPanjang: number;
  totalLiabilitas: number;
  ekuitas: Array<{ code: string; name: string; amount: number }>;
  totalEkuitas: number;
}

export function generateLabaRugiPDF(data: LabaRugiData, options: PDFGenerationOptions): Blob;
export function generateNeracaPDF(data: NeracaData, options: PDFGenerationOptions): Blob;
```

- [ ] **Step 1**: `npm install jspdf jspdf-autotable` + verify install (`npm ls jspdf`)
- [ ] **Step 2**: Write `pdfExport.ts` with types + empty function stubs (return placeholder Blob)
- [ ] **Step 3**: `npx tsc --noEmit` clean
- [ ] **Step 4**: Commit `feat(akuntansi): Phase 4 Task 1 — install jspdf + scaffold pdfExport module`

---

### Task 2: reportQueries.ts service + unit tests

**Files:**
- Create: `src/lib/akuntansi/reportQueries.ts`
- Create: `src/lib/akuntansi/reportQueries.test.ts`

**Interfaces produced:**
```typescript
// All return aggregated client-side results

export interface MutasiRow {
  entry_id: string;
  entry_date: string;
  entry_number: string;
  account_id: string;
  account_code: string;
  account_label: string;  // internal_label dari cash_accounts atau account_name
  source_type: string;
  category: string;  // derived
  description: string;
  in_amount: number;   // 0 if OUT
  out_amount: number;  // 0 if IN
}

export interface MutasiFilters {
  accountIds: string[];  // empty = all cash accounts
  fromDate: string;
  toDate: string;
  direction?: 'IN' | 'OUT' | 'ALL';
  category?: string | 'ALL';
  includePersonal?: boolean;
}

export async function fetchMutasi(filters: MutasiFilters): Promise<MutasiRow[]>;

export interface LineItem { code: string; name: string; amount: number }

export interface LabaRugiResult {
  pendapatan: LineItem[];
  pendapatanBersih: number;
  hpp: LineItem[];
  totalHpp: number;
  labaKotor: number;
  bebanOperasional: LineItem[];
  totalBebanOp: number;
  labaOperasional: number;
  pendapatanLainLain: LineItem[];
  bebanLainLain: LineItem[];
  labaSebelumPajak: number;
  bebanPajak: number;
  labaNeto: number;
}

export async function fetchLabaRugi(fromDate: string, toDate: string): Promise<LabaRugiResult>;

export interface NeracaResult {
  asetLancar: LineItem[];
  totalAsetLancar: number;
  asetTetap: LineItem[];
  akumulasiPenyusutan: number;
  totalAsetTetap: number;
  totalAset: number;
  liabilitasLancar: LineItem[];
  totalLiabLancar: number;
  liabilitasJkPanjang: LineItem[];
  totalLiabJkPanjang: number;
  totalLiabilitas: number;
  ekuitas: LineItem[];
  totalEkuitas: number;
  balanceCheck: { isBalanced: boolean; diff: number };
}

export async function fetchNeraca(asOfDate: string): Promise<NeracaResult>;

export interface CashFlowCell { month: string; net: number; grossIn: number; grossOut: number }
export interface CashFlowCategory { category: string; cells: CashFlowCell[]; totalNet: number; totalIn: number; totalOut: number }
export interface CashFlowResult {
  months: string[];  // ['Jan', 'Feb', ..., 'Jun']
  monthDates: Array<{ year: number; month: number; label: string }>;
  uangMasuk: CashFlowCategory[];
  uangKeluar: CashFlowCategory[];
  netPerMonth: number[];
  totalNet: number;
}

export async function fetchCashFlow(endYear: number, endMonth: number, trailingMonths: number): Promise<CashFlowResult>;
```

**Source-type → kategori mapping** (shared util, place at top of file):
```typescript
const CATEGORY_MAP: Record<string, string> = {
  KASIR_SALE: 'Penjualan',
  PEMBAYARAN: 'Bayar Pembelian',
  PIUTANG_PAYMENT: 'Pelunasan Piutang',
  WALKIN_PAYMENT: 'Pelunasan Piutang',
  KASIR_EXPENSE: 'Beban Operasional',
  MANUAL_TRANSFER: 'Transfer Internal',
  OWNER_DRAWING: 'Tarik Pribadi',
  OWNER_TOPUP: 'Topup Owner',
  WALLET_TOPUP: 'Wallet',
  WALLET_SPEND: 'Wallet',
  ADJUSTMENT: 'Penyesuaian',
  OPENING_BALANCE: 'Saldo Awal',
  TAX_ACCRUAL_PPH: 'Pajak',
  // ... fallback "Lainnya"
};
```

- [ ] **Step 1**: Verify view + table schemas via MCP execute_sql
- [ ] **Step 2**: Write failing unit tests (mocked supabase)
- [ ] **Step 3**: Implement 4 fetch functions
- [ ] **Step 4**: Run tests pass + tsc clean
- [ ] **Step 5**: Commit `feat(akuntansi): Phase 4 Task 2 — reportQueries service`

---

### Task 3: Implement pdfExport — Laba Rugi + Neraca PDF generation

**Files:**
- Modify: `src/lib/akuntansi/pdfExport.ts`
- Create: `src/lib/akuntansi/pdfExport.test.ts`

Use `jspdf` + `jspdf-autotable` to build PDF per spec section 5.

**Layout for Laba Rugi PDF:**
- Page A4, margin 20mm
- Header (centered): companyName 16pt bold, NPWP 10pt, address 10pt
- Title 14pt bold "LAPORAN LABA RUGI"
- Subtitle 11pt italic with period label
- Body: autotable with columns ["Keterangan", "Rupiah"]
- Section headers (PENDAPATAN, HPP, BEBAN OPERASIONAL, etc) with cellPadding extra, background fill
- Subtotal rows with bold + topBorder
- Final row "LABA NETO" with double-rule bottom + bold + larger font
- Footer: "Dicetak: [date+time WIB] · Sistem Akuntansi Garindo ERP"

**Layout for Neraca PDF:**
- Page A4 landscape (more space for side-by-side)
- Header same as P&L
- Title "NERACA"
- Subtitle with as-of date
- Body: two tables side-by-side (use autotable with `startY` + `margin.left` set per side)
- Left: ASET (top), with sub-sections Aset Lancar + Aset Tetap
- Right: LIABILITAS (top sub-section) + EKUITAS (bottom sub-section)
- Bottom: "TOTAL ASET = TOTAL LIABILITAS + EKUITAS ✓ Rp [n]" centered with double-rule
- Footer same as P&L

- [ ] **Step 1**: Write `generateLabaRugiPDF` using jspdf + autotable
- [ ] **Step 2**: Write `generateNeracaPDF` same pattern
- [ ] **Step 3**: Light snapshot test (verify Blob size > 0, contentType=application/pdf, PDF header bytes start with `%PDF-`)
- [ ] **Step 4**: tsc + tests clean
- [ ] **Step 5**: Commit `feat(akuntansi): Phase 4 Task 3 — pdfExport for Laba Rugi + Neraca`

---

### Task 4: LaporanScreen top-tab refactor

**Files:**
- Modify: `src/components/LaporanScreen.tsx`

Wrap existing content in tab system:
```typescript
type LaporanTab = 'performa' | 'akuntansi';
const [activeTab, setActiveTab] = useState<LaporanTab>('performa');

return (
  <div className="space-y-6 animate-fadeIn">
    {/* Top tab strip */}
    <div className="flex gap-2 bg-white p-2 rounded-3xl border border-[#c7d7f5] w-fit">
      <button onClick={() => setActiveTab('performa')} className={...active ? primary : secondary}>
        Performa
      </button>
      <button onClick={() => setActiveTab('akuntansi')} className={...}>
        Akuntansi
      </button>
    </div>
    {activeTab === 'performa' && <PerformaContent />}
    {activeTab === 'akuntansi' && <AkuntansiLaporanTab showToast={showToast} />}
  </div>
);
```

Refactor existing render into `<PerformaContent />` inline component or extract to `src/components/laporan/PerformaTab.tsx`.

- [ ] **Step 1**: Add tab state + strip
- [ ] **Step 2**: Wrap existing content as Performa tab
- [ ] **Step 3**: Conditionally render AkuntansiLaporanTab (will be stub initially)
- [ ] **Step 4**: tsc clean + build OK + verify Performa still works
- [ ] **Step 5**: Commit `feat(akuntansi): Phase 4 Task 4 — LaporanScreen top tabs`

---

### Task 5: AkuntansiLaporanTab parent + 4 sub-tab navigation

**Files:**
- Create: `src/components/laporan/akuntansi/AkuntansiLaporanTab.tsx`

Parent component with 4-sub-tab nav (pill style per Phase 4 mockup top tab bar):
```typescript
type AkuntansiSubTab = 'mutasi' | 'laba-rugi' | 'neraca' | 'cash-flow';
const [activeSubTab, setActiveSubTab] = useState<AkuntansiSubTab>('laba-rugi');  // default to most useful
```

Pill-style tabs (per mockup .tab-btn): active = bg-#012749 text-white; inactive = border-#c7d7f5 bg-white text-#1e3d60

Render placeholder content for each sub-tab (will be replaced in Tasks 6-9).

- [ ] **Step 1**: Write parent with tab nav + 4 stub tabs
- [ ] **Step 2**: tsc clean
- [ ] **Step 3**: Commit `feat(akuntansi): Phase 4 Task 5 — AkuntansiLaporanTab parent`

---

### Task 6: MutasiTab

**Files:**
- Create: `src/components/laporan/akuntansi/MutasiTab.tsx`

Per mockup M1: filter row (akun multi-select chips + periode + arah + kategori) + summary bar (Total IN/OUT/Net + 156 mutasi + Include akun Pribadi toggle) + table (Tanggal | Akun | Kategori | Keterangan | IN | OUT) + tfoot.

Use `fetchMutasi(filters)` from reportQueries.

- [ ] **Step 1**: Write component
- [ ] **Step 2**: tsc clean
- [ ] **Step 3**: Commit

---

### Task 7: LabaRugiTab + PDF export wiring

**Files:**
- Create: `src/components/laporan/akuntansi/LabaRugiTab.tsx`

Per mockup M2: emerald gradient hero + structured P&L sections + info banner + Export buttons.

Submit "PDF SAK EMKM" → call `generateLabaRugiPDF` + trigger browser download.

- [ ] **Step 1**: Write component + PDF wiring
- [ ] **Step 2**: tsc + test PDF download triggers
- [ ] **Step 3**: Commit

---

### Task 8: NeracaTab + PDF export wiring

**Files:**
- Create: `src/components/laporan/akuntansi/NeracaTab.tsx`

Per mockup M3: violet gradient hero + 2-col grid (ASET | LIABILITAS+EKUITAS) + balance verification banner + Export buttons.

Submit "PDF SAK EMKM" → `generateNeracaPDF`.

- [ ] **Step 1**: Write component
- [ ] **Step 2**: tsc clean
- [ ] **Step 3**: Commit

---

### Task 9: CashFlowTab

**Files:**
- Create: `src/components/laporan/akuntansi/CashFlowTab.tsx`

Per mockup M4: header + 3 view-mode pills (Net/Gross IN/Gross OUT) + matrix table dengan sticky-left first column + current-month highlight + total column.

Use `fetchCashFlow(endYear, endMonth, 6)`.

- [ ] **Step 1**: Write component
- [ ] **Step 2**: tsc clean
- [ ] **Step 3**: Commit

---

### Task 10: Integration tests + final validation + progress.md

**Files:**
- Create: `tests/integration/akuntansi-phase4/_setup.ts`
- Create: `tests/integration/akuntansi-phase4/laba-rugi.test.ts`
- Create: `tests/integration/akuntansi-phase4/neraca.test.ts`
- Modify: `progress.md`

Pattern C per Phase 3/0d precedent.

- [ ] **Step 1**: Write _setup + 2 integration test files (schema joins + aggregation sanity)
- [ ] **Step 2**: Run `npx vitest run tests/integration/akuntansi-phase4 --no-file-parallelism` → PASS
- [ ] **Step 3**: Full validation: `npm test --run` + `npx tsc --noEmit` + `npm run build`
- [ ] **Step 4**: Append progress.md entry summarizing 10 tasks
- [ ] **Step 5**: Commit `docs(progress): Akuntansi Phase 4 Laporan COMPLETE`

---

## Verification matrix

| Layer | Method | Pass criterion |
|---|---|---|
| Service unit | vitest | All 4 fetch + 2 PDF mocked supabase pass |
| PDF snapshot | vitest | Blob non-empty + starts with %PDF- |
| Component render | tsc + build | mounts without console errors |
| Integration | vitest Pattern C | schema joins + aggregation correctness |
| Build | npm run build | bundle OK (warn but no error) |
| Regression | npm test --run | All 342+ pre-existing tests still pass |
| Manual smoke | Chrome DevTools MCP | LaporanScreen tabs + sub-tabs + PDF download |

## Pre-flight notes

- Worktree: `.claude/worktrees/akuntansi-phase4` on branch `worktree-akuntansi-phase4`
- Ledger: `.superpowers/sdd/progress.md`
- npm deps: jspdf + jspdf-autotable (added in Task 1)
- IMPORTANT: subagents MUST verify `git branch --show-current` = `worktree-akuntansi-phase4` BEFORE committing (per Phase 0d Task 2 anomaly precedent)
