package templates

import (
	"context"
	"fmt"
	"strings"
)

// PiutangReminderH3 renders the "3 days before due date" reminder message.
// CustomTemplate lets tenant-level config override the default — falls back to
// spec 5.5 default template if empty.
type PiutangReminderH3 struct {
	CustomTemplate string // From tenant_wa_reminder_config.template_h3; empty = use default
}

// DefaultPiutangReminderH3Template is the spec 5.5 H-3 default (Bahasa Indonesia).
// Uses simple {key} substitution — not Go template syntax — so tenants can edit freely.
const DefaultPiutangReminderH3Template = "Halo {customer_nama} 👋, ini reminder ramah dari {toko_nama}. Invoice #{invoice_no} sebesar Rp {jumlah} akan jatuh tempo pada {due_date} (3 hari lagi). Kalau sudah dibayar mohon abaikan pesan ini. Terima kasih 🙏"

// TemplateID returns the stable template identifier for versioning + logs.
func (PiutangReminderH3) TemplateID() string { return "piutang_reminder_h3" }

// RequiredParams returns the parameter keys Build expects.
func (PiutangReminderH3) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no", "jumlah", "due_date"}
}

// Build renders the H-3 piutang reminder with the provided params.
// If CustomTemplate is empty the DefaultPiutangReminderH3Template is used.
// When using the default template, all RequiredParams must be present.
// When using a custom template, only params referenced as {key} in the template are required.
func (p PiutangReminderH3) Build(_ context.Context, params map[string]any) (string, error) {
	usingDefault := p.CustomTemplate == ""
	tmpl := p.CustomTemplate
	if usingDefault {
		tmpl = DefaultPiutangReminderH3Template
	}
	rendered := tmpl
	keys := (PiutangReminderH3{}).RequiredParams()
	for _, k := range keys {
		placeholder := "{" + k + "}"
		if usingDefault || strings.Contains(tmpl, placeholder) {
			v, ok := params[k]
			if !ok {
				return "", fmt.Errorf("piutang_h3: missing required param %q", k)
			}
			rendered = strings.ReplaceAll(rendered, placeholder, fmt.Sprint(v))
		}
	}
	return rendered, nil
}
