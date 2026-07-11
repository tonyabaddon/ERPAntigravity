# QA Cycle Findings

**Objective:** end-to-end QA cycle covering every tenant module + VOSI Admin surface before commercial launch to new tenants. Started 2026-07-11 after multi-agent audit + P0 RLS write-path fix.

## Cadence

- 1-2 modules or 1 business scenario per conversation session (~4-6 hours Chrome MCP work)
- Findings logged per session in this file, committed at end
- Each finding = severity + reproduction + fix status
- Fixes commit + deploy where feasible in same session; else defer with tracking

## Severity legend

- **🔴 P0 blocker** — feature broken, data loss, or security hole. Must fix before launch.
- **🟠 P1 major** — feature works but wrong behavior on common inputs. Fix before launch.
- **🟡 P2 minor** — UX gap, edge-case handling, cosmetic. Fix opportunistically.
- **🔵 P3 info** — observation, follow-up idea, doc gap. Track without blocking.
- **✅ PASS** — verified working end-to-end, no finding.

## Phase overview

| Phase | Sessions | Coverage |
|---|---|---|
| Phase 1 — Business scenarios | 1-5 | Cash walk-in day, Tempo credit lifecycle, Purchase cycle, VOSI onboard flow, Full opname cycle |
| Phase 2 — Module gaps | 6-11 | Sales Inbox, Penawaran, bank recon, month-close, Pengaturan hub, User Mgmt, Laporan, Manajemen Gudang, Multi-tier pricing |
| Phase 3 — VOSI Admin | 12-14 | Onboard/Plans/Sales Reps CRUD, Verifikasi Pembayaran, Platform Settings, Deprovision, Module toggle, Log aktivitas |
| Phase 4 — Regression | 15-16 | Cross-tenant impersonation, JWT expiry, READONLY mode, concurrent users, perf smoke |

## Coverage matrix (module → session)

| Tenant module | Primary session | Secondary |
|---|---|---|
| Dashboard | 1 (Scenario A) | — |
| Sales Inbox | 6 | — |
| Penjualan (wizard, invoice) | 2 (Scenario B) | 11 (multi-tier) |
| Penawaran (quotes) | 6 | — |
| Kasir | 1 (Scenario A) | 11 (multi-tier) |
| Pelanggan | 2 (Scenario B) | — |
| Piutang | 2 (Scenario B) | — |
| Kas & Bank | 2, 3, 7 | — |
| Produk & Stok | 1, 3, 5 | — |
| Stok Opname | 5 (Scenario E) | — |
| Pembelian | 3 (Scenario C) | — |
| Manajemen Gudang | 5, 11 | — |
| Persetujuan | 5 (Scenario E) | — |
| Rekonsiliasi & Tutup Buku | 1 (harian), 7 (bank), 8 (bulanan) | — |
| Akuntansi | 2, 3, 8 | — |
| Laporan | 1, 10 | — |
| User Management | 10 | — |
| Pengaturan hub | 5, 9 | — |
| **VOSI Admin module** | | |
| Beranda | 4 | — |
| Tenant list + detail | 4, 14 | — |
| Log aktivitas | 14 | — |
| Paket (Plans) | 4, 12 | — |
| Pendapatan | 13 | — |
| Sales Reps | 4, 12 | — |
| Verifikasi Pembayaran | 4, 13 | — |
| Pengaturan Pembayaran | 4, 13 | — |
| Pengaturan admin | 13 | — |
| Onboard wizard | 4, 12 | — |

Every module hits at least one dedicated session.

---

## Session log

_(Entries added per session below. Newest at top.)_

### Session 1 — Scenario A: Cash walk-in day

**Date:** _pending execution_

**Modules covered:** Dashboard, Kasir POS, Produk & Stok, Rekonsiliasi tutup harian, Laporan, Akuntansi (GL auto-post)

**Test flow:**
1. Impersonate Garindo → verify Dashboard KPIs render (7d omset, transaksi count, stok tipis count)
2. Kasir → new walk-in cash sale (1-3 SKUs, cash payment, FULL type)
3. Verify sale appears in kasir_transactions
4. Verify stocks decremented (SKU stock movement)
5. Verify auto GL entry (Kas Toko debit, Pendapatan Kasir Walkin credit, HPP debit, Persediaan credit)
6. Kasir Rekap → verify daily total
7. Tutup Buku Harian → verify laba bersih calculation
8. Laporan → verify sale reflects in revenue chart
9. Dashboard reload → verify KPI updates

**Findings:**
_(Populated during execution.)_

**Session status:** Not started.

---

## Findings summary (all sessions)

_(Roll-up populated as sessions complete.)_

| # | Severity | Session | Module | Title | Status |
|---|---|---|---|---|---|
| _no findings yet — cycle not started_ |
