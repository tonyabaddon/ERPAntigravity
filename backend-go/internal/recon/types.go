// backend-go/internal/recon/types.go
package recon

import "time"

type Direction string

const (
	DirectionIn  Direction = "IN"
	DirectionOut Direction = "OUT"
)

type LineKind string

const (
	KindCustomerPayment  LineKind = "CUSTOMER_PAYMENT"
	KindCashDeposit      LineKind = "CASH_DEPOSIT"
	KindEDCSettlement    LineKind = "EDC_SETTLEMENT"
	KindSupplierPayment  LineKind = "SUPPLIER_PAYMENT"
	KindExpense          LineKind = "EXPENSE"
	KindBankFee          LineKind = "BANK_FEE"
	KindInternalTransfer LineKind = "INTERNAL_TRANSFER"
	KindCustomerTopup    LineKind = "CUSTOMER_TOPUP"
	KindOwnerDrawing     LineKind = "OWNER_DRAWING"
	KindOwnerTopup       LineKind = "OWNER_TOPUP"
	KindRefund           LineKind = "REFUND"
	KindOtherIncome      LineKind = "OTHER_INCOME"
	KindLegacyPeriod     LineKind = "LEGACY_PERIOD"
	KindUnknown          LineKind = "UNKNOWN"
)

type Lane string

const (
	LaneGreen  Lane = "GREEN"
	LaneYellow Lane = "YELLOW"
	LaneOrange Lane = "ORANGE"
	LaneRed    Lane = "RED"
	LaneGray   Lane = "GRAY"
)

type BankLine struct {
	ID             string
	BankAccountID  string
	BankAccountNum string // for internal-transfer detection
	TxnDate        time.Time
	Amount         float64
	Direction      Direction
	Description    string
	Counterparty   string
	LineKind       LineKind
	Lane           Lane
}

type PayableSlot struct {
	ID             string
	OrderID        string
	SlotType       string // FULL | DP | BALANCE
	ExpectedAmount float64
	CustomerName   string
	OrderCreatedAt time.Time
	Status         string // OPEN | MATCHED | ...
}

type Supplier struct {
	ID   string
	Name string
}

type BankAccount struct {
	ID            string
	BankCode      string
	AccountNumber string
}

type Settings struct {
	ThresholdGreen        float64
	ThresholdYellow       float64
	ThresholdOrange       float64
	AmountTolerancePct    float64
	DateWindowBackDays    int
	DateWindowForwardDays int
	EDCMDRMinPct          float64
	EDCMDRMaxPct          float64
	FirstEligibleDate     time.Time
}

type Candidate struct {
	Slot           PayableSlot
	Score          float64
	AmountMatch    float64
	NameSimilarity float64
	DateProximity  float64
	Breakdown      string
}
