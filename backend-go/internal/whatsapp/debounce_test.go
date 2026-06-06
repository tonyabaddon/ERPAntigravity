package whatsapp

import (
	"context"
	"sync"
	"testing"
	"time"
)

// stubFlushFn captures flush invocations for assertion.
type stubFlushFn struct {
	mu    sync.Mutex
	calls []stubFlushCall
}

type stubFlushCall struct {
	phone         string
	joined        string
	originalTexts []string
}

func (s *stubFlushFn) fn(ctx context.Context, phone, joined string, originalTexts []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, stubFlushCall{phone, joined, append([]string{}, originalTexts...)})
	return nil
}

func (s *stubFlushFn) getCalls() []stubFlushCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]stubFlushCall{}, s.calls...)
}

func newTestDebounce(t *testing.T, clock *fakeClock, flushFn FlushFunc) *DebounceHandler {
	t.Helper()
	return NewDebounceHandler(DebounceConfig{
		Clock:    clock,
		FlushFn:  flushFn,
		SoftWait: 5 * time.Second,
		HardWait: 12 * time.Second,
	})
}

func TestPush_BufferingResetsSoftTimer(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628xxx", "halo")
	fc.Advance(3 * time.Second)         // t=3s, dalam window
	d.Push(context.Background(), "628xxx", "tony")
	fc.Advance(4 * time.Second)         // t=7s — would expire if not reset (5s from t=0)
	if got := len(stub.getCalls()); got != 0 {
		t.Fatalf("flush fired prematurely after %d calls", got)
	}

	fc.Advance(2 * time.Second)         // t=9s — past reset deadline of 8s (3+5)
	if got := len(stub.getCalls()); got != 1 {
		t.Fatalf("expected 1 flush call, got %d", got)
	}
	call := stub.getCalls()[0]
	if call.joined != "halo\ntony" {
		t.Fatalf("expected joined='halo\\ntony', got %q", call.joined)
	}
	if call.phone != "628xxx" {
		t.Fatalf("expected phone='628xxx', got %q", call.phone)
	}
}

func TestPush_IdleToBuffering(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628xxx", "halo")

	pb := d.getBufferUnsafe("628xxx")
	if pb == nil {
		t.Fatalf("expected buffer to be created")
	}
	if pb.state != stateBuffering {
		t.Fatalf("expected state=BUFFERING, got %v", pb.state)
	}
	if len(pb.texts) != 1 || pb.texts[0] != "halo" {
		t.Fatalf("expected texts=['halo'], got %v", pb.texts)
	}
}

// TestOrphanBufferRace verifies that when a Push races with postFlush's
// delete, the timer callback flushes the buffer it was installed for —
// not whatever buffer the map currently holds.
//
// The race exposed before the fix:
//  1. Flush starts, state=PROCESSING, pb.mu released
//  2. Push grabs old pb pointer from map, blocks on pb.mu
//  3. postFlush sets state=IDLE, deletes map entry
//  4. Push acquires pb.mu, sees IDLE, transitions to BUFFERING on orphan pb
//  5. Another Push creates fresh pb2 in the map
//  6. Timer fires, looks up by phone, gets pb2 (IDLE) — orphan texts lost
//
// After the fix, timer callbacks hold pb directly via closure capture, so
// orphan-pb still gets flushed.
func TestOrphanBufferRace_TimerFlushesOriginalBuffer(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	// Cycle 1: push and flush. After this, map entry should be deleted.
	d.Push(context.Background(), "628xxx", "first")
	fc.Advance(5 * time.Second) // soft timer expires → flush → postFlush deletes

	// Allow flush goroutine to fully complete
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if d.getBufferUnsafe("628xxx") == nil {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if d.getBufferUnsafe("628xxx") != nil {
		t.Fatalf("expected map entry deleted after cycle 1 flush")
	}

	// Cycle 2: push again. New buffer created.
	d.Push(context.Background(), "628xxx", "second")
	pb2 := d.getBufferUnsafe("628xxx")
	if pb2 == nil {
		t.Fatalf("expected new buffer for cycle 2")
	}

	// Advance to fire cycle 2's soft timer
	fc.Advance(5 * time.Second)
	deadline = time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if len(stub.getCalls()) >= 2 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	calls := stub.getCalls()
	if len(calls) != 2 {
		t.Fatalf("expected 2 flush calls (cycle 1 + cycle 2), got %d: %+v", len(calls), calls)
	}
	if calls[0].joined != "first" {
		t.Fatalf("expected first flush='first', got %q", calls[0].joined)
	}
	if calls[1].joined != "second" {
		t.Fatalf("expected second flush='second', got %q", calls[1].joined)
	}
}
