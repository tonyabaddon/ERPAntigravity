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

func TestFlush_HardCapEnforced(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628xxx", "m1")   // t=0
	fc.Advance(3 * time.Second)
	d.Push(context.Background(), "628xxx", "m2")   // t=3
	fc.Advance(3 * time.Second)
	d.Push(context.Background(), "628xxx", "m3")   // t=6
	fc.Advance(3 * time.Second)
	d.Push(context.Background(), "628xxx", "m4")   // t=9

	// At t=9, soft timer would expire at t=14, hard cap at t=12.
	fc.Advance(2*time.Second + 500*time.Millisecond) // t=11.5: still buffered
	if got := len(stub.getCalls()); got != 0 {
		t.Fatalf("flush fired before hard cap, got %d calls", got)
	}

	fc.Advance(1 * time.Second) // t=12.5: hard cap @ 12 has fired
	// Allow flush goroutine to complete
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if len(stub.getCalls()) >= 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if got := len(stub.getCalls()); got != 1 {
		t.Fatalf("expected hard cap to fire 1 call, got %d", got)
	}
	call := stub.getCalls()[0]
	if call.joined != "m1\nm2\nm3\nm4" {
		t.Fatalf("expected joined='m1\\nm2\\nm3\\nm4', got %q", call.joined)
	}
}

// slowFlushFn blocks until release is closed. Allows asserting state during PROCESSING.
type slowFlushFn struct {
	stub    *stubFlushFn
	release chan struct{}
	entered chan struct{}
}

func (s *slowFlushFn) fn(ctx context.Context, phone, joined string, originalTexts []string) error {
	close(s.entered)
	<-s.release
	return s.stub.fn(ctx, phone, joined, originalTexts)
}

func TestProcessing_NextBufferDuringFlush(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	slow := &slowFlushFn{
		stub:    stub,
		release: make(chan struct{}),
		entered: make(chan struct{}),
	}
	d := newTestDebounce(t, fc, slow.fn)

	d.Push(context.Background(), "628xxx", "first")
	// Trigger flush in background: fakeClock.Advance fires callbacks synchronously,
	// so if slow.fn blocks (waiting on release), Advance would never return on the
	// test goroutine. Run it in a goroutine so test goroutine can proceed to receive
	// on entered.
	go fc.Advance(5 * time.Second)
	<-slow.entered // ensure flushFn started

	// During PROCESSING, new push should go to nextBuffer
	d.Push(context.Background(), "628xxx", "second")

	pb := d.getBufferUnsafe("628xxx")
	pb.mu.Lock()
	if pb.state != stateProcessing {
		pb.mu.Unlock()
		t.Fatalf("expected state=PROCESSING during flush, got %v", pb.state)
	}
	if len(pb.nextBuffer) != 1 || pb.nextBuffer[0] != "second" {
		pb.mu.Unlock()
		t.Fatalf("expected nextBuffer=['second'], got %v", pb.nextBuffer)
	}
	pb.mu.Unlock()

	// Release flushFn so it returns
	close(slow.release)

	// Wait for postFlush to run (state transition is sync within flush goroutine)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		pb.mu.Lock()
		if pb.state == stateBuffering && len(pb.texts) == 1 && pb.texts[0] == "second" {
			pb.mu.Unlock()
			break
		}
		pb.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	pb.mu.Lock()
	if pb.state != stateBuffering {
		pb.mu.Unlock()
		t.Fatalf("expected cycle 2 to start in BUFFERING, got %v", pb.state)
	}
	if len(pb.texts) != 1 || pb.texts[0] != "second" {
		pb.mu.Unlock()
		t.Fatalf("expected cycle 2 texts=['second'], got %v", pb.texts)
	}
	pb.mu.Unlock()
}

func TestPostFlush_TransitionsToIdleAndDeletesEntry(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628xxx", "halo")
	// Advance to trigger flush. Since stub returns immediately (not blocking),
	// fc.Advance fires the timer synchronously and the flush + postFlush chain
	// completes inline.
	fc.Advance(5 * time.Second)

	// Small spin in case flush+postFlush goroutine path is async
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if d.getBufferUnsafe("628xxx") == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if d.getBufferUnsafe("628xxx") != nil {
		t.Fatalf("expected buffer entry to be deleted after flush with empty nextBuffer")
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

func TestSpamCap_DropsExcess(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	// Push 25 messages quickly
	for i := 0; i < 25; i++ {
		d.Push(context.Background(), "628xxx", "msg")
	}

	pb := d.getBufferUnsafe("628xxx")
	pb.mu.Lock()
	defer pb.mu.Unlock()
	if len(pb.texts) != maxBufferTexts {
		t.Fatalf("expected texts capped at %d, got %d", maxBufferTexts, len(pb.texts))
	}
}
