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
