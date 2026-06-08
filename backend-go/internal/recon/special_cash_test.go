// backend-go/internal/recon/special_cash_test.go
package recon

import (
	"testing"
)

func TestMatchCashDeposit_SingleCandidate(t *testing.T) {
	line := BankLine{Amount: 10_000_000, TxnDate: mustDate("2026-06-03")}
	batches := []FakeBatch{
		{ID: "k3", ExpectedAmount: 10_000_000, DepositDate: mustDate("2026-06-02"), Status: "PENDING"},
	}
	out, variance := MatchCashDeposit(line, batches)
	if out == nil || out.ID != "k3" {
		t.Fatalf("expected k3, got %+v", out)
	}
	if variance != 0 {
		t.Errorf("variance = %.2f, want 0", variance)
	}
}

func TestMatchCashDeposit_Variance(t *testing.T) {
	line := BankLine{Amount: 7_000_000, TxnDate: mustDate("2026-06-02")}
	batches := []FakeBatch{
		{ID: "k2", ExpectedAmount: 7_245_000, DepositDate: mustDate("2026-06-01"), Status: "PENDING"},
	}
	out, variance := MatchCashDeposit(line, batches)
	if out == nil || out.ID != "k2" {
		t.Fatalf("expected k2, got %+v", out)
	}
	if variance != -245_000 {
		t.Errorf("variance = %.2f, want -245000", variance)
	}
}

func TestMatchCashDeposit_NoCandidate(t *testing.T) {
	line := BankLine{Amount: 1_000_000, TxnDate: mustDate("2026-06-15")}
	out, _ := MatchCashDeposit(line, []FakeBatch{})
	if out != nil {
		t.Errorf("expected nil, got %+v", out)
	}
}
