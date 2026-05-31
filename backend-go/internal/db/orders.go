package db

import (
	"encoding/json"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func (c *Client) CreateOrder(conv *models.Conversation, items []models.OrderItem, subtotal float64) (*models.Order, error) {
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(48 * time.Hour)

	var order models.Order
	var itemsBack []byte
	err = c.DB.QueryRow(`
		INSERT INTO orders (
			conversation_id, customer_name, customer_company, customer_address,
			customer_phone, items, subtotal, total, status, booking_expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'PENDING',$8)
		RETURNING id, conversation_id, customer_name, customer_company,
		          customer_address, customer_phone, items, subtotal, total,
		          status, booking_expires_at, created_at, updated_at
	`,
		conv.ID,
		conv.CollectedData.Name,
		conv.CollectedData.Company,
		conv.CollectedData.Address,
		conv.CustomerPhone,
		itemsJSON,
		subtotal,
		expiresAt,
	).Scan(
		&order.ID, &order.ConversationID, &order.CustomerName,
		&order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&itemsBack, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(itemsBack, &order.Items)
	return &order, nil
}

func (c *Client) UpdateOrderStatus(orderID, status string) error {
	var query string
	if status == "CANCELLED" {
		query = `UPDATE orders SET status = $1 WHERE id = $2`
	} else {
		query = `UPDATE orders SET status = $1, approved_at = now() WHERE id = $2`
	}
	_, err := c.DB.Exec(query, status, orderID)
	return err
}

func (c *Client) MarkReminderSent(orderID string) error {
	_, err := c.DB.Exec(`UPDATE orders SET reminder_sent_at = $1 WHERE id = $2`, time.Now(), orderID)
	return err
}

type PendingOrder struct {
	ID             string
	ConversationID string
	CustomerPhone  string
	ExpiresAt      time.Time
}

func (c *Client) ListActiveBookings() ([]PendingOrder, error) {
	rows, err := c.DB.Query(`
		SELECT o.id, o.conversation_id, o.customer_phone, o.booking_expires_at
		FROM orders o
		WHERE o.status IN ('PENDING') AND o.booking_expires_at > now()
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var orders []PendingOrder
	for rows.Next() {
		var o PendingOrder
		rows.Scan(&o.ID, &o.ConversationID, &o.CustomerPhone, &o.ExpiresAt)
		orders = append(orders, o)
	}
	return orders, nil
}

func (c *Client) GetOrderByConversation(conversationID string) (*models.Order, error) {
	var order models.Order
	var itemsJSON []byte
	err := c.DB.QueryRow(`
		SELECT id, conversation_id, customer_name, customer_company,
		       customer_address, customer_phone, items, subtotal, total,
		       status, booking_expires_at, created_at, updated_at
		FROM orders WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1
	`, conversationID).Scan(
		&order.ID, &order.ConversationID, &order.CustomerName,
		&order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&itemsJSON, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(itemsJSON, &order.Items)
	return &order, nil
}

func (c *Client) GetOrderByID(orderID string) (*models.Order, error) {
	var order models.Order
	var itemsJSON []byte
	err := c.DB.QueryRow(`
		SELECT id, conversation_id, customer_name, customer_company,
		       customer_address, customer_phone, items, subtotal, total,
		       status, booking_expires_at, created_at, updated_at
		FROM orders WHERE id = $1
	`, orderID).Scan(
		&order.ID, &order.ConversationID, &order.CustomerName,
		&order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&itemsJSON, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(itemsJSON, &order.Items)
	return &order, nil
}
