# Unified Sales Channel Across Customer / Order History / Pipeline

Date: 2026-06-08
Status: Draft for review

## Problem

Sales activity in the ERP is split across two tables that never join:

- `orders` — created by the WhatsApp/AI sales flow (status lifecycle: PENDING → WAITING_PAYMENT → PAYMENT_VERIFIED).
- `kasir_transactions` — created by the in-store POS (`channel` ∈ `walkin | tokopedia | grosir`).

Consequences observed by the user:

1. **PelangganScreen "Riwayat Pesanan" is empty for kasir customers.**
   `customersService.fetchProfile` joins `customers ← orders` via `orders.customer_id`. `kasir_transactions` has no `customer_id` FK (only free-text `customer_phone/name/company`), so every POS sale is invisible on the customer detail page even though `KasirScreen` does auto-create a matching `customers` row.

2. **OrderHistoryScreen and PipelineScreen are channel-blind.**
   - Order History queries only `orders`, so walk-in / tokopedia / grosir sales never appear.
   - Pipeline queries only `leads`, and a `lead` requires a `conversation_id` (WhatsApp). A walk-in customer who asks for a sales order to be drafted (no payment yet) has nowhere to live, so they fall out of the funnel.

## Scope

Three independent concerns, fixed together because they share schema work:

- **(A) PelangganScreen visibility** — show all sales (orders + kasir) for a customer.
- **(B) Order History unification** — show all completed sales from every channel with a channel badge + filter.
- **(C) Pipeline expansion** — let walk-in customers create a draft sales order that lives in the pipeline until paid.

**Pipeline principle:** every customer who is still inquiring (chatting, asking, requesting a quote) from any channel and has **not yet paid** belongs in Pipeline. Today that means WhatsApp leads + walk-in drafts. Future channels with an inquiry stage (e.g., Tokopedia chat integration) plug in the same way — surface a record while the deal is open, drop it out of Pipeline once `PAYMENT_VERIFIED`.

Out of scope:
- Migrating `kasir_transactions` rows into `orders` (one-way door; user chose to keep two tables).
- Tokopedia/Grosir in Pipeline (those flows already involve payment at insert time).
- New Kasir UI for marketplace orders (Tokopedia/Grosir keep their current immediate-sale flow).

## Architecture

### Schema changes

**Migration 1 — Link kasir to customers.**

```sql
ALTER TABLE kasir_transactions
  ADD COLUMN customer_id text REFERENCES customers(id);

CREATE INDEX idx_kasir_customer_id ON kasir_transactions(customer_id);

-- Backfill existing rows by phone match.
UPDATE kasir_transactions kt
SET customer_id = c.id
FROM customers c
WHERE kt.customer_id IS NULL
  AND kt.customer_phone IS NOT NULL
  AND kt.customer_phone = c.wa_number;
```

`customer_id` stays nullable — `walkin` sales with no name/phone entered remain anonymous.

**Migration 2 — Tag the channel on `orders`.**

```sql
ALTER TABLE orders
  ADD COLUMN sales_channel text NOT NULL DEFAULT 'whatsapp'
    CHECK (sales_channel IN ('whatsapp', 'walkin'));

CREATE INDEX idx_orders_sales_channel_status ON orders(sales_channel, status);
```

Walk-in draft orders use `sales_channel = 'walkin'`. Existing rows stay `whatsapp`.
Tokopedia/Grosir are not added to this enum — they remain pure kasir_transactions (immediate paid sales), and their channel comes from `kasir_transactions.channel`.

### Application changes

**KasirScreen — two flows:**

1. **"Catat Penjualan" (existing).** Inserts into `kasir_transactions` as today. Now also sets `customer_id` when a `customers` row exists or is created.
2. **"Buat Sales Order (Belum Dibayar)" (new).** Inserts into `orders` with:
   - `sales_channel = 'walkin'`
   - `status = 'WAITING_PAYMENT'`
   - `customer_id`, `customer_name`, `customer_phone`, `customer_company`
   - `items`, `subtotal`, `total`
   - `gjp_order_id` generated (reuse existing GJP counter)

   This order then flows through the same lifecycle as WhatsApp orders: customer comes back, kasir marks paid via Order History or a "Lunas" button, transitions to `PAYMENT_VERIFIED`. **Marking it paid also inserts a matching `kasir_transactions` income row** so the daily kasir summary stays accurate (today's pattern: `kasir_transactions` is the source of truth for cashbook, `orders` is the source of truth for fulfillment).

**PelangganScreen — unified `Riwayat Pesanan`:**

`customersService.fetchProfile` extended to fetch kasir transactions in parallel:

```typescript
async fetchProfile(customerId: string): Promise<DbCustomerProfile> {
  const [customerRes, kasirRes] = await Promise.all([
    supabase.from('customers')
      .select('*, orders!orders_customer_id_fkey(*), leads!leads_customer_id_fkey(*)')
      .eq('id', customerId).single(),
    supabase.from('kasir_transactions')
      .select('*').eq('customer_id', customerId).eq('type', 'income'),
  ]);
  // merge orders + kasir into a unified `salesEntries[]` sorted by date desc
}
```

UI card layout stays the same; adds a small **channel badge** per entry:
`WhatsApp` (blue) · `Walk-in` (slate) · `Tokopedia` (green) · `Grosir` (amber).

The stats row's "Pesanan" count becomes total entries across both sources.

**OrderHistoryScreen — channel-aware listing:**

- Fetch `orders` (existing) + `kasir_transactions` where `type='income'` in parallel.
- Merge into a single `SalesEntry[]` shape with: `{ source, id, date, customer_name, items, total, status, channel }`.
- Existing filter tabs (`all/pending/waiting/uploaded/done/cancelled`) keep working for `orders`. Kasir entries are always "done" (paid on insert) so they appear under `all` and `done`.
- Add **channel filter** dropdown: All / WhatsApp / Walk-in / Tokopedia / Grosir.
- Card UI gains a channel badge in the header row.

**PipelineScreen — walk-in drafts join the funnel:**

- Fetch `leads` (existing) + `orders WHERE sales_channel='walkin' AND status IN ('WAITING_PAYMENT','PAYMENT_UPLOADED','DP_VERIFIED','WAITING_DP','DP_UPLOADED')`.
- Unify into `PipelineEntry[]`:
  - WA lead → `kind='lead'`, status from lead lifecycle
  - Walk-in draft → `kind='walkin_order'`, status mapped to NEW/IN_PROGRESS/ESCALATED so it slots into existing columns
- Badge each card with origin: `WhatsApp Lead` vs `Walk-in Order`.
- A walk-in card's primary action is "Tandai Lunas" which transitions the order and writes a kasir_transactions row (see KasirScreen flow #2 above).

### Type changes

```typescript
// types.ts
export type SalesChannel = 'whatsapp' | 'walkin' | 'tokopedia' | 'grosir';

export interface DbOrder {
  // existing fields...
  sales_channel: 'whatsapp' | 'walkin';
}

export interface KasirTransaction {
  // existing fields...
  customer_id?: string | null;
}

// New unified view-model for OrderHistory + PelangganScreen
export interface SalesEntry {
  source: 'order' | 'kasir';
  id: string;
  display_id: string;        // gjp_order_id or invoice_number
  channel: SalesChannel;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  items: Array<{ name: string; qty: number }>;
  total: number;
  status: string;            // order_status for orders, 'PAID' for kasir
  date: string;              // created_at
}
```

## Data Flow

```
Walk-in customer wants quote (no payment):
  KasirScreen → "Buat Sales Order" → orders (sales_channel=walkin, status=WAITING_PAYMENT)
    → appears in: PelangganScreen, OrderHistoryScreen (waiting tab), PipelineScreen

Walk-in customer pays:
  Pipeline/OrderHistory → "Tandai Lunas"
    → UPDATE orders SET status='PAYMENT_VERIFIED'
    → INSERT kasir_transactions (channel=walkin, customer_id, items, ...)
    → kasir daily summary picks it up via existing kasir queries

Walk-in customer pays immediately (existing flow):
  KasirScreen → "Catat Penjualan"
    → kasir_transactions (now with customer_id)
    → appears in: PelangganScreen, OrderHistoryScreen (done tab)
```

## Error Handling

- Backfill `customer_id` is best-effort (phone exact match); unmatched rows stay NULL and continue to render as anonymous walk-ins.
- "Tandai Lunas" wraps `orders.update + kasir_transactions.insert` in a single RPC so partial states cannot occur.
- If the new `orders.sales_channel` column is somehow NULL (shouldn't happen, has NOT NULL + default), UI treats it as `whatsapp`.

## Testing

- **Migration**: smoke-check on local Supabase — both migrations idempotent (already standard pattern in this repo's migrations).
- **Backfill**: verify kasir_transactions for a known customer get linked.
- **PelangganScreen**: customer with mixed history (1 WA order + 2 walk-in kasir + 1 walk-in draft) shows all 4 entries with correct badges.
- **OrderHistoryScreen**: channel filter narrows correctly; "done" tab includes both PAYMENT_VERIFIED orders and kasir_transactions.
- **PipelineScreen**: walk-in draft appears alongside WA leads; "Tandai Lunas" moves the card to done and creates kasir row.

## Rollout

Single PR, single migration sequence:
1. Migration 1 (kasir.customer_id + backfill).
2. Migration 2 (orders.sales_channel).
3. KasirScreen update.
4. supabaseClient services for the union queries.
5. UI updates to Pelanggan / OrderHistory / Pipeline.

Backwards compatible — existing rows default to sensible values.
