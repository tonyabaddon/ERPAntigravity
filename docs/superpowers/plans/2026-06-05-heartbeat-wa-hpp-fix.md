# Heartbeat Notification + WA Order HPP Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix WA orders to decrement stock and record FIFO HPP on payment verification, then build the missing heartbeat poller that sends periodic WA profit/stock reports.

**Architecture:** DB migration adds `hpp_total` to `orders`. Go handler calls `decrement_stock` + `deduct_stock_fifo` RPCs per item on payment verification. New `internal/heartbeat/` package ticks every minute, reads `notification_config`, and sends formatted WA reports to all active `wa_recipients` during WIB business hours.

**Tech Stack:** Go 1.21, PostgreSQL (Supabase), whatsmeow WA sender, existing `internal/followup` pattern

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260605000006_orders_hpp_total.sql` | Create | Add `hpp_total NUMERIC(15,2)` column to `orders` |
| `backend-go/internal/models/types.go` | Modify | Add `HppTotal float64` to `Order` struct |
| `backend-go/internal/db/stock.go` | Modify | Add `DeductStockAndGetHPP(sku, qty)` |
| `backend-go/internal/db/orders.go` | Modify | Add `UpdateOrderHpp(orderID, hpp)` |
| `backend-go/internal/whatsapp/handler.go` | Modify | Fix `HandlePaymentVerified` to call stock/HPP |
| `backend-go/internal/db/heartbeat.go` | Create | `GetHeartbeatConfig`, `GetTodayOmset`, `GetTodayHpp`, `GetLowStockItems` |
| `backend-go/internal/heartbeat/poller.go` | Create | Heartbeat poller — tick, schedule, build + send report |
| `backend-go/internal/heartbeat/poller_test.go` | Create | Unit tests for `parseInterval`, `isWIBBusinessHours`, `buildReport` |
| `backend-go/main.go` | Modify | Import heartbeat package, call `.Start(ctx)` |
| `src/types.ts` | Modify | Add `hpp_total?: number` to `DbOrder` |

---

## Task 1: DB Migration — Add `hpp_total` to `orders`

**Files:**
- Create: `supabase/migrations/20260605000006_orders_hpp_total.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260605000006_orders_hpp_total.sql
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS hpp_total NUMERIC(15,2) NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__plugin_supabase_supabase__apply_migration` tool with:
- `name`: `orders_hpp_total`
- `query`: `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS hpp_total NUMERIC(15,2) NOT NULL DEFAULT 0;`

- [ ] **Step 3: Verify the column exists**

Use `mcp__plugin_supabase_supabase__execute_sql` with:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'hpp_total';
```
Expected: one row with `column_name=hpp_total`, `data_type=numeric`, `column_default=0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260605000006_orders_hpp_total.sql
git commit -m "feat(db): add hpp_total column to orders table"
```

---

## Task 2: Go Model — Add `HppTotal` to `Order` struct

**Files:**
- Modify: `backend-go/internal/models/types.go` (lines 140–171)

- [ ] **Step 1: Add the field**

In `backend-go/internal/models/types.go`, in the `Order` struct after `UpdatedAt time.Time`:

```go
// Before:
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

// After:
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
	HppTotal         float64      `json:"hpp_total"`
}
```

- [ ] **Step 2: Verify build**

```bash
cd backend-go && go build ./...
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/models/types.go
git commit -m "feat(models): add HppTotal to Order struct"
```

---

## Task 3: DB Methods — `DeductStockAndGetHPP` and `UpdateOrderHpp`

**Files:**
- Modify: `backend-go/internal/db/stock.go`
- Modify: `backend-go/internal/db/orders.go`

- [ ] **Step 1: Add `DeductStockAndGetHPP` to `stock.go`**

Append to `backend-go/internal/db/stock.go`:

```go
// DeductStockAndGetHPP decrements stock_atas by qty and returns the FIFO cost via
// the deduct_stock_fifo RPC. Both operations are best-effort; errors are returned
// but callers should log-and-continue so payment confirmation is never blocked.
func (c *Client) DeductStockAndGetHPP(sku string, qty int) (float64, error) {
	if _, err := c.DB.Exec(`SELECT public.decrement_stock($1, $2, 'atas')`, sku, qty); err != nil {
		return 0, fmt.Errorf("decrement_stock %s x%d: %w", sku, qty, err)
	}
	var cost float64
	if err := c.DB.QueryRow(`SELECT public.deduct_stock_fifo($1, $2)`, sku, qty).Scan(&cost); err != nil {
		return 0, fmt.Errorf("deduct_stock_fifo %s x%d: %w", sku, qty, err)
	}
	return cost, nil
}
```

Add `"fmt"` to the import block if not already present (check current imports — it currently only has `"encoding/json"` and `"strings"`):

```go
import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)
```

- [ ] **Step 2: Add `UpdateOrderHpp` to `orders.go`**

Append to `backend-go/internal/db/orders.go` (after the last function):

```go
func (c *Client) UpdateOrderHpp(orderID string, hpp float64) error {
	_, err := c.DB.Exec(`UPDATE orders SET hpp_total = $1 WHERE id = $2`, hpp, orderID)
	return err
}
```

- [ ] **Step 3: Verify build**

```bash
cd backend-go && go build ./...
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/db/stock.go backend-go/internal/db/orders.go
git commit -m "feat(db): add DeductStockAndGetHPP and UpdateOrderHpp methods"
```

---

## Task 4: Fix `HandlePaymentVerified` — Stock Decrement + HPP Recording

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go` (lines 510–538)

- [ ] **Step 1: Update `HandlePaymentVerified`**

The current function ends at line 538. After the existing `h.db.UpdateLeadStatus` block, append the stock/HPP loop. Replace the existing `HandlePaymentVerified` function body with:

```go
func (h *Handler) HandlePaymentVerified(ctx context.Context, orderID, conversationID string) {
	order, err := h.db.GetOrderByConversation(conversationID)
	if err != nil || order == nil {
		log.Printf("[HANDLER] HandlePaymentVerified: GetOrderByConversation error for %s: %v", conversationID, err)
		return
	}

	lang := "id"
	h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, conversationID).Scan(&lang)

	msg := "✅ *Pembayaran Dikonfirmasi!*\n\nTerima kasih Bapak/Ibu " + order.CustomerName + ", pembayaran Anda telah kami verifikasi.\nPesanan Anda sedang diproses. Terima kasih telah berbelanja di Garindo Jaya Panel! 😊"
	if lang == "en" {
		msg = "✅ *Payment Confirmed!*\n\nThank you " + order.CustomerName + ", your payment has been verified.\nYour order is being processed. Thank you for shopping at Garindo Jaya Panel! 😊"
	}
	if err := h.sender.SendText(ctx, order.CustomerPhone, msg); err != nil {
		log.Printf("[HANDLER] HandlePaymentVerified: SendText error: %v", err)
	}

	h.db.InsertMessage(conversationID, models.SenderSystem, "PAYMENT_VERIFIED: confirmed by admin")
	h.db.UpdateOrderStatus(orderID, string(models.OrderStatusCompleted))
	h.db.UpdateConversationState(conversationID, models.StateCompleted)

	if order.LeadsID != "" {
		if err := h.db.UpdateLeadStatus(order.LeadsID, models.LeadStatusOrdered); err != nil {
			log.Printf("[HANDLER] UpdateLeadStatus error for lead %s: %v", order.LeadsID, err)
		}
	}

	// Decrement stock and record FIFO HPP for each item.
	// Errors are logged but never block payment confirmation.
	var totalHpp float64
	for _, item := range order.Items {
		cost, err := h.db.DeductStockAndGetHPP(item.SKU, item.Qty)
		if err != nil {
			log.Printf("[HANDLER] DeductStockAndGetHPP error for %s x%d: %v", item.SKU, item.Qty, err)
			continue
		}
		totalHpp += cost
	}
	if err := h.db.UpdateOrderHpp(orderID, totalHpp); err != nil {
		log.Printf("[HANDLER] UpdateOrderHpp error for order %s: %v", orderID, err)
	}
}
```

- [ ] **Step 2: Verify build**

```bash
cd backend-go && go build ./...
```
Expected: no output.

- [ ] **Step 3: Run existing handler tests**

```bash
cd backend-go && go test ./internal/whatsapp/... -v 2>&1 | tail -20
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go
git commit -m "fix(handler): decrement stock and record FIFO HPP on payment verification"
```

---

## Task 5: Heartbeat DB Layer

**Files:**
- Create: `backend-go/internal/db/heartbeat.go`

- [ ] **Step 1: Create `heartbeat.go`**

Create `backend-go/internal/db/heartbeat.go`:

```go
package db

import "github.com/username/sinar-elektrik-backend/internal/models"

// HeartbeatConfig holds the notification_config row (single-row table).
type HeartbeatConfig struct {
	Enabled       bool
	IntervalLabel string
	ReportRevenue bool
	ReportStatus  bool
	LowStockAlert int
}

// GetHeartbeatConfig reads the single notification_config row.
// Returns nil, nil if the table is empty (feature not yet configured).
func (c *Client) GetHeartbeatConfig() (*HeartbeatConfig, error) {
	var cfg HeartbeatConfig
	err := c.DB.QueryRow(`
		SELECT enabled, interval_label, report_revenue, report_status, low_stock_alert
		FROM notification_config
		ORDER BY id DESC LIMIT 1
	`).Scan(&cfg.Enabled, &cfg.IntervalLabel, &cfg.ReportRevenue, &cfg.ReportStatus, &cfg.LowStockAlert)
	if err != nil {
		// sql.ErrNoRows means table is empty — not configured yet.
		return nil, err
	}
	return &cfg, nil
}

// GetTodayOmset returns total revenue for today (WIB date) across both channels:
// kasir_transactions (income rows) + orders (COMPLETED rows).
func (c *Client) GetTodayOmset() (float64, error) {
	var kasir, wa float64
	if err := c.DB.QueryRow(`
		SELECT COALESCE(SUM(subtotal), 0)
		FROM kasir_transactions
		WHERE type = 'income'
		  AND date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
	`).Scan(&kasir); err != nil {
		return 0, err
	}
	if err := c.DB.QueryRow(`
		SELECT COALESCE(SUM(total), 0)
		FROM orders
		WHERE status = 'COMPLETED'
		  AND (updated_at AT TIME ZONE 'Asia/Jakarta')::date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
	`).Scan(&wa); err != nil {
		return 0, err
	}
	return kasir + wa, nil
}

// GetTodayHpp returns total COGS for today (WIB date) across both channels.
func (c *Client) GetTodayHpp() (float64, error) {
	var kasir, wa float64
	if err := c.DB.QueryRow(`
		SELECT COALESCE(SUM(hpp_total), 0)
		FROM kasir_transactions
		WHERE type = 'income'
		  AND date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
	`).Scan(&kasir); err != nil {
		return 0, err
	}
	if err := c.DB.QueryRow(`
		SELECT COALESCE(SUM(hpp_total), 0)
		FROM orders
		WHERE status = 'COMPLETED'
		  AND (updated_at AT TIME ZONE 'Asia/Jakarta')::date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
	`).Scan(&wa); err != nil {
		return 0, err
	}
	return kasir + wa, nil
}

// GetLowStockItems returns stock items at or below the given threshold, ascending by stock.
func (c *Client) GetLowStockItems(threshold int) ([]models.StockItem, error) {
	rows, err := c.DB.Query(`
		SELECT sku, name, stock
		FROM stocks
		WHERE stock <= $1
		ORDER BY stock ASC
	`, threshold)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []models.StockItem
	for rows.Next() {
		var item models.StockItem
		if err := rows.Scan(&item.SKU, &item.Name, &item.Stock); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
```

- [ ] **Step 2: Verify build**

```bash
cd backend-go && go build ./...
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/db/heartbeat.go
git commit -m "feat(db): add heartbeat DB layer (GetHeartbeatConfig, GetTodayOmset, GetTodayHpp, GetLowStockItems)"
```

---

## Task 6: Heartbeat Poller

**Files:**
- Create: `backend-go/internal/heartbeat/poller.go`
- Create: `backend-go/internal/heartbeat/poller_test.go`

- [ ] **Step 1: Write the failing tests first**

Create `backend-go/internal/heartbeat/poller_test.go`:

```go
package heartbeat

import (
	"strings"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/models"
)

func TestParseInterval(t *testing.T) {
	cases := []struct {
		label string
		want  time.Duration
	}{
		{"Setiap 4 Jam", 4 * time.Hour},
		{"Setiap 4 jam", 4 * time.Hour},
		{"setiap 4 jam", 4 * time.Hour},
		{"Setiap 8 Jam", 8 * time.Hour},
		{"Setiap 12 Jam", 12 * time.Hour},
		{"Harian", 24 * time.Hour},
		{"harian", 24 * time.Hour},
		{"unknown label", 8 * time.Hour},
		{"", 8 * time.Hour},
	}
	for _, tc := range cases {
		got := parseInterval(tc.label)
		if got != tc.want {
			t.Errorf("parseInterval(%q) = %v, want %v", tc.label, got, tc.want)
		}
	}
}

func TestIsWIBBusinessHours(t *testing.T) {
	wib := time.FixedZone("WIB", 7*3600)
	// 07:00 WIB — boundary, should be in hours
	t0700 := time.Date(2026, 6, 5, 7, 0, 0, 0, wib)
	if !isWIBBusinessHours(t0700) {
		t.Error("07:00 WIB should be business hours")
	}
	// 21:59 WIB — last minute inside
	t2159 := time.Date(2026, 6, 5, 21, 59, 0, 0, wib)
	if !isWIBBusinessHours(t2159) {
		t.Error("21:59 WIB should be business hours")
	}
	// 22:00 WIB — boundary, outside
	t2200 := time.Date(2026, 6, 5, 22, 0, 0, 0, wib)
	if isWIBBusinessHours(t2200) {
		t.Error("22:00 WIB should not be business hours")
	}
	// 06:59 WIB — before hours
	t0659 := time.Date(2026, 6, 5, 6, 59, 0, 0, wib)
	if isWIBBusinessHours(t0659) {
		t.Error("06:59 WIB should not be business hours")
	}
}

func TestBuildReport_WithLowStock(t *testing.T) {
	cfg := &db.HeartbeatConfig{LowStockAlert: 5}
	items := []models.StockItem{
		{SKU: "SKU-001", Name: "Kabel NYM", Stock: 3},
		{SKU: "SKU-002", Name: "MCB 16A", Stock: 1},
	}
	msg := buildReport(cfg, 15_000_000, 8_000_000, items)

	if !strings.Contains(msg, "Rp 15.000.000") {
		t.Errorf("expected omset in message, got: %s", msg)
	}
	if !strings.Contains(msg, "Rp 7.000.000") {
		t.Errorf("expected laba bersih (15M-8M=7M) in message, got: %s", msg)
	}
	if !strings.Contains(msg, "Kabel NYM") {
		t.Errorf("expected low stock item in message, got: %s", msg)
	}
	if !strings.Contains(msg, "MCB 16A") {
		t.Errorf("expected low stock item in message, got: %s", msg)
	}
	if strings.Contains(msg, "Semua stok aman") {
		t.Error("should not show 'aman' when there are low stock items")
	}
}

func TestBuildReport_NoLowStock(t *testing.T) {
	cfg := &db.HeartbeatConfig{LowStockAlert: 5}
	msg := buildReport(cfg, 5_000_000, 3_000_000, nil)

	if !strings.Contains(msg, "Semua stok aman") {
		t.Errorf("expected 'Semua stok aman' when no low stock, got: %s", msg)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend-go && go test ./internal/heartbeat/... -v 2>&1 | tail -10
```
Expected: compile error — package does not exist yet.

- [ ] **Step 3: Create the poller implementation**

Create `backend-go/internal/heartbeat/poller.go`:

```go
package heartbeat

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
)

var wibLocation = time.FixedZone("WIB", 7*3600)

// Poller sends periodic heartbeat WA reports based on notification_config.
// lastFiredAt is in-memory: resets to zero on restart so first eligible tick fires immediately.
type Poller struct {
	db          *db.Client
	sender      *whatsapp.Sender
	lastFiredAt time.Time
}

func NewPoller(d *db.Client, s *whatsapp.Sender) *Poller {
	return &Poller{db: d, sender: s}
}

// Start launches the polling goroutine. Stops when ctx is cancelled.
func (p *Poller) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				p.tick(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (p *Poller) tick(ctx context.Context) {
	cfg, err := p.db.GetHeartbeatConfig()
	if err != nil || cfg == nil || !cfg.Enabled {
		return
	}

	now := time.Now().In(wibLocation)
	if !isWIBBusinessHours(now) {
		return
	}

	interval := parseInterval(cfg.IntervalLabel)
	if !p.lastFiredAt.IsZero() && now.Before(p.lastFiredAt.Add(interval)) {
		return
	}

	omset, err := p.db.GetTodayOmset()
	if err != nil {
		log.Printf("[HEARTBEAT] GetTodayOmset error: %v", err)
		return
	}
	hpp, err := p.db.GetTodayHpp()
	if err != nil {
		log.Printf("[HEARTBEAT] GetTodayHpp error: %v", err)
		return
	}

	var lowStock []models.StockItem
	if cfg.ReportStatus {
		lowStock, err = p.db.GetLowStockItems(cfg.LowStockAlert)
		if err != nil {
			log.Printf("[HEARTBEAT] GetLowStockItems error: %v", err)
			// Non-fatal — send report without low stock section.
		}
	}

	msg := buildReport(cfg, omset, hpp, lowStock)

	recipients, err := p.db.GetActiveRecipients()
	if err != nil {
		log.Printf("[HEARTBEAT] GetActiveRecipients error: %v", err)
		return
	}

	for _, r := range recipients {
		if err := p.sender.SendText(ctx, r.WANumber, msg); err != nil {
			log.Printf("[HEARTBEAT] SendText to %s (%s) error: %v", r.Name, r.WANumber, err)
		}
	}

	p.lastFiredAt = now
	log.Printf("[HEARTBEAT] Report sent to %d recipients (omset=%.0f, laba=%.0f)", len(recipients), omset, omset-hpp)
}

func buildReport(cfg *db.HeartbeatConfig, omset, hpp float64, lowStock []models.StockItem) string {
	now := time.Now().In(wibLocation)
	laba := omset - hpp

	var sb strings.Builder
	sb.WriteString("📊 *Laporan Detak Jantung*\n")
	sb.WriteString(fmt.Sprintf("🕐 %s\n\n", now.Format("Monday, 02 Jan 2006 - 15:04 WIB")))

	if cfg.ReportRevenue {
		sb.WriteString(fmt.Sprintf("💰 Omset Hari Ini: Rp %s\n", formatRupiah(omset)))
		sb.WriteString(fmt.Sprintf("📈 Laba Bersih: Rp %s\n", formatRupiah(laba)))
	}

	if cfg.ReportStatus {
		sb.WriteString(fmt.Sprintf("\n📦 *Stok Menipis (≤%d unit):*\n", cfg.LowStockAlert))
		if len(lowStock) == 0 {
			sb.WriteString("Semua stok aman ✅\n")
		} else {
			for _, item := range lowStock {
				sb.WriteString(fmt.Sprintf("• %s — %s: %d unit\n", item.SKU, item.Name, item.Stock))
			}
		}
	}

	return sb.String()
}

func parseInterval(label string) time.Duration {
	switch strings.ToLower(strings.TrimSpace(label)) {
	case "setiap 4 jam":
		return 4 * time.Hour
	case "setiap 8 jam":
		return 8 * time.Hour
	case "setiap 12 jam":
		return 12 * time.Hour
	case "harian":
		return 24 * time.Hour
	default:
		return 8 * time.Hour
	}
}

func isWIBBusinessHours(t time.Time) bool {
	wib := t.In(wibLocation)
	hour := wib.Hour()
	return hour >= 7 && hour < 22
}

func formatRupiah(amount float64) string {
	sign := ""
	if amount < 0 {
		sign = "-"
		amount = -amount
	}
	n := int64(amount)
	s := fmt.Sprintf("%d", n)
	result := make([]byte, 0, len(s)+len(s)/3)
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			result = append(result, '.')
		}
		result = append(result, byte(c))
	}
	return sign + string(result)
}
```

- [ ] **Step 4: Run the tests**

```bash
cd backend-go && go test ./internal/heartbeat/... -v
```
Expected output:
```
=== RUN   TestParseInterval
--- PASS: TestParseInterval
=== RUN   TestIsWIBBusinessHours
--- PASS: TestIsWIBBusinessHours
=== RUN   TestBuildReport_WithLowStock
--- PASS: TestBuildReport_WithLowStock
=== RUN   TestBuildReport_NoLowStock
--- PASS: TestBuildReport_NoLowStock
PASS
```

- [ ] **Step 5: Verify full build**

```bash
cd backend-go && go build ./...
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/heartbeat/poller.go backend-go/internal/heartbeat/poller_test.go
git commit -m "feat(heartbeat): implement heartbeat poller with WIB schedule and report formatting"
```

---

## Task 7: Wire Heartbeat Poller in `main.go`

**Files:**
- Modify: `backend-go/main.go`

- [ ] **Step 1: Add the import**

In `backend-go/main.go`, in the import block, add:

```go
"github.com/username/sinar-elektrik-backend/internal/heartbeat"
```

The import block will look like:

```go
import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/username/sinar-elektrik-backend/config"
	"github.com/username/sinar-elektrik-backend/internal/assets"
	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/followup"
	"github.com/username/sinar-elektrik-backend/internal/gemini"
	"github.com/username/sinar-elektrik-backend/internal/heartbeat"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
)
```

- [ ] **Step 2: Start the heartbeat poller**

After the existing `followup.NewPoller(dbClient, sender).Start(ctx)` line (line 86), add:

```go
	followup.NewPoller(dbClient, sender).Start(ctx)
	log.Println("[MAIN] Follow-up poller started (1-minute tick)")

	heartbeat.NewPoller(dbClient, sender).Start(ctx)
	log.Println("[MAIN] Heartbeat poller started (1-minute tick)")
```

- [ ] **Step 3: Verify build**

```bash
cd backend-go && go build ./...
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add backend-go/main.go
git commit -m "feat(main): wire heartbeat poller"
```

---

## Task 8: Frontend Type Sync

**Files:**
- Modify: `src/types.ts` (line ~211, inside `DbOrder`)

- [ ] **Step 1: Add `hpp_total` to `DbOrder`**

In `src/types.ts`, in the `DbOrder` interface, add `hpp_total` after `updated_at`:

```typescript
  // Before:
  payment_verified_at?: string;
  verified_by?: string;
  created_at: string;
  updated_at: string;
}

// After:
  payment_verified_at?: string;
  verified_by?: string;
  created_at: string;
  updated_at: string;
  hpp_total?: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add hpp_total to DbOrder interface"
```

---

## Task 9: Rebuild Daemon and Verify

**Files:**
- Modify: `backend-go/sinar-elektrik-backend` (binary)

- [ ] **Step 1: Build the daemon binary**

```bash
cd backend-go && go build -o sinar-elektrik-backend .
```
Expected: no errors, updated binary.

- [ ] **Step 2: Run all Go tests**

```bash
cd backend-go && go test ./... 2>&1
```
Expected: all packages PASS, no failures.

- [ ] **Step 3: Commit the binary**

```bash
git add backend-go/sinar-elektrik-backend
git commit -m "build: rebuild daemon binary with heartbeat poller and WA HPP fix"
```

- [ ] **Step 4: Update progress.md**

Add to `progress.md` under a new section:
```
## 2026-06-05 — Heartbeat Poller + WA Order HPP Fix
- DB: Added hpp_total column to orders table
- Go: HandlePaymentVerified now decrements stock (stock_atas) and records FIFO HPP
- Go: New internal/heartbeat package — sends periodic WA reports per notification_config
- Frontend: DbOrder type includes hpp_total
```

```bash
git add progress.md
git commit -m "docs(progress): heartbeat poller + WA order HPP fix complete"
```
