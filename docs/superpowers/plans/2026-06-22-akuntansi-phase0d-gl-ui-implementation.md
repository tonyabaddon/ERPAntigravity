# Akuntansi Phase 0d GL UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AkuntansiScreen tabs — Trial Balance, Buku Besar, Tutup Buku, COA Management — fully wired to existing Phase 0a backend views/RPCs.

**Architecture:** 4-tab refactor di `AkuntansiScreen` after opening balance set. New service layer reads existing `trial_balance` + `general_ledger` views + `accounting_periods` table. Single new RPC `update_coa_account` for COA edit. PeriodCloseModal calls existing `close_accounting_period` + `accrue_period_taxes`.

**Tech Stack:** PostgreSQL 15 (Supabase), React 18 + TypeScript, Tailwind v4, lucide-react, vitest.

## Global Constraints

- All new RPC SECURITY DEFINER + GRANT EXECUTE TO authenticated + `_assert_owner_active()` gate
- Backend reuse 100% from Phase 0a (zero schema changes except 1 new RPC for COA update)
- Tabs preserve URL via existing urlRoute pattern OR session state — pick simpler
- COA Management: **NO add new account button** (SAK EMKM standard fixed; auto-create via AccountFormModal Phase 1)
- COA system accounts (`is_system=true`) protected — only name+description editable, NOT is_active
- Trial Balance + Buku Besar export PDF/Excel: **placeholder toast** "hadir di Phase 4 Laporan"
- Period close: only periods OPEN + month < current_month eligible
- Period close verifies trial balance balanced before close (delegate to existing `close_accounting_period` RPC if it checks)
- Design tokens match existing app: `--color-primary: #1e3d60`, `#012749` button, `#c7d7f5` border, `#fafbff` sub-card, rounded-full pill, lucide-react icons
- TypeScript strict, zero `any` in new files
- Migration timestamp slot `20260722*` (continues Phase 3 slot since same date — use `20260722000005`)
- Indonesian-friendly error messages match Phase 0a/3 pattern

## File Structure

**Backend:**
- `supabase/migrations/20260722000005_update_coa_account_rpc.sql` (CREATE)

**Service layer:**
- `src/lib/akuntansi/glQueries.ts` (CREATE) — fetchTrialBalance, fetchGeneralLedger, fetchAccountingPeriods, fetchCoaTree
- `src/lib/akuntansi/glQueries.test.ts` (CREATE)
- `src/lib/akuntansi/periodClose.ts` (CREATE) — closePeriod wrapper
- `src/lib/akuntansi/periodClose.test.ts` (CREATE)
- `src/lib/akuntansi/coaUpdate.ts` (CREATE) — updateCoaAccount wrapper
- `src/lib/akuntansi/coaUpdate.test.ts` (CREATE)

**UI:**
- `src/components/akuntansi/gl/TrialBalanceTab.tsx` (CREATE)
- `src/components/akuntansi/gl/BukuBesarTab.tsx` (CREATE)
- `src/components/akuntansi/gl/TutupBukuTab.tsx` (CREATE)
- `src/components/akuntansi/gl/PeriodCloseModal.tsx` (CREATE)
- `src/components/akuntansi/gl/COAManagementTab.tsx` (CREATE)
- `src/components/akuntansi/gl/COAEditModal.tsx` (CREATE)
- `src/components/akuntansi/AkuntansiScreen.tsx` (MODIFY) — tab layout

**Tests:**
- `tests/integration/akuntansi-phase0d/_setup.ts` (CREATE)
- `tests/integration/akuntansi-phase0d/trial-balance.test.ts` (CREATE)
- `tests/integration/akuntansi-phase0d/general-ledger.test.ts` (CREATE)
- `tests/integration/akuntansi-phase0d/coa-update.test.ts` (CREATE)

**Docs:**
- `progress.md` (MODIFY) — final entry per CLAUDE.md gotcha

---

## Task Breakdown

### Task 1: Migration — `update_coa_account` RPC + smoke test

**Files:**
- Create: `supabase/migrations/20260722000005_update_coa_account_rpc.sql`

**Interfaces produced:**
- `update_coa_account(p_id uuid, p_account_name text, p_description text, p_is_active boolean) RETURNS jsonb` — `{ok, updated_at}`

**Logic:**
- `_assert_owner_active()` gate
- Lookup row by p_id; raise `COA_NOT_FOUND` if missing
- Validate `length(trim(p_account_name)) >= 3` → raise `INVALID_ACCOUNT_NAME`
- If `is_system=true AND p_is_active=false AND existing.is_active=true` → raise `SYSTEM_ACCOUNT_PROTECTED`
- Update with `is_active = CASE WHEN is_system THEN existing.is_active ELSE p_is_active END` (system always stays active)
- Update `updated_at = now()` (if column exists; check via list_tables first)
- Return jsonb

- [ ] **Step 1**: Verify chart_of_accounts schema via MCP `execute_sql` — does `description` + `updated_at` column exist?
- [ ] **Step 2**: Write migration
- [ ] **Step 3**: Apply via MCP `apply_migration`
- [ ] **Step 4**: Smoke test via MCP `execute_sql` — 3 cases (happy + INVALID_ACCOUNT_NAME + SYSTEM_ACCOUNT_PROTECTED) with `set_config` + rollback
- [ ] **Step 5**: Commit `feat(akuntansi): Phase 0d Task 1 — update_coa_account RPC`

---

### Task 2: TS service `glQueries.ts` + tests

**Files:**
- Create: `src/lib/akuntansi/glQueries.ts`
- Create: `src/lib/akuntansi/glQueries.test.ts`

**Interfaces produced:**
```typescript
export interface TrialBalanceRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: 'ASET' | 'LIABILITAS' | 'MODAL' | 'PENDAPATAN' | 'BEBAN';
  account_subtype: string | null;
  parent_id: string | null;
  is_system: boolean;
  is_active: boolean;
  total_debit: number;
  total_credit: number;
  balance: number;     // (debit - credit) for DEBIT-normal, vice versa
  normal_balance: 'DEBIT' | 'CREDIT';
}

export interface AccountingPeriod {
  id: string;
  period_year: number;
  period_month: number;
  status: 'OPEN' | 'CLOSED' | 'REOPENED';
  closed_at: string | null;
  closed_by: string | null;
  reopen_count: number;
}

export interface CoaTreeRow {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype: string | null;
  parent_id: string | null;
  is_system: boolean;
  is_active: boolean;
  description: string | null;
  normal_balance: 'DEBIT' | 'CREDIT';
}

export async function fetchTrialBalance(periodId: string | null): Promise<TrialBalanceRow[]>;
// periodId=null → current open period
export async function fetchGeneralLedger(accountId: string, fromDate: string, toDate: string): Promise<GeneralLedgerRow[]>;
// GeneralLedgerRow already exists in src/lib/akuntansi/types.ts — reuse
export async function fetchAccountingPeriods(): Promise<AccountingPeriod[]>;
export async function fetchCoaTree(includeInactive?: boolean): Promise<CoaTreeRow[]>;
```

- [ ] **Step 1**: Verify view schemas via MCP — what columns does `trial_balance` view return? `general_ledger` view? `accounting_periods` table? Match types to actual columns.
- [ ] **Step 2**: Write failing tests with mocked supabase
- [ ] **Step 3**: Implement queries
- [ ] **Step 4**: Tests pass + tsc clean
- [ ] **Step 5**: Commit

---

### Task 3: `periodClose.ts` + `coaUpdate.ts` services + tests

**Files:**
- Create: `src/lib/akuntansi/periodClose.ts` + `periodClose.test.ts`
- Create: `src/lib/akuntansi/coaUpdate.ts` + `coaUpdate.test.ts`

**Interfaces produced:**
```typescript
export interface PeriodCloseResult { ok: true; period_id: string; closed_at: string; tax_entry_id?: string | null }
export async function closeAccountingPeriod(periodId: string): Promise<PeriodCloseResult>;
// Calls existing close_accounting_period RPC. Verify RPC name + signature in 20260715000010

export interface CoaUpdateResult { ok: true; updated_at: string }
export async function updateCoaAccount(input: {
  id: string;
  accountName: string;
  description: string | null;
  isActive: boolean;
}): Promise<CoaUpdateResult>;
```

- [ ] **Step 1**: Verify `close_accounting_period` RPC signature di `supabase/migrations/20260715000010_period_close_rpcs.sql` — does it return jsonb? does it handle tax accrual internally or separate?
- [ ] **Step 2**: Write failing tests
- [ ] **Step 3**: Implement wrappers
- [ ] **Step 4**: Tests pass + tsc clean
- [ ] **Step 5**: Commit

---

### Task 4: TrialBalanceTab component

**Files:**
- Create: `src/components/akuntansi/gl/TrialBalanceTab.tsx`

**Props:**
```typescript
interface TrialBalanceTabProps {
  showToast: ToastFn;
  onDrillDown: (accountId: string) => void;
}
```

**Layout per mockup section 3:**
- Header card: title + period selector + Export PDF/Excel placeholder buttons
- Balance banner: ✓ Seimbang (emerald) atau ⚠ Tidak Seimbang (rose) based on sum(debit)===sum(credit)
- Table grouped by account_type with colored section header rows:
  - ASET (blue-50/30, color #1e40af)
  - LIABILITAS (rose-50/30, color #9f1239)
  - MODAL (violet-50/30, color #6b21a8)
  - PENDAPATAN (emerald-50/30, color #065f46)
  - BEBAN (orange-50/30, color #9a3412)
- Columns: Kode | Nama Akun | Debit | Kredit | Saldo
- Row click → `onDrillDown(row.account_id)`
- Tfoot: TOTAL row with sums + ✓ Balanced indicator

**Data:**
```typescript
const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);  // null = current
const [rows, setRows] = useState<TrialBalanceRow[]>([]);
const [loading, setLoading] = useState(true);
```

- [ ] **Step 1**: Write component
- [ ] **Step 2**: tsc clean
- [ ] **Step 3**: Commit

---

### Task 5: BukuBesarTab component

**Files:**
- Create: `src/components/akuntansi/gl/BukuBesarTab.tsx`

**Props:**
```typescript
interface BukuBesarTabProps {
  initialAccountId: string | null;
  onBackToTB?: () => void;
  showToast: ToastFn;
}
```

**Layout per mockup section 4:**
- Header: optional back-link "Trial Balance" (if onBackToTB provided), title "Buku Besar: [code] [name]", subtitle (type/subtype/normal_balance)
- Account picker dropdown (fetch all COA active accounts) — auto-select kalau initialAccountId
- Period selector (reuse same dropdown options as TB)
- 3-stat hero sub-cards: Saldo Awal | Movement bulan ini | Saldo Akhir
- Table: Tanggal | No. Entry | Keterangan | Debit | Kredit | Saldo running (similar to AccountDetailScreen Riwayat — reuse format helpers)
- Export PDF/Excel placeholder

**Data:**
```typescript
const [accountId, setAccountId] = useState<string | null>(initialAccountId);
const [period, setPeriod] = useState({fromDate, toDate});  // current month default
const [rows, setRows] = useState<GeneralLedgerRow[]>([]);
```

- [ ] **Step 1**: Write component (reuse formatting from AccountDetailScreen)
- [ ] **Step 2**: tsc clean
- [ ] **Step 3**: Commit

---

### Task 6: TutupBukuTab + PeriodCloseModal

**Files:**
- Create: `src/components/akuntansi/gl/TutupBukuTab.tsx`
- Create: `src/components/akuntansi/gl/PeriodCloseModal.tsx`

**TutupBukuTab layout per mockup section 5 left card:**
- Period list with status chip (OPEN green / CLOSED gray / REOPENED blue)
- Latest closeable period (OPEN + month < current_month) shows red "Tutup Buku" button
- Older closed/reopened periods read-only

**PeriodCloseModal per mockup section 5 right card:**
- Header rose: "Tutup Buku [Month Year] — Konfirmasi"
- Snapshot sub-card: total entries (query) + trial balance status (re-fetch) + omzet (sum PENDAPATAN)
- Tax Accrual sub-card amber: PPh Final preview = omzet × 0.5% (if `pajak_mode='FINAL_UMKM'` from accounting_config)
- Footer: btn-danger "Tutup Buku + Generate Tax" + Batal

**Submit:** call `closeAccountingPeriod(periodId)` → on success toast + close + parent reloads

- [ ] **Step 1**: Write TutupBukuTab
- [ ] **Step 2**: Write PeriodCloseModal
- [ ] **Step 3**: tsc clean
- [ ] **Step 4**: Commit

---

### Task 7: COAManagementTab + COAEditModal

**Files:**
- Create: `src/components/akuntansi/gl/COAManagementTab.tsx`
- Create: `src/components/akuntansi/gl/COAEditModal.tsx`

**COAManagementTab layout:**
- Header: title + filter chip (Aktif / Semua) + search box (filter by account_code / name)
- Tree grouped by account_type (ASET/LIABILITAS/MODAL/PENDAPATAN/BEBAN), section header per type
- Each row: account_code mono + name + active dot + Edit pencil icon
- Disabled (inactive) rows: muted gray text + "Inactive" chip
- System accounts: 🔒 icon next to name

**COAEditModal:**
- Header: account_code readonly + title
- Fields:
  - account_name (editable)
  - description (editable textarea, optional)
  - is_active toggle — disabled if `is_system=true`
- Footer: btn-primary "Simpan" + btn-secondary "Batal"
- On submit: call `updateCoaAccount({id, accountName, description, isActive})` → toast + reload parent

- [ ] **Step 1**: Write COAManagementTab
- [ ] **Step 2**: Write COAEditModal
- [ ] **Step 3**: tsc clean
- [ ] **Step 4**: Commit

---

### Task 8: AkuntansiScreen refactor — 4 tabs

**Files:**
- Modify: `src/components/akuntansi/AkuntansiScreen.tsx`

**Add to existing AkuntansiScreen (after opening balance is set branch):**

```typescript
type AkuntansiTab = 'trial-balance' | 'buku-besar' | 'tutup-buku' | 'coa';
const [activeTab, setActiveTab] = useState<AkuntansiTab>('trial-balance');
const [bukuBesarAccountId, setBukuBesarAccountId] = useState<string | null>(null);

const handleDrillDown = (accountId: string) => {
  setBukuBesarAccountId(accountId);
  setActiveTab('buku-besar');
};
```

Tab bar style (match AccountDetailScreen):
```tsx
<div className="border-b border-gray-200 px-6 flex gap-1 overflow-x-auto bg-white">
  {tabs.map(t => (
    <button onClick={() => setActiveTab(t.key)} className={`px-4 py-3 text-[13px] ${activeTab === t.key ? 'font-extrabold border-b-2 border-emerald-600 text-[#012749]' : 'font-bold text-gray-500 hover:text-gray-700'}`}>
      {t.label}
    </button>
  ))}
</div>
```

Tab content area renders active tab component.

Remove "Foundation ready" placeholder card.

- [ ] **Step 1**: Modify AkuntansiScreen
- [ ] **Step 2**: tsc + build OK
- [ ] **Step 3**: Commit

---

### Task 9: Integration tests

**Files:**
- Create: `tests/integration/akuntansi-phase0d/_setup.ts`
- Create: `tests/integration/akuntansi-phase0d/trial-balance.test.ts`
- Create: `tests/integration/akuntansi-phase0d/general-ledger.test.ts`
- Create: `tests/integration/akuntansi-phase0d/coa-update.test.ts`

Pattern Pattern C per Phase 3 (deployment + schema + role-gate sanity since Owner auth not injectable via service-role).

- `trial-balance.test.ts`: view returns expected columns; period filter works; sum balance check
- `general-ledger.test.ts`: view returns running balance; account_id filter works; ordering correct
- `coa-update.test.ts`: RPC exists; INVALID_ACCOUNT_NAME fires; SYSTEM_ACCOUNT_PROTECTED fires; happy path returns ok

- [ ] **Step 1**: Write _setup
- [ ] **Step 2**: Write 3 test files
- [ ] **Step 3**: `npx vitest run tests/integration/akuntansi-phase0d` → all PASS
- [ ] **Step 4**: Commit

---

### Task 10: Final validation + progress.md

- [ ] **Step 1**: `npm test --run` → all PASS
- [ ] **Step 2**: `npx tsc --noEmit` clean
- [ ] **Step 3**: `npm run build` OK
- [ ] **Step 4**: Append entry to `progress.md` summarizing 10 tasks + commits + verification + next phase recommendation
- [ ] **Step 5**: Commit `docs(progress): Akuntansi Phase 0d GL UI COMPLETE`

---

## Verification matrix

| Layer | Method | Pass criterion |
|---|---|---|
| RPC | MCP execute_sql | update_coa_account happy + 2 negative PASS |
| Service unit | vitest | mocked supabase calls verified |
| Component render | tsc + manual | mounts without console errors |
| Integration | vitest Pattern C | deployment + schema + role-gate verified |
| Build | npm run build | bundle OK |
| Regression | npm test --run | all pre-existing tests pass |

## Pre-flight notes

- Worktree: `.claude/worktrees/akuntansi-phase0d` on branch `worktree-akuntansi-phase0d`
- Migration slot `20260722000005` (Phase 3 used 1-4)
- Ledger: `.superpowers/sdd/progress.md`
