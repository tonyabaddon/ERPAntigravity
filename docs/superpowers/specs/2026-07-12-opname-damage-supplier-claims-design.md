# Opname Damage Flag + Unified Supplier Claims — Design

**Status:** Draft (pending user review)
**Author:** Tony Wei + Claude
**Date:** 2026-07-12
**Scope:** Item #1 in a 5-item brainstorm sweep. Items #2-5 are separate specs.

---

## 1. Overview & Goals

### 1.1 Purpose

Enable admin untuk flag barang rusak **inline** saat stock opname, dan unify semua "pending supplier claim" (dari PO receipt damage + opname damage + ad-hoc stock adjustment damage) ke **satu source of truth** dengan resolution workflow yang consistent.

### 1.2 Goals

1. Admin bisa flag rusak per-line saat opname (inline, no context-switch ke separate adjustment flow)
2. Single unified `supplier_claims` model yang cover 3 sources: PO receipt, opname, ad-hoc adjustment
3. Owner-configurable approval gate untuk resolve klaim (via existing `approval_settings` framework)
4. Proper akuntansi: existing rusak-adjustment bug fixed as byproduct (rusak sekarang post journal, tidak lagi silent stock decrement)
5. Backward-compatible dengan existing PO damage UI (`ReceiveGoodsModal`, `ReceiveReplacementModal`)
6. Scale-ready: config-driven visibility per tenant SOP, extensible source types + resolution outcomes

### 1.3 Non-goals (explicit YAGNI)

- WA notification ke supplier (per user feedback: no supplier WA)
- Journal template + tenant_gl_mapping runtime editor (defer to accounting maturity initiative)
- Aging report untuk pending claims (nice-to-have, defer)
- Multi-currency claims (structure ready, no logic)
- Approval workflow untuk creating claims (only resolve is gated)
- Supplier retur workflow beyond record-keeping (physical logistics offline)

---

## 2. Data Model

### 2.1 New table: `supplier_claims`

Single source of truth untuk pending goods claim ke supplier.

```sql
CREATE TABLE public.supplier_claims (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  supplier_id           UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  sku                   TEXT NOT NULL,
  warehouse             TEXT NOT NULL,  -- migrate to warehouse_id post-Phase 3 cutover
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  unit_cost             NUMERIC(15,2) NOT NULL CHECK (unit_cost >= 0),
  currency_code         TEXT NOT NULL DEFAULT 'IDR',  -- future multi-currency
  source_type           TEXT NOT NULL CHECK (source_type IN ('PO_RECEIPT','STOCK_OPNAME','STOCK_ADJUSTMENT')),
  source_ref_id         BIGINT NOT NULL,
  damage_notes          TEXT,
  evidence_urls         TEXT[],
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','RESOLVED_REPLACED','RESOLVED_CREDITED','RESOLVED_CASHED','REJECTED')),
  resolution_amount     NUMERIC(15,2),  -- actual refund/credit amount (may differ from qty*unit_cost)
  resolution_target_id  TEXT,           -- e.g. AP invoice id for CREDITED, Kas/Bank account code for CASHED
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES auth.users(id),
  resolution_journal_id BIGINT REFERENCES journal_entries(id),
  resolution_notes      TEXT,
  approval_request_id   BIGINT REFERENCES approval_requests(id),  -- link kalau resolve via approval_settings gate
  idempotency_key       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_supplier_claims_tenant_status ON supplier_claims(tenant_id, status);
CREATE INDEX idx_supplier_claims_supplier_status ON supplier_claims(supplier_id, status);
CREATE INDEX idx_supplier_claims_source ON supplier_claims(source_type, source_ref_id);
CREATE UNIQUE INDEX uq_supplier_claims_po_source ON supplier_claims(source_ref_id) WHERE source_type='PO_RECEIPT';
CREATE UNIQUE INDEX uq_supplier_claims_opname_source ON supplier_claims(source_ref_id, sku, warehouse) WHERE source_type='STOCK_OPNAME';
CREATE UNIQUE INDEX uq_supplier_claims_adj_source ON supplier_claims(source_ref_id) WHERE source_type='STOCK_ADJUSTMENT';
CREATE UNIQUE INDEX uq_supplier_claims_idempotency ON supplier_claims(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

### 2.2 Audit trail table: `supplier_claim_events`

Append-only event log per claim (created, updated, resolved, void).

```sql
CREATE TABLE public.supplier_claim_events (
  id               BIGSERIAL PRIMARY KEY,
  claim_id         BIGINT NOT NULL REFERENCES supplier_claims(id),
  event_type       TEXT NOT NULL CHECK (event_type IN ('CREATED','APPROVAL_REQUESTED','APPROVED','RESOLVED','REJECTED','VOIDED')),
  actor_user_id    UUID,
  payload          JSONB,
  journal_entry_id BIGINT REFERENCES journal_entries(id),
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_supplier_claim_events_claim ON supplier_claim_events(claim_id, at);
```

### 2.3 Existing tables — additive changes

**`stock_adjustments`** — add disposition + supplier context + optional link ke claim:
```sql
ALTER TABLE stock_adjustments ADD COLUMN damage_disposition TEXT
  CHECK (damage_disposition IS NULL OR damage_disposition IN ('DISPOSE','KLAIM_SUPPLIER'));
ALTER TABLE stock_adjustments ADD COLUMN damage_supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE stock_adjustments ADD COLUMN supplier_claim_id BIGINT REFERENCES supplier_claims(id);
-- Constraint: if disposition=KLAIM_SUPPLIER then damage_supplier_id required
ALTER TABLE stock_adjustments ADD CONSTRAINT klaim_requires_supplier
  CHECK (damage_disposition != 'KLAIM_SUPPLIER' OR damage_supplier_id IS NOT NULL);
```

**`purchase_order_items`** — link ke claim + extend damage_status enum:
```sql
ALTER TABLE purchase_order_items ADD COLUMN supplier_claim_id BIGINT REFERENCES supplier_claims(id);
-- damage_status enum extension (Gap 3 decision A)
ALTER TYPE damage_status_enum ADD VALUE 'RESOLVED_CREDITED';
ALTER TYPE damage_status_enum ADD VALUE 'RESOLVED_CASHED';
ALTER TYPE damage_status_enum ADD VALUE 'REJECTED';
```

**`stock_opname_counts`** — capture damage at count time:
```sql
ALTER TABLE stock_opname_counts ADD COLUMN damaged_qty INTEGER NOT NULL DEFAULT 0
  CHECK (damaged_qty >= 0);
ALTER TABLE stock_opname_counts ADD CONSTRAINT damaged_qty_within_counted
  CHECK (damaged_qty <= counted_qty);
ALTER TABLE stock_opname_counts ADD COLUMN damage_disposition TEXT
  CHECK (damage_disposition IS NULL OR damage_disposition IN ('DISPOSE','KLAIM_SUPPLIER'));
ALTER TABLE stock_opname_counts ADD COLUMN damage_supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE stock_opname_counts ADD COLUMN damage_notes TEXT;
ALTER TABLE stock_opname_counts ADD COLUMN damage_evidence_urls TEXT[];
```

### 2.4 Chart of Accounts additions

```sql
INSERT INTO chart_of_accounts (account_code, account_name, account_type, parent_code) VALUES
  ('1-1460', 'Piutang Klaim Supplier', 'ASET',  '1-1400'),
  ('5-3160', 'Beban Barang Rusak',     'BEBAN', '5-3000');
```

- `1-1460` — suspense asset holding pending klaim value
- `5-3160` — expense untuk damage loss (dispose, reject supplier, partial refund variance)

### 2.5 CHECK constraint enumeration (existing tables to be modified)

Before implementation, RPC must satisfy ALL existing CHECKs on tables being modified. Enumerated below (verify current state during implementation):

- **`stock_adjustments`**: existing status enum values, qty_delta constraints, approval_request linkage rules
- **`purchase_order_items`**: qty_ordered/qty_received/qty_damaged non-negative, damage_status enum membership, price non-negative
- **`stock_opname_counts`**: counted_qty >= 0, variance computed from counted - system_qty (STORED column recomputes on update)

Implementation plan will enumerate exact current CHECKs from live schema before writing migrations.

---

## 3. RPCs (Backend)

### 3.1 Write RPCs — 2 create + 1 resolve + 1 internal helper

**Convention:** semua SECURITY DEFINER, OWNED BY `vosi_rpc_owner`. Tenant scope derived dari JWT `auth.uid()`. Idempotency key optional.

**`create_supplier_claim_from_opname(session_id, sku, warehouse, damaged_qty, disposition, supplier_id, notes, evidence_urls[], idempotency_key)`**
- Guard: caller must be admin/owner in tenant
- Validate `damaged_qty > 0`, `damaged_qty <= counted_qty` for the opname row
- For `disposition='DISPOSE'`: create `stock_adjustments` row (reason='rusak', damage_disposition='DISPOSE'), commit stock decrement, post journal (Dr 5-3160 / Cr 1-1510)
- For `disposition='KLAIM_SUPPLIER'`: create `stock_adjustments` row (damage_disposition='KLAIM_SUPPLIER'), call `_insert_supplier_claim(...)`, link back, post journal (Dr 1-1460 / Cr 1-1510)
- Return `{adjustment_id, claim_id}`

**`create_supplier_claim_from_po_receipt(po_item_id, qty, notes, evidence_urls[], idempotency_key)`**
- Called from `receive_purchase_order` when `qty_damaged > 0`
- Call `_insert_supplier_claim(source_type='PO_RECEIPT', source_ref_id=po_item_id, ...)`
- Update `purchase_order_items.supplier_claim_id = new_claim.id`, `damage_status = 'PENDING_RETURN'`
- **No journal posted here** — journal happens later at `record_pi` (see §4b)
- Return `{claim_id}`

**Ad-hoc adjustment source has no separate public create RPC.** Reason: adjustment commit already handles stock + journal atomically via `_apply_adjustment_change`. Adding a separate wrapper would either double-post journal or fragment the transaction. Instead, `_apply_adjustment_change` is modified (§3.3) to read `damage_disposition` + `damage_supplier_id` from the adjustment row and call `_insert_supplier_claim(...)` directly when disposition='KLAIM_SUPPLIER'. Frontend interacts via existing `request_adjustment` RPC (with new disposition params).

**`_insert_supplier_claim(source_type, source_ref_id, supplier_id, sku, warehouse, qty, unit_cost, notes, evidence_urls[])`**
- Internal helper (not exposed via PostgREST — schema `private` or naming convention)
- INSERT into `supplier_claims` with status='PENDING'
- INSERT into `supplier_claim_events` (event_type='CREATED')
- Return `claim_id`

**`resolve_supplier_claim(claim_id, outcome, resolution_amount, resolution_target_id, notes, evidence_urls[], idempotency_key)`**
- Guard: `SELECT ... FOR UPDATE` claim row, verify status='PENDING'
- Check `approval_settings` for tenant + request_type='RESOLVE_SUPPLIER_CLAIM':
  - If threshold hit and no pre-existing approval_request → create approval_request, return `{status: 'PENDING_APPROVAL', approval_request_id}` (async workflow, resume later)
  - If approval already granted (linked via approval_request_id) → proceed
  - If no threshold hit → proceed inline
- Post journal per outcome (see §4c) — handle variance (Gap 2 decision B) if `resolution_amount ≠ qty × unit_cost`
- For CREDITED: check supplier Utang balance; if refund > balance → split (Dr 2-1100 partial + Dr 1-1450 remainder as prepayment)
- Update `supplier_claims.status`, `resolved_at`, `resolved_by`, `resolution_journal_id`, etc.
- For REPLACED: also insert `stock_movements` +qty at same unit_cost, refresh `stock_levels`
- For PO_RECEIPT source: sync `purchase_order_items.damage_status` to matching outcome enum value
- INSERT into `supplier_claim_events` (event_type='RESOLVED')
- Immutable: no re-resolve allowed

### 3.2 Read RPCs

All SECURITY DEFINER, tenant-scoped from JWT.

- **`list_supplier_claims(filter_status TEXT[], filter_supplier_id UUID, filter_source_type TEXT[], filter_date_range DATERANGE, page_size INT, cursor TEXT)`** — paginated list untuk Klaim Supplier menu. Filterable columns match UI filter bar.
- **`get_supplier_claim(claim_id BIGINT)`** — single claim detail dengan supplier name, PO ref, opname session ref (whichever applicable), computed `book_value = qty × unit_cost`.
- **`list_supplier_claim_events(claim_id BIGINT)`** — timeline events for row expand.

### 3.3 Modifications to existing RPCs

**`commit_opname_session`** — iterate `stock_opname_counts` where `damaged_qty > 0`:
- For each row, call appropriate create RPC based on `damage_disposition`
- Rest of variance handling (non-damaged) proceeds as existing behavior

**`receive_purchase_order`** — when `qty_damaged > 0`:
- Call `create_supplier_claim_from_po_receipt(...)` instead of just setting `damage_status='PENDING_RETURN'` inline (RPC does that + creates claim record)

**`receive_replacement`** — thin wrapper: call `resolve_supplier_claim(outcome='RESOLVED_REPLACED', ...)`. UI unchanged.

**`_apply_adjustment_change`** — add journal posting + optional claim insertion for reason='rusak' (Gap 1 fix — decision A):
- If reason='rusak' + damage_disposition='DISPOSE': post Dr 5-3160 / Cr 1-1510
- If reason='rusak' + damage_disposition='KLAIM_SUPPLIER': post Dr 1-1460 / Cr 1-1510, call `_insert_supplier_claim(source_type='STOCK_ADJUSTMENT', source_ref_id=adjustment.id, supplier_id=adjustment.damage_supplier_id, ...)`, UPDATE `stock_adjustments.supplier_claim_id = new_claim.id`
- Other reasons ('hilang', 'sampel', 'koreksi_input'): out of scope for this feature (existing behavior preserved; separate cleanup ticket)
- All modifications happen in single transaction with existing stock_movements + stock_levels updates → atomic guarantee

**`record_pi`** (record purchase invoice — Tagihan) — modify GL split (see §4b for details):
- Read PO items' `qty_damaged` at record_pi time
- Split debit: `Dr 1-1510 × (qty_good × cost) + Dr 1-1460 × (qty_damaged × cost) / Cr 2-1100 × total`
- Gated by feature flag `enable_pi_damage_split` (see §10)

---

## 4. Accounting (Journals)

All debits and credits verified balanced. Amounts in IDR (single currency for now).

### 4.1 CREATE events

**Opname DISPOSE** (qty=5, unit_cost=100,000):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `5-3160` Beban Barang Rusak | 500,000 | |
| 2 | `1-1510` Persediaan Barang Jadi | | 500,000 |

**Opname KLAIM** (qty=5, unit_cost=100,000):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `1-1460` Piutang Klaim Supplier | 500,000 | |
| 2 | `1-1510` Persediaan Barang Jadi | | 500,000 |

**Ad-hoc adjustment DISPOSE / KLAIM** — same as Opname DISPOSE / KLAIM respectively.

### 4.2 PO receipt damage — journal at Tagihan (record_pi)

Current `record_pi`: `Dr 1-1510 total / Cr 2-1100 total` (all received qty to Persediaan).

**Modified** (feature-flagged): split debit based on `qty_damaged`.

Example: PO 100 unit @ 100,000, qty_damaged=3, Tagihan total = 10,000,000.

| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `1-1510` Persediaan Barang Jadi (97 × 100k) | 9,700,000 | |
| 2 | `1-1460` Piutang Klaim Supplier (3 × 100k) | 300,000 | |
| 3 | `2-1100` Hutang Usaha | | 10,000,000 |

Balance: 9,700,000 + 300,000 = 10,000,000 ✓

### 4.3 RESOLVE events (all with book_value = qty × unit_cost)

**REPLACED** (book Rp 500,000, supplier ganti barang):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `1-1510` Persediaan Barang Jadi | 500,000 | |
| 2 | `1-1460` Piutang Klaim Supplier | | 500,000 |

Plus stock_movement +qty at same unit_cost.

**CREDITED exact** (book 500k, credit 500k, Utang balance ≥ 500k):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `2-1100` Hutang Usaha | 500,000 | |
| 2 | `1-1460` Piutang Klaim Supplier | | 500,000 |

**CREDITED partial** (book 500k, credit 400k, Utang balance ≥ 400k):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `2-1100` Hutang Usaha | 400,000 | |
| 2 | `5-3160` Beban Barang Rusak (loss) | 100,000 | |
| 3 | `1-1460` Piutang Klaim Supplier | | 500,000 |

**CREDITED with Utang overflow** (Gap 2 decision B; book 500k, credit 500k, Utang balance = 300k):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `2-1100` Hutang Usaha (up to balance) | 300,000 | |
| 2 | `1-1450` Piutang Lain-lain (voucher supplier) | 200,000 | |
| 3 | `1-1460` Piutang Klaim Supplier | | 500,000 |

UI warns: "Sisa Rp 200,000 akan dicatat sebagai voucher supplier (Piutang Lain-lain). Bisa dipakai potongan pembayaran PO berikutnya ke supplier ini."

**CASHED exact** (book 500k, cash 500k ke Bank BCA `1-1200`):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `1-1200` Bank | 500,000 | |
| 2 | `1-1460` Piutang Klaim Supplier | | 500,000 |

**CASHED partial** (book 500k, cash 400k):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `1-1200` Bank | 400,000 | |
| 2 | `5-3160` Beban Barang Rusak (loss) | 100,000 | |
| 3 | `1-1460` Piutang Klaim Supplier | | 500,000 |

**CASHED overpay** (book 500k, cash 600k — rare, supplier goodwill):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `1-1200` Bank | 600,000 | |
| 2 | `1-1460` Piutang Klaim Supplier | | 500,000 |
| 3 | `4-1200` Pendapatan Lain-lain | | 100,000 |

**REJECTED** (supplier tolak, jadi loss):
| Line | Account | Debit | Credit |
|---|---|---|---|
| 1 | `5-3160` Beban Barang Rusak | 500,000 | |
| 2 | `1-1460` Piutang Klaim Supplier | | 500,000 |

### 4.4 Journal helper convention

All journals via existing `_post_journal_entry(entry_date, source_type='SUPPLIER_CLAIM', description, lines jsonb, source_ref_table='supplier_claims', source_ref_id=claim_id, tenant_id)`.

Account codes hardcoded in RPC as named PL/pgSQL constants at top of function:
```sql
v_acc_claim_suspense CONSTANT TEXT := '1-1460';
v_acc_damage_loss    CONSTANT TEXT := '5-3160';
v_acc_inventory      CONSTANT TEXT := '1-1510';
v_acc_ap             CONSTANT TEXT := '2-1100';
v_acc_prepay         CONSTANT TEXT := '1-1450';
v_acc_other_income   CONSTANT TEXT := '4-1200';
```

Future template refactor (tenant_gl_mapping) = separate initiative.

---

## 5. UI

### 5.1 Opname flag — inline in count table

- Per counted row: tombol `🚩 Flag Rusak` (visible when `counted_qty > 0`)
- Click → `<DamageFlagModal>`:
  - Damage qty input (0 to counted_qty, live validation, warning if 100%)
  - Radio: **Dispose (buang, catat sebagai loss)** vs **Klaim Supplier (retur/refund)**
  - If Klaim: supplier dropdown (default = last supplier from PO of this SKU, else free select from suppliers list)
  - Notes textarea (optional)
  - Photo upload (existing evidence_urls pattern from `StockAdjustmentModal`)
- Row header after flag: badge `🚩 5 rusak — Klaim PT ABC` (or `Dispose`)
- Live compute: `Sellable = counted_qty - damaged_qty` shown as subtext

### 5.2 Klaim Supplier menu (new tab in Pembelian)

Tab order: `... bnl | klaim | pembayaran | suppliers` (position 6)

Page structure:
- Header: 4 summary cards — Pending count, Total value pending, Resolved this month, Rejected this month
- Filter bar: Status | Supplier | Date range | Source type badge
- Table columns: `Tanggal | SKU | Qty | Supplier | Source | Nilai (qty×unit_cost) | Status | Action`
- Row expand: notes, foto bukti (thumbnail), timeline (`supplier_claim_events`)
- Action per PENDING row: "Resolve" → `<ClaimResolveModal>` (5.4)

### 5.3 Backward-compat existing PO damage UI

- **`ReceiveGoodsModal`** — captures `qty_damaged` at receipt. After submit, RPC auto-creates claim. Badge appears: `🚩 X rusak — klaim dibuat`
- **`ReceiveReplacementModal`** — becomes thin wrapper: internal `resolve_supplier_claim(outcome='RESOLVED_REPLACED', ...)`. UI unchanged.
- **`StockAdjustmentModal`** — when reason=rusak: disposition radio appears (Dispose default). Klaim → supplier dropdown appears (required). Submit calls existing `request_adjustment` RPC with new params (`damage_disposition`, `damage_supplier_id`). On approve+commit, `_apply_adjustment_change` handles claim insertion + journal atomically (see §3.3).

### 5.4 `<ClaimResolveModal>` (reusable)

Header: `Resolve Klaim — [SKU × qty] dari [Supplier]`. Show `Book value: Rp X`.

Outcome radio (4 options — future-extensible via tenant `enabled_claim_outcomes`):
- **Replacement** — no extra input
- **Credit note** — optional dropdown of open AP invoices for this supplier + amount input
- **Cash refund** — Kas/Bank dropdown (Kas Toko / Bank / E-Wallet accounts) + amount input (default = book value, editable)
- **Reject** — no extra input

Resolution notes (optional) + additional photos (optional, e.g. WA screenshot).

**Approval gate handling:**
- On submit: RPC checks `approval_settings`
- If threshold hit + verification_method='PIN': inline PIN input appears, RPC verifies + proceeds
- If verification_method='APP_INBOX': modal shows "Ditambahkan ke inbox owner", RPC creates approval_request, returns PENDING_APPROVAL. Owner sees in inbox menu, approves, callback resolves.
- **WA_BUTTON not supported for this feature** — WA-based approval feels like overhead for a workflow already covered by in-app inbox. Per-tenant `approval_settings` for RESOLVE_SUPPLIER_CLAIM only accepts PIN or APP_INBOX.
- If no gate: submit inline, close modal, refresh list.

**Variance handling UI:**
- If user enters resolution_amount ≠ book_value: warning banner appears with breakdown ("Refund Rp X, book value Rp Y, selisih Rp Z akan dicatat sebagai [loss/pendapatan/voucher]")
- User must confirm before submit

### 5.5 Reusable components

| Component | Reused di |
|---|---|
| `<DamageFlagModal>` | Opname row + StockAdjustmentModal |
| `<ClaimListTable>` | Klaim menu, PO detail drill-down, Opname session detail, Supplier profile |
| `<ClaimResolveModal>` | Klaim menu, ReceiveReplacementModal (wrapped), ad-hoc adjustment resolve |
| `<ClaimStatusBadge>` | List, detail, timeline everywhere |

### 5.6 Config-driven visibility

- `tenant_config.enabled_claim_sources` (default: all). Warung tenant can disable `PO_RECEIPT` if no formal PO flow.
- `tenant_config.enabled_claim_outcomes` (default: all). Retail can hide `REPLACED` if supplier never sends replacement.

Grandfathering: existing PENDING claims with sources/outcomes later disabled remain resolvable.

### 5.7 Discoverability hooks

- Supplier profile page: badge "Aktif klaim: 5" → filtered list link
- PO detail page: section "Klaim terkait" for linked claims (audit trail)
- Opname session detail: section "Klaim dari session ini" (audit trail)
- Dashboard card (future — coordinated with Item #3 refresh)

### 5.8 Design system compliance

- Body text 13-14px (base UI), 11-12px for PDF only
- Icons: `AlertTriangle` (rusak), `Package` (SKU), `Truck` (supplier), `CheckCircle2` (resolved), `XCircle` (rejected)
- Badge palette (existing VOSI-Design-System): kuning (pending), hijau (resolved-replaced), biru (resolved-credit), ungu (resolved-cash), merah (rejected)

### 5.9 Permission model

| Role | Create claim | Resolve below threshold | Resolve above threshold |
|---|---|---|---|
| Admin | ✅ | ✅ | ❌ (needs Owner approval per config) |
| Owner | ✅ | ✅ | ✅ (self-approve if verification=PIN) |
| View-only | ❌ | ❌ | ❌ |

---

## 6. RLS + SECDEF Pattern

**Design constraints** (from CLAUDE.md memory):
- `_guard_expiry_write()` predicate broken → direct client writes to `t_*`-policied tables blocked → every new write path needs SECDEF RPC
- SECDEF RPC owned by `vosi_rpc_owner` must have `t_select_own` include `vosi_rpc_owner` for `INSERT ... RETURNING` to work
- Platform-admin read RLS for SECDEF requires policy-level opt-in (not membership-based)

### 6.1 Policy skeleton for new tables

`supplier_claims` and `supplier_claim_events` — RLS enabled.

**Read policies** (`p_select_own`):
```sql
CREATE POLICY p_select_own ON supplier_claims TO {authenticated}
  USING (tenant_id = (SELECT tenant_id FROM user_tenant WHERE user_id = auth.uid()));
```

**Write policies** — write only via SECDEF RPC. Add stub policy `t_no_direct_write TO {authenticated} WITH CHECK (false)` to block direct writes.

**SECDEF ownership grant** — `t_select_own TO vosi_rpc_owner` also, for RETURNING support:
```sql
CREATE POLICY t_select_own_secdef ON supplier_claims TO vosi_rpc_owner
  USING (true);  -- SECDEF trusted; tenant scope enforced in RPC
```

**Platform admin readall** (per memory: 79 tables have supplementary `p_platform_admin_readall`) — add same policy on new tables.

### 6.2 RPC ownership

All new RPCs `OWNER TO vosi_rpc_owner`. Grant EXECUTE to `authenticated`. RPCs derive tenant from `auth.uid()` → `user_tenant` join.

### 6.3 Reads

- Read RPCs (`list_*`, `get_*`) also SECDEF for consistency + centralized filter logic
- Direct table SELECT allowed via `p_select_own` if needed elsewhere in codebase

---

## 7. Approval Flow Integration

Reuse existing `approval_settings` framework with new `request_type = 'RESOLVE_SUPPLIER_CLAIM'`.

### 7.1 Seed config

Default: no gate. Tenant configures via Pengaturan → Approval Settings:
- `approval_required` (bool)
- `threshold_amount` (Rp — trigger when `resolution_amount ≥ threshold`)
- `threshold_qty` (unused for claims)
- `verification_method` (PIN | APP_INBOX only — WA_BUTTON explicitly excluded for this feature)

### 7.2 Two verification flows in `resolve_supplier_claim`

**PIN inline:**
1. UI shows PIN input when threshold hit
2. User enters PIN, submit
3. RPC calls existing `verify_owner_pin(pin_text)` — pass/fail
4. On pass: proceed with resolution, post journal, return SUCCESS
5. Idempotent: RPC checks `approval_request_id` on claim — if already granted, skip verification

**APP_INBOX (async):**
1. UI submits without PIN
2. RPC creates `approval_requests` row (existing table), links `supplier_claims.approval_request_id`
3. RPC returns `{status: 'PENDING_APPROVAL', approval_request_id}`
4. UI shows "Ditambahkan ke inbox owner"
5. Owner sees pending item in existing Approval Inbox menu
6. Callback flow: owner clicks approve → updates `approval_requests.status='APPROVED'` → triggers `resolve_supplier_claim` retry (idempotent — proceeds because approval_request_id already linked and status=APPROVED)

**WA_BUTTON explicitly not supported.** Rationale: (a) in-app inbox already covers async owner approval without external dependencies, (b) WA callback plumbing adds failure modes (webhook delays, delivery failures) without proportional UX benefit for this workflow, (c) reduces test surface. If tenant configures verification_method='WA_BUTTON' for RESOLVE_SUPPLIER_CLAIM, RPC returns error `wa_not_supported_for_claim_resolve` — Pengaturan UI should also grey out the WA option for this request_type.

### 7.3 Idempotency in resolve

`idempotency_key` UNIQUE per tenant. Same key resubmitted returns cached result. Prevents double-post on retry.

---

## 8. Rollout Plan

### 8.1 Feature flag

`tenant_config.enable_pi_damage_split` (default: false). Toggles `record_pi` split behavior only.

- Off: existing behavior (Dr 1-1510 full / Cr 2-1100). Damage tracked on PO but not in journal.
- On: split debit as per §4.2.

Other pieces (new tables, opname flag UI, klaim menu, resolve RPC) not flagged — safe to deploy off by default.

### 8.2 Deployment order

1. Deploy schema migrations (100-101): new tables + column additions + COA + enum extensions
2. Deploy RPCs (102-103): create/resolve + read RPCs + RLS policies
3. Deploy UI (frontend release): opname flag button, klaim menu, resolve modal
4. Run backfill migration (104): existing PO damage_status → supplier_claims
5. Enable `enable_pi_damage_split` per tenant after verify (start with Garindo, then rollout)

### 8.3 In-flight handling

- PIs posted BEFORE flag=on retain old journal shape. `record_pi` reads flag at call time.
- If flag flipped mid-day, PIs posted after get split. No conflicts (each PI's journal is atomic).

### 8.4 Rollback

- Feature flag off returns to existing behavior
- Backfill migration idempotent — safe to re-run
- New tables don't affect existing queries (no shared references except optional FKs which are nullable)
- Enum extensions non-removable (Postgres limitation) — accept as one-way door

---

## 9. Backfill Migration

**File:** `supabase/migrations/20261115000104_backfill_supplier_claims.sql`

**Purpose:** create audit-trail claim records for existing `purchase_order_items` with `damage_status ≠ 'NONE'`.

### 9.1 Approach — batched, idempotent, resumable

- Batch size: 500 rows per iteration
- Progress checkpoint in temp table `_migration_supplier_claims_progress(last_processed_po_item_id BIGINT)`
- Loop:
  1. SELECT next 500 po_items where damage_status IN ('PENDING_RETURN','RETURNED','REPLACED') AND supplier_claim_id IS NULL, ORDER BY id, LIMIT 500
  2. INSERT into supplier_claims per row:
     - source_type='PO_RECEIPT', source_ref_id=po_item.id
     - qty=qty_damaged, unit_cost from PO item (or historical stock_movements join)
     - status: map from damage_status (PENDING_RETURN → PENDING, RETURNED → PENDING, REPLACED → RESOLVED_REPLACED)
     - resolved_at = po_item.updated_at (best-effort audit)
     - resolution_journal_id = NULL (no re-post)
  3. UPDATE po_items SET supplier_claim_id = new_claim.id
  4. UPSERT checkpoint with max(id) processed
  5. COMMIT batch
- Loop exits when SELECT returns 0 rows

### 9.2 Idempotency

- WHERE `supplier_claim_id IS NULL` — skip already-migrated rows
- Safe to re-run: partial progress preserved via checkpoint

### 9.3 Post-migration verification

- Row count: existing damaged PO items should equal count in supplier_claims where source_type='PO_RECEIPT'
- Sanity: no orphan (supplier_claim referenced by PO item but claim missing)
- Journal balance unchanged (no re-post)

---

## 10. Testing Strategy

### 10.1 Migration tests

- Apply new migrations on staging clone of prod schema
- Verify: new tables exist with expected columns, indexes, RLS enabled
- Verify: enum extensions applied
- Verify: existing FIFO ledger balance unchanged post-migration

### 10.2 Unit tests (RPC-level)

Per RPC:
- Happy path: create + resolve with each outcome
- Idempotency: same key returns cached result
- Guard: unauthorized user rejected
- Guard: invalid state transitions rejected (resolve already-resolved claim, etc.)
- Variance: refund amount ≠ book_value produces correct variance journal

### 10.3 SECDEF smoke tests (per memory: `set_config` + `RAISE EXCEPTION` rollback)

Pattern:
```sql
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '<test-user-uuid>', true);
  PERFORM create_supplier_claim_from_opname(...);
  -- assert state
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

Every SECDEF RPC gets one smoke test. Runs via MCP `execute_sql`. Zero side effects.

### 10.4 Integration tests (full flow)

- Opname session with damage flag → commit → verify claim created + adjustment + journal balanced
- PO receipt damage → verify claim created (no journal yet) → record_pi → verify split journal
- Resolve each outcome → verify journal + stock (for REPLACED) + PO damage_status sync
- Approval gate: threshold hit → PENDING_APPROVAL → grant → verify resolve proceeds

### 10.5 UI tests

- Opname flag modal validation (qty > counted rejected, disposition required)
- Klaim list filtering
- Resolve modal — variance warning banner appears when amount ≠ book_value
- Backward compat: existing ReceiveGoodsModal + ReceiveReplacementModal produce identical UX (no visible regression)

### 10.6 Backfill migration test

- Seed staging DB with existing PENDING_RETURN + REPLACED rows
- Run backfill
- Verify: claims created, po_items.supplier_claim_id populated, no journal changes

---

## 11. Migration Slots Claimed

Per project memory (100+ free). This feature claims **20261115000100 - 20261115000105**:

| Slot | Content |
|---|---|
| 100 | Schema: supplier_claims + supplier_claim_events tables + COA additions (1-1460, 5-3160) + column extensions on stock_adjustments, purchase_order_items, stock_opname_counts + enum extensions on damage_status |
| 101 | RPCs: create_supplier_claim_from_opname, create_supplier_claim_from_po_receipt, _insert_supplier_claim, resolve_supplier_claim + modifications to request_adjustment, _apply_adjustment_change, commit_opname_session, receive_purchase_order, record_pi |
| 102 | RPCs: list_supplier_claims, get_supplier_claim, list_supplier_claim_events + read policies |
| 103 | RLS policies for new tables + policy adjustments |
| 104 | Backfill migration (batched, resumable) |
| 105 | Reserved (buffer for splitting slot 101 if needed, or feature flag config seed) |

Update project memory `project_migration_slot_allocation.md` after this spec is approved.

---

## 12. Edge Cases

| # | Case | Handling |
|---|---|---|
| 1 | Opname session cancelled after commit | Committed opname immutable (existing rule). Reversal via manual `resolve_supplier_claim(outcome='REJECTED', notes='opname_cancellation')` — natural fit, journal Dr 5-3160 / Cr 1-1460. |
| 2 | Duplicate claim per source | UNIQUE partial indexes per source_type (see §2.1). Attempt to duplicate → constraint violation returned to caller. |
| 3 | Concurrent resolve attempts | `SELECT ... FOR UPDATE` on claim row in `resolve_supplier_claim`. Second call sees status != PENDING → return 'already_resolved' error. |
| 4 | Deleted supplier | FK `ON DELETE RESTRICT`. Force resolve pending claims before delete. |
| 5 | FIFO cost on REPLACED | New stock enters at same unit_cost as original claim. No FIFO layering issue. |
| 6 | Multi-currency | Structure has `currency_code`, no logic yet. All IDR. Future scope. |
| 7 | Backfill of REPLACED rows | Insert as `status='RESOLVED_REPLACED'`, `resolution_journal_id=NULL`. Audit trail only, no re-post. |
| 8 | Approval PIN validation | Reuse existing `verify_owner_pin` (or equivalent). No duplicate PIN logic. |
| 9 | `Beban Barang Rusak` account existence | Migration 100 adds `5-3160`. If tenant has custom COA that already has similar account, tenant admin can remap post-migration (manual — YAGNI auto-mapping for now). |
| 10 | Tenant switches `enabled_claim_outcomes` mid-flight | Existing PENDING claims can still resolve to disabled outcome (grandfathered). New claims: source/outcome disabled hidden in UI. |
| 11 | Damaged qty at PO receipt time is discovered later at opname (double-count risk) | Opname damage flow decrements stock via adjustment (Dr 1-1460/5-3160 Cr 1-1510). If same units also flagged at PO receipt earlier, PO claim already exists — that's a separate incident. Tenant workflow discipline required to avoid double-flag. UI shows warning if SKU has active PO_RECEIPT claim when opname damage flagged. |
| 12 | User inputs resolution_amount < 0 or > 10× book_value | Validation: `resolution_amount >= 0`, warning banner if `> 3× book_value` (likely typo), block if `< 0`. |

---

## 13. Open Items / Future Work

Explicitly out of scope for Item #1 delivery:

1. Aging report for pending claims (days since PENDING > 30) — future report menu
2. Supplier WA reminder for stale claims — user preference: no supplier WA
3. Bulk resolve (select multiple, apply same outcome) — YAGNI
4. Journal template + `tenant_gl_mapping` runtime refactor — separate accounting maturity initiative
5. Cleanup of existing `hilang`, `sampel` adjustment reasons that also lack journal posting — separate bug ticket
6. Warehouse cutover to `warehouse_id` (Phase 3) — migrate `supplier_claims.warehouse` when Phase 3 lands
7. Historical `damage_status` values preserved on `purchase_order_items` even after enum extension (accept: enum extension is one-way in PG)

---

## 14. Success Criteria (definition of done)

- [ ] Admin can flag rusak inline during opname with disposition choice
- [ ] Klaim Supplier menu shows all pending claims from PO + opname + adjustment sources
- [ ] Resolve flow supports all 4 outcomes with correct journals (verified balance)
- [ ] Owner-configurable approval gate works with PIN + APP_INBOX (WA_BUTTON explicitly not supported for this workflow)
- [ ] Existing PO damage UI (`ReceiveGoodsModal`, `ReceiveReplacementModal`) works without user-visible regression
- [ ] Backfill migration completes on staging without data loss
- [ ] Feature flag `enable_pi_damage_split` toggles behavior cleanly
- [ ] All SECDEF RPCs have smoke tests passing
- [ ] Existing `Kerugian Selisih Stock Opname` (5-3150) reporting unaffected
- [ ] Bug fix confirmed: ad-hoc rusak adjustment now posts journal (previously silent)

---

## 15. Sequencing with other items

- Item #1 (this spec) → deliver first
- Item #4 (discount approval) — brainstorm next; reuses `approval_settings` framework validated here
- Item #5 (mid-year P&L opening) — independent
- Item #3 (dashboard vs laporan) — independent; may reference claim summary card
- Item #2 (BOM re-architecture) — biggest, independent

Total 5 specs, each shipped independently. This spec is the smallest of the 5 despite being unified in scope.
