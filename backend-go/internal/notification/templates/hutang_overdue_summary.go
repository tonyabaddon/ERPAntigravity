package templates

import "context"

// HutangOverdueSummary renders the daily owner summary of supplier invoices
// due this week (CURRENT_DATE to CURRENT_DATE + 7 days). Sent once per day at
// 07:30 WIB via the hutang.OverdueSummaryPoller (Sprint 4 Task 4.2).
type HutangOverdueSummary struct {
	// CustomTemplate overrides the default if non-empty.
	// Uses {key} substitution — same convention as all other templates.
	CustomTemplate string
}

// DefaultHutangOverdueSummaryTemplate is the spec 5.6 default (Bahasa Indonesia).
const DefaultHutangOverdueSummaryTemplate = "💸 *Ringkasan Hutang Supplier — {tanggal}*\n\nTagihan jatuh tempo minggu ini: {total_count}\nTotal nilai: Rp {total_amount}\n\nTerdekat:\n{top_list}\n\nBuka Pembelian → Pembayaran untuk atur pembayaran."

// TemplateID returns the stable identifier used in logs and the template registry.
func (HutangOverdueSummary) TemplateID() string { return "hutang_overdue_summary" }

// RequiredParams returns the parameter keys Build expects.
func (HutangOverdueSummary) RequiredParams() []string {
	return []string{"tanggal", "total_count", "total_amount", "top_list"}
}

// Build renders the hutang overdue summary with the provided params.
// Falls back to DefaultHutangOverdueSummaryTemplate if CustomTemplate is empty.
func (h HutangOverdueSummary) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := h.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultHutangOverdueSummaryTemplate
	}
	return renderSimple(tmpl, params, h.RequiredParams())
}
