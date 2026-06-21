# Pipeline Revamp — Design Spec

**Date:** 2026-06-21
**Status:** Draft — pending user review before plan
**Mockup:** `docs/superpowers/mockups/2026-06-21-pipeline-revamp.html`

## Goal

Hapus menu Pipeline (low-value, redundant dengan Sales Inbox + Penjualan), pindahkan visualisasi lead funnel ke Sales Inbox sebagai filter kategori, dan tambah kemampuan admin manual override conversation state untuk koreksi saat AI salah klasifikasi.

## Non-Goals

- Inbox Pemilik / Owner Cockpit (rollup Piutang/PO/Persetujuan/Opname) — separate brainstorm.
- WA conversion-rate KPI card di Dashboard — separate work.
- Drop tabel `leads` di DB — backend Go masih write; UI Pipeline dihapus saja.
- Drop RPC `mark_walkin_order_paid` di DB — biarkan, drop di phase cleanup terpisah.
- Inbox Pemilik untuk Piutang/PO/Persetujuan/Opname rollup — separate spec.

## Why now

- Audit progress.md 2026-06-15 (baris 2985, 2872) sudah flag: "Pipeline screen brands itself as a sales kanban but renders a flat list... value-add over Order History unclear; consider folding into Order History."
- User feedback (2026-06-21): "kurang berguna dan add value buat MSME"
- Verifikasi data prod (2026-06-21): `SELECT sales_channel, status, count(*) FROM orders` → 5 rows total, semua `whatsapp`, ZERO walk-in. Fitur Tandai Lunas walk-in tidak pernah dipakai.

## Architecture

Tiga delta deploy dalam urutan risk-ascending:

```
Delta A+B  →  Delta C1     →  Delta C2
(Hari 1)     (Hari 2-3)       (Hari 4-5)
Pure delete  UI shift         DB + cron + backend
```

| Delta | Scope | Files | Risk |
|---|---|---|---|
| **A** | Hapus menu Pipeline | Sidebar, App.tsx, types, PipelineScreen.tsx, lib/urlRoute.ts | Low (UI delete) |
| **B** | Hapus walk-in markPaid path | supabaseClient (markWalkinPaid, fetchOpenWalkinDrafts) | Low (zero data impact) |
| **C1** | Sales Inbox Slack-style kategori list | SalesInboxScreen, Sidebar (badge count) | Medium (UI behavior change) |
| **C2** | Manual state override + lock | Migration baru, RPC baru, pg_cron, backend Go guard, SalesInboxScreen dropdown | High (DB + backend + cron) |

## Delta A — Hapus menu Pipeline

### File changes

| File | Perubahan |
|---|---|
| `src/components/Sidebar.tsx` baris 75 | Hapus entry `{ id: 'pipeline', label: 'Pipeline', icon: TrendingUp, ... }` |
| `src/App.tsx` baris 447 | Hapus `case 'pipeline':` di switch render |
| `src/types.ts` | Hapus literal `'pipeline'` dari union `ActivePage` |
| `src/components/PipelineScreen.tsx` | Hapus file |
| `src/lib/urlRoute.ts` | Tambah redirect rule `/pipeline` → `/sales-inbox` (preserve bookmark backward-compat) |
| `src/initialData.ts` baris 20, 43 | Hapus `pipeline: bool` dari role permission seeds — kecuali ada konsumen lain (cek saat plan) |
| `src/types.ts` `PermissionSet` | Hapus key `pipeline` |

### Preservation

| Yang TIDAK disentuh | Alasan |
|---|---|
| Tabel `leads` di DB | Backend Go masih write; data masih dipakai PelangganScreen via inline `LEAD_BADGE` baris 42 |
| `leadsService.fetchAll()` di `supabaseClient.ts` | Mungkin dipakai future Owner Inbox; tidak ganggu kalau dibiarkan |
| `LEAD_BADGE` const di PelangganScreen.tsx baris 42 | Inline definition; tidak butuh shared lib refactor |

### Verifikasi sebelum drop

- `grep -rn "ActivePage.*pipeline\|page === 'pipeline'\|'/pipeline'"` — pastikan semua reference dihapus
- `grep -rn "permKey.*pipeline\|pipeline.*PermissionSet"` di backend Go + RLS policies — kalau ada konsumen, deprecate dulu

## Delta B — Hapus walk-in Tandai Lunas path

### Data justification

Query prod 2026-06-21:
```sql
SELECT sales_channel, status, count(*) FROM orders GROUP BY sales_channel, status;
-- whatsapp · INVOICE_WRITTEN_OFF · 3
-- whatsapp · COMPLETED           · 2
-- (zero walk-in)
```

Fitur deferred-payment walk-in tidak pernah dipakai. Tidak ada data orphan, tidak ada migration, tidak ada user impact.

### File changes

| File | Perubahan |
|---|---|
| `src/lib/supabaseClient.ts` | Hapus `orderService.markWalkinPaid()` |
| `src/lib/supabaseClient.ts` | Hapus `salesEntriesService.fetchOpenWalkinDrafts()` |
| `PipelineScreen.tsx handleMarkPaid` | Otomatis hilang via Delta A |

### Yang dibiarkan (drop di phase cleanup terpisah)

- RPC `mark_walkin_order_paid` di DB
- Enum value `'walkin'` di `sales_channel` CHECK constraint
- Backend Go endpoint apapun yang refer `'walkin'` channel

### Verifikasi sebelum drop

- `grep -rn "markWalkinPaid\|fetchOpenWalkinDrafts"` — pastikan tidak ada caller lain
- `grep -rn "sales_channel.*=.*'walkin'\|sales_channel === 'walkin'"` di Catat Penjualan / Kasir flow — pastikan UI tidak masih create walk-in WAITING_PAYMENT. Kalau masih ada, surface jadi follow-up task

## Delta C1 — Sales Inbox: Slack-style kategori list

Ganti filter `[Semua | Admin (5) | AI (42)]` 3-tab kasar dengan 4-kategori vertical list mirip Slack channels / Gmail labels.

### Kategori mapping (final)

| Kategori | Color | Predicate |
|---|---|---|
| 🔴 **Butuh Aksi** | red | `(state IN ('ESCALATED_ADMIN','ESCALATED_WIRING','BOOKED','TIMEOUT_REMINDER')) OR (ai_active=false AND state NOT IN ('COMPLETED','CANCELLED'))` |
| 🔵 **AI Aktif** | blue | `ai_active=true AND state IN ('GREETING','COLLECTING','CLARIFYING','STOCK_CHECK','CONFIRMING','ADD_MORE','APPROVED')` |
| 🟡 **Menunggu** | yellow | `state IN ('DELIVERY')` |
| ✅ **Riwayat** | gray (collapsed default) | `state IN ('COMPLETED','CANCELLED')` |

**Catatan**: `(ai_active=false AND non-terminal)` masuk "Butuh Aksi" karena conv-nya dikelola admin (entah escalated atau manual override). Tanpa ini, conv overridden bisa "hilang" dari Butuh Aksi.

**Untuk verifikasi saat plan**: semantik `TIMEOUT_REMINDER` & `APPROVED` di Go engine — kalau ternyata APPROVED butuh admin action (verify pembayaran), pindah ke Butuh Aksi.

### UI layout

```
┌──────────────────────┐
│ Inbox AI · 47        │ ← header
├──────────────────────┤
│ [Search...........] 🔍│
├──────────────────────┤
│ KATEGORI             │
│ 🔴 Butuh Aksi      8 │ ← active (bg highlight + left border)
│ 🔵 AI Aktif       23 │
│ 🟡 Menunggu        5 │
│ ✅ Riwayat        11 │ ← muted color
├──────────────────────┤
│ [chat list filtered] │
│ Budi · Butuh Admin   │
│ Joko · Eskalasi Wir. │
└──────────────────────┘
```

- Klik baris kategori = filter list ke kategori itu
- Active state = bg highlight + left border accent (3px)
- Count badge di kanan (style mirip Slack unread)
- Hover tooltip = breakdown per-state
- Default kategori aktif saat load = "Butuh Aksi" (most urgent)
- Badge state per row tetap render label asli (mis. "Cek Stok") — granularitas dipertahankan

### Sidebar badge count

Sebelum: hitung dari `ESCALATED_*` saja
Sesudah: hitung dari predicate "Butuh Aksi"

### Code changes

| File | Perubahan |
|---|---|
| `src/components/SalesInboxScreen.tsx` baris 76, 95-111, 162-180 | Replace 3-tab filter dengan kategori list; new state `categoryFilter`; new helper `categorize(conv)` + counts |
| `src/components/Sidebar.tsx` | Update sidebar badge derive logic untuk Sales Inbox entry |

## Delta C2 — Manual state override + AI pause + auto-resume

### Behavior summary

```
Admin klik state badge di chat header
  → popover dropdown 11 state (terminal disabled)
  → pilih state baru
  → RPC manually_override_conversation_state(conv_id, new_state, 15)
     · UPDATE conversations SET
         state = new_state,
         ai_active = false,
         state_locked_until = NOW() + 15 min,
         state_locked_by_admin_id = current_admin
     · INSERT INTO messages (sender='system', text='Tony (Owner) mengubah status ke X, AI di-pause 15 menit, pada 14:23')
  → Admin handle reply manual selama 15 menit
  → pg_cron tiap 1 menit jalankan auto_resume_expired_locks()
     · UPDATE conversations SET ai_active=true, state_locked_until=NULL WHERE state_locked_until < NOW()
  → AI lanjut normal
```

### DB migration

`supabase/migrations/20260621NNNNNN_conversation_state_lock.sql`:

```sql
-- Schema delta
ALTER TABLE conversations
  ADD COLUMN state_locked_until TIMESTAMPTZ NULL,
  ADD COLUMN state_locked_by_admin_id UUID NULL REFERENCES admin_users(id);

CREATE INDEX idx_conversations_state_lock
  ON conversations(state_locked_until)
  WHERE state_locked_until IS NOT NULL;

-- Override RPC (SECURITY DEFINER, gated by owner/admin role)
CREATE OR REPLACE FUNCTION manually_override_conversation_state(
  p_conv_id UUID,
  p_new_state conversation_state,
  p_lock_minutes INT DEFAULT 15
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_admin_name TEXT;
  v_old_state conversation_state;
BEGIN
  -- Gate: role check (owner/admin only)
  SELECT id, name INTO v_admin_id, v_admin_name
  FROM admin_users
  WHERE auth_uid = auth.uid()
    AND role IN ('owner','admin')
    AND active = true;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'not authorized: only owner/admin can override conversation state';
  END IF;

  -- Guard: terminal state cannot be overridden (prevent revival)
  IF p_new_state IN ('COMPLETED','CANCELLED') THEN
    RAISE EXCEPTION 'cannot override to terminal state %', p_new_state;
  END IF;
  SELECT state INTO v_old_state FROM conversations WHERE id = p_conv_id;
  IF v_old_state IN ('COMPLETED','CANCELLED') THEN
    RAISE EXCEPTION 'cannot override conversation in terminal state %', v_old_state;
  END IF;

  -- Mutate
  UPDATE conversations SET
    state = p_new_state,
    ai_active = false,
    state_locked_until = NOW() + (p_lock_minutes || ' minutes')::INTERVAL,
    state_locked_by_admin_id = v_admin_id,
    updated_at = NOW()
  WHERE id = p_conv_id;

  -- Audit (system message in chat)
  INSERT INTO messages (conversation_id, sender, text, created_at)
  VALUES (
    p_conv_id, 'system',
    format('%s mengubah status ke %s, AI di-pause %s menit, pada %s',
           v_admin_name, p_new_state, p_lock_minutes,
           to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'HH24:MI')),
    NOW()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION manually_override_conversation_state TO authenticated;

-- Auto-resume RPC
CREATE OR REPLACE FUNCTION auto_resume_expired_locks() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
BEGIN
  WITH resumed AS (
    UPDATE conversations
    SET ai_active = true,
        state_locked_until = NULL,
        state_locked_by_admin_id = NULL,
        updated_at = NOW()
    WHERE state_locked_until IS NOT NULL
      AND state_locked_until < NOW()
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM resumed;
  RETURN v_count;
END;
$$;

-- pg_cron schedule (1 menit interval)
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'auto_resume_locked_conversations',
  '* * * * *',
  $$ SELECT auto_resume_expired_locks() $$
);
```

### Backend Go change (minimal — defense-in-depth)

`backend-go/internal/whatsapp/handler.go` — saat customer message masuk:

```go
// Lazy resume guard (defense in case pg_cron failed/delayed)
if conv.StateLockedUntil != nil && conv.StateLockedUntil.Before(time.Now()) {
    if err := db.AutoResumeConv(ctx, conv.ID); err == nil {
        conv.AIActive = true
        conv.StateLockedUntil = nil
    }
}

// Existing logic: skip auto-reply if ai_active=false
if !conv.AIActive {
    log.Printf("[HANDLER] AI off for conv %s (locked until %v), skip auto-reply",
               conv.ID, conv.StateLockedUntil)
    return
}
```

`backend-go/internal/engine/machine.go` — saat AI engine tries to write back state:

```go
// Concurrency guard: don't overwrite admin's manual state during lock
if conv.StateLockedUntil != nil && conv.StateLockedUntil.After(time.Now()) {
    log.Printf("[ENGINE] State locked until %v, skip state recompute", *conv.StateLockedUntil)
    // AI tetap balas (kalau ai_active=true setelah lazy resume), tapi tidak transisi state
    return
}
```

### Frontend changes

| File | Perubahan |
|---|---|
| `src/types.ts` `DbConversation` | Tambah field `state_locked_until: string \| null`, `state_locked_by_admin_id: string \| null` |
| `src/lib/supabaseClient.ts` | Tambah wrapper `manuallyOverrideConversationState(convId, newState, lockMin?)` |
| `src/components/SalesInboxScreen.tsx` | (a) Badge state di chat header jadi `<button>` dengan dropdown popover; (b) Render lock countdown `🔒 14 min`; (c) "Aktifkan AI Sekarang" tombol (calls `toggleAiControl(id, true)`); (d) Permission gate: hide dropdown kalau role bukan owner/admin |
| `src/components/SalesInboxScreen.tsx` | Countdown `setInterval(60_000)` untuk re-render sisa waktu |

### Realtime sync

`useRealtimeConversations` hook listen `conversations` table changes via Postgres CDC — column tambahan otomatis ke-include. Setiap admin override → realtime update ke semua client. Countdown UI rely on local clock + `setInterval` tick.

### Permission gate

Owner + admin only. Gated 2 lapis:
- Frontend: hide dropdown kalau `role NOT IN ('owner','admin')` (cosmetic, UX-friendly)
- Backend: RPC SECURITY DEFINER cek `admin_users.role IN ('owner','admin')` — defense-in-depth

Kasir TIDAK boleh override (mungkin tidak punya konteks bisnis untuk koreksi AI state).

## Data flow

### Normal AI flow (no override)
1. Customer kirim msg ke WA → backend Go handler.go terima
2. handler.go cek `conv.AIActive`. True → masuk engine
3. Engine call LLM → generate reply + recompute state
4. Engine write state baru ke `conversations`
5. Frontend `useRealtimeConversations` terima update via CDC → re-render

### Override flow
1. Owner/admin klik state badge di chat header → dropdown popover muncul
2. Pilih state baru → frontend call `manuallyOverrideConversationState(convId, newState)`
3. RPC validate role, terminal state guard, mutate (state, ai_active=false, lock=NOW+15min), insert system message
4. CDC fire → all clients re-render: avatar hijau (admin mode), countdown timer di header, system message muncul di chat
5. Admin handle reply manual selama 15 menit
6. Customer message selama lock window → handler.go cek `!conv.AIActive` → skip auto-reply
7. Lock expire (pg_cron 1 menit window): auto_resume_expired_locks() flip `ai_active=true`
8. Customer next msg → handler.go cek (lazy-resume guard kalau cron delayed) → AI normal flow

### Race condition handling (in-flight AI write)
- Engine baca conv.state=COLLECTING (3 sec ago) → call LLM (3-5 sec)
- Admin override mid-flight → conv.state=CONFIRMING, ai_active=false, locked
- Engine selesai LLM, write back state baru dari LLM result
- **Engine guard di machine.go cek `state_locked_until > NOW()` → skip write** — admin's state preserved

## Error handling

| Error | Handling |
|---|---|
| RPC override failed (role check) | Frontend toast: "Hanya owner/admin boleh ubah status manual" |
| RPC override failed (terminal state) | Toast: "Tidak bisa ubah status conversation yang sudah selesai/dibatalkan" |
| pg_cron extension tidak terinstal | Migration `CREATE EXTENSION IF NOT EXISTS pg_cron` defensive |
| Lock expire tapi pg_cron delayed | Lazy resume di handler.go saat next customer msg |
| Realtime sub putus saat lock countdown | Countdown stale tapi tidak break; next refetch sync state |
| Customer ghost setelah override (no msg + cron failed) | Cron tetap jalan 1 menit interval; tidak ada stuck case |
| Frontend state lock display vs server lock mismatch | CDC update otomatis; manual refresh fallback |

## Testing strategy

### Delta A+B (smoke)
- Sidebar render tanpa entry Pipeline
- Navigate `/pipeline` URL → redirect ke `/sales-inbox`
- Build (TypeScript) tidak error setelah `ActivePage` literal dihapus
- `grep -rn "markWalkinPaid\|fetchOpenWalkinDrafts"` → 0 hits

### Delta C1 (UI)
- Render Sales Inbox dengan 0/some/many conv → kategori list render benar
- Klik tiap kategori → filter list sesuai predicate
- Hover kategori → tooltip breakdown muncul
- Conv overridden (`ai_active=false`, state=CONFIRMING) → muncul di "Butuh Aksi", NOT "AI Aktif"
- Sidebar badge sync dengan "Butuh Aksi" count

### Delta C2 (DB + RPC)
- Manual smoke via Supabase SQL editor:
  - Fake `auth.uid()` ke admin role → `manually_override_conversation_state(uuid, 'CONFIRMING')` → success, ai_active=false, lock=NOW+15min, system message inserted
  - Fake `auth.uid()` ke kasir role → RPC raise 'not authorized'
  - Override ke 'COMPLETED' → RPC raise 'cannot override to terminal'
  - Override conv yang status='COMPLETED' → RPC raise 'cannot override conversation in terminal state'
- pg_cron job: tunggu 1 menit setelah override → cek `ai_active=true`, lock cleared
- Concurrency: simulate engine writing state mid-override → engine guard skips write

### E2E (browser via Chrome DevTools MCP saat plan)
- Login as owner → open Sales Inbox → klik state badge chat → dropdown muncul
- Pilih state → countdown muncul, system message in chat
- Login as kasir → klik state badge → dropdown tidak muncul (gated)
- Mock customer msg via Supabase insert → AI tidak auto-reply selama lock
- Tunggu lock expire → next customer msg trigger AI reply normal

## Deployment

| Step | Hari | Risk |
|---|---|---|
| Delta A+B: hapus Pipeline + walk-in path | 1 | Low (UI delete) |
| Delta C1: Slack-style kategori list | 2-3 | Medium |
| Delta C2: migration + RPC + cron + Go change + UI dropdown | 4-5 | High |

Each delta as separate PR + cloud build `--no-traffic` revision + smoke before promote-to-100%.

## Out of scope / follow-ups

- Drop tabel `leads` & RPC `mark_walkin_order_paid` di DB
- Drop enum value `'walkin'` di `sales_channel`
- Inbox Pemilik (Piutang/PO/Persetujuan/Opname rollup)
- WA conversion-rate KPI card di Dashboard
- Per-tenant kategori customization (multi-tenant defer)
- Lock TTL configurable per tenant (current: hardcoded 15 menit)
