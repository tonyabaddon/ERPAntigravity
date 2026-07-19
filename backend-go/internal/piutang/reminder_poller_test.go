package piutang

import (
	"testing"
)

func TestEligibleInvoicesQuery_MatchesExpectedSchema(t *testing.T) {
	q := eligibleInvoicesQuery()
	// Assert the query includes required filters (per spec Section 5.3)
	requiredFilters := []string{
		"ts.tier = 'premium'",
		"o.status = 'OPEN'",
		"o.payment_type IN ('tempo', 'kredit')",
		"c.wa_reminder_enabled = TRUE",
		"ts.piutang_wa_reminder_enabled",
		"o.due_date = CURRENT_DATE + INTERVAL '3 days'",
		"o.due_date = CURRENT_DATE - INTERVAL '3 days'",
	}
	for _, f := range requiredFilters {
		if !contains(q, f) {
			t.Errorf("expected filter %q in eligibility query", f)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
