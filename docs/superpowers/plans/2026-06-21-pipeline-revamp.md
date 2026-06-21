# Pipeline Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-06-21-pipeline-revamp-design.md`
**Mockup:** `docs/superpowers/mockups/2026-06-21-pipeline-revamp.html`

**Goal:** Hapus menu Pipeline, ganti dengan Slack-style kategori filter di Sales Inbox + manual state override (AI auto-pause + auto-resume 15 menit).

**Architecture:** Tiga delta sekuensial: A+B (pure delete Pipeline UI + walk-in services), C1 (Sales Inbox kategori list UI, no DB), C2 (DB migration + RPC + pg_cron + frontend dropdown + backend Go guards). Lock TTL pakai dual layer: pg_cron tiap 1 menit + lazy resume inline di handler.go.

**Tech Stack:** React + TypeScript + Vite + Vitest, Supabase Postgres 17 (pg_cron), Go backend (whatsmeow + Calista engine), Tailwind CSS.

## Global Constraints

- **Permission gate**: Manual override RPC + UI hanya untuk role `owner` atau `admin`. Kasir terblok di frontend (hide dropdown) DAN backend (RPC raise 'not authorized').
- **Lock TTL**: hardcoded 15 menit. Tidak per-tenant configurable di scope ini.
- **Indonesian UI labels**: Kategori "Butuh Aksi · AI Aktif · Menunggu · Riwayat". System message juga Indonesian.
- **Migration slot**: pakai `20260621090000_conversation_state_lock.sql` (high slot range untuk hindari collision dengan parallel terminals — per CLAUDE memory).
- **Branch strategy**: tiap delta = PR terpisah, di-deploy Cloud Run dengan `--no-traffic`, smoke dulu sebelum promote 100%.
- **pg_cron extension**: belum terinstal di project `ekhhojaezdfjfwuxyjkl` (verified 2026-06-21). Migration includes `CREATE EXTENSION IF NOT EXISTS pg_cron`.
- **No backfill needed**: query prod menunjukkan 0 walk-in orders, jadi Delta B pure delete tanpa data cleanup.
- **`LEAD_BADGE` aman**: didefinisikan inline di `PelangganScreen.tsx:42`, BUKAN diimpor dari PipelineScreen. Aman dihapus.
- **No backwards-compat shims**: ActivePage literal `'pipeline'` dihapus total dari union; tidak ada deprecated path.

---

## Phase 1 — Delta A+B: Pure delete (Hari 1)

### Task 1: Verifikasi tidak ada caller lain + hapus PipelineScreen + ActivePage literal

**Files:**
- Delete: `src/components/PipelineScreen.tsx`
- Modify: `src/types.ts` (remove `'pipeline'` literal from `ActivePage`, remove `pipeline` key from `PermissionSet`)
- Modify: `src/App.tsx` (remove `case 'pipeline':` block)
- Modify: `src/components/Sidebar.tsx:75` (remove pipeline entry)
- Modify: `src/lib/urlRoute.ts` (add redirect `/pipeline` → `/sales-inbox`)
- Modify: `src/initialData.ts:20,43` (remove `pipeline: true|false` dari role seeds)
- Modify: `src/lib/supabaseClient.ts` (remove `orderService.markWalkinPaid`, `salesEntriesService.fetchOpenWalkinDrafts`)

**Interfaces:**
- Consumes: none
- Produces: cleaner sidebar (one menu less), simpler types

- [ ] **Step 1: Verifikasi tidak ada caller lain untuk markWalkinPaid + fetchOpenWalkinDrafts**

Run:
```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
grep -rn "markWalkinPaid\|fetchOpenWalkinDrafts" src/ --include="*.ts" --include="*.tsx"
```

Expected: only references inside `PipelineScreen.tsx` dan `supabaseClient.ts`. Jika ada caller lain (mis. DashboardScreen, KasirScreen), STOP dan surface ke user — out of scope.

- [ ] **Step 2: Verifikasi tidak ada caller `'pipeline'` di luar Sidebar/App/types**

Run:
```bash
grep -rn "'pipeline'\|\"pipeline\"" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules"
```

Expected references: `Sidebar.tsx:75`, `App.tsx:447`, `types.ts` (ActivePage + PermissionSet), `initialData.ts:20,43`. Tidak ada lain.

- [ ] **Step 3: Verifikasi tidak ada caller `permKey: 'pipeline'` di backend RLS**

Run:
```bash
grep -rn "pipeline" supabase/migrations/ | head -10
grep -rn "pipeline" backend-go/ --include="*.go" | head -10
```

Expected: no hits (atau hanya comment). Jika ada RLS policy yang baca `pipeline` perm, STOP dan surface — butuh deprecate migration dulu.

- [ ] **Step 4: Delete file PipelineScreen.tsx**

Run:
```bash
rm src/components/PipelineScreen.tsx
```

- [ ] **Step 5: Edit `src/types.ts` — hapus literal `'pipeline'` dari ActivePage + key dari PermissionSet**

Cari blok `ActivePage` union, hapus `| 'pipeline'`. Cari interface `PermissionSet`, hapus baris `pipeline: boolean;` atau `pipeline?: boolean;`.

- [ ] **Step 6: Edit `src/App.tsx:447` — hapus `case 'pipeline':` block**

Cari `case 'pipeline':` (sekitar baris 447 berdasarkan grep awal). Hapus seluruh block sampai sebelum `case` berikutnya. Hapus juga import `PipelineScreen` dari atas file kalau ada.

- [ ] **Step 7: Edit `src/components/Sidebar.tsx:75` — hapus pipeline entry**

Hapus baris:
```tsx
{ id: 'pipeline', label: 'Pipeline', icon: TrendingUp, category: 'operasional', permKey: 'pipeline' },
```

Periksa apakah `TrendingUp` masih dipakai di file ini di tempat lain (mis. di header icon). Kalau tidak, hapus juga dari import lucide-react.

- [ ] **Step 8: Edit `src/lib/urlRoute.ts` — tambah redirect `/pipeline` → `/sales-inbox`**

Buka file, lihat pattern existing untuk routes. Tambah:
```ts
// Deprecated: Pipeline menu dihapus 2026-06-21; redirect bookmark lama
if (path === '/pipeline' || path.startsWith('/pipeline/')) {
  return { page: 'sales-inbox', detail: null };
}
```

Posisikan sebelum default fallback. Sesuaikan dengan return shape yang dipakai modul ini.

- [ ] **Step 9: Edit `src/initialData.ts:20,43` — hapus `pipeline:` key dari role seeds**

Hapus baris `pipeline: true,` (baris 20) dan `pipeline: false,` (baris 43). Sesuaikan trailing comma di baris atas/bawah supaya valid JSON/TS object literal.

- [ ] **Step 10: Edit `src/lib/supabaseClient.ts` — hapus `orderService.markWalkinPaid` dan `salesEntriesService.fetchOpenWalkinDrafts`**

Cari method `markWalkinPaid` di dalam `orderService = {...}`. Hapus seluruh method termasuk type signature. Cari `fetchOpenWalkinDrafts` di dalam `salesEntriesService`, hapus juga.

Periksa kalau ada import yang jadi tidak terpakai setelah hapus, bersihkan.

- [ ] **Step 11: Run TypeScript build untuk validasi**

Run:
```bash
npm run build
```

Expected: build sukses. Jika error TypeScript (mis. literal `'pipeline'` masih dipakai di tempat tak terduga), fix dan ulang sampai pass.

- [ ] **Step 12: Run unit tests**

Run:
```bash
npm test
```

Expected: semua test pass. Jika `urlRoute.test.ts` punya assertion lama untuk `/pipeline`, update sesuai redirect baru atau hapus assertion lama.

- [ ] **Step 13: Smoke manual via dev server**

Run:
```bash
npm run dev
```

Browser ke `http://localhost:3000/pipeline` — verifikasi redirect ke `/sales-inbox`. Sidebar — verifikasi entry Pipeline tidak muncul. Login dengan role kasir + admin + owner — verifikasi semua tidak crash.

Stop dev server (Ctrl-C).

- [ ] **Step 14: Update progress.md**

Tambah entry di puncak `progress.md`:
```markdown
## 2026-06-21 — Pipeline Revamp Phase 1 (Delta A+B): menu Pipeline + walk-in markPaid path DIHAPUS

- Hapus file PipelineScreen.tsx + entry sidebar + case App.tsx + literal types.
- Hapus orderService.markWalkinPaid + salesEntriesService.fetchOpenWalkinDrafts (0 caller lain).
- Redirect /pipeline → /sales-inbox preserve bookmark.
- DB intact: tabel leads + RPC mark_walkin_order_paid + enum 'walkin' dibiarkan untuk drop phase terpisah.
- Justifikasi data: query prod 2026-06-21 → 0 walk-in orders, 0 backfill risk.
- TypeScript build PASS, unit tests PASS.
```

- [ ] **Step 15: Commit Phase 1**

Run:
```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(sales): kill Pipeline menu + walk-in markPaid path (Phase 1)

- Hapus PipelineScreen + sidebar entry + URL route (redirect ke /sales-inbox).
- Hapus orderService.markWalkinPaid + fetchOpenWalkinDrafts (0 caller, 0 walk-in di prod).
- Hapus literal 'pipeline' dari ActivePage + PermissionSet + role seeds.
- DB intact: tabel leads + RPC mark_walkin_order_paid dibiarkan untuk phase cleanup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Delta C1: Sales Inbox Slack-style kategori list (Hari 2-3)

### Task 2: Categorize helper + unit tests

**Files:**
- Create: `src/lib/salesInboxCategorize.ts`
- Create: `src/lib/salesInboxCategorize.test.ts`

**Interfaces:**
- Consumes: existing `ConversationWithMessages` type dari `hooks/useRealtimeConversations`
- Produces:
  - `export type InboxCategory = 'butuhAksi' | 'aiAktif' | 'menunggu' | 'riwayat'`
  - `export function categorize(conv: { state: ConversationState; ai_active: boolean }): InboxCategory`
  - `export function categoryCounts(convs: Array<{ state: ConversationState; ai_active: boolean }>): Record<InboxCategory, number>`

- [ ] **Step 1: Write failing test file**

Buat `src/lib/salesInboxCategorize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { categorize, categoryCounts } from './salesInboxCategorize';

describe('categorize', () => {
  it('routes ESCALATED_ADMIN to butuhAksi', () => {
    expect(categorize({ state: 'ESCALATED_ADMIN', ai_active: false })).toBe('butuhAksi');
  });
  it('routes ESCALATED_WIRING to butuhAksi', () => {
    expect(categorize({ state: 'ESCALATED_WIRING', ai_active: false })).toBe('butuhAksi');
  });
  it('routes BOOKED to butuhAksi', () => {
    expect(categorize({ state: 'BOOKED', ai_active: true })).toBe('butuhAksi');
  });
  it('routes TIMEOUT_REMINDER to butuhAksi', () => {
    expect(categorize({ state: 'TIMEOUT_REMINDER', ai_active: true })).toBe('butuhAksi');
  });
  it('routes ai_active=false non-terminal to butuhAksi (manual override case)', () => {
    expect(categorize({ state: 'CONFIRMING', ai_active: false })).toBe('butuhAksi');
    expect(categorize({ state: 'COLLECTING', ai_active: false })).toBe('butuhAksi');
  });
  it('routes COMPLETED ai_active=false to riwayat (not butuhAksi)', () => {
    expect(categorize({ state: 'COMPLETED', ai_active: false })).toBe('riwayat');
  });
  it('routes CANCELLED to riwayat', () => {
    expect(categorize({ state: 'CANCELLED', ai_active: true })).toBe('riwayat');
  });
  it('routes ai_active=true AI states to aiAktif', () => {
    for (const s of ['GREETING','COLLECTING','CLARIFYING','STOCK_CHECK','CONFIRMING','ADD_MORE','APPROVED'] as const) {
      expect(categorize({ state: s, ai_active: true })).toBe('aiAktif');
    }
  });
  it('routes DELIVERY to menunggu', () => {
    expect(categorize({ state: 'DELIVERY', ai_active: true })).toBe('menunggu');
  });
});

describe('categoryCounts', () => {
  it('counts each conversation exactly once', () => {
    const convs = [
      { state: 'ESCALATED_ADMIN' as const, ai_active: false },
      { state: 'CONFIRMING' as const, ai_active: true },
      { state: 'CONFIRMING' as const, ai_active: false }, // override case
      { state: 'COMPLETED' as const, ai_active: false },
      { state: 'DELIVERY' as const, ai_active: true },
    ];
    expect(categoryCounts(convs)).toEqual({
      butuhAksi: 2, // ESCALATED_ADMIN + overridden CONFIRMING
      aiAktif: 1,   // ai_active CONFIRMING
      menunggu: 1,  // DELIVERY
      riwayat: 1,   // COMPLETED
    });
  });
  it('handles empty array', () => {
    expect(categoryCounts([])).toEqual({ butuhAksi: 0, aiAktif: 0, menunggu: 0, riwayat: 0 });
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run:
```bash
npm test -- salesInboxCategorize
```

Expected: FAIL dengan `Cannot find module './salesInboxCategorize'`.

- [ ] **Step 3: Implement categorize() helper**

Buat `src/lib/salesInboxCategorize.ts`:
```ts
import type { ConversationState } from '../types';

export type InboxCategory = 'butuhAksi' | 'aiAktif' | 'menunggu' | 'riwayat';

const TERMINAL: ReadonlySet<ConversationState> = new Set(['COMPLETED', 'CANCELLED']);
const ESCALATED_OR_NEEDS_ADMIN: ReadonlySet<ConversationState> = new Set([
  'ESCALATED_ADMIN', 'ESCALATED_WIRING', 'BOOKED', 'TIMEOUT_REMINDER',
]);
const AI_STAGES: ReadonlySet<ConversationState> = new Set([
  'GREETING', 'COLLECTING', 'CLARIFYING', 'STOCK_CHECK', 'CONFIRMING', 'ADD_MORE', 'APPROVED',
]);
const MENUNGGU: ReadonlySet<ConversationState> = new Set(['DELIVERY']);

export function categorize(conv: { state: ConversationState; ai_active: boolean }): InboxCategory {
  if (TERMINAL.has(conv.state)) return 'riwayat';
  if (ESCALATED_OR_NEEDS_ADMIN.has(conv.state)) return 'butuhAksi';
  if (!conv.ai_active) return 'butuhAksi'; // manual override / takeover
  if (MENUNGGU.has(conv.state)) return 'menunggu';
  if (AI_STAGES.has(conv.state)) return 'aiAktif';
  return 'aiAktif'; // safe default for unknown non-terminal state
}

export function categoryCounts(
  convs: Array<{ state: ConversationState; ai_active: boolean }>
): Record<InboxCategory, number> {
  const counts: Record<InboxCategory, number> = { butuhAksi: 0, aiAktif: 0, menunggu: 0, riwayat: 0 };
  for (const c of convs) counts[categorize(c)] += 1;
  return counts;
}
```

- [ ] **Step 4: Run test, verify PASS**

Run:
```bash
npm test -- salesInboxCategorize
```

Expected: all PASS.

- [ ] **Step 5: Commit**

Run:
```bash
git add src/lib/salesInboxCategorize.ts src/lib/salesInboxCategorize.test.ts
git commit -m "feat(sales-inbox): categorize helper + tests for 4 verb-driven groups

Maps 11 conversation_state + ai_active to {butuhAksi, aiAktif, menunggu, riwayat}.
ai_active=false non-terminal → butuhAksi (covers manual override + escalation).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: SalesInboxScreen — Slack-style kategori list UI

**Files:**
- Modify: `src/components/SalesInboxScreen.tsx` (replace filter section, integrate categorize)

**Interfaces:**
- Consumes: `categorize`, `categoryCounts`, `InboxCategory` dari Task 2
- Produces: kategori filter state `activeCategory: InboxCategory | null`

- [ ] **Step 1: Add imports + state to SalesInboxScreen**

Buka `src/components/SalesInboxScreen.tsx`. Tambah import:
```ts
import { categorize, categoryCounts, type InboxCategory } from '../lib/salesInboxCategorize';
```

Ganti state filter lama:
```ts
const [activeFilter, setActiveFilter] = useState<'Semua' | 'Admin' | 'AI'>('Semua');
```
Menjadi:
```ts
const [activeCategory, setActiveCategory] = useState<InboxCategory>('butuhAksi');
```

- [ ] **Step 2: Replace count derivation**

Cari blok `adminCount` + `aiCount` (sekitar baris 95-100). Ganti dengan:
```ts
const counts = categoryCounts(conversations);
```

Hapus baris `adminCount` dan `aiCount`.

- [ ] **Step 3: Replace filter predicate**

Cari blok filter di `filteredConvs` (sekitar baris 102-111). Ganti:
```ts
if (activeFilter === 'Admin') return ... ;
if (activeFilter === 'AI') return ... ;
```
Menjadi:
```ts
if (categorize(conv) !== activeCategory) return false;
```

(Search query filter di atas tetap dipertahankan.)

- [ ] **Step 4: Replace 3-tab filter UI dengan Slack-style kategori list**

Cari blok JSX `{/* Filter tabs */}` (sekitar baris 161-180). Ganti seluruh `<div className="flex gap-1 px-2 py-2 border-b border-gray-100 shrink-0">` block dengan:

```tsx
{/* Kategori list (Slack-style) */}
<div className="border-b border-gray-100 shrink-0">
  <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">
    Kategori
  </div>
  {(
    [
      { id: 'butuhAksi', label: '🔴 Butuh Aksi', accent: 'red',     active: 'bg-red-50 border-l-red-500 text-red-700',         badge: 'bg-red-500 text-white' },
      { id: 'aiAktif',   label: '🔵 AI Aktif',   accent: 'blue',    active: 'bg-blue-50 border-l-blue-500 text-blue-700',      badge: 'bg-blue-500 text-white' },
      { id: 'menunggu',  label: '🟡 Menunggu',   accent: 'amber',   active: 'bg-amber-50 border-l-amber-500 text-amber-700',    badge: 'bg-amber-500 text-white' },
      { id: 'riwayat',   label: '✅ Riwayat',    accent: 'gray',    active: 'bg-gray-100 border-l-gray-400 text-gray-600',       badge: 'bg-gray-400 text-white' },
    ] as const
  ).map(({ id, label, active, badge }) => {
    const isActive = activeCategory === id;
    return (
      <button
        key={id}
        onClick={() => setActiveCategory(id)}
        className={`w-full px-3 py-2 flex items-center justify-between text-left border-l-[3px] ${
          isActive ? active : 'border-l-transparent hover:bg-gray-100 text-gray-700'
        }`}
      >
        <span className={`text-xs ${isActive ? 'font-bold' : ''}`}>{label}</span>
        <span className={`text-[10px] font-bold px-1.5 rounded-full ${
          isActive ? badge : 'bg-gray-200 text-gray-700'
        }`}>
          {counts[id]}
        </span>
      </button>
    );
  })}
</div>
```

- [ ] **Step 5: Hapus state lama yang sudah tidak terpakai**

Hapus deklarasi `setActiveFilter` references yang tersisa. Hapus juga blok `adminCount` / `aiCount` di atas (Step 2) kalau masih ada.

Run TypeScript build:
```bash
npm run build
```

Fix error sampai pass.

- [ ] **Step 6: Run unit tests untuk regresi**

Run:
```bash
npm test
```

Expected: all PASS. Tidak ada test SalesInboxScreen langsung di repo, jadi yang relevan cuma `salesInboxCategorize.test.ts` (sudah pass dari Task 2).

- [ ] **Step 7: Smoke manual via dev server**

Run:
```bash
npm run dev
```

Browser ke `http://localhost:3000/sales-inbox`. Verifikasi:
- 4 baris kategori muncul (Butuh Aksi/AI Aktif/Menunggu/Riwayat) dengan count
- Default aktif = "Butuh Aksi" (highlighted)
- Klik tiap kategori → list filter sesuai
- Riwayat kelihatan dim (muted) dibanding lainnya
- Search bar di atas masih fungsi

Stop dev server.

- [ ] **Step 8: Commit**

Run:
```bash
git add src/components/SalesInboxScreen.tsx
git commit -m "feat(sales-inbox): Slack-style 4-kategori filter (Phase 2)

Ganti tab Semua/Admin/AI dengan 4 baris kategori verb-driven:
🔴 Butuh Aksi · 🔵 AI Aktif · 🟡 Menunggu · ✅ Riwayat.

Default aktif: Butuh Aksi (most urgent). Conv overridden (ai_active=false)
otomatis masuk Butuh Aksi via categorize() helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sidebar badge count update untuk Sales Inbox

**Files:**
- Modify: `src/components/Sidebar.tsx` (derive Sales Inbox badge dari "Butuh Aksi" count)

**Interfaces:**
- Consumes: `categoryCounts` dari Task 2; conversations dari realtime hook
- Produces: badge merah `(N)` di sidebar reflect "Butuh Aksi" count

- [ ] **Step 1: Inspect current Sidebar badge logic**

Run:
```bash
grep -n "badge\|salesInbox\|ESCALATED\|escalat" src/components/Sidebar.tsx
```

Identifikasi di mana badge count dihitung sekarang. Kemungkinan via prop dari `App.tsx` atau via hook langsung.

- [ ] **Step 2: Pilih sumber data**

Jika Sidebar terima badge count via prop dari App.tsx, modify App.tsx untuk hitung dengan `categoryCounts(conversations).butuhAksi`. Jika Sidebar punya hook sendiri, panggil `categoryCounts` langsung di sini.

- [ ] **Step 3: Edit logic count**

Ganti hitungan badge Sales Inbox dari ESCALATED-only:
```ts
const salesInboxBadge = conversations.filter(c => c.state === 'ESCALATED_ADMIN' || c.state === 'ESCALATED_WIRING').length;
```
Menjadi:
```ts
import { categoryCounts } from '../lib/salesInboxCategorize';
// ...
const salesInboxBadge = categoryCounts(conversations).butuhAksi;
```

(Sesuaikan ke lokasi import + cara badge di-pass ke entry sidebar.)

- [ ] **Step 4: Run TypeScript build**

Run: `npm run build`. Fix error sampai pass.

- [ ] **Step 5: Smoke manual**

Run `npm run dev`. Login. Verifikasi badge di sidebar Sales Inbox reflect "Butuh Aksi" count (sama dengan count di kategori "Butuh Aksi" dalam Sales Inbox screen).

- [ ] **Step 6: Update progress.md + commit Phase 2**

Tambah ke `progress.md`:
```markdown
## 2026-06-21 — Pipeline Revamp Phase 2 (Delta C1): Sales Inbox Slack-style kategori filter

- Helper `salesInboxCategorize.ts` + unit tests (9 cases).
- SalesInboxScreen filter diganti dari 3-tab (Semua/Admin/AI) ke 4 kategori verb-driven.
- Sidebar badge Sales Inbox hitung dari "Butuh Aksi" predicate (escalated + booked + timeout + !ai_active non-terminal).
- TypeScript build PASS, unit tests PASS, dev smoke PASS.
```

Run:
```bash
git add -A
git commit -m "feat(sidebar): Sales Inbox badge derive dari Butuh Aksi count (Phase 2 final)

Sebelum: hitung dari ESCALATED_* saja.
Sesudah: hitung dari kategori 'Butuh Aksi' (escalated + booked + timeout + !ai_active).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Delta C2: Manual override + AI pause + auto-resume (Hari 4-5)

### Task 5: DB migration — lock columns + 2 RPCs + pg_cron

**Files:**
- Create: `supabase/migrations/20260621090000_conversation_state_lock.sql`

**Interfaces:**
- Consumes: existing tables `conversations`, `admin_users`, `messages`; existing enum `conversation_state`
- Produces:
  - kolom `conversations.state_locked_until TIMESTAMPTZ`
  - kolom `conversations.state_locked_by_admin_id UUID`
  - RPC `manually_override_conversation_state(p_conv_id UUID, p_new_state conversation_state, p_lock_minutes INT DEFAULT 15) RETURNS VOID`
  - RPC `auto_resume_expired_locks() RETURNS INT`
  - pg_cron job `auto_resume_locked_conversations` (1 menit interval)

- [ ] **Step 1: Verifikasi exact schema `admin_users`**

Run via Supabase MCP:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'admin_users' AND table_schema = 'public'
ORDER BY ordinal_position;
```

Catat exact nama kolom untuk `role`, status active (mungkin `active` atau `is_active`), dan join key ke `auth.uid()` (mungkin `auth_uid` atau `id`). Sesuaikan SQL migration di langkah berikut.

- [ ] **Step 2: Tulis file migration**

Buat `supabase/migrations/20260621090000_conversation_state_lock.sql`:

```sql
-- Pipeline Revamp Phase 3 — Manual state override + AI pause + auto-resume.
-- Spec: docs/superpowers/specs/2026-06-21-pipeline-revamp-design.md
-- Plan: docs/superpowers/plans/2026-06-21-pipeline-revamp.md

BEGIN;

-- ─── Schema delta ───────────────────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS state_locked_until      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS state_locked_by_admin_id UUID       NULL REFERENCES admin_users(id);

CREATE INDEX IF NOT EXISTS idx_conversations_state_lock
  ON conversations(state_locked_until)
  WHERE state_locked_until IS NOT NULL;

-- ─── Override RPC ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION manually_override_conversation_state(
  p_conv_id       UUID,
  p_new_state     conversation_state,
  p_lock_minutes  INT DEFAULT 15
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id    UUID;
  v_admin_name  TEXT;
  v_old_state   conversation_state;
BEGIN
  -- Role gate: owner + admin only (kasir blocked).
  -- NOTE: replace 'auth_uid' / 'role' / 'is_active' with exact column names
  -- verified in Step 1.
  SELECT id, name INTO v_admin_id, v_admin_name
  FROM admin_users
  WHERE auth_uid = auth.uid()
    AND role IN ('owner','admin')
    AND is_active = true;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'not authorized: hanya owner/admin yang boleh override state'
      USING ERRCODE = '42501';
  END IF;

  -- Terminal-state guard: tidak boleh override KE terminal, dan tidak boleh
  -- override KONVERSASI YANG SUDAH terminal.
  IF p_new_state IN ('COMPLETED','CANCELLED') THEN
    RAISE EXCEPTION 'tidak bisa override ke status terminal: %', p_new_state
      USING ERRCODE = '22023';
  END IF;

  SELECT state INTO v_old_state FROM conversations WHERE id = p_conv_id FOR UPDATE;
  IF v_old_state IS NULL THEN
    RAISE EXCEPTION 'conversation % tidak ditemukan', p_conv_id
      USING ERRCODE = '22023';
  END IF;
  IF v_old_state IN ('COMPLETED','CANCELLED') THEN
    RAISE EXCEPTION 'tidak bisa override conversation yang sudah %', v_old_state
      USING ERRCODE = '22023';
  END IF;

  -- Mutate: set state, pause AI, set lock window.
  UPDATE conversations SET
    state                    = p_new_state,
    ai_active                = false,
    state_locked_until       = NOW() + (p_lock_minutes || ' minutes')::INTERVAL,
    state_locked_by_admin_id = v_admin_id,
    updated_at               = NOW()
  WHERE id = p_conv_id;

  -- Audit (system message in chat).
  INSERT INTO messages (conversation_id, sender, text, created_at)
  VALUES (
    p_conv_id,
    'system',
    format(
      '%s mengubah status ke %s, AI di-pause %s menit, pada %s WIB',
      v_admin_name,
      p_new_state,
      p_lock_minutes,
      to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'HH24:MI')
    ),
    NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION manually_override_conversation_state(UUID, conversation_state, INT) TO authenticated;

-- ─── Auto-resume RPC ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_resume_expired_locks()
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
BEGIN
  WITH resumed AS (
    UPDATE conversations
    SET
      ai_active                = true,
      state_locked_until       = NULL,
      state_locked_by_admin_id = NULL,
      updated_at               = NOW()
    WHERE state_locked_until IS NOT NULL
      AND state_locked_until < NOW()
    RETURNING id
  )
  SELECT count(*)::INT INTO v_count FROM resumed;
  RETURN v_count;
END;
$$;

-- ─── pg_cron schedule ───────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent: hapus job yang mungkin sudah ada dari run sebelumnya
SELECT cron.unschedule('auto_resume_locked_conversations')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_resume_locked_conversations');

SELECT cron.schedule(
  'auto_resume_locked_conversations',
  '* * * * *',
  $cron$ SELECT auto_resume_expired_locks(); $cron$
);

COMMIT;
```

- [ ] **Step 3: Apply migration via Supabase MCP**

Run via MCP `apply_migration` tool dengan project `ekhhojaezdfjfwuxyjkl`:

```
name: 20260621090000_conversation_state_lock
query: <contents of the SQL file above>
```

Expected: success. Jika kolom `is_active`/`auth_uid`/`role` di `admin_users` ternyata beda nama, edit file + ulang.

- [ ] **Step 4: Verify schema setelah apply**

Run via MCP `execute_sql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='conversations' AND column_name LIKE 'state_locked%';
```
Expected: 2 rows (`state_locked_until`, `state_locked_by_admin_id`).

```sql
SELECT proname FROM pg_proc WHERE proname IN ('manually_override_conversation_state','auto_resume_expired_locks');
```
Expected: 2 rows.

```sql
SELECT jobname, schedule FROM cron.job WHERE jobname='auto_resume_locked_conversations';
```
Expected: 1 row dengan schedule `* * * * *`.

- [ ] **Step 5: Smoke RPC manual (no side effect)**

Run via MCP `execute_sql`:

```sql
DO $$
DECLARE
  v_conv_id UUID;
  v_admin_uid UUID;
BEGIN
  -- ambil sampel conv non-terminal + owner admin_users.auth_uid
  SELECT id INTO v_conv_id FROM conversations
  WHERE state NOT IN ('COMPLETED','CANCELLED') LIMIT 1;
  SELECT auth_uid INTO v_admin_uid FROM admin_users
  WHERE role IN ('owner','admin') AND is_active LIMIT 1;

  IF v_conv_id IS NULL OR v_admin_uid IS NULL THEN
    RAISE NOTICE 'skip: tidak ada conv non-terminal atau owner admin';
    RETURN;
  END IF;

  -- fake auth.uid
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::TEXT, true);

  -- override
  PERFORM manually_override_conversation_state(v_conv_id, 'CONFIRMING', 15);
  RAISE NOTICE 'override OK';

  -- verify state
  PERFORM 1 FROM conversations WHERE id=v_conv_id AND state='CONFIRMING' AND ai_active=false;
  RAISE NOTICE 'state correct';

  -- rollback supaya tidak meninggalkan jejak di prod
  RAISE EXCEPTION 'intentional rollback after smoke';
END $$;
```

Expected: notices "override OK", "state correct", then "intentional rollback after smoke" error (which rolls back DO block).

- [ ] **Step 6: Smoke negative case (kasir blocked)**

Run:
```sql
DO $$
DECLARE
  v_conv_id UUID;
  v_kasir_uid UUID;
BEGIN
  SELECT id INTO v_conv_id FROM conversations
  WHERE state NOT IN ('COMPLETED','CANCELLED') LIMIT 1;
  SELECT auth_uid INTO v_kasir_uid FROM admin_users
  WHERE role = 'kasir' AND is_active LIMIT 1;
  IF v_kasir_uid IS NULL THEN
    RAISE NOTICE 'skip: no kasir in admin_users';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_kasir_uid::TEXT, true);
  BEGIN
    PERFORM manually_override_conversation_state(v_conv_id, 'CONFIRMING', 15);
    RAISE EXCEPTION 'FAIL: kasir should be blocked';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: kasir blocked as expected';
  END;
  RAISE EXCEPTION 'intentional rollback';
END $$;
```

Expected: notice "PASS: kasir blocked as expected" + rollback.

- [ ] **Step 7: Commit migration file**

Run:
```bash
git add supabase/migrations/20260621090000_conversation_state_lock.sql
git commit -m "feat(db): conversation state lock columns + RPCs + pg_cron (Phase 3)

- ALTER conversations add state_locked_until, state_locked_by_admin_id.
- RPC manually_override_conversation_state(): role gate (owner/admin),
  terminal guard, pause AI, set lock, emit system message.
- RPC auto_resume_expired_locks(): bulk flip ai_active=true on lock expire.
- pg_cron job 'auto_resume_locked_conversations' tiap 1 menit.
- Applied + smoked: owner override OK, kasir blocked, rollback bersih.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend types + RPC wrapper + chat header dropdown UI

**Files:**
- Modify: `src/types.ts` (add lock fields to `DbConversation`)
- Modify: `src/lib/supabaseClient.ts` (add `manuallyOverrideConversationState` wrapper)
- Modify: `src/components/SalesInboxScreen.tsx` (state badge → button → popover dropdown, lock countdown, early-resume button, permission gate)

**Interfaces:**
- Consumes: existing `ConversationWithMessages`, `toggleAiControl`, `CONV_STATE_DISPLAY`, `getModeBanner`
- Produces:
  - `manuallyOverrideConversationState(convId: string, newState: ConversationState, lockMinutes?: number): Promise<void>`
  - `DbConversation.state_locked_until: string | null`
  - `DbConversation.state_locked_by_admin_id: string | null`

- [ ] **Step 1: Add types**

Buka `src/types.ts`. Cari interface `DbConversation`. Tambah field:
```ts
state_locked_until: string | null;       // ISO timestamp; NULL = no lock
state_locked_by_admin_id: string | null; // admin who set the lock
```

- [ ] **Step 2: Add RPC wrapper**

Buka `src/lib/supabaseClient.ts`. Cari method `toggleAiControl` (di sekitar conversations service). Tambah method baru di adjacent:
```ts
async manuallyOverrideConversationState(
  convId: string,
  newState: ConversationState,
  lockMinutes: number = 15
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('manually_override_conversation_state', {
    p_conv_id: convId,
    p_new_state: newState,
    p_lock_minutes: lockMinutes,
  });
  if (error) throw error;
},
```

(Sesuaikan ke object service yang men-host method conversations lainnya.)

- [ ] **Step 3: Inject permission prop ke SalesInboxScreen**

Buka `src/App.tsx`, cari render `<SalesInboxScreen ...>`. Tambah prop:
```tsx
<SalesInboxScreen
  onNavigate={...}
  userRole={currentUser?.role ?? null}
/>
```

Di `SalesInboxScreen.tsx`, tambah prop type:
```ts
export default function SalesInboxScreen({
  onNavigate,
  userRole,
}: {
  onNavigate?: (page: ActivePage) => void;
  userRole: string | null;
}) {
```

Derive `canOverride = userRole === 'owner' || userRole === 'admin'`.

- [ ] **Step 4: Replace static badge with clickable dropdown trigger di chat header**

Cari header chat (sekitar baris 236-247):
```tsx
<div className="bg-[#012749] text-white px-4 py-2.5 flex items-center gap-2.5 shrink-0">
  <div className={`w-8 h-8 ...`}>{getInitials(activeChat)}</div>
  <div className="flex-1 min-w-0">
    <div className="font-bold text-sm truncate">{getDisplayName(activeChat)}</div>
    <div className="text-[10px] opacity-60">{activeChat.customer_phone}</div>
  </div>
</div>
```

Tambah state untuk dropdown:
```ts
const [stateDropdownOpen, setStateDropdownOpen] = useState(false);
```

Tambah element setelah `<div className="flex-1 min-w-0">...</div>` di header, sebelum penutup:

```tsx
{(() => {
  const stateInfo = CONV_STATE_DISPLAY[activeChat.state];
  const lockedUntil = activeChat.state_locked_until ? new Date(activeChat.state_locked_until) : null;
  const minutesLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000)) : null;
  return (
    <div className="relative">
      <button
        disabled={!canOverride}
        onClick={() => setStateDropdownOpen(o => !o)}
        className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full ${stateInfo?.badgeClass ?? 'bg-gray-100 text-gray-600'} ${canOverride ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
      >
        {minutesLeft !== null && <span>🔒</span>}
        {stateInfo?.label ?? activeChat.state}
        {minutesLeft !== null && <span className="opacity-70">· {minutesLeft} min</span>}
        {canOverride && <span className="material-symbols-outlined text-sm">{stateDropdownOpen ? 'expand_less' : 'expand_more'}</span>}
      </button>
      {stateDropdownOpen && canOverride && (
        <StateOverrideDropdown
          currentState={activeChat.state}
          onPick={async (newState) => {
            try {
              await conversationsService.manuallyOverrideConversationState(activeChat.id, newState);
              setStateDropdownOpen(false);
            } catch (e) {
              alert(`Gagal ubah status: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
          onClose={() => setStateDropdownOpen(false)}
        />
      )}
    </div>
  );
})()}
```

(Sesuaikan import `material-symbols-outlined` jika perlu — atau pakai lucide icon `ChevronDown` / `ChevronUp`.)

- [ ] **Step 5: Create StateOverrideDropdown component (inline atau separate file)**

Tambah di bawah komponen utama `SalesInboxScreen` (atau pisah ke file `SalesInboxStateDropdown.tsx`):

```tsx
const ALL_STATES: ConversationState[] = [
  'GREETING','COLLECTING','CLARIFYING','STOCK_CHECK','CONFIRMING',
  'BOOKED','TIMEOUT_REMINDER','APPROVED','ADD_MORE','DELIVERY',
  'ESCALATED_ADMIN','ESCALATED_WIRING','COMPLETED','CANCELLED',
];
const TERMINAL: ConversationState[] = ['COMPLETED','CANCELLED'];

function StateOverrideDropdown({
  currentState,
  onPick,
  onClose,
}: {
  currentState: ConversationState;
  onPick: (s: ConversationState) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute top-full right-0 mt-1 bg-white text-gray-800 rounded-xl shadow-2xl border border-gray-200 w-64 z-20">
        <div className="px-3 py-2 border-b border-gray-100">
          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400">Ubah Status Manual</div>
          <div className="text-[10px] text-gray-500 mt-0.5">AI di-pause 15 menit. Admin handle balas. Auto-resume saat lock expire.</div>
        </div>
        <div className="max-h-56 overflow-y-auto py-1 text-xs">
          {ALL_STATES.map(s => {
            const info = CONV_STATE_DISPLAY[s];
            const isCurrent = s === currentState;
            const isTerminal = TERMINAL.includes(s);
            return (
              <button
                key={s}
                disabled={isTerminal || isCurrent}
                onClick={() => !isTerminal && !isCurrent && onPick(s)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                  isTerminal ? 'opacity-40 cursor-not-allowed' :
                  isCurrent ? 'bg-gray-100 cursor-default' :
                  'hover:bg-gray-50'
                }`}
              >
                <span className={`inline-block text-[8px] font-bold px-1.5 py-0.5 rounded-full ${info?.badgeClass ?? 'bg-gray-100 text-gray-600'}`}>
                  {info?.label ?? s}
                </span>
                <span className="text-gray-400 text-[9px] font-mono">{s}{isCurrent ? ' · saat ini' : isTerminal ? ' · terminal' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Add lock countdown re-render via setInterval**

Di body `SalesInboxScreen`, tambah:
```ts
const [, forceTick] = useState(0);
useEffect(() => {
  // re-render tiap 60 detik supaya countdown lock di header refresh
  const id = setInterval(() => forceTick(t => t + 1), 60_000);
  return () => clearInterval(id);
}, []);
```

- [ ] **Step 7: Wire "Aktifkan AI Sekarang" early-resume button di mode banner**

Cari `getModeBanner` (baris 33-53). Modifikasi banner saat ada lock aktif:
```ts
function getModeBanner(conv: ConversationWithMessages): {
  bg: string; text: string; btnLabel: string; makeActive: boolean;
} {
  const lockedUntil = conv.state_locked_until ? new Date(conv.state_locked_until) : null;
  const isLocked = lockedUntil !== null && lockedUntil > new Date();
  if (isLocked) {
    return {
      bg: 'bg-emerald-700',
      text: `👤 Mode Admin · Status di-lock sampai ${lockedUntil!.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}`,
      btnLabel: 'Aktifkan AI Sekarang',
      makeActive: true,
    };
  }
  // ... existing escalated / ai_active / fallback branches
}
```

Saat tombol diklik (existing `toggleAiControl` call), kalau ada lock aktif → call wrapper baru yang clear lock juga. Simplest: add a small RPC `clear_conversation_lock(p_conv_id)` atau extend `toggleAiControl` di backend untuk clear lock saat `makeActive=true`.

Untuk scope ini, tambah RPC wrapper di frontend:
```ts
// di supabaseClient.ts
async clearConversationLock(convId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('conversations')
    .update({
      ai_active: true,
      state_locked_until: null,
      state_locked_by_admin_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', convId);
  if (error) throw error;
},
```

Di handler banner button:
```ts
onClick={async () => {
  const isLocked = activeChat.state_locked_until && new Date(activeChat.state_locked_until) > new Date();
  if (isLocked) await conversationsService.clearConversationLock(activeChat.id);
  else toggleAiControl(activeChat.id, banner.makeActive, ...);
}}
```

(Verifikasi nama service yang host conversation methods saat plan execution.)

- [ ] **Step 8: Run TypeScript build**

Run: `npm run build`. Fix error sampai pass.

- [ ] **Step 9: Run unit tests**

Run: `npm test`. Expected: all PASS.

- [ ] **Step 10: Smoke manual via dev server**

Run `npm run dev`. Login sebagai owner:
- Buka Sales Inbox → pilih chat
- Klik state badge di header → dropdown muncul dengan 13 state (2 terminal disabled, current di-highlight)
- Pilih state baru → dropdown tutup, system message muncul di chat, badge ganti dengan 🔒 + countdown, mode banner hijau "Mode Admin"
- Klik "Aktifkan AI Sekarang" → lock cleared, badge kembali normal, mode banner kembali biru "Dikelola AI"
- Login ulang sebagai kasir → klik state badge → tidak ada dropdown (button disabled)

Stop dev server.

- [ ] **Step 11: Commit**

Run:
```bash
git add -A
git commit -m "feat(sales-inbox): manual state override dropdown + lock countdown (Phase 3)

- Types: DbConversation.state_locked_until + state_locked_by_admin_id.
- supabaseClient: manuallyOverrideConversationState + clearConversationLock wrappers.
- SalesInboxScreen: chat header state badge → clickable button → popover dropdown
  (13 state, terminal disabled, current highlighted).
- Perm gate: dropdown hidden untuk role ≠ owner/admin.
- Lock countdown via setInterval(60s); 'Aktifkan AI Sekarang' early-resume.
- Mode banner hijau saat lock aktif.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Backend Go — lazy resume + state lock guard

**Files:**
- Modify: `backend-go/internal/db/conversations.go` (add `AutoResumeConv` + update model struct)
- Modify: `backend-go/internal/whatsapp/handler.go` (lazy resume sebelum process customer msg)
- Modify: `backend-go/internal/engine/machine.go` (skip state write saat locked)

**Interfaces:**
- Consumes: existing `db.Client`, `Conversation` model
- Produces:
  - `func (c *Client) AutoResumeConv(ctx context.Context, convID string) error`
  - `Conversation.StateLockedUntil *time.Time` field

- [ ] **Step 1: Add field ke Conversation model + scan**

Buka `backend-go/internal/db/conversations.go`. Cari struct `Conversation` (atau model file relevan). Tambah field:
```go
StateLockedUntil *time.Time `db:"state_locked_until"`
```

Cari query yang select `*` atau eksplisit kolom dari `conversations`. Tambahkan `state_locked_until` ke SELECT list dan scan target.

- [ ] **Step 2: Add `AutoResumeConv` method**

Di file yang sama:
```go
// AutoResumeConv flips ai_active=true + clears lock for a single conversation.
// Used as defense-in-depth saat pg_cron telat / failed.
func (c *Client) AutoResumeConv(ctx context.Context, convID string) error {
    _, err := c.pool.Exec(ctx, `
        UPDATE conversations SET
            ai_active = true,
            state_locked_until = NULL,
            state_locked_by_admin_id = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND state_locked_until IS NOT NULL
          AND state_locked_until < NOW()
    `, convID)
    return err
}
```

- [ ] **Step 3: Lazy resume di handler.go**

Buka `backend-go/internal/whatsapp/handler.go`. Cari titik di mana customer message diterima dan conv dimuat dari DB (sekitar pola `conv, err := db.GetConversation(...)`). Tambah sebelum check `!conv.AIActive`:

```go
// Lazy resume: kalau lock expired tapi pg_cron telat, flip ai_active sekarang.
if conv.StateLockedUntil != nil && conv.StateLockedUntil.Before(time.Now()) {
    if err := db.AutoResumeConv(ctx, conv.ID); err == nil {
        conv.AIActive = true
        conv.StateLockedUntil = nil
    } else {
        log.Printf("[HANDLER] AutoResumeConv failed for %s: %v", conv.ID, err)
    }
}

// Existing path:
if !conv.AIActive {
    log.Printf("[HANDLER] AI off for conv %s (locked until %v), skip auto-reply",
               conv.ID, conv.StateLockedUntil)
    return
}
```

- [ ] **Step 4: State write guard di machine.go**

Buka `backend-go/internal/engine/machine.go`. Cari titik di mana state baru ditulis kembali ke DB (kemungkinan pola `db.UpdateConversationState(...)`). Bungkus dengan guard:

```go
// Concurrency guard: kalau admin baru saja override + lock aktif, jangan timpa.
if conv.StateLockedUntil != nil && conv.StateLockedUntil.After(time.Now()) {
    log.Printf("[ENGINE] State locked until %v, skip recompute for conv %s",
               *conv.StateLockedUntil, conv.ID)
    return  // atau lanjut tanpa write state
}

// Existing write:
if err := db.UpdateConversationState(...); err != nil { ... }
```

(Sesuaikan pola — kalau write state ada beberapa lokasi, semua butuh guard.)

- [ ] **Step 5: Build backend**

Run:
```bash
cd backend-go && go build ./...
```

Expected: build sukses.

- [ ] **Step 6: Run backend tests**

Run:
```bash
cd backend-go && go test ./...
```

Expected: existing tests PASS. Jika fail karena struct mismatch (mis. test bikin `Conversation` literal tanpa `StateLockedUntil`), update test sample atau pakai zero value.

- [ ] **Step 7: Commit backend changes**

Run:
```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
git add backend-go/
git commit -m "feat(backend): conversation state lock guards + lazy resume (Phase 3)

- db.Conversation: tambah StateLockedUntil *time.Time + select+scan.
- db.AutoResumeConv: flip ai_active=true for single expired-lock conv.
- handler.go: lazy resume before AI-off check (defense kalau pg_cron telat).
- machine.go: skip state recompute write saat StateLockedUntil aktif (race-safe).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: E2E smoke via Chrome DevTools MCP + production rollout

**Files:** none (smoke + verification only)

**Interfaces:** none

- [ ] **Step 1: Deploy frontend ke Cloud Run --no-traffic revision**

Run:
```bash
git push origin main
```

Cloud Build trigger via existing pipeline (`cloudbuild.frontend.yaml` dengan `--no-traffic` pattern). Catat revision number dari Cloud Build console.

- [ ] **Step 2: Deploy backend Go ke Cloud Run --no-traffic revision**

Backend build mungkin punya pipeline terpisah. Catat revision.

- [ ] **Step 3: E2E smoke owner override flow via Chrome DevTools MCP**

Pakai Chrome DevTools MCP tools:
1. `navigate_page` ke preview URL Cloud Run revision
2. Login sebagai owner (`take_screenshot` after login untuk verifikasi)
3. `navigate_page` ke `/sales-inbox`
4. `take_snapshot` → identify chat row + state badge button
5. `click` state badge → verifikasi dropdown muncul (`take_screenshot`)
6. `click` opsi state baru (mis. `CONFIRMING`)
7. `take_snapshot` → verifikasi: badge berubah ke 🔒 + countdown, mode banner hijau, system message di chat
8. Cek DB via `mcp__plugin_supabase_supabase__execute_sql`:
   ```sql
   SELECT state, ai_active, state_locked_until
   FROM conversations WHERE id = '<convID>';
   ```
   Expected: state='CONFIRMING', ai_active=false, state_locked_until≈NOW+15min

- [ ] **Step 4: E2E smoke /pipeline redirect**

1. `navigate_page` ke `<preview-url>/pipeline`
2. Verifikasi URL final = `/sales-inbox` (via `evaluate_script` baca `window.location.pathname`)

- [ ] **Step 5: E2E smoke kasir permission gate**

1. Logout, login sebagai kasir
2. `navigate_page` ke `/sales-inbox`
3. `click` state badge → verifikasi dropdown TIDAK muncul (button disabled atau no popover)
4. Coba bypass via console: `evaluate_script("window.supabase.rpc('manually_override_conversation_state', {p_conv_id:'...', p_new_state:'CONFIRMING'})")`. Expected: error `not authorized`.

- [ ] **Step 6: pg_cron auto-resume verification**

Lock satu conv (sebagai owner). Tunggu 15 menit. Cek DB:
```sql
SELECT id, ai_active, state_locked_until FROM conversations
WHERE id = '<convID>';
```
Expected setelah ~16 menit: `ai_active=true`, `state_locked_until=NULL`.

Cek cron log:
```sql
SELECT runid, status, return_message, start_time FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='auto_resume_locked_conversations')
ORDER BY start_time DESC LIMIT 5;
```
Expected: row dengan return_message berisi count >= 1.

- [ ] **Step 7: Promote frontend + backend revisions ke 100% traffic**

Via `gcloud run services update-traffic` atau Cloud Run console UI:
```bash
gcloud run services update-traffic garindo-jaya-panel-msme-erp-frontend \
  --region asia-southeast1 \
  --to-revisions=<frontend-revision-id>=100

gcloud run services update-traffic garindo-jaya-panel-msme-erp-backend \
  --region asia-southeast1 \
  --to-revisions=<backend-revision-id>=100
```

(Sesuaikan service name + region dengan setup actual.)

- [ ] **Step 8: Update progress.md final**

Tambah ke `progress.md`:
```markdown
## 2026-06-21 — Pipeline Revamp Phase 3 (Delta C2) DEPLOYED 100% — state override + AI auto-pause + auto-resume

- DB migration 20260621090000 applied: state_locked_until/by columns + 2 RPCs + pg_cron 1-min job.
- Frontend: SalesInboxScreen state badge clickable, popover dropdown, lock countdown, perm gate (owner/admin).
- Backend Go: lazy resume di handler.go + state write guard di machine.go.
- E2E smoke PASS: owner override OK, kasir blocked, /pipeline redirect, cron auto-resume verified.
- Pipeline Revamp (3 phases, 8 tasks) SELESAI.
```

- [ ] **Step 9: Final commit**

Run:
```bash
git add progress.md
git commit -m "docs(progress): Pipeline Revamp 3 phases DEPLOYED 100% + smoked"
```

---

## Self-Review (executed by author of this plan)

**Spec coverage**:
- ✓ Goal (kill Pipeline + Slack-style filter + override) → Tasks 1, 3, 4, 5, 6, 7
- ✓ Delta A (hapus Pipeline UI) → Task 1
- ✓ Delta B (kill walk-in path) → Task 1 (combined per spec deployment plan)
- ✓ Delta C1 (Sales Inbox kategori list) → Tasks 2, 3, 4
- ✓ Delta C2 DB → Task 5
- ✓ Delta C2 frontend → Task 6
- ✓ Delta C2 backend → Task 7
- ✓ E2E testing → Task 8
- ✓ Permission gate (owner/admin only) → Step 1+2 di Task 5 (RPC), Step 3 di Task 6 (frontend), Step 5 di Task 8 (E2E verify)
- ✓ pg_cron + lazy resume dual-layer → Task 5 Step 2 (cron) + Task 7 Step 3 (lazy)
- ✓ Race condition guard di engine → Task 7 Step 4

**Placeholder scan**: ✓ no TBD/TODO/fill-in. Code blocks complete. Schema verification step (Task 5 Step 1) is explicit task, not placeholder.

**Type consistency**:
- `manuallyOverrideConversationState(convId, newState, lockMinutes?)` — sama di Task 6 wrapper dan smoke (Task 8) call.
- `categorize` / `categoryCounts` signatures sama di Task 2 (definition), Task 3 (consume), Task 4 (consume).
- `state_locked_until` field name konsisten di types (Task 6 Step 1), DB column (Task 5), Go struct (Task 7 Step 1).
- `InboxCategory` type literal: `'butuhAksi' | 'aiAktif' | 'menunggu' | 'riwayat'` konsisten.

Plan ready untuk execution.
