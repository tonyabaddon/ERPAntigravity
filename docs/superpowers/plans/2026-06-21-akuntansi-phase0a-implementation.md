# Akuntansi MSME — Phase 0a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build GL Schema Foundation — Chart of Accounts (50 SAK EMKM accounts), journal_entries + journal_entry_lines tables, double-entry validator, Trial Balance view, Opening Balance wizard, plus RPCs for posting/closing/tax-accrual/year-end. **No business RPC wraps** (deferred to Phase 0b/0c). No UI beyond Opening Balance Wizard.

**Architecture:** Write-through double-entry ledger. Every business event → 1 journal_entry header + N balanced journal_entry_lines via canonical `_post_journal_entry()` RPC. SECURITY DEFINER for write paths; deny-by-default RLS on tables. tenant_id NULL = global (multi-tenant future-proof). 50 SAK EMKM seed accounts; Garindo default `accounting_config` non-PKP + UMKM Final 0.5%.

**Tech Stack:** Supabase PostgreSQL (migrations applied via MCP `apply_migration`), PL/pgSQL RPCs (SECURITY DEFINER), Vitest integration tests (`tests/integration/akuntansi-phase0a/`), React + TypeScript + Tailwind (Opening Balance Wizard UI).

**Spec:** `docs/superpowers/specs/2026-06-21-akuntansi-phase0a-design.md` (rev3)
**Roadmap:** `docs/superpowers/specs/2026-06-21-kas-bank-gl-roadmap.md`
**Worktree:** Recommend `.claude/worktrees/akuntansi-phase0a` on branch `feat/akuntansi-phase0a`

## Global Constraints

- **SAK EMKM compliance** (Indonesian Standar Akuntansi Keuangan untuk UMKM). All 50 seed accounts ada di spec section 4.2 — copy verbatim.
- **Migration slot range:** `20260715000001+` (avoid collision dengan parallel work — latest migration in main is `20260630000008`).
- **All schema changes applied via Supabase MCP `apply_migration`** — NEVER run psql directly. MCP project_id: `ekhhojaezdfjfwuxyjkl`.
- **All RPCs SECURITY DEFINER + SET search_path = public + GRANT EXECUTE TO authenticated.**
- **All new tables ENABLE RLS** with deny-by-default for write, authenticated SELECT only. Write via RPC.
- **`tenant_id uuid NULL` on all new tables** (multi-tenant ready; NULL = global for Garindo).
- **Validator enforces** debit_total = credit_total per journal_entry (CHECK constraint + RPC body validation).
- **`is_system=true` accounts** cannot be edited/deleted via UI; only via migration.
- **Number generation:** `JE-YYYYMM-####` format (e.g., JE-202606-0001). Sequential per (tenant_id, month).
- **TypeScript clean** required at every commit: `npx tsc --noEmit`.
- **Vitest pass** required at every commit: `npx vitest run`.
- **No business RPC wraps** in this phase (Phase 0b/0c).
- **Opening Balance Wizard UI** is Owner-only — gated by `role='Owner' AND status='Aktif'`.
- **Acceptance criteria** per spec section 13 must all check before declaring Phase 0a complete.

---

## File Structure

### New SQL migrations (15 files)
- `supabase/migrations/20260715000001_chart_of_accounts_table.sql`
- `supabase/migrations/20260715000002_chart_of_accounts_seed.sql`
- `supabase/migrations/20260715000003_coa_parent_links_update.sql`
- `supabase/migrations/20260715000004_accounting_config_table.sql`
- `supabase/migrations/20260715000005_accounting_periods_table.sql`
- `supabase/migrations/20260715000006_journal_entries_table.sql`
- `supabase/migrations/20260715000007_journal_entry_lines_table.sql`
- `supabase/migrations/20260715000008_validators.sql`
- `supabase/migrations/20260715000009_post_journal_entry_rpc.sql`
- `supabase/migrations/20260715000010_period_close_rpcs.sql`
- `supabase/migrations/20260715000011_views.sql`
- `supabase/migrations/20260715000012_seed_coa_for_existing_cash_accounts.sql`
- `supabase/migrations/20260715000013_opening_balance_rpc.sql`
- `supabase/migrations/20260715000014_year_end_close_rpc.sql`
- `supabase/migrations/20260715000015_tax_accrual_rpc.sql`

### New integration tests (per-task TDD)
- `tests/integration/akuntansi-phase0a/coa-schema.test.ts`
- `tests/integration/akuntansi-phase0a/coa-seed.test.ts`
- `tests/integration/akuntansi-phase0a/accounting-config.test.ts`
- `tests/integration/akuntansi-phase0a/accounting-periods.test.ts`
- `tests/integration/akuntansi-phase0a/journal-entries-schema.test.ts`
- `tests/integration/akuntansi-phase0a/post-journal-entry-rpc.test.ts`
- `tests/integration/akuntansi-phase0a/period-close-rpc.test.ts`
- `tests/integration/akuntansi-phase0a/views.test.ts`
- `tests/integration/akuntansi-phase0a/coa-cash-accounts-link.test.ts`
- `tests/integration/akuntansi-phase0a/opening-balance-rpc.test.ts`
- `tests/integration/akuntansi-phase0a/year-end-close-rpc.test.ts`
- `tests/integration/akuntansi-phase0a/tax-accrual-rpc.test.ts`

### New TypeScript service module
- `src/lib/akuntansi/types.ts` — TypeScript types untuk COA, journal entries, accounting config
- `src/lib/akuntansi/service.ts` — Supabase client wrappers untuk RPCs
- `src/lib/akuntansi/service.test.ts` — unit tests

### New UI components (Opening Balance Wizard)
- `src/components/akuntansi/OpeningBalanceWizard.tsx` — 4-step wizard
- `src/components/akuntansi/OpeningBalanceWizard.test.tsx` — component tests
- `src/components/akuntansi/AkuntansiScreen.tsx` — landing screen yang gate ke wizard kalau opening_balance_set=false

### Routing + sidebar
- `src/App.tsx` — tambah `case 'akuntansi'`
- `src/lib/urlRoute.ts` — tambah `'akuntansi'` ke ActivePage union
- `src/components/Sidebar.tsx` — entry "Akuntansi" di group Keuangan

---

## Task 1: Test infrastructure scaffolding

**Files:**
- Create: `tests/integration/akuntansi-phase0a/_setup.ts`
- Create: `tests/integration/akuntansi-phase0a/.gitkeep`

**Interfaces:**
- Produces: `supabaseAdmin` client untuk integration tests, `withCleanup()` helper untuk auto-rollback test data, `TEST_PREFIX` constant (`AKUNTANSI-P0A-${Date.now()}`).

- [ ] **Step 1: Read existing integration test pattern**

Check `tests/integration/sales-recording.test.ts` and `tests/integration/phase2b-tf-rpcs.test.ts` for established pattern (dotenv loading, supabase client, cleanup pattern).

- [ ] **Step 2: Create test setup file**

Create `tests/integration/akuntansi-phase0a/_setup.ts`:

```typescript
// Shared test setup untuk Akuntansi Phase 0a integration tests
import { loadEnv } from 'vite';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const env = loadEnv('test', process.cwd(), '');

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY required for integration tests');
}

export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

export const TEST_PREFIX = `AKUNTANSI-P0A-${Date.now()}`;

/** Set auth.uid for SECURITY DEFINER RPC testing. Pass null to clear. */
export async function setAuthUid(uid: string | null): Promise<void> {
  if (uid === null) {
    await supabaseAdmin.rpc('set_config' as any, { key: 'request.jwt.claim.sub', value: '', is_local: true });
  } else {
    await supabaseAdmin.rpc('set_config' as any, { key: 'request.jwt.claim.sub', value: uid, is_local: true });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/akuntansi-phase0a/_setup.ts
git commit -m "test(akuntansi): scaffold Phase 0a integration test setup"
```

---

## Task 2: `chart_of_accounts` table

**Files:**
- Create: `supabase/migrations/20260715000001_chart_of_accounts_table.sql`
- Create: `tests/integration/akuntansi-phase0a/coa-schema.test.ts`

**Interfaces:**
- Produces: Table `public.chart_of_accounts` dengan kolom (id, account_code, account_name, account_type CHECK IN 5 kelompok, account_subtype, parent_id self-FK, is_control_account, normal_balance CHECK IN DEBIT/CREDIT, is_active, is_system, description, tenant_id, created_at, updated_at). UNIQUE(tenant_id, account_code). RLS enabled. Updated_at trigger.

- [ ] **Step 1: Write failing test**

Create `tests/integration/akuntansi-phase0a/coa-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('chart_of_accounts table schema', () => {
  it('table exists', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
  });

  it('rejects invalid account_type', async () => {
    const { error } = await supabaseAdmin
      .from('chart_of_accounts')
      .insert({
        account_code: 'TEST-1',
        account_name: 'Test',
        account_type: 'INVALID_TYPE',
        normal_balance: 'DEBIT',
      });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/account_type/i);
  });

  it('rejects invalid normal_balance', async () => {
    const { error } = await supabaseAdmin
      .from('chart_of_accounts')
      .insert({
        account_code: 'TEST-2',
        account_name: 'Test',
        account_type: 'ASET',
        normal_balance: 'INVALID',
      });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/normal_balance/i);
  });

  it('UNIQUE (tenant_id, account_code) enforced', async () => {
    // Insert first row
    const { error: e1 } = await supabaseAdmin
      .from('chart_of_accounts')
      .insert({
        account_code: 'TEST-UNIQ-1',
        account_name: 'Test Uniq',
        account_type: 'ASET',
        normal_balance: 'DEBIT',
      });
    expect(e1).toBeNull();

    // Duplicate should fail
    const { error: e2 } = await supabaseAdmin
      .from('chart_of_accounts')
      .insert({
        account_code: 'TEST-UNIQ-1',
        account_name: 'Test Uniq 2',
        account_type: 'ASET',
        normal_balance: 'DEBIT',
      });
    expect(e2).toBeTruthy();
    expect(e2!.message).toMatch(/duplicate|unique/i);

    // Cleanup
    await supabaseAdmin.from('chart_of_accounts').delete().eq('account_code', 'TEST-UNIQ-1');
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

```bash
npx vitest run tests/integration/akuntansi-phase0a/coa-schema.test.ts
```

Expected: FAIL (table doesn't exist).

- [ ] **Step 3: Write migration SQL**

Create `supabase/migrations/20260715000001_chart_of_accounts_table.sql`:

```sql
-- Phase 0a: Chart of Accounts table foundation for SAK EMKM accounting
BEGIN;

CREATE TABLE public.chart_of_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code        text NOT NULL,
  account_name        text NOT NULL,
  account_type        text NOT NULL CHECK (account_type IN (
    'ASET','LIABILITAS','MODAL','PENDAPATAN','BEBAN'
  )),
  account_subtype     text,
  parent_id           uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  is_control_account  boolean NOT NULL DEFAULT false,
  normal_balance      text NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
  is_active           boolean NOT NULL DEFAULT true,
  is_system           boolean NOT NULL DEFAULT false,
  description         text,
  tenant_id           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_code)
);

CREATE INDEX idx_coa_type_active ON public.chart_of_accounts(account_type, is_active);
CREATE INDEX idx_coa_subtype ON public.chart_of_accounts(account_subtype) WHERE is_active = true;
CREATE INDEX idx_coa_parent ON public.chart_of_accounts(parent_id);
CREATE INDEX idx_coa_tenant ON public.chart_of_accounts(tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read coa" ON public.chart_of_accounts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "owners write coa" ON public.chart_of_accounts FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ));

CREATE TRIGGER coa_set_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
```

- [ ] **Step 4: Apply migration via Supabase MCP**

Use MCP `mcp__plugin_supabase_supabase__apply_migration`:
- project_id: `ekhhojaezdfjfwuxyjkl`
- name: `chart_of_accounts_table`
- query: contents of the migration file above

Expected: `{"success": true}`.

- [ ] **Step 5: Run test to verify PASS**

```bash
npx vitest run tests/integration/akuntansi-phase0a/coa-schema.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715000001_chart_of_accounts_table.sql tests/integration/akuntansi-phase0a/coa-schema.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 2 — chart_of_accounts table + RLS + tests"
```

---

## Task 3: COA seed (50 SAK EMKM accounts)

**Files:**
- Create: `supabase/migrations/20260715000002_chart_of_accounts_seed.sql`
- Create: `tests/integration/akuntansi-phase0a/coa-seed.test.ts`

**Interfaces:**
- Produces: 50 system accounts seeded di `chart_of_accounts` dengan `is_system=true`. Codes follow `K-CCSS` format (kelompok-categorysub).

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('SAK EMKM COA seed', () => {
  it('seeds at least 45 system accounts', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code, account_type, is_system')
      .eq('is_system', true);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(45);
  });

  it('all 5 kelompok represented (Aset, Liab, Modal, Pendapatan, Beban)', async () => {
    const { data } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_type')
      .eq('is_system', true);
    const types = new Set(data!.map(r => r.account_type));
    expect(types.has('ASET')).toBe(true);
    expect(types.has('LIABILITAS')).toBe(true);
    expect(types.has('MODAL')).toBe(true);
    expect(types.has('PENDAPATAN')).toBe(true);
    expect(types.has('BEBAN')).toBe(true);
  });

  it('includes rev3 critical accounts (2-1500 DP, 3-1900 Ikhtisar, 5-1100 HPP, 4-1230 Untung Opname, 5-3150 Rugi Opname)', async () => {
    const requiredCodes = ['2-1500', '3-1900', '5-1100', '4-1230', '5-3150', '5-3300', '2-1210', '3-1200'];
    const { data } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code')
      .in('account_code', requiredCodes);
    expect(data!.length).toBe(requiredCodes.length);
  });

  it('normal_balance correct per kelompok (sample check)', async () => {
    const { data } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code, account_type, normal_balance')
      .in('account_code', ['1-1110', '2-1100', '3-1100', '4-1110', '5-2100', '3-1200']);
    const map = Object.fromEntries(data!.map(r => [r.account_code, r.normal_balance]));
    expect(map['1-1110']).toBe('DEBIT');   // Aset = Debit
    expect(map['2-1100']).toBe('CREDIT');  // Liabilitas = Credit
    expect(map['3-1100']).toBe('CREDIT');  // Modal = Credit
    expect(map['4-1110']).toBe('CREDIT');  // Pendapatan = Credit
    expect(map['5-2100']).toBe('DEBIT');   // Beban = Debit
    expect(map['3-1200']).toBe('DEBIT');   // Prive = Debit (contra-equity)
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

```bash
npx vitest run tests/integration/akuntansi-phase0a/coa-seed.test.ts
```

Expected: FAIL (0 system accounts).

- [ ] **Step 3: Write seed migration**

Create `supabase/migrations/20260715000002_chart_of_accounts_seed.sql` — copy verbatim from spec rev3 section 4.2 INSERT block (50 accounts, wrap in BEGIN/COMMIT).

- [ ] **Step 4: Apply migration via MCP**

Use `apply_migration` name: `chart_of_accounts_seed`.

- [ ] **Step 5: Run test to verify PASS**

```bash
npx vitest run tests/integration/akuntansi-phase0a/coa-seed.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715000002_chart_of_accounts_seed.sql tests/integration/akuntansi-phase0a/coa-seed.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 3 — seed 50 SAK EMKM standard accounts"
```

---

## Task 4: COA parent_id links update

**Files:**
- Create: `supabase/migrations/20260715000003_coa_parent_links_update.sql`
- Modify: `tests/integration/akuntansi-phase0a/coa-seed.test.ts` (tambah parent test)

- [ ] **Step 1: Add parent test to existing file**

Tambah test ke `coa-seed.test.ts`:

```typescript
it('parent_id links resolved (sample: 1-1110 parent = 1-1100, 4-1110 parent = 4-1100)', async () => {
  const { data } = await supabaseAdmin
    .from('chart_of_accounts')
    .select('account_code, parent_id, parent:parent_id(account_code)')
    .in('account_code', ['1-1110', '4-1110', '5-2100']);

  const map = Object.fromEntries(data!.map((r: any) => [r.account_code, r.parent?.account_code]));
  expect(map['1-1110']).toBe('1-1100');   // Kas Toko → Kas
  expect(map['4-1110']).toBe('4-1100');   // Penjualan Walkin → Penjualan
  expect(map['5-2100']).toBe('5-2000');   // Beban Gaji → Beban Operasional
});
```

- [ ] **Step 2: Run test to verify FAIL**

Expected: parent_id NULL, test fails.

- [ ] **Step 3: Write update migration**

Create `supabase/migrations/20260715000003_coa_parent_links_update.sql`:

```sql
-- Phase 0a: Resolve parent_id links setelah COA seed
BEGIN;

-- Aset Lancar children
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1-1100')
  WHERE account_code IN ('1-1110');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1-1500')
  WHERE account_code IN ('1-1510','1-1520');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1-1000')
  WHERE account_code IN ('1-1100','1-1200','1-1300','1-1400','1-1450','1-1500');

-- Aset Tetap
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1-2000')
  WHERE account_code IN ('1-2100','1-2200','1-2900');

-- Liabilitas Lancar
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2-1200')
  WHERE account_code IN ('2-1210','2-1220');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2-1000')
  WHERE account_code IN ('2-1100','2-1200','2-1300','2-1400','2-1500');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2-2000')
  WHERE account_code IN ('2-2100');

-- Modal
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '3-1000')
  WHERE account_code IN ('3-1100','3-1200','3-1300','3-1400','3-1900');

-- Pendapatan
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '4-1100')
  WHERE account_code IN ('4-1110','4-1120','4-1130','4-1140');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '4-1200')
  WHERE account_code IN ('4-1210','4-1220','4-1230');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '4-1000')
  WHERE account_code IN ('4-1100','4-1200','4-1900');

-- Beban
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5-1000')
  WHERE account_code IN ('5-1100');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5-2000')
  WHERE account_code IN ('5-2100','5-2200','5-2300','5-2400','5-2500','5-2600','5-2700','5-2800','5-2900','5-2950');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5-3000')
  WHERE account_code IN ('5-3100','5-3150','5-3200','5-3300');

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `coa_parent_links_update`**

- [ ] **Step 5: Run test to verify PASS**

```bash
npx vitest run tests/integration/akuntansi-phase0a/coa-seed.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715000003_coa_parent_links_update.sql tests/integration/akuntansi-phase0a/coa-seed.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 4 — COA parent_id hierarchy resolved"
```

---

## Task 5: `accounting_config` table + Garindo seed

**Files:**
- Create: `supabase/migrations/20260715000004_accounting_config_table.sql`
- Create: `tests/integration/akuntansi-phase0a/accounting-config.test.ts`

**Interfaces:**
- Produces: `public.accounting_config` table dengan kolom (id, tenant_id UNIQUE, ppn_mode, ppn_rate_pct, pph_mode, pph_rate_pct, fiscal_year_start_month, enable_dual_write_to_gl, enable_strict_period_close, opening_balance_set, opening_balance_date, auto_accrue_pph_monthly, auto_accrue_ppn_monthly, timestamps). Seed Garindo (tenant_id=NULL) dengan non-PKP + UMKM Final + 0.5%.

- [ ] **Step 1: Write failing test**

Create `tests/integration/akuntansi-phase0a/accounting-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('accounting_config table + Garindo seed', () => {
  it('Garindo default config exists with tenant_id NULL', async () => {
    const { data, error } = await supabaseAdmin
      .from('accounting_config')
      .select('*')
      .is('tenant_id', null)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.ppn_mode).toBe('NON_PKP');
    expect(data!.pph_mode).toBe('UMKM_FINAL_0_5');
    expect(Number(data!.pph_rate_pct)).toBe(0.5);
    expect(data!.opening_balance_set).toBe(false);
    expect(data!.enable_dual_write_to_gl).toBe(false);
    expect(data!.auto_accrue_pph_monthly).toBe(true);
    expect(data!.fiscal_year_start_month).toBe(1);
  });

  it('rejects invalid ppn_mode', async () => {
    const { error } = await supabaseAdmin
      .from('accounting_config')
      .insert({ ppn_mode: 'INVALID', pph_mode: 'UMKM_FINAL_0_5' });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/ppn_mode/i);
  });

  it('rejects invalid pph_mode', async () => {
    const { error } = await supabaseAdmin
      .from('accounting_config')
      .insert({ ppn_mode: 'NON_PKP', pph_mode: 'INVALID' });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/pph_mode/i);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

- [ ] **Step 3: Write migration SQL**

Create `supabase/migrations/20260715000004_accounting_config_table.sql`:

```sql
BEGIN;

CREATE TABLE public.accounting_config (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid UNIQUE,
  ppn_mode                    text NOT NULL DEFAULT 'NON_PKP'
    CHECK (ppn_mode IN ('NON_PKP','PKP')),
  ppn_rate_pct                numeric(5,2) NOT NULL DEFAULT 11.0,
  pph_mode                    text NOT NULL DEFAULT 'UMKM_FINAL_0_5'
    CHECK (pph_mode IN ('UMKM_FINAL_0_5','BADAN_NORMAL_25','BADAN_NORMAL_22','MANUAL')),
  pph_rate_pct                numeric(5,2),
  fiscal_year_start_month     int NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  enable_dual_write_to_gl     boolean NOT NULL DEFAULT false,
  enable_strict_period_close  boolean NOT NULL DEFAULT false,
  opening_balance_set         boolean NOT NULL DEFAULT false,
  opening_balance_date        date,
  auto_accrue_pph_monthly     boolean NOT NULL DEFAULT true,
  auto_accrue_ppn_monthly     boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read config" ON public.accounting_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "owners write config" ON public.accounting_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'));

CREATE TRIGGER accounting_config_set_updated_at
  BEFORE UPDATE ON public.accounting_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed Garindo default
INSERT INTO public.accounting_config (
  tenant_id, ppn_mode, pph_mode, pph_rate_pct,
  enable_dual_write_to_gl, opening_balance_set
) VALUES (
  NULL, 'NON_PKP', 'UMKM_FINAL_0_5', 0.5, false, false
);

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `accounting_config_table`**

- [ ] **Step 5: Run test PASS, commit**

```bash
git add supabase/migrations/20260715000004_accounting_config_table.sql tests/integration/akuntansi-phase0a/accounting-config.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 5 — accounting_config table + Garindo seed (non-PKP + UMKM Final)"
```

---

## Task 6: `accounting_periods` table + historical seed

**Files:**
- Create: `supabase/migrations/20260715000005_accounting_periods_table.sql`
- Create: `tests/integration/akuntansi-phase0a/accounting-periods.test.ts`

**Interfaces:**
- Produces: `public.accounting_periods` (id, tenant_id, period_year, period_month, status enum OPEN/CLOSED/REOPENED, closed_at, closed_by, reopened_at, reopened_by, reopen_reason, notes, created_at). UNIQUE (tenant_id, year, month). Seed: 19 periods Juni 2025 → Des 2026 status OPEN.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('accounting_periods table + historical seed', () => {
  it('seeded periods from Juni 2025 to Des 2026 (19 periods)', async () => {
    const { data, error } = await supabaseAdmin
      .from('accounting_periods')
      .select('period_year, period_month, status')
      .is('tenant_id', null)
      .order('period_year', { ascending: true })
      .order('period_month', { ascending: true });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(19);

    // Spot check
    const first = data![0];
    expect(first.period_year).toBe(2025);
    expect(first.period_month).toBe(6);
    expect(first.status).toBe('OPEN');
  });

  it('rejects invalid period_month', async () => {
    const { error } = await supabaseAdmin
      .from('accounting_periods')
      .insert({ period_year: 2026, period_month: 13, status: 'OPEN' });
    expect(error).toBeTruthy();
  });

  it('UNIQUE (tenant_id, period_year, period_month) enforced', async () => {
    // Juni 2025 already exists from seed
    const { error } = await supabaseAdmin
      .from('accounting_periods')
      .insert({ period_year: 2025, period_month: 6, status: 'OPEN' });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/duplicate|unique/i);
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260715000005_accounting_periods_table.sql`:

```sql
BEGIN;

CREATE TABLE public.accounting_periods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid,
  period_year         int NOT NULL,
  period_month        int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status              text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CLOSED','REOPENED')),
  closed_at           timestamptz,
  closed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_at         timestamptz,
  reopened_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopen_reason       text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_year, period_month)
);

CREATE INDEX idx_periods_status ON public.accounting_periods(status, period_year, period_month);
CREATE INDEX idx_periods_tenant ON public.accounting_periods(tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read periods" ON public.accounting_periods
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "owners write periods" ON public.accounting_periods FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'));

-- Seed historical OPEN periods Juni 2025 - Des 2026
INSERT INTO public.accounting_periods (tenant_id, period_year, period_month, status)
SELECT NULL, y, m, 'OPEN'
FROM (
  SELECT 2025 AS y, m FROM generate_series(6, 12) m
  UNION ALL
  SELECT 2026 AS y, m FROM generate_series(1, 12) m
) AS periods;

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `accounting_periods_table`**

- [ ] **Step 5: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000005_accounting_periods_table.sql tests/integration/akuntansi-phase0a/accounting-periods.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 6 — accounting_periods table + Juni 2025-Des 2026 seed"
```

---

## Task 7: `journal_entries` table + source enum

**Files:**
- Create: `supabase/migrations/20260715000006_journal_entries_table.sql`
- Create: `tests/integration/akuntansi-phase0a/journal-entries-schema.test.ts`

**Interfaces:**
- Produces: `journal_entry_source` enum (24 values per spec rev3), `public.journal_entries` table dengan CHECK total_debit = total_credit, generated `is_balanced` column, indexes, RLS (read-only via authenticated).

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('journal_entries table schema', () => {
  it('table exists', async () => {
    const { error } = await supabaseAdmin.from('journal_entries').select('id').limit(1);
    expect(error).toBeNull();
  });

  it('rejects unbalanced entries via CHECK', async () => {
    const { error } = await supabaseAdmin.from('journal_entries').insert({
      entry_number: 'TEST-UNBAL-1',
      entry_date: '2026-06-15',
      source_type: 'BACKFILL',
      description: 'test unbalanced',
      total_debit: 100,
      total_credit: 50,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/check|debit|credit/i);
  });

  it('UNIQUE (tenant_id, entry_number) enforced', async () => {
    await supabaseAdmin.from('journal_entries').insert({
      entry_number: 'TEST-UNIQ',
      entry_date: '2026-06-15',
      source_type: 'BACKFILL',
      description: 'first',
      total_debit: 100,
      total_credit: 100,
    });

    const { error } = await supabaseAdmin.from('journal_entries').insert({
      entry_number: 'TEST-UNIQ',
      entry_date: '2026-06-16',
      source_type: 'BACKFILL',
      description: 'duplicate',
      total_debit: 200,
      total_credit: 200,
    });
    expect(error).toBeTruthy();

    // Cleanup
    await supabaseAdmin.from('journal_entries').delete().eq('entry_number', 'TEST-UNIQ');
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260715000006_journal_entries_table.sql`:

```sql
BEGIN;

CREATE TYPE public.journal_entry_source AS ENUM (
  'KASIR_SALE',
  'PEMBAYARAN',
  'PIUTANG_PAYMENT',
  'KASIR_EXPENSE',
  'PI_TAGIHAN',
  'PI_RECEIVE_GOODS',
  'WALKIN_PAYMENT',
  'TEMPO_WRITEOFF',
  'CASH_DEPOSIT_BATCH',
  'MANUAL_TRANSFER',
  'OWNER_DRAWING',
  'OWNER_TOPUP',
  'WALLET_TOPUP',
  'WALLET_SPEND',
  'ADJUSTMENT',
  'OPENING_BALANCE',
  'BACKFILL',
  'PERIOD_CLOSE',
  'YEAR_END_CLOSE',
  'HPP_RECOGNITION',
  'TAX_ACCRUAL_PPH',
  'TAX_ACCRUAL_PPN',
  'STOCK_OPNAME_ADJ',
  'DP_RECEIVE',
  'DP_RECOGNIZE',
  'DP_REFUND'
);

CREATE TABLE public.journal_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number          text NOT NULL,
  entry_date            date NOT NULL,
  posted_at             timestamptz NOT NULL DEFAULT now(),
  source_type           public.journal_entry_source NOT NULL,
  source_ref_table      text,
  source_ref_id         uuid,
  description           text NOT NULL,
  total_debit           numeric(15,2) NOT NULL CHECK (total_debit >= 0),
  total_credit          numeric(15,2) NOT NULL CHECK (total_credit >= 0),
  is_balanced           boolean GENERATED ALWAYS AS (total_debit = total_credit) STORED,
  is_posted             boolean NOT NULL DEFAULT true,
  posted_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_by_entry_id  uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  reverses_entry_id     uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes                 text,
  tenant_id             uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entry_number),
  CHECK (total_debit = total_credit)
);

CREATE INDEX idx_je_entry_date ON public.journal_entries(entry_date DESC);
CREATE INDEX idx_je_source ON public.journal_entries(source_type, source_ref_table, source_ref_id);
CREATE INDEX idx_je_tenant_period ON public.journal_entries(tenant_id, entry_date) WHERE is_posted = true;
CREATE UNIQUE INDEX uq_je_source_unique ON public.journal_entries(source_type, source_ref_table, source_ref_id)
  WHERE source_ref_id IS NOT NULL AND reverses_entry_id IS NULL;

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read je" ON public.journal_entries
  FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE: only via SECURITY DEFINER RPC _post_journal_entry

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `journal_entries_table`**

- [ ] **Step 5: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000006_journal_entries_table.sql tests/integration/akuntansi-phase0a/journal-entries-schema.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 7 — journal_entries table + 26-value source enum + RLS"
```

---

## Task 8: `journal_entry_lines` table

**Files:**
- Create: `supabase/migrations/20260715000007_journal_entry_lines_table.sql`
- Modify: `tests/integration/akuntansi-phase0a/journal-entries-schema.test.ts` (extend)

**Interfaces:**
- Produces: `public.journal_entry_lines` table dengan kolom (id, entry_id FK, line_number, account_id FK COA, side CHECK DEBIT/CREDIT, amount > 0, description, counterparty_type, counterparty_id, status PENDING/CLEARED, cleared_at, reconciled_at, bank_line_id, tenant_id, created_at). UNIQUE (entry_id, line_number). Indexes for performance.

- [ ] **Step 1: Add test to existing file**

```typescript
it('journal_entry_lines table exists', async () => {
  const { error } = await supabaseAdmin.from('journal_entry_lines').select('id').limit(1);
  expect(error).toBeNull();
});

it('CHECK amount > 0 enforced', async () => {
  // Insert dummy entry first
  const { data: entry } = await supabaseAdmin.from('journal_entries').insert({
    entry_number: 'TEST-LINE-CHECK',
    entry_date: '2026-06-15',
    source_type: 'BACKFILL',
    description: 'test',
    total_debit: 100,
    total_credit: 100,
  }).select().single();

  const { data: kasAcc } = await supabaseAdmin.from('chart_of_accounts')
    .select('id').eq('account_code', '1-1110').single();

  const { error } = await supabaseAdmin.from('journal_entry_lines').insert({
    entry_id: entry!.id,
    line_number: 1,
    account_id: kasAcc!.id,
    side: 'DEBIT',
    amount: 0,  // invalid
  });
  expect(error).toBeTruthy();
  expect(error!.message).toMatch(/check|amount/i);

  await supabaseAdmin.from('journal_entries').delete().eq('id', entry!.id);
});

it('CASCADE delete from journal_entries removes lines', async () => {
  const { data: entry } = await supabaseAdmin.from('journal_entries').insert({
    entry_number: 'TEST-CASCADE',
    entry_date: '2026-06-15',
    source_type: 'BACKFILL',
    description: 'test cascade',
    total_debit: 100,
    total_credit: 100,
  }).select().single();

  const { data: kasAcc } = await supabaseAdmin.from('chart_of_accounts')
    .select('id').eq('account_code', '1-1110').single();
  const { data: pendAcc } = await supabaseAdmin.from('chart_of_accounts')
    .select('id').eq('account_code', '4-1110').single();

  await supabaseAdmin.from('journal_entry_lines').insert([
    { entry_id: entry!.id, line_number: 1, account_id: kasAcc!.id, side: 'DEBIT', amount: 100 },
    { entry_id: entry!.id, line_number: 2, account_id: pendAcc!.id, side: 'CREDIT', amount: 100 },
  ]);

  await supabaseAdmin.from('journal_entries').delete().eq('id', entry!.id);

  const { data: orphans } = await supabaseAdmin.from('journal_entry_lines')
    .select('id').eq('entry_id', entry!.id);
  expect(orphans!.length).toBe(0);
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260715000007_journal_entry_lines_table.sql`:

```sql
BEGIN;

CREATE TABLE public.journal_entry_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id            uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  line_number         int NOT NULL,
  account_id          uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  side                text NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  amount              numeric(15,2) NOT NULL CHECK (amount > 0),
  description         text,
  counterparty_type   text CHECK (counterparty_type IN ('CUSTOMER','SUPPLIER','OWNER','INTERNAL','TAX','OTHER')),
  counterparty_id     uuid,
  status              text NOT NULL DEFAULT 'CLEARED'
    CHECK (status IN ('CLEARED','PENDING')),
  cleared_at          timestamptz,
  reconciled_at       timestamptz,
  bank_line_id        uuid,
  tenant_id           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, line_number)
);

CREATE INDEX idx_jel_account_date ON public.journal_entry_lines(account_id, created_at DESC);
CREATE INDEX idx_jel_entry ON public.journal_entry_lines(entry_id);
CREATE INDEX idx_jel_counterparty ON public.journal_entry_lines(counterparty_type, counterparty_id)
  WHERE counterparty_id IS NOT NULL;
CREATE INDEX idx_jel_status ON public.journal_entry_lines(status) WHERE status = 'PENDING';
CREATE INDEX idx_jel_reconciled ON public.journal_entry_lines(account_id, reconciled_at)
  WHERE reconciled_at IS NULL;
CREATE INDEX idx_jel_tenant ON public.journal_entry_lines(tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read jel" ON public.journal_entry_lines
  FOR SELECT TO authenticated USING (true);

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `journal_entry_lines_table`**

- [ ] **Step 5: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000007_journal_entry_lines_table.sql tests/integration/akuntansi-phase0a/journal-entries-schema.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 8 — journal_entry_lines table + RLS"
```

---

## Task 9: Validators (helper PL/pgSQL functions)

**Files:**
- Create: `supabase/migrations/20260715000008_validators.sql`

**Interfaces:**
- Produces:
  - `public._validate_journal_entry_balanced(p_entry_id uuid) RETURNS boolean` — checks SUM(debit lines) = SUM(credit lines) for an entry.
  - `public._check_period_open(p_entry_date date, p_tenant_id uuid DEFAULT NULL) RETURNS boolean` — returns true if period not locked (or strict_close disabled).

- [ ] **Step 1: Write migration**

Create `supabase/migrations/20260715000008_validators.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public._validate_journal_entry_balanced(p_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_debit numeric;
  v_total_credit numeric;
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE side = 'DEBIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE side = 'CREDIT'), 0)
  INTO v_total_debit, v_total_credit
  FROM public.journal_entry_lines
  WHERE entry_id = p_entry_id;

  RETURN v_total_debit = v_total_credit AND v_total_debit > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public._check_period_open(
  p_entry_date date,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_period_status text;
  v_strict_close boolean;
BEGIN
  SELECT enable_strict_period_close INTO v_strict_close
  FROM public.accounting_config
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  -- Strict mode disabled? Always allow.
  IF NOT COALESCE(v_strict_close, false) THEN
    RETURN true;
  END IF;

  SELECT status INTO v_period_status
  FROM public.accounting_periods
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND period_year = EXTRACT(YEAR FROM p_entry_date)::int
    AND period_month = EXTRACT(MONTH FROM p_entry_date)::int;

  -- Period not initialized → allow (period will be auto-created by _post_journal_entry)
  RETURN COALESCE(v_period_status, 'OPEN') IN ('OPEN', 'REOPENED');
END;
$$;

GRANT EXECUTE ON FUNCTION public._validate_journal_entry_balanced(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._check_period_open(date, uuid) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Apply via MCP, name `validators`**

- [ ] **Step 3: Commit (no separate test — exercised via Task 10 RPC test)**

```bash
git add supabase/migrations/20260715000008_validators.sql
git commit -m "feat(akuntansi): Phase 0a Task 9 — validator helpers (_validate_balanced, _check_period_open)"
```

---

## Task 10: `_post_journal_entry` canonical RPC

**Files:**
- Create: `supabase/migrations/20260715000009_post_journal_entry_rpc.sql`
- Create: `tests/integration/akuntansi-phase0a/post-journal-entry-rpc.test.ts`

**Interfaces:**
- Produces: `public._post_journal_entry(p_entry_date, p_source_type, p_source_ref_table?, p_source_ref_id?, p_description, p_lines jsonb, p_tenant_id?, p_reverses_entry_id?) RETURNS jsonb`. Validates balance + period + account existence; auto-creates period if missing; generates entry_number `JE-YYYYMM-####`.

- [ ] **Step 1: Write failing test**

Create `tests/integration/akuntansi-phase0a/post-journal-entry-rpc.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('_post_journal_entry RPC', () => {
  it('posts a balanced 2-line entry successfully', async () => {
    const { data, error } = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_source_ref_table: 'test',
      p_source_ref_id: crypto.randomUUID(),
      p_description: 'test balanced entry',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 100000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 100000 },
      ],
      p_tenant_id: null,
      p_reverses_entry_id: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });
    expect(data!.entry_id).toBeDefined();
    expect(data!.entry_number).toMatch(/^JE-202606-\d{4}$/);

    // Verify entry posted with 2 lines
    const { data: entry } = await supabaseAdmin
      .from('journal_entries')
      .select('*, journal_entry_lines(*)')
      .eq('id', data!.entry_id)
      .single();
    expect(entry!.total_debit).toBe('100000.00');
    expect(entry!.total_credit).toBe('100000.00');
    expect(entry!.journal_entry_lines.length).toBe(2);

    await supabaseAdmin.from('journal_entries').delete().eq('id', data!.entry_id);
  });

  it('rejects unbalanced entry', async () => {
    const { data, error } = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_description: 'unbalanced',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 100000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 50000 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/unbalanced/i);
  });

  it('rejects entry with invalid account_code', async () => {
    const { error } = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_description: 'bad acc',
      p_lines: [
        { account_code: '9-9999', side: 'DEBIT', amount: 100 },
        { account_code: '4-1110', side: 'CREDIT', amount: 100 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/account_not_found/i);
  });

  it('auto-creates period when missing', async () => {
    // Use future date with no period
    const { data, error } = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2027-03-15',
      p_source_type: 'BACKFILL',
      p_description: 'future period',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 1 },
        { account_code: '4-1110', side: 'CREDIT', amount: 1 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeNull();

    const { data: period } = await supabaseAdmin
      .from('accounting_periods')
      .select('*')
      .is('tenant_id', null)
      .eq('period_year', 2027)
      .eq('period_month', 3)
      .maybeSingle();
    expect(period).not.toBeNull();

    // Cleanup
    await supabaseAdmin.from('journal_entries').delete().eq('id', data!.entry_id);
    await supabaseAdmin.from('accounting_periods').delete().eq('id', period!.id);
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260715000009_post_journal_entry_rpc.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public._post_journal_entry(
  p_entry_date date,
  p_source_type public.journal_entry_source,
  p_description text,
  p_lines jsonb,
  p_source_ref_table text DEFAULT NULL,
  p_source_ref_id uuid DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL,
  p_reverses_entry_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line jsonb;
  v_line_number int := 0;
  v_account_id uuid;
  v_year int;
  v_month int;
BEGIN
  v_year := EXTRACT(YEAR FROM p_entry_date)::int;
  v_month := EXTRACT(MONTH FROM p_entry_date)::int;

  -- 1. Auto-create period if missing
  INSERT INTO accounting_periods (tenant_id, period_year, period_month, status)
  VALUES (p_tenant_id, v_year, v_month, 'OPEN')
  ON CONFLICT (tenant_id, period_year, period_month) DO NOTHING;

  -- 2. Validate period open
  IF NOT _check_period_open(p_entry_date, p_tenant_id) THEN
    RAISE EXCEPTION 'period_closed: cannot post entry to closed period for date %', p_entry_date;
  END IF;

  -- 3. Validate balanced
  SELECT
    COALESCE(SUM(CASE WHEN (l->>'side') = 'DEBIT' THEN (l->>'amount')::numeric ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (l->>'side') = 'CREDIT' THEN (l->>'amount')::numeric ELSE 0 END), 0)
  INTO v_total_debit, v_total_credit
  FROM jsonb_array_elements(p_lines) AS arr(l);

  IF v_total_debit IS DISTINCT FROM v_total_credit OR v_total_debit <= 0 THEN
    RAISE EXCEPTION 'unbalanced_entry: debit=% credit=%', v_total_debit, v_total_credit;
  END IF;

  -- 4. Generate entry number
  SELECT 'JE-' || to_char(p_entry_date, 'YYYYMM') || '-' ||
    LPAD((COALESCE(
      (SELECT MAX(NULLIF(SUBSTRING(entry_number FROM 'JE-\d{6}-(\d+)$'), '')::int)
       FROM journal_entries
       WHERE entry_number LIKE 'JE-' || to_char(p_entry_date, 'YYYYMM') || '-%'
         AND COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ), 0) + 1)::text, 4, '0')
  INTO v_entry_number;

  -- 5. Insert entry header
  INSERT INTO journal_entries (
    entry_number, entry_date, source_type, source_ref_table, source_ref_id,
    description, total_debit, total_credit, posted_by, reverses_entry_id, tenant_id
  ) VALUES (
    v_entry_number, p_entry_date, p_source_type, p_source_ref_table, p_source_ref_id,
    p_description, v_total_debit, v_total_credit, auth.uid(), p_reverses_entry_id, p_tenant_id
  ) RETURNING id INTO v_entry_id;

  -- 6. Insert lines
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;

    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE account_code = (v_line->>'account_code')
      AND COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND is_active = true;

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'account_not_found: %', (v_line->>'account_code');
    END IF;

    INSERT INTO journal_entry_lines (
      entry_id, line_number, account_id, side, amount, description,
      counterparty_type, counterparty_id, tenant_id
    ) VALUES (
      v_entry_id, v_line_number, v_account_id,
      (v_line->>'side'), (v_line->>'amount')::numeric,
      v_line->>'description',
      v_line->>'counterparty_type',
      NULLIF(v_line->>'counterparty_id', '')::uuid,
      p_tenant_id
    );
  END LOOP;

  -- 7. Link reversal if applicable
  IF p_reverses_entry_id IS NOT NULL THEN
    UPDATE journal_entries
    SET reversed_by_entry_id = v_entry_id
    WHERE id = p_reverses_entry_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'entry_number', v_entry_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._post_journal_entry(
  date, public.journal_entry_source, text, jsonb, text, uuid, uuid, uuid
) TO authenticated;

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `post_journal_entry_rpc`**

- [ ] **Step 5: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000009_post_journal_entry_rpc.sql tests/integration/akuntansi-phase0a/post-journal-entry-rpc.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 10 — _post_journal_entry canonical RPC + auto-period + tests"
```

---

## Task 11: `close_accounting_period` RPC

**Files:**
- Create: `supabase/migrations/20260715000010_period_close_rpcs.sql`
- Create: `tests/integration/akuntansi-phase0a/period-close-rpc.test.ts`

**Interfaces:**
- Produces: `public.close_accounting_period(p_year int, p_month int, p_tenant_id uuid DEFAULT NULL) RETURNS jsonb`. Requires Owner role. Marks period CLOSED + sets `closed_at`/`closed_by`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('close_accounting_period RPC', () => {
  it('closes period successfully when Owner', async () => {
    // Find an Owner user
    const { data: owner } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('role', 'Owner')
      .eq('status', 'Aktif')
      .limit(1)
      .single();

    // Impersonate Owner via service-role workaround:
    // For this test, we call RPC and rely on existing DEFINER pattern.
    // Use a test year/month that we'll create explicitly.
    const testYear = 2030;
    const testMonth = 6;

    await supabaseAdmin
      .from('accounting_periods')
      .insert({ tenant_id: null, period_year: testYear, period_month: testMonth, status: 'OPEN' });

    // Since RPC checks auth.uid() against admin_users.role='Owner', we need
    // either signed-in Owner session OR direct DB execution. Use raw SQL via
    // set_config to fake auth.uid:
    await supabaseAdmin.rpc('set_config' as any, {
      key: 'request.jwt.claim.sub', value: owner!.id, is_local: false
    });

    const { data, error } = await supabaseAdmin.rpc('close_accounting_period', {
      p_year: testYear, p_month: testMonth, p_tenant_id: null,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });

    const { data: period } = await supabaseAdmin
      .from('accounting_periods')
      .select('status, closed_at, closed_by')
      .eq('period_year', testYear)
      .eq('period_month', testMonth)
      .is('tenant_id', null)
      .single();
    expect(period!.status).toBe('CLOSED');
    expect(period!.closed_at).not.toBeNull();

    // Cleanup
    await supabaseAdmin.from('accounting_periods').delete()
      .eq('period_year', testYear).eq('period_month', testMonth);
  });

  it('rejects close when period not OPEN/REOPENED', async () => {
    const { data: owner } = await supabaseAdmin
      .from('admin_users').select('id').eq('role', 'Owner').eq('status', 'Aktif').limit(1).single();

    await supabaseAdmin.from('accounting_periods')
      .insert({ tenant_id: null, period_year: 2030, period_month: 7, status: 'CLOSED' });

    await supabaseAdmin.rpc('set_config' as any, {
      key: 'request.jwt.claim.sub', value: owner!.id, is_local: false
    });

    const { error } = await supabaseAdmin.rpc('close_accounting_period', {
      p_year: 2030, p_month: 7, p_tenant_id: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/period_not_open/i);

    await supabaseAdmin.from('accounting_periods').delete()
      .eq('period_year', 2030).eq('period_month', 7);
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260715000010_period_close_rpcs.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.close_accounting_period(
  p_year int,
  p_month int,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ) THEN
    RAISE EXCEPTION 'owner_only';
  END IF;

  UPDATE accounting_periods
  SET status = 'CLOSED',
      closed_at = now(),
      closed_by = auth.uid()
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND period_year = p_year
    AND period_month = p_month
    AND status IN ('OPEN', 'REOPENED');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'period_not_open_or_not_found: year=% month=%', p_year, p_month;
  END IF;

  RETURN jsonb_build_object('ok', true, 'closed_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_accounting_period(int, int, uuid) TO authenticated;

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `period_close_rpcs`**

- [ ] **Step 5: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000010_period_close_rpcs.sql tests/integration/akuntansi-phase0a/period-close-rpc.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 11 — close_accounting_period RPC + Owner-gate"
```

---

## Task 12: Views (`trial_balance` + `general_ledger`)

**Files:**
- Create: `supabase/migrations/20260715000011_views.sql`
- Create: `tests/integration/akuntansi-phase0a/views.test.ts`

**Interfaces:**
- Produces: `trial_balance` view (account-level sum debit/credit + balance per normal_balance), `general_ledger` view (per-line with running_balance via window function).

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('trial_balance + general_ledger views', () => {
  let testEntries: string[] = [];

  it('trial_balance returns balanced totals system-wide', async () => {
    // Post 2 sample balanced entries
    const r1 = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_description: 'tb test 1',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 50000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 50000 },
      ],
      p_tenant_id: null,
    });
    testEntries.push(r1.data!.entry_id);

    const r2 = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_description: 'tb test 2',
      p_lines: [
        { account_code: '5-2100', side: 'DEBIT', amount: 30000 },
        { account_code: '1-1210', side: 'CREDIT', amount: 30000 },
      ],
      p_tenant_id: null,
    });
    testEntries.push(r2.data!.entry_id);

    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, total_debit, total_credit, balance');
    expect(error).toBeNull();

    const systemDebit = data!.reduce((sum, r: any) => sum + Number(r.total_debit), 0);
    const systemCredit = data!.reduce((sum, r: any) => sum + Number(r.total_credit), 0);
    expect(systemDebit).toBe(systemCredit);
  });

  it('general_ledger shows running_balance per account', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('account_code, entry_date, debit, credit, running_balance')
      .eq('account_code', '1-1110')
      .order('entry_date', { ascending: true });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    // Last row's running_balance should be > 0 (we deposited 50000 to Kas Toko)
    expect(Number(data![data!.length - 1].running_balance)).toBeGreaterThanOrEqual(50000);
  });

  // Cleanup
  it('cleanup test entries', async () => {
    for (const id of testEntries) {
      await supabaseAdmin.from('journal_entries').delete().eq('id', id);
    }
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260715000011_views.sql`:

```sql
BEGIN;

CREATE OR REPLACE VIEW public.trial_balance AS
SELECT
  coa.id AS account_id,
  coa.account_code,
  coa.account_name,
  coa.account_type,
  coa.account_subtype,
  coa.normal_balance,
  coa.tenant_id,
  COALESCE(SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE 0 END), 0) AS total_debit,
  COALESCE(SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE 0 END), 0) AS total_credit,
  CASE coa.normal_balance
    WHEN 'DEBIT' THEN
      COALESCE(SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE 0 END), 0)
    WHEN 'CREDIT' THEN
      COALESCE(SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE 0 END), 0)
  END AS balance
FROM public.chart_of_accounts coa
LEFT JOIN public.journal_entry_lines jel ON jel.account_id = coa.id
LEFT JOIN public.journal_entries je ON je.id = jel.entry_id AND je.is_posted = true
WHERE coa.is_active = true
GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.account_subtype, coa.normal_balance, coa.tenant_id
ORDER BY coa.account_code;

CREATE OR REPLACE VIEW public.general_ledger AS
SELECT
  jel.account_id,
  coa.account_code,
  coa.account_name,
  coa.normal_balance,
  je.id AS entry_id,
  je.entry_number,
  je.entry_date,
  je.posted_at,
  je.description AS entry_description,
  jel.description AS line_description,
  jel.side,
  jel.amount,
  CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE 0 END AS debit,
  CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE 0 END AS credit,
  jel.counterparty_type,
  jel.counterparty_id,
  jel.status,
  jel.reconciled_at,
  je.source_type,
  je.source_ref_table,
  je.source_ref_id,
  CASE coa.normal_balance
    WHEN 'DEBIT' THEN
      SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE -jel.amount END)
      OVER (PARTITION BY jel.account_id ORDER BY je.entry_date, je.posted_at, jel.line_number)
    WHEN 'CREDIT' THEN
      SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE -jel.amount END)
      OVER (PARTITION BY jel.account_id ORDER BY je.entry_date, je.posted_at, jel.line_number)
  END AS running_balance,
  je.tenant_id
FROM public.journal_entry_lines jel
JOIN public.journal_entries je ON je.id = jel.entry_id
JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
WHERE je.is_posted = true;

GRANT SELECT ON public.trial_balance TO authenticated;
GRANT SELECT ON public.general_ledger TO authenticated;

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `views`**

- [ ] **Step 5: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000011_views.sql tests/integration/akuntansi-phase0a/views.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 12 — trial_balance + general_ledger views"
```

---

## Task 13: Seed COA for existing `cash_accounts`

**Files:**
- Create: `supabase/migrations/20260715000012_seed_coa_for_existing_cash_accounts.sql`
- Create: `tests/integration/akuntansi-phase0a/coa-cash-accounts-link.test.ts`

**Interfaces:**
- Produces: `cash_accounts.coa_account_id` column ADD + populated for existing BANK/KAS/E_WALLET rows. Auto-generates sub-COA entries under 1-1200/1-1300 for each existing bank/wallet account.

**Note:** Depends on existing `cash_accounts` table (from Phase 1a rev2 — if not applied yet, this task includes the prerequisite migration check; if `cash_accounts` doesn't exist yet, skip this task and document for later).

- [ ] **Step 1: Pre-check existing `cash_accounts` schema**

Use MCP `list_tables` to verify `cash_accounts` exists. If NOT exists, document SKIP in plan comment and proceed without this task. Cash accounts link wired up in Phase 1.

- [ ] **Step 2: Write failing test (only if cash_accounts exists)**

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('seed COA for existing cash_accounts', () => {
  it('each active BANK cash_account has linked coa_account_id', async () => {
    const { data, error } = await supabaseAdmin
      .from('cash_accounts')
      .select('id, internal_label, account_type, coa_account_id')
      .eq('account_type', 'BANK')
      .eq('is_active', true);
    expect(error).toBeNull();
    for (const row of data!) {
      expect(row.coa_account_id).not.toBeNull();
    }
  });

  it('linked COA entries are under 1-1200 Bank parent', async () => {
    const { data: bankParent } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id').eq('account_code', '1-1200').single();

    const { data } = await supabaseAdmin
      .from('cash_accounts')
      .select('coa_account_id, coa:coa_account_id(parent_id, account_subtype)')
      .eq('account_type', 'BANK')
      .eq('is_active', true)
      .not('coa_account_id', 'is', null);

    for (const row of data!) {
      expect((row.coa as any).parent_id).toBe(bankParent!.id);
      expect((row.coa as any).account_subtype).toBe('BANK');
    }
  });
});
```

- [ ] **Step 3: Verify FAIL**

- [ ] **Step 4: Write migration**

Create `supabase/migrations/20260715000012_seed_coa_for_existing_cash_accounts.sql`:

```sql
BEGIN;

-- Add coa_account_id column
ALTER TABLE public.cash_accounts
  ADD COLUMN IF NOT EXISTS coa_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

-- Auto-seed BANK sub-COAs under 1-1200 (use 1-12NN sequence)
WITH bank_parent AS (
  SELECT id FROM public.chart_of_accounts WHERE account_code = '1-1200' AND is_system = true LIMIT 1
),
bank_seed AS (
  INSERT INTO public.chart_of_accounts (
    account_code, account_name, account_type, account_subtype,
    parent_id, normal_balance, is_system, is_active
  )
  SELECT
    '1-12' || LPAD((10 + ROW_NUMBER() OVER (ORDER BY ca.sort_order, ca.created_at))::text, 2, '0'),
    ca.internal_label,
    'ASET', 'BANK',
    (SELECT id FROM bank_parent),
    'DEBIT', false, true
  FROM public.cash_accounts ca
  WHERE ca.account_type = 'BANK' AND ca.is_active = true
    AND ca.coa_account_id IS NULL
  RETURNING id, account_name
)
UPDATE public.cash_accounts ca
SET coa_account_id = bs.id
FROM bank_seed bs
WHERE ca.internal_label = bs.account_name
  AND ca.account_type = 'BANK'
  AND ca.coa_account_id IS NULL;

-- Auto-seed E_WALLET sub-COAs under 1-1300
WITH wallet_parent AS (
  SELECT id FROM public.chart_of_accounts WHERE account_code = '1-1300' AND is_system = true LIMIT 1
),
wallet_seed AS (
  INSERT INTO public.chart_of_accounts (
    account_code, account_name, account_type, account_subtype,
    parent_id, normal_balance, is_system, is_active
  )
  SELECT
    '1-13' || LPAD((10 + ROW_NUMBER() OVER (ORDER BY ca.sort_order, ca.created_at))::text, 2, '0'),
    ca.internal_label,
    'ASET', 'E_WALLET',
    (SELECT id FROM wallet_parent),
    'DEBIT', false, true
  FROM public.cash_accounts ca
  WHERE ca.account_type = 'E_WALLET' AND ca.is_active = true
    AND ca.coa_account_id IS NULL
  RETURNING id, account_name
)
UPDATE public.cash_accounts ca
SET coa_account_id = ws.id
FROM wallet_seed ws
WHERE ca.internal_label = ws.account_name
  AND ca.account_type = 'E_WALLET'
  AND ca.coa_account_id IS NULL;

-- Link KAS accounts to 1-1110 Kas Toko (already system-seeded)
UPDATE public.cash_accounts ca
SET coa_account_id = (SELECT id FROM public.chart_of_accounts WHERE account_code = '1-1110' LIMIT 1)
WHERE ca.account_type = 'KAS' AND ca.is_active = true AND ca.coa_account_id IS NULL;

COMMIT;
```

- [ ] **Step 5: Apply via MCP, name `seed_coa_for_existing_cash_accounts`**

- [ ] **Step 6: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000012_seed_coa_for_existing_cash_accounts.sql tests/integration/akuntansi-phase0a/coa-cash-accounts-link.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 13 — seed sub-COAs for existing cash_accounts + add coa_account_id FK"
```

---

## Task 14: `set_opening_balance` RPC + guard

**Files:**
- Create: `supabase/migrations/20260715000013_opening_balance_rpc.sql`
- Create: `tests/integration/akuntansi-phase0a/opening-balance-rpc.test.ts`

**Interfaces:**
- Produces: `public.set_opening_balance(p_balance_date date, p_lines jsonb, p_tenant_id uuid DEFAULT NULL) RETURNS jsonb`. Owner-gated. Posts single OPENING_BALANCE entry via `_post_journal_entry`. Sets `accounting_config.opening_balance_set=true` + `opening_balance_date`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('set_opening_balance RPC', () => {
  it('posts opening balance + flips config flag', async () => {
    // Reset config flag for test
    await supabaseAdmin.from('accounting_config').update({
      opening_balance_set: false,
      opening_balance_date: null,
    }).is('tenant_id', null);

    const { data: owner } = await supabaseAdmin
      .from('admin_users').select('id').eq('role', 'Owner').eq('status', 'Aktif').limit(1).single();
    await supabaseAdmin.rpc('set_config' as any, {
      key: 'request.jwt.claim.sub', value: owner!.id, is_local: false
    });

    const { data, error } = await supabaseAdmin.rpc('set_opening_balance', {
      p_balance_date: '2025-05-31',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 500000 },
        { account_code: '1-1210', side: 'DEBIT', amount: 8500000 },
        { account_code: '3-1100', side: 'CREDIT', amount: 9000000 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });

    const { data: cfg } = await supabaseAdmin
      .from('accounting_config')
      .select('opening_balance_set, opening_balance_date')
      .is('tenant_id', null).single();
    expect(cfg!.opening_balance_set).toBe(true);
    expect(cfg!.opening_balance_date).toBe('2025-05-31');

    // Cleanup
    await supabaseAdmin.from('journal_entries').delete().eq('id', data!.entry_id);
    await supabaseAdmin.from('accounting_config').update({
      opening_balance_set: false,
      opening_balance_date: null,
    }).is('tenant_id', null);
  });

  it('rejects second call when opening_balance_set=true', async () => {
    await supabaseAdmin.from('accounting_config').update({
      opening_balance_set: true,
      opening_balance_date: '2025-05-31',
    }).is('tenant_id', null);

    const { data: owner } = await supabaseAdmin
      .from('admin_users').select('id').eq('role', 'Owner').eq('status', 'Aktif').limit(1).single();
    await supabaseAdmin.rpc('set_config' as any, {
      key: 'request.jwt.claim.sub', value: owner!.id, is_local: false
    });

    const { error } = await supabaseAdmin.rpc('set_opening_balance', {
      p_balance_date: '2025-05-31',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 100 },
        { account_code: '3-1100', side: 'CREDIT', amount: 100 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/opening_balance_already_set/i);

    // Cleanup
    await supabaseAdmin.from('accounting_config').update({
      opening_balance_set: false,
      opening_balance_date: null,
    }).is('tenant_id', null);
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260715000013_opening_balance_rpc.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.set_opening_balance(
  p_balance_date date,
  p_lines jsonb,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_set boolean;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ) THEN
    RAISE EXCEPTION 'owner_only';
  END IF;

  SELECT opening_balance_set INTO v_already_set
  FROM accounting_config
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_already_set THEN
    RAISE EXCEPTION 'opening_balance_already_set';
  END IF;

  v_result := _post_journal_entry(
    p_entry_date := p_balance_date,
    p_source_type := 'OPENING_BALANCE'::journal_entry_source,
    p_description := 'Saldo awal per ' || p_balance_date::text,
    p_lines := p_lines,
    p_tenant_id := p_tenant_id
  );

  UPDATE accounting_config
  SET opening_balance_set = true,
      opening_balance_date = p_balance_date,
      updated_at = now()
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_opening_balance(date, jsonb, uuid) TO authenticated;

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `opening_balance_rpc`**

- [ ] **Step 5: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000013_opening_balance_rpc.sql tests/integration/akuntansi-phase0a/opening-balance-rpc.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 14 — set_opening_balance RPC + idempotency guard"
```

---

## Task 15: `close_fiscal_year` RPC (year-end closing)

**Files:**
- Create: `supabase/migrations/20260715000014_year_end_close_rpc.sql`
- Create: `tests/integration/akuntansi-phase0a/year-end-close-rpc.test.ts`

**Interfaces:**
- Produces: `public.close_fiscal_year(p_year int, p_tenant_id uuid DEFAULT NULL) RETURNS jsonb`. Owner-gated. Posts 4 closing entries via `_post_journal_entry` (Pendapatan → Ikhtisar, Beban → Ikhtisar, Ikhtisar Net Income → Laba Ditahan, Prive → Laba Ditahan).

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('close_fiscal_year RPC', () => {
  it('posts 4 closing entries and zeros P&L accounts', async () => {
    // Use test year 2099 so we don't disturb production data
    const testYear = 2099;

    // Seed test data: 1 sale entry + 1 expense entry within 2099
    const sale = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: `${testYear}-06-15`,
      p_source_type: 'BACKFILL',
      p_description: 'fiscal close test sale',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 100000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 100000 },
      ],
      p_tenant_id: null,
    });
    expect(sale.error).toBeNull();

    const expense = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: `${testYear}-06-15`,
      p_source_type: 'BACKFILL',
      p_description: 'fiscal close test expense',
      p_lines: [
        { account_code: '5-2100', side: 'DEBIT', amount: 30000 },
        { account_code: '1-1210', side: 'CREDIT', amount: 30000 },
      ],
      p_tenant_id: null,
    });

    const { data: owner } = await supabaseAdmin
      .from('admin_users').select('id').eq('role', 'Owner').eq('status', 'Aktif').limit(1).single();
    await supabaseAdmin.rpc('set_config' as any, {
      key: 'request.jwt.claim.sub', value: owner!.id, is_local: false
    });

    const { data, error } = await supabaseAdmin.rpc('close_fiscal_year', {
      p_year: testYear, p_tenant_id: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, fiscal_year: testYear });
    expect(data!.net_income).toBeDefined();

    // Verify P&L accounts zero after close
    const { data: tb } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, balance')
      .in('account_code', ['4-1110', '5-2100', '3-1900']);
    const map = Object.fromEntries(tb!.map(r => [r.account_code, Number(r.balance)]));
    expect(map['4-1110']).toBe(0);
    expect(map['5-2100']).toBe(0);
    expect(map['3-1900']).toBe(0);

    // Cleanup all entries in 2099
    const { data: yrEntries } = await supabaseAdmin
      .from('journal_entries').select('id')
      .gte('entry_date', `${testYear}-01-01`).lte('entry_date', `${testYear}-12-31`);
    for (const e of yrEntries!) await supabaseAdmin.from('journal_entries').delete().eq('id', e.id);
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260715000014_year_end_close_rpc.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.close_fiscal_year(
  p_year int,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fiscal_end date;
  v_pendapatan_lines jsonb := '[]'::jsonb;
  v_beban_lines jsonb := '[]'::jsonb;
  v_total_pendapatan numeric := 0;
  v_total_beban numeric := 0;
  v_net_income numeric;
  v_prive_balance numeric := 0;
  v_acc record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ) THEN
    RAISE EXCEPTION 'owner_only';
  END IF;

  v_fiscal_end := make_date(p_year, 12, 31);

  -- Step 1: Build Pendapatan close (D 4-XXXX, K 3-1900)
  FOR v_acc IN
    SELECT coa.account_code, ABS(tb.balance) AS bal
    FROM trial_balance tb
    JOIN chart_of_accounts coa ON coa.id = tb.account_id
    WHERE coa.account_type = 'PENDAPATAN' AND tb.balance <> 0
      AND COALESCE(tb.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LOOP
    v_pendapatan_lines := v_pendapatan_lines ||
      jsonb_build_object('account_code', v_acc.account_code, 'side', 'DEBIT', 'amount', v_acc.bal);
    v_total_pendapatan := v_total_pendapatan + v_acc.bal;
  END LOOP;

  IF v_total_pendapatan > 0 THEN
    v_pendapatan_lines := v_pendapatan_lines ||
      jsonb_build_object('account_code', '3-1900', 'side', 'CREDIT', 'amount', v_total_pendapatan);
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Pendapatan ke Ikhtisar Laba Rugi (FY ' || p_year || ')',
      p_lines := v_pendapatan_lines,
      p_tenant_id := p_tenant_id
    );
  END IF;

  -- Step 2: Build Beban close (D 3-1900, K 5-XXXX)
  FOR v_acc IN
    SELECT coa.account_code, ABS(tb.balance) AS bal
    FROM trial_balance tb
    JOIN chart_of_accounts coa ON coa.id = tb.account_id
    WHERE coa.account_type = 'BEBAN' AND tb.balance <> 0
      AND COALESCE(tb.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LOOP
    v_beban_lines := v_beban_lines ||
      jsonb_build_object('account_code', v_acc.account_code, 'side', 'CREDIT', 'amount', v_acc.bal);
    v_total_beban := v_total_beban + v_acc.bal;
  END LOOP;

  IF v_total_beban > 0 THEN
    v_beban_lines := jsonb_build_array(
      jsonb_build_object('account_code', '3-1900', 'side', 'DEBIT', 'amount', v_total_beban)
    ) || v_beban_lines;
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Beban ke Ikhtisar Laba Rugi (FY ' || p_year || ')',
      p_lines := v_beban_lines,
      p_tenant_id := p_tenant_id
    );
  END IF;

  -- Step 3: Close Ikhtisar Laba Rugi (Net Income) ke Laba Ditahan
  v_net_income := v_total_pendapatan - v_total_beban;

  IF v_net_income > 0 THEN
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Net Income ke Laba Ditahan (FY ' || p_year || ')',
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '3-1900', 'side', 'DEBIT', 'amount', v_net_income),
        jsonb_build_object('account_code', '3-1300', 'side', 'CREDIT', 'amount', v_net_income)
      ),
      p_tenant_id := p_tenant_id
    );
  ELSIF v_net_income < 0 THEN
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Net Loss ke Laba Ditahan (FY ' || p_year || ')',
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '3-1300', 'side', 'DEBIT', 'amount', ABS(v_net_income)),
        jsonb_build_object('account_code', '3-1900', 'side', 'CREDIT', 'amount', ABS(v_net_income))
      ),
      p_tenant_id := p_tenant_id
    );
  END IF;

  -- Step 4: Close Prive ke Laba Ditahan
  SELECT ABS(balance) INTO v_prive_balance
  FROM trial_balance tb
  JOIN chart_of_accounts coa ON coa.id = tb.account_id
  WHERE coa.account_code = '3-1200'
    AND COALESCE(tb.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_prive_balance > 0 THEN
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Prive ke Laba Ditahan (FY ' || p_year || ')',
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '3-1300', 'side', 'DEBIT', 'amount', v_prive_balance),
        jsonb_build_object('account_code', '3-1200', 'side', 'CREDIT', 'amount', v_prive_balance)
      ),
      p_tenant_id := p_tenant_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'fiscal_year', p_year,
    'total_pendapatan', v_total_pendapatan,
    'total_beban', v_total_beban,
    'net_income', v_net_income,
    'prive_closed', v_prive_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_fiscal_year(int, uuid) TO authenticated;

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `year_end_close_rpc`**

- [ ] **Step 5: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000014_year_end_close_rpc.sql tests/integration/akuntansi-phase0a/year-end-close-rpc.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 15 — close_fiscal_year RPC (4-step closing entries via Ikhtisar)"
```

---

## Task 16: `accrue_period_taxes` RPC (PPh Final monthly)

**Files:**
- Create: `supabase/migrations/20260715000015_tax_accrual_rpc.sql`
- Create: `tests/integration/akuntansi-phase0a/tax-accrual-rpc.test.ts`

**Interfaces:**
- Produces: `public.accrue_period_taxes(p_year int, p_month int, p_tenant_id uuid DEFAULT NULL) RETURNS jsonb`. Computes monthly Pendapatan total × pph_rate_pct; posts entry D 5-3300 Beban Pajak, K 2-1210 Hutang PPh Final.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('accrue_period_taxes RPC (PPh Final 0.5% UMKM)', () => {
  it('posts tax accrual entry based on monthly omzet', async () => {
    // Seed sample sale in 2099-06 (test isolation)
    const sale = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2099-06-15',
      p_source_type: 'BACKFILL',
      p_description: 'tax accrual test sale',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 1000000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 1000000 },
      ],
      p_tenant_id: null,
    });
    expect(sale.error).toBeNull();

    const { data, error } = await supabaseAdmin.rpc('accrue_period_taxes', {
      p_year: 2099, p_month: 6, p_tenant_id: null,
    });
    expect(error).toBeNull();
    expect(Number(data!.omzet)).toBe(1000000);
    expect(Number(data!.tax)).toBe(5000);  // 0.5% × 1jt = 5rb

    // Verify accrual entry posted
    const { data: pajakEntry } = await supabaseAdmin
      .from('journal_entries')
      .select('*, journal_entry_lines(*)')
      .eq('source_type', 'TAX_ACCRUAL_PPH')
      .eq('entry_date', '2099-06-30');
    expect(pajakEntry!.length).toBeGreaterThan(0);

    // Cleanup
    const { data: yrEntries } = await supabaseAdmin
      .from('journal_entries').select('id')
      .gte('entry_date', '2099-01-01').lte('entry_date', '2099-12-31');
    for (const e of yrEntries!) await supabaseAdmin.from('journal_entries').delete().eq('id', e.id);
  });

  it('skips accrual when omzet zero', async () => {
    const { data, error } = await supabaseAdmin.rpc('accrue_period_taxes', {
      p_year: 2098, p_month: 6, p_tenant_id: null,
    });
    expect(error).toBeNull();
    expect(Number(data!.omzet)).toBe(0);
    expect(Number(data!.tax ?? 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write migration**

Create `supabase/migrations/20260715000015_tax_accrual_rpc.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.accrue_period_taxes(
  p_year int,
  p_month int,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config accounting_config;
  v_omzet numeric;
  v_tax numeric;
  v_period_end date;
BEGIN
  SELECT * INTO v_config
  FROM accounting_config
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_config IS NULL OR NOT v_config.auto_accrue_pph_monthly THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'auto_accrue_disabled_or_no_config');
  END IF;

  -- Compute monthly omzet (sum credit side of all Pendapatan accounts in period, excluding year-end/tax-accrual sources)
  SELECT COALESCE(SUM(jel.amount), 0) INTO v_omzet
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'PENDAPATAN'
    AND jel.side = 'CREDIT'
    AND EXTRACT(YEAR FROM je.entry_date)::int = p_year
    AND EXTRACT(MONTH FROM je.entry_date)::int = p_month
    AND je.is_posted = true
    AND je.source_type NOT IN ('YEAR_END_CLOSE','TAX_ACCRUAL_PPH','TAX_ACCRUAL_PPN')
    AND COALESCE(je.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);

  v_tax := v_omzet * (COALESCE(v_config.pph_rate_pct, 0.5) / 100);

  IF v_tax <= 0 THEN
    RETURN jsonb_build_object('omzet', v_omzet, 'tax', 0, 'skipped', true);
  END IF;

  v_period_end := (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date;

  PERFORM _post_journal_entry(
    p_entry_date := v_period_end,
    p_source_type := 'TAX_ACCRUAL_PPH'::journal_entry_source,
    p_description := 'PPh Final ' || v_config.pph_rate_pct || '% accrual ' ||
                     to_char(make_date(p_year, p_month, 1), 'Mon YYYY') ||
                     ' (omzet Rp ' || v_omzet || ')',
    p_lines := jsonb_build_array(
      jsonb_build_object('account_code', '5-3300', 'side', 'DEBIT', 'amount', v_tax),
      jsonb_build_object('account_code', '2-1210', 'side', 'CREDIT', 'amount', v_tax)
    ),
    p_tenant_id := p_tenant_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'omzet', v_omzet,
    'tax', v_tax,
    'pph_rate_pct', v_config.pph_rate_pct
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accrue_period_taxes(int, int, uuid) TO authenticated;

COMMIT;
```

- [ ] **Step 4: Apply via MCP, name `tax_accrual_rpc`**

- [ ] **Step 5: Verify PASS, commit**

```bash
git add supabase/migrations/20260715000015_tax_accrual_rpc.sql tests/integration/akuntansi-phase0a/tax-accrual-rpc.test.ts
git commit -m "feat(akuntansi): Phase 0a Task 16 — accrue_period_taxes RPC (PPh Final UMKM monthly)"
```

---

## Task 17: TypeScript service module

**Files:**
- Create: `src/lib/akuntansi/types.ts`
- Create: `src/lib/akuntansi/service.ts`
- Create: `src/lib/akuntansi/service.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `CoaAccount`, `JournalEntry`, `JournalEntryLine`, `AccountingConfig`, `AccountingPeriod`, `OpeningBalanceLine`, `JournalSource` types
  - `service.ts` exports: `fetchCoa()`, `fetchAccountingConfig()`, `setOpeningBalance(date, lines)`, `closeAccountingPeriod(year, month)`, `closeFiscalYear(year)`, `accruePeriodTaxes(year, month)`, `fetchTrialBalance()`, `fetchGeneralLedger(accountId, fromDate, toDate)`

- [ ] **Step 1: Write failing unit test (using mock supabase)**

Create `src/lib/akuntansi/service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  }
}));

import { supabase } from '../supabaseClient';
import { setOpeningBalance, closeAccountingPeriod, fetchTrialBalance } from './service';

describe('akuntansi service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setOpeningBalance calls RPC with correct payload', async () => {
    const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
    mockRpc.mockResolvedValue({ data: { ok: true, entry_id: 'abc' }, error: null });

    const result = await setOpeningBalance('2025-05-31', [
      { account_code: '1-1110', side: 'DEBIT', amount: 100 },
      { account_code: '3-1100', side: 'CREDIT', amount: 100 },
    ]);

    expect(mockRpc).toHaveBeenCalledWith('set_opening_balance', expect.objectContaining({
      p_balance_date: '2025-05-31',
    }));
    expect(result).toMatchObject({ ok: true });
  });

  it('closeAccountingPeriod calls RPC', async () => {
    const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    await closeAccountingPeriod(2026, 6);
    expect(mockRpc).toHaveBeenCalledWith('close_accounting_period', { p_year: 2026, p_month: 6, p_tenant_id: null });
  });

  it('fetchTrialBalance returns rows', async () => {
    const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [{ account_code: '1-1110' }], error: null })
      })
    });

    const rows = await fetchTrialBalance();
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Write types + service**

Create `src/lib/akuntansi/types.ts`:

```typescript
export type AccountType = 'ASET' | 'LIABILITAS' | 'MODAL' | 'PENDAPATAN' | 'BEBAN';
export type NormalBalance = 'DEBIT' | 'CREDIT';
export type Side = 'DEBIT' | 'CREDIT';
export type PeriodStatus = 'OPEN' | 'CLOSED' | 'REOPENED';
export type PpnMode = 'NON_PKP' | 'PKP';
export type PphMode = 'UMKM_FINAL_0_5' | 'BADAN_NORMAL_25' | 'BADAN_NORMAL_22' | 'MANUAL';

export type JournalSource =
  | 'KASIR_SALE' | 'PEMBAYARAN' | 'PIUTANG_PAYMENT' | 'KASIR_EXPENSE'
  | 'PI_TAGIHAN' | 'PI_RECEIVE_GOODS' | 'WALKIN_PAYMENT' | 'TEMPO_WRITEOFF'
  | 'CASH_DEPOSIT_BATCH' | 'MANUAL_TRANSFER' | 'OWNER_DRAWING' | 'OWNER_TOPUP'
  | 'WALLET_TOPUP' | 'WALLET_SPEND' | 'ADJUSTMENT' | 'OPENING_BALANCE'
  | 'BACKFILL' | 'PERIOD_CLOSE' | 'YEAR_END_CLOSE' | 'HPP_RECOGNITION'
  | 'TAX_ACCRUAL_PPH' | 'TAX_ACCRUAL_PPN' | 'STOCK_OPNAME_ADJ'
  | 'DP_RECEIVE' | 'DP_RECOGNIZE' | 'DP_REFUND';

export interface CoaAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  account_subtype: string | null;
  parent_id: string | null;
  normal_balance: NormalBalance;
  is_active: boolean;
  is_system: boolean;
  is_control_account: boolean;
  description: string | null;
  tenant_id: string | null;
}

export interface AccountingConfig {
  id: string;
  tenant_id: string | null;
  ppn_mode: PpnMode;
  ppn_rate_pct: number;
  pph_mode: PphMode;
  pph_rate_pct: number | null;
  fiscal_year_start_month: number;
  enable_dual_write_to_gl: boolean;
  enable_strict_period_close: boolean;
  opening_balance_set: boolean;
  opening_balance_date: string | null;
  auto_accrue_pph_monthly: boolean;
  auto_accrue_ppn_monthly: boolean;
}

export interface AccountingPeriod {
  id: string;
  tenant_id: string | null;
  period_year: number;
  period_month: number;
  status: PeriodStatus;
  closed_at: string | null;
  closed_by: string | null;
}

export interface OpeningBalanceLine {
  account_code: string;
  side: Side;
  amount: number;
  description?: string;
}

export interface TrialBalanceRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  account_subtype: string | null;
  normal_balance: NormalBalance;
  total_debit: number;
  total_credit: number;
  balance: number;
}

export interface GeneralLedgerRow {
  account_id: string;
  account_code: string;
  account_name: string;
  entry_id: string;
  entry_number: string;
  entry_date: string;
  entry_description: string;
  line_description: string | null;
  side: Side;
  amount: number;
  debit: number;
  credit: number;
  running_balance: number;
  source_type: JournalSource;
  source_ref_table: string | null;
  source_ref_id: string | null;
}
```

Create `src/lib/akuntansi/service.ts`:

```typescript
import { supabase } from '../supabaseClient';
import type {
  CoaAccount, AccountingConfig, AccountingPeriod,
  OpeningBalanceLine, TrialBalanceRow, GeneralLedgerRow,
} from './types';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

export async function fetchCoa(): Promise<CoaAccount[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('chart_of_accounts')
    .select('*')
    .order('account_code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CoaAccount[];
}

export async function fetchAccountingConfig(): Promise<AccountingConfig | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('accounting_config')
    .select('*')
    .is('tenant_id', null)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AccountingConfig | null;
}

export async function fetchAccountingPeriods(): Promise<AccountingPeriod[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('accounting_periods')
    .select('*')
    .is('tenant_id', null)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AccountingPeriod[];
}

export async function setOpeningBalance(
  balanceDate: string,
  lines: OpeningBalanceLine[],
): Promise<{ ok: boolean; entry_id?: string; entry_number?: string }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('set_opening_balance', {
    p_balance_date: balanceDate,
    p_lines: lines,
    p_tenant_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; entry_id?: string; entry_number?: string };
}

export async function closeAccountingPeriod(year: number, month: number): Promise<{ ok: boolean }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('close_accounting_period', {
    p_year: year, p_month: month, p_tenant_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean };
}

export async function closeFiscalYear(year: number): Promise<{
  ok: boolean; fiscal_year: number; net_income: number; total_pendapatan: number; total_beban: number; prive_closed: number;
}> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('close_fiscal_year', {
    p_year: year, p_tenant_id: null,
  });
  if (error) throw error;
  return data as any;
}

export async function accruePeriodTaxes(year: number, month: number): Promise<{
  ok?: boolean; omzet: number; tax: number; pph_rate_pct?: number; skipped?: boolean;
}> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('accrue_period_taxes', {
    p_year: year, p_month: month, p_tenant_id: null,
  });
  if (error) throw error;
  return data as any;
}

export async function fetchTrialBalance(): Promise<TrialBalanceRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('trial_balance')
    .select('*')
    .order('account_code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TrialBalanceRow[];
}

export async function fetchGeneralLedger(
  accountId: string,
  fromDate: string,
  toDate: string,
): Promise<GeneralLedgerRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('general_ledger')
    .select('*')
    .eq('account_id', accountId)
    .gte('entry_date', fromDate)
    .lte('entry_date', toDate)
    .order('entry_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as GeneralLedgerRow[];
}
```

- [ ] **Step 4: Run tests + tsc verify**

```bash
npx vitest run src/lib/akuntansi/service.test.ts
npx tsc --noEmit
```

Expected: tests PASS, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/akuntansi/
git commit -m "feat(akuntansi): Phase 0a Task 17 — TypeScript service module + types + unit tests"
```

---

## Task 18: Opening Balance Wizard UI (4-step)

**Files:**
- Create: `src/components/akuntansi/OpeningBalanceWizard.tsx`
- Create: `src/components/akuntansi/AkuntansiScreen.tsx`
- Modify: `src/App.tsx` (add `case 'akuntansi'` routing)
- Modify: `src/lib/urlRoute.ts` (add `'akuntansi'` to ActivePage union)
- Modify: `src/components/Sidebar.tsx` (add Akuntansi entry in Keuangan group)

**Interfaces:**
- Produces:
  - `AkuntansiScreen.tsx` — entry point; checks `accounting_config.opening_balance_set`; if false → render `OpeningBalanceWizard`, else → placeholder "Akuntansi siap, Phase 0b-0d nyusul"
  - `OpeningBalanceWizard.tsx` — 4-step wizard: (1) tanggal saldo awal, (2) input saldo per akun (auto-suggest dari existing data), (3) balance check + auto-plug Laba Ditahan, (4) confirm & post via `setOpeningBalance()`

- [ ] **Step 1: Create AkuntansiScreen entry component**

Create `src/components/akuntansi/AkuntansiScreen.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { fetchAccountingConfig } from '../../lib/akuntansi/service';
import type { AccountingConfig } from '../../lib/akuntansi/types';
import OpeningBalanceWizard from './OpeningBalanceWizard';

interface Props {
  currentUser: { role: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function AkuntansiScreen({ currentUser, showToast }: Props) {
  const [config, setConfig] = useState<AccountingConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAccountingConfig()
      .then(setConfig)
      .catch(err => {
        console.error(err);
        showToast('Gagal load akuntansi config', 'warning');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-[#43474e]">Memuat...</div>;

  const isOwner = currentUser?.role?.toLowerCase() === 'owner';

  if (!config?.opening_balance_set) {
    if (!isOwner) {
      return (
        <div className="p-8">
          <h1 className="text-xl font-extrabold text-[#012749]">Akuntansi</h1>
          <p className="text-[13px] text-[#43474e] mt-2">
            Setup saldo awal belum dilakukan. Owner perlu setup wizard dulu.
          </p>
        </div>
      );
    }
    return <OpeningBalanceWizard onDone={() => { fetchAccountingConfig().then(setConfig); }} showToast={showToast} />;
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-extrabold text-[#012749]">Akuntansi MSME</h1>
      <p className="text-[13px] text-[#43474e] mt-2">
        Saldo awal sudah di-set per <strong>{config.opening_balance_date}</strong>.
      </p>
      <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-[13px] text-emerald-900">
        ✓ Foundation ready. UI Buku Besar + Trial Balance + Period Close menyusul di Phase 0d.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create OpeningBalanceWizard component (skeleton with all 4 steps)**

Create `src/components/akuntansi/OpeningBalanceWizard.tsx`:

```tsx
import React, { useState } from 'react';
import { setOpeningBalance } from '../../lib/akuntansi/service';
import type { OpeningBalanceLine } from '../../lib/akuntansi/types';

interface Props {
  onDone: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface AccountInput {
  account_code: string;
  account_name: string;
  side: 'DEBIT' | 'CREDIT';
  amount: number;
}

// Initial accounts to capture (subset for Phase 0a; expand in Phase 0d UI)
const DEFAULT_ACCOUNTS: AccountInput[] = [
  { account_code: '1-1110', account_name: 'Kas Toko', side: 'DEBIT', amount: 0 },
  { account_code: '1-1210', account_name: 'BCA Operasional', side: 'DEBIT', amount: 0 },
  { account_code: '1-1220', account_name: 'Mandiri Toko', side: 'DEBIT', amount: 0 },
  { account_code: '1-1310', account_name: 'Lalamove Balance', side: 'DEBIT', amount: 0 },
  { account_code: '1-1400', account_name: 'Piutang Usaha', side: 'DEBIT', amount: 0 },
  { account_code: '1-1510', account_name: 'Persediaan Barang Jadi', side: 'DEBIT', amount: 0 },
  { account_code: '1-2100', account_name: 'Peralatan', side: 'DEBIT', amount: 0 },
  { account_code: '2-1100', account_name: 'Hutang Usaha', side: 'CREDIT', amount: 0 },
  { account_code: '2-2100', account_name: 'Hutang Bank Jangka Panjang', side: 'CREDIT', amount: 0 },
  { account_code: '3-1100', account_name: 'Modal Owner', side: 'CREDIT', amount: 0 },
];

export default function OpeningBalanceWizard({ onDone, showToast }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [balanceDate, setBalanceDate] = useState('2025-05-31');
  const [accounts, setAccounts] = useState<AccountInput[]>(DEFAULT_ACCOUNTS);
  const [submitting, setSubmitting] = useState(false);

  const totalDebit = accounts.filter(a => a.side === 'DEBIT').reduce((s, a) => s + a.amount, 0);
  const totalCredit = accounts.filter(a => a.side === 'CREDIT').reduce((s, a) => s + a.amount, 0);
  const labaDitahanPlug = totalDebit - totalCredit;  // positive = need plug to CREDIT

  function updateAmount(i: number, amount: number) {
    setAccounts(acc => acc.map((a, idx) => idx === i ? { ...a, amount } : a));
  }

  async function handleSubmit() {
    if (submitting) return;

    // Build lines with auto-plug
    const lines: OpeningBalanceLine[] = accounts
      .filter(a => a.amount > 0)
      .map(a => ({ account_code: a.account_code, side: a.side, amount: a.amount }));

    if (labaDitahanPlug !== 0) {
      lines.push({
        account_code: '3-1300',
        side: labaDitahanPlug > 0 ? 'CREDIT' : 'DEBIT',
        amount: Math.abs(labaDitahanPlug),
      });
    }

    setSubmitting(true);
    try {
      await setOpeningBalance(balanceDate, lines);
      showToast('✓ Saldo awal berhasil di-set', 'success');
      onDone();
    } catch (err: any) {
      showToast(`Gagal: ${err.message}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-extrabold text-[#012749] mb-2">Setup Saldo Awal — Wizard</h1>
      <p className="text-[12px] text-[#43474e] mb-6">Mandatory first-time setup sebelum bisa mulai catat transaksi GL.</p>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6 text-[12px]">
        {[1, 2, 3, 4].map(n => (
          <React.Fragment key={n}>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg font-bold ${step === n ? 'bg-rose-100 text-rose-800' : 'bg-white border border-[#e5eeff] text-[#43474e]'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold ${step === n ? 'bg-rose-600 text-white' : 'bg-slate-300 text-white'}`}>{n}</span>
              {n === 1 && 'Tanggal'}
              {n === 2 && 'Input Saldo'}
              {n === 3 && 'Balance Check'}
              {n === 4 && 'Confirm'}
            </div>
            {n < 4 && <span className="text-slate-400">→</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Date */}
      {step === 1 && (
        <div className="bg-white rounded-2xl p-6 border border-[#e5eeff]">
          <label className="block font-bold mb-2 text-[13px]">Tanggal saldo awal *</label>
          <input type="date" value={balanceDate} onChange={e => setBalanceDate(e.target.value)}
            className="w-full max-w-xs border border-[#e5eeff] rounded-lg px-3 py-2 text-[13px]" />
          <p className="text-[11px] text-[#43474e] mt-2">Pakai tanggal sebelum data transaksi tertua (default: 31 Mei 2025, sebelum kasir mulai Juni 2025).</p>
          <button onClick={() => setStep(2)} className="mt-4 bg-[#012749] text-white font-bold px-4 py-2 rounded-lg text-[13px]">Next →</button>
        </div>
      )}

      {/* Step 2: Accounts */}
      {step === 2 && (
        <div className="bg-white rounded-2xl p-6 border border-[#e5eeff]">
          <p className="text-[12px] text-[#43474e] mb-4">Input saldo per akun per <strong>{balanceDate}</strong>. Akun yang tidak relevan biarkan 0.</p>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10px] uppercase font-bold text-[#43474e]">
                <th className="text-left pb-2">Akun</th>
                <th className="text-left pb-2">Side</th>
                <th className="text-right pb-2">Saldo (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a, i) => (
                <tr key={a.account_code} className="border-t border-[#e5eeff]">
                  <td className="py-2"><strong>{a.account_code}</strong> {a.account_name}</td>
                  <td className="py-2 text-[11px]">{a.side}</td>
                  <td className="py-2 text-right">
                    <input type="number" min="0" value={a.amount} onChange={e => updateAmount(i, Number(e.target.value))}
                      className="w-32 border border-[#e5eeff] rounded px-2 py-1 text-right font-bold" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep(1)} className="bg-white border border-[#e5eeff] font-bold px-4 py-2 rounded-lg text-[13px]">← Back</button>
            <button onClick={() => setStep(3)} className="bg-[#012749] text-white font-bold px-4 py-2 rounded-lg text-[13px]">Next: Balance Check →</button>
          </div>
        </div>
      )}

      {/* Step 3: Balance Check */}
      {step === 3 && (
        <div className="bg-white rounded-2xl p-6 border border-[#e5eeff]">
          <h2 className="text-base font-extrabold text-[#012749] mb-3">Balance Check</h2>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between"><span>Total Debit</span><strong className="text-emerald-700">Rp {totalDebit.toLocaleString('id-ID')}</strong></div>
            <div className="flex justify-between"><span>Total Credit</span><strong className="text-rose-700">Rp {totalCredit.toLocaleString('id-ID')}</strong></div>
            <div className="flex justify-between border-t border-[#e5eeff] pt-2"><span>Selisih</span><strong className={Math.abs(labaDitahanPlug) < 1 ? 'text-emerald-700' : 'text-amber-700'}>Rp {Math.abs(labaDitahanPlug).toLocaleString('id-ID')} {labaDitahanPlug !== 0 && '→ auto-plug Laba Ditahan'}</strong></div>
          </div>
          {labaDitahanPlug !== 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-[12px] text-amber-900">
              ⚠ Saldo tidak balance. Sistem auto-plug Rp {Math.abs(labaDitahanPlug).toLocaleString('id-ID')} ke <strong>3-1300 Laba Ditahan</strong> (side: {labaDitahanPlug > 0 ? 'CREDIT' : 'DEBIT'}). Owner boleh edit nilai akun di step 2 kalau ada breakdown akurat.
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep(2)} className="bg-white border border-[#e5eeff] font-bold px-4 py-2 rounded-lg text-[13px]">← Back</button>
            <button onClick={() => setStep(4)} className="bg-[#012749] text-white font-bold px-4 py-2 rounded-lg text-[13px]">Next: Confirm →</button>
          </div>
        </div>
      )}

      {/* Step 4: Confirm + Submit */}
      {step === 4 && (
        <div className="bg-white rounded-2xl p-6 border border-[#e5eeff]">
          <h2 className="text-base font-extrabold text-[#012749] mb-3">Confirm &amp; Post Opening Balance</h2>
          <div className="bg-slate-50 rounded p-4 text-[12px] mb-4">
            <p>Tanggal saldo awal: <strong>{balanceDate}</strong></p>
            <p>Total Debit = Total Credit = <strong>Rp {(totalDebit + (labaDitahanPlug < 0 ? Math.abs(labaDitahanPlug) : 0)).toLocaleString('id-ID')}</strong></p>
            <p className="text-amber-700 mt-2">⚠ Setelah submit, opening balance tidak bisa di-edit. Salah input pakai Penyesuaian di Phase 2.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} disabled={submitting} className="bg-white border border-[#e5eeff] font-bold px-4 py-2 rounded-lg text-[13px]">← Back</button>
            <button onClick={handleSubmit} disabled={submitting} className="bg-rose-600 text-white font-extrabold px-6 py-2 rounded-lg text-[13px]">
              {submitting ? 'Posting...' : '🔒 Post Opening Balance'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire routing — modify `src/lib/urlRoute.ts`**

Add `'akuntansi'` to the `ActivePage` union. Exact location: find `export type ActivePage = ...` and add `| 'akuntansi'`.

- [ ] **Step 4: Wire routing — modify `src/App.tsx`**

Find the screen-routing switch/conditional. Add:

```tsx
{activePage === 'akuntansi' && <AkuntansiScreen currentUser={currentUser} showToast={showToast} />}
```

Plus import at top: `import AkuntansiScreen from './components/akuntansi/AkuntansiScreen';`

- [ ] **Step 5: Add Sidebar entry — modify `src/components/Sidebar.tsx`**

Find the Keuangan group section. Add new entry near "Kas & Bank":

```tsx
<SidebarItem icon="⛁" label="Akuntansi" active={activePage === 'akuntansi'} onClick={() => onNavigate('akuntansi')} />
```

(Match existing SidebarItem pattern in file.)

- [ ] **Step 6: Run tests + tsc verify**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: TS clean, all tests pass, build clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/akuntansi/ src/App.tsx src/lib/urlRoute.ts src/components/Sidebar.tsx
git commit -m "feat(akuntansi): Phase 0a Task 18 — Opening Balance Wizard UI + sidebar routing"
```

---

## Task 19: Final staging validation + acceptance criteria

**Files:** No new files; verification only.

- [ ] **Step 1: Apply all 15 migrations to staging via MCP**

If any migration not yet applied, apply now (sequence #1 → #15).

- [ ] **Step 2: Run full integration test suite**

```bash
npx vitest run tests/integration/akuntansi-phase0a/
```

Expected: all tests PASS.

- [ ] **Step 3: Verify Trial Balance system-wide balanced**

Run via MCP `execute_sql`:

```sql
SELECT
  SUM(total_debit) AS sys_debit,
  SUM(total_credit) AS sys_credit,
  SUM(total_debit) - SUM(total_credit) AS diff
FROM trial_balance;
```

Expected: `diff = 0` (or NULL if no entries yet).

- [ ] **Step 4: Post 10 sample balanced entries via `_post_journal_entry`**

Run via MCP `execute_sql`:

```sql
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..10 LOOP
    PERFORM _post_journal_entry(
      p_entry_date := '2026-08-' || LPAD(i::text, 2, '0'),
      p_source_type := 'BACKFILL'::journal_entry_source,
      p_description := 'staging validation sample #' || i,
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1-1110', 'side', 'DEBIT', 'amount', 100000 * i),
        jsonb_build_object('account_code', '4-1110', 'side', 'CREDIT', 'amount', 100000 * i)
      ),
      p_tenant_id := NULL
    );
  END LOOP;
END $$;
```

Re-verify Trial Balance balanced (step 3 query).

Cleanup:
```sql
DELETE FROM journal_entries WHERE description LIKE 'staging validation sample%';
```

- [ ] **Step 5: Verify general_ledger view returns running_balance correct**

```sql
SELECT account_code, entry_number, entry_date, debit, credit, running_balance
FROM general_ledger
WHERE account_code = '1-1110'
ORDER BY entry_date, posted_at, line_number
LIMIT 20;
```

Manually verify running_balance accumulates correctly.

- [ ] **Step 6: AI-assisted COA review (SAK EMKM check)**

Read seeded COA via MCP:
```sql
SELECT account_code, account_name, account_type, normal_balance, is_control_account
FROM chart_of_accounts WHERE is_system = true ORDER BY account_code;
```

Cross-reference output dengan SAK EMKM standard template (publicly available di references seperti situs DJP, IAI Indonesia). Verify:
- 5 kelompok (1-5) represented
- Normal balance correct per kelompok
- DP, Ikhtisar, Stock Opname, Tax accounts ada
- Tidak ada nama account yang ambigu

- [ ] **Step 7: Update `progress.md`**

Tambah entry di top:

```markdown
## 2026-06-21 — Akuntansi Phase 0a — IMPLEMENTATION COMPLETE

All 15 migrations applied to staging Supabase via MCP. 50 COA accounts seeded SAK EMKM standard. All RPCs (post_journal_entry, close_accounting_period, set_opening_balance, close_fiscal_year, accrue_period_taxes) tested green. Trial Balance system-wide balanced. Opening Balance Wizard UI live di sidebar Akuntansi.

**Files landed:**
- 15 migrations `20260715000001-20260715000015_*.sql`
- 12 integration test files under `tests/integration/akuntansi-phase0a/`
- TypeScript service module `src/lib/akuntansi/`
- 2 React components: `AkuntansiScreen.tsx`, `OpeningBalanceWizard.tsx`
- Sidebar entry + routing wired

**Acceptance criteria** (per spec rev3 section 13): all 11 boxes checked.

**Next:** Phase 0b (parallel-write 3 high-traffic RPC: record_kasir_sale, record_pembayaran, record_piutang_payment) starts after Phase 1 Cash & Bank UI lands setelah review checkpoint dengan user.
```

- [ ] **Step 8: Commit progress update**

```bash
git add progress.md
git commit -m "docs(progress): Akuntansi Phase 0a implementation complete + staging validation pass"
```

---

## Self-Review

**1. Spec coverage check:**
- ✓ COA table (Task 2) — spec §4.1
- ✓ 50 SAK EMKM seed (Task 3) — spec §4.2
- ✓ Parent links (Task 4) — spec §6 migration #3
- ✓ accounting_config (Task 5) — spec §4.3
- ✓ accounting_periods (Task 6) — spec §4.6
- ✓ journal_entries (Task 7) — spec §4.4
- ✓ journal_entry_lines (Task 8) — spec §4.5
- ✓ Validators (Task 9) — spec §5.1, 5.2
- ✓ _post_journal_entry RPC (Task 10) — spec §5.3
- ✓ close_accounting_period (Task 11) — spec §5.4
- ✓ Views (Task 12) — spec §4.7, 4.8
- ✓ Seed COA for cash_accounts (Task 13) — spec §6 migration #12
- ✓ set_opening_balance + wizard (Tasks 14, 18) — spec §5.2
- ✓ close_fiscal_year (Task 15) — spec §5.4
- ✓ accrue_period_taxes (Task 16) — spec §5.5
- ✓ TS service module (Task 17) — implicit infrastructure
- ✓ Final staging validation (Task 19) — spec §13 acceptance criteria

All 13 spec acceptance criteria mapped to a task.

**2. Placeholder scan:** No TBD/TODO/incomplete placeholders. All SQL + TS code blocks contain real content.

**3. Type consistency:** `_post_journal_entry` signature consistent across Task 10 (definition) + Task 14 (set_opening_balance internal call) + Task 15 (close_fiscal_year internal call) + Task 16 (accrue_period_taxes internal call). Source enum `journal_entry_source` used consistently. `OpeningBalanceLine` interface used in service + wizard.

**4. Migration sequence dependencies:** Each task depends on prior tables/RPCs existing. Order is correct:
- Tables before RPCs that reference them
- Validators before _post_journal_entry that uses them
- _post_journal_entry before set_opening_balance / close_fiscal_year / accrue_period_taxes that delegate to it
- Views after journal_entry_lines that they query

No issues found. Plan ready for execution.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-akuntansi-phase0a-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each task gets a clean context so SQL/TS code doesn't pollute future tasks. Two-stage review (subagent reports → I sanity-check → user gate).

**2. Inline Execution** — Execute tasks in this session using superpowers:executing-plans. Batch execution with checkpoints for user review. Faster perceived progress but heavier context usage.

**Which approach do you want?**
