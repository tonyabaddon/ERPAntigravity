package heartbeat

import (
	"strings"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/models"
)

func TestParseInterval(t *testing.T) {
	cases := []struct {
		label string
		want  time.Duration
	}{
		{"Setiap 4 Jam", 4 * time.Hour},
		{"Setiap 4 jam", 4 * time.Hour},
		{"setiap 4 jam", 4 * time.Hour},
		{"Setiap 8 Jam", 8 * time.Hour},
		{"Setiap 12 Jam", 12 * time.Hour},
		{"Harian", 24 * time.Hour},
		{"harian", 24 * time.Hour},
		{"unknown label", 8 * time.Hour},
		{"", 8 * time.Hour},
	}
	for _, tc := range cases {
		got := parseInterval(tc.label)
		if got != tc.want {
			t.Errorf("parseInterval(%q) = %v, want %v", tc.label, got, tc.want)
		}
	}
}

func TestIsWIBBusinessHours(t *testing.T) {
	wib := time.FixedZone("WIB", 7*3600)
	t0700 := time.Date(2026, 6, 5, 7, 0, 0, 0, wib)
	if !isWIBBusinessHours(t0700) {
		t.Error("07:00 WIB should be business hours")
	}
	t2159 := time.Date(2026, 6, 5, 21, 59, 0, 0, wib)
	if !isWIBBusinessHours(t2159) {
		t.Error("21:59 WIB should be business hours")
	}
	t2200 := time.Date(2026, 6, 5, 22, 0, 0, 0, wib)
	if isWIBBusinessHours(t2200) {
		t.Error("22:00 WIB should not be business hours")
	}
	t0659 := time.Date(2026, 6, 5, 6, 59, 0, 0, wib)
	if isWIBBusinessHours(t0659) {
		t.Error("06:59 WIB should not be business hours")
	}
}

func TestBuildReport_WithLowStock(t *testing.T) {
	cfg := &db.HeartbeatConfig{ReportRevenue: true, ReportStatus: true, LowStockAlert: 5}
	items := []models.StockItem{
		{SKU: "SKU-001", Name: "Kabel NYM", Stock: 3},
		{SKU: "SKU-002", Name: "MCB 16A", Stock: 1},
	}
	msg := buildReport(cfg, 15_000_000, 8_000_000, items)

	if !strings.Contains(msg, "Rp 15.000.000") {
		t.Errorf("expected omset in message, got: %s", msg)
	}
	if !strings.Contains(msg, "Rp 7.000.000") {
		t.Errorf("expected laba bersih (15M-8M=7M) in message, got: %s", msg)
	}
	if !strings.Contains(msg, "Kabel NYM") {
		t.Errorf("expected low stock item in message, got: %s", msg)
	}
	if !strings.Contains(msg, "MCB 16A") {
		t.Errorf("expected low stock item in message, got: %s", msg)
	}
	if strings.Contains(msg, "Semua stok aman") {
		t.Error("should not show 'aman' when there are low stock items")
	}
}

func TestBuildReport_NoLowStock(t *testing.T) {
	cfg := &db.HeartbeatConfig{ReportRevenue: true, ReportStatus: true, LowStockAlert: 5}
	msg := buildReport(cfg, 5_000_000, 3_000_000, nil)

	if !strings.Contains(msg, "Semua stok aman") {
		t.Errorf("expected 'Semua stok aman' when no low stock, got: %s", msg)
	}
}
