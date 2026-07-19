package templates

import "context"

// ApprovalSlaBreach renders the critical alert sent when one or more approval
// requests have been pending for more than 2 hours without a response.
// Sent every 15 minutes by the approvals.SLABreachPoller until the owner
// responds (dedup via sla_breach_notified_at column). Sprint 4 Task 4.3.
type ApprovalSlaBreach struct {
	// CustomTemplate overrides the default if non-empty.
	// Uses {key} substitution — same convention as all other templates.
	CustomTemplate string
}

// DefaultApprovalSlaBreachTemplate is the spec 5.7 default (Bahasa Indonesia).
const DefaultApprovalSlaBreachTemplate = "⚠️ *Approval Pending SLA Breach*\n\n{total_count} approval sudah pending > 2 jam belum di-respond:\n\n{top_list}\n\nBuka Approval Inbox di app.caleo.id untuk respond."

// TemplateID returns the stable identifier used in logs and the template registry.
func (ApprovalSlaBreach) TemplateID() string { return "approval_sla_breach" }

// RequiredParams returns the parameter keys Build expects.
func (ApprovalSlaBreach) RequiredParams() []string { return []string{"total_count", "top_list"} }

// Build renders the SLA breach alert with the provided params.
// Falls back to DefaultApprovalSlaBreachTemplate if CustomTemplate is empty.
func (a ApprovalSlaBreach) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := a.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultApprovalSlaBreachTemplate
	}
	return renderSimple(tmpl, params, a.RequiredParams())
}
