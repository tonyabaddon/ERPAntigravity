# Landing vs. Shipped — Gap Analysis (2026-07-19)

**Method:** 4 parallel research agents inventoried backend-go (Calista, WA, jobs, API), Supabase migrations (437 files), frontend `src/` (React SPA), landing HTML + pricing.md. Cross-referenced every specific landing claim (~250 line items) against shipped code, DB tables, RPCs, and UI screens.

**Executive verdict:** Backend and DB depth is IMPRESSIVE. Most core modules ship end-to-end (Kasir, Pembelian, Stok multi-gudang, Pembukuan dual-write auto-journal, Piutang, User Management, Admin platform). Meaningful gaps concentrate in **customer-facing AI features** and **multi-channel marketplace integrations** — the two areas most prominently featured in landing marketing.

**Bottom line:** ~85% of landing promises are shipped. ~15% are partial or missing. The gaps cluster in 3 areas: (1) AI Manager proactive insights UI, (2) Piutang WA reminder scheduler, (3) Marketplace API sync (Shopee/Tokped/Lazada/TikTok/Blibli).

---

## Priority Table — What to Build or Trim First

| # | Gap | Landing Section | Impact | Effort | Recommendation |
|---|-----|----|----|----|----|
| **P0** | AI Manager proactive insights dashboard | Modules card, Modul deep-dive with demo mock, Growth card | HIGH — demo-visible | 3-5 days | **BUILD** — analytics RPCs already exist, need UI |
| **P0** | Piutang WA reminder scheduler | Modules card, Testimonial (Ibu S 40% turun), Solusi gain | HIGH — testimonial-attributed impact | 3-5 days | **BUILD** — Calista sender exists, need cron+config |
| **P0** | Marketplace API sync (Shopee/Tokped/Lazada/TikTok/Blibli) | Modules card "14 channel", Growth card "omset naik 20-40%", Toko Online audience card | HIGH — biggest visible gap | 2-3 months (per marketplace) | **TRIM landing to be honest** OR phased build (start Shopee first) |
| **P1** | Excel export for Neraca / Laba Rugi / Mutasi | Pembukuan module claim "Export siap ke konsultan pajak" | MEDIUM — konsultan pajak commonly needs Excel | 1-2 days | **BUILD** — PDF export works; add Excel via SheetJS |
| **P1** | Custom nota/struk template editor | Entire Fleksibel section — "Format Nota, Struk, Invoice" | HIGH — Fleksibel is major landing differentiator | 5-7 days for builder OR 0 days if positioned as high-touch service | **POSITION AS SERVICE** — Caleo team customizes at setup (already doing this manually) |
| **P1** | Calista 300 chat/hari per-tenant enforcement | Modules card, Premium tier feature | LOW visibility, HIGH cost-control need | 1 day | **BUILD** — add daily counter to conversations |
| **P2** | Serial number + garansi tracking | Toko CCTV audience card, Stok module claim | HIGH for CCTV segment | 3-4 days | **BUILD IF CCTV tenant onboarded** — otherwise defer |
| **P2** | VIP customer tier + riwayat pembelian tab | Customer Management module, AI Manager VIP claim | MEDIUM | 2-3 days | **BUILD** — small, high-value UX |
| **P2** | Rakit/Assembly (BOM) for Pabrik audience | Pabrik & Produksi UMKM audience card, pricing.md Pro tier | HIGH for Pabrik segment | 7-10 days | **BUILD IF pabrik tenant onboarded** — otherwise defer |
| **P2** | Split-method payment UI (kasir) | Kasir module claim "multi-payment: tunai, transfer, e-wallet, tempo" | LOW-MEDIUM — ambiguous claim | 3-4 days | **DEFER** — landing wording covers current implementation |
| **P2** | PPh Formal (e-Faktur XML) export | Pembukuan claim "PPN + PPh siap export" | MEDIUM | 5-7 days | **DEFER** — pricing.md already discloses "PPh formal defer" |
| **P2** | Per-cabang permission scope | Fleksibel card "role & permission per-cabang" | MEDIUM | 5-7 days | **DEFER** — requires branch entity + RBAC refactor |
| **P2** | Custom dashboard/report builder | Premium tier "custom dashboard/report (maks. 3)" | MEDIUM | 10-14 days OR 0 days as high-touch service | **POSITION AS SERVICE** — Caleo team builds custom reports on request |
| **P3** | Dedicated Supplier screen | Supplier Management module | LOW | 2-3 days | **DEFER** — Pembelian tab already covers it |
| **P3** | Supplier rating field | Supplier Management module | LOW | 1-2 days | **DEFER** — nice-to-have |
| **P3** | CSV export refinement | FAQ #10 "Data bisa di-export lengkap CSV/Excel" | LOW | 1-2 days | **DEFER** — export_tenant_data RPC returns JSONB, needs FE-side CSV conversion |
| **P3** | Setup wizard (full tenant onboarding) | Onboarding step 2 | LOW | 5-7 days | **DEFER** — high-touch onboarding is intentional at 10-tenant scale |
| **P4** | Landing marketing accuracy audit | Cross-cutting | HIGH — trust risk | 1 day | **AUDIT + TRIM** — see next section |

---

## Landing Marketing Accuracy Audit — items to TRIM or ADD DISCLAIMER

These are claims where the landing over-promises what's shipped. Trust risk if prospect verifies during demo.

### CRITICAL — trim or add disclaimer:

1. **"Order dari 14 channel masuk 1 dashboard"** (Modules card + Multi-Channel Sales)
   - Reality: 14 channels defined as tags/labels; NO marketplace API sync. WA only (via Calista).
   - **Options**: (a) trim to "WA + tag lain manual"; (b) add "Marketplace API sync roadmap 2026-Q4" disclaimer; (c) commit to build Shopee first (7-10 days for OAuth + webhook + reconciliation)

2. **"Omset bisa naik 20-40% saat multi-channel aktif"** (Growth section card 1)
   - Reality: Predicated on multi-channel being fully integrated (it's not). Effect claim depends on shipped feature.
   - **Options**: (a) remove card; (b) reframe as "WA + manual entry" scope; (c) build multi-channel first

3. **Landing AI Manager demo mock** with specific recommendations (MCB 10A margin, Kabel NYA 40% faster, Pak Anton VIP birthday)
   - Reality: NO AI Manager dashboard exists. Analytics RPCs exist but not surfaced proactively.
   - **Options**: (a) build simple MVP dashboard consuming existing RPCs; (b) trim demo mock and reframe as "insights via Laporan Performa"

4. **Testimonial impact numbers** (Piutang turun 40%, Omset naik 30%, tutup 3 jam lebih cepat)
   - Reality: Not verified — need to check if from real Garindo tenant with actual metrics
   - **Founder verification needed**: are these real Garindo numbers or estimated?

5. **Case study specific numbers** (474 SKU, 290+ supplier, 1.500+ pergerakan/bulan, 250+ chat WA, 670+ jurnal)
   - Reality: Attributed to distributor at Jakarta Barat (likely Garindo per `no_garindo_disclosure` memory)
   - **Founder verification needed**: query Garindo tenant DB to verify these are current-actual

### MEDIUM — clarify wording:

6. **"Serial tracking + varian + garansi record"** (Toko CCTV audience)
   - Reality: No serial/garansi field in codebase
   - **Fix**: trim CCTV card OR commit to build serial tracking

7. **"Multi-payment: tunai, transfer, e-wallet, tempo"** (Kasir module + deep-dive)
   - Reality: Single method per transaction (no split-payment UI)
   - **Fix**: leave as-is (claim is ambiguous enough) OR add "1 metode per transaksi" clarifier

8. **"Custom dashboard/report (maks. 3) sesuai kebutuhan"** (Premium tier)
   - Reality: No builder UI. Delivered as manual custom work.
   - **Fix**: OK as-is if delivered as service. Add clarifier "Kami build sesuai kebutuhan tokomu saat setup" to avoid expecting self-serve.

### LOW — no action needed:

9. **"Kepatuhan UU PDP"** — legal compliance stance, code has RLS + audit + export, meets spirit
10. **"Backup harian & diuji restore"** — infra concern, Supabase PITR + runbook exists
11. **"Response time WA customer < 1 menit (AI)"** — depends on Calista latency; typically <10s under normal load
12. **"1.500+ Pergerakan stok/bulan"** — real data if from Garindo

---

## Fully Shipped — Landing Claims Backed by Code (nothing to worry about)

For confidence: these landing sections have full code+DB+UI backing.

- **Jualan & Kasir** (kasir_transactions, kasir_counters, invoice_counters, KasirScreen, CatatPenjualanWizard, InvoicePreviewScreen with dot-matrix)
- **Pembelian** (purchase_orders, purchase_invoices, tukar_faktur, pembayaran, payable_slots, PembelianScreen with 8 sub-tabs)
- **Stok multi-gudang** (stocks, warehouses, warehouse_transfers, stock_opname_sessions, StockManagerScreen, StockOpnameScreen, ManajemenGudangScreen, WarehouseTransfer components)
- **Pembukuan dual-write auto-journal** (`_post_journal_entry` + `enforce_dual_write_always_on`, chart_of_accounts, journal_entries, AkuntansiScreen with COA/Buku Besar/Trial Balance/Tutup Buku, LaporanScreen with Mutasi/Laba Rugi/Neraca/Cash Flow)
- **Rekonsiliasi bank** (bank_statement_lines, bank_imports, auto-match RPC, RekonsiliasiScreen)
- **Kas & Bank** (cash_accounts, bank_accounts, KasBankScreen)
- **Piutang kredit limit + write-off** (customers.credit_limit, piutang_write_off_requests, TempoCreditSection, WriteOffRequestModal, PiutangScreen aging bar)
- **Multi-User** (admin_users, tenant_users, permission JSONB, UserManagementScreen, approval_requests + ApprovalRulesPanel)
- **Approval Workflow** (approval_requests, approval_settings, ApprovalRulesPanel, ApprovalGateEditor, 10+ approval types)
- **Customer Management basics** (customers with tier eceran/grosir + credit limit, PelangganScreen with tempo/credit section)
- **Supplier Management basics** (suppliers table with claims table, embedded in Pembelian Supplier tab)
- **Admin platform** (11 admin routes covering tenants/revenue/sales-reps/payments/audit/billing/plans)
- **WhatsApp pair (QR + pair-code)** (whatsapp_numbers table, whatsmeow-go client, /api/wa/qr + /api/wa/pair-code endpoints, WhatsappAiScreen with QRCodeSVG)
- **Row-Level Security per tenant** (187 tables with ENABLE ROW LEVEL SECURITY, `custom_access_token_hook` for JWT tenant_id claim, `_resolve_tenant_id()` function)
- **Row-level audit trail** (audit_log table, `_audit_row_change` trigger, dedicated migration for kasir + pembelian, `prune_audit_log` retention)
- **Data export RPC** (`export_tenant_data` returns JSONB blob per tenant — needs FE CSV/Excel formatter)
- **Multi-tier pricing** (stocks grosir/retail price fields, customers.default_pricing_tier constraint)
- **CSV bulk product upload** (BulkUploadSection with template download)
- **CSP + security headers on all HTTP responses** (Task 6 Worker)
- **Sentry SDK wired** (dormant — DSN not set; app-side PII scrubbing in place)

---

## Recommendation: Sprint Plan

Based on the priority table, recommended build order (weeks 1-4 post-Phase 3):

### Sprint 1 (Week 1) — "Close the demo-visible gaps"
- **AI Manager MVP dashboard** (P0, 3 days) — Consume existing analytics RPCs (`get_slow_moving_stock`, `get_top_customers`, `get_profit_per_channel`, `get_performa_summary_with_delta`), show top 3 recommendations per day as cards on dashboard
- **Piutang WA reminder scheduler** (P0, 3 days) — Enable disabled button, wire to Calista sender, add cron trigger per-tenant, config UI
- **Landing marketing accuracy audit** (P4, 1 day) — Trim multi-channel claims to honest scope; trim Growth card 1; verify testimonial + case-study numbers with founder

### Sprint 2 (Week 2) — "Real customer harm items"
- **Excel export for accounting reports** (P1, 2 days) — SheetJS to convert Laba Rugi + Neraca + Mutasi + Buku Besar to XLSX
- **Calista 300 chat/hari enforcement** (P1, 1 day) — Add daily counter to conversations table + guard in engine
- **Reply-as halo@caleo.id polish** — send founder the 5-min Gmail Send-As runbook (already written)

### Sprint 3 (Week 3-4) — "Multi-channel start"
- **Shopee integration MVP** (~7-10 days) — Register app, OAuth flow, order pull webhook, reconciliation to Caleo orders table, per-channel filter in DaftarPesananScreen. Ship Shopee first before Tokped/Lazada.

### Sprint 4 (Week 5+) — depends on tenant onboarding pipeline
- If CCTV tenant onboarded → Serial + garansi tracking (P2, 4 days)
- If Pabrik tenant onboarded → Rakit/Assembly (P2, 10 days)
- Otherwise: Tokped integration (~7 days)

**Total effort estimate to close P0+P1**: ~10 working days (Sprints 1-2). Sprint 3+ scales with marketplace scope.

---

## Discussion Points for Founder

1. **Multi-channel scope**: Do we commit to phased build (Shopee first, then Tokped, then TikTok Shop, then Lazada, then Blibli) or trim landing to honest current scope?
2. **AI Manager**: MVP dashboard using existing RPCs is achievable in a week. Or do we defer and trim landing?
3. **Testimonial + case-study numbers**: Are Piutang turun 40%, Omset naik 30%, tutup 3 jam lebih cepat, 474 SKU, 290+ supplier, 1.500+ pergerakan actually real? Which tenant? (per `no_garindo_disclosure` memory, likely Garindo)
4. **Custom nota template**: Build editor UI or continue high-touch service model?
5. **Serial garansi + Rakit**: Wait for CCTV / Pabrik tenant to onboard before building?
6. **Landing prices**: pricing.md v3 says Premium 12-mo Rp 2,659K; landing says Rp 2,880K (updated 2026-07-19). Should pricing.md be re-versioned to v4 to match?

---

## Cross-cutting recommendations

- **Add Phase 4 planning doc** in `docs/superpowers/plans/` once priorities decided
- **Update pricing.md** partial-ship disclosure table to add: AI Manager dashboard, Multi-channel API sync, WA reminder scheduler (currently marketing-visible but code-partial)
- **Regression test**: extend Playwright to click "Baca cerita distributor..." and other landing CTAs to catch stale hrefs (recent case-study anchor bug)
- **Landing partial-ship disclosure section**: consider adding an honest "Roadmap Q3/Q4 2026" section on landing showing what's coming — trust builder for MSME buyer skeptical of vaporware

---

*Analysis date: 2026-07-19*
*Basis: 4 parallel research agents (backend-go, Supabase migrations, frontend src/, landing HTML + pricing.md)*
*Full agent transcripts preserved in `/private/tmp/claude-501/.../tasks/`*
