---
name: pembelian-phase2-roadmap-design
description: Phase 2 roadmap — refactor existing PO into 4-entity model (Pesanan + Tagihan + Tukar Faktur + Pembayaran), SOP Profile per tenant, approval workflow, AP report, Quick Mode, reconciliation panel
metadata:
  type: project
---

# Pembelian Phase 2 — PO Refactor Roadmap

**Status:** Roadmap • brainstormed 2026-06-14
**Companion:** `2026-06-14-pembelian-belanja-numpang-lewat-design.md` — Phase 1 detailed spec
**Mockup:** `tmp/pembelian-cash-invoice-mockup.html` (Phase 1 reference)

Dokumen ini adalah **roadmap high-level** untuk Phase 2. Detail per komponen akan dispec ulang saat siap implementasi (post Phase 1 ship + tenant feedback).

## 1. Why

Existing PO (single entity, 4 status DRAFT → ORDERED → RECEIVED → PAID) mencampurkan 3 entitas akuntansi standar:

| Status PO existing | Equivalent Jurnal entity |
|---|---|
| DRAFT / ORDERED | Pesanan Pembelian |
| RECEIVED | Faktur Pembelian (Bill, dengan stok impact) |
| PAID | Pembayaran Pembelian |

Untuk **multi-tenant SaaS MSME**, ini punya 3 masalah:

1. **Non-standard untuk tenant yang familiar Jurnal/Accurate.** Tenant migrasi akan bingung — di Jurnal mereka biasa pakai 3 entitas terpisah dengan UI sendiri-sendiri.
2. **Consolidated payment hampir mustahil.** "1 transfer bayar 5 Tagihan supplier yang sama" tidak bisa di-model dengan 1 PO record.
3. **No support untuk Tukar Faktur ritual B2B Indonesia.** Distributor MSME yang punya jadwal tukar faktur mingguan dengan supplier tidak terlayani.

Phase 2 refactor PO ke **4-entity model** + tambah killer features (SOP Profile, Quick Mode, Reconciliation panel, AP report) supaya kompetitif vs Jurnal untuk segmen MSME Indonesia.

## 2. 4-Entity Model

```
1. Pesanan (Purchase Order)
       │ komitmen ke supplier, belum dapat barang
       ↓ (boleh skip)
2. Tagihan (Faktur Pembelian)        ← STOK +X
       │ barang + invoice supplier, ke AP
       ↓ (boleh skip ke #4)
3. Tukar Faktur (Join Invoice)
       │ consolidation N Tagihan same-supplier untuk bayar batch
       ↓
4. Pembayaran (Purchase Payment)      ← KAS −X
       │ aktual kas keluar; M:N dengan Tagihan ATAU 1:1 dengan Tukar Faktur
```

**Skema relasi:**
- 1 Pesanan : N Tagihan (partial delivery)
- 1 Tagihan : 1 Pesanan (optional FK, NULL untuk ad-hoc)
- 1 Tukar Faktur : N Tagihan (same supplier only)
- 1 Pembayaran : N PembayaranItem (junction)
- 1 PembayaranItem : 1 Tagihan ATAU 1 Tukar Faktur (exactly one)

### 2.1 Field umum lintas entitas (audit trail wajib)

Semua 4 entitas (Pesanan, Tagihan, Tukar Faktur, Pembayaran) punya 2 field audit trail dokumen:

- `supplier_doc_number` (text, opsional) — nomor referensi dokumen dari supplier:
  - Pesanan: nomor SO supplier (kalau supplier kasih konfirmasi)
  - **Tagihan: nomor faktur/invoice supplier — paling penting**
  - Tukar Faktur: nomor tanda terima tukar faktur
  - Pembayaran: nomor referensi transfer / cek
- `supplier_doc_photo_url` (text, opsional, Supabase Storage) — foto dokumen asli:
  - Pesanan: foto konfirmasi pesanan
  - **Tagihan: foto faktur asli supplier — paling penting**
  - Tukar Faktur: foto tanda terima fisik (signed)
  - Pembayaran: foto bukti transfer

**Soft duplicate warning di Tagihan:** Saat operator input `supplier_doc_number` di Tagihan, cek apakah supplier + nomor yang sama sudah ada. Warning, bukan block. Lihat BR6 di Phase 1 spec.

**Tukar Faktur bulk photo:** selain `supplier_doc_photo_url` (foto tanda terima), Tukar Faktur juga punya `tagihan_photos[]` jsonb dengan struktur `[{tagihan_id, photo_url}]` — operator upload 1 foto per Tagihan asli yang di-tukar (bulk camera roll, drag-drop multi).

## 3. Naming Convention (Indonesian everyday)

| Database table | UI label | Apa yang di-track |
|---|---|---|
| `purchase_orders` (rename) | **Pesanan** | Pesan ke supplier, belum dapat |
| `purchase_invoices` (extend type='STOCK') | **Tagihan** | Barang + invoice datang, ke AP |
| `purchase_invoices` (extend type='PASSTHROUGH') | **Belanja Numpang Lewat** | Phase 1 — pass-through, no stok |
| `tukar_faktur` | **Tukar Faktur** | Consolidation paket faktur untuk bayar |
| `purchase_payments` | **Pembayaran** | Kas keluar |
| `purchase_payment_items` | (internal) | Junction |
| `suppliers` (existing) | **Supplier** | Tidak berubah |

**Tenant config:** Pengaturan → Belanja → "Istilah" — tenant bisa override label per-entitas kalau perlu (e.g., distributor formal pakai "Faktur Pembelian", warung pakai "Nota Beli"). Default = bahasa awam di tabel atas.

## 4. SOP Profile (per tenant)

Saat tenant onboarding, pilih profil yang cocok dengan workflow tim mereka:

```
○ Warung                  — 1 step: Tagihan + auto-bayar di 1 form
○ Service Shop            — 2 step: Tagihan + Pembayaran terpisah
○ Toko Ritel              — 3 step: Pesanan + Tagihan + Pembayaran
○ Distributor B2B         — 4 step: Pesanan + Tagihan + Tukar Faktur + Pembayaran
○ Pass-through Only       — 1 step: Belanja Numpang Lewat saja
○ Saya atur sendiri       — checkbox per step
```

Backend: `tenant_settings.purchase_sop_profile` enum + `tenant_settings.purchase_steps_enabled` jsonb `{pesanan:bool, tagihan:bool, tukar_faktur:bool, pembayaran:bool, bnl:bool}`.

Sidebar **Pembelian** dan tombol "+ Buat Baru" menyesuaikan: tenant Warung cuma lihat 1 menu "Catat Belanja"; Distributor lihat full 5 menu.

Switch profil tidak destroy data lama — entitas hidden cuma di sidebar; row tetap accessible via URL & history.

## 5. Approval Workflow (Permission-Based)

### Permission keys baru di `PermissionSet`

| Permission | Default holder | Bisa apa |
|---|---|---|
| `pembelian.create` | Owner + Admin | Bikin Pesanan / Tagihan / Pembayaran sebagai DRAFT |
| `pembelian.approve_pesanan` | Owner | Setujui Pesanan DRAFT → ORDERED |
| `pembelian.approve_pembayaran` | Owner | Setujui Pembayaran DRAFT → LUNAS |

(Phase 3 boleh tambah `pembelian.approve_tagihan` kalau tenant butuh gate barang masuk.)

### Self-approve

Saat user punya kedua-duanya (create + approve_X), form punya 2 tombol:
- "Simpan Draft" → status DRAFT_PENDING_APPROVAL
- "Simpan & Setujui" → status langsung aktif, skip pending (audit log "created+approved in 1 second")

User yang cuma punya `create`: form cuma 1 tombol "Simpan untuk Persetujuan".

### Tenant config

Pengaturan → Belanja → 3 toggle (default OFF untuk tenant baru):
```
☐ Pesanan butuh persetujuan
☐ Pembayaran butuh persetujuan
☐ Tagihan butuh persetujuan (jarang aktif)
```

Kalau OFF: status aktif langsung tanpa pending state, regardless of permission.

### Notifikasi approval

Push notif (web push + dashboard widget) ke semua user dengan `approve_X` permission saat draft baru dibuat. Phase 3 tambah email + WA notif via whatsmeow.

## 6. Partial Delivery + Multi-Payment Mechanics

### Partial delivery (1 Pesanan → N Tagihan)

Item-level tracking di `pesanan_items.qty_received_total` (sum dari linked Tagihan items). Tagihan_item punya optional FK ke pesanan_item.

Saat operator buat Tagihan dengan Pesanan link:
- Item picker pre-fill dengan `qty_remaining = pesanan_item.qty - qty_received_total`
- Operator boleh edit (supplier kurang/lebih kirim)

Pesanan auto-CLOSED saat semua item fulfilled. Manual force-close juga support.

### Multi-Tagihan-per-Pembayaran + Partial Payment

`purchase_payments` punya `purchase_payment_items[]` (junction).

```
purchase_payments
  - id, amount_total, account_id, paid_at, status, payment_method
  - discount_amount (cash discount dari supplier)
  - PaymentItem[]:
      - tagihan_id    FK nullable
      - tukar_faktur_id FK nullable
      - amount         (untuk partial payment)
```

Constraint: EXACTLY ONE of (tagihan_id, tukar_faktur_id) non-NULL per item.

Tagihan.paid_amount = SUM(PaymentItem.amount WHERE tagihan_id=this OR via Tukar Faktur).

Tagihan status:
- BELUM_LUNAS (paid_amount = 0)
- DIBAYAR_SEBAGIAN (0 < paid_amount < total)
- LUNAS (paid_amount >= total)

### Smart suggestions di form Pembayaran

Saat pilih supplier, system suggest:
- "Bayar semua outstanding (Rp X)" — 1 klik pre-fill semua Tagihan
- "Bayar yang jatuh tempo minggu ini (Rp Y)"
- "Bayar Tukar Faktur #001 (Rp Z)"

## 7. AP Report (Pembelian → Beranda)

Dashboard default landing untuk menu Pembelian.

### Panel 1 — KPI strip

- Total Utang: sum AP outstanding
- Jatuh Tempo Bulan Ini
- Terlambat
- 7 Hari ke Depan

### Panel 2 — Per Supplier (sortable)

```
PT Eterna Persada           Rp 10jt    [Bayar] [▼]
  ├─ 3 Tagihan outstanding  Rp 5jt
  ├─ 1 Tukar Faktur         Rp 5jt
  └─ Jatuh tempo terdekat:  14 Jun
```

Tombol "Bayar" pre-fill Pembayaran form dengan semua outstanding supplier.

### Panel 3 — Aging Distribution (bar chart)

Belum jatuh tempo / 1-30 hari / 31-60 / 61-90 / 90+.

### Panel 4 — Cash Flow Forecast (7-14 hari)

Bar per hari dengan total Tagihan yang jatuh tempo.

### Reports tambahan (di tab Laporan)

1. Laporan Pembelian per Supplier
2. Laporan Pembelian per Produk (siapa supplier paling murah per SKU)
3. Laporan Tukar Faktur (kronologis)
4. Aging Schedule snapshot per tanggal

## 8. Reconciliation Panel (Tukar Faktur Day)

Skenario: sales Eterna datang Rabu bawa 5 Faktur asli. Admin perlu cek apakah cocok dengan Tagihan di sistem.

### Full Reconciliation mode (untuk distributor B2B)

```
Tukar Faktur — PT Eterna Persada — 14 Jun 2026

[Tagihan di sistem (outstanding dari Eterna)]
☑ INV-0123  Senin  Rp 500k  ✓ cocok
☑ INV-0145  Rabu   Rp 1.5jt ✓ cocok
☑ INV-0156  Kamis  Rp 250k  ✓ cocok
☐ INV-0177  Sabtu  Rp 750k  ⚠ supplier tidak bawa
                              [Pisahkan ke TF berikutnya]

[Faktur asing dari supplier (tidak ada di sistem)]
⚠ INV-0188  Rp 400k  → [Buat Tagihan dulu] [Skip]

[Foto bukti tukar faktur]
[📷 Foto 5 Faktur asli]  [+ Tambah foto]

Total terverifikasi: Rp 2.25jt
Jatuh tempo bayar:   [14 Jul 2026] (Net 30 dari hari ini)

[Batal] [Simpan Draft] [Tanda Tangan & Selesai]
```

Saat "Tanda Tangan & Selesai":
1. Tukar Faktur status → TERTANDA
2. Generate PDF "Tanda Terima Tukar Faktur" (cetak / WA ke supplier)
3. Tagihan-tagihan yang dicheck → `tukar_faktur_id` set
4. Calendar reminder schedule untuk payment_due_at

### Quick Mode untuk operator yang tidak butuh ribet

Tombol "Quick Tukar Faktur": pilih supplier → auto-select semua outstanding → simpan. Tanpa scan/foto/reconciliation. 2-3 klik vs full panel.

## 9. Quick Mode Form (1-form Cash Purchase)

Untuk SOP Warung & Service Shop. 1 form bikin Tagihan + Pembayaran sekaligus.

```
Catat Belanja
  Supplier: [Toko Pak Slamet (Pasar)        ▼]
  Tanggal: [14 Jun 2026]
  
  Item                Qty   Harga    Total
  [Lampu LED Philips]  10  35,000   350,000
  [Saklar Legrand 1G]   5  70,000   350,000
  [+ Tambah item]
  
  TOTAL: Rp 700,000
  
  Bayar: ⦿ Cash  ○ Transfer  ○ Tempo
  Bukti: [📎 Foto nota]
  
  [Batal] [Simpan]
```

Backend RPC `record_quick_purchase`:
1. Buat Tagihan dengan status LUNAS (kalau Cash/Transfer + paid) atau BELUM_LUNAS (kalau Tempo)
2. Buat Pembayaran dengan status LUNAS, linked ke Tagihan, amount = Tagihan total
3. Insert Kasir expense entry
4. Insert stock_lots (kalau type=STOCK) atau skip (kalau type=PASSTHROUGH)

Atomic — rollback semua kalau salah satu fail.

## 10. WA Reminder via whatsmeow

WhatsApp reminder ke supplier (free, via whatsmeow open-source library):

- **Trigger 1**: 3 hari sebelum Tagihan jatuh tempo — operator dapat opsi "Kirim WA ingatan ke supplier" dari Tagihan detail
- **Trigger 2**: Saat Pembayaran LUNAS — auto-send notif ke supplier "Tagihan #X sudah dibayar via [method] Rp Y"
- **Trigger 3**: Saat Tukar Faktur TERTANDA — kirim PDF Tanda Terima ke supplier via WA

Template message customizable di Pengaturan → Belanja → Template WA. Default templates 3-5 untuk kasus umum.

Implementation: existing whatsmeow integration (kalau ada). Cek backend Go untuk whatsmeow setup. Kalau belum ada, deploy whatsmeow service terpisah sebelum fitur ini ship.

## 11. Migration Strategy (existing PO data)

### Strategi: Big-bang split saat Phase 2 deploy

Mapping per status PO existing:

| PO existing status | → Jadi |
|---|---|
| DRAFT | 1 Pesanan(DRAFT) |
| ORDERED | 1 Pesanan(ORDERED) |
| RECEIVED | 1 Pesanan(CLOSED) + 1 Tagihan(BELUM_LUNAS, type=STOCK) |
| PAID | 1 Pesanan(CLOSED) + 1 Tagihan(LUNAS, type=STOCK) + 1 Pembayaran(LUNAS) |

### Stock lots refactor

```
stock_lots.po_id (existing)
  → stock_lots.source_id + stock_lots.source_type = 'TAGIHAN'
  → point ke Tagihan record baru (yang inherit data dari old PO RECEIVED)
```

### Kasir expense entries (existing dari PO PAID)

Tetap valid, ditambah cross-reference ke Pembayaran record baru via `kasir_expenses.pembayaran_id` FK.

### URL backward compat

`?po=PO-2026-0042` redirect ke detail Tagihan (atau Pesanan, tergantung mapping). Cross-reference: `pesanan.legacy_po_number = 'PO-2026-0042'`.

### Risk mitigation

1. **Dry-run script** di staging dengan production snapshot
2. **Checksum verification** sebelum/sesudah:
   - Total stock per SKU sama
   - Total AP outstanding sama
   - Total payment recorded sama
   - Total Kasir expense sama
3. **Rollback plan**: backup old tables (`purchase_orders_archive`), rollback script siap
4. **Maintenance window** ~30 menit di low-traffic hour (Sunday 02:00 WIB)
5. **Tenant by tenant migration** (kalau multi-tenant sudah live)

## 12. Out of Phase 2 scope

- **Permintaan Pembelian (Purchase Request)** — formal approval entity untuk multi-branch tenant. Phase 3 kalau ada demand.
- **Penawaran Pembelian (Quote)** — compare quote dari N supplier. Phase 3.
- **Retur Pembelian** — return barang rusak ke supplier. Phase 3.
- **Multi-currency** — semua dalam IDR. Phase 4 kalau tenant cross-border.
- **PPN / Faktur Pajak formal** — tenant yang strict tax compliance. Phase 3 (paid tier "Accounting Pro").
- **3-way match (PO ↔ GR ↔ Invoice)** — formal accounting flow untuk audit. Phase 3.

## 13. Phase 2 timeline estimate (rough)

| Sprint | Scope |
|---|---|
| Sprint 1 | Schema + RPC: Pesanan, Tagihan (type=STOCK), Pembayaran (junction). Approval permissions. SOP Profile setting. |
| Sprint 2 | Frontend: Tagihan menu (list/form/detail). Pesanan menu refactor. Permission gating. Quick Mode form. |
| Sprint 3 | Tukar Faktur entity + reconciliation panel + Quick TF mode. PDF Tanda Terima. |
| Sprint 4 | AP Report dashboard. Laporan refactor. WA reminder via whatsmeow. |
| Sprint 5 | Migration script (dry-run, staging test). Production rollout dengan maintenance window. |

Total ~5 sprints = ~2.5 bulan kerja. Bisa diparalelkan kalau ada lebih dari 1 dev.

## 14. Backward compatibility checklist

- ✅ Phase 1 BNL (`purchase_invoices` type='PASSTHROUGH') tidak terganggu — Phase 2 cuma ADD COLUMN.
- ✅ Existing PO data tidak hilang — di-migrate ke Pesanan+Tagihan+Pembayaran.
- ✅ Stock_lots refactor preserves FIFO ordering (received_at unchanged).
- ✅ Kasir expense entries tetap valid (cross-reference added).
- ✅ Existing reports masih jalan (queries di-update untuk merge old+new entities).
- ✅ URL bookmarks PO old di-redirect ke new entities.
- ⚠ User training material perlu di-update (PO → Pesanan + Tagihan + Pembayaran terms).
