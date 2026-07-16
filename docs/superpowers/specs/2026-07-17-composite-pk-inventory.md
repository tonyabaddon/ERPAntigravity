# Composite PK Inventory — Multi-Tenant Scale-Forward Hardening

**Date**: 2026-07-17
**Author**: Claude Code (Task 6, Day 6 autonomous execution)
**Status**: LIVE — reflects applied migrations as of this date
**Reversibility**: IRREVERSIBLE — PK shape is a partitioning contract; see CLAUDE.md

---

## Summary

Phase 1 hardening ships composite `(tenant_id, id)` PKs on all high-volume tenant-scoped tables, making them partition-ready before tenant #2 lands. At current row counts (hundreds to low thousands) each migration takes seconds. At 10M+ rows the same migration would require days of downtime.

**Migrations applied (Batch 1, Task 5):** 304, 305, 306
**Migrations applied (Batch 2, Task 6):** 307, 308, 309
**Total tables migrated to composite PK:** 5

---

## Full PK Inventory

| Table | Current PK | Migration | Priority | Status | Rationale |
|---|---|---|---|---|---|
| `stock_movements` | `(tenant_id, id)` | 304 | P1 | Done | High-volume ledger; grows 1 row per item movement; partition-critical |
| `journal_entry_lines` | `(tenant_id, id)` | 305 | P1 | Done | High-volume GL ledger; grows 2+ rows per journal entry |
| `purchase_orders` | `(tenant_id, id)` | 307 | P1 | Done | Transaction table; grows with every supplier order |
| `purchase_invoices` | `(tenant_id, id)` | 308 | P1 | Done | AP ledger; grows with every supplier invoice |
| `journal_entries` | `(tenant_id, id)` | 309 | P1 | Done | Core GL header; 1 entry per business event; links entire accounting chain |

---

## FK Upgrade Map

Each composite PK migration required upgrading inbound FKs to composite references. All child tables already had `tenant_id NOT NULL` with zero cross-tenant violations (verified pre-flight).

### Migration 304 — stock_movements
| Child Table | FK Column | Composite FK |
|---|---|---|
| `stock_adjustments` | `committed_movement_id` | `(tenant_id, committed_movement_id) → stock_movements(tenant_id, id)` |
| `stock_movements` (self) | `related_movement_id` | `(tenant_id, related_movement_id) → stock_movements(tenant_id, id)` |

### Migration 307 — purchase_orders
| Child Table | FK Column | Composite FK |
|---|---|---|
| `purchase_order_items` | `po_id` | `(tenant_id, po_id) → purchase_orders(tenant_id, id)` |
| `stock_lots` | `po_id` | `(tenant_id, po_id) → purchase_orders(tenant_id, id)` |

### Migration 308 — purchase_invoices
| Child Table | FK Column | Composite FK |
|---|---|---|
| `purchase_invoice_items` | `pi_id` | `(tenant_id, pi_id) → purchase_invoices(tenant_id, id)` |
| `pembayaran_items` | `tagihan_id` | `(tenant_id, tagihan_id) → purchase_invoices(tenant_id, id)` |

### Migration 309 — journal_entries
| Child Table | FK Column | Composite FK |
|---|---|---|
| `journal_entries` (self) | `reverses_entry_id` | `(tenant_id, reverses_entry_id) → journal_entries(tenant_id, id)` |
| `journal_entries` (self) | `reversed_by_entry_id` | `(tenant_id, reversed_by_entry_id) → journal_entries(tenant_id, id)` |
| `journal_entry_lines` | `entry_id` | `(tenant_id, entry_id) → journal_entries(tenant_id, id)` |
| `supplier_claim_events` | `journal_entry_id` | `(tenant_id, journal_entry_id) → journal_entries(tenant_id, id)` |
| `supplier_claims` | `create_journal_id` | `(tenant_id, create_journal_id) → journal_entries(tenant_id, id)` |
| `supplier_claims` | `resolution_journal_id` | `(tenant_id, resolution_journal_id) → journal_entries(tenant_id, id)` |

---

## Deferred Tables (P2 / P3)

### P2 — Defer to Task 7 (high complexity, needs dedicated migration)

| Table | PK Today | Rows | Reason Deferred |
|---|---|---|---|
| `kasir_transactions` | `(id)` uuid | 123 | Hottest write path (POS sales). FK fan-out to 5 child tables (`cash_deposit_batch_items`, `rakit_job_lines`, `rakit_lock_requests`, `stock_lot_consumption`, `sales_orders.converted_to_kasir_tx_id`). Needs isolated task with full regression coverage. |
| `pesanan` | `(id)` uuid | 42 | Referenced by `purchase_invoices.pesanan_id` (outbound FK, won't break) + parent of `pesanan_items`. Medium complexity. Low urgency — row count low. |
| `pembayaran` | `(id)` uuid | low | References `suppliers(id)`. Child: `pembayaran_items.pembayaran_id`. Straightforward but deliberately batched with pesanan for cohesion. |
| `stock_opname_sessions` | `(id)` bigint | 219 | Child `stock_opname_counts` already has composite PK `(session_id, sku, warehouse)`. Needs composite FK upgrade when parent migrated. Low urgency. |
| `stock_lots` | `(id)` uuid | 245 | References `purchase_orders(tenant_id, id)` (already composite). Child: `stock_lot_consumption`. Manageable but deferred — no FK fan-out pressure yet. |
| `stock_adjustments` | `(id)` bigint | 166 | References `stock_movements(tenant_id, id)` (composite FK already upgraded in 304). No inbound FKs. Can migrate alone cheaply. |
| `stock_lot_consumption` | `(id)` uuid | low | References `kasir_transactions(id)` and `stock_lots(id)` — both still single-col PK. Defer until parents migrated. |
| `sales_orders` | `(id)` text | low | Text PK (UUID cast to text). Unusual type. Needs careful FK audit before migration. Low volume. |
| `approval_requests` | `(id)` bigint | 1289 | Referenced by `stock_adjustments.approval_request_id` and `supplier_claims.approval_request_id`. Has `tenant_id NOT NULL`. Medium priority — growing with approval workflows. |

### P3 — Keep single-column PK (tenant-agnostic or system tables)

| Table | PK Today | Rationale |
|---|---|---|
| `warehouses` | `(id)` | Master config table. Shared reference, small cardinality, no tenant_id, no partitioning need. |
| `chart_of_accounts` | `(id)` | Shared accounting reference. tenant_id NOT NULL but very low row count + COA is stable config. |
| `stocks` | `(sku)` text | Natural key. Low cardinality per tenant. No id to make composite. |
| `stock_levels` | `(sku, warehouse_id)` | Already composite but on natural keys; no id column. Partition-ready as-is. |
| `suppliers` | `(id)` uuid | Master entity. Low cardinality. Partition pressure negligible. |
| `customers` | `(id)` text | Master entity with text PK. Low cardinality. |
| `warehouse_transfers` | `(tenant_id, id)` | Already composite — done in an earlier migration. |
| `warehouse_transfer_items` | `(tenant_id, transfer_id, line_no)` | Already composite — done in an earlier migration. |
| `stock_opname_counts` | `(session_id, sku, warehouse)` | Already composite — natural composite key. |
| `messages` | `(id, inserted_at)` | Partitioned table — already has correct composite PK. |
| `audit_log` | `(id)` bigint | Append-only log. tenant_id NOT NULL. Deferred — low priority for PK shape (audit queries filter by tenant_id via index, not PK scan). |
| `warehouse_audit_log` | `(id)` bigint | Same rationale as audit_log. |
| `gl_dual_write_anomalies` | `(id)` | Internal diagnostic table. No partitioning need. |
| `whatsmeow_*` | various | WhatsApp protocol tables. Not tenant-scoped in the ERP sense. Keep as-is. |

---

## Scale-Forward Rationale

**Why composite `(tenant_id, id)` PK?**

1. **Partition-readiness**: Postgres range/list partitioning keys must be a prefix of the PK. `(tenant_id, id)` allows future partitioning by `tenant_id` (all data for a tenant in one shard) or `(tenant_id, time_bucket)` with only the PK shape already in place.

2. **RLS enforcement at the index level**: A composite PK index on `(tenant_id, id)` serves all single-row lookups that already filter by `tenant_id` (which all RPCs must). Postgres uses the PK index directly for `WHERE tenant_id = $1 AND id = $2` lookups — faster than a heap scan with a separate tenant filter.

3. **Cross-tenant integrity enforcement**: Composite FKs `(tenant_id, FK_col) → parent(tenant_id, id)` enforce at the DB level that a child row can never reference a parent row belonging to a different tenant. This is defense-in-depth beyond RLS.

4. **Low migration cost now, high later**: At current row counts (tens to hundreds per table), each migration runs in < 1 second with zero downtime. At 10M rows, the same PK rebuild would require days of downtime or a complex online migration tool.

---

## Advisor Triage (post-migration 309)

**Unindexed FK findings introduced by Task 6**: None. All composite FK indexes added in the same migration transaction (covering indexes for all 10 new composite FKs).

**Pre-existing unindexed FK findings** (not Task 6's scope): These exist on columns like `supplier_id`, `created_by_user_id`, `posted_by`, `sku`, `warehouse_id` across various tables. Deferred to a future index-sweep task.

**Unused indexes on new composite FK indexes**: Expected. Supabase advisor flags indexes with zero recent usage; these indexes were created in this task and will be used once normal operations resume.

**Multiple permissive policies**: Pre-existing. Tracked separately in Phase A SECDEF work.

---

## Next Steps

1. **Task 7** (recommended): Migrate `kasir_transactions` (dedicated task — high FK fan-out, hot path).
2. **Task 8** (recommended): Migrate `pesanan` + `pembayaran` together (cohesive AP chain).
3. **Task 9** (recommended): Migrate `approval_requests` + `stock_opname_sessions` (growing tables).
4. **Index sweep** (lower priority): Add missing FK indexes for `supplier_id`, `created_by_user_id`, etc. across purchase/payment tables.
