// backend-go/internal/recon/special_edc_test.go
package recon

import "testing"

func TestMatchEDC_ValidMDR(t *testing.T) {
	// gross 12,287,000 settled net 12,200,000 → MDR 87,000 (0.71% — valid)
	line := BankLine{Amount: 12_200_000, TxnDate: mustDate("2026-06-04")}
	gross := 12_287_000.0
	s := Settings{EDCMDRMinPct: 0.005, EDCMDRMaxPct: 0.015}
	out := MatchEDCSettlement(line, gross, s)
	if !out.Valid {
		t.Fatalf("expected valid, got %+v", out)
	}
	if out.MDR <= 0 {
		t.Errorf("expected positive MDR, got %.2f", out.MDR)
	}
}

func TestMatchEDC_MDROutOfRange(t *testing.T) {
	// MDR = 0 (line == gross) → out of [0.5%, 1.5%] → invalid
	line := BankLine{Amount: 10_000_000}
	gross := 10_000_000.0
	s := Settings{EDCMDRMinPct: 0.005, EDCMDRMaxPct: 0.015}
	out := MatchEDCSettlement(line, gross, s)
	if out.Valid {
		t.Errorf("expected invalid (zero MDR), got valid")
	}
}

func TestMatchEDC_TooHighMDR(t *testing.T) {
	// 10% MDR — way above max
	line := BankLine{Amount: 9_000_000}
	gross := 10_000_000.0
	s := Settings{EDCMDRMinPct: 0.005, EDCMDRMaxPct: 0.015}
	out := MatchEDCSettlement(line, gross, s)
	if out.Valid {
		t.Errorf("MDR 10%% should be invalid")
	}
}
