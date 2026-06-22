# Akuntansi Phase 3 — Manual Entry Design Spec

**Date:** 2026-06-22
**Status:** Draft for user review
**Phase:** 3 of Akuntansi MSME roadmap (after Phase 1 Cash & Bank UI shipped)
**Mockup reference:** `docs/superpowers/mockups/2026-06-21-akuntansi-phase3-manual-entry.html`

---

## 1. Goal

Bekali Owner dengan UI untuk **mencatat transaksi non-otomatis** (di luar flow Kasir / Pembelian / Piutang) langsung ke General Ledger via `_post_journal_entry`. Phase 3 unblock GL terisi dengan data riil sebelum Phase 0b/0c dual-write masuk — owner bisa pakai modul Akuntansi end-to-end mulai dari Buku Kecil sampai Buku Besar walaupun integrasi otomatis belum 100%.

## 2. Scope

### In-scope (6 modal manual entry)
1. **Transfer Internal** — pindah dana antar 2 cash account (Bank ↔ Bank, Bank ↔ Kas, Bank ↔ E-Wallet)
2. **Setor Kas ke Bank** — variant Transfer Internal, source dikunci ke akun KAS
3. **Tarik Pribadi (Owner Drawing)** — single-leg keluar dari bank/kas bisnis ke akun Prive (1-3300)
4. **Penyesuaian Saldo (PIN-gated)** — koreksi saldo +/- dengan counterpart account explicit + PIN Owner
5. **Wallet Top-Up + Spend** — Bank → Wallet top-up + Wallet → Beban spend (variant Transfer dan Expense)
6. **Catat Pengeluaran (Beban Operasional)** — D Beban, K Bank/Kas (kategori beban dari COA dynamic)

### Component baru
- `+ Aksi` dropdown context-aware di **AccountDetailScreen** top-right (per recommendation user — single location, focused)
- `JournalEntryPreview` component shared (table debit/kredit + balanced indicator)
- Modal components dengan JE preview live update

### Out-of-scope (defer ke phase lain)
- Picker integration di kasir/pembelian/piutang → Phase 0b
- Buku Besar / Trial Balance / COA Management UI → Phase 0d
- Laporan Laba Rugi / Neraca → Phase 4
- Auto-allocate wallet spend ke order COGS → defer (memo only di Phase 3)
- Owner drawing dual-leg dengan personal account auto-update → defer (single-leg saja, personal account update manual via Setor/Penyesuaian terpisah)

## 3. Architecture

### Data flow

```
[User klik kartu akun di KasBankScreen]
        ↓
[AccountDetailScreen + Aksi dropdown]
        ↓
[ManualEntryModal — context-aware (sesuai action picked)]
        ↓ [submit]
[Service layer: src/lib/akuntansi/manualEntry.ts]
        ↓
[supabase.rpc('record_<action>', payload)]
        ↓
[PostgreSQL SECURITY DEFINER RPC]
  - Validate inputs
  - Verify PIN (kalau Penyesuaian)
  - Resolve COA ids
  - Call _post_journal_entry(entry_date, source_type, description, lines)
        ↓
[journal_entries + journal_entry_lines]
        ↓
[AccountDetailScreen reload → Riwayat update real-time]
```

### Backend RPCs (5 baru)

Semua RPC SECURITY DEFINER + GRANT EXECUTE TO authenticated + role-gate `is_owner_active()` (kecuali Wallet Top-Up/Spend yang non-PIN dan boleh dijalankan Admin Toko juga).

| RPC | Signature | source_type | Lines |
|---|---|---|---|
| `record_internal_transfer` | `(p_from_cash_id, p_to_cash_id, p_amount, p_entry_date, p_notes, p_proof_url)` | `MANUAL_TRANSFER` | D dest cash COA, K source cash COA |
| `record_owner_drawing` | `(p_from_cash_id, p_amount, p_entry_date, p_reason, p_personal_memo)` | `OWNER_DRAWING` | D 1-3300 Prive, K source cash COA |
| `record_balance_adjustment` | `(p_cash_account_id, p_direction, p_amount, p_counterpart_coa_id, p_reason, p_pin)` | `ADJUSTMENT` | direction='UP' → D cash, K counterpart; 'DOWN' → reverse |
| `record_wallet_spend` | `(p_wallet_cash_id, p_beban_coa_id, p_amount, p_entry_date, p_order_id, p_notes)` | `WALLET_SPEND` | D beban, K wallet cash COA |
| `record_manual_expense` | `(p_beban_coa_id, p_source_cash_id, p_amount, p_entry_date, p_description, p_proof_url)` | `KASIR_EXPENSE` | D beban, K source cash COA |

**Notes:**
- `record_internal_transfer` dipakai untuk **3 use case**: Transfer Internal (M2), Setor Kas (M3), Wallet Top-Up (M5a). Frontend lock source/destination berdasarkan modal variant.
- `record_owner_drawing` field `p_personal_memo` jadi memo di entry.description (track destination personal account label tanpa post leg keduanya).
- `record_balance_adjustment` PIN verify via `verify_owner_pin` (existing RPC). Kalau gagal 3× → `INSUFFICIENT_PIN_LOCKED` exception.
- Enum `journal_entry_source` sudah punya semua value yang dibutuhkan (verified di `20260715000006_journal_entries_table.sql`).
- Reuse existing `KASIR_EXPENSE` enum untuk Catat Pengeluaran (sumber ttp dari cash account, scope sama).

### Period validation
`_post_journal_entry` sudah panggil `_check_period_open(p_entry_date)`. Phase 3 RPCs delegate ke sana — tidak duplicate logic.

### Negative balance allowance
Mengikuti existing pattern (memory `feedback_allow_negative_stock_preorder`): UI **warn** kalau action akan bikin saldo akun jadi minus, tapi tidak block. Backend tidak ada CHECK constraint saldo minus.

## 4. Schema Changes

### Migration 1 — `20260722000001_post_manual_journal_rpcs.sql`

Berisi 5 RPC baru. Tidak ada perubahan tabel.

**Helper internal:**
- `_resolve_cash_coa(p_cash_account_id uuid) RETURNS uuid` — lookup `cash_accounts.coa_account_id`
- `_assert_owner_active()` — role-gate helper (reuse pattern dari Phase 0a)

**Per-RPC validation:**
- All amounts > 0 (`p_amount > 0`)
- Source ≠ destination untuk transfer (CHECK `p_from_cash_id != p_to_cash_id`)
- COA counterpart untuk adjustment harus aktif + `account_type IN ('PENDAPATAN','BEBAN')` (typical correction targets)
- Reason min 10 char untuk Penyesuaian
- Description min 3 char untuk Manual Expense

### Migration 2 — `20260722000002_manual_entry_proofs_bucket.sql`

Storage bucket `accounting-proofs` (kalau belum ada) untuk bukti transfer/expense. Reuse policy mirip `payment-proofs`.

## 5. UI Components

### File structure
```
src/components/akuntansi/manual/
├── AksiDropdown.tsx                    // Context-aware "+ Aksi" trigger
├── JournalEntryPreview.tsx             // Shared D/K table preview
├── ManualTransferModal.tsx             // Transfer Internal + Setor Kas + Wallet Top-Up (variants)
├── OwnerDrawingModal.tsx
├── BalanceAdjustmentModal.tsx          // PIN-gated
├── WalletSpendModal.tsx
└── ManualExpenseModal.tsx

src/lib/akuntansi/
├── manualEntry.ts                      // RPC wrappers
├── manualEntry.test.ts                 // Unit tests
└── coaQueries.ts                       // fetchBebanCategories(), fetchAdjustmentCounterparts()
```

### `+ Aksi` dropdown content per account_type

**BANK:**
- Transfer Internal · Setor dari Kas · Tarik Pribadi · Catat Pengeluaran
- *(separator)*
- Penyesuaian (PIN) · Edit Akun

**KAS:**
- Setor ke Bank · Tarik Pribadi · Catat Pengeluaran
- *(separator)*
- Penyesuaian (PIN) · Edit Akun

**E_WALLET:**
- Top-Up dari Bank · Catat Spending
- *(separator)*
- Penyesuaian (PIN) · Edit Akun

### JE Preview shared component
Props: `lines: Array<{accountCode, accountName, debit, credit}>`
Render: header (Akun, Debit, Kredit) + rows + footer total + balanced/imbalanced badge.
Update live saat user isi amount + pilih account.

### PIN Pad reuse
Penyesuaian modal embed `OwnerPinPad` (existing di `src/components/approval/OwnerPinPad.tsx`). PIN dikirim **raw ke `record_balance_adjustment`** sebagai param — RPC verify-then-post atomik di backend (1 round-trip, tidak ada window race). Backend logic:
```
1. _assert_owner_active()
2. verify_owner_pin(p_pin) → boolean (existing RPC)
   - kalau false: increment failed_pin_attempts table; raise INVALID_PIN
   - kalau ≥3 fail in 10 min: raise PIN_LOCKED
3. _post_journal_entry(...) — atomic
```

### KasBankScreen + AccountDetailScreen changes
- **KasBankScreen:** tidak ada perubahan (per recommendation user — dropdown hanya di detail page)
- **AccountDetailScreen:** tambah `<AksiDropdown account={balance} onAction={openModal} />` di header top-right (samping back-link, atau di area bawah hero stats). Modal state lifted ke AccountDetailScreen.

## 6. Validation Rules (summary)

| Field | Rule | Error message |
|---|---|---|
| Amount | > 0 | "Jumlah harus lebih dari nol" |
| Date | not in closed period | "Tanggal masuk periode yang sudah ditutup" (dari `_check_period_open`) |
| Source ≠ Destination | transfer only | "Akun sumber dan tujuan tidak boleh sama" |
| Reason min 10 char | adjustment only | "Alasan minimal 10 karakter (audit)" |
| PIN | 6 digit, 3 attempt | "PIN salah" / "Akun terkunci 10 menit" |
| Beban COA active | expense + wallet spend | "Kategori beban tidak aktif" |

## 7. Error Handling

- All RPC exceptions surface via `showToast(msg, 'warning')`
- Network error → "Gagal connect — coba lagi"
- Validation error → message dari RPC (sudah Indonesian-friendly di Phase 0a pattern)
- PIN locked → modal stays open, show countdown timer
- After submit success → modal close + toast "✓ Journal entry dicatat" + reload `fetchAccountLedger()` di parent

## 8. Testing Strategy

### Unit tests (vitest)
- `manualEntry.test.ts` — mock supabase.rpc, verify each function calls correct RPC name + args
- Field validation: amount=0 rejects, missing required → error message
- JE preview: lines balance check (visual + assertion)

### Integration tests (vitest + Supabase test client)
- `tests/integration/akuntansi-phase3/manual-transfer.test.ts` — call RPC dengan fake auth.uid, verify journal_entries row + 2 lines + balance check
- `tests/integration/akuntansi-phase3/owner-drawing.test.ts` — verify D Prive K Bank, source_type=OWNER_DRAWING
- `tests/integration/akuntansi-phase3/balance-adjustment.test.ts` — PIN happy path + 3× wrong-PIN lock
- `tests/integration/akuntansi-phase3/expense.test.ts` — D beban K source

Per memory `reference_smoke_test_security_definer_rpcs`: pakai `set_config('request.jwt.claim.sub', uid)` + `RAISE EXCEPTION 'rollback'` di akhir DO block untuk auth-gated RPCs.

### Manual smoke (browser via Chrome DevTools MCP)
- Open Kas & Bank → klik BCA Operasional → "+ Aksi" → Transfer Internal Rp 100rb ke Mandiri Toko → verify balance update + Riwayat baru
- Penyesuaian + PIN happy path + PIN wrong 3×
- Catat Pengeluaran → pilih beban gaji + sumber kas + Rp 500rb → verify Riwayat baru

## 9. Open Questions (resolved during brainstorm)

| Q | Decision |
|---|---|
| Owner Drawing dual-leg? | **NO** — single-leg sederhana (D Prive, K Bank). Personal account update manual. |
| Wallet spend link to order? | **Memo only** — store di entry.description, no COGS allocation. |
| `+ Aksi` location? | **AccountDetailScreen only** — top-right, single trigger location. |

## 10. Effort Estimate

- Migrations + RPCs: **2 hari** (5 RPCs + helpers + tests)
- UI components (6 modals + dropdown + preview shared): **3 hari**
- Service layer + types + unit tests: **1 hari**
- Integration tests + staging smoke: **1 hari**

**Total: ~7 hari engineering** (target ship dalam 1 minggu dengan subagent-driven dev).

## 11. Success Criteria

- [ ] 5 RPCs deployed + tested di staging
- [ ] 6 modals + dropdown live di AccountDetailScreen
- [ ] JE preview update real-time saat user isi form
- [ ] Penyesuaian PIN flow happy path + lockout verified browser-side
- [ ] Owner bisa input ≥10 manual JE end-to-end tanpa bug
- [ ] All entries muncul di AccountDetailScreen Riwayat sesuai source_type chip (Cleared / Recon)
- [ ] tsc clean, all tests pass
- [ ] No regression di Phase 1 Cash & Bank UI

---

## Next Steps

1. User review spec — request changes kalau ada
2. Write implementation plan (file structure + task breakdown)
3. Execute via subagent-driven-development
