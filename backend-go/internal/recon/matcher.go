// backend-go/internal/recon/matcher.go
package recon

import (
	"fmt"
	"math"
	"sort"
	"time"
)

const (
	weightAmount = 0.50
	weightName   = 0.30
	weightDate   = 0.20
)

// ScoreCandidate computes a 0..1 confidence score for a (bank line, slot) pair.
func ScoreCandidate(line BankLine, slot PayableSlot) Candidate {
	diff := math.Abs(line.Amount - slot.ExpectedAmount)
	var am float64
	switch {
	case diff <= 100:
		am = 1.00
	case diff/slot.ExpectedAmount <= 0.01:
		am = 0.85
	case diff/slot.ExpectedAmount <= 0.03:
		am = 0.50
	default:
		am = 0.0
	}

	ns := NameSimilarity(line.Counterparty, slot.CustomerName)

	dp := dateProximity(line.TxnDate, slot.OrderCreatedAt)

	score := am*weightAmount + ns*weightName + dp*weightDate
	return Candidate{
		Slot:           slot,
		Score:          round2(score),
		AmountMatch:    am,
		NameSimilarity: round2(ns),
		DateProximity:  dp,
		Breakdown:      fmt.Sprintf("amt=%.2f, name=%.2f, date=%.2f", am, ns, dp),
	}
}

func dateProximity(a, b time.Time) float64 {
	days := math.Abs(a.Sub(b).Hours() / 24)
	switch {
	case days <= 1:
		return 1.00
	case days <= 3:
		return 0.70
	case days <= 7:
		return 0.50
	case days <= 14:
		return 0.20
	default:
		return 0.00
	}
}

// AssignLane decides a lane for a sorted (or unsorted) candidate list.
func AssignLane(cands []Candidate, s Settings) Lane {
	if len(cands) == 0 {
		return LaneRed
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].Score > cands[j].Score })
	best := cands[0].Score
	aboveOrange := 0
	for _, c := range cands {
		if c.Score >= s.ThresholdOrange {
			aboveOrange++
		}
	}
	if aboveOrange >= 2 {
		return LaneOrange
	}
	if best >= s.ThresholdGreen {
		return LaneGreen
	}
	if best >= s.ThresholdYellow {
		return LaneYellow
	}
	return LaneRed
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
