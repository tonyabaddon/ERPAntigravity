package llm

import (
	"context"
	"testing"
)

type stubPinStore struct {
	pins    map[string]PinEntry
	tones   map[string]ToneSignature
	saved   []PinEntry
	cleared []string
}

func newStubPinStore() *stubPinStore {
	return &stubPinStore{pins: map[string]PinEntry{}, tones: map[string]ToneSignature{}}
}

func (s *stubPinStore) LoadPin(_ context.Context, convID string) (PinEntry, bool, error) {
	p, ok := s.pins[convID]
	return p, ok, nil
}

func (s *stubPinStore) SavePin(_ context.Context, p PinEntry) error {
	s.pins[p.ConversationID] = p
	s.saved = append(s.saved, p)
	return nil
}

func (s *stubPinStore) ClearPin(_ context.Context, convID string) error {
	delete(s.pins, convID)
	delete(s.tones, convID)
	s.cleared = append(s.cleared, convID)
	return nil
}

func (s *stubPinStore) LoadTone(_ context.Context, convID string) (ToneSignature, bool, error) {
	t, ok := s.tones[convID]
	return t, ok, nil
}

func (s *stubPinStore) SaveTone(_ context.Context, convID string, tone ToneSignature) error {
	s.tones[convID] = tone
	return nil
}

func TestPinning_NewConversation_NoPin(t *testing.T) {
	store := newStubPinStore()
	mgr := NewPinManager(store)
	pin, err := mgr.Get(context.Background(), "conv-1")
	if err != nil {
		t.Fatal(err)
	}
	if pin != nil {
		t.Errorf("expected nil pin for new conversation, got %+v", pin)
	}
}

func TestPinning_SetAndGet(t *testing.T) {
	store := newStubPinStore()
	mgr := NewPinManager(store)
	ctx := context.Background()

	err := mgr.Set(ctx, "conv-1", "google/gemma-4-31b")
	if err != nil {
		t.Fatal(err)
	}

	pin, err := mgr.Get(ctx, "conv-1")
	if err != nil {
		t.Fatal(err)
	}
	if pin == nil || pin.ModelSlug != "google/gemma-4-31b" {
		t.Errorf("expected pin to gemma-4-31b, got %+v", pin)
	}
	if pin.SwapCount != 0 {
		t.Errorf("expected SwapCount=0 on initial Set, got %d", pin.SwapCount)
	}
}

func TestPinning_ForcedSwap_IncrementsCount(t *testing.T) {
	store := newStubPinStore()
	mgr := NewPinManager(store)
	ctx := context.Background()
	_ = mgr.Set(ctx, "conv-1", "google/gemma-4-31b")

	err := mgr.ForceSwap(ctx, "conv-1", "qwen/qwen3-next-80b-a3b-instruct")
	if err != nil {
		t.Fatal(err)
	}
	pin, _ := mgr.Get(ctx, "conv-1")
	if pin.ModelSlug != "qwen/qwen3-next-80b-a3b-instruct" {
		t.Errorf("expected pin to swap to qwen, got %s", pin.ModelSlug)
	}
	if pin.SwapCount != 1 {
		t.Errorf("expected SwapCount=1 after first swap, got %d", pin.SwapCount)
	}
}

func TestPinning_ForceSwap_OverCapReturnsError(t *testing.T) {
	store := newStubPinStore()
	mgr := NewPinManager(store)
	ctx := context.Background()
	_ = mgr.Set(ctx, "conv-1", "a")
	_ = mgr.ForceSwap(ctx, "conv-1", "b") // count 1
	_ = mgr.ForceSwap(ctx, "conv-1", "c") // count 2

	err := mgr.ForceSwap(ctx, "conv-1", "d") // would be count 3 → over cap
	if err == nil {
		t.Fatal("expected ErrSwapCapExceeded on 3rd forced swap, got nil")
	}
	if err.Error() != ErrSwapCapExceeded.Error() {
		t.Errorf("expected ErrSwapCapExceeded, got %v", err)
	}
}

func TestPinning_Unpin_ClearsState(t *testing.T) {
	store := newStubPinStore()
	mgr := NewPinManager(store)
	ctx := context.Background()
	_ = mgr.Set(ctx, "conv-1", "a")

	err := mgr.Unpin(ctx, "conv-1")
	if err != nil {
		t.Fatal(err)
	}
	pin, _ := mgr.Get(ctx, "conv-1")
	if pin != nil {
		t.Errorf("expected nil pin after Unpin, got %+v", pin)
	}
	if len(store.cleared) != 1 {
		t.Errorf("expected 1 ClearPin call, got %d", len(store.cleared))
	}
}
