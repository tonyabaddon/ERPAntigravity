package llm

import "context"

// Helpers exported for the engine integration test. Kept in a non-_test.go
// file so packages outside `llm` can use them (Go test helpers in _test.go
// are package-private).

func NewStubCooldownStore() CooldownStore   { return &stubCooldownStoreExport{m: map[string]CooldownEntry{}} }
func NewStubPinStoreForTest() PinStore       { return &stubPinStoreExport{m: map[string]PinEntry{}} }
func NewStubTelemetryStoreForTest() TelemetryStore { return &stubTelemetryStoreExport{} }

type stubCooldownStoreExport struct{ m map[string]CooldownEntry }

func (s *stubCooldownStoreExport) LoadCooldowns() ([]CooldownEntry, error) {
	out := make([]CooldownEntry, 0, len(s.m))
	for _, e := range s.m {
		out = append(out, e)
	}
	return out, nil
}
func (s *stubCooldownStoreExport) SaveCooldown(e CooldownEntry) error { s.m[e.ModelSlug] = e; return nil }

type stubPinStoreExport struct{ m map[string]PinEntry }

func (s *stubPinStoreExport) LoadPin(_ context.Context, id string) (PinEntry, bool, error) {
	p, ok := s.m[id]
	return p, ok, nil
}
func (s *stubPinStoreExport) SavePin(_ context.Context, p PinEntry) error {
	s.m[p.ConversationID] = p
	return nil
}
func (s *stubPinStoreExport) ClearPin(_ context.Context, id string) error {
	delete(s.m, id)
	return nil
}

type stubTelemetryStoreExport struct{}

func (s *stubTelemetryStoreExport) RecordLLMCall(_ context.Context, _ TelemetryRecord) error { return nil }

// NewRateLimitErrorForTest builds a *rateLimitError. Exported only for use
// in tests outside the llm package (which can't construct unexported types).
func NewRateLimitErrorForTest() error {
	return &rateLimitError{status: 429, body: "test"}
}
