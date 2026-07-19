package templates

import (
	"context"
	"strings"
	"testing"
)

func TestDPVerified_DefaultTemplate(t *testing.T) {
	msg, err := DPVerified{}.Build(context.Background(), map[string]any{
		"customer_nama": "Ibu Sari",
		"toko_nama":     "Toko Berkah",
		"invoice_no":    "AB12CD34",
		"sisa_amount":   "3.500.000",
		"due_date":      "2026-08-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Ibu Sari") {
		t.Errorf("expected customer_nama in output, got: %s", msg)
	}
	if !strings.Contains(msg, "AB12CD34") {
		t.Errorf("expected invoice_no in output, got: %s", msg)
	}
	if !strings.Contains(msg, "3.500.000") {
		t.Errorf("expected sisa_amount in output, got: %s", msg)
	}
	if !strings.Contains(msg, "2026-08-01") {
		t.Errorf("expected due_date in output, got: %s", msg)
	}
	if !strings.Contains(msg, "Toko Berkah") {
		t.Errorf("expected toko_nama in output, got: %s", msg)
	}
}

func TestDPVerified_CustomTemplate(t *testing.T) {
	tmpl := DPVerified{CustomTemplate: "DP #{invoice_no} ok {customer_nama}, sisa {sisa_amount} by {due_date} — {toko_nama}"}
	msg, err := tmpl.Build(context.Background(), map[string]any{
		"customer_nama": "Andi",
		"toko_nama":     "Toko Sejahtera",
		"invoice_no":    "ZZ9999",
		"sisa_amount":   "2000000",
		"due_date":      "2026-09-15",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "DP #ZZ9999 ok Andi, sisa 2000000 by 2026-09-15 — Toko Sejahtera"
	if msg != want {
		t.Errorf("got %q, want %q", msg, want)
	}
}

func TestDPVerified_MissingParam(t *testing.T) {
	_, err := DPVerified{}.Build(context.Background(), map[string]any{
		"customer_nama": "Budi",
		// missing toko_nama, invoice_no, sisa_amount, due_date
	})
	if err == nil {
		t.Fatal("expected error for missing required params, got nil")
	}
}

func TestDPVerified_TemplateID(t *testing.T) {
	if got := (DPVerified{}).TemplateID(); got != "dp_verified" {
		t.Errorf("TemplateID() = %q, want %q", got, "dp_verified")
	}
}
