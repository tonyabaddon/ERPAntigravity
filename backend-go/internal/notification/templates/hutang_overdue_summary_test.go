package templates

import (
	"context"
	"strings"
	"testing"
)

func TestHutangOverdueSummary_DefaultTemplate(t *testing.T) {
	tmpl := HutangOverdueSummary{}
	params := map[string]any{
		"tanggal":      "19 Jul 2026",
		"total_count":  3,
		"total_amount": "7.500.000",
		"top_list":     "• Supplier A — Rp 3.000.000 — 20 Jul",
	}
	msg, err := tmpl.Build(context.Background(), params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(msg, "19 Jul 2026") {
		t.Error("expected tanggal in rendered message")
	}
	if !strings.Contains(msg, "3") {
		t.Error("expected total_count in rendered message")
	}
	if !strings.Contains(msg, "7.500.000") {
		t.Error("expected total_amount in rendered message")
	}
	if !strings.Contains(msg, "Supplier A") {
		t.Error("expected top_list in rendered message")
	}
	// Verify default template content (spec 5.6)
	if !strings.Contains(msg, "Hutang Supplier") {
		t.Error("expected 'Hutang Supplier' in default template")
	}
}

func TestHutangOverdueSummary_CustomTemplate(t *testing.T) {
	tmpl := HutangOverdueSummary{CustomTemplate: "Hutang {total_count} — {tanggal} — {total_amount} — {top_list}"}
	params := map[string]any{
		"tanggal":      "19 Jul 2026",
		"total_count":  2,
		"total_amount": "5.000.000",
		"top_list":     "• B",
	}
	msg, err := tmpl.Build(context.Background(), params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if msg != "Hutang 2 — 19 Jul 2026 — 5.000.000 — • B" {
		t.Errorf("unexpected render: %q", msg)
	}
}

func TestHutangOverdueSummary_MissingParam(t *testing.T) {
	tmpl := HutangOverdueSummary{}
	_, err := tmpl.Build(context.Background(), map[string]any{
		"tanggal": "19 Jul 2026",
		// missing total_count, total_amount, top_list
	})
	if err == nil {
		t.Fatal("expected error for missing required params")
	}
}

func TestHutangOverdueSummary_TemplateID(t *testing.T) {
	if got := (HutangOverdueSummary{}).TemplateID(); got != "hutang_overdue_summary" {
		t.Errorf("TemplateID() = %q, want %q", got, "hutang_overdue_summary")
	}
}

func TestHutangOverdueSummary_RequiredParams(t *testing.T) {
	params := (HutangOverdueSummary{}).RequiredParams()
	expected := []string{"tanggal", "total_count", "total_amount", "top_list"}
	if len(params) != len(expected) {
		t.Fatalf("expected %d required params, got %d", len(expected), len(params))
	}
	for i, p := range expected {
		if params[i] != p {
			t.Errorf("expected param[%d]=%q, got %q", i, p, params[i])
		}
	}
}
