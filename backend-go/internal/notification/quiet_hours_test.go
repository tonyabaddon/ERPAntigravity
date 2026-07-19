// backend-go/internal/notification/quiet_hours_test.go
package notification

import (
	"testing"
	"time"
)

func TestIsInQuietHours_WrappingWindow(t *testing.T) {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	// Quiet window 22:00–07:00 (crosses midnight)
	tests := []struct {
		hour, min int
		want      bool
		label     string
	}{
		{23, 0, true, "23:00 is inside evening side"},
		{3, 0, true, "03:00 is inside morning side"},
		{6, 30, true, "06:30 is inside morning side (before 07:00)"},
		{7, 0, false, "07:00 is the boundary — NOT quiet (half-open end)"},
		{9, 0, false, "09:00 is daytime, outside window"},
		{21, 59, false, "21:59 is just before window starts"},
		{22, 0, true, "22:00 is window start (inclusive)"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.label, func(t *testing.T) {
			ts := time.Date(2026, 7, 19, tt.hour, tt.min, 0, 0, tz)
			got := isInQuietHours(ts, "22:00", "07:00")
			if got != tt.want {
				t.Errorf("isInQuietHours(%02d:%02d) = %v; want %v", tt.hour, tt.min, got, tt.want)
			}
		})
	}
}

func TestIsInQuietHours_NonWrappingWindow(t *testing.T) {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	// Non-crossing window 09:00–17:00 (normal daytime)
	tests := []struct {
		hour, min int
		want      bool
		label     string
	}{
		{8, 59, false, "just before start"},
		{9, 0, true, "window start (inclusive)"},
		{12, 0, true, "midday inside"},
		{16, 59, true, "last minute inside"},
		{17, 0, false, "window end (exclusive)"},
		{18, 0, false, "after window"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.label, func(t *testing.T) {
			ts := time.Date(2026, 7, 19, tt.hour, tt.min, 0, 0, tz)
			got := isInQuietHours(ts, "09:00", "17:00")
			if got != tt.want {
				t.Errorf("isInQuietHours(%02d:%02d) = %v; want %v", tt.hour, tt.min, got, tt.want)
			}
		})
	}
}

func TestIsInQuietHours_ZeroWidthWindow(t *testing.T) {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	ts := time.Date(2026, 7, 19, 22, 0, 0, 0, tz)
	// start == end → never quiet
	if isInQuietHours(ts, "22:00", "22:00") {
		t.Error("zero-width window should never be quiet")
	}
}

func TestIsInQuietHours_EmptyStrings(t *testing.T) {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	ts := time.Date(2026, 7, 19, 3, 0, 0, 0, tz)
	// Malformed strings parse to 0 → zero-width window → not quiet
	if isInQuietHours(ts, "", "") {
		t.Error("empty start/end should not be quiet (fail-open)")
	}
}
