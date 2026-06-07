package db

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func (c *Client) SearchStockByName(productName string) ([]models.StockItem, error) {
	rows, err := c.DB.Query(`
		SELECT sku, name, category, price, stock, status, specs
		FROM stocks
		WHERE (LOWER(name) LIKE $1 OR LOWER(specs::text) LIKE $1) AND stock > 0
		ORDER BY name ASC LIMIT 10
	`, "%"+strings.ToLower(productName)+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []models.StockItem
	for rows.Next() {
		var item models.StockItem
		var specsRaw []byte
		rows.Scan(&item.SKU, &item.Name, &item.Category, &item.Price, &item.Stock, &item.Status, &specsRaw) //nolint:errcheck
		if len(specsRaw) > 0 {
			json.Unmarshal(specsRaw, &item.Specs) //nolint:errcheck
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

// DeductStockAndGetHPP decrements stock_atas by qty and returns the FIFO cost via
// the deduct_stock_fifo RPC. Both operations are best-effort; errors are returned
// but callers should log-and-continue so payment confirmation is never blocked.
//
// orderID is threaded into both RPCs as related_doc_id with related_doc_type
// 'order' and source 'sale_wa', so the two stock_movements ledger rows produced
// by each call (Phase 1 Tasks 5 & 7) can be correlated in audit queries.
//
// See 20260607000006_wrap_decrement_stock.sql's ARCHITECTURAL FINDING for why
// both calls remain in sequence and why each one writes a ledger row in Phase 1.
func (c *Client) DeductStockAndGetHPP(sku string, qty int, orderID string) (float64, error) {
	if _, err := c.DB.Exec(
		`SELECT public.decrement_stock($1, $2, 'atas', 'order'::text, $3::text, 'sale_wa'::public.stock_movement_source)`,
		sku, qty, orderID,
	); err != nil {
		return 0, fmt.Errorf("decrement_stock %s x%d: %w", sku, qty, err)
	}
	var cost float64
	if err := c.DB.QueryRow(
		`SELECT public.deduct_stock_fifo($1, $2, 'atas', 'order'::text, $3::text, 'sale_wa'::public.stock_movement_source)`,
		sku, qty, orderID,
	).Scan(&cost); err != nil {
		return 0, fmt.Errorf("deduct_stock_fifo %s x%d: %w", sku, qty, err)
	}
	return cost, nil
}
