# ERP Antigravity (Vosi) — End-to-End Build Snapshot

> **Snapshot date:** 2026-06-12
> **Purpose:** Comprehensive inventory of EVERYTHING shipped to date, designed to be diff-compared against Mekari Jurnal / Mekari Qontak / Mekari Desty demo recordings. The output of that diff feeds the Phase 1 roadmap.
> **Companion docs:**
> - Vision & target state — `docs/product/PRD.md`
> - Chronological build log — `progress.md` (4,569 lines, 250+ task entries)
> - Mekari benchmark videos — `docs/competitive-research/mekari-jurnal/Results Benchmark/*.mov`

---

## 0. How to read this document

1. **§1 — TL;DR** is a one-page summary you can hand to a non-technical reviewer.
2. **§2 — Architecture** covers stack + boundaries (frontend / backend-go / Supabase / Edge Functions).
3. **§3-§14** are the **module-by-module catalog** organized by business domain. Each module section answers four questions:
   - *What it does*
   - *Where the code lives*
   - *Key features (✅ shipped)*
   - *Known gaps / partial (🟡) / missing (❌)*
4. **§15 — Cross-cutting capabilities** (audit, permissions, FIFO, timezone).
5. **§16 — Differentiators vs Mekari** — what Vosi has that Mekari doesn't, and vice versa.
6. **§17 — Side-by-side mapping** so you can mentally diff against the .mov recordings.
7. **§18 — Recommended Phase 1 lenses** for when you come back.

Legend: ✅ shipped · 🟡 partial · ❌ missing · ⏭️ deferred to later phase

---

## 1. TL;DR — what's been built

Vosi today is a **multi-channel sales + inventory + WhatsApp-AI ERP** for a single tenant (Garindo Jaya Panel). It runs end-to-end:

- **Front-of-house** — kasir POS for Walk-in / Tokopedia / Grosir / WhatsApp / Rakit (custom panel service), with DP + Lunas split, multi-warehouse stock pick per line, auto-print invoice PDF, atomic FIFO HPP computation in one Postgres RPC (`record_kasir_sale`).
- **Inventory** — Dual-warehouse stock (atas/bawah), FIFO lot tracking, immutable `stock_movements` audit ledger, opname with witness + Owner approval, adjustment + price-change with evidence upload and approval workflow.
- **Purchasing** — Full PO lifecycle: draft → ordered → received (with damage handling) → paid, PDF generation, supplier directory, overdue-payment indicator.
- **CRM-ish** — Customer 360 (Pelanggan), unified Order History across all channels, Lead/Walk-in Kanban Pipeline.
- **WhatsApp AI ("Calista")** — Go daemon (whatsmeow + Gemini 2.5 Flash-Lite) handling state-machine conversation (GREETING → COLLECTING → CLARIFYING → STOCK_CHECK → CONFIRMING → BOOKED), auto-order creation, 48h booking timer, followup poller, debounce (typing buffer), admin take-over via Sales Inbox.
- **Approvals (Phase 2 fraud foundation)** — Single `approval_requests` table fronting six request types (adjustment, opname, price_change, kasir_*, rakit_lock) with Owner PIN (bcrypt + 5-fail lockout) AND WhatsApp button decision channel, 30-min default expiry + sweeper. Immutable ledgers and append-only triggers backstop every state transition.
- **Bank reconciliation (Phase 2)** — 6-step wizard, multi-bank account, PDF statement upload → Gemini OCR → bank_statement_lines → classified into lanes (GREEN/YELLOW/ORANGE/RED/GRAY) → matched to `payable_slots` auto-generated when an order enters WAITING_PAYMENT.
- **Reports & Dashboards** — Dashboard (today's omset, channel mix, AI vs manual chat), Laporan (7/30/90d trends + top products), Pengawasan views (top adjustments, kasir-discount-7d, outflow outliers, transfer aging).
- **Admin** — User Management with 30+ granular permissions, Pengaturan (company, bank, WA recipients, logo), Notification Settings (interval-based heartbeat reports).

What is **NOT** there: General Ledger / Chart of Accounts, P&L / Neraca / Arus Kas, PPN automation, period closing for bookkeeping, return-from-customer + return-to-supplier flows, multi-tenant org_id, marketplace API sync, mobile app, barcode print/scan, multi-currency, e-Faktur DGT.

**One-sentence positioning:** Today Vosi can run a panel/elektrik retailer's daily operations + WhatsApp customer pipeline + audit-grade inventory, but it cannot yet replace Mekari Jurnal for the bookkeeper.

---

## 2. Architecture & Tech Stack

### 2.1 Topology

```
┌────────────────────────────────────────────────────────────────┐
│                       Browser (React SPA)                      │
│  Vite + React 19 + TailwindCSS 4 + Recharts + jsPDF + Lucide   │
└────────────────────────────────────────────────────────────────┘
            │                                       │
            │ Supabase JS SDK (REST + Realtime)    │ fetch / poll
            ▼                                       ▼
┌─────────────────────────────────┐   ┌────────────────────────────┐
│        Supabase Postgres        │◀──│       backend-go           │
│  • 41 tables, 47 RPCs           │   │  Go 1.x, whatsmeow,        │
│  • Immutable ledgers (triggers) │   │  Gemini 2.5 Flash-Lite,    │
│  • RLS (open model + gates)     │   │  Cloud Run / daemon mode   │
│  • Realtime (postgres_changes)  │   │  HTTP API:                 │
│  • Auth (OTP)                   │   │   /api/health              │
│  • Storage (stock-evidence,     │   │   /api/wa/qr               │
│      payment proofs, logos)     │   │   /api/wa/status           │
│  • Edge Function:               │   │   /api/wa/logout           │
│      send-admin-invite          │   │   /api/wa/debug            │
│                                 │   │   /api/approval/wa-webhook │
└─────────────────────────────────┘   │   /api/recon/upload        │
            ▲                         │   /api/recon/close         │
            │ LISTEN/NOTIFY           │                            │
            └─────────────────────────│ Pollers (1-min ticks):     │
                                      │  • followup poller         │
                                      │  • heartbeat poller        │
                                      │  • approval expiry poller  │
                                      │  • booking-timeout sched.  │
                                      └────────────────────────────┘
                                                  │
                                                  ▼
                              ┌─────────────────────────────────────┐
                              │  WhatsApp (whatsmeow websocket)     │
                              │  • Customer DM                      │
                              │  • Owner approval buttons           │
                              │  • Admin/Owner heartbeat reports    │
                              └─────────────────────────────────────┘
```

### 2.2 Repo layout

```
ERPAntigravity/
├── src/                            React SPA
│   ├── App.tsx                     Page router (19 named pages)
│   ├── components/                 Screens + modal + subfolders
│   │   ├── approval/               ApprovalRequestRow, RakitLockApprovalRequestRow, PendingApprovalBadge
│   │   ├── pembelian/              PurchaseOrderFormPage + form/{SupplierPicker, StockPicker, ItemRow, InlineSupplierForm}, MarkAsPaidModal, ReceiveGoodsModal, ReceiveReplacementModal, PoDetailView
│   │   ├── penjualan/              ChannelStrip, ItemSearchPanel, CartRows, CustomerPanel, PaymentPanel, RakitButtonsRow, RakitInlineForm, MarkLunasModal, LockSubmissionModal, SalesInvoicePDF
│   │   ├── stok/                   StockOpnameScreen, StockOpnameSessionView, StockAdjustmentModal, PriceChangeRequestModal
│   │   └── rekonsiliasi/           WizardSteps, OrdersColumn, MutasiColumn, CashColumn, ClassificationModal, MappingDrawer, AddBankAccountModal, UploadPDFModal, TallyBar, CompletionSummary
│   ├── hooks/                      useRealtimeConversations, useRekonsiliasi
│   ├── lib/                        supabaseClient.ts (all services), pembelianService.ts, salesEntries.ts, format.ts, pdf/purchaseOrderPdf.ts
│   ├── types.ts                    All DTOs + enums (Permission, Order, Lead, Kasir, Approval, Rakit, Reconciliation, etc.)
│   └── initialData.ts              Seed for localStorage fallback dev mode
│
├── backend-go/                     Go daemon (Cloud Run)
│   ├── main.go                     HTTP server + poller bootstrap + WA init + graceful shutdown
│   ├── internal/
│   │   ├── api/approval_webhook.go POST /api/approval/wa-webhook
│   │   ├── approvals/expiry_poller.go
│   │   ├── assets/prompts.go       Calista system prompt
│   │   ├── db/                     conversations, orders, messages, customers, leads, payment, approvals, followup, heartbeat, bank_config, wa_recipients, stock, recon_* (+ tests)
│   │   ├── engine/                 state machine, parser, prompt builder, retry/backoff
│   │   ├── followup/poller.go      Daily-quota WA reminders
│   │   ├── gemini/                 client.go (chat), document.go (PDF OCR)
│   │   ├── heartbeat/poller.go     Periodic revenue/low-stock summaries to admins via WA
│   │   ├── models/types.go         DTOs
│   │   ├── recon/                  classifier, matcher, name_similarity, special_cash/edc/internal, types
│   │   ├── rules/escalation.go     Wiring/admin keyword detection
│   │   ├── scheduler/timeout.go    24h reminder + 48h cancel timers
│   │   ├── storage/                Supabase Storage uploads
│   │   └── whatsapp/               client, handler, sender, debounce, approval_sender, typing, clock (+ tests)
│   ├── go.mod                      whatsmeow, generative-ai-go, lib/pq
│   ├── Dockerfile                  Alpine multi-stage, CGO_ENABLED=0
│   └── README.md
│
├── supabase/
│   ├── migrations/                 82 timestamped SQL files (oldest 20260531000000)
│   └── functions/send-admin-invite TypeScript/Deno Edge Function (Gmail SMTP)
│
├── docs/
│   ├── product/PRD.md              Vision, target state, MVP scope, open questions
│   ├── superpowers/specs/          Per-feature specs (brainstorming output)
│   ├── superpowers/plans/          Per-feature implementation plans
│   ├── competitive-research/       Mekari benchmark + .mov + Summary docx
│   ├── deploy/                     Deployment notes
│   ├── haloai-demo/, mekari-demo/  Live demo recordings & analysis
│   └── vosi-landing/               Marketing site source
│
├── tests/integration               Vitest integration tests
├── progress.md                     Chronological build log (~4.5k lines)
├── CLAUDE.md                       Project gotchas (update progress.md every task)
├── package.json                    React 19, Vite 6, jsPDF, Recharts, motion, qrcode.react
└── vosi-landing/                   Public landing page
```

### 2.3 Notable tech choices

| Layer | Choice | Why it matters |
|---|---|---|
| Frontend framework | React 19 + Vite 6 + TypeScript ~5.8 | Modern; Vite-native dev; type-safe DTOs throughout |
| Styling | Tailwind 4 (Vite plugin) | No design system; utility-first |
| Charts | Recharts 3.8 | Used in Dashboard + Laporan |
| PDFs | jsPDF 2.5 + jspdf-autotable | Sales invoice + PO PDF |
| Realtime | Supabase Realtime (postgres_changes) + 30s poll fallback | Conversations, orders, approvals |
| Backend lang | Go (CGO disabled) | Statically linked; Cloud Run friendly |
| WA integration | whatsmeow (websocket multidevice) | Session persisted in Postgres |
| LLM | Gemini 2.5 Flash-Lite (chat) + Gemini 2.5 Vision (PDF OCR) | Chat agent + bank statement parser |
| Cron/poll | In-process goroutines, 1-min ticks | No external scheduler |
| Inter-process | Postgres LISTEN/NOTIFY (6 channels) | Realtime backend→frontend nudges |
| Auth | Supabase Auth OTP | Passwordless; dev bypass with 123456 |
| Storage | Supabase Storage (`stock-evidence`, payment proofs, logos) | Evidence attached to approvals |
| Deploy | Cloud Run (backend) + Vite static build for frontend | Stateless container; 8-second graceful shutdown |

---

## 3. Module — Sales / Front-of-House (Kasir + Penjualan Baru)

### 3.1 What it does

Capture every sale across all channels and lock cost basis at the moment of sale.

### 3.2 Code locations

- `src/components/KasirScreen.tsx` — daily ledger + KPI strip + filter
- `src/components/PenjualanBaruScreen.tsx` — new-sale workflow
- `src/components/penjualan/*` — sub-components
- DB: `kasir_transactions`, `kasir_counters`, `orders` (when walk-in or WhatsApp)
- RPC: `record_kasir_sale`, `next_kasir_number`, `mark_walkin_order_paid`, `deduct_stock_fifo`, `decrement_stock`

### 3.3 Shipped ✅

| Capability | Detail |
|---|---|
| Kasir Harian dashboard | Date picker (WIB default), KPI: omset, expense, COGS, gross/net profit, items sold |
| Status filter | PAID, AWAITING_LUNAS, COMPLETED, CANCELLED, WIP, PENDING_LOCK_APPROVAL |
| Channel breakdown chips | Walk-in 🚶, Tokopedia 🛒, Grosir 📦, WhatsApp 💬 |
| Payment method tally | Cash, Transfer, QRIS, EDC |
| Inline expense add | 6 categories: Gaji, Utilitas, Transportasi, Pembelian Stok, Marketing, Lain-lain |
| Daily report PDF | "Cetak Laporan Harian" button |
| **Penjualan Baru — channel-aware fields** | Tokopedia order#, WA phone+chat URL, Walk-in default |
| Customer panel | Autocomplete from `customers` or inline create (ON CONFLICT wa_number) |
| Item search | Live SKU/name search; qty × unit_price; per-line warehouse atas/bawah selector |
| Rakit service lines | jasa_rakit + jasa_custom_panel inline form with estimated price |
| DP split payment | AMOUNT or PERCENT input; ongkir/shipping fee toggle |
| Invoice PDF auto-print | SalesInvoicePDF (Lunas variant + DP variant) |
| Mark Lunas flow | MarkLunasModal — second/final payment, optional ongkir adjust |
| Atomic save | `record_kasir_sale` RPC bundles: invoice# reservation + customer upsert + FIFO deduct + warehouse decrement + ledger write + insert |
| WIP draft for Rakit | Cart with no SKU (pure-jasa) supported (recent fix 2026-06-12) |
| Cancel transaction | Marks status=CANCELLED (legacy path; rakit-specific cancel via `cancel_rakit` RPC) |

### 3.4 Gaps / partial

| Item | Status |
|---|---|
| Returns from customer | ❌ Critical for MVP |
| Sales person attribution + commission | ❌ Post-MVP |
| Kasir gate workflows (price override, void, refund) | 🟡 Approval rows render in inbox but action buttons stubbed (Phase 3b) |
| Open/close kasir shift | 🟡 Permission exists (can_open_kasir_shift) but no shift state machine |

---

## 4. Module — Inventory (StockManager + Opname + Warehouse Transfer)

### 4.1 What it does

Master catalog, dual-warehouse stock, physical count cycle, immutable ledger.

### 4.2 Code locations

- `src/components/StockManagerScreen.tsx`
- `src/components/stok/*`
- DB: `stocks`, `stock_lots`, `stock_lot_consumption`, `stock_movements` (immutable), `stock_price_history` (immutable)
- RPC: `seed_stock_row`, `_log_stock_movement`, `decrement_stock`, `deduct_stock_fifo`, `transfer_warehouse`, `start_opname_session`, `record_opname_count`, `witness_acknowledge_opname`, `submit_opname_for_owner`, `commit_opname`, `request_adjustment`, `commit_approved_adjustment`, `reject_adjustment`, `request_price_change`, `commit_approved_price_change`

### 4.3 Shipped ✅

| Capability | Detail |
|---|---|
| Stock master CRUD | sku/name/category/price/harga_modal/stock_atas/stock_bawah |
| Category-specific specs | Panel (material, tipe_pasang, dimensions, ketebalan_mm, finishing, kelengkapan), MCB (merek, ampere, phase), Kabel (tipe, mm², panjang), Aksesori |
| CSV bulk import | sku + nama + kategori + harga + harga_modal + stok + spec columns |
| CSV bulk export | Full catalog with specs |
| Dual-warehouse layout | stock_atas + stock_bawah (sync trigger maintains legacy `stock` column) |
| FIFO lot tracking | `stock_lots` (po_id, unit_cost, qty_remaining, received_at); seed lots dated 10 years ago to consume first |
| Immutable audit ledger | `stock_movements` with `qty_before + qty_delta = qty_after` CHECK; REVOKE UPDATE/DELETE + trigger blocks even service_role |
| Source enum on ledger | purchase_receive, sale_wa, sale_kasir, transfer_out, transfer_in, adjustment, opname_variance, correction, return_kasir, seed |
| Stock adjustment with approval | StockAdjustmentModal — qty_delta, reason_code (rusak/hilang/sampel/koreksi/korjual_admin), evidence upload, submit → `request_adjustment` RPC |
| Evidence enforcement | rusak/hilang require ≥1 evidence URL (DB-level check) |
| Price change with approval | PriceChangeRequestModal — old/new for price or harga_modal, append-only `stock_price_history` after commit |
| Stock Opname session | StockOpnameScreen — types: full, per_kategori, per_sku_list; scope_payload jsonb |
| Two-person rule | CHECK counted_by ≠ witnessed_by (schema-level); UI guard friendly error |
| Snapshot pattern | system_qty_snapshot frozen at session start; variance auto-computed (GENERATED ALWAYS) |
| Witness acknowledge | `witness_acknowledge_opname` RPC |
| Submit for owner | `submit_opname_for_owner` builds approval_request with variance_total_value |
| Commit on owner approve | `commit_opname` writes per-row stock_movements with source='opname_variance' |
| Warehouse transfer | `transfer_warehouse` RPC writes paired transfer_out + transfer_in ledger rows |

### 4.4 Gaps / partial

| Item | Status |
|---|---|
| N>2 warehouses per tenant | ❌ Hard-coded atas/bawah |
| Warehouse transfer state machine | 🟡 Single-step RPC; Phase 3d two-step (initiate → receive) not yet built |
| Barcode print + scan | ❌ Phase 3 |
| Serial number tracking | ❌ Segment-specific (e.g. electronics) |
| Batch tracking + expiry | ❌ Food/pharma segment |
| Sub-categories (nested) | ❌ Required for broader retail |
| Custom product fields | ❌ Required for non-panel segments |

---

## 5. Module — Rakit (Custom Assembly Service)

### 5.1 What it does

Track WIP for custom-panel / wiring services where price/components are uncertain at the time of customer commitment; lock cost via Owner approval before invoicing.

### 5.2 Code locations

- `src/components/WipListScreen.tsx`
- `src/components/penjualan/RakitButtonsRow.tsx`, `RakitInlineForm.tsx`, `LockSubmissionModal.tsx`
- `src/components/approval/RakitLockApprovalRequestRow.tsx`
- DB: `rakit_job_lines`, `rakit_components`, `rakit_audit_log`, view `kasir_rakit_forfeit_summary`
- Linked tables: `kasir_transactions` (status state machine WIP → PENDING_LOCK_APPROVAL → AWAITING_LUNAS/PAID, plus lock_submitted/approved/rejected audit fields)
- RPC: `submit_rakit_lock`, `withdraw_rakit_lock`, `reject_rakit_lock`, `approve_rakit_lock`, `cosmetic_edit_rakit`, `material_edit_rakit`, `cancel_rakit`, helper `_rakit_audit`

### 5.3 Shipped ✅

| Capability | Detail |
|---|---|
| Inline form on Penjualan Baru | jasa_rakit and jasa_custom_panel with description + estimated_price |
| Auto-WIP draft creation | If cart contains rakit_lines, `insertWipWithRakit` service creates kasir_tx with status=WIP |
| WIP list screen | Shows transactions in WIP; "🔒 Selesaikan Rakit" opens LockSubmissionModal |
| Lock submission | Owner-HPP-override per line, material-edit flag, submit → creates approval_request |
| Two tracking modes | `detail` (component BOM with fifo_cost_snapshot) vs `lumpsum` (fixed labor_cost or lump_sum_hpp) |
| Owner approval path | Owner approves via ApprovalInbox → `approve_rakit_lock` deducts components and writes ledger |
| Cosmetic edit | After lock, prices-only edits allowed (transitions PENDING_LOCK_APPROVAL again) |
| Material edit | Components edits — reverses previous adjustment ledger (`adjustment_reversal`) before re-applying |
| Cancellation with forfeit | `cancel_rakit` splits DP into refund + forfeit; reports via `kasir_rakit_forfeit_summary` view |
| Full audit | `rakit_audit_log` records every state transition with before/after JSONB |

### 5.4 Gaps / partial

| Item | Status |
|---|---|
| Component picker UX in submission modal | 🟡 Owner can override but UI for full BOM TBD |
| Multi-line cosmetic edit batch | ✅ Supported |
| Per-component supplier link | ❌ Not modeled |

---

## 6. Module — Purchasing (Pembelian)

### 6.1 What it does

PO lifecycle from supplier to receipt to payment, including damage handling.

### 6.2 Code locations

- `src/components/PembelianScreen.tsx`
- `src/components/pembelian/*` (PurchaseOrderFormPage, PoDetailView, ReceiveGoodsModal, MarkAsPaidModal, ReceiveReplacementModal, SupplierPicker, InlineSupplierForm, StockPicker, ItemRow)
- `src/lib/pembelianService.ts`
- `src/lib/pdf/purchaseOrderPdf.ts`
- DB: `suppliers`, `purchase_orders`, `purchase_order_items`
- RPC: `generate_po_number`, `receive_purchase_order`, `receive_replacement`

### 6.3 Shipped ✅

| Capability | Detail |
|---|---|
| Tabs: Orders + Suppliers | Two-tab layout |
| Supplier directory | Inline add/edit/delete; usage-frequency sort |
| PO list | Sorted by created_at DESC, status pills (DRAFT/ORDERED/RECEIVED/PAID), MTD KPIs |
| Overdue indicator | "Telat X hari" if payment_due_at < today |
| Create PO form | Supplier select (or inline create), expected receive date, tax rate, items, notes, save as DRAFT or ORDERED, audit fields |
| Sequential PO number | `generate_po_number` → PO-YYYY-MM-NNN (date-stamped) |
| Receive goods | Per-line qty_received + qty_damaged + damage_notes + damage_status (NONE/PENDING_RETURN/RETURNED/REPLACED); atomically updates stock + lot + ledger row per line |
| Mark as paid | Upload payment proof; logs payment_verified_at + verified_by; creates kasir expense entry |
| Receive replacement | Modal for damaged-item replacement flow |
| PO PDF download | Button in PoDetailView (jsPDF + autotable) |
| Audit fields | created_by_user_id, updated_by_user_id, expected_receive_date (migration 20260608) |

### 6.4 Gaps / partial

| Item | Status |
|---|---|
| Purchase Request (PR) → PO step + approval | ❌ MVP gap (Mekari has this) |
| Purchase Quotation | ❌ Optional MVP |
| PO approval workflow above threshold | 🟡 Approval system exists; not wired to PO |
| Joining invoices (multi-receipt → single bill) | ❌ MVP gap |
| Returns to supplier (full flow) | ❌ MVP gap |
| Standalone damaged goods workflow | 🟡 Captured in receive flow only |

---

## 7. Module — Customer & CRM (Pelanggan + Pipeline + Order History)

### 7.1 What it does

Unified customer profile and a Kanban-style funnel that mixes WhatsApp leads + walk-in waiting-payment drafts.

### 7.2 Code locations

- `src/components/PelangganScreen.tsx`
- `src/components/PipelineScreen.tsx`
- `src/components/OrderHistoryScreen.tsx`
- `src/lib/salesEntries.ts` (merges orders + kasir_transactions)
- DB: `customers`, `leads`, joined views of `orders` + `kasir_transactions`
- RPC: order/lead status updaters

### 7.3 Shipped ✅

| Capability | Detail |
|---|---|
| Customer list | Aggregate order_count + total_spend |
| Customer profile | Name/company/phone + edit inline + full order history + lead history + kasir history |
| Customer auto-link | by wa_number (UNIQUE constraint) — works across kasir + orders |
| Pipeline Kanban | NEW, IN_PROGRESS, ESCALATED, ORDERED, DROPPED columns |
| Mixed pipeline entries | DbLead (from WhatsApp AI) + DbOrder (walk-in waiting-payment) |
| Order History unified | Merged orders + kasir_transactions; channel filter; 15+ status badges; left-border color coding |
| Order detail | InvoiceModal with print; Mark Lunas; payment proof view |

### 7.4 Gaps / partial

| Item | Status |
|---|---|
| Drag-drop status transitions | 🟡 View-only currently |
| Customer credit limit + payment terms | ❌ B2B grosir post-MVP |
| Customer segments / tags | ❌ Post-MVP |
| Lifetime value tracking | ❌ Post-MVP |

---

## 8. Module — WhatsApp AI ("Calista") + Sales Inbox

### 8.1 What it does

Go daemon ingests WhatsApp messages, drives a Gemini-backed state machine to qualify a customer, builds a cart, books an order, and notifies the customer/admin/owner via WA messages. Frontend Sales Inbox lets a human take over.

### 8.2 Code locations

- Backend: `backend-go/internal/whatsapp/*`, `backend-go/internal/engine/*`, `backend-go/internal/gemini/*`, `backend-go/internal/scheduler/timeout.go`, `backend-go/internal/followup/poller.go`, `backend-go/internal/heartbeat/poller.go`, `backend-go/internal/rules/escalation.go`, `backend-go/internal/assets/prompts.go`
- Frontend: `src/components/SalesInboxScreen.tsx`, `src/components/WhatsappAiScreen.tsx`, `src/hooks/useRealtimeConversations.ts`
- DB: `conversations`, `messages`, `orders`, `leads`, `customers`, `whatsapp_numbers`, `wa_recipients`, `notification_config`, `stocks` (for stock lookup)
- HTTP API: `/api/wa/qr`, `/api/wa/status`, `/api/wa/logout`, `/api/wa/debug`, `/api/approval/wa-webhook`

### 8.3 Shipped ✅

| Capability | Detail |
|---|---|
| QR pairing | Polls `/api/wa/qr`; auto-connect on scan; status to CONNECTED |
| Multiple WA numbers | `whatsapp_numbers` table; per-number `is_enabled` + `is_ai_enabled` toggles |
| Calista state machine (11 states) | GREETING → COLLECTING → CLARIFYING → STOCK_CHECK → CONFIRMING → ADD_MORE → DELIVERY → BOOKED → TIMEOUT_REMINDER → COMPLETED/CANCELLED; ESCALATED_ADMIN / ESCALATED_WIRING terminal |
| Language detection | id / en switching |
| Collected data jsonb | Name, company, address, product, qty, specs, cart |
| Stock lookup during STOCK_CHECK | `SearchStockByName` lookup; gates "out-of-stock" path |
| Order creation from chat | At CONFIRMING → BOOKED, creates orders row (status=PENDING_ADMIN_CONFIRMATION, expires_at=+48h) |
| Booking timer scheduler | In-memory + DB persistence; 24h reminder + 48h auto-cancel; survives daemon restart via RestoreOnBoot |
| Sales Inbox (frontend) | Visual stepper, AI ↔ Admin take-over toggle, escalation actions, real-time messages |
| AI active toggle | `conversations.ai_active` boolean — admin can mute AI mid-conversation |
| Debounce (typing buffer) | Soft 5s / hard 12s window; media always drains; typing indicator while buffering |
| Stale message drop | Filter messages > 5 min old on reconnect (avoids replay storms) |
| Group/broadcast filter | Skip @lid groups and broadcasts |
| Followup poller | 1-min tick; max 2 follow-ups/conv/day (WIB-aware); bilingual templates |
| Heartbeat poller | Periodic revenue + low-stock summary to wa_recipients per `notification_config` |
| LISTEN/NOTIFY channels | admin_messages, order_approved, payment_verified, payment_rejected, dp_verified, dp_proof_rejected — backend → frontend nudges |
| Approval WA webhook | Owner taps button → POST `/api/approval/wa-webhook` → resolve approval_id by wa_message_id or fallback to latest pending → `decide_via_wa_button` RPC |
| Payment proof recognition | 🟡 Plan exists at `2026-06-04-payment-proof-fix.md` (track in Phase 4 audit) |
| Retry / 429 handling | 3× exponential backoff; immediate bail on 429 |
| WhatsApp screen UI | QR display, daemon log terminal, sample Go+Node webhook integration snippets |

### 8.4 Gaps / partial

| Item | Status |
|---|---|
| Marketplace API (Tokped/Shopee/Lazada) sync | ❌ Channel name only |
| Multiple Calista personalities / multi-tenant prompts | ❌ Single hardcoded prompt |
| Voice transcription | ❌ |
| Catalog browsing UX (interactive list) | ❌ Text-only |

---

## 9. Module — Approval / Governance (Phase 2)

### 9.1 What it does

Single approval request table fronts six request types. Owner can decide in-app (PIN) or via WhatsApp button. Append-only audit. Immutable downstream ledgers.

### 9.2 Code locations

- `src/components/approval/*` (ApprovalInboxScreen lives in `src/components/` root; ApprovalRequestRow + RakitLockApprovalRequestRow + PendingApprovalBadge under `approval/`)
- DB: `approval_requests` (immutable except via `_transition_approval` helper), `stock_adjustments`, `stock_opname_sessions`, `stock_opname_counts`, `price_change_requests`
- RPC: `_transition_approval`, `verify_owner_pin`, `decide_via_wa_button`, `expire_pending_approvals`, plus per-type request/commit/reject RPCs
- Helper Go file: `backend-go/internal/api/approval_webhook.go` + `internal/approvals/expiry_poller.go`

### 9.3 Shipped ✅

| Capability | Detail |
|---|---|
| Single approval_requests table | request_type enum (adjustment, opname, price_change, kasir_price_override, kasir_void, kasir_refund); payload jsonb |
| Lifecycle | pending (default expiry +30m) → approved / rejected / expired |
| _transition_approval helper | Sole sanctioned UPDATE path; SECURITY DEFINER; revoked from anon/authenticated |
| Disabled-UPDATE trigger | Default; allows helper to pass while blocking everything else |
| Enabled-DELETE trigger | Always blocks deletion |
| Decision channels recorded | wa_button / owner_pin / app_inbox / auto_expire |
| Owner PIN | bcrypt-hashed (pgcrypto crypt); per-Owner lockout after 5 fails (1h window); explicit "PIN not set" error |
| WA button decision | `decide_via_wa_button` checks Owner role + valid decision; trusts Go webhook signature |
| Expiry sweeper | `expire_pending_approvals` granted only to service_role; per-row safe (swallows concurrent race) |
| Stock adjustment flow | request_adjustment → approval_request + stock_adjustments; on approve → commit_approved_adjustment (FOR UPDATE locks, qty math guards) |
| Opname flow | start → record → witness_acknowledge → submit_for_owner → commit_opname (writes ledger per row) |
| Price change flow | request_price_change → approval + price_change_requests; on commit → updates stocks + append-only stock_price_history |
| Rakit lock flow | submit_rakit_lock → withdraw / reject / approve / cancel; multi-action audit log |
| Frontend Approval Inbox | Filter pills (Adjustment / Harga / Opname / Rakit Lock / Kasir); approve / reject inline; realtime + 30s poll fallback |
| Permission gates | can_approve_adjustment, can_approve_price_change, can_commit_opname, etc. checked client-side |

### 9.4 Gaps / partial

| Item | Status |
|---|---|
| Kasir price-override / void / refund actions | 🟡 Rows render in inbox but action buttons stubbed (Phase 3b) |
| Multi-level approval | ❌ Single approver only |
| Threshold-based auto-approve UI | 🟡 Mechanism exists, configuration UI partial |
| Anomaly alert auto-DM owner | ❌ Post-MVP |

---

## 10. Module — Anti-Fraud / Pengawasan (Phase 4 views)

### 10.1 What it does

Read-only views the Owner can scan to spot fraud signals.

### 10.2 Code locations

- DB views: `v_pengawasan_top_adjustments`, `v_pengawasan_kasir_discount_7d`, `v_pengawasan_outflow_outliers`, `v_pengawasan_transfer_aging`
- Frontend consumer (TBD; the views exist, integration UI varies by screen)

### 10.3 Shipped ✅

| View | What it shows |
|---|---|
| v_pengawasan_top_adjustments | Largest absolute rupiah variance from committed `stock_adjustments` (qty_delta × harga_modal), joined to actor name |
| v_pengawasan_kasir_discount_7d | Per-cashier discount aggregation, last 7d (revenue leakage signal) |
| v_pengawasan_outflow_outliers | SKUs where 7d outflow > 3× (90d daily avg × 7) — bulk movement signal |
| v_pengawasan_transfer_aging | Transfers stuck in "initiated" for >24h (Phase 3d two-step refactor will give this teeth) |
| Append-only audit | All approval decisions + ledger rows are immutable; SQL drill-down possible |

### 10.4 Gaps / partial

| Item | Status |
|---|---|
| Dedicated Pengawasan dashboard UI | 🟡 Views exist; integration spots vary; not a single screen |
| Anomaly auto-alert | ❌ Manual review for now |
| Anomaly snooze / acknowledge | ❌ |

---

## 11. Module — Bank Reconciliation (Rekonsiliasi)

### 11.1 What it does

6-step wizard for monthly reconciliation: bank accounts → upload PDF → review classified bank lines → cash deposits → payables matching → close.

### 11.2 Code locations

- `src/components/RekonsiliasiScreen.tsx`
- `src/components/rekonsiliasi/*`
- `src/hooks/useRekonsiliasi.ts`
- Backend: `backend-go/internal/recon/*` (handler, engine, classifier, matcher, name_similarity, special_cash/edc/internal)
- DB: `bank_accounts`, `bank_imports`, `bank_statement_lines`, `bank_line_allocations`, `payable_slots`, `cash_deposit_batches`, `reconciliation_periods`, `reconciliation_settings`, `reconciliation_audit_log`
- Triggers: `create_slots_for_order` (auto-create slots on WAITING_PAYMENT), `sync_slot_after_allocation` (recompute matched_amount + status)
- HTTP API: `POST /api/recon/upload`, `POST /api/recon/close`

### 11.3 Shipped ✅

| Step | Detail |
|---|---|
| 1. Bank accounts | List + add (bank_code BCA/MANDIRI/BRI/BNI/PERMATA/CIMB/OTHER, account_number, account_label, purpose: OPERATIONAL/OWNER_PERSONAL/SAVINGS/OTHER) |
| 2. Upload PDF | Multipart form to `/api/recon/upload`; Gemini 2.5 Vision OCR; insert lines into bank_statement_lines; dedup via SHA256 hash |
| 3. Review bank lines | Lanes GREEN (auto-match) / YELLOW (possible) / ORANGE (review) / RED (discrepancy) / GRAY (unclassified); manual reclassify via ClassificationModal |
| BankLineKind enum | CUSTOMER_PAYMENT, EDC_SETTLEMENT, CASH_DEPOSIT, SUPPLIER_PAYMENT, EXPENSE, BANK_FEE, INTERNAL_TRANSFER, LEGACY_PERIOD, UNKNOWN (… plus a few more in the matcher) |
| Scoring | Amount tolerance, name similarity (Levenshtein), date window (back 14 / forward 7 default), confidence thresholds (green=0.90, yellow=0.75, orange=0.70) |
| EDC MDR detection | edc_mdr_min_pct=0.50% / edc_mdr_max_pct=1.50% bracket |
| Internal transfer loop detection | Special handler in `recon/special_internal.go` |
| 4. Cash deposit batch | Expected vs deposited; variance reasons (PETTY_CASH, HITUNG_KURANG, HITUNG_LEBIH, LAINNYA); status PENDING/DEPOSITED/CARRY_OVER |
| 5. Payables matching | Auto-created `payable_slots` per order via trigger (DP + BALANCE if payment_type='DP'; else FULL); drag-drop or click-match to allocate bank line |
| 6. Close month | `/api/recon/close` → reconciliation_periods.status='CLOSED'; immutable audit log of every match/unmatch/write_off/extend |
| Audit | reconciliation_audit_log captures before/after JSON per edit |

### 11.4 Gaps / partial

| Item | Status |
|---|---|
| Bank API auto-sync (multi-bank Indonesia) | ❌ Fragmented; deferred |
| First-eligible period cutoff | ✅ Configured via reconciliation_settings.first_eligible_period_start (avoids retroactive slot creation) |
| Per-period close PDF export | 🟡 reconciliation_periods.pdf_storage_path column exists; render path TBD |
| Variance journal entries | ❌ Tied to General Ledger gap |

---

## 12. Module — Reports & Dashboard (Laporan)

### 12.1 What it does

Period-based summary reports + KPI cards + charts.

### 12.2 Code locations

- `src/components/DashboardScreen.tsx`
- `src/components/LaporanScreen.tsx`
- Service: `reportsService` in `src/lib/supabaseClient.ts`

### 12.3 Shipped ✅

| Report | Detail |
|---|---|
| Dashboard today | KPI: today's omset, pesanan, queue; low-stock badge; activity log; quick nav |
| Period selector (7d / 30d / 90d) | Both Dashboard + Laporan |
| Revenue trend | Daily/weekly bar chart |
| Channel mix | Walk-in / Tokopedia / Grosir / WhatsApp split |
| Top products | reportsService.fetchTopProducts |
| AI vs manual conversations | useRealtimeConversations stats |
| Daily summary PDF | Cetak Laporan Harian from KasirScreen |

### 12.4 Gaps / partial

| Item | Status |
|---|---|
| P&L (Laba Rugi) | ❌ **MVP-critical** |
| Neraca (Balance Sheet) | ❌ **MVP-critical** |
| Arus Kas (Cash Flow) | ❌ **MVP-critical** |
| Aged receivables / payables | ❌ MVP-optional |
| Sales by salesperson | ❌ Post-MVP |
| Customer-level revenue / margin | ❌ Post-MVP |
| Cross-period comparison | ❌ |
| CSV/Excel export per report | ❌ |

---

## 13. Module — Admin & Settings (Pengaturan + Users + Notifications)

### 13.1 What it does

Tenant settings, user RBAC, notification config.

### 13.2 Code locations

- `src/components/PengaturanScreen.tsx`
- `src/components/UserManagementScreen.tsx`
- `src/components/NotificationSettingsScreen.tsx`
- DB: `company_settings`, `bank_config`, `wa_recipients`, `notification_config`, `admin_users` (+ pgcrypto for PIN), `admin_invitations`
- Edge function: `supabase/functions/send-admin-invite` (Gmail SMTP)

### 13.3 Shipped ✅

| Capability | Detail |
|---|---|
| Company settings | name, address, phone, email, NPWP, logo upload to storage bucket |
| Bank config (legacy single-row) | bank_name, account_number, account_name, is_active |
| WA recipients | role (admin/owner) + name + wa_number + is_active toggle |
| Notification settings | Master enable + interval (4h/8h/12h/daily/custom) + report toggles (revenue/queue/activity/status) + low_stock_alert + delay_alert thresholds + recipients |
| User management | Add/edit/deactivate users; email-based invite via Edge Function |
| 30+ granular permissions | Dashboard, SalesInbox, Laporan, AIStock, Pipeline, Pelanggan, OrderHistory, Pembelian, Kasir, Reconciliation, can_create_po, can_edit_po, can_request/approve_adjustment, can_start/witness/commit_opname, can_request/approve_price_change, can_open/request/approve kasir_* gates, can_override_price_floor, can_initiate/receive_transfer, can_view_pengawasan |
| Role templates | Owner / Staff Admin Toko / Supervisor Gudang / Finance Manager / Custom |
| Owner PIN setup | bcrypt-stored approval_pin_hash + lockout counters |
| OTP auth | Supabase Auth + 6-digit OTP (production) + dev bypass 123456 |
| Send-admin-invite Edge Function | Bearer-auth, HTML email, app link |

### 13.4 Gaps / partial

| Item | Status |
|---|---|
| Multi-tenant org_id | ❌ Single-tenant only |
| Per-tenant settings (currency, fiscal year, tax rate, language) | ❌ |
| Tenant onboarding wizard | ❌ |
| Plan tier + billing | ❌ |
| Audit log UI | 🟡 Tables exist (approval_requests, reconciliation_audit_log, rakit_audit_log, stock_movements) — no unified UI |

---

## 14. Module — WhatsApp infrastructure & ops (backend-go runtime concerns)

### 14.1 What it does

Reliability layer for WhatsApp connection + Gemini + Postgres.

### 14.2 Shipped ✅

| Capability | Detail |
|---|---|
| Stateless container | Cloud Run; binds 8080; HTTP starts before WA init so probe succeeds early |
| Session persistence | whatsmeow store in Postgres (`sqlstore`) — survives redeploys |
| Graceful shutdown | 8-second window to drain debounce buffer + WA disconnect |
| Reconnect resilience | If WA hangs, WA-dependent endpoints return safe defaults |
| Heartbeat ticker | 1-min loop respecting WIB business hours (7am–10pm) |
| Booking timer recovery | RestoreOnBoot re-registers reminder + cancel timers from active orders |
| LISTEN/NOTIFY trigger model | DB triggers fire NOTIFY on order/payment state changes; Go subscribers push WA messages |
| Structured logs | `[PACKAGE] message` prefixes |
| Connection pool | 10 open, 5 idle, 5min max lifetime |
| Tests | Per-package: classifier_test, matcher_test, machine_test, parser_test, prompts_test, retry_test, handler_test, handler_routing_test, debounce_test, debounce_integration_test, approval_sender_test, expiry_poller_test, poller_test (heartbeat/followup), approvals_test, stock_movements_test, record_kasir_sale_test, pengawasan_test |

### 14.3 Env vars

```
SUPABASE_DB_CONNECTION   PG conn string
GEMINI_API_KEY           Gemini API key (required)
SUPABASE_URL             Supabase URL (recon writer)
SUPABASE_SERVICE_KEY     Admin key (recon writer)
PORT                     8080
WA_NUMBER_ID             wa_1
DEBOUNCE_ENABLED         false (default)
DEBOUNCE_SOFT_WAIT_MS    5000
DEBOUNCE_HARD_WAIT_MS    12000
```

---

## 15. Cross-cutting capabilities

### 15.1 Audit & immutability

- **Stock ledger** (`stock_movements`) — REVOKE UPDATE/DELETE from PUBLIC, anon, authenticated, AND a trigger that blocks even service_role. `chk_qty_math` CHECK constraint enforces `qty_before + qty_delta = qty_after`. Source enum names every cause. Corrections must be a new compensating row, never an edit.
- **Price history** (`stock_price_history`) — same append-only pattern with its own trigger.
- **Approval requests** (`approval_requests`) — DELETE always blocked, UPDATE only via the SECURITY DEFINER `_transition_approval` helper. The disabled-UPDATE-trigger pattern is the canonical way the helper can pass without exposing the table to direct mutation.
- **Rakit audit log** — every transition (create / submit / withdraw / approve / reject / cosmetic_edit / material_edit / cancel / pelunasan) writes a row with before/after JSONB.
- **Reconciliation audit log** — same pattern, indexed by period+time.

### 15.2 Permissions (RBAC)

Permissions are a `JSONB` on `admin_users`. Frontend services check both screen-level perms (Dashboard, SalesInbox, Laporan, AIStock, Pipeline, Pelanggan, OrderHistory, Pembelian, Kasir, Reconciliation) AND action-level perms (request_adjustment, approve_adjustment, start_opname, witness_opname, commit_opname, request_price_change, approve_price_change, open_kasir_shift, request/approve kasir_price_override / void / refund, override_price_floor, initiate/receive transfer, view_pengawasan, create_po, edit_po). Roles (Owner / Staff Admin / Supervisor Gudang / Finance Manager) preload sensible defaults; permissions then override per user.

### 15.3 FIFO costing

- `stock_lots` rows created on every PO receipt with `unit_cost` from the PO line.
- **Seed lots** for pre-existing stock dated 10 years ago (so they consume first).
- `deduct_stock_fifo` walks lots ORDER BY received_at ASC, deducts `LEAST(remaining_qty, lot.qty_remaining)`, accumulates cost.
- Aggregate cost goes into a single `stock_movements` row (not per-lot).
- Distribute cost proportionally across kasir item lines (`hpp_per_unit`, `hpp_subtotal`).
- Fallback if lots exhausted: use `stocks.harga_modal` at 1:1 (logs WARNING).

### 15.4 Timezone (WIB)

All date filters use `wibDateString()` helper; period boundaries computed in WIB midnight; backend pollers gate by WIB business hours. Notable past fix: "WH-1 / WIB midnight ISO timestamp for range filters" (2026-06-02 and 2026-06-09 catch-up sweep).

### 15.5 Realtime + fallback poll

Approvals, conversations, orders subscribe via Supabase Realtime; a 30-second poll backstop runs in parallel to mask Realtime hiccups.

### 15.6 Auth model

OTP via Supabase Auth; `admin_users` joined to auth user via email; on login the user's `permissions` jsonb is loaded into `currentUser`. Single Owner per deployment is assumed (`FirstOwnerAdminUserID()` returns the lowest-id owner).

---

## 16. Differentiators vs Mekari

### 16.1 What Vosi has that Mekari doesn't

| Capability | Why this matters |
|---|---|
| **Native WhatsApp AI sales pipeline** | Customer DM → AI quote → order draft → Pipeline → Kasir confirm, automatic. Mekari needs Qontak (Rp 400k+/user/mo) and there's still no AI auto-quote. |
| **Single atomic sale RPC** | `record_kasir_sale` bundles invoice# + FIFO HPP + warehouse decrement + ledger write + insert in one Postgres transaction. No "partial sale" states. |
| **Multi-channel kasir as first-class** | Walk-in / Tokped / Grosir / WhatsApp / Rakit are channels with per-channel invoice prefixes (WLK / TPD / GRS / WAM / RKT), channel-specific fields, and unified reporting. Mekari treats marketplace as integration plug-ins. |
| **Audit-grade immutable ledgers** | REVOKE + trigger combo blocks even service_role from rewriting history. Mekari has approval workflows; Vosi has approvals AND monitoring AND immutability. |
| **WhatsApp button decision channel** | Owner approves stock adjustments / opname / price changes from their phone via WA button — no need to log into the dashboard. |
| **Two-person rule for opname** | CHECK constraint guarantees counter ≠ witness. Schema-level. |
| **Rakit (custom-service) state machine** | WIP → PENDING_LOCK_APPROVAL → AWAITING_LUNAS with cosmetic vs material edit paths and cancel-with-forfeit. Mekari has nothing equivalent for custom-service revenue. |
| **Bank-reconciliation lanes with Gemini OCR** | PDF upload → AI parses → auto-matches 70%+ of customer payments to open `payable_slots`. Mekari's recon is manual / CSV. |
| **Single-screen kasir-first home** | Operational-first design: daily kasir is the entry point, not an accounting menu. |
| **Pengawasan views built-in** | Top adjustments, kasir discount per cashier, outflow outliers, transfer aging — all SQL views ready for an Owner dashboard. |

### 16.2 What Mekari has that Vosi doesn't

| Capability | Vosi status |
|---|---|
| **Deep accounting** — Chart of Accounts, General Journal, P&L, Neraca, Arus Kas, period closing | ❌ All missing. **MVP-critical.** Pondasi yang bookkeeper butuhkan untuk pindah penuh dari Jurnal. |
| **PPN automation** — VAT-in / VAT-out tracking, 11% mapping, SPT Masa export | ❌ Missing. Critical for PKP customers. |
| **e-Faktur Coretax + SPT auto-gen + E-Bupot** | ❌ Compliance-grade tier — defer to Phase 5 (Open Question Q1). |
| **Multi-currency** | ❌ Defer to Phase 3 (UMKM parity). |
| **Marketplace API sync** (Tokped / Shopee / Lazada) | ❌ Channel name only. |
| **Mobile app** | ❌ Browser-only. |
| **Multi-tenant** — org_id everywhere, signup, billing | ❌ Single-tenant only. **Phase 2 critical** (must land before customer #2). |
| **Barcode print + scan** | ❌ |
| **Serial number, batch + expiry tracking** | ❌ Segment-specific |
| **Brand trust / track record** | Mekari has thousands of customers; Vosi has one. |
| **40+ standard reports** | Vosi has ~5 reports; Mekari has dozens. |
| **Bank API auto-import** | ❌ Manual PDF upload only |
| **Aged receivables / aged payables** | ❌ |
| **Recurring transactions** (sewa, listrik, langganan) | ❌ Post-MVP |
| **Multi-level approval workflows** | 🟡 Vosi has single-level only |

### 16.3 Where they're similar

| Capability | Mekari | Vosi |
|---|---|---|
| Approval workflow | Built-in | Built-in + Owner PIN + WA button + immutability backstop |
| Inventory + warehouse | Multi-warehouse | Dual-warehouse (atas/bawah hard-coded) |
| Sales orders | Standard | Multi-channel + Rakit state machine |
| Bank reconciliation | Manual upload + matching | PDF upload + Gemini OCR + lanes |
| Customer management | Full CRM | Pelanggan + Pipeline + Order History |
| RBAC | 11 roles | 30+ permissions + 4 default role templates |

---

## 17. Side-by-side comparison map for the .mov reviews

Use this when watching each Mekari demo. For each Mekari feature you see, find the Vosi row and mark match (=), gap (Vosi missing), or surplus (Vosi extra).

### 17.1 vs **Mekari Jurnal** (accounting-centric)

| Mekari Jurnal | Vosi today | Status |
|---|---|---|
| Chart of Accounts | (none) | ❌ Vosi gap — **MVP-critical** |
| General Journal entries | (none) | ❌ Vosi gap — **MVP-critical** |
| Sales Invoice + Receipt | Penjualan Baru + Kasir + Order History | = match (Vosi richer for kasir; missing accounting journal) |
| Purchase Order + Bill | Pembelian (PO+receive+pay) | = match (Vosi missing PR step) |
| Inventory + stock movements | StockManager + stock_movements ledger | = match (Vosi richer audit, missing barcode) |
| Bank reconciliation | Rekonsiliasi 6-step | = match (Vosi has Gemini OCR; Mekari has bank API) |
| Cash + Bank tracking | bank_config + bank_accounts | = match (basic) |
| P&L / Neraca / Arus Kas | (none) | ❌ Vosi gap — **MVP-critical** |
| Period closing (tutup buku) | reconciliation_periods only | 🟡 partial (reconciliation closes; accounting close missing) |
| Tax PPN | (none) | ❌ Vosi gap |
| e-Faktur | (none) | ❌ Vosi gap (defer compliance-grade) |
| Multi-currency | (none) | ❌ Vosi gap (defer Phase 3) |
| Multi-company / multi-tenant | (none) | ❌ Vosi gap (Phase 2) |
| Audit trail | stock_movements, approval_requests, rakit_audit_log, reconciliation_audit_log | ✅ Vosi surplus (audit-grade immutability) |
| WhatsApp AI sales | Calista state machine | ✅ Vosi surplus |
| Approval workflow | per-action with PIN + WA button | ✅ Vosi parity-plus |
| 40+ standard reports | ~5 reports | ❌ Vosi gap |

### 17.2 vs **Mekari Qontak** (CRM / omnichannel)

| Mekari Qontak | Vosi today | Status |
|---|---|---|
| WhatsApp Business API integration | whatsmeow daemon | = match (Vosi self-hosted, no per-message fee) |
| Conversation routing | Sales Inbox + take-over toggle | = match |
| Chatbot flows | Calista AI state machine (Gemini) | ✅ Vosi surplus (true LLM, not template) |
| Multi-channel inbox (WA, IG, FB, Tokped) | WA only | ❌ Vosi gap |
| Contact / lead CRM | Pelanggan + Pipeline | = match |
| Sales pipeline Kanban | PipelineScreen | = match (view-only; drag-drop pending) |
| Campaign / broadcast | (none) | ❌ Vosi gap |
| Quick replies / canned messages | (none) | ❌ Vosi gap |
| Custom flow builder | (none) | ❌ Vosi gap (Calista is code-driven) |
| Analytics per agent | (none) | ❌ Vosi gap |
| Voice / video calls | (none) | ❌ Vosi gap |
| Bank reconciliation | Rekonsiliasi | ✅ Vosi surplus |
| Kasir + inventory | Full | ✅ Vosi surplus |
| WhatsApp button approvals | `/api/approval/wa-webhook` | ✅ Vosi surplus |

### 17.3 vs **Mekari Desty** (POS + inventory + light CRM)

| Mekari Desty | Vosi today | Status |
|---|---|---|
| POS UI | KasirScreen + PenjualanBaruScreen | = match (Vosi richer: rakit, DP/Lunas, multi-channel) |
| Multi-store / multi-location | Single store, atas/bawah warehouse | 🟡 partial |
| Inventory management | StockManager + opname + adjustment + transfer | ✅ Vosi parity-plus |
| Barcode print/scan | (none) | ❌ Vosi gap |
| Marketplace sync | Channel name only | ❌ Vosi gap |
| Loyalty program | (none) | ❌ Vosi gap |
| Customer profile | Pelanggan + Pipeline | = match |
| Discount / promo engine | (none structured) | 🟡 Vosi has per-line discount via kasir_price_override (Phase 3b stubbed) |
| Cash management / shift open-close | (none) | 🟡 permission exists, no state machine |
| Reports | Dashboard + Laporan | = match (Vosi has channel mix; Desty likely has loyalty + footfall) |
| Sync to Jurnal | (none — Vosi IS the accounting backend) | ✅ surplus (no separate sync) |
| Mobile app | (none) | ❌ Vosi gap |

---

## 18. Recommended lenses for the Phase 1 roadmap

When you come back, you'll need to choose what fills the **Phase 1** bucket. The PRD already declared MVP-critical items in §6:

- **Accounting block:** Chart of Accounts, auto-journaling from kasir/PO/receive, manual general journal, PPN 11% mapping, P&L, Neraca, Arus Kas, period closing, CSV/Excel export.
- **Operational block:** Returns from customer, returns to supplier, PR → PO + approval, joining invoices.
- **SaaS block:** Multi-tenant org_id + per-tenant settings + tenant onboarding migration tool.

But the .mov diff may surface other priorities (e.g., recurring transactions, aged receivables, branch consolidation, e-Faktur depth). Suggested lenses:

1. **"Bookkeeper can leave Jurnal" lens** — what's the minimum accounting layer so Garindo's bookkeeper closes the books inside Vosi for a full month? This is the PRD's #1 MVP success criterion.
2. **"Pilot customer #2 can sign up" lens** — what blocks onboarding a non-Garindo customer? (Multi-tenant + per-tenant settings + onboarding migration.)
3. **"Operational completeness" lens** — what daily operation can the customer NOT do today? (Returns, PR step, joining invoices.)
4. **"Sales pitch" lens** — what unique demo moment do we want for first-meeting wow? (Probably WA AI + Rakit state machine + Pengawasan dashboard.)
5. **"Risk reduction" lens** — what bugs/maintenance debt threatens prod stability? (E.g., Phase 3b kasir gate stubs, Phase 3d two-step transfer refactor, payment-proof recognition completion.)

For each Mekari feature you flag in the .mov, ask:
- Does it serve lens 1, 2, 3, 4, or 5?
- What's the rough effort vs. parity value?
- Does PRD §8 list it as an Open Question (Q1 accounting depth, Q4 migration tooling, etc.)?

Items already triaged in PRD as ⏭️ (compliance-grade tier, multi-currency, marketplace API, advanced analytics) should stay deferred unless the demo reveals a deal-breaker for the target segment.

---

## 19. Quick-reference — RPC + table inventory

### 19.1 RPC list by domain (47 total)

**Ledger core:**
- `_log_stock_movement`
- `seed_stock_row`
- `sync_stock_total` (trigger)

**Purchasing:**
- `generate_po_number`
- `receive_purchase_order` (legacy 5-arg + new 6-arg)
- `receive_replacement`

**Sales / FIFO:**
- `next_kasir_number`
- `record_kasir_sale`
- `deduct_stock_fifo`
- `decrement_stock`
- `mark_walkin_order_paid`
- `mark_walkin_paid_with_stock`

**Transfers:**
- `transfer_warehouse`

**Approvals:**
- `_transition_approval`
- `verify_owner_pin`
- `decide_via_wa_button`
- `expire_pending_approvals`

**Stock adjustment:**
- `request_adjustment`
- `commit_approved_adjustment`
- `reject_adjustment`

**Stock opname:**
- `start_opname_session`
- `record_opname_count`
- `witness_acknowledge_opname`
- `submit_opname_for_owner`
- `commit_opname`

**Price change:**
- `request_price_change`
- `commit_approved_price_change`

**Rakit (assembly):**
- `_rakit_audit` (helper)
- `submit_rakit_lock`
- `withdraw_rakit_lock`
- `reject_rakit_lock`
- `approve_rakit_lock`
- `cosmetic_edit_rakit`
- `material_edit_rakit`
- `cancel_rakit`

**Reconciliation:**
- `create_slots_for_order` (trigger)
- `sync_slot_after_allocation` (trigger)

**Pengawasan (views, not RPCs):**
- `v_pengawasan_top_adjustments`
- `v_pengawasan_kasir_discount_7d`
- `v_pengawasan_outflow_outliers`
- `v_pengawasan_transfer_aging`
- `kasir_rakit_forfeit_summary` (view)

**Mutation guards (triggers):**
- `deny_stock_movement_mutation`
- `deny_price_history_mutation`
- `deny_approval_mutation`

### 19.2 Tables by domain (41+ total)

| Domain | Tables |
|---|---|
| Auth / users | `admin_users`, `admin_invitations` |
| Customers / CRM | `customers`, `leads`, `conversations`, `messages` |
| Catalog / stock | `stocks`, `stock_lots`, `stock_lot_consumption`, `stock_movements`, `stock_price_history` |
| Sales | `orders`, `kasir_transactions`, `kasir_counters` |
| Purchasing | `suppliers`, `purchase_orders`, `purchase_order_items` |
| Approvals | `approval_requests`, `stock_adjustments`, `stock_opname_sessions`, `stock_opname_counts`, `price_change_requests` |
| Rakit | `rakit_job_lines`, `rakit_components`, `rakit_audit_log`, view `kasir_rakit_forfeit_summary` |
| WhatsApp | `whatsapp_numbers`, `wa_recipients`, `notification_config` |
| Reconciliation | `bank_accounts`, `bank_imports`, `bank_statement_lines`, `bank_line_allocations`, `payable_slots`, `cash_deposit_batches`, `reconciliation_periods`, `reconciliation_settings`, `reconciliation_audit_log` |
| Settings | `company_settings`, `bank_config` (legacy) |
| Pengawasan views | `v_pengawasan_top_adjustments`, `v_pengawasan_kasir_discount_7d`, `v_pengawasan_outflow_outliers`, `v_pengawasan_transfer_aging` |

### 19.3 Frontend page registry (App.tsx)

```
auth | dashboard | sales-inbox | ai-stock | user-management |
notifications | whatsapp-ai | settings | pipeline | order-history |
pelanggan | laporan | pembelian | kasir | penjualanBaru |
persetujuan | stok-opname | rekonsiliasi | wip-list
```

19 distinct screens.

### 19.4 Edge Functions

- `send-admin-invite` — TypeScript / Deno, Gmail SMTP, Bearer-auth, HTML email with app link.

### 19.5 Backend HTTP API

```
GET   /api/health
GET   /api/wa/status
GET   /api/wa/qr
POST  /api/wa/logout
GET   /api/wa/debug
POST  /api/approval/wa-webhook
POST  /api/recon/upload
POST  /api/recon/close
```

### 19.6 Backend background loops

- Follow-up poller (1-min tick) — WA reminders for stale conversations
- Heartbeat poller (1-min tick) — revenue + low-stock summary to admins
- Approval expiry poller (1-min tick) — flips status='expired' for stale approvals
- Booking timeout scheduler — 24h reminder + 48h auto-cancel timers per active order

### 19.7 Postgres NOTIFY channels

```
admin_messages       (admin posts in inbox → notify customer WA)
order_approved       (order moves to APPROVED)
payment_verified     (FULL payment verified)
payment_rejected     (FULL payment rejected)
dp_verified          (DP verified)
dp_proof_rejected    (DP proof rejected)
```

---

## 20. Critical context for the Phase 1 roadmap session

When you sit down with the Mekari diff, also consider these PRD-flagged open questions (§8 of PRD) — they're not yet decided and each blocks a different roadmap branch:

| # | Open question | What it blocks |
|---|---|---|
| Q1 | Accounting depth: Level 1 (good-enough), 2 (accountant-grade), 3 (compliance-grade)? | Whether MVP includes only P&L+Neraca+Arus Kas OR also PPN+SPT+e-Faktur. 4-8 weeks vs 6-12 months. |
| Q2 | Target segment after Garindo: panel-only or broader retail? | Whether barcode + batch + sub-categories become MVP or Phase 3 |
| Q3 | Pricing model: per-tenant flat, per-user, freemium, setup-fee? | Multi-tenant architecture decisions |
| Q4 | Migration tooling: invest in "import from Jurnal" or just CSV import? | Differentiator strength for "replace Jurnal" pitch |
| Q5 | Timeline to MVP / to first non-Garindo customer? | Team size + funding burn |
| Q6 | Engineering team size: solo / 2-3 devs / larger? | Parallel work capacity |
| Q7 | Marketing channel: direct / partner (akuntan kantor) / content / paid ads? | Which features are GTM-critical (e.g. accountant-friendly export matters for partner channel) |
| Q8 | Compliance: PSAK + e-Faktur target, or stay "good enough"? | Whether medium-business segment is on the table |
| Q9 | Support model: chat / dedicated CSM / self-serve docs? | Pricing structure |
| Q10 | Multi-tenant architecture: shared schema with org_id vs schema-per-tenant? | MVP backend foundation |

---

## 21. End of snapshot

**Stats:** 82 migrations, 47 RPCs, 41+ tables, 19 frontend pages, 9 backend HTTP endpoints, 4 background pollers, 6 NOTIFY channels, 30+ permission flags, 11 conversation states, 6 approval request types, 1 immutable stock ledger + 1 immutable price-history ledger + 1 sanitized-update approval table.

**Total feature lines in PRD's catalog:** 95 capabilities tracked, of which ~50 are ✅, ~10 are 🟡, ~35 are ❌.

**Maintenance note:** Per `CLAUDE.md`, every completed task updates `progress.md`. This snapshot is a cross-section view, not the chronological log. When you implement the Phase 1 roadmap, continue logging tasks in `progress.md` as usual; refresh this snapshot at major milestones (end of MVP, end of Phase 2, etc.).
