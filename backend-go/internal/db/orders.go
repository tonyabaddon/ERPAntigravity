package db

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// CreateOrder inserts a new order. leadsID and customerID may be empty strings
// (stored as NULL) if not yet known. deliveryType may be empty (unknown until confirmed).
func (c *Client) CreateOrder(
	conv *models.Conversation,
	items []models.OrderItem,
	subtotal float64,
	leadsID, customerID string,
	orderType models.OrderType,
	deliveryType models.DeliveryType,
) (*models.Order, error) {
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(48 * time.Hour)

	// Convert empty strings to nil for nullable FK columns.
	var leadsIDVal, customerIDVal, deliveryTypeVal interface{}
	if leadsID != "" {
		leadsIDVal = leadsID
	}
	if customerID != "" {
		customerIDVal = customerID
	}
	if deliveryType != "" {
		deliveryTypeVal = string(deliveryType)
	}

	var order models.Order
	var itemsBack []byte
	err = c.DB.QueryRow(`
		INSERT INTO orders (
			conversation_id, customer_name, customer_company, customer_address,
			customer_phone, items, subtotal, total, status, booking_expires_at,
			leads_id, customer_id, order_type, delivery_type
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'PENDING_ADMIN_CONFIRMATION',$8,$9,$10,$11,$12)
		RETURNING id, conversation_id,
		          COALESCE(gjp_order_id,''), order_type,
		          COALESCE(leads_id,''), COALESCE(customer_id,''),
		          customer_name, customer_company, customer_address, customer_phone,
		          COALESCE(delivery_type,''),
		          items, subtotal, total, status, booking_expires_at,
		          created_at, updated_at
	`,
		conv.ID,
		conv.CollectedData.Name,
		conv.CollectedData.Company,
		conv.CollectedData.Address,
		conv.CustomerPhone,
		itemsJSON,
		subtotal,
		expiresAt,
		leadsIDVal,
		customerIDVal,
		string(orderType),
		deliveryTypeVal,
	).Scan(
		&order.ID, &order.ConversationID,
		&order.GJPOrderID, &order.OrderType,
		&order.LeadsID, &order.CustomerID,
		&order.CustomerName, &order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&order.DeliveryType,
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
	if status == "WAITING_PAYMENT" {
		// Only set approved_at when admin actually approves the order.
		query = `UPDATE orders SET status = $1, approved_at = now() WHERE id = $2`
	} else {
		query = `UPDATE orders SET status = $1 WHERE id = $2`
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
		WHERE o.status IN ('PENDING_ADMIN_CONFIRMATION') AND o.booking_expires_at > now()
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var orders []PendingOrder
	for rows.Next() {
		var o PendingOrder
		if err := rows.Scan(&o.ID, &o.ConversationID, &o.CustomerPhone, &o.ExpiresAt); err != nil {
			return nil, err
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return orders, nil
}

func (c *Client) UpdateOrderTotal(orderID string, total float64) error {
	_, err := c.DB.Exec(`UPDATE orders SET total = $1 WHERE id = $2`, total, orderID)
	return err
}

func (c *Client) GetOrderByConversation(conversationID string) (*models.Order, error) {
	var order models.Order
	var itemsJSON []byte
	err := c.DB.QueryRow(`
		SELECT id, conversation_id,
		       COALESCE(gjp_order_id,''), order_type,
		       COALESCE(leads_id,''), COALESCE(customer_id,''),
		       customer_name, customer_company, customer_address, customer_phone,
		       COALESCE(delivery_type,''),
		       items, subtotal, total, status, booking_expires_at,
		       created_at, updated_at
		FROM orders WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1
	`, conversationID).Scan(
		&order.ID, &order.ConversationID,
		&order.GJPOrderID, &order.OrderType,
		&order.LeadsID, &order.CustomerID,
		&order.CustomerName, &order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&order.DeliveryType,
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
		SELECT id, conversation_id,
		       COALESCE(gjp_order_id,''), order_type,
		       COALESCE(leads_id,''), COALESCE(customer_id,''),
		       customer_name, customer_company, customer_address, customer_phone,
		       COALESCE(delivery_type,''),
		       items, subtotal, total, status, booking_expires_at,
		       created_at, updated_at
		FROM orders WHERE id = $1
	`, orderID).Scan(
		&order.ID, &order.ConversationID,
		&order.GJPOrderID, &order.OrderType,
		&order.LeadsID, &order.CustomerID,
		&order.CustomerName, &order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&order.DeliveryType,
		&itemsJSON, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(itemsJSON, &order.Items)
	return &order, nil
}

// GetOrderByIDWithPayment returns a full order including payment fields.
// Used by the payment verification flow (sub-project C).
func (c *Client) GetOrderByIDWithPayment(orderID string) (*models.Order, error) {
	var order models.Order
	var itemsJSON []byte
	var paymentVerifiedAt sql.NullTime
	err := c.DB.QueryRow(`
		SELECT id, conversation_id,
		       COALESCE(gjp_order_id,''), order_type,
		       COALESCE(leads_id,''), COALESCE(customer_id,''),
		       customer_name, customer_company, customer_address, customer_phone,
		       COALESCE(delivery_type,''),
		       items, subtotal, total, status, booking_expires_at,
		       COALESCE(payment_proof_url,''), payment_verified_at,
		       COALESCE(verified_by,''),
		       created_at, updated_at
		FROM orders WHERE id = $1
	`, orderID).Scan(
		&order.ID, &order.ConversationID,
		&order.GJPOrderID, &order.OrderType,
		&order.LeadsID, &order.CustomerID,
		&order.CustomerName, &order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&order.DeliveryType,
		&itemsJSON, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt,
		&order.PaymentProofURL, &paymentVerifiedAt,
		&order.VerifiedBy,
		&order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if paymentVerifiedAt.Valid {
		order.PaymentVerifiedAt = &paymentVerifiedAt.Time
	}
	json.Unmarshal(itemsJSON, &order.Items)
	return &order, nil
}
