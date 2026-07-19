package piutang

import (
	"testing"
)

func TestEligibleInvoicesQuery_MatchesExpectedSchema(t *testing.T) {
	q := eligibleInvoicesQuery()
	// Assert the query includes required filters using ACTUAL DB columns (verified 2026-07-19).
	// tenant_subscriptions: plan_code + grace_expires_at (no .tier, no .status).
	// orders: status='INVOICE_TEMPO' (not 'OPEN'), no .invoice_no, no .amount_due.
	// customers: wa_number (not .phone).
	requiredFilters := []string{
		"ts.plan_code = 'PREMIUM'",
		"ts.grace_expires_at >= CURRENT_DATE",
		"ts.piutang_wa_reminder_enabled",
		"o.status = 'INVOICE_TEMPO'",
		"o.payment_type IN ('tempo', 'kredit')",
		"c.wa_number",
		"c.wa_reminder_enabled = TRUE",
		"o.due_date = CURRENT_DATE + INTERVAL '3 days'",
		"o.due_date = CURRENT_DATE - INTERVAL '3 days'",
		"piutang_paid_amount",
	}
	for _, f := range requiredFilters {
		if !contains(q, f) {
			t.Errorf("expected filter/column %q in eligibility query", f)
		}
	}

	// Verify old non-existent columns are NOT present
	bannedColumns := []string{
		"ts.tier",
		"ts.status",
		"o.status = 'OPEN'",
		"c.phone",
		"o.invoice_no",
		"o.amount_due",
		"t.language",
	}
	for _, b := range bannedColumns {
		if contains(q, b) {
			t.Errorf("banned non-existent column/filter %q found in eligibility query", b)
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
