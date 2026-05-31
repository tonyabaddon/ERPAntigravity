package models

import "time"

type ConversationState string

const (
	StateGreeting        ConversationState = "GREETING"
	StateCollecting      ConversationState = "COLLECTING"
	StateClarifying      ConversationState = "CLARIFYING"
	StateStockCheck      ConversationState = "STOCK_CHECK"
	StateConfirming      ConversationState = "CONFIRMING"
	StateBooked          ConversationState = "BOOKED"
	StateTimeoutReminder ConversationState = "TIMEOUT_REMINDER"
	StateCancelled       ConversationState = "CANCELLED"
	StateApproved        ConversationState = "APPROVED"
	StateCompleted       ConversationState = "COMPLETED"
	StateEscalatedAdmin  ConversationState = "ESCALATED_ADMIN"
	StateEscalatedWiring ConversationState = "ESCALATED_WIRING"
)

// IsTerminal returns true for states where new customer messages should be ignored by the AI.
func (s ConversationState) IsTerminal() bool {
	switch s {
	case StateCancelled, StateCompleted, StateEscalatedAdmin, StateEscalatedWiring:
		return true
	}
	return false
}

type CollectedData struct {
	Name     string    `json:"name,omitempty"`
	Company  string    `json:"company,omitempty"`
	Address  string    `json:"address,omitempty"`
	Product  string    `json:"product,omitempty"`
	Quantity int       `json:"quantity,omitempty"`
	Specs    SpecsData `json:"specs,omitempty"`
}

func (d CollectedData) AllCoreFieldsFilled() bool {
	return d.Name != "" && d.Company != "" && d.Address != "" && d.Product != ""
}

type SpecsData struct {
	Size  string `json:"size,omitempty"`
	Color string `json:"color,omitempty"`
	Notes string `json:"notes,omitempty"`
}

type Conversation struct {
	ID                 string            `json:"id"`
	WANumberID         string            `json:"wa_number_id"`
	CustomerPhone      string            `json:"customer_phone"`
	State              ConversationState `json:"state"`
	Language           string            `json:"language"`
	CollectedData      CollectedData     `json:"collected_data"`
	ClarificationRound int               `json:"clarification_round"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

type Message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	Sender         string    `json:"sender"`
	Text           string    `json:"text"`
	MediaURL       string    `json:"media_url,omitempty"`
	MediaType      string    `json:"media_type,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type Order struct {
	ID              string      `json:"id"`
	ConversationID  string      `json:"conversation_id"`
	CustomerName    string      `json:"customer_name"`
	CustomerCompany string      `json:"customer_company"`
	CustomerAddress string      `json:"customer_address"`
	CustomerPhone   string      `json:"customer_phone"`
	Items           []OrderItem `json:"items"`
	Subtotal        float64     `json:"subtotal"`
	ShippingFee     *float64    `json:"shipping_fee,omitempty"`
	Total           float64     `json:"total"`
	Status          string      `json:"status"`
	BookingExpiresAt time.Time  `json:"booking_expires_at"`
	ReminderSentAt  *time.Time  `json:"reminder_sent_at,omitempty"`
	ApprovedAt      *time.Time  `json:"approved_at,omitempty"`
	CreatedAt       time.Time   `json:"created_at"`
}

type OrderItem struct {
	SKU       string  `json:"sku"`
	Name      string  `json:"name"`
	Qty       int     `json:"qty"`
	UnitPrice float64 `json:"unit_price"`
	Subtotal  float64 `json:"subtotal"`
}

type StockItem struct {
	SKU      string  `json:"sku"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Price    float64 `json:"price"`
	Stock    int     `json:"stock"`
	Status   string  `json:"status"`
}
