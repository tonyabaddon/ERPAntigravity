# Kas & Bank — Phase 2 Design Spec (Manual Entry)

**Tanggal:** 2026-06-20
**Status:** Draft — menunggu user review untuk lock requirements
**Roadmap:** `2026-06-20-kas-bank-roadmap.md`
**Depends on:** Phase 1a (cash_accounts + cash_movements + balance view + RPC wraps)

---

## 1. Goal

Owner bisa catat hal yang sistem otomatis belum tahu: transfer antar rekening sendiri, setor cash kasir ke bank manual (di luar cash_batches batch flow), tarik untuk pribadi, top-up Lalamove balance, koreksi saldo karena selisih dengan rekening asli.

**Success criteria:**
- 5 modal flow: Transfer Internal, Setor Kas, Tarik Owner, Penyesuaian Saldo, Wallet Top-Up/Spend
- Penyesuaian Saldo membutuhkan Owner PIN (defensif — bisa dipakai mask theft)
- Attachment upload (foto bukti transfer/struk) di setiap form
- Saldo di sistem cocok sama saldo asli setelah owner pakai Penyesuaian
- Owner bisa lihat counterpart dari Transfer Internal di Riwayat kedua akun

---

## 2. Locked decisions (carry-over + new)

From Phase 1a:
- `cash_movements` table sudah extensible (Phase 1a sudah lock schema)

New di Phase 2:
- Reuse existing `verify_owner_pin` RPC (migration 20260626000010) untuk Penyesuaian
- Storage bucket baru `cash-attachments` untuk bukti foto
- Manual entries diberi `created_by` = caller auth.uid()
- Penyesuaian punya reason minimum 10 karakter
- 1 Transfer Internal → 2 cash_movements rows (OUT + IN) di-link via shared `transfer_pair_id`

---

## 3. Out of scope Phase 2

- Recurring transfer rules → Phase 3 atau later
- Approval workflow (admin → owner) untuk Penyesuaian — per `feedback_no_approval_workflow`, owner=admin di founder context, langsung Penyesuaian dengan PIN
- Auto-deduct dari Lalamove via API → Phase 5
- Penyesuaian bulk (multi-account sekaligus) — single account per transaksi

---

## 4. Data model updates

### 4.1 Extend `cash_movements.source_type` enum

```sql
ALTER TYPE cash_movement_source ADD VALUE IF NOT EXISTS 'MANUAL_TRANSFER';
ALTER TYPE cash_movement_source ADD VALUE IF NOT EXISTS 'MANUAL_DEPOSIT';      -- Setor Kas
ALTER TYPE cash_movement_source ADD VALUE IF NOT EXISTS 'OWNER_DRAWING';       -- Tarik Owner
ALTER TYPE cash_movement_source ADD VALUE IF NOT EXISTS 'OWNER_TOPUP';         -- Topup dari owner (kebalikan drawing)
ALTER TYPE cash_movement_source ADD VALUE IF NOT EXISTS 'ADJUSTMENT';          -- Penyesuaian
ALTER TYPE cash_movement_source ADD VALUE IF NOT EXISTS 'WALLET_TOPUP';        -- E-Wallet top-up
ALTER TYPE cash_movement_source ADD VALUE IF NOT EXISTS 'WALLET_SPEND';        -- E-Wallet spend
```

### 4.2 Add `transfer_pair_id` to cash_movements

```sql
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS transfer_pair_id uuid;

CREATE INDEX IF NOT EXISTS idx_cash_movements_pair
  ON public.cash_movements(transfer_pair_id) WHERE transfer_pair_id IS NOT NULL;

-- Constraint: paired rows must have opposite direction + same amount + same occurred_at
-- Enforced in RPC, not via CHECK (cross-row constraint)
```

### 4.3 Add `attachment_url` to cash_movements

```sql
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_filename text,
  ADD COLUMN IF NOT EXISTS attachment_size_bytes int;
```

### 4.4 NEW: Storage bucket `cash-attachments`

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (
  'cash-attachments', 'cash-attachments', false, 10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
);

-- RLS: only authenticated users can read; only via RPC can write
CREATE POLICY "authenticated read cash-attachments" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cash-attachments');
CREATE POLICY "authenticated insert cash-attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cash-attachments' AND auth.uid() IS NOT NULL);
```

Path pattern: `cash-attachments/{account_id}/{ts}-{filename}`.

### 4.5 Audit log entries

Reuse existing `audit_log` table. Event types:
- `cash_transfer_internal`
- `cash_setor_manual`
- `cash_owner_drawing`
- `cash_owner_topup`
- `cash_adjustment`
- `cash_wallet_topup`
- `cash_wallet_spend`

Payload jsonb: `{ movement_id(s), account_id(s), amount, reason, attachment_url }`.

---

## 5. RPC contracts

### 5.1 `record_internal_transfer`

```sql
CREATE OR REPLACE FUNCTION public.record_internal_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_occurred_at timestamptz,
  p_description text,
  p_attachment_url text DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER ... AS $$
DECLARE
  v_pair_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
BEGIN
  -- Validate: auth, accounts exist + active, from != to, amount > 0, sufficient balance (skip for OWNER_PERSONAL?)
  -- Insert OUT row
  INSERT INTO cash_movements (account_id, direction, amount, occurred_at, source_type, description, transfer_pair_id, attachment_url, created_by)
  VALUES (p_from_account_id, 'OUT', p_amount, p_occurred_at, 'MANUAL_TRANSFER', p_description, v_pair_id, p_attachment_url, auth.uid())
  RETURNING id INTO v_out_id;

  -- Insert IN row
  INSERT INTO cash_movements (account_id, direction, amount, occurred_at, source_type, description, transfer_pair_id, attachment_url, created_by)
  VALUES (p_to_account_id, 'IN', p_amount, p_occurred_at, 'MANUAL_TRANSFER', p_description, v_pair_id, p_attachment_url, auth.uid())
  RETURNING id INTO v_in_id;

  -- Audit
  INSERT INTO audit_log (event, payload, actor_user_id) VALUES (
    'cash_transfer_internal',
    jsonb_build_object('pair_id', v_pair_id, 'from', p_from_account_id, 'to', p_to_account_id, 'amount', p_amount),
    auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'pair_id', v_pair_id, 'out_id', v_out_id, 'in_id', v_in_id);
END;
$$;
```

### 5.2 `record_manual_deposit` (Setor Kas)

```sql
-- From Kas Toko (or any KAS account) to bank
CREATE OR REPLACE FUNCTION public.record_manual_deposit(
  p_from_account_id uuid,  -- type=KAS
  p_to_account_id uuid,    -- type=BANK
  p_amount numeric,
  p_occurred_at timestamptz,
  p_description text,
  p_attachment_url text DEFAULT NULL
) RETURNS jsonb
-- Body similar to internal_transfer, with validation: from is KAS, to is BANK
```

### 5.3 `record_owner_drawing` / `record_owner_topup`

```sql
-- Owner drawing: OUT bisnis account, IN pribadi account (if pribadi tracked)
CREATE OR REPLACE FUNCTION public.record_owner_drawing(
  p_from_account_id uuid,         -- bisnis
  p_to_personal_account_id uuid,  -- nullable; jika NULL, hanya OUT row (no destination)
  p_amount numeric,
  p_occurred_at timestamptz,
  p_reason text,
  p_attachment_url text DEFAULT NULL
) RETURNS jsonb
```

`record_owner_topup` is mirror: pribadi → bisnis.

### 5.4 `record_adjustment` (PIN-gated)

```sql
CREATE OR REPLACE FUNCTION public.record_adjustment(
  p_account_id uuid,
  p_direction text,           -- 'IN' or 'OUT' (positive correction or negative)
  p_amount numeric,
  p_occurred_at timestamptz,
  p_reason text,              -- MIN 10 chars
  p_owner_pin text,           -- validated via verify_owner_pin internally
  p_attachment_url text DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER ... AS $$
DECLARE
  v_pin_ok boolean;
BEGIN
  IF length(p_reason) < 10 THEN RAISE EXCEPTION 'reason_too_short: min 10 chars'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount_must_be_positive'; END IF;

  -- Validate PIN via existing RPC (which is bound to auth.uid + Aktif Owner only)
  SELECT (verify_owner_pin(NULL, p_owner_pin)::jsonb)->>'ok' INTO v_pin_ok;
  IF v_pin_ok IS NOT TRUE THEN RAISE EXCEPTION 'pin_invalid'; END IF;

  -- Insert adjustment movement
  INSERT INTO cash_movements (...) VALUES (...);

  -- Audit log dengan reason
  INSERT INTO audit_log (event, payload, actor_user_id) VALUES (
    'cash_adjustment',
    jsonb_build_object('account_id', p_account_id, 'direction', p_direction, 'amount', p_amount, 'reason', p_reason),
    auth.uid()
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
```

**Catatan:** `verify_owner_pin` saat ini bound ke approval flow (lock counter). Untuk Penyesuaian standalone, mungkin perlu wrap baru atau extend signature. Open question O3.

### 5.5 `record_wallet_topup` / `record_wallet_spend`

```sql
-- Top-up: OUT bank, IN wallet (pair)
-- Spend: OUT wallet (no pair; category text for spend type)
```

Reuses `record_internal_transfer` shape for top-up (just enforces `to_account.account_type='E_WALLET'`).

Spend is single-row OUT with `source_type='WALLET_SPEND'`.

---

## 6. UI components

### 6.1 NEW: 5 modal components

`src/components/kasbank/modals/`:
- `TransferInternalModal.tsx`
- `SetorKasModal.tsx`
- `OwnerDrawingModal.tsx` (+ inverse OwnerTopupModal)
- `PenyesuaianModal.tsx` (with PIN pad)
- `WalletTopupModal.tsx` (top-up); `WalletSpendModal.tsx` (spend)

Each modal shares structure:
- Account picker (from + to where applicable)
- Amount input (formatted IDR)
- Date picker (default = now)
- Description / reason text
- Attachment uploader (drag-drop or click; preview thumbnail; remove button)
- Submit button (loading state, disabled until form valid)
- Optional: balance preview "Saldo akan jadi Rp X setelah submit"

### 6.2 Account Detail screen — tombol Aksi

Update `AccountDetailScreen.tsx` Phase 1a:
- Dropdown "+ Aksi" tampil tombol berdasarkan account_type:
  - BANK: Transfer Internal, Penyesuaian
  - KAS: Setor ke Bank, Penyesuaian
  - E_WALLET: Top Up, Spend, Penyesuaian
  - Pribadi (purpose=OWNER_PERSONAL): Terima dari Owner, Transfer ke Pribadi (filter)
- Tombol "✏ Edit" akun: enable (was disabled di Phase 1a)

### 6.3 Pengaturan: opsi default

- Toggle: "Wajibkan Penyesuaian disertai foto bukti" (default OFF; defensif kalau ON, attachment required)
- Toggle: "Wajibkan Penyesuaian dengan reason ≥50 chars" (default OFF; default min 10)

### 6.4 Attachment uploader component

`src/components/kasbank/AttachmentUploader.tsx`:
- Validate: max 10 MB, accept image/* + PDF
- Upload to Supabase storage bucket `cash-attachments` via `uploadToCashAttachments(file, accountId)`
- Return: `{ url, filename, size_bytes }`
- Preview: image thumbnail (max 200×200) atau PDF icon + filename

---

## 7. Permission model

- All manual entry RPCs: any authenticated user can call (founder context — owner=admin).
- Penyesuaian: PIN-gated (existing flow).
- Future multi-tenant: add `canRecordCashManual` permission flag (deferred).

---

## 8. Edge cases

| Case | Handling |
|---|---|
| Transfer dari account A balance Rp 1jt, transfer Rp 2jt → negative balance | Allowed (no balance constraint). UI warning "Saldo akan jadi -Rp 1jt — lanjut?" Owner can ignore. |
| Penyesuaian dengan amount = 0 | Reject (`amount_must_be_positive`). |
| Penyesuaian PIN salah 5x → lockout? | Reuse `verify_owner_pin` lockout (existing behavior). |
| Owner Drawing tanpa pribadi account terdaftar | OK — `p_to_personal_account_id = NULL`, single OUT row dengan description "Tarik untuk pribadi" |
| Attachment upload gagal mid-flow | Modal: jangan submit RPC kalau upload error; tampilkan error retry button. Setelah upload OK, baru call RPC. |
| Modal dibuka, user partially fill, network drop saat submit | Local form state preserved in modal; user can retry. Optimistic UI update: tunggu RPC success baru update balance. |
| 2 user simultan Penyesuaian PIN ke account sama | Postgres serializable: both RPCs run, second one mungkin race PIN counter. Acceptable trade-off. |
| Cancel/Undo Transfer Internal | Phase 2 tidak ada undo. Solusi: insert reversing Transfer Internal manual (Owner kerja 2x kali). Phase 3+ bisa tambah "Undo last" button. |

---

## 9. Testing strategy

**Unit:**
- 5 modal form validation
- AttachmentUploader file size + MIME validation

**Integration:**
- record_internal_transfer creates 2 paired movements
- record_adjustment requires valid PIN
- record_adjustment reason < 10 chars → error
- record_owner_drawing dengan personal account = NULL → single OUT row
- Attachment upload + URL stored in cash_movement row

**E2E:**
- Owner Transfer Internal BCA → Mandiri, lihat di Riwayat kedua akun (with shared pair_id pill)
- Owner Penyesuaian dengan PIN benar → saldo update; salah PIN → error
- Owner Top Up Lalamove, lihat saldo wallet bertambah

---

## 10. Risk + mitigation

| Risk | Mitigation |
|---|---|
| Owner accidentally Penyesuaian saldo besar → mask kesalahan | Audit log lengkap dengan PIN-verified user. Reason wajib. Bulk audit di Pengaturan future. |
| Attachment storage cost balloon (banyak foto bukti) | 10 MB max per file. Quarterly cleanup script: hapus attachments > 2 tahun. |
| `verify_owner_pin` lockout shared dengan approval flow | Phase 2: investigate apakah lockout shared atau per-feature. Jika shared, owner harus tunggu cooldown untuk approve sales lain juga. Mungkin perlu refactor `verify_owner_pin` jadi context-aware. |
| Transfer Internal pair atomicity (1 row insert sukses, 1 gagal) | RPC SECURITY DEFINER wrap dalam BEGIN/COMMIT implicit; entire body rollback on error. |
| User pakai Wallet Spend untuk hide owner drawing | Audit log + monthly review (Phase 3 cash flow). Phase 1a immutable design prevents deletion. |

---

## 11. Open questions for user

**O1. Pribadi account tracking di Owner Drawing.** Phase 1a brainstorm sudah lock "akun pribadi muncul di list". Tapi flow Owner Drawing: apakah owner WAJIB pilih pribadi account sebagai destination, atau opsional?
- (a) Opsional — jika pilih, insert pair (OUT bisnis + IN pribadi); jika tidak, OUT only
- (b) Wajib — paksa owner track ke mana drawing pergi
- (c) Default behavior tergantung apakah ada Pribadi account dgn purpose=OWNER_PERSONAL: ada → wajib pilih; tidak ada → OUT only

**O2. Attachment requirement.** Apakah attachment wajib untuk Penyesuaian (defensif anti-theft)?
- (a) Opsional untuk semua (current spec)
- (b) Wajib untuk Penyesuaian saja
- (c) Wajib untuk Penyesuaian + Owner Drawing
- (d) Configurable di Pengaturan

**O3. `verify_owner_pin` reuse vs new wrapper.** Existing RPC bound ke approval flow. Untuk Penyesuaian, butuh wrap atau refactor?
- (a) Reuse as-is (lockout counter shared dengan approval — owner kena lockout PIN gak bisa approve sales juga)
- (b) Buat wrapper baru `verify_owner_pin_for_cash` dengan counter terpisah
- (c) Refactor `verify_owner_pin` jadi context-aware (param p_context='approval'|'cash')

**O4. Balance constraint.** Boleh transfer/setor lebih dari saldo akun (negative balance allowed)?
- (a) Allowed (current spec, warning UI saja)
- (b) Reject di RPC jika `current_balance < p_amount` (defensif)
- (c) Allowed untuk akun bisnis, reject untuk akun pribadi (cover overdraft scenario)

**O5. E-Wallet Spend category.** Untuk WALLET_SPEND, owner pilih kategori dari mana?
- (a) Free-text input (sederhana, ill-defined)
- (b) Dropdown predefined list ("Lalamove ongkir", "GoSend ongkir", "Top-up gas", "Listrik", "Lainnya")
- (c) Tabel baru `cash_categories` yang owner manage di Pengaturan

**O6. Reason min length.** Saat ini 10 karakter. Apakah cocok untuk Indonesian bahasa context?
- (a) 10 chars (current)
- (b) 20 chars (force more detail)
- (c) Configurable di Pengaturan

**O7. Pair "Setor Kas" cash_batches.** Existing cash_batches flow tetap aktif. Phase 2 manual Setor Kas: apakah:
- (a) Two parallel flows: cash_batches (kasir close-of-day) + manual setor (Phase 2) — owner pilih
- (b) Deprecate cash_batches; semua setor pakai Phase 2 manual
- (c) Manual setor INSERT row di cash_batches juga (sync), jadi single source of truth

---

## 12. Estimate (3-4 hari)

| Komponen | Estimasi |
|---|---|
| Schema extensions + storage bucket | 0.5 hari |
| 5-6 RPC (transfer, deposit, drawing, topup, adjustment, wallet) + tests | 1-1.5 hari |
| 5-6 modal UI + form validation | 1-1.5 hari |
| AttachmentUploader component + upload service | 0.5 hari |
| AccountDetail dropdown + edit-account enable | 0.5 hari |
| E2E smoke + bug fixes | 0.5 hari |

Total: **3-4 hari**.
