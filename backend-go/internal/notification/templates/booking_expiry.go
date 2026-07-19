// Package templates contains reusable WA message template renderers.
// Each template is a stateless struct with a Build method that renders a
// parameterised string from a map of named values.
package templates

import (
	"context"
	"fmt"
)

// BookingExpiry renders the booking-timeout reminder message.
// Extracted from main.go inline closure (Sprint 1 B2 fix).
// The B2 bug: the inline closure called SendText directly, skipping
// InsertMessage — no audit trail. Routing through NotifyCustomer fixes it.
type BookingExpiry struct{}

// TemplateID returns the stable template identifier for versioning + logs.
func (BookingExpiry) TemplateID() string { return "booking_expiry" }

// RequiredParams returns the parameter keys Build expects.
func (BookingExpiry) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no"}
}

// Build renders the booking-expiry reminder with the provided params.
// Only id (Bahasa Indonesia) is supported per spec Section 3 non-goal.
// Required params: customer_nama, toko_nama, invoice_no.
func (b BookingExpiry) Build(_ context.Context, params map[string]any) (string, error) {
	for _, k := range b.RequiredParams() {
		if _, ok := params[k]; !ok {
			return "", fmt.Errorf("booking_expiry: missing required param %q", k)
		}
	}
	return fmt.Sprintf(
		"Halo %s 👋,\n\nPesanan #%s di %s akan expired dalam 24 jam ke depan. "+
			"Kalau mau lanjut pembayaran, silakan chat kami. "+
			"Kalau tidak, pesanan akan dibatalkan otomatis.\n\nTerima kasih 🙏",
		params["customer_nama"], params["invoice_no"], params["toko_nama"],
	), nil
}
