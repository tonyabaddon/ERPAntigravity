package llm

import (
	"errors"
	"testing"
	"time"
)

type stubStore struct {
	loaded  map[string]CooldownEntry
	written []CooldownEntry
	loadErr error
	saveErr error
}

func (s *stubStore) LoadCooldowns() ([]CooldownEntry, error) {
	if s.loadErr != nil {
		return nil, s.loadErr
	}
	out := make([]CooldownEntry, 0, len(s.loaded))
	for _, e := range s.loaded {
		out = append(out, e)
	}
	return out, nil
}

func (s *stubStore) SaveCooldown(e CooldownEntry) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	s.written = append(s.written, e)
	return nil
}

func TestCooldown_NewIsHealthy(t *testing.T) {
	store := &stubStore{loaded: map[string]CooldownEntry{}}
	reg, err := NewCooldownRegistry(store)
	if err != nil {
		t.Fatal(err)
	}
	if !reg.IsHealthy("google/gemma-4-31b", time.Now()) {
		t.Error("expected unknown model to be healthy")
	}
}

func TestCooldown_MarkRateLimited(t *testing.T) {
	store := &stubStore{loaded: map[string]CooldownEntry{}}
	reg, _ := NewCooldownRegistry(store)
	now := time.Now()

	reg.MarkRateLimited("google/gemma-4-31b", 60, now)

	if reg.IsHealthy("google/gemma-4-31b", now.Add(1*time.Minute)) {
		t.Error("expected model to be in cooldown 1 min after MarkRateLimited(60)")
	}
	if !reg.IsHealthy("google/gemma-4-31b", now.Add(61*time.Minute)) {
		t.Error("expected cooldown to expire 61 min after MarkRateLimited(60)")
	}
	if len(store.written) != 1 {
		t.Errorf("expected 1 store write, got %d", len(store.written))
	}
}

func TestCooldown_ExponentialOnRepeatedFailures(t *testing.T) {
	store := &stubStore{loaded: map[string]CooldownEntry{}}
	reg, _ := NewCooldownRegistry(store)
	now := time.Now()

	reg.MarkRateLimited("x", 60, now)         // 60 min
	reg.MarkRateLimited("x", 60, now)         // → 90 min
	reg.MarkRateLimited("x", 60, now)         // → 120 min
	reg.MarkRateLimited("x", 60, now)         // → 240 min (cap at 4h)
	reg.MarkRateLimited("x", 60, now)         // → still 240 (cap)

	// 240 min cap == 4h, so model should still be cooled 230 min later.
	if reg.IsHealthy("x", now.Add(230*time.Minute)) {
		t.Error("expected exponential cooldown to cap at 4h")
	}
}

func TestCooldown_ResetOnSuccess(t *testing.T) {
	store := &stubStore{loaded: map[string]CooldownEntry{}}
	reg, _ := NewCooldownRegistry(store)
	now := time.Now()

	reg.MarkRateLimited("x", 60, now)
	reg.MarkRateLimited("x", 60, now) // 90 min
	reg.MarkSuccess("x", now)

	// After success, next rate-limit should reset to 60 min base.
	reg.MarkRateLimited("x", 60, now.Add(time.Minute))
	if reg.IsHealthy("x", now.Add(50*time.Minute)) {
		t.Error("expected fresh 60 min cooldown after success+rate-limit")
	}
}

func TestCooldown_LoadErrorReturned(t *testing.T) {
	store := &stubStore{loadErr: errors.New("db down")}
	_, err := NewCooldownRegistry(store)
	if err == nil {
		t.Fatal("expected load error to propagate")
	}
}
