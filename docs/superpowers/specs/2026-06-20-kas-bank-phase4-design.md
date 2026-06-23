# Kas & Bank — Phase 4 Design Spec (Recon Alignment)

**Tanggal:** 2026-06-20
**Status:** Draft — menunggu user review untuk lock requirements
**Roadmap:** `2026-06-20-kas-bank-roadmap.md`
**Depends on:** Phase 1a (cash_movements) + Phase 1b (PENDING status) + Phase 2 (manual entry)

---

## 1. Goal

Owner upload PDF mutasi rekening (workflow Rekonsiliasi existing) → setiap mutasi otomatis cocok dengan `cash_movements` yang sudah dicatat. Yang tidak cocok di-highlight: "Bulan ini ada 3 mutasi yang gak ada di buku".

**Success criteria:**
- Modul Rekonsiliasi existing diadapsi: matching cari pasangan di `cash_movements`, bukan langsung di `payable_slots`
- Auto-flip `cash_movement.reconciled_at` saat match green (confidence ≥0.9)
- Auto-clear PENDING settlement saat match dengan bank line (Phase 1b integration)
- Indicator UI: "✓ Rekonsiliasi: 28 dari 30 mutasi cocok" / "⚠ 3 mutasi gak ada di buku → Tindak Lanjut"
- Partial allocation: 1 bank line → multiple cash_movements (atau sebaliknya)

---

## 2. Locked decisions (carry-over + new)

From Phase 1a:
- `cash_movements.reconciled_at` + `bank_line_id` columns sudah dibuat

From Phase 1b:
- PENDING settlement queue sudah ada

New di Phase 4:
- `bank_line_allocations` schema change: kolom `cash_movement_id` baru (nullable transitional), `slot_id` deprecated
- Match algorithm: (account_id, amount ±5%, date ±N days) where N configurable
- Multi-allocation: 1 line bisa cover N movements (allocation per movement = amount), atau 1 movement bisa cover N lines (refund partial)
- Manual override: owner bisa manually link/unlink dari Recon UI

---

## 3. Out of scope Phase 4

- Auto-pull bank mutasi via API → Phase 5
- ML/AI scoring untuk match candidate → keep deterministic
- Cross-period match (1 line bulan Juni match dengan movement bulan Mei) — limit ±15 days per match

---

## 4. Data model

### 4.1 Update `bank_line_allocations`

```sql
-- Migration: tambah cash_movement_id, soft-deprecate slot_id
ALTER TABLE public.bank_line_allocations
  ADD COLUMN IF NOT EXISTS cash_movement_id uuid REFERENCES public.cash_movements(id) ON DELETE CASCADE;

-- Constraint: either slot_id OR cash_movement_id (XOR via CHECK)
ALTER TABLE public.bank_line_allocations
  ADD CONSTRAINT bank_line_allocations_target_check
  CHECK (
    (slot_id IS NOT NULL AND cash_movement_id IS NULL)
    OR (slot_id IS NULL AND cash_movement_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_bla_cash_movement ON public.bank_line_allocations(cash_movement_id) WHERE cash_movement_id IS NOT NULL;
```

**Migration plan:** soft transition. Existing allocations (Phase 4 deploy time) tetap pakai slot_id. New allocations sejak Phase 4 pakai cash_movement_id. Old slot_id allocations tetap functional (Rekonsiliasi UI handle both columns).

### 4.2 NEW: `cash_movement_id` populated on cash_movements creation

Phase 1a RPC wraps insert `cash_movements` dengan link ke source_ref. Phase 4 menambah bridge: saat `bank_statement_lines` upload + classification, auto-create `bank_line_allocations` row dengan `cash_movement_id` filled via match algorithm.

### 4.3 NEW view: `cash_movements_with_recon_status`

```sql
CREATE OR REPLACE VIEW public.cash_movements_with_recon_status AS
SELECT
  m.*,
  CASE
    WHEN m.reconciled_at IS NOT NULL THEN 'reconciled'
    WHEN m.bank_line_id IS NULL AND m.occurred_at > now() - interval '7 days' THEN 'pending_match'
    WHEN m.bank_line_id IS NULL AND m.occurred_at <= now() - interval '7 days' THEN 'unmatched'
    ELSE 'partial'
  END AS recon_status
FROM public.cash_movements m;
```

### 4.4 NEW view: `account_recon_summary`

```sql
CREATE OR REPLACE VIEW public.account_recon_summary AS
SELECT
  a.id AS account_id,
  a.internal_label,
  COUNT(*) FILTER (WHERE m.status = 'CLEARED' AND m.reconciled_at IS NOT NULL) AS reconciled_count,
  COUNT(*) FILTER (WHERE m.status = 'CLEARED' AND m.reconciled_at IS NULL AND m.occurred_at <= now() - interval '7 days') AS unmatched_count,
  COUNT(*) AS total_cleared
FROM public.cash_accounts a
LEFT JOIN public.cash_movements m ON m.account_id = a.id
WHERE a.account_type = 'BANK' AND a.is_active = true
GROUP BY a.id, a.internal_label;
```

---

## 5. RPC contracts

### 5.1 NEW: `match_bank_line_to_movements`

```sql
CREATE OR REPLACE FUNCTION public.match_bank_line_to_movements(
  p_bank_line_id uuid,
  p_tolerance_amount_pct numeric DEFAULT 5,
  p_tolerance_days int DEFAULT 3
) RETURNS jsonb
SECURITY DEFINER ...
AS $$
DECLARE
  v_line bank_statement_lines;
  v_candidates jsonb;
BEGIN
  SELECT * INTO v_line FROM bank_statement_lines WHERE id = p_bank_line_id;

  -- Find candidate cash_movements:
  -- - same account
  -- - amount within ±tolerance_pct
  -- - date within ±tolerance_days
  -- - direction matches (line IN ↔ movement IN; line OUT ↔ movement OUT)
  -- - not yet reconciled
  SELECT jsonb_agg(jsonb_build_object(
    'movement_id', m.id, 'amount', m.amount, 'occurred_at', m.occurred_at,
    'description', m.description, 'category', m.category,
    'amount_diff', m.amount - v_line.amount,
    'days_diff', EXTRACT(DAY FROM (m.occurred_at - v_line.txn_date)),
    'score', CASE WHEN m.amount = v_line.amount AND EXTRACT(DAY FROM (m.occurred_at - v_line.txn_date)) = 0 THEN 1.0 ELSE 0.7 END
  )) INTO v_candidates
  FROM cash_movements m
  WHERE m.account_id = v_line.bank_account_id
    AND m.direction = CASE v_line.direction WHEN 'IN' THEN 'IN' ELSE 'OUT' END
    AND m.status = 'CLEARED'
    AND m.reconciled_at IS NULL
    AND m.amount BETWEEN v_line.amount * (1 - p_tolerance_amount_pct/100) AND v_line.amount * (1 + p_tolerance_amount_pct/100)
    AND ABS(EXTRACT(DAY FROM (m.occurred_at - v_line.txn_date))) <= p_tolerance_days
  ORDER BY score DESC, ABS(m.amount - v_line.amount) ASC
  LIMIT 5;

  RETURN jsonb_build_object('ok', true, 'candidates', COALESCE(v_candidates, '[]'::jsonb));
END;
$$;
```

### 5.2 NEW: `confirm_bank_line_match`

```sql
CREATE OR REPLACE FUNCTION public.confirm_bank_line_match(
  p_bank_line_id uuid,
  p_movement_ids uuid[]   -- can be multiple (partial allocation)
) RETURNS jsonb
SECURITY DEFINER ...
AS $$
DECLARE
  v_line bank_statement_lines;
  v_total_alloc numeric := 0;
  v_movement_id uuid;
BEGIN
  SELECT * INTO v_line FROM bank_statement_lines WHERE id = p_bank_line_id;

  -- For each movement: create allocation, set reconciled_at
  FOREACH v_movement_id IN ARRAY p_movement_ids LOOP
    DECLARE
      v_movement cash_movements;
    BEGIN
      SELECT * INTO v_movement FROM cash_movements WHERE id = v_movement_id FOR UPDATE;
      IF v_movement.reconciled_at IS NOT NULL THEN RAISE EXCEPTION 'movement_already_reconciled: %', v_movement_id; END IF;

      -- If PENDING, auto-clear (Phase 1b integration)
      IF v_movement.status = 'PENDING' THEN
        UPDATE cash_movements SET status='CLEARED', cleared_at=now(), reconciled_at=now(), bank_line_id=p_bank_line_id WHERE id=v_movement_id;
      ELSE
        UPDATE cash_movements SET reconciled_at=now(), bank_line_id=p_bank_line_id WHERE id=v_movement_id;
      END IF;

      INSERT INTO bank_line_allocations (bank_line_id, cash_movement_id, amount)
      VALUES (p_bank_line_id, v_movement_id, v_movement.amount);

      v_total_alloc := v_total_alloc + v_movement.amount;
    END;
  END LOOP;

  -- Update bank line lane based on coverage
  IF v_total_alloc = v_line.amount THEN
    UPDATE bank_statement_lines SET lane='GREEN', matched_at=now(), matched_by=auth.uid() WHERE id=p_bank_line_id;
  ELSIF v_total_alloc < v_line.amount THEN
    UPDATE bank_statement_lines SET lane='YELLOW' WHERE id=p_bank_line_id;  -- partial
  ELSE
    RAISE EXCEPTION 'over_allocation: total=%, line=%', v_total_alloc, v_line.amount;
  END IF;

  RETURN jsonb_build_object('ok', true, 'allocated', v_total_alloc);
END;
$$;
```

### 5.3 NEW: `unlink_bank_line_match` (manual override)

```sql
-- Owner manually disconnect line ↔ movement
-- Reset reconciled_at + bank_line_id, delete allocation row
```

### 5.4 Auto-match batch trigger

Saat `bank_imports.status` transition ke `READY`, trigger function loop all `bank_statement_lines` in the import:
- Call `match_bank_line_to_movements` per line
- If 1 candidate with score=1.0 (exact match): auto-call `confirm_bank_line_match`
- Otherwise: leave line in YELLOW lane untuk owner manual review

---

## 6. UI components

### 6.1 Update `RekonsiliasiScreen.tsx`

- `MutasiColumn`: tampilkan kandidat dari `cash_movements` (bukan dari payable_slots saja)
- `MappingDrawer`: refactor untuk show candidates from cash_movements + visible source info (KASIR_SALE / PI_PAYMENT / MANUAL_TRANSFER)
- Tombol "Auto-Match All Green" — execute confirm untuk semua line dengan 1 candidate exact match

### 6.2 NEW: account recon indicator di KasBankScreen + AccountDetailScreen

```tsx
function AccountReconBadge({ account }: { account: CashAccount }) {
  const summary = useAccountReconSummary(account.id);
  if (account.account_type !== 'BANK') return null;

  const pct = summary.reconciled_count / summary.total_cleared * 100;
  if (summary.unmatched_count > 0) {
    return <Badge color="amber">⚠ {summary.unmatched_count} mutasi belum cocok</Badge>;
  }
  return <Badge color="emerald">✓ Rekonsiliasi {pct.toFixed(0)}%</Badge>;
}
```

### 6.3 NEW: Tab "Belum Cocok Recon" di AccountDetailScreen

- Filter `cash_movements_with_recon_status` where `recon_status='unmatched'`
- Tombol "Tindak Lanjut" → buka Rekonsiliasi screen filtered ke akun ini

### 6.4 PENDING settlement auto-clear UI feedback

Saat Phase 4 auto-match clear PENDING settlement:
- Notifikasi toast: "✓ 3 marketplace pending otomatis cocok dengan mutasi BCA"
- Belum Cair list refresh, item hilang

---

## 7. Match algorithm details

### 7.1 Tolerance defaults

- Amount: ±5% (handle marketplace fee deduction)
- Date: ±3 days (handle weekend/holiday settlement)

### 7.2 Candidate scoring

```
score = 1.0 if amount_exact AND date_exact
      = 0.85 if amount_exact AND date_within_1_day
      = 0.75 if amount_within_1pct AND date_within_3_days
      = 0.6 otherwise
```

Threshold for auto-confirm: 0.95.

### 7.3 Partial allocation strategy

Owner manual select multiple movements in Recon UI. Sum must equal line amount (or split remaining as "OTHER" entry).

### 7.4 Marketplace fee handling

Tokopedia cair Rp 1.230.000 untuk movement Rp 1.250.000 (fee 1.6%):
- amount_diff = -20.000 (1.6%)
- score ≥0.95 jika `marketplace_fee_pct` configured untuk channel = ±2% → tolerance auto-expanded
- Confirm match → owner option: "Selisih Rp 20rb adalah fee marketplace?" → insert OUT cash_movement category='Marketplace Fee'

---

## 8. Edge cases

| Case | Handling |
|---|---|
| Multiple movements with exact same amount + date | Show all candidates in MappingDrawer; owner pick |
| Bank line amount > sum of all candidate movements | Allocate partial; remaining flagged as "needs manual entry" |
| Movement reconciled, then user unlink | Set reconciled_at=NULL, bank_line_id=NULL; allocation row deleted |
| Bank line classified as INTERNAL_TRANSFER but matches Transfer Internal movement | Auto-link if pair found in cash_movements (transfer_pair_id) |
| Backfilled movements (source_type=BACKFILL) | Reconcile mode same as live; backfill data tetap eligible |
| PENDING settlement auto-cleared via match → balance jumps unexpectedly | UI notification + audit log entry. Owner can review. |
| Old slot_id allocations (legacy pre-Phase 4) | Recon UI tetap support; new allocations pakai cash_movement_id |
| Marketplace fee saat fee % beda dari config (Tokopedia kadang 1%, kadang 2.5%) | Tolerance expanded; manual allocation tetap available |

---

## 9. Testing strategy

**Unit:**
- Match scoring function (exact / partial / no match)
- Tolerance calculation

**Integration:**
- Upload bank statement → auto-match runs → exact matches auto-confirmed
- Owner manual link partial allocation → allocation rows created, line YELLOW
- Owner unlink → reset state
- PENDING settlement match → status flip to CLEARED + reconciled_at set

**E2E:**
- Owner upload BCA mutasi PDF → see auto-matched lines GREEN, unmatched YELLOW
- Confirm partial allocation → bank line still YELLOW dengan remaining amount
- Belum Cair list updates after auto-clear

---

## 10. Risk + mitigation

| Risk | Mitigation |
|---|---|
| Auto-match false positive (cocok yg salah) | Threshold 0.95 default. Manual unlink available. Audit log per match. |
| Slow match query untuk import dengan 100+ lines | Index `(account_id, amount, occurred_at)` sudah ada; benchmark di staging |
| Legacy slot_id allocations broken setelah refactor | CHECK constraint enforces XOR; transition Recon UI handles both columns |
| Owner accidentally confirm wrong match | Unlink available; reconciled_at audit timestamp |
| Marketplace fee tolerance terlalu loose (false positive untuk amount mirip) | Tolerance scoped per channel via settlement_timing_config; owner audit suspicious matches |

---

## 11. Open questions for user

**O1. Legacy slot_id allocations — migrate atau leave.** Setelah Phase 4 ship, allocations baru pakai cash_movement_id. Old slot_id-based stays. Apakah:
- (a) Leave (dual-mode permanently)
- (b) Migrate: convert old slot_id allocations → cash_movement_id via mapping (slot → underlying sale/pi → cash_movement)
- (c) Force-confirm legacy allocations (set reconciled_at di cash_movement via mapping) tapi tabel allocations tetap dual

**O2. Auto-match threshold.** Default 0.95 mean exact amount + date_within_1day. Apakah:
- (a) Conservative 0.95 (current)
- (b) Aggressive 0.85 (auto more, more false positives risk)
- (c) Configurable di Pengaturan per owner preference

**O3. Marketplace fee handling.** Saat match dengan fee deviation:
- (a) Tolerance auto-expand based on settlement_timing_config marketplace_fee_pct
- (b) Owner manual: "Selisih Rp X adalah fee? [Ya / Tidak]"
- (c) Auto-create fee movement: matched amount = gross - fee, fee OUT separately

**O4. Unmatched threshold (`recon_status='unmatched'`).** Saat ini: movement >7 hari belum di-recon = unmatched. Apakah cocok dengan flow MSME?
- (a) 7 hari (current)
- (b) 14 hari (lebih longgar)
- (c) Configurable

**O5. PENDING settlement auto-clear policy.** Saat bank line match ke PENDING movement:
- (a) Auto-flip ke CLEARED tanpa konfirmasi (current spec)
- (b) Confirm dialog: "Flip 3 marketplace pending ke CLEARED?"
- (c) Auto-flip + notification toast

**O6. Notification owner saat batch auto-match selesai.** Setelah upload PDF + auto-match:
- (a) Inline UI summary (current Rekonsiliasi screen)
- (b) WA push ke owner ("Recon Juni: 28 dari 30 lines auto-matched")
- (c) Email summary
- (d) Tidak ada notif tambahan

---

## 12. Estimate (2-3 hari)

| Komponen | Estimasi |
|---|---|
| Schema: cash_movement_id di allocations + view recon_status + account_recon_summary | 0.5 hari |
| RPC match + confirm + unlink + tests | 0.5-1 hari |
| Auto-match batch trigger + bank_imports integration | 0.5 hari |
| Rekonsiliasi UI refactor (MutasiColumn + MappingDrawer) | 0.5-1 hari |
| AccountReconBadge + tab "Belum Cocok" | 0.5 hari |
| PENDING auto-clear feedback UI | 0.25 hari |
| E2E smoke + edge case fixes | 0.5 hari |

Total: **2-3 hari**.
