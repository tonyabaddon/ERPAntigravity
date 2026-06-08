// backend-go/internal/recon/special_internal_test.go
package recon

import "testing"

func TestPairInternalTransfer_FindsMatch(t *testing.T) {
	out := BankLine{ID: "o1", BankAccountID: "a1", Direction: DirectionOut, Amount: 20_000_000, TxnDate: mustDate("2026-06-15"), Description: "TRSF KE 5678"}
	in := BankLine{ID: "i1", BankAccountID: "a2", Direction: DirectionIn, Amount: 20_000_000, TxnDate: mustDate("2026-06-15"), Counterparty: "GARINDO JAYA"}
	inLines := []BankLine{in}
	found := PairInternalTransfer(out, inLines)
	if found == nil || found.ID != "i1" {
		t.Errorf("expected i1, got %+v", found)
	}
}

func TestPairInternalTransfer_NoMatchOutOfWindow(t *testing.T) {
	out := BankLine{ID: "o1", Direction: DirectionOut, Amount: 20_000_000, TxnDate: mustDate("2026-06-10")}
	in := BankLine{ID: "i1", Direction: DirectionIn, Amount: 20_000_000, TxnDate: mustDate("2026-06-15")}
	found := PairInternalTransfer(out, []BankLine{in})
	if found != nil {
		t.Errorf("expected nil (5 days apart), got %+v", found)
	}
}
