package templates

import (
	"context"
	"strings"
	"testing"
)

func TestHeartbeatDigest_IncludesAllSections(t *testing.T) {
	h := HeartbeatDigest{}
	msg, err := h.Build(context.Background(), map[string]any{
		"tanggal":         "19 Jul 2026",
		"omset_hari":      5000000,
		"laba_hari":       1250000,
		"low_stock_count": 3,
		"low_stock_items": []string{"Kabel NYA", "MCB 10A", "Stop Kontak"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Rp 5.000.000") || !strings.Contains(msg, "Kabel NYA") {
		t.Errorf("expected sections rendered, got: %s", msg)
	}
}

func TestHeartbeatDigest_NoLowStockItems(t *testing.T) {
	h := HeartbeatDigest{}
	msg, err := h.Build(context.Background(), map[string]any{
		"tanggal":         "19 Jul 2026",
		"omset_hari":      int64(10_000_000),
		"laba_hari":       int64(3_500_000),
		"low_stock_count": 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Rp 10.000.000") {
		t.Errorf("expected omset rendered, got: %s", msg)
	}
	if !strings.Contains(msg, "Rp 3.500.000") {
		t.Errorf("expected laba rendered, got: %s", msg)
	}
	// No low_stock_items passed — stok section should be absent.
	if strings.Contains(msg, "Stok Menipis") {
		t.Errorf("expected no low-stock section when items absent, got: %s", msg)
	}
}

func TestHeartbeatDigest_MissingRequiredParam(t *testing.T) {
	h := HeartbeatDigest{}
	_, err := h.Build(context.Background(), map[string]any{
		"tanggal": "19 Jul 2026",
		// missing omset_hari, laba_hari, low_stock_count
	})
	if err == nil {
		t.Fatal("expected error on missing required params")
	}
}

func TestHeartbeatDigest_FormatRp_Float64(t *testing.T) {
	h := HeartbeatDigest{}
	msg, err := h.Build(context.Background(), map[string]any{
		"tanggal":         "19 Jul 2026",
		"omset_hari":      float64(7_500_000),
		"laba_hari":       float64(2_000_000),
		"low_stock_count": 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Rp 7.500.000") {
		t.Errorf("expected float64 formatted, got: %s", msg)
	}
}

func TestFormatRp(t *testing.T) {
	cases := []struct {
		input any
		want  string
	}{
		{5000000, "5.000.000"},
		{int64(1250000), "1.250.000"},
		{float64(10000000), "10.000.000"},
		{0, "0"},
		{999, "999"},
		{1000, "1.000"},
	}
	for _, tc := range cases {
		got := formatRp(tc.input)
		if got != tc.want {
			t.Errorf("formatRp(%v) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
