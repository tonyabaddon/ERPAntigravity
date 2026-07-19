package templates

import (
	"context"
	"strings"
	"testing"
)

func TestPiutangOverdueSummary_DefaultTemplate(t *testing.T) {
	tmpl := PiutangOverdueSummary{}
	params := map[string]any{
		"tanggal":      "19 Jul 2026",
		"total_count":  5,
		"total_amount": "12.500.000",
		"top_list":     "• Toko A — Rp 3.000.000 — H+15",
	}
	msg, err := tmpl.Build(context.Background(), params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(msg, "19 Jul 2026") {
		t.Error("expected tanggal in rendered message")
	}
	if !strings.Contains(msg, "5") {
		t.Error("expected total_count in rendered message")
	}
	if !strings.Contains(msg, "12.500.000") {
		t.Error("expected total_amount in rendered message")
	}
	if !strings.Contains(msg, "Toko A") {
		t.Error("expected top_list in rendered message")
	}
}

func TestPiutangOverdueSummary_CustomTemplate(t *testing.T) {
	tmpl := PiutangOverdueSummary{CustomTemplate: "Overdue {total_count} — {tanggal} — {total_amount} — {top_list}"}
	params := map[string]any{
		"tanggal":      "19 Jul 2026",
		"total_count":  3,
		"total_amount": "5.000.000",
		"top_list":     "• B",
	}
	msg, err := tmpl.Build(context.Background(), params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if msg != "Overdue 3 — 19 Jul 2026 — 5.000.000 — • B" {
		t.Errorf("unexpected render: %q", msg)
	}
}

func TestPiutangOverdueSummary_MissingParam(t *testing.T) {
	tmpl := PiutangOverdueSummary{}
	_, err := tmpl.Build(context.Background(), map[string]any{
		"tanggal": "19 Jul 2026",
		// missing total_count, total_amount, top_list
	})
	if err == nil {
		t.Fatal("expected error for missing required params")
	}
}

func TestPiutangOverdueSummary_TemplateID(t *testing.T) {
	if got := (PiutangOverdueSummary{}).TemplateID(); got != "piutang_overdue_summary" {
		t.Errorf("TemplateID() = %q, want %q", got, "piutang_overdue_summary")
	}
}

func TestPiutangOverdueSummary_RequiredParams(t *testing.T) {
	params := (PiutangOverdueSummary{}).RequiredParams()
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
