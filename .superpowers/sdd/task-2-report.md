### Task 2 Report: reportQueries.ts service + unit tests

**Status:** COMPLETE
**Commit:** a9becc2
**Branch:** worktree-akuntansi-phase4 ✓

---

#### Schema Verification

Confirmed column names from Supabase `ekhhojaezdfjfwuxyjkl`:

| Table | Key columns used |
|---|---|
| `journal_entry_lines` | id, entry_id, account_id, side, amount, description |
| `journal_entries` | entry_date, entry_number, source_type, description |
| `chart_of_accounts` | id, account_code, account_name, account_type, account_subtype, normal_balance |
| `cash_accounts` | id, coa_account_id, internal_label, account_type, purpose |

Actual subtype values verified from live seed data. Key findings that affected implementation:

- `cash_accounts.purpose` only has `PETTY_CASH` — `includePersonal` is a reserved stub (no OWNER_PERSONAL purpose exists)
- `ASET/KONTRA` = single account `1-2900 "Akumulasi Penyusutan"` (CREDIT-normal)
- Liabilitas split: `2-1xxx` = Lancar, `2-2xxx` = Jangka Panjang (confirmed by account_code prefix)
- `PENDAPATAN/KONTRA` subtype exists (Retur Penjualan) — handled in `pendapatanBersih` computation
- `BEBAN/HPP` subtype confirmed (not a separate account_type)

---

#### Files Created

- `src/lib/akuntansi/reportQueries.ts` — 4 fetch functions + shared helpers
- `src/lib/akuntansi/reportQueries.test.ts` — 23 unit tests

---

#### Function Summary

**`fetchMutasi(filters)`**
- Resolves cash COA IDs (BANK/KAS/E_WALLET) when `accountIds` is empty
- Fetches `cash_accounts.internal_label` for display label (falls back to account_name)
- Classifies IN/OUT based on `normal_balance` vs `side` (not hardcoded DEBIT=IN)
- Applies direction + category filters client-side
- Sorted by entry_date ASC, entry_number ASC

**`fetchLabaRugi(fromDate, toDate)`**
- Single query: PENDAPATAN + BEBAN accounts for date range
- Pending breakdown: PENJUALAN, KONTRA (subtracted), PENDAPATAN_LAIN
- HPP, BEBAN_OPERASIONAL, BEBAN_NON_OPERASIONAL (excl. 5-3300)
- `beban_pajak` = account_code '5-3300' extracted separately

**`fetchNeraca(asOfDate)`**
- Cumulative query: all ASET/LIABILITAS/MODAL entries ≤ asOfDate
- Aset Lancar: subtypes BANK/KAS/E_WALLET/PERSEDIAAN/PIUTANG/PIUTANG_USAHA
- Aset Tetap gross − akumulasiPenyusutan (KONTRA subtype)
- Liabilitas split by account_code prefix (2-1 vs 2-2)
- `balanceCheck.diff = totalAset − (totalLiabilitas + totalEkuitas)`, balanced if |diff| < 0.01
- Header/group rows (null subtype) excluded from line items

**`fetchCashFlow(endYear, endMonth, trailingMonths)`**
- Builds trailing-month window with year-boundary handling
- Two-query approach: COA resolve → journal lines for date range
- Category pivot: `inMap` (DEBIT on DEBIT-normal) / `outMap` (CREDIT)
- `CashFlowCategory.totalNet` = totalIn for uangMasuk, totalOut for uangKeluar

---

#### Design Decisions

- `is_posted` NOT filtered — conscious parity with `fetchTrialBalanceAsOf` in glQueries.ts
- `any` used only in test helper mock setup (eslint-disable comment)
- `supabase-js` relational fields unwrapped via `Array.isArray()` guard (matches glQueries pattern)

---

#### Tests: 23/23 PASS

| Suite | Tests |
|---|---|
| fetchMutasi | 5 (happy, direction filter, explicit IDs, empty, error, no-cash-COA) |
| fetchLabaRugi | 5 (happy, KONTRA, pajak extraction, empty, error) |
| fetchNeraca | 5 (happy balanced, imbalanced diff, empty, jk-panjang split, error) |
| fetchCashFlow | 8 (happy 2-month pivot, year boundary, no cash, empty, 2x error, OWNER_DRAWING) |

`npx tsc --noEmit` → 0 errors, 0 warnings.
