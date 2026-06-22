# Akuntansi Phase 0d — GL UI Design Spec

**Date:** 2026-06-22
**Status:** Draft for user review
**Phase:** 0d of Akuntansi MSME roadmap (after Phase 0a foundation + Phase 1 Cash & Bank + Phase 3 Manual Entry shipped)
**Mockup reference:** `docs/superpowers/mockups/2026-06-21-akuntansi-phase0d-gl-ui.html`

---

## 1. Goal

Bekali Owner dengan **viewing surface untuk General Ledger** — Trial Balance (Neraca Saldo), Buku Besar per akun, Period Close + Tax Accrual, dan Chart of Accounts management. Phase 0d melengkapi loop: Owner sekarang bisa CREATE (Phase 3 manual entry) + VIEW (Phase 0d) + CLOSE (Phase 0d tutup buku) GL — full accounting cycle dalam app.

## 2. Scope

### In-scope (4 tabs di AkuntansiScreen)

1. **Tab "Trial Balance" (default)** — Neraca Saldo per period, grouped by account_type (ASET/LIABILITAS/MODAL/PENDAPATAN/BEBAN), balance check banner, period selector
2. **Tab "Buku Besar"** — General Ledger per akun (account picker + drill-down dari Trial Balance row click), 3-stat hero (Saldo Awal / Movement bulan ini / Saldo Akhir), running balance table
3. **Tab "Tutup Buku"** — Period status list + close confirmation modal with tax accrual preview (uses existing `close_accounting_period` + `accrue_period_taxes` RPCs from Phase 0a)
4. **Tab "COA"** — Chart of Accounts management: tree list grouped by account_type, edit account_name/description, toggle is_active. **NO add new account** (SAK EMKM standard 59 akun fixed dari seed; auto-create sub-bank sudah via AccountFormModal Phase 1)

### Out-of-scope (defer)
- PDF / Excel export — placeholder toast "hadir di Phase 4 Laporan" (consistent dengan pattern AccountDetailScreen export)
- Add new COA account UI — defer (auto-create di AccountFormModal cukup untuk most cases)
- Reverse / void journal entry from GL UI — defer
- Laba Rugi / Neraca / Cash Flow report — Phase 4 scope
- Cash movements deprecation (mentioned di roadmap section 7) — defer ke phase berikutnya

## 3. Architecture

### Data flow

```
[User navigates Sidebar → Akuntansi]
        ↓
[AkuntansiScreen]
  ├─ no opening balance? → OpeningBalanceWizard (existing Phase 0a)
  └─ opening balance set? → Tabbed layout
      ├─ Tab 1 Trial Balance — read `trial_balance` view
      ├─ Tab 2 Buku Besar — picker + read `general_ledger` view filtered by account_id
      ├─ Tab 3 Tutup Buku — list `accounting_periods` + close_accounting_period RPC
      └─ Tab 4 COA — list/update chart_of_accounts table
```

### Backend (all already shipped di Phase 0a — zero schema changes)

| Asset | Migration | Purpose |
|---|---|---|
| `trial_balance` view | `20260715000011_views.sql` | Trial Balance tab data source |
| `general_ledger` view | `20260715000011_views.sql` | Buku Besar tab data source |
| `accounting_periods` table | `20260715000005_accounting_periods_table.sql` | Period status list |
| `close_accounting_period(p_period_id)` RPC | `20260715000010_period_close_rpcs.sql` | Tutup Buku action |
| `accrue_period_taxes(p_period_id)` RPC | `20260715000015_tax_accrual_rpc.sql` | Auto tax PPh Final |
| `chart_of_accounts` table | `20260715000001` | COA management read/write |

**ONE new helper RPC** untuk COA update (security gate):
- `update_coa_account(p_id uuid, p_account_name text, p_description text, p_is_active boolean) RETURNS jsonb`
  - SECURITY DEFINER + `_assert_owner_active()`
  - Validates `account_code` is_system=false (system accounts protected)
  - Returns `{ok, updated_at}`

### File structure

```
src/components/akuntansi/
├── AkuntansiScreen.tsx                 (MODIFY — add tabs after opening balance set)
├── OpeningBalanceWizard.tsx            (no change)
├── manual/                             (no change — Phase 3 lives here)
├── gl/                                 (NEW dir)
│   ├── TrialBalanceTab.tsx             (CREATE)
│   ├── BukuBesarTab.tsx                (CREATE)
│   ├── TutupBukuTab.tsx                (CREATE)
│   ├── PeriodCloseModal.tsx            (CREATE — confirmation modal with tax preview)
│   └── COAManagementTab.tsx            (CREATE)
src/lib/akuntansi/
├── glQueries.ts                        (CREATE — fetchTrialBalance, fetchGeneralLedger, fetchPeriods, fetchCoaTree)
├── glQueries.test.ts                   (CREATE)
├── periodCloseService.ts               (CREATE — closePeriod RPC wrapper)
├── periodCloseService.test.ts          (CREATE)
├── coaUpdateService.ts                 (CREATE — updateCoaAccount wrapper)
└── coaUpdateService.test.ts            (CREATE)
supabase/migrations/
└── 20260722000005_update_coa_account_rpc.sql  (CREATE — single helper RPC)
tests/integration/akuntansi-phase0d/
├── _setup.ts                           (CREATE)
├── trial-balance.test.ts               (CREATE)
├── general-ledger.test.ts              (CREATE)
└── coa-update.test.ts                  (CREATE)
```

## 4. Components Detail

### 4.1 AkuntansiScreen — tab routing

```typescript
type AkuntansiTab = 'trial-balance' | 'buku-besar' | 'tutup-buku' | 'coa';

const [activeTab, setActiveTab] = useState<AkuntansiTab>('trial-balance');
const [bukuBesarAccountId, setBukuBesarAccountId] = useState<string | null>(null);
// ^ saat user klik row di TrialBalance → setActiveTab('buku-besar') + setBukuBesarAccountId

// Header: title + tab strip
// Body: render active tab component
```

Tab bar style match existing AccountDetailScreen tabs (border-b-2 emerald-600 on active).

### 4.2 TrialBalanceTab (M3)

**Props:**
```typescript
interface TrialBalanceTabProps {
  showToast: ToastFn;
  onDrillDown: (accountId: string) => void;  // switch ke Buku Besar tab
}
```

**State:** `period` (selectedPeriodId atau current month), `rows: TrialBalanceRow[]`, `loading`

**Layout:**
- Header: title + period selector dropdown + Export PDF/Excel buttons (placeholder)
- Balance banner: green ✓ Seimbang atau red ⚠ Tidak Seimbang
- Table grouped by `account_type` (ASET, LIABILITAS, MODAL, PENDAPATAN, BEBAN) with section header rows colored per type
- Row click → onDrillDown(account_id)
- Tfoot: TOTAL Debit/Kredit + Balanced indicator

**Data:**
```sql
SELECT * FROM trial_balance WHERE period_id = ? ORDER BY account_code
```
Group rows by account_type in TS (no SQL grouping).

### 4.3 BukuBesarTab (M4)

**Props:**
```typescript
interface BukuBesarTabProps {
  initialAccountId?: string | null;  // dari TB drill-down
  showToast: ToastFn;
}
```

**State:** `accountId`, `period`, `rows: GeneralLedgerRow[]`, `accountMeta` (code/name/normal_balance)

**Layout:**
- Header: back-link "Trial Balance" (kalau came from drill-down) + akun title + subtitle (type/subtype/normal_balance)
- Account picker dropdown (fetch all active COA accounts) — auto-select kalau initialAccountId provided
- Period selector
- 3-stat hero (sub-card style, NOT gradient): Saldo Awal / Movement bulan ini / Saldo Akhir
- Running balance table: Tanggal | No. Entry | Keterangan | Debit | Kredit | Saldo
- PDF/Excel buttons (placeholder)

**Data:**
```sql
SELECT * FROM general_ledger WHERE account_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date, line_number
```

### 4.4 TutupBukuTab (M5)

**Layout:**
- Left card: Period status list (OPEN / CLOSED / REOPENED). Closeable period (latest OPEN that's not current month) has "Tutup Buku" red button.
- Right card: ketika user klik "Tutup Buku" → show PeriodCloseModal pre-loaded with that period

**Period list source:**
```sql
SELECT * FROM accounting_periods ORDER BY period_year DESC, period_month DESC
```

**Close-eligibility logic:**
- Status OPEN
- period_month < current_month (atau period_year < current_year)
- Trial balance for period is balanced (verify pre-flight di modal)

### 4.5 PeriodCloseModal

**Props:**
```typescript
interface PeriodCloseModalProps {
  open: boolean;
  period: AccountingPeriod;
  onClose: () => void;
  onClosed: () => void;
  showToast: ToastFn;
}
```

**Layout (mockup section 5 right card):**
- Header rose-themed "Tutup Buku [Month Year] — Konfirmasi"
- Snapshot sub-card: Total entries, Trial Balance status, Omzet period
- Tax Accrual sub-card amber: PPh Final preview (omzet × 0.5%) — show JE skeleton "D 5-3300 Beban Pajak / K 2-1210 Hutang PPh Final"
- Footer: btn-danger "Tutup Buku + Generate Tax" + btn-secondary "Batal"

**Submit flow:**
1. Call `close_accounting_period(period_id)` — RPC handles tax accrual internally OR call `accrue_period_taxes(period_id)` then `close_accounting_period(period_id)`
2. Verify which pattern by reading existing RPCs (likely close calls accrual internally per spec)
3. On success: toast + onClosed + onClose
4. On error: surface error message

### 4.6 COAManagementTab

**Layout:**
- Header: title + filter (active/inactive) + search box (filter by account_code/name)
- Tree-ish list grouped by `account_type`:
  - Section header per type (ASET / LIABILITAS / MODAL / PENDAPATAN / BEBAN)
  - Within each: rows showing `account_code` (mono) + name + parent (if any) + Active toggle + Edit button
- Each row click → opens edit drawer/modal:
  - account_code (readonly)
  - account_name (editable)
  - description (editable, optional)
  - is_active toggle
  - **is_system=true** rows show "🔒 System account — only label editable, cannot disable" 

**Data fetch:**
```sql
SELECT * FROM chart_of_accounts ORDER BY account_code
```

**Update via RPC:** `update_coa_account(p_id, p_account_name, p_description, p_is_active)` — RPC guards `is_system=true` accounts (only name + description editable, NOT is_active).

## 5. Backend — Single New RPC

### Migration `20260722000005_update_coa_account_rpc.sql`

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.update_coa_account(
  p_id uuid,
  p_account_name text,
  p_description text,
  p_is_active boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing public.chart_of_accounts%ROWTYPE;
BEGIN
  PERFORM _assert_owner_active();

  SELECT * INTO v_existing FROM chart_of_accounts WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COA_NOT_FOUND';
  END IF;

  -- Validation
  IF p_account_name IS NULL OR length(trim(p_account_name)) < 3 THEN
    RAISE EXCEPTION 'INVALID_ACCOUNT_NAME: minimal 3 karakter';
  END IF;

  -- System accounts: can only edit name/description, not is_active
  IF v_existing.is_system AND p_is_active = false AND v_existing.is_active = true THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_PROTECTED: akun sistem tidak bisa dinonaktifkan';
  END IF;

  UPDATE chart_of_accounts
  SET
    account_name = trim(p_account_name),
    description = p_description,
    is_active = CASE WHEN v_existing.is_system THEN v_existing.is_active ELSE p_is_active END,
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'updated_at', now());
END $$;

GRANT EXECUTE ON FUNCTION public.update_coa_account(uuid, text, text, boolean) TO authenticated;

COMMIT;
```

## 6. Validation Rules

| Field | Rule | Error |
|---|---|---|
| Period for close | must be OPEN + month < current_month | "Periode belum bisa di-close" |
| Period for close | trial balance must be balanced | "Trial Balance tidak seimbang — fix dulu" |
| COA account_name update | min 3 char | "INVALID_ACCOUNT_NAME" |
| COA is_active flip | is_system rows cannot be disabled | "SYSTEM_ACCOUNT_PROTECTED" |
| Tab navigation | preserve URL state via existing urlRoute pattern (akuntansi-tab=...) | n/a |

## 7. Error Handling

- Period close errors → modal stays open, error shown
- COA update errors → toast warning, edit modal stays open
- Trial Balance / Buku Besar load errors → show "Gagal memuat" placeholder
- View loading: skeleton state matching existing AccountDetailScreen pattern

## 8. Testing Strategy

### Unit tests (vitest)
- `glQueries.test.ts` — 4 query functions (fetchTrialBalance, fetchGeneralLedger, fetchPeriods, fetchCoaTree) with mocked supabase
- `periodCloseService.test.ts` — RPC wrapper happy + error path
- `coaUpdateService.test.ts` — RPC wrapper + validation

### Integration tests (vitest)
- `trial-balance.test.ts` — verify view returns expected columns + filtering by period
- `general-ledger.test.ts` — verify view returns running balance + filtering by account
- `coa-update.test.ts` — RPC update happy path + system_account_protected + invalid name

### Manual smoke (browser via Chrome DevTools MCP)
- Open Akuntansi → Trial Balance tab → verify table renders + balanced
- Click row → drill to Buku Besar with that account
- Switch period → table refresh
- Open Tutup Buku tab → click "Tutup Buku" on a closeable period → verify modal preview + close success
- Open COA tab → toggle an account is_active → verify update

## 9. Decisions Locked (from brainstorm)

| Q | Decision |
|---|---|
| Layout | Tabs di-satu-screen (4 tabs di AkuntansiScreen) |
| Export PDF/Excel | Placeholder toast — defer ke Phase 4 |
| COA Management | View + edit name + toggle is_active. **NO add new account.** |
| Buku Besar drill-down | Tab switch + initialAccountId state (same screen, no route change) |

## 10. Effort Estimate

- Backend RPC + migration: **0.5 hari** (1 RPC)
- Service layer + types + unit tests: **1 hari**
- TrialBalanceTab: **1 hari**
- BukuBesarTab: **1 hari** (reuses much logic from AccountDetailScreen Riwayat table)
- TutupBukuTab + PeriodCloseModal: **1 hari**
- COAManagementTab + edit drawer: **1.5 hari**
- AkuntansiScreen tab refactor + integration: **0.5 hari**
- Integration tests + smoke: **1 hari**

**Total: ~7.5 hari engineering** (target 1 minggu via subagent-driven dev).

## 11. Success Criteria

- [ ] AkuntansiScreen tabs functional (4 tabs visible + switch state)
- [ ] Trial Balance loads from view, grouped by type, balanced banner accurate
- [ ] Buku Besar drill-down dari Trial Balance row click works
- [ ] Tutup Buku close flow: select period → modal → submit → period status flips CLOSED
- [ ] Tax Accrual JE auto-posted di period close (verified di Riwayat)
- [ ] COA toggle active/inactive persists + system accounts protected
- [ ] Browser smoke: 5+ flows end-to-end PASS
- [ ] tsc + tests clean + build OK
- [ ] No regression di Phase 1 / Phase 3

---

## Next Steps

1. User review spec — request changes kalau ada
2. Write implementation plan (10-12 tasks)
3. Execute via subagent-driven-development
