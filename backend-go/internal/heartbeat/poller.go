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
	if err != nil {
		log.Printf("[HEARTBEAT] GetHeartbeatConfig error: %v", err)
		return
	}
	if cfg == nil || !cfg.Enabled {
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
