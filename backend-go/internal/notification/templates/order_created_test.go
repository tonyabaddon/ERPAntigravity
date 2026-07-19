package templates

import (
	"context"
	"strings"
	"testing"
)

func TestOrderCreated_DefaultTemplate(t *testing.T) {
	tmpl := OrderCreated{}
	msg, err := tmpl.Build(context.Background(), map[string]any{
		"customer_nama": "Budi Santoso",
		"toko_nama":     "Toko Jaya Makmur",
		"invoice_no":    "ABC12345",
		"amount":        "1500000",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(msg, "Budi Santoso") {
		t.Errorf("expected customer_nama in output, got: %s", msg)
	}
	if !strings.Contains(msg, "Toko Jaya Makmur") {
		t.Errorf("expected toko_nama in output, got: %s", msg)
	}
	if !strings.Contains(msg, "ABC12345") {
		t.Errorf("expected invoice_no in output, got: %s", msg)
	}
	if !strings.Contains(msg, "1500000") {
		t.Errorf("expected amount in output, got: %s", msg)
	}
}

func TestOrderCreated_CustomTemplate(t *testing.T) {
	tmpl := OrderCreated{CustomTemplate: "Order #{invoice_no} dari {toko_nama} untuk {customer_nama}. Total: {amount}"}
	msg, err := tmpl.Build(context.Background(), map[string]any{
		"customer_nama": "Siti",
		"toko_nama":     "Toko ABC",
		"invoice_no":    "XY9999",
		"amount":        "250000",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "Order #XY9999 dari Toko ABC untuk Siti. Total: 250000"
	if msg != want {
		t.Errorf("got %q, want %q", msg, want)
	}
}

func TestOrderCreated_MissingRequiredParam(t *testing.T) {
	tmpl := OrderCreated{}
	_, err := tmpl.Build(context.Background(), map[string]any{
		"customer_nama": "Budi",
		// missing toko_nama, invoice_no, amount
	})
	if err == nil {
		t.Fatal("expected error for missing required params, got nil")
	}
}

func TestOrderCreated_TemplateID(t *testing.T) {
	if got := (OrderCreated{}).TemplateID(); got != "order_created" {
		t.Errorf("TemplateID() = %q, want %q", got, "order_created")
	}
}

func TestOrderShipped_DefaultTemplate(t *testing.T) {
	tmpl := OrderShipped{}
	msg, err := tmpl.Build(context.Background(), map[string]any{
		"customer_nama": "Ani Rahayu",
		"toko_nama":     "Toko Maju",
		"invoice_no":    "DEF67890",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(msg, "Ani Rahayu") {
		t.Errorf("expected customer_nama in output, got: %s", msg)
	}
	if !strings.Contains(msg, "DEF67890") {
		t.Errorf("expected invoice_no in output, got: %s", msg)
	}
	if !strings.Contains(msg, "Toko Maju") {
		t.Errorf("expected toko_nama in output, got: %s", msg)
	}
}

func TestOrderShipped_MissingRequiredParam(t *testing.T) {
	tmpl := OrderShipped{}
	_, err := tmpl.Build(context.Background(), map[string]any{
		"customer_nama": "Ani",
		// missing toko_nama and invoice_no
	})
	if err == nil {
		t.Fatal("expected error for missing required params, got nil")
	}
}

func TestOrderShipped_TemplateID(t *testing.T) {
	if got := (OrderShipped{}).TemplateID(); got != "order_shipped" {
		t.Errorf("TemplateID() = %q, want %q", got, "order_shipped")
	}
}
