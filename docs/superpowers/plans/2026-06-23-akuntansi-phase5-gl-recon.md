# Akuntansi Phase 5 GL Recon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Match bank statement lines to GL journal_entry_lines (D/K on BANK accounts) — extend existing Rekonsiliasi screen rather than build new. Multi-allocation 1:N supported.

**Architecture:** Schema already prepared (Phase 0a added `journal_entry_lines.bank_line_id` + `reconciled_at`). Phase 5 = minimal backend RPCs for atomic matching + extend existing RekonsiliasiScreen with GL mode + new tab di KasBankScreen.

**Tech Stack:** PostgreSQL 15, React 18 + TypeScript strict, vitest.

## Global Constraints

- TypeScript strict, zero `any` in new files
- EXTEND existing `src/components/RekonsiliasiScreen.tsx` — do NOT create separate AkuntansiReconScreen
- Reuse existing PDF upload + bank_accounts + Gemini parsing + lane coloring
- Multi-allocation: 1 bank_statement_line → N journal_entry_lines (set `bank_line_id` on each matched line)
- Auto-match algorithm: ±5% amount tolerance + ±3 days date window + confidence ≥0.95 → auto; else manual via drawer
- Feature flag: when `accounting_config.enable_dual_write_to_gl=true` AND BANK COA accounts exist → enable GL mode in RekonsiliasiScreen
- Backward compat: existing payable_slot matching flow unchanged
- Migration slot `20260725*`
- Indonesian-friendly errors

## File Structure

**Backend (1 migration):**
- `supabase/migrations/20260725000001_phase5_gl_recon_rpcs.sql` — 2 RPCs (match_journal_to_bank_line, auto_match_journal_lines_to_bank) + supporting helpers

**Service layer:**
- `src/lib/akuntansi/journalReconService.ts` (CREATE)
- `src/lib/akuntansi/journalReconService.test.ts` (CREATE)

**UI:**
- `src/components/RekonsiliasiScreen.tsx` (MODIFY) — add GL mode auto-enable + new column for journal_entry_lines
- `src/components/rekonsiliasi/MappingDrawer.tsx` (MODIFY) — support `journal` candidate type + checkbox multi-allocation + balance calculator
- `src/components/rekonsiliasi/JournalColumn.tsx` (CREATE) — new column showing unreconciled journal_entry_lines on BANK
- `src/components/kasbank/UnmatchedJournalTab.tsx` (CREATE) — M4 "Belum Cocok" tab di KasBankScreen
- `src/components/kasbank/AccountDetailScreen.tsx` (MODIFY) — add "Belum Cocok" sub-tab (kalau cash_account type='BANK')

**Tests:**
- `tests/integration/akuntansi-phase5/_setup.ts`
- `tests/integration/akuntansi-phase5/match-journal.test.ts`
- `tests/integration/akuntansi-phase5/auto-match.test.ts`

**Docs:** progress.md

---

## Task Breakdown

### Task 1: Migration — match RPCs

**File:** `supabase/migrations/20260725000001_phase5_gl_recon_rpcs.sql`

**RPC 1: `match_journal_to_bank_line(p_bank_line_id uuid, p_journal_entry_line_ids uuid[], p_match_reason text)`**

- SECURITY DEFINER + Owner gate via `_assert_owner_active()`
- Validates bank_line_id exists + journal_entry_line_ids non-empty
- Validates sum of journal_entry_lines.amount ≤ bank_line.amount (overflow check)
- UPDATEs each `journal_entry_lines.bank_line_id = p_bank_line_id` + `reconciled_at = now()`
- UPDATEs bank_statement_lines: maybe set `lane='GREEN'` + `match_reason`
- Returns jsonb `{ok, matched_count, total_amount_matched}`

**RPC 2: `auto_match_journal_lines_to_bank(p_bank_account_id uuid, p_period_year int, p_period_month int)`**

- For each unmatched bank_statement_line in period:
  - Find journal_entry_lines candidates (BANK account_type + same period + unmatched + amount ±5% + date ±3 days)
  - Score by amount-similarity + date proximity
  - If best score ≥ 0.95: auto-match (call internal `_link_journal_to_bank`)
  - Else: skip (leave for manual)
- Returns jsonb `{auto_matched_count, candidates_pending_manual_count}`

**Helper internal:** `_score_journal_match(bank_line_id, journal_line_id) RETURNS numeric` — return 0.0-1.0

**Smoke tests (MCP):**
1. Manual match happy path: create test bank_line + journal_line, call RPC, verify FK + reconciled_at set
2. Auto-match: insert 2 bank_lines + 2 matching JEs, call auto_match, verify both matched
3. Owner gate: non-owner → INSUFFICIENT_ROLE
4. Cleanup test data

- [ ] **Step 1**: Verify column existence (`journal_entry_lines.bank_line_id`, `bank_statement_lines.lane`)
- [ ] **Step 2**: Write migration + RPCs
- [ ] **Step 3**: Apply
- [ ] **Step 4**: Smoke 4 cases via MCP execute_sql with cleanup
- [ ] **Step 5**: Commit `feat(akuntansi): Phase 5 Task 1 — GL recon RPCs`

---

### Task 2: Service `journalReconService.ts`

**Interfaces produced:**
```typescript
export interface UnreconciledBankLine {
  id: string;
  bank_account_id: string;
  date: string;
  description: string;
  amount: number;
  direction: 'IN' | 'OUT';
  lane: 'GREEN' | 'YELLOW' | 'RED' | 'GRAY';
}

export interface UnreconciledJournalLine {
  id: string;
  entry_id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  account_code: string;
  account_id: string;
  side: 'DEBIT' | 'CREDIT';
  amount: number;
}

export interface MatchResult {
  ok: true;
  matched_count: number;
  total_amount_matched: number;
}

export async function fetchUnreconciledBankLines(bankAccountId: string, fromDate: string, toDate: string): Promise<UnreconciledBankLine[]>;
export async function fetchUnreconciledJournalLines(coaAccountId: string, fromDate: string, toDate: string): Promise<UnreconciledJournalLine[]>;
export async function matchJournalToBankLine(input: {
  bankLineId: string;
  journalEntryLineIds: string[];
  matchReason: string;
}): Promise<MatchResult>;
export async function autoMatchJournalLinesToBank(input: {
  bankAccountId: string;
  periodYear: number;
  periodMonth: number;
}): Promise<{ autoMatched: number; candidatesPendingManual: number }>;
```

Unit tests: mocked supabase.rpc, 8-10 tests.

- [ ] **Step 1**: Write service + unit tests
- [ ] **Step 2**: tsc + tests pass
- [ ] **Step 3**: Commit

---

### Task 3: Extend MappingDrawer support journal candidates + multi-allocation

**File:** `src/components/rekonsiliasi/MappingDrawer.tsx` (MODIFY)

Current props likely have:
```typescript
candidates: { source: 'mutasi' | 'order' | 'cash', ... }[]
```

Extend `source` union to include `'journal'`. Add `multiAllocation?: boolean` prop. When true:
- Render checkboxes instead of single-select radio
- Show "Selected total: Rp X / Target: Rp Y" balance line at top
- Submit triggers `matchJournalToBankLine` with array of selected IDs

- [ ] **Step 1**: Read current MappingDrawer.tsx (likely ~200 lines)
- [ ] **Step 2**: Extend types + checkbox UI
- [ ] **Step 3**: tsc clean
- [ ] **Step 4**: Commit

---

### Task 4: Extend RekonsiliasiScreen with GL mode + JournalColumn

**Files:**
- Modify: `src/components/RekonsiliasiScreen.tsx`
- Create: `src/components/rekonsiliasi/JournalColumn.tsx`

**Strategy:**
1. Read existing RekonsiliasiScreen structure (3 columns currently)
2. Add detection: `glModeEnabled = config?.enable_dual_write_to_gl === true && bankAccountsExist.length > 0`
3. When `glModeEnabled`: show 4th column "Journal Entries" replacing or beside CashColumn
   - OR: replace OrdersColumn with JournalColumn (when GL mode)
   - Decision: ADD as 4th column → user can compare. Existing 3 columns stay.
4. JournalColumn fetches `fetchUnreconciledJournalLines` for selected bank account COA
5. Click journal line → opens MappingDrawer in 'journal' mode → find candidate bank lines
6. OR: click bank line → drawer shows journal candidates

**JournalColumn layout:**
- Header: account name + balance summary
- Per row: entry_number + date + amount + account_code small chip
- Status: unmatched (gray) / matched (green check)
- "Auto-match" button at top → calls autoMatchJournalLinesToBank → toast result

- [ ] **Step 1**: Read RekonsiliasiScreen + understand column rendering
- [ ] **Step 2**: Write JournalColumn
- [ ] **Step 3**: Wire into RekonsiliasiScreen + detection
- [ ] **Step 4**: tsc + build
- [ ] **Step 5**: Commit

---

### Task 5: Add "Belum Cocok" tab to AccountDetailScreen (Phase 5 M4)

**File:** `src/components/kasbank/AccountDetailScreen.tsx` (MODIFY)

Per Phase 5 mockup M4: tab "Belum Cocok" appears for accounts of type BANK showing unmatched journal_entry_lines.

Add new tab between existing "Riwayat" / "Statistik" tabs (if exists). When active:
- Fetch `fetchUnreconciledJournalLines(account.coa_account_id, '30 days ago', today)`
- Render table: date, description, amount, "since X days unmatched"
- Empty state: "Semua sudah cocok ✓"
- Button per row: "Buka Modul Rekonsiliasi" → onNavigate('rekonsiliasi') with bank_account context

Only show this tab when `cash_account.account_type === 'BANK'`.

- [ ] **Step 1**: Read AccountDetailScreen for tab structure
- [ ] **Step 2**: Add UnmatchedJournalTab inline OR new file
- [ ] **Step 3**: tsc + build
- [ ] **Step 4**: Commit

---

### Task 6: Integration tests + final validation + deploy

**Files:**
- `tests/integration/akuntansi-phase5/_setup.ts`
- `tests/integration/akuntansi-phase5/match-journal.test.ts`
- `tests/integration/akuntansi-phase5/auto-match.test.ts`

Pattern C tests:
- RPCs exist (match_journal_to_bank_line, auto_match_journal_lines_to_bank, _score_journal_match)
- journal_entry_lines columns accessible (bank_line_id, reconciled_at)
- Schema joins work

~10-12 tests.

**Plus final validation:**
- `npm test --run` PASS
- `npx tsc --noEmit` clean
- `npm run build` OK
- progress.md entry
- Merge → push → wait Cloud Build → promote traffic
- MCP smoke in production: create test bank_line + JE, call match RPC, verify, cleanup

- [ ] **Step 1**: Write tests
- [ ] **Step 2**: Run vitest pass
- [ ] **Step 3**: Full validation
- [ ] **Step 4**: progress.md
- [ ] **Step 5**: Commit + merge + push + promote + smoke

---

## Verification matrix

| Layer | Method | Pass criterion |
|---|---|---|
| RPCs | MCP execute_sql | Manual + auto match scenarios PASS |
| Service unit | vitest | Wrappers verified |
| Component render | tsc + build | mounts without errors |
| Integration tests | vitest | Schema + deployment verified |
| Production smoke | MCP execute_sql | match RPC works with real auth |

## Pre-flight notes

- Worktree: `.claude/worktrees/akuntansi-phase5` on branch `worktree-akuntansi-phase5`
- Migration slot `20260725*`
- Auth UID for smoke: `227c28f4-09f6-4dc9-af7a-01b0feb2c194` (tonywei)
- **No test data currently exists** — 0 bank_statement_lines + 0 journal lines on BANK. Smoke tests must create fixtures.
- Subagent MUST verify `git branch --show-current` = `worktree-akuntansi-phase5` BEFORE git add

## Out-of-scope (defer)

- New schema columns on journal_entry_lines (use existing bank_line_id + reconciled_at)
- ML-based fuzzy matching
- PDF re-upload UI (existing flow OK)
- Bulk re-reconciliation (defer)
- Cross-period auto-match (within-period only for Phase 5 v1)
