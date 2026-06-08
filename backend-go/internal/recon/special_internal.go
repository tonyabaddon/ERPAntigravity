// backend-go/internal/recon/special_internal.go
package recon

import "math"

// PairInternalTransfer finds an IN line on another account that pairs with an OUT line.
// Match: same amount (within Rp 100), txn_date within ±2 days, must be different bank accounts.
func PairInternalTransfer(out BankLine, inLines []BankLine) *BankLine {
	if out.Direction != DirectionOut {
		return nil
	}
	for i := range inLines {
		in := &inLines[i]
		if in.Direction != DirectionIn {
			continue
		}
		if in.BankAccountID == out.BankAccountID {
			continue
		}
		if math.Abs(in.Amount-out.Amount) > 100 {
			continue
		}
		days := math.Abs(in.TxnDate.Sub(out.TxnDate).Hours() / 24)
		if days > 2 {
			continue
		}
		return in
	}
	return nil
}
