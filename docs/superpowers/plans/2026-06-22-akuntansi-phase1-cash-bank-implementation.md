# Akuntansi Phase 1 — Cash & Bank UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Owner sees saldo per akun Bank/Kas/E-Wallet live, plus Riwayat (running balance format akuntan). NEW `cash_accounts` table linked to `chart_of_accounts`. Picker integration deferred to Phase 0b.

**Architecture:** `cash_accounts` table (NEW) with FK `coa_account_id` → `chart_of_accounts`. Saldo computed via SQL view from `journal_entry_lines` (filter account_subtype IN KAS/BANK/E_WALLET). Riwayat reuses Phase 0a `general_ledger` view filtered by account.

**Tech Stack:** Supabase Postgres + React + TypeScript + Tailwind + lucide-react. Migrations applied via Supabase MCP.

**Mockup reference:** `docs/superpowers/mockups/2026-06-21-akuntansi-phase1-cash-bank.html`
**Roadmap:** `docs/superpowers/specs/2026-06-21-kas-bank-gl-roadmap.md` (Section 8)
**Worktree:** `.claude/worktrees/akuntansi-phase1` on branch `worktree-akuntansi-phase1`

## Global Constraints

- NEW `cash_accounts` table — DO NOT touch existing `bank_accounts` (recon) or `store_bank_accounts` (invoice display). Backward compat.
- Migration slot range: `20260720000001+` (after Phase 0a `20260715*`)
- All migrations applied via Supabase MCP `apply_migration` (project_id `ekhhojaezdfjfwuxyjkl`)
- Saldo + Riwayat read-only from journal_entry_lines (no business RPC wraps in this phase)
- Picker integration NOT included (Phase 0b deliverable)
- Sidebar: NEW "Kas & Bank" entry in **Operasional** group (owner daily-use), alongside Kasir + Piutang
- Design system match: lucide-react icons, rounded-full pill buttons, `border-[#c7d7f5] bg-[#fafbff]` sub-cards, `text-[#1e3d60]` primary
- TypeScript clean + vitest pass + npm run build clean per task commit

---

## Task 1: Test scaffolding

**Files:**
- Create: `tests/integration/akuntansi-phase1/_setup.ts` (copy from Phase 0a pattern)

- [ ] **Step 1: Copy Phase 0a `_setup.ts` to phase1 folder + adjust TEST_PREFIX**

Copy `tests/integration/akuntansi-phase0a/_setup.ts` to `tests/integration/akuntansi-phase1/_setup.ts`. Change `TEST_PREFIX` to `AKUNTANSI-P1-${Date.now()}`. Same supabaseAdmin client + setAuthUid helper.

- [ ] **Step 2: Verify TypeScript clean**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/akuntansi-phase1/_setup.ts
git commit -m "test(akuntansi): scaffold Phase 1 integration test setup"
```

---

## Task 2: `cash_accounts` table migration + Garindo seed

**Files:**
- Create: `supabase/migrations/20260720000001_cash_accounts_table.sql`
- Create: `tests/integration/akuntansi-phase1/cash-accounts-schema.test.ts`

**Schema:**

```sql
BEGIN;

CREATE TABLE public.cash_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type         text NOT NULL CHECK (account_type IN ('BANK','KAS','E_WALLET')),
  bank_code            text CHECK (account_type != 'BANK' OR bank_code IN ('BCA','MANDIRI','BRI','BNI','PERMATA','CIMB','OTHER')),
  account_number       text,
  account_holder       text,
  internal_label       text NOT NULL,
  provider             text,
  purpose              text NOT NULL DEFAULT 'OPERATIONAL' CHECK (purpose IN ('OPERATIONAL','OWNER_PERSONAL','SAVINGS','PETTY_CASH','OTHER')),
  show_in_invoice      boolean NOT NULL DEFAULT true,
  sort_order           int NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  opening_balance      numeric(15,2) NOT NULL DEFAULT 0,
  opening_balance_date date,
  coa_account_id       uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  tenant_id            uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Type-aware nullability
  CHECK ((account_type = 'BANK' AND account_number IS NOT NULL) OR account_type IN ('KAS','E_WALLET')),
  CHECK ((account_type = 'E_WALLET' AND provider IS NOT NULL) OR account_type IN ('BANK','KAS'))
);

CREATE INDEX idx_cash_accounts_type_active ON public.cash_accounts(account_type, is_active);
CREATE INDEX idx_cash_accounts_sort ON public.cash_accounts(sort_order) WHERE is_active = true;
CREATE INDEX idx_cash_accounts_coa ON public.cash_accounts(coa_account_id) WHERE coa_account_id IS NOT NULL;

ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read cash_accounts" ON public.cash_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "owners write cash_accounts" ON public.cash_accounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'));
CREATE POLICY "service_role bypass cash_accounts" ON public.cash_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER cash_accounts_set_updated_at BEFORE UPDATE ON public.cash_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed Garindo default: Kas Toko (linked to existing COA 1-1110)
INSERT INTO public.cash_accounts (account_type, internal_label, purpose, coa_account_id)
VALUES ('KAS', 'Kas Toko', 'PETTY_CASH', (SELECT id FROM chart_of_accounts WHERE account_code='1-1110'));

COMMIT;
```

- [ ] **Step 1: Write failing test** (table existence, CHECK constraints, default seed)

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('cash_accounts schema', () => {
  it('Garindo default Kas Toko seeded with COA link', async () => {
    const { data, error } = await supabaseAdmin
      .from('cash_accounts')
      .select('account_type, internal_label, coa_account_id, chart_of_accounts(account_code)')
      .eq('account_type', 'KAS')
      .eq('internal_label', 'Kas Toko')
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data as any).chart_of_accounts.account_code).toBe('1-1110');
  });

  it('rejects E_WALLET without provider', async () => {
    const { error } = await supabaseAdmin.from('cash_accounts').insert({
      account_type: 'E_WALLET', internal_label: 'Bad wallet'
    });
    expect(error).toBeTruthy();
  });
});
```

- [ ] **Step 2-3: Apply via MCP + verify via execute_sql**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(akuntansi): Phase 1 Task 2 — cash_accounts table + Garindo seed"
```

---

## Task 3: `cash_account_balances` view

**Files:**
- Create: `supabase/migrations/20260720000002_cash_account_balances_view.sql`
- Create: `tests/integration/akuntansi-phase1/cash-account-balances.test.ts`

View pattern (derived from journal_entry_lines via COA link):

```sql
CREATE OR REPLACE VIEW public.cash_account_balances AS
SELECT
  ca.id AS cash_account_id,
  ca.internal_label,
  ca.account_type,
  ca.purpose,
  ca.bank_code,
  ca.account_number,
  ca.account_holder,
  ca.provider,
  ca.sort_order,
  ca.is_active,
  ca.tenant_id,
  ca.opening_balance,
  COALESCE(SUM(CASE WHEN jel.status='CLEARED' AND jel.side='DEBIT' THEN jel.amount ELSE 0 END), 0) AS total_debit,
  COALESCE(SUM(CASE WHEN jel.status='CLEARED' AND jel.side='CREDIT' THEN jel.amount ELSE 0 END), 0) AS total_credit,
  COALESCE(SUM(CASE WHEN jel.status='PENDING' AND jel.side='DEBIT' THEN jel.amount ELSE 0 END), 0) AS pending_in,
  ca.opening_balance
    + COALESCE(SUM(CASE WHEN jel.status='CLEARED' AND jel.side='DEBIT' THEN jel.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN jel.status='CLEARED' AND jel.side='CREDIT' THEN jel.amount ELSE 0 END), 0) AS current_balance,
  MAX(je.entry_date) AS last_movement_date,
  COUNT(*) FILTER (WHERE je.entry_date >= date_trunc('month', now())) AS movements_this_month
FROM public.cash_accounts ca
LEFT JOIN public.journal_entry_lines jel ON jel.account_id = ca.coa_account_id
LEFT JOIN public.journal_entries je ON je.id = jel.entry_id AND je.is_posted = true
WHERE ca.is_active = true
GROUP BY ca.id, ca.internal_label, ca.account_type, ca.purpose, ca.bank_code, ca.account_number, ca.account_holder, ca.provider, ca.sort_order, ca.is_active, ca.tenant_id, ca.opening_balance;

GRANT SELECT ON public.cash_account_balances TO authenticated;
```

- Test: seed sample journal entry to Kas Toko via _post_journal_entry, query view, verify current_balance matches.

- [ ] **Commit:** `feat(akuntansi): Phase 1 Task 3 — cash_account_balances view`

---

## Task 4: TypeScript service module for Cash & Bank

**Files:**
- Create: `src/lib/kasbank/types.ts` — `CashAccount`, `CashAccountBalance` types
- Create: `src/lib/kasbank/service.ts` — `fetchCashAccounts()`, `fetchCashAccountBalances()`, `createCashAccount(input)`, `updateCashAccount(id, patch)`, `fetchAccountLedger(coaAccountId, fromDate, toDate)` (delegates to `fetchGeneralLedger` from akuntansi service)
- Create: `src/lib/kasbank/service.test.ts` — unit tests with mocked supabase

- [ ] **Commit:** `feat(akuntansi): Phase 1 Task 4 — TS service module for Cash & Bank`

---

## Task 5: `KasBankScreen` component (main page)

**Files:**
- Create: `src/components/kasbank/KasBankScreen.tsx`

Mockup reference: `phase1-cash-bank.html` section M1.

Structure:
- Header: total liquid (sum current_balance WHERE purpose != OWNER_PERSONAL) di gradient card emerald
- Group "Akun Bisnis" (purpose != OWNER_PERSONAL) — grid 2 cols, sub-card per akun with icon-tile + COA code + balance + mutasi count
- Group "Akun Pribadi" (purpose = OWNER_PERSONAL) — separate grid, dimmed style with Pribadi badge
- "+ Tambah Akun" button (Owner-only, opens AccountFormModal)
- Click card → navigate to AccountDetailScreen

Data source: `fetchCashAccountBalances()` (sorted by sort_order). Realtime: subscribe to journal_entry_lines + cash_accounts for auto-refresh.

- [ ] **Commit:** `feat(akuntansi): Phase 1 Task 5 — KasBankScreen main page`

---

## Task 6: `AccountDetailScreen` component (Riwayat tab)

**Files:**
- Create: `src/components/kasbank/AccountDetailScreen.tsx`

Mockup reference: `phase1-cash-bank.html` section M2.

Structure:
- Hero header: account label + COA code + 4 stat cards (saldo awal/total debit/total kredit/saldo akhir)
- Tabs: Riwayat (default) + Belum Cair (Phase 2 placeholder) + Info Akun
- Riwayat: filter periode + format akuntan table (tanggal/no.entry/keterangan/debit/kredit/saldo running/status)
- Data via `fetchAccountLedger(coa_account_id, from, to)` → uses `general_ledger` view (Phase 0a)

- [ ] **Commit:** `feat(akuntansi): Phase 1 Task 6 — AccountDetailScreen with running balance Riwayat`

---

## Task 7: `AccountFormModal` (CRUD)

**Files:**
- Create: `src/components/kasbank/AccountFormModal.tsx`

Mockup reference: `phase1-cash-bank.html` section M3.

Structure:
- 2 variants: BANK (bank_code + account_number + account_holder + show_in_invoice + bank-specific) + E_WALLET (provider + simpler) + KAS (just internal_label)
- account_type dropdown swaps form fields
- Auto-suggest COA: when creating, lookup `chart_of_accounts` for matching subtype (BANK→1-12NN, KAS→1-1110, E_WALLET→1-13NN). If new BANK/E_WALLET, generate next sub-COA code (consult Phase 0a Task 13 brief for pattern).
- Insert via Supabase client (RLS Owner-gated)

- [ ] **Commit:** `feat(akuntansi): Phase 1 Task 7 — AccountFormModal CRUD with COA auto-link`

---

## Task 8: Sidebar + routing wire-up

**Files:**
- Modify: `src/lib/urlRoute.ts` — add `'kasBank'` to ActivePage union
- Modify: `src/types.ts` — same union update
- Modify: `src/App.tsx` — `case 'kasBank'` route to `<KasBankScreen />`
- Modify: `src/components/Sidebar.tsx` — new entry "Kas & Bank" di **Operasional** group dengan lucide icon `Coins`, between Kasir + Piutang

- [ ] **Verify:** tsc clean + npm run build clean

- [ ] **Commit:** `feat(akuntansi): Phase 1 Task 8 — Kas & Bank sidebar + routing`

---

## Task 9: Final staging validation

- Smoke via MCP: query cash_account_balances, verify Kas Toko visible
- Smoke via npm run build
- Update `progress.md` with Phase 1 entry
- Commit `docs(progress): Phase 1 Cash & Bank UI complete`

---

## Self-Review

Spec coverage:
- ✓ Task 2-3: schema + view (data foundation)
- ✓ Task 4: TS service
- ✓ Task 5-7: 3 UI components per mockup
- ✓ Task 8: routing
- ✓ Task 9: validation

Decoupled scope:
- ✓ NEW cash_accounts (not touching bank_accounts/store_bank_accounts)
- ✓ No picker integration (Phase 0b)
- ✓ Read-only on Phase 0a journal_entry_lines

Estimated total: 4-6 hari (vs roadmap's 5-7 hari estimate).
