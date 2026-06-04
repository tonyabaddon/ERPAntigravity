package whatsapp

import (
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func TestBuildOrderItems_MultipleCart(t *testing.T) {
	cart := []models.CartItem{
		{Product: "Kabel 40A", Quantity: 2},
		{Product: "MCB 16A", Quantity: 1},
	}
	lookup := func(product string) ([]models.StockItem, error) {
		switch product {
		case "Kabel 40A":
			return []models.StockItem{{SKU: "kbl-1", Name: "Kabel 40A", Price: 100000}}, nil
		case "MCB 16A":
			return []models.StockItem{{SKU: "mcb-1", Name: "MCB 16A", Price: 50000}}, nil
		}
		return nil, nil
	}

	items, subtotal := buildOrderItems(cart, lookup)

	if len(items) != 2 {
		t.Fatalf("expected 2 order items, got %d", len(items))
	}
	if items[0].SKU != "kbl-1" {
		t.Errorf("expected first item SKU=kbl-1, got %s", items[0].SKU)
	}
	if items[0].Qty != 2 {
		t.Errorf("expected first item Qty=2, got %d", items[0].Qty)
	}
	expectedSubtotal := float64(100000*2 + 50000*1)
	if subtotal != expectedSubtotal {
		t.Errorf("expected subtotal=%.0f, got %.0f", expectedSubtotal, subtotal)
	}
}

func TestBuildOrderItems_FallbackSingleItem(t *testing.T) {
	cart := []models.CartItem{
		{Product: "Panel Besi", Quantity: 0},
	}
	lookup := func(product string) ([]models.StockItem, error) {
		return []models.StockItem{{SKU: "pnl-1", Name: "Panel Besi", Price: 850000}}, nil
	}

	items, subtotal := buildOrderItems(cart, lookup)

	if len(items) != 1 {
		t.Fatalf("expected 1 order item, got %d", len(items))
	}
	if items[0].Qty != 1 {
		t.Errorf("qty=0 should default to 1, got %d", items[0].Qty)
	}
	if subtotal != 850000 {
		t.Errorf("expected subtotal=850000, got %.0f", subtotal)
	}
}

func TestBuildOrderItems_MissingStock(t *testing.T) {
	cart := []models.CartItem{
		{Product: "Tidak Ada", Quantity: 1},
	}
	lookup := func(product string) ([]models.StockItem, error) {
		return nil, nil
	}

	items, subtotal := buildOrderItems(cart, lookup)

	if len(items) != 0 {
		t.Errorf("missing stock → expected 0 items, got %d", len(items))
	}
	if subtotal != 0 {
		t.Errorf("expected subtotal=0, got %.0f", subtotal)
	}
}
