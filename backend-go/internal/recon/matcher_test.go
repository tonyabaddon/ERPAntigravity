// backend-go/internal/recon/matcher_test.go
package recon

import (
	"testing"
	"time"
)

func mustDate(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func TestScoreCandidate_ExactMatch(t *testing.T) {
	line := BankLine{Amount: 4200000, Counterparty: "HENDRA K", TxnDate: mustDate("2026-05-28")}
	slot := PayableSlot{ExpectedAmount: 4200000, CustomerName: "Hendra Kurniawan", OrderCreatedAt: mustDate("2026-05-27")}
	c := ScoreCandidate(line, slot)
	if c.Score < 0.85 || c.Score > 0.95 {
		t.Errorf("expected score ~0.90, got %.3f", c.Score)
	}
	if c.AmountMatch != 1.0 {
		t.Errorf("AmountMatch = %.2f, want 1.0", c.AmountMatch)
	}
}

func TestScoreCandidate_AmountOnly(t *testing.T) {
	line := BankLine{Amount: 4200000, Counterparty: "X Y Z", TxnDate: mustDate("2026-05-28")}
	slot := PayableSlot{ExpectedAmount: 4200000, CustomerName: "Hendra Kurniawan", OrderCreatedAt: mustDate("2026-05-01")}
	c := ScoreCandidate(line, slot)
	if c.Score > 0.70 {
		t.Errorf("expected score <= 0.70, got %.3f", c.Score)
	}
}

func TestAssignLane_Green(t *testing.T) {
	s := defaultSettings()
	cands := []Candidate{{Score: 0.95}}
	lane := AssignLane(cands, s)
	if lane != LaneGreen {
		t.Errorf("got %v, want GREEN", lane)
	}
}

func TestAssignLane_Yellow(t *testing.T) {
	s := defaultSettings()
	cands := []Candidate{{Score: 0.82}}
	lane := AssignLane(cands, s)
	if lane != LaneYellow {
		t.Errorf("got %v, want YELLOW", lane)
	}
}

func TestAssignLane_Orange_MultipleCandidates(t *testing.T) {
	s := defaultSettings()
	cands := []Candidate{{Score: 0.86}, {Score: 0.80}, {Score: 0.40}}
	lane := AssignLane(cands, s)
	if lane != LaneOrange {
		t.Errorf("got %v, want ORANGE", lane)
	}
}

func TestAssignLane_Red_NoCandidates(t *testing.T) {
	s := defaultSettings()
	cands := []Candidate{}
	lane := AssignLane(cands, s)
	if lane != LaneRed {
		t.Errorf("got %v, want RED", lane)
	}
}

func TestAssignLane_Red_LowBest(t *testing.T) {
	s := defaultSettings()
	cands := []Candidate{{Score: 0.40}}
	lane := AssignLane(cands, s)
	if lane != LaneRed {
		t.Errorf("got %v, want RED", lane)
	}
}

func defaultSettings() Settings {
	return Settings{
		ThresholdGreen: 0.90, ThresholdYellow: 0.75, ThresholdOrange: 0.70,
	}
}

func TestEligibleSlots_FiltersByAmountAndDate(t *testing.T) {
	s := Settings{
		ThresholdGreen: 0.90, ThresholdYellow: 0.75, ThresholdOrange: 0.70,
		AmountTolerancePct: 0.05, DateWindowBackDays: 14, DateWindowForwardDays: 7,
	}
	line := BankLine{Amount: 1_000_000, TxnDate: mustDate("2026-06-10")}
	slots := []PayableSlot{
		{ID: "in", ExpectedAmount: 1_000_000, OrderCreatedAt: mustDate("2026-06-01")},
		{ID: "amt", ExpectedAmount: 1_500_000, OrderCreatedAt: mustDate("2026-06-01")},
		{ID: "old", ExpectedAmount: 1_000_000, OrderCreatedAt: mustDate("2026-05-01")},
	}
	out := EligibleSlots(line, slots, s)
	if len(out) != 1 || out[0].ID != "in" {
		t.Errorf("expected only 'in', got %+v", out)
	}
}
