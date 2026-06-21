# Catat Penjualan — 3-Step Wizard Design

**Status:** Approved 2026-06-20 (founder, via brainstorming session)
**Phase:** Catat Penjualan revamp (deferred since Sales Funnel 2-I phase)
**Migration slot range claimed:** `20260630000001` – `20260630000010` (distant from parallel session's `20260628xxx`)
**Mockup:** `docs/superpowers/mockups/2026-06-20-catat-penjualan-3-step-wizard.html`

---

## Goal

Replace the 624-line monolithic `PenjualanBaruScreen.tsx` with a guided 3-step wizard:

1. **Step 1 — Channel & Customer:** pick channel (walk-in / Tokopedia / Shopee / WA / etc.) + select an existing customer or create a new one inline.
2. **Step 2 — Pesanan:** add SKU items + optional jasa (Custom Panel / Wiring Panel) lines. Pre-order allowed (stock can go negative).
3. **Step 3 — Pembayaran:** pick payment type (LUNAS / DP / TEMPO), method, ongkir, delivery address, notes. Save → invoice preview screen.

After Simpan: navigate to a new `InvoicePreviewScreen` with print options (regular printer + dot matrix), WhatsApp share, and "+ Catat Penjualan Lagi" reset.

The wizard preserves all existing save-path RPCs (`recordSale`, `insertWipWithRakit`, `createTempoInvoice`) with one new optional flag for pre-order support.

## Non-goals

- **PPN / pajak / discount / promo code:** none in current flow; not added in wizard either (parity with existing).
- **Draft persistence:** if browser closes mid-wizard, state is lost. No auto-save to DB or localStorage in v1.
- **Mobile responsive layout:** desktop-first; mobile is acceptable but not optimized.
- **Auto-WA notification for pre-order fulfillment:** manual operator action only in v1.
- **Public PDF URL for WA share:** WA share opens with text-only summary; operator attaches PDF manually.
- **Keyboard shortcuts (Tab/Enter):** not in v1 polish.
- **Bulk sale entry:** one sale at a time.
- **PIN→auth.uid modernization** for `approve_customer_credit_activate`: separate cross-cutting cleanup PR.

## Architecture

A new `CatatPenjualanWizard.tsx` orchestrator replaces `PenjualanBaruScreen.tsx` (deleted in the same PR). The orchestrator:

- Owns shared state (`channel`, `customer`, `items`, `rakitLines`, `payment*`, `marketplaceOrderNo`, `waPhone`, etc.) — same shape as today's monolith.
- Renders the horizontal `WizardStepper` at top, Lanjut/Kembali nav at bottom, and one of three step components based on `currentStep` (1/2/3).
- Dispatches the final Simpan to one of three existing RPCs based on cart shape + payment_type:
  - **TEMPO** → `createTempoInvoice(payload)` (now passes `p_allow_negative_stock=true`)
  - **Mixed SKU + jasa** → `insertWipWithRakit(payload)` (also pre-order-aware)
  - **Pure SKU or pure jasa, FULL/DP** → `recordSale(payload)` (also pre-order-aware)

Each step component (`Step1ChannelCustomer`, `Step2Items`, `Step3Payment`) wraps existing sub-components (`ChannelSelector`, `CustomerPanel`, `PaymentPanel`, `ItemSearchPanel`, `CartRows`, `RakitButtonsRow`, `RakitInlineForm`) and owns its own validation. Step components receive shared state + handler props from the orchestrator.

After Simpan, navigate to new `InvoicePreviewScreen` mounted via new `?screen=invoicePreview` route key. The preview embeds the existing `SalesInvoicePDF.tsx` (unchanged layout) and provides four actions: Cetak Printer Biasa, Cetak Dot Matrix, Bagikan WA, Download PDF, plus "+ Catat Penjualan Lagi" (reset wizard) and "Lihat di Daftar Pesanan".

All RPCs remain `SECURITY DEFINER` with `auth.uid()` binding (current behavior). The new pre-order flag is server-validated — client can request `allow_negative_stock=true` but server still does its existing customer/role/permission checks.

## Components

### Backend prereqs (4 migrations)

| # | File | Purpose |
|---|---|---|
| `20260630000001` | `customers_add_address.sql` | `ALTER TABLE public.customers ADD COLUMN address TEXT NULL`. Plain additive. No backfill (existing rows get NULL). |
| `20260630000002` | `recordsale_allow_negative_stock.sql` | Add `p_allow_negative_stock BOOLEAN DEFAULT false` param to `recordSale` (or the actual RPC name; verify during implementation). When true, the stock-availability RAISE branches are bypassed (still log to `stock_movements`; just don't refuse). When false, behavior unchanged. |
| `20260630000003` | `tempo_and_wip_allow_negative_stock.sql` | Same `p_allow_negative_stock` param added to `create_tempo_invoice` + `insertWipWithRakit` (or actual names). Same semantics. |
| `20260630000004` | `reject_customer_credit_activate_rpc.sql` | New RPC `reject_customer_credit_activate(p_request_id BIGINT, p_reason TEXT) RETURNS VOID`. Mirrors the `approve_customer_credit_activate` permission check pattern (Aktif Owner via auth.uid + email — same as PR #34). Calls `_transition_approval(approval_id, 'rejected', v_admin_id, p_reason)`. Inserts audit event `customer_credit_activate_rejected`. |

If any of `recordSale` / `create_tempo_invoice` / `insertWipWithRakit` rely on `stock_lots` table-level CHECK constraints that enforce `qty_remaining >= 0`, drop those CHECKs as part of `20260630000002` or `_003`. Audit during implementation.

### New audit log event

| Event type | Emitted by | Payload |
|---|---|---|
| `preorder_fulfilled` | `record_pi` (and any other Pembelian-side RPC that increments stock) | `{sku, qty_delivered, qty_fulfilled, pending_order_ids: [...], supplier_id, tagihan_id}`. Logged when the SKU being delivered had a pre-call stock balance < 0. Allocation is FIFO by `orders.created_at` (oldest pre-order first); allocation is implicit (no separate allocation table). |
| `customer_credit_activate_rejected` | `reject_customer_credit_activate` RPC | `{request_id, reject_reason, customer_id, requested_limit, requested_term}` |

### Frontend new files

| File | Purpose | Est. lines |
|---|---|---|
| `src/components/penjualan/CatatPenjualanWizard.tsx` | Orchestrator. Shared state, stepper UI, nav (Lanjut/Kembali), Step 3 save dispatch. | ~250 |
| `src/components/penjualan/wizard/WizardStepper.tsx` | Horizontal stepper (3 step labels, ✓/current/locked states, click-to-jump-back for completed steps only). | ~80 |
| `src/components/penjualan/wizard/Step1ChannelCustomer.tsx` | Wraps `ChannelSelector` + `ChannelStrip` + `CustomerPanel`. Owns "+ Customer Baru" inline form expansion + HP autocomplete hint. Owns Step 1 validation (channel + customer required). | ~200 |
| `src/components/penjualan/wizard/Step2Items.tsx` | Wraps `ItemSearchPanel` + `CartRows` + `RakitButtonsRow` + `RakitInlineForm`. Owns pre-order chip rendering on rows where qty > available stock. Owns Step 2 validation (≥1 line; SKU items qty>0 + warehouse; jasa lines description + estimatedPrice>0; qty=0 allowed for jasa). Honors `prefill_sku` query param. | ~200 |
| `src/components/penjualan/wizard/Step3Payment.tsx` | Wraps `PaymentPanel`. Owns Simpan button + save dispatch + spinner + error toast. Owns Step 3 validation (payment_type set; TEMPO requires customer.allows_tempo). | ~150 |
| `src/components/penjualan/InvoicePreviewScreen.tsx` | Post-save destination. Renders existing `SalesInvoicePDF.tsx`. Buttons: Cetak Printer Biasa (window.print regular stylesheet), Cetak Dot Matrix (window.print with narrow/monospace stylesheet), Bagikan WhatsApp (wa.me link with text summary), Download PDF (jsPDF), Lihat di Daftar Pesanan, + Catat Penjualan Lagi. | ~150 |
| `src/components/penjualan/wizard/NewCustomerInlineForm.tsx` | Inline "+ Customer Baru" form. Fields: nama (required), HP (required), perusahaan (optional), alamat (optional). TEMPO request section with checkbox + 3 fields (limit, term, reason). On save: calls `customersService.insert` + optionally `requestCustomerCreditActivate`. Returns new customer to Step 1 via callback. | ~180 |
| `src/components/approval/CustomerCreditActivateApprovalRequestRow.tsx` | Dedicated inbox row component for `'customer_credit_activate'` approval type. Mirrors `TempoWriteOffApprovalRequestRow` shape. Shows customer name + phone + requested limit + requested term + reason (if provided) + Tolak/Setujui buttons. Tolak opens inline reject-reason textarea. | ~140 |

### Frontend modified files

| File | Change |
|---|---|
| `src/App.tsx` | Replace `<PenjualanBaruScreen ... />` mount with `<CatatPenjualanWizard ... />` (same `?screen=penjualanBaru` key, same prop interface: `prefill_sku`, `onNavigate`, `showToast`, etc.). Add new screen key `'invoicePreview'` mounting `<InvoicePreviewScreen orderId={...} />`. |
| `src/types.ts` | Add `'invoicePreview'` to `ActivePage` union. Add `customers.address` to the `DbCustomer` interface. |
| `src/lib/supabaseClient.ts` | Add `customersService.insert(...)` if missing; add `requestCustomerCreditActivate(customerId, termDays, creditLimit, reason)` wrapper; add `rejectCustomerCreditActivate(requestId, reason)` wrapper. Add `p_allow_negative_stock=true` to wizard's call sites of `recordSale` / `create_tempo_invoice` / `insertWipWithRakit`. |
| `src/components/penjualan/SalesInvoicePDF.tsx` | Add per-row pre-order footnote rendering: "*Pre-order, akan dikirim setelah barang tiba" (small italic note under the item description when the row's qty exceeded stock at sale time — derived from `stock_movements` join or `orders.items[i].is_pre_order` flag if needed). Add `printMode: 'normal' | 'dot_matrix'` prop. Dot matrix mode: narrower layout, monospace fallback fonts, fewer borders. |
| `src/components/approval/ApprovalInboxScreen.tsx` | Add render dispatch arm for `r.requestType === 'customer_credit_activate'` → render `<CustomerCreditActivateApprovalRequestRow />`. Add handleApprove branch → calls existing `approve_customer_credit_activate` (or wrap with PIN modal since current RPC requires PIN — note: this PIN dependency is the cross-cutting cleanup deferred to a separate PR; for now, keep PIN flow). Add handleReject branch → calls new `rejectCustomerCreditActivate`. |
| `src/components/penjualan/PaymentPanel.tsx` | If TEMPO selected and customer.allows_tempo=false (newly created pending Owner approve), show inline warning + auto-flip to LUNAS. Existing credit-limit-exceeded modal behavior unchanged. |
| `src/components/KasirScreen.tsx` | No change. Kasir's "Catat Penjualan" button continues navigating to `?screen=penjualanBaru` (now mounts wizard). Kasir's own walk-in flow keeps current behavior (no pre-order). |
| `src/components/PenjualanScreen.tsx` | No change. "Input Baru" tab continues mounting the same screen key. |

### Frontend deleted files

- `src/components/PenjualanBaruScreen.tsx` (624 lines) — superseded entirely by the wizard orchestrator.

### Existing reused unchanged

- `src/components/penjualan/CustomerPanel.tsx` — note: the manual-entry-fallback "ad-hoc customer" affordance currently in this component MUST be removed as part of Step 1 wiring (per `feedback_no_adhoc_customers` memory).
- `src/components/penjualan/PaymentPanel.tsx` (mostly unchanged; small TEMPO warning addition above)
- `src/components/penjualan/ItemSearchPanel.tsx`
- `src/components/penjualan/CartRows.tsx` (small addition: yellow pre-order chip on rows where computed `is_pre_order=true`)
- `src/components/penjualan/ChannelSelector.tsx`
- `src/components/penjualan/ChannelStrip.tsx`
- `src/components/penjualan/RakitButtonsRow.tsx` — note: remove the "Rakit Standard" / ASSEMBLY button if present (founder confirmed only Custom Panel + Wiring Panel are real jasa types)
- `src/components/penjualan/RakitInlineForm.tsx`
- `src/components/penjualan/MarkLunasModal.tsx`
- `src/components/penjualan/LockSubmissionModal.tsx` — still the downstream lock flow for mixed SKU+jasa orders

## Data flow

### Step 1 → 2 (click "Lanjut ke Pesanan")

1. Validation: `channel` set + `customer` (id) set. Marketplace channels require `marketplaceOrderNo` non-empty. WhatsApp channel requires `waPhone` non-empty. Button disabled until all required fields valid.
2. Search behavior: typing in customer search filters existing customers by name / wa_number / company. Tip hint: searching by HP enables repeat-buyer auto-detect.
3. "+ Customer Baru" flow:
   - Click button → inline form expands.
   - Form requires: nama + HP. Optional: perusahaan, alamat.
   - Optional checkbox "Ajukan TEMPO" → reveals 3 fields (limit, term, reason).
   - On Simpan & Pilih: call `customersService.insert({name, wa_number, company, address, allows_tempo: false})` → returns new customer row.
   - If TEMPO checkbox was checked: call `requestCustomerCreditActivate(newCustomer.id, term, limit, reason)` → returns approval_request_id. Toast "Request TEMPO terkirim ke Owner."
   - Selected customer becomes the wizard's `customer` state. Inline form collapses.
4. No backend call on Lanjut click itself; everything's pre-persisted.

### Step 2 → 3 (click "Lanjut ke Pembayaran")

1. Validation:
   - At least 1 line (SKU item OR jasa rakit line).
   - Each SKU row: `qty > 0` AND `warehouse_id` set.
   - Each jasa row: `description` non-empty AND `estimated_price > 0`. `qty` MAY be 0 (lump-sum allowed per founder).
2. Pre-order detection (client-side): for each SKU row, if `qty > stockAtWarehouse(warehouse_id, sku)`, mark `is_pre_order=true` and render yellow "⏳ PRE-ORDER · kurang N" chip. Lanjut stays enabled.
3. Cart summary: shows count of pre-order rows in info banner if > 0.
4. No backend call on Lanjut click.

### Step 3 → Simpan (3 RPC paths)

1. Validation: `payment_type` set; if TEMPO, `customer.allows_tempo === true`.
2. Save dispatch based on cart shape + payment_type:

**TEMPO path:**
```
createTempoInvoice({
  customer_id, channel, items, rakit_lines: [],
  marketplace_order_no, ongkir_amount, delivery_address, notes,
  p_allow_negative_stock: true
})
```
- Server-side: re-checks `customer.allows_tempo` + credit headroom.
- If `allows_tempo=false` (new customer pending Owner approve): raises `tempo_not_enabled`. Toast: "Customer ini belum punya TEMPO eligibility. Pakai LUNAS atau DP dulu." Step 3 auto-flips to LUNAS.
- If credit limit exceeded: raises `credit_limit_exceeded: outstanding=X, new=Y, limit=Z`. Modal shows numbers + offer to switch to DP (with DP = limit - outstanding).
- On success: returns order_id. Navigate to InvoicePreviewScreen.

**Mixed SKU + jasa path:**
```
insertWipWithRakit({
  customer_id, channel, items, rakit_lines: [...],
  payment_type, payment_method, dp_amount, ongkir, ...,
  p_allow_negative_stock: true
})
```
- Server creates WIP order + rakit_job_lines. Status = WIP, funnel_sub_stage = 3f (waiting for admin to submit cost lock).
- Returns order_id. Navigate to InvoicePreviewScreen with "Menunggu Owner Lock" status pill.

**Pure SKU or pure jasa, FULL/DP path:**
```
recordSale({
  customer_id, channel, items, rakit_lines, payment_type, ...,
  p_allow_negative_stock: true
})
```
- Standard recordSale flow. Returns order_id. Navigate to InvoicePreviewScreen.

### Post-save: InvoicePreviewScreen

1. Mounts with `orderId` prop (passed via App state).
2. Fetches order + customer + line items.
3. Renders existing `SalesInvoicePDF.tsx` component with `printMode='normal'` by default.
4. Action buttons:
   - **Cetak Printer Biasa (A4/A5):** sets `printMode='normal'`, calls `window.print()`. Stylesheet `@media print` ensures only the invoice DOM renders.
   - **Cetak Dot Matrix (struk panjang):** sets `printMode='dot_matrix'`, calls `window.print()`. Stylesheet switches to narrow + monospace fallback fonts.
   - **Bagikan via WhatsApp:** opens `https://wa.me/${customer.wa_number}?text=<encoded summary text>`. Summary text: "Invoice {invNumber} - Total Rp {total} - {payment_type}. Terima kasih atas pesanannya."
   - **Download PDF:** existing jsPDF generator triggers `doc.save(`INV-{id}.pdf`)`.
   - **Lihat di Daftar Pesanan:** navigate to `?screen=daftarPesanan` with the new order highlighted.
   - **+ Catat Penjualan Lagi:** navigate to `?screen=penjualanBaru` (resets wizard state).

### Back navigation (clicking stepper labels for completed steps)

- State preserved across step transitions.
- If Step 1 customer is changed to one with different TEMPO eligibility, Step 3 `payment_type` is reset to LUNAS with toast: "Customer berubah — pembayaran direset."
- If Step 1 channel changes to one requiring marketplace order #, and the field is empty, Step 1 stays at the changed-channel state (Lanjut disabled until valid).
- Jump-forward (e.g., Step 1 → Step 3 directly) blocked: clicking a not-yet-reached step in the stepper does nothing.

### Cancel (any step)

- Confirm dialog "Batalkan? Semua input akan hilang." → on Ya, navigate back to where user came from (`?screen=salesLanding` or `?screen=kasir`).

### Browser-level

- `beforeunload` warning if any wizard state is non-default and user attempts to close/refresh.

## Error handling

### Backend RPC errors at Simpan

| Scenario | RPC raises | Client toast / behavior |
|---|---|---|
| Customer not TEMPO-eligible at TEMPO save | `tempo_not_enabled` | "Customer ini belum punya TEMPO eligibility. Pakai LUNAS atau DP dulu, atau tunggu Owner approve TEMPO." Step 3 auto-flips to LUNAS. |
| Credit limit exceeded at TEMPO save | `credit_limit_exceeded: outstanding=X, new=Y, limit=Z` | Modal: shows X/Y/Z + "Sisa: Rp {Z-X-Y}" (negative = over by abs). Options: [Batal] [Switch to DP with dp = Z - X, sisa nanti via Catat Bayar]. |
| Marketplace order # duplicate | unique constraint violation | Toast "Nomor order marketplace ini sudah pernah dipakai. Cek di Riwayat." |
| Network / generic Supabase error | any other | Toast "Gagal simpan. Coba lagi." Save button re-enabled. console.error full message for debugging. |

### Step 1 errors

| Scenario | Behavior |
|---|---|
| Customer search returns empty | Show "+ Customer Baru" button + hint "Tidak ketemu?" |
| New customer save fails (DB error) | Toast "Gagal simpan customer. Coba lagi." Form stays open with values preserved. |
| TEMPO request fails (after customer saved) | Toast "Customer tersimpan, tapi gagal kirim request TEMPO ke Owner. Coba aktifkan TEMPO dari menu Pelanggan." Customer is still selectable; user advances. |
| Marketplace channel + empty order # | Lanjut disabled + hint "Nomor order Tokopedia/Shopee wajib." |
| WhatsApp channel + empty phone | Lanjut disabled + hint "Nomor WhatsApp wajib." |

### Step 2 errors

| Scenario | Behavior |
|---|---|
| Item add when stock=0 at both warehouses | "+ Tambah" stays enabled; row added as pre-order with chip "⏳ PRE-ORDER · kurang N". |
| Operator picks warehouse with stock < qty | Row shows pre-order chip with kurang count + tooltip explaining fulfillment via Pembelian. Lanjut stays enabled. |
| Cart empty at Lanjut | Button disabled (validation gate). |
| Jasa line has description but estimated price = 0 | Inline warning "Estimasi harga wajib > 0." Lanjut disabled. |
| Jasa line has price but no description | Inline warning "Deskripsi wajib." Lanjut disabled. |

### Post-save errors (InvoicePreviewScreen)

| Scenario | Behavior |
|---|---|
| Print dialog cancelled by user | No-op; preview stays open. |
| Dot Matrix stylesheet renders weird on printer | OS-level concern; nothing the app can do at this layer. |
| WhatsApp share but customer.wa_number is empty | Bagikan WA button disabled with tooltip "Customer ini tidak punya nomor WhatsApp." |
| PDF download fails (browser security) | Toast "Gagal download. Cek setting browser." |

### Critical invariants

- **TEMPO eligibility check is server-side, not client-side.** Client may render "Customer ini bisa TEMPO" based on `customer.allows_tempo` fetched at Step 1; `createTempoInvoice` re-checks server-side.
- **Pre-order detection is client-side hint only.** Server doesn't refuse negative stock when `p_allow_negative_stock=true` is passed.
- **Marketplace order # uniqueness enforced via DB unique constraint.** Client check on Lanjut is a UX hint only.

## Testing

### Vitest (client lib + utility, no UI tests per project policy)

| Test target | Cases |
|---|---|
| `validateStep1(state)` pure function | Returns OK only when channel + customer set. Marketplace channels require marketplaceOrderNo; WA channels require waPhone. Returns specific error key for each missing field. |
| `validateStep2(state)` pure function | Returns OK when ≥1 line; SKU rows have qty>0 + warehouse_id; jasa rows have description + estimatedPrice>0. qty=0 allowed for jasa. Returns error per-row. |
| `validateStep3(state)` pure function | Returns OK when payment_type set; TEMPO requires customer.allows_tempo. |
| `dispatchSave(state) → 'tempo' | 'wip' | 'standard'` pure function | TEMPO payment_type → 'tempo'. Mixed SKU + jasa → 'wip'. Pure SKU or pure jasa FULL/DP → 'standard'. |
| `isPreOrder(item, stockByWarehouse)` | Returns true when item.qty > stock at item.warehouse_id; false otherwise. |
| `requestCustomerCreditActivate` wrapper | Calls correct RPC with correct params; returns approval_id; re-throws RPC errors with prefix intact. |
| `rejectCustomerCreditActivate` wrapper | Calls correct RPC; returns void; re-throws. |
| `customersService.insert` wrapper | Calls correct table insert with allows_tempo=false default; returns new customer row. |

### SQL smoke via Supabase MCP `execute_sql`

| # | Path | Setup | Expected |
|---|---|---|---|
| 1 | recordSale with negative stock allowed | Warehouse stock=2; call recordSale with qty=5 and `p_allow_negative_stock=true` | Succeeds. stock_lots qty_remaining = -3 (no RAISE). stock_movements OUT row written. |
| 2 | recordSale with negative stock blocked (default) | Same as #1 but no flag (or `p_allow_negative_stock=false`) | Raises insufficient_stock or similar (current behavior). |
| 3 | create_tempo_invoice with pre-order | TEMPO-eligible customer; stock < requested qty; flag=true | Succeeds (same as #1 but TEMPO). |
| 4 | New customer + activate TEMPO | Insert customer with allows_tempo=false → call request_customer_credit_activate(id, 30, 5000000, 'smoke test') | Returns approval_id; approval_requests row exists with type='customer_credit_activate'; payload carries customer_id + term_days + credit_limit + reason. |
| 5 | TEMPO save against non-eligible customer | New customer (pending TEMPO approval); call createTempoInvoice | Raises `tempo_not_enabled`. Order NOT created. |
| 6 | TEMPO save over limit | Customer limit=1jt, outstanding=500k, new=750k → call createTempoInvoice | Raises `credit_limit_exceeded: outstanding=500000, new=750000, limit=1000000`. |
| 7 | reject_customer_credit_activate happy | Owner Aktif caller; pending approval | approval status=`rejected`; decision_channel=`p_reason`; audit `customer_credit_activate_rejected` |
| 8 | reject_customer_credit_activate non-Owner | Non-Owner caller | Raises `OWNER_ONLY: caller is not an active Owner` |
| 9 | record_pi auto-allocates pre-order audit | Pre-condition: order A has 5 units of SKU X (stock_lots negative -5); record_pi delivers 10 units of SKU X | Stock balance goes from -5 to +5. audit_log row `preorder_fulfilled` written with payload `{sku:X, qty_delivered:10, qty_fulfilled:5, pending_order_ids:[A.id], supplier_id, tagihan_id}`. |
| 10 | record_pi when no pre-order pending | Pre-condition: stock balance ≥ 0; record_pi delivers normally | No `preorder_fulfilled` audit row written. |

### Manual UI smoke (Chrome DevTools MCP, after deploy)

| # | Path | Expected |
|---|---|---|
| 1 | Happy walk-in LUNAS | Step 1 (walk-in + existing customer) → Step 2 (2 SKU items + 1 Custom Panel jasa lump-sum) → Step 3 (LUNAS cash) → Simpan → InvoicePreviewScreen with Cetak buttons. Order recorded; stock_movements OUT rows correct. |
| 2 | Happy Tokopedia TEMPO | Step 1 (Tokopedia + marketplace order # + TEMPO-eligible customer) → Step 2 (3 SKU) → Step 3 (TEMPO, credit headroom shown) → Simpan → InvoicePreviewScreen with TEMPO due date pill. |
| 3 | New customer + TEMPO request | Step 1 (walk-in + "+ Customer Baru" + fill form + check "Ajukan TEMPO" + limit + term + reason) → Simpan & Pilih → customer added (visible in Pelanggan menu); approval_request created (visible in Persetujuan inbox). Step 3 shows "TEMPO pending — pakai LUNAS/DP dulu" warning. Save as LUNAS succeeds. |
| 4 | Pre-order flow | Step 2: add SKU with qty > available stock → pre-order chip + count visible on row; cart banner shows "X item pre-order". Lanjut enabled. → Step 3 → Simpan → recordSale succeeds; stock_lots goes negative; order recorded. |
| 5 | Lump-sum jasa | Step 2: + Custom Panel + description "Genset 50kVA" + estimated price 5jt + qty=0 → Lanjut. → Step 3 → Simpan → insertWipWithRakit succeeds → order in WIP at sub_stage 3f → visible in Persetujuan inbox as rakit_lock pending after admin submits cost via existing LockSubmissionModal. |
| 6 | Back nav state preserve | Step 1 → Step 2 fill cart → click Step 1 in stepper → arrives at Step 1 with selections intact → click Step 2 → cart still populated. |
| 7 | Cancel mid-wizard | Step 2 → Batal → confirm "Yakin? Semua input hilang." → Ya → back to salesLanding. |
| 8 | Stepper jump-forward blocked | Step 1 incomplete → click Step 2 in stepper → no navigation. |
| 9 | Cetak Dot Matrix | InvoicePreviewScreen → Cetak Dot Matrix → print dialog opens; print preview narrower + monospace fonts. |
| 10 | Bagikan WA | InvoicePreviewScreen → Bagikan WhatsApp → opens `wa.me/{customer.wa_number}?text=...` with summary text. |
| 11 | Owner approve credit_activate request | Owner navigates to Persetujuan inbox → sees CustomerCreditActivateApprovalRequestRow with customer + limit + term + reason → click Setujui (current PIN-gated flow; cross-cutting cleanup deferred) → approval succeeds → customer.allows_tempo flips to true. |
| 12 | Owner reject credit_activate request | Same as #11 but click Tolak → inline reason textarea → Konfirmasi Tolak → approval rejected; customer.allows_tempo remains false; audit row visible. |

## Cross-cutting impacts (documented, not blocking ship)

1. **Kasir walk-in flow:** keeps current behavior — no pre-order, no negative stock allowed (Kasir = physical-customer-present POS, no pre-order concept).
2. **SalesInvoicePDF.tsx:** gains two changes — per-row pre-order footnote when applicable, and `printMode='dot_matrix'` prop with alternate stylesheet. Existing layout/branding unchanged.
3. **Dashboard:** gains a new small card "Recent pre-order fulfillments (last 7 days)" populated from `audit_log` filtered by `event_type='preorder_fulfilled'`. Each row has a "Notify WA" button that opens `wa.me/{customer.wa_number}` for the affected order. v1 = manual notification only.
4. **Stock Manager screen:** already renders negative stock in red (existing behavior). No change needed.
5. **EditOrderModal:** stays compatible — pre-order rows are derived from stock_lots balance, not stored as an order field.
6. **Pembelian record_pi:** gains an audit insert for `preorder_fulfilled` when delivered SKU had pre-call stock < 0. Implementation: read pre-call balance, run delivery, if pre-call was negative emit audit row with FIFO-ordered pending_order_ids.
7. **Permissions:** reuse existing `pelanggan` flag for "+ Customer Baru" + "Ajukan TEMPO" gating. No new permission flag added.
8. **ApprovalInboxScreen:** gains a dispatch arm for `customer_credit_activate` rendering `CustomerCreditActivateApprovalRequestRow`. Existing rakit_lock + piutang_write_off arms unchanged.
9. **CustomerPanel.tsx:** the manual-entry-fallback "ad-hoc customer" affordance currently in this component MUST be removed during wizard wiring (per `feedback_no_adhoc_customers` memory). Anyone outside the wizard that calls `<CustomerPanel manualEntry={true} />` needs migration too — audit during implementation.
10. **RakitButtonsRow.tsx:** the ASSEMBLY / "Rakit Standard" button (if present) must be removed (only Custom Panel + Wiring Panel are real jasa per founder).

## Deferred (Category D — future, explicit non-goals for v1)

- Draft persistence mid-wizard (close browser = state lost).
- Public PDF URL infrastructure for WA share (current = text only).
- Auto-WA notification when pre-order is fulfilled (current = manual).
- Keyboard shortcuts (Tab/Enter to advance).
- Mobile responsive layout (single column, sticky stepper).
- PIN→auth.uid modernization for `approve_customer_credit_activate` (cross-cutting cleanup — separate PR).
- Pre-order allocation table + multi-supplier matching (current = FIFO by order date, implicit via stock_movements timestamp).
- Bulk sale entry (one at a time).

## Open considerations

- **`approve_customer_credit_activate` PIN dependency:** current RPC requires Owner PIN. Wizard's UX submits a request that Owner approves later. The Owner approval path still goes through the existing PIN-gated RPC. PR #34 modernized `verify_owner_pin` and related auth.uid path, but this RPC wasn't updated. Documented as deferred; wizard ships regardless.
- **`recordSale` RPC name verification:** the actual RPC name in `supabaseClient.ts` may differ from the user-facing label. Implementation must audit and confirm exact RPC names before writing migrations.
- **Stock balance computation for pre-order chip:** client needs near-real-time stock per warehouse per SKU. Implementation may use the existing `fetchStock` / similar function (verify during impl). If the existing fetch is server-side aggregated, may need a small Supabase view for fast per-warehouse-per-sku lookup.
- **`preorder_fulfilled` event ordering:** FIFO by `orders.created_at` is the agreed allocation policy. If multiple orders for the same SKU exist (e.g., 3 orders each needing 2 units of SKU X totaling 6, supplier delivers 4), allocation fills oldest 2 orders fully (4 units) and leaves the 3rd order still pending. Edge case worth verifying in smoke #9.
