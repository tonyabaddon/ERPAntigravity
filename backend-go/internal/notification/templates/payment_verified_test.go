package templates

import (
	"context"
	"strings"
	"testing"
)

func TestPaymentVerified_DefaultTemplate(t *testing.T) {
	msg, err := PaymentVerified{}.Build(context.Background(), map[string]any{
		"customer_nama": "Pak Budi",
		"toko_nama":     "Toko Jaya",
		"invoice_no":    "INV-001",
		"amount":        "4.200.000",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "INV-001") {
		t.Errorf("expected invoice_no in output, got: %s", msg)
	}
	if !strings.Contains(msg, "Pak Budi") {
		t.Errorf("expected customer_nama in output, got: %s", msg)
	}
	if !strings.Contains(msg, "Toko Jaya") {
		t.Errorf("expected toko_nama in output, got: %s", msg)
	}
	if !strings.Contains(msg, "4.200.000") {
		t.Errorf("expected amount in output, got: %s", msg)
	}
}

func TestPaymentVerified_CustomTemplate(t *testing.T) {
	tmpl := PaymentVerified{CustomTemplate: "Bayar #{invoice_no} verified untuk {customer_nama} — {toko_nama}. Rp {amount}"}
	msg, err := tmpl.Build(context.Background(), map[string]any{
		"customer_nama": "Siti",
		"toko_nama":     "Toko Maju",
		"invoice_no":    "XY1234",
		"amount":        "1000000",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "Bayar #XY1234 verified untuk Siti — Toko Maju. Rp 1000000"
	if msg != want {
		t.Errorf("got %q, want %q", msg, want)
	}
}

func TestPaymentVerified_MissingParam(t *testing.T) {
	_, err := PaymentVerified{}.Build(context.Background(), map[string]any{
		"customer_nama": "Budi",
		// missing toko_nama, invoice_no, amount
	})
	if err == nil {
		t.Fatal("expected error for missing required params, got nil")
	}
}

func TestPaymentVerified_TemplateID(t *testing.T) {
	if got := (PaymentVerified{}).TemplateID(); got != "payment_verified" {
		t.Errorf("TemplateID() = %q, want %q", got, "payment_verified")
	}
}
