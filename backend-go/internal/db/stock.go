package db

import (
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func (c *Client) SearchStockByName(productName string) ([]models.StockItem, error) {
	rows, err := c.DB.Query(`
		SELECT sku, name, category, price, stock, status
		FROM stocks
		WHERE LOWER(name) LIKE $1 AND stock > 0
		ORDER BY name ASC LIMIT 10
	`, "%"+strings.ToLower(productName)+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []models.StockItem
	for rows.Next() {
		var item models.StockItem
		rows.Scan(&item.SKU, &item.Name, &item.Category, &item.Price, &item.Stock, &item.Status)
		items = append(items, item)
	}
	return items, nil
}
