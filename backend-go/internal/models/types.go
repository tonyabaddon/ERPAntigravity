package models

import "time"

type ConversationState string

const (
	StateGreeting        ConversationState = "GREETING"
	StateCollecting      ConversationState = "COLLECTING"
	StateClarifying      ConversationState = "CLARIFYING"
	StateStockCheck      ConversationState = "STOCK_CHECK"
	StateConfirming      ConversationState = "CONFIRMING"
	StateAddMore         ConversationState = "ADD_MORE"
	StateDelivery        ConversationState = "DELIVERY"
	StateBooked          ConversationState = "BOOKED"
	StateTimeoutReminder ConversationState = "TIMEOUT_REMINDER"
	StateCancelled       ConversationState = "CANCELLED"
	StateApproved        ConversationState = "APPROVED"
	StateCompleted       ConversationState = "COMPLETED"
	StateEscalatedAdmin  ConversationState = "ESCALATED_ADMIN"
	StateEscalatedWiring ConversationState = "ESCALATED_WIRING"
)

func (s ConversationState) IsTerminal() bool {
	switch s {
	case StateCancelled, StateCompleted, StateEscalatedAdmin, StateEscalatedWiring:
		return true
	}
	return false
}

type OrderStatus string

const (
	OrderStatusPending                  OrderStatus = "PENDING"
	OrderStatusApproved                 OrderStatus = "APPROVED"
	OrderStatusPendingAdminConfirmation OrderStatus = "PENDING_ADMIN_CONFIRMATION"
	OrderStatusPendingPriceNego         OrderStatus = "PENDING_PRICE_NEGO"
	OrderStatusPendingStockCheck        OrderStatus = "PENDING_STOCK_CHECK"
	OrderStatusPendingCustomQuote       OrderStatus = "PENDING_CUSTOM_QUOTE"
	OrderStatusPendingWiringQuote       OrderStatus = "PENDING_WIRING_QUOTE"
	OrderStatusWaitingPayment           OrderStatus = "WAITING_PAYMENT"
	OrderStatusWaitingDP                OrderStatus = "WAITING_DP"
	OrderStatusDPUploaded               OrderStatus = "DP_UPLOADED"
	OrderStatusDPVerified               OrderStatus = "DP_VERIFIED"
	OrderStatusDPProofRejected          OrderStatus = "DP_PROOF_REJECTED"
	OrderStatusPaymentUploaded          OrderStatus = "PAYMENT_UPLOADED"
	OrderStatusPaymentVerified          OrderStatus = "PAYMENT_VERIFIED"
	OrderStatusPaymentRejected          OrderStatus = "PAYMENT_REJECTED"
	OrderStatusCancelled                OrderStatus = "CANCELLED"
	OrderStatusCompleted                OrderStatus = "COMPLETED"
)

type OrderType string

const (
	OrderTypeStandard    OrderType = "STANDARD"
	OrderTypeCustomPanel OrderType = "CUSTOM_PANEL"
	OrderTypeWiring      OrderType = "WIRING_PANEL"
)

type DeliveryType string

const (
	DeliveryTypePickup   DeliveryType = "PICKUP"
	DeliveryTypeDelivery DeliveryType = "DELIVERY"
)

type LeadStatus string

const (
	LeadStatusNew        LeadStatus = "NEW"
	LeadStatusInProgress LeadStatus = "IN_PROGRESS"
	LeadStatusEscalated  LeadStatus = "ESCALATED"
	LeadStatusOrdered    LeadStatus = "ORDERED"
	LeadStatusDropped    LeadStatus = "DROPPED"
)

type MessageSender string

const (
	SenderCustomer MessageSender = "customer"
	SenderAI       MessageSender = "ai"
	SenderAdmin    MessageSender = "admin"
	SenderSystem   MessageSender = "system"
)

type CartItem struct {
	Product  string `json:"product"`
	Quantity int    `json:"quantity"`
	Specs    string `json:"specs"`
}

type CollectedData struct {
	Name     string     `json:"name,omitempty"`
	Company  string     `json:"company,omitempty"`
	Address  string     `json:"address,omitempty"`
	Product  string     `json:"product,omitempty"`
	Quantity int        `json:"quantity,omitempty"`
	Specs    SpecsData  `json:"specs,omitempty"`
	Cart     []CartItem `json:"cart,omitempty"`
}

func (d CollectedData) AllCoreFieldsFilled() bool {
	return d.Name != "" && d.Company != "" && d.Product != ""
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
	AIActive           bool              `json:"ai_active"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
	LastAIMessageAt    *time.Time        `json:"last_ai_message_at,omitempty"`
	FollowupCountToday int               `json:"followup_count_today"`
	LastFollowupDate   *time.Time        `json:"last_followup_date,omitempty"`
	StateLockedUntil   *time.Time        `json:"state_locked_until,omitempty"`
}

type Message struct {
	ID             string        `json:"id"`
	ConversationID string        `json:"conversation_id"`
	Sender         MessageSender `json:"sender"`
	Text           string        `json:"text"`
	MediaURL       string        `json:"media_url,omitempty"`
	MediaType      string        `json:"media_type,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
}

type Order struct {
	ID               string       `json:"id"`
	ConversationID   string       `json:"conversation_id"`
	GJPOrderID       string       `json:"gjp_order_id,omitempty"`
	OrderType        OrderType    `json:"order_type"`
	LeadsID          string       `json:"leads_id,omitempty"`
	CustomerID       string       `json:"customer_id,omitempty"`
	CustomerName     string       `json:"customer_name"`
	CustomerCompany  string       `json:"customer_company"`
	CustomerAddress  string       `json:"customer_address"`
	CustomerPhone    string       `json:"customer_phone"`
	DeliveryType     DeliveryType `json:"delivery_type,omitempty"`
	Items            []OrderItem  `json:"items"`
	Subtotal         float64      `json:"subtotal"`
	ShippingFee      *float64     `json:"shipping_fee,omitempty"`
	Total            float64      `json:"total"`
	Status           OrderStatus  `json:"status"`
	BookingExpiresAt time.Time    `json:"booking_expires_at"`
	ReminderSentAt   *time.Time   `json:"reminder_sent_at,omitempty"`
	ApprovedAt       *time.Time   `json:"approved_at,omitempty"`
	FullProofURL     string       `json:"full_proof_url,omitempty"`
	DPProofURL       string       `json:"dp_proof_url,omitempty"`
	PaymentType      string       `json:"payment_type,omitempty"`
	DPAmount         float64      `json:"dp_amount,omitempty"`
	DPInputType      string       `json:"dp_input_type,omitempty"`
	DPValue          float64      `json:"dp_value,omitempty"`
	RejectionReason  string       `json:"rejection_reason,omitempty"`
	PaymentVerifiedAt *time.Time  `json:"payment_verified_at,omitempty"`
	VerifiedBy       string       `json:"verified_by,omitempty"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
	HppTotal         float64      `json:"hpp_total"`
}

type OrderItem struct {
	SKU       string  `json:"sku"`
	Name      string  `json:"name"`
	Qty       int     `json:"qty"`
	UnitPrice float64 `json:"unit_price"`
	Subtotal  float64 `json:"subtotal"`
}

type StockItem struct {
	SKU      string                 `json:"sku"`
	Name     string                 `json:"name"`
	Category string                 `json:"category"`
	Price    float64                `json:"price"`
	Stock    int                    `json:"stock"`
	Status   string                 `json:"status"`
	Specs    map[string]interface{} `json:"specs"`
}

type Customer struct {
	ID        string    `json:"id"`
	WANumber  string    `json:"wa_number"`
	Name      string    `json:"name"`
	Company   string    `json:"company"`
	CreatedAt time.Time `json:"created_at"`
}

type Lead struct {
	ID               string     `json:"id"`
	CustomerID       string     `json:"customer_id"`
	ConversationID   string     `json:"conversation_id"`
	WANumber         string     `json:"wa_number"`
	Status           LeadStatus `json:"status"`
	ConfirmedOrderID string     `json:"confirmed_order_id,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type BankConfig struct {
	ID            int       `json:"id"`
	BankName      string    `json:"bank_name"`
	AccountNumber string    `json:"account_number"`
	AccountName   string    `json:"account_name"`
	IsActive      bool      `json:"is_active"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type WaRecipient struct {
	ID        int       `json:"id"`
	Role      string    `json:"role"`
	Name      string    `json:"name"`
	WANumber  string    `json:"wa_number"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
}
