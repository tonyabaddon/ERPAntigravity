// backend-go/internal/recon/engine.go
package recon

import (
	"context"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// DBPort decouples engine from concrete *db.Client (allows mocking in tests).
type DBPort interface {
	ListBankAccounts(ctx context.Context) ([]db.BankAccount, error)
	ListSuppliers(ctx context.Context) ([]db.Supplier, error)
	ListOpenSlotsForDate(ctx context.Context, txnDate time.Time, backDays, forwardDays int) ([]db.PayableSlot, error)
	InsertAllocation(ctx context.Context, lineID, slotID string, amount float64) error
	UpdateLineLane(ctx context.Context, lineID, lane, reason string, conf float64) error
	GetSettings(ctx context.Context) (db.Settings, error)
}

// ProcessLines runs the engine over an import's newly-inserted lines.
// Returns count of GREEN auto-matches.
func ProcessLines(ctx context.Context, p DBPort, importID string, lines []BankLine) (matched int, err error) {
	settings, err := p.GetSettings(ctx)
	if err != nil {
		return 0, err
	}
	accts, err := p.ListBankAccounts(ctx)
	if err != nil {
		return 0, err
	}
	sups, err := p.ListSuppliers(ctx)
	if err != nil {
		return 0, err
	}

	coreAccts := make([]BankAccount, len(accts))
	for i, a := range accts {
		coreAccts[i] = BankAccount{ID: a.ID, BankCode: a.BankCode, AccountNumber: a.AccountNumber}
	}
	coreSups := make([]Supplier, len(sups))
	for i, s := range sups {
		coreSups[i] = Supplier{ID: s.ID, Name: s.Name}
	}
	coreSettings := Settings{
		ThresholdGreen:        settings.ThresholdGreen,
		ThresholdYellow:       settings.ThresholdYellow,
		ThresholdOrange:       settings.ThresholdOrange,
		AmountTolerancePct:    settings.AmountTolerancePct,
		DateWindowBackDays:    settings.DateWindowBackDays,
		DateWindowForwardDays: settings.DateWindowForwardDays,
		EDCMDRMinPct:          settings.EDCMDRMinPct,
		EDCMDRMaxPct:          settings.EDCMDRMaxPct,
		FirstEligibleDate:     settings.FirstEligibleDate,
	}

	for i := range lines {
		l := &lines[i]

		// Legacy period guard
		if l.TxnDate.Before(coreSettings.FirstEligibleDate) {
			l.LineKind = KindLegacyPeriod
			l.Lane = LaneGray
			_ = p.UpdateLineLane(ctx, l.ID, string(LaneGray), "pre-cutoff", 0)
			continue
		}

		// Stage 1: classify
		l.LineKind = Classify(*l, coreAccts, coreSups)
		if l.LineKind != KindCustomerPayment {
			l.Lane = LaneGray
			_ = p.UpdateLineLane(ctx, l.ID, string(LaneGray), string(l.LineKind), 0)
			continue
		}

		// Stage 2-3: candidates + score + lane
		dbSlots, err := p.ListOpenSlotsForDate(ctx, l.TxnDate, coreSettings.DateWindowBackDays, coreSettings.DateWindowForwardDays)
		if err != nil {
			return matched, err
		}
		slots := make([]PayableSlot, len(dbSlots))
		for j, s := range dbSlots {
			slots[j] = PayableSlot{
				ID:             s.ID,
				OrderID:        s.OrderID,
				SlotType:       s.SlotType,
				ExpectedAmount: s.ExpectedAmount,
				CustomerName:   s.CustomerName,
				OrderCreatedAt: s.OrderCreatedAt,
				Status:         s.Status,
			}
		}
		eligible := EligibleSlots(*l, slots, coreSettings)
		cands := make([]Candidate, 0, len(eligible))
		for _, sl := range eligible {
			cands = append(cands, ScoreCandidate(*l, sl))
		}
		lane := AssignLane(cands, coreSettings)
		l.Lane = lane

		bestReason := ""
		var bestScore float64
		if len(cands) > 0 {
			// cands is sorted by AssignLane (best first)
			bestScore = cands[0].Score
			bestReason = cands[0].Breakdown
		}
		if lane == LaneGreen && len(cands) > 0 {
			if err := p.InsertAllocation(ctx, l.ID, cands[0].Slot.ID, l.Amount); err != nil {
				return matched, err
			}
			matched++
		}
		_ = p.UpdateLineLane(ctx, l.ID, string(lane), bestReason, bestScore)
	}
	return matched, nil
}
