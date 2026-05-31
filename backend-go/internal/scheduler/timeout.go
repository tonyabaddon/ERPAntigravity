package scheduler

import (
	"log"
	"sync"
	"time"
)

type BookingEntry struct {
	ID        string
	ExpiresAt time.Time
}

type Scheduler struct {
	mu             sync.Mutex
	cancelTimers   map[string]*time.Timer
	reminderTimers map[string]*time.Timer
	onReminder     func(orderID string)
	onCancel       func(orderID string)
}

func NewScheduler(onReminder, onCancel func(orderID string)) *Scheduler {
	return &Scheduler{
		cancelTimers:   make(map[string]*time.Timer),
		reminderTimers: make(map[string]*time.Timer),
		onReminder:     onReminder,
		onCancel:       onCancel,
	}
}

// Schedule registers reminder (at expiresAt - 24hr) and cancellation (at expiresAt) timers.
func (s *Scheduler) Schedule(orderID string, expiresAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked(orderID)

	now := time.Now()
	reminderAt := expiresAt.Add(-24 * time.Hour)
	if reminderAt.After(now) {
		s.reminderTimers[orderID] = time.AfterFunc(time.Until(reminderAt), func() {
			log.Printf("[SCHEDULER] Reminder firing for order %s", orderID)
			s.onReminder(orderID)
		})
	}
	if expiresAt.After(now) {
		s.cancelTimers[orderID] = time.AfterFunc(time.Until(expiresAt), func() {
			log.Printf("[SCHEDULER] Cancellation firing for order %s", orderID)
			s.onCancel(orderID)
		})
	}
}

func (s *Scheduler) Cancel(orderID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked(orderID)
	log.Printf("[SCHEDULER] Timers cancelled for order %s", orderID)
}

func (s *Scheduler) stopLocked(orderID string) {
	if t, ok := s.cancelTimers[orderID]; ok {
		t.Stop()
		delete(s.cancelTimers, orderID)
	}
	if t, ok := s.reminderTimers[orderID]; ok {
		t.Stop()
		delete(s.reminderTimers, orderID)
	}
}

// RestoreOnBoot re-registers timers for active bookings after a daemon restart.
func (s *Scheduler) RestoreOnBoot(entries []BookingEntry) {
	for _, e := range entries {
		if e.ExpiresAt.After(time.Now()) {
			s.Schedule(e.ID, e.ExpiresAt)
			log.Printf("[SCHEDULER] Restored timer for order %s (expires %v)", e.ID, e.ExpiresAt)
		}
	}
}
