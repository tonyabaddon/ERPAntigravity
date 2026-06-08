// Package approvals hosts background workers that drive the approval_requests
// state machine outside the request/response path. Today that means just the
// expiry poller — a goroutine that wakes once per period and flips
// past-deadline pending rows to status='expired' by calling the SECURITY
// DEFINER RPC public.expire_pending_approvals().
//
// The package deliberately keeps zero knowledge of WhatsApp, Owner PINs, or
// the inbox UI: those layers all converge on the same DB rows, so the poller
// only needs an Expirer interface that returns (count, error). Wiring lives
// in main.go (Task 20).
package approvals

import (
	"context"
	"log"
	"time"
)

// defaultPeriod is the production cadence. The plan calls for 60s and the
// spec's freshness budget for the inbox banner is "at most a minute stale",
// so we hard-code it here and let callers override via WithPeriod for tests.
const defaultPeriod = time.Minute

// Expirer is the narrow interface the poller depends on. *db.Client satisfies
// it via the ExpirePendingApprovals method in internal/db/approvals.go —
// we accept the interface so tests can pass a fake without standing up a DB.
type Expirer interface {
	ExpirePendingApprovals(ctx context.Context) (int, error)
}

// Poller drives the expiry sweep. A zero-value Poller is NOT usable; always
// construct via NewPoller so defaults (period, logger) are populated.
type Poller struct {
	expirer Expirer
	log     *log.Logger
	period  time.Duration
	// onStop, if set, is invoked exactly once when the goroutine returns.
	// Used by tests to deterministically detect goroutine exit on ctx.Done.
	// Not exposed in production wiring — there's no shutdown coordination
	// beyond ctx cancel in main.go.
	onStop func()
}

// PollerOption configures optional Poller fields. Functional-options instead
// of a config struct keeps the call-site terse for the common case
// (NewPoller(client)) while leaving room for future knobs without breaking
// the constructor signature.
type PollerOption func(*Poller)

// WithPeriod overrides the default tick interval. Tests pass milliseconds;
// production accepts the default minute and does not call this.
func WithPeriod(d time.Duration) PollerOption {
	return func(p *Poller) { p.period = d }
}

// WithLogger swaps the destination logger. Defaults to the package-level
// log.Default(). Tests capture output by passing a logger writing to a bytes
// buffer so they can assert on the success log line.
func WithLogger(l *log.Logger) PollerOption {
	return func(p *Poller) { p.log = l }
}

// WithOnStop registers a callback fired exactly once when the goroutine
// returns due to ctx cancellation. Test-only — production never sets this.
func WithOnStop(f func()) PollerOption {
	return func(p *Poller) { p.onStop = f }
}

// NewPoller constructs a Poller with sane defaults. The expirer is required;
// options patch fields after defaults are applied so a later WithPeriod wins
// over the default — order of options does not matter relative to defaults.
func NewPoller(expirer Expirer, opts ...PollerOption) *Poller {
	p := &Poller{
		expirer: expirer,
		log:     log.Default(),
		period:  defaultPeriod,
	}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

// Start launches the poller goroutine and returns immediately. The goroutine
// exits when ctx is cancelled. Matches the pattern of heartbeat.Poller.Start
// so main.go wiring looks identical for both pollers.
//
// Per-tick semantics:
//   - On RPC error: log "[APPROVALS] expire error: <err>" and continue.
//     The next tick retries — transient DB blips should not kill the worker.
//   - On success with n>0: log "[APPROVALS] expired N requests".
//   - On success with n==0: stay silent (the common case; logging every
//     minute would flood the daemon log with noise).
func (p *Poller) Start(ctx context.Context) {
	go func() {
		if p.onStop != nil {
			defer p.onStop()
		}
		ticker := time.NewTicker(p.period)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				p.tick(ctx)
			}
		}
	}()
}

// tick performs one expiry sweep. Split out from Start so the select loop
// stays tiny and easy to read; also makes the error/success branches
// independently coverable if we ever add a test that exercises the method
// directly without a ticker.
func (p *Poller) tick(ctx context.Context) {
	n, err := p.expirer.ExpirePendingApprovals(ctx)
	if err != nil {
		p.log.Printf("[APPROVALS] expire error: %v", err)
		return
	}
	if n > 0 {
		p.log.Printf("[APPROVALS] expired %d requests", n)
	}
}
