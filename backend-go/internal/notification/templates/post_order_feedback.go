package templates

import "context"

// PostOrderFeedback renders the post-delivery feedback request message sent
// to customers 7 days after their order reaches COMPLETED status.
// Sprint 4 Task 4.4. Params: customer_nama, toko_nama.
type PostOrderFeedback struct {
	// CustomTemplate overrides the default if non-empty.
	// Uses {key} substitution — same convention as all other templates.
	CustomTemplate string
}

// DefaultPostOrderFeedbackTemplate is the Bahasa Indonesia default.
const DefaultPostOrderFeedbackTemplate = "Halo {customer_nama} 👋, terima kasih sudah order di {toko_nama}!\n\nKami mau tanya sedikit — bagaimana pengalaman belanjanya?\n\nBalas dengan angka 1-5 (5 = sangat puas) + komentar opsional.\nContoh: *5 pengiriman cepat, barang sesuai!*\n\nKalau ada masalah, langsung kabari kami, siap bantu. Terima kasih! 🙏"

// TemplateID returns the stable identifier used in logs and the template registry.
func (PostOrderFeedback) TemplateID() string { return "post_order_feedback" }

// RequiredParams returns the parameter keys Build expects.
func (PostOrderFeedback) RequiredParams() []string { return []string{"customer_nama", "toko_nama"} }

// Build renders the feedback request with the provided params.
// Falls back to DefaultPostOrderFeedbackTemplate if CustomTemplate is empty.
func (p PostOrderFeedback) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := p.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultPostOrderFeedbackTemplate
	}
	return renderSimple(tmpl, params, p.RequiredParams())
}
