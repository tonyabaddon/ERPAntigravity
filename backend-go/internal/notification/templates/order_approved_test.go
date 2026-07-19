package templates

import (
	"context"
	"strings"
	"testing"
)

func TestOrderApproved_DefaultTemplate(t *testing.T) {
	msg, err := OrderApproved{}.Build(context.Background(), map[string]any{
		"customer_nama": "Bu Dewi",
		"toko_nama":     "Toko Sentosa",
		"invoice_no":    "EE778899",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Bu Dewi") {
		t.Errorf("expected customer_nama in output, got: %s", msg)
	}
	if !strings.Contains(msg, "EE778899") {
		t.Errorf("expected invoice_no in output, got: %s", msg)
	}
	if !strings.Contains(msg, "Toko Sentosa") {
		t.Errorf("expected toko_nama in output, got: %s", msg)
	}
}

func TestOrderApproved_CustomTemplate(t *testing.T) {
	tmpl := OrderApproved{CustomTemplate: "Order #{invoice_no} approved {customer_nama} — {toko_nama}"}
	msg, err := tmpl.Build(context.Background(), map[string]any{
		"customer_nama": "Doni",
		"toko_nama":     "Toko Abadi",
		"invoice_no":    "FF000001",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "Order #FF000001 approved Doni — Toko Abadi"
	if msg != want {
		t.Errorf("got %q, want %q", msg, want)
	}
}

func TestOrderApproved_MissingParam(t *testing.T) {
	_, err := OrderApproved{}.Build(context.Background(), map[string]any{
		"customer_nama": "Budi",
		// missing toko_nama, invoice_no
	})
	if err == nil {
		t.Fatal("expected error for missing required params, got nil")
	}
}

func TestOrderApproved_TemplateID(t *testing.T) {
	if got := (OrderApproved{}).TemplateID(); got != "order_approved" {
		t.Errorf("TemplateID() = %q, want %q", got, "order_approved")
	}
}
