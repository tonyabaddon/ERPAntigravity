package templates

import (
	"context"
	"strings"
	"testing"
)

func TestPaymentRejected_DefaultTemplate(t *testing.T) {
	msg, err := PaymentRejected{}.Build(context.Background(), map[string]any{
		"customer_nama": "Pak Hendra",
		"toko_nama":     "Toko Makmur",
		"invoice_no":    "CC445566",
		"reason":        "Foto bukti tidak terbaca",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Pak Hendra") {
		t.Errorf("expected customer_nama in output, got: %s", msg)
	}
	if !strings.Contains(msg, "CC445566") {
		t.Errorf("expected invoice_no in output, got: %s", msg)
	}
	if !strings.Contains(msg, "Foto bukti tidak terbaca") {
		t.Errorf("expected reason in output, got: %s", msg)
	}
	if !strings.Contains(msg, "Toko Makmur") {
		t.Errorf("expected toko_nama in output, got: %s", msg)
	}
}

func TestPaymentRejected_CustomTemplate(t *testing.T) {
	tmpl := PaymentRejected{CustomTemplate: "#{invoice_no} ditolak {customer_nama}: {reason}. — {toko_nama}"}
	msg, err := tmpl.Build(context.Background(), map[string]any{
		"customer_nama": "Rini",
		"toko_nama":     "Toko XYZ",
		"invoice_no":    "DD123456",
		"reason":        "Nominal tidak sesuai",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "#DD123456 ditolak Rini: Nominal tidak sesuai. — Toko XYZ"
	if msg != want {
		t.Errorf("got %q, want %q", msg, want)
	}
}

func TestPaymentRejected_MissingParam(t *testing.T) {
	_, err := PaymentRejected{}.Build(context.Background(), map[string]any{
		"customer_nama": "Budi",
		// missing toko_nama, invoice_no, reason
	})
	if err == nil {
		t.Fatal("expected error for missing required params, got nil")
	}
}

func TestPaymentRejected_TemplateID(t *testing.T) {
	if got := (PaymentRejected{}).TemplateID(); got != "payment_rejected" {
		t.Errorf("TemplateID() = %q, want %q", got, "payment_rejected")
	}
}
