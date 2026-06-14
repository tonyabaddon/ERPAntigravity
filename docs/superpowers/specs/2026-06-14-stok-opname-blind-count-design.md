# Stok Opname — Blind-Count + Conditional Approval

**Spec date:** 2026-06-14
**Status:** Draft (awaiting user review)
**Mockup:** `docs/superpowers/specs/2026-06-13-stok-opname-blind-count-mockup.html`

## 1. Tujuan & ringkasan

Tambah dua mekanisme anti-bias ke modul Stok Opname yang sudah berjalan:

1. **Blind-count** — saat status sesi `in_progress`, hanya role Owner yang melihat `system_qty_snapshot`, `variance qty`, `variance Rp`, dan `Total Selisih`. Admin/staff lain input tanpa lihat sistem.
2. **Conditional approval** — kalau semua baris match sistem (variance = 0 untuk semua), sesi langsung "Selesai Otomatis" tanpa Owner PIN. Kalau ada selisih, jalur lama tetap berlaku (`pending_owner` → Owner PIN → committed).

Tujuan strategis: cegah admin "menyamakan angka fisik dengan sistem" untuk menutupi pencurian, sambil mengurangi friction operasional untuk opname yang clean. MSME-friendly: kontrol kuat saat input, transparansi pasca-input.

## 2. Behavior matrix (visibility per role per status)

| Status sesi | Role Owner | Role lain (admin/staff/saksi) |
|---|---|---|
| `in_progress` | Sistem ✓, Selisih qty ✓, Selisih Rp ✓, Total ✓ | **Semua disembunyikan** (badge "🔒 Tanpa Lihat Sistem") |
| `pending_owner` | Lihat semua | Lihat semua |
| `committed` / `rejected` | Lihat semua | Lihat semua |

Blinding hanya saat input window (`in_progress`). Setelah counts ter-frozen, transparansi penuh untuk admin (recap, learning, jawab pertanyaan owner).

## 3. Submit outcome branching

> **Note:** Gate 4 & 5 hanya berlaku kalau tenant setting `opname_require_witness = TRUE`. Lihat **Section 13** untuk detail configurability.

Saat admin tap "Kirim ke Owner untuk Disetujui", RPC `submit_opname` cek 5 gate:

1. `row_count > 0` (sesi punya minimal 1 baris)
2. SEMUA `counted_qty IS NOT NULL` (tidak boleh ada baris belum dihitung)
3. SEMUA `variance = 0` (semua match sistem)
4. `witness_acknowledged_at IS NOT NULL` (saksi sudah ack) — **skip kalau witness disabled**
5. `counter_user_id <> witness_user_id` — **skip kalau witness disabled**

```
Gate 4 gagal → ERROR "Saksi belum acknowledge"
Gate 1 gagal → ERROR "Sesi tidak punya baris untuk dihitung"
Gate 2 atau 3 gagal → PATH: pending_owner (jalur lama)
Semua gate lulus → PATH: auto-commit (Selesai Otomatis)
```

**Path Auto-commit (Selesai Otomatis):**
- Status sesi: `in_progress` → `committed`
- Stock sistem TIDAK berubah (variance = 0 untuk semua baris)
- Ledger `stock_movements` TIDAK ditulis (skip zero-delta rows; ledger untuk gerakan, bukan diam)
- Audit log entry `opname_auto_commit` ditulis dengan counter + witness
- Toast: "✓ Sesi #N selesai — semua cocok dengan sistem"

**Path Owner approval:**
- Status: `in_progress` → `pending_owner`
- `approval_requests` row dibuat (jalur existing)
- Owner buka Kotak Persetujuan, masukkan PIN
- Approve → `commit_opname` RPC: status → `committed`, stock sistem disesuaikan ke fisik, ledger ditulis, audit_log entry `opname_owner_commit`
- Reject → status → `rejected`, stock tidak berubah, audit_log entry `opname_owner_reject`
- Toast (admin): "→ Sesi #N dikirim ke Owner"

## 4. Backend changes

### 4.1 Migration A — `fetch_opname_counts` masking

RPC jadi SECURITY DEFINER dengan logic:

```sql
CREATE OR REPLACE FUNCTION public.fetch_opname_counts(p_session_id BIGINT)
RETURNS TABLE (
  session_id BIGINT, sku TEXT, warehouse TEXT,
  system_qty_snapshot INTEGER,  -- nullable
  counted_qty INTEGER,
  variance INTEGER,             -- nullable
  variance_value NUMERIC
) AS $$
DECLARE
  v_session_status public.opname_status;
  v_caller_role TEXT;
  v_mask BOOLEAN;
BEGIN
  SELECT status INTO v_session_status FROM stock_opname_sessions WHERE id = p_session_id;
  SELECT role INTO v_caller_role FROM admin_users WHERE id = auth.uid();

  -- Default-deny: kalau role lookup gagal, mask
  v_mask := (v_session_status = 'in_progress' AND COALESCE(v_caller_role, '') <> 'Owner');

  RETURN QUERY
    SELECT
      c.session_id, c.sku, c.warehouse,
      CASE WHEN v_mask THEN NULL ELSE c.system_qty_snapshot END,
      c.counted_qty,
      CASE WHEN v_mask THEN NULL ELSE c.variance END,
      CASE WHEN v_mask THEN 0 ELSE c.variance_value END
    FROM stock_opname_counts c WHERE c.session_id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

`get_opname_session` mask field `variance_total_value` dengan pola sama (walaupun di in_progress nilainya 0, tetap konsisten).

### 4.2 Migration B — `submit_opname` dengan auto-commit branch

```sql
-- existing validation: witness ack, scope, dll.
v_row_count := (SELECT COUNT(*) FROM stock_opname_counts WHERE session_id = p_session_id);
IF v_row_count = 0 THEN RAISE EXCEPTION 'Sesi tidak punya baris untuk dihitung'; END IF;

v_has_null := EXISTS (SELECT 1 FROM stock_opname_counts WHERE session_id = p_session_id AND counted_qty IS NULL);
v_has_variance := EXISTS (SELECT 1 FROM stock_opname_counts WHERE session_id = p_session_id AND variance <> 0);

IF NOT v_has_null AND NOT v_has_variance THEN
  -- AUTO-COMMIT path: panggil commit_opname internal (jangan duplikasi logic)
  PERFORM public.commit_opname_internal(p_session_id, p_user_id, 'auto');
  -- commit_opname_internal handles: status update, audit_log write
  -- Skip ledger writes karena delta = 0 untuk semua baris
  RETURN jsonb_build_object('status', 'committed', 'auto', true);
ELSE
  -- existing pending_owner path
  UPDATE stock_opname_sessions SET status='pending_owner', submitted_at=now(),
         variance_total_value=(SELECT SUM(variance_value) FROM stock_opname_counts WHERE session_id=p_session_id)
   WHERE id=p_session_id;
  INSERT INTO approval_requests (...) VALUES (...);
  RETURN jsonb_build_object('status', 'pending_owner', 'auto', false);
END IF;
```

### 4.3 Migration C — `recordOpnameCount` invalidate ack on edit

Setelah witness ack, kalau counter edit `counted_qty`, ack otomatis batal (re-witness required).

```sql
-- inside record_opname_count RPC, before UPDATE counted_qty
IF (SELECT witness_acknowledged_at FROM stock_opname_sessions WHERE id = p_session_id) IS NOT NULL THEN
  UPDATE stock_opname_sessions SET witness_acknowledged_at = NULL WHERE id = p_session_id;
END IF;
```

UI di session view harus refresh sesi state setelah `recordOpnameCount` panggilan supaya tombol "Saya Saksi" muncul lagi.

### 4.4 Migration D — `commit_opname` + reject path tulis audit_log

`commit_opname` (path Owner approve) tambahkan INSERT ke audit_log:

```sql
INSERT INTO audit_log (event_type, actor_user_id, payload) VALUES (
  'opname_owner_commit', auth.uid(),
  jsonb_build_object(
    'session_id', p_session_id,
    'counter_user_id', v_counter_id,
    'counter_name', v_counter_name,
    'witness_user_id', v_witness_id,
    'witness_name', v_witness_name,
    'approved_by_user_id', auth.uid(),
    'approved_by_name', v_approver_name,
    'row_count', v_row_count,
    'total_variance_value', v_total_variance
  )
);
```

`reject_opname` RPC (path Owner reject) tulis dengan `event_type = 'opname_owner_reject'` dan field tambahan `rejection_reason`.

### Affected files

| File | Perubahan |
|---|---|
| `supabase/migrations/20260614_opname_blind_count_rpc.sql` | Migration A (mask fetch_opname_counts + get_opname_session) |
| `supabase/migrations/20260614_opname_auto_commit_rpc.sql` | Migration B (submit_opname branch + commit_opname_internal helper) |
| `supabase/migrations/20260614_opname_reack_on_edit.sql` | Migration C (record_opname_count invalidate ack) |
| `supabase/migrations/20260614_opname_audit_log_events.sql` | Migration D (commit_opname + reject_opname audit entries) |
| `src/lib/supabaseClient.ts` | Update return types: `OpnameCount` nullable, `submitOpnameForOwner` return `{status, auto}` |
| `src/types.ts` | `OpnameCount.systemQtySnapshot: number \| null`, `OpnameCount.variance: number \| null` |
| `src/components/stok/StockOpnameSessionView.tsx` | Conditional rendering blind mode, refresh setelah recordOpnameCount, toast variants |

## 5. Frontend changes

### 5.1 `StockOpnameSessionView.tsx`

**Derived state:**
```tsx
const isOwner = currentUser?.role === 'Owner';
const isBlindMode = session?.status === 'in_progress' && !isOwner;
```

**Header (lines 285-291):** kalau `isBlindMode`, ganti "Total Varians" dengan badge `🔒 Tanpa Lihat Sistem`. Kalau tidak, tampilkan "Total Selisih" (rename dari "Total Varians" untuk bahasa konsisten).

**Per-row grid:** dua layout:
- Blind: `grid-cols-12: [3 Gudang | 6 Stok Fisik input | 3 spacer]` + column header row `[Gudang | Stok Fisik (yang Anda hitung)]`
- Full: `grid-cols-12: [2 Gudang | 3 Sistem | 3 Stok Fisik input | 4 Selisih]` dengan format selisih `-1 (-Rp 25.000)` digabung di kolom kanan + column header row

**Tombol submit:** text "Kirim ke Owner untuk Disetujui" (sebelumnya "Kirim ke Owner untuk Commit").

**Setelah submit, toast berdasarkan response:**
```tsx
const result = await submitOpnameForOwner(sessionId, currentUser.id);
if (result?.auto) {
  showToast('Sesi selesai — semua cocok dengan sistem (Selesai Otomatis)', 'success');
} else {
  showToast('Sesi dikirim ke Owner untuk persetujuan', 'success');
}
```

**Re-acknowledge required after edit:** kalau `session.witness_acknowledged_at` jadi NULL setelah `recordOpnameCount`, UI munculkan banner kuning "Counter mengubah angka — saksi perlu acknowledge ulang sebelum submit".

### 5.2 Banner pasca-commit (lines 419-422)

Ganti "Sesi sudah di-commit oleh Owner" → "Sesi sudah disetujui Owner".

## 6. Audit log structure

Tiga event types untuk path opname yang berbeda:

| event_type | Kapan ditulis | Actor |
|---|---|---|
| `opname_auto_commit` | `submit_opname` path auto | counter (admin) |
| `opname_owner_commit` | `commit_opname` setelah PIN | Owner |
| `opname_owner_reject` | `reject_opname` | Owner |

**Common payload fields:**
- `session_id`
- `counter_user_id`, `counter_name`
- `witness_user_id`, `witness_name`
- `warehouse_keys: [uuid, …]`
- `row_count`
- `total_variance_value`

**Tambahan per event:**
- `opname_owner_commit`: `approved_by_user_id`, `approved_by_name`
- `opname_owner_reject`: `rejected_by_user_id`, `rejected_by_name`, `rejection_reason`

**UI Pengawasan — Catatan Audit Opname (Owner only):**
Tabel dengan kolom Waktu, Sesi#, Penghitung, Saksi, Total Selisih, Status. Filter: rentang waktu, penghitung, saksi, status. Klik sesi → drill ke detail.

## 7. Owner approve action (existing behavior, unchanged)

Saat Owner approve di Kotak Persetujuan via PIN:

1. **Stock sistem otomatis disesuaikan ke stock fisik.** Misal SKU-A sistem=25 fisik=24 → setelah approve, stock_levels SKU-A jadi 24.
2. **Selisih ditulis ke `stock_movements`** sebagai immutable ledger. Satu row per (sku, warehouse) dengan delta non-zero, sumber = `opname_adjustment`, link ke `session_id`. Zero-delta rows tidak ditulis.
3. **Status sesi → `committed`.**
4. **Audit log entry `opname_owner_commit`** (per Section 6).
5. **Owner TIDAK bisa edit angka counted.** Kalau ada baris terlihat salah, reject seluruh sesi, admin re-count.

Saat Owner reject:
- Status sesi → `rejected`. Stock tidak berubah, tidak ada ledger entry.
- Audit log entry `opname_owner_reject` dengan alasan reject.

## 8. Edge cases

| Skenario | Behavior |
|---|---|
| Admin buka DevTools, panggil RPC `fetch_opname_counts` langsung | Server-side mask → tetap NULL. Cosmetic bypass impossible. |
| Owner ikut jadi counter | Owner lihat semua angka selama input (tidak blind). Audit log mencatat actor = Owner. |
| Sesi `pending_owner`, Owner reject | Status → `rejected`. Admin yang buka → blinding sudah off. Admin bisa buat sesi baru, re-count. |
| Submit dengan baris NULL counted_qty | Path pending_owner (bukan auto-commit). Toast "dikirim ke Owner". |
| Submit witness belum ack | RPC reject "Saksi belum acknowledge". |
| Counter edit setelah witness ack | `witness_acknowledged_at` di-NULL-kan. UI tampilkan banner "saksi perlu acknowledge ulang". |
| Sesi 0 baris | RPC reject "Sesi tidak punya baris untuk dihitung". |
| Sesi `in_progress` lama yang dibuat sebelum deploy | Admin lihat layout berubah saat refresh page. Tidak ada data loss. |
| Admin role berubah jadi Owner mid-session | Re-render → `isBlindMode=false` → angka muncul. Aman: role lookup at request time. |
| Race: dua admin submit sekaligus | Submit_opname transactional; pertama lolos, kedua dapat error "sesi tidak in_progress". |
| `variance_total_value` di session row | 0 selama in_progress (baru diisi saat submit). Tidak ada leak. |

## 9. Testing strategy

### Backend RPC integration tests

1. `fetch_opname_counts(caller=Owner, status=in_progress)` → semua field lengkap
2. `fetch_opname_counts(caller=admin, status=in_progress)` → `system_qty_snapshot=null, variance=null, variance_value=0`
3. `fetch_opname_counts(caller=admin, status=committed)` → semua field lengkap (blinding off)
4. `submit_opname(all_filled, all_variance_zero)` → status=committed, audit_log row `opname_auto_commit`, NO stock_movements rows
5. `submit_opname(has_variance)` → status=pending_owner, approval_request row created (existing path tidak rusak)
6. `submit_opname(has_null_counted_qty)` → status=pending_owner (NOT auto-commit)
7. `submit_opname(empty_session)` → exception "Sesi tidak punya baris"
8. `submit_opname(witness_not_acked)` → exception "Saksi belum acknowledge"
9. `record_opname_count` saat witness sudah ack → `witness_acknowledged_at` jadi NULL
10. `commit_opname(via_owner_PIN)` → audit_log row `opname_owner_commit` dengan counter+witness names
11. `reject_opname(via_owner)` → audit_log row `opname_owner_reject` dengan reason

### Frontend manual smoke

1. Login admin → mulai sesi → cek kolom Sistem & Variance hilang, badge "🔒 Tanpa Lihat Sistem" muncul, column header "Stok Fisik (yang Anda hitung)" tampak
2. Login Owner → buka sesi yang sama → cek semua angka tampil, kolom Selisih digabung `-1 (-Rp 25.000)`
3. Admin submit semua match → toast Selesai Otomatis, status di list = Selesai
4. Admin submit dengan variance → toast "dikirim ke Owner", status = Menunggu Persetujuan
5. Owner buka Kotak Persetujuan → hanya sesi variance yang muncul, auto-commit tidak masuk inbox
6. Admin buka sesi committed → angka muncul kembali (post-input transparency)
7. Counter edit angka setelah witness ack → banner kuning muncul, tombol submit di-disable sampai witness re-ack
8. Pengawasan → Catatan Audit Opname → tampil 3 jenis status (Selesai Otomatis, Disetujui Owner, Ditolak) dengan kolom Penghitung & Saksi

## 10. Migration order (deployment sequence)

**Penting:** frontend null-tolerance harus deploy DULU (atau bersamaan), supaya tab lama tidak crash baca NULL dari masked RPC.

1. Frontend update — `types.ts` nullable + `StockOpnameSessionView.tsx` handle null + conditional rendering. Deploy. Smoke test: existing sesi non-masked masih jalan.
2. DB Migration A — `fetch_opname_counts` masking. Deploy. Smoke test: admin sesi in_progress lihat blinding, Owner lihat lengkap.
3. DB Migration C — `record_opname_count` invalidate ack. Deploy. Smoke test: edit setelah ack reset witness.
4. DB Migration B — `submit_opname` auto-commit branch + `commit_opname_internal` helper. Deploy. Smoke test: semua-match auto-commit, variance via Owner.
5. DB Migration D — audit_log entries di commit + reject. Deploy. Smoke test: Pengawasan tampilkan 3 jenis entry.
6. DB Migration E (witness configurability per Section 13) — schema relax + settings row + Pengaturan toggle. Deploy LAST karena affect semua RPC (mereka harus baca setting). Default TRUE = zero behavioral change untuk existing tenant.

Setiap step bisa di-commit independent. Total estimate: 1.5 hari kerja (backend 5 jam + frontend 4 jam + tests 2 jam) — tambahan 4 jam dari Section 13 (witness config + Pengaturan UI + tests both modes).

## 11. Out of scope (sengaja tidak dikerjakan)

- **Tolerance ±X** untuk auto-commit. Strict equality saja. Bisa ditambahkan kalau MSME merasa praktis tidak match perfect.
- **Permission granular `can_see_system_qty_during_opname`** di Pengaturan. Fix ke role `Owner` dulu.
- **Larangan Owner jadi counter** (separation-of-duty). Owner tetap boleh count sendiri.
- **Owner edit angka counted sebelum approve.** Reject + re-count = pola yang dipertahankan (chain-of-custody aman).
- **Blinding sampai pending_owner atau permanen.** MSME-friendly: blind hanya di `in_progress`.
- **Witness sharing 1 HP dengan counter.** Operational gap terpisah, tidak terkait spec ini.
- **Multi-location/branch dengan SOP witness berbeda dalam tenant sama.** Setting global per tenant saja. Per-location config = iterasi berikutnya.
- **Notifikasi push ke Owner saat ada sesi pending.** Sudah ada di flow existing, tidak diubah.
- **Bulk reject** atau partial approve. Tetap satu sesi = satu keputusan atomic.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Admin tahu pola "match → auto-commit" → sengaja submit angka cocok untuk hide theft | Blind-count = admin tidak tahu angka sistem, tidak bisa intentionally match. Witness ack lapis kedua. |
| Owner kehilangan visibility atas auto-commit yang sering | `opname_auto_commit` audit_log + Catatan Audit table di Pengawasan. Owner bisa filter "auto-commit minggu ini" untuk anomaly check. |
| RPC masking gagal (typo, role lookup error) → angka leak ke admin | Default-deny pattern: `COALESCE(role,'') <> 'Owner'`. Plus unit test khusus untuk masking. |
| Frontend cache stale → tampilkan angka lama saat blind kicks in | Hard refresh state on session change. Backend selalu source of truth. |
| Re-ack requirement bikin admin sebal | Banner kuning kasih konteks ("counter mengubah angka — saksi perlu acknowledge ulang"). 1 tap dari witness, bukan flow ulang. |
| Audit_log table belum ada / struktur berbeda | Verifikasi schema di task awal implementation. Kalau tidak ada, blocker — surface ke user sebelum kode. |

## 13. Configurable Witness Requirement (Tenant SOP)

**Motivasi:** Tenant punya SOP berbeda. Ada yang ketat (two-person rule wajib), ada yang lebih kecil/longgar (satu orang owner cukup, witness friction berlebih). Spec ini membuat witness configurable di Pengaturan, default ON (MSME-safe).

### 13.1 Setting

Tambah row di tabel settings (existing `tenant_settings` atau `app_settings` — verifikasi nama di awal implementation):

| Key | Type | Default | Description |
|---|---|---|---|
| `opname_require_witness` | BOOLEAN | TRUE | Wajibkan saksi (orang ke-2) untuk sesi opname |

UI di Pengaturan screen (Owner only):

```
[Modul Stok Opname]

☑ Wajibkan saksi saat opname
   Saat aktif: setiap sesi butuh saksi (counter ≠ saksi),
   saksi acknowledge sebelum submit, dan two-person rule berlaku.
   Saat nonaktif: counter bisa kerja sendiri, tidak ada acknowledge step.
   Rekomendasi: AKTIF untuk toko dengan staff > 1.
```

### 13.2 Behavior matrix dengan setting

| Aspek | `require_witness = TRUE` (default) | `require_witness = FALSE` |
|---|---|---|
| Start opname session | UI prompt pilih counter + witness | UI prompt pilih counter saja |
| `witnessed_by_user_id` | NOT NULL, ≠ counter | NULL allowed |
| `chk_two_person` constraint | Aktif (counter ≠ witness) | **Tidak diterapkan** kalau witness NULL |
| Tombol "Saya Saksi (Acknowledge)" | Tampak, wajib dipencet sebelum submit | Tidak tampak |
| Submit gate witness ack | Wajib `witness_acknowledged_at NOT NULL` | Skip |
| Counter edit setelah ack | Reset ack, banner kuning | N/A (tidak ada ack) |
| Audit log payload field `witness_*` | Required (counter + witness) | `witness_user_id: null, witness_name: null` |
| UI Catatan Audit kolom "Saksi" | Tampilkan nama saksi | Tampilkan "—" atau "(solo)" |
| Blind-count rule untuk Admin | Tetap berlaku (Owner only lihat sistem) | **Tetap berlaku** (independen dari witness) |
| Owner approve flow | Tidak berubah | Tidak berubah |

### 13.3 Schema changes

```sql
-- Migration: relax witness columns + constraint
ALTER TABLE public.stock_opname_sessions
  ALTER COLUMN witnessed_by_user_id DROP NOT NULL;

ALTER TABLE public.stock_opname_sessions
  DROP CONSTRAINT chk_two_person;

-- Replace with conditional: hanya enforce kalau witness ada
ALTER TABLE public.stock_opname_sessions
  ADD CONSTRAINT chk_two_person_when_witness_present
  CHECK (witnessed_by_user_id IS NULL
         OR counted_by_user_id <> witnessed_by_user_id);

-- Settings row (kalau pakai tenant_settings key-value)
INSERT INTO public.tenant_settings (key, value, value_type)
VALUES ('opname_require_witness', 'true', 'boolean')
ON CONFLICT (key) DO NOTHING;
```

### 13.4 RPC behavior changes

**`start_opname_session(counter, witness=null)`:**
- Cek setting `opname_require_witness`
- Kalau TRUE dan witness NULL → reject "Saksi wajib di-set"
- Kalau FALSE dan witness NULL → izinkan, simpan witness=NULL

**`submit_opname`:**
- Tambah branch: kalau `opname_require_witness=FALSE` skip gate 4 & 5
- Auto-commit path tetap sama, witness null tidak masalah

**`record_opname_count` invalidate ack:**
- Skip invalidation kalau `opname_require_witness=FALSE` (tidak ada ack untuk di-invalidate)

**`commit_opname` / `reject_opname` audit log:**
- Payload selalu include `witness_user_id` dan `witness_name` (null kalau setting OFF)

### 13.5 Frontend changes

**Pengaturan screen** — tambah toggle "Wajibkan saksi saat opname" (Owner permission required to change).

**StockOpnameScreen.tsx (start session modal):**
- Kalau setting OFF: dropdown "Saksi" tidak muncul, hanya "Penghitung"

**StockOpnameSessionView.tsx:**
- Header: kalau setting OFF, jangan tampilkan info "Saksi: ..."
- Action bar: kalau setting OFF, tombol "Saya Saksi (Acknowledge)" tidak di-render
- Submit button enable condition: kalau setting OFF, ignore witness ack state
- Tidak ada banner "saksi perlu re-ack" (tidak ada ack untuk di-reset)

**Catatan Audit Opname table:**
- Kolom "Saksi" tampilkan `—` (em-dash) untuk row dengan witness NULL

### 13.6 Migration & rollout considerations

- **Default TRUE** — existing tenants tidak terpengaruh saat deploy. Setting baru aktif tapi rule sama dengan sebelumnya.
- **Sesi in-progress saat setting di-toggle** — grandfather: sesi tetap pakai aturan saat mereka di-start. Tidak migrate ulang.
- **Toggle OFF di tengah sesi** — affect hanya sesi baru. Tidak retroaktif.
- **Toggle ON dari OFF** — sesi yang sudah jalan tanpa witness tetap bisa submit (grandfather). Sesi baru wajib witness.
- **Edit constraint** — drop CHECK + tambah conditional CHECK harus di transaksi single (avoid race).

### 13.7 Edge cases tambahan

| Skenario | Behavior |
|---|---|
| Setting OFF, counter sendirian, submit semua match → auto-commit? | YES. Counter solo + zero variance + no witness required → langsung Selesai Otomatis |
| Setting OFF, counter solo, ada variance → pending_owner? | YES. Tetap butuh Owner PIN untuk variance (lapis defense terpisah dari witness) |
| Owner toggle dari ON → OFF saat ada 3 sesi `in_progress` dengan witness assigned | Grandfather: 3 sesi tetap butuh witness ack. Sesi ke-4 tidak perlu witness. |
| Setting OFF, role Admin start sesi tanpa pilih witness | Berhasil, witness=NULL di DB |
| Setting ON, role Admin coba start sesi tanpa pilih witness | RPC reject "Saksi wajib di-set" |

### 13.8 Trade-off & risk

| Risk | Mitigation |
|---|---|
| Tenant OFF tanpa pikir matang → kehilangan two-person control | Tooltip di Pengaturan: "Rekomendasi AKTIF untuk toko dengan staff > 1". Plus copy text yang jelaskan konsekuensi. |
| Audit table kolom Saksi banyak `—` bikin Owner confused | Tooltip "(solo)" pada cell `—` untuk konteks |
| Setting bug → mode mismatch antara UI & RPC | Single source of truth: RPC selalu cek setting at submit time, tidak rely on frontend |
| Tenant punya beberapa lokasi dengan SOP berbeda | Out of scope: setting global per tenant. Multi-location bisa di iterasi berikutnya. |

### 13.9 Affected files (delta dari Section 4)

| File | Tambahan |
|---|---|
| `supabase/migrations/20260614_opname_witness_optional.sql` | Schema relax + settings row |
| Frontend: `PengaturanScreen.tsx` | Toggle UI |
| Frontend: `StockOpnameScreen.tsx` | Skip witness prompt kalau setting OFF |
| Frontend: `StockOpnameSessionView.tsx` | Conditional render header info, ack button, submit gate |
| Backend RPCs (semua di Section 4) | Tambah branch baca setting `opname_require_witness` |

---

## 14. Acceptance criteria

Spec selesai diimplementasi kalau:

- [ ] Login admin → start sesi → tidak lihat Sistem / Selisih / Total
- [ ] Login Owner → start sesi → lihat semua angka, kolom Selisih digabung qty + Rp
- [ ] Admin submit semua match → status langsung committed, audit_log `opname_auto_commit` ada
- [ ] Admin submit dengan variance → status pending_owner, Owner PIN required
- [ ] Owner reject → status rejected, audit_log `opname_owner_reject` dengan reason
- [ ] Owner commit → stock sistem disesuaikan ke fisik, audit_log `opname_owner_commit`
- [ ] Counter edit setelah ack → witness ack reset, banner kuning muncul, submit di-disable
- [ ] RPC reject empty session
- [ ] RPC mask field via Postman/curl call by admin token (security test)
- [ ] Catatan Audit Opname table di Pengawasan tampilkan 3 jenis status dengan kolom Penghitung & Saksi
- [ ] Pengaturan toggle "Wajibkan saksi saat opname" berfungsi: ON = flow lama, OFF = single-operator allowed (per Section 13)
- [ ] Setting OFF + counter solo + match → auto-commit jalan
- [ ] Setting ON + start tanpa witness → RPC reject
- [ ] Audit table kolom Saksi tampil "—" untuk sesi solo
