package whatsapp

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// stubDebouncer records Push and Flush calls in order so routing tests can
// assert that Flush was called before the bypass handler fired.
type stubDebouncer struct {
	mu    sync.Mutex
	calls []stubDebouncerCall
}

type stubDebouncerCall struct {
	action string // "push" or "flush"
	phone  string
	text   string
}

func (s *stubDebouncer) Push(_ context.Context, phone, text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, stubDebouncerCall{action: "push", phone: phone, text: text})
}

func (s *stubDebouncer) Flush(phone string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, stubDebouncerCall{action: "flush", phone: phone})
}

func (s *stubDebouncer) getCalls() []stubDebouncerCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]stubDebouncerCall{}, s.calls...)
}

// newRoutingTestHandler builds a Handler with a stub debouncer and nil for
// all other dependencies. Tests must only invoke routeMessage with branches
// that do not dereference db/machine/sender/scheduler — for escalation tests
// we accept that the spawned goroutine will fail; we only assert Flush
// ordering before the goroutine starts.
func newRoutingTestHandler(deb debouncer) *Handler {
	return &Handler{debounce: deb}
}

func TestRouteMessage_TextPushedToDebounce(t *testing.T) {
	stub := &stubDebouncer{}
	h := newRoutingTestHandler(stub)

	h.routeMessage(context.Background(), "628xxx", "halo", false, nil)

	calls := stub.getCalls()
	if len(calls) != 1 {
		t.Fatalf("expected 1 call, got %d: %+v", len(calls), calls)
	}
	if calls[0].action != "push" || calls[0].phone != "628xxx" || calls[0].text != "halo" {
		t.Fatalf("expected push for 628xxx halo, got %+v", calls[0])
	}
}

func TestRouteMessage_EscalationFlushesBeforeEscalateGoroutine(t *testing.T) {
	stub := &stubDebouncer{}
	h := newRoutingTestHandler(stub)

	// "mau diskon" triggers EscalationAdmin per rules.CheckEscalation.
	// routeMessage calls Flush synchronously, then spawns a goroutine that
	// will try to run handleAdminEscalation. That goroutine will panic on
	// nil h.db but has its own defer recover() per the handler refactor.
	h.routeMessage(context.Background(), "628xxx", "mau diskon dong", false, nil)

	// Wait briefly for the Flush call to land (it's synchronous so should
	// already be there, but be defensive about scheduler ordering).
	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) {
		if len(stub.getCalls()) >= 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	calls := stub.getCalls()
	if len(calls) < 1 {
		t.Fatalf("expected at least 1 call (Flush before escalate), got 0")
	}
	if calls[0].action != "flush" || calls[0].phone != "628xxx" {
		t.Fatalf("expected first call to be flush for 628xxx, got %+v", calls[0])
	}
	// No Push call should fire for escalation path.
	for _, c := range calls {
		if c.action == "push" {
			t.Fatalf("escalation path should not Push, got %+v", calls)
		}
	}

	// Allow escalation goroutine to finish its panic recovery cycle so the
	// test doesn't leave a dangling goroutine that runs after t.Cleanup.
	time.Sleep(50 * time.Millisecond)
}

func TestRouteMessage_MediaFlushesBeforeMediaHandler(t *testing.T) {
	stub := &stubDebouncer{}
	h := newRoutingTestHandler(stub)

	var mediaCalled int32
	var orderOk int32
	mediaFn := func() {
		// When this runs, Flush must already be in the call log.
		calls := stub.getCalls()
		if len(calls) == 1 && calls[0].action == "flush" && calls[0].phone == "628xxx" {
			atomic.StoreInt32(&orderOk, 1)
		}
		atomic.StoreInt32(&mediaCalled, 1)
	}

	h.routeMessage(context.Background(), "628xxx", "", true, mediaFn)

	if atomic.LoadInt32(&mediaCalled) != 1 {
		t.Fatalf("expected media handler to be called")
	}
	if atomic.LoadInt32(&orderOk) != 1 {
		t.Fatalf("expected Flush to be called BEFORE media handler, got calls: %+v", stub.getCalls())
	}
}

func TestRouteMessage_NilDebouncerMediaPathDoesNotPanic(t *testing.T) {
	// When debouncer is nil (flag off), the media bypass must skip the
	// nil.Flush() call without panicking and still invoke the media handler.
	h := newRoutingTestHandler(nil)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("unexpected panic with nil debouncer: %v", r)
		}
	}()

	var mediaCalled int32
	h.routeMessage(context.Background(), "628xxx", "", true, func() {
		atomic.StoreInt32(&mediaCalled, 1)
	})

	if atomic.LoadInt32(&mediaCalled) != 1 {
		t.Fatalf("expected media handler to run on nil-debouncer path")
	}
}
