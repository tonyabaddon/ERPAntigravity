# Saldo Awal & Tutup Buku Tahunan (Item #5) — Design Spec

**Status:** Draft
**Date:** 2026-07-13
**Founder pain point:** MSME onboard mid-year → Laba Rugi + Neraca tidak reflect YTD sebenarnya (cuma tampil dari tanggal sistem mulai dipakai). Owner Garindo pertama kali pakai Juli 2026 — Neraca kosong, Piutang aging 0 rows.

---

## 1. Ringkasan

Ship 2 mekanisme akuntansi yang benar-benar dipakai MSME sepanjang life-cycle bisnis:

1. **Saldo Awal Wizard (mid-year onboarding)** — 4-step wizard untuk owner masukin data neraca per cutover date. Aggregate atau optional detail per-customer/supplier. Auto-compute persediaan dari master stok. Modal + Laba Ditahan split. Sistem generate 1 balanced JE dated cutover-1 day dengan `source_type='OPENING_BALANCE'`.

2. **Tutup Buku Tahunan (year-end rollover)** — button "Tutup Buku Tahun 20XX" di Laporan Akuntansi setelah semua Dec transactions posted. Sistem generate closing JE (revenue + expense → Laba Ditahan) dengan `source_type='YEAR_END_CLOSE'`. Tahun N+1 fresh P&L.

Aligned dengan Jurnal.id + Accurate Online patterns (Indonesian MSME accountant tools). Follows PSAK-ETAP standard.

---

## 2. Terminology (bahasa Indonesia MSME akuntansi standar)

| Istilah | Arti |
|---------|------|
| **Cutover date** | Tanggal owner mulai pakai sistem (mid-year onboarding date) |
| **Saldo Awal** | Opening balance sheet entries |
| **Modal Owner** | Paid-in capital (investasi historis owner) |
| **Laba Ditahan** | Retained earnings (akumulasi laba periode sebelumnya) |
| **Prive** | Owner's drawings (contra-equity) |
| **Tutup Buku** | Year-end close (close revenue/expense → equity) |
| **Aging** | AR/AP overdue bucket tracking |
| **JE** | Journal Entry |
| **COA** | Chart of Accounts |

---

## 3. Scope

### 3.1 In scope MVP

**Saldo Awal Wizard (4 steps):**
- Step 1 — Kas & Bank per account (existing `cash_accounts.opening_balance`)
- Step 2 — Aktiva:
  - Piutang Usaha (toggle aggregate vs detail per-customer, opt-in detail)
  - Persediaan (auto-computed `sum(stocks × harga_modal)`, editable override)
  - Aktiva Tetap net aggregate
  - Optional expandable "Akun Aktiva lain" (Piutang Lain-lain, Uang Muka Pembelian, Biaya Dibayar Dimuka, custom via COA picker)
- Step 3 — Kewajiban:
  - Hutang Usaha (toggle aggregate vs detail per-supplier, opt-in detail)
  - Optional expandable "Kewajiban lain" (Hutang Bank, Uang Muka Pelanggan, Hutang Pajak, Beban Masih Harus Dibayar, custom via COA picker)
- Step 4 — Ekuitas + Preview:
  - Modal Owner (input)
  - Optional Prive (contra-equity)
  - Laba Ditahan (auto-calculated balancing figure)
  - Preview Neraca dengan balance check
  - Confirmation checkboxes + submit button
  - PDF export "Cetak Ringkasan Saldo Awal" untuk akuntan review

**Cross-cutting Saldo Awal:**
- Draft auto-save on step transition
- Reversal mechanism (post → mistake → reverse + re-input)
- Cross-check validation Kas total ↔ existing `cash_accounts.opening_balance`
- COA picker for "lain-lain" rows

**Year-End Close:**
- Button "Tutup Buku Tahun 20XX" di Laporan → Akuntansi header
- Preview modal show total_revenue + total_expense + net_income
- Confirmation checkbox + post
- Generate closing JE + insert `year_end_close_events` row
- Reversal via existing Mutasi tab JE reversal UI

**Banner nudge:**
- Persistent banner di Laporan Akuntansi tab (Laba Rugi/Neraca/Cash Flow) sebelum Saldo Awal posted
- Message: "Anda belum set Saldo Awal — laporan mencerminkan data dari tanggal sistem mulai dipakai. [Set Saldo Awal →]"
- Dismissable per session, return tiap login sampai completed

**Report integration:**
- Neraca, Laba Rugi, Cash Flow — zero code change (query GL, opening JE contributes naturally)
- Piutang aging service — extend to UNION `opening_ar_lines`
- Hutang aging service — extend to UNION `opening_ap_lines`
- Dashboard maintenance counts (Item #3) — extend piutang/hutang overdue queries to include opening lines

### 3.2 Out of scope MVP (deferred)

- **YTD P&L blob** (Jan-cutover revenue/expense breakdown) — industry benchmark (Odoo/Xero/QB) skip; Y1 partial report reality accepted
- **Monthly P&L breakdown untuk onboarding year** — owner rarely has data
- **Fixed asset depreciation schedule** — aggregate net Aktiva Tetap covers PSAK-ETAP minimum
- **Multi-currency / FX** — Indonesia MSME 99% Rupiah
- **Custom fiscal year (non-Jan-Dec)** — 90% Indonesia MSME follows tahun pajak
- **CSV / Excel import for AR/AP detail** — fast follower; owner biasa manual entry <20 lines dalam 5 menit
- **Multi-user concurrent draft editing** — rare untuk MSME
- **Rollback protection** (disable reversal after N days) — MVP allow reversal anytime with confirmation
- **Historical audit trail on step_data changes** — updated_at/by sufficient
- **Prior year Retained Earnings split** (Y-1 vs Y-2 accumulation) — 1 blob OK
- **YTD comparison mode toggle di Laporan** (partial vs cutover-onwards) — cutover onwards only
- **Auto-suggest based on tenant category** — no taxonomy yet
- **Auto-email opening JE PDF ke akuntan** — owner bisa manual attach

### 3.3 Bahasa + design system

- Bahasa Indonesia MSME akuntansi standar (Jurnal.id / Accurate style)
- Font 13-14px UI body (per feedback `font_sizing`)
- Wizard shell reuse pattern dari `CatatPenjualanWizard.tsx` (progress dots, Back/Next, sticky preview panel)
- Modal shell reuse existing modal component
- Rupiah format via `formatIDR()` from `src/lib/formatIDR.ts`
- Number inputs pakai `NumberInput` component (per repo audit convention)
- COA picker reuse existing autocomplete dari manual journal entry UI
- Customer/supplier picker reuse existing dari Piutang/Pembelian
- Badge palette: emerald (positive/aktiva) / rose (kewajiban) / slate (ekuitas) / amber (warning validation)

---

## 4. Data model

### 4.1 Migration slots

| Slot | File | Purpose |
|------|------|---------|
| **20261115000140** | `20261115000140_saldo_awal_enum_ext.sql` | ADD VALUE 'OPENING_BALANCE' + 'YEAR_END_CLOSE' to `journal_entry_source` enum |
| **20261115000141** | `20261115000141_saldo_awal_tables.sql` | 4 new tables + RLS + indexes |
| **20261115000142** | `20261115000142_saldo_awal_rpcs.sql` | 8 SECDEF RPCs |
| **20261115000143** | `20261115000143_aging_include_opening.sql` | Modify piutang/hutang aging views/functions |

### 4.2 Tables

```sql
-- 4.2.1 saldo_awal_snapshots — wizard state + audit
CREATE TABLE IF NOT EXISTS public.saldo_awal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  cutover_date DATE NOT NULL,
  step_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','posted','reversed')),
  posted_je_id UUID,
  posted_at TIMESTAMPTZ,
  posted_by UUID,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID,
  reversed_je_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_saldo_awal_one_active
  ON public.saldo_awal_snapshots (tenant_id) WHERE status = 'posted';
CREATE UNIQUE INDEX IF NOT EXISTS ux_saldo_awal_one_draft
  ON public.saldo_awal_snapshots (tenant_id) WHERE status = 'draft';

ALTER TABLE public.saldo_awal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saldo_awal_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY p_select_own ON public.saldo_awal_snapshots
  FOR SELECT USING (tenant_id = public._resolve_tenant_id());
CREATE POLICY p_platform_admin_readall ON public.saldo_awal_snapshots
  FOR SELECT USING (public._is_platform_admin());


-- 4.2.2 opening_ar_lines — AR detail per customer (opt-in)
CREATE TABLE IF NOT EXISTS public.opening_ar_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  snapshot_id UUID NOT NULL REFERENCES public.saldo_awal_snapshots(id) ON DELETE CASCADE,
  customer_id TEXT,
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) > 0),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  original_due_date DATE,
  invoice_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opening_ar_snapshot
  ON public.opening_ar_lines (tenant_id, snapshot_id);

ALTER TABLE public.opening_ar_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_ar_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY p_select_own ON public.opening_ar_lines
  FOR SELECT USING (tenant_id = public._resolve_tenant_id());
CREATE POLICY p_platform_admin_readall ON public.opening_ar_lines
  FOR SELECT USING (public._is_platform_admin());


-- 4.2.3 opening_ap_lines — AP detail per supplier (opt-in)
CREATE TABLE IF NOT EXISTS public.opening_ap_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  snapshot_id UUID NOT NULL REFERENCES public.saldo_awal_snapshots(id) ON DELETE CASCADE,
  supplier_id UUID,
  supplier_name TEXT NOT NULL CHECK (length(trim(supplier_name)) > 0),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  original_due_date DATE,
  invoice_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opening_ap_snapshot
  ON public.opening_ap_lines (tenant_id, snapshot_id);

ALTER TABLE public.opening_ap_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_ap_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY p_select_own ON public.opening_ap_lines
  FOR SELECT USING (tenant_id = public._resolve_tenant_id());
CREATE POLICY p_platform_admin_readall ON public.opening_ap_lines
  FOR SELECT USING (public._is_platform_admin());


-- 4.2.4 year_end_close_events — annual close tracker
CREATE TABLE IF NOT EXISTS public.year_end_close_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  fiscal_year INT NOT NULL CHECK (fiscal_year >= 2020 AND fiscal_year <= 2100),
  net_income NUMERIC(15,2) NOT NULL,
  posted_je_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by UUID NOT NULL,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID,
  reversed_je_id UUID,
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_year_end_close_one_active
  ON public.year_end_close_events (tenant_id, fiscal_year) WHERE status = 'posted';

ALTER TABLE public.year_end_close_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.year_end_close_events FORCE ROW LEVEL SECURITY;
CREATE POLICY p_select_own ON public.year_end_close_events
  FOR SELECT USING (tenant_id = public._resolve_tenant_id());
CREATE POLICY p_platform_admin_readall ON public.year_end_close_events
  FOR SELECT USING (public._is_platform_admin());
```

### 4.3 `step_data` JSONB shape

```json
{
  "wizard_version": 1,
  "step1_cash": {
    "accounts": [
      {"cash_account_id": "uuid", "opening_balance": 5000000, "as_of": "2026-06-30"}
    ]
  },
  "step2_aktiva": {
    "piutang": {
      "mode": "aggregate",
      "aggregate_amount": 15000000
    },
    "persediaan": {
      "auto_computed_amount": 500000000,
      "manual_override": false,
      "final_amount": 500000000,
      "override_reason": null
    },
    "aktiva_tetap": {
      "amount": 75000000,
      "notes": "Rak, forklift, PC toko"
    },
    "lain_lain": [
      {"coa_code": "1-1220", "coa_name": "Piutang Lain-lain", "amount": 2000000, "notes": ""}
    ]
  },
  "step3_kewajiban": {
    "hutang_usaha": {
      "mode": "aggregate",
      "aggregate_amount": 8000000
    },
    "lain_lain": [
      {"coa_code": "2-1200", "coa_name": "Hutang Bank", "amount": 50000000, "notes": ""}
    ]
  },
  "step4_ekuitas": {
    "modal_owner": {"amount": 500000000},
    "prive": {"amount": 0},
    "laba_ditahan_calculated": null
  }
}
```

### 4.4 Enum extension

```sql
-- Split into own migration file (slot 140)
-- Postgres ADD VALUE requires new transaction before usable
ALTER TYPE public.journal_entry_source ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';
ALTER TYPE public.journal_entry_source ADD VALUE IF NOT EXISTS 'YEAR_END_CLOSE';
```

---

## 5. Backend RPCs

All RPCs: `SECURITY DEFINER STABLE|VOLATILE`, owned by `vosi_rpc_owner`, `REVOKE ALL FROM PUBLIC`, `REVOKE EXECUTE FROM anon`, `GRANT EXECUTE TO authenticated`.

### 5.1 `save_saldo_awal_draft(p_step_data JSONB, p_cutover_date DATE) → UUID`

- Validate cutover_date ≤ CURRENT_DATE
- Upsert `saldo_awal_snapshots` with `status='draft'` (delete-and-insert or update-if-exists)
- Return snapshot_id
- Idempotent: same input replaces prior draft

### 5.2 `preview_saldo_awal_totals(p_step_data JSONB) → TABLE(total_assets NUMERIC, total_liab NUMERIC, total_equity NUMERIC, laba_ditahan_balancing NUMERIC)`

- STABLE, pure function of input
- Sum Assets = step1.cash + step2.piutang + step2.persediaan + step2.aktiva_tetap + step2.lain_lain
- Sum Liab = step3.hutang + step3.lain_lain
- Modal = step4.modal_owner - step4.prive (prive contra-equity)
- laba_ditahan_balancing = Assets - Liab - Modal
- total_equity = Modal + laba_ditahan_balancing

### 5.3 `get_persediaan_auto_value() → NUMERIC`

- STABLE, tenant-scoped
- Return `sum(stocks.stock × COALESCE(stocks.harga_modal, 0)) WHERE tenant_id = ...`

### 5.4 `post_saldo_awal_snapshot(p_snapshot_id UUID) → UUID`

- VOLATILE
- Load snapshot from DB (verify tenant scope + status='draft')
- Compute totals via preview_saldo_awal_totals()
- Generate balanced JE via `_post_journal_entry`:
  - entry_date = cutover_date - 1 day
  - source_type = 'OPENING_BALANCE'
  - lines: per cash account (DEBIT), AR aggregate/per-line (DEBIT), Inventory (DEBIT), Fixed Assets (DEBIT), Aktiva lain-lain (DEBIT), AP aggregate/per-line (CREDIT), Kewajiban lain-lain (CREDIT), Modal Owner (CREDIT), Prive (DEBIT if > 0), Laba Ditahan (CREDIT)
- Insert `opening_ar_lines` rows if step2.piutang.mode='detail'
- Insert `opening_ap_lines` rows if step3.hutang.mode='detail'
- Update snapshot: status='posted', posted_je_id, posted_at, posted_by
- Sync `cash_accounts.opening_balance` per step1 data (optional — separate flag OR always)
- Return posted_je_id

### 5.5 `reverse_saldo_awal(p_snapshot_id UUID, p_reason TEXT) → UUID`

- VOLATILE
- Verify snapshot posted + not already reversed
- Generate reversal JE (swap debit/credit)
- Update snapshot: status='reversed', reversed_at, reversed_by, reversed_je_id
- Return reversal_je_id

### 5.6 `get_saldo_awal_state() → TABLE(id UUID, cutover_date DATE, status TEXT, posted_je_id UUID, step_data JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`

- STABLE, tenant-scoped
- Return most recent non-reversed snapshot (draft or posted) OR NULL for fresh tenant

### 5.7 `preview_year_end_close(p_fiscal_year INT) → TABLE(total_revenue NUMERIC, total_expense NUMERIC, net_income NUMERIC)`

- STABLE
- Read `general_ledger` for fiscal year Jan 1 - Dec 31
- total_revenue = Σ CREDITs on Revenue COA (4-*)
- total_expense = Σ DEBITs on Expense COA (5-*)
- net_income = total_revenue - total_expense

### 5.8 `post_year_end_close(p_fiscal_year INT) → UUID`

- VOLATILE
- Verify no existing posted year_end_close_events for fiscal_year
- Compute revenue + expense balances via preview_year_end_close
- Generate closing JE:
  - entry_date = fiscal_year || '-12-31'
  - source_type = 'YEAR_END_CLOSE'
  - Debit each Revenue account by its cumulative CREDIT balance (zeroing)
  - Credit each Expense account by its cumulative DEBIT balance (zeroing)
  - Net → Laba Ditahan (CREDIT if positive net income, DEBIT if loss)
- Insert `year_end_close_events` row
- Return posted_je_id

---

## 6. Frontend UI

### 6.1 Entry point + banner

**Placement**: `Pengaturan → Akuntansi → Saldo Awal` sub-panel

**Persistent banner** di Laporan Akuntansi tab:
```
⚠ Anda belum set Saldo Awal — laporan mencerminkan data dari tanggal
   sistem mulai dipakai, bukan Year-to-Date sebenarnya.
   [Set Saldo Awal →]                                [× dismiss]
```

Banner conditions:
- Show if `get_saldo_awal_state()` returns NULL OR status='reversed' with no re-post
- Dismissable per session (localStorage flag); return on next login

### 6.2 Wizard shell (`src/components/pengaturan/SaldoAwalWizard.tsx`)

**Layout**:
```
┌──────────────────────────────────────────────────┐
│ Saldo Awal — Onboarding                  [× tutup]│
│                                                    │
│ Tanggal cutover: [📅 2026-06-30]                  │
│                                                    │
│ ●──●──●──○                                        │
│ 1  2  3  4                                        │
│ Kas Aktiva Kewajiban Ekuitas                      │
│                                                    │
│ [ Step content ]                                  │
│                                                    │
│ Preview Neraca (live):                            │
│  Aktiva: Rp X · Kewajiban: Rp Y · Ekuitas: Rp Z  │
│  ✓ Balanced                                       │
│                                                    │
│ [Simpan Draft] [← Sebelumnya] [Berikutnya →]     │
└──────────────────────────────────────────────────┘
```

**Behaviors**:
- Cutover date default = today - 1
- Progress dots: filled/current/empty
- Auto-save draft on step transition
- Owner can exit anytime, resume via draft state
- Preview panel live-updates on any field change

### 6.3 Step 1 — Kas & Bank

Read from existing `cash_accounts` table (via existing service). Pre-populate current `opening_balance`. Rows editable with NumberInput. Cross-check warning if sum differs from prior state.

### 6.4 Step 2 — Aktiva

**Fixed sections:**
- Piutang Usaha: toggle aggregate | detail
  - Aggregate: single NumberInput
  - Detail: table [customer picker, amount, original_due_date, invoice_ref, delete] + "+ Tambah Baris"
- Persediaan: display auto-computed value + toggle "Pakai auto | Override manual"
- Aktiva Tetap: single NumberInput + notes textarea

**Collapsible "Akun Aktiva lain (opsional)":**
- Table [COA picker, amount, notes, delete] + "+ Tambah Baris"

### 6.5 Step 3 — Kewajiban

Mirror pattern:
- Hutang Usaha: toggle aggregate | detail per-supplier
- Collapsible "Kewajiban lain": table with COA picker

### 6.6 Step 4 — Ekuitas + Preview + Confirm

- Modal Owner: NumberInput
- Optional Prive: NumberInput (contra-equity, displayed with warning icon)
- Laba Ditahan: computed display (auto-balancing)
- Full Neraca preview table
- Balance check indicator ✓/✗
- Confirmation checkboxes (2):
  - "Saya sudah verify angka di atas benar"
  - "Setelah post, data masuk ke Jurnal Umum sebagai Opening Balance JE; edit langsung tidak bisa (via reversal)"
- Button "Cetak Ringkasan" — trigger PDF export (reuse existing PDF infrastructure like `SalesInvoicePDF.tsx` pattern)
- Button "Simpan & Post Saldo Awal" — disabled until both checkboxes ticked + balance ✓
- On submit: call `post_saldo_awal_snapshot(snapshot_id)` → success toast → navigate back to Pengaturan → Akuntansi

### 6.7 Reversal UI

**State display** at `Pengaturan → Akuntansi → Saldo Awal` after post:
```
Saldo Awal — Terpost
Cutover date: 2026-06-30
Posted at: 2026-07-13 10:30 by Owner Tony
JE Number: JE-OB-000001
Ringkasan:
  Aktiva Rp X · Kewajiban Rp Y · Ekuitas Rp Z

[📄 Lihat JE]  [↺ Reverse & Edit]
```

Reverse button opens confirmation modal with reason textarea → call `reverse_saldo_awal(id, reason)`.

### 6.8 Year-End Close UI

**Button** di Laporan → Akuntansi header:
```
Laporan → Akuntansi                    [Tutup Buku Tahun 2026]
```

Button enabled only if:
- Current year > fiscal_year OR fiscal_year == current_year AND today >= Dec 15 (allow early close preview)
- No existing posted event for that fiscal_year

**Confirmation modal**:
```
Tutup Buku Tahun 2026?

Preview:
  Total Pendapatan 2026: Rp 1.200.000.000
  Total Beban 2026:      Rp   850.000.000
  Net Income:            Rp   350.000.000
  → Transfer ke Laba Ditahan

Sistem akan:
1. Ambil semua akun Pendapatan + Beban 2026
2. Buat Jurnal Umum yang me-nol-kan mereka
3. Selisih transfer ke Laba Ditahan

Setelah tutup buku:
• Laporan Laba Rugi 2027 mulai dari 0
• Neraca 2027 include Laba Ditahan updated
• Reverse via menu Mutasi (manual JE reversal)

☐ Saya sudah verify semua transaksi 2026 lengkap

[Batal]                       [Tutup Buku 2026]
```

Submit disabled until checkbox ticked. On submit: call `post_year_end_close(2026)` → toast + close modal + refresh page.

### 6.9 File structure

**Create**:
- `src/lib/saldoAwal/types.ts` — TypeScript types
- `src/lib/saldoAwal/api.ts` — API wrappers
- `src/components/pengaturan/SaldoAwalPanel.tsx` — Pengaturan entry + state display
- `src/components/pengaturan/saldoAwal/SaldoAwalWizard.tsx` — wizard shell
- `src/components/pengaturan/saldoAwal/Step1KasBank.tsx`
- `src/components/pengaturan/saldoAwal/Step2Aktiva.tsx`
- `src/components/pengaturan/saldoAwal/Step3Kewajiban.tsx`
- `src/components/pengaturan/saldoAwal/Step4EkuitasPreview.tsx`
- `src/components/pengaturan/saldoAwal/CoAPicker.tsx` — reused COA autocomplete
- `src/components/pengaturan/saldoAwal/SaldoAwalPDF.tsx` — PDF export
- `src/components/laporan/akuntansi/SaldoAwalBanner.tsx` — nudge banner
- `src/components/laporan/akuntansi/YearEndCloseButton.tsx` — button + confirmation modal

**Modify**:
- `src/components/PengaturanScreen.tsx` — tambah tab/section "Akuntansi"
- `src/components/laporan/akuntansi/AkuntansiLaporanTab.tsx` — render banner + Year-End Close button
- `src/lib/piutangService.ts` — extend AR aging to UNION opening_ar_lines
- `src/lib/purchaseInvoiceService.ts` (or equivalent) — extend AP aging to UNION opening_ap_lines
- `src/types.ts` — add SaldoAwal + YearEndClose types if not in saldoAwal/types.ts

---

## 7. Report integration

### 7.1 Zero-change reports

- **Neraca (Balance Sheet)** — queries `general_ledger` cumulative balances. Opening JE dated cutover-1 = counted naturally.
- **Laba Rugi (P&L)** — queries date-range GL. Opening JE dated cutover-1 = BEFORE reporting period start → excluded.
- **Cash Flow** — queries date-range GL. Existing report handles opening cash carry.

### 7.2 Modify existing services

**Piutang aging** (`src/lib/piutangService.ts` — verify exact filename at plan time):
- Existing query filters kasir_transactions TEMPO AR
- Extend: UNION with `opening_ar_lines` WHERE snapshot posted AND not reversed
- Aging bucket: use `original_due_date` for opening lines

**Hutang aging** (`src/lib/purchaseInvoiceService.ts` — verify):
- Similar UNION with `opening_ap_lines`

### 7.3 Dashboard maintenance counts (Item #3)

`get_dashboard_maintenance_counts()` — extend piutang/hutang overdue calc to include opening lines:
- Piutang overdue count: existing kasir_transactions count + count of opening_ar_lines with original_due_date < CURRENT_DATE
- Piutang overdue sum: existing + sum of opening_ar_lines.amount where overdue
- Same for hutang

Modify slot 130 RPC OR add sub-view. **Chosen approach**: modify slot 130 RPC directly with UNION subquery. Migration slot 143 = modified version of `get_dashboard_maintenance_counts` + aging queries.

---

## 8. Multi-tenant + scalability

### 8.1 Existing tenants

- Tables created empty; existing tenants unaffected
- Banner nudge appears in Laporan Akuntansi
- Owner opts in via wizard, no forced migration

### 8.2 New tenants

- Empty tables at onboarding
- Wizard prompt banner appears in Laporan Akuntansi
- Zero backfill needed

### 8.3 Query scalability

- Snapshot queries: 1 row per tenant → tenant-scoped index hit
- opening_ar_lines / opening_ap_lines: bounded per snapshot (< 500 lines) → cheap UNION with existing AR/AP query
- Year-end close event: 1 row per tenant per year → cheap lookup

### 8.4 Storage curve

- Per-tenant per lifetime: < 1MB total (4 tables combined)
- Absorbed within existing DB

### 8.5 Cost curve

- Zero paid API impact
- Wizard = one-time; year-close = annual → cold path
- Per-tenant $/month impact: ~$0

### 8.6 Reversibility rating

**Semi-reversible**:
- Tables can be dropped (data loss for opening snapshots + AR/AP lines + year-close events)
- Enum values cannot be dropped (Postgres limitation), but unused values harmless
- Reports auto-adjust if opening JE reversed (no residual dependency)

Per CLAUDE.md: not architectural; no advisor memo required. Advisor call before commit (diff >100 lines, touches >3 files).

### 8.7 Idempotency

- All migrations `IF NOT EXISTS` guarded
- Unique indexes enforce single active snapshot/draft/close per tenant
- Wizard re-post creates new snapshot after reversal

---

## 9. Edge cases + validation

| # | Skenario | Handling |
|---|----------|----------|
| 1 | Cutover date di masa depan | RPC reject `cutover_date <= CURRENT_DATE` |
| 2 | Cutover date > earliest kasir_transaction | Warning "Ada X transaksi sebelum cutover — mereka akan double-count. Yakin?" |
| 3 | Sum(step1_cash) ≠ existing cash_accounts.opening_balance sum | Warning saat step 1 loaded; opt "Sync ke Kas & Bank" |
| 4 | Detail AR/AP sum ≠ toggle=detail expected amount | Preview show sum; user must confirm balance |
| 5 | Negative amount input | Client validation reject sebelum step transition |
| 6 | Modal Owner = 0 atau negatif | Allowed |
| 7 | Cutover before earliest transaction | Accept |
| 8 | Owner post + reverse + re-post | Both audit trail preserved |
| 9 | Draft stale (>30 days) | Preserve; banner reminder |
| 10 | step_data JSONB schema drift | Wizard validates on mount; offer "Reset draft" |
| 11 | Multi-user concurrent draft | Last-writer-wins via updated_at |
| 12 | Year-close before all Dec transactions posted | Confirmation modal cross-check kasir_transactions AWAITING_LUNAS di Dec |
| 13 | Year-close for future year | RPC reject `p_fiscal_year >= EXTRACT(YEAR FROM CURRENT_DATE)` unless Dec 15+ current year |
| 14 | Year-close reversal | Via Mutasi tab manual JE reversal |
| 15 | Tenant tanpa cash_accounts | Wizard step 1 empty state; block progress dengan CTA "Setup Kas & Bank dulu" |
| 16 | Tenant sudah punya OPENING_BALANCE JE (import lama) | RPC detect existing → offer reversal path first |
| 17 | COA picker: pick income/expense account for opening | Reject — opening is balance sheet only |
| 18 | Prive > Modal Owner | Warning "Prive lebih besar dari Modal — apakah benar?" tapi allow submit |
| 19 | Persediaan auto = 0 (fresh tenant no stocks) | Show "Nilai auto = Rp 0 (belum ada master stok)" + suggest opname atau override |
| 20 | Year-end close reversal — need to un-mark event | Manual UPDATE year_end_close_events SET status='reversed' (via admin RPC or migration) — MVP: manual DB update by support |

---

## 10. Smoke tests + rollback

### 10.1 Stage 1 — Local verification

- `npm run lint`, `audit:numinput`, `audit:secdef-null-tenant` clean
- `npx vitest run --changed`
- UI check via `npm run dev`:
  - Banner appears in Laporan Akuntansi for fresh tenant
  - Wizard opens, all 4 steps navigable, preview updates live
  - Cross-check warnings trigger correctly
  - PDF export renders
  - Year-End Close button + modal on Laporan Akuntansi

### 10.2 SQL smoke — rollback-marker pattern

```sql
DO $$ 
DECLARE
  v_tenant UUID := '11111111-1111-1111-1111-111111111111'::uuid;
  v_owner  UUID := '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid;
  v_snap_id UUID; v_je_id UUID; v_prev NUMERIC;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated', 'tenant_id', v_tenant::text)::text, true);

  v_snap_id := save_saldo_awal_draft(
    '{"wizard_version":1,"step1_cash":{"accounts":[]},"step2_aktiva":{"piutang":{"mode":"aggregate","aggregate_amount":15000000},"persediaan":{"auto_computed_amount":500000000,"final_amount":500000000},"aktiva_tetap":{"amount":75000000},"lain_lain":[]},"step3_kewajiban":{"hutang_usaha":{"mode":"aggregate","aggregate_amount":8000000},"lain_lain":[]},"step4_ekuitas":{"modal_owner":{"amount":500000000},"prive":{"amount":0}}}'::jsonb,
    '2026-06-30'::date);
  ASSERT v_snap_id IS NOT NULL;

  SELECT total_assets INTO v_prev FROM preview_saldo_awal_totals('...');
  RAISE NOTICE 'preview assets = %', v_prev;

  v_je_id := post_saldo_awal_snapshot(v_snap_id);
  ASSERT (SELECT status FROM saldo_awal_snapshots WHERE id=v_snap_id) = 'posted';
  ASSERT (SELECT ABS(total_debit - total_credit) FROM journal_entries WHERE id=v_je_id) < 0.01;

  PERFORM reverse_saldo_awal(v_snap_id, 'test');
  ASSERT (SELECT status FROM saldo_awal_snapshots WHERE id=v_snap_id) = 'reversed';

  PERFORM * FROM preview_year_end_close(2026);

  RAISE EXCEPTION 'rollback-marker: saldo awal smoke complete';
END $$;
```

### 10.3 Stage 2 — Deploy prod

Push to main → Cloud Build → Cloud Run --no-traffic → tag URL smoke → 100% traffic.

### 10.4 Stage 3 — Prod smoke MCP chrome

- Login as owner Garindo
- Navigate Pengaturan → Akuntansi → Saldo Awal
- Verify wizard opens, all 4 steps functional
- Test draft save + reload
- Test preview auto-calc
- Test post → verify status update + JE creation in Mutasi tab
- Test reversal
- Test Year-End Close modal preview
- Regression: Neraca / Laba Rugi / Cash Flow render correctly after opening posted
- Regression: Piutang aging includes opening lines

### 10.5 Rollback plan

- Frontend bug: revert Cloud Run revision
- Backend bug: RPC drop or replace (idempotent)
- Data corruption: manual DB fix by support (no automated rollback for financial data)

---

## 11. Observability

Per CLAUDE.md requirement:
- Entry log per RPC: `{tenant_id, user_id, feature: 'saldo_awal', action, args}`
- Error path logs per validation branch
- Usage counter: `SELECT COUNT(*) FROM saldo_awal_snapshots WHERE status='posted'` per tenant — adoption tracking
- Year-close usage: `SELECT tenant_id, fiscal_year, net_income FROM year_end_close_events`

---

## 12. Success criteria

1. Owner Garindo run wizard, isi 4 steps, post → sistem create balanced JE
2. Neraca di Laporan langsung reflect opening balances (zero report code change)
3. Piutang aging include opening_ar_lines detail rows
4. Owner klik "Tutup Buku Tahun 2026" (setelah Dec) → closing JE created, Laba Ditahan updated
5. Multi-tenant: tenant test baru works from empty state
6. Advisor check clean post-deployment
7. Regression zero: existing Laporan Akuntansi tabs work; Item #3 Dashboard counts still accurate

---

## 13. Reversibility rating

**Semi-reversible** — tables droppable (with data loss); enum values immortal but harmless; reports auto-adjust.

Not architectural — no advisor memo required per CLAUDE.md. Advisor call before final commit (>100 lines, >3 files).

---

**End of spec.**
