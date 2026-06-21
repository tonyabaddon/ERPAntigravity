# Akuntansi MSME — Phase 0a Design Spec (GL Schema Foundation)

**Tanggal:** 2026-06-21 (rev3)
**Status:** Draft rev3 — ready for staging validation
**Roadmap:** `2026-06-21-kas-bank-gl-roadmap.md`

---

## 1. Goal

Lock data model General Ledger + Chart of Accounts (COA) + tenant tax config + double-entry validator + Trial Balance view + opening balance wizard + critical accounting flows (HPP, year-end, tax accrual, DP). **No UI changes** beyond opening balance wizard. Foundation untuk semua phase berikutnya.

**Success criteria:**
- Schema deployable ke staging Supabase tanpa error
- COA seed lengkap dengan SAK EMKM standard (~50 akun, termasuk DP)
- Double-entry validator reject any journal entry yang debit ≠ credit
- Trial Balance view return correct sum debit/kredit per akun, system-wide balanced
- Tenant config support PKP / non-PKP + UMKM Final / Badan Normal mode
- Period close mechanism via manual flag (owner klik)
- Opening balance wizard untuk first-time activation
- Inventory + HPP + Persediaan flow di-spec dengan jelas (auto-paired entries)
- Year-end closing procedure ke Laba Ditahan
- Tax accrual auto-entry (PPh Final monthly, PPN PKP)
- DP / Pendapatan Diterima Dimuka pattern documented
- 10 sample entries di staging post sukses, Trial Balance seimbang

---

## 2. Locked decisions

1. SAK EMKM standard COA (untuk UMKM Indo asset <Rp 50jt)
2. PPN configurable per tenant — Garindo default `NON_PKP`
3. PPh dual-mode — Garindo default `UMKM_FINAL_0_5`
4. Skip depreciation di Phase 0
5. Period close manual oleh owner
6. Tenant_id propagation aligned dengan `2026-06-13-multi-tenant-prerequisites-design.md`
7. COA validation via SAK EMKM template + AI assist (no human akuntan)
8. **Rev3:** Opening Balance wizard included sebagai Phase 0a deliverable (UI minimal, mandatory first-time)
9. **Rev3:** Inventory + HPP flow spec'd via auto-paired entries pattern
10. **Rev3:** Year-end closing RPC included
11. **Rev3:** Tax accrual RPC included (PPh Final monthly + PPN PKP saat enabled)
12. **Rev3:** DP via Pendapatan Diterima Dimuka pattern (added to COA seed)

---

## 3. Out of scope Phase 0a

- RPC wrap untuk business flow (kasir_sale, pembayaran, dll) → Phase 0b/0c
- Historical backfill journal entries → Phase 0c
- UI Buku Besar / Trial Balance / COA management → Phase 0d
- Cash & Bank UI (KasBankScreen, dll) → Phase 1 (parallel after 0a)
- Per-tenant COA customization beyond default seed → defer to multi-tenant phase
- Sub-ledger per customer/supplier auto-generation → pakai control account model
- Auto-depreciation cron — placeholder COA only

---

## 4. Data model

### 4.1 `chart_of_accounts` table

(unchanged from rev2 — see section below for schema)

```sql
CREATE TABLE public.chart_of_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code        text NOT NULL,
  account_name        text NOT NULL,
  account_type        text NOT NULL CHECK (account_type IN (
    'ASET','LIABILITAS','MODAL','PENDAPATAN','BEBAN'
  )),
  account_subtype     text,
  parent_id           uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  is_control_account  boolean NOT NULL DEFAULT false,
  normal_balance      text NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
  is_active           boolean NOT NULL DEFAULT true,
  is_system           boolean NOT NULL DEFAULT false,
  description         text,
  tenant_id           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_code)
);

CREATE INDEX idx_coa_type_active ON chart_of_accounts(account_type, is_active);
CREATE INDEX idx_coa_subtype ON chart_of_accounts(account_subtype) WHERE is_active = true;
CREATE INDEX idx_coa_parent ON chart_of_accounts(parent_id);
CREATE INDEX idx_coa_tenant ON chart_of_accounts(tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read coa" ON chart_of_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "owners write coa" ON chart_of_accounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'));

CREATE TRIGGER coa_set_updated_at BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### 4.2 SAK EMKM standard COA seed (rev3 — added DP + Pajak completeness)

~50 akun. **Rev3 additions:** `2-1500 Pendapatan Diterima Dimuka` (DP), expanded tax accounts, explicit fiscal year accounts.

```sql
INSERT INTO chart_of_accounts (account_code, account_name, account_type, account_subtype, normal_balance, is_control_account, is_system) VALUES
-- ============ 1 ASET ============
('1-1000', 'ASET LANCAR', 'ASET', NULL, 'DEBIT', true, true),
('1-1100', 'Kas', 'ASET', 'KAS', 'DEBIT', true, true),
('1-1110', 'Kas Toko', 'ASET', 'KAS', 'DEBIT', false, true),
('1-1200', 'Bank', 'ASET', 'BANK', 'DEBIT', true, true),
  -- Sub-accounts per bank account seeded from cash_accounts existing
('1-1300', 'E-Wallet', 'ASET', 'E_WALLET', 'DEBIT', true, true),
  -- Sub per wallet seeded from cash_accounts
('1-1400', 'Piutang Usaha', 'ASET', 'PIUTANG_USAHA', 'DEBIT', true, true),
('1-1450', 'Piutang Lain-lain', 'ASET', 'PIUTANG', 'DEBIT', false, true),
('1-1500', 'Persediaan', 'ASET', 'PERSEDIAAN', 'DEBIT', true, true),
('1-1510', 'Persediaan Barang Jadi', 'ASET', 'PERSEDIAAN', 'DEBIT', false, true),
('1-1520', 'Persediaan Bahan Baku', 'ASET', 'PERSEDIAAN', 'DEBIT', false, true),
-- ('1-1600', 'PPN Masukan', 'ASET', 'PAJAK', 'DEBIT', false, true), -- conditional PKP
('1-2000', 'ASET TETAP', 'ASET', NULL, 'DEBIT', true, true),
('1-2100', 'Peralatan', 'ASET', 'ASET_TETAP', 'DEBIT', false, true),
('1-2200', 'Kendaraan', 'ASET', 'ASET_TETAP', 'DEBIT', false, true),
('1-2900', 'Akumulasi Penyusutan (contra)', 'ASET', 'KONTRA', 'CREDIT', false, true),

-- ============ 2 LIABILITAS ============
('2-1000', 'LIABILITAS LANCAR', 'LIABILITAS', NULL, 'CREDIT', true, true),
('2-1100', 'Hutang Usaha', 'LIABILITAS', 'HUTANG_USAHA', 'CREDIT', true, true),
('2-1200', 'Hutang Pajak', 'LIABILITAS', 'PAJAK', 'CREDIT', true, true),
('2-1210', 'Hutang PPh Final 0.5%', 'LIABILITAS', 'PAJAK', 'CREDIT', false, true),
('2-1220', 'Hutang PPh Pasal 25', 'LIABILITAS', 'PAJAK', 'CREDIT', false, true),
-- ('2-1230', 'PPN Keluaran', 'LIABILITAS', 'PAJAK', 'CREDIT', false, true), -- conditional PKP
('2-1300', 'Hutang Bank Jangka Pendek', 'LIABILITAS', 'HUTANG_BANK', 'CREDIT', false, true),
('2-1400', 'Hutang Lain-lain', 'LIABILITAS', NULL, 'CREDIT', false, true),
('2-1500', 'Pendapatan Diterima Dimuka (DP)', 'LIABILITAS', 'DP', 'CREDIT', false, true),  -- REV3
  -- Untuk track DP customer yang belum delivery
('2-2000', 'LIABILITAS JANGKA PANJANG', 'LIABILITAS', NULL, 'CREDIT', true, true),
('2-2100', 'Hutang Bank Jangka Panjang', 'LIABILITAS', 'HUTANG_BANK', 'CREDIT', false, true),

-- ============ 3 MODAL ============
('3-1000', 'EKUITAS', 'MODAL', NULL, 'CREDIT', true, true),
('3-1100', 'Modal Owner', 'MODAL', 'MODAL_DISETOR', 'CREDIT', false, true),
('3-1200', 'Prive (Owner Drawing)', 'MODAL', 'PRIVE', 'DEBIT', false, true),
('3-1300', 'Laba Ditahan', 'MODAL', 'LABA_DITAHAN', 'CREDIT', false, true),
('3-1400', 'Laba/(Rugi) Tahun Berjalan', 'MODAL', 'LABA_BERJALAN', 'CREDIT', false, true),
('3-1900', 'Ikhtisar Laba Rugi (closing)', 'MODAL', 'CLOSING', 'CREDIT', false, true),  -- REV3
  -- Akun perantara untuk year-end closing process

-- ============ 4 PENDAPATAN ============
('4-1000', 'PENDAPATAN USAHA', 'PENDAPATAN', NULL, 'CREDIT', true, true),
('4-1100', 'Penjualan', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', true, true),
('4-1110', 'Penjualan Walkin', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', false, true),
('4-1120', 'Penjualan Marketplace', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', false, true),
('4-1130', 'Penjualan Grosir', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', false, true),
('4-1140', 'Penjualan Tempo (Kredit)', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', false, true),
('4-1200', 'Pendapatan Lain-lain', 'PENDAPATAN', 'PENDAPATAN_LAIN', 'CREDIT', true, true),
('4-1210', 'Pendapatan Bunga', 'PENDAPATAN', 'PENDAPATAN_LAIN', 'CREDIT', false, true),
('4-1220', 'Pendapatan Ongkir (margin)', 'PENDAPATAN', 'PENDAPATAN_LAIN', 'CREDIT', false, true),
('4-1230', 'Keuntungan Selisih Stock Opname', 'PENDAPATAN', 'PENDAPATAN_LAIN', 'CREDIT', false, true),  -- REV3
('4-1900', 'Diskon Penjualan (contra)', 'PENDAPATAN', 'KONTRA', 'DEBIT', false, true),

-- ============ 5 BEBAN ============
('5-1000', 'HARGA POKOK PENJUALAN', 'BEBAN', NULL, 'DEBIT', true, true),
('5-1100', 'HPP Penjualan', 'BEBAN', 'HPP', 'DEBIT', false, true),
('5-2000', 'BEBAN OPERASIONAL', 'BEBAN', NULL, 'DEBIT', true, true),
('5-2100', 'Beban Gaji', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2200', 'Beban Sewa Tempat', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2300', 'Beban Utilitas (Listrik, Air, Gas)', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2400', 'Beban Marketing', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2500', 'Beban Transportasi/Ongkir', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2600', 'Beban ATK', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2700', 'Beban Komunikasi/Internet', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2800', 'Beban MDR EDC / Bank Fee', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2900', 'Beban Konsumsi Karyawan', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2950', 'Beban Operasional Lain-lain', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-3000', 'BEBAN NON-OPERASIONAL', 'BEBAN', NULL, 'DEBIT', true, true),
('5-3100', 'Kerugian Piutang (Write-off)', 'BEBAN', 'BEBAN_NON_OPERASIONAL', 'DEBIT', false, true),
('5-3150', 'Kerugian Selisih Stock Opname', 'BEBAN', 'BEBAN_NON_OPERASIONAL', 'DEBIT', false, true),  -- REV3
('5-3200', 'Beban Penyusutan', 'BEBAN', 'BEBAN_NON_OPERASIONAL', 'DEBIT', false, true),
('5-3300', 'Beban Pajak', 'BEBAN', 'BEBAN_NON_OPERASIONAL', 'DEBIT', false, true);
```

### 4.3 `accounting_config` table

(unchanged from rev2)

```sql
CREATE TABLE public.accounting_config (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid UNIQUE,
  ppn_mode                    text NOT NULL DEFAULT 'NON_PKP'
    CHECK (ppn_mode IN ('NON_PKP','PKP')),
  ppn_rate_pct                numeric(5,2) NOT NULL DEFAULT 11.0,
  pph_mode                    text NOT NULL DEFAULT 'UMKM_FINAL_0_5'
    CHECK (pph_mode IN ('UMKM_FINAL_0_5','BADAN_NORMAL_25','BADAN_NORMAL_22','MANUAL')),
  pph_rate_pct                numeric(5,2),
  fiscal_year_start_month     int NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  enable_dual_write_to_gl     boolean NOT NULL DEFAULT false,
  enable_strict_period_close  boolean NOT NULL DEFAULT false,
  -- REV3: opening_balance_set flag
  opening_balance_set         boolean NOT NULL DEFAULT false,
  opening_balance_date        date,
  -- REV3: auto-accrual flags
  auto_accrue_pph_monthly     boolean NOT NULL DEFAULT true,
  auto_accrue_ppn_monthly     boolean NOT NULL DEFAULT false,  -- only saat PKP
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Seed Garindo default
INSERT INTO accounting_config (tenant_id, ppn_mode, pph_mode, pph_rate_pct, enable_dual_write_to_gl, opening_balance_set, opening_balance_date)
VALUES (NULL, 'NON_PKP', 'UMKM_FINAL_0_5', 0.5, false, false, NULL);
```

### 4.4-4.8 (unchanged from rev2)

`journal_entries`, `journal_entry_lines`, `accounting_periods`, `trial_balance` view, `general_ledger` view — see rev2 for full DDL (preserved as-is). New addition: `journal_entry_source` enum expanded with rev3 source types.

```sql
-- REV3: Updated enum
CREATE TYPE journal_entry_source AS ENUM (
  'KASIR_SALE',
  'PEMBAYARAN',
  'PIUTANG_PAYMENT',
  'KASIR_EXPENSE',
  'PI_TAGIHAN',
  'PI_RECEIVE_GOODS',        -- REV3: receive goods → Persediaan
  'WALKIN_PAYMENT',
  'TEMPO_WRITEOFF',
  'CASH_DEPOSIT_BATCH',
  'MANUAL_TRANSFER',
  'OWNER_DRAWING',
  'OWNER_TOPUP',
  'WALLET_TOPUP',
  'WALLET_SPEND',
  'ADJUSTMENT',
  'OPENING_BALANCE',
  'BACKFILL',
  'PERIOD_CLOSE',
  'YEAR_END_CLOSE',          -- REV3: annual closing
  'HPP_RECOGNITION',
  'TAX_ACCRUAL_PPH',         -- REV3: PPh accrual
  'TAX_ACCRUAL_PPN',         -- REV3: PPN accrual (PKP)
  'STOCK_OPNAME_ADJ',        -- REV3: opname adjustment
  'DP_RECEIVE',              -- REV3: DP from customer
  'DP_RECOGNIZE',            -- REV3: DP → Penjualan saat delivery
  'DP_REFUND'                -- REV3: refund DP
);
```

---

## 5. Critical accounting flows (REV3 — central additions)

### 5.1 Inventory + HPP + Persediaan flow

**Problem:** Without explicit spec, Persediaan account balance bisa "in air" — Trial Balance balanced internally tapi stock account tidak reflect kenyataan.

**Pattern:**

#### 5.1.1 Pembelian PI received (existing `record_pi` + receive_goods flow)

Saat PI received (qty_received update):
```
D 1-1510 Persediaan Barang Jadi (subtotal)
  K 2-1100 Hutang Usaha (subtotal)
```

Untuk PKP (ada PPN):
```
D 1-1510 Persediaan Barang Jadi (subtotal_dpp)
D 1-1600 PPN Masukan (ppn_amount)
  K 2-1100 Hutang Usaha (total)
```

Untuk cash purchase (langsung dibayar saat received):
```
D 1-1510 Persediaan Barang Jadi
  K 1-1xxx Kas/Bank (source)
```

Wrap di Phase 0c saat `record_pi` + receive_goods flow. Source: `PI_RECEIVE_GOODS`.

#### 5.1.2 Kasir sale dengan HPP recognition (auto-paired)

`record_kasir_sale` di Phase 0b wrap **dua journal entries paired**:

**Entry 1 — Sale recognition:**
```
D 1-1xxx Kas/Bank (total - hpp_total + hpp_total = total)
  K 4-11xx Penjualan (subtotal)
```

**Entry 2 — HPP recognition (paired via source_ref_id):**
```
D 5-1100 HPP Penjualan (hpp_total)
  K 1-1510 Persediaan Barang Jadi (hpp_total)
```

Source: Entry 1 = `KASIR_SALE`, Entry 2 = `HPP_RECOGNITION` dengan `source_ref_table='journal_entries'`, `source_ref_id=<entry1.id>`. UI Buku Besar tampilkan keduanya berurutan.

Rationale: tetap immutable, audit trail jelas, easy to reverse jika sale dibatalkan (reverse both).

#### 5.1.3 Stock opname adjustment

Saat `stock_opname` selesai dengan variance:

**Selisih KURANG (lost stock):**
```
D 5-3150 Kerugian Selisih Stock Opname (variance_value)
  K 1-1510 Persediaan Barang Jadi (variance_value)
```

**Selisih LEBIH (found stock):**
```
D 1-1510 Persediaan Barang Jadi (variance_value)
  K 4-1230 Keuntungan Selisih Stock Opname (variance_value)
```

Wrap di Phase 0c saat opname approve flow. Source: `STOCK_OPNAME_ADJ`.

#### 5.1.4 HPP cost basis

Untuk Phase 0a/0b/0c: pakai `kasir_transactions.hpp_total` yang existing (FIFO/Average computed di existing flow). Tidak ada perubahan stock valuation method.

#### 5.1.5 Sale cancellation / refund

Saat order cancelled setelah journal entry posted: gunakan reversal pattern via `_post_journal_entry` dengan `p_reverses_entry_id`. Reversal entry flip debit/credit. Kalau hpp_total juga sudah recognized, reverse HPP entry juga.

### 5.2 Opening Balance setup wizard (mandatory first-time)

**Problem:** Garindo punya saldo historis pre-Juni 2025 (modal awal, saldo bank, persediaan). Tanpa opening balance, setelah backfill Aset ≠ Liabilitas + Modal, Trial Balance system-wide off.

**Solution: Opening Balance Wizard sebagai Phase 0a UI deliverable.**

#### 5.2.1 Wizard flow (4 steps)

1. **Konfirmasi tanggal saldo awal** (default: hari sebelum data backfill earliest, mis. 2025-05-31)
2. **Input saldo per akun bisnis** (Owner only):
   - Kas Toko, BCA, Mandiri, E-Wallets (auto-list dari cash_accounts)
   - Piutang Usaha total (auto-sum from existing orders)
   - Persediaan (auto-sum from existing stock_levels × current cost)
   - Aset Tetap (optional manual input)
   - Hutang Usaha total (auto-sum from existing purchase_invoices unpaid)
   - Modal Owner (manual input)
3. **Balance check**: Total Aset harus = Total Liabilitas + Modal. Show diff, auto-suggest plug ke Laba Ditahan kalau slight diff.
4. **Confirm & post**: Single journal entry dengan multi-line, source `OPENING_BALANCE`, occurred_at = balance date.

```sql
-- Resulting journal entry shape (example Garindo):
-- D 1-1110 Kas Toko          500.000
-- D 1-1210 BCA Operasional  8.500.000
-- D 1-1220 Mandiri Toko     3.200.000
-- D 1-1310 Lalamove          200.000
-- D 1-1400 Piutang Usaha   12.000.000
-- D 1-1510 Persediaan      35.000.000
-- D 1-2100 Peralatan        5.000.000
--   K 2-1100 Hutang Usaha           8.000.000
--   K 2-2100 Hutang Bank Jangka Pj  6.500.000
--   K 3-1100 Modal Owner           40.000.000
--   K 3-1300 Laba Ditahan          10.000.000  -- plug
-- TOTAL D = K = 64.400.000
```

#### 5.2.2 Validation gates

- Block all other journal entry insertions until `accounting_config.opening_balance_set=true`
- Backfill migration (Phase 0c) blocks until opening balance set
- UI banner di Akuntansi screen kalau belum set

#### 5.2.3 RPC: `set_opening_balance`

```sql
CREATE OR REPLACE FUNCTION public.set_opening_balance(
  p_balance_date date,
  p_lines jsonb,   -- Array of {account_code, side, amount}
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER ...
AS $$
DECLARE
  v_already_set boolean;
  v_result jsonb;
BEGIN
  -- Validate Owner
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif') THEN
    RAISE EXCEPTION 'owner_only';
  END IF;

  -- Validate not already set
  SELECT opening_balance_set INTO v_already_set FROM accounting_config
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000') = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000') LIMIT 1;
  IF v_already_set THEN RAISE EXCEPTION 'opening_balance_already_set'; END IF;

  -- Delegate to _post_journal_entry (validates balanced + post)
  v_result := _post_journal_entry(
    p_entry_date := p_balance_date,
    p_source_type := 'OPENING_BALANCE',
    p_source_ref_table := NULL,
    p_source_ref_id := NULL,
    p_description := 'Saldo awal per ' || p_balance_date::text,
    p_lines := p_lines,
    p_tenant_id := p_tenant_id
  );

  -- Mark config flag
  UPDATE accounting_config
    SET opening_balance_set = true, opening_balance_date = p_balance_date
    WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000') = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000');

  RETURN v_result;
END;
$$;
```

### 5.3 DP / Pendapatan Diterima Dimuka pattern

**Account:** `2-1500 Pendapatan Diterima Dimuka` (Liabilitas)

#### 5.3.1 Terima DP dari customer

```
D 1-1xxx Kas/Bank (dp_amount)
  K 2-1500 Pendapatan Diterima Dimuka (dp_amount)
```

Source: `DP_RECEIVE`. `counterparty_type='CUSTOMER'`, `counterparty_id=customer_id`. Triggered saat existing flow record_kasir_sale dengan dp_amount > 0 (atau dedicated DP flow).

#### 5.3.2 Saat barang delivered + lunas (recognize as Penjualan)

```
D 2-1500 Pendapatan Diterima Dimuka (dp_amount)
D 1-1xxx Kas/Bank (sisa_amount = total - dp_amount)
  K 4-11xx Penjualan (total)
```

Source: `DP_RECOGNIZE`. Plus paired HPP entry seperti regular sale.

#### 5.3.3 Refund DP (kalau order cancelled)

```
D 2-1500 Pendapatan Diterima Dimuka (dp_amount)
  K 1-1xxx Kas/Bank (dp_amount)
```

Source: `DP_REFUND`.

**Note:** Existing kasir flow has dp_amount field — Phase 0b/0c wrap akan handle this branching logic dalam `record_kasir_sale` wrapper.

### 5.4 Year-end closing procedure

**Problem:** Tanpa year-end close, Pendapatan + Beban akumulasi forever, Laba Tahun Berjalan tidak crystallize.

**Solution:** RPC `close_fiscal_year` yang generate "closing entries" untuk move P&L balances ke Laba Ditahan.

#### 5.4.1 Closing entries pattern (Indonesia standard)

End of fiscal year (Dec 31 if fiscal_year_start_month=1):

**Step 1 — Close Pendapatan ke Ikhtisar Laba Rugi:**
```
D 4-1110 Penjualan Walkin          (saldo period)
D 4-1120 Penjualan Marketplace     (saldo period)
... (semua 4-XXXX accounts)
  K 3-1900 Ikhtisar Laba Rugi      (total Pendapatan)
```

**Step 2 — Close Beban ke Ikhtisar Laba Rugi:**
```
D 3-1900 Ikhtisar Laba Rugi        (total Beban)
  K 5-1100 HPP Penjualan           (saldo period)
  K 5-2100 Beban Gaji              (saldo period)
  ... (semua 5-XXXX accounts)
```

**Step 3 — Close Ikhtisar Laba Rugi ke Laba Ditahan:**
```
Kalau Laba (Pendapatan > Beban):
D 3-1900 Ikhtisar Laba Rugi        (net income)
  K 3-1300 Laba Ditahan            (net income)

Kalau Rugi (Beban > Pendapatan):
D 3-1300 Laba Ditahan              (net loss)
  K 3-1900 Ikhtisar Laba Rugi      (net loss)
```

**Step 4 — Close Prive ke Laba Ditahan:**
```
D 3-1300 Laba Ditahan              (saldo Prive)
  K 3-1200 Prive (Owner Drawing)   (saldo Prive)
```

#### 5.4.2 RPC: `close_fiscal_year`

```sql
CREATE OR REPLACE FUNCTION public.close_fiscal_year(
  p_year int,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER ...
AS $$
DECLARE
  v_fiscal_end date;
  v_pendapatan_lines jsonb;
  v_beban_lines jsonb;
  v_net_income numeric;
  v_prive_balance numeric;
BEGIN
  -- Validate Owner + all monthly periods closed
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif') THEN
    RAISE EXCEPTION 'owner_only';
  END IF;

  -- Determine fiscal year end based on config
  -- (assume Jan-Dec for simplicity in Phase 0a; configurable later)
  v_fiscal_end := make_date(p_year, 12, 31);

  -- Build closing entries (3-4 entries posted via _post_journal_entry)
  -- ... detailed logic ...

  -- Insert 3-4 separate journal entries with source_type='YEAR_END_CLOSE'
  -- Return summary

  RETURN jsonb_build_object('ok', true, 'fiscal_year', p_year, 'net_income', v_net_income);
END;
$$;
```

### 5.5 Tax accrual auto-entries

#### 5.5.1 PPh Final 0.5% UMKM monthly accrual

Saat owner klik "Tutup Buku Juni" (period close), RPC otomatis compute + post tax accrual entry.

**Compute:**
- Omzet bulanan = `SUM(amount WHERE side='CREDIT')` dari journal_entry_lines WHERE account in 4-XXXX (Pendapatan) AND entry_date in period
- Tax amount = omzet × 0.5% (atau dari `pph_rate_pct` config)

**Entry:**
```
D 5-3300 Beban Pajak              (tax_amount)
  K 2-1210 Hutang PPh Final 0.5%  (tax_amount)
```

Source: `TAX_ACCRUAL_PPH`. Posted dengan entry_date = last day of month.

#### 5.5.2 PPN Keluaran - PPN Masukan accrual (PKP only)

Saat tenant PKP + period close:
- Total PPN Keluaran period (sum K 2-1230)
- Total PPN Masukan period (sum D 1-1600)
- Net PPN payable = PPN Keluaran - PPN Masukan

Kalau payable > 0:
```
D 2-1230 PPN Keluaran (total period)
  K 1-1600 PPN Masukan (total period)
  K 2-1240 PPN Terutang (net payable, baru akun untuk track)
```

(Note: 2-1240 PPN Terutang belum di seed Phase 0a; tambah saat PKP mode enabled.)

#### 5.5.3 RPC: `accrue_period_taxes`

```sql
CREATE OR REPLACE FUNCTION public.accrue_period_taxes(
  p_year int,
  p_month int,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER ...
AS $$
DECLARE
  v_config accounting_config;
  v_omzet numeric;
  v_tax numeric;
BEGIN
  SELECT * INTO v_config FROM accounting_config
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000') = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000');

  IF NOT v_config.auto_accrue_pph_monthly THEN RETURN jsonb_build_object('skipped', true); END IF;

  -- Compute omzet
  SELECT COALESCE(SUM(jel.amount), 0) INTO v_omzet
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'PENDAPATAN'
    AND jel.side = 'CREDIT'
    AND EXTRACT(YEAR FROM je.entry_date)::int = p_year
    AND EXTRACT(MONTH FROM je.entry_date)::int = p_month
    AND je.is_posted = true
    AND je.source_type NOT IN ('YEAR_END_CLOSE','TAX_ACCRUAL_PPH','TAX_ACCRUAL_PPN');

  v_tax := v_omzet * (v_config.pph_rate_pct / 100);

  IF v_tax <= 0 THEN RETURN jsonb_build_object('omzet', v_omzet, 'tax', 0); END IF;

  -- Post accrual via _post_journal_entry
  PERFORM _post_journal_entry(
    p_entry_date := make_date(p_year, p_month, 1) + INTERVAL '1 month - 1 day',
    p_source_type := 'TAX_ACCRUAL_PPH',
    p_description := 'PPh Final 0.5% accrual ' || to_char(make_date(p_year, p_month, 1), 'Mon YYYY') || ' (omzet ' || v_omzet || ')',
    p_lines := jsonb_build_array(
      jsonb_build_object('account_code', '5-3300', 'side', 'DEBIT', 'amount', v_tax),
      jsonb_build_object('account_code', '2-1210', 'side', 'CREDIT', 'amount', v_tax)
    ),
    p_tenant_id := p_tenant_id
  );

  RETURN jsonb_build_object('omzet', v_omzet, 'tax', v_tax);
END;
$$;
```

Hook ke `close_accounting_period` RPC: setelah period closed, auto-trigger `accrue_period_taxes` jika config enabled.

---

## 6. Validators (helper functions)

(unchanged from rev2 — see rev2 for `_validate_journal_entry_balanced`, `_check_period_open`, `_post_journal_entry`, `close_accounting_period`)

**Rev3 additions:** `set_opening_balance`, `close_fiscal_year`, `accrue_period_taxes` documented above.

---

## 7. Migrations (revised order)

Slot range: `20260715000001` onwards.

| # | File | Purpose |
|---|---|---|
| 1 | `20260715000001_chart_of_accounts_table.sql` | CREATE TABLE COA |
| 2 | `20260715000002_chart_of_accounts_seed.sql` | INSERT 50 standard accounts SAK EMKM (rev3 includes DP + Ikhtisar) |
| 3 | `20260715000003_coa_parent_links_update.sql` | UPDATE parent_id setelah seed |
| 4 | `20260715000004_accounting_config_table.sql` | CREATE accounting_config + seed Garindo default |
| 5 | `20260715000005_accounting_periods_table.sql` | CREATE periods + seed historical |
| 6 | `20260715000006_journal_entries_table.sql` | CREATE journal_entries + enum (rev3 expanded source types) + RLS |
| 7 | `20260715000007_journal_entry_lines_table.sql` | CREATE journal_entry_lines + RLS |
| 8 | `20260715000008_validators.sql` | Functions: _validate_journal_entry_balanced, _check_period_open |
| 9 | `20260715000009_post_journal_entry_rpc.sql` | Canonical RPC _post_journal_entry |
| 10 | `20260715000010_period_close_rpcs.sql` | close_accounting_period RPC |
| 11 | `20260715000011_views.sql` | CREATE VIEW trial_balance, general_ledger |
| 12 | `20260715000012_seed_coa_for_existing_cash_accounts.sql` | Seed per-account COA dari cash_accounts existing |
| **13** | **`20260715000013_opening_balance_rpc.sql`** | **REV3: set_opening_balance RPC + opening_balance_set guard** |
| **14** | **`20260715000014_year_end_close_rpc.sql`** | **REV3: close_fiscal_year RPC + Ikhtisar Laba Rugi flow** |
| **15** | **`20260715000015_tax_accrual_rpc.sql`** | **REV3: accrue_period_taxes RPC + hook ke close_accounting_period** |

---

## 8. Edge cases

(rev2 cases + rev3 additions)

| Case | Handling |
|---|---|
| (rev2 cases preserved) | |
| **Opening balance not set, owner mau post entry** | RPC `_post_journal_entry` cek `opening_balance_set` flag — kalau false, raise `opening_balance_required: please set opening balance first via wizard` |
| **Opening balance tidak balance (Aset ≠ Liab + Modal)** | Wizard UI show diff + auto-suggest plug ke 3-1300 Laba Ditahan. Owner confirm sebelum post. |
| **Kasir sale dengan hpp_total=0** | HPP entry skip (no Persediaan impact). Sale entry tetap post. |
| **Stock opname variance=0** | No adjustment entry posted (no-op). |
| **Year-end close di tengah periode** | Reject — must close all monthly periods first. Validate before posting closing entries. |
| **Tax accrual untuk period dengan zero omzet** | Skip accrual (zero tax). Log "no accrual posted". |
| **PKP mode enabled mid-year** | PPN entries baru aktif sejak enabled. Historical entries pre-enable tidak retroactively add PPN. Owner notification. |
| **DP receive tapi customer cancel sebelum delivery** | DP_REFUND entry; original DP_RECEIVE preserved. |
| **DP recognize tapi total = dp_amount (full pre-pay)** | Sisa_amount = 0 line skipped; only DP→Penjualan transfer. |
| **Closing entry posted, owner mau reverse** | Allow via reversal pattern, tapi flag warning karena affect annual report. Audit log critical. |

---

## 9. Testing strategy

**Unit (vitest):**
- COA seed validation (50 rows inserted, parent_id resolved)
- `_post_journal_entry` happy path + reject unbalanced + reject closed period
- `set_opening_balance` guard (block second call)
- `accrue_period_taxes` compute correct
- `close_fiscal_year` closing entries balance to 0

**Integration:**
- Apply all 15 migrations to staging Supabase → no errors
- Seed Garindo accounting_config + verify
- Run opening balance wizard → 1 OPENING_BALANCE entry with Aset = Liab + Modal
- Post 10 sample entries → verify trial_balance system-wide balanced
- Sample sale entry + auto-paired HPP entry
- Stock opname adj entry
- Year-end close → fiscal year 2025 (limited data) → closing entries posted, P&L accounts zero balance
- Tax accrual untuk Jun 2026 → PPh entry posted dengan correct amount

**E2E:** N/A Phase 0a (no UI beyond opening balance wizard which has minimal flow)

---

## 10. Risk + mitigation

(rev2 risks preserved)

**Rev3 additions:**

| Risk | Mitigation |
|---|---|
| Opening balance wizard mishandled (owner skip atau salah input) | Block backfill + business RPC until set; UI banner persistent; suggest plug ke Laba Ditahan |
| HPP recognition pair atomicity (entry 1 sukses, entry 2 gagal) | Wrap dalam transaction; rollback both kalau salah satu fail |
| Year-end close double-posted (klik 2x) | UPDATE WHERE status='OPEN' on fiscal year; second call no-op |
| Tax accrual amount mismatch (omzet definition fuzzy) | Test verbose: compute via SQL + manual cross-check; document exclusions (year-end-close entries excluded from omzet calc) |
| DP_RECEIVE recognized as penjualan (revenue) prematurely | DP goes to 2-1500 Liabilitas, not 4-XXXX. Validated via test entries. |

---

## 11. Open questions for user (revised)

**O1-O6 from rev2 preserved.** Plus rev3 additions:

**O7 (rev3). Opening balance plug strategy.** Saat saldo awal Aset ≠ Liab + Modal:
- (a) Auto-plug diff ke 3-1300 Laba Ditahan (current spec)
- (b) Owner manual specify plug account
- (c) Reject, force owner balance manually

**O8 (rev3). Year-end closing trigger.** Saat ini RPC `close_fiscal_year` callable by Owner. Apakah:
- (a) Manual klik (current)
- (b) Auto-trigger via cron tanggal 1 Januari
- (c) Reminder UI di Dashboard saat awal tahun

**O9 (rev3). Tax accrual auto vs manual.** Auto-accrue saat period close → simple tapi owner gak bisa adjust. Apakah:
- (a) Auto pada period close (current spec)
- (b) Manual klik "Generate PPh accrual"
- (c) Both — auto + button to recompute

**O10 (rev3). DP detection di kasir sale flow.** `record_kasir_sale` existing punya `dp_amount` param. Phase 0b wrap akan branch logic:
- (a) Single entry untuk full payment + DP separately tracked (clean)
- (b) Two-stage: DP_RECEIVE saat sale catat, DP_RECOGNIZE saat delivery/lunas (proper accounting)

---

## 12. Estimate (rev3: 4-5 hari)

| Komponen | Estimasi |
|---|---|
| Schema migrations (15 files) + SAK EMKM seed + validation | 1.5-2 hari |
| RPCs (_post_journal_entry, close_period, set_opening_balance, close_fiscal_year, accrue_taxes) | 1-1.5 hari |
| Views (trial_balance, general_ledger) + tests | 0.5 hari |
| Opening balance wizard UI (minimal — Owner-only screen) | 0.5-1 hari |
| Integration tests + staging apply + AI COA review | 0.5-1 hari |

Total: **4-5 hari** (naik dari 3-4 karena +3 RPC + opening balance wizard).

---

## 13. Acceptance criteria (untuk lanjut ke Phase 0b)

- [ ] 15 migrations applied to staging Supabase, no errors
- [ ] 50 COA accounts seeded with correct parent_id
- [ ] `_post_journal_entry` integration test passes
- [ ] `trial_balance` view system-wide balanced (debit_total = credit_total)
- [ ] `general_ledger` view returns running_balance correct
- [ ] Opening balance wizard tested: 1 entry posted, opening_balance_set=true, business RPC unblocked
- [ ] HPP auto-paired entry pattern tested (sample sale → 2 entries posted, both balanced)
- [ ] Stock opname adj entry test (kurang + lebih)
- [ ] Year-end closing dry-run di staging — closing entries posted, P&L accounts reset to 0
- [ ] Tax accrual untuk sample period — PPh entry posted correct
- [ ] DP receive + recognize + refund flow test
- [ ] AI-assisted COA review confirms SAK EMKM compliance + DP/closing accounts correct
- [ ] User sign-off untuk lanjut Phase 0b

---

## 14. Revision history

- **rev1 (2026-06-21 morning):** Initial draft
- **rev2 (2026-06-21 mid):** First spec write
- **rev3 (2026-06-21 evening):** Post-advisor critical gap audit. 5 critical additions:
  - **Inventory + HPP + Persediaan flow** — auto-paired entries pattern; PI receive → Persediaan; opname adjustment
  - **Opening balance wizard** — mandatory first-time setup, blocks business RPC until set, auto-plug to Laba Ditahan
  - **DP / Pendapatan Diterima Dimuka** — added `2-1500` account + DP_RECEIVE/RECOGNIZE/REFUND flow
  - **Year-end closing procedure** — `close_fiscal_year` RPC + Ikhtisar Laba Rugi (3-1900) closing entries
  - **Tax accrual auto-entries** — `accrue_period_taxes` RPC hooked ke period close (PPh Final monthly + PPN PKP)
  - 3 new migrations (#13-15) + 4 new OQ (O7-O10) + estimate revised 3-4 → 4-5 hari
- **Next:** Apply ke staging Supabase via MCP, validate integration tests, kalau green → writing-plans skill
