# Kasir Expense Categories — Owner-Configurable

**Date:** 2026-07-24
**Status:** Draft — awaiting founder review
**Type:** Irreversible-decision memo + feature design
**Author:** Claude (via `superpowers:brainstorming`)

---

## 1. Context

MSME founder request: dropdown "Kategori" di **Kasir → Catat Pengeluaran** perlu **owner-configurable**. Variasi MSME (warung, toko, distributor, jasa) besar; kategori bawaan tidak mungkin cover semua. Solusi current (`kasir_expense_category` PG enum) menghalangi user-created values.

**Konteks tambahan:**
- 5 kategori user-facing existing: Gaji, Utilitas, Transportasi, Marketing, Lain-lain.
- 1 kategori (`Pembelian Stok`) di dropdown hari ini overlap dengan modul Pembelian yang auto-emit — user-facing manual entry misleading (tidak update stok, tidak update utang).
- 3 kategori sistem (`Pembelian Stok`, `Pembelian Pass-Through`, `MDR EDC`) di-emit backend RPC (record_pi, record_pembayaran, MarkAsPaid, phase 0b/0c dual-write) — **tidak boleh break**.
- `insertExpense` = plain client INSERT ke `kasir_transactions`, **tidak** post ke journal/COA. Kategori kasir = label UI-only.

**Konstrain:**
- ~100 tenants existing, target 10K.
- Zero-cost budget (no paid API, no infra upgrade).
- MVP: label + urutan + on/off toggle. Advanced (icon, COA mapping, budget alert) DEFERRED.
- Wave delivery Phase B saat ini tidak mencantumkan fitur ini — scale-forward improvement, bukan wave-critical.

**Deadline:** None fixed.

---

## 2. Decision

Ganti hardcoded enum dengan **tabel per-tenant `kasir_expense_categories(id, tenant_id, label, sort_order, active, is_system, deleted_at, timestamps)`**. Migrasi `kasir_transactions.expense_category` dari enum ke `TEXT` untuk enable custom labels. Kategori sistem (di-emit backend) di-flag `is_system=true` dan **invisible di semua UI** (dropdown Kasir + panel Pengaturan). User-facing categories dikelola owner via panel Pengaturan baru dengan **5 SECDEF RPC** (`create`, `update`, `soft_delete`, `restore`, `reorder`). Kasir dropdown dan panel share React Query cache untuk instant cross-consumer sync.

---

## 3. Alternatives Considered

| Alternatif | Alasan Reject |
|---|---|
| **A: Enum tetap + tenant preference JSON** | Enum reject INSERT dengan value baru → tidak enable "create new". Doesn't meet requirement. |
| **C: FK column `expense_category_id UUID`** | Semua backend RPC butuh per-tenant lookup id `WHERE tenant_id AND label='Pembelian Stok'` — extra query per insert, seed-dependency risk. Rename retroactive mutasi label riwayat → audit red flag. Blast radius > B. |
| **JSONB array on `tenants.kasir_expense_categories`** | No referential integrity, no unique constraint, tenants row bloat. Painful migrate away. |
| **EAV settings table** | Schema-less anti-pattern, awful queries. |
| **Global taxonomy + tenant overrides** | Doesn't enable pure "create new" per tenant. Coupling to platform taxonomy inappropriate untuk MSME variety. |

Chosen: **B — relational per-tenant table + `is_system` flag + text column migration**.

---

## 4. Data Model

### 4.1 New table `kasir_expense_categories`

| Kolom | Type | Notes |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `tenant_id` | `UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` | |
| `label` | `TEXT NOT NULL CHECK (LENGTH(TRIM(label)) BETWEEN 3 AND 40)` | |
| `sort_order` | `INT NOT NULL DEFAULT 0` | drag-reorder writes this |
| `active` | `BOOL NOT NULL DEFAULT true` | on/off toggle |
| `is_system` | `BOOL NOT NULL DEFAULT false` | invisible di UI, backend-only |
| `deleted_at` | `TIMESTAMPTZ` | soft delete |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

### 4.2 Indexes

- `UNIQUE (tenant_id, LOWER(label)) WHERE deleted_at IS NULL` — case-insensitive uniqueness per tenant, allows re-use setelah soft-delete
- `(tenant_id, sort_order) WHERE deleted_at IS NULL AND NOT is_system` — read path index (covers BOTH panel query yang butuh row inactive juga, DAN dropdown query. Consumer filter `active` client-side. Tidak include `AND active` di predicate karena panel butuh lihat semua row user-facing termasuk yang OFF)

### 4.3 RLS

- `ENABLE ROW LEVEL SECURITY`
- `SELECT` policy: `tenant_id IN (SELECT current_user_tenant_ids())` — tenant-isolated
- No direct client `INSERT`/`UPDATE`/`DELETE` — semua via SECDEF RPC (per `guard_expiry_write` memory)
- `t_select_own` include `vosi_rpc_owner` (per `secdef_returning_gap` memory) — supaya `INSERT ... RETURNING` di SECDEF tidak 42501

### 4.4 Modifikasi `kasir_transactions`

- `expense_category`: `kasir_expense_category` enum → `TEXT` (nullable, kept for backward-compat)
- Migration: `ALTER TABLE kasir_transactions ALTER COLUMN expense_category TYPE TEXT USING expense_category::TEXT;`
- Enum di-drop di follow-up migration terpisah (slot 106+) setelah semua RPC cast di-remove — grace period 2 minggu

### 4.5 Seed idempotent

Dipanggil on tenant create + backfill:

```sql
INSERT INTO kasir_expense_categories (tenant_id, label, sort_order, is_system)
VALUES
  ($1, 'Gaji',                    10,  false),
  ($1, 'Utilitas',                20,  false),
  ($1, 'Transportasi',            30,  false),
  ($1, 'Marketing',               40,  false),
  ($1, 'Lain-lain',               50,  false),
  ($1, 'Pembelian Stok',          100, true),
  ($1, 'Pembelian Pass-Through',  110, true),
  ($1, 'MDR EDC',                 120, true)
ON CONFLICT (tenant_id, LOWER(label)) WHERE deleted_at IS NULL DO NOTHING;
```

Backfill = one-shot migration loop atas `SELECT id FROM tenants` → panggil seed per tenant. Idempotent.

---

## 5. RPC Contract

Semua 5 endpoint SECDEF, owned by `vosi_rpc_owner`. Baca (dropdown + panel) langsung SELECT via RLS — tidak butuh RPC.

**Auth gate umum:**
- Derive `tenant_id` dari JWT `auth.uid()` → `SELECT tenant_id FROM users WHERE user_id = auth.uid()` (bukan dari input client).
- Assert role in ('OWNER', 'ADMIN') via helper `_assert_owner_or_admin(auth.uid())`; raise `KECT_FORBIDDEN` kalau bukan.

### 5.1 `kasir_expense_category_create(p_label TEXT, p_insert_after_id UUID DEFAULT NULL)`

- Trim label → validate `LENGTH BETWEEN 3 AND 40` → raise `KECT_LABEL_INVALID` kalau gagal
- Case-insensitive dedup → raise `KECT_LABEL_DUPLICATE`
- Compute sort_order:
  - `p_insert_after_id` given → `(after.sort_order + next.sort_order)/2` fractional midpoint
  - NULL → `MAX(sort_order) + 10 FROM tenant AND NOT is_system`
- INSERT dengan `is_system=false`, `active=true`, `deleted_at=NULL`
- RETURN row

### 5.2 `kasir_expense_category_update(p_id UUID, p_label TEXT DEFAULT NULL, p_active BOOL DEFAULT NULL)`

- SELECT FOR UPDATE. Assert `tenant_id = _t AND deleted_at IS NULL AND NOT is_system`
- Kalau `p_label` non-null: trim + validate + dedup (exclude self) → update
- Kalau `p_active` non-null: update
- Update `updated_at = now()`. RETURN row.

### 5.3 `kasir_expense_category_soft_delete(p_id UUID)`

- SELECT FOR UPDATE. Assert tenant + not-deleted + not-is_system
- Set `deleted_at = now()`
- RETURN row (untuk undo toast)

### 5.4 `kasir_expense_category_restore(p_id UUID)`

- SELECT FOR UPDATE. Assert tenant + `deleted_at IS NOT NULL` + not-is_system
- Cek konflik label (case-insensitive) → raise `KECT_LABEL_DUPLICATE`
- Set `deleted_at = NULL`, `updated_at = now()`
- RETURN row

### 5.5 `kasir_expense_categories_reorder(p_ordered_ids UUID[])`

- Assert semua id belong to tenant + `NOT is_system` + `deleted_at IS NULL` → raise `KECT_INVALID_ORDER`
- Single UPDATE via `WITH ORDINALITY`:

```sql
UPDATE kasir_expense_categories t
SET sort_order = o.rn * 10, updated_at = now()
FROM (SELECT id, row_number() OVER () AS rn
      FROM unnest(p_ordered_ids) WITH ORDINALITY AS a(id, rn)) o
WHERE t.id = o.id AND t.tenant_id = _t;
```

- Idempotent. RETURN `setof kasir_expense_categories`.

### 5.6 Error taxonomy

| Code | HTTP-analog | Message ID (bahasa) |
|---|---|---|
| `KECT_FORBIDDEN` | 403 | "Hanya owner/admin yang dapat mengubah daftar kategori." |
| `KECT_NOT_FOUND` | 404 | "Kategori tidak ditemukan." |
| `KECT_IS_SYSTEM` | 403 | "Kategori sistem tidak dapat diubah." |
| `KECT_LABEL_INVALID` | 400 | "Nama kategori harus 3–40 karakter." |
| `KECT_LABEL_DUPLICATE` | 409 | "Kategori dengan nama itu sudah ada." |
| `KECT_INVALID_ORDER` | 400 | "Urutan tidak valid." |

### 5.7 Grant + smoke test

- `GRANT EXECUTE ON` semua 5 RPC `TO authenticated`
- Migration terakhir: DO block dengan `set_config('request.jwt.claim.sub', <fake-owner-uid>, true)` → call setiap RPC → assert result → `RAISE EXCEPTION` rollback (per `smoke_test_security_definer_rpcs` memory)

---

## 6. Migration Path

Slot claim: **100–103** (per memory `migration_slot_allocation`: 100+ free). Reserve 104–109 untuk follow-up.

### 6.1 File sequence

| # | File | Aksi | Breakage risk |
|---|---|---|---|
| 100 | `20261115000100_kasir_expense_categories_table.sql` | CREATE TABLE + indexes + RLS + t_select_own grant | Zero — artefak baru |
| 101 | `20261115000101_kasir_expense_categories_seed_and_backfill.sql` | CREATE seed function + LOOP over existing tenants | Zero — insert-only |
| 102 | `20261115000102_kasir_expense_categories_rpcs.sql` | CREATE 5 SECDEF RPCs + smoke DO block dengan rollback | Zero — belum dipanggil |
| 103 | `20261115000103_kasir_transactions_expense_category_to_text.sql` | `ALTER TABLE kasir_transactions ALTER COLUMN expense_category TYPE TEXT` | Low — non-breaking (verified below) |

### 6.2 Kenapa migration 103 non-breaking

6+ RPC production emit `(...)::kasir_expense_category` cast (record_pi, record_pembayaran, phase 0b/0c dual-write, record_pi_with_discount). Setelah kolom jadi TEXT:

- `'Pembelian Stok'::kasir_expense_category` → returns text → insert ke TEXT column → **works**. Enum type masih ada di schema, cast tetap valid.
- `insertExpense` client-side pakai plain text string → **works** (sebelumnya sudah works via implicit cast).
- **Zero backend Go / RPC code change** untuk ship migration 103.
- Cast cleanup → dijadwalkan migration 104-105 (follow-up) setelah RPC di-refactor batch.

### 6.3 Drop enum — DEFERRED

- Migration `DROP TYPE kasir_expense_category` masuk slot 106+
- Prerequisite: zero cast reference (semua RPC sudah di-refactor batch di 104-105)
- Grace period: min 2 minggu prod soak setelah 103 apply

### 6.4 Rollback matrix

| Stage failed | Rollback |
|---|---|
| 100 | `DROP TABLE IF EXISTS kasir_expense_categories CASCADE;` |
| 101 | Truncate table atau leave; tidak breaking |
| 102 | `DROP FUNCTION IF EXISTS` semua 5 RPC |
| 103 | `ALTER TABLE kasir_transactions ALTER COLUMN expense_category TYPE kasir_expense_category USING expense_category::kasir_expense_category` — works selama belum ada custom label. Kalau FE sudah ship + user create custom → UPDATE non-enum rows ke NULL dulu |
| Full feature | Revert FE deploy (dropdown fallback hardcoded) → rollback 103 → 102 → 101 → 100 |

**Sequencing rule:** migration 103 aman ship **sebelum** FE update, karena text column masih terima nilai enum lama. FE ship setelah 100-103 semua green.

### 6.5 Ship & verify stages (per CLAUDE.md)

**Stage 1 — Supabase branch first:**
1. `mcp__plugin_supabase_supabase__create_branch` name `feat-kasir-expense-config`
2. Apply migrations 100→103 di branch
3. Smoke test: SELECT sample rows before/after identical
4. Test insert custom label → success
5. Test all 5 RPCs via fake auth
6. `mcp__plugin_supabase_supabase__get_advisors` → triage
7. Merge

**Stage 2 — Apply to prod:**
- Add to `scripts/apply-pending-migrations.sh` atau apply via MCP `apply_migration`
- Verify `SELECT COUNT(*) FROM kasir_expense_categories` = tenants × 8

**Stage 3 — Prod-testing tenant smoke (Toko Jaya Makmur):**
- Login sebagai owner
- Full 15-step manual verification (see Section 9.6)
- Console clean, network 200

---

## 7. FE Pengaturan Panel

### 7.1 Location

`src/components/pengaturan/KasirExpenseCategoriesPanel.tsx` — ikut pattern existing (`ClipMonitorPanel`, `ModulSwitchesPanel`, `ApprovalRulesPanel`). Terdaftar di `PengaturanScreen.tsx` sebagai section baru "Kategori Pengeluaran Kasir".

Access gate: owner + admin role via existing `permissions.pengaturan.canEdit`. Non-owner read-only view (no [Edit]/[×] buttons).

### 7.2 Component tree

```
KasirExpenseCategoriesPanel                 ← container
├── PanelHeader ("+ Tambah kategori" CTA)
├── DndContext (drag-drop scope)
│   └── SortableList (mapped rows)
│       └── CategoryRow (× N)
│           ├── DragHandle (⋮⋮)
│           ├── LabelDisplay | LabelInput   ← click-to-edit swap
│           ├── ActiveToggle (switch)
│           └── DeleteButton (×)
├── AddCategoryRow (inline, muncul saat CTA di-klik)
└── (Toast via useToast context)
```

**File count:** 2 baru (`KasirExpenseCategoriesPanel.tsx`, `CategoryRow.tsx`). `AddCategoryRow` inline di panel.

### 7.3 Design system alignment

Semua reuse token existing. **Tidak ada design token baru.**

| Elemen | Token |
|---|---|
| Container | `bg-white rounded-3xl border border-slate-100` |
| Header text | `text-base font-extrabold text-[#012749]` |
| Label field | `text-xs font-semibold text-slate-800` |
| CTA button | `bg-[#012749] text-white rounded-xl px-4 py-2 text-xs font-bold` |
| Row hover | `hover:bg-slate-50` |
| Drag handle | `text-slate-300 cursor-grab active:cursor-grabbing` |
| Toggle ON | `bg-[#2d8a4e]` (brand green) |
| Toggle OFF | `bg-slate-200` |
| Row inactive (grayed) | `opacity-50` |
| Inline error | `text-[10px] text-red-600 mt-1` |
| Delete button | `text-slate-400 hover:text-red-600` |

### 7.4 UI mockup

```
┌──────────────────────────────────────────────────────────────┐
│  Kategori Pengeluaran Kasir                                  │
│  Kelola daftar kategori yang tampil di dropdown Kasir →      │
│  Catat Pengeluaran.                                          │
│                                                              │
│  [ + Tambah kategori baru ]                                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ⋮⋮   Gaji                     [●━━] ON   [Edit] [×] │   │
│  │  ⋮⋮   Utilitas                 [●━━] ON   [Edit] [×] │   │
│  │  ⋮⋮   Transportasi             [●━━] ON   [Edit] [×] │   │
│  │  ⋮⋮   Marketing                [●━━] ON   [Edit] [×] │   │
│  │  ⋮⋮   Sewa Tempat              [●━━] ON   [Edit] [×] │   │
│  │  ⋮⋮   Retribusi Harian         [━━○] OFF  [Edit] [×] │   │ ← grayed
│  │  ⋮⋮   Lain-lain                [●━━] ON   [Edit] [×] │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘

Toast (5s, top-right):
┌────────────────────────────────────────────┐
│  Kategori "Sewa Tempat" dihapus.           │
│                              [ Batalkan ]  │
└────────────────────────────────────────────┘
```

### 7.5 Interaction flow

- **Add:** klik CTA → inline row + auto-focus input → Enter save (RPC create + optimistic append) / Esc cancel
- **Edit:** klik label atau [Edit] → text→input, auto-select-all → Enter save (RPC update) / Esc revert
- **Toggle:** klik switch → optimistic flip → RPC update; rollback on error
- **Reorder:** drag handle → drop → optimistic reorder + RPC reorder (debounce 300ms untuk batch cepat)
- **Soft delete + undo:** klik [×] → optimistic remove + toast 5s → klik Batalkan → RPC restore + re-add. Timeout → permanent (secara UX; DB `deleted_at` still set)

### 7.6 State management

- **React Query** fetch: key `['kasir-expense-categories', tenantId]`, staleTime 5 min
- Query: `supabase.from('kasir_expense_categories').select('*').is('deleted_at', null).eq('is_system', false).order('sort_order')`
- **Optimistic mutations** semua 5 RPC: rollback via `onError` reset cache
- **Debounce reorder** 300ms untuk batch cepat
- **Cache invalidation** on mutation success — Kasir dropdown pakai key sama, otomatis sync

### 7.7 Accessibility

- Button `aria-label` bahasa Indonesia
- Toggle `role="switch"` + `aria-checked`
- Drag handle keyboard-accessible via dnd-kit (Space + arrows)
- Inline edit input auto-focus + select-all
- Screen reader announce delete + undo hint
- Kontras teks pass WCAG AA (brand tokens existing sudah compliant)

### 7.8 New dependency

**`@dnd-kit/core` + `@dnd-kit/sortable`** (~10–15 KB gzipped). Alternatif ditolak:
- Native HTML5 DnD → poor mobile touch, aksesibilitas buruk
- Up/down arrows → aksesibilitas OK, UX kalah direct
- react-beautiful-dnd → deprecated

Zero $-cost (bundle size only). Owner-only panel → lazy-loaded → impact minimal.

### 7.9 Error handling per KECT code

| Code | UI treatment |
|---|---|
| `KECT_LABEL_INVALID` | Inline red di bawah input |
| `KECT_LABEL_DUPLICATE` | Inline red di bawah input |
| `KECT_FORBIDDEN` | Toast merah + rollback optimistic |
| `KECT_NOT_FOUND` | Toast merah + refetch |
| `KECT_IS_SYSTEM` | Toast merah + Sentry (should never happen — UI hides system rows) |
| `KECT_INVALID_ORDER` | Toast merah + refetch + rollback local reorder |
| Network / 5xx | Toast merah generic + rollback |

---

## 8. Kasir Dropdown Integration

### 8.1 Files touched

- `src/components/KasirScreen.tsx` — ExpenseModal (lines 587-682): replace hardcoded array dengan fetch
- `src/types.ts` — `KasirExpenseCategory` type (lines 386-387): widen union → `string`
- **New:** `src/lib/hooks/useKasirExpenseCategories.ts` — shared hook untuk Panel + Dropdown

### 8.2 Shared hook

```ts
export function useKasirExpenseCategories() {
  return useQuery({
    queryKey: ['kasir-expense-categories', tenantId],
    queryFn: () => supabase
      .from('kasir_expense_categories')
      .select('*')
      .is('deleted_at', null)
      .eq('is_system', false)
      .order('sort_order'),
    staleTime: 5 * 60 * 1000,
  });
}
```

**Consumer filters:**
- Panel: render semua row (grey `!active`)
- Dropdown: `.filter(c => c.active)`

Single cache = single fetch = konsisten instant.

### 8.3 Type change

```ts
// BEFORE:
export type KasirExpenseCategory =
  | 'Gaji' | 'Utilitas' | 'Transportasi' | 'Pembelian Stok' | 'Marketing' | 'Lain-lain';

// AFTER:
export type KasirExpenseCategory = string;
```

Widening — zero call-site breakage (`'Pembelian Stok'` literal at `MarkAsPaidModal.tsx:33` tetap assignable to string).

### 8.4 ExpenseModal changes

```diff
- const EXPENSE_CATEGORIES: KasirExpenseCategory[] = [
-   'Gaji', 'Utilitas', 'Transportasi', 'Pembelian Stok', 'Marketing', 'Lain-lain',
- ];
  function ExpenseModal({ selectedDate, onClose, onSaved, showToast }: ExpenseModalProps) {
-   const [category, setCategory] = useState<KasirExpenseCategory>('Utilitas');
+   const { data: categories, isLoading, isError, refetch } = useKasirExpenseCategories();
+   const activeCategories = useMemo(
+     () => categories?.filter(c => c.active) ?? [],
+     [categories]
+   );
+   const [category, setCategory] = useState<string>('');
+   useEffect(() => {
+     if (!category && activeCategories.length > 0) setCategory(activeCategories[0].label);
+   }, [activeCategories, category]);
```

### 8.5 State handling

| State | UI |
|---|---|
| Loading | Dropdown disabled + "Memuat kategori..." + Save disabled |
| Error | Inline red "Gagal memuat kategori" + `[Coba lagi]` + Save disabled |
| Empty (defensive) | Empty state card + Pengaturan link untuk owner |
| Loaded | Dropdown fungsional |

**No hardcoded fallback list** — kalau fetch gagal, block save + retry.

### 8.6 Discoverability

Di bawah dropdown, kalau user punya `pengaturan.canEdit`:

```
┌────────────────────────────────────┐
│  Kategori: [ Utilitas         ▼ ]  │
│                                    │
│         Kelola kategori →          │  ← text-[10px] text-slate-400
└────────────────────────────────────┘
```

Deep-link ke Pengaturan → panel. Non-owner tidak lihat link.

### 8.7 Realtime cross-session sync — DEFERRED

5-min staleTime acceptable untuk owner-role changes yang rare. Realtime subscription = extra WebSocket (Supabase project dekat cap sub per memory `supabase_split_pool`) — zero value untuk 99% owner flow. Build kalau tenant support ticket muncul.

### 8.8 Daily-summary tampilan riwayat

`KasirScreen.tsx:387` — `${tx.expense_category} — ${tx.description}` **no change**. Column stays TEXT, historical rows menampilkan label ter-simpan saat insert. Rename kategori **tidak** retroactive ke riwayat (correct audit semantic).

### 8.9 Adjacent flow regression check

`insertExpense` dipanggil juga dari `pembelian/MarkAsPaidModal.tsx:33` dengan hardcoded `expense_category: 'Pembelian Stok'`:

- Column TEXT setelah 103 → text literal 'Pembelian Stok' valid ✅
- Tidak muncul di dropdown (filtered `is_system=false`) ✅
- Tidak muncul di panel (filtered `is_system=false`) ✅
- Muncul di kasir daily-summary line 387 — user melihat "Pembelian Stok — Pembayaran PO XXX" di riwayat (correct audit visibility) ✅

Same pattern untuk 'Pembelian Pass-Through' + 'MDR EDC'. Zero regression.

---

## 9. Test Plan

### 9.1 Migration smoke (SQL, per file)

Setiap file ada `DO $$ ... RAISE EXCEPTION 'rollback' $$;` di akhir:

| Migration | Assertions |
|---|---|
| 100 | Table + indexes + RLS + policies exist |
| 100 re-run | Idempotent (2nd apply zero DDL error) |
| 101 | N tenants × 8 = row count; re-run adds 0 |
| 102 | 5 RPCs exist dengan signature + SECDEF + owner + grant |
| 103 | Column type = TEXT; existing values preserved |

### 9.2 RPC unit tests (fake auth DO blocks)

**Positive (10):** create success + sort_order math; create with insert-after fractional; update rename + toggle; soft_delete; restore; reorder set-based; RLS SELECT tenant isolation.

**Negative (13):** label length invalid; duplicate label; non-owner forbidden; update on system row; update on other tenant's id (→ NOT_FOUND not FORBIDDEN — no leak); soft_delete on system; restore on non-deleted; restore with label conflict; reorder with cross-tenant id / system id / soft-deleted id.

Total 23 assertions. One DO block per migration.

### 9.3 Cross-tenant isolation (CRITICAL)

2 scratch tenants (A, B) dengan owner masing-masing. Matrix:

| Attempt | Expected |
|---|---|
| A SELECT via RLS | Only A's rows |
| A → update B's id | `KECT_NOT_FOUND` |
| A → soft_delete B's id | `KECT_NOT_FOUND` |
| A → reorder array includes B's id | `KECT_INVALID_ORDER` |
| A → direct client INSERT/UPDATE/DELETE | Blocked by `guard_expiry_write()` (42501) |

### 9.4 FE Vitest tests

**New:** `KasirExpenseCategoriesPanel.test.tsx` (~15 tests), `CategoryRow.test.tsx`, `useKasirExpenseCategories.test.ts`.

**Extended:** `KasirScreen.test.tsx` (ExpenseModal dropdown fetch), `MarkAsPaidModal.test.tsx` (post-migration regression).

### 9.5 Regression tests (existing flows)

| Flow | Test |
|---|---|
| Pembelian MarkAsPaid | `insertExpense` called with 'Pembelian Stok'; kasir_transactions row inserted post-103 |
| record_pi (STOCK) | expense_category='Pembelian Stok' persists |
| record_pi (pass-through) | expense_category='Pembelian Pass-Through' persists |
| record_pembayaran | expense_category='Pembelian Stok' persists |
| Kasir daily-summary | Historical 'Pembelian Stok' entries visible in history |
| Kasir daily-summary total | Sum uses `subtotal`, tidak lookup category — unchanged |

### 9.6 Manual smoke on Toko Jaya Makmur (Stage 3)

Sequential via MCP chrome-devtools terhadap prod URL, logged in as prod-testing tenant owner:

1. Login → Pengaturan → tab "Kategori Pengeluaran Kasir"
2. Verify 5 default (Gaji, Utilitas, Transportasi, Marketing, Lain-lain) muncul, aktif, sorted
3. Verify sistem (Pembelian Stok, Pass-Through, MDR EDC) TIDAK muncul di panel
4. Add "Sewa Gudang" → muncul, RPC 200
5. Add "Sewa Gudang" lagi → inline error duplicate
6. Edit "Sewa Gudang" → "Sewa Kantor" → updated
7. Toggle Marketing OFF → grayed, RPC 200
8. Drag Utilitas ke atas Gaji → order updated, RPC 200
9. Delete "Sewa Kantor" → undo toast muncul
10. Klik Batalkan dalam 5s → restored, muncul kembali di posisi asal
11. Delete "Sewa Kantor" lagi → tunggu 6s → permanent (soft-delete di DB)
12. Navigate ke Kasir → Catat Pengeluaran → dropdown menampilkan: Utilitas, Gaji, Transportasi, Lain-lain (bukan Marketing OFF, bukan Sewa Kantor deleted)
13. Insert expense pakai "Utilitas" → tersimpan → tampil di riwayat
14. Navigate ke Pembelian → mark PO paid → muncul di Kasir daily-summary sebagai "Pembelian Stok — Pembayaran PO XXX"
15. Console clean, all network 200

### 9.7 Post-migration Supabase advisors

Setelah 100-103 di prod: `mcp__plugin_supabase_supabase__get_advisors` → triage findings di `progress.md`.

### 9.8 Test file inventory

**New:**
- `src/components/pengaturan/KasirExpenseCategoriesPanel.test.tsx`
- `src/components/pengaturan/CategoryRow.test.tsx`
- `src/lib/hooks/useKasirExpenseCategories.test.ts`
- `supabase/tests/kasir_expense_categories_rpcs_test.sql` (atau embed di migration DO blocks)

**Extended:**
- `src/components/KasirScreen.test.tsx`
- `src/components/pembelian/MarkAsPaidModal.test.tsx`

---

## 10. Observability + Cost

### 10.1 Cost analysis — $0/tenant/month, $0 infra upgrade

| Item | @ 1 tenant | @ 10K tenants |
|---|---|---|
| Storage baru | ~450 B | ~4 MB total |
| Supabase storage $/tenant/mo | ~$0.00000001 | ~$0.00001 total |
| RPC call frequency | Rare (owner config, few/week) | Independent of tenant activity |
| Dropdown read | Sub-ms, cached 5min FE | Same |
| WebSocket (Realtime) | 0 (deferred) | 0 |
| New service | 0 | 0 |
| Paid API call | 0 | 0 |

**Zero-cost validation:**
- ❌ No new paid API
- ❌ No larger Cloud Run instance
- ❌ No higher Supabase plan
- ❌ No added SaaS subscription
- ❌ No storage quota bump
- ❌ No superlinear cost curve

**Zero founder approval needed untuk cost.**

### 10.2 Observability instrumentation

**Entry logs** (via existing Sentry breadcrumbs):
```
{feature: 'kasir_expense_category', action, tenant_id, user_id, ts}
```

Actions: `panel_opened`, `dropdown_opened`, `create_attempted/succeeded`, `update_...`, `toggle_...`, `delete_...`, `restore_...`, `reorder_...`.

**Error logs** (via existing `captureError`):
```ts
captureError(err, { feature: 'kasir_expense_category', action, tenant_id, error_code });
```

Parse `KECT_*` return string ke `error_code` untuk Sentry grouping. Non-KECT → `UNKNOWN`.

**Usage counters:**

| Metric | Definisi | Threshold |
|---|---|---|
| `kasir_expense_category_custom_created_total{tenant}` | Non-default-seed created | Adoption signal |
| `kasir_expense_category_toggled_total{tenant, dir}` | on/off events | Config tuning frequency |
| `kasir_expense_category_deleted_total{tenant}` | Soft-delete events | Churn signal — kalau tinggi, default seed off-mark |
| `kasir_expense_used_custom_ratio{tenant}` | % expense inserts pakai label ≠ 5 default seed | **Key metric** — <5% underused, >20% validated |

Ratio metric = computed offline via SQL 4 minggu setelah ship.

### 10.3 Post-launch retrospective

- Week 2: check `custom_created_total` per tenant
- Week 4: `used_custom_ratio` — validate adoption
- `used_custom_ratio` < 5% across all tenants → consider rollback / rethink UX
- `deleted_total` tinggi pada 1-2 default → default seed off-mark, tune

### 10.4 Sentry alerts — DEFERRED

Existing captureError catch-all sudah cukup. Custom alerts tune setelah 2 minggu real data.

---

## 11. Scale Ceiling Check (6 questions per CLAUDE.md)

1. **Ceiling @ 10× (10K tenants):** ~130K rows di `kasir_expense_categories` (5 custom avg per tenant). Trivial. `kasir_transactions` PK tidak berubah.
2. **Hot path:** dropdown read indexed on `(tenant_id, sort_order) WHERE ...` — sub-ms @ 10× scale, cached 5 min FE.
3. **Partition-ready:** `kasir_expense_categories` small table, no partition needed. `kasir_transactions` PK tidak diubah.
4. **Idempotency:** seed `ON CONFLICT DO NOTHING`; backfill re-run = 0 rows; RPCs create-by-unique-label, update-by-id, soft-delete idempotent, reorder set-based deterministic.
5. **Long ops:** none. Semua sub-100ms.
6. **Cost curve:** flat. $0/tenant/mo. Storage negligible. RPC frequency independent of tenant activity.

---

## 12. Consequences & Reversibility

**Reversibility rating: SEMI-IRREVERSIBLE.**

- Migration 103 (enum→text) = one-way in practice: rollback works selama belum ada custom label; setelah user create → rollback butuh UPDATE non-enum rows to NULL dulu.
- Full feature rollback = revert FE deploy → migrations reverse order. Est downtime: <10 min di window low-traffic.

**Blast radius:**
- FE: 3 new files + 2 modified files
- SQL: 4 migration files + 5 SECDEF RPCs
- Backend Go: **zero change**
- Existing RPCs: zero forced change; optional cast cleanup follow-up
- Data: 1 new table (~4 MB @ 10K) + 1 column type change on high-volume `kasir_transactions`

**Migration path kalau perlu undo di masa depan:**
- Feature under-used (`used_custom_ratio < 5%` setelah 4 minggu) → rollback FE ke hardcoded list, table dibiarkan dormant, enum recreated + column reverted
- Data model perlu evolve ke FK (untuk COA mapping etc.) → tambah kolom `category_id UUID` + backfill via label lookup + gradual RPC refactor

---

## 13. Follow-Up Work

| Task | Owner | Timing |
|---|---|---|
| Migration 104-105: RPC batch refactor hilangkan `::kasir_expense_category` cast | dev | Week 2-3 setelah ship (soak) |
| Migration 106+: `DROP TYPE kasir_expense_category` | dev | Setelah zero cast reference confirmed |
| PM retrospective: `used_custom_ratio` per tenant | founder | Week 4 setelah ship |
| Advisor findings triage (post `get_advisors` output) | dev | Immediately post-Stage-2 |
| `progress.md` entry + link ke design doc + incident kalau ada | dev | End of ship |
| Realtime cross-session sync (Supabase Realtime subscription) | dev | Deferred — build kalau tenant support ticket muncul |
| COA account mapping per kategori (jurnal integration) | dev | Deferred — Phase 3+ |
| Icon/emoji picker | dev | Deferred kecuali user request eksplisit |

---

## 14. Confidence Tags

- Codebase claims (file paths, line numbers, existing enum values, RPC emit pattern, insertExpense path, `expense_category` display in daily-summary): **[VERIFIED]**
- Migration slot allocation (100-103 free): **[VERIFIED]** via memory `migration_slot_allocation`
- SECDEF ownership + t_select_own gap + guard_expiry_write predicate: **[VERIFIED]** via memories `secdef_returning_gap`, `guard_expiry_write_broken_predicate`
- $0/tenant/month cost: **[VERIFIED]** via math (row size × count × Supabase pricing)
- UX pattern (inline table + drag + inline edit + undo toast): **[REASONED]** — industry-standard SaaS admin, not A/B tested with tenants
- 5-minute staleTime acceptable: **[REASONED]** — assumption owner rarely edits mid-session
- Adoption threshold `used_custom_ratio < 5% = underused` after 4 weeks: **[ASSUMED]** — needs post-launch validation

---

## 15. Approval Trail (from brainstorming conversation 2026-07-24)

Each section approved incrementally by founder during brainstorming:

- Data Model (§4) — approved
- RPC Contract (§5) — approved
- Migration Path (§6) — approved
- FE Pengaturan Panel (§7) — approved
- Kasir Dropdown Integration (§8) — approved
- Test Plan (§9) — approved
- Observability + Cost (§10) — approved
- Scale-Forward Memo (§11–§13) — approved

**Next step:** founder review this file → invoke `superpowers:writing-plans` skill for detailed implementation plan.
