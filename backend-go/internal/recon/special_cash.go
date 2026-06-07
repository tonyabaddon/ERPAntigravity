// backend-go/internal/recon/special_cash.go
package recon

import (
	"math"
	"time"
)

// FakeBatch is a stand-in for the cash_deposit_batches row used by MatchCashDeposit.
// It will be replaced with a generated DB model in a later task.
type FakeBatch struct {
	ID             string
	ExpectedAmount float64
	DepositDate    time.Time
	Status         string
}

// MatchCashDeposit picks the best PENDING batch (amount within ±5%, date within ±2 days).
// Returns the matched batch (or nil) and variance (line.Amount - batch.ExpectedAmount).
func MatchCashDeposit(line BankLine, batches []FakeBatch) (*FakeBatch, float64) {
	var best *FakeBatch
	bestDelta := math.MaxFloat64
	for i := range batches {
		b := &batches[i]
		if b.Status != "PENDING" {
			continue
		}
		if math.Abs(b.ExpectedAmount-line.Amount)/line.Amount > 0.05 {
			continue
		}
		days := math.Abs(line.TxnDate.Sub(b.DepositDate).Hours() / 24)
		if days > 2 {
			continue
		}
		delta := math.Abs(b.ExpectedAmount - line.Amount)
		if delta < bestDelta {
			bestDelta = delta
			best = b
		}
	}
	if best == nil {
		return nil, 0
	}
	return best, line.Amount - best.ExpectedAmount
}
