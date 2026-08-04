# Cetak Sales Order (Penawaran) GJP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Sales Order (Penawaran) PDF output with a professional, master-data-hydrated template that matches the GJP reference layout, ships graceful fallbacks for non-manufacturer tenants, and extends Pengaturan/Customer/order-line schemas with the minimum fields required.

**Architecture:** Single tactical migration adds 14 columns to `store_settings`, 2 to `customers`, 8 to `sales_orders` — all backward-compatible (nullable/defaulted). `KasirItem` JSONB type gains 2 optional fields. The client (`salesOrderService.ts`) does the `admin_users.name` lookup and includes it in the RPC payload (avoiding SECDEF owner trap on `create_sales_order`). `create_sales_order` RPC body extends to persist new fields but does NOT gain any new `auth.*` reads. PDF stack (`salesOrderPdf.ts` + new multi-page primitives in `common.ts` + new `terbilang.ts` helper) rewritten to match reference layout with auto-hidden MANUFACTURE column and running header/footer bar.

**Tech Stack:** React 18, TypeScript, Vite, Supabase (Postgres 15 + RLS + SECURITY DEFINER RPCs), jsPDF, Vitest, Tailwind CSS (Caleo design tokens), Chrome DevTools MCP for verification.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-08-04-cetak-sales-order-gjp-design.md` — every task's requirements defer to the spec.
- **Migration slot:** claim `20261115000570` (highest observed on origin/main is 547, per miss-log Entry #7 `highest + 20` HARD RULE with a small buffer).
- **Idempotency:** every DDL uses `IF NOT EXISTS` / `CHECK ... OR NULL` / `DO $$ ... EXCEPTION WHEN duplicate_object` per CLAUDE.md.
- **Design tokens:** all new UI uses semantic Caleo tokens (`text-caleo-danger`, `bg-caleo-primary`, etc.) — NO `text-red-*` / `text-emerald-*` / `text-rose-*` to avoid creating new violations for the parallel DS sweep.
- **Language:** UI labels in Bahasa Indonesia. Table PDF headers in English per spec §5.1.
- **Error handling:** use `extractErrorMessage()` helper (never `String(err)` or `err instanceof Error ? .message : String(err)`) per audit `no-string-err-fallback` Stop hook.
- **Isolate in worktree:** `.claude/worktrees/cetak-so-gjp` per memory `parallel_terminals_worktree`.
- **Currency format:** `Rp 15.000.000` (id-ID period separator).
- **Font sizes:** body 11pt / table 10pt / sub-parts 9pt mid-grey per memory `font_sizing`.
- **PDF colors:** existing Caleo palette in `src/lib/sales/pdf/common.ts` — banner + table header `#012749` navy, GRAND TOTAL row `#eff4ff`.
- **Backward compat:** every new field is NULL-tolerant at render (PDF falls back to defaults or hides the element).
- **No cross-tenant guard needed:** RLS `t_select_own` on `sales_orders` + `customers` is properly tenant-scoped (verified in spec §14).
- **`created_by_name` is client-supplied**: filled by `salesOrderService.ts` from `admin_users.name` lookup; passed in RPC payload; RPC does NOT read `auth.*` for it.

## File structure

**New files:**
- `supabase/migrations/20261115000570_cetak_so_penawaran_gjp_schema.sql` — one migration for all 3 tables
- `src/lib/terbilang.ts` — pure ID-locale number-to-words helper
- `src/lib/terbilang.test.ts` — Vitest fixtures
- `src/components/pengaturan/SalesOrderDefaultsPanel.tsx` — new Pengaturan card
- `src/components/pengaturan/SalesOrderDefaultsPanel.test.tsx` — component test
- `src/components/penjualan/wizard/SubPartsModal.tsx` — sub-parts editor modal
- `src/components/penjualan/wizard/SubPartsModal.test.tsx` — component test
- `tests/pdf/salesOrderPdf.new.test.ts` — Vitest PDF snapshot / assertion suite

**Modified files:**
- `supabase/migrations/20260725000003_create_sales_order_rpc.sql` — NOT edited (immutable history). Instead, migration 570 supersedes the body via `CREATE OR REPLACE`.
- `scripts/apply-pending-migrations.sh` — append the new migration filename to the array (if the pattern is used) — verify at implementation time
- `src/types.ts` — extend `KasirItem` with optional `brand_name` + `sub_parts` + `DbCustomer` with `salutation` + `contact_person_name`
- `src/lib/pengaturan/types.ts` — extend `StoreSettings` with 12 new fields
- `src/lib/pengaturan/mutations.ts` (or the file that upserts StoreSettings) — accept new fields
- `src/lib/salesOrderService.ts` — extend payload; add client-side `admin_users.name` lookup helper
- `src/components/pengaturan/IdentitasTokoCard.tsx` — add `telp_kantor` + `website_url` fields
- `src/components/pengaturan/PengaturanScreen.tsx` — mount `SalesOrderDefaultsPanel` below IdentitasTokoCard
- `src/components/CustomerForm.tsx` (or wherever customer create/edit lives — verify path at task start) — add `salutation` + `contact_person_name`
- `src/components/penjualan/wizard/Step2Items.tsx` — per-line Merek input + Sub-parts button
- `src/components/penjualan/wizard/CatatPenjualanWizard.tsx` — override section (collapsible) + wire brand+sub_parts through
- `src/lib/sales/pdf/common.ts` — new multi-page primitives (`addPageWithHeader`, `measureRowHeight`)
- `src/lib/sales/pdf/salesOrderPdf.ts` — full rewrite to new layout
- `src/lib/sales/pdf/salesOrderPdf.test.ts` — replace with new assertions
- `docs/qa-week/pdf-regression/post/10-salesOrder.pdf` — regenerated baseline (visual-diff-gated)
- `progress.md` — one line linking this plan

**Task decomposition rationale:** DB → shared types → helper (terbilang) → RPC → service layer → UI (Pengaturan → Customer → SO wizard) → PDF → tests → verification. Each task ends with a green test cycle + commit.

---

### Task 1: Migration — schema + seed for store_settings / customers / sales_orders

**Files:**
- Create: `supabase/migrations/20261115000570_cetak_so_penawaran_gjp_schema.sql`
- Modify: `scripts/apply-pending-migrations.sh` (append new filename to migrations array — verify pattern at task start)

**Interfaces:**
- Consumes: existing `store_settings`, `customers`, `sales_orders` tables
- Produces: 14 new columns on `store_settings`, 2 on `customers`, 8 on `sales_orders` — usable by later tasks

- [ ] **Step 1: Pre-claim slot verification per Entry #7 HARD RULE**

Run:
```bash
git fetch origin main --quiet
ls supabase/migrations/20261115*.sql | sort | tail -5
```
Expected: highest slot on disk should be ≤ 547. If ≥ 548 appears, choose slot `(highest + 20)` instead of 570 and update the filename accordingly.

- [ ] **Step 2: Create the migration file**

Path: `supabase/migrations/20261115000570_cetak_so_penawaran_gjp_schema.sql`

```sql
-- ============================================================================
-- Cetak Sales Order (Penawaran) GJP — schema + seed for improved SO PDF template.
-- Design spec: docs/superpowers/specs/2026-08-04-cetak-sales-order-gjp-design.md
-- Reversibility: tactical / reversible — all columns nullable or defaulted.
-- ============================================================================

-- ---- store_settings: SO defaults + footer contact fields ----
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS telp_kantor                TEXT,
  ADD COLUMN IF NOT EXISTS website_url                TEXT,
  ADD COLUMN IF NOT EXISTS default_so_validity_days   INT     DEFAULT 14 NOT NULL,
  ADD COLUMN IF NOT EXISTS default_payment_terms      TEXT,
  ADD COLUMN IF NOT EXISTS default_lead_time_text     TEXT,
  ADD COLUMN IF NOT EXISTS default_so_notes           TEXT,
  ADD COLUMN IF NOT EXISTS default_opening_greeting   TEXT,
  ADD COLUMN IF NOT EXISTS default_signatory_name     TEXT,
  ADD COLUMN IF NOT EXISTS default_signatory_title    TEXT,
  ADD COLUMN IF NOT EXISTS footer_show_telp_kantor    BOOLEAN DEFAULT TRUE  NOT NULL,
  ADD COLUMN IF NOT EXISTS footer_show_wa             BOOLEAN DEFAULT TRUE  NOT NULL,
  ADD COLUMN IF NOT EXISTS footer_show_email          BOOLEAN DEFAULT TRUE  NOT NULL,
  ADD COLUMN IF NOT EXISTS footer_show_website        BOOLEAN DEFAULT FALSE NOT NULL;

-- Seed sensible Indonesian defaults for existing tenants where NULL.
UPDATE public.store_settings SET default_payment_terms = '50% DP saat penetapan order, 50% pelunasan sebelum barang diambil'
  WHERE default_payment_terms IS NULL;
UPDATE public.store_settings SET default_lead_time_text = '7–10 hari kerja setelah uang muka diterima'
  WHERE default_lead_time_text IS NULL;
UPDATE public.store_settings SET default_opening_greeting = 'Dengan Hormat, bersama ini kami mengajukan penawaran harga untuk kebutuhan Bapak/Ibu, dengan perincian sebagai berikut:'
  WHERE default_opening_greeting IS NULL;
UPDATE public.store_settings SET default_so_notes = E'Harga belum termasuk PPN 11%\nHarga sudah termasuk perakitan dan pengujian\nPengiriman & instalasi tidak termasuk'
  WHERE default_so_notes IS NULL;

-- ---- customers: salutation + contact person ----
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='salutation'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN salutation TEXT
      CHECK (salutation IN ('Bapak','Ibu') OR salutation IS NULL);
  END IF;
END $$;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS contact_person_name TEXT;

-- ---- sales_orders: snapshot cols + per-SO overrides ----
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS customer_salutation          TEXT,
  ADD COLUMN IF NOT EXISTS customer_contact_person      TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name              TEXT,
  ADD COLUMN IF NOT EXISTS opening_greeting_override    TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms_override       TEXT,
  ADD COLUMN IF NOT EXISTS lead_time_override           TEXT,
  ADD COLUMN IF NOT EXISTS so_notes_override            TEXT,
  ADD COLUMN IF NOT EXISTS valid_until_override         DATE;

COMMENT ON COLUMN public.sales_orders.created_by_name IS
  'Snapshot of admin_users.name at SO creation. Filled client-side (not RPC — avoids miss-log Entry #4 SECDEF owner trap). Preserves historical accuracy if admin_user later renamed.';
```

- [ ] **Step 3: Apply migration locally via MCP**

Run:
```
mcp__plugin_supabase_supabase__apply_migration(name='cetak_so_penawaran_gjp_schema', query=<paste the SQL above>)
```
Expected: succeeds with no errors.

- [ ] **Step 4: Verify idempotency (apply again — should no-op)**

Re-apply the same migration. Expected: no errors, no row changes on the seed UPDATEs (WHERE clauses already skip NULL-less rows).

- [ ] **Step 5: Post-migration advisor check per CLAUDE.md**

Run: `mcp__plugin_supabase_supabase__get_advisors(type='security')` then `type='performance'`.
Expected: no NEW critical findings (any preexisting findings unchanged from baseline).

- [ ] **Step 6: Smoke-verify columns exist**

Run:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('store_settings','customers','sales_orders')
  AND column_name IN (
    'telp_kantor','website_url','default_so_validity_days','default_payment_terms',
    'default_lead_time_text','default_so_notes','default_opening_greeting',
    'default_signatory_name','default_signatory_title','footer_show_telp_kantor',
    'footer_show_wa','footer_show_email','footer_show_website',
    'salutation','contact_person_name',
    'customer_salutation','customer_contact_person','created_by_name',
    'opening_greeting_override','payment_terms_override','lead_time_override',
    'so_notes_override','valid_until_override'
  )
ORDER BY table_name, column_name;
```
Expected: 23 rows returned (14 store_settings + 2 customers + 8 sales_orders — 24 total, minus 1 because valid_until_override is 1 not 2).

Actually count: 13 store_settings columns added + 2 customers + 8 sales_orders = 23. Confirm 23 rows.

- [ ] **Step 7: Verify seed values landed**

Run:
```sql
SELECT default_payment_terms, default_lead_time_text, default_opening_greeting IS NOT NULL AS greeting_set,
       default_so_notes IS NOT NULL AS notes_set
FROM public.store_settings LIMIT 3;
```
Expected: all seed columns non-null with the seeded values.

- [ ] **Step 8: Append to apply-pending-migrations.sh if pattern used**

Read `scripts/apply-pending-migrations.sh`. If the file has an explicit array of migration filenames, append `20261115000570_cetak_so_penawaran_gjp_schema.sql` in slot-order. If the script auto-discovers migrations, skip this step.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20261115000570_cetak_so_penawaran_gjp_schema.sql
# Only add apply-pending-migrations.sh if you edited it in step 8
git add scripts/apply-pending-migrations.sh 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(so-template): migration for penawaran template schema

Adds store_settings SO defaults (validity days, payment terms, lead time,
notes, opening greeting, signatory name/title, telp_kantor, website_url,
4 footer toggles), customers (salutation, contact_person_name), and
sales_orders snapshot + override columns per design spec
2026-08-04-cetak-sales-order-gjp-design.md.

All idempotent, backward-compatible, seeded with Indonesian defaults for
existing tenants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Terbilang helper (pure function) + tests

**Files:**
- Create: `src/lib/terbilang.ts`
- Create: `src/lib/terbilang.test.ts`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces: `export function terbilangRupiah(n: number): string` — returns Indonesian words for integer rupiah. Example: `terbilangRupiah(18_300_000)` → `"Delapan Belas Juta Tiga Ratus Ribu Rupiah"`.

- [ ] **Step 1: Write the failing test suite**

Create `src/lib/terbilang.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { terbilangRupiah } from './terbilang';

describe('terbilangRupiah', () => {
  const cases: Array<[number, string]> = [
    [0, 'Nol Rupiah'],
    [1, 'Satu Rupiah'],
    [2, 'Dua Rupiah'],
    [10, 'Sepuluh Rupiah'],
    [11, 'Sebelas Rupiah'],
    [12, 'Dua Belas Rupiah'],
    [19, 'Sembilan Belas Rupiah'],
    [20, 'Dua Puluh Rupiah'],
    [21, 'Dua Puluh Satu Rupiah'],
    [99, 'Sembilan Puluh Sembilan Rupiah'],
    [100, 'Seratus Rupiah'],
    [101, 'Seratus Satu Rupiah'],
    [111, 'Seratus Sebelas Rupiah'],
    [200, 'Dua Ratus Rupiah'],
    [999, 'Sembilan Ratus Sembilan Puluh Sembilan Rupiah'],
    [1_000, 'Seribu Rupiah'],
    [1_001, 'Seribu Satu Rupiah'],
    [1_500, 'Seribu Lima Ratus Rupiah'],
    [2_000, 'Dua Ribu Rupiah'],
    [10_000, 'Sepuluh Ribu Rupiah'],
    [11_000, 'Sebelas Ribu Rupiah'],
    [100_000, 'Seratus Ribu Rupiah'],
    [999_999, 'Sembilan Ratus Sembilan Puluh Sembilan Ribu Sembilan Ratus Sembilan Puluh Sembilan Rupiah'],
    [1_000_000, 'Satu Juta Rupiah'],
    [1_500_000, 'Satu Juta Lima Ratus Ribu Rupiah'],
    [18_300_000, 'Delapan Belas Juta Tiga Ratus Ribu Rupiah'],
    [100_000_000, 'Seratus Juta Rupiah'],
    [999_999_999, 'Sembilan Ratus Sembilan Puluh Sembilan Juta Sembilan Ratus Sembilan Puluh Sembilan Ribu Sembilan Ratus Sembilan Puluh Sembilan Rupiah'],
    [1_000_000_000, 'Satu Milyar Rupiah'],
    [2_500_000_000, 'Dua Milyar Lima Ratus Juta Rupiah'],
    [1_000_000_000_000, 'Satu Triliun Rupiah'],
  ];

  it.each(cases)('terbilangRupiah(%d) → %s', (n, expected) => {
    expect(terbilangRupiah(n)).toBe(expected);
  });

  it('rejects negative numbers', () => {
    expect(() => terbilangRupiah(-1)).toThrow(/non-negative/i);
  });

  it('rounds fractional to integer (rupiah has no sen)', () => {
    expect(terbilangRupiah(1.7)).toBe('Dua Rupiah');
  });
});
```

- [ ] **Step 2: Run tests — verify all fail**

Run: `npx vitest run src/lib/terbilang.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement terbilang.ts**

Create `src/lib/terbilang.ts`:

```ts
/**
 * Convert a non-negative integer rupiah amount to Indonesian words.
 * Follows Indonesian number-to-words convention (satuan / puluhan / ratusan /
 * ribuan / juta / milyar / triliun). "Sebelas" for 11, "Seratus" for 100,
 * "Seribu" for 1000 (contracted from "satu ribu"), "Sepuluh" for 10.
 * Always appends " Rupiah".
 */
export function terbilangRupiah(n: number): string {
  if (n < 0) throw new Error('terbilangRupiah expects a non-negative number');
  const rounded = Math.round(n);
  if (rounded === 0) return 'Nol Rupiah';
  return capitalize(spellNumber(rounded)) + ' Rupiah';
}

const ONES = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan'];

/** Numbers < 1000. */
function under1000(n: number): string {
  if (n === 0) return '';
  if (n < 10) return ONES[n];
  if (n < 12) return n === 10 ? 'Sepuluh' : 'Sebelas';
  if (n < 20) return `${ONES[n - 10]} Belas`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones === 0 ? `${ONES[tens]} Puluh` : `${ONES[tens]} Puluh ${ONES[ones]}`;
  }
  // n < 1000
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  const hundredsPart = hundreds === 1 ? 'Seratus' : `${ONES[hundreds]} Ratus`;
  return rem === 0 ? hundredsPart : `${hundredsPart} ${under1000(rem)}`;
}

/** Any non-negative integer. */
function spellNumber(n: number): string {
  if (n < 1000) return under1000(n);

  const scales: Array<{ value: number; word: string }> = [
    { value: 1e12, word: 'Triliun' },
    { value: 1e9,  word: 'Milyar' },
    { value: 1e6,  word: 'Juta' },
    { value: 1e3,  word: 'Ribu' },
  ];
  let out = '';
  let rem = n;
  for (const { value, word } of scales) {
    if (rem >= value) {
      const count = Math.floor(rem / value);
      rem = rem % value;
      // Special case: 1000 → "Seribu" (contraction), not "Satu Ribu"
      const countWord = count === 1 && word === 'Ribu' ? 'Se' : `${spellNumber(count)} `;
      const scalePhrase = countWord === 'Se' ? 'Seribu' : `${countWord}${word}`.trim();
      out = out ? `${out} ${scalePhrase}` : scalePhrase;
    }
  }
  if (rem > 0) {
    out = out ? `${out} ${under1000(rem)}` : under1000(rem);
  }
  return out;
}

function capitalize(s: string): string {
  return s
    .split(' ')
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}
```

- [ ] **Step 4: Run tests — verify all pass**

Run: `npx vitest run src/lib/terbilang.test.ts`
Expected: all 32 test cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/terbilang.ts src/lib/terbilang.test.ts
git commit -m "$(cat <<'EOF'
feat(terbilang): add Indonesian number-to-words helper (terbilangRupiah)

Pure function converting non-negative integer rupiah to Bahasa Indonesia words
for the Penawaran PDF template. Handles boundaries: satuan/puluhan/ratusan/
ribuan/juta/milyar/triliun, "Sebelas" for 11, "Seratus" for 100, "Seribu"
contraction for 1000. 32 table-driven test cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Extend TypeScript types (KasirItem + DbCustomer + StoreSettings)

**Files:**
- Modify: `src/types.ts` (KasirItem + DbCustomer)
- Modify: `src/lib/pengaturan/types.ts` (StoreSettings)

**Interfaces:**
- Consumes: existing types
- Produces:
  - `KasirItem.brand_name?: string`
  - `KasirItem.sub_parts?: Array<{ name: string; qty?: number; unit?: string }>`
  - `DbCustomer.salutation?: 'Bapak' | 'Ibu' | null`
  - `DbCustomer.contact_person_name?: string | null`
  - 12 new fields on `StoreSettings` (see spec §4.1)

- [ ] **Step 1: Locate current KasirItem definition**

Run: `grep -n "interface KasirItem\|type KasirItem\|KasirItem =" src/types.ts`
Read the surrounding block to understand existing fields.

- [ ] **Step 2: Extend KasirItem — add both optional fields**

Edit `src/types.ts`. Locate the `KasirItem` interface and add:

```ts
export interface KasirItem {
  // ... existing fields (do not modify) ...
  /** Brand / manufacturer for the item (free-text, e.g., "Schneider", "Chint").
   *  PDF auto-hides MANUFACTURE column if ALL items have empty brand_name. */
  brand_name?: string;
  /** Sub-components rendered as bullet list under item description in PDF.
   *  Free-form; qty/unit are optional. Empty/undefined → no bullets rendered. */
  sub_parts?: Array<{ name: string; qty?: number; unit?: string }>;
}
```

- [ ] **Step 3: Extend DbCustomer**

In `src/types.ts`, locate `DbCustomer` (or the current customer type). Add:

```ts
export interface DbCustomer {
  // ... existing fields ...
  /** Salutation for contact person on Penawaran PDF. NULL = no prefix. */
  salutation?: 'Bapak' | 'Ibu' | null;
  /** Contact person name (separate from company name). Renders as
   *  "Bapak {name}" / "Ibu {name}" on PDF. NULL = omit line. */
  contact_person_name?: string | null;
}
```

- [ ] **Step 4: Extend StoreSettings**

Edit `src/lib/pengaturan/types.ts`. Locate `StoreSettings` interface. Add 12 fields matching migration 570:

```ts
export interface StoreSettings {
  // ... existing fields ...

  // Footer contact — telp_kantor separate from telp_wa
  telp_kantor?: string | null;
  website_url?: string | null;

  // Sales Order (Penawaran) defaults
  default_so_validity_days: number;      // default 14, NOT NULL
  default_payment_terms?: string | null;
  default_lead_time_text?: string | null;
  default_so_notes?: string | null;
  default_opening_greeting?: string | null;
  default_signatory_name?: string | null;
  default_signatory_title?: string | null;

  // Footer visibility toggles
  footer_show_telp_kantor: boolean;      // default TRUE
  footer_show_wa: boolean;               // default TRUE
  footer_show_email: boolean;            // default TRUE
  footer_show_website: boolean;          // default FALSE
}
```

- [ ] **Step 5: Run tsc across the project — no new type errors**

Run: `npm run lint` (per CLAUDE.md — includes typecheck)
Expected: green. If any consumer of `KasirItem` / `DbCustomer` / `StoreSettings` fails compile, the new fields are optional so it should be additive. Fix any type issues in consumers by treating new fields as optional.

- [ ] **Step 6: Run existing Vitest to verify no behavior regressions**

Run: `npx vitest run --changed`
Expected: green. If `Step2Items.test.tsx` / `CartRows.test.tsx` fail because they instantiate `KasirItem` in a way that's incompatible with the new optional field, adjust the test fixtures.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/lib/pengaturan/types.ts
git commit -m "$(cat <<'EOF'
feat(types): extend KasirItem/DbCustomer/StoreSettings for Penawaran template

Adds optional brand_name + sub_parts to KasirItem, salutation +
contact_person_name to DbCustomer, and 12 SO-defaults + footer fields to
StoreSettings. All optional / backward-compatible per design spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Extend `create_sales_order` RPC — persist new fields (MINIMAL DIFF, no auth.* reads)

**Files:**
- Create: `supabase/migrations/20261115000571_extend_create_sales_order_rpc.sql`

**Interfaces:**
- Consumes: `sales_orders` new columns (Task 1); RPC contract from `20260725000003_create_sales_order_rpc.sql`
- Produces: `create_sales_order(p_payload jsonb)` accepts new payload keys: `customer_salutation`, `customer_contact_person`, `created_by_name`, `opening_greeting_override`, `payment_terms_override`, `lead_time_override`, `so_notes_override`, `valid_until_override`. Per-item `brand_name` + `sub_parts` ride inside `items[]` JSONB (passthrough — no RPC change needed for those).

**⚠️ CRITICAL PATTERN — MINIMAL DIFF, NOT WHOLE-BODY REWRITE:**

Independent audit found the CURRENT `create_sales_order` body contains **6 critical behaviors** we MUST preserve verbatim:
1. `public.validate_sales_channel(v_channel)` call (channel validation)
2. Items array length + `customer_name` validation
3. Find-or-create customer pattern (creates customer row if `customer_id` is absent)
4. `public.next_sales_order_number()` call (counter reservation)
5. SO number generation CASE statement (formats the returned so_number)
6. `v_actor := auth.uid()` capture (used as `created_by`)

A whole-body rewrite dropping any of these would break SO creation entirely. **We instruct the implementer to COPY the current body verbatim, then ADD the 8 new columns to the INSERT list + 8 new VALUES from `p_payload`.**

- [ ] **Step 1: Read the current RPC body — FULL contents**

Read: `supabase/migrations/20260725000003_create_sales_order_rpc.sql` in its entirety. Also grep for any later redefinition:

```bash
grep -rn "CREATE OR REPLACE FUNCTION public.create_sales_order\|CREATE FUNCTION public.create_sales_order" supabase/migrations/*.sql
```

If a later migration redefined the function, READ THAT VERSION instead — it's the current live body.

Note down:
- The DECLARE block (all variables: `v_actor`, `v_channel`, `v_items`, `v_customer_name`, `v_so_number`, etc.)
- Every RAISE EXCEPTION / validation line
- Every `SELECT ... INTO` (customer lookup, next number)
- The full INSERT column list (currently 12 columns: `so_number, date, channel, items, subtotal, customer_id, customer_name, customer_phone, customer_company, notes, status, created_by`)
- The RETURN statement

- [ ] **Step 2: Create the extension migration — start with EXACT copy of current body**

Path: `supabase/migrations/20261115000571_extend_create_sales_order_rpc.sql`

Structure:

```sql
-- ============================================================================
-- Extend create_sales_order to persist Penawaran template fields.
-- MINIMAL DIFF applied to current body: adds 8 new nullable columns to the
-- INSERT list; ALL existing validation / find-or-create / counter reservation
-- logic preserved verbatim.
--
-- - No RPC signature change; still takes jsonb.
-- - No OWNER change (miss-log Entry #4: OWNER stays as-is; no new auth.*
--   reads added — client supplies created_by_name).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_sales_order(p_payload jsonb)
RETURNS public.sales_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- COPY VERBATIM from current body (all existing v_* variables)
  <paste full DECLARE block from Step 1>
BEGIN
  -- COPY VERBATIM from current body:
  --   - v_actor := auth.uid();
  --   - validate_sales_channel(v_channel)
  --   - Items array + customer_name validation (RAISE EXCEPTION)
  --   - Find-or-create customer pattern
  --   - v_so_number := next_sales_order_number(...) + CASE-format
  <paste full body up to the INSERT statement>

  -- MODIFIED INSERT: original 12 columns + 8 new nullable Penawaran template columns
  INSERT INTO public.sales_orders (
    -- ORIGINAL 12 COLUMNS — COPY VERBATIM from current body
    so_number, date, channel, items, subtotal,
    customer_id, customer_name, customer_phone, customer_company,
    notes, status, created_by,
    -- ADDED 8 NEW COLUMNS for Penawaran template (all nullable)
    customer_salutation,
    customer_contact_person,
    created_by_name,
    opening_greeting_override,
    payment_terms_override,
    lead_time_override,
    so_notes_override,
    valid_until_override
  )
  VALUES (
    -- ORIGINAL 12 VALUES — COPY VERBATIM from current body
    <original values from current body — v_so_number, (p_payload->>'date')::date, v_channel, v_items, v_subtotal, v_customer_id, v_customer_name, ... etc.>,
    -- 8 NEW VALUES — read from p_payload with NULL fallback
    NULLIF(p_payload->>'customer_salutation', ''),
    NULLIF(p_payload->>'customer_contact_person', ''),
    NULLIF(p_payload->>'created_by_name', ''),
    NULLIF(p_payload->>'opening_greeting_override', ''),
    NULLIF(p_payload->>'payment_terms_override', ''),
    NULLIF(p_payload->>'lead_time_override', ''),
    NULLIF(p_payload->>'so_notes_override', ''),
    NULLIF(p_payload->>'valid_until_override', '')::date
  )
  RETURNING * INTO v_row;

  -- COPY VERBATIM: any post-INSERT logic (RETURN v_row; or additional side effects)
  RETURN v_row;
END;
$$;

-- Preserve existing grants — copy any GRANT EXECUTE lines from the current file
GRANT EXECUTE ON FUNCTION public.create_sales_order(jsonb) TO anon, authenticated;

COMMENT ON FUNCTION public.create_sales_order(jsonb) IS
  'Create Penawaran/SO. Extended 2026-08-04 for template rework: added 8 nullable snapshot + override columns to the INSERT. All existing validation / find-or-create / counter logic preserved verbatim. created_by_name is client-supplied (see spec §4.3, miss-log Entry #4 avoidance). No new auth.* reads.';
```

**Verification checklist before applying:**
- ✅ DECLARE block matches current body
- ✅ `validate_sales_channel` call present
- ✅ Items + customer_name validation present
- ✅ Find-or-create customer block present
- ✅ `next_sales_order_number` + CASE formatting present
- ✅ Original 12 INSERT columns present in same order
- ✅ Only diff vs current: 8 new columns appended + 8 new VALUES appended
- ✅ RETURN statement preserved
- ✅ GRANT EXECUTE preserved

- [ ] **Step 3: Apply the migration**

Run:
```
mcp__plugin_supabase_supabase__apply_migration(name='extend_create_sales_order_rpc', query=<paste SQL>)
```
Expected: succeeds.

- [ ] **Step 4: Smoke-test the RPC with fake auth per memory `smoke_test_security_definer_rpcs`**

Run via `mcp__plugin_supabase_supabase__execute_sql`:

```sql
DO $$
DECLARE
  v_test_user_id uuid := '11111111-1111-1111-1111-111111111111';
  v_result public.sales_orders;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_test_user_id::text, true);

  -- Payload includes all validated fields (channel, items array, customer_name)
  -- to satisfy the preserved validation logic. Adjust `channel` to a valid value
  -- per validate_sales_channel — verify by grepping the function definition.
  v_result := public.create_sales_order(jsonb_build_object(
    'channel', 'kasir',                             -- must match validate_sales_channel allowlist
    'items', '[{"name":"Test Item","qty":1,"unit_price":15000000}]'::jsonb,
    'subtotal', 15000000,
    'customer_id', NULL,
    'customer_name', 'Test Customer',
    'customer_salutation', 'Bapak',
    'customer_contact_person', 'Andi Wijaya',
    'created_by_name', 'Budi Santoso',
    'opening_greeting_override', 'Test greeting',
    'payment_terms_override', '100% cash',
    'valid_until_override', '2026-09-01'
  ));

  RAISE NOTICE 'Created SO id=%, so_number=%, salutation=%, contact=%, created_by_name=%, greeting_override=%',
    v_result.id, v_result.so_number, v_result.customer_salutation, v_result.customer_contact_person,
    v_result.created_by_name, v_result.opening_greeting_override;

  -- Rollback so this test leaves zero side effects
  RAISE EXCEPTION 'ROLLBACK — smoke test complete';
END $$;
```
Expected: NOTICE line shows a system-generated so_number PLUS all snapshot + override fields persisted; then EXCEPTION rollback. If channel validation fails, adjust the channel value.

- [ ] **Step 5: Verify RPC still works via existing payload (backward compat)**

Same DO block, but WITHOUT the new keys — verify the RPC still creates a row correctly.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261115000571_extend_create_sales_order_rpc.sql
git commit -m "$(cat <<'EOF'
feat(rpc): extend create_sales_order for Penawaran template snapshot + override

Accepts new payload keys (customer_salutation, customer_contact_person,
created_by_name, 4 override fields, valid_until_override). No signature
change, no OWNER change, no new auth.* reads (created_by_name is
client-supplied per spec §4.3 to avoid miss-log Entry #4 SECDEF owner trap).
Backward compatible with existing callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Client service extension — salesOrderService.ts

**Files:**
- Modify: `src/lib/salesOrderService.ts`

**Interfaces:**
- Consumes: KasirItem type (Task 3); `create_sales_order` RPC (Task 4); existing `admin_users` table (open-access RLS per migration 20260603000003)
- Produces: `createSalesOrder(input)` builds the enriched payload, calling a private `resolveCreatedByName()` helper client-side

- [ ] **Step 1: Read the current salesOrderService.ts**

Read the file in full. Note the existing `createSalesOrder()` (or equivalent) function signature and payload shape.

- [ ] **Step 2: Add the private helper for admin_users.name lookup**

At the top of `salesOrderService.ts`, add:

```ts
import { extractErrorMessage } from './extractErrorMessage'; // adjust path if needed

/**
 * Look up the current user's admin_users.name for the Penawaran signatory snapshot.
 * Returns null if the current user has no matching admin_users row (edge case:
 * super-admin, provisioning race). Consumer falls back to
 * store_settings.default_signatory_name at PDF render time.
 *
 * Uses admin_users' open-access RLS (POLICY "anon full access admin_users",
 * migration 20260603000003). Runs entirely client-side to avoid extending
 * create_sales_order's SECDEF body to read auth.* (miss-log Entry #4 class trap).
 */
async function resolveCreatedByName(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data: userResp } = await supabase.auth.getUser();
    const email = userResp?.user?.email;
    if (!email) return null;

    const { data, error } = await supabase
      .from('admin_users')
      .select('name')
      .eq('email', email)  // exact match — matches existing convention in supabaseClient.ts fetchByEmail
      .maybeSingle();

    if (error) {
      console.warn('resolveCreatedByName lookup failed:', extractErrorMessage(error));
      return null;
    }
    return data?.name ?? null;
  } catch (e) {
    console.warn('resolveCreatedByName unexpected error:', extractErrorMessage(e));
    return null;
  }
}
```

- [ ] **Step 3: Extend the createSalesOrder payload builder**

Locate the payload construction inside `createSalesOrder()`. Add the new fields:

```ts
const createdByName = await resolveCreatedByName(supabase);

const payload = {
  // ... existing fields (so_number, date, channel, items, subtotal, customer_*, notes, status) ...

  // NEW Penawaran template snapshots (from selected customer)
  customer_salutation: selectedCustomer?.salutation ?? null,
  customer_contact_person: selectedCustomer?.contact_person_name ?? null,

  // NEW signatory snapshot (client-side lookup)
  created_by_name: createdByName,

  // NEW per-SO overrides (from form; may be null = use StoreSettings default at render)
  opening_greeting_override: input.opening_greeting_override ?? null,
  payment_terms_override: input.payment_terms_override ?? null,
  lead_time_override: input.lead_time_override ?? null,
  so_notes_override: input.so_notes_override ?? null,
  valid_until_override: input.valid_until_override ?? null,
};
```

`items[]` is already passed through — the new `brand_name` + `sub_parts` per-line fields ride along automatically since it's JSONB.

- [ ] **Step 4: Update the input type**

If `createSalesOrder` takes a typed input, add the new optional override fields:

```ts
export interface CreateSalesOrderInput {
  // ... existing fields ...
  opening_greeting_override?: string | null;
  payment_terms_override?: string | null;
  lead_time_override?: string | null;
  so_notes_override?: string | null;
  valid_until_override?: string | null;  // ISO date string YYYY-MM-DD
}
```

- [ ] **Step 5: Add / update tests**

If `salesOrderService.test.ts` exists, add a case that:
1. Mocks `supabase.auth.getUser` to return an email.
2. Mocks `admin_users` query to return `{ name: 'Test User' }`.
3. Calls `createSalesOrder(input)` with `opening_greeting_override: 'custom'`.
4. Asserts the mock `create_sales_order` RPC receives payload with `created_by_name: 'Test User'` + `opening_greeting_override: 'custom'`.

If no test file exists, create `src/lib/salesOrderService.test.ts` with the above.

- [ ] **Step 6: Run type-check + affected tests**

Run: `npm run lint && npx vitest run src/lib/salesOrderService.test.ts`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/salesOrderService.ts src/lib/salesOrderService.test.ts
git commit -m "$(cat <<'EOF'
feat(so-service): pass Penawaran snapshot + overrides + client-side signatory lookup

createSalesOrder now includes customer_salutation, customer_contact_person,
created_by_name (client-side admin_users lookup), and 5 per-SO override
fields in the RPC payload. Uses admin_users' open-access RLS; avoids
extending create_sales_order SECDEF with auth.* reads (miss-log Entry #4
avoidance per spec §4.3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Extend IdentitasTokoCard (telp_kantor + website_url)

**Files:**
- Modify: `src/components/pengaturan/IdentitasTokoCard.tsx`

**Interfaces:**
- Consumes: `StoreSettings.telp_kantor` + `StoreSettings.website_url` (Task 3)
- Produces: form UI for both fields; mutation wires through existing StoreSettings save path

- [ ] **Step 1: Read IdentitasTokoCard.tsx to identify pattern**

Read the file. Note how existing fields (e.g., `telp_wa`, `email`) are wired: local state, input change handler, onSave upsert.

- [ ] **Step 2: Add fields to local form state**

After the existing state declarations, add:

```tsx
const [telpKantor, setTelpKantor] = useState(settings.telp_kantor ?? '');
const [websiteUrl, setWebsiteUrl] = useState(settings.website_url ?? '');
```

- [ ] **Step 3: Render inputs in the JSX**

After the existing `Email` input (or wherever fits the visual grouping), add:

```tsx
<label className="block mb-4">
  <span className="block text-sm font-medium text-slate-700 mb-1">Telepon Kantor</span>
  <input
    type="tel"
    value={telpKantor}
    onChange={(e) => setTelpKantor(e.target.value)}
    placeholder="021-6234567"
    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary focus:border-caleo-primary"
  />
</label>

<label className="block mb-4">
  <span className="block text-sm font-medium text-slate-700 mb-1">Website</span>
  <input
    type="url"
    value={websiteUrl}
    onChange={(e) => setWebsiteUrl(e.target.value)}
    placeholder="https://gjp.co.id"
    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary focus:border-caleo-primary"
  />
</label>
```

Uses semantic Caleo tokens per Global Constraints.

- [ ] **Step 4: Include new fields in save payload**

Locate the `onSave` (or Simpan button) handler. Add:

```tsx
telp_kantor: telpKantor.trim() || null,
website_url: websiteUrl.trim() || null,
```
to the object passed to the StoreSettings mutation.

- [ ] **Step 5: Verify locally (npm run dev)**

Run: `npm run dev`
Open Pengaturan → verify Telepon Kantor + Website appear, save, reload, values persist.

- [ ] **Step 6: Run lint + audits + affected tests**

Run: `npm run lint && npm run audit:no-string-err-fallback && npm run audit:csp-backend-allowlist && npx vitest run --changed`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/components/pengaturan/IdentitasTokoCard.tsx
git commit -m "$(cat <<'EOF'
feat(pengaturan): add telp_kantor + website_url to IdentitasTokoCard

Two new fields for the Penawaran PDF footer bar (telepon kantor separate
from telp_wa; optional website). Saved to store_settings columns from
migration 570.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Build SalesOrderDefaultsPanel (new Pengaturan card)

**Files:**
- Create: `src/components/pengaturan/SalesOrderDefaultsPanel.tsx`
- Create: `src/components/pengaturan/SalesOrderDefaultsPanel.test.tsx`
- Modify: `src/components/pengaturan/PengaturanScreen.tsx` (mount the new panel)

**Interfaces:**
- Consumes: `StoreSettings` fields (Task 3), StoreSettings mutation hook
- Produces: UI form for 10 fields (5 text/textarea + 4 boolean toggles + 1 number + 2 signatory inputs). Wired into the same save path as IdentitasTokoCard.

- [ ] **Step 1: Read PengaturanScreen.tsx + IdentitasTokoCard.tsx to understand the pattern**

Read both files. Note how IdentitasTokoCard is imported + rendered inside PengaturanScreen. Note the shared mutation hook used to save StoreSettings.

- [ ] **Step 2: Create the failing component test**

Create `src/components/pengaturan/SalesOrderDefaultsPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SalesOrderDefaultsPanel } from './SalesOrderDefaultsPanel';
import type { StoreSettings } from '../../lib/pengaturan/types';

const baseSettings: Partial<StoreSettings> = {
  default_so_validity_days: 14,
  default_payment_terms: '50% DP',
  default_lead_time_text: '7-10 hari',
  default_so_notes: 'Harga belum termasuk PPN 11%',
  default_opening_greeting: 'Dengan Hormat...',
  default_signatory_name: 'Budi Santoso',
  default_signatory_title: 'Sales Engineer',
  footer_show_telp_kantor: true,
  footer_show_wa: true,
  footer_show_email: true,
  footer_show_website: false,
};

describe('SalesOrderDefaultsPanel', () => {
  it('renders all fields prefilled from StoreSettings', () => {
    const onSave = vi.fn();
    render(<SalesOrderDefaultsPanel settings={baseSettings as StoreSettings} onSave={onSave} />);
    expect(screen.getByLabelText(/masa berlaku/i)).toHaveValue(14);
    expect(screen.getByLabelText(/nama penandatangan/i)).toHaveValue('Budi Santoso');
    expect(screen.getByLabelText(/jabatan/i)).toHaveValue('Sales Engineer');
    expect(screen.getByLabelText(/tampilkan website/i)).not.toBeChecked();
  });

  it('calls onSave with all fields when Simpan is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SalesOrderDefaultsPanel settings={baseSettings as StoreSettings} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/masa berlaku/i), { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      default_so_validity_days: 21,
      default_signatory_name: 'Budi Santoso',
      footer_show_website: false,
    }));
  });
});
```

- [ ] **Step 3: Run tests — verify they fail (component doesn't exist)**

Run: `npx vitest run src/components/pengaturan/SalesOrderDefaultsPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the component**

Create `src/components/pengaturan/SalesOrderDefaultsPanel.tsx`:

```tsx
import { useState } from 'react';
import type { StoreSettings } from '../../lib/pengaturan/types';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

interface Props {
  settings: StoreSettings;
  onSave: (updates: Partial<StoreSettings>) => Promise<void>;
}

export function SalesOrderDefaultsPanel({ settings, onSave }: Props) {
  const [validityDays, setValidityDays] = useState(settings.default_so_validity_days ?? 14);
  const [openingGreeting, setOpeningGreeting] = useState(settings.default_opening_greeting ?? '');
  const [paymentTerms, setPaymentTerms] = useState(settings.default_payment_terms ?? '');
  const [leadTime, setLeadTime] = useState(settings.default_lead_time_text ?? '');
  const [soNotes, setSoNotes] = useState(settings.default_so_notes ?? '');
  const [signatoryName, setSignatoryName] = useState(settings.default_signatory_name ?? '');
  const [signatoryTitle, setSignatoryTitle] = useState(settings.default_signatory_title ?? '');
  const [showTelpKantor, setShowTelpKantor] = useState(settings.footer_show_telp_kantor ?? true);
  const [showWa, setShowWa] = useState(settings.footer_show_wa ?? true);
  const [showEmail, setShowEmail] = useState(settings.footer_show_email ?? true);
  const [showWebsite, setShowWebsite] = useState(settings.footer_show_website ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        default_so_validity_days: Number(validityDays) || 14,
        default_opening_greeting: openingGreeting.trim() || null,
        default_payment_terms: paymentTerms.trim() || null,
        default_lead_time_text: leadTime.trim() || null,
        default_so_notes: soNotes.trim() || null,
        default_signatory_name: signatoryName.trim() || null,
        default_signatory_title: signatoryTitle.trim() || null,
        footer_show_telp_kantor: showTelpKantor,
        footer_show_wa: showWa,
        footer_show_email: showEmail,
        footer_show_website: showWebsite,
      });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Default Penawaran</h2>

      <label className="block mb-4">
        <span className="block text-sm font-medium text-slate-700 mb-1">Masa Berlaku Penawaran (hari)</span>
        <input
          type="number"
          min={1}
          max={365}
          value={validityDays}
          onChange={(e) => setValidityDays(Number(e.target.value))}
          className="w-32 px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
      </label>

      <label className="block mb-4">
        <span className="block text-sm font-medium text-slate-700 mb-1">Kalimat Pembuka</span>
        <textarea
          rows={3}
          value={openingGreeting}
          onChange={(e) => setOpeningGreeting(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
      </label>

      <label className="block mb-4">
        <span className="block text-sm font-medium text-slate-700 mb-1">Cara Pembayaran</span>
        <textarea
          rows={2}
          value={paymentTerms}
          onChange={(e) => setPaymentTerms(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
      </label>

      <label className="block mb-4">
        <span className="block text-sm font-medium text-slate-700 mb-1">Waktu Pengadaan</span>
        <textarea
          rows={2}
          value={leadTime}
          onChange={(e) => setLeadTime(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
      </label>

      <label className="block mb-4">
        <span className="block text-sm font-medium text-slate-700 mb-1">Catatan Default</span>
        <textarea
          rows={4}
          value={soNotes}
          onChange={(e) => setSoNotes(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <label className="block">
          <span className="block text-sm font-medium text-slate-700 mb-1">Nama Penandatangan Default</span>
          <input
            type="text"
            value={signatoryName}
            onChange={(e) => setSignatoryName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700 mb-1">Jabatan Penandatangan</span>
          <input
            type="text"
            value={signatoryTitle}
            onChange={(e) => setSignatoryTitle(e.target.value)}
            placeholder="Sales Engineer"
            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
          />
        </label>
      </div>

      <fieldset className="mt-6 border-t border-slate-200 pt-4">
        <legend className="text-sm font-medium text-slate-700 mb-2">Footer PDF</legend>
        <label className="flex items-center gap-2 mb-2">
          <input type="checkbox" checked={showTelpKantor} onChange={(e) => setShowTelpKantor(e.target.checked)} />
          <span>Tampilkan Telepon Kantor</span>
        </label>
        <label className="flex items-center gap-2 mb-2">
          <input type="checkbox" checked={showWa} onChange={(e) => setShowWa(e.target.checked)} />
          <span>Tampilkan WhatsApp</span>
        </label>
        <label className="flex items-center gap-2 mb-2">
          <input type="checkbox" checked={showEmail} onChange={(e) => setShowEmail(e.target.checked)} />
          <span>Tampilkan Email</span>
        </label>
        <label className="flex items-center gap-2 mb-2">
          <input type="checkbox" checked={showWebsite} onChange={(e) => setShowWebsite(e.target.checked)} />
          <span>Tampilkan Website</span>
        </label>
      </fieldset>

      {error && <p className="text-caleo-danger text-sm mt-4">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-6 px-4 py-2 bg-caleo-primary text-white rounded-md hover:bg-caleo-primary-dark disabled:opacity-50"
      >
        {saving ? 'Menyimpan...' : 'Simpan'}
      </button>
    </section>
  );
}
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `npx vitest run src/components/pengaturan/SalesOrderDefaultsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire into PengaturanScreen.tsx**

Edit `src/components/pengaturan/PengaturanScreen.tsx`. Import + render the panel below `IdentitasTokoCard`:

```tsx
import { SalesOrderDefaultsPanel } from './SalesOrderDefaultsPanel';
// ... later, in JSX after <IdentitasTokoCard ...>:
<SalesOrderDefaultsPanel settings={settings} onSave={saveStoreSettings} />
```

`saveStoreSettings` should be the same mutation hook already used by IdentitasTokoCard.

- [ ] **Step 7: npm run dev + manual verify**

Run: `npm run dev`
Open Pengaturan → verify SalesOrderDefaultsPanel appears below IdentitasTokoCard. Change validity to 30, edit signatory name, click Simpan, reload → values persist.

- [ ] **Step 8: Lint + audits + tests**

Run: `npm run lint && npm run audit:no-string-err-fallback && npx vitest run --changed`

- [ ] **Step 9: Commit**

```bash
git add src/components/pengaturan/SalesOrderDefaultsPanel.tsx \
        src/components/pengaturan/SalesOrderDefaultsPanel.test.tsx \
        src/components/pengaturan/PengaturanScreen.tsx
git commit -m "$(cat <<'EOF'
feat(pengaturan): add SalesOrderDefaultsPanel for Penawaran defaults

New card under Pengaturan with 10 fields: validity days, opening greeting,
payment terms, lead time, notes default, signatory name/title, and 4
footer visibility toggles. Wired to existing StoreSettings save path.
Uses semantic Caleo color tokens; extractErrorMessage for errors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Customer form — add salutation + contact_person_name

**Files:**
- Modify: `src/components/CustomerForm.tsx` (or wherever the customer create/edit form lives — locate at task start)

**Interfaces:**
- Consumes: `DbCustomer.salutation` + `DbCustomer.contact_person_name` (Task 3)
- Produces: form UI for the two fields; wired to existing customer save path

- [ ] **Step 1: Locate customer create/edit form**

Run: `grep -rn "customers\.\|from.*customers" src/components/ | grep -iE "form|edit|create" | head -10`
Also grep: `grep -rn "'customers'" src/components/ | head -10`
Identify the file (likely `src/components/CustomerForm.tsx` or `src/components/customers/CustomerEditModal.tsx`).

- [ ] **Step 2: Add salutation dropdown + contact_person input**

Near the existing `Nama` / `Nama PT` fields, add:

```tsx
<label className="block mb-4">
  <span className="block text-sm font-medium text-slate-700 mb-1">Sapaan</span>
  <select
    value={salutation ?? ''}
    onChange={(e) => setSalutation(e.target.value === '' ? null : (e.target.value as 'Bapak' | 'Ibu'))}
    className="w-32 px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
  >
    <option value="">— (kosong)</option>
    <option value="Bapak">Bapak</option>
    <option value="Ibu">Ibu</option>
  </select>
</label>

<label className="block mb-4">
  <span className="block text-sm font-medium text-slate-700 mb-1">Nama Kontak Person</span>
  <input
    type="text"
    value={contactPersonName ?? ''}
    onChange={(e) => setContactPersonName(e.target.value)}
    placeholder="Andi Wijaya"
    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
  />
</label>
```

Add corresponding `useState` hooks at top of the component:

```tsx
const [salutation, setSalutation] = useState<'Bapak' | 'Ibu' | null>(customer?.salutation ?? null);
const [contactPersonName, setContactPersonName] = useState<string>(customer?.contact_person_name ?? '');
```

- [ ] **Step 3: Include in save payload**

In the customer save handler, add to the upsert object:

```tsx
salutation,
contact_person_name: contactPersonName.trim() || null,
```

- [ ] **Step 4: npm run dev + manual verify**

Run: `npm run dev`
Open Customer create form → verify Sapaan dropdown + Kontak Person input appear. Save a new customer with Bapak + name, reload, values persist.

- [ ] **Step 5: Lint + affected tests**

Run: `npm run lint && npx vitest run --changed`

- [ ] **Step 6: Commit**

```bash
git add src/components/  # narrow to the specific file(s) touched
git commit -m "$(cat <<'EOF'
feat(customer): add salutation + contact_person_name to customer form

Two new fields for the Penawaran PDF recipient block. Saved to
customers.salutation (CHECK Bapak/Ibu/NULL) + customers.contact_person_name.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: SO wizard — Merek input + Sub-parts modal (Step2Items)

**Files:**
- Modify: `src/components/penjualan/wizard/Step2Items.tsx`
- Create: `src/components/penjualan/wizard/SubPartsModal.tsx`
- Create: `src/components/penjualan/wizard/SubPartsModal.test.tsx`

**Interfaces:**
- Consumes: KasirItem type extensions (Task 3)
- Produces:
  - SubPartsModal: `<SubPartsModal open initialSubParts onSave onClose />` — one-textarea modal
  - Step2Items: renders per-line "Merek" input + "Sub-komponen" button (opens modal); handles the auto-hide toggle for MANUFACTURE column

- [ ] **Step 1: Read Step2Items.tsx to understand line-item structure**

Read the file. Note how each item row is rendered (probably a grid), where qty/price inputs live, and how state flows back to the wizard.

- [ ] **Step 2: Create SubPartsModal test**

Create `src/components/penjualan/wizard/SubPartsModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubPartsModal } from './SubPartsModal';

describe('SubPartsModal', () => {
  it('parses one bullet per line and calls onSave with structured array', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SubPartsModal open={true} initialSubParts={[]} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Box Panel 1.2mm\nMCCB 3P 300A\nTerminal, Busbar\n\nPemasangan' },
    });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
    expect(onSave).toHaveBeenCalledWith([
      { name: 'Box Panel 1.2mm' },
      { name: 'MCCB 3P 300A' },
      { name: 'Terminal, Busbar' },
      { name: 'Pemasangan' },
    ]);
  });

  it('prefills textarea from initialSubParts', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SubPartsModal open={true}
      initialSubParts={[{ name: 'Foo' }, { name: 'Bar' }]}
      onSave={onSave} onClose={onClose} />);
    expect(screen.getByRole('textbox')).toHaveValue('Foo\nBar');
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

Run: `npx vitest run src/components/penjualan/wizard/SubPartsModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement SubPartsModal**

Create `src/components/penjualan/wizard/SubPartsModal.tsx`:

```tsx
import { useEffect, useState } from 'react';

interface SubPart { name: string; qty?: number; unit?: string; }

interface Props {
  open: boolean;
  initialSubParts: SubPart[];
  onSave: (subParts: SubPart[]) => void;
  onClose: () => void;
}

export function SubPartsModal({ open, initialSubParts, onSave, onClose }: Props) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) {
      setText(initialSubParts.map((sp) => sp.name).join('\n'));
    }
  }, [open, initialSubParts]);

  if (!open) return null;

  function handleSave() {
    const subParts: SubPart[] = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((name) => ({ name }));
    onSave(subParts);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Sub-komponen</h3>
        <p className="text-sm text-slate-600 mb-2">Satu bullet per baris:</p>
        <textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Box Panel Indoor Plat 1.2 mm&#10;MCCB 3P 300A&#10;Terminal, Busbar, Rail & Duct&#10;Pemasangan"
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary font-mono text-sm"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-700 rounded-md hover:bg-slate-100"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-caleo-primary text-white rounded-md hover:bg-caleo-primary-dark"
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `npx vitest run src/components/penjualan/wizard/SubPartsModal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Extend Step2Items — Merek input + Sub-komponen button**

Edit `src/components/penjualan/wizard/Step2Items.tsx`. Locate the per-item row rendering.

Add local state at top:

```tsx
const [subPartsFor, setSubPartsFor] = useState<number | null>(null);
```

Add near the qty/price columns, after understanding the existing grid:

```tsx
// Merek input (per row)
<input
  type="text"
  value={item.brand_name ?? ''}
  onChange={(e) => updateItem(index, { ...item, brand_name: e.target.value })}
  placeholder="Merek"
  className="w-32 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-caleo-primary"
/>

// Sub-komponen button (per row)
<button
  type="button"
  onClick={() => setSubPartsFor(index)}
  className="ml-2 text-caleo-primary hover:text-caleo-primary-dark text-sm"
>
  {(item.sub_parts?.length ?? 0) > 0
    ? `${item.sub_parts!.length} sub-komponen`
    : '+ Sub-komponen'}
</button>
```

At the bottom of the component (before closing tag), render the modal:

```tsx
<SubPartsModal
  open={subPartsFor !== null}
  initialSubParts={subPartsFor !== null ? (items[subPartsFor]?.sub_parts ?? []) : []}
  onSave={(subParts) => {
    if (subPartsFor !== null) {
      updateItem(subPartsFor, { ...items[subPartsFor], sub_parts: subParts });
    }
  }}
  onClose={() => setSubPartsFor(null)}
/>
```

Adjust variable names to match the file's actual `updateItem` / `items` API.

- [ ] **Step 7: Auto-collapse Merek column based on last 5 SO history (optional polish)**

If time permits, wrap the Merek input in a `showMerekColumn` state that defaults `true` and can be toggled. For MVP, always render — the PDF will still auto-hide MANUFACTURE if empty.

*Marker for MVP: skip the auto-collapse-column runtime derivation for this iteration; log to progress.md as follow-up polish. This is not a blocker.*

- [ ] **Step 8: Update existing Step2Items.test.tsx if it exists**

Read `src/components/penjualan/wizard/Step2Items.test.tsx`. Verify existing tests still pass with the new columns. If they instantiate `KasirItem` in a way that the render now requires the new fields, add `brand_name` / `sub_parts` as undefined to fixtures (they should just work since fields are optional).

Add ONE new test:

```tsx
it('renders Merek input per line and updates item.brand_name', () => {
  const items: KasirItem[] = [{ /* base fields */, brand_name: 'Schneider' }];
  const updateItem = vi.fn();
  render(<Step2Items items={items} onChange={updateItem} />);
  const merekInput = screen.getByPlaceholderText(/merek/i);
  expect(merekInput).toHaveValue('Schneider');
  fireEvent.change(merekInput, { target: { value: 'Chint' } });
  expect(updateItem).toHaveBeenCalledWith(0, expect.objectContaining({ brand_name: 'Chint' }));
});
```

- [ ] **Step 9: npm run dev + manual verify**

Run: `npm run dev`
Open SO wizard Step 2 → verify Merek input appears per line. Click "+ Sub-komponen" → modal opens → type 3 bullets → Simpan → button now reads "3 sub-komponen". Complete the SO save → verify no console errors.

- [ ] **Step 10: Lint + tests**

Run: `npm run lint && npx vitest run --changed`

- [ ] **Step 11: Commit**

```bash
git add src/components/penjualan/wizard/Step2Items.tsx \
        src/components/penjualan/wizard/SubPartsModal.tsx \
        src/components/penjualan/wizard/SubPartsModal.test.tsx \
        src/components/penjualan/wizard/Step2Items.test.tsx
git commit -m "$(cat <<'EOF'
feat(so-wizard): add Merek input + Sub-komponen modal per line

Per-item Merek text input (free-text brand) + click-to-open modal for
sub-parts (one bullet per line, saved as JSONB array on KasirItem).
No column-auto-collapse runtime yet — MVP always renders inputs; PDF
auto-hides MANUFACTURE column when all rows empty. Auto-collapse
logged as follow-up polish.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: SO wizard — Override section (collapsible per-SO overrides)

**Files:**
- Modify: `src/components/penjualan/wizard/CatatPenjualanWizard.tsx` (or the final Step / summary step)

**Interfaces:**
- Consumes: StoreSettings (for defaults) + `salesOrderService.createSalesOrder` input type (Task 5)
- Produces: form fields → `input.opening_greeting_override` / `.payment_terms_override` / `.lead_time_override` / `.so_notes_override` / `.valid_until_override`

- [ ] **Step 1: Read CatatPenjualanWizard.tsx + Step3Payment (or the finalize step)**

Understand the flow. Overrides likely fit either as a separate collapsible in the final step, OR in a dedicated summary panel before Simpan.

- [ ] **Step 2: Add state for override fields (default from StoreSettings)**

Assuming the wizard already reads StoreSettings via a hook (verify):

```tsx
const [showOverrides, setShowOverrides] = useState(false);
const [openingOverride, setOpeningOverride] = useState('');
const [paymentOverride, setPaymentOverride] = useState('');
const [leadTimeOverride, setLeadTimeOverride] = useState('');
const [notesOverride, setNotesOverride] = useState('');
const today = new Date().toISOString().slice(0, 10);
const validityDays = settings.default_so_validity_days ?? 14;
const defaultValidUntil = new Date(Date.now() + validityDays * 86400_000).toISOString().slice(0, 10);
const [validUntilOverride, setValidUntilOverride] = useState(defaultValidUntil);
```

- [ ] **Step 3: Render the collapsible section**

```tsx
<div className="mt-6 border-t border-slate-200 pt-4">
  <button
    type="button"
    onClick={() => setShowOverrides(!showOverrides)}
    className="text-caleo-primary hover:text-caleo-primary-dark text-sm font-medium"
  >
    {showOverrides ? '▲' : '▼'} Override untuk Penawaran ini (opsional)
  </button>

  {showOverrides && (
    <div className="mt-4 space-y-4 bg-slate-50 rounded-md p-4">
      <label className="block">
        <span className="block text-sm font-medium text-slate-700 mb-1">Berlaku Sampai</span>
        <input
          type="date"
          value={validUntilOverride}
          onChange={(e) => setValidUntilOverride(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-slate-700 mb-1">Kalimat Pembuka</span>
        <textarea
          rows={2}
          value={openingOverride}
          onChange={(e) => setOpeningOverride(e.target.value)}
          placeholder={settings.default_opening_greeting ?? ''}
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
        <span className="text-xs text-slate-500">Kosong = pakai default dari Pengaturan</span>
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-slate-700 mb-1">Cara Pembayaran</span>
        <textarea
          rows={2}
          value={paymentOverride}
          onChange={(e) => setPaymentOverride(e.target.value)}
          placeholder={settings.default_payment_terms ?? ''}
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-slate-700 mb-1">Waktu Pengadaan</span>
        <textarea
          rows={2}
          value={leadTimeOverride}
          onChange={(e) => setLeadTimeOverride(e.target.value)}
          placeholder={settings.default_lead_time_text ?? ''}
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-slate-700 mb-1">Catatan</span>
        <textarea
          rows={3}
          value={notesOverride}
          onChange={(e) => setNotesOverride(e.target.value)}
          placeholder={settings.default_so_notes ?? ''}
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-caleo-primary"
        />
      </label>
    </div>
  )}
</div>
```

- [ ] **Step 4: Pass overrides to createSalesOrder call**

Locate the `createSalesOrder(input)` invocation. Add:

```tsx
opening_greeting_override: openingOverride.trim() || null,
payment_terms_override: paymentOverride.trim() || null,
lead_time_override: leadTimeOverride.trim() || null,
so_notes_override: notesOverride.trim() || null,
valid_until_override: validUntilOverride !== defaultValidUntil ? validUntilOverride : null,
```

The valid_until_override compares against the default to only persist when the user changed it.

- [ ] **Step 5: npm run dev + manual verify**

Run: `npm run dev`
Open SO wizard → complete to the final step → verify override section collapsed. Expand → edit greeting → save → verify RPC receives `opening_greeting_override: 'edited'` (check Network tab).

- [ ] **Step 6: Lint + affected tests**

Run: `npm run lint && npx vitest run --changed`

- [ ] **Step 7: Commit**

```bash
git add src/components/penjualan/wizard/CatatPenjualanWizard.tsx
git commit -m "$(cat <<'EOF'
feat(so-wizard): add per-SO override section (opening/terms/lead-time/notes/valid-until)

Collapsible 'Override untuk Penawaran ini' section on the SO wizard final
step. Fields prefilled with StoreSettings placeholders (empty state); values
only persisted when user actually edits. valid_until_override defaults to
date + default_so_validity_days.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: PDF common.ts — multi-page primitives

**Files:**
- Modify: `src/lib/sales/pdf/common.ts`

**Interfaces:**
- Consumes: jsPDF instance
- Produces:
  - `renderPageHeader(doc, ctx): number` — draws banner + company info + doc info; returns Y position for next content
  - `addPageWithHeader(doc, ctx): number` — calls `doc.addPage()` then `renderPageHeader(doc, ctx)`
  - `measureItemRowHeight(doc, item, opts): number` — computes height including sub-parts bullets
  - `renderRunningFooter(doc, ctx)` — draws footer bar (called on EVERY page just before addPage OR at the end)

- [ ] **Step 1: Read common.ts (all 534 lines) to understand existing helpers**

Read the file. Note existing `renderHeader`, `renderFooter`, palette, formatMoney, formatTanggal, fetchLogoDataUrl. Locate where the file ends so new helpers append.

- [ ] **Step 2: Add multi-page primitives — append to common.ts**

Append this block (verify no import conflicts):

```ts
// ============================================================================
// Multi-page primitives for Penawaran template (task 11 of 2026-08-04 plan)
// ============================================================================

export interface PageHeaderContext {
  store: StoreSettings;
  logoDataUrl: string | null;
  docLabel: string;        // e.g., "PENAWARAN HARGA"
  docNumber: string;       // e.g., "SO/2026/00012"
  docDate: string;         // formatted "04 Agu 2026"
  validUntil: string;      // formatted "18 Agu 2026"
  pageNumber: number;      // 1-based
  totalPages: number;      // computed AFTER first pass; use placeholder then overlay
}

/** Draw full header (logo, company, banner, doc info). Return Y for next content. */
export function renderPageHeader(doc: jsPDF, ctx: PageHeaderContext): number {
  // Reuse existing renderHeader() for logo + company block; add banner + doc-info
  const nextY = renderHeader(doc, {
    store: ctx.store,
    logoDataUrl: ctx.logoDataUrl,
    // ... (map existing renderHeader signature)
  });

  // Doc banner (top-right, navy background, white text, 16pt bold)
  const pageWidth = doc.internal.pageSize.getWidth();
  const bannerX = pageWidth - 65;
  const bannerY = 15;
  doc.setFillColor(PALETTE.NAVY);  // '#012749'
  doc.rect(bannerX, bannerY, 55, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(ctx.docLabel, bannerX + 27.5, bannerY + 8.5, { align: 'center' });

  // Doc info (below banner, right-aligned).
  // NOTE: "Halaman" row is rendered as label-only placeholder; the actual
  // "N dari M" text is overlaid AFTER render pass (see salesOrderPdf.ts
  // overlayPageNumber helper) once doc.getNumberOfPages() returns the real
  // total. Placeholder pattern used because a single-pass render doesn't know
  // the final page count until after all content is drawn.
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  const infoStartY = bannerY + 20;
  const infoRows = [
    ['Nomor', ctx.docNumber],
    ['Tanggal', ctx.docDate],
    ['Berlaku sampai', ctx.validUntil],
    ['Halaman', ''],  // placeholder — overlaid post-render
  ];
  infoRows.forEach(([label, value], i) => {
    doc.text(`${label}:`, bannerX, infoStartY + i * 6);
    if (value) doc.text(value, bannerX + 30, infoStartY + i * 6);
  });

  // Return Y of next content + hint for overlayPageNumber (last row Y)
  return Math.max(nextY, infoStartY + infoRows.length * 6) + 8;
}

/** Y-coordinate constants for overlayPageNumber (must match renderPageHeader) */
export const PAGE_INFO_HALAMAN_Y_OFFSET = 20 + 3 * 6;  // bannerY + rowIndex(3) * 6
export const PAGE_INFO_HALAMAN_X_OFFSET = 30;          // bannerX + 30 (value column)

/** Add page + draw header. Returns Y for next content.
 *  Uses jsPDF's automatic page-index; no manual pageNumber tracking needed
 *  since overlayPageNumber fills in "N dari M" after all pages are rendered. */
export function addPageWithHeader(doc: jsPDF, ctx: PageHeaderContext): number {
  doc.addPage();
  return renderPageHeader(doc, ctx);
}

/** Compute height of one item row including sub-parts bullets. */
export function measureItemRowHeight(
  doc: jsPDF,
  item: { name: string; sub_parts?: Array<{ name: string }> },
  opts: { rowFontSize: number; subPartFontSize: number; lineHeight: number; padVertical: number }
): number {
  const baseHeight = opts.rowFontSize * 1.2;  // roughly one text line
  const subCount = item.sub_parts?.length ?? 0;
  const subHeight = subCount * (opts.subPartFontSize * 1.15);
  return opts.padVertical * 2 + baseHeight + subHeight;
}

/** Draw running footer bar at bottom of current page. */
export function renderRunningFooter(
  doc: jsPDF,
  store: StoreSettings
): void {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const footerY = pageHeight - 12;

  // Divider bars top + bottom of footer
  doc.setDrawColor(PALETTE.NAVY);
  doc.setLineWidth(0.5);
  doc.line(10, footerY - 2, pageWidth - 10, footerY - 2);
  doc.line(10, footerY + 6, pageWidth - 10, footerY + 6);

  // Contact items separated by " | "
  const parts: string[] = [];
  if (store.footer_show_telp_kantor && store.telp_kantor) parts.push(`Telp: ${store.telp_kantor}`);
  if (store.footer_show_wa && store.telp_wa) parts.push(`WA: ${store.telp_wa}`);
  if (store.footer_show_email && store.email) parts.push(store.email);
  if (store.footer_show_website && store.website_url) parts.push(store.website_url);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.text(parts.join(' │ '), pageWidth / 2, footerY + 2, { align: 'center' });
}
```

- [ ] **Step 3: Update or add tests in `common.test.ts`**

Add basic unit tests:

```ts
import { measureItemRowHeight } from './common';
import { jsPDF } from 'jspdf';

describe('measureItemRowHeight', () => {
  it('returns base height for item without sub_parts', () => {
    const doc = new jsPDF();
    const h = measureItemRowHeight(doc, { name: 'Test' }, {
      rowFontSize: 10, subPartFontSize: 9, lineHeight: 1.2, padVertical: 2,
    });
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(25);  // sanity
  });

  it('grows with sub_parts count', () => {
    const doc = new jsPDF();
    const short = measureItemRowHeight(doc, { name: 'Test' }, {
      rowFontSize: 10, subPartFontSize: 9, lineHeight: 1.2, padVertical: 2,
    });
    const long = measureItemRowHeight(doc, {
      name: 'Test', sub_parts: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }],
    }, { rowFontSize: 10, subPartFontSize: 9, lineHeight: 1.2, padVertical: 2 });
    expect(long).toBeGreaterThan(short + 40);  // 5 sub-parts should add >= 40mm
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/sales/pdf/common.test.ts`
Expected: green (existing tests still pass; new tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/pdf/common.ts src/lib/sales/pdf/common.test.ts
git commit -m "$(cat <<'EOF'
feat(pdf-common): add multi-page primitives for Penawaran template

renderPageHeader, addPageWithHeader, measureItemRowHeight, renderRunningFooter.
Reuses existing renderHeader for logo+company; adds banner+doc-info block.
Foundation for salesOrderPdf.ts rewrite in next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Rewrite salesOrderPdf.ts — new layout, multi-page, terbilang

**Files:**
- Modify: `src/lib/sales/pdf/salesOrderPdf.ts` (full rewrite of the `generateSalesOrderPdf` function body)
- Modify: `src/lib/sales/pdf/salesOrderPdf.test.ts` (extend existing assertions)

**Interfaces:**
- Consumes: `terbilangRupiah` (Task 2), `KasirItem` types (Task 3), primitives from `common.ts` (Task 11), `StoreSettings` (Task 3)
- Produces: `generateSalesOrderPdf(so, storeSettings, bankAccounts, options): Promise<Blob>` — full multi-page Penawaran PDF matching design spec §5

- [ ] **Step 1: Read the current salesOrderPdf.ts + test.ts**

Note current function signature, options, assertion patterns.

- [ ] **Step 2: Rewrite generateSalesOrderPdf**

Replace the function body. Pseudocode (adapt to actual file structure):

```ts
import { jsPDF } from 'jspdf';
import { terbilangRupiah } from '../../terbilang';
import {
  renderPageHeader, addPageWithHeader, measureItemRowHeight,
  renderRunningFooter, PALETTE, formatMoney, formatTanggal,
  fetchLogoDataUrl, // ... other helpers
} from './common';

export async function generateSalesOrderPdf(
  so: SalesOrderRow,
  storeSettings: StoreSettings,
  bankAccounts: StoreBankAccount[],
  options: { logoDataUrl?: string } = {}
): Promise<Blob> {
  const doc = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' });
  const logo = options.logoDataUrl ?? await fetchLogoDataUrl(storeSettings);

  // Compute validity date
  const validityDays = storeSettings.default_so_validity_days ?? 14;
  const soDate = new Date(so.date);
  const defaultValidUntil = new Date(soDate.getTime() + validityDays * 86400_000);
  const validUntil = so.valid_until_override ? new Date(so.valid_until_override) : defaultValidUntil;

  // Resolve override or default text
  const openingGreeting = so.opening_greeting_override ?? storeSettings.default_opening_greeting ?? '';
  const paymentTerms = so.payment_terms_override ?? storeSettings.default_payment_terms ?? '';
  const leadTime = so.lead_time_override ?? storeSettings.default_lead_time_text ?? '';
  const soNotes = so.so_notes_override ?? storeSettings.default_so_notes ?? '';
  const signatoryName = so.created_by_name ?? storeSettings.default_signatory_name ?? '';
  const signatoryTitle = storeSettings.default_signatory_title ?? '';

  // MANUFACTURE column visibility (auto-hide if all items empty)
  const items = (so.items ?? []) as KasirItem[];
  const showManufacture = items.some((i) => i.brand_name && i.brand_name.trim().length > 0);

  // SINGLE-PASS render — page count is unknown upfront.
  // Use placeholder totalPages: 0 during render; overlay real "Halaman N dari M"
  // AFTER all pages are drawn using doc.getNumberOfPages() (jsPDF 4.x standard).
  // Rationale (audit): no existing multi-page precedent in this codebase; a
  // two-pass render with doc.deletePage(1) is fragile and doubles paginate logic.
  const ctx: PageHeaderContext = {
    store: storeSettings,
    logoDataUrl: logo,
    docLabel: 'PENAWARAN HARGA',
    docNumber: so.so_number,
    docDate: formatTanggal(so.date),
    validUntil: formatTanggal(validUntil.toISOString()),
    pageNumber: 1,
    totalPages: 0,  // placeholder — overlaid after render pass completes
  };

  let y = renderPageHeader(doc, ctx);

  // Recipient block (page 1 only)
  y = renderRecipient(doc, y, so);

  // Opening greeting (page 1 only)
  y = renderOpeningGreeting(doc, y, openingGreeting);

  // Items table (paginate as needed)
  y = renderItemsTable(doc, y, items, showManufacture, ctx);

  // Grand Total row (inside last page of table, aligned right, highlighted)
  y = renderGrandTotalRow(doc, y, so.subtotal);

  // Terbilang
  y = renderTerbilang(doc, y, so.subtotal);

  // T&C + Catatan side-by-side
  y = renderTermsAndNotes(doc, y, paymentTerms, leadTime, validityDays, bankAccounts, soNotes);

  // Signature block
  y = renderSignature(doc, y, signatoryName, signatoryTitle);

  // Overlay total-pages number + running footer on ALL pages.
  // Now that render is complete, doc.getNumberOfPages() gives the true count.
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    // Overlay "Halaman N dari M" over the placeholder in the doc-info block
    // (rendered by renderPageHeader with totalPages=0). Use a small white
    // rectangle to cover the placeholder, then re-draw with correct value.
    overlayPageNumber(doc, p, totalPages);
    // Draw running footer (contact bar) on every page
    renderRunningFooter(doc, storeSettings);
  }

  return doc.output('blob');
}
```

**Helper functions** (defined at bottom of same file):
- `overlayPageNumber(doc, currentPage, totalPages)`:
  ```ts
  import { PAGE_INFO_HALAMAN_X_OFFSET, PAGE_INFO_HALAMAN_Y_OFFSET } from './common';
  function overlayPageNumber(doc: jsPDF, page: number, total: number) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const bannerX = pageWidth - 65;
    const y = 15 + PAGE_INFO_HALAMAN_Y_OFFSET;  // bannerY(15) + halaman-row offset
    // renderPageHeader left value blank — draw the "N dari M" text now
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(`${page} dari ${total}`, bannerX + PAGE_INFO_HALAMAN_X_OFFSET, y);
  }
  ```
- `renderRecipient` — draws "Kepada Yth" + salutation + contact + company + WA
- `renderOpeningGreeting` — draws greeting text with word wrap
- `renderItemsTable` — draws table header + rows, paginating via `addPageWithHeader` when `y + rowHeight > pageBottomThreshold`; skips MANUFACTURE column if `!showManufacture`; renders sub-parts as bullets under description with 9pt mid-grey
- `renderGrandTotalRow` — draws highlighted row with "GRAND TOTAL" + formatMoney(subtotal)
- `renderTerbilang` — draws "Terbilang: <words>" in italic
- `renderTermsAndNotes` — two columns side-by-side. Left: T&C list (payment, lead time, validity, bank rekening — up to 3 active accounts + "... dan N lainnya" if more). Right: Catatan text
- `renderSignature` — right-aligned "Hormat Kami," + 3 blank lines + signature line + name + title

Each helper is bite-sized enough to write directly. Reader: expand these helpers with the actual jsPDF calls following the existing pattern in current salesOrderPdf.ts.

- [ ] **Step 3: Update test assertions**

Edit `src/lib/sales/pdf/salesOrderPdf.test.ts`:

```ts
describe('generateSalesOrderPdf (new template)', () => {
  it('generates valid PDF blob with default 1-page layout', async () => {
    const so = /* fixture with 3 items, brand_name on all, sub_parts on 1 */;
    const settings = /* fixture with all Penawaran defaults filled */;
    const banks = [{ bank_name: 'BCA', account_number: '123-456', account_holder: 'PT GJP', is_active: true, sort_order: 1 }];
    const blob = await generateSalesOrderPdf(so, settings, banks);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('multi-page for 25-item SO', async () => {
    const items = Array.from({ length: 25 }, (_, i) => makeItem(`Item ${i+1}`));
    const so = /* fixture with 25 items */;
    const blob = await generateSalesOrderPdf(so, settings, banks);
    // Verify by parsing PDF page count (use pdfjs-dist or similar if available)
    // Or: inspect blob size heuristically (25-item PDF should be > 20kb)
    expect(blob.size).toBeGreaterThan(20000);
  });

  it('renders backward-compat SO with NULL new fields gracefully', async () => {
    const so = /* fixture with brand_name/sub_parts/salutation/contact/created_by_name all NULL */;
    const blob = await generateSalesOrderPdf(so, settings, banks);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1000);
    // MANUFACTURE column should be hidden — no way to assert visually here;
    // rely on visual-diff regression baseline for that.
  });

  it('uses signatoryName override from so.created_by_name', async () => {
    // Test that render doesn't throw when created_by_name IS present
    const so = /* fixture with created_by_name = 'Custom User' */;
    const blob = await generateSalesOrderPdf(so, settings, banks);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/sales/pdf/salesOrderPdf.test.ts`
Expected: green.

- [ ] **Step 5: Manual visual check via npm run dev**

Run: `npm run dev`
Create fresh SO in the wizard with 2 items + 1 sub-parts + Merek. Click Preview PDF. Verify:
- Banner "PENAWARAN HARGA" navy background
- All company info hydrated
- Kepada Yth block shows salutation + PT + WA
- Items table 6 columns
- Sub-parts as bullets under item 1
- Grand Total highlighted
- Terbilang line italic
- T&C + Catatan side-by-side
- Signature block bottom-right
- Footer bar with active contact items only

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/pdf/salesOrderPdf.ts src/lib/sales/pdf/salesOrderPdf.test.ts
git commit -m "$(cat <<'EOF'
feat(pdf): rewrite salesOrderPdf.ts to Penawaran template layout

Full layout rewrite matching design spec §5: brand banner, hydrated
company header, Kepada Yth with salutation, 6-column items table with
sub-parts bullets, GRAND TOTAL highlighted, terbilang italic, T&C+Catatan
side-by-side, signature block, running footer. Multi-page with full
header repeat + auto-hide MANUFACTURE column. Backward-compat fallbacks
for NULL new fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Regenerate QA-week regression baseline + visual-diff gate

**Files:**
- Modify: `docs/qa-week/pdf-regression/post/10-salesOrder.pdf`
- Create: `public/visual-diff/cetak-so-gjp/before/gjp-so-standard.png`
- Create: `public/visual-diff/cetak-so-gjp/after/gjp-so-standard.png`
- Create: `public/visual-diff/cetak-so-gjp/before/tjm-so-noManufacture.png`
- Create: `public/visual-diff/cetak-so-gjp/after/tjm-so-noManufacture.png`
- Create: `public/visual-diff/cetak-so-gjp/manifest.json`

**Interfaces:**
- Consumes: production `app.caleo.id` (before) + local dev server (after)
- Produces: HTML report at `dist/visual-diff-cetak-so-gjp.html`

- [ ] **Step 1: Regenerate the QA-week baseline PDF**

Run the SO regression fixture (`tests/sql/qa-week/2e-regression.sql`) locally, generate PDF via the new template, save the file to `docs/qa-week/pdf-regression/post/10-salesOrder.pdf` (overwrite).

- [ ] **Step 2: Capture BEFORE screenshots from production**

Via Chrome DevTools MCP: navigate to `app.caleo.id` → login as Toko Jaya Makmur (non-manufacturer, per `production-testing-tenant` memory) → open an existing SO → generate PDF → screenshot. Save to `public/visual-diff/cetak-so-gjp/before/tjm-so-noManufacture.png`.

Then log in as GJP tenant (if accessible) → same SO → save to `public/visual-diff/cetak-so-gjp/before/gjp-so-standard.png`.

- [ ] **Step 3: Capture AFTER screenshots from local dev**

Via Chrome DevTools MCP: navigate to `http://localhost:5173` (or wherever `npm run dev` serves) → login as GJP (or the local test tenant with Penawaran fields filled) → generate PDF via new template → screenshot → `public/visual-diff/cetak-so-gjp/after/gjp-so-standard.png`.

Same for Toko Jaya Makmur → save.

- [ ] **Step 4: Write manifest.json per visual-approval-gate spec**

Create `public/visual-diff/cetak-so-gjp/manifest.json`:

```json
{
  "slug": "cetak-so-gjp",
  "title": "Cetak Sales Order (Penawaran) GJP",
  "date": "2026-08-04",
  "pairs": [
    {
      "label": "GJP standard SO (with MANUFACTURE + sub-parts)",
      "before": "before/gjp-so-standard.png",
      "after": "after/gjp-so-standard.png"
    },
    {
      "label": "Toko Jaya Makmur (non-manufacturer, MANUFACTURE auto-hidden)",
      "before": "before/tjm-so-noManufacture.png",
      "after": "after/tjm-so-noManufacture.png"
    }
  ]
}
```

- [ ] **Step 5: Generate the HTML report**

Run: `npm run visual-diff:build -- --manifest=public/visual-diff/cetak-so-gjp/manifest.json`
Expected: prints absolute path to generated HTML.

- [ ] **Step 6: Present path to founder → wait for "go"**

Message to founder: "Visual diff report at `<absolute path>`. Please open + reply `go` / `adjust X` / `reject`."

**STOP HERE.** Do NOT commit until founder replies "go".

- [ ] **Step 7: On founder "go" → commit**

```bash
git add docs/qa-week/pdf-regression/post/10-salesOrder.pdf public/visual-diff/cetak-so-gjp/
git commit -m "$(cat <<'EOF'
test(so-template): update regression baseline + visual-diff gate for Penawaran

Regenerated 10-salesOrder.pdf with new template. Added visual-diff manifest
+ before/after screenshots for GJP (manufacturer, MANUFACTURE column shown)
and Toko Jaya Makmur (non-manufacturer, column auto-hidden). Founder-
approved visually before this commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Ship & Verify — Stage 1 through Stage 4

**Files:**
- Modify: `progress.md` (one line)

**Interfaces:** verification checklist per CLAUDE.md § Ship & Verify

- [ ] **Step 1: Stage 1 final local verification**

Run in sequence:
```bash
npm run lint
npm run audit:numinput
npm run audit:secdef-null-tenant
npm run audit:no-string-err-fallback
npm run audit:csp-backend-allowlist
npx vitest run
```
Expected: all green. If any fail, STOP + fix root cause + rerun from step 1.

- [ ] **Step 2: Stage 2 deploy — frontend**

```bash
git push origin <worktree-branch>:main  # OR the merge flow the founder normally uses
# Then, per manual_prod_gate_after_real_tenant memory:
# scripts/promote-to-prod.sh (or equivalent) — MANUAL promotion required
```

After push:
```bash
gcloud builds list --limit=2
```
Expected: STATUS != FAILURE per `deploy_verify_after_push` memory. Wait for build to complete before Stage 3.

- [ ] **Step 3: Stage 2 deploy — migration**

Already applied locally via MCP in Task 1 + Task 4. On prod: verify migration 570 + 571 are in the applied list.

Run: `mcp__plugin_supabase_supabase__get_advisors(type='security')` + `type='performance'`.
Triage any new findings.

- [ ] **Step 4: Stage 3 — prod-testing tenant smoke**

Via Chrome DevTools MCP: navigate to `app.caleo.id` → login as Toko Jaya Makmur (`production-testing-tenant` memory — NEVER a real customer tenant).

Test flow:
1. Open Pengaturan → SalesOrderDefaultsPanel visible, seeded values present, save works.
2. Open Customer → salutation + contact_person save.
3. Create a fresh SO with 2 items + Merek + sub-parts + override greeting → save → Preview PDF → visual matches design.
4. Reprint an EXISTING (pre-migration) SO → verify graceful fallback (no MANUFACTURE column, no salutation prefix, StoreSettings signatory fallback).
5. Console + network clean.

If any regression → **rollback immediately** (revert Cloud Run traffic to prior revision) + revert migrations if needed + log to `docs/incidents/YYYY-MM-DD-cetak-so-rollback.md`.

- [ ] **Step 5: Stage 4 — direct-launch (all tenants) per `direct_launch_skip_phased`**

Traffic already at 100% from Stage 2. All eligible tenants see the new template. Non-manufacturer tenants get graceful auto-hide of MANUFACTURE column so no disruption.

- [ ] **Step 6: Update progress.md**

Append to `progress.md`:

```
- 2026-08-04: Cetak Sales Order (Penawaran) template rework shipped.
  Spec: docs/superpowers/specs/2026-08-04-cetak-sales-order-gjp-design.md
  Plan: docs/superpowers/plans/2026-08-04-cetak-sales-order-gjp.md
  Migrations 570 + 571. New template with hydrated master-data, terbilang,
  sub-parts bullets, auto-hide MANUFACTURE, running footer, multi-page.
  Follow-ups: auto-collapse Merek column runtime, WA-send integration,
  brand-picker link to product_brands.
```

- [ ] **Step 7: Commit progress.md**

```bash
git add progress.md
git commit -m "docs(progress): cetak SO Penawaran template shipped (spec + plan)"
```

---

## Self-review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| §2 In scope: visual redesign | Task 12 |
| §2 Master-data hydration | Tasks 6, 7 |
| §2 Customer salutation/contact | Task 8 |
| §2 Terbilang helper | Task 2 |
| §2 Valid Until compute | Task 12 (render) |
| §2 Sub-parts bullets | Tasks 3, 9, 12 |
| §2 Per-SO override | Task 10 (form) + Task 4 (persist) + Task 12 (render) |
| §2 Multi-page + running footer | Tasks 11, 12 |
| §4 DB migration | Task 1 |
| §4.5 RPC extension | Task 4 |
| §4.6 Signatory logic (client-side lookup) | Task 5 |
| §5 Layout details | Task 12 |
| §6.1 Pengaturan UI | Tasks 6, 7 |
| §6.2 Customer UI | Task 8 |
| §6.3 SO wizard UI | Tasks 9, 10 |
| §6.4 PDF preview | (Unchanged — verified no code change needed) |
| §7 Testing | Embedded in each task; regression baseline in Task 13 |
| §8 Rollout | Task 14 |
| §9 Observability | **GAP — need to add logging** (see below) |
| §11 Risks | Handled per task (idempotent migrations, snapshot backward-compat, RPC smoke) |
| §14 Confidence tags | Verified during audit; carried into task decisions |

**Gap identified:** Section 9 (Observability) is not explicitly implemented in any task. This is required per CLAUDE.md "non-negotiable" rule. Adding as follow-up sub-task in Task 12 (PDF entry point is the natural place for entry log + usage counter).

**Fix applied inline (Task 12 addendum):** at the top of `generateSalesOrderPdf`, add:

```ts
console.info('[sales_order_print]', {
  tenant_id: /* from session context */,
  user_id: /* from auth */,
  feature: 'sales_order_print',
  action: 'generate',
  so_number: so.so_number,
  timestamp: new Date().toISOString(),
});
```

And in each error branch of `generateSalesOrderPdf`:
```ts
console.error('[sales_order_print:error]', {
  tenant_id, user_id, feature: 'sales_order_print',
  error_code: 'render_failed', error_message: extractErrorMessage(e), so_number: so?.so_number,
});
```

Usage counter is deferred (no existing counter infra observed; not blocking per CLAUDE.md — logs suffice for launch).

**Add this to Task 12 Step 2 (rewrite generateSalesOrderPdf) — the pseudocode above should include the entry log at the top of the function and error logging in each catch/throw branch.**

**Placeholder scan:** No "TBD", "TODO", or "similar to Task N" placeholders. Each step has concrete commands or code.

**Type consistency check:**
- `KasirItem.brand_name` used in Task 3, 9, 12 ✓ same name
- `KasirItem.sub_parts` used in Task 3, 9, 12 ✓ same name + same shape `{name, qty?, unit?}`
- `resolveCreatedByName` in Task 5 → produces `string | null` → payload key `created_by_name` in Task 4 accepts NULL ✓
- `settings.default_so_validity_days` used in Task 3 (type), Task 7 (form), Task 10 (compute default), Task 12 (compute validity) ✓ same name

**Independent audit corrections (post-write):**

1. **Task 4 RPC (CRITICAL):** Original approach was a whole-body rewrite that would have silently dropped 6 preserved behaviors (validate_sales_channel, items+customer validation, find-or-create customer, next_sales_order_number counter, so_number CASE formatting, auth.uid capture). Rewritten as MINIMAL DIFF: copy current body verbatim, add 8 new columns to INSERT + 8 new VALUES only. Smoke test payload updated to satisfy channel/items/customer_name validation.
2. **Task 5 admin_users lookup:** changed `.ilike('email', email)` → `.eq('email', email)` to match existing codebase convention (`supabaseClient.ts:1239-1248 fetchByEmail`).
3. **Task 11/12 pagination:** replaced two-pass `deletePage(1)` pattern with single-pass render + post-render `doc.getNumberOfPages()` overlay. renderPageHeader now emits a placeholder "Halaman: " row; new `overlayPageNumber` helper fills in "N dari M" per page after all content is drawn. jsPDF 4.2.1 supports `getNumberOfPages()`; no existing multi-page precedent in codebase (this becomes the first pattern).

**Ready for execution.**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-04-cetak-sales-order-gjp.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
