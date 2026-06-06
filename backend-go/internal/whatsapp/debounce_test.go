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
