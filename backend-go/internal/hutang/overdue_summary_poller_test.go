package hutang

import (
	"testing"
	"time"
)

func TestNextDailyTarget_FutureToday(t *testing.T) {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	// 06:00 WIB — target 07:30 is still in the future today
	now := time.Date(2026, 7, 19, 6, 0, 0, 0, tz)
	got := nextDailyTarget(now, 7, 30)
	want := time.Date(2026, 7, 19, 7, 30, 0, 0, tz)
	if !got.Equal(want) {
		t.Errorf("nextDailyTarget = %v, want %v", got, want)
	}
}

func TestNextDailyTarget_PastToday(t *testing.T) {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	// 08:00 WIB — target 07:30 already passed, should return tomorrow
	now := time.Date(2026, 7, 19, 8, 0, 0, 0, tz)
	got := nextDailyTarget(now, 7, 30)
	want := time.Date(2026, 7, 20, 7, 30, 0, 0, tz)
	if !got.Equal(want) {
		t.Errorf("nextDailyTarget = %v, want %v", got, want)
	}
}

func TestNextDailyTarget_ExactTime(t *testing.T) {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	// exactly at 07:30 WIB — already passed (not after), returns tomorrow
	now := time.Date(2026, 7, 19, 7, 30, 0, 0, tz)
	got := nextDailyTarget(now, 7, 30)
	want := time.Date(2026, 7, 20, 7, 30, 0, 0, tz)
	if !got.Equal(want) {
		t.Errorf("nextDailyTarget = %v, want %v", got, want)
	}
}

func TestFormatRp(t *testing.T) {
	tests := []struct {
		n    int64
		want string
	}{
		{0, "0"},
		{100, "100"},
		{1000, "1.000"},
		{12500000, "12.500.000"},
		{1000000000, "1.000.000.000"},
		{-5000, "-5.000"},
	}
	for _, tc := range tests {
		got := formatRp(tc.n)
		if got != tc.want {
			t.Errorf("formatRp(%d) = %q, want %q", tc.n, got, tc.want)
		}
	}
}
