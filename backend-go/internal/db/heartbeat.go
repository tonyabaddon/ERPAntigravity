package db

import (
	"database/sql"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

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
		if err == sql.ErrNoRows {
			return nil, nil
		}
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
