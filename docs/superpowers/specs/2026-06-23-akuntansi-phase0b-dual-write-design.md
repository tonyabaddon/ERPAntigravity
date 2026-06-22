# Akuntansi Phase 0b — Dual-Write + Picker Integration Design Spec

**Date:** 2026-06-23
**Status:** Draft for user review
**Phase:** 0b of Akuntansi MSME roadmap (after 0a, 1, 3, 0d, 4 shipped)
**Roadmap reference:** `docs/superpowers/specs/2026-06-21-kas-bank-gl-roadmap.md` section 5

---

## 1. Goal

Populate General Ledger (GL) dengan transaksi bisnis riil (kasir sales, pembayaran supplier, pelunasan piutang) sehingga Phase 4 Laporan (P&L, Neraca, Cash Flow) actually show real data. Phase 0b bundles **picker M4** (deferred dari Phase 1) + **dual-write** ke 3 business RPCs sehingga atomic value delivery.

## 2. Scope

### In-scope (3 RPCs + 3 modals + 1 anomaly table)

**Backend:**
- New table `gl_dual_write_anomalies` — soft-fail audit log
- New columns di `accounting_config`: `default_kas_account_id`, `default_bank_account_id`, `default_qris_account_id`, `default_edc_account_id` (UUID FKs ke cash_accounts)
- New column di `orders`: `cash_account_id` (UUID FK ke cash_accounts) — destination account for piutang payment
- New RPC `record_piutang_payment(p_order_id, p_cash_account_id, p_proof_url, p_verified_by_user_id)` — replaces direct UPDATE pattern in `markTempoInvoicePaid`
- Modify `record_kasir_sale`: add `p_cash_account_id uuid DEFAULT NULL` (param 22) + dual-write to GL
- Modify `record_pembayaran`: leverage existing `payload.account_id` for GL post + dual-write

**Frontend:**
- New shared component `src/components/akuntansi/CashAccountPicker.tsx` with filter prop
- Modify `src/components/penjualan/PenjualanBaruScreen.tsx` — render CashAccountPicker when payment_method ≠ 'cash'
- Modify `src/components/pembelian/PembayaranFormPage.tsx` — render CashAccountPicker (already wired but verify)
- Modify `src/components/piutang/PiutangScreen.tsx` CatatBayarModal — add CashAccountPicker + call new RPC

**Soft-fail logic:** Every dual-write wrapped:
```sql
BEGIN
  PERFORM _post_journal_entry(...);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO gl_dual_write_anomalies (...) VALUES (...);
  RAISE WARNING 'GL post failed: %', SQLERRM;
END;
```

Business RPC **never rolls back** because of GL fail. Feature flag `enable_dual_write_to_gl` acts as kill-switch (skip entire dual-write block).

### Out-of-scope (defer ke Phase 0c)

- `record_pi` (Tagihan creation) — D Persediaan/PPN Masukan, K Hutang Usaha
- `mark_walkin_order_paid` — D Kas/Bank, K Piutang Walkin
- `record_tukar_faktur` — TF reversal logic
- `write_off_tempo_invoice` — write-off scenarios
- HPP recognition saat sale
- Historical backfill since June 2025
- Daily cron compare (anomaly detection)
- Anomaly review UI (just `gl_dual_write_anomalies` table, no UI yet)

## 3. Architecture

### 3.1 Dual-Write Flow (Kasir Sale Example)

```
[User klik "Selesai" di PenjualanBaru]
  ↓
[handleSubmit → record_kasir_sale(p_payment_method='transfer', p_cash_account_id=<picker selection>)]
  ↓
[RPC body]
  1. INSERT customers + kasir_transactions (existing)
  2. IF accounting_config.enable_dual_write_to_gl:
     BEGIN
       v_destination_coa := resolve_cash_account_to_coa(p_cash_account_id OR default by payment_method)
       _post_journal_entry(
         entry_date := p_date,
         source_type := 'KASIR_SALE',
         description := 'Penjualan ' || channel || ' ' || marketplace_order_no,
         lines := [
           {account_code: v_destination_coa, side: 'DEBIT', amount: p_total_amount},
           {account_code: '4-1110/4-1120/4-1130', side: 'CREDIT', amount: p_total_amount}
         ],
         source_ref_table := 'kasir_transactions',
         source_ref_id := v_kasir_tx.id
       )
     EXCEPTION WHEN OTHERS THEN
       INSERT INTO gl_dual_write_anomalies (...);
       RAISE WARNING;
     END;
  3. RETURN v_kasir_tx (existing return)
```

### 3.2 Pendapatan COA mapping per channel

| `channel` (kasir_transactions) | Pendapatan COA |
|---|---|
| WALK_IN | 4-1110 Penjualan Walkin |
| MARKETPLACE_* | 4-1120 Penjualan Marketplace |
| WHOLESALE / GROSIR | 4-1130 Penjualan Grosir |
| TEMPO | 4-1140 Penjualan Tempo |

### 3.3 Cash account resolution per payment_method

```sql
-- Order of precedence:
-- 1. p_cash_account_id explicit (from picker)
-- 2. Fallback by payment_method via accounting_config defaults
-- 3. Final fallback: error (no valid default)

CASE p_payment_method
  WHEN 'cash' THEN COALESCE(p_cash_account_id, config.default_kas_account_id)
  WHEN 'transfer' THEN COALESCE(p_cash_account_id, config.default_bank_account_id)
  WHEN 'qris' THEN COALESCE(p_cash_account_id, config.default_qris_account_id, config.default_bank_account_id)
  WHEN 'edc' THEN COALESCE(p_cash_account_id, config.default_edc_account_id, config.default_bank_account_id)
END
```

If resolution returns NULL → anomaly log + skip GL post (soft-fail).

### 3.4 `record_pembayaran` flow

Already has `payload.account_id` (UUID FK to a `cash_accounts` table or similar). Use directly:

```sql
-- GL post:
-- D 2-1100 Hutang Usaha (per supplier invoice)
-- K <resolve_cash_coa(payload.account_id)>
```

### 3.5 `record_piutang_payment` flow (NEW)

Signature:
```sql
record_piutang_payment(
  p_order_id uuid,
  p_cash_account_id uuid,         -- explicit, from picker
  p_proof_url text,
  p_verified_by_user_id uuid
) RETURNS jsonb
```

Body:
1. Validate: order exists + status='INVOICE_TEMPO'
2. UPDATE orders SET status='PAYMENT_VERIFIED', cash_account_id=p_cash_account_id, payment_verified_at=now(), verified_by=p_verified_by_user_id, full_proof_url=p_proof_url WHERE id=p_order_id AND status='INVOICE_TEMPO'
3. IF dual_write_enabled:
   - D <resolve_cash_coa(p_cash_account_id)>
   - K 1-1400 Piutang Usaha
   - amount = orders.total
4. Return {ok, order_id, je_entry_id}

### 3.6 `gl_dual_write_anomalies` schema

```sql
CREATE TABLE gl_dual_write_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source_rpc text NOT NULL,           -- 'record_kasir_sale' | 'record_pembayaran' | 'record_piutang_payment'
  source_ref_table text NOT NULL,
  source_ref_id uuid NOT NULL,
  error_code text,                    -- SQLSTATE
  error_message text NOT NULL,        -- SQLERRM
  attempted_payload jsonb NOT NULL,   -- snapshot of what was supposed to post
  resolved_at timestamptz,            -- nullable, set when fixed
  resolved_by uuid,                   -- nullable
  resolution_notes text               -- nullable
);

CREATE INDEX idx_gl_anomalies_unresolved ON gl_dual_write_anomalies (created_at DESC) WHERE resolved_at IS NULL;
```

No RLS — service-role only access; future Phase 0c UI bisa expose ke Owner.

## 4. Migration Strategy

### Migration 1 — `20260723000001_phase0b_dual_write_infra.sql`

- CREATE TABLE `gl_dual_write_anomalies`
- ALTER TABLE `accounting_config` ADD columns: default_kas_account_id, default_bank_account_id, default_qris_account_id, default_edc_account_id (all UUID nullable FK)
- ALTER TABLE `orders` ADD COLUMN cash_account_id uuid REFERENCES cash_accounts(id)
- Seed Garindo defaults: SET default_kas_account_id = (id of Kas Toko)

### Migration 2 — `20260723000002_phase0b_record_kasir_sale_dual_write.sql`

- CREATE OR REPLACE `record_kasir_sale` dengan p_cash_account_id param ke-22 + dual-write soft-fail block

### Migration 3 — `20260723000003_phase0b_record_pembayaran_dual_write.sql`

- CREATE OR REPLACE `record_pembayaran` dengan dual-write block leveraging existing payload.account_id

### Migration 4 — `20260723000004_phase0b_record_piutang_payment_rpc.sql`

- CREATE FUNCTION `record_piutang_payment` (NEW) — SECURITY DEFINER + dual-write inline

## 5. UI Changes

### 5.1 `CashAccountPicker.tsx` (NEW shared component)

```typescript
export interface CashAccountPickerProps {
  value: string | null;  // selected cash_account_id
  onChange: (cashAccountId: string | null) => void;
  
  // Filter options
  paymentMethod?: 'cash' | 'transfer' | 'qris' | 'edc';  // filter accounts per type
  purposeFilter?: 'business-only' | 'all';
  
  // Display
  label?: string;        // default: "Masuk ke akun"
  placeholder?: string;  // default: "Pilih akun..."
  required?: boolean;
  disabled?: boolean;
  showBalance?: boolean; // default true — show current balance per option
}

export default function CashAccountPicker(props: CashAccountPickerProps): React.ReactElement;
```

Render: dropdown showing `${type_icon} ${account_code} ${internal_label} · ${formatRp(balance)}` per option. Filter by `paymentMethod` mapping to account_type:
- cash → KAS
- transfer → BANK
- qris → BANK with `meta.qris_enabled` (future) atau all BANK
- edc → BANK with `meta.edc_enabled` (future) atau all BANK

For Phase 0b: simpler filter — just `account_type` match.

### 5.2 PenjualanBaruScreen changes

Add CashAccountPicker rendered conditionally:
- When `payment_method !== 'cash'`: show picker with `paymentMethod={selectedMethod}`
- When `payment_method === 'cash'`: hide picker (auto = Kas Toko)
- Pass `cash_account_id` to `record_kasir_sale` RPC call

### 5.3 PembayaranFormPage

Verify existing `account_id` field is wired to CashAccountPicker — if not, refactor to use shared component.

### 5.4 CatatBayarModal (PiutangScreen)

Add CashAccountPicker (required, business-only). Replace `markTempoInvoicePaid` call with new `recordPiutangPayment` service wrapper.

## 6. Service Layer

### `src/lib/akuntansi/dualWrite.ts` (NEW)

```typescript
export async function recordPiutangPayment(input: {
  orderId: string;
  cashAccountId: string;
  proofUrl: string | null;
  verifiedByUserId: string;
}): Promise<{ ok: true; order_id: string; je_entry_id: string | null }>;
```

Wraps `supabase.rpc('record_piutang_payment', ...)`.

### `src/lib/piutangService.ts` modification

Deprecate `markTempoInvoicePaid` (mark with `@deprecated`). Replace internal calls to use `recordPiutangPayment`.

## 7. Validation Rules

| Field | Rule | Error |
|---|---|---|
| p_cash_account_id (kasir transfer/qris/edc) | required when payment_method != 'cash' | "Pilih akun tujuan transfer" |
| p_cash_account_id (piutang) | required | "Pilih akun penerima pembayaran" |
| cash_account_id active | must be is_active=true | "Akun tidak aktif" |
| cash_account purpose | must NOT be 'OWNER_PERSONAL' for business flows | "Akun pribadi tidak boleh untuk transaksi bisnis" |

## 8. Error Handling

- Soft-fail GL post → anomaly logged + business transaction succeeds
- Hard-fail business RPC errors → existing behavior unchanged
- Picker validation → frontend toast warning before submit
- Feature flag OFF → skip dual-write entirely

## 9. Testing Strategy

### Unit tests
- `dualWrite.test.ts` — recordPiutangPayment service wrapper
- CashAccountPicker mock test (account filtering, balance display)

### Integration tests
- `record_kasir_sale_dual_write.test.ts` — verify GL post with both explicit + fallback cash_account_id
- `record_pembayaran_dual_write.test.ts` — verify GL post via payload.account_id
- `record_piutang_payment.test.ts` — happy path + soft-fail simulation (closed period)

### MCP Smoke tests
- Enable `enable_dual_write_to_gl = true` in accounting_config
- Run 3 sample transactions via execute_sql with rollback
- Verify journal_entries inserted correctly + balanced

### Browser smoke (Chrome DevTools MCP)
- PenjualanBaru: cash sale → no picker, GL post 1-1110
- PenjualanBaru: transfer sale → picker shows, GL post selected bank
- CatatBayar: tempo payment → picker required, GL post correct

## 10. Decisions Locked (brainstorm)

| Q | Decision |
|---|---|
| Piutang dual-write approach | NEW RPC `record_piutang_payment` replaces direct UPDATE |
| `record_kasir_sale` signature | Add `p_cash_account_id` as optional param 22 (DEFAULT NULL) |
| Picker UX | Shared `CashAccountPicker` component with filter prop |
| Failure mode | Soft-fail + anomaly log, feature-flagged via accounting_config.enable_dual_write_to_gl |

## 11. Effort Estimate

- Backend (4 migrations + helpers): **1.5 hari**
- Service layer + types + unit tests: **0.5 hari**
- CashAccountPicker shared component: **0.5 hari**
- 3 modal integrations (PenjualanBaru, PembayaranForm, CatatBayar): **1.5 hari**
- Integration tests + MCP smoke: **1 hari**
- Browser smoke + manual QA: **0.5 hari**

**Total: ~5.5 hari engineering** (target 4-5 hari via subagent-driven dev).

## 12. Success Criteria

- [ ] `gl_dual_write_anomalies` table deployed
- [ ] 3 RPCs (record_kasir_sale + record_pembayaran + record_piutang_payment) dual-write to GL when feature flag ON
- [ ] CashAccountPicker live di 3 modals
- [ ] `enable_dual_write_to_gl = true` di Garindo accounting_config
- [ ] Test transaction (real kasir sale via UI) → row appears di journal_entries + journal_entry_lines + Trial Balance non-empty
- [ ] Soft-fail verified: simulate closed period → anomaly logged, business RPC OK
- [ ] All 379 existing tests still pass
- [ ] tsc + build clean

---

## Next Steps

1. User review spec — request changes
2. Write implementation plan (10-12 tasks)
3. Execute via subagent-driven-development
