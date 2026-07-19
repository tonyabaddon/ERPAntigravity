package templates

import "context"

// OrderApproved renders the WA message sent to the customer when admin
// approves their order and it moves to the booking/confirmed state.
//
// CustomTemplate lets tenant-level config override the default (Sprint 3+);
// falls back to DefaultOrderApprovedTemplate when empty.
type OrderApproved struct {
	CustomTemplate string // from tenant_notification_templates; empty = use default
}

// DefaultOrderApprovedTemplate is the spec 5.4 order_approved default (Bahasa Indonesia).
// Uses {key} substitution — not Go template syntax — so tenants can edit freely.
const DefaultOrderApprovedTemplate = "Halo {customer_nama} 👋, order kamu #{invoice_no} sudah kami approve!\n\nKami akan proses secepatnya. Terima kasih 🙏 — {toko_nama}"

// TemplateID returns the stable identifier used for logging and DB lookup.
func (OrderApproved) TemplateID() string { return "order_approved" }

// RequiredParams returns the keys that Build expects in params.
func (OrderApproved) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no"}
}

// Build renders the order-approved message with the provided params.
// If CustomTemplate is empty, DefaultOrderApprovedTemplate is used.
func (o OrderApproved) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := o.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultOrderApprovedTemplate
	}
	return renderSimple(tmpl, params, o.RequiredParams())
}
