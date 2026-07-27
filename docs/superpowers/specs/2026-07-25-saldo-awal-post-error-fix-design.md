# Saldo Awal post error fix — design

**Date:** 2026-07-25
**Author:** Claude (Opus 4.7) with founder collaboration
**Type:** Bug fix (dual: data hole + class error-masking recurrence)
**Reversibility:** Semi-reversible (2 migrations reversible; FE refactor reversible via revert)
**Cost impact:** Zero (no paid-service, no infra upgrade)
**Incident?** No — pure hygiene (only test tenant affected)

---

## 1. Context

### Reported symptom
Founder (2026-07-24): "tidak bisa setup saldo awal ketika klik post opening balance muncul gagal eror posting."

Toast shown to user: `Gagal post Saldo Awal: [object Object]`.

### Reproduction
`chrome-devtools MCP` on `app.caleo.id`, tenant `toko-jaya-makmur`, `Pengaturan → 🧾 Akuntansi → Buat Saldo Awal → step through wizard → Post`.

- Network reqid=120: `POST /rest/v1/rpc/post_saldo_awal_snapshot` → HTTP 400
- Response body: `{"code":"P0001","details":null,"hint":null,"message":"cash_account 89fce160-accf-4b8c-977b-ed8f84f49dde tidak punya COA link"}`

### Two independent bugs surfaced by this one action

**Bug A — Data (root cause of the RPC failure):** two of three cash_accounts on Toko Jaya Makmur have `coa_account_id = NULL`. The `post_saldo_awal_snapshot` RPC (migration `20261115000147`, lines 122-129) correctly raises when a positive-balance cash account has no COA link.

**Bug B — FE error masking (class recurrence):** `Step4EkuitasPreview.tsx:91` renders errors via `err instanceof Error ? err.message : String(err)`. Supabase `PostgrestError` is a plain object, not an `Error` instance → `String(err) === "[object Object]"`. This masked Bug A completely.

**Bug B is miss-log Entry #4 recurring within 24 hours.** Entry #4 (2026-07-24 morning) fixed the same pattern in `OwnerPinPad.tsx` + `PinPad.tsx`. Prevention rule #3 in that entry said "never render errors via `String(e)`; detect Supabase PostgrestError shape and surface `.message` explicitly." That rule was never audited across the codebase. Per the miss-log feedback protocol in `CLAUDE.md`: **2+ occurrences of the same class = permanent CLAUDE.md rule mandatory**.

---

## 2. Verification / scan results

All verified via Supabase Management API `/v1/projects/{ref}/database/query` before writing this spec.

### Data scan — how many tenants affected?
```sql
SELECT t.slug, count(ca.*), array_agg(ca.id)
FROM cash_accounts ca JOIN tenants t ON t.id = ca.tenant_id
WHERE ca.coa_account_id IS NULL GROUP BY t.slug;
```
Result: exactly one tenant.
| slug | count | ids |
|---|---|---|
| `toko-jaya-makmur` | 2 | BCA Utama `89fce160-accf-4b8c-977b-ed8f84f49dde`, GoPay Merchant `0d449dff-f3f6-4329-ab20-81cf74ad93b3` |

No prod / real-customer tenant has a null. This is test-tenant hygiene, **not an incident**.

### Journal-entry conflict scan (adversarial check per advisor)
```sql
SELECT ca.internal_label, count(jel.id) AS je_lines
FROM cash_accounts ca
LEFT JOIN journal_entry_lines jel
  ON jel.tenant_id = ca.tenant_id
 AND jel.description ILIKE '%' || ca.internal_label || '%'
WHERE ca.coa_account_id IS NULL GROUP BY ca.internal_label;
```
Result: `je_lines = 0` for both. Backfilling `coa_account_id` will not conflict with any historical GL entry.

### Parent-COA presence scan
For Toko Jaya (tenant `22222222-2222-2222-2222-222222222222`):
- `1-1110 Kas Toko` ✓
- `1-1200 Bank` ✓
- `1-1300 E-Wallet` ✓
- No existing `1-12NN` or `1-13NN` sub-COAs → backfill will insert `1-1210 BCA Utama` + `1-1310 GoPay Merchant`.

### FE class-audit
```
grep -rn "instanceof Error ? .* : String(" src/ | grep -v .test. | wc -l
→ 53
```
Zero pre-existing `extractSupabaseError` helper (`grep -rn "extractSupabaseError" src/` returns nothing).

---

## 3. Design

### 3.1 One bundled PR (not split)

All 4 parts ship together. Rationale: (a) small surface each, (b) reviewer sees the coherent story `class fix → data fix → schema hardening → prevention rule`, (c) no shipping value in intermediate states, (d) matches founder's stated preference for bundled changes in similar contexts.

### 3.2 Part 1 — Data backfill migration

**File:** `supabase/migrations/20261115000521_backfill_cash_accounts_coa_link.sql`
**Slot claim:** 521 (next free after 520). Add to `progress.md` slot allocation.
**Ownership:** postgres (needs to write across all tenants unconditionally; not a per-request SECDEF).
**Idempotency:** DO block that skips rows already linked; safe to re-run.

Logic (per row where `coa_account_id IS NULL`):
1. Look up parent COA for the row's tenant:
   - `KAS` → `SELECT id FROM chart_of_accounts WHERE tenant_id = X AND account_code = '1-1110'`
   - `BANK` → parent = `1-1200`
   - `E_WALLET` → parent = `1-1300`
2. If parent missing → `RAISE NOTICE` and skip (don't fail whole migration).
3. For `KAS`, set `coa_account_id = <1-1110 id>` directly (reuse; no new COA).
4. For `BANK` / `E_WALLET`:
   - `SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = <parent> AND account_code LIKE '<prefix>%'`
   - `nextSuffix = 10 + count` (matches `resolveCoaAccountId` convention exactly — `AccountFormModal.tsx:107`)
   - `INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, account_subtype, parent_id, normal_balance, is_system, is_active) VALUES (<t>, '<newcode>', <internal_label>, 'ASET', '<BANK|E_WALLET>', <parent>, 'DEBIT', false, true) RETURNING id`
   - `UPDATE cash_accounts SET coa_account_id = <new-id> WHERE id = <ca-id>`

**Post-migration verification** (inside the same file):
```sql
DO $$ DECLARE v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining FROM public.cash_accounts WHERE coa_account_id IS NULL;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'backfill_cash_accounts_coa_link: % rows still NULL after backfill', v_remaining;
  END IF;
  RAISE NOTICE 'backfill_cash_accounts_coa_link: all cash_accounts linked';
END $$;
```

**Blast radius:** 2 rows updated (Toko Jaya only), 2 new COA rows created. Nothing on real customer tenants.

### 3.3 Part 2 — FE class fix

**New file:** `src/lib/extractSupabaseError.ts`

```typescript
// Detect Supabase PostgrestError shape / standard Error / string / unknown.
// Returns a human-readable message. In dev, prepends [code] for triage.
export interface SupabaseErrorShape {
  message: string;
  code?: string;
  hint?: string | null;
  details?: string | null;
}

function isPostgrestErrorShape(x: unknown): x is SupabaseErrorShape {
  return typeof x === 'object' && x !== null
    && 'message' in x && typeof (x as { message: unknown }).message === 'string';
}

export function extractSupabaseError(err: unknown): string {
  if (err == null) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (isPostgrestErrorShape(err)) {
    const s = err as SupabaseErrorShape;
    if (import.meta.env.DEV && s.code) return `[${s.code}] ${s.message}`;
    return s.message;
  }
  try { return JSON.stringify(err); } catch { return String(err); }
}
```

**Replacements:** All 53 non-test occurrences of `err instanceof Error ? err.message : String(err)` (and shape variants `e instanceof Error ? e.message : String(e)` etc.) → `extractSupabaseError(err)` / `extractSupabaseError(e)`. Import added per file.

**Test coverage:** `src/lib/extractSupabaseError.test.ts` — covers PostgrestError shape, Error instance, string, plain object without `.message`, null, undefined.

### 3.4 Part 2b — Audit script + Stop hook

**New file:** `scripts/audit-supabase-error-extraction.ts`

Greps `src/**/*.{ts,tsx}` (excluding `*.test.*` and `*.spec.*`) for these regex patterns:
- `instanceof Error ? .* : String\(` (the exact broken pattern)
- `String\(\s*(err|e|error|ex)\s*\)` when the preceding lines contain `catch` (broader safety net)
- Bare template `\$\{(err|e|error|ex)\}` inside catch blocks (also stringifies POJOs incorrectly)

Non-zero exit if any hit. Report file + line + snippet.

**`package.json` script:** `"audit:err-extract": "tsx scripts/audit-supabase-error-extraction.ts"`

**`.claude/settings.json` Stop hook:** append `npm run audit:err-extract` to the existing chain that already runs `lint`, `audit:numinput`, `audit:secdef-null-tenant`, `audit:csp-backend-allowlist`, `vitest --changed`.

### 3.5 Part 3 — Schema hardening migration

**File:** `supabase/migrations/20261115000522_cash_accounts_coa_link_not_null.sql`

```sql
-- Slot 522 — schema hardening after slot 521 backfill.
-- Prevents any future cash_account row from being inserted without a COA link.
-- Safe: slot 521 backfilled the only 2 NULL rows in prod (Toko Jaya Makmur).
--
-- Idempotent: SET NOT NULL is a no-op if column is already NOT NULL.

ALTER TABLE public.cash_accounts
  ALTER COLUMN coa_account_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cash_accounts'
      AND column_name='coa_account_id' AND is_nullable='NO'
  ) THEN
    RAISE EXCEPTION 'cash_accounts.coa_account_id NOT NULL verification failed';
  END IF;
END $$;
```

**Rollback:** `ALTER TABLE public.cash_accounts ALTER COLUMN coa_account_id DROP NOT NULL;`

### 3.6 Part 4 — Miss-log + CLAUDE.md rule

**Miss-log Entry #5** appended to `docs/superpowers/miss-log.md`:
- Title: "2026-07-25 — `[object Object]` recurrence 24h after Entry #4 — class-audit missed"
- Body follows established structure: Context, What was missed, Root cause, Prevention, Empirical confirmation, Files updated.
- Cross-reference Entry #4.

**CLAUDE.md permanent rule** added as a new "## FE error rendering (NON-NEGOTIABLE)" section, inserted directly above the existing "## GOTCHAS" section (so it sits with other hard-rule sections, not buried inside SECDEF-specific guidance):

> ### FE error rendering (NON-NEGOTIABLE)
>
> All error rendering to users (toasts, dialogs, panels, banners) MUST use `extractSupabaseError()` from `src/lib/extractSupabaseError.ts`. It detects Supabase `PostgrestError` shape, standard `Error`, string, and unknown — never yielding `[object Object]`.
>
> **Banned in catch blocks:**
> - `String(err)` / `String(e)` / `String(error)`
> - `` `${err}` `` / `` `${e}` `` (bare-template of raw err)
> - `err.toString()` / `e.toString()`
> - `err instanceof Error ? err.message : String(err)` — the classic broken pattern
>
> **Why:** Supabase RPC errors are plain objects, not `Error` instances. Every banned pattern yields `[object Object]` for Supabase errors, hiding the real cause. Miss-log Entries #4 (2026-07-24) and #5 (2026-07-25) both traced back to this class.
>
> **Enforcement:** `npm run audit:err-extract` runs in the Stop hook. CI-blocks new instances.

**`progress.md`** entry:
```
### 2026-07-25 — Saldo Awal post fix + [object Object] class kill
- Fixed: Toko Jaya Makmur cash_accounts.coa_account_id backfill (2 rows) — unblocks Post Saldo Awal
- Class fix: `extractSupabaseError()` helper + 53 FE sites migrated + audit script + Stop hook
- Schema: cash_accounts.coa_account_id NOT NULL (safe after backfill)
- Prevention: CLAUDE.md permanent rule + miss-log Entry #5
- Spec: docs/superpowers/specs/2026-07-25-saldo-awal-post-error-fix-design.md
```

---

## 4. Impact analysis

**Direct FE importers of changed files:**
- `Step4EkuitasPreview.tsx` — only imported by `SaldoAwalWizard.tsx`
- 53 replacement sites are all self-contained toast/dialog handlers; no re-exports

**Indirect callers of `post_saldo_awal_snapshot`:** only `src/lib/saldoAwal/api.ts::postSaldoAwalSnapshot`; only caller of that is `Step4EkuitasPreview.tsx::handleSubmit`. Scope: 1 call site.

**Tests affected:** `tests/integration/akuntansi-phase0a/opening-balance-rpc.test.ts` — must still pass; migration 521 adds COA rows on the test tenant if not already linked (idempotent).

**DB touchpoints:**
- Write: `cash_accounts` (UPDATE 2 rows), `chart_of_accounts` (INSERT 2 rows)
- Schema: `cash_accounts.coa_account_id` NOT NULL constraint

**Verdict:** 1 caller of the failing RPC, 53 FE replacement sites (all mechanical), 2 DB rows updated + 2 inserted, 1 constraint added, 1 new helper file, 1 new audit script, 1 CLAUDE.md rule, 1 miss-log entry. Plan covers all; nothing deferred.

---

## 5. Ship & verify (per CLAUDE.md staged flow)

**Stage 1 — local:**
1. `npm run lint` clean
2. `npm run audit:numinput` clean
3. `npm run audit:secdef-null-tenant` clean
4. `npm run audit:csp-backend-allowlist` clean
5. `npm run audit:err-extract` clean (new — verifies helper adoption)
6. `npx vitest run --changed` green (includes new `extractSupabaseError.test.ts`)
7. Apply migrations 521 + 522 to a Supabase branch first; verify 2 rows backfilled, NOT NULL applied
8. `npm run dev` + chrome MCP: reopen the saldo-awal wizard on Toko Jaya, step through, click Post → expect success toast with JE id
9. Sanity check: intentionally trigger an RPC error somewhere (e.g., duplicate save) → toast should show real error text, not `[object Object]`

**Stage 2 — deploy:**
- Backend migrations: `SUPABASE_PROJECT_REF=ekhhojaezdfjfwuxyjkl scripts/apply-migration.sh 521` then `522`
- Frontend: `git push main` → Cloud Build tag-URL smoke → 100% traffic on 200 OK
- Verify: `gcloud builds list --limit=2` STATUS=SUCCESS

**Stage 3 — prod smoke on Toko Jaya:**
- Chrome MCP against `https://app.caleo.id`, tenant `toko-jaya-makmur`
- Reopen Saldo Awal wizard → step through → Post → expect success + JE row appears in `journal_entries`
- Adjacent regression check: open one other screen (Kasir + Piutang) and confirm nothing broke from the 53-site refactor

**Post-migration:**
- Run `mcp__plugin_supabase_supabase__get_advisors` (or Management API equivalent) → triage any new perf/security findings

**Rollback plan:**
- Migration 522 rollback: `ALTER TABLE cash_accounts ALTER COLUMN coa_account_id DROP NOT NULL`
- Migration 521 rollback: `UPDATE cash_accounts SET coa_account_id = NULL WHERE id IN (<2 backfilled ids>)` + `DELETE FROM chart_of_accounts WHERE account_code IN ('1-1210','1-1310') AND tenant_id = '22222222-...'` (only if intentional revert; not needed under normal fix path)
- FE rollback: `git revert <commit>` — helper file left in place, callers restored

---

## 6. Definition of done

- [ ] All 4 parts merged in one PR
- [ ] Stage 1 audits + tests green
- [ ] Migrations 521 + 522 applied to prod
- [ ] Chrome MCP prod smoke on Toko Jaya: saldo awal posts successfully
- [ ] `mcp__plugin_supabase_supabase__get_advisors` run + findings triaged
- [ ] `progress.md` updated
- [ ] Miss-log Entry #5 committed
- [ ] CLAUDE.md new rule committed
- [ ] `/code-review` run on the diff — findings addressed
- [ ] No new `[object Object]` renders detectable via manual smoke on 2-3 error paths

---

## 7. Out of scope

- **Auto-heal in RPC:** letting `post_saldo_awal_snapshot` create missing COA rows on-the-fly. Considered; rejected as adding SECDEF surface without clear ROI. Defer.
- **UI to edit `coa_account_id` on existing cash_accounts:** the account edit modal (`AccountFormModal.tsx:189-199`) doesn't expose this. Not urgent since NOT NULL prevents future gaps. Defer.
- **Backend Go analog:** Go backend doesn't format Supabase RPC errors for user display — this is purely a FE concern. No changes.
- **Sub-COA numbering conflicts across the "10 + count" convention:** existing implementation could collide if two accounts are created concurrently (race). Not new in this PR; keeps existing behavior. Defer if it ever surfaces.
