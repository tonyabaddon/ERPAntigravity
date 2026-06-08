package approvals

import (
	"bytes"
	"context"
	"errors"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeExpirer is a programmable test double for the Expirer interface.
// Each tick consumes one entry from results (round-robin once exhausted).
type fakeExpirer struct {
	mu      sync.Mutex
	calls   int32
	results []fakeResult
	idx     int
	// signal lets tests wait for the Nth call without polling.
	signal chan struct{}
}

type fakeResult struct {
	n   int
	err error
}

func (f *fakeExpirer) ExpirePendingApprovals(ctx context.Context) (int, error) {
	atomic.AddInt32(&f.calls, 1)
	f.mu.Lock()
	var r fakeResult
	if len(f.results) > 0 {
		r = f.results[f.idx%len(f.results)]
		f.idx++
	}
	f.mu.Unlock()
	// Non-blocking send so we never hang the poller if no test is listening.
	select {
	case f.signal <- struct{}{}:
	default:
	}
	return r.n, r.err
}

func newFakeExpirer(results ...fakeResult) *fakeExpirer {
	return &fakeExpirer{
		results: results,
		signal:  make(chan struct{}, 16),
	}
}

// waitForCalls blocks until the fake has been called at least n times or the
// deadline elapses. Returns true on success, false on timeout.
func (f *fakeExpirer) waitForCalls(n int32, timeout time.Duration) bool {
	deadline := time.After(timeout)
	for atomic.LoadInt32(&f.calls) < n {
		select {
		case <-f.signal:
			// Loop and re-check counter.
		case <-deadline:
			return atomic.LoadInt32(&f.calls) >= n
		}
	}
	return true
}

// TestPoller_TicksAndCallsExpire verifies the poller fires the expirer
// at the configured period. We use a short period (25ms) and wait
// deterministically for two calls instead of sleeping a fixed wall-clock
// interval, which keeps the test fast and tolerant of CI scheduler jitter.
func TestPoller_TicksAndCallsExpire(t *testing.T) {
	fe := newFakeExpirer(fakeResult{n: 0, err: nil})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	p := NewPoller(fe, WithPeriod(25*time.Millisecond))
	p.Start(ctx)

	if !fe.waitForCalls(2, 2*time.Second) {
		t.Fatalf("expected >=2 calls within 2s, got %d", atomic.LoadInt32(&fe.calls))
	}
}

// TestPoller_ContinuesOnError seeds the fake to return an error on the first
// tick and success on subsequent ticks. The poller must NOT panic or return —
// it must log the error and keep ticking. We verify by waiting for a 3rd call
// (which can only happen if the goroutine survived the first error).
func TestPoller_ContinuesOnError(t *testing.T) {
	fe := newFakeExpirer(
		fakeResult{n: 0, err: errors.New("boom")},
		fakeResult{n: 2, err: nil},
		fakeResult{n: 0, err: nil},
	)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var buf bytes.Buffer
	logger := log.New(&buf, "", 0)

	p := NewPoller(fe,
		WithPeriod(20*time.Millisecond),
		WithLogger(logger),
	)
	p.Start(ctx)

	if !fe.waitForCalls(3, 2*time.Second) {
		t.Fatalf("poller stopped after error: only %d calls", atomic.LoadInt32(&fe.calls))
	}

	// Second tick returned n=2, so the success log line should mention it.
	logOut := buf.String()
	if !strings.Contains(logOut, "[APPROVALS] expired 2 requests") {
		t.Errorf("expected '[APPROVALS] expired 2 requests' in log output, got: %q", logOut)
	}
	// First tick errored — error should be logged too.
	if !strings.Contains(logOut, "boom") {
		t.Errorf("expected error 'boom' to be logged, got: %q", logOut)
	}
}

// TestPoller_StopsOnContextCancel cancels the parent context and asserts that
// the poller goroutine returns within a small grace window. We detect the
// goroutine exit by overriding the ticker period to be tiny and watching
// the call counter freeze after cancel.
func TestPoller_StopsOnContextCancel(t *testing.T) {
	fe := newFakeExpirer(fakeResult{n: 0, err: nil})
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	p := NewPoller(fe,
		WithPeriod(10*time.Millisecond),
		WithOnStop(func() { close(done) }),
	)
	p.Start(ctx)

	// Let the poller tick at least once so we know it's running.
	if !fe.waitForCalls(1, 1*time.Second) {
		t.Fatalf("poller never ticked; cannot verify cancel semantics")
	}

	cancel()

	select {
	case <-done:
		// Goroutine returned.
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("poller goroutine did not exit within 500ms of ctx cancel")
	}

	// Calls should not increase after cancel — sample now, wait, re-check.
	frozen := atomic.LoadInt32(&fe.calls)
	time.Sleep(50 * time.Millisecond)
	if got := atomic.LoadInt32(&fe.calls); got != frozen {
		t.Errorf("calls grew from %d to %d after cancel — poller still running", frozen, got)
	}
}
