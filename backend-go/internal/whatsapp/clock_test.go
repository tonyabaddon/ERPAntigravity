package whatsapp

import (
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFakeClock_AfterFuncFiresOnAdvance(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	var fired int32

	fc.AfterFunc(5*time.Second, func() {
		atomic.StoreInt32(&fired, 1)
	})

	fc.Advance(4 * time.Second)
	if atomic.LoadInt32(&fired) != 0 {
		t.Fatalf("timer fired too early")
	}

	fc.Advance(2 * time.Second) // total 6s, past the 5s deadline
	if atomic.LoadInt32(&fired) != 1 {
		t.Fatalf("timer did not fire after deadline passed")
	}
}

func TestFakeClock_StopPreventsFire(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	var fired int32

	timer := fc.AfterFunc(5*time.Second, func() {
		atomic.StoreInt32(&fired, 1)
	})

	if !timer.Stop() {
		t.Fatalf("Stop returned false on active timer")
	}
	fc.Advance(10 * time.Second)
	if atomic.LoadInt32(&fired) != 0 {
		t.Fatalf("timer fired after Stop()")
	}
}

func TestFakeClock_NowAdvances(t *testing.T) {
	start := time.Unix(1000, 0)
	fc := newFakeClock(start)
	fc.Advance(7 * time.Second)
	if !fc.Now().Equal(start.Add(7 * time.Second)) {
		t.Fatalf("Now did not advance correctly: got %v", fc.Now())
	}
}

// fakeClock is a test helper that implements Clock with manual time advancement.

type fakeTimer struct {
	deadline time.Time
	fn       func()
	stopped  bool
	clock    *fakeClock
}

func (t *fakeTimer) Stop() bool {
	t.clock.mu.Lock()
	defer t.clock.mu.Unlock()
	if t.stopped {
		return false
	}
	t.stopped = true
	return true
}

type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}

func newFakeClock(start time.Time) *fakeClock {
	return &fakeClock{now: start}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) Timer {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{
		deadline: c.now.Add(d),
		fn:       f,
		clock:    c,
	}
	c.timers = append(c.timers, t)
	return t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	// Snapshot timers that should fire, sorted by deadline
	due := make([]*fakeTimer, 0)
	remaining := make([]*fakeTimer, 0)
	for _, t := range c.timers {
		if t.stopped {
			continue
		}
		if !t.deadline.After(c.now) {
			due = append(due, t)
		} else {
			remaining = append(remaining, t)
		}
	}
	sort.Slice(due, func(i, j int) bool {
		return due[i].deadline.Before(due[j].deadline)
	})
	c.timers = remaining
	c.mu.Unlock()

	// Fire callbacks OUTSIDE the lock (callbacks may reacquire it)
	for _, t := range due {
		t.fn()
	}
}
