package whatsapp

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestIntegration_RapidFireSingleFlush(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}

	d := NewDebounceHandler(DebounceConfig{
		Clock:    fc,
		FlushFn:  stub.fn,
		SoftWait: 5 * time.Second,
		HardWait: 12 * time.Second,
	})

	d.Push(context.Background(), "628xxx", "halo")
	fc.Advance(2 * time.Second)
	d.Push(context.Background(), "628xxx", "saya tony")
	fc.Advance(2 * time.Second)
	d.Push(context.Background(), "628xxx", "mau panel")
	// At t=4, soft timer would expire at t=9 (reset at t=4). Advance another 5s in goroutine.
	go fc.Advance(5 * time.Second)

	// Allow flush goroutine to complete
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if len(stub.getCalls()) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	calls := stub.getCalls()
	if len(calls) != 1 {
		t.Fatalf("expected 1 flush call, got %d", len(calls))
	}
	if calls[0].joined != "halo\nsaya tony\nmau panel" {
		t.Fatalf("unexpected joined: %q", calls[0].joined)
	}
	if len(calls[0].originalTexts) != 3 {
		t.Fatalf("expected 3 original texts, got %d: %v", len(calls[0].originalTexts), calls[0].originalTexts)
	}
}

func TestIntegration_HardCapEndToEnd(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	var flushCount int32
	flushFn := func(ctx context.Context, phone, joined string, originalTexts []string) error {
		atomic.AddInt32(&flushCount, 1)
		return nil
	}
	d := NewDebounceHandler(DebounceConfig{
		Clock:    fc,
		FlushFn:  flushFn,
		SoftWait: 5 * time.Second,
		HardWait: 12 * time.Second,
	})

	// Rapid-fire 4 messages @ 3s apart (always resetting soft timer)
	for i := 0; i < 4; i++ {
		d.Push(context.Background(), "628xxx", "msg")
		go fc.Advance(3 * time.Second)
		time.Sleep(20 * time.Millisecond) // give clock advance a moment to land
	}

	// At this point virtual time ~12s, hard cap should fire
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&flushCount) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&flushCount); got != 1 {
		t.Fatalf("expected hard cap to trigger 1 flush, got %d", got)
	}
}
