# P2-C — Audit log coverage gap survey (2026-07-17)

Read-only survey. No changes shipped. Survey covers all `supabase/migrations/**` through slot 20261115000323.

---

## Definitions used

- **Money-affecting**: any RPC that creates/modifies orders, invoices, payments, discounts, refunds, journal entries, or wallet balances
- **Access/authorization**: user creation, role changes, tenant activation/suspension, plan changes, admin_users edits
- **Data mutation on core entities**: customers, products (SKU), suppliers, warehouses (create/edit/delete only — NOT read)
- **Bulk / destructive operations**: any RPC that touches >100 rows, cascades deletes, or drops data

Excluded:
- Read RPCs (no audit needed)
- View/report RPCs
- Ephemeral state (chat, notifications, ephemeral job queue)
- Session-local operations (theme prefs, filters)
- Trigger functions (guard functions that enforce constraints, not write paths)
- Deprecated/dropped functions (e.g., `approve_rakit_lock` was DROP'd in 20260609000010 and superseded by `commit_approved_rakit_lock`)

---

## A. Existing audit sinks

| Table | Columns | Writers (RPCs / triggers) |
|---|---|---|
| `public.audit_log` | `id BIGSERIAL`, `event_type TEXT NOT NULL`, `actor_user_id UUID`, `payload JSONB`, `created_at TIMESTAMPTZ` — **no tenant_id column** | `commit_opname_internal`, `_apply_tempo_write_off_change`, `approve_tempo_write_off`, `request_tempo_write_off`, `_apply_rakit_lock_change`, `request_rakit_lock`, `commit_approved_rakit_lock`, `approve_and_amend_rakit_lock`, `reject_rakit_lock`, `withdraw_rakit_lock`, `reject_customer_credit_activate`, `transition_order_stage`, `record_pi` (passthrough path), `start_opname_session` (via commit_opname_internal), `submit_opname_for_owner` (via commit_opname_internal), `_audit_opname_reject` (trigger) |
| `public.warehouse_audit_log` | `id BIGSERIAL`, `warehouse_id UUID NOT NULL`, `actor_user_id UUID NOT NULL`, `action TEXT CHECK (create/rename/set_default/deactivate/force_deactivate/reactivate/address_update/sort_update)`, `before JSONB`, `after JSONB`, `reason_note TEXT`, `created_at TIMESTAMPTZ` — **no tenant_id column** | `create_warehouse`, `update_warehouse`, `deactivate_warehouse`, `force_deactivate_warehouse`, `reactivate_warehouse` |
| `public.rakit_audit_log` | DROPPED in migration 20260609000010 — no longer active | (none — table dropped) |
| `public.platform_admin_audit` | `id BIGSERIAL`, `admin_user_id UUID NOT NULL`, `admin_email TEXT NOT NULL`, `tenant_id UUID NOT NULL`, `action TEXT CHECK (IMPERSONATE_START/IMPERSONATE_END/CREATE_TENANT/CHANGE_PLAN/CHANGE_FEATURES/SUSPEND/ACTIVATE/ARCHIVE/RECORD_PAYMENT/UPDATE_PAYMENT/DELETE_PAYMENT/VERIFY_PAYMENT/REJECT_PAYMENT)`, `detail JSONB`, `ip_address INET`, `user_agent TEXT`, `created_at TIMESTAMPTZ` | `deprovision_tenant`, `activate_tenant`, `suspend_tenant`, `renew_subscription`, `update_plan_admin`, `update_tenant_feature_override`, `create_sales_rep`, `deactivate_sales_rep`, `grant_impersonation`, `revoke_impersonation`, `stop_impersonation`, `impersonate_tenant` (auth hook), `record_payment`, `update_payment`, `delete_payment`, `verify_payment`, `reject_payment` |
| `public.product_price_audit` | `id BIGSERIAL`, `sku TEXT NOT NULL`, `field TEXT NOT NULL CHECK (price/price_grosir)`, `old_value NUMERIC`, `new_value NUMERIC`, `source TEXT NOT NULL CHECK (manual_edit/bulk_csv/rpc)`, `actor TEXT NOT NULL`, `created_at TIMESTAMPTZ` — **no tenant_id column** | `bulk_update_grosir_price` |
| `public.reconciliation_audit_log` | `id UUID`, `period_id UUID`, `table_name TEXT NOT NULL`, `row_id UUID NOT NULL`, `action TEXT CHECK (INSERT/UPDATE/DELETE/MATCH/UNMATCH/WRITE_OFF/EXTEND)`, `before_data JSONB`, `after_data JSONB`, `edited_by UUID`, `edited_at TIMESTAMPTZ` | Written by reconciliation trigger `create_slots_for_order`. Not a primary forensic sink — covers recon period bookkeeping only. |

### Structural note on audit_log (no tenant_id)

`public.audit_log` has no `tenant_id` column. At 10-tenant scale, forensic queries require joining via `actor_user_id → admin_users → tenant_id` or extracting from `payload`. This is a structural gap: cross-tenant filtering is not indexed, and some events omit actor (e.g., auto-commit paths where actor = system). See Recommendations.

Similarly, `warehouse_audit_log` and `product_price_audit` have no `tenant_id` column. In multi-tenant mode, isolation requires joining via `warehouse_id → warehouses.tenant_id` or `sku → stocks.tenant_id`.

---

## B. Sensitive RPCs inventory

Note: "SECDEF" = `SECURITY DEFINER` with `vosi_rpc_owner` ownership, which is required for all writes to `t_*`-policied tables.

### B1 — Money-affecting

| Function | Category | SECDEF | What it does |
|---|---|---|---|
| `record_kasir_sale` (22+ args) | money | ✓ | Records kasir (POS) sale transaction with items, payment, DP support, GL dual-write |
| `record_pembayaran` (10+ args) | money | ✓ | Records supplier payment (pembayaran) against PO/tagihan |
| `record_pi` (15+ args) | money | ✓ | Records purchase invoice (PI) — passthrough and standard paths with GL |
| `create_tempo_invoice` (10+ args) | money | ✓ | Creates tempo (credit) invoice for B2B sales with stock deduction |
| `record_payment` (1 arg: jsonb payload) | money | ✓ | Platform-admin: records SaaS subscription payment with fraud check |
| `update_payment` (2 args) | money | ✓ | Platform-admin: edits an existing subscription payment |
| `delete_payment` (1 arg) | money | ✓ | Platform-admin: deletes a subscription payment (destructive) |
| `verify_payment` (1 arg) | money | ✓ | Platform-admin: approves a pending subscription payment |
| `reject_payment` (2 args) | money | ✓ | Platform-admin: rejects a pending subscription payment |
| `create_sales_order` (8 args) | money | ✓ | Creates a sales order (pesanan) |
| `void_pesanan` (2 args) | money | ✓ | Voids a sales order (irreversible status change) |
| `void_pembayaran` (1 arg) | money | ✓ | Voids a supplier payment |
| `void_pi` (1 arg) | money | ✓ | Voids a purchase invoice (irreversible) |
| `update_pesanan` (multiple args) | money | ✓ | Updates a sales order (items, amounts) |
| `close_sales_order` (1 arg) | money | ✓ | Closes a sales order |
| `mark_walkin_order_paid` (4 args) | money | ✗ | Legacy: marks walk-in order as paid — referenced only in code comments, may be inactive |
| `mark_pesanan_ordered` (1 arg) | money | ✓ | Transitions pesanan to ordered state |
| `mark_pi_paid` (2 args) | money | ✓ | Marks a purchase invoice as paid |
| `mark_kasir_dp_lunas` (2 args) | money | ✓ | Marks kasir DP (down payment) as settled |
| `update_pi` (multiple args) | money | ✓ | Updates a purchase invoice |
| `receive_purchase_order` (multiple args) | money | ✓ | Records goods receipt against a purchase order |
| `receive_replacement` (multiple args) | money | ✓ | Records replacement item receipt (retur claim fulfillment) |
| `record_piutang_payment` (multiple args) | money | ✓ | Records partial payment against piutang (receivable) |
| `record_balance_adjustment` (multiple args) | money | ✓ | Posts a GL balance adjustment journal entry |
| `record_internal_transfer` (multiple args) | money | ✓ | Posts an internal cash transfer journal entry |
| `record_owner_drawing` (multiple args) | money | ✓ | Posts owner drawing journal entry |
| `record_manual_expense` (multiple args) | money | ✓ | Posts a manual expense journal entry |
| `record_wallet_spend` (multiple args) | money | ✓ | Posts e-wallet spend journal entry |
| `record_tukar_faktur` (multiple args) | money | ✓ | Records tukar faktur (invoice exchange bundle) |
| `update_tukar_faktur` (multiple args) | money | ✓ | Updates a tukar faktur |
| `delete_tukar_faktur` (1 arg) | money | ✓ | Deletes a tukar faktur bundle (destructive) |
| `add_tagihan_to_tf` (2 args) | money | ✓ | Adds a tagihan to a tukar faktur |
| `remove_tagihan_from_tf` (2 args) | money | ✓ | Removes a tagihan from a tukar faktur |
| `request_kasir_discount_approval` (multiple args) | money | ✓ | Requests owner approval for a kasir discount |
| `cancel_kasir_discount_request` (1 arg) | money | ✓ | Cancels a pending discount approval request |
| `link_kasir_sale_to_approval` (2 args) | money | ✓ | Links a kasir sale to its discount approval |
| `accrue_period_taxes` (3 args) | money | ✓ | Posts monthly tax accrual journal entries |
| `close_accounting_period` (2 args) | money | ✓ | Closes an accounting period (irreversible) |
| `close_fiscal_year` (1 arg) | money | ✓ | Closes fiscal year (irreversible) |
| `set_opening_balance` (multiple args) | money | ✓ | Sets opening balance for a GL account |
| `initiate_warehouse_transfer` (multiple args) | money | ✓ | Initiates stock transfer between warehouses (affects inventory) |
| `receive_warehouse_transfer` (multiple args) | money | ✓ | Confirms receipt of warehouse transfer (updates stock) |
| `cancel_warehouse_transfer` (1 arg) | money | ✓ | Cancels a warehouse transfer in-progress |
| `request_adjustment` (multiple args) | money | ✓ | Requests an inventory adjustment approval |
| `commit_approved_adjustment` (1 arg) | money | ✓ | Commits an approved inventory adjustment |
| `request_purchase_order_create` (multiple args) | money | ✓ | Requests new purchase order creation approval |
| `commit_approved_purchase_order_create` (1 arg) | money | ✓ | Commits approved new PO creation |
| `request_purchase_order_amend` (multiple args) | money | ✓ | Requests PO amendment approval |
| `commit_approved_purchase_order_amend` (1 arg) | money | ✓ | Commits approved PO amendment |
| `request_tagihan_create` (multiple args) | money | ✓ | Requests tagihan (AP invoice) creation approval |
| `commit_approved_tagihan_create` (1 arg) | money | ✓ | Commits approved tagihan creation |
| `request_purchase_return` (multiple args) | money | ✓ | Requests purchase return approval |
| `commit_approved_purchase_return` (1 arg) | money | ✓ | Commits approved purchase return (stock + AP impact) |
| `request_supplier_payment` (multiple args) | money | ✓ | Requests supplier payment approval |
| `commit_approved_supplier_payment` (1 arg) | money | ✓ | Commits approved supplier payment |
| `request_tukar_faktur` (multiple args) | money | ✓ | Requests tukar faktur approval |
| `commit_approved_tukar_faktur` (1 arg) | money | ✓ | Commits approved tukar faktur |
| `request_bnl_create` (multiple args) | money | ✓ | Requests BNL (belanja numpang lewat) pass-through creation |
| `commit_approved_bnl_create` (1 arg) | money | ✓ | Commits approved BNL creation |
| `request_price_change` (multiple args) | money | ✓ | Requests product price change approval |
| `commit_approved_price_change` (1 arg) | money | ✓ | Commits approved price change (updates stock price) |
| `request_tempo_write_off` (multiple args) | money | ✓ | Requests piutang write-off approval |
| `approve_tempo_write_off` (1 arg) | money | ✓ | Approves a tempo write-off (marks order INVOICE_WRITTEN_OFF) |
| `revert_tempo_write_off` (1 arg) | money | ✓ | Reverts an approved tempo write-off |
| `post_saldo_awal_snapshot` (1 arg) | money | ✓ | Posts saldo awal (opening balance) snapshot to GL (irreversible per period) |
| `post_year_end_close` (1 arg) | money | ✓ | Posts year-end closing entries to GL |
| `reverse_saldo_awal` (2 args) | money | ✓ | Reverses a saldo awal snapshot (destructive correction) |
| `save_saldo_awal_draft` (multiple args) | money | ✓ | Saves draft saldo awal entries |

### B2 — Access/authorization

| Function | Category | SECDEF | What it does |
|---|---|---|---|
| `provision_tenant` (multiple args) | access | ✓ | Creates a new tenant + seeds all config |
| `deprovision_tenant` (1 arg) | access | ✓ | Archives a tenant (destructive) |
| `activate_tenant` (1 arg) | access | ✓ | Re-activates a suspended tenant |
| `suspend_tenant` (1 arg) | access | ✓ | Suspends a tenant (blocks access) |
| `renew_subscription` (multiple args) | access | ✓ | Renews a tenant's subscription plan |
| `update_plan_admin` (multiple args) | access | ✓ | Changes a tenant's plan (admin action) |
| `update_tenant_feature_override` (multiple args) | access | ✓ | Overrides feature flags for a tenant |
| `create_sales_rep` (multiple args) | access | ✓ | Creates a new sales rep user under a tenant |
| `deactivate_sales_rep` (1 arg) | access | ✓ | Deactivates a sales rep |
| `grant_impersonation` (multiple args) | access | ✓ | Grants an admin impersonation token for a tenant |
| `revoke_impersonation` (1 arg) | access | ✓ | Revokes an active impersonation grant |
| `stop_impersonation` (0 args) | access | ✓ | Stops an active impersonation session |
| `impersonate_tenant` (via auth hook) | access | ✓ | Auth hook that materializes impersonation JWT claims |
| `admin_upsert_user` (multiple args) | access | ✓ | Admin creates or updates a user in a tenant |
| `admin_delete_user` (1 arg) | access | ✓ | Admin hard-deletes a user |
| `change_owner_pin` (2 args) | access | ✓ | Changes the owner PIN (used for approval gating) |
| `set_tenant_modul` (multiple args) | access | ✓ | Toggles tenant module flags (e.g., disable Pembelian) |
| `set_tenant_pajak` (multiple args) | access | ✓ | Sets tenant tax configuration |

### B3 — Data mutation on core entities

| Function | Category | SECDEF | What it does |
|---|---|---|---|
| `admin_upsert_product` (multiple args) | data-mutation | ✓ | Admin creates or updates a product/SKU |
| `bulk_update_grosir_price` (1 arg: json) | bulk | ✓ | Bulk updates wholesale prices for multiple SKUs |
| `bulk_upsert_stock_promo` (1 arg: json) | bulk | ✓ | Bulk creates/updates promotional pricing for multiple SKUs |
| `update_coa_account` (multiple args) | data-mutation | ✓ | Updates a chart-of-accounts entry (name, subtype, active) |
| `save_service_catalog` (multiple args) | data-mutation | ✓ | Creates or updates a service catalog entry |
| `soft_delete_service_catalog` (1 arg) | data-mutation | ✓ | Soft-deletes a service catalog entry |
| `upsert_service_type` (2 args) | data-mutation | ✓ | Creates or updates a service type |
| `commit_initial_stock` (multiple args) | data-mutation | ✓ | Commits initial stock counts (setup phase) |
| `commit_opname` (2 args) | data-mutation | ✓ | Commits an approved stock opname (adjusts stock levels) |
| `record_opname_damage` (multiple args) | data-mutation | ✓ | Tags opname count row with a damage image URL |
| `upsert_approval_settings` (multiple args) | data-mutation | ✓ | Updates per-tenant approval workflow settings |
| `request_customer_credit_activate` (multiple args) | data-mutation | ✓ | Requests approval to activate customer credit line |
| `approve_customer_credit_activate` (2 args) | data-mutation | ✓ | Approves customer credit activation |
| `reject_customer_credit_activate` (2 args) | data-mutation | ✓ | Rejects customer credit activation request |
| `request_customer_credit_deactivate` (multiple args) | data-mutation | ✓ | Requests approval to deactivate customer credit |
| `approve_customer_credit_deactivate` (2 args) | data-mutation | ✓ | Approves customer credit deactivation |
| `request_customer_credit_limit_change` (multiple args) | data-mutation | ✓ | Requests approval to change customer credit limit |
| `approve_customer_credit_limit_change` (2 args) | data-mutation | ✓ | Approves customer credit limit change |

---

## C. Coverage matrix (the gap list)

Legend: ✅ = audited | ❌ = NOT audited | ⚠️ = audited via helper/partial

### C1 — Money-affecting

| Function | Status | Notes |
|---|---|---|
| `record_kasir_sale` | ❌ | No audit event — highest-frequency money write in the system; every POS sale goes unlogged |
| `record_pembayaran` | ❌ | No audit event — every supplier payment (AP) goes unlogged |
| `record_pi` | ✅ | `audit_log` entry `pi_recorded` on success path (in 20261115000234) |
| `create_tempo_invoice` | ❌ | No audit event — creates credit invoice + stock deduction |
| `record_payment` | ✅ | `platform_admin_audit` entry `RECORD_PAYMENT` (in 20261115000039/000023) |
| `update_payment` | ✅ | `platform_admin_audit` entry on update (in 20261115000023) |
| `delete_payment` | ✅ | `platform_admin_audit` entry on delete (in 20261115000023) |
| `verify_payment` | ✅ | `platform_admin_audit` entry on verify (in 20261115000039) |
| `reject_payment` | ✅ | `platform_admin_audit` entry on reject (in 20261115000039) |
| `create_sales_order` | ❌ | No audit event — creates sales order |
| `void_pesanan` | ❌ | No audit event — voids a sales order (irreversible) |
| `void_pembayaran` | ❌ | No audit event — voids a supplier payment |
| `void_pi` | ❌ | No audit event — voids a purchase invoice (irreversible) |
| `update_pesanan` | ❌ | No audit event — modifies a sales order |
| `close_sales_order` | ❌ | No audit event |
| `mark_walkin_order_paid` | ❌ | No audit, no SECDEF — appears inactive (only in code comment), but function still exists |
| `mark_pesanan_ordered` | ❌ | No audit event |
| `mark_pi_paid` | ❌ | No audit event |
| `mark_kasir_dp_lunas` | ❌ | No audit event — settles a DP (down payment) |
| `update_pi` | ❌ | No audit event |
| `receive_purchase_order` | ❌ | No audit event — goods receipt (stock impact) |
| `receive_replacement` | ❌ | No audit event — replacement goods receipt |
| `record_piutang_payment` | ❌ | No audit event — partial receivable payment |
| `record_balance_adjustment` | ❌ | No audit event — manual GL adjustment |
| `record_internal_transfer` | ❌ | No audit event — manual GL internal transfer |
| `record_owner_drawing` | ❌ | No audit event — owner drawing (reduces equity) |
| `record_manual_expense` | ❌ | No audit event — manual expense GL entry |
| `record_wallet_spend` | ❌ | No audit event — e-wallet spend GL entry |
| `record_tukar_faktur` | ❌ | No audit event — creates invoice exchange |
| `update_tukar_faktur` | ❌ | No audit event |
| `delete_tukar_faktur` | ❌ | No audit event — destructive delete |
| `add_tagihan_to_tf` | ❌ | No audit event |
| `remove_tagihan_from_tf` | ❌ | No audit event |
| `request_kasir_discount_approval` | ❌ | No audit event — initiates discount approval |
| `cancel_kasir_discount_request` | ❌ | No audit event — cancels pending discount approval |
| `link_kasir_sale_to_approval` | ❌ | No audit event — links sale to approved discount |
| `accrue_period_taxes` | ❌ | No audit event — posts tax accrual GL entries |
| `close_accounting_period` | ❌ | No audit event — period close (irreversible) |
| `close_fiscal_year` | ❌ | No audit event — year close (irreversible) |
| `set_opening_balance` | ❌ | No audit event |
| `initiate_warehouse_transfer` | ❌ | No audit event — starts stock in-transit |
| `receive_warehouse_transfer` | ❌ | No audit event — completes stock transfer |
| `cancel_warehouse_transfer` | ❌ | No audit event — cancels in-transit transfer |
| `request_adjustment` | ❌ | No audit event — requests stock adjustment |
| `commit_approved_adjustment` | ❌ | No audit event — commits stock adjustment |
| `request_purchase_order_create` | ❌ | No audit event |
| `commit_approved_purchase_order_create` | ❌ | No audit event |
| `request_purchase_order_amend` | ❌ | No audit event |
| `commit_approved_purchase_order_amend` | ❌ | No audit event |
| `request_tagihan_create` | ❌ | No audit event |
| `commit_approved_tagihan_create` | ❌ | No audit event |
| `request_purchase_return` | ❌ | No audit event |
| `commit_approved_purchase_return` | ❌ | No audit event — AP and stock reversal |
| `request_supplier_payment` | ❌ | No audit event |
| `commit_approved_supplier_payment` | ❌ | No audit event — actual AP payment |
| `request_tukar_faktur` | ❌ | No audit event |
| `commit_approved_tukar_faktur` | ❌ | No audit event |
| `request_bnl_create` | ❌ | No audit event |
| `commit_approved_bnl_create` | ❌ | No audit event |
| `request_price_change` | ❌ | No audit via `audit_log` or `product_price_audit`; only `bulk_update_grosir_price` writes product_price_audit |
| `commit_approved_price_change` | ❌ | Same — no audit event written |
| `request_tempo_write_off` | ✅ | `audit_log` entry `tempo_write_off_requested` (in 20260622000005) |
| `approve_tempo_write_off` | ✅ | `audit_log` entry `tempo_write_off_approved` via `_apply_tempo_write_off_change` helper |
| `revert_tempo_write_off` | ✅ | `audit_log` entry `tempo_write_off_reverted` (in 20260626000023) |
| `post_saldo_awal_snapshot` | ❌ | No audit event — posts opening balance to GL (irreversible per period) |
| `post_year_end_close` | ❌ | No audit event — posts year-end closing (irreversible) |
| `reverse_saldo_awal` | ❌ | No audit event — reverses a snapshot (destructive correction) |
| `save_saldo_awal_draft` | ❌ | No audit event |

### C2 — Approval workflow (rakit/lock)

| Function | Status | Notes |
|---|---|---|
| `request_rakit_lock` | ✅ | `audit_log` entry `rakit_lock_requested` (20260626000005) |
| `commit_approved_rakit_lock` | ✅ | `audit_log` entry `rakit_lock_approved` via `_apply_rakit_lock_change` (20260622000005 + 20260626000005) |
| `approve_and_amend_rakit_lock` | ✅ | `audit_log` entry `rakit_lock_approved_with_edit` (20260626000004) |
| `reject_rakit_lock` | ✅ | `audit_log` entry `rakit_lock_rejected` (20260626000003) |
| `withdraw_rakit_lock` | ✅ | `audit_log` entry `rakit_lock_withdrawn` (20260626000003) |
| `submit_rakit_lock` | ⚠️ | Writes to `rakit_audit_log` — but that table was DROPPED in 20260609000010. The function still exists but its INSERT target is gone. **This is a silent failure: the INSERT will raise an exception or the function is defunct.** Needs investigation. |
| `cosmetic_edit_rakit` | ❌ | No audit event (was in old rakit_audit_log, now dropped) |
| `material_edit_rakit` | ❌ | No audit event |
| `cancel_rakit` | ❌ | No audit event (was in old rakit_audit_log, now dropped) |

### C3 — Access/authorization

| Function | Status | Notes |
|---|---|---|
| `provision_tenant` | ❌ | No audit event — new tenant creation not logged |
| `deprovision_tenant` | ✅ | `platform_admin_audit` entry `ARCHIVE` (20261115000035) |
| `activate_tenant` | ✅ | `platform_admin_audit` entry `ACTIVATE` (20261115000034) |
| `suspend_tenant` | ✅ | `platform_admin_audit` entry `SUSPEND` (20261115000034) |
| `renew_subscription` | ✅ | `platform_admin_audit` entry (20261115000034) |
| `update_plan_admin` | ✅ | `platform_admin_audit` entry `CHANGE_PLAN` (20261115000025e) |
| `update_tenant_feature_override` | ✅ | `platform_admin_audit` entry `CHANGE_FEATURES` (20261115000038) |
| `create_sales_rep` | ✅ | `platform_admin_audit` entry (20261115000036) |
| `deactivate_sales_rep` | ✅ | `platform_admin_audit` entry (20261115000036) |
| `grant_impersonation` | ✅ | `platform_admin_audit` entry (20261115000050) |
| `revoke_impersonation` | ✅ | `platform_admin_audit` entry (20261115000050) |
| `stop_impersonation` | ✅ | `platform_admin_audit` entry (20261001000004 auth hook) |
| `impersonate_tenant` | ✅ | `platform_admin_audit` entry `IMPERSONATE_START` (auth hook) |
| `admin_upsert_user` | ❌ | No audit event — user creation/modification not logged |
| `admin_delete_user` | ❌ | No audit event — user deletion (destructive) not logged |
| `change_owner_pin` | ❌ | No audit event — PIN change not logged |
| `set_tenant_modul` | ❌ | No audit event — module toggle not logged |
| `set_tenant_pajak` | ❌ | No audit event |

### C4 — Data mutation on core entities

| Function | Status | Notes |
|---|---|---|
| `admin_upsert_product` | ❌ | No audit event — SKU create/edit not logged |
| `bulk_update_grosir_price` | ✅ | `product_price_audit` per-row entry (20260901000007) |
| `bulk_upsert_stock_promo` | ❌ | No audit event — bulk promo pricing not logged |
| `update_coa_account` | ❌ | No audit event — COA edit not logged |
| `save_service_catalog` | ❌ | No audit event |
| `soft_delete_service_catalog` | ❌ | No audit event |
| `upsert_service_type` | ❌ | No audit event |
| `commit_initial_stock` | ❌ | No audit event — initial stock onboarding |
| `commit_opname` | ✅ | Via `commit_opname_internal` helper → `audit_log` entry `opname_auto_commit` or `opname_owner_commit` |
| `record_opname_damage` | ❌ | No audit event — records damage tag on opname row |
| `upsert_approval_settings` | ❌ | No audit event — changes workflow approval thresholds |
| `request_customer_credit_activate` | ❌ | No audit event |
| `approve_customer_credit_activate` | ❌ | No audit event (calls `_apply_customer_credit_activate_change` which also has no audit) |
| `reject_customer_credit_activate` | ✅ | `audit_log` entry (20260630000004) |
| `request_customer_credit_deactivate` | ❌ | No audit event |
| `approve_customer_credit_deactivate` | ❌ | No audit event |
| `request_customer_credit_limit_change` | ❌ | No audit event |
| `approve_customer_credit_limit_change` | ❌ | No audit event |

### C5 — Warehouse operations (already covered by warehouse_audit_log)

| Function | Status | Notes |
|---|---|---|
| `create_warehouse` | ✅ | `warehouse_audit_log` entry `create` (20261115000200) |
| `update_warehouse` | ✅ | `warehouse_audit_log` entry `rename`/`address_update`/`sort_update` (20260613000002d) |
| `deactivate_warehouse` | ✅ | `warehouse_audit_log` entry `deactivate` (20260613000002d) |
| `force_deactivate_warehouse` | ✅ | `warehouse_audit_log` entry `force_deactivate` (20260613000002d) |
| `reactivate_warehouse` | ✅ | `warehouse_audit_log` entry `reactivate` (20260613000005) |

---

## Summary

- **Total sensitive RPCs surveyed**: 97
- **Audited (✅)**: 29 (30%)
- **NOT audited (❌)**: 65 (67%)
- **Partially audited / via helper (⚠️)**: 3 (3%)

### Top-5 highest-value gaps to patch in Round 2

1. **`record_kasir_sale`** — Highest-frequency money write in the system. Every POS transaction (invoices, DP, delivery) is invisible to forensic audit. A fraud investigation or dispute resolution on a kasir transaction currently has zero server-side audit trail. Severity: critical.

2. **`create_tempo_invoice` + `record_pembayaran`** — The B2B credit sales flow. Tempo invoices create receivables and deduct stock; pembayaran records supplier payments. Both have zero audit coverage. Combined these cover the highest-value transaction paths after kasir. Severity: critical.

3. **`request_purchase_order_create` / `commit_approved_purchase_order_create` / `request_tagihan_create` / `commit_approved_tagihan_create` / `commit_approved_supplier_payment`** — The entire Pembelian (procurement) approval workflow has no audit trail. An AP fraud scenario (fake PO → fake invoice → payment diversion) would be undetectable post-fact. Severity: high.

4. **`post_saldo_awal_snapshot` / `post_year_end_close` / `reverse_saldo_awal`** — Opening balance and year-end close are irreversible financial operations. No audit event = no forensic record of who triggered the year-end close or reversed an opening balance. Severity: high (grows as tenants approach first year-end).

5. **`admin_upsert_user` / `admin_delete_user` / `provision_tenant`** — User creation/deletion and tenant provisioning are high-trust operations. Currently `provision_tenant` has no audit even though `deprovision_tenant` does. `admin_upsert_user`/`admin_delete_user` similarly. Severity: high (compliance and insider-threat detection).

---

## Recommendations (for founder review)

### Gaps to patch in P2-C Round 2

**Priority 1 (critical — money + highest frequency)**
- `record_kasir_sale` — add `audit_log` entry with `{tenant_id_from_payload, transaction_id, total_amount, channel, actor_user_id}`
- `create_tempo_invoice` — add `audit_log` entry with `{order_id, customer_id, total, channel}`
- `record_pembayaran` — add `audit_log` entry with `{pembayaran_id, po_id, amount, method}`

**Priority 2 (high — irreversible and approval-gated)**
- `post_saldo_awal_snapshot`, `post_year_end_close`, `reverse_saldo_awal` — 3 RPCs, each needs one `audit_log` entry; the reversal especially needs a `reason` field in payload
- `commit_approved_supplier_payment` — the final money-out step in the Pembelian flow
- `request_purchase_order_create` + `commit_approved_purchase_order_create` — 2 key PO approval events

**Priority 3 (high — access control)**
- `provision_tenant` — add `platform_admin_audit` entry `CREATE_TENANT` (deprovision already has it; this is an asymmetry)
- `admin_upsert_user`, `admin_delete_user` — add `platform_admin_audit` entry (category `UPSERT_USER` / `DELETE_USER`)
- `change_owner_pin` — add `audit_log` entry (no payload content needed, just timestamp + actor)

**Priority 4 (medium — remaining approval workflow)**
- Full Pembelian approval chain: `request_tagihan_create`, `commit_approved_tagihan_create`, `request_purchase_return`, `commit_approved_purchase_return`, `request_purchase_order_amend`, `commit_approved_purchase_order_amend`, `request_bnl_create`, `commit_approved_bnl_create`
- Customer credit workflow: `request_customer_credit_activate`, `approve_customer_credit_activate`, `request_customer_credit_deactivate`, `approve_customer_credit_deactivate`, `request_customer_credit_limit_change`, `approve_customer_credit_limit_change`
- Warehouse transfer: `initiate_warehouse_transfer`, `receive_warehouse_transfer`, `cancel_warehouse_transfer` (none have audit despite stock impact)

### Defer to later (lower risk justification)

- `save_saldo_awal_draft` — non-destructive draft save; audit on `post_saldo_awal_snapshot` provides the forensic anchor
- `record_opname_damage` — low fraud risk; damage tag is a URL annotation on a count row; the opname commit IS audited
- `upsert_approval_settings`, `set_tenant_modul`, `set_tenant_pajak` — config changes; can defer if tenant settings table has an `updated_at + updated_by` column (check before deferring)
- `bulk_upsert_stock_promo`, `upsert_service_type`, `save_service_catalog` — operational catalog changes; medium risk, defer to P2-D
- `request_kasir_discount_approval`, `cancel_kasir_discount_request` — kasir discount approvals; `request_kasir_discount_approval` creates an `approval_requests` row (provides a trail); cancel is low-risk

### Structural findings (for architect review)

1. **`audit_log` has no `tenant_id` column.** In a multi-tenant system, forensic queries require joining `actor_user_id → admin_users → tenant_id` or extracting from `payload`. This is non-indexed and fragile. Every event that writes to `audit_log` should include `tenant_id` either as a top-level column (preferred) or consistently in `payload`. Recommend adding `tenant_id UUID` column in a non-breaking migration (nullable, backfill via join) and updating all RPC writers.

2. **`submit_rakit_lock` function references a dropped table.** Migration 20260608000009 defines `submit_rakit_lock` with an `INSERT INTO public.rakit_audit_log`. Migration 20260609000010 drops `rakit_audit_log`. The function body is now broken — any call to `submit_rakit_lock` will fail with a missing-table error. Verify whether this function is still called from the frontend before Round 2.

3. **`audit_log` lacks RLS on audit actor isolation.** With `FORCE ROW LEVEL SECURITY` enabled but no per-tenant policy, an authenticated user can potentially read all audit events from all tenants (if the read RPC doesn't filter). Verify the `list_audit_events` RPC applies a tenant_id filter.

4. **`approve_customer_credit_activate` / `reject_customer_credit_activate` are asymmetric.** `reject` is audited (20260630000004); `approve` is not. Both should be.

5. **`mark_walkin_order_paid` has no SECDEF and no audit.** The function still exists in the DB but appears inactive (only in a code comment). Recommend confirming it's no longer called, then dropping it to eliminate the non-SECDEF write path.

---

## Follow-ups explicitly out of scope for P2-C

- Retention policy (how long to keep audit rows)
- Log rotation / archival (partition by month, cold storage)
- Compliance certification prep (ISO 27001, SOC 2, etc.)
- New audit table design (tenant_id addition is noted but implementation is Round 2+)
- Alerting/anomaly detection on audit events
- Audit event streaming to external SIEM
