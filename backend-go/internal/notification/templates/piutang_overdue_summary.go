package templates

import "context"

// PiutangOverdueSummary renders the daily owner summary of all overdue piutang
// invoices across the tenant. Sent once per day at 08:00 WIB via the
// OverdueSummaryPoller (Sprint 4 Task 4.1).
type PiutangOverdueSummary struct {
	// CustomTemplate overrides the default if non-empty.
	// Uses {key} substitution — same convention as all other templates.
	CustomTemplate string
}

// DefaultPiutangOverdueSummaryTemplate is the spec 5.5 default (Bahasa Indonesia).
const DefaultPiutangOverdueSummaryTemplate = "📊 *Ringkasan Piutang — {tanggal}*\n\nTotal invoice overdue: {total_count}\nTotal nilai: Rp {total_amount}\n\nTerlama:\n{top_list}\n\nSemua akan dapat H+3 auto WA reminder (jam 09:00). Yang H+30+ mungkin butuh follow-up personal."

// TemplateID returns the stable identifier used in logs and the template registry.
func (PiutangOverdueSummary) TemplateID() string { return "piutang_overdue_summary" }

// RequiredParams returns the parameter keys Build expects.
func (PiutangOverdueSummary) RequiredParams() []string {
	return []string{"tanggal", "total_count", "total_amount", "top_list"}
}

// Build renders the overdue summary with the provided params.
// Falls back to DefaultPiutangOverdueSummaryTemplate if CustomTemplate is empty.
func (p PiutangOverdueSummary) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := p.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultPiutangOverdueSummaryTemplate
	}
	return renderSimple(tmpl, params, p.RequiredParams())
}
