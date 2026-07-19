package templates

import "context"

// DPVerified renders the WA message sent to the customer when admin
// verifies their down-payment (DP) proof and requests the remaining balance.
//
// CustomTemplate lets tenant-level config override the default (Sprint 3+);
// falls back to DefaultDPVerifiedTemplate when empty.
type DPVerified struct {
	CustomTemplate string // from tenant_notification_templates; empty = use default
}

// DefaultDPVerifiedTemplate is the spec 5.4 dp_verified default (Bahasa Indonesia).
// Uses {key} substitution — not Go template syntax — so tenants can edit freely.
const DefaultDPVerifiedTemplate = "Halo {customer_nama} 👋, DP untuk invoice #{invoice_no} sudah kami terima.\n\nSisa: Rp {sisa_amount}\nDeadline pelunasan: {due_date}\n\nTerima kasih 🙏 — {toko_nama}"

// TemplateID returns the stable identifier used for logging and DB lookup.
func (DPVerified) TemplateID() string { return "dp_verified" }

// RequiredParams returns the keys that Build expects in params.
func (DPVerified) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no", "sisa_amount", "due_date"}
}

// Build renders the DP-verified message with the provided params.
// If CustomTemplate is empty, DefaultDPVerifiedTemplate is used.
func (d DPVerified) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := d.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultDPVerifiedTemplate
	}
	return renderSimple(tmpl, params, d.RequiredParams())
}
