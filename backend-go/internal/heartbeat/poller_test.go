package heartbeat

import (
	"testing"
	"time"
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

// Note: buildReport removed in Task 1.9 — migrated to templates.HeartbeatDigest.
// Message format coverage is in internal/notification/templates/heartbeat_digest_test.go.
