package llm

import (
	"fmt"
	"sync"
	"time"
)

const (
	cooldownMaxMinutes = 240 // hard cap at 4h
)

// cooldownBumpTable[failures-1] = minutes added on top of baseMin for that
// failure count. Pattern: baseMin, baseMin+30, baseMin+60, baseMin+180, then cap.
var cooldownBumpTable = []int{0, 30, 60, 180}

// CooldownEntry is the persisted shape of one model's cooldown state.
type CooldownEntry struct {
	ModelSlug            string
	CooldownUntil        time.Time
	LastError            string
	ConsecutiveFailures  int
	UpdatedAt            time.Time
}

// CooldownStore is the persistence interface (implemented by db.CalistaStore
// or stubStore in tests).
type CooldownStore interface {
	LoadCooldowns() ([]CooldownEntry, error)
	SaveCooldown(CooldownEntry) error
}

// CooldownRegistry holds in-memory cooldown state with write-through
// persistence to the underlying store. Mutex-protected — safe for concurrent
// callers (router runs multiple conversation handlers in parallel).
type CooldownRegistry struct {
	mu    sync.RWMutex
	state map[string]CooldownEntry
	store CooldownStore
}

// NewCooldownRegistry loads existing cooldown state from the store and returns
// a ready-to-use registry. Returns an error if the load fails — caller should
// log and continue with empty state OR retry, depending on whether persistence
// is critical for safety.
func NewCooldownRegistry(store CooldownStore) (*CooldownRegistry, error) {
	entries, err := store.LoadCooldowns()
	if err != nil {
		return nil, fmt.Errorf("llm/cooldown: load: %w", err)
	}
	r := &CooldownRegistry{
		state: make(map[string]CooldownEntry, len(entries)),
		store: store,
	}
	for _, e := range entries {
		r.state[e.ModelSlug] = e
	}
	return r, nil
}

// IsHealthy returns true when the model can be called at `now`. Unknown
// models are healthy by default (haven't failed yet).
func (r *CooldownRegistry) IsHealthy(slug string, now time.Time) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.state[slug]
	if !ok {
		return true
	}
	return e.CooldownUntil.IsZero() || now.After(e.CooldownUntil)
}

// MarkRateLimited records a 429/quota event. Cooldown duration grows with
// consecutive failures: baseMin, baseMin+30, baseMin+60, baseMin+180, capped at 4h.
// The store write is synchronous in Phase 1A (low volume); future versions
// can queue async.
func (r *CooldownRegistry) MarkRateLimited(slug string, baseMin int, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e := r.state[slug]
	e.ModelSlug = slug
	e.ConsecutiveFailures++
	idx := e.ConsecutiveFailures - 1
	var cooldownMin int
	if idx >= len(cooldownBumpTable) {
		cooldownMin = cooldownMaxMinutes
	} else {
		cooldownMin = baseMin + cooldownBumpTable[idx]
	}
	if cooldownMin > cooldownMaxMinutes {
		cooldownMin = cooldownMaxMinutes
	}
	e.CooldownUntil = now.Add(time.Duration(cooldownMin) * time.Minute)
	e.LastError = "rate_limit"
	e.UpdatedAt = now
	r.state[slug] = e
	_ = r.store.SaveCooldown(e) // best-effort; in-memory remains source of truth
}

// MarkTransient records a 5xx/timeout/etc. Cooldown is short (5 min for 5xx, 2 min for timeout)
// and does NOT trip exponential bump (transient ≠ rate-limit signal).
func (r *CooldownRegistry) MarkTransient(slug string, minutes int, reason string, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e := r.state[slug]
	e.ModelSlug = slug
	if now.Add(time.Duration(minutes) * time.Minute).After(e.CooldownUntil) {
		e.CooldownUntil = now.Add(time.Duration(minutes) * time.Minute)
	}
	e.LastError = reason
	e.UpdatedAt = now
	r.state[slug] = e
	_ = r.store.SaveCooldown(e)
}

// MarkSuccess resets the consecutive-failure counter (next rate-limit reverts
// to the base 60-min cooldown rather than the bumped value).
func (r *CooldownRegistry) MarkSuccess(slug string, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e := r.state[slug]
	e.ModelSlug = slug
	e.ConsecutiveFailures = 0
	e.UpdatedAt = now
	r.state[slug] = e
	_ = r.store.SaveCooldown(e)
}
