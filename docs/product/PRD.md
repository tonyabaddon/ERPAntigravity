# ERP Antigravity — Product Requirements Document

> **Status:** Living document. Update with every major learning.
> **Version:** 1.0 (2026-06-09 — initial draft)
> **Owner:** Tony (tonywei.office@gmail.com)
> **Maintenance:** See "Changelog & Maintenance" at the end.

---

## 1. Vision & Positioning

### Vision

Make ERP Antigravity the **single operational and accounting system** Indonesian UMKM use to run their business end-to-end — so the owner stops juggling Jurnal + Desti + WhatsApp + Excel and just has one screen.

### Positioning

**"All-in-One ERP for Indonesian UMKM — Replace Jurnal + Desti + WhatsApp + Excel."**

Today an Indonesian small business commonly runs on:
- **Mekari Jurnal** (~Rp 459-1,200K/month) for accounting / bookkeeping
- **Mekari Desti** for POS + inventory + light CRM
- **WhatsApp** (free, manual) for customer chat — the dominant Indonesian B2C channel
- **Excel** for everything that doesn't fit the above (stock recon, custom reports, ad-hoc)

The four don't talk to each other. The owner pastes data between them, the accountant exports CSVs, and the stockkeeper updates inventory twice. ERP Antigravity collapses the stack:

- Sales (kasir/walkin/marketplace/WA) → Inventory → Accounting all in one ledger.
- WhatsApp AI is **first-class native** — customer chat lands as a sales order draft automatically.
- Anti-fraud / audit-grade controls built in (Pengawasan + Approval system) — the owner can sleep.

### Strategic intent (2026-06-09 decision)

**Pivot SaaS, with Garindo Jaya as the flagship customer / proof-of-concept.**

- Garindo Jaya Panel (toko panel elektrik, Indonesia) drives the near-term product roadmap because they're the paying customer with the most operational depth.
- Architecture must be prepared for **multi-tenant** early so we don't have to retrofit when adding the second customer.
- Post-MVP: pilot 2-3 additional customers in the same/adjacent segment (toko hardware, panel/listrik retail, B2B grosir teknis) before broader go-to-market.

---

## 2. Target Customers & Personas

### Flagship (live now)

**Garindo Jaya Panel** — Indonesian electrical panel retailer + wholesaler.
- ~2 warehouses (atas / bawah), single store.
- Sales channels: walk-in retail, Tokopedia, B2B grosir, WhatsApp inquiry.
- Mix of stock sales + custom panel/wiring services (Rakit).
- Has a bookkeeper (not certified accountant) doing books on Excel + receipts.

### Phase 2 target (after MVP, 2026 H2 estimate)

Small Indonesian B2B+B2C retailers/wholesalers with these characteristics:
- 1-5 warehouses or store locations.
- 50%+ revenue via WhatsApp inquiries or Indonesian marketplaces (Tokopedia/Shopee/Lazada).
- 100-2,000 SKUs.
- Owner-operator or owner + 2-5 staff.
- Currently juggling Jurnal/Accurate + Excel + WhatsApp.
- PKP (must collect PPN) but not yet at the size needing a full ERP like SAP/Oracle.

Adjacent segments to evaluate before Phase 2: **toko hardware / bangunan, suku cadang otomotif, alat listrik, alat kantor, distributor kosmetik kecil**. All have similar shapes: dense SKU catalog, mix of walk-in + marketplace + WhatsApp, owner needs daily kasir close.

### Personas

| Persona | What they do daily | What we sell them on |
|---|---|---|
| **Owner / Pemilik** | Cek omset hari ini, approve harga miring, lihat siapa staff yang ngasih discount paling banyak, deal dengan supplier | "Tidur tenang — semua transaksi tercatat permanen, anti-fraud built-in, omset realtime dari satu layar." |
| **Kasir / Sales** | Catat penjualan walk-in / Tokopedia / grosir / WA, terima customer, terima retur | "Satu form untuk semua channel — Tokped, walk-in, WA, grosir. Auto-print invoice, auto-kurangi stok." |
| **Stockkeeper / Gudang** | Terima barang dari supplier, update stok, opname bulanan, transfer antar gudang | "Stok selalu sinkron, FIFO otomatis, opname dengan saksi anti-fraud." |
| **Bookkeeper / Accountant** | Tutup buku harian/bulanan, lapor PPN, rekonsiliasi bank, prepare laporan keuangan | "Jurnal otomatis dari setiap penjualan, PPN auto-calc, laporan langsung jadi tanpa rekap Excel." |
| **Admin Tokopedia / Marketplace** | Sinkron stok ke marketplace, balas chat marketplace | "Sinkron stok otomatis. Order Tokped masuk langsung jadi sales order." |

---

## 3. Competitive Landscape

### Direct competitors

| Product | Strength | Weakness | Pricing (per bulan) |
|---|---|---|---|
| **Mekari Jurnal** | Accounting depth, PPN ready, Indonesian SME standard, brand trust | Tidak terintegrasi sales/CRM/WA — butuh Desti terpisah. UI berat untuk operational. | Essential 459K, Plus 749K, Pro 1.2M |
| **Mekari Desti** | POS + inventory + light CRM, integrasi ke Jurnal | Hanya satu sisi (sales/inventory). Tidak ada WA AI. Tidak ada anti-fraud monitoring. | (Bundled / separate) |
| **Accurate Online** | Deep accounting, PSAK compliant, sudah lama di pasar | UI legacy, mahal, kurang fokus ke marketplace+WA | 200-1,500K |
| **Bee.id** | Murah untuk toko kecil, banyak fitur kasir | Tidak audit-grade, scaling terbatas | 99-400K |
| **MOKA POS** | POS bagus untuk F&B + retail kecil | Tidak ada accounting lengkap, butuh Jurnal terpisah | 199-549K |

### Indirect competitors

- **Excel / Spreadsheet** — free, full flexibility, painful at scale, no audit trail. Most UMKM start here.
- **Manual buku / nota** — still common in deep micro segment.
- **Custom local ERP konsultan** — Rp 50-200jt one-time, no recurring updates.

### Where ERP Antigravity wins

1. **WhatsApp AI native** — no competitor has automated WA-to-order with AI. Indonesia's #1 B2C channel.
2. **Anti-fraud / Pengawasan** — immutable ledger + monitoring views + approval workflows. Mekari has approvals; we have monitoring AND approvals AND immutability.
3. **Operational-first design** — daily kasir flow is the home screen, not buried under accounting menus.
4. **Multi-channel sales as first-class** — Walk-in, Tokopedia, Grosir, WA all treated as channels of the same Kasir, not bolt-on integrations.

### Where ERP Antigravity loses (today)

1. **Accounting depth** — no chart of accounts, no general journal, no P&L/Neraca/Arus Kas. Bookkeeper still needs Jurnal.
2. **Brand trust / track record** — Mekari has thousands of customers; we have one.
3. **Multi-tenant infrastructure** — no signup, no billing, no per-tenant settings.
4. **Marketplace integration depth** — Tokopedia is a channel name only, no API sync. Shopee/Lazada not represented.
5. **Industry-specific niceties** — barcode/scan, serial numbers, batch/expiry, multi-currency.

---

## 4. Differentiators

1. **WhatsApp AI Sales Pipeline** — Conversation → AI auto-quote → order draft → Pipeline → Kasir confirmation. End-to-end from customer DM to invoice paid, automatic.
2. **Anti-Fraud Built-In** — Pengawasan views (top adjustments, kasir discount per cashier 7d, outflow outliers, transfer aging), immutable stock_movements ledger (REVOKE UPDATE/DELETE + trigger), Approval system with per-action permissions + Owner PIN.
3. **One Atomic RPC = One Sale** — `record_kasir_sale` bundles invoice number + FIFO stock deduction + warehouse decrement + ledger write + kasir insert in one Postgres transaction. No more "partial sale" states; reviewer-grade correctness.
4. **Multi-Channel Native** — Walk-in / Tokopedia / Grosir / WhatsApp / Rakit (custom service) are first-class kasir channels with per-channel invoice prefixes, channel-specific fields (Tokped order no, WA phone+chat), and unified reporting.
5. **Mandatory Witness for Stock Opname** — physical count requires a different person as witness (configurable). Eliminates "ghost stock" the owner can't verify.

---

## 5. Feature Catalog

Legend: ✅ Done (in prod) · 🟡 Partial · ❌ Missing · ⏭️ Future segment

### 5.1 Sales & Front-of-House

| Capability | Status | Notes |
|---|---|---|
| Kasir Harian (daily dashboard + transaction log) | ✅ | KasirScreen with KPI strip, filter, reconciliation |
| Catat Penjualan (PenjualanBaruScreen) | ✅ | Dedicated page, atomic save via `record_kasir_sale` RPC |
| Channel: Walk-in | ✅ | invoice prefix `WLK` |
| Channel: Tokopedia | ✅ | `TPD` + tokped_order_no field |
| Channel: Grosir | ✅ | `GRS` |
| Channel: WhatsApp Manual | ✅ | `WAM` + wa_phone + wa_chat_url |
| Channel: Rakit (custom panel/wiring service) | ✅ | Sub-line types: jasa_custom_panel, jasa_rakit |
| DP (Down Payment) + Pelunasan flow | ✅ | status AWAITING_LUNAS → COMPLETED |
| Mark Lunas with optional ongkir adjustment | ✅ | MarkLunasModal |
| Sales Invoice PDF (DP variant + Lunas variant) | ✅ | Auto-print on save (toggle) |
| Multi-warehouse per cart line | ✅ | atas/bawah selectable per item |
| Customer auto-create on save | ✅ | ON CONFLICT(wa_number) inside RPC |
| FIFO HPP computation per sale | ✅ | Aggregate-then-deduct, per (sku, warehouse) |
| Cancel transaction | ✅ | status=CANCELLED |
| Returns from customer | ❌ | Required for MVP — needs return RPC + ledger reversal |
| Sales person attribution + commission | ❌ | Post-MVP |

### 5.2 Inventory

| Capability | Status | Notes |
|---|---|---|
| Stock master (sku, name, category, price, harga_modal) | ✅ | StockManagerScreen |
| Per-warehouse stock columns (stock_atas, stock_bawah) | ✅ | Two-warehouse only |
| Stock adjustments with approval | ✅ | StockAdjustmentModal + Approval flow |
| Price change requests with approval | ✅ | PriceChangeRequestModal |
| Stock opname (physical count) sessions | ✅ | StockOpnameScreen with witness ack, owner commit |
| Stock movements (immutable ledger) | ✅ | REVOKE UPDATE/DELETE + immutability trigger |
| FIFO stock_lots tracking | ✅ | Lot received_at, qty_remaining, unit_cost |
| Warehouse transfer (atas ↔ bawah) | 🟡 | `transfer_warehouse` RPC exists, Phase 3d UI/state machine partial |
| N warehouses beyond atas/bawah | ❌ | MVP-ready: parameterize warehouse list per tenant |
| Barcode printing | ❌ | Future (Phase 3 — UMKM parity) |
| Barcode scanning | ❌ | Future (Phase 3) |
| Serial number tracking | ❌ | Future (segment-specific, e.g. electronics) |
| Batch tracking + expiry | ❌ | Future (food/pharma segment) |
| Sub-categories (nested) | ❌ | Required for broader retail segment |
| Custom product fields | ❌ | Required for segments with non-standard attributes |

### 5.3 Purchasing

| Capability | Status | Notes |
|---|---|---|
| Purchase Order (PO) | ✅ | Full lifecycle, PoDetailView, PdfGen |
| Supplier management | ✅ | Inline create supplier from PO form |
| Receive Goods modal | ✅ | Per-line received qty + damaged qty + notes |
| Mark as Paid (with proof upload) | ✅ | MarkAsPaidModal + kasir expense entry |
| PO payment due tracking + "telat X hari" badge | ✅ | payment_due_at + isOverdue predicate |
| Purchase Request (PR) before PO | ❌ | MVP — Mekari has it, Garindo informally does it |
| Purchase Quotation | ❌ | MVP-optional |
| Approval workflow on PO above threshold | 🟡 | Approval system exists; need wiring |
| Joining invoices (multi-receipt → single bill) | ❌ | MVP — common pattern |
| Returns to supplier | ❌ | MVP |
| Damaged goods handling | 🟡 | Captured in receive flow, no separate workflow yet |

### 5.4 Customer & CRM

| Capability | Status | Notes |
|---|---|---|
| Customer profile (PelangganScreen) | ✅ | Per-customer order history + stats |
| Customer auto-link via wa_number | ✅ | Across kasir + orders |
| Pipeline (leads + walk-in drafts) | ✅ | Unified across WA leads and walk-in waiting-payment |
| Order History (unified across channels) | ✅ | OrderHistoryScreen with channel filter |
| WhatsApp conversations linked to customer | ✅ | conversations.id ↔ leads.customer_id |
| Customer credit limit / payment terms | ❌ | Post-MVP (B2B grosir segment) |
| Customer segment / tags | ❌ | Post-MVP |
| Lifetime value tracking | ❌ | Post-MVP |

### 5.5 WhatsApp & AI

| Capability | Status | Notes |
|---|---|---|
| WhatsApp connector (whatsmeow) | ✅ | backend-go |
| Multiple WA numbers per tenant | ✅ | wa_numbers table |
| AI auto-respond (Gemini) | ✅ | Conversation state machine |
| Auto-quote from chat (stock check + price reply) | ✅ | CONFIRMING state |
| Order creation from chat | ✅ | BOOKED state → orders.status='PENDING' |
| Sales Inbox (admin can take over) | ✅ | SalesInboxScreen |
| AI active toggle per conversation | ✅ | ai_active boolean |
| Followup reminders (TIMEOUT_REMINDER) | ✅ | followup_count_today + last_followup_date |
| WA payment proof recognition (image/PDF) | 🟡 | Plan exists at `2026-06-04-payment-proof-fix.md` (track status in Phase 4 audit) |

### 5.6 Accounting & Finance

| Capability | Status | Notes |
|---|---|---|
| Bank reconciliation (Rekonsiliasi) | ✅ | Bank statement upload + per-line matching |
| Bank statement PDF upload + parse | 🟡 | UploadPDFModal + reconciliation_service |
| Cash deposit batches | ✅ | cash_deposit_batches table |
| Kasir daily summary (revenue, expense, HPP, profit) | ✅ | DailySummary in dashboard |
| Monthly reconciliation | 🟡 | Plan exists at `2026-06-07-monthly-reconciliation.md`; status TBD |
| Chart of Accounts | ❌ | **MVP-critical** |
| General Journal (manual journal entries) | ❌ | **MVP-critical** |
| Tax mapping & PPN automation (11%) | ❌ | **MVP-critical** for PKP customers (most B2B) |
| Period closing (tutup buku bulanan/tahunan) | ❌ | MVP-critical for accountant workflows |
| P&L (Laba Rugi) report | ❌ | **MVP-critical** |
| Neraca (Balance Sheet) report | ❌ | **MVP-critical** |
| Arus Kas (Cash Flow) report | ❌ | MVP |
| Aged receivables / payables | ❌ | MVP-optional |
| Recurring transactions (sewa, listrik) | ❌ | Post-MVP nicety |
| Multi-currency | ❌ | ⏭️ Future segment (import-focused) |
| E-Faktur DGT / Coretax integration | ❌ | ⏭️ Compliance-grade tier (Open question — see §8) |
| SPT Masa/Tahunan auto-generate | ❌ | ⏭️ Compliance-grade tier |
| E-Bupot integration | ❌ | ⏭️ Compliance-grade tier |
| Foreign exchange handling | ❌ | ⏭️ Multi-currency dependency |

### 5.7 Approval / Governance

| Capability | Status | Notes |
|---|---|---|
| Approval system (PendingApprovalBadge + ApprovalInboxScreen) | ✅ | |
| Per-role permissions (PermissionSet, 30+ keys) | ✅ | Phase 2 anti-fraud foundation |
| Owner PIN verification | ✅ | OwnerPinPad + verify_owner_pin RPC with bcrypt + lockout |
| Approval workflow per action type | ✅ | submit/approve/reject/cancel/withdraw RPCs |
| Configurable thresholds (auto-approve below X) | 🟡 | Mechanism exists, UI configuration partial |
| Multi-level approval (e.g. manager + owner) | ❌ | Currently single-level approver |

### 5.8 Anti-Fraud / Pengawasan

| Capability | Status | Notes |
|---|---|---|
| v_pengawasan_top_adjustments (Phase 4 T1) | ✅ | Largest qty_delta × harga_modal |
| v_pengawasan_kasir_discount_7d (T2) | ✅ | Per-cashier discount aggregation |
| v_pengawasan_outflow_outliers (T3) | ✅ | SKUs with 7d outflow > 3× 90d daily avg × 7 |
| v_pengawasan_transfer_aging (T4) | ✅ | Transfers stuck "initiated" > 24h |
| Stock movements immutability (REVOKE + trigger) | ✅ | Audit-grade |
| Audit trail via approval_requests | ✅ | actor + before/after snapshot |
| Anomaly alerts (auto-DM owner on flag) | ❌ | Post-MVP nicety |

### 5.9 Reporting & Dashboard

| Capability | Status | Notes |
|---|---|---|
| Dashboard (today's omset, pesanan, queue) | ✅ | |
| Laporan (period reports: 7d/30d/90d) | ✅ | LaporanScreen with multi-period |
| Weekly/monthly revenue trend chart | ✅ | groupByDay |
| Per-channel revenue breakdown | ✅ | walkin/tokopedia/grosir/waai |
| Top products | ✅ | |
| P&L / Neraca / Arus Kas (proper financial statements) | ❌ | MVP-critical — currently no proper financial reports |
| Sales by salesperson | ❌ | Post-MVP (when sales attribution lands) |
| Customer-level revenue / margin | ❌ | Post-MVP |

### 5.10 System / Admin

| Capability | Status | Notes |
|---|---|---|
| User management (admin_users + roles) | ✅ | UserManagementScreen |
| Pengaturan (company settings, bank config, notification config) | ✅ | PengaturanScreen |
| Multiple WA numbers + AI toggle | ✅ | WhatsappAiScreen |
| Notification settings (WA reminders, frequency) | ✅ | NotificationSettingsScreen |

### 5.11 SaaS Foundation (Multi-Tenant)

| Capability | Status | Notes |
|---|---|---|
| Multi-tenant data isolation (org_id on every table) | ❌ | **Phase 2 critical** — must land before customer #2 |
| Tenant-aware RLS policies | ❌ | Phase 2 |
| Tenant onboarding / signup flow | ❌ | Phase 4 (GTM) |
| Plan tiers (Essential / Plus / Pro analog) | ❌ | Phase 4 |
| Billing / subscription / Stripe (or Xendit local) | ❌ | Phase 4 |
| Per-tenant settings (currency, fiscal year, tax rate, languages) | ❌ | Phase 2 |
| Per-tenant data export / backup | ❌ | Phase 4 |
| Tenant support tooling (CSM dashboard) | ❌ | Phase 4 |
| Tenant-aware audit log | 🟡 | Approval_requests is tenant-scopable once org_id lands |

### 5.12 Integrations

| Capability | Status | Notes |
|---|---|---|
| Bank statement upload (PDF parse) | 🟡 | Manual upload + parse |
| Bank API sync (auto-import) | ❌ | Future (multi-bank API in Indonesia is fragmented) |
| Marketplace API: Tokopedia API | ❌ | Currently channel name only — future integration |
| Marketplace API: Shopee | ❌ | Future (Phase 3 — UMKM parity) |
| Marketplace API: Lazada | ❌ | Future |
| Accounting export (CSV / Excel for accountant) | ❌ | MVP-recommended |
| Migration from Jurnal (import data) | ❌ | MVP-strategic — key for "replace Jurnal" pitch |
| Migration from Excel | ❌ | MVP-strategic |
| Tax DJP integration (e-Faktur Coretax) | ❌ | ⏭️ Compliance-grade tier |

---

## 6. MVP Scope

**MVP definition:** the minimum viable "All-in-One" that lets Garindo Jaya stop using Jurnal entirely AND that we can pitch to 1-2 pilot customers in the same segment.

### MVP must include

In addition to everything ✅ today:

| Category | Feature | Reason |
|---|---|---|
| Accounting | Chart of Accounts (default 20-30 PSAK-aligned accounts) | Pondasi semua jurnal |
| Accounting | Auto-journaling from kasir + PO + receive → general ledger | Otomasi yang Mekari/Accurate jual |
| Accounting | Manual general journal entries | Bookkeeper butuh untuk transaksi non-rutin |
| Accounting | PPN 11% mapping + automatic VAT-in / VAT-out tracking | PKP customer (most B2B Indonesia) |
| Accounting | P&L statement (filter periode + per-channel) | Bookkeeper must-have |
| Accounting | Neraca (balance sheet, end-of-period) | Bookkeeper must-have |
| Accounting | Arus Kas (cash flow, end-of-period) | Bookkeeper must-have |
| Accounting | Period closing flow (lock period after audit) | Anti-fraud + audit-grade |
| Accounting | CSV/Excel export per report | Accountant compatibility |
| Sales | Returns from customer (with ledger reversal) | Real-world operational need |
| Purchasing | Returns to supplier | Real-world operational need |
| Purchasing | PR (Purchase Request) → PO step + approval | Mekari has it; common workflow |
| SaaS | Multi-tenant data isolation (org_id everywhere) | Block on customer #2 onboarding |
| SaaS | Per-tenant settings (PPN rate, fiscal year, default currency=IDR) | Reusability |
| Onboarding | Migration: import Excel COA / opening balance / customers / SKUs | Reduce switching cost |

### MVP excludes (deferred)

- Multi-currency (Garindo IDR-only; defer to Phase 3 UMKM parity)
- Barcode print / scan (defer to Phase 3)
- Serial numbers, batch tracking (defer to segment-specific)
- E-Faktur Coretax integration (defer until accounting-depth decision is made — see §8)
- Marketplace API sync (defer — channel naming is enough for MVP)
- Sales commission attribution (defer)
- Multi-level approvals (single-level enough for MVP)
- Full self-serve signup + Stripe billing (Phase 4 GTM)

### MVP success criteria

1. Garindo Jaya stops using Jurnal — bookkeeper does 100% of bookkeeping inside ERP Antigravity for at least 1 full month.
2. Bookkeeper accepts the P&L / Neraca / Arus Kas as accurate enough to share with the owner.
3. PPN report can be exported in a format that matches what's needed for the next SPT Masa.
4. At least 1 pilot customer outside Garindo onboarded with the multi-tenant model.

---

## 7. Post-MVP Phases

### Phase 2 — SaaS Foundation Hardening + Pilot

After MVP, with Garindo running stable and 1-2 pilot customers onboarded:

- Tenant-aware audit log + per-tenant export
- Multi-level approval workflows
- Anomaly alerts (auto-DM owner on Pengawasan flags)
- Better marketplace integration (Tokopedia API sync if pilot demands)
- Warehouse transfer state machine completion (Phase 3d)
- Sales attribution + commission tracking

### Phase 3 — UMKM Feature Parity (broaden segment)

Expand beyond toko panel/elektrik:

- Multi-currency (for import-heavy retailers)
- Barcode print + scan
- Sub-categories + custom product fields
- Marketplace API: Shopee, Lazada
- Recurring transactions
- Customer credit limit + payment terms
- Batch tracking + serial numbers (if a target segment demands)

### Phase 4 — GTM / Commercial Layer

- Self-serve signup
- Stripe (or Xendit local) billing
- Plan tiers (Essential / Plus / Pro)
- Onboarding wizard + import-from-Jurnal tooling
- Marketing site
- CSM tooling, in-app support chat

### Phase 5 — Compliance & Scale (TBD)

- Decision-gated by Open Question (§8) on accounting depth
- E-Faktur Coretax, SPT auto-gen, E-Bupot
- Multi-period comparison reports
- Audit-grade financial statements (PSAK compliant)
- Tax engine for non-IDR currencies + multi-country (if international)

---

## 8. Open Strategic Questions

These need answers before / during MVP planning. Each blocks specific work.

| # | Question | Why it matters | Decision needed by |
|---|---|---|---|
| Q1 | **Accounting depth: Level 1 (good-enough), 2 (accountant-grade), or 3 (compliance-grade)?** | Determines scope of Sec 5.6 work — Level 1 is 4-8 weeks, Level 3 is 6-12 months | Before MVP scope finalized |
| Q2 | **Target segment after Garindo: toko panel/elektrik only, or broader retail?** | Affects whether Phase 3 features (barcode, batch, etc.) become MVP or stay deferred | After MVP launch |
| Q3 | **Pricing model: per-tenant flat, per-user, freemium, setup-fee?** | Affects multi-tenant cost-of-goods architecture decisions; Garindo is internal but plan tiers need shape | Before Phase 4 |
| Q4 | **Migration tooling: invest in "import from Jurnal" or just CSV import?** | Strong differentiator for "replace Jurnal" pitch; significant effort if direct import | Before Phase 4 (or earlier as MVP optional) |
| Q5 | **Timeline to MVP, to first non-Garindo customer?** | Determines team size + funding burn rate | Before MVP planning |
| Q6 | **Engineering team size: solo, 2-3 devs, or larger?** | Determines feasible velocity and parallel work | Now |
| Q7 | **Marketing/sales channel: direct, partner (akuntan kantor), content, paid ads?** | Affects which features are GTM-critical (e.g. accountant-friendly export matters for partner channel) | Before Phase 4 |
| Q8 | **Accounting compliance: target PSAK + e-Faktur, or stay "good enough"?** | Subset of Q1 but bigger — determines whether we pursue medium-business segment | Before Phase 5 |
| Q9 | **Support model: chat support, dedicated CSM, self-serve docs?** | Affects pricing and per-tenant operational cost | Phase 4 |
| Q10 | **Multi-tenant architecture: shared schema with org_id (recommended) vs schema-per-tenant?** | Affects performance, backup, isolation; must decide before MVP backend work | Before MVP backend work begins |

---

## 9. Changelog & Maintenance

### How to use this document

- This is a **living document**. Every major learning (new customer interview, completed phase, competitor launch, accounting compliance change) should result in a PR updating it.
- The **Feature Catalog (§5)** is the canonical source of truth for "what we have / what we need". Sub-project specs in `docs/superpowers/specs/` should reference the catalog rows they implement.
- **Open Questions (§8)** should be reviewed at every monthly product check-in. When a question is decided, move it to the Changelog with the decision.
- **MVP Scope (§6)** is frozen once a phase begins. Changes to MVP scope mid-phase require explicit rationale logged here.

### Changelog

| Date | Version | Changes |
|---|---|---|
| 2026-06-09 | 1.0 | Initial draft after Mekari Jurnal benchmark. Established All-in-One positioning, Garindo flagship → SaaS pivot intent, decomposed 4 sub-projects (A-D), framed open questions Q1-Q10. |

### Related documents

- Mekari Jurnal benchmark source: `docs/competitive-research/mekari-jurnal/Results Benchmark/Summary_Mekari Jurnal_09062026.docx` + `.mov`
- Current implementation: `progress.md`
- Active backlog: `docs/superpowers/plans/2026-06-09-post-overhaul-backlog.md`
- Per-feature specs: `docs/superpowers/specs/`
- Per-feature plans: `docs/superpowers/plans/`
