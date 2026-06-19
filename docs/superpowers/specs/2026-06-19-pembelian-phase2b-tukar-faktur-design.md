---
name: pembelian-phase2b-tukar-faktur-design
description: Phase 2b implementation spec — Tukar Faktur entity (Jurnal-aligned search-and-add), JT override rule, Tanda Terima PDF, foreign-faktur escape via relaxed pi_type_linkage_check. Builds on Phase 2a (Pesanan + Tagihan + Pembayaran). Defers bulk-select + full AP Dashboard to Phase 2c.
metadata:
  type: design
  phase: 2b
  status: approved
  approved_at: 2026-06-19
  predecessor: 2026-06-16-pembelian-phase2-implementation-design.md
  mockup: tmp/pembelian-phase2b-tukar-faktur-mockup.html
---

# Pembelian Phase 2b — Tukar Faktur Implementation Design

## 1. Goal

Add **Tukar Faktur (TF)** as an optional bundling layer between Tagihan and Pembayaran, matching the in-person ritual at Garindo (sales rep datang Rabu serahkan faktur fisik, operator confirm + cetak Tanda Terima, bayar kolektif Net 30 kemudian). TF is opt-in — Phase 2a's Tagihan → Pembayaran direct path remains the default.

Pattern reference: **Jurnal Tukar Faktur Pembelian** — search-and-add UX, payment-derived status (no DRAFT/TERTANDA state machine), delete unlinks (does not void underlying Tagihans).

## 2. Scope

| In scope (Phase 2b) | Out of scope |
|---|---|
| `tukar_faktur` table + RPCs + Service layer | Bulk-select multi-Tagihan from Tagihan list — deferred to **Phase 2c** |
| Form: search-and-add Faktur per supplier | Full AP Dashboard (aging, cash-flow forecast) — **Phase 2c** |
| Foreign-faktur quick-add inline (relax `pi_type_linkage_check`) | TF supplier-side approval workflow — N/A (single tenant) |
| TF List + Detail pages | TF auto-suggest from Beranda — **Phase 2c** |
| JT override (TF JT supersedes Faktur JT while bundled) | Multi-currency, multi-warehouse split — out of MSME scope |
| Tanda Terima PDF (optional, on-demand) | Server-side PDF render — kept client-side per existing pattern |
| URL routing `?tf=TF-YYYY-MM-NNN` | |
| Secondary entry: "Tambah ke Tukar Faktur" button on Tagihan Detail | |

## 3. Architectural fit

```
                                            ┌──────────────────────────┐
                                            │  Tukar Faktur (Phase 2b) │
                                            │  (optional bundle)       │
                                            └────┬─────────────────────┘
                                                 │ ↕ 1:N via purchase_invoices.tukar_faktur_id
Pesanan ──► Tagihan (type=STOCK) ────────────────┴──► Pembayaran
            (purchase_invoices)                       (junction → tagihan_id XOR tukar_faktur_id)
Sales Order ──► Tagihan (type=PASSTHROUGH/BNL) ──────► Pembayaran
```

- TF lives **between** Tagihan and Pembayaran as opt-in bundle.
- Pembayaran junction (`pembayaran_items`) already supports `tagihan_id` XOR `tukar_faktur_id` since Phase 2a — no schema change there.
- Operator who doesn't ritual: Tagihan → Pembayaran direct, unchanged from Phase 2a.
- Operator who ritual (Garindo): Tagihan → TF → Pembayaran (1 transaksi cover N Tagihan).

## 4. Schema changes

### 4.1 `tukar_faktur` table — **revised from Phase 2a §4.3**

Drop the DRAFT/TERTANDA/PAID `status` enum from Phase 2a §4.3. Status of a TF is **derived** from `pembayaran_items` aggregations (Belum Lunas / Dibayar Sebagian / Lunas), matching Jurnal pattern.

```sql
CREATE TABLE public.tukar_faktur (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tf_number      text NOT NULL UNIQUE,                 -- format TF-YYYY-MM-NNN
  supplier_id    uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  tukar_date     date NOT NULL,                        -- tanggal ritual fisik
  payment_due_at date NOT NULL,                        -- JT override; auto-fill Net N from supplier
  total_amount   numeric NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount    numeric NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),  -- recomputed by trigger
  photo_urls     text[] NOT NULL DEFAULT '{}',         -- supplier-invoices/ bucket subdir
  tanda_terima_printed_at timestamptz NULL,            -- audit only; PDF re-generated on each print
  notes          text NULL,                            -- single free-text (per Phase 2a convention)
  created_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz NULL,
  voided_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason    text NULL,
  CHECK (paid_amount <= total_amount)
);

CREATE INDEX tukar_faktur_supplier_id_idx ON public.tukar_faktur(supplier_id);
CREATE INDEX tukar_faktur_due_at_idx ON public.tukar_faktur(payment_due_at) WHERE voided_at IS NULL;
```

**Notes on changes from Phase 2a §4.3:**
- Drop `status text`. Derived status logic in §6.
- Drop `tanda_terima_pdf_url text` (no longer stored — regenerate from current state, per existing Tagihan/PI Print pattern). Add `tanda_terima_printed_at` for audit only.
- Add `paid_amount numeric`, maintained by trigger from `pembayaran_items` sum where `tukar_faktur_id=this.id`.
- Drop assumption of separate `tukar_faktur_items` — relation Tagihan → TF stays via `purchase_invoices.tukar_faktur_id` (1:N).

### 4.2 `purchase_invoices` — new column + relaxed CHECK

```sql
ALTER TABLE public.purchase_invoices
  ADD COLUMN is_tf_quick_add boolean NOT NULL DEFAULT false;

-- Drop existing constraint added in Phase 2a (migration 20260620000003)
ALTER TABLE public.purchase_invoices DROP CONSTRAINT IF EXISTS pi_type_linkage_check;

ALTER TABLE public.purchase_invoices ADD CONSTRAINT pi_type_linkage_check CHECK (
  (type = 'PASSTHROUGH' AND order_id IS NOT NULL AND pesanan_id IS NULL)
  OR
  (type = 'STOCK' AND order_id IS NULL AND (
    pesanan_id IS NOT NULL                           -- normal path
    OR tukar_faktur_id IS NOT NULL                   -- bundled via TF (may or may not have Pesanan)
    OR is_tf_quick_add = true                        -- TF quick-add (no Pesanan, no items)
  ))
);
```

**Why `is_tf_quick_add` as a separate flag, not derived?** Because after TF deletion (which sets `tukar_faktur_id` to NULL), the Tagihan needs a way to still satisfy the constraint while operator decides what to do with it. The flag persists; the FK can be unlinked.

### 4.3 `pembayaran_items` — no change

Phase 2a already created junction with `tagihan_id XOR tukar_faktur_id` CHECK. Phase 2b reuses as-is.

### 4.4 Trigger: maintain `tukar_faktur.paid_amount`

```sql
CREATE OR REPLACE FUNCTION public._tf_recompute_paid_amount() RETURNS trigger AS $$
BEGIN
  UPDATE public.tukar_faktur
  SET paid_amount = COALESCE((
    SELECT SUM(pi_item.amount)
    FROM public.pembayaran_items pi_item
    JOIN public.pembayaran p ON p.id = pi_item.pembayaran_id
    WHERE pi_item.tukar_faktur_id = COALESCE(NEW.tukar_faktur_id, OLD.tukar_faktur_id)
      AND p.status = 'LUNAS'
      AND p.voided_at IS NULL
  ), 0)
  WHERE id = COALESCE(NEW.tukar_faktur_id, OLD.tukar_faktur_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER _tf_recompute_after_pembayaran_items
AFTER INSERT OR UPDATE OR DELETE ON public.pembayaran_items
FOR EACH ROW WHEN (COALESCE(NEW.tukar_faktur_id, OLD.tukar_faktur_id) IS NOT NULL)
EXECUTE FUNCTION public._tf_recompute_paid_amount();
```

Same pattern as Phase 2a's `_recompute_tagihan_status`.

## 5. RPCs

### 5.1 `generate_tf_number() RETURNS text`

Pattern matches Phase 2a `generate_pesanan_number`, `generate_pi_number`, `generate_pembayaran_number`. Format `TF-YYYY-MM-NNN`, monotonic per-month.

### 5.2 `record_tukar_faktur(payload jsonb) RETURNS jsonb`

```typescript
// payload
{
  supplier_id: uuid,
  tukar_date: 'YYYY-MM-DD',
  payment_due_at: 'YYYY-MM-DD',
  tagihan_ids: uuid[],                              // existing Tagihans to bundle
  quick_add_tagihans: [{                            // optional: foreign-faktur new Tagihans
    supplier_invoice_number: text,
    purchase_date: 'YYYY-MM-DD',
    total: number,
    payment_due_at: 'YYYY-MM-DD'
  }],
  photo_urls: text[],
  notes?: text
}

// Returns
{ tf_number: text, tf_id: uuid }
```

**Atomic operation:**
1. `INSERT tukar_faktur` (compute total_amount = SUM of bundled Tagihans' totals + quick_add totals).
2. For each `quick_add_tagihans`: `INSERT purchase_invoices` with `type='STOCK'`, `is_tf_quick_add=true`, `status='BELUM_LUNAS'`, `pesanan_id=NULL`. Returns new pi_id.
3. `UPDATE purchase_invoices SET tukar_faktur_id = v_tf_id WHERE id IN (tagihan_ids ∪ quick_add_ids)`.
4. Validate: all bundled Tagihans must have `supplier_id = payload.supplier_id` (same-supplier constraint, raise `same_supplier_violation`).
5. Validate: no Tagihan already in another non-voided TF (raise `tagihan_already_bundled` with existing TF number).

### 5.3 `update_tukar_faktur(p_tf_id uuid, payload jsonb) RETURNS jsonb`

Edit-header path. Updates: `tukar_date`, `payment_due_at`, `notes`, `photo_urls`. **Does NOT** add/remove Tagihans from bundle — that's `add_to_tf` / `remove_from_tf` separately, OR delete + recreate.

### 5.4 `add_tagihan_to_tf(p_tf_id uuid, p_tagihan_id uuid) RETURNS jsonb`

Single-row add. Validates: TF not voided, Tagihan same-supplier, Tagihan not in another TF, Tagihan not LUNAS. Recomputes `tf.total_amount`.

### 5.5 `remove_tagihan_from_tf(p_tf_id uuid, p_tagihan_id uuid) RETURNS jsonb`

Unlink: `UPDATE purchase_invoices SET tukar_faktur_id=NULL WHERE id=p_tagihan_id`. Recomputes `tf.total_amount`. Validates: TF.paid_amount=0 (cannot remove from partially-paid TF — must void Pembayaran first).

### 5.6 `delete_tukar_faktur(p_tf_id uuid) RETURNS jsonb`

- If `paid_amount > 0`: raise `cannot_delete_paid_tf` (must void Pembayaran first).
- Unlink all bundled Tagihans (set `tukar_faktur_id=NULL`).
- **Cascade-delete** any `purchase_invoices` where `is_tf_quick_add=true AND tukar_faktur_id` matches (orphan tf_quick_add Tagihans have no independent existence).
- Mark TF `voided_at = now()`.

Soft-delete via `voided_at` to preserve audit; the FK from bundled Tagihans removed so they reappear in outstanding lists.

### 5.7 `tf_recompute_pembayaran_suggestions(p_supplier_id uuid) RETURNS jsonb`

Extends Phase 2a `pembayaran_suggest_outstanding`. Returns:
```
{
  tagihan: [...],        // Tagihans outstanding NOT in any TF
  tukar_faktur: [...]    // TFs outstanding (paid_amount < total_amount)
}
```

Operator's Pembayaran form picks either or both via XOR junction.

## 6. Derived TF status

No `status` column. Computed in queries / RPC results:

```sql
CASE
  WHEN voided_at IS NOT NULL THEN 'VOIDED'
  WHEN paid_amount = 0 THEN 'BELUM_LUNAS'
  WHEN paid_amount < total_amount THEN 'DIBAYAR_SEBAGIAN'
  ELSE 'LUNAS'
END AS status
```

Frontend reads this from service layer. Status filter pill at TF List uses same derivation.

## 7. JT override rule

When Tagihan bundled into TF (`tukar_faktur_id IS NOT NULL`):
- **Effective JT** for that Tagihan = `tukar_faktur.payment_due_at` (TF's JT, set at ritual time).
- Tagihan's own `payment_due_at` column **unchanged** — preserved for audit and restoration when TF deleted.
- All consumers (AP Dashboard, BerandaPembelian, reminders) compute effective JT as:
  ```sql
  COALESCE(tf.payment_due_at, pi.payment_due_at) AS effective_due_at
  FROM purchase_invoices pi
  LEFT JOIN tukar_faktur tf ON tf.id = pi.tukar_faktur_id
  ```

UI shows JT asli with strikethrough + TF JT highlighted (mockup Layar 5 Daftar Faktur dalam Bundle).

## 8. Frontend

### 8.1 File structure

```
src/components/pembelian/tukar-faktur/
  TukarFakturList.tsx        — List view, matches PesananList pattern
  TukarFakturFormPage.tsx    — Buat/Edit, search-and-add UX (mockup Layar 1 + 2)
  TukarFakturDetailPage.tsx  — Detail view (mockup Layar 5)
  TfQuickAddTagihanModal.tsx — Foreign-faktur escape (mockup Layar 3)
  TandaTerimaPdf.tsx         — Client-side PDF generation (jsPDF), opens in new tab

src/lib/
  tukarFakturService.ts      — CRUD wrappers + RPC clients
```

### 8.2 PembelianScreen tab order — revised

```ts
// existing Phase 2a order:
['beranda', 'pesanan', 'tagihan', 'bnl', 'pembayaran', 'supplier']

// Phase 2b order:
['beranda', 'pesanan', 'tagihan', 'tukar-faktur', 'pembayaran', 'bnl', 'supplier']
```

BNL geser ke kanan Pembayaran karena pass-through alternate, bukan main stock flow. Tab order konsisten left-to-right dengan business flow.

### 8.3 Secondary entry on Tagihan Detail

Add button to `TagihanDetailPage.tsx`:
```tsx
{tagihan.status === 'BELUM_LUNAS' && !tagihan.tukar_faktur_id && (
  <button onClick={() => navigate(`?screen=pembelian&tf=new&prefill_tagihan=${tagihan.id}`)}>
    Tambah ke Tukar Faktur
  </button>
)}
```

If `tagihan.tukar_faktur_id IS NOT NULL`, show badge "Bagian dari TF-XXX" linking to TF Detail.

### 8.4 URL routing

- `?screen=pembelian&tf=TF-2026-06-001` → TF Detail
- `?screen=pembelian&tf=new` → TF Form (create)
- `?screen=pembelian&tf=new&prefill_tagihan=<uuid>` → TF Form with that Tagihan pre-added (secondary entry from Tagihan Detail)
- `?screen=pembelian&tf=new&prefill_supplier=<uuid>` → TF Form with supplier locked (future use)

Add to `App.tsx` deep-link handler alongside existing `?pesanan=`, `?tagihan=`, `?pembayaran=`.

## 9. Tanda Terima PDF

Client-side jsPDF generation, **on-demand** (not stored). Pattern matches existing Phase 1 BNL Print + Phase 2a Tagihan/Pesanan Print.

```typescript
// TandaTerimaPdf.tsx
function generateTandaTerima(tf: DbTukarFaktur): Blob {
  const doc = new jsPDF({ format: 'a5', unit: 'mm' });
  // ... layout per mockup Layar 5 collapsible preview
  return doc.output('blob');
}

function handleCetakClick(tf: DbTukarFaktur) {
  const blob = generateTandaTerima(tf);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // server-side: mark printed_at timestamp
  tukarFakturService.markPrinted(tf.id);
}
```

Format: A5 default (thermal-printer friendly for Garindo's counter). Future tenant config (Phase 3 multi-tenant): toggle A5 vs A4.

## 10. Business rules

| ID | Rule | Enforcement |
|---|---|---|
| TF-1 | Hanya 1 supplier per TF | App layer (RPC) raise `same_supplier_violation` |
| TF-2 | Tagihan tidak boleh ter-bundle di 2 TF simultaneously | App layer (RPC) raise `tagihan_already_bundled` |
| TF-3 | TF JT override JT Tagihan selama bundled | View layer: `COALESCE(tf.payment_due_at, pi.payment_due_at)` |
| TF-4 | Hapus TF = unlink Tagihans, cascade-delete tf_quick_add Tagihans | `delete_tukar_faktur` RPC |
| TF-5 | Cannot delete partially-paid TF | RPC raise `cannot_delete_paid_tf` |
| TF-6 | Cannot remove Tagihan from partially-paid TF | RPC raise `cannot_remove_from_paid_tf` |
| TF-7 | tf_quick_add Tagihan = `type=STOCK`, no items, no Pesanan link | Relaxed `pi_type_linkage_check` |
| TF-8 | TF same-supplier validated in Pembayaran junction | Phase 2a existing CHECK |
| TF-9 | TF auto-LUNAS via `_tf_recompute_paid_amount` trigger when `paid_amount = total_amount` | Trigger on `pembayaran_items` |
| TF-10 | Voided Pembayaran reverses `paid_amount` via trigger | `_tf_recompute_paid_amount` handles UPDATE/DELETE |

## 11. Migration

Single migration adds TF table + trigger + relaxed CHECK + new column. No data migration needed (no existing TF entities in Phase 2a — table reserved but never populated).

```
supabase/migrations/20260619000001_phase2b_tukar_faktur.sql
```

Backward-compat:
- Phase 2a Tagihans with `tukar_faktur_id IS NULL`: unchanged behavior.
- Phase 2a `pembayaran_items.tukar_faktur_id`: already exists, no change.
- New `purchase_invoices.is_tf_quick_add` column added with `DEFAULT false` — existing rows backfill to false safely.

## 12. Testing

### 12.1 Integration tests (`tests/integration/phase2b-tf-rpcs.test.ts`)

- `record_tukar_faktur` with 2 existing Tagihans → TF created, both linked, total = sum
- `record_tukar_faktur` with mixed supplier_id Tagihans → raises `same_supplier_violation`
- `record_tukar_faktur` with Tagihan already in another TF → raises `tagihan_already_bundled`
- `record_tukar_faktur` with quick_add → Tagihan created with `is_tf_quick_add=true`, `pesanan_id NULL`, satisfies CHECK
- `delete_tukar_faktur` unpaid → unlinks Tagihans, cascade-deletes tf_quick_add Tagihans
- `delete_tukar_faktur` partially paid → raises `cannot_delete_paid_tf`
- `_tf_recompute_paid_amount` trigger: record_pembayaran on TF → tf.paid_amount updates; void_pembayaran → reverts
- Same `pembayaran` with 1 row for TF and 1 row for loose Tagihan (same supplier) → both succeed via junction

### 12.2 Frontend smoke (manual, via Chrome MCP)

E2E happy path:
1. Login → Pembelian → click new "Tukar Faktur" tab
2. Klik "Buat Tukar Faktur" → form opens (Layar 1)
3. Pilih supplier "PT Eterna Persada" → JT auto-fill Net 30
4. Cari Faktur "PI-2026-06-005" → tambah → cari "INV-3401" → tambah
5. Cari Faktur "INV-3501" (foreign) → klik "Buat Tagihan baru" → modal (Layar 3) → simpan → kembali ke form dengan 3 Faktur
6. Catatan: "Test smoke" → Simpan → TF-2026-06-001 created
7. Detail page (Layar 5) shows 3 Faktur, 2 dari PI existing + 1 tf_quick_add
8. Klik "Cetak Tanda Terima" → PDF opens new tab
9. Klik "Bayar Tukar Faktur" → Pembayaran form pre-filled dengan 1 pembayaran_items pointing to tf_id
10. Simpan Pembayaran → TF auto-LUNAS, Tagihan-Tagihan otomatis LUNAS via cascade

DB verify between each step.

## 13. Out of scope (Phase 2c)

- **Bulk-select Tagihan list + floating action bar** (Bundle ke TF / Bayar Sekaligus): Adds multi-select UX pattern not present in current codebase; same-supplier guard logic; "Bayar Sekaligus" overlaps with existing Pembayaran multi-Tagihan. Defer to Phase 2c when full AP Dashboard workflow integrates it naturally.
- **Full AP Dashboard** (aging chart, cash-flow forecast, kalender JT supplier): Phase 2a BerandaPembelian lite version. Phase 2c will extend with TF integration.
- **TF auto-suggest** ("Supplier X sudah jadwal ritual besok — bundle 3 Faktur outstanding sekarang?"): Phase 2c notification.
- **A4 vs A5 print toggle**: Hardcode A5 thermal for Garindo. Phase 3 SaaS multi-tenant config.

## 14. Effort estimate

| Component | Days |
|---|---|
| Schema migration + relaxed CHECK + trigger | 0.5 |
| RPCs (6 functions) + integration tests | 1.5 |
| Service layer (tukarFakturService.ts) | 0.5 |
| TukarFakturList + filter | 0.5 |
| TukarFakturFormPage (search-and-add + Ringkasan) | 1.5 |
| TfQuickAddTagihanModal | 0.5 |
| TukarFakturDetailPage + JT countdown card | 1.0 |
| TandaTerimaPdf (jsPDF) | 0.5 |
| PembelianScreen tab refactor + App.tsx routing | 0.5 |
| Tagihan Detail "Tambah ke TF" secondary entry | 0.25 |
| Frontend smoke + bug fixes | 1.0 |
| **Total** | **~8 hari** |

Lebih besar dari Phase 2a estimate ~1 sprint, fits ~1.5 sprint with buffer.

## 15. References

- **Predecessor spec**: `docs/superpowers/specs/2026-06-16-pembelian-phase2-implementation-design.md` (§4.3 tukar_faktur, §5.3 RPCs, §9 Reconciliation panel)
- **Mockup**: `tmp/pembelian-phase2b-tukar-faktur-mockup.html` (6 layar, v4 final)
- **Jurnal docs**:
  - https://help-center.jurnal.id/hc/id/articles/13969888865689 (Menerima Pembayaran Join Invoice/Tukar Faktur)
  - https://www.jurnal.id/id/blog/solusi-enterprise-tagih-penjualan-besar-dengan-join-invoice/
  - https://help-center.jurnal.id/hc/id/articles/5356753449881 (Laporan Daftar Tukar Faktur)
- **Memory**: `feedback_tukar_faktur_optional.md`, `feedback_no_wa_supplier_reminder.md`, `feedback_no_approval_workflow.md`

## 16. Decisions (approved 2026-06-19)

All 4 open questions resolved — Opsi A across the board, locked into implementation plan:

| # | Decision | Implementation note |
|---|---|---|
| Q1 | **Cascade soft-delete** foreign-faktur Tagihan on TF delete | `delete_tukar_faktur` RPC sets `voided_at`+`void_reason='cascade from TF-XXX deletion'` on each `is_tf_quick_add=true` Tagihan. No hard-delete (audit trail preserved). |
| Q2 | **Regenerate on-demand** Tanda Terima PDF (no snapshot storage) | `TandaTerimaPdf.tsx` runs jsPDF client-side from current TF state; `tanda_terima_printed_at` timestamp marks first print for audit |
| Q3 | **Split actions** for Edit | "Edit Header" button = metadata only (notes/JT/photos); "Lepas Faktur" per row + "Tambah Faktur" search-bar separate. Each carries own validation. |
| Q4 | **Geser BNL** ke kanan Pembayaran | Tab order: `Beranda · Pesanan · Tagihan · Tukar Faktur · Pembayaran · BNL · Supplier`. Mitigation: 1-time toast notification "Tab Pembelian sudah re-arrange" on first TF tab open. |

Original open-questions content preserved below for context.

### Q1 — Kalau TF di-Hapus, Faktur "foreign" (yang dibuat inline tanpa Pesanan) ikut terhapus?

**Skenario:** Hari Rabu operator buat TF-001 dengan 3 Faktur. 1 di antaranya adalah Faktur dari sales rep yang **belum pernah dicatat sebelumnya** — operator pakai "Tambah Faktur baru" inline (Layar 3) buat catat di tempat. Hari Jumat ternyata TF salah, operator Hapus TF-001.

**Pertanyaan:** Faktur foreign yang 1 itu — yang dibuat lewat inline tadi — perlu diapain?

- **Opsi A (proposal saya):** Ikut terhapus bersama TF. Alasannya: Faktur ini cuma ada karena ritual TF, di luar TF dia tidak punya konteks (tidak ada Pesanan link, tidak ada items). Bersih.
- **Opsi B:** Tetap ada di list Tagihan jadi "Tagihan yatim" (tanpa Pesanan, tanpa items, tanpa TF). Operator perlu manual void atau edit sendiri.

**Recommended: A (cascade-delete).** B berisiko ninggalin Tagihan misterius di list yang operator lupa kenapa ada.

### Q2 — Tanda Terima yang dicetak ulang bulan depan, datanya yang mana?

**Skenario:** Hari ini operator print Tanda Terima TF-001 → kasih ke sales rep tanda-tangan basah. 2 minggu kemudian operator buka TF Detail lagi dan klik "Cetak Tanda Terima" lagi (mau cetak kopi buat arsip kantor). Selama 2 minggu itu Catatan TF sudah di-edit (tambah info).

**Pertanyaan:** PDF kedua yang dicetak isinya...

- **Opsi A (proposal saya):** Generate ulang dari data terkini. Kalau Catatan di-edit, perubahan ikut terlihat di cetakan ke-2. Simpel, no storage cost.
- **Opsi B:** Tampilkan persis seperti cetakan pertama (snapshot, immutable). Lebih ribet (perlu store PDF di Storage bucket), tapi lebih aman untuk audit (kalau ada dispute "kok Tanda Terima berubah?").

**Recommended: A (regenerate).** Garindo skala kecil, dispute jarang. Kalau perlu audit-grade snapshot, tambah Phase 3.

### Q3 — Kalau TF salah Faktur (operator mau ganti), gimana cara fix-nya?

**Skenario:** TF-001 sudah dibuat dengan 3 Faktur (INV-3344, INV-3401, INV-3450). Sales rep telepon: "eh INV-3401 tadi salah, harusnya INV-3402". TF belum dibayar.

**Pertanyaan:** Operator buka TF Detail, gimana cara fix?

- **Opsi A (proposal saya):** 
  - Tombol "Edit Header" cuma bisa edit Catatan/JT/Foto Lampiran
  - Buat ganti Faktur: di tabel "Daftar Faktur dalam Bundle", tombol kecil "Lepas dari TF" per row → keluarin INV-3401 → terus klik "Tambah Faktur" → cari INV-3402 → tambah
  - 2 step terpisah tapi explicit, tidak ada risiko salah-klik massal
- **Opsi B:** Tombol "Edit" buka full form yang mirip Layar 2 (header + search-and-add Faktur lagi). Edit semua dalam 1 page. Lebih cepat, tapi UX-nya lebih banyak field.

**Recommended: A (split actions).** Jelas mana yang sedang di-edit; tidak bisa salah-hapus Faktur waktu lagi edit Catatan.

### Q4 — Posisi tab "Tukar Faktur" di menu Pembelian, BNL geser ke kanan atau tidak?

**Sekarang (Phase 2a):**
```
Beranda · Pesanan · Tagihan · BNL · Pembayaran · Supplier
```

**Pertanyaan:** Setelah tambah tab "Tukar Faktur", mana yang lebih baik?

- **Opsi A (proposal saya): BNL geser ke kanan Pembayaran**
  ```
  Beranda · Pesanan · Tagihan · Tukar Faktur · Pembayaran · BNL · Supplier
  ```
  Alasan: 4-step main stock flow (Pesanan → Tagihan → TF → Pembayaran) berbaris rapi kiri-kanan. BNL pass-through alternate, jadi pindah ke kanan setelah main flow.

- **Opsi B: BNL tetap di tempat, TF disisipkan setelah BNL**
  ```
  Beranda · Pesanan · Tagihan · BNL · Tukar Faktur · Pembayaran · Supplier
  ```
  Alasan: Operator yang sudah biasa klik posisi 4 untuk BNL tidak perlu adjust. Cost: TF tampak "menjepit" main flow dengan BNL di tengah.

**Recommended: A.** Garindo masih early, muscle memory belum kuat. Sekali geser sekarang, urutan jadi logis untuk seterusnya.
