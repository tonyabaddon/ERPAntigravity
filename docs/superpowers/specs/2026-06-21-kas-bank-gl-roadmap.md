# Modul Akuntansi MSME — Roadmap v2 (post-GL pivot)

**Tanggal:** 2026-06-21
**Status:** Draft — menunggu user approval untuk start Phase 0a
**Supersedes:** `2026-06-20-kas-bank-roadmap.md` (still valid as historical record of pre-GL design)

---

## 1. Pivot dari roadmap sebelumnya

Roadmap v1 (2026-06-20) plan modul Kas & Bank sebagai standalone (5 phase). Saat brainstorming MSME accounting best practice, user pilih bangun **proper accounting system** dengan **General Ledger double-entry**. Pivot ini ubah fundamental dari "modul Kas & Bank" jadi "modul Akuntansi MSME dengan Kas & Bank sebagai sub-ledger."

### Locked decisions (brainstorm 2026-06-21)

1. **General Ledger foundation** dengan double-entry bookkeeping (interpretasi B dari diskusi ledger)
2. **PPN tracking configurable per tenant** — Garindo default non-PKP; schema support PKP untuk paying tenant nanti
3. **PPh dual-mode** — UMKM Final 0.5% (Garindo default) ATAU Badan PPh Pasal 25
4. **Depreciation** — skip dari Phase 0, defer ke phase nanti saat ada signal
5. **Period close** — manual oleh owner (klik "Tutup Buku Juni")
6. **Phase 0 decomposed 0a/0b/0c/0d** dengan parallel-write feature flag (advisor recommendation)
7. **Phase 1 Cash & Bank UI interleave** mulai setelah 0a ship (~3-4 hari), bukan tunggu seluruh Phase 0 selesai
8. **COA validation** via SAK EMKM template + AI assist (no human akuntan eksternal saat ini)
9. **Phase 5 auto bank feed DROPPED** — pakai manual PDF upload pattern Rekonsiliasi existing
10. **Phase 2 enhancements** — Catat Pengeluaran modal (ke-6), WalletSpend link ke Order/Customer untuk ongkir scenarios

---

## 2. Phase overview (revised)

| Phase | Scope | Value buat owner | Effort | Start |
|---|---|---|---|---|
| **0a** | GL schema (COA + journal_entries + validator + Trial Balance view) + tenant tax config | Foundation — tidak terlihat UI | 3-4 hari | First |
| **0b** | Parallel-write feature flag — wrap 3 high-traffic RPC (kasir_sale, pembayaran, piutang_payment) dual-write ke OLD + GL path | Soak validation | 4-5 hari | After 0a |
| **0c** | Wrap remaining business RPC + historical backfill batched + verify Trial Balance | Foundation complete | 3-4 hari | After 0b |
| **0d** | GL UI: Buku Besar per akun + Trial Balance report + COA management + deprecate `cash_movements` (replace view) | Akuntan-grade visibility | 2-3 hari | After 0c |
| **1** | Cash & Bank UI: saldo + riwayat per akun Kas/Bank/E-Wallet (derive dari journal_entry_lines), account picker integration | "Saya tahu saldo saya sekarang" | 5-7 hari | **Parallel after 0a** (mulai minggu 1-2) |
| **2** | Settlement T+N akurasi: PENDING/CLEARED status, Belum Cair list | "Saldo BCA gak overstate" | 3-5 hari | After 1 |
| **3** | Manual entry: 6 modal (Transfer/Setor/Tarik/Penyesuaian PIN/Wallet+Spend/Catat Pengeluaran) | "Saya catat yang sistem belum tahu" | 3-4 hari | After 1 |
| **4** | Laporan: Mutasi + Saldo Trailing + Cash Flow + **Trial Balance** + **P&L sederhana** + **Neraca sederhana** | "Share ke akuntan, ambil keputusan" | 5-7 hari | After 0d + 3 |
| **5** | Recon alignment: bank_statement_lines auto-match ke journal_entry_lines (Bank accounts) | "Buku cocok sama mutasi bank" | 2-3 hari | After 4 |
| ~~6~~ | ~~Auto bank feed~~ **DROPPED** — pakai manual PDF upload | — | — | — |

**Total Phase 0a-5: ~32-46 hari kerja** (vs roadmap v1 ~20-25 hari). Naik karena GL foundation work.

### Eksekusi parallel chart

```
Week 1-2: [0a schema] → [0b dual-write 3 RPC]
              ↓ after 0a
              [Phase 1 UI start, derive from GL rows]
Week 3:    [0c remaining RPC + backfill]  +  [Phase 1 continue]
Week 4:    [0d GL UI + deprecate cash_movements]  +  [Phase 1 ship]  +  [Phase 2 start]
Week 5:    [Phase 3 manual entry]
Week 6:    [Phase 4 laporan + P&L + Neraca]
Week 7:    [Phase 5 recon alignment]
```

Owner mulai lihat UI baru di **Week 2-3**, bukan Week 4-5.

---

## 3. Akuntansi MSME Indonesia — context

**Standar yang dipakai:** SAK EMKM (untuk UMKM mikro asset <Rp 50jt) atau SAK ETAP simplified (asset <Rp 10M, omzet <Rp 50M). Garindo Jaya Panel = SAK EMKM scope.

**Karakteristik SAK EMKM:**
- Double-entry bookkeeping (debit = kredit)
- Cash basis acceptable untuk sebagian besar transaksi
- Laporan keuangan minimal: Neraca + Laporan Laba Rugi + Catatan atas Laporan Keuangan
- Tidak wajib: Laporan Arus Kas formal (tapi nice to have)
- COA bebas custom sesuai operasional usaha

**COA structure 5 kelompok utama:**
- **1-XXXX Aset** (Kas, Bank, Piutang, Persediaan, Aset Tetap)
- **2-XXXX Liabilitas** (Hutang Usaha, Hutang Bank, Hutang Pajak)
- **3-XXXX Modal/Ekuitas** (Modal Owner, Prive, Laba Ditahan)
- **4-XXXX Pendapatan** (Penjualan, Pendapatan Lain)
- **5-XXXX Beban** (HPP, Beban Operasional)

**Tax considerations:**
- **PPh Final 0.5% UMKM** (PP 23/2018) — omzet < Rp 4.8M/tahun. Hitung dari omzet bulanan, bayar tanggal 15 bulan berikutnya. Tidak butuh perhitungan laba.
- **PPh Pasal 25 normal** — untuk PT/CV lewat threshold. Butuh perhitungan laba neto + adjustment.
- **PPN 11%** — wajib untuk PKP (omzet > Rp 4.8M/tahun mulai 2014). Split PPN Masukan + Keluaran di setiap transaksi.
- Garindo non-PKP UMKM: skip PPN; pakai PPh Final.

---

## 4. Phase 0a — GL Schema Foundation (detail di spec terpisah)

**Goal:** Lock data model GL + tenant tax config + double-entry validator + Trial Balance view. **No UI changes.** Foundation untuk semua phase berikut.

**Deliverable highlights:**
- `chart_of_accounts` table dengan SAK EMKM seed (~50-70 akun standar)
- `journal_entries` table (header)
- `journal_entry_lines` table (debit/credit lines, validator enforce sum = 0 per entry)
- `tenants` table (atau extend existing) dengan `ppn_mode`, `pph_mode` config
- `accounting_periods` table untuk manual close tracking
- `trial_balance` view (sum debit/kredit per akun per period)
- Helper functions: `_validate_journal_entry`, `_post_journal_entry`
- Tenant default seed untuk Garindo (non-PKP, UMKM Final 0.5%, period close manual)

**Effort:** 3-4 hari. **Checkpoint:** ship + user review + AI-assisted COA validation sebelum lanjut 0b.

---

## 5. Phase 0b — Parallel-write 3 RPC (detail di spec terpisah)

**Goal:** Wrap 3 high-traffic RPC dual-write: tetap tulis ke OLD path (existing tables) + juga tulis ke journal_entries. Feature flag `gl_dual_write_enabled` aktifkan/nonaktifkan per RPC.

**RPC wrapped:**
1. `record_kasir_sale` (3 variants) — D Kas/Bank, K Pendapatan
2. `record_pembayaran` — D Hutang Usaha, K Kas/Bank
3. `record_piutang_payment` (Phase 1a NEW) — D Kas/Bank, K Piutang Usaha

**Validation:**
- Daily cron compare: SUM(journal_entry_lines per period per account) vs SUM(existing source tables)
- Discrepancy report → owner review

**Effort:** 4-5 hari. **Checkpoint:** soak 1-2 hari, validate.

---

## 6. Phase 0c — Wrap remaining RPC + backfill (detail di spec terpisah)

**Goal:** Cover seluruh business flow dengan GL.

**RPC remaining:**
- `record_expense` (Phase 2 NEW) — D Beban, K Kas/Bank
- `record_pi` (Tagihan creation) — D Persediaan/PPN Masukan, K Hutang Usaha (PKP) ATAU D Persediaan, K Hutang Usaha (non-PKP)
- `mark_walkin_order_paid` — D Kas/Bank, K Piutang Walkin
- `write_off_tempo_invoice` — D Kerugian Piutang, K Piutang Usaha
- `confirm_cash_deposit_batch` — D Bank, K Kas Toko
- HPP recognition saat sale — D HPP, K Persediaan (kalau ada persediaan tracking)
- Phase 2b `void_pembayaran` reversal logic
- Adjustment / Penyesuaian saldo (Phase 3) — D/K disesuaikan
- Owner Drawing (Phase 3) — D Prive, K Kas/Bank
- Transfer Internal (Phase 3) — D Account A, K Account B
- Wallet Top-Up (Phase 3) — D Wallet, K Bank

**Historical backfill:**
- Loop transactions sejak Juni 2025
- Generate journal entries retroaktif per existing row
- Batched LIMIT 5000 per loop dengan COMMIT
- Verify: Trial Balance per period sebanding dengan existing data

**Effort:** 3-4 hari. **Checkpoint:** Trial Balance harus seimbang sebelum lanjut 0d.

---

## 7. Phase 0d — GL UI + deprecate cash_movements (detail di spec terpisah)

**Goal:** UI Buku Besar + Trial Balance + COA management. Replace `cash_movements` table dengan view atas `journal_entry_lines` filter `account.type IN ('KAS','BANK','E_WALLET')`.

**UI:**
- `src/components/akuntansi/BukuBesarScreen.tsx` — pilih akun, lihat ledger format (Tanggal | Keterangan | Debit | Kredit | Saldo running)
- `src/components/akuntansi/TrialBalanceScreen.tsx` — daftar semua akun + saldo debit/kredit per period
- `src/components/akuntansi/COAManagementScreen.tsx` — list COA tree, add/edit/disable akun (owner only)
- `src/components/akuntansi/JournalEntryDetailModal.tsx` — klik entry → lihat debit/credit lines

**Cutover:**
- `cash_movements` table → `cash_movements_v` view atas `journal_entry_lines` (backward-compat untuk Phase 1 UI yang sudah pakai cash_movements pattern)
- Soak 1 minggu, jika no breakage → drop physical `cash_movements` table di phase berikut

**Effort:** 2-3 hari.

---

## 8. Phase 1 — Cash & Bank UI (detail di spec terpisah, revisi)

**Pivot dari Phase 1a roadmap v1:** Phase 1 UI tetap sama (KasBankScreen + AccountDetail + AccountForm + 3 picker), tapi data **derive dari GL**:
- Saldo akun = `SUM(debit) - SUM(credit) FROM journal_entry_lines WHERE account_id IN (Kas/Bank/E-Wallet COA codes)`
- Riwayat akun = `journal_entry_lines WHERE account_id = X ORDER BY occurred_at`
- Account picker integration: saat user pilih akun di kasir/pembelian/piutang, account_id tersimpan di journal entry line

**Yang berubah dari roadmap v1:**
- `cash_movements` standalone table → view over GL
- `cash_accounts` table tetap, tapi tambah kolom `coa_code` untuk link ke `chart_of_accounts`
- Backfill bukan ke `cash_movements`, tapi ke `journal_entry_lines` (di Phase 0c)

**Effort:** 5-7 hari (turun dari 7-10 karena backfill + RPC wrap udah di Phase 0).

---

## 9. Phase 2-5 — high-level (detail di spec terpisah, revisi setelah Phase 0a lock)

| Phase | Pivot dari roadmap v1 |
|---|---|
| **2 Settlement** | PENDING/CLEARED status di `journal_entry_lines.status` (untuk cash-side lines), bukan di standalone `cash_movements.status` |
| **3 Manual Entry** | 6 modal (+ Catat Pengeluaran). Setiap submit = create journal entry, bukan insert cash_movement |
| **4 Laporan** | Tambah **Trial Balance**, **P&L sederhana** (group by account type 4-XXXX vs 5-XXXX), **Neraca sederhana** (group by 1-XXXX, 2-XXXX, 3-XXXX). Cash Flow tetap. |
| **5 Recon Alignment** | Bank statement lines match ke journal_entry_lines (filter account_type=BANK) |

**Spec revision Phase 1-5:** Will be done after Phase 0a ships dan lock journal_entries contract. **Jangan revise sekarang** — risk rewrite 2x.

---

## 10. Out of scope explicitly

- **Depreciation** (auto + asset module) — defer to phase nanti
- **Auto bank feed via API** (Brick/Cashlink) — defer to nanti, manual PDF upload existing cukup
- **Per-tenant COA customization** beyond default SAK EMKM seed — defer to multi-tenant phase
- **Multi-currency** — single IDR
- **Sub-ledger inventory tracking** dengan moving average / FIFO — partial via kasir_transactions.hpp_total existing, full inventory journal di phase nanti
- **Konsolidasi laporan multi-perusahaan** — single entity
- **Audit trail untuk perubahan COA setelah ada journal entries** — basic logging only, full audit di phase nanti

---

## 11. Risk + mitigation

| Risk | Mitigation |
|---|---|
| Phase 0 slip dari 14-21 hari ke 4+ minggu | Decomposisi 0a/0b/0c/0d dengan checkpoint; bisa pause antara phase |
| Regression di RPC business (kasir sale, pembayaran, dll) | Parallel-write feature flag — OLD path tetap aktif; GL path optional. Cutover hanya setelah validate. |
| COA salah seed → historical entries link ke kode yang salah | SAK EMKM template + AI validate + ship sebagai draft, lock setelah review |
| Owner gak rasa value selama Phase 0 | Phase 1 UI interleave setelah 0a (minggu 1-2) |
| Multi-tenant config (PKP/PPh) belum tested | Garindo non-PKP UMKM tested; PKP mode tested saat paying tenant pertama |
| Pembelian Phase 2b yang baru deployed (2026-06-20) terpengaruh oleh RPC wrap | Parallel-write minimize blast radius; 1-2 hari soak per RPC sebelum cutover |
| Recon module existing pakai `bank_accounts` table (akan jadi `cash_accounts`) | RENAME + ADD COLUMN strategy preserve FK via OID (sudah documented di Phase 1a rev2) |

---

## 12. Next steps

1. ✅ Roadmap doc (file ini) — user review
2. ⏳ Phase 0a spec lengkap (`2026-06-21-akuntansi-phase0a-design.md`)
3. ⏳ Mockup Buku Besar + Trial Balance + COA management (Phase 0d preview)
4. Mark Phase 5 spec + mockup deprecated (preserve history)
5. User review Phase 0a + mockup → kalau approved, lanjut implementation plan Phase 0a
6. Execute Phase 0a (~3-4 hari) → checkpoint
7. Start Phase 0b + Phase 1 parallel
8. ...
