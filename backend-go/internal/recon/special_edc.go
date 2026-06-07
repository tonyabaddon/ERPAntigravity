// backend-go/internal/recon/special_edc.go
package recon

type EDCMatch struct {
	Valid   bool
	Gross   float64
	Net     float64
	MDR     float64
	MDRRate float64
}

func MatchEDCSettlement(line BankLine, grossSum float64, s Settings) EDCMatch {
	if grossSum <= 0 {
		return EDCMatch{}
	}
	mdr := grossSum - line.Amount
	rate := mdr / grossSum
	if rate < s.EDCMDRMinPct || rate > s.EDCMDRMaxPct {
		return EDCMatch{Gross: grossSum, Net: line.Amount, MDR: mdr, MDRRate: rate, Valid: false}
	}
	return EDCMatch{Valid: true, Gross: grossSum, Net: line.Amount, MDR: mdr, MDRRate: rate}
}
