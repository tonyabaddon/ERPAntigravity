---
name: monthly-reconciliation-design
description: Design spec for monthly book closing & reconciliation — match sales orders to bank mutasi, supplier purchases to sell-through, with multi-bank-account support, AI-extracted PDF, guided wizard, and period lock.
metadata:
  type: project
---

# Monthly Reconciliation — Design Spec

**Date:** 2026-06-07
**Status:** Approved for implementation
**Owner:** Tony Wei
**Prototype:** `.superpowers/brainstorm/5766-1780760262/content/rekonsiliasi-v7-guided.html`

---

## 1. Problem

Garindo Jaya Panel sudah punya `KasirScreen` untuk **rekonsiliasi harian P&L** (penjualan vs pengeluaran), tapi tidak punya cara untuk **menutup buku bulanan**. Owner tidak punya jawaban yang dapat dipercaya untuk:

1. **Apakah uang dari setiap penjualan benar-benar masuk?** Customer kirim bukti transfer (foto), order dapat status `PAYMENT_VERIFIED`, tapi tidak ada cross-check terhadap mutasi rekening yang sebenarnya. Bukti palsu / transfer gagal tidak terdeteksi.
2. **Berapa cash yang sebenarnya disetor ke bank vs total kas masuk?** Owner setor bulk per hari, dan tidak ada pencatatan apakah jumlah setoran = jumlah kas masuk.
3. **Dari yang dibeli ke supplier bulan ini, sudah laku berapa persen?** Kalau supplier kasih net-30, owner perlu tahu apakah cash dari sell-through cukup menutup utang yang jatuh tempo.
4. **Order mana yang belum dibayar (piutang)?** Tidak ada satu tempat untuk melihat outstanding receivables.
tamba
Tanpa rekonsiliasi bulanan, owner bekerja pakai memori dan asumsi — tidak bisa mengambil keputusan berbasis data tentang kas, kredit supplier, atau follow-up piutang.

---

## 2. Goal & Non-Goals

### Goal

Bangun layar **Rekonsiliasi** baru yang mengeksekusi tutup buku bulanan dengan:

- **Multi-bank-account**: BCA Bisnis, BCA Pribadi, Mandiri, BRI, dst. — upload mutasi PDF per rekening, matching engine berjalan lintas rekening.
- **AI-extracted PDF**: pakai Gemini 3.5 Flash untuk parse statement PDF apapun (BCA, Mandiri, BRI) tanpa template per bank.
- **3-stream matching**: setiap order penjualan, setiap baris mutasi, dan setiap batch kas tunai harus punya pasangan sebelum buku ditutup.
- **Sell-through per PO**: untuk setiap pembelian supplier bulan ini, tampilkan per-item sudah laku berapa unit dan ke order penjualan mana saja.
- **Guided wizard 6 step** dengan Next Action coach yang adaptif — owner selalu tahu langkah selanjutnya.
- **Period lock** dengan audit trail dan PDF closing report.

### Non-Goals

- ❌ Tidak menangani PPN/tax (taxpayer perorangan, tidak kena PPN).
- ❌ Tidak menangani multi-currency (semua IDR).
- ❌ Tidak menangani installment di luar DP+Balance (1 slot DP, 1 slot Balance — tidak ada 3+ cicilan).
- ❌ Tidak menangani in-app WA reminder untuk piutang (tim follow-up manual via SOP eksternal).
- ❌ Tidak menangani multi-user concurrency (1 user mapping pada satu waktu — terima fakta ini untuk v1).
- ❌ Tidak menangani data pra-deploy (cutoff per periode; periode-periode sebelum deploy tidak masuk Rekonsiliasi).

---

## 3. Locked Decisions

| Decision | Pilihan |
|---|---|
| **Layout utama** | 3 kolom: Order Penjualan (kiri) · Mutasi Bank (tengah) · Kas Tunai (kanan) + PO sell-through di bawah |
| **Upload mutasi** | PDF, di-extract via Gemini 3.5 Flash (free tier project `garindo-gemini-free`) |
| **Matching engine** | 4 stages: extract → classify → score → special-handlers |
| **Scoring formula** | `score = amount_match × 0.50 + name_similarity × 0.30 + date_proximity × 0.20` |
| **Lane thresholds** | 🟢 Cocok ≥ 0.90 (1 candidate) · 🟡 Konfirmasi 0.75–0.89 · 🟠 Pilih 2+ candidates ≥ 0.70 · 🔴 Belum < 0.70 |
| **DP model** | `payable_slots` per order: 1 slot untuk `payment_type=FULL`, 2 slot (DP + BALANCE) untuk `payment_type=DP` |
| **Combined transfer** | `bank_line_allocations` — 1 bank line bisa di-split ke N slots |
| **Cash bulk deposit** | `cash_deposit_batches` — kumpulan kasir cash tx yang disetor bersama ke 1 mutasi `SETORAN_TUNAI` line |
| **EDC settlement** | 1 mutasi line dari merchant acquirer = N orders + auto-MDR fee expense |
| **Internal transfer** | Auto-detect OUT-IN pair antar `bank_accounts` sendiri; excluded from tally |
| **Wizard** | 6 step: Setup → Auto-cocok → Review → Kas → Piutang → Tutup |
| **Period lock** | Soft lock dengan audit trail (edits ke periode CLOSED tetap allowed tapi di-log) |
| **Piutang follow-up** | Manual SOP di luar sistem; UI hanya tampilkan list + tombol "Geser tempo" & "Write-off" |
| **Multi-user** | Tidak ada concurrency lock di v1 (1 user only) |
| **Pre-migration data** | Strict cutoff per periode; periode pertama yang muncul = bulan berikutnya setelah deploy |
| **Role permission** | `currentUser.role === 'owner'` OR `permissions.reconciliation === true` |
| **Tally check** | `sum(transfer + edc + cash + piutang) ≡ total_sales`; mismatch → badge ❌ |
| **Sales channel** | Setiap order ditandai channel asal: `WHATSAPP` (Calista AI), `TOKOPEDIA` (marketplace), `WALKIN` (kasir tatap muka), `GROSIR` (wholesale). Ditampilkan sebagai pill di kolom Order, bisa di-filter, dan di-breakdown di KPI. |

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (React)                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ RekonsiliasiScreen                                           │   │
│  │  ├ WizardSteps (6 langkah)                                   │   │
│  │  ├ NextActionBanner (coach)                                  │   │
│  │  ├ MultiAccountStatus                                        │   │
│  │  ├ TallyBar                                                  │   │
│  │  ├ MatchingGrid (3 columns)                                  │   │
│  │  │   ├ OrdersColumn  (left)                                  │   │
│  │  │   ├ MutasiColumn  (center)                                │   │
│  │  │   └ CashColumn    (right)                                 │   │
│  │  ├ MappingDrawer (overlay)                                   │   │
│  │  ├ POSellThrough                                             │   │
│  │  └ CompletionSummary                                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ Supabase RPC + Realtime
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Supabase (Postgres)                                                 │
│  ├ bank_accounts                                                    │
│  ├ bank_imports                                                     │
│  ├ bank_statement_lines                                             │
│  ├ bank_line_allocations                                            │
│  ├ payable_slots                                                    │
│  ├ cash_deposit_batches  +  cash_deposit_batch_items                │
│  ├ stock_lot_consumption  (new — for PO drill-down)                 │
│  ├ reconciliation_periods                                           │
│  ├ reconciliation_settings                                          │
│  └ reconciliation_audit_log                                         │
│                                                                      │
│  RPC functions:                                                      │
│  ├ rpc_close_period(year, month) — validate + snapshot + lock       │
│  ├ rpc_match_bank_line(line_id, slot_id, amount)                    │
│  └ rpc_unmatch_bank_line(line_id)                                   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ POST /api/recon/upload  (multipart PDF)
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Go Backend (cmd/daemon)                                             │
│  ├ internal/recon/                                                  │
│  │   ├ pdf_extractor.go     (Gemini 3.5 Flash client)              │
│  │   ├ classifier.go        (line_kind rules)                       │
│  │   ├ matcher.go           (scoring + lane assignment)             │
│  │   ├ special_handlers.go  (cash deposit, EDC, internal transfer)  │
│  │   └ closer.go            (period close: snapshot + PDF + lock)   │
│  └ internal/gemini/                                                 │
│      └ document.go          (separate Gemini client for PDFs)       │
└─────────────────────────────────────────────────────────────────────┘
```

**Boundary rationale:**
- **PDF extraction lives in Go**, not in browser, because Gemini API needs the API key kept server-side, and parsing 5-15 page PDFs is too heavy for the client.
- **Matching engine lives in Go**, called via RPC, because it touches many tables transactionally and must be deterministic + auditable.
- **UI lives in React** following existing pattern (`KasirScreen`, `OrderHistoryScreen`); reads via Supabase client, writes via RPC.

---

## 5. Data Model

### 5.1 New Tables

#### `bank_accounts` — register a bank account once, use many times

```sql
CREATE TABLE bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_code       text NOT NULL CHECK (bank_code IN ('BCA','MANDIRI','BRI','BNI','PERMATA','CIMB','OTHER')),
  account_number  text NOT NULL,
  account_label   text NOT NULL,                    -- e.g. "BCA Bisnis Operasional 8420"
  purpose         text NOT NULL CHECK (purpose IN ('OPERATIONAL','OWNER_PERSONAL','SAVINGS','OTHER')),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_code, account_number)
);
```

#### `bank_imports` — one row per PDF upload

```sql
CREATE TABLE bank_imports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id    uuid NOT NULL REFERENCES bank_accounts(id),
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  filename           text NOT NULL,
  storage_path       text NOT NULL,                  -- Supabase Storage path
  uploaded_by        uuid REFERENCES admin_users(id),
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  line_count         int NOT NULL DEFAULT 0,
  matched_count      int NOT NULL DEFAULT 0,         -- denormalized for fast progress display
  gemini_model       text NOT NULL DEFAULT 'gemini-3.5-flash',
  gemini_input_tokens int,
  gemini_output_tokens int,
  status             text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','READY','FAILED')),
  error_message      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bank_imports_account_period ON bank_imports(bank_account_id, period_start);
```

#### `bank_statement_lines` — extracted transactions, the heart of reconciliation

```sql
CREATE TABLE bank_statement_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id          uuid NOT NULL REFERENCES bank_imports(id) ON DELETE CASCADE,
  bank_account_id    uuid NOT NULL REFERENCES bank_accounts(id), -- denormalized for query speed
  txn_date           date NOT NULL,
  amount             numeric(15,2) NOT NULL CHECK (amount > 0),
  direction          text NOT NULL CHECK (direction IN ('IN','OUT')),
  description        text NOT NULL,                  -- raw description from PDF
  counterparty       text,                            -- extracted sender/recipient name
  raw_row            jsonb,                           -- original Gemini-extracted row, for audit
  line_kind          text NOT NULL DEFAULT 'UNKNOWN' CHECK (line_kind IN (
    'CUSTOMER_PAYMENT',     -- IN, matches payable_slot
    'CASH_DEPOSIT',         -- IN, matches cash_deposit_batch
    'EDC_SETTLEMENT',       -- IN, matches multiple kasir EDC txs
    'SUPPLIER_PAYMENT',     -- OUT, matches PO
    'EXPENSE',              -- OUT, kasir_transaction expense
    'BANK_FEE',             -- OUT, auto-recorded as expense
    'INTERNAL_TRANSFER',    -- OUT/IN pair across own bank_accounts
    'CUSTOMER_TOPUP',       -- IN from customer, no order yet (advance payment)
    'OWNER_DRAWING',        -- OUT to owner personal
    'OWNER_TOPUP',          -- IN from owner personal to ops
    'REFUND',               -- OUT to customer for cancelled order
    'OTHER_INCOME',         -- IN: interest, cashback, etc.
    'LEGACY_PERIOD',        -- txn_date < first eligible period start
    'UNKNOWN'
  )),
  lane               text NOT NULL DEFAULT 'GRAY' CHECK (lane IN ('GREEN','YELLOW','ORANGE','RED','GRAY')),
  match_confidence   numeric(3,2),                    -- 0.00 .. 1.00
  match_reason       text,                            -- "amount+sender exact, date +1d"
  matched_internal_pair_id uuid REFERENCES bank_statement_lines(id),  -- for INTERNAL_TRANSFER
  matched_at         timestamptz,
  matched_by         uuid REFERENCES admin_users(id), -- null = auto-matched, set = manual confirm
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bsl_account_date ON bank_statement_lines(bank_account_id, txn_date);
CREATE INDEX idx_bsl_lane ON bank_statement_lines(lane) WHERE lane IN ('YELLOW','ORANGE','RED');
CREATE INDEX idx_bsl_kind ON bank_statement_lines(line_kind);
```

#### `payable_slots` — receivable slots; bank is source of truth

```sql
CREATE TABLE payable_slots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  slot_type          text NOT NULL CHECK (slot_type IN ('FULL','DP','BALANCE')),
  expected_amount    numeric(15,2) NOT NULL,
  matched_amount     numeric(15,2) NOT NULL DEFAULT 0,  -- sum of allocations
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MATCHED','WRITTEN_OFF','EXTENDED')),
  due_date           date,                              -- nullable; FULL+DP use orders.expires_at, BALANCE owner-set
  written_off_at     timestamptz,
  written_off_reason text,
  extended_count     int NOT NULL DEFAULT 0,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ps_order ON payable_slots(order_id);
CREATE INDEX idx_ps_open ON payable_slots(status, due_date) WHERE status = 'OPEN';
```

#### `bank_line_allocations` — 1 bank line ⟷ N slots (combined transfer)

```sql
CREATE TABLE bank_line_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_line_id    uuid NOT NULL REFERENCES bank_statement_lines(id) ON DELETE CASCADE,
  slot_id         uuid NOT NULL REFERENCES payable_slots(id) ON DELETE CASCADE,
  amount          numeric(15,2) NOT NULL CHECK (amount > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_line_id, slot_id)
);
CREATE INDEX idx_bla_line ON bank_line_allocations(bank_line_id);
CREATE INDEX idx_bla_slot ON bank_line_allocations(slot_id);

-- Trigger keeps payable_slots.matched_amount + status in sync
CREATE OR REPLACE FUNCTION sync_slot_after_allocation() RETURNS trigger AS $$
BEGIN
  WITH agg AS (SELECT slot_id, COALESCE(SUM(amount),0) AS total FROM bank_line_allocations WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id) GROUP BY slot_id)
  UPDATE payable_slots ps SET
    matched_amount = COALESCE(agg.total, 0),
    status = CASE WHEN COALESCE(agg.total,0) >= ps.expected_amount THEN 'MATCHED' ELSE 'OPEN' END,
    updated_at = now()
  FROM agg WHERE ps.id = agg.slot_id;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_sync_slot_after_allocation
AFTER INSERT OR DELETE OR UPDATE ON bank_line_allocations
FOR EACH ROW EXECUTE FUNCTION sync_slot_after_allocation();
```

#### `cash_deposit_batches` — groups kasir cash txs into one bank "Setoran Tunai" line

```sql
CREATE TABLE cash_deposit_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_date       date,                            -- date deposited to bank (nullable until deposited)
  bank_line_id       uuid REFERENCES bank_statement_lines(id), -- set on match
  deposited_amount   numeric(15,2),                   -- amount on bank line; null while pending
  expected_amount    numeric(15,2) NOT NULL,          -- sum of selected kasir cash txs
  variance           numeric(15,2) NOT NULL DEFAULT 0, -- deposited - expected
  variance_reason    text CHECK (variance_reason IN ('PETTY_CASH','HITUNG_KURANG','HITUNG_LEBIH','LAINNYA')),
  variance_notes     text,
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DEPOSITED','CARRY_OVER')),
  carry_over_period  text,                            -- "2026-07" if carried to next period
  created_by         uuid REFERENCES admin_users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_deposit_batch_items (
  batch_id           uuid NOT NULL REFERENCES cash_deposit_batches(id) ON DELETE CASCADE,
  kasir_txn_id       uuid NOT NULL REFERENCES kasir_transactions(id),
  PRIMARY KEY (batch_id, kasir_txn_id)
);
```

#### `stock_lot_consumption` — track which sale consumed which lot (for PO drill-down)

```sql
CREATE TABLE stock_lot_consumption (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id          uuid NOT NULL REFERENCES stock_lots(id),
  source_type     text NOT NULL CHECK (source_type IN ('ORDER_ITEM','KASIR_ITEM')),
  order_id        uuid REFERENCES orders(id),                -- if ORDER_ITEM
  kasir_txn_id    uuid REFERENCES kasir_transactions(id),    -- if KASIR_ITEM
  sku             text NOT NULL,                             -- denormalized for query
  qty_consumed    int NOT NULL CHECK (qty_consumed > 0),
  unit_cost       numeric(15,2) NOT NULL,                    -- snapshot from lot
  consumed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_slc_lot ON stock_lot_consumption(lot_id);
CREATE INDEX idx_slc_order ON stock_lot_consumption(order_id);
CREATE INDEX idx_slc_kasir ON stock_lot_consumption(kasir_txn_id);
```

#### `reconciliation_periods` — period snapshot + lock

```sql
CREATE TABLE reconciliation_periods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year                int NOT NULL,
  month               int NOT NULL CHECK (month BETWEEN 1 AND 12),
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSING','CLOSED')),
  opened_at           timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  closed_by           uuid REFERENCES admin_users(id),
  summary             jsonb,                            -- full snapshot: tally amounts, AR aging, AP aging, variance reasons
  pdf_storage_path    text,                             -- Supabase Storage path for closing PDF
  UNIQUE (year, month)
);
```

#### `reconciliation_settings` — tunable thresholds

```sql
CREATE TABLE reconciliation_settings (
  id              text PRIMARY KEY DEFAULT 'singleton',
  threshold_green numeric(3,2) NOT NULL DEFAULT 0.90,
  threshold_yellow numeric(3,2) NOT NULL DEFAULT 0.75,
  threshold_orange numeric(3,2) NOT NULL DEFAULT 0.70,
  amount_tolerance_pct numeric(3,2) NOT NULL DEFAULT 0.05,
  date_window_back_days int NOT NULL DEFAULT 14,
  date_window_forward_days int NOT NULL DEFAULT 7,
  edc_mdr_min_pct numeric(3,4) NOT NULL DEFAULT 0.005,
  edc_mdr_max_pct numeric(3,4) NOT NULL DEFAULT 0.015,
  first_eligible_period_start date NOT NULL,         -- cutoff for pre-migration data
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

#### `reconciliation_audit_log` — append-only

```sql
CREATE TABLE reconciliation_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id    uuid REFERENCES reconciliation_periods(id),
  table_name   text NOT NULL,
  row_id       uuid NOT NULL,
  action       text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','MATCH','UNMATCH','WRITE_OFF','EXTEND')),
  before_data  jsonb,
  after_data   jsonb,
  edited_by    uuid REFERENCES admin_users(id),
  edited_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ral_period ON reconciliation_audit_log(period_id, edited_at DESC);
```

### 5.2 Modifications to Existing Tables

| Table | Change |
|---|---|
| `orders` | Add `channel sales_channel NOT NULL DEFAULT 'WHATSAPP'`. Trigger `trg_orders_create_slots` auto-creates `payable_slots` rows when status moves to `BOOKED` / `WAITING_PAYMENT` / `WAITING_DP`. |
| `purchase_orders` | Add `paid_bank_line_id uuid REFERENCES bank_statement_lines(id)`. Auto-flip to `PAID` via trigger when a `SUPPLIER_PAYMENT` line is matched. |
| `kasir_transactions` | No column change. Existing `channel` field (`walkin`/`tokopedia`/`grosir`) already covers non-WA. Cash income txs become candidates for `cash_deposit_batches`. EDC income txs become candidates for `EDC_SETTLEMENT` mutasi line. |
| `stocks` | No change. |
| `stock_lots` | No change; `qty_remaining` updates via existing FIFO logic. |

```sql
-- New enum for orders.channel (lowercase to match existing kasir_channel convention).
-- kasir_transactions.channel keeps its existing kasir_channel enum (no WA value there).
CREATE TYPE sales_channel AS ENUM ('whatsapp','tokopedia','walkin','grosir');

ALTER TABLE orders
  ADD COLUMN channel sales_channel NOT NULL DEFAULT 'whatsapp';
-- All existing orders predate this column; they're all Calista-originated → 'whatsapp' is correct default.
```

### 5.3 Order-to-Slots Migration Trigger

```sql
-- Auto-create payable_slots when an order moves into a payment-pending state.
-- Only triggers for orders created post-cutoff (see §5.4).
CREATE OR REPLACE FUNCTION create_slots_for_order() RETURNS trigger AS $$
DECLARE
  cutoff date;
BEGIN
  SELECT first_eligible_period_start INTO cutoff FROM reconciliation_settings WHERE id = 'singleton';
  IF NEW.created_at < cutoff THEN RETURN NEW; END IF;

  -- Only run when state transitions INTO a payment-collection state
  IF NEW.status IN ('WAITING_PAYMENT','WAITING_DP','BOOKED')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('WAITING_PAYMENT','WAITING_DP','BOOKED','DP_VERIFIED','PAYMENT_UPLOADED','PAYMENT_VERIFIED','COMPLETED','DP_UPLOADED'))
  THEN
    IF NEW.payment_type = 'DP' THEN
      INSERT INTO payable_slots (order_id, slot_type, expected_amount, due_date)
      VALUES (NEW.id, 'DP', NEW.dp_amount, COALESCE(NEW.booking_expires_at::date, NEW.created_at::date + INTERVAL '2 days')),
             (NEW.id, 'BALANCE', NEW.total - NEW.dp_amount, NULL);  -- owner sets BALANCE due_date manually
    ELSE
      INSERT INTO payable_slots (order_id, slot_type, expected_amount, due_date)
      VALUES (NEW.id, 'FULL', NEW.total, COALESCE(NEW.booking_expires_at::date, NEW.created_at::date + INTERVAL '2 days'));
    END IF;
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_create_slots
AFTER INSERT OR UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION create_slots_for_order();
```

### 5.4 Backfill on Deploy

Migration sets `reconciliation_settings.first_eligible_period_start` to the first day of the month **after** deploy. For example, deploy on 2026-06-07 → cutoff = 2026-07-01.

No backfill of pre-cutoff orders. They keep their existing `PAYMENT_VERIFIED` status but are invisible to the Rekonsiliasi screen.

For orders created post-cutoff, a one-time migration creates the corresponding `payable_slots` based on `payment_type`.

---

## 6. PDF Extraction (Gemini 3.5 Flash)

### 6.1 Why Gemini

Indonesian bank e-statements are PDF, with varying layouts per bank and per period:
- BCA Bisnis: tabular with `Tanggal | Keterangan | Cabang | Mutasi | Saldo`
- Mandiri MGS: different column order, account number redacted
- BRI Pengusaha: combines header + body + footer in 1 PDF

Rule-based parsers (regex per template) break whenever the bank updates layout — happened 3× to BCA in 2025. AI-based extraction handles layout variance robustly.

**Model choice**: `gemini-3.5-flash` (more accurate than `flash-lite` for tabular documents). Free tier: 5 RPM, 250 RPD — sufficient for monthly upload cadence (3-6 PDFs/month total).

**API key**: shared `garindo-gemini-free` project key (free tier, no billing). Same project as Calista daemon, but uses different model so rate-limit buckets don't compete.

### 6.2 Client (Go)

New file: `backend-go/internal/gemini/document.go`

```go
package gemini

type DocumentClient struct {
    apiKey string
    model  *genai.GenerativeModel  // gemini-3.5-flash
}

func NewDocumentClient(ctx context.Context, apiKey string) (*DocumentClient, error) {
    client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
    if err != nil { return nil, err }
    model := client.GenerativeModel("gemini-3.5-flash")
    model.ResponseMIMEType = "application/json"
    return &DocumentClient{apiKey: apiKey, model: model}, nil
}

type ExtractedLine struct {
    TxnDate      string  `json:"txn_date"`        // YYYY-MM-DD
    Description  string  `json:"description"`
    Counterparty string  `json:"counterparty"`    // may be empty
    Amount       float64 `json:"amount"`          // always positive
    Direction    string  `json:"direction"`       // "IN" | "OUT"
    Balance      float64 `json:"balance"`         // running balance
}

func (c *DocumentClient) ExtractMutasi(ctx context.Context, pdfBytes []byte, bankCode string) ([]ExtractedLine, error) {
    prompt := fmt.Sprintf(`
Ekstrak SEMUA transaksi dari laporan mutasi rekening %s ini.
Setiap transaksi jadikan 1 object di array JSON dengan field:
  txn_date      (string YYYY-MM-DD)
  description   (string, deskripsi mentah dari statement)
  counterparty  (string, nama pengirim/penerima — kosong jika tidak ada)
  amount        (number positif tanpa pemisah ribuan)
  direction     ("IN" untuk transaksi MASUK / kredit, "OUT" untuk KELUAR / debit)
  balance       (number saldo setelah transaksi)

Aturan:
- HANYA baris transaksi, jangan masukkan header/footer/saldo awal.
- Tanggal harus dikonversi ke ISO YYYY-MM-DD.
- Untuk SETORAN TUNAI atau CDM, isi description apa adanya.
- Untuk EDC SETTLEMENT, isi description apa adanya.
- Jangan tambah field lain. Output JSON array murni, no markdown wrapper.
`, bankCode)

    resp, err := c.model.GenerateContent(ctx,
        genai.Blob{MIMEType: "application/pdf", Data: pdfBytes},
        genai.Text(prompt),
    )
    if err != nil { return nil, err }

    var lines []ExtractedLine
    if err := json.Unmarshal([]byte(extractText(resp)), &lines); err != nil {
        return nil, fmt.Errorf("parse Gemini output: %w", err)
    }
    return lines, nil
}
```

### 6.3 Pipeline

```
[User uploads PDF]
        │
        ▼
POST /api/recon/upload  (multipart: file + bank_account_id + period)
        │
        ▼
1. Insert bank_imports row (status=PROCESSING)
2. Save PDF to Supabase Storage: chat-media/recon/{import_id}.pdf
3. documentClient.ExtractMutasi(pdfBytes, bankCode) — sync, blocks request
4. For each ExtractedLine:
     - Parse txn_date as Asia/Jakarta (WIB) since bank PDFs report local time
     - Dedup hash: SHA256(bank_account_id, txn_date, amount, description, balance) —
       skip if existing bank_statement_lines row has same hash (handles re-upload / overlap)
     - Insert bank_statement_lines row (line_kind=UNKNOWN, lane=GRAY)
5. Trigger matching engine (synchronous, see §7)
6. Update bank_imports: status=READY, line_count, matched_count, gemini_*_tokens
        │
        ▼
Return { import_id, line_count, matched_count, breakdown }
```

**Timezone**: all `txn_date` values are interpreted as Asia/Jakarta (WIB, UTC+7), consistent with `payment_lifecycle` and `wib_timezone_fix` specs. Statement PDFs use local time; the extractor passes dates as `YYYY-MM-DD` (date-only, no TZ).

**Dedup**: protects against owner uploading the same week twice or overlapping monthly statements. Hash is stored in a future `bank_statement_lines.dedup_hash` column (UNIQUE per bank_account_id):

```sql
ALTER TABLE bank_statement_lines
  ADD COLUMN dedup_hash text,
  ADD CONSTRAINT uq_bsl_dedup UNIQUE (bank_account_id, dedup_hash);
```

### 6.4 Failure modes

- **PDF too big** (>20MB): reject upload with friendly error.
- **Gemini timeout** (>30s): bank_imports.status=FAILED, owner re-uploads.
- **JSON parse fails**: store raw output in `bank_imports.error_message`, status=FAILED.
- **Zero lines extracted**: still mark READY but warn owner via toast.

---

## 7. Matching Engine

Pipeline runs synchronously after PDF extraction (typical: 200 lines × ~100 open slots = 5-30 seconds).

### 7.1 Stage 1 — Classify `line_kind`

For each `bank_statement_lines` row with `line_kind = UNKNOWN`, apply rules in order:

```go
func ClassifyLine(line *BankStatementLine, accounts []BankAccount, suppliers []Supplier) string {
    d := strings.ToUpper(line.Description)

    // 1. Cash deposit
    if matchAny(d, []string{"SETORAN TUNAI", "CDM", "ATM SETORAN", "AUTO TELLER MACH"}) {
        return "CASH_DEPOSIT"
    }
    // 2. EDC settlement
    if matchAny(d, []string{"SETTLEMENT EDC", "SETLM EDC", "MERCHANT BCA"}) {
        return "EDC_SETTLEMENT"
    }
    // 3. Bank fee
    if matchAny(d, []string{"BIAYA ADMIN", "BIAYA TRF", "ADM E-BANKING", "BUNGA"}) {
        if matchAny(d, []string{"BUNGA"}) { return "OTHER_INCOME" }
        return "BANK_FEE"
    }
    // 4. Internal transfer
    for _, acct := range accounts {
        if strings.Contains(d, acct.AccountNumber) {
            return "INTERNAL_TRANSFER" // marked pending; pair-up in stage 4c
        }
    }
    // 5. Supplier payment (OUT only, fuzzy match supplier name)
    if line.Direction == "OUT" {
        for _, sup := range suppliers {
            if NameSimilarity(line.Counterparty, sup.Name) >= 0.85 {
                return "SUPPLIER_PAYMENT"
            }
        }
        return "EXPENSE" // default OUT
    }
    // 6. Default IN → customer payment candidate
    return "CUSTOMER_PAYMENT"
}
```

### 7.2 Stage 2 — Generate candidates

For each `CUSTOMER_PAYMENT` line, query `payable_slots`:

```sql
SELECT ps.*, o.customer_name, o.payment_type
FROM payable_slots ps
JOIN orders o ON o.id = ps.order_id
WHERE ps.status = 'OPEN'
  AND ps.expected_amount BETWEEN
        :line_amount * (1 - :amount_tolerance_pct)
        AND :line_amount * (1 + :amount_tolerance_pct)
  AND o.created_at BETWEEN
        :line_date - INTERVAL ':back days'
        AND :line_date + INTERVAL ':forward days'
```

For each `SUPPLIER_PAYMENT` line, query open POs by supplier_id + amount ±tolerance + due_date ±window.

### 7.3 Stage 3 — Score & assign lane

For each candidate compute:

```
amount_match    = 1.00 if |line.amount - slot.expected_amount| <= 100
                = 0.85 if pct_diff <= 1% (round-off)
                = 0.50 if pct_diff <= 3% (fee transfer antar bank)
                = 0.00 otherwise

name_similarity = Levenshtein-based ratio on normalized names:
                  - uppercase
                  - strip prefixes: "PT", "CV", "BPK", "IBU", "MR", "MRS"
                  - strip suffixes: "TBK"
                  - collapse multi-space
                  Returns 0.0 .. 1.0

date_proximity  = 1.00 same day
                = 0.70 ±1 day
                = 0.50 ±3 days
                = 0.20 ±7 days
                = 0.00 otherwise

score = amount_match * 0.50 + name_similarity * 0.30 + date_proximity * 0.20
```

Lane assignment:

| Condition | Lane | Action |
|---|---|---|
| best ≥ 0.90 AND only 1 candidate ≥ 0.70 | GREEN | Auto-allocate (insert `bank_line_allocations` row, slot trigger handles status) |
| best 0.75–0.89 AND only 1 candidate ≥ 0.70 | YELLOW | Save best candidate in `match_reason`, owner confirms in drawer |
| ≥ 2 candidates ≥ 0.70 | ORANGE | Save top 3 in `match_reason`, owner picks in drawer |
| best < 0.70 OR 0 candidates | RED | Owner manually maps in drawer |

### 7.4 Stage 4 — Special handlers (override scoring)

#### 4a. Cash deposit
For each `CASH_DEPOSIT` line:
1. Query `cash_deposit_batches` with `status='PENDING'`, `expected_amount BETWEEN line.amount * 0.97 AND line.amount * 1.03`, deposit_date within ±2 days.
2. If exactly 1 candidate batch → auto-link: set `batch.bank_line_id = line.id`, `batch.deposited_amount = line.amount`, `batch.deposit_date = line.txn_date`, `batch.variance = line.amount - batch.expected_amount`. Set `batch.status = 'DEPOSITED'`.
3. If variance > 0 (deposited more) or < 0 (deposited less) → owner must set `variance_reason` before closing book.

#### 4b. EDC settlement
For each `EDC_SETTLEMENT` line:
1. Find all `kasir_transactions` of `payment_method='EDC'` on the same date.
2. Sum gross = Σ kasir.total. Compute MDR = gross - line.amount.
3. Validate: `0.005 ≤ MDR/gross ≤ 0.015` (typical Indonesian debit MDR range).
4. If valid:
   - Set `line.lane='GREEN'`.
   - Create kasir_transactions expense row: `type='expense'`, `expense_category='MDR EDC'` (new enum value added in §10).
   - Store gross + MDR breakdown in `line.match_reason`.
5. If MDR out of range: lane=RED, owner classifies manually.

#### 4c. Internal transfer
After Stage 1 tags lines as `INTERNAL_TRANSFER` (only OUT side initially):
1. For each OUT line tagged INTERNAL_TRANSFER, search for IN line where:
   - IN line's `bank_account_id` matches the account number found in OUT line's description
   - amount equal (rounded to 100)
   - txn_date within ±2 days
2. If found, set `out.matched_internal_pair_id = in.id` and `in.matched_internal_pair_id = out.id`, set both lanes to GREEN. Mark both `line_kind='INTERNAL_TRANSFER'`. Excluded from tally.
3. If unpaired OUT: lane=YELLOW, owner confirms (might be transfer to spouse/relative — classify as OWNER_DRAWING).

**Known limitation**: detection relies on the OUT-side description containing the destination account number. BCA Bisnis statements include this; other banks may not. Fallback: if bank doesn't print the account number, owner manually classifies via the drawer's "Klasifikasi lain" footer button.

#### 4d. Legacy period
For any line with `txn_date < settings.first_eligible_period_start`: `line_kind='LEGACY_PERIOD'`, lane=GRAY. Excluded from current-period UI but kept for audit.

---

## 8. UI Specification

### 8.1 Sidebar

Add new menu item between `Pembelian` and `Laporan`:
```
{ id: 'rekonsiliasi', label: 'Rekonsiliasi', icon: Receipt, description: 'Tutup Buku Bulanan', permKey: 'reconciliation' }
```

Show only when `currentUser.role === 'owner'` OR `currentUser.permissions.reconciliation === true`.

### 8.2 Page structure (top to bottom)

1. **Header strip** — period selector + Upload PDF + Kelola Rekening + Tutup Buku button (disabled until 100%)
2. **Wizard 6 steps** — Setup / Auto-Cocok / Review / Kas / Piutang / Tutup with current step highlighted
3. **Next Action banner** — coach that adapts to state ("Review 26 baris", "Verifikasi 2 batch", "✓ Semua siap")
4. **Multi-Account status** — 4 cards per account showing upload status + saldo
5. **Tally bar** — 4-segment bar by payment method (Transfer / EDC / Tunai / Piutang) with live amounts; ✓ TALLY / ❌ Selisih badge. Below: small "Per Channel" strip — 4 KPI mini cards (📱 WhatsApp Rp X · N order, 🛍️ Tokopedia Rp Y · N, 🏪 Walk-in Rp Z · N, 🏭 Grosir Rp W · N) for the breakdown.
6. **3-column matching grid**
   - **Order Penjualan (LEFT)**: union view of `orders` (WHATSAPP channel) + `kasir_transactions` (WALKIN/TOKOPEDIA/GROSIR channels). Each row shows: customer name + **channel pill** (📱 WA / 🛍️ Tokopedia / 🏪 Walk-in / 🏭 Grosir, colors match existing `KasirScreen.ChannelPill`) + payment-method pill + slot status + link badges. Filter chips: Semua / 📱 WA / 🛍️ Tokopedia / 🏪 Walk-in / 🏭 Grosir / 🏦 Transfer / 💳 EDC / 💵 Tunai / ⏳ Piutang (channel filters and payment-method filters work independently). Progress meter in header.
   - **Mutasi Bank (CENTER)**: bank lines with account pill + lane badge. Account-filter chips: Semua / per-account. Progress meter in header.
   - **Kas Tunai (RIGHT)**: cash_deposit_batches with link badges or pending/variance status. Progress meter.
7. **Pembelian Supplier section** — PO list with progress bar; click ▶ to expand drill-down showing per-SKU sold/remaining + sales order IDs as clickable pills
8. **Completion summary** — Order% · Mutasi% · Kas% · Total% as small KPI strip at bottom

### 8.3 Mapping Drawer

A right-side panel (460px wide) overlay triggered by any "Cari pasangan →" button. Contents:

- **Header**: source identification + close button. Header background red (for unmatched source) or amber (for confirmation).
- **Tabs**: candidate type filter — `📋 Order Penjualan` / `💵 Setoran Kas` / `📝 Custom`. Each tab shows count.
- **Search input**: filter candidates by name (live).
- **Candidate list**: top candidate highlighted green (`best`), others with neutral border. Each shows:
  - Order ID or batch ID
  - Customer name + payment method pill
  - Slot type or batch summary
  - Score + breakdown text ("nama 87% · jumlah ✓ · tgl +1d")
  - Score progress bar
  - Amount + "Pilih" button
- **Footer actions**:
  - 🔀 **Split** — open split-mode UI to allocate one bank line across N slots
  - 📝 **Klasifikasi lain** — open classification modal with 5 categories: CUSTOMER_TOPUP, OWNER_DRAWING, OWNER_TOPUP, REFUND, OTHER_INCOME
  - ⏭️ **Lewati dulu** — leaves line as RED, blocks period close

### 8.4 Split Mode

When owner clicks 🔀 Split on a bank line:
- Drawer expands to show "Pecah Rp X ke beberapa target"
- Owner adds N rows, each with: target slot picker + amount input
- Sum must equal source line amount (validation real-time, "Sisa: Rp Y" displayed)
- Click "Terapkan split" → creates N `bank_line_allocations` rows, line lane → GREEN

### 8.5 Classification Modal

Triggered from 📝 Klasifikasi lain footer button. Modal with 5 options:

```
┌─────────────────────────────────────────┐
│ Klasifikasi Bank Line                   │
│ M5 · TRSF MASUK · HENDRA K · Rp 4,2jt   │
│                                         │
│ ⚪ Customer Topup (advance payment)     │
│    Customer transfer duluan, order      │
│    belum dibuat. Masuk ke saldo deposit.│
│                                         │
│ ⚪ Owner Topup                          │
│    Pemilik kirim modal kerja ke ops.    │
│                                         │
│ ⚪ Owner Drawing                        │
│    Pemilik tarik uang untuk pribadi.    │
│                                         │
│ ⚪ Pendapatan Lain                      │
│    Bunga, cashback, dll.                │
│                                         │
│ ⚪ Pelunasan Order Lama (LEGACY)        │
│    Pelunasan order dari periode         │
│    sebelum cutoff Rekonsiliasi.         │
│                                         │
│ Notes (opsional): [_______________]     │
│                                         │
│             [Batal]    [Simpan]         │
└─────────────────────────────────────────┘
```

For OWNER_DRAWING / OWNER_TOPUP / REFUND, the classified line still adjusts cash position but does NOT enter the sales tally (since it's not revenue).

### 8.6 Wizard Step Detail

| Step | UI Section | Action |
|---|---|---|
| 1 SETUP | Multi-Account status panel | Add `bank_accounts` + click "Upload PDF" per account |
| 2 AUTO-COCOK | Toast + progress bar during PDF processing | Read-only — owner watches engine finish |
| 3 REVIEW | Mutasi column filtered to lanes YELLOW/ORANGE/RED | Confirm 🟡, pick 🟠, map 🔴 via drawer |
| 4 KAS | Cash column | Confirm each batch deposited / mark CARRY_OVER / fill variance_reason |
| 5 PIUTANG | Orders column filtered to "Piutang" | View list; click order to drill in; available actions: 📅 Geser tempo (slot → status=`EXTENDED`, new due_date in future period — does NOT block current close), ✗ Write-off (slot → status=`WRITTEN_OFF` with reason, auto-creates kasir expense `Kerugian Piutang`) |
| 6 TUTUP | "Tutup Buku" button | Runs `rpc_close_period` |

### 8.7 PO Sell-Through Drill-Down

For each PO row:
- Click ▶ header expands detail panel
- For each SKU in PO: show `qty_sold / qty_received (qty_remaining sisa)`
- Show clickable pills per sale: `#order_id · qty · date` (click → toast or navigate to order)
- Query backing: `SELECT slc.order_id, slc.qty_consumed, o.created_at FROM stock_lot_consumption slc JOIN stock_lots l ON l.id = slc.lot_id JOIN orders o ON o.id = slc.order_id WHERE l.po_id = ?`
- Bottom: projection vs payable ("Aman" or "Kurang Rp Xjt")

---

## 9. Period Close Workflow

### 9.1 Validation (RPC: `rpc_close_period(year, month)`)

Period can be closed when ALL of:
1. All `bank_statement_lines` for the period have lane ≠ RED (or `line_kind` set to a classified non-customer-payment category).
2. All `cash_deposit_batches` for the period have status in (`DEPOSITED`, `CARRY_OVER`) — none `PENDING`.
3. All `payable_slots` for orders in the period have status ≠ `OPEN` (matched, written off, or extended to future period).
4. Tally checks: `Σ(transfer_matched) + Σ(edc_matched) + Σ(cash_deposited) + Σ(piutang_extended) ≡ Σ(orders.total)` within Rp 100 tolerance.

If any check fails → RPC returns `{ ok: false, reason: '...' }` and owner sees error toast with specific item that blocks.

### 9.2 Snapshot & PDF generation

On successful validation:
1. Build `summary` jsonb with:
   - Tally amounts (transfer / EDC / cash / piutang) + counts
   - AR aging breakdown (DP outstanding, balance outstanding, written-off)
   - AP aging (PO unpaid + days to due)
   - Sell-through ratio per PO
   - Variance reasons (cash batches)
   - Internal transfers excluded
2. Insert `reconciliation_periods` row with status=`CLOSED`, snapshot.
3. Generate PDF via existing `KasirInvoiceModal`-style approach (extend invoice template). Save to Supabase Storage: `chat-media/closing/{year}-{month}.pdf`.
4. Update `pdf_storage_path`.

### 9.3 Soft lock

Lock model: edits to data inside a CLOSED period are allowed but each edit creates a `reconciliation_audit_log` row. UI shows a yellow banner on closed period view: "⚠️ Periode ini sudah ditutup. Edit di-log untuk audit." This avoids the operational pain of true RLS lock when owner discovers a mistake.

The UI presents closed periods with all the same controls as open ones (drawer, classify, write-off), but every action goes through the audit_log capture. The closing PDF is regenerated on demand (button "Generate ulang PDF") if `summary` changed after edits — the original PDF stays in storage as `closing-{year}-{month}-v1.pdf`, the regenerated one as `-v2.pdf`, etc.

---

## 10. Minor schema additions to support reconciliation

### kasir_expense_category — add `MDR_EDC`

```sql
ALTER TYPE kasir_expense_category ADD VALUE IF NOT EXISTS 'MDR EDC';
```

Used by EDC settlement handler to auto-record the fee as an expense.

---

## 11. Permissions

```typescript
// src/types.ts — extend PermissionSet
interface PermissionSet {
  // ... existing ...
  reconciliation?: boolean;  // owner-only by default, can be granted to assigned admin
}
```

Sidebar visibility, route access, and "Tutup Buku" RPC are all gated by `role === 'owner' || permissions.reconciliation === true`.

---

## 12. Pre-Migration Cutoff

On first deploy, migration sets `reconciliation_settings.first_eligible_period_start` to the first day of the month **after deploy date**.

- Periode dropdown only shows periods >= cutoff.
- Orders with `created_at < cutoff` do NOT have `payable_slots` created (migration trigger skips them).
- Bank statement lines with `txn_date < cutoff` get `line_kind = LEGACY_PERIOD`, lane = GRAY, excluded from tally and any UI sections.
- If owner uploads a PDF that spans cutoff (e.g., PDF covers 28 May – 8 July), only lines on/after cutoff get classified.

---

## 13. Testing Strategy

### Backend unit tests (Go)

- `internal/recon/classifier_test.go`: 15+ cases covering each `line_kind` (BCA cash deposit pattern, EDC settlement pattern, internal transfer with account number in description, fee, customer payment, supplier payment fuzzy match, etc.)
- `internal/recon/matcher_test.go`: scoring formula edge cases (exact match, name-only match, date-only match, ambiguous scores)
- `internal/recon/special_handlers_test.go`:
  - cash deposit: single batch, variance positive/negative, no candidates
  - EDC: valid MDR range, MDR too high (rejected), zero EDC orders that day (rejected)
  - internal transfer: paired, unpaired OUT, multiple candidates
- `internal/recon/closer_test.go`: validation blocks (open RED line, pending batch, open slot, tally mismatch)

### Backend integration tests

- End-to-end: upload sample BCA PDF (synthesized fixture) → assert N lines extracted, M auto-matched, K manually pending → confirm via RPC → close period → assert PDF + locked.

### Frontend tests

- Component test: Tally bar reactive to mapping action (uses mock state).
- Drawer interaction: open from mutasi RED, pick candidate, assert source + target rows flip to matched.
- Wizard progression: simulate state where step 3 done → assert Next Action banner reflects step 4 prompt.

### Manual QA checklist (before merging)

- Upload real-life BCA Bisnis PDF, validate >90% auto-match rate
- Upload Mandiri PDF for second account, validate same engine works
- Combined transfer scenario: customer CV Berkah Jaya pays Rp 10,5jt for two orders → split flow → both slots MATCHED
- DP order full lifecycle: WA AI order created → bukti uploaded → DP slot matched from bank line → 30 days later balance bank line matched → both slots MATCHED → order COMPLETED
- Edit closed period → audit log row created
- Try close book with 1 RED line → blocked with specific reason

---

## 14. Phase 2 Deferred Items

Not in scope for v1; surfaced as roadmap:

- Cash flow forecast widget ("minggu depan butuh Rp X")
- Bulk confirm ("setujui semua saran skor ≥ 0.85")
- Mobile responsive layout (current is desktop-only)
- Free-text search di mutasi column
- Audit history viewer per row (currently log exists but no UI)
- Undo last mapping action (currently use "Lepas mapping")
- Email closing PDF ke accountant
- Period-over-period comparison
- Onboarding tour
- Realtime notifications (new bank line auto-detected via aggregator)
- Multi-user concurrency lock
- Installment beyond DP+BALANCE (3+ payment chunks per order)
- Refund full lifecycle (currently classified manually only)

---

## 15. Notes for plan phase

- **Storage estimate**: Supabase Storage for PDF + closing PDFs ≈ 50KB × 12 imports/year × 4 accounts ≈ 2.4MB/year — negligible.
- **PDF template**: extend existing `KasirInvoiceModal` and `Invoice` print templates. Single page summary + appendix per section (tally, AR, AP, variances).
- **Re-run match button**: deferred to Phase 2. v1 owner re-uploads PDF or contacts dev if engine needs re-run.
