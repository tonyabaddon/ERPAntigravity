package engine

import (
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func TestBuildPromptGreeting(t *testing.T) {
	result := BuildPrompt(models.StateGreeting, "id", models.CollectedData{}, nil, "")
	if !strings.Contains(result, "GREETING") {
		t.Error("greeting prompt must name the current state")
	}
	if !strings.Contains(result, "detected_language") {
		t.Error("greeting prompt must include detected_language in JSON format")
	}
	if !strings.Contains(result, "JSON") {
		t.Error("greeting prompt must instruct JSON-only output")
	}
}

func TestBuildPromptCollectingIncludesCollectedData(t *testing.T) {
	data := models.CollectedData{Name: "Budi Santoso", Product: "Panel Besi 60x40x20"}
	result := BuildPrompt(models.StateCollecting, "id", data, nil, "")
	if !strings.Contains(result, "Budi Santoso") {
		t.Error("collecting prompt must include customer name in context")
	}
	if !strings.Contains(result, "Panel Besi 60x40x20") {
		t.Error("collecting prompt must include product name in context")
	}
	if !strings.Contains(result, "next_action") {
		t.Error("collecting prompt must specify next_action in JSON format")
	}
}

func TestBuildPromptCollectingListsMissingFields(t *testing.T) {
	data := models.CollectedData{Name: "Budi"} // company, address, product all missing
	result := BuildPrompt(models.StateCollecting, "id", data, nil, "")
	if !strings.Contains(result, "perusahaan") {
		t.Error("collecting prompt must mention missing company field in Indonesian")
	}
	if !strings.Contains(result, "alamat") {
		t.Error("collecting prompt must mention missing address field in Indonesian")
	}
}

func TestBuildPromptClarifyingIncludesProductAndSpecs(t *testing.T) {
	data := models.CollectedData{
		Product:  "MCB Schneider 16A",
		Quantity: 10,
		Specs:    models.SpecsData{Size: "1P"},
	}
	result := BuildPrompt(models.StateClarifying, "id", data, nil, "")
	if !strings.Contains(result, "MCB Schneider 16A") {
		t.Error("clarifying prompt must include product name in context")
	}
	if !strings.Contains(result, `"specs"`) {
		t.Error("clarifying prompt must include specs in JSON format")
	}
}

func TestBuildPromptStockCheckIncludesStockContext(t *testing.T) {
	data := models.CollectedData{Product: "MCB", Quantity: 5}
	stockCtx := StockContextString([]models.StockItem{
		{SKU: "MCB001", Name: "MCB Schneider 16A", Price: 45000, Stock: 20},
	})
	result := BuildPrompt(models.StateStockCheck, "id", data, nil, stockCtx)
	if !strings.Contains(result, "MCB001") {
		t.Error("stock_check prompt must include stock context data")
	}
	if !strings.Contains(result, "CONFIRM") {
		t.Error("stock_check prompt must mention CONFIRM as a valid next_action value")
	}
}

func TestBuildPromptConfirmingIncludesOrderSummaryAndBothBoolFields(t *testing.T) {
	data := models.CollectedData{
		Name: "Budi", Company: "CV Maju", Product: "MCB Schneider", Quantity: 5,
	}
	result := BuildPrompt(models.StateConfirming, "id", data, nil, "")
	if !strings.Contains(result, "Budi") {
		t.Error("confirming prompt must include customer name in order summary")
	}
	if !strings.Contains(result, "confirmed") {
		t.Error("confirming prompt must include confirmed bool field in JSON format")
	}
	if !strings.Contains(result, "modification_requested") {
		t.Error("confirming prompt must include modification_requested bool field in JSON format")
	}
}

func TestStockContextStringEmpty(t *testing.T) {
	result := StockContextString(nil)
	if result == "" {
		t.Error("empty stock list must return non-empty fallback message")
	}
	result2 := StockContextString([]models.StockItem{})
	if result2 == "" {
		t.Error("empty stock slice must return non-empty fallback message")
	}
}

func TestStockContextStringWithItems(t *testing.T) {
	items := []models.StockItem{
		{SKU: "MCB001", Name: "MCB Schneider 16A", Price: 45000, Stock: 20},
	}
	result := StockContextString(items)
	if !strings.Contains(result, "MCB001") {
		t.Error("must include SKU")
	}
	if !strings.Contains(result, "45000") {
		t.Error("must include price")
	}
	if !strings.Contains(result, "20") {
		t.Error("must include stock quantity")
	}
}

func TestOrBelum(t *testing.T) {
	if orBelum("") != "belum diketahui" {
		t.Errorf("empty string: got %q, want 'belum diketahui'", orBelum(""))
	}
	if orBelum("Budi") != "Budi" {
		t.Errorf("non-empty string: got %q, want 'Budi'", orBelum("Budi"))
	}
}

func TestMissingFieldsAllMissing(t *testing.T) {
	result := missingFields(models.CollectedData{})
	if !strings.Contains(result, "nama") {
		t.Error("must list nama as missing")
	}
	if !strings.Contains(result, "perusahaan") {
		t.Error("must list perusahaan as missing")
	}
}

func TestMissingFieldsNoneMissing(t *testing.T) {
	data := models.CollectedData{Name: "A", Company: "B", Address: "C", Product: "D"}
	result := missingFields(data)
	if strings.Contains(result, "nama") || strings.Contains(result, "perusahaan") {
		t.Error("must not list fields that are already filled")
	}
}
