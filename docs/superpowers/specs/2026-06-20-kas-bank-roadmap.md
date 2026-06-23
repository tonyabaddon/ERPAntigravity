# Modul Kas & Bank — Roadmap 5 Phase

**Tanggal:** 2026-06-20
**Status:** Draft — menunggu user approval untuk lanjut ke Phase 1a design spec
**Konteks:** Gap analysis vs Jurnal Mekari Kas & Bank (2026-06-20). Founder context: Garindo Jaya Panel (B2B distributor panel), single-tenant.

---

## 1. Latar belakang

Hari ini owner Garindo tidak tahu saldo Bank/Kas-nya tanpa membuka m-banking masing-masing rekening. Penjualan, pembelian, pelunasan piutang sudah tercatat di sistem — tapi tidak ada satu pun layar yang menjawab pertanyaan dasar: **"saldo BCA saya sekarang berapa?"**.

Modul Kas & Bank menutup gap tersebut secara bertahap. Setiap phase ship satu peningkatan nyata yang owner langsung rasa — bukan plumbing internal.

## 2. Decisions yang sudah di-lock (brainstorm 2026-06-20)

1. **Account picker saat input transaksi.** Cash kasir otomatis ke Kas Toko; transfer/QRIS/debit/pembayaran pembelian/pelunasan piutang: user pilih akun bank dari dropdown.
2. **Akun pribadi owner muncul di list** dengan badge "Pribadi". Laporan bisnis otomatis exclude akun `purpose=OWNER_PERSONAL`.
3. **Backfill semua data historis** sejak Juni 2025 (kasir + pembelian + piutang). Opening balance per akun default 0; owner adjust via Penyesuaian di Phase 2.
4. **Konsolidasi 3-arah** jadi 1 tabel `cash_accounts` — merge `store_bank_accounts` + `bank_accounts` (recon) + konsep akun baru (Kas Toko, E-Wallet).
5. **Sidebar top-level** "Kas & Bank" di group Keuangan.
6. **Settlement T+N (marketplace)** — split jadi Phase 1a (sale langsung IN + banner "Belum cair Rp X") + Phase 1b (queue + confirm UI).
7. **Jenis akun:** `BANK` + `KAS` + `E_WALLET` (untuk Lalamove balance dll). Tidak ada `KAS_KECIL` karena Garindo bukan warung.
8. **Arsitektur:** Write-through ledger — `cash_movements` table sebagai source of truth, di-insert via RPC wrap dari semua flow payment-touching.
9. **Third-party integration (auto bank feed)** → Phase terakhir, bukan diskip.

---

## 3. Phase overview

| # | Phase | Value buat owner | Effort | Dependency |
|---|---|---|---|---|
| 1a | **Visibility** | "Saya tahu saldo saya sekarang" | ~7-9 hari | — |
| 1b | **Settlement akurasi** | "Saldo BCA gak overstate karena marketplace pending" | ~3-5 hari | 1a |
| 2 | **Manual entry** | "Saya bisa catat yang sistem belum tahu" | ~3-4 hari | 1a |
| 3 | **Laporan** | "Saya bisa share ke akuntan / ambil keputusan" | ~3-4 hari | 1a, 2 |
| 4 | **Recon alignment** | "Buku saya cocok sama rekening bank" | ~2-3 hari | 1a, 1b |
| 5 | **Auto bank feed** | "Rekening bank update sendiri" | TBD | semua di atas |

**Total estimasi (Phase 1a-4):** ~18-25 hari. Phase 5 di-defer sampai ada signal konkrit (API partner siap, volume justify, atau tenant request).

---

## 4. Phase 1a — Visibility

### 4.1 Value yang owner rasa hari pertama ship

Owner buka modul Kas & Bank → lihat semua akun di satu halaman dengan saldo terkini:

```
💳 BCA Operasional      Rp 12.500.000      • Bisnis
🏦 Mandiri Toko         Rp  5.300.000      • Bisnis  
💵 Kas Toko             Rp    850.000      • Bisnis
🛵 Lalamove Balance     Rp    420.000      • Bisnis
💳 BCA Pribadi          Rp 35.000.000      ⚪ Pribadi
```

Klik salah satu → tab Riwayat menampilkan semua mutasi auto dari kasir/pembelian/piutang dengan filter periode.

### 4.2 Scope

**Schema:**
- Tabel baru `cash_accounts` (gabungan dari `store_bank_accounts` + `bank_accounts` recon + konsep baru). Kolom: `id, account_type (BANK|KAS|E_WALLET), bank_code, bank_name, account_number, account_holder, internal_label, purpose, show_in_invoice, sort_order, is_active, opening_balance, opening_balance_date, provider (E_WALLET only), created_at, updated_at`.
- Tabel baru `cash_movements` (write-through ledger): `id, account_id, direction (IN|OUT), amount, occurred_at, source_type, source_ref_id, source_ref_table, category, description, created_by, created_at`.
- `source_type` enum: `KASIR_SALE | PIUTANG_PAYMENT | PI_PAYMENT | CASH_BATCH_DEPOSIT | OPENING_BALANCE | BACKFILL`.
- View `cash_account_balances` (computed) = `opening_balance + sum(IN where status=CLEARED) - sum(OUT where status=CLEARED)` per akun.

**Migrasi:**
- `ALTER TABLE bank_accounts RENAME TO cash_accounts` (preserve FK di `bank_imports`, `bank_statement_lines`, `bank_line_allocations`, `cash_batches` lewat OID).
- `ALTER TABLE ADD COLUMN` untuk kolom yang missing (account_holder, sort_order, opening_balance, dll).
- Migrate data dari `store_bank_accounts` → row baru di `cash_accounts` dengan dedup by `account_number`.
- Insert seed default: 1 row `account_type=KAS, internal_label='Kas Toko'`.
- Soak window: `store_bank_accounts` tetap ada sebagai view shim ke `cash_accounts` (filter `account_type=BANK AND show_in_invoice=true`); drop physical table di Phase 2.

**RPC wraps (write-through):**
- `record_kasir_sale*` (3 varian) — tambah param `p_bank_account_id` (NULL kalau cash → default Kas Toko), insert `cash_movements` row IN.
- `markTempoInvoicePaid` — tambah param `bank_account_id`, insert IN row.
- `record_pi_payment` / `mark_pi_paid` — tambah param `bank_account_id`, insert OUT row.
- `cash_batches.status='DEPOSITED'` trigger atau RPC: tambah param `target_bank_account_id`, insert pair (OUT Kas Toko + IN bank).

**Backfill script (one-shot SQL migration):**
- Loop `kasir_transactions` sejak Juni 2025 → insert `cash_movements` IN dengan `source_type='BACKFILL', category='KASIR_SALE'`. Untuk channel non-cash, default ke akun BCA Operasional (owner adjust nanti via Penyesuaian).
- Loop `purchase_invoice_payments` → insert OUT.
- Loop `tempo_payments` → insert IN.
- Loop `cash_batches.status='DEPOSITED'` → insert pair OUT Kas Toko + IN bank tujuan (kalau bank tujuan tidak tercatat di histori, default ke BCA).

**UI baru:**
- `src/components/kasbank/KasBankScreen.tsx` — halaman utama, daftar akun + saldo, "+ Tambah Akun" button.
- `src/components/kasbank/AccountDetailScreen.tsx` — detail per akun, tab Riwayat + tab Info, filter periode.
- `src/components/kasbank/AccountFormModal.tsx` — create/edit akun (Owner only).
- Banner kuning di account detail kalau saldo termasuk marketplace pending: "Saldo termasuk Rp X dari marketplace yang belum cair — phase 1b akan handle ini lebih akurat."
- Sidebar: tambah entry "Kas & Bank" di group Keuangan.
- Pengaturan → "Rekening Bank" card di-deprecate, redirect ke Kas & Bank.

**Picker UI di flow existing:**
- Modal di kasir transfer/QRIS/debit/marketplace: dropdown "Masuk ke akun" dengan akun aktif type=BANK.
- Modal Catat Bayar Pembelian: dropdown "Bayar dari akun" dengan semua akun aktif.
- Modal Catat Bayar Piutang: dropdown "Masuk ke akun" dengan akun BANK aktif (cash piutang → Kas Toko auto).

### 4.3 Deliverable

- Owner buka modul Kas & Bank di sidebar, lihat saldo semua akun.
- Klik akun, lihat riwayat 1 tahun historis (dari backfill).
- Tambah akun baru via modal.
- Setiap transaksi baru (kasir/pembelian/piutang) otomatis update saldo.
- Banner peringatan kalau ada marketplace pending.

### 4.4 What it doesn't do

- Manual entry (Transfer Internal, Setor, Tarik, Penyesuaian) — Phase 2.
- Settlement timing T+N akurat — Phase 1b.
- Laporan PDF/Excel — Phase 3.
- Cocokkan dengan mutasi bank — Phase 4.
- Auto-pull dari bank API — Phase 5.

### 4.5 Estimate

**7-9 hari** kerja (revisi dari 5-7 awal karena: 3-way migrasi + backfill 1 tahun data + N RPC wraps + picker UI di flow existing).

---

## 5. Phase 1b — Settlement Akurasi

### 5.1 Value

Owner buka Kas & Bank → saldo BCA tidak lagi overstate. Marketplace pending punya queue terpisah "Belum Cair" yang owner confirm satu-per-satu saat uang benar-benar cair.

### 5.2 Scope

- Tambah kolom `cash_movements.status` enum: `PENDING | CLEARED`.
- Marketplace sale (channel `tokopedia/shopee/lazada/blibli/bukalapak/ralali/bhinneka`) dan QRIS/EDC: insert dengan `status='PENDING'`.
- View `cash_account_balances` filter `status='CLEARED'` saja.
- Halaman baru "Belum Cair" per akun: list pending settlement, tombol "Konfirmasi Cair" (transisi status, set `cleared_at`).
- Per-channel timing config table (`settlement_timing_days`): hint estimasi cair untuk owner.

### 5.3 Estimate

**3-5 hari.**

---

## 6. Phase 2 — Manual Entry

### 6.1 Value

Owner bisa catat hal yang sistem belum tahu: transfer antar rekening sendiri, setor cash kasir ke bank, tarik untuk pribadi, top-up Lalamove balance, koreksi saldo karena selisih dengan rekening asli.

### 6.2 Scope

- 4 form manual: `TransferInternalModal`, `SetorKasModal`, `TarikModal` (owner drawing), `PenyesuaianSaldoModal`.
- Top Up + Spend untuk akun E_WALLET (Lalamove dll).
- `cash_movements.source_type` extend: `MANUAL_TRANSFER | MANUAL_DEPOSIT | OWNER_DRAWING | OWNER_TOPUP | ADJUSTMENT | WALLET_TOPUP | WALLET_SPEND`.
- Attachment upload (foto bukti transfer/struk) di setiap form, simpan ke Supabase storage bucket `cash-attachments`.
- Penyesuaian Saldo butuh reason ≥10 char + Owner PIN (defensif: bisa dipakai mask theft).

### 6.3 Estimate

**3-4 hari.**

---

## 7. Phase 3 — Laporan & Cash Flow

### 7.1 Value

Owner akhir bulan tinggal kirim PDF ke akuntan eksternal. Owner mau review keputusan: bisa pivot uang masuk vs keluar per kategori per bulan.

### 7.2 Scope

- Laporan mutasi per akun (PDF + Excel + CSV) — pakai jsPDF + jspdf-autotable existing pattern.
- Laporan saldo akhir bulanan per akun (12 bulan trailing).
- Cash flow report bulanan: matriks `category × month` untuk IN dan OUT.
- Filter periode + multi-account select.
- Mount di sidebar Laporan existing.

### 7.3 Estimate

**3-4 hari.**

---

## 8. Phase 4 — Recon Alignment

### 8.1 Value

Owner upload PDF mutasi rekening (workflow recon existing) → setiap mutasi otomatis cocok dengan `cash_movements` yang sudah dicatat. Yang tidak cocok di-highlight: "Bulan ini ada 3 mutasi yang gak ada di buku."

### 8.2 Scope

- Modul Rekonsiliasi existing diadapsi: `bank_line_allocations` repoint dari `payable_slot` ke `cash_movement`.
- Match algorithm di Recon: cari `cash_movement` dengan `(account_id, amount, date ±N days)` yang `reconciled_at IS NULL`.
- Auto-flip `cash_movement.reconciled_at` saat match green.
- Indicator di Kas & Bank account detail: "✓ Rekonsiliasi: 28 dari 30 mutasi cocok" / "⚠ 3 mutasi gak ada di buku → klik untuk Tindak Lanjut".
- Settlement Pending dari Phase 1b ikut handle: marketplace pending yg match dengan mutasi bank → auto transisi PENDING → CLEARED.

### 8.3 Estimate

**2-3 hari.**

---

## 9. Phase 5 — Auto Bank Feed (Last Phase)

### 9.1 Value

Tidak perlu upload PDF mutasi tiap bulan. Saldo Bank update real-time. Bisa initiate transfer keluar langsung dari aplikasi dengan Maker/Releaser approval.

### 9.2 Scope (TBD — saat ada signal)

- Integrasi Cash Link Feeds (BCA/Mandiri/dll) via partner API.
- Auto-pull mutasi → insert `bank_statement_lines` + auto-match.
- Outbound transfer dari aplikasi dengan dual-role (Maker create + Releaser approve via OTP).
- Webhook handler untuk push notification dari bank.

### 9.3 Trigger untuk start Phase 5

- API partner bank siap dipakai (saat ini Cashlink Jurnal cuma Mandiri).
- Volume transaksi/bulan justify cost integrasi.
- Atau: paying tenant minta sebagai gating feature.

### 9.4 Estimate

**TBD.** Kemungkinan ~10-15 hari termasuk certification + security review.

---

## 10. Execution order

```
Phase 1a (Visibility)      → ~7-9 hari   → ship pertama, dapat visibility
   ↓
Phase 1b (Settlement)      → ~3-5 hari   → akurasi marketplace
   ↓
Phase 2 (Manual entry)     → ~3-4 hari   → align dengan realita
   ↓
Phase 3 (Laporan)          → ~3-4 hari   → share + decision
   ↓
Phase 4 (Recon alignment)  → ~2-3 hari   → audit-grade
   ↓
Phase 5 (Auto bank feed)   → TBD         → tunggu signal
```

**Bisa ship pertama setelah Phase 1a (~7-9 hari)** — owner dapat visibility instan. Phase 1b-4 menyusul tiap 1-2 minggu sebagai value tambahan stand-alone.

---

## 11. Out of scope (di-skip total, bukan defer)

- **Multi-currency.** Single-tenant Indo, IDR only. Tidak ada signal butuh.
- **Kartu kredit sebagai jenis akun.** Founder tidak punya use case. Tambah kalau tenant lain minta.
- **KAS_KECIL (petty cash warung-style).** Garindo bukan warung; pakai E_WALLET (Lalamove dll) untuk operasional.
- **Maker/Releaser OTP untuk outbound transfer.** Hanya relevan kalau ada Phase 5 (transfer dari aplikasi).
- **Recurring transaction rules.** Bisa Phase 2.5 atau Phase 3 kalau ada signal.

---

## 12. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Migrasi `bank_accounts` → `cash_accounts` break Recon module di prod | Pakai RENAME (preserve OID + FK), dual-write soak window 1 minggu sebelum drop `store_bank_accounts` |
| Backfill 1 tahun data: amount mismatch karena lost data / RPC variant divergence | Dry-run di staging dulu, compare sum movements vs sum source tables; rollback-able transaction wrap |
| User adoption gagal (owner buka modul, saldo "kelihatan salah" karena belum di-adjust) | Phase 1a banner: "Saldo di-compute dari transaksi historis, mungkin beda dengan saldo bank asli. Phase 2 punya Penyesuaian." |
| Settlement Pending salah timing (Tokopedia ternyata bukan T+7 tapi T+3) | Per-channel `settlement_timing_days` config; owner override per channel kalau pattern berbeda |
| Marketplace settlement uang cair bertahap (parsial) | Phase 4 handle: 1 cash_movement bisa dipecah jadi multiple `bank_line_allocations` |

---

## 13. Next steps

1. ✅ Roadmap doc (file ini) — user review.
2. ⏳ HTML mockup Phase 1a — visualisasi UI sebelum spec.
3. ⏳ Phase 1a design spec lengkap — `2026-06-20-kas-bank-phase1a-design.md`.
4. ⏳ Implementation plan Phase 1a — `2026-06-20-kas-bank-phase1a-implementation.md`.
5. Execute Phase 1a.
6. Phase 1b spec setelah 1a ship + feedback loop.
