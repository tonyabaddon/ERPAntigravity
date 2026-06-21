# Pengaturan MSME Configurability — Phase 1 Design

**Date:** 2026-06-21
**Status:** Draft (awaiting founder review)
**Scope:** Single-tenant Garindo + foundation untuk V2 multi-tenant
**Estimasi:** 12-15 hari kerja
**Sister doc:** `docs/superpowers/specs/2026-06-21-akuntansi-phase0a-spec.md` (akuntansi Phase 0a parallel)

---

## 1. Konteks & Motivasi

Pengaturan ERP saat ini bersifat **single-tenant + hardcoded**: 12 approval gate selalu wajib Owner PIN, modul Custom Panel + Wiring Panel hardcoded di wizard, pajak mode tidak ada, dan modul-modul ERP (Kasir/TEMPO/Pengiriman dll) tidak punya saklar global.

Untuk onboarding **5 tenant toko listrik LTC Glodok** di Phase 1 + persiapan tenant non-listrik (Distributor, F&B, Online) di V3, kita butuh:

1. **Approval configurable** — beberapa tenant Owner-strict (semua aksi via PIN), beberapa Owner-relaxed (cukup role check), beberapa Owner-jauh (WA button async).
2. **Modul switches** — beberapa tenant tidak pakai Kasir, Multi-warehouse, atau Jasa Manufaktur.
3. **Tenant-defined service types** — bukan hardcoded "Custom Panel" + "Wiring Panel", tapi master `service_types` CRUD oleh tenant.
4. **Pajak mode** — beberapa tenant PKP (PPN 11%), beberapa UMKM (PPh Final 0.5%), beberapa Non-PKP.

Founder memory yang HARUS dipertahankan (backward-compat zero-regression):
- `feedback_no_approval_workflow.md` — Pembelian default `approval_required=false`
- `feedback_allow_negative_stock_preorder.md` — stock check tetap relax di RPC (tidak diubah spec ini)
- `feedback_no_adhoc_customers.md` — customer wajib terdaftar (tidak diubah spec ini)
- `project_garindo_account_types.md` — 3 jenis akun BANK/KAS/E_WALLET (tidak diubah)

### 1.1 Regulasi pajak Indonesia 2026 (basis pajak mode)

Spec ini mengacu regulasi pajak yang berlaku di Indonesia per **2026**:

| Regulasi | Dampak ke spec |
|---|---|
| **UU HPP No. 7/2021** + **PMK 131/2024** (Des 2024) | PPN tarif umum **tetap 11%** di 2026 (tidak naik ke 12%). PPN 12% berlaku **hanya untuk barang/jasa mewah** (LBO). Toko listrik LTC mayoritas pakai 11%. |
| **PP 55/2022** (revisi PP 23/2018) | PPh Final UMKM 0.5% untuk omzet < Rp 4.8 miliar/tahun. **Batas waktu:** PT 3 tahun, CV 4 tahun, Orang Pribadi 7 tahun. Setelah expiry wajib pindah ke skema umum. |
| **Peraturan DJP Juli 2024** | NIK = NPWP untuk Orang Pribadi (16 digit). |
| **e-Faktur 3.0** | Mandatory untuk PKP. Phase 1: placeholder field; XML generator defer V2. |
| **Coretax Administration System (DJP 2025)** | Pelaporan terpusat DJP. Phase 1: field `pajak_coretax_id` saja; integration push defer V2. |
| **PPh Pasal 22 marketplace 0.5%** | Berlaku untuk e-commerce. Defer V3 (Phase 1 = LTC offline toko listrik). |

---

## 2. Scope

### 2.1 In-scope (Phase 1)

| # | Item | Estimasi (hari) |
|---|---|---|
| 1 | Refactor model approval ke 2-axis (`approval_required` + `verification_method`) | 1 |
| 2 | Tambah 7 Pembelian approval gates (total jadi **19**) | 1 |
| 3 | Tabel baru `approval_settings` + seed Garindo | 1 |
| 4 | Patch 19 RPC dengan pre-check (1-line conditional) | 3 |
| 5 | UI layar baru "Pengaturan Approval Rules" | 2 |
| 6 | Tabel baru `tenant_settings` (modul switches + pajak mode) + seed Garindo | 0.5 |
| 7 | Tabel baru `service_types` + seed Garindo (Custom Panel + Wiring Panel) | 0.5 |
| 8 | UI layar baru "Pengaturan Modul & Jasa" | 2 |
| 9 | Wire cascade dependency map (modul OFF → menu/field/gate hide) | 2 |
| 10 | Dynamic render Step 2 wizard `RakitButtonsRow` dari `service_types` | 0.5 |
| 11 | Smoke test matrix (per-gate + per-modul) | 1.5 |
|   | **Total** | **15** |

### 2.2 Out-of-scope (defer V2/V3)

| Item | Alasan defer |
|---|---|
| **Multi-tenant infra** (RLS, tenant_id everywhere, login isolation, sub-domain routing) | Fundamental architecture decision. Phase 1 single-tenant Garindo dulu; V2 spec terpisah saat onboard tenant ke-2 LTC. Tabel baru di spec ini sudah punya `tenant_id` nullable column → V2 tidak butuh schema migration besar. |
| **Stok flags (Batch / Expired / Serial)** | Itu **3 fitur** (bukan toggle): butuh `batch` table + FIFO picker + opname per-batch + expiry alert + reporting. ~3-4 minggu kerja. Spec terpisah ketika tenant Distributor/F&B masuk V3. |
| **First-run Setup Wizard** | UI investment yang baru bayar saat tenant ke-2. Sekarang Garindo single-tenant. |
| **Settings Library refactor** (search, autosave + undo toast, kartu pattern semua existing) | Sentuh semua existing card pattern. Risk regresi tinggi, ROI rendah. |
| **Template editor** (invoice/WA variable parser) | Mini-project 1-2 minggu. Spec terpisah. |
| **Default term TEMPO global + Payment types active checklist** | Per-customer sudah jalan. Nice-to-have, defer. |
| **COA mapping UI** | Hidup di Akuntansi Phase 0a spec. Jangan duplikasi. |
| **AI personality, Custom fields, Notif routing per event, Audit log retention** | Polish features, V2. |
| **Modul switches untuk archetype F&B/Distributor/Online** (BOM/Resep, dst.) | Phase 1 = 5 LTC toko listrik, same archetype as Garindo. Modul `bom_recipe` ON/OFF column tetap di-create (future-proof), tapi UI surface defer. |

---

## 3. Data Model

### 3.1 `tenant_settings` (modul switches + global toggles)

```sql
CREATE TABLE public.tenant_settings (
  id                       BIGSERIAL PRIMARY KEY,
  tenant_id                UUID,                          -- nullable di Phase 1 (single-tenant Garindo).
                                                          -- V2 multi-tenant: backfill + NOT NULL + UNIQUE.
  -- Modul switches (7 kolom)
  modul_kasir              BOOLEAN NOT NULL DEFAULT TRUE,
  modul_tempo              BOOLEAN NOT NULL DEFAULT TRUE,
  modul_pengiriman         BOOLEAN NOT NULL DEFAULT TRUE,
  modul_multi_warehouse    BOOLEAN NOT NULL DEFAULT TRUE,
  modul_akuntansi          BOOLEAN NOT NULL DEFAULT TRUE, -- akan hidup setelah Phase 0a
  modul_jasa_layanan       BOOLEAN NOT NULL DEFAULT TRUE,
  modul_bom_recipe         BOOLEAN NOT NULL DEFAULT FALSE,-- future-proof, UI surface defer V3

  -- Pajak mode (mengacu regulasi 2026 Indonesia: UU HPP No. 7/2021 + PMK 131/2024 + PP 55/2022)
  pajak_mode               TEXT NOT NULL DEFAULT 'FINAL_UMKM',
                           CHECK (pajak_mode IN ('PKP', 'NON_PKP', 'FINAL_UMKM')),

  -- PPN rates (PMK 131/2024, Des 2024):
  --   - Tarif umum tetap 11% di 2026 (tidak naik ke 12% sebagaimana isi UU HPP).
  --   - 12% berlaku HANYA untuk barang/jasa mewah (LBO).
  --   - Tenant pilih rate yang relevan; toko listrik LTC mayoritas 11% (non-mewah).
  pajak_ppn_rate_umum      NUMERIC(5,2) DEFAULT 11.00,    -- tarif PPN umum (PMK 131/2024)
  pajak_ppn_rate_mewah     NUMERIC(5,2) DEFAULT 12.00,    -- tarif PPN barang/jasa mewah (LBO)

  -- PPh Final UMKM 0.5% (PP 55/2022):
  --   - Berlaku untuk omzet < Rp 4.8 miliar/tahun.
  --   - Batas waktu: PT 3 tahun, CV 4 tahun, Orang Pribadi 7 tahun sejak terdaftar.
  --   - Setelah expiry, WAJIB pindah ke skema umum (PPh OP progresif atau PPh Badan 22%).
  pajak_final_rate         NUMERIC(5,2) DEFAULT 0.50,
  pajak_umkm_jenis_badan   TEXT CHECK (pajak_umkm_jenis_badan IN ('PT','CV','OP','KOPERASI','FIRMA')),
  pajak_umkm_terdaftar_at  DATE,                          -- tanggal mulai gunakan skema UMKM
  pajak_umkm_expires_at    DATE,                          -- auto-derive: terdaftar_at + (3/4/7 tahun by jenis_badan)

  -- NPWP / NIK (regulasi DJP Juli 2024: NIK = NPWP untuk Orang Pribadi)
  pajak_npwp               TEXT,                          -- format 16 digit (NIK) atau 15 digit (NPWP lama)
  pajak_nik_as_npwp        BOOLEAN NOT NULL DEFAULT FALSE,-- TRUE jika pakai NIK sebagai NPWP

  -- e-Faktur (mandatory untuk PKP per regulasi 2026)
  pajak_efaktur_enabled    BOOLEAN NOT NULL DEFAULT FALSE,-- toggle e-Faktur 3.0 integration (placeholder, infra defer V2)
  pajak_pkp_registered_at  DATE,                          -- tanggal terdaftar sebagai PKP

  -- Coretax integration (DJP 2025) — placeholder field, infra defer V2
  pajak_coretax_id         TEXT,                          -- ID Coretax DJP

  -- Regulation tracking
  pajak_regulation_year    INTEGER NOT NULL DEFAULT 2026, -- versi regulasi yang dipakai (audit)

  -- Audit
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               UUID
);

-- Single-row guard untuk Phase 1 (single-tenant):
CREATE UNIQUE INDEX idx_tenant_settings_single ON public.tenant_settings
  ((CASE WHEN tenant_id IS NULL THEN 'SINGLETON' ELSE tenant_id::TEXT END));

-- Phase 1 seed (Garindo, regulasi 2026):
-- Asumsi: Garindo masih dalam masa UMKM (PP 55/2022). Jenis badan + tanggal terdaftar
-- harus dikonfirmasi founder via OQ7 (section 11) sebelum migration di-apply.
INSERT INTO public.tenant_settings (
  tenant_id,
  pajak_mode,
  pajak_umkm_jenis_badan,
  pajak_umkm_terdaftar_at,
  pajak_umkm_expires_at,
  pajak_regulation_year
) VALUES (
  NULL,
  'FINAL_UMKM',
  'OP',                                                    -- founder konfirm: PT/CV/OP?
  '2022-01-01',                                            -- founder konfirm tanggal terdaftar UMKM
  '2029-01-01',                                            -- OP = 7 tahun → expires 2029
  2026
);
```

**Garindo seed default**: semua modul TRUE except `modul_bom_recipe` (irrelevant), `pajak_mode=FINAL_UMKM` (UMKM 0.5%), regulasi tahun 2026. **Catatan untuk founder:** jenis badan + tanggal terdaftar UMKM harus dikonfirmasi sebelum seed final (OQ7 baru).

### 3.2 `approval_settings` (per-gate config, 19 row)

```sql
CREATE TABLE public.approval_settings (
  id                       BIGSERIAL PRIMARY KEY,
  tenant_id                UUID,                              -- nullable Phase 1
  request_type             public.approval_request_type NOT NULL,

  -- 2-axis model (koreksi dari draft awal)
  approval_required        BOOLEAN NOT NULL DEFAULT TRUE,
  verification_method      TEXT NOT NULL DEFAULT 'PIN'
                           CHECK (verification_method IN ('NONE', 'PIN', 'WA_BUTTON', 'APP_INBOX')),

  -- Optional bypass thresholds
  threshold_amount         NUMERIC(18,2),                    -- bypass kalau payload amount < ini
  threshold_qty            INTEGER,                          -- bypass kalau qty < ini
  threshold_percent        NUMERIC(5,2),                     -- bypass kalau % diff < ini (untuk opname)

  -- Approver routing
  approver_role            TEXT NOT NULL DEFAULT 'Owner',    -- bisa di-relax ke 'Staff Admin Toko'
  requestor_bypass_self    BOOLEAN NOT NULL DEFAULT FALSE,  -- Owner sendiri minta → auto-approve own
  reason_required          BOOLEAN NOT NULL DEFAULT FALSE,

  -- Audit
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               UUID,

  UNIQUE (tenant_id, request_type)
);

-- Phase 1 seed (Garindo, zero-behavior-change):
-- All 19 rows: approval_required=TRUE, verification_method='PIN' kecuali Pembelian (7) = FALSE
INSERT INTO public.approval_settings (tenant_id, request_type, approval_required, verification_method)
  VALUES
    -- Stok (3): PIN
    (NULL, 'adjustment',                    TRUE,  'PIN'),
    (NULL, 'opname',                        TRUE,  'PIN'),
    (NULL, 'initial_stock',                 TRUE,  'PIN'),
    -- Kasir (3): PIN
    (NULL, 'kasir_price_override',          TRUE,  'PIN'),
    (NULL, 'kasir_void',                    TRUE,  'PIN'),
    (NULL, 'kasir_refund',                  TRUE,  'PIN'),
    -- Harga (1): PIN
    (NULL, 'price_change',                  TRUE,  'PIN'),
    -- Customer credit & TEMPO (4): PIN
    (NULL, 'customer_credit_activate',      TRUE,  'PIN'),
    (NULL, 'customer_credit_limit_change',  TRUE,  'PIN'),
    (NULL, 'customer_credit_deactivate',    TRUE,  'PIN'),
    (NULL, 'piutang_write_off',             TRUE,  'PIN'),
    -- Jasa (1): PIN
    (NULL, 'rakit_lock',                    TRUE,  'PIN'),
    -- Pembelian (7): OFF (memory: no_approval_workflow)
    (NULL, 'purchase_order_create',         FALSE, 'NONE'),
    (NULL, 'purchase_order_amend',          FALSE, 'NONE'),
    (NULL, 'tagihan_create',                FALSE, 'NONE'),
    (NULL, 'supplier_payment',              FALSE, 'NONE'),
    (NULL, 'bnl_create',                    FALSE, 'NONE'),
    (NULL, 'tukar_faktur',                  FALSE, 'NONE'),
    (NULL, 'purchase_return',               FALSE, 'NONE');
```

**Backward-compat:** Garindo seed = 12 existing PIN (perilaku sekarang) + 7 Pembelian OFF (memory). Zero behavior change.

### 3.3 `service_types` (Master Jenis Jasa)

```sql
CREATE TABLE public.service_types (
  id                       BIGSERIAL PRIMARY KEY,
  tenant_id                UUID,                            -- nullable Phase 1
  code                     TEXT NOT NULL,                   -- internal key, mis. 'custom_panel', 'wiring_panel'
  name                     TEXT NOT NULL,                   -- display label, mis. "Custom Panel"
  description              TEXT,
  pricing_model            TEXT NOT NULL DEFAULT 'LUMP_SUM'
                           CHECK (pricing_model IN ('LUMP_SUM', 'PER_HOUR', 'PER_METER', 'PER_UNIT')),
  requires_material_lock   BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE → trigger rakit_lock approval
  default_account_revenue  BIGINT REFERENCES public.coa_accounts(id), -- nullable sampai Phase 0a
  default_account_cogs     BIGINT REFERENCES public.coa_accounts(id),
  color_hex                TEXT,                            -- UI hint, e.g. '#9333EA' (ungu)
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  display_order            INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- Phase 1 seed (Garindo: 2 jasa existing yang sekarang hardcoded):
INSERT INTO public.service_types (tenant_id, code, name, pricing_model, requires_material_lock, color_hex, display_order)
  VALUES
    (NULL, 'custom_panel',  'Custom Panel',  'LUMP_SUM', TRUE, '#9333EA', 1),
    (NULL, 'wiring_panel',  'Wiring Panel',  'LUMP_SUM', TRUE, '#0EA5E9', 2);
```

**Migration impact ke RPC existing:**
- `rakit_lock` payload tambah field `service_type_id` (FK ke `service_types.id`). Payload existing yang hardcoded "Custom Panel"/"Wiring Panel" akan di-backfill ke service_type_id sesuai code.

---

## 4. Approval gates catalog (19 lengkap)

| # | request_type | Source migration | RPC trigger | Default Garindo (mode/method) |
|---|---|---|---|---|
| 1 | `adjustment` | `20260607000007` | `request_stock_adjustment` | TRUE / PIN |
| 2 | `opname` | `20260607000011` + `…013` | `submit_opname_count` (when selisih ≠ 0) | TRUE / PIN |
| 3 | `initial_stock` | `20260614000024` | `request_initial_stock` | TRUE / PIN |
| 4 | `kasir_price_override` | `20260607000007` | `request_kasir_price_override` | TRUE / PIN |
| 5 | `kasir_void` | `20260607000007` | `request_kasir_void` | TRUE / PIN |
| 6 | `kasir_refund` | `20260607000007` | `request_kasir_refund` | TRUE / PIN |
| 7 | `price_change` | `20260607000016` | `request_price_change` | TRUE / PIN |
| 8 | `customer_credit_activate` | `20260614000009` + `…012` | `request_customer_credit_activate` | TRUE / PIN |
| 9 | `customer_credit_limit_change` | `20260614000013` | `request_customer_credit_limit_change` | TRUE / PIN |
| 10 | `customer_credit_deactivate` | `20260614000014` | `request_customer_credit_deactivate` | TRUE / PIN |
| 11 | `piutang_write_off` | `20260626000020` + `…021/022` | `request_tempo_write_off` | TRUE / PIN |
| 12 | `rakit_lock` | `20260609000010` + `…0011` | `request_rakit_lock` | TRUE / PIN |
| 13 | `purchase_order_create` | **NEW** migration ini | `request_purchase_order_create` (NEW) | FALSE / NONE |
| 14 | `purchase_order_amend` | **NEW** | `request_purchase_order_amend` (NEW) | FALSE / NONE |
| 15 | `tagihan_create` | **NEW** | `request_tagihan_create` (NEW) | FALSE / NONE |
| 16 | `supplier_payment` | **NEW** | `request_supplier_payment` (NEW) | FALSE / NONE |
| 17 | `bnl_create` | **NEW** | `request_bnl_create` (NEW) | FALSE / NONE |
| 18 | `tukar_faktur` | **NEW** | `request_tukar_faktur` (NEW) | FALSE / NONE |
| 19 | `purchase_return` | **NEW** | `request_purchase_return` (NEW) | FALSE / NONE |

### 4.1 ENUM extension migration

```sql
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'purchase_order_create';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'purchase_order_amend';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'tagihan_create';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'supplier_payment';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'bnl_create';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'tukar_faktur';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'purchase_return';
```

---

## 5. Verification Methods

| Method | UX | Backend |
|---|---|---|
| `NONE` (role-only) | Aksi langsung commit. Cuma cek user role = approver_role. Audit log entry tetap dibuat. | Pre-check: `IF user.role NOT IN approver_role THEN raise` |
| `PIN` | OwnerPinPad modal muncul. User ketik PIN. RPC `verify_owner_pin` check bcrypt. | Existing flow, no change. |
| `WA_BUTTON` | Approval request created status='pending'. WA delivered ke approver dengan Approve/Reject button (link ke endpoint). | Butuh infra delivery: WA Business API + button payload + endpoint `/api/approval/wa-decide`. **Phase 1 build skeleton, delivery infra defer ke V2.** Phase 1 fallback: kalau enabled tapi infra belum siap, raise warning + fall through ke APP_INBOX. |
| `APP_INBOX` | Approval request created status='pending'. Muncul di `ApprovalInboxScreen` Owner. Owner approve/reject di app. | Existing flow, sudah full-wired. |

---

## 6. RPC patch matrix

Setiap RPC yang sekarang langsung create approval_request **atau** langsung commit (kalau Pembelian yang baru) tambah pre-check di awal:

```sql
-- Pseudo template untuk semua 19 RPC
CREATE OR REPLACE FUNCTION public.request_<gate_name>(...)
RETURNS ... LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_settings public.approval_settings;
  v_amount NUMERIC;
  v_user_role TEXT;
BEGIN
  -- 1. Load setting untuk gate ini
  SELECT * INTO v_settings
    FROM public.approval_settings
    WHERE request_type = '<gate_name>'
      AND (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

  -- 2. Hitung amount/qty dari payload (per-gate logic)
  v_amount := (p_payload->>'amount')::NUMERIC;

  -- 3. Threshold bypass check
  IF NOT v_settings.approval_required THEN
    -- Auto-pass, langsung commit (untuk Pembelian gates)
    RETURN public.<gate>_direct_commit(...);
  END IF;

  IF v_settings.threshold_amount IS NOT NULL AND v_amount < v_settings.threshold_amount THEN
    -- Bypass threshold, langsung commit
    RETURN public.<gate>_direct_commit(...);
  END IF;

  -- 4. Self-bypass check (requestor = approver)
  SELECT role INTO v_user_role FROM public.admin_users WHERE id = auth.uid();
  IF v_settings.requestor_bypass_self AND v_user_role = v_settings.approver_role THEN
    RETURN public.<gate>_direct_commit(...);
  END IF;

  -- 5. Verification method routing
  IF v_settings.verification_method = 'NONE' THEN
    IF v_user_role <> v_settings.approver_role THEN
      RAISE EXCEPTION 'INSUFFICIENT_ROLE';
    END IF;
    RETURN public.<gate>_direct_commit(...);
  END IF;

  -- PIN/WA_BUTTON/APP_INBOX → existing flow create approval_request
  INSERT INTO public.approval_requests (request_type, payload, requested_by)
    VALUES ('<gate_name>', p_payload, auth.uid())
    RETURNING id INTO v_request_id;

  -- 6. Sisanya: existing logic untuk PIN/WA/INBOX delivery
  RETURN v_request_id;
END $$;
```

**Total RPC patch:** 12 existing RPC patch (tambah pre-check) + 7 RPC baru (Pembelian) + 19 `_direct_commit` companion function = ~26 file SQL touch.

---

## 7. UI Mockup

### 7.1 Pengaturan Approval Rules screen

```
🔒 PENGATURAN APPROVAL

Cara Owner approve (default):
   ⚪ Ketik PIN   ⚪ Lewat WhatsApp   ⚫ Cukup login Owner

Kategori yang butuh approval:

 ╔═ STOK ═════════════════════════════════════╗
 ║ ☑ Adjustment manual (in/out tanpa nota)    ║
 ║ ☑ Opname dengan selisih > [ 500.000 ]      ║
 ║ ☑ Set saldo awal stok produk baru          ║
 ╚════════════════════════════════════════════╝

 ╔═ KASIR ════════════════════════════════════╗
 ║ ☑ Override harga di kasir                  ║
 ║ ☑ Void transaksi                           ║
 ║ ☑ Refund tunai                             ║
 ╚════════════════════════════════════════════╝

 ╔═ HARGA & PRODUK ═══════════════════════════╗
 ║ ☑ Ubah harga jual produk                   ║
 ╚════════════════════════════════════════════╝

 ╔═ PELANGGAN & TEMPO ═══════════════════════╗
 ║ ☑ Aktifkan TEMPO untuk pelanggan baru      ║
 ║ ☑ Naikin credit limit                       ║
 ║ ☑ Nonaktifkan TEMPO                         ║
 ║ ☑ Write-off piutang macet                   ║
 ╚════════════════════════════════════════════╝

 ╔═ PENJUALAN & JASA ════════════════════════╗
 ║ ☑ Lock material untuk jasa (Custom/Wiring) ║
 ╚════════════════════════════════════════════╝

 ╔═ PEMBELIAN (semua OFF default) ═══════════╗
 ║ ☐ Buat PO baru        > [ Rp     ........]║
 ║ ☐ Ubah PO existing                          ║
 ║ ☐ Buat Tagihan supplier                     ║
 ║ ☐ Bayar supplier      > [ Rp     ........]║
 ║ ☐ Buat Beban Non Listing (BNL)              ║
 ║ ☐ Tukar Faktur                              ║
 ║ ☐ Retur barang ke supplier                  ║
 ╚════════════════════════════════════════════╝

 [▾ Pengaturan lanjutan ]   ← override verification method per gate
                              + per-approver role + self-bypass + reason
```

### 7.2 Pengaturan Modul & Jasa screen

```
📦 MODUL ERP

Modul yang aktif di toko kamu. Mematikan modul =
menu, fitur, dan tombol terkait disembunyikan.

 ╔══════════════════════════════════════════╗
 ║ ⚙️ Kasir / POS                  [✓ Aktif] ║
 ║   Meja kasir, struk thermal, drawer       ║
 ╠══════════════════════════════════════════╣
 ║ 💳 TEMPO / Piutang              [✓ Aktif] ║
 ║   Pelanggan boleh ambil utang, bayar nanti║
 ║   📊 Saat ini: 12 pelanggan aktif TEMPO   ║
 ║   ⚠️ Kalau mati: 12 jadi Cash-Only        ║
 ╠══════════════════════════════════════════╣
 ║ 🚚 Pengiriman                   [✓ Aktif] ║
 ║   Tambah ongkir sebagai baris invoice     ║
 ╠══════════════════════════════════════════╣
 ║ 🏬 Multi-warehouse              [✓ Aktif] ║
 ║   Stok di lebih dari 1 gudang            ║
 ║   📊 Saat ini: 2 gudang                  ║
 ╠══════════════════════════════════════════╣
 ║ 🧾 Akuntansi                    [✓ Aktif] ║
 ║   Buku Besar, Trial Balance, Laporan      ║
 ╠══════════════════════════════════════════╣
 ║ 🛠️ Jasa & Layanan              [✓ Aktif] ║
 ║   Tawarkan jasa selain produk fisik       ║
 ╠══════════════════════════════════════════╣
 ║ 🍳 Resep / BOM                  [☐ Off ]  ║
 ║   Produk dengan komposisi material (F&B)  ║
 ╚══════════════════════════════════════════╝

🧾 PAJAK (regulasi 2026: UU HPP + PMK 131/2024 + PP 55/2022)
   Status pajak toko:
   ⚫ UMKM (PPh Final 0.5%)        ← Garindo
   ⚪ PKP (PPN umum 11%)
   ⚪ Non-PKP

   ┌─ Detail UMKM (PP 55/2022) ──────────────────────┐
   │ Jenis badan: [ OP ▾ ]  (PT/CV/OP/Koperasi/Firma)│
   │ Terdaftar UMKM sejak:  [ 2022-01-01 ]            │
   │ Otomatis expires:      2029-01-01 (OP = 7 tahun) │
   │ ⚠️ 90 hari sebelum expiry kamu akan diingatkan   │
   │   untuk pindah ke skema umum.                    │
   └──────────────────────────────────────────────────┘

   NPWP / NIK:
   ⚫ Pakai NIK sebagai NPWP (Orang Pribadi, Juli 2024)
   ⚪ NPWP legacy (15 digit)
   Nomor: [ 16 digit NIK ............ ]

   ┌─ Detail PKP (kalau mode=PKP) ───────────────────┐
   │ Tanggal registrasi PKP: [ ......... ]            │
   │ Tarif PPN umum:         [ 11.00 % ]              │
   │ Tarif PPN barang mewah: [ 12.00 % ]              │
   │ e-Faktur 3.0:           [✓] aktifkan integrasi   │
   │   (Phase 1: placeholder, infra DJP defer V2)     │
   │ Coretax ID:             [ .......... ]           │
   │   (Phase 1: storage saja, push defer V2)         │
   └──────────────────────────────────────────────────┘

🛠️ MASTER JENIS JASA (muncul kalau Modul Jasa & Layanan ON)

Jasa yang ditawarkan toko. Yang aktif muncul di
Step 2 wizard Catat Penjualan sebagai tombol.

  ┌────────────────────────────────────────────┐
  │ ● Custom Panel               [✓ Aktif]    │
  │   Lump-sum · Lock material approval Owner │
  │                          [Edit]   [Hapus] │
  ├────────────────────────────────────────────┤
  │ ● Wiring Panel               [✓ Aktif]    │
  │   Lump-sum · Lock material approval Owner │
  │                          [Edit]   [Hapus] │
  └────────────────────────────────────────────┘
  [+ Tambah Jenis Jasa]

Edit modal jasa:
  Nama jasa:             [ Custom Panel              ]
  Kode internal:         [ custom_panel              ] (slug)
  Penjelasan:            [ ...                       ]
  Model harga:           ⚪ Lump-sum ⚪ Per-jam
                         ⚪ Per-meter ⚪ Per-unit
  Butuh lock material?   [✓] Owner approve sebelum mulai
  Warna tombol:          [ ungu ▾ ]
  Akun pendapatan:       [ Pilih akun dari COA ▾ ]
  Akun HPP:              [ Pilih akun dari COA ▾ ]
                                          [Simpan]
```

### 7.3 Setting cards pattern (untuk yang BARU saja)

Card-ku tiap setting baru:

```
┌─────────────────────────────────────────────────┐
│ {nama-bahasa-manusia}                       [✓] │
│                                                  │
│ {satu-kalimat-penjelasan apa fitur ini}         │
│                                                  │
│ 📊 Saat ini: {usage stats — kalau ada}          │
│ ⚠️ Kalau dimatikan: {dampak ke data existing}   │
│                                                  │
│ {optional inline config: dropdown/threshold}    │
└─────────────────────────────────────────────────┘
```

**5 prinsip UX:**

1. Plain Indonesian, no jargon ("Kasih utang" bukan "Activate credit terms")
2. Impact preview — tiap toggle nunjukin "saat ini ada X yang pakai, kalau mati jadi Y"
3. Smart defaults — Garindo seed sudah benar; tenant pasif gak perlu sentuh
4. Autosave — tidak ada save button; toggle langsung commit dengan undo toast 5 detik
5. Pengaturan lanjutan di-collapse — 90% tenant cuma butuh checkbox + threshold

**Setting lama (`IdentitasTokoCard`, `JamOperasionalCard`, `RekeningBankCard`, `CostingMethodPanel`, etc.) JANGAN dikutak-katik** — biarkan format sekarang. Hindari refactor.

---

## 8. Cascade Dependency Map

Mapping eksplisit per modul OFF → kode mana yang hide/disable. Diimplementasi di helper module `src/lib/pengaturan/cascadeMap.ts` + Sidebar/menu gating + per-screen guard.

### 8.1 Modul Kasir OFF
- Sidebar: hide menu "Kasir"
- Catat Penjualan wizard Step 1 ChannelSelector: hide tile "Walk-in" channel
- Approval Rules screen: hide section "KASIR" (3 gates disabled)
- 3 approval RPC (`kasir_price_override`, `kasir_void`, `kasir_refund`): RPC raise "MODULE_OFF" jika dipanggil

### 8.2 Modul TEMPO/Piutang OFF
- Sidebar: hide menu "Piutang", hide menu "Tukar Faktur" (kalau ada)
- Customer dropdown di wizard: hide chip "TEMPO OK / CASH ONLY"
- Step 3 Payment wizard: hide tile "TEMPO"
- Approval Rules screen: hide section "PELANGGAN & TEMPO" (4 gates disabled)
- Customer form: hide field `allows_tempo`, `tempo_term`, `credit_limit`
- 4 customer credit RPCs: raise "MODULE_OFF"
- WhatsApp AI: matikan kemampuan AI quote TEMPO

### 8.3 Modul Pengiriman OFF
- Catat Penjualan wizard Step 2: hide field "Ongkos kirim"
- Invoice template: hide line item "Pengiriman"
- Laporan: hide grouping by channel pengiriman

### 8.4 Modul Multi-warehouse OFF
- Sidebar: hide menu "Transfer Gudang"
- Manajemen Gudang: hide button "Tambah Gudang"
- Catat Penjualan wizard Step 2 cart row: hide dropdown warehouse picker, auto-pakai `is_default` warehouse
- Opname: skip warehouse selector, langsung default

### 8.5 Modul Akuntansi OFF
- Sidebar: hide menu "Akuntansi", "Trial Balance", "Buku Besar", "Laporan SAK EMKM"
- Cron job period close + tax accrual: skip
- (Defer implementation sampai Phase 0a akuntansi rilis)

### 8.6 Modul Jasa & Layanan OFF
- Sidebar: hide menu "Pesanan WIP" (kalau ada)
- Catat Penjualan wizard Step 2: hide `RakitButtonsRow` entirely
- Approval Rules screen: hide section "PENJUALAN & JASA" (1 gate `rakit_lock` disabled)
- Pengaturan Modul & Jasa screen: hide section "Master Jenis Jasa"
- 1 approval RPC `rakit_lock`: raise "MODULE_OFF"

### 8.7 Modul Resep/BOM OFF (default)
- Future feature — Phase 1 cuma bikin column. No UI surface change. V3 nanti.

### 8.8 Pajak mode `FINAL_UMKM` (PP 55/2022, 0.5%)
- Invoice template: tampilkan "Termasuk PPh Final 0.5% (PP 55/2022)" footnote
- Laporan Laba Rugi: PPh row auto-calc (omzet × `pajak_final_rate` 0.5%)
- Catat Penjualan Step 3: hide PPN line
- **Expiry alert:** kalau `pajak_umkm_expires_at` < CURRENT_DATE + 90 hari → banner peringatan "Status UMKM kamu akan habis pada {tanggal}. Wajib pindah ke skema umum." di Dashboard + Pengaturan.
- **Auto-transition (defer V2):** trigger pg_cron daily check; bila expires_at lewat, lock UMKM mode + paksa founder pilih PKP atau NON_PKP.

### 8.9 Pajak mode `PKP` (PMK 131/2024 — tarif PPN umum 11%, mewah 12%)
- Catat Penjualan Step 3: tampilkan PPN line dengan rate per-produk:
  - Produk standar → `pajak_ppn_rate_umum` (default 11%)
  - Produk yang flagged `is_barang_mewah=true` (di tabel products, future column V2) → `pajak_ppn_rate_mewah` (12%)
  - Phase 1: assume semua produk pakai tarif umum 11% (toko listrik LTC tidak jual barang mewah).
- Invoice template: split DPP + PPN per baris; footer "PKP — NPWP {pajak_npwp}"
- e-Faktur generator: kalau `pajak_efaktur_enabled=true` → generate XML format e-Faktur 3.0 (infra defer V2, Phase 1 hanya placeholder field).
- Laporan: PPN Keluaran row + PPN Masukan (dari Pembelian PKP supplier)

### 8.10 Pajak mode `NON_PKP` (omzet < Rp 4.8M tapi tidak ambil UMKM)
- Hide PPN line everywhere
- Hide PPh Final auto-calc
- Laporan: PPh OP progressive (skema umum) — calc manual via Akuntansi Phase 0a, BUKAN auto-accrual.

### 8.11 NIK sebagai NPWP (per regulasi DJP Juli 2024)
- Kalau `pajak_nik_as_npwp=true`:
  - Field validation: `pajak_npwp` harus 16 digit (NIK)
  - Invoice template: header tertulis "NIK/NPWP: {16-digit}"
- Kalau false (legacy NPWP 15 digit): validation 15 digit + "NPWP: {15-digit}"

---

## 9. Migration Plan

### 9.1 Migration files

```
20260622000001_tenant_settings_table.sql
  CREATE TABLE tenant_settings + seed Garindo single row (NULL tenant_id)

20260622000002_approval_settings_table.sql
  ALTER TYPE approval_request_type ADD 7 new values
  CREATE TABLE approval_settings + seed 19 rows (Garindo)

20260622000003_service_types_table.sql
  CREATE TABLE service_types + seed 2 rows (Custom Panel, Wiring Panel)
  Backfill existing approval_requests payload.service_type_id where request_type='rakit_lock'

20260622000004_approval_settings_rpc_helpers.sql
  Helper function _check_approval_required(p_type, p_amount, p_qty, p_actor_role) → returns
    enum ('bypass'|'pin'|'wa_button'|'app_inbox')

20260622000005_extend_existing_rpcs.sql
  Patch 12 existing approval RPCs to call _check_approval_required pre-check
  (request_stock_adjustment, request_opname_count, request_initial_stock,
   request_kasir_price_override, request_kasir_void, request_kasir_refund,
   request_price_change, request_customer_credit_activate,
   request_customer_credit_limit_change, request_customer_credit_deactivate,
   request_tempo_write_off, request_rakit_lock)

20260622000006_new_pembelian_approval_rpcs.sql
  CREATE 7 new RPCs untuk Pembelian gates (request_purchase_order_create dst)
  Per-gate _direct_commit companion function
```

### 9.2 Aturan applying

1. Apply via Supabase MCP `apply_migration` ke remote dengan smoke test rollback (DO block + RAISE).
2. Verify Garindo seed values match expected.
3. Verify existing approval flow Garindo tidak berubah (run 5 sample: opname diff, price change, refund, customer credit activate, rakit lock).
4. Verify Pembelian gates default-OFF: run 5 sample Pembelian RPC → langsung commit, no approval request created.

---

## 10. Test Plan

### 10.1 DB-level smoke (via MCP `execute_sql` DO-block, rollback at end)

**Per-gate matrix (19 gates × 4 verification methods × 2 threshold-states = 152 cases):**

```sql
DO $$
DECLARE
  v_actor_id UUID := '...';  -- fake admin user with Owner role
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::TEXT, TRUE);

  -- Case 1.1: gate=adjustment, mode=PIN, no threshold
  UPDATE approval_settings SET approval_required=TRUE, verification_method='PIN', threshold_qty=NULL
    WHERE request_type='adjustment';
  -- Trigger RPC, assert approval_request inserted
  ...

  -- Case 1.2: gate=adjustment, mode=NONE, role-pass
  UPDATE approval_settings SET verification_method='NONE' WHERE request_type='adjustment';
  -- Trigger RPC, assert direct commit
  ...

  -- Case 1.3: gate=adjustment, threshold_qty=5, qty=3 → bypass
  UPDATE approval_settings SET verification_method='PIN', threshold_qty=5
    WHERE request_type='adjustment';
  -- Trigger RPC with qty=3, assert direct commit
  ...

  -- ... (152 cases total)

  RAISE EXCEPTION 'rollback';
END $$;
```

### 10.2 Cascade dependency smoke

**Per-modul OFF check (7 moduls × ~5 surface points each = ~35 cases):**

```sql
-- Modul Kasir OFF
UPDATE tenant_settings SET modul_kasir=FALSE;
-- Assert: ApprovalInboxScreen kasir rows masih bisa di-read tapi tidak bisa create new
-- Assert: kasir_price_override RPC raise 'MODULE_OFF'
-- Assert: get_active_sidebar_items() returns list without 'kasir'
```

### 10.3 UI snapshot

- Pengaturan Approval Rules screen: snapshot test untuk 4 mode global (PIN/WA/INBOX/NONE) + 3 sample threshold values
- Pengaturan Modul & Jasa screen: snapshot test untuk 2 state (all-on vs Jasa-off)
- Catat Penjualan Step 2: snapshot test dengan service_types = 0/1/2/3 rows

### 10.4 Backward-compat verification (Garindo zero-regression)

5 manual scenarios untuk verify perilaku Garindo tidak berubah:
1. Admin minta opname dengan selisih 100rb → Owner PIN dialog muncul (sama seperti sekarang).
2. Admin minta refund kasir 50rb → Owner PIN dialog muncul.
3. Admin aktifkan TEMPO customer baru → Owner PIN dialog muncul.
4. Admin buat PO baru 25jt → langsung commit, no approval (Pembelian OFF default).
5. Catat Penjualan jasa Custom Panel → RakitButtonsRow render dari `service_types` table, tombol "Custom" muncul ungu, tombol "Wiring" muncul biru.

---

## 11. Open Questions

| # | Question | Default if no answer |
|---|---|---|
| OQ1 | WA_BUTTON delivery infra — sekarang verification_method='WA_BUTTON' fallback ke APP_INBOX dengan warning? Atau raise error? | Fallback ke APP_INBOX + emit telemetry event "wa_button_unavailable" |
| OQ2 | Apakah modul switch perubahan harus minta Owner PIN sendiri? (mis. matikan TEMPO = aksi destruktif kalau ada 12 customer aktif) | YES — toggle modul switch ke OFF saat ada usage stats > 0 wajib PIN konfirmasi |
| OQ3 | Apakah service_types yang sudah ada payload aktif (rakit_lock pending) boleh di-delete? | NO — gate `is_active=false` saja, jangan hard delete. Hard delete blocked dengan FK constraint. |
| OQ4 | Pajak mode change dari FINAL_UMKM ke PKP butuh approval/PIN? | YES — perubahan fundamental pajak. Wajib Owner PIN konfirmasi + reason text. |
| OQ5 | Tenant_id column di 3 tabel baru — apakah V2 multi-tenant migration butuh down-time? | Target 0 down-time: pre-V2 backfill script populate tenant_id pada semua row → ALTER COLUMN SET NOT NULL → ALTER TABLE ADD UNIQUE(tenant_id, ...). Plan-nya di V2 spec terpisah. |
| OQ6 | Approval Rules screen "Pengaturan lanjutan" collapse — apa scope advanced (verification method per gate, approver role override, self-bypass)? | YES, semua 3 di advanced collapse. Default user cukup checkbox + threshold. |
| OQ7 | Garindo pajak seed: jenis badan (PT/CV/OP)? Tanggal terdaftar UMKM (untuk hitung expires_at)? NPWP/NIK? | Founder konfirm sebelum apply migration; UI editable post-deploy. |
| OQ8 | e-Faktur 3.0 integration — Phase 1 cuma placeholder field atau build XML generator? | Phase 1 placeholder field saja; XML generator + DJP API integration defer V2 (butuh sertifikat digital DJP, infra effort 1-2 minggu sendiri). |
| OQ9 | Coretax DJP integration — Phase 1 hanya store `pajak_coretax_id` atau real-time push? | Phase 1 hanya field storage; real-time push defer V2. |
| OQ10 | Auto-transition saat UMKM expiry: lock paksa pindah PKP/NON_PKP, atau soft warning saja? | Phase 1: soft warning saja (banner 90 hari sebelum). Auto-lock defer V2 untuk hindari disrupt transaksi tenant. |
| OQ11 | Per-produk barang mewah flag (untuk PPN 12% LBO) — Phase 1 atau defer? | Defer V2. Toko listrik LTC tidak jual LBO. Phase 1 asumsi semua produk PPN 11% umum. |

---

## 12. V2/V3 Backlog (defer)

| Item | Trigger event untuk un-defer |
|---|---|
| Multi-tenant infra (RLS, tenant_id everywhere, login isolation) | Onboard tenant ke-2 LTC |
| Stok flags (Batch/Expired/Serial sebagai fitur) | Onboard tenant Distributor FMCG atau F&B |
| First-run Setup Wizard | Onboard tenant ke-3 (operasional manual sekarang gak skala) |
| Settings Library refactor (search + autosave + cards untuk semua) | Onboard tenant ke-5 (UX scrutiny meningkat) |
| Template editor (invoice/WA variable) | Owner request unik per-tenant branding |
| WA_BUTTON delivery infra | Owner mobile-first request (mau approve dari luar kantor) |
| AI personality config | Tenant non-listrik dengan tone berbeda |
| Custom fields per transaction type | Tenant request field tambahan |
| Notif routing per event | Multi-staff tenant dengan role expansion |
| Audit log retention configurability | Compliance request |
| COA mapping UI | Bareng Akuntansi Phase 0a |

---

## Approval Gates Required Before Implementation

- [ ] Founder review spec (`docs/superpowers/specs/2026-06-21-pengaturan-msme-configurability-design.md`)
- [ ] Konfirmasi Open Questions (OQ1-OQ6 di section 11)
- [ ] Konfirmasi estimasi 12-15 hari kerja masuk akal vs bandwidth Akuntansi Phase 0a paralel
- [ ] Invoke `writing-plans` skill untuk implementation plan setelah approval
