package templates

import "context"

// OrderShipped renders the "order completed/fulfilled" WA message sent when
// an order transitions to COMPLETED status.
//
// NOTE on naming: the channel and TemplateID are "order_shipped" per the Sprint 3
// interface spec. In this DB the trigger fires on COMPLETED (no SHIPPED status
// exists as of 2026-07-19). Template copy says "selesai diproses" (honest) rather
// than "sudah kami kirim". Founder can add a SHIPPED status and remap later.
//
// CustomTemplate lets tenant-level config override the default (Sprint 3+);
// falls back to DefaultOrderShippedTemplate when empty.
type OrderShipped struct {
	CustomTemplate string // from tenant_notification_templates; empty = use default
}

// DefaultOrderShippedTemplate is the spec 5.4 order_shipped default (Bahasa Indonesia).
// Uses {key} substitution — not Go template syntax — so tenants can edit freely.
const DefaultOrderShippedTemplate = "Halo {customer_nama} 📦, pesanan #{invoice_no} Anda sudah selesai kami proses!\n\nMohon dicek ya. Kalau ada pertanyaan balas pesan ini. Terima kasih 🙏 — {toko_nama}"

// TemplateID returns the stable identifier used for logging and DB lookup.
func (OrderShipped) TemplateID() string { return "order_shipped" }

// RequiredParams returns the keys that Build expects in params.
func (OrderShipped) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no"}
}

// Build renders the order-shipped confirmation message with the provided params.
// If CustomTemplate is empty, DefaultOrderShippedTemplate is used.
func (o OrderShipped) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := o.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultOrderShippedTemplate
	}
	return renderSimple(tmpl, params, o.RequiredParams())
}
