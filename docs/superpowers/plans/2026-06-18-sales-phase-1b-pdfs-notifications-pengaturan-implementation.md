# Sales Phase 1B + 1A Leftovers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1B critical path (PDFs, WA notifications, Pengaturan UI, stock reservation) + remaining Phase 1A items (EditOrderModal, settings seed) so the Daftar Pesanan funnel is fully production-usable for daily ops at Sinar Elektrik / Garindo Jaya Panel.

**Architecture:** Continue the pattern from Phase 1A — DB RPCs for state-machine atomicity, lib/sales for typed wrappers, React components under `src/components/sales/`. Add PDF generation via existing jsPDF + jspdf-autotable (already in package.json from kasir invoice work). WA notifications go through existing Calista WhatsApp integration. Pengaturan tables for store identity used by all PDFs.

**Tech Stack:** React + TypeScript (Vite), Tailwind CSS, Supabase (Postgres + Storage + Realtime), Vitest, jsPDF v2.5.2 + jspdf-autotable v3.8.4 (existing), Calista WA backend (existing).

**Scope shipped:**
1. Pengaturan UI: Identitas Toko (nama, logo, alamat, telp), Jam Operasional, Rekening Bank
2. 5 PDF generators: Sales Order, Invoice DP, Invoice Lunas, Invoice Pelunasan (CP/RP variant), Surat Jalan
3. WA notification system: 10 templates seeded + wired to stage transitions
4. Stock reservation atomic RPC: deduct on 3a entry (komponen flow), restore on cancel
5. EditOrderModal: admin edits ongkir/alamat/items pre-payment with audit reason
6. Catatan Pembatalan PDF for Stage 6 archive

**Out of scope (deferred to Phase 1C+):**
- InputBaruWizard rewrite (uses existing PenjualanBaruScreen)
- Calista AI parser for customer "sudah" replies
- Stage 1 Bertanya conversation row UI (Sales Inbox already separate)
- Owner override modal (placeholder toast OK for now)
- Dot matrix print path (modern PDF works on most printers)
- Stuck-order detection cron (manual review for now)
- Backend Go service layer (DB RPCs sufficient)
- Modification audit log table separate from `audit_log`

**Reference docs:**
- Parent spec: in-memory (was brainstormed but never written to file — design in `/tmp/fulfillment-mockup.html` Section 8 PDFs)
- CP/RP extension: `docs/superpowers/specs/2026-06-16-rakit-custom-panel-funnel-integration-design.md` Section 9 (PDF layout) + Section 8.7 (WA templates)
- Phase 1A shipped: `docs/superpowers/plans/2026-06-18-sales-landing-and-daftar-pesanan-2i-implementation.md`

---

## File Structure

**NEW backend (Supabase migrations):**
- `supabase/migrations/20260625000010_pengaturan_tables.sql` — `store_settings` (single-row identitas+alamat), `operating_hours` (7-day grid), `bank_accounts` (multi-row); RLS for owner-only write, authenticated read
- `supabase/migrations/20260625000011_reserve_stock_rpc.sql` — atomic `reserve_stock(p_order_id)` + `restore_stock(p_order_id)` RPCs
- `supabase/migrations/20260625000012_notification_templates_table.sql` — `notification_templates` table + seed 10 stage-transition templates
- `supabase/migrations/20260625000013_send_wa_notification_helper.sql` — `queue_wa_notification(p_order_id, p_template_key)` enqueue function (writes to existing `wa_outbox` or calls Calista endpoint via pg_net)
- `supabase/migrations/20260625000014_invoice_numbering_counters.sql` — `invoice_counters` table + `next_invoice_number(p_type)` RPC for SO/INV-DP/INV-PEL/INV-LUNAS/SJ/CANCEL numbering
- `supabase/migrations/20260625000015_transition_rpc_v3_with_stock_and_wa.sql` — replace `transition_order_stage` to call `reserve_stock` on 3a entry, `restore_stock` on cancel-to-6a, `queue_wa_notification` on appropriate transitions

**NEW lib/pengaturan modules:**
- `src/lib/pengaturan/types.ts` — `StoreSettings`, `OperatingHours`, `BankAccount` interfaces
- `src/lib/pengaturan/queries.ts` — fetch + subscribe for settings/hours/banks
- `src/lib/pengaturan/mutations.ts` — upsert helpers

**NEW lib/sales/pdf modules:**
- `src/lib/sales/pdf/common.ts` — shared header/footer/bank-block render helpers using StoreSettings
- `src/lib/sales/pdf/salesOrderPdf.ts` — Sales Order PDF (SO/YYYY/NNNNN)
- `src/lib/sales/pdf/invoiceDpPdf.ts` — Invoice DP PDF (INV-DP/YYYY/NNNNN)
- `src/lib/sales/pdf/invoiceLunasPdf.ts` — Invoice Lunas (full payment from start) — variant of Invoice DP without DP/Sisa block
- `src/lib/sales/pdf/invoicePelunasanPdf.ts` — Invoice Pelunasan (sisa after DP, with breakdown table)
- `src/lib/sales/pdf/suratJalanPdf.ts` — Surat Jalan delivery note with TTD block
- `src/lib/sales/pdf/catatanPembatalanPdf.ts` — Catatan Pembatalan for Stage 6 archive
- `src/lib/sales/pdf/invoiceNumber.ts` — wraps `next_invoice_number` RPC

**NEW components:**
- `src/components/pengaturan/IdentitasTokoCard.tsx` — nama, logo upload, alamat, telp
- `src/components/pengaturan/JamOperasionalCard.tsx` — 7-day time pickers + libur khusus
- `src/components/pengaturan/RekeningBankCard.tsx` — list/add/edit/delete bank rows
- `src/components/sales/EditOrderModal.tsx` — pre-payment edit modal with audit reason
- `src/components/sales/PdfPreviewModal.tsx` — preview generated PDF in iframe before print/download

**MODIFIED files:**
- `src/components/PengaturanScreen.tsx` — add 3 new cards above existing sections
- `src/components/sales/DaftarPesananScreen.tsx` — add Edit button + PDF download buttons per action panel
- `src/components/sales/ActionPanel.tsx` — add PDF buttons (SO download, Invoice download)
- `src/components/sales/SalesLandingScreen.tsx` — add stuck-order subtle indicator if any > 7 days
- `src/lib/sales/queries.ts` — extend rowToOrder to include settings reference

**NEW tests:**
- `src/lib/pengaturan/__tests__/queries.test.ts`
- `src/lib/pengaturan/__tests__/mutations.test.ts`
- `src/lib/sales/pdf/__tests__/common.test.ts`
- `src/lib/sales/pdf/__tests__/invoiceNumber.test.ts`
- One small smoke test per PDF generator (verifies non-empty blob output)

---

## Pre-flight Tasks

### Task 0: Worktree verification

**Files:** N/A

- [ ] **Step 1: Verify worktree + branch**

Run:
```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity/.claude/worktrees/sales-phase-1b
git status
git branch --show-current   # should print feat/sales-phase-1b
git log --oneline -1         # should be 3ac55ec (Phase 1A merge)
```

- [ ] **Step 2: Baseline test run**

Run: `npm test -- --run`
Expected: 79+ tests, all passing (from Phase 1A baseline)

- [ ] **Step 3: Verify Supabase migration slot range**

Run: `ls supabase/migrations/2026062500001*.sql | tail -1`
Expected: `20260625000007_transition_rpc_use_auth_uid.sql` (from Phase 1A); claim next slots `20260625000010+` (gap of 3 leaves room for hotfixes if needed)

---

## Milestone A: Pengaturan Tables + RPCs

### Task A1: Migration — pengaturan tables

**Files:**
- Create: `supabase/migrations/20260625000010_pengaturan_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- store_settings: single-row identitas toko (nama, alamat, logo, telp, npwp, etc.)
CREATE TABLE IF NOT EXISTS store_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nama_toko text NOT NULL DEFAULT 'Sinar Elektrik',
  nama_legal text NULL,
  tagline text NULL,
  alamat_lengkap text NOT NULL DEFAULT '',
  kota text NOT NULL DEFAULT '',
  telp_wa text NOT NULL DEFAULT '',
  logo_url text NULL,
  google_maps_url text NULL,
  npwp text NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  updated_by uuid NULL REFERENCES auth.users(id)
);

-- Singleton row seeded if not present
INSERT INTO store_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- operating_hours: 7-day grid
CREATE TABLE IF NOT EXISTS operating_hours (
  day_of_week smallint PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Senin, 6=Minggu
  is_open boolean NOT NULL DEFAULT true,
  open_time time NULL,
  close_time time NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Seed 7 rows with defaults (Mon-Sat open 08-17, Sun closed)
INSERT INTO operating_hours(day_of_week, is_open, open_time, close_time)
VALUES
  (0, true, '08:00', '17:00'), (1, true, '08:00', '17:00'),
  (2, true, '08:00', '17:00'), (3, true, '08:00', '17:00'),
  (4, true, '08:00', '17:00'), (5, true, '08:00', '15:00'),
  (6, false, NULL, NULL)
ON CONFLICT (day_of_week) DO NOTHING;

-- bank_accounts: multi-row, ordered by sort_order
CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_holder text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_active_order ON bank_accounts(is_active, sort_order);

-- RLS: authenticated read for all, owner-only write (matches existing pattern from admin_users.role)
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read store_settings" ON store_settings;
CREATE POLICY "Authenticated read store_settings" ON store_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner write store_settings" ON store_settings;
CREATE POLICY "Owner write store_settings" ON store_settings FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND role = 'Owner')
);

DROP POLICY IF EXISTS "Authenticated read operating_hours" ON operating_hours;
CREATE POLICY "Authenticated read operating_hours" ON operating_hours FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner write operating_hours" ON operating_hours;
CREATE POLICY "Owner write operating_hours" ON operating_hours FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND role = 'Owner')
);

DROP POLICY IF EXISTS "Authenticated read bank_accounts" ON bank_accounts;
CREATE POLICY "Authenticated read bank_accounts" ON bank_accounts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner all bank_accounts" ON bank_accounts;
CREATE POLICY "Owner all bank_accounts" ON bank_accounts FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND role = 'Owner')
);

COMMENT ON TABLE store_settings IS 'Single-row store identity used by all PDFs + WA signature';
COMMENT ON TABLE operating_hours IS '7-day open/close grid; 0=Senin per Indonesian convention';
COMMENT ON TABLE bank_accounts IS 'Bank accounts rendered in invoices for customer transfers';
```

- [ ] **Step 2: Apply locally** (skip if Docker not running; will apply via apply-pending-migrations.sh)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260625000010_pengaturan_tables.sql
git commit -m "feat(pengaturan): store_settings + operating_hours + bank_accounts tables with RLS"
```

### Task A2: Migration — invoice numbering counters

**Files:**
- Create: `supabase/migrations/20260625000014_invoice_numbering_counters.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Monotonic counters per doc-type per year. Format: PREFIX/YYYY/NNNNN
-- Used by frontend PDF generators via next_invoice_number RPC.
CREATE TABLE IF NOT EXISTS invoice_counters (
  doc_type text NOT NULL,  -- SO, INV-DP, INV-PEL, INV-LUNAS, INV-TEMPO, SJ, CANCEL
  year smallint NOT NULL,
  counter int NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);

CREATE OR REPLACE FUNCTION next_invoice_number(p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year smallint := EXTRACT(YEAR FROM NOW())::smallint;
  v_counter int;
BEGIN
  INSERT INTO invoice_counters(doc_type, year, counter)
  VALUES (p_doc_type, v_year, 1)
  ON CONFLICT (doc_type, year) DO UPDATE SET counter = invoice_counters.counter + 1
  RETURNING counter INTO v_counter;
  RETURN p_doc_type || '/' || v_year || '/' || LPAD(v_counter::text, 5, '0');
END;
$$;

REVOKE ALL ON FUNCTION next_invoice_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_invoice_number(text) TO authenticated;

COMMENT ON FUNCTION next_invoice_number IS 'Atomically increment per-type per-year counter. Returns formatted number like SO/2026/00001.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260625000014_invoice_numbering_counters.sql
git commit -m "feat(sales): invoice_counters table + next_invoice_number RPC for monotonic doc numbering"
```

---

## Milestone B: Stock Reservation

### Task B1: Migration — reserve/restore stock RPCs

**Files:**
- Create: `supabase/migrations/20260625000011_reserve_stock_rpc.sql`

- [ ] **Step 1: Read existing stock schema first**

Run:
```bash
grep -l "CREATE TABLE.*stocks\b" supabase/migrations/*.sql | head -2
```

Read the file to confirm `stocks` table schema. Expected columns: `sku`, `warehouse_id` (uuid) or legacy `warehouse` (text), `qty`. Adapt RPC accordingly.

- [ ] **Step 2: Write the migration**

```sql
-- Reserve stock for an order: for each item in kasir_transactions.items[],
-- decrement stocks.qty atomically. Idempotent via stock_movements log lookup.
-- For KOMPONEN orders, called on transition to 3a (Sedang Siapkan Barang).
-- For CUSTOM_PANEL/RAKIT_PANEL, owner approval handles via existing rakit_lock flow.
CREATE OR REPLACE FUNCTION reserve_stock(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_sku text;
  v_qty int;
  v_warehouse text;
  v_current_qty int;
  v_already int;
BEGIN
  SELECT items, order_type INTO v_items, v_warehouse FROM kasir_transactions WHERE id = p_order_id;
  IF v_items IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  -- Idempotency: skip if already reserved (any stock_movements with this order_id + kind='reserve')
  SELECT COUNT(*) INTO v_already FROM stock_movements WHERE order_id = p_order_id AND kind = 'reserve';
  IF v_already > 0 THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_RESERVED');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_sku := v_item->>'sku';
    v_qty := (v_item->>'qty')::int;
    v_warehouse := v_item->>'warehouse';
    IF v_sku IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT qty INTO v_current_qty FROM stocks WHERE sku = v_sku AND COALESCE(warehouse, 'atas') = COALESCE(v_warehouse, 'atas') FOR UPDATE;
    IF v_current_qty IS NULL OR v_current_qty < v_qty THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT', 'sku', v_sku, 'requested', v_qty, 'available', COALESCE(v_current_qty, 0));
    END IF;

    UPDATE stocks SET qty = qty - v_qty WHERE sku = v_sku AND COALESCE(warehouse, 'atas') = COALESCE(v_warehouse, 'atas');

    INSERT INTO stock_movements(sku, warehouse, qty_change, kind, order_id, created_at)
    VALUES (v_sku, COALESCE(v_warehouse, 'atas'), -v_qty, 'reserve', p_order_id, NOW());
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION restore_stock(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov record;
BEGIN
  -- Reverse all 'reserve' movements for this order
  FOR v_mov IN SELECT sku, warehouse, qty_change FROM stock_movements WHERE order_id = p_order_id AND kind = 'reserve'
  LOOP
    UPDATE stocks SET qty = qty + ABS(v_mov.qty_change) WHERE sku = v_mov.sku AND warehouse = v_mov.warehouse;
    INSERT INTO stock_movements(sku, warehouse, qty_change, kind, order_id, created_at)
    VALUES (v_mov.sku, v_mov.warehouse, ABS(v_mov.qty_change), 'restore', p_order_id, NOW());
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION reserve_stock(uuid), restore_stock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_stock(uuid), restore_stock(uuid) TO authenticated;

COMMENT ON FUNCTION reserve_stock IS 'Atomic stock deduction on stage 3a entry. Idempotent.';
COMMENT ON FUNCTION restore_stock IS 'Atomic stock restoration on cancel-to-6a. Reverses prior reserve.';
```

**Note:** If actual `stocks` table uses `warehouse_id` (uuid) instead of `warehouse` (text), the implementer must adapt the WHERE clauses + stock_movements columns to match the real schema. Run `\d stocks` first to confirm.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260625000011_reserve_stock_rpc.sql
git commit -m "feat(sales): reserve_stock + restore_stock atomic RPCs with idempotency"
```

---

## Milestone C: WA Notification System

### Task C1: Migration — notification templates table + seed

**Files:**
- Create: `supabase/migrations/20260625000012_notification_templates_table.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS notification_templates (
  key text PRIMARY KEY,                 -- e.g. 'reminder-bayar-komponen', 'dp-cprp'
  description text NOT NULL,
  template_text text NOT NULL,          -- with {{customer}}, {{total}}, {{sisa}}, {{estimasiHari}} placeholders
  applies_to_sub_stages text[] NOT NULL,-- e.g. ['2c'], ['3h']
  applies_to_order_types text[] NOT NULL DEFAULT ARRAY['KOMPONEN','CUSTOM_PANEL','RAKIT_PANEL'],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Seed 10 stage-transition templates
INSERT INTO notification_templates(key, description, template_text, applies_to_sub_stages, applies_to_order_types) VALUES
  ('reminder-bayar-komponen',
   'Stage 2c · Tunggu Bayar · Komponen',
   'Halo {{customer}} 🙏 Pesanan #{{orderShortId}} sebesar Rp {{total}} mohon ditransfer ke rekening kami ya. Bank: {{bankInfo}}',
   ARRAY['2c'], ARRAY['KOMPONEN']),
  ('dp-cprp',
   'Stage 2c · Tunggu Bayar DP · CP/RP',
   'Halo {{customer}}, terima kasih sudah memesan {{orderTypeLabel}}. Mohon transfer DP sebesar Rp {{dpAmount}}. Estimasi selesai: {{estimasiHari}} hari kerja. Bank: {{bankInfo}}',
   ARRAY['2c'], ARRAY['CUSTOM_PANEL','RAKIT_PANEL']),
  ('progress-rakit',
   'Stage 3f · Progress Update · CP/RP',
   'Update Pak/Bu {{customer}}: panel sudah hari ke-{{hariProgress}} dari estimasi {{estimasiHari}} hari. {{progressNote}}',
   ARRAY['3f'], ARRAY['CUSTOM_PANEL','RAKIT_PANEL']),
  ('final-cost-cprp',
   'Stage 3h · Biaya Final · Invoice Pelunasan',
   '{{orderTypeLabel}} sudah selesai ✅. Biaya final: Rp {{biayaFinal}} (estimasi awal Rp {{estimasiAwal}}{{selisihNote}}). DP sudah diterima Rp {{dpReceived}} · sisa pelunasan: Rp {{sisa}}. Invoice terlampir.',
   ARRAY['3h'], ARRAY['CUSTOM_PANEL','RAKIT_PANEL']),
  ('tracking-info',
   'Stage 4a · Tracking Link Dikirim',
   'Pesanan Pak/Bu {{customer}} sudah dikirim via {{kurir}} 🚚. Track di: {{trackingLink}}. Mohon konfirmasi setelah terima ya. Terima kasih 🙏',
   ARRAY['4a'], ARRAY['KOMPONEN','CUSTOM_PANEL','RAKIT_PANEL']),
  ('siap-pickup',
   'Stage 4b · Siap Diambil di Toko',
   'Pesanan {{customer}} siap diambil 🏪. Alamat toko: {{alamatToko}}. Jam buka: {{jamBuka}}. Telp: {{telpToko}}. Mohon bawa nomor order #{{orderShortId}} ya.',
   ARRAY['4b'], ARRAY['KOMPONEN','CUSTOMER_PANEL','RAKIT_PANEL']),
  ('review-google',
   'Stage 5 · Review Request',
   'Terima kasih Pak/Bu {{customer}} atas pembelian di {{namaToko}} 🙏 Kalau berkenan, mohon kasih review di Google: {{googleMapsLink}}. Sangat membantu toko kami ⭐',
   ARRAY['5a'], ARRAY['KOMPONEN','CUSTOM_PANEL','RAKIT_PANEL']),
  ('reject-bukti',
   'Stage 2e · Bukti Ditolak',
   'Halo {{customer}}, mohon maaf bukti transfer belum bisa kami verifikasi. Mohon upload ulang bukti yang lebih jelas / yang benar ya. Alasan: {{rejectReason}}',
   ARRAY['2e'], ARRAY['KOMPONEN','CUSTOM_PANEL','RAKIT_PANEL']),
  ('order-approved',
   'Stage 2c · Order Approved (SO sent)',
   'Halo {{customer}} 🙏 Pesanan Anda sudah kami konfirmasi. Sales Order #{{orderShortId}} terlampir. Mohon transfer total Rp {{total}} ke rekening kami untuk diproses.',
   ARRAY['2c'], ARRAY['KOMPONEN','CUSTOM_PANEL','RAKIT_PANEL']),
  ('cancel-confirmed',
   'Stage 6 · Pesanan Dibatalkan',
   'Pesanan #{{orderShortId}} sudah dibatalkan sesuai permintaan. Terima kasih sudah berbelanja di {{namaToko}}.',
   ARRAY['6a','6b'], ARRAY['KOMPONEN','CUSTOM_PANEL','RAKIT_PANEL'])
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  template_text = EXCLUDED.template_text,
  applies_to_sub_stages = EXCLUDED.applies_to_sub_stages,
  applies_to_order_types = EXCLUDED.applies_to_order_types,
  updated_at = NOW();

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read notification_templates" ON notification_templates;
CREATE POLICY "Authenticated read notification_templates" ON notification_templates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner write notification_templates" ON notification_templates;
CREATE POLICY "Owner write notification_templates" ON notification_templates FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND role = 'Owner')
);

COMMENT ON TABLE notification_templates IS '10 WA notification templates seeded for stage-transition auto-messages. Owner can edit/toggle via Pengaturan.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260625000012_notification_templates_table.sql
git commit -m "feat(sales): notification_templates table seeded with 10 WA stage-transition templates"
```

### Task C2: Migration — queue WA notification helper

**Files:**
- Create: `supabase/migrations/20260625000013_send_wa_notification_helper.sql`

**Note:** This task depends on whether the project already has a `wa_outbox` table or uses pg_net to call Calista backend. **Implementer must first grep for existing WA send pattern**:

```bash
grep -rn "wa_outbox\|send_wa\|whatsapp" supabase/migrations/*.sql | head -10
```

If `wa_outbox` exists, write to that. If pg_net pattern exists (calling external HTTP), follow it. If neither, implement minimal `queue_wa_notification` that just logs to `audit_log` for now (real WA send wired in follow-up).

Minimum viable (audit-only) implementation:

```sql
CREATE OR REPLACE FUNCTION queue_wa_notification(
  p_order_id uuid,
  p_template_key text,
  p_extra_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tmpl record;
BEGIN
  SELECT key, template_text, is_active INTO v_tmpl FROM notification_templates WHERE key = p_template_key;
  IF v_tmpl.key IS NULL OR NOT v_tmpl.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TEMPLATE_INACTIVE_OR_MISSING');
  END IF;

  -- Log the intent — actual WA send TBD by Calista integration follow-up
  INSERT INTO audit_log(event_type, actor_user_id, payload)
  VALUES ('wa_notification_queued', NULL, jsonb_build_object(
    'order_id', p_order_id,
    'template_key', p_template_key,
    'template_text', v_tmpl.template_text,
    'extra', p_extra_payload
  ));

  RETURN jsonb_build_object('ok', true, 'template_key', p_template_key);
END;
$$;

REVOKE ALL ON FUNCTION queue_wa_notification(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION queue_wa_notification(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION queue_wa_notification IS 'Queue a WA notification to customer. Phase 1B: logs to audit_log. Follow-up: wire actual send via Calista.';
```

If a richer `wa_outbox` table exists, INSERT into that instead with status='pending' and let the existing background worker pick it up.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260625000013_send_wa_notification_helper.sql
git commit -m "feat(sales): queue_wa_notification helper (audit-log for Phase 1B; Calista wire follow-up)"
```

### Task C3: Migration — extend transition RPC with stock + WA hooks

**Files:**
- Create: `supabase/migrations/20260625000015_transition_rpc_v3_with_stock_and_wa.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Replace transition_order_stage to call reserve_stock on 3a entry,
-- restore_stock on cancel-to-6a, queue_wa_notification on key transitions.
DROP FUNCTION IF EXISTS transition_order_stage(uuid, text, text, int, text);

CREATE OR REPLACE FUNCTION transition_order_stage(
  p_order_id uuid,
  p_from_sub_stage text,
  p_to_sub_stage text,
  p_expected_version int,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_version int;
  v_current_sub_stage text;
  v_new_stage smallint;
  v_actor uuid := auth.uid();
  v_order_type text;
  v_reserve_result jsonb;
BEGIN
  SELECT version, funnel_sub_stage, order_type
    INTO v_current_version, v_current_sub_stage, v_order_type
  FROM kasir_transactions
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_current_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF v_current_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'current_version', v_current_version);
  END IF;
  IF v_current_sub_stage != p_from_sub_stage THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STAGE_MISMATCH', 'current_sub_stage', v_current_sub_stage);
  END IF;

  v_new_stage := CAST(SUBSTRING(p_to_sub_stage FROM '^[0-9]+') AS smallint);

  -- Reserve stock when entering 3a (Komponen flow). CP/RP uses rakit_lock approval instead.
  IF p_to_sub_stage = '3a' AND v_order_type = 'KOMPONEN' THEN
    v_reserve_result := reserve_stock(p_order_id);
    IF (v_reserve_result->>'ok')::boolean = false THEN
      RETURN jsonb_build_object('ok', false, 'code', 'STOCK_INSUFFICIENT', 'details', v_reserve_result);
    END IF;
  END IF;

  -- Restore stock when cancelling to 6a from a stage that had stock reserved
  IF v_new_stage = 6 AND v_current_sub_stage IN ('3a', '3b', '3c', '3d', '3e') THEN
    PERFORM restore_stock(p_order_id);
  END IF;

  UPDATE kasir_transactions
  SET
    funnel_sub_stage = p_to_sub_stage,
    funnel_stage = v_new_stage,
    version = version + 1,
    wip_started_at = CASE WHEN p_to_sub_stage IN ('3a', '3f') AND wip_started_at IS NULL THEN NOW() ELSE wip_started_at END
  WHERE id = p_order_id;

  INSERT INTO audit_log(event_type, actor_user_id, payload)
  VALUES ('stage_transition', v_actor, jsonb_build_object(
    'order_id', p_order_id,
    'from_sub_stage', p_from_sub_stage,
    'to_sub_stage', p_to_sub_stage,
    'reason', p_reason
  ));

  -- Fire WA notification for key transitions (fire-and-forget; queue_wa_notification handles missing template)
  IF p_to_sub_stage = '2c' THEN
    IF v_order_type = 'KOMPONEN' THEN
      PERFORM queue_wa_notification(p_order_id, 'order-approved');
    ELSE
      PERFORM queue_wa_notification(p_order_id, 'dp-cprp');
    END IF;
  ELSIF p_to_sub_stage = '2e' THEN
    PERFORM queue_wa_notification(p_order_id, 'reject-bukti', jsonb_build_object('rejectReason', p_reason));
  ELSIF p_to_sub_stage = '4a' THEN
    PERFORM queue_wa_notification(p_order_id, 'tracking-info');
  ELSIF p_to_sub_stage = '4b' THEN
    PERFORM queue_wa_notification(p_order_id, 'siap-pickup');
  ELSIF p_to_sub_stage = '5a' THEN
    PERFORM queue_wa_notification(p_order_id, 'review-google');
  ELSIF v_new_stage = 6 THEN
    PERFORM queue_wa_notification(p_order_id, 'cancel-confirmed');
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_version', v_current_version + 1, 'new_sub_stage', p_to_sub_stage);
END;
$$;

REVOKE ALL ON FUNCTION transition_order_stage(uuid, text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_order_stage(uuid, text, text, int, text) TO authenticated;

COMMENT ON FUNCTION transition_order_stage IS 'v3 — atomic transition + optimistic lock + audit log + stock reserve/restore + WA notification queue.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260625000015_transition_rpc_v3_with_stock_and_wa.sql
git commit -m "feat(sales): transition_order_stage v3 wires reserve_stock + restore_stock + queue_wa_notification"
```

---

## Milestone D: Pengaturan Lib + Components

### Task D1: lib/pengaturan types + queries + mutations

**Files:**
- Create: `src/lib/pengaturan/types.ts`
- Create: `src/lib/pengaturan/queries.ts`
- Create: `src/lib/pengaturan/mutations.ts`
- Create: `src/lib/pengaturan/__tests__/queries.test.ts`

- [ ] **Step 1: Write types**

`src/lib/pengaturan/types.ts`:

```typescript
export interface StoreSettings {
  id: 1;
  nama_toko: string;
  nama_legal?: string;
  tagline?: string;
  alamat_lengkap: string;
  kota: string;
  telp_wa: string;
  logo_url?: string;
  google_maps_url?: string;
  npwp?: string;
  updated_at: string;
  updated_by?: string;
}

export interface OperatingHour {
  day_of_week: number;  // 0=Senin .. 6=Minggu
  is_open: boolean;
  open_time?: string;
  close_time?: string;
}

export interface BankAccount {
  id: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  is_active: boolean;
  sort_order: number;
}
```

- [ ] **Step 2: Write queries**

`src/lib/pengaturan/queries.ts`:

```typescript
import { supabase } from '../supabaseClient';
import type { StoreSettings, OperatingHour, BankAccount } from './types';

export async function fetchStoreSettings(): Promise<StoreSettings> {
  const { data, error } = await supabase.from('store_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as StoreSettings;
}

export async function fetchOperatingHours(): Promise<OperatingHour[]> {
  const { data, error } = await supabase.from('operating_hours').select('*').order('day_of_week');
  if (error) throw error;
  return (data ?? []) as OperatingHour[];
}

export async function fetchBankAccounts(): Promise<BankAccount[]> {
  const { data, error } = await supabase.from('bank_accounts').select('*').order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BankAccount[];
}
```

- [ ] **Step 3: Write mutations**

`src/lib/pengaturan/mutations.ts`:

```typescript
import { supabase } from '../supabaseClient';
import type { StoreSettings, OperatingHour, BankAccount } from './types';

export async function updateStoreSettings(patch: Partial<StoreSettings>): Promise<void> {
  const { error } = await supabase.from('store_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) throw error;
}

export async function updateOperatingHour(day: number, patch: Partial<OperatingHour>): Promise<void> {
  const { error } = await supabase.from('operating_hours').update(patch).eq('day_of_week', day);
  if (error) throw error;
}

export async function upsertBankAccount(account: Partial<BankAccount>): Promise<BankAccount> {
  if (account.id) {
    const { data, error } = await supabase.from('bank_accounts').update(account).eq('id', account.id).select().single();
    if (error) throw error;
    return data as BankAccount;
  } else {
    const { data, error } = await supabase.from('bank_accounts').insert(account).select().single();
    if (error) throw error;
    return data as BankAccount;
  }
}

export async function deleteBankAccount(id: string): Promise<void> {
  const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Write tests**

`src/lib/pengaturan/__tests__/queries.test.ts`:

```typescript
import { describe, test, expect, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 1, nama_toko: 'Test', alamat_lengkap: 'A', kota: 'X', telp_wa: '0812', updated_at: '2026' }, error: null }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

import { fetchStoreSettings, fetchOperatingHours, fetchBankAccounts } from '../queries';

describe('pengaturan queries', () => {
  test('fetchStoreSettings returns row with id=1', async () => {
    const s = await fetchStoreSettings();
    expect(s.id).toBe(1);
    expect(s.nama_toko).toBe('Test');
  });
  test('fetchOperatingHours returns array', async () => {
    const h = await fetchOperatingHours();
    expect(Array.isArray(h)).toBe(true);
  });
  test('fetchBankAccounts returns array', async () => {
    const b = await fetchBankAccounts();
    expect(Array.isArray(b)).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests + commit**

```bash
npm test -- src/lib/pengaturan --run
git add src/lib/pengaturan/
git commit -m "feat(pengaturan): types + queries + mutations for store_settings, operating_hours, bank_accounts"
```

### Task D2: Pengaturan UI cards

**Files:**
- Create: `src/components/pengaturan/IdentitasTokoCard.tsx`
- Create: `src/components/pengaturan/JamOperasionalCard.tsx`
- Create: `src/components/pengaturan/RekeningBankCard.tsx`
- Modify: `src/components/PengaturanScreen.tsx`

Implementation references the mockup at `/tmp/fulfillment-mockup.html` Section 6 — admin already approved the visual design. Render uniform with existing PengaturanScreen pattern (white cards, navy primary). Reference: existing PengaturanScreen for layout/styling cues.

- [ ] **Step 1: Implement IdentitasTokoCard** — inputs for nama, nama_legal, tagline, alamat_lengkap, kota, telp_wa, google_maps_url + logo upload via Supabase storage `product-photos` bucket (reuse). "Simpan" button → updateStoreSettings.
- [ ] **Step 2: Implement JamOperasionalCard** — 7 rows with day label + time inputs. Sunday default CLOSED.
- [ ] **Step 3: Implement RekeningBankCard** — list current banks + "+ Tambah Bank" button + per-row edit/delete. Mark active toggle.
- [ ] **Step 4: Wire all three into PengaturanScreen** at the top, before existing sections.
- [ ] **Step 5: Commit**

```bash
git add src/components/pengaturan/ src/components/PengaturanScreen.tsx
git commit -m "feat(pengaturan): IdentitasToko + JamOperasional + RekeningBank cards"
```

---

## Milestone E: PDF Generators

### Task E1: PDF common shared module

**Files:**
- Create: `src/lib/sales/pdf/common.ts`
- Test: `src/lib/sales/pdf/__tests__/common.test.ts`

- [ ] **Step 1: Write common helpers**

```typescript
import { jsPDF } from 'jspdf';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';
import type { Order } from '../types';

/** A4 dimensions (mm) */
export const PAGE_WIDTH = 210;
export const PAGE_HEIGHT = 297;
export const MARGIN = 14;

/** Render company header at top: logo box + nama + alamat + telp + doc title/number right side. */
export function renderHeader(doc: jsPDF, settings: StoreSettings, docTitle: string, docNumber: string, dateStr: string): number {
  // Logo placeholder (navy box with initials)
  doc.setFillColor(1, 39, 73);
  doc.roundedRect(MARGIN, 12, 12, 12, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  const initials = settings.nama_toko.slice(0, 2).toUpperCase();
  doc.text(initials, MARGIN + 6, 19, { align: 'center' });

  // Company name + address
  doc.setTextColor(1, 39, 73);
  doc.setFontSize(11);
  doc.text(settings.nama_toko, MARGIN + 16, 16);
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  let y = 20;
  doc.text(settings.alamat_lengkap, MARGIN + 16, y);
  if (settings.kota) { y += 3.5; doc.text(settings.kota, MARGIN + 16, y); }
  if (settings.telp_wa) { y += 3.5; doc.text('Telp/WA: ' + settings.telp_wa, MARGIN + 16, y); }

  // Doc title + number (right-aligned)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(1, 39, 73);
  doc.text(docNumber, PAGE_WIDTH - MARGIN, 16, { align: 'right' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, PAGE_WIDTH - MARGIN, 20, { align: 'right' });

  // Divider
  doc.setDrawColor(1, 39, 73);
  doc.setLineWidth(0.6);
  const dividerY = Math.max(y + 4, 30);
  doc.line(MARGIN, dividerY, PAGE_WIDTH - MARGIN, dividerY);
  return dividerY + 4;
}

/** Render customer info block (nama + phone + alamat). Returns new y. */
export function renderCustomerBlock(doc: jsPDF, order: Order, y: number): number {
  doc.setFillColor(239, 244, 255);
  doc.roundedRect(MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 18, 1, 1, 'F');
  doc.setTextColor(1, 39, 73);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Kepada:', MARGIN + 3, y + 4);
  doc.setTextColor(60, 60, 60);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(order.customer, MARGIN + 3, y + 8);
  // Phone + address would come from extended Order in production
  return y + 22;
}

/** Render bank accounts block for payment instructions. Returns new y. */
export function renderBankBlock(doc: jsPDF, banks: BankAccount[], y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(1, 39, 73);
  doc.text('Cara Pembayaran — transfer ke salah satu rekening:', MARGIN, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (const b of banks.filter(b => b.is_active)) {
    doc.setDrawColor(199, 215, 245);
    doc.setFillColor(250, 251, 255);
    doc.roundedRect(MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 6, 0.8, 0.8, 'FD');
    doc.text(`${b.bank_name} · ${b.account_number} · a.n. ${b.account_holder}`, MARGIN + 3, y + 4);
    y += 7;
  }
  return y + 2;
}

/** Render T&C footer. */
export function renderFooter(doc: jsPDF, lines: string[]): void {
  const y = PAGE_HEIGHT - 28;
  doc.setDrawColor(1, 39, 73);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(1, 39, 73);
  doc.text('SYARAT & KETENTUAN', MARGIN, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(7);
  let yy = y + 8;
  for (const l of lines) { doc.text('• ' + l, MARGIN + 2, yy); yy += 3; }
}
```

- [ ] **Step 2: Write quick test** (smoke that doc instance is non-null + page count = 1):

```typescript
import { describe, test, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { renderHeader, renderCustomerBlock, renderFooter } from '../common';
import type { StoreSettings } from '../../../pengaturan/types';
import type { Order } from '../../types';

describe('PDF common', () => {
  test('renderHeader returns Y past header', () => {
    const doc = new jsPDF();
    const settings: StoreSettings = { id: 1, nama_toko: 'Sinar Elektrik', alamat_lengkap: 'Jl. Pulau', kota: 'Surabaya', telp_wa: '085264', updated_at: '' };
    const y = renderHeader(doc, settings, 'INVOICE', 'INV/2026/00001', '18 Jun 2026');
    expect(y).toBeGreaterThan(30);
    expect(doc.getNumberOfPages()).toBe(1);
  });
  test('renderCustomerBlock advances Y', () => {
    const doc = new jsPDF();
    const order = { id: 'a', customer: 'X' } as Order;
    const y = renderCustomerBlock(doc, order, 40);
    expect(y).toBeGreaterThan(40);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/sales/pdf/common.ts src/lib/sales/pdf/__tests__/common.test.ts
git commit -m "feat(sales/pdf): shared header + customer + bank + footer renderers using StoreSettings"
```

### Task E2: Sales Order PDF

**Files:**
- Create: `src/lib/sales/pdf/salesOrderPdf.ts`
- Create: `src/lib/sales/pdf/invoiceNumber.ts`

- [ ] **Step 1: invoiceNumber.ts**

```typescript
import { supabase } from '../../supabaseClient';
export async function nextInvoiceNumber(docType: 'SO' | 'INV-DP' | 'INV-PEL' | 'INV-LUNAS' | 'INV-TEMPO' | 'SJ' | 'CANCEL'): Promise<string> {
  const { data, error } = await supabase.rpc('next_invoice_number', { p_doc_type: docType });
  if (error) throw error;
  return data as string;
}
```

- [ ] **Step 2: salesOrderPdf.ts**

```typescript
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Order } from '../types';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';
import { renderHeader, renderCustomerBlock, renderBankBlock, renderFooter, MARGIN, PAGE_WIDTH } from './common';
import { nextInvoiceNumber } from './invoiceNumber';

export async function generateSalesOrderPdf(order: Order & { items?: unknown[]; ongkir_amount?: number }, settings: StoreSettings, banks: BankAccount[]): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const soNumber = await nextInvoiceNumber('SO');
  const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  let y = renderHeader(doc, settings, 'PESANAN PENJUALAN', soNumber, dateStr);
  y += 3;
  doc.setFontSize(14);
  doc.setTextColor(1, 39, 73);
  doc.setFont('helvetica', 'bold');
  doc.text('PESANAN PENJUALAN', PAGE_WIDTH / 2, y, { align: 'center' });
  y += 6;
  y = renderCustomerBlock(doc, order, y);

  // Items table
  const items = ((order as { items?: Array<{ name: string; qty: number; unit_price?: number; subtotal: number }> }).items) ?? [];
  autoTable(doc, {
    startY: y,
    head: [['No', 'Produk', 'Qty', 'Harga', 'Subtotal']],
    body: items.map((it, idx) => [String(idx + 1), it.name, String(it.qty), (it.unit_price ?? 0).toLocaleString('id-ID'), it.subtotal.toLocaleString('id-ID')]),
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: [239, 244, 255], textColor: [1, 39, 73], fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 2 },
  });
  const tableEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Subtotal: ${order.total.toLocaleString('id-ID')}`, PAGE_WIDTH - MARGIN, tableEnd, { align: 'right' });
  if (order.ongkir_amount) doc.text(`Ongkir: ${order.ongkir_amount.toLocaleString('id-ID')}`, PAGE_WIDTH - MARGIN, tableEnd + 4, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(45, 138, 78);
  doc.setFontSize(11);
  doc.text(`TOTAL: Rp ${(order.total + (order.ongkir_amount ?? 0)).toLocaleString('id-ID')}`, PAGE_WIDTH - MARGIN, tableEnd + 10, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  // Bank block
  renderBankBlock(doc, banks, tableEnd + 18);

  // Footer
  renderFooter(doc, [
    'Barang yang telah dibeli tidak dapat dikembalikan',
    'Pembayaran dianggap sah setelah dana masuk ke rekening kami',
    'Komplain barang rusak/kurang harap disampaikan saat barang diterima',
  ]);
  return doc.output('blob');
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/sales/pdf/salesOrderPdf.ts src/lib/sales/pdf/invoiceNumber.ts
git commit -m "feat(sales/pdf): Sales Order PDF + invoiceNumber RPC wrapper"
```

### Task E3-E6: Invoice DP / Invoice Lunas / Invoice Pelunasan / Surat Jalan / Catatan Pembatalan

Same pattern as Task E2 — each is a focused generator file. Implementer follows the mockup at `/tmp/fulfillment-mockup.html` Section 8 for exact layout per doc type:

- **Invoice DP** (`invoiceDpPdf.ts`) — items table + Rincian Pembayaran box (Total / DP Diterima / Sisa Pelunasan) + bank block + status badge "DP DITERIMA"
- **Invoice Lunas** (`invoiceLunasPdf.ts`) — items + simple LUNAS status badge
- **Invoice Pelunasan** (`invoicePelunasanPdf.ts`) — items + breakdown table (Estimasi Awal / Total Final / Selisih / DP Sebelumnya / Pelunasan Hari Ini / Total Dibayar / Sisa) + LUNAS badge — used for CP/RP after owner approves biaya final
- **Surat Jalan** (`suratJalanPdf.ts`) — Kepada + Dikirim dari blocks + items table + TTD block with signature lines + "Diserahkan oleh: {nama_toko}" from settings
- **Catatan Pembatalan** (`catatanPembatalanPdf.ts`) — customer + nomor order + cancel reason + cancelled_by + status DIBATALKAN — for Stage 6 archive

Each task:
- [ ] Write generator file
- [ ] Smoke test (blob non-empty + getNumberOfPages === 1)
- [ ] Commit `feat(sales/pdf): <doctype> PDF generator`

---

## Milestone F: EditOrderModal + ActionPanel PDF buttons

### Task F1: EditOrderModal component

**Files:**
- Create: `src/components/sales/EditOrderModal.tsx`

- [ ] **Step 1: Implement modal**

Modal opens on row Edit click. Allows pre-payment edit of: ongkir, alamat_pengiriman, items qty. Audit reason required (textarea). On submit:
- UPDATE kasir_transactions SET ongkir_amount, delivery_address, items, updated_at
- INSERT audit_log entry with event_type='order_modified' + payload including from/to values
- Returns to funnel screen with toast

- [ ] **Step 2: Wire into DaftarPesananScreen** — add Edit button to ActionPanel for orders in 2a-2d only (pre-payment).

- [ ] **Step 3: Commit**

```bash
git add src/components/sales/EditOrderModal.tsx src/components/sales/DaftarPesananScreen.tsx
git commit -m "feat(sales): EditOrderModal for pre-payment edits with audit reason"
```

### Task F2: ActionPanel PDF download buttons

**Files:**
- Modify: `src/components/sales/ActionPanel.tsx`

- [ ] **Step 1: Add PDF download buttons per stage**

For each sub-stage, render appropriate PDF buttons:
- 2a/2b/2c: 📄 Sales Order (calls generateSalesOrderPdf → opens in new tab via URL.createObjectURL)
- 2d/3a-h: + Invoice DP (if payment_type='DP') / Invoice Lunas (if 'FULL')
- 3b/3h: + Invoice Pelunasan
- 4a/4b: + Surat Jalan
- 5a: All documents available
- 6a/6b: + Catatan Pembatalan

Helper:

```typescript
async function downloadPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Fetch settings + banks once at top of DaftarPesananScreen**, pass via context or prop to ActionPanel so PDF generators have data.

- [ ] **Step 3: Commit**

```bash
git add src/components/sales/ActionPanel.tsx src/components/sales/DaftarPesananScreen.tsx
git commit -m "feat(sales): PDF download buttons in ActionPanel wired to generators"
```

---

## Self-Review

After completing all tasks above, run:

```bash
npm test -- --run                    # expect 100+ tests, all passing
npx tsc --noEmit                     # expect clean
npm run build                        # expect clean
```

**Spec coverage check:**

- [x] Pengaturan: alamat toko + jam operasional + rekening bank — Milestone D
- [x] PDF generation (5 types + Catatan Pembatalan) — Milestone E
- [x] WA notifications (10 templates seeded, wired to transition RPC) — Milestone C
- [x] Stock reservation on 3a entry — Milestone B
- [x] EditOrderModal — Milestone F1
- [x] Invoice numbering — Milestone A2 + E2

**Out-of-scope acknowledged:**
- Calista AI parser for customer "sudah" replies — separate plan
- Stage 1 Bertanya conversation row UI — Sales Inbox already covers
- Owner override modal — placeholder OK for now
- Dot matrix print path — modern PDF sufficient
- Stuck-order detection cron — manual review for now
- Backend Go service layer rewrite — DB RPCs suffice

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-sales-phase-1b-pdfs-notifications-pengaturan-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
