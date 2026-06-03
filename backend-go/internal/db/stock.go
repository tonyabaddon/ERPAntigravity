package db

import (
	"encoding/json"
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
	return items, nil
}
