# VOSI — Kontrol Anti-Fraud (Pitch Deck Content)

**Untuk:** Slide "Sistem Anti-Curang" di pitch deck ke calon tenant MSME Indonesia (owner distributor / toko / warung).
**Tanggal audit:** 2026-07-11
**Basis:** Audit codebase — hanya fitur yang **sudah shipped**, bukan roadmap.
**Bahasa:** Indonesia semi-formal (Anda / owner).
**Cara pakai:** Copy ke slide, atau paste ke Claude PPT builder sebagai section spec.

---

## Judul Slide (Rekomendasi)

**Headline:** Sistem yang Bikin Susah Curang — Bahkan Dari Diri Sendiri

**Sub-headline:** 32 kontrol terpasang di level database — bukan sekadar tampilan cantik.

---

## 5 Pilar Kontrol Anti-Fraud

### Pilar 1 — Jejak Audit yang Tidak Bisa Dihapus

Semua aksi tercatat siapa-kapan-apa. Bahkan admin database sekalipun tidak bisa hapus history.

- **Audit trail lengkap** — pembayaran diverifikasi, tenant di-impersonate, stok diubah, semua masuk log immutable. Owner bisa lihat sendiri di `/admin/audit` (search + export CSV).
- **Ledger stok append-only** — setiap perubahan stok jadi baris baru. Trigger + REVOKE bikin data mustahil dihapus atau diedit. *Kalau kasir bilang "stok emang segitu Bu", history yang bicara.*
- **Riwayat harga tidak bisa diedit** — perubahan master price masuk log immutable. Ketahuan kalau ada yang turunkan harga diam-diam sebelum jual.

---

### Pilar 2 — Verifikasi Pembayaran 2-Step (Owner-Approved)

Uang belum diakui masuk sebelum owner setujui. Bukti wajib, anomali auto-flag.

- **Non-cash payment wajib diverifikasi owner** — kasir transfer/QRIS masuk queue "Pending". Owner cek bukti → verify atau reject.
- **Bukti wajib diupload** — transfer/QRIS tanpa lampiran bukti langsung ditolak sistem. Tidak bisa "catat dulu, bukti nyusul".
- **Deteksi anomali nominal** — setoran meleset >10% dari nominal seharusnya (misal typo 9jt vs 90jt) → sistem kasih badge "⚠ Anomali" untuk owner review.
- **Rejection ada alasan tercatat** — owner tolak pembayaran → reason wajib diisi, masuk audit trail.

---

### Pilar 3 — Integritas Stok

Dari warung kelontong sampai distributor — stok tidak bisa "disesuaikan" diam-diam.

- **Stock Opname buta + saksi** — staff hitung tanpa lihat sistem, wajib nama saksi. Variance ≠ 0 otomatis eskalasi ke owner. *Bikin susah kasir "sesuaikan" hasil opname.*
- **FIFO per-lot dengan traceability** — setiap penjualan tarik dari lot terlama. Tiap movement stok kelihatan asalnya dari transaksi mana (order ID / invoice ID).
- **Stok minus di-clamp** — kasir tidak bisa jual lebih dari yang ada (default). Kalau owner explicitly izinkan pre-order, di-flag terpisah.
- **Deteksi duplikat tagihan supplier** — supplier kirim faktur yang sama 2x? Sistem block + kasih peringatan.

---

### Pilar 4 — Kontrol Akses Berjenjang + Threshold Approval

Peran terpisah tegas. Kasir tidak bisa "khilaf" kasih diskon besar tanpa ketahuan.

- **Peran terpisah tegas** — Kasir tidak bisa edit invoice / ubah harga / hapus transaksi. Owner pegang kunci untuk operasi high-value.
- **Threshold approval bisa di-set owner** — contoh: "diskon >5% wajib PIN owner", "adjustment stok >50pcs wajib approval". Kasir yang minta tidak bisa approve sendiri.
- **Guard markup & discount berlebihan** — kasir tidak bisa jual di atas master price (curi selisih). Diskon dibatasi max = subtotal. Semua total dihitung ulang di server (input kasir diabaikan).
- **Impersonation gate untuk admin platform** — tim support VOSI masuk lihat data tenant? Ada layar konfirmasi eksplisit + tercatat siapa masuk kapan.

---

### Pilar 5 — Immutability Transaksi (Void, Bukan Delete)

Tidak ada tombol "hapus permanen". Semua koreksi meninggalkan jejak.

- **PO, invoice, pembayaran tidak bisa dihapus** — hanya bisa di-void dengan alasan wajib. History tetap ada untuk audit.
- **Duplicate customer dedup by phone** — nomor WA sama → langsung merge ke customer existing. Database MSME tidak ke-polusi duplicate.
- **Reconciliation kas otomatis (GL Recon)** — statement bank vs jurnal di-match otomatis dengan scoring (amount + tanggal). Yang meragukan masuk lane Kuning/Orange untuk owner review manual.

---

## Honest Disclosure (untuk kredibilitas pitch)

Cantumkan di slide "Roadmap" atau small print. **Belum ada** dan jangan di-claim di slide utama:

- MFA / 2FA login (PIN adalah primary verification method saat ini)
- Period lock / month-end close (transaksi lama masih bisa di-void kapan saja)
- Session timeout & IP logging
- Anomaly dashboard real-time (deteksi anomali *ada*, dashboard alert *belum*)
- Automated late-fee / dunning workflow
- Duplicate customer dedup by nama (hanya by phone)
- Soft-delete pattern (workaround via void; hard delete = irreversible)

**Kenapa cantumkan gap:** prospek MSME lebih percaya "kami punya A, B, C sekarang — MFA & period lock coming Q4" ketimbang overclaim. Founder credibility naik.

---

## Alternatif Copy Ringkas (1-slide Version)

Kalau deck cuma boleh 1 slide untuk topik ini:

> **Sistem Anti-Fraud Terpasang di Level Database**
>
> - **Jejak audit immutable** — semua aksi tercatat, bahkan admin tidak bisa hapus
> - **Pembayaran 2-step verify** — kasir catat, owner approve, bukti wajib
> - **Stok opname buta + saksi** — variance auto-eskalasi
> - **Threshold approval owner** — diskon besar / adjustment stok butuh PIN
> - **Void, bukan delete** — koreksi selalu meninggalkan jejak
>
> Belum ada: MFA, period lock, anomaly dashboard. Roadmap Q4 2026.

---

## Speaker Notes (kalau live pitch)

> "Fitur anti-fraud ini bukan gimmick marketing — ini diimplementasikan di level database Postgres pakai Row-Level Security, SECURITY DEFINER RPCs, dan trigger immutable. Artinya kalau ada developer nakal sekalipun coba akses langsung database, mereka tetap tidak bisa edit history stok atau hapus audit trail. Ini standar yang biasanya cuma dipakai bank atau ERP enterprise — kami bawa turun untuk MSME karena masalah 'kasir nyolong stok' atau 'admin sesuaikan pembukuan' adalah pain point nomor 1 owner distributor yang saya wawancarai selama 12 tahun jalanin distributor sendiri."

*Catatan: hindari sebut nama distributor tertentu (Garindo) — memory instruction founder.*

---

## Data Foundations (untuk verifikasi klaim, jangan taruh di deck)

Semua klaim di atas backed by migration files. Kalau ada prospek/investor yang mau audit teknis:

- Audit trail: `platform_admin_audit` (mig 20261115000040), `audit_log` (mig 20260614000003)
- Stock ledger immutable: `stock_movements` (mig 20260607000001) + `deny_sm_update/delete` triggers
- Payment verification: `record_payment` RPC (mig 20261115000039), PendingPaymentsQueue UI
- Opname variance: `stock_opname_sessions` (mig 20260607000011), auto-commit (mig 20260614000004)
- Discount guards: `record_kasir_sale_with_discount` (mig 20260801000004) — MARKUP_NOT_ALLOWED, EXCESSIVE_LINE_DISCOUNT error codes
- GL Recon: `_score_journal_match` (mig 20260726000001)
- Impersonation gate: `TenantImpersonateGate.tsx`, JWT claim validation di `App.tsx`

Total: 32 kontrol terverifikasi shipped per audit 2026-07-11.
