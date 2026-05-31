package scheduler

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestSchedulerFiresReminder(t *testing.T) {
	var reminderFired atomic.Bool
	s := NewScheduler(
		func(orderID string) { reminderFired.Store(true) },
		func(orderID string) {},
	)
	// Reminder fires at (expiresAt - 24hr); for test we set expiresAt = now + 80ms + 24hr (so reminder = now + 80ms)
	expiresAt := time.Now().Add(24*time.Hour + 80*time.Millisecond)
	s.Schedule("order-1", expiresAt)
	time.Sleep(150 * time.Millisecond)
	if !reminderFired.Load() {
		t.Error("reminder should have fired by now")
	}
}

func TestSchedulerCancel(t *testing.T) {
	var cancelFired atomic.Bool
	s := NewScheduler(
		func(orderID string) {},
		func(orderID string) { cancelFired.Store(true) },
	)
	expiresAt := time.Now().Add(50 * time.Millisecond)
	s.Schedule("order-cancel", expiresAt)
	s.Cancel("order-cancel")
	time.Sleep(100 * time.Millisecond)
	if cancelFired.Load() {
		t.Error("cancel handler should NOT have fired after Cancel()")
	}
}

func TestRestoreOnBoot(t *testing.T) {
	var fired atomic.Bool
	s := NewScheduler(
		func(orderID string) {},
		func(orderID string) { fired.Store(true) },
	)
	s.RestoreOnBoot([]BookingEntry{
		{ID: "restore-1", ExpiresAt: time.Now().Add(50 * time.Millisecond)},
	})
	time.Sleep(100 * time.Millisecond)
	if !fired.Load() {
		t.Error("restored booking should have cancelled by now")
	}
}
