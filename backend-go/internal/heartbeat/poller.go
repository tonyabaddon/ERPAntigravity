package heartbeat

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/notification"
	"github.com/username/sinar-elektrik-backend/internal/notification/templates"
)

var wibLocation = time.FixedZone("WIB", 7*3600)

// Poller sends periodic heartbeat WA reports based on notification_config.
// lastFiredAt is in-memory: resets to zero on restart so first eligible tick fires immediately.
type Poller struct {
	db          *db.Client
	notifier    *notification.Notifier
	lastFiredAt time.Time
}

func NewPoller(d *db.Client, n *notification.Notifier) *Poller {
	return &Poller{db: d, notifier: n}
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
		slog.Error("[HEARTBEAT] GetHeartbeatConfig error", slog.String("error", err.Error()))
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
		slog.Error("[HEARTBEAT] GetTodayOmset error", slog.String("error", err.Error()))
		return
	}
	hpp, err := p.db.GetTodayHpp()
	if err != nil {
		slog.Error("[HEARTBEAT] GetTodayHpp error", slog.String("error", err.Error()))
		return
	}

	laba := omset - hpp

	var lowStockNames []string
	if cfg.ReportStatus {
		items, stockErr := p.db.GetLowStockItems(cfg.LowStockAlert)
		if stockErr != nil {
			slog.Error("[HEARTBEAT] GetLowStockItems error", slog.String("error", stockErr.Error()))
			// Non-fatal — send report without low stock section.
		} else {
			for _, item := range items {
				lowStockNames = append(lowStockNames, fmt.Sprintf("%s — %s: %d unit", item.SKU, item.Name, item.Stock))
			}
		}
	}

	tmpl := templates.HeartbeatDigest{}
	params := map[string]any{
		"tanggal":         now.Format("2 Jan 2006"),
		"omset_hari":      omset,
		"laba_hari":       laba,
		"low_stock_count": len(lowStockNames),
	}
	if len(lowStockNames) > 0 {
		params["low_stock_items"] = lowStockNames
	}

	msg, err := tmpl.Build(ctx, params)
	if err != nil {
		slog.ErrorContext(ctx, "[HEARTBEAT] template render error", slog.Any("error", err))
		return
	}

	// tenantID is empty string: single-tenant Calista backend; the recipientResolverAdapter
	// in main.go ignores this arg until multi-tenant migration in Sprint 2+.
	filter := notification.RecipientFilter{Role: "owner", CritLevel: "normal"}
	if err := p.notifier.BroadcastToStaff(ctx, "", filter, msg); err != nil {
		slog.ErrorContext(ctx, "[HEARTBEAT] broadcast error", slog.Any("error", err))
	}

	p.lastFiredAt = now
	slog.InfoContext(ctx, "[HEARTBEAT] report sent",
		slog.Float64("omset", omset),
		slog.Float64("laba", laba),
		slog.Int("low_stock_count", len(lowStockNames)))
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
