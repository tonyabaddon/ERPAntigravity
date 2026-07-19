package templates

import (
	"context"
	"strings"
	"testing"
)

func TestPiutangReminderH3_RendersWithCustomTemplate(t *testing.T) {
	t3 := PiutangReminderH3{
		CustomTemplate: "Halo {customer_nama}, invoice {invoice_no} jatuh tempo {due_date} — Rp {jumlah} — {toko_nama}",
	}
	msg, err := t3.Build(context.Background(), map[string]any{
		"customer_nama": "Pak Budi",
		"toko_nama":     "Toko Jaya",
		"invoice_no":    "INV-001",
		"jumlah":        "4.200.000",
		"due_date":      "22 Jul 2026",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Pak Budi") || !strings.Contains(msg, "INV-001") {
		t.Errorf("expected substitution, got: %s", msg)
	}
}

func TestPiutangReminderH3Plus_IncludesOverdueDays(t *testing.T) {
	t3 := PiutangReminderH3Plus{CustomTemplate: "H+{overdue_days} lewat"}
	msg, err := t3.Build(context.Background(), map[string]any{"overdue_days": 3})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "H+3 lewat") {
		t.Errorf("expected overdue_days substituted, got: %s", msg)
	}
}

func TestPiutangReminderH3_DefaultTemplateContainsAllParams(t *testing.T) {
	t3 := PiutangReminderH3{} // empty CustomTemplate → use default
	msg, err := t3.Build(context.Background(), map[string]any{
		"customer_nama": "Bu Sari",
		"toko_nama":     "Toko Makmur",
		"invoice_no":    "INV-999",
		"jumlah":        "1.500.000",
		"due_date":      "25 Jul 2026",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Bu Sari", "Toko Makmur", "INV-999", "1.500.000", "25 Jul 2026"} {
		if !strings.Contains(msg, want) {
			t.Errorf("default template missing %q; got: %s", want, msg)
		}
	}
}

func TestPiutangReminderH3_ReturnsErrorOnMissingParam(t *testing.T) {
	t3 := PiutangReminderH3{}
	_, err := t3.Build(context.Background(), map[string]any{"customer_nama": "x"}) // missing others
	if err == nil {
		t.Fatal("expected error on missing required param")
	}
}

func TestPiutangReminderH3Plus_DefaultTemplateContainsAllParams(t *testing.T) {
	t3 := PiutangReminderH3Plus{} // empty CustomTemplate → use default
	msg, err := t3.Build(context.Background(), map[string]any{
		"customer_nama": "Pak Anton",
		"toko_nama":     "Toko Hebat",
		"invoice_no":    "INV-500",
		"jumlah":        "800.000",
		"overdue_days":  5,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Pak Anton", "Toko Hebat", "INV-500", "800.000", "5"} {
		if !strings.Contains(msg, want) {
			t.Errorf("default template missing %q; got: %s", want, msg)
		}
	}
}

func TestPiutangReminderH3Plus_ReturnsErrorOnMissingParam(t *testing.T) {
	t3 := PiutangReminderH3Plus{}
	_, err := t3.Build(context.Background(), map[string]any{"customer_nama": "x"}) // missing others
	if err == nil {
		t.Fatal("expected error on missing required param")
	}
}
