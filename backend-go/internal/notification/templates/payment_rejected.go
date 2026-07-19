package templates

import "context"

// PaymentRejected renders the WA message sent to the customer when admin
// rejects their payment proof and asks them to resend.
//
// CustomTemplate lets tenant-level config override the default (Sprint 3+);
// falls back to DefaultPaymentRejectedTemplate when empty.
type PaymentRejected struct {
	CustomTemplate string // from tenant_notification_templates; empty = use default
}

// DefaultPaymentRejectedTemplate is the spec 5.4 payment_rejected default (Bahasa Indonesia).
// Uses {key} substitution — not Go template syntax — so tenants can edit freely.
const DefaultPaymentRejectedTemplate = "Halo {customer_nama}, mohon maaf pembayaran untuk invoice #{invoice_no} belum bisa kami verifikasi.\n\nAlasan: {reason}\n\nSilakan cek dan kirim ulang bukti transfer. Terima kasih 🙏 — {toko_nama}"

// TemplateID returns the stable identifier used for logging and DB lookup.
func (PaymentRejected) TemplateID() string { return "payment_rejected" }

// RequiredParams returns the keys that Build expects in params.
func (PaymentRejected) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no", "reason"}
}

// Build renders the payment-rejected message with the provided params.
// If CustomTemplate is empty, DefaultPaymentRejectedTemplate is used.
func (p PaymentRejected) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := p.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultPaymentRejectedTemplate
	}
	return renderSimple(tmpl, params, p.RequiredParams())
}
