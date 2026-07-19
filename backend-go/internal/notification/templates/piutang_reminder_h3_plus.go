package templates

import (
	"context"
	"fmt"
	"strings"
)

// PiutangReminderH3Plus renders the "3 days after due date" overdue reminder.
// CustomTemplate lets tenant-level config override the default — falls back to
// spec 5.5 default template if empty.
type PiutangReminderH3Plus struct {
	CustomTemplate string // From tenant_wa_reminder_config.template_h3_plus; empty = use default
}

// DefaultPiutangReminderH3PlusTemplate is the spec 5.5 H+3 default (Bahasa Indonesia).
// Uses simple {key} substitution — not Go template syntax — so tenants can edit freely.
const DefaultPiutangReminderH3PlusTemplate = "Halo {customer_nama}, invoice #{invoice_no} sebesar Rp {jumlah} sudah lewat jatuh tempo (H+{overdue_days}). Mohon segera dibayar ya. Kalau ada kendala bisa reply pesan ini — kami siap bantu. Terima kasih 🙏 — {toko_nama}"

// TemplateID returns the stable template identifier for versioning + logs.
func (PiutangReminderH3Plus) TemplateID() string { return "piutang_reminder_h3_plus" }

// RequiredParams returns the parameter keys Build expects.
func (PiutangReminderH3Plus) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no", "jumlah", "overdue_days"}
}

// Build renders the H+3 piutang overdue reminder with the provided params.
// If CustomTemplate is empty the DefaultPiutangReminderH3PlusTemplate is used.
// When using the default template, all RequiredParams must be present.
// When using a custom template, only params referenced as {key} in the template are required.
func (p PiutangReminderH3Plus) Build(_ context.Context, params map[string]any) (string, error) {
	usingDefault := p.CustomTemplate == ""
	tmpl := p.CustomTemplate
	if usingDefault {
		tmpl = DefaultPiutangReminderH3PlusTemplate
	}
	rendered := tmpl
	keys := (PiutangReminderH3Plus{}).RequiredParams()
	for _, k := range keys {
		placeholder := "{" + k + "}"
		if usingDefault || strings.Contains(tmpl, placeholder) {
			v, ok := params[k]
			if !ok {
				return "", fmt.Errorf("piutang_h3plus: missing required param %q", k)
			}
			rendered = strings.ReplaceAll(rendered, placeholder, fmt.Sprint(v))
		}
	}
	return rendered, nil
}
