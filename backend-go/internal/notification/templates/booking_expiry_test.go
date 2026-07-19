package templates

import (
	"context"
	"strings"
	"testing"
)

func TestBookingExpiry_RendersID(t *testing.T) {
	b := BookingExpiry{}
	msg, err := b.Build(context.Background(), map[string]any{
		"customer_nama": "Pak Budi",
		"toko_nama":     "Toko Jaya",
		"invoice_no":    "INV-001",
		"lang":          "id",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Pak Budi") || !strings.Contains(msg, "Toko Jaya") || !strings.Contains(msg, "INV-001") {
		t.Errorf("expected variables substituted, got: %s", msg)
	}
}

func TestBookingExpiry_ReturnsErrorOnMissingParam(t *testing.T) {
	b := BookingExpiry{}
	_, err := b.Build(context.Background(), map[string]any{"customer_nama": "x"}) // missing others
	if err == nil {
		t.Fatal("expected error on missing required param")
	}
}
