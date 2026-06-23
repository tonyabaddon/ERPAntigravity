# Kas & Bank — Phase 1b Design Spec (Settlement Akurasi)

**Tanggal:** 2026-06-20
**Status:** Draft — menunggu user review untuk lock requirements
**Roadmap:** `2026-06-20-kas-bank-roadmap.md`
**Depends on:** Phase 1a (cash_accounts + cash_movements + balance view)

---

## 1. Goal

Saldo BCA tidak lagi overstate karena marketplace pending. Owner dapat queue terpisah "Belum Cair" yang bisa di-confirm satu-per-satu saat uang benar-benar cair ke rekening.

**Success criteria:**
- Marketplace sale (channel `tokopedia/shopee/lazada/blibli/bukalapak/ralali/bhinneka`) + QRIS/EDC: insert `cash_movements` dengan `status='PENDING'` (tidak masuk saldo).
- Halaman per akun + halaman global "Belum Cair" list pending settlement.
- Owner satu klik "Konfirmasi Cair" → transisi `PENDING → CLEARED` + set `cleared_at`, saldo bertambah.
- Per-channel timing config: estimasi cair (hint untuk owner, bukan auto-clear).
- Total pending per akun ditampilkan di header akun + total pending sistem-wide di dashboard.

---

## 2. Locked decisions (carry-over + new)

From Phase 1a:
- `cash_movements.status` enum `PENDING | CLEARED` (column sudah dibuat di Phase 1a, default `CLEARED`)
- `cash_account_balances` view sudah filter status=CLEARED

New di Phase 1b:
- Per-channel timing config table baru (`settlement_timing_config`)
- "Belum Cair" list = dedicated screen + per-account tab
- Manual confirm (no auto-clear in Phase 1b; auto-match di Phase 4)
- Cancel/refund order saat pending: insert reversing OUT pending → kalau pair sudah CLEARED, error "cannot reverse cleared"

---

## 3. Out of scope Phase 1b

- Auto-match pending dengan bank statement mutasi → Phase 4
- Partial settlement allocation (Tokopedia cair 70%, sisa hangus karena retur) → Phase 4
- Penyesuaian saldo pending manual → Phase 2 (via Penyesuaian flow)
- Per-marketplace fee deduction (fee Tokopedia 1-3% dipotong saat cair) → Phase 4 mode "auto-cair dengan fee net"

---

## 4. Data model

### 4.1 Update `cash_movements`

Status column sudah ada dari Phase 1a (default `CLEARED`). Phase 1b mengubah behavior:

```sql
-- Backfill: existing PENDING records (jika ada test data Phase 1b dev) tetap PENDING
-- No schema change, hanya RPC logic change
```

### 4.2 NEW: `settlement_timing_config`

```sql
CREATE TABLE public.settlement_timing_config (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel             text NOT NULL UNIQUE
    CHECK (channel IN ('tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka','qris','debit','credit_card')),
  default_bank_account_id  uuid REFERENCES public.cash_accounts(id) ON DELETE SET NULL,
  estimated_settlement_days int NOT NULL DEFAULT 7
    CHECK (estimated_settlement_days BETWEEN 0 AND 30),
  marketplace_fee_pct numeric(5,2) NOT NULL DEFAULT 0
    CHECK (marketplace_fee_pct >= 0 AND marketplace_fee_pct <= 100),  -- info only di Phase 1b, applied di Phase 4
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Seed default
INSERT INTO public.settlement_timing_config (channel, estimated_settlement_days, marketplace_fee_pct) VALUES
  ('tokopedia', 7, 1.0),
  ('shopee', 7, 1.5),
  ('lazada', 14, 2.0),
  ('blibli', 7, 1.0),
  ('bukalapak', 7, 1.5),
  ('ralali', 14, 1.0),
  ('bhinneka', 14, 1.0),
  ('qris', 1, 0.7),
  ('debit', 1, 0.0),
  ('credit_card', 2, 2.5)
ON CONFLICT (channel) DO NOTHING;

ALTER TABLE public.settlement_timing_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all authenticated read" ON public.settlement_timing_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "owners write" ON public.settlement_timing_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'));
```

### 4.3 View: `pending_settlements`

```sql
CREATE OR REPLACE VIEW public.pending_settlements AS
SELECT
  m.id AS movement_id,
  m.account_id,
  a.internal_label AS account_label,
  m.amount,
  m.occurred_at,
  m.description,
  m.category,
  m.source_ref_table,
  m.source_ref_id,
  -- Derive channel from category (e.g., 'KASIR_SALE_TOKOPEDIA' → 'tokopedia')
  LOWER(REPLACE(m.category, 'KASIR_SALE_', '')) AS channel,
  cfg.estimated_settlement_days,
  (m.occurred_at + (cfg.estimated_settlement_days || ' days')::interval)::date AS expected_clear_date,
  CASE
    WHEN (m.occurred_at + (cfg.estimated_settlement_days || ' days')::interval) < now() THEN 'OVERDUE'
    WHEN (m.occurred_at + (cfg.estimated_settlement_days || ' days')::interval) < now() + interval '2 days' THEN 'SOON'
    ELSE 'ON_TRACK'
  END AS aging_status
FROM public.cash_movements m
JOIN public.cash_accounts a ON a.id = m.account_id
LEFT JOIN public.settlement_timing_config cfg
  ON cfg.channel = LOWER(REPLACE(m.category, 'KASIR_SALE_', ''))
WHERE m.status = 'PENDING'
  AND m.direction = 'IN'
ORDER BY m.occurred_at;
```

---

## 5. RPC changes

### 5.1 Modify `record_kasir_sale` (3 variants)

Untuk channel marketplace + payment_method `qris/debit/credit_card`: set `cash_movements.status='PENDING'`. Channel walkin/grosir + cash: status='CLEARED' (langsung masuk Kas Toko).

```sql
-- Pseudocode di dalam RPC body
v_status text := CASE
  WHEN v_channel IN ('tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka') THEN 'PENDING'
  WHEN p_payment_method IN ('qris','debit','credit_card') THEN 'PENDING'
  ELSE 'CLEARED'
END;

INSERT INTO cash_movements (..., status, cleared_at) VALUES (..., v_status,
  CASE WHEN v_status = 'CLEARED' THEN now() ELSE NULL END
);
```

### 5.2 NEW RPC: `confirm_cash_movement_cleared`

```sql
CREATE OR REPLACE FUNCTION public.confirm_cash_movement_cleared(
  p_movement_id uuid,
  p_actual_amount numeric DEFAULT NULL  -- NULL = use original; for partial settlement
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement cash_movements;
BEGIN
  -- Validate caller is Owner or has canManageCashBank permission
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id=auth.uid() AND status='Aktif') THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT * INTO v_movement FROM cash_movements WHERE id = p_movement_id FOR UPDATE;
  IF v_movement.id IS NULL THEN RAISE EXCEPTION 'movement_not_found'; END IF;
  IF v_movement.status <> 'PENDING' THEN RAISE EXCEPTION 'movement_not_pending'; END IF;

  -- Phase 1b: ignore p_actual_amount; partial → Phase 4
  UPDATE cash_movements
    SET status='CLEARED', cleared_at=now()
    WHERE id = p_movement_id;

  -- Audit
  INSERT INTO audit_log (event, payload, actor_user_id) VALUES (
    'cash_movement_cleared',
    jsonb_build_object('movement_id', p_movement_id, 'amount', v_movement.amount),
    auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'cleared_at', now());
END;
$$;
```

### 5.3 NEW RPC: `cancel_pending_movement`

```sql
-- Untuk case: order marketplace dibatalkan customer SEBELUM cair
-- Insert reversing OUT row pending (sehingga net = 0)
CREATE OR REPLACE FUNCTION public.cancel_pending_movement(
  p_movement_id uuid,
  p_reason text
) RETURNS jsonb ...
-- Body: validate is PENDING, insert reversing OUT cleared (or PENDING for paired cancel?)
-- Phase 1b decision: insert OUT with status=CLEARED (net zero, owner sees both in riwayat)
```

---

## 6. UI components

### 6.1 NEW: `src/components/kasbank/PendingSettlementScreen.tsx`

Sidebar entry baru "Belum Cair" di group Keuangan (atau sebagai tab/badge di Kas & Bank screen utama).

Layout:
- Header: total pending sistem-wide + breakdown per channel (Tokopedia Rp 3jt, Shopee Rp 1.5jt, dll)
- Filter: by account, by channel, by aging_status (Overdue/Soon/On track)
- List rows: amount + description + channel + expected_clear_date + aging chip + button "Konfirmasi Cair"

```tsx
function PendingSettlementScreen() {
  const { data: pending } = useQuery('pending_settlements');
  const { data: totals } = useQuery('pending_totals_by_channel');

  return (
    <>
      <PendingTotalsHeader totals={totals} />
      <FilterBar />
      <PendingList rows={pending} onConfirm={handleConfirm} onCancel={handleCancel} />
    </>
  );
}

async function handleConfirm(movementId: string) {
  await supabase.rpc('confirm_cash_movement_cleared', { p_movement_id: movementId });
  // Toast: "✓ Saldo BCA bertambah Rp X"
  // Realtime subscription will refresh balances
}
```

### 6.2 Update `AccountDetailScreen.tsx`

- Banner "Saldo termasuk Rp X belum cair" tetap (dari Phase 1a) tapi sekarang berisi tombol "→ Lihat Belum Cair" yang scope ke akun ini.
- Tab baru "Belum Cair" di samping tab Riwayat, badge count.
- Tab Belum Cair: render rows pending untuk akun ini + tombol per row "Konfirmasi Cair" / "Batalkan".

### 6.3 Update `KasBankScreen.tsx`

- Total liquid header sekarang akurat (CLEARED only). Subtitle: "+ Rp X.X jt belum cair · klik untuk lihat" link ke PendingSettlementScreen.
- Per-account card: badge kuning "⚠ Rp 5.2jt belum cair" di samping saldo.

### 6.4 NEW: `src/components/pengaturan/SettlementTimingCard.tsx`

Owner config UI di Pengaturan:
- Per channel: estimated_settlement_days input + default_bank_account_id dropdown + marketplace_fee_pct (info only, apply di Phase 4)
- Save button → write ke `settlement_timing_config` table

### 6.5 Picker default per channel

Update picker di `PenjualanBaruScreen.tsx`:
- Saat user pilih channel Tokopedia, dropdown "Masuk ke akun" auto-fill dengan `settlement_timing_config[tokopedia].default_bank_account_id`
- User bisa override

---

## 7. Edge cases

| Case | Handling |
|---|---|
| Pending settlement age > 30 hari (overdue ekstrem) | Aging chip merah "Overdue 23 hari!". Owner harus manually confirm atau cancel. Tidak auto-cancel (data integrity). |
| Order marketplace dibatalkan customer setelah cair | Refund process: insert OUT cleared dengan source='REFUND'. Pending settlement gak relevan (sudah CLEARED). Phase 4 handle. |
| Order marketplace partial refund (cair 70%, refund 30%) | Phase 1b: confirm full amount; refund handle terpisah. Phase 4 dukung partial allocation. |
| Channel baru ditambahkan (mis. shopee dilink ke channel selain shopee) | settlement_timing_config tambah row baru; UI Pengaturan support add new channel. |
| Marketplace fee (Tokopedia potong 1.5% saat cair) | Phase 1b: `marketplace_fee_pct` di-config tapi belum applied. UI tampilkan "Estimasi net: Rp X (dikurangi fee 1.5%)". Phase 4 auto-deduct. |
| Confirm dengan actual_amount berbeda dari original | Phase 1b: ignore p_actual_amount, raise warning di UI ("Phase 4 akan handle selisih"). |
| Dual confirm race (2 user simultan klik Confirm) | RPC lock FOR UPDATE → 1 sukses, 1 gagal dengan `movement_not_pending`. |

---

## 8. Testing strategy

**Unit:**
- pending_settlements view: input cash_movements with various statuses → assert correct filter
- Aging classification (now vs expected_clear_date)

**Integration:**
- record_kasir_sale Tokopedia channel → cash_movement.status='PENDING'
- confirm_cash_movement_cleared RPC: PENDING → CLEARED, audit log written
- cancel_pending_movement RPC: insert reversing OUT
- Race: 2 concurrent confirm → 1 fails

**E2E:**
- Owner input sale Tokopedia → masuk Belum Cair list
- Click Konfirmasi Cair → saldo BCA bertambah, row hilang dari Belum Cair, masuk Riwayat dengan status Cleared

---

## 9. Risk + mitigation

| Risk | Mitigation |
|---|---|
| Owner lupa confirm pending → list menumpuk berbulan-bulan | Aging chip merah + dashboard widget "Anda punya 23 pending Belum Cair > 14 hari". Phase 4 auto-match akan resolve sebagian. |
| Channel mapping di category text fragile (`KASIR_SALE_TOKOPEDIA` parse) | Normalize: tambah explicit `channel` column ke cash_movements (nullable, only filled untuk KASIR_SALE source). Migration 1 hari. |
| settlement_timing_config not editable by non-Owner | RLS enforced; UI gates button by role |
| Marketplace settlement bertahap (3 kali transfer dari 1 batch sale) | Phase 4 partial allocation. Phase 1b: owner confirm full, deviation absorbed. |

---

## 10. Open questions for user

**O1. Channel column di cash_movements.** Saat ini saya parse dari category text (`KASIR_SALE_TOKOPEDIA` → tokopedia). Cleaner: tambah explicit `channel text NULL` column. Trade-off: schema bersih vs migration overhead.
- (a) Parse dari category text (no migration)
- (b) Tambah `channel` column, populate dari RPC + backfill

**O2. Aging cutoff untuk OVERDUE warning.** Saat ini saya pakai `expected_clear_date < now()`. Owner mungkin mau threshold lebih ketat (mis. > 3 hari setelah expected).
- (a) Exact (any day past expected = OVERDUE)
- (b) +3 hari grace
- (c) Configurable per channel di settlement_timing_config

**O3. Auto-clear policy.** Phase 1b spec saat ini: manual confirm only. Apakah perlu auto-clear option untuk channel high-volume (mis. QRIS auto-clear after T+1)?
- (a) Manual confirm only (current spec)
- (b) Auto-clear setelah aging_status=ON_TRACK + N hari (configurable per channel)
- (c) Defer ke Phase 4 (recon match auto-clears)

**O4. Sidebar entry "Belum Cair".** Apakah perlu top-level entry, atau cukup tab di Kas & Bank screen?
- (a) Tab di Kas & Bank (less sidebar clutter)
- (b) Top-level entry "Belum Cair" dengan badge count (more visibility, encourages owner to clear)
- (c) Notification badge di entry Kas & Bank itu sendiri

**O5. Marketplace fee (marketplace_fee_pct).** Apakah Phase 1b cukup info-only (UI hint) atau harus deduct di Phase 1b juga?
- (a) Info only Phase 1b, deduct di Phase 4 (current spec)
- (b) Deduct sekarang: cash_movement IN = gross, lalu OUT fee CLEARED otomatis saat confirm. Net masuk saldo = gross - fee.
- (c) Owner input actual cleared amount saat confirm (manual override fee)

**O6. Channel `walkin` non-marketplace tapi pakai QRIS payment method.** Owner pakai EDC + QRIS di counter Walkin. Apakah QRIS walkin = PENDING (T+1 cair) atau CLEARED (anggap real-time)?
- (a) PENDING (akurat, owner confirm setiap hari)
- (b) CLEARED (sederhana, asumsi cair sama hari)
- (c) Conditional: jika EDC merchant punya next-day batch settlement → PENDING; jika instant (QRIS Mandiri) → CLEARED

---

## 11. Estimate (3-5 hari)

| Komponen | Estimasi |
|---|---|
| settlement_timing_config table + seed + RLS | 0.5 hari |
| Modify record_kasir_sale (3 variants) for PENDING logic | 0.5-1 hari |
| confirm_cash_movement_cleared + cancel_pending_movement RPCs | 0.5 hari |
| pending_settlements view + integration tests | 0.5 hari |
| PendingSettlementScreen UI | 1-1.5 hari |
| AccountDetailScreen tab "Belum Cair" + KasBankScreen badges | 0.5-1 hari |
| SettlementTimingCard di Pengaturan | 0.5 hari |
| E2E smoke + tests | 0.5 hari |

Total: **3-5 hari**.
