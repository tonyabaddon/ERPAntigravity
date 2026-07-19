package templates

import "context"

// OrderCreated renders the order-confirmation WA message sent to the customer
// immediately after an order INSERT.
// CustomTemplate lets tenant-level config override the default (Sprint 3+);
// falls back to DefaultOrderCreatedTemplate when empty.
type OrderCreated struct {
	CustomTemplate string // from tenant_notification_templates; empty = use default
}

// DefaultOrderCreatedTemplate is the spec 5.4 order_created default (Bahasa Indonesia).
// Uses {key} substitution — not Go template syntax — so tenants can edit freely.
const DefaultOrderCreatedTemplate = "Halo {customer_nama} 👋, terima kasih sudah order di {toko_nama}!\n\nInvoice: #{invoice_no}\nTotal: Rp {amount}\n\nKami akan segera proses pesanan Anda. Terima kasih 🙏"

// TemplateID returns the stable identifier used for logging and DB lookup.
func (OrderCreated) TemplateID() string { return "order_created" }

// RequiredParams returns the keys that Build expects in params.
func (OrderCreated) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no", "amount"}
}

// Build renders the order-created confirmation message with the provided params.
// If CustomTemplate is empty, DefaultOrderCreatedTemplate is used.
func (o OrderCreated) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := o.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultOrderCreatedTemplate
	}
	return renderSimple(tmpl, params, o.RequiredParams())
}
