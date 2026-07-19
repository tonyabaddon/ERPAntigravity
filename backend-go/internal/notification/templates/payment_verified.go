package templates

import "context"

// PaymentVerified renders the WA message sent to the customer when admin
// verifies their full payment.
//
// CustomTemplate lets tenant-level config override the default (Sprint 3+);
// falls back to DefaultPaymentVerifiedTemplate when empty.
type PaymentVerified struct {
	CustomTemplate string // from tenant_notification_templates; empty = use default
}

// DefaultPaymentVerifiedTemplate is the spec 5.4 payment_verified default (Bahasa Indonesia).
// Uses {key} substitution — not Go template syntax — so tenants can edit freely.
const DefaultPaymentVerifiedTemplate = "Halo {customer_nama} 👋, pembayaran untuk invoice #{invoice_no} sudah kami terima dan verifikasi.\n\nJumlah: Rp {amount}\n\nTerima kasih! Pesanan akan segera diproses 🙏 — {toko_nama}"

// TemplateID returns the stable identifier used for logging and DB lookup.
func (PaymentVerified) TemplateID() string { return "payment_verified" }

// RequiredParams returns the keys that Build expects in params.
func (PaymentVerified) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no", "amount"}
}

// Build renders the payment-verified confirmation message with the provided params.
// If CustomTemplate is empty, DefaultPaymentVerifiedTemplate is used.
func (p PaymentVerified) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := p.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultPaymentVerifiedTemplate
	}
	return renderSimple(tmpl, params, p.RequiredParams())
}
