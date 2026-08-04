# Improvement Cetak Sales Order / Penawaran — Design Spec

**Date:** 2026-08-04
**Status:** Design approved — ready for writing-plans
**Reversibility:** Tactical / reversible (no PK shape, no partitioning, no shipped-contract change)
**Source requirements:** `docs/Requirements/requirements-cetak-sales-order-gjp.md`
**Related memories:** `font_sizing`, `no_fake_numbers`, `parallel_terminals_worktree`, `migration_slot_allocation`, `smoke_test_security_definer_rpcs`, `secdef_returning_gap`, `phase_a_secdef_authenticated_gap`, `deploy_verify_after_push`, `manual_prod_gate_after_real_tenant`, `production-testing-tenant`, `direct_launch_skip_phased`

---

## 1. Context

Founder-requested improvement of the SO print output (currently the customer-facing "Penawaran" per the `sales_orders` table comment: *"Sales Order (Penawaran) — pre-commit quote ke customer"*). The current output does not meet the visual expectations of a professional quotation — reference layout provided by Garindo Jaya Panel (GJP, electrical panel manufacturer, first user of the new template).

The new template must:
1. Match a professional-quotation reference layout (banner, doc info, recipient, items table with sub-part bullets + manufacture column, T&C box, catatan box, signature, footer bar).
2. Hydrate every visible field from tenant master data (no hardcoded strings) so any Caleo tenant benefits — GJP is first, others get the same layout automatically with fields they've filled.
3. Be graceful for non-manufacturer tenants (e.g., retail) — MANUFACTURE column auto-hides when unused, sub-parts input is optional.

---

## 2. Goals & non-goals

### In scope (this iteration)
- Visual redesign of the SO PDF template matching the reference layout.
- Master-data hydration (company info, bank accounts, sales-order defaults, footer contact items).
- Customer block with separate salutation + contact person + PT name + WA lines.
- Terbilang (number-to-words Bahasa Indonesia) helper — new pure function.
- Valid Until auto-computation (`order.date + default_so_validity_days`).
- Sub-component bullets under item description (JSONB free-text).
- Per-SO override of Catatan / Syarat & Kondisi / Opening greeting (all optional; NULL falls back to StoreSettings defaults).
- Multi-page support with full header repeat + running footer bar.

### Deferred (follow-up sub-projects)
- `stocks.brand_id` FK link to `product_brands` registry (brand as free-text this iteration).
- `stocks.default_unit_id` FK to `product_units` registry.
- WhatsApp send integration (storage upload + WA API + delivery status).
- QTN-YYMMDD-XXX doc number format (stays SO/YYYY/NNNNN).
- Per-tenant brand color on PDF (`store_settings.brand_color_hex`).
- QR code for QRIS / bank transfer.
- PDF signing / password protection.
- Editable footer with reorderable items (JSONB).
- Multi-language templates (English quotation for foreign customers).

---

## 3. Scope map — modules touched

| # | Module | Change | Effort |
|---|---|---|---|
| 1 | **Pengaturan → StoreSettings** | Add columns (7 SO defaults + 4 footer toggles + telp_kantor + website_url + signatory name + signatory title). UI: extend `IdentitasTokoCard` for telp_kantor/website; new `SalesOrderDefaultsPanel`. | Small |
| 2 | **Customer** | Add `salutation` (`Bapak`/`Ibu`/NULL) + `contact_person_name`. Snapshot to sales_orders at creation. UI: form fields. | Small |
| 3 | **`KasirItem` JSONB shape** | Add optional `brand_name?: string` + `sub_parts?: Array<{name; qty?; unit?}>`. No migration (JSONB). | Small type change; 9 consumer files reviewed. |
| 4 | **`sales_orders`** | Snapshot cols (`customer_salutation`, `customer_contact_person`, `created_by_name`) + override cols (opening_greeting_override, payment_terms_override, lead_time_override, so_notes_override, valid_until_override). | Tiny |
| 5 | **`create_sales_order` RPC** | Extend body to persist new snapshot + override fields from JSONB payload. No signature change. | Small |
| 6 | **PDF template + preview** | Rewrite `salesOrderPdf.ts` layout; new multi-page primitives in `common.ts`; new `terbilang.ts`; `PdfPreviewModal` unchanged (view-only). | Medium-large (the actual deliverable) |

Modules NOT touched: `kasir_transactions`, invoice / SJ templates (keep current), product master (`stocks.brand_id`), WA integration, doc-number RPC.

---

## 4. Data model changes

**Migration:** single slot claimed from the `20261115000560+` range per miss-log Entry #7 codified rule (free boundary advanced to 560+ after the parallel-session slot 521/522 collision incident). Idempotent (uses `IF NOT EXISTS`, CHECK OR NULL, no destructive ops). Implementation MUST first run `git fetch origin main && ls supabase/migrations/20261115*.sql | sort | tail -5` per Entry #7's HARD RULE before claiming.

### 4.1 `store_settings`

```sql
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS telp_kantor                TEXT,
  ADD COLUMN IF NOT EXISTS website_url                TEXT,
  ADD COLUMN IF NOT EXISTS default_so_validity_days   INT     DEFAULT 14 NOT NULL,
  ADD COLUMN IF NOT EXISTS default_payment_terms      TEXT,
  ADD COLUMN IF NOT EXISTS default_lead_time_text     TEXT,
  ADD COLUMN IF NOT EXISTS default_so_notes           TEXT,
  ADD COLUMN IF NOT EXISTS default_opening_greeting   TEXT,
  ADD COLUMN IF NOT EXISTS default_signatory_name     TEXT,
  ADD COLUMN IF NOT EXISTS default_signatory_title    TEXT,
  ADD COLUMN IF NOT EXISTS footer_show_telp_kantor    BOOLEAN DEFAULT TRUE  NOT NULL,
  ADD COLUMN IF NOT EXISTS footer_show_wa             BOOLEAN DEFAULT TRUE  NOT NULL,
  ADD COLUMN IF NOT EXISTS footer_show_email          BOOLEAN DEFAULT TRUE  NOT NULL,
  ADD COLUMN IF NOT EXISTS footer_show_website        BOOLEAN DEFAULT FALSE NOT NULL;
```

**Seed values** — applied in the same migration via `UPDATE store_settings SET <field> = <seed> WHERE <field> IS NULL` per column, so all existing tenants see sensible defaults immediately without needing to touch Pengaturan:
- `default_so_validity_days` = 14
- `default_payment_terms` = "50% DP saat penetapan order, 50% pelunasan sebelum barang diambil"
- `default_lead_time_text` = "7–10 hari kerja setelah uang muka diterima"
- `default_opening_greeting` = "Dengan Hormat, bersama ini kami mengajukan penawaran harga untuk kebutuhan Bapak/Ibu, dengan perincian sebagai berikut:"
- `default_so_notes` = "Harga belum termasuk PPN 11%\nHarga sudah termasuk perakitan dan pengujian\nPengiriman & instalasi tidak termasuk"

### 4.2 `customers`

```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS salutation           TEXT
    CHECK (salutation IN ('Bapak','Ibu') OR salutation IS NULL),
  ADD COLUMN IF NOT EXISTS contact_person_name  TEXT;
```

### 4.3 `sales_orders`

```sql
ALTER TABLE sales_orders
  -- snapshot cols (naming matches existing customer_name/customer_phone pattern, no _snapshot suffix)
  ADD COLUMN IF NOT EXISTS customer_salutation          TEXT,
  ADD COLUMN IF NOT EXISTS customer_contact_person      TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name              TEXT,
  -- per-SO overrides (NULL = fall back to StoreSettings default at render)
  ADD COLUMN IF NOT EXISTS opening_greeting_override    TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms_override       TEXT,
  ADD COLUMN IF NOT EXISTS lead_time_override           TEXT,
  ADD COLUMN IF NOT EXISTS so_notes_override            TEXT,
  ADD COLUMN IF NOT EXISTS valid_until_override         DATE;
```

**Why snapshot `created_by_name` instead of runtime join:**
`sales_orders.created_by uuid REFERENCES auth.users(id)`, but `admin_users.id ≠ auth.users.id` in this repo (mapped by email per migration 20261115000224 — memory-known gotcha). Snapshot at creation avoids repeating the email-join on every PDF render, matches the existing pattern (`customer_name`, `customer_phone`, `customer_company` are all snapshots), and preserves historical accuracy if an admin_user is later renamed.

**Who fills `created_by_name`:** the **client** (in `salesOrderService.ts`), by reading the current user's `admin_users.name` from the existing auth context / hook (client has SELECT on `admin_users` via its `anon full access` policy from migration 20260603000003). Client passes the value in the `p_payload.created_by_name` key. RPC just persists what it receives (or writes NULL if key absent; render-time fallback to `store_settings.default_signatory_name`).

**Why client-side, not RPC-side (audit correction):** an earlier draft had the RPC do the join `auth.uid → auth.users.email → admin_users.email → admin_users.name`. Independent audit flagged the miss-log Entry #4 class trap — SECDEF that reads `auth.*` MUST be `OWNER postgres`, and `create_sales_order` currently has no explicit OWNER (default owner could drift silently). Client-side lookup avoids the trap entirely since admin_users has open-access RLS. RPC does NOT gain a new `auth.*` read; owner-change risk eliminated.

### 4.4 `KasirItem` (TypeScript type — no migration)

```ts
export interface KasirItem {
  // ... existing fields (sku, name, qty, unit_price, discount_amount_rp, ...)
  brand_name?: string;                                     // free-text; PDF auto-hides column if empty across all rows
  sub_parts?: Array<{ name: string; qty?: number; unit?: string }>;  // free-form bullet list
}
```

Backward compatible: undefined fields on existing JSONB rows behave as absent.

### 4.5 `create_sales_order(p_payload jsonb)` RPC

Extend body to read new payload keys and INSERT into the new columns. No RPC signature change (still takes `jsonb`). Follow the existing pattern used for `customer_name`, `customer_phone`, `customer_company`.

**SECDEF hygiene** (per miss-log Entry #4 + `smoke_test_security_definer_rpcs` memory):
- Do NOT change RPC OWNER — leave as-is.
- Smoke-test the updated body with `set_config('request.jwt.claim.sub', ...)` + `RAISE EXCEPTION` at end of DO block to rollback.
- Verify `RETURNING` still works (per `secdef_returning_gap` memory — check that `t_select_own` or equivalent grants SELECT to the RPC owner).

### 4.6 Signatory rendering (no schema change)
- **Name:** `sales_orders.created_by_name` (snapshot); fallback `store_settings.default_signatory_name` when NULL (old SOs).
- **Title:** `store_settings.default_signatory_title` (no per-SO override this iteration).

### 4.7 Bank rekening source
`store_bank_accounts` (tenant receiving accounts — from `pengaturan` migration 20260625000010) — NOT `bank_accounts` (recon module, migration 20260607000001). Filter `is_active = true`, ORDER BY `sort_order`.

### 4.8 Backward compat for existing SOs (rendering)
- NULL `customer_salutation` → omit "Bapak/Ibu" prefix.
- NULL `customer_contact_person` → omit contact-person line entirely.
- NULL `created_by_name` → use `store_settings.default_signatory_name`.
- NULL `sub_parts` → no bullets under item.
- All items NULL `brand_name` → hide MANUFACTURE column (5-column table).
- NULL override fields → use StoreSettings defaults.
- **No auto-re-snapshot on old-SO edit** — preserves historical record.

### 4.9 Discount preservation
Existing per-line discount handling (`KasirItem.discount_amount_rp`) carries over unchanged. Grand Total = sum of net line totals. No column changes.

### 4.10 Post-migration hygiene
Run `mcp__plugin_supabase_supabase__get_advisors` per CLAUDE.md; triage any new perf/security findings.

---

## 5. Layout

A4 portrait, ~10mm margins. Multi-page: full header repeats on every page (Kepada Yth + greeting only on page 1). Table header row repeats top of each page. Footer bar (Telp/WA/Email/Website) on every page. T&C + Catatan + Signature only on LAST page. Items never split across pages (force whole item to next page if it won't fit).

```
┌──────────────────────────────────────────────────────────────────────┐
│ [LOGO]  PT GARINDO JAYA PANEL      ┌────────────────────────────┐   │
│         Electrical Panel & Eng.    │   PENAWARAN HARGA          │   │
│         LTC Glodok Lt.2 Blok A     │   (navy banner, white text)│   │
│         Jakarta                    └────────────────────────────┘   │
│         WA: 0812-3456-7890                                           │
│         Email: sales@gjp.co.id                                       │
│                                     Nomor         : SO/2026/00012    │
│                                     Tanggal       : 04 Agu 2026      │
│                                     Berlaku sampai: 18 Agu 2026      │
│                                     Halaman       : 1 dari 2         │
│                                                                      │
│ Kepada Yth,                                                          │
│   Bapak Andi Wijaya                                                  │
│   PT Solusi Elektrik Nusantara                                       │
│   WhatsApp: 0821-1234-5678                                           │
│                                                                      │
│ Dengan Hormat, bersama ini kami mengajukan penawaran harga untuk     │
│ kebutuhan Bapak/Ibu, dengan perincian sebagai berikut:               │
│                                                                      │
│ ┌────┬─────────────────────┬─────────────┬─────┬──────────┬────────┐│
│ │ NO │ DESCRIPTION         │ MANUFACTURE │ QTY │ UNIT PRC │  TOTAL ││  ← navy header
│ ├────┼─────────────────────┼─────────────┼─────┼──────────┼────────┤│    white text
│ │ 1  │ PANEL INDOOR 300A   │ Schneider   │  1  │15.000.000│15.000k ││
│ │    │  • Box Panel 1.2mm  │             │     │          │        ││
│ │    │  • MCCB 3P 300A     │             │     │          │        ││
│ │    │  • Terminal, Busbar │             │     │          │        ││
│ │    │  • Pemasangan       │             │     │          │        ││
│ ├────┼─────────────────────┼─────────────┼─────┼──────────┼────────┤│
│ │ 2  │ PILOT LAMP RST      │ Chint       │  3  │  150.000 │  450k  ││
│ ├────┴─────────────────────┴─────────────┴─────┴──────────┼────────┤│
│ │                                          GRAND TOTAL:    │Rp18.3M ││  ← highlighted
│ └──────────────────────────────────────────────────────────┴────────┘│
│ Terbilang: Delapan Belas Juta Tiga Ratus Ribu Rupiah  (italic)       │
│                                                                      │
│ ┌────────────────────────────────┬──────────────────────────────┐   │
│ │ Syarat & Kondisi Penawaran     │ Catatan                       │   │
│ │ • Pembayaran: 50% DP, ...      │ • Harga belum termasuk PPN 11%│   │
│ │ • Waktu Pengadaan: 7–10 hari   │ • Sudah termasuk perakitan &  │   │
│ │ • Masa Berlaku: 14 hari        │   pengujian                   │   │
│ │ • Transfer: BCA 123-4567-890   │ • Pengiriman & instalasi      │   │
│ │   a.n. PT Garindo Jaya Panel   │   tidak termasuk              │   │
│ │   (multiple banks stack here)  │                               │   │
│ └────────────────────────────────┴──────────────────────────────┘   │
│                                                                      │
│                                              Hormat Kami,           │
│                                                                      │
│                                                                      │
│                                              ─────────────────      │
│                                              Budi Santoso           │
│                                              Sales Engineer         │
│                                                                      │
│ ══════════════════════════════════════════════════════════════════   │
│ Telp: 021-6234567 │ WA: 0812-3456-7890 │ sales@gjp.co.id            │  ← footer bar
│ ══════════════════════════════════════════════════════════════════   │  every page
└──────────────────────────────────────────────────────────────────────┘
```

### 5.1 Rendering rules

- **Table column headers:** English (`NO | DESCRIPTION | MANUFACTURE | QTY | UNIT PRICE | TOTAL PRICE`) — matches reference verbatim.
- **All other labels:** Bahasa Indonesia (`Nomor`, `Tanggal`, `Berlaku sampai`, `Halaman`, `Kepada Yth`, `Dengan Hormat`, `Terbilang`, `Syarat & Kondisi Penawaran`, `Catatan`, `Hormat Kami`, `PENAWARAN HARGA` banner). `GRAND TOTAL` kept English (standard business term).
- **Multi-page:** full header repeats every page; table header row repeats; "Halaman N dari M" per page.
- **Footer bar:** every page.
- **T&C, Catatan, Signature:** last page only.
- **MANUFACTURE column:** auto-hidden when zero items in the SO have `brand_name` filled → table becomes 5-column.
- **Sub-part bullets:** rendered under item description when `sub_parts` non-empty for that row; row height expands accordingly.
- **Items never split across pages:** if remaining page space < item height, force whole item to next page.
- **Multiple bank accounts:** stack under "Transfer:" section, ordered by `sort_order`, filtered `is_active = true`. **Soft cap 3 accounts on PDF** — if more than 3 active, render first 3 by sort_order + "... dan {N} rekening lainnya (lihat Pengaturan)" line to prevent footer overflow.
- **Rupiah format:** `Rp 15.000.000` (id-ID standard, period thousand separator).
- **Currency precision:** integer rupiah, no sen.
- **Font sizes** (per `font_sizing` memory — base 11-12pt PDF data):
  - Body 11pt
  - Table body 10pt
  - Sub-parts 9pt mid-grey (`#4a5568`) — deliberately secondary
  - Company name 14pt bold
  - Banner ("PENAWARAN HARGA") 16pt bold
  - Footer 9pt
- **Colors** (existing Caleo palette from `common.ts`, no per-tenant customization):
  - Banner + table header background: navy `#012749`, white text
  - GRAND TOTAL row background: `#eff4ff`
  - Body text: black; sub-parts: mid-grey `#4a5568`
- **PDF download filename:** `Penawaran-{so_number}.pdf` (e.g., `Penawaran-SO-2026-00012.pdf`).
- **"Halaman N dari M" rendering:** 2-pass jsPDF render (or post-overlay of page-count text) — standard technique.
- **Icons:** text labels ("WA:", "Email:", "Telp:") — no SVG icons this iteration.
- **NPWP:** omitted from PDF (StoreSettings has field but reference doesn't show it).

---

## 6. User flow

Three touchpoints for the user.

### 6.1 Pengaturan (one-time setup per tenant)

**Extend `IdentitasTokoCard`** (`src/components/pengaturan/IdentitasTokoCard.tsx`): add `Telepon Kantor` + `Website` fields.

**New `SalesOrderDefaultsPanel`** (`src/components/pengaturan/SalesOrderDefaultsPanel.tsx`, sibling to IdentitasTokoCard) under Pengaturan, rendered below IdentitasTokoCard in `PengaturanScreen.tsx`. Fields:
- Masa Berlaku Penawaran (hari) — number input, default 14
- Kalimat Pembuka — textarea, seeded
- Cara Pembayaran — textarea, seeded
- Waktu Pengadaan — textarea, seeded
- Catatan Default — textarea, seeded
- Nama Penandatangan Default — text input
- Jabatan Penandatangan — text input
- Footer PDF: 4 checkboxes (Tampilkan Telepon Kantor / WhatsApp / Email / Website)

### 6.2 Customer create/edit

Add two fields near existing `Nama` + `Nama PT`:
- **Sapaan** dropdown: `— / Bapak / Ibu`
- **Nama Kontak Person** text input

### 6.3 SO create/edit (extend `CatatPenjualanWizard` / Step 2 items)

**Per-line inputs:**
- **Merek** column input — free-text, one per line. Column collapsed by default via on-the-fly derivation: on wizard mount, check if the tenant's most recent 5 SOs had zero `brand_name` usage → collapsed with "Tampilkan Merek" toggle; otherwise expanded. Derivation is runtime, not a stored setting — tenants who start filling brand_name naturally see the column expand from SO #6 onward.
- **Sub-komponen** button per line → opens inline textarea (one bullet per line) → saved as `sub_parts: [{name}]`. Optional qty/unit fields deferred to future.

**Per-SO override section** (collapsible "▼ Override untuk Penawaran ini (opsional)" at end of form):
- Berlaku Sampai — date picker, default computed
- Kalimat Pembuka — textarea prefilled from StoreSettings
- Cara Pembayaran — textarea prefilled
- Waktu Pengadaan — textarea prefilled
- Catatan — textarea prefilled

Empty/unchanged fields → save as NULL → PDF uses StoreSettings default at render.
Any edited field → save value → PDF uses per-SO value.

### 6.4 PDF preview + print

Existing `PdfPreviewModal` — no behavior change. All editing on SO form, preview shows final PDF only, Download button unchanged.

### 6.5 Data flow (create SO)

```
User → SO wizard Step 2 items
   fills merek + sub_parts per line
User → SO wizard override section (optional)
   optionally edits any of 4 default text fields + valid_until
User → Simpan
   salesOrderService.createSalesOrder(payload):
     - client looks up current user's admin_users.name via auth context / hook
     payload.items[]  → include brand_name, sub_parts
     payload         → include customer_salutation, customer_contact_person snapshots
                     → include created_by_name (client-side lookup)
                     → include override fields (or NULL)
   create_sales_order RPC:
     - persists to sales_orders + items JSONB (no auth.* read; no owner-trap risk)
User → Preview PDF
   generateSalesOrderPdf(sales_order, store_settings, store_bank_accounts)
     → renders with defaults-fallback for NULL fields
     → cross-tenant fetch is already blocked by RLS (Phase A t_select_own on sales_orders/customers)
     → PdfPreviewModal
   Download → Penawaran-{so_number}.pdf
```

---

## 7. Testing

| Layer | What & where | Type |
|---|---|---|
| `terbilang.ts` | Table-driven ≥30 fixtures: 0, 1-10, 11-19, tens boundaries, 100-999, 1k-999k, 1M-999M, 1B+, mixed digits, edge (1_000_000 → "satu juta rupiah"), zeros-at-end. | Unit (Vitest) |
| Migration idempotency | Apply migration twice; second run no-op. | Integration |
| `create_sales_order` RPC | Smoke with new JSONB payload via `set_config('request.jwt.claim.sub', ...)` + `RAISE EXCEPTION` rollback. Verify new columns persist. | RPC smoke |
| KasirItem type change | Type compile + existing Vitest for `Step2Items.tsx`, `CartRows.tsx` — behavior unchanged when new fields undefined. | Component |
| `SalesOrderDefaultsPanel` | Save/load cycle. Defaults seed on first render for empty tenant. Save-reload preserves values. | Component |
| Customer form | Save salutation + contact_person; empty → NULL persisted; NULL renders blank. | Component |
| SO wizard extensions | Fill merek + sub_parts on line → save → reload → preserved. Delete last sub_part → array empty. | Component |
| PDF snapshot regression | Generate PDF for `tests/sql/qa-week/2e-regression.sql` fixture → pixel-diff vs `docs/qa-week/pdf-regression/post/10-salesOrder.pdf`. Baseline updated in-PR with founder-approved new visual. | Visual-diff |
| Backward compat SO | Fixture: SO created BEFORE migration (all new fields NULL). Render in new template. No crash, MANUFACTURE column hidden, no salutation prefix, signature falls back to StoreSettings default. | Component + PDF |
| Non-manufacturer tenant | Toko Jaya Makmur SO with no brand_name. Verify MANUFACTURE auto-hidden, 5-column table, layout intact. | Component + PDF |
| Multi-page | Fixture SO with 25 items (some with sub_parts). Verify full header repeats page 2, table header row repeats, "Halaman 1 dari 2" correct, footer bar every page, T&C + Signature last page only, no item split. | PDF |

**CI gates enforced per CLAUDE.md (Stop hooks):**
- `npm run lint`
- `npm run audit:numinput`
- `npm run audit:secdef-null-tenant`
- `npm run audit:no-string-err-fallback`
- `npm run audit:csp-backend-allowlist`
- `npx vitest run --changed`

---

## 8. Rollout — per CLAUDE.md Ship & Verify

### 8.1 Pre-ship setup
- Isolate work in `.claude/worktrees/cetak-so-gjp` (per `parallel_terminals_worktree` memory — DS session in parallel).
- Claim migration slot from `20261115000560+` range (miss-log Entry #7 codified boundary). Before claiming: `git fetch origin main && ls supabase/migrations/20261115*.sql | sort | tail -5` per Entry #7 HARD RULE.
- Use semantic Caleo color tokens from day 1 in new UI. No `text-red-*` / `text-emerald-*` — avoid creating new violations for the parallel DS sweep.

### 8.2 Stage 1 — Local verification (mandatory before deploy)
1. Lint + 4 audits + `vitest --changed` → all green.
2. `npm run dev` → open Pengaturan → verify new SalesOrderDefaultsPanel saves + reloads.
3. Open Customer → verify salutation + contact_person save.
4. Fresh SO with merek + sub_parts on 2 items → save → preview → verify layout matches spec + fields hydrate.
5. SO WITHOUT merek/sub_parts → verify MANUFACTURE column auto-hides → 5-column layout.
6. Multi-page: 25-item SO → verify pagination.
7. Backward compat: reprint an existing (pre-migration) SO → graceful fallback.
8. Smoke `create_sales_order` RPC via MCP with `set_config` + rollback → confirm 200 + fields persisted (including `created_by_name` filled by RPC).
9. Console/network clean throughout.

### 8.3 Visual approval gate (per `manual_prod_gate_after_real_tenant`)
- Generate before/after PDF pairs for GJP + Toko Jaya Makmur (non-manufacturer).
- Save to `public/visual-diff/cetak-so-gjp/{before,after}/`.
- Run `npm run visual-diff:build -- --manifest=public/visual-diff/cetak-so-gjp/manifest.json`.
- Present HTML report path → wait for founder "go" BEFORE opening PR.

### 8.4 Stage 2 — Deploy
- Frontend: `git push` → `cloudbuild.frontend.yaml` → Cloud Run 0% tag `c<SHORT_SHA>` → auto-smoke → 100% on 200.
- Migration: `mcp__plugin_supabase_supabase__apply_migration` (or add to `scripts/apply-pending-migrations.sh`).
- Post-migration: `mcp__plugin_supabase_supabase__get_advisors`.
- Verify `gcloud builds list --limit=2` STATUS != FAILURE per `deploy_verify_after_push`.

### 8.5 Stage 3 — Prod-testing-tenant smoke
- ONLY on Toko Jaya Makmur (`production-testing-tenant` memory).
- Chrome MCP → app.caleo.id → login → SO screen → create test SO → preview PDF → verify layout + backward compat SO reprint.
- Regression → rollback traffic to prior Cloud Run revision + revert migration if needed → log to `docs/incidents/YYYY-MM-DD-<slug>.md`.

### 8.6 Stage 4 — Production rollout
Direct-launch to all eligible tenants once Stage 3 green (per `direct_launch_skip_phased`). No feature flag, no phased rollout. Non-manufacturer tenants get graceful MANUFACTURE auto-hide so no disruption.

---

## 9. Observability (non-negotiable per CLAUDE.md)

| Signal | Where | Payload |
|---|---|---|
| Entry log | Every `generateSalesOrderPdf()` invocation | `{tenant_id, user_id, feature: 'sales_order_print', action: 'generate', so_number, timestamp}` |
| Error log | Each failure branch: missing store_settings, missing bank accounts, missing customer, terbilang failure, jsPDF render failure | `{tenant_id, user_id, feature: 'sales_order_print', error_code, error_message, so_number}` |
| Usage counter | Successful PDF generate | `feature_usage_total{feature="sales_order_print", tenant=<tenant_id>}` |
| Save-defaults log | `SalesOrderDefaultsPanel` save action | `{tenant_id, user_id, feature: 'so_defaults_save', fields_changed: [...]}` |

Log via existing `console.log` + Sentry breadcrumb path per `project_sentry_setup` memory. Metric via existing pattern (or deferred to a shared observability sub-project if none exists).

---

## 10. Cost check (per CLAUDE.md cost discipline)

**Zero new paid-API cost.** No Gemini, no external services, no storage bucket writes at PDF-generate time (PDF is client-side jsPDF, in-memory blob, download only). No cost upgrade needed. No founder approval on billing required.

---

## 11. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Multi-page jsPDF layout bug (variable row height + page break) | Medium | High | Pre-render height measurement; item-never-split rule; 25-item fixture; visual-diff gate |
| KasirItem shape change breaks 9 consumer files | Medium | High | Optional JSONB fields (backward-compatible); explicit consumer list (§12); existing tests must pass |
| `create_sales_order` RPC missing new-field handling → silent NULL | Medium | Medium | Explicit RPC body update in migration; smoke test verifies persistence |
| Client-side `admin_users.name` lookup returns empty (edge: super-admin, provisioning race, or user renamed themselves to blank) | Low | Low | Client passes NULL if lookup empty; PDF falls back to `store_settings.default_signatory_name` |
| `create_sales_order` RPC OWNER unknown (no explicit ALTER FUNCTION OWNER in history) | Low if we don't add auth.* reads | High if we do | AVOIDED by keeping name-lookup on client side (see §4.3 audit correction). RPC gains no new auth.* reads → owner trap does not fire. If future work needs RPC-side auth.* read, MUST add `ALTER FUNCTION ... OWNER TO postgres;` first per miss-log Entry #4 class rule. |
| Migration touches sales_orders during merge with parallel DS session | Low | Medium | Worktree isolation; DS work is code-only (no migration); rebase before merge |
| Terbilang edge cases (huge numbers, ends in zeros, tens-teens) | Low | Low | Table-driven Vitest with ≥30 fixtures |
| Old QA-week PDF fixture becomes stale | High | Low | Baseline updated in-PR with founder-approved new layout; commit both files together |
| Non-manufacturer tenant confused by "Merek" input | Low | Low | Auto-collapse column when tenant's last 5 SOs had zero brand usage; manual expand toggle available |
| Signatory-name mismatch (admin user renamed after SO created) | Very low | Very low | Snapshot is deliberate — preserves historical accuracy |
| User expects to edit T&C in preview modal | Medium | Low | Preview modal has "Edit di form" link jumping back to SO form (implementation detail) |

---

## 12. Impact analysis — `KasirItem` consumers

Grep-verified list of 9 files that reference `KasirItem`:

1. `src/types.ts` — type declaration (extend here)
2. `src/components/KasirScreen.tsx` — kasir (POS) screen — transparent (optional fields ignored)
3. `src/components/penjualan/CartRows.tsx` — cart rendering — transparent
4. `src/components/penjualan/wizard/Step2Items.tsx` — SO wizard items step — **extend** (merek + sub-parts UI)
5. `src/components/penjualan/CatatPenjualanWizard.tsx` — SO wizard container — **wire** (pass through)
6. `src/components/penjualan/wizard/Step3Payment.tsx` — SO wizard payment step — transparent
7. `src/lib/salesOrderService.ts` — SO save path — **extend** (include new fields in payload)
8. `src/components/penjualan/CartRows.test.tsx` — verify still passes
9. `src/components/penjualan/wizard/Step2Items.test.tsx` — verify still passes; add new tests for merek + sub_parts

**Verdict:** 7 non-test call sites, 2 tests, 1 DB touchpoint (`create_sales_order` RPC). 3 sites need real changes (Step2Items, CatatPenjualanWizard wiring, salesOrderService); 4 are transparent thanks to optional fields.

---

## 13. Adjacent flags — noted but out of scope

1. **`stocks.brand_id` FK** — deferred. Brand as free-text on SO line for now.
2. **`stocks.default_unit_id` FK** — same deferral pattern.
3. **WhatsApp send integration** — deferred; requires WA API + storage bucket.
4. **QTN-YYMMDD-XXX doc number format** — deferred; SO/YYYY/NNNNN retained.
5. **Per-tenant brand color on PDF** — deferred; Caleo navy for all tenants.
6. **QR code for QRIS/bank transfer** — deferred.
7. **PDF signing / password protection** — deferred.
8. **Editable footer with reorderable items (JSONB)** — chose simple toggles instead.
9. **Multi-language templates** — deferred.

**Not-a-gap note (audit correction):** An earlier draft of this spec claimed `sales_orders_select_authenticated USING (true)` was a preexisting RLS gap. Audit verified this is FALSE — Phase A migration `20261001000003_phase_a_not_null_and_rls.sql` already replaced that policy with proper tenant-filtered `t_select_own` (`USING (tenant_id = _resolve_tenant_id())`), same for `customers`. No follow-up fix needed; no cross-tenant guard needed.

---

## 14. Confidence markings

- **[VERIFIED]** — I ran the check + result matched
- **[REASONED]** — I applied domain knowledge; did not run a check
- **[ASSUMED]** — I'm guessing; needs verification before acting

Key claims:
- `sales_orders` table already models "Penawaran" per its table comment. **[VERIFIED]** — read migration 20260725000001 line 62-63.
- `sales_orders.items` is JSONB; extending KasirItem needs no ALTER TABLE. **[VERIFIED]** — migration line 10.
- `admin_users.id ≠ auth.users.id` in this repo, mapped by email. **[VERIFIED]** — migration 20261115000224 header comment.
- `common.ts` has no `addPage` calls — multi-page is new work. **[VERIFIED]** — grep result.
- `KasirItem` has 9 consumer files. **[VERIFIED]** — `grep -rn "KasirItem\b" src --include="*.ts*" -l | wc -l = 9`.
- `store_bank_accounts` = tenant receiving accounts; `bank_accounts` = recon module. **[VERIFIED]** — two distinct CREATE TABLEs (migrations 20260625000010 line 41 and 20260607000001 line 4).
- `create_sales_order` exists as an RPC taking JSONB payload. **[VERIFIED]** — migration 20260725000003.
- Reversibility rating (tactical, safe without irreversible-decision memo). **[REASONED]** — no PK shape, no partitioning, all column-adds nullable/defaulted, backward-compat.
- Terbilang correctness with 30 fixtures is sufficient. **[REASONED]** — covers boundary regions of the ID number system.
- `sales_orders` + `customers` RLS is properly tenant-scoped via Phase A `t_select_own` policies. **[VERIFIED]** — read migration 20261001000003.
- SECDEF RPC OWNER of `create_sales_order` — should be verified at implementation, not changed. **[ASSUMED]** — I did not read the RPC body; verify at impl time.
- Migration slot 560+ is the current codified free boundary per miss-log Entry #7 (2026-07-28). **[VERIFIED]** — Entry #7 body confirms boundary advance from 500+ to 560+ after the 521/522 parallel-session collision.

---

## 15. Adversarial critique

- (a) *"Sub-part storage should be a proper child table for reporting"* — rejected: MSME-friendly free-text matches business reality; no reporting requirement stated; YAGNI. Migration to a child table later is a simple JSONB→rows expansion if needed. **[REASONED]**
- (b) *"9 KasirItem consumers is too many — this is really a refactor"* — rejected: optional JSONB fields are backward-compatible at type level; 7 consumers just need to compile-pass. Only 3 need behavior changes. **[VERIFIED via grep]**
- (c) *"Terbilang tests with 30 fixtures overkill"* — rejected: ID number-to-words has 5+ boundary regions × sign cases; 30 covers boundary + typical + adversarial. **[REASONED]**
- (d) *"Visual-diff gate adds friction to every ship"* — accepted trade-off: templates go to CUSTOMERS; silent visual regression = brand damage. Aligned with `manual_prod_gate_after_real_tenant`. **[REASONED]**
- (e) *"Snapshot `created_by_name` loses provenance if user is later deleted"* — actually the opposite: snapshot PRESERVES the name at the moment of authoring. Deleting the auth user later does not blank historical SOs. This is correct behavior. **[REASONED]**
- (f) *"MANUFACTURE auto-hide should be a per-tenant setting"* — rejected: derived from data (auto-hide when all rows empty) requires zero setup. A setting adds a step for the tenant with no upside. **[REASONED]**
- (g) *"Multiple bank accounts in footer might overflow the box"* — mitigated inline in §5.1: soft cap 3 accounts on PDF; the rest visible in Pengaturan. **[REASONED]**
- (h) *"Do we still need any cross-tenant guard as belt-and-suspenders?"* — rejected: RLS is properly tenant-scoped (Phase A `t_select_own` on sales_orders + customers). Extra client-side guard would be code weight with zero real safety gain. YAGNI. **[VERIFIED]**
- (i) *"RPC-side name lookup is cleaner than client-side"* — rejected after independent audit. `create_sales_order` has NO explicit `ALTER FUNCTION ... OWNER TO postgres` in migration history — default owner could be postgres or could have drifted. Adding `SELECT ... FROM auth.users` to the RPC body would hit miss-log Entry #4 class trap (SECDEF reading auth.* MUST own postgres) and could 42501 in prod. Client-side lookup uses admin_users' open-access RLS and avoids the trap entirely. **[VERIFIED via audit]**

---

## 16. Definition of Done (per CLAUDE.md)

- [ ] 7-lens applied; findings surfaced in this spec.
- [ ] Stop-hook gates green: `lint` + 4 audits + `vitest --changed`.
- [ ] Ship & Verify Stages 1 + 2 + 3 completed.
- [ ] `get_advisors` run post-migration; findings triaged.
- [ ] Observability shipped: entry log + error log + usage counter (Section 9).
- [ ] Zero new paid-API cost (Section 10).
- [ ] Reversible / tactical work — no irreversible-decision memo required.
- [ ] `progress.md` updated with WHAT changed + WHY.
- [ ] No unaddressed TODO / dead code in diff.
- [ ] `advisor()` consulted at design phase (this session) + before commit (impl phase).
- [ ] FE UI/UX founder approval obtained (this session, per section).
- [ ] Visual approval gate: before/after PDF pair → founder "go" before PR merge.

---

## 17. Follow-up work spawned

- Vitest fixture for the pre-migration SO reprint case.
- `progress.md` entry linking this spec.
- `docs/qa-week/pdf-regression/post/10-salesOrder.pdf` baseline update (same PR).
- QA-week checklist additions.

---

## 18. Decisions locked during brainstorming

- Doc type: reuse existing `sales_orders` table (already the "Penawaran" per its schema comment). No new table, no new workflow, no new number format.
- Scope: visual redesign + master-data hydration + terbilang + valid-until + sub-parts + editable T&C. Skip: WA-send, QTN format, brand FK link.
- Sub-parts: JSONB free-text on KasirItem; no child table; no product-BOM link.
- Brand: free-text `brand_name` per SO line; no `stocks.brand_id` this iteration.
- Signatory name: snapshot `created_by_name` at SO create; fallback `store_settings.default_signatory_name`.
- Jabatan: `store_settings.default_signatory_title` only.
- Opening greeting: editable, seeded from `store_settings.default_opening_greeting`.
- Multi-tenant fit: auto-hide MANUFACTURE column when unused (no per-tenant flag).
- Rollout: direct-launch all tenants after Stage 3 green.
- Banner: `PENAWARAN HARGA`.
- Table headers: English (matches reference verbatim).
- All other labels: Bahasa Indonesia. `GRAND TOTAL` in English.
- Font sizes: body 11pt / table 10pt / sub-parts 9pt mid-grey.
- Multi-page: full header every page; footer bar every page; T&C+Catatan+Signature last page only; items never split.
- Rupiah format: `Rp 15.000.000` (id-ID period separator).
- Bank accounts: all active from `store_bank_accounts`, sorted by `sort_order`.
- PDF filename: `Penawaran-{so_number}.pdf`.
- No cross-tenant guard — RLS already properly tenant-scoped (Phase A verified).
- `created_by_name` filled by **client** in `salesOrderService.ts` (reads from admin_users via existing session context, passes in payload). NOT filled by RPC. Rationale: avoids miss-log Entry #4 SECDEF owner trap on `create_sales_order` (no explicit ALTER FUNCTION OWNER in migration history, would risk 42501 if extended to read auth.users).
- Migration slot claimed from `20261115000560+` per miss-log Entry #7 codified boundary; MUST fetch-before-claim per Entry #7 HARD RULE.

---

**End of design spec.**
