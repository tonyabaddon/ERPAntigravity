package llm

import (
	"context"
	"errors"
	"time"
)

const maxSwapCount = 2

// ErrSwapCapExceeded is returned when ForceSwap would push swap_count past the
// hard cap of 2. Router maps this to ChainExhaustedError so the engine
// escalates the conversation to admin.
var ErrSwapCapExceeded = errors.New("llm/pinning: swap cap exceeded")

// PinEntry is the persisted shape of one conversation's pin state.
type PinEntry struct {
	ConversationID string
	ModelSlug      string
	PinnedAt       time.Time
	SwapCount      int
}

// PinStore is the persistence interface for conversation pins.
//
// LoadTone / SaveTone manage the first_reply_tone JSONB column on the same
// public.conversations row, supporting the perceptual-continuity tone
// seeding flow (spec §5.6 #4). Co-located here because both concepts persist
// per-conversation on the same row.
type PinStore interface {
	LoadPin(ctx context.Context, conversationID string) (PinEntry, bool, error)
	SavePin(ctx context.Context, p PinEntry) error
	ClearPin(ctx context.Context, conversationID string) error
	LoadTone(ctx context.Context, conversationID string) (ToneSignature, bool, error)
	SaveTone(ctx context.Context, conversationID string, tone ToneSignature) error
}

// PinManager wraps PinStore with the sticky-pinning business rules.
// Phase 1A reads/writes through directly; no in-memory cache (router queries
// at most once per turn so DB hit is acceptable).
type PinManager struct {
	store PinStore
}

func NewPinManager(store PinStore) *PinManager {
	return &PinManager{store: store}
}

// Get returns the current pin for a conversation, or nil if unpinned.
func (m *PinManager) Get(ctx context.Context, convID string) (*PinEntry, error) {
	p, ok, err := m.store.LoadPin(ctx, convID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	return &p, nil
}

// Set creates a new pin (or overwrites without incrementing swap_count —
// used for fresh-conversation pre-flight assignment).
func (m *PinManager) Set(ctx context.Context, convID, modelSlug string) error {
	return m.store.SavePin(ctx, PinEntry{
		ConversationID: convID,
		ModelSlug:      modelSlug,
		PinnedAt:       time.Now(),
		SwapCount:      0,
	})
}

// ForceSwap rotates the pin to a new model and increments swap_count.
// Returns ErrSwapCapExceeded when the next increment would exceed the cap
// (spec §5.6: customer sees AT MOST 2 voice changes per conversation; the
// 3rd "swap" is escalation to human).
func (m *PinManager) ForceSwap(ctx context.Context, convID, newSlug string) error {
	current, _, err := m.store.LoadPin(ctx, convID)
	if err != nil {
		return err
	}
	if current.SwapCount >= maxSwapCount {
		return ErrSwapCapExceeded
	}
	current.ConversationID = convID
	current.ModelSlug = newSlug
	current.PinnedAt = time.Now()
	current.SwapCount++
	return m.store.SavePin(ctx, current)
}

// Unpin clears the pin (called by engine when conversation terminates:
// BOOKED, COMPLETED, CANCELLED, ESCALATED_*).
func (m *PinManager) Unpin(ctx context.Context, convID string) error {
	return m.store.ClearPin(ctx, convID)
}

// GetTone returns the first-reply tone signature for a conversation, or nil
// if not yet set. Used by the router to inject voice hints on subsequent calls.
func (m *PinManager) GetTone(ctx context.Context, convID string) (*ToneSignature, error) {
	t, ok, err := m.store.LoadTone(ctx, convID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	return &t, nil
}

// SetTone persists the first-reply tone signature. Called by the router
// after the first successful LLM reply per conversation.
func (m *PinManager) SetTone(ctx context.Context, convID string, tone ToneSignature) error {
	return m.store.SaveTone(ctx, convID, tone)
}
