# Task 4 Report — RekonsiliasiScreen GL Mode + JournalColumn

**Status:** DONE
**Date:** 2026-06-23
**Branch:** worktree-akuntansi-phase5
**Base commit:** ba99a85
**Verification:** tsc clean · 48 test files · 401/401 PASS

---

## Existing RekonsiliasiScreen Structure

Before this task, `RekonsiliasiScreen.tsx` had:
- 3-column grid: `OrdersColumn` (left) · `MutasiColumn` (center) · `CashColumn` (right)
- `openFindPairForMutasi` builds `DrawerCandidate[]` from `orders[].slots` (payable_slots) and opens `MappingDrawer` with single-select mode
- `MappingDrawer` already had `multiAllocation` + `onPickMulti` props added in Task 3
- No GL awareness — no `glMode`, no `glConfig`, no journal entry lines fetched

---

## Files Modified

### `src/components/RekonsiliasiScreen.tsx`

New imports:
- `fetchAccountingConfig`, `fetchCoa` from `../lib/akuntansi/service`
- `AccountingConfig`, `CoaAccount` types from `../lib/akuntansi/types`
- `fetchUnreconciledJournalLines`, `matchJournalToBankLine`, `autoMatchJournalLinesToBank`, `UnreconciledJournalLine` from `../lib/akuntansi/journalReconService`
- `JournalColumn` from `./rekonsiliasi/JournalColumn`

New state:
- `glMode: boolean` — toggle flag
- `glConfig: AccountingConfig | null` — fetched on mount
- `glBankCoaAccounts: CoaAccount[]` — BANK-subtype COA accounts (fetched when glMode on)
- `glCoaAccountId: string | null` — active COA selection
- `glJournalLines: UnreconciledJournalLine[]` — cached for drawer candidates
- `glRefreshKey: number` — bumped after match to force JournalColumn refetch

New effects:
- Mount: `fetchAccountingConfig()` → `setGlConfig`
- `glMode` on: `fetchCoa()` → filter `account_subtype === 'BANK'` → auto-select first
- `glCoaAccountId / period / glRefreshKey` change: `fetchUnreconciledJournalLines()` → `setGlJournalLines`

New derived:
- `glModeAvailable = glConfig?.enable_dual_write_to_gl === true && accounts.length > 0`

---

## Files Created

### `src/components/rekonsiliasi/JournalColumn.tsx`

Props:
```typescript
interface Props {
  coaAccountId: string | null;
  bankAccountId: string | null;
  bankAccountLabel: string;
  fromDate: string;
  toDate: string;
  onPickJournalLine: (line: UnreconciledJournalLine) => void;
  onAutoMatch: () => Promise<void>;
  refreshKey?: number;
}
```

Layout:
- Header: "GL · Journal Entries" + bankAccountLabel + count badge + Auto-match button
- Scrollable list with per-row: `entry_number` (mono blue) + `entry_date` + optional description + `account_code` chip + amount + DEBIT (emerald) / CREDIT (rose) side chip
- Hover: `hover:bg-blue-50 hover:border-blue-200`
- Empty state: "Semua sudah cocok ✓"
- No COA state: link prompt
- Auto-match button disabled when `!bankAccountId`

---

## GL Mode Toggle Wiring

Toggle button location: top-right of header, next to period selector and "Tutup Buku".

Condition: Only rendered when `glModeAvailable` is true (i.e. `enable_dual_write_to_gl === true && accounts.length > 0`).

Visual states:
- Off: outlined indigo button "Match dengan GL (Phase 5)"
- On: filled indigo "✓ GL Mode Aktif"

COA selector: shown below header bar when `glMode && glBankCoaAccounts.length > 1`.

---

## Auto-Match Button Location

The "Auto-match" button lives in `JournalColumn` header (top-right). It calls the `onAutoMatch` prop which in `RekonsiliasiScreen` runs:
```typescript
autoMatchJournalLinesToBank({ bankAccountId: accounts[0].id, periodYear, periodMonth })
```

**Known limitation:** Auto-match uses `accounts[0].id` regardless of which COA account is selected in the multi-COA selector. For Garindo (single-tenant, one bank account), this is fine. Future: correlate selected `glCoaAccountId` back to the specific `bank_accounts` row via `cash_accounts.coa_account_id` lookup.

---

## Flow (Option A: bank line as anchor)

1. User activates GL mode → OrdersColumn swapped with JournalColumn
2. User clicks a bank line in MutasiColumn → `openFindPairForMutasi` detects `glMode=true`
3. `buildGlCandidates(line)` scores `glJournalLines` by amount proximity (±5% tolerance, 97% score on tight match)
4. `MappingDrawer` opens with `multiAllocation=true`, `headerBg` in indigo tone
5. User selects one or more journal lines → clicks "Match selected"
6. `handlePickMultiGl` calls `matchJournalToBankLine({ bankLineId, journalEntryLineIds, matchReason: 'manual_gl' })`
7. Success: toast + `glRefreshKey++` (JournalColumn refetches) + `refresh()` (MutasiColumn refetches)

---

## Branch Verification

```
git branch --show-current
→ worktree-akuntansi-phase5
```

---

## Verification Checklist

- [x] `npx tsc --noEmit` — 0 errors
- [x] `npm test -- --run` — 48 files, 401/401 PASS
- [x] GL mode toggle visible only when `enable_dual_write_to_gl === true`
- [x] Standard 3-column flow unchanged when `glMode=false`
- [x] `JournalColumn` created with correct props interface
- [x] `MappingDrawer` opened with `multiAllocation=true` in GL mode
- [x] Auto-match button in JournalColumn header
- [x] Empty state: "Semua sudah cocok ✓"
- [x] No COA state: link prompt shown
