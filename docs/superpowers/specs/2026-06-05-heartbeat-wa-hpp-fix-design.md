# Heartbeat Notification + WA Order HPP Architecture Fix

**Date:** 2026-06-05  
**Status:** Approved

## Overview

Two independent but related architectural gaps:

1. **WA Order HPP/Stock Gap** — When admin verifies WA order payment, stock is never decremented and no FIFO HPP is recorded. This means net profit calculations exclude WA channel revenue and stock counts drift.

2. **Heartbeat Poller Missing** — `notification_config` table and frontend UI exist, but the Go backend never reads the config or sends periodic WA reports. The feature is entirely unimplemented.

These are fixed together because the heartbeat report requires accurate HPP data from both channels (kasir + WA).

---

## Component A: DB Migration

Single migration adds `hpp_total` to the `orders` table:

```sql
ALTER TABLE orders ADD COLUMN hpp_total NUMERIC(15,2) NOT NULL DEFAULT 0;
```

Existing rows default to 0. New WA orders will have this populated on payment verification.

---

## Component B: WA Order Stock Decrement + FIFO HPP Fix

**Problem:** `HandlePaymentVerified` in `internal/whatsapp/handler.go` (line 511) sends the WA confirmation, updates order status to COMPLETED, but never:
- Calls `decrement_stock` to reduce stock count
- Calls `deduct_stock_fifo` to record FIFO cost of goods

**Fix scope:**

### `internal/models/types.go`
Add `HppTotal float64 \`json:"hpp_total"\`` to the `Order` struct.

### `internal/db/stock.go`
Add two new DB methods:

```go
// DeductStockFIFO calls the deduct_stock_fifo Supabase RPC and returns total FIFO cost.
// Also calls decrement_stock (warehouse=atas) to reduce the display stock count.
func (c *Client) DeductStockAndGetHPP(sku string, qty int) (float64, error)
```

This method:
1. Calls `SELECT public.decrement_stock($1, $2, 'atas')` — reduces `stock_atas` by qty
2. Calls `SELECT public.deduct_stock_fifo($1, $2)` — deducts FIFO lots, returns total cost
3. Returns the FIFO cost

### `internal/db/orders.go`
Add:

```go
func (c *Client) UpdateOrderHpp(orderID string, hpp float64) error
```

Simple `UPDATE orders SET hpp_total = $1 WHERE id = $2`.

### `internal/whatsapp/handler.go` — `HandlePaymentVerified`
After updating order status to COMPLETED, add:

```go
var totalHpp float64
for _, item := range order.Items {
    cost, err := h.db.DeductStockAndGetHPP(item.SKU, item.Qty)
    if err != nil {
        log.Printf("[HANDLER] DeductStockAndGetHPP error for %s x%d: %v", item.SKU, item.Qty, err)
        // Continue — don't block payment confirmation on HPP failure
    }
    totalHpp += cost
}
if err := h.db.UpdateOrderHpp(orderID, totalHpp); err != nil {
    log.Printf("[HANDLER] UpdateOrderHpp error for order %s: %v", orderID, err)
}
```

**Warehouse default:** WA orders default to `stock_atas` (display floor). WA channel does not have warehouse selection; this matches the business assumption that customer-facing sales draw from the display stock.

**Error resilience:** HPP recording failure must not block the payment confirmation WA message or status update. Log and continue.

---

## Component C: Heartbeat Poller

### New files

**`internal/db/heartbeat.go`**

```go
type HeartbeatConfig struct {
    Enabled       bool
    IntervalLabel string  // "Setiap 4 jam", "Setiap 8 jam", "Setiap 12 jam", "Harian"
    ReportRevenue bool
    ReportStatus  bool    // low stock alert
    LowStockAlert int
}

func (c *Client) GetHeartbeatConfig() (*HeartbeatConfig, error)
func (c *Client) GetTodayOmset() (float64, error)     // kasir income + completed WA orders, WIB date
func (c *Client) GetTodayHpp() (float64, error)        // kasir hpp_total + WA orders hpp_total, WIB date
func (c *Client) GetLowStockItems(threshold int) ([]models.StockItem, error)
```

**Omset query** (both channels, WIB date boundary):
```sql
-- Kasir channel
SELECT COALESCE(SUM(subtotal), 0) FROM kasir_transactions
WHERE type = 'income'
  AND date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date

-- WA channel
SELECT COALESCE(SUM(total), 0) FROM orders
WHERE status = 'COMPLETED'
  AND (updated_at AT TIME ZONE 'Asia/Jakarta')::date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
```

**HPP query** (same date logic):
```sql
-- Kasir HPP
SELECT COALESCE(SUM(hpp_total), 0) FROM kasir_transactions
WHERE type = 'income'
  AND date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date

-- WA HPP
SELECT COALESCE(SUM(hpp_total), 0) FROM orders
WHERE status = 'COMPLETED'
  AND (updated_at AT TIME ZONE 'Asia/Jakarta')::date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
```

**`internal/heartbeat/poller.go`**

```go
type Poller struct {
    db          *db.Client
    sender      *whatsapp.Sender
    lastFiredAt time.Time
}

func NewPoller(d *db.Client, s *whatsapp.Sender) *Poller
func (p *Poller) Start(ctx context.Context)  // ticks every minute
```

**Tick logic:**
1. Read config from DB (if disabled, return early)
2. Check WIB business hours: 07:00–22:00 (skip outside hours)
3. Parse `interval_label` to duration:
   - "Setiap 4 jam" → 4h
   - "Setiap 8 jam" → 8h
   - "Setiap 12 jam" → 12h
   - "Harian" → 24h
   - Unknown → 8h default
4. If `now < lastFiredAt + interval`, return early
5. Build and send report
6. Update `lastFiredAt = now`

**Note on persistence:** `lastFiredAt` is in-memory. On restart, it initializes to zero value, which means the first eligible tick after startup will fire. This is acceptable — an extra report on restart is harmless.

**Report format:**
```
📊 *Laporan Detak Jantung*
🕐 [Hari, DD MMM YYYY - HH:mm WIB]

💰 Omset Hari Ini: Rp X
📈 Laba Bersih: Rp Y

📦 Stok Menipis (≤Z unit):
• [SKU] — [Name]: N unit
• ...
(Jika tidak ada: "Semua stok aman ✅")
```

**Recipients:** All active entries from `wa_recipients` table (using existing `GetActiveRecipients()`).

**Failure handling:** Send errors per recipient are logged but don't abort other recipients. DB query failures abort the tick with a log entry.

### `main.go` wiring
```go
heartbeat.NewPoller(dbClient, sender).Start(ctx)
log.Println("[MAIN] Heartbeat poller started")
```

---

## Component D: Frontend Type Sync

In `src/types.ts`, add to `DbOrder`:
```typescript
hpp_total?: number;
```

This enables the Laporan screen to compute accurate total laba bersih across all channels when this field is populated.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260605000006_orders_hpp_total.sql` | Add `hpp_total` column to orders |
| `backend-go/internal/models/types.go` | Add `HppTotal` to `Order` struct |
| `backend-go/internal/db/stock.go` | Add `DeductStockAndGetHPP` |
| `backend-go/internal/db/orders.go` | Add `UpdateOrderHpp` |
| `backend-go/internal/db/heartbeat.go` | New file — heartbeat DB queries |
| `backend-go/internal/whatsapp/handler.go` | Fix `HandlePaymentVerified` |
| `backend-go/internal/heartbeat/poller.go` | New file — heartbeat poller |
| `backend-go/main.go` | Wire heartbeat poller |
| `src/types.ts` | Add `hpp_total` to `DbOrder` |

---

## Out of Scope

- Changing which warehouse WA orders deduct from (hardcoded to `atas`)
- Historical HPP backfill for existing COMPLETED orders (they stay at 0)
- Frontend UI changes to display WA order HPP (Laporan screen can compute from existing data once types are updated)
