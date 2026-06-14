package llm

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeCompleter struct {
	// per-model behaviour: "ok", "429", "5xx", "timeout"
	behavior map[string]string
	calls    []string
}

func (f *fakeCompleter) Complete(_ context.Context, req CompletionRequest) (*CompletionResponse, error) {
	f.calls = append(f.calls, req.Model)
	switch f.behavior[req.Model] {
	case "ok":
		return &CompletionResponse{
			Body:  "Halo Pak! Tersedia.",
			Usage: TokenUsage{Prompt: 10, Completion: 5, Total: 15},
		}, nil
	case "429":
		return nil, &rateLimitError{status: 429, body: "rate limit"}
	case "5xx":
		return nil, &serverError{status: 503, body: "down"}
	case "timeout":
		return nil, &timeoutError{cause: errors.New("deadline")}
	default:
		return &CompletionResponse{
			Body:  "default-ok",
			Usage: TokenUsage{Prompt: 5, Completion: 3, Total: 8},
		}, nil
	}
}

func newTestRouter(t *testing.T, completer *fakeCompleter) (*Router, *stubPinStore, *stubTelemetryStore) {
	cooldownStore := &stubStore{loaded: map[string]CooldownEntry{}}
	cd, err := NewCooldownRegistry(cooldownStore)
	if err != nil {
		t.Fatal(err)
	}
	pinStore := newStubPinStore()
	pin := NewPinManager(pinStore)
	telStore := &stubTelemetryStore{}
	rec := NewRecorder(telStore)
	r := NewRouter(completer, cd, pin, rec, DefaultCalistaAgent())
	return r, pinStore, telStore
}

func TestRouter_NewConversation_PinsToPrimary(t *testing.T) {
	completer := &fakeCompleter{behavior: map[string]string{
		"google/gemma-4-31b": "ok",
	}}
	r, pinStore, telStore := newTestRouter(t, completer)

	resp, err := r.Call(context.Background(), []Message{{Role: "user", Content: "halo"}},
		CallOpts{ConversationID: "conv-1"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.ModelUsed != "google/gemma-4-31b" {
		t.Errorf("expected primary model, got %q", resp.ModelUsed)
	}
	if pinStore.pins["conv-1"].ModelSlug != "google/gemma-4-31b" {
		t.Errorf("expected pin written to gemma-4-31b, got %+v", pinStore.pins["conv-1"])
	}
	if len(telStore.records) != 1 || telStore.records[0].Status != StatusSuccess {
		t.Errorf("expected 1 success telemetry, got %+v", telStore.records)
	}
}

func TestRouter_PrimaryRateLimited_FallsThrough_Pins(t *testing.T) {
	completer := &fakeCompleter{behavior: map[string]string{
		"google/gemma-4-31b":                 "429",
		"qwen/qwen3-next-80b-a3b-instruct":   "ok",
	}}
	r, pinStore, _ := newTestRouter(t, completer)

	resp, err := r.Call(context.Background(), []Message{{Role: "user", Content: "halo"}},
		CallOpts{ConversationID: "conv-2"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.ModelUsed != "qwen/qwen3-next-80b-a3b-instruct" {
		t.Errorf("expected qwen, got %q", resp.ModelUsed)
	}
	if pinStore.pins["conv-2"].ModelSlug != "qwen/qwen3-next-80b-a3b-instruct" {
		t.Errorf("expected pin to qwen, got %s", pinStore.pins["conv-2"].ModelSlug)
	}
}

func TestRouter_StickyPin_OnSecondCall(t *testing.T) {
	completer := &fakeCompleter{behavior: map[string]string{
		"google/gemma-4-31b": "ok",
	}}
	r, _, _ := newTestRouter(t, completer)
	ctx := context.Background()

	_, _ = r.Call(ctx, []Message{{Role: "user", Content: "halo"}},
		CallOpts{ConversationID: "conv-3"})
	resp, err := r.Call(ctx, []Message{{Role: "user", Content: "lagi"}},
		CallOpts{ConversationID: "conv-3"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.ModelUsed != "google/gemma-4-31b" {
		t.Errorf("expected sticky pin to gemma, got %q", resp.ModelUsed)
	}
	if len(completer.calls) != 2 {
		t.Errorf("expected 2 completer calls, got %d", len(completer.calls))
	}
}

func TestRouter_PinRateLimited_ForcedSwapMidConversation(t *testing.T) {
	completer := &fakeCompleter{behavior: map[string]string{
		"google/gemma-4-31b":                 "ok",
		"qwen/qwen3-next-80b-a3b-instruct":   "ok",
	}}
	r, pinStore, _ := newTestRouter(t, completer)
	ctx := context.Background()

	// Turn 1: pin to gemma.
	_, _ = r.Call(ctx, []Message{{Role: "user", Content: "halo"}},
		CallOpts{ConversationID: "conv-4"})

	// Simulate gemma rate-limit at turn 2.
	completer.behavior["google/gemma-4-31b"] = "429"

	resp, err := r.Call(ctx, []Message{{Role: "user", Content: "lagi"}},
		CallOpts{ConversationID: "conv-4"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.ModelUsed != "qwen/qwen3-next-80b-a3b-instruct" {
		t.Errorf("expected forced-swap to qwen, got %q", resp.ModelUsed)
	}
	if !resp.WasForcedSwap {
		t.Error("expected WasForcedSwap=true")
	}
	if pinStore.pins["conv-4"].SwapCount != 1 {
		t.Errorf("expected SwapCount=1, got %d", pinStore.pins["conv-4"].SwapCount)
	}
}

func TestRouter_ChainExhausted_ReturnsSentinel(t *testing.T) {
	completer := &fakeCompleter{behavior: map[string]string{}}
	for _, m := range DefaultCalistaAgent().Chain {
		completer.behavior[m.Slug] = "429"
	}
	r, _, _ := newTestRouter(t, completer)

	_, err := r.Call(context.Background(), []Message{{Role: "user", Content: "halo"}},
		CallOpts{ConversationID: "conv-5"})
	if err == nil {
		t.Fatal("expected error when all models 429, got nil")
	}
	if !errors.Is(err, ErrChainExhausted) {
		t.Errorf("expected ErrChainExhausted, got %T: %v", err, err)
	}
}

func TestRouter_StateBoundary_UnpinAttempt(t *testing.T) {
	// Turn 1: gemma 429, qwen ok → pin to qwen.
	completer := &fakeCompleter{behavior: map[string]string{
		"google/gemma-4-31b":                 "429",
		"qwen/qwen3-next-80b-a3b-instruct":   "ok",
	}}
	r, _, _ := newTestRouter(t, completer)
	ctx := context.Background()
	_, _ = r.Call(ctx, []Message{{Role: "user", Content: "halo"}},
		CallOpts{ConversationID: "conv-6"})

	// Turn 2: gemma now healthy. With StateBoundary=true the router should
	// retry primary; here gemma is now OK so the pin should move back to it.
	completer.behavior["google/gemma-4-31b"] = "ok"
	resp, err := r.Call(ctx, []Message{{Role: "user", Content: "lagi"}},
		CallOpts{ConversationID: "conv-6", StateBoundary: true})
	if err != nil {
		t.Fatal(err)
	}
	if resp.ModelUsed != "google/gemma-4-31b" {
		t.Errorf("expected state-boundary unpin back to gemma, got %q", resp.ModelUsed)
	}
}

// longBodyCompleter overrides the body of any OK reply with a fixed long string.
type longBodyCompleter struct {
	inner *fakeCompleter
	body  string
}

func (c *longBodyCompleter) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
	resp, err := c.inner.Complete(ctx, req)
	if err != nil {
		return nil, err
	}
	resp.Body = c.body
	return resp, nil
}

func TestRouter_TripwireFlagsOnLongReply(t *testing.T) {
	long := strings.Repeat("a", 900)
	completer := &fakeCompleter{behavior: map[string]string{"google/gemma-4-31b": "ok"}}
	wrapper := &longBodyCompleter{inner: completer, body: long}

	cooldownStore := &stubStore{loaded: map[string]CooldownEntry{}}
	cd, _ := NewCooldownRegistry(cooldownStore)
	pinStore := newStubPinStore()
	pin := NewPinManager(pinStore)
	telStore := &stubTelemetryStore{}
	rec := NewRecorder(telStore)
	r := NewRouter(wrapper, cd, pin, rec, DefaultCalistaAgent())

	resp, err := r.Call(context.Background(),
		[]Message{{Role: "user", Content: "halo"}},
		CallOpts{ConversationID: "conv-tw"})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.TripwireFlags) == 0 {
		t.Errorf("expected tripwire flags for >800-char reply, got none")
	}
	// Telemetry should also record the alert status.
	gotAlert := false
	for _, r := range telStore.records {
		if r.Status == StatusTripwireAlert {
			gotAlert = true
		}
	}
	if !gotAlert {
		t.Error("expected tripwire_alert status in telemetry")
	}
}

// captureCompleter records what messages the router sent on each call.
// Used to verify tone-hint injection in TestRouter_ToneSeeding_*.
type captureCompleter struct {
	body  string
	calls [][]Message
}

func (c *captureCompleter) Complete(_ context.Context, req CompletionRequest) (*CompletionResponse, error) {
	msgs := make([]Message, len(req.Messages))
	copy(msgs, req.Messages)
	c.calls = append(c.calls, msgs)
	return &CompletionResponse{
		Body:  c.body,
		Usage: TokenUsage{Prompt: 5, Completion: 3, Total: 8},
	}, nil
}

func TestRouter_ToneSeeding_ExtractsAndInjects(t *testing.T) {
	completer := &captureCompleter{body: "Halo Pak Budi! Kabel tersedia."}
	r, _, _ := newTestRouter(t, &fakeCompleter{behavior: map[string]string{}})
	r = NewRouter(completer, r.cooldowns, r.pins, r.telemetry, r.agent)
	ctx := context.Background()

	baseMsgs := []Message{
		{Role: "system", Content: "PERSONA"},
		{Role: "user", Content: "halo"},
	}
	_, err := r.Call(ctx, baseMsgs, CallOpts{ConversationID: "conv-tone-1"})
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if len(completer.calls) != 1 || len(completer.calls[0]) != 2 {
		t.Fatalf("first call should send 2 messages (system+user), got %d calls / %d msgs",
			len(completer.calls), len(completer.calls[0]))
	}

	_, err = r.Call(ctx, baseMsgs, CallOpts{ConversationID: "conv-tone-1"})
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	second := completer.calls[1]
	if len(second) != 3 {
		t.Fatalf("second call should send 3 messages (system+tone-hint+user), got %d", len(second))
	}
	if second[0].Content != "PERSONA" {
		t.Errorf("position 0 should be PERSONA, got %q", second[0].Content)
	}
	if second[1].Role != "system" {
		t.Errorf("position 1 should be system tone hint, got role=%q", second[1].Role)
	}
	if !strings.Contains(strings.ToLower(second[1].Content), "match this voice") {
		t.Errorf("tone hint should contain 'match this voice' directive, got %q", second[1].Content)
	}
	if second[2].Role != "user" {
		t.Errorf("position 2 should be user, got role=%q", second[2].Role)
	}
}

func TestRouter_ToneSeeding_DoesNotOverwrite(t *testing.T) {
	completer := &captureCompleter{body: "Halo Pak Budi! Kabel tersedia."}
	r, _, _ := newTestRouter(t, &fakeCompleter{behavior: map[string]string{}})
	r = NewRouter(completer, r.cooldowns, r.pins, r.telemetry, r.agent)
	ctx := context.Background()

	baseMsgs := []Message{{Role: "user", Content: "halo"}}
	_, _ = r.Call(ctx, baseMsgs, CallOpts{ConversationID: "conv-tone-2"})
	tone1, _ := r.pins.GetTone(ctx, "conv-tone-2")
	if tone1 == nil {
		t.Fatal("expected tone after first call")
	}
	firstSample := tone1.Sample

	completer.body = "Different reply with different tone marker."
	_, _ = r.Call(ctx, baseMsgs, CallOpts{ConversationID: "conv-tone-2"})
	tone2, _ := r.pins.GetTone(ctx, "conv-tone-2")
	if tone2 == nil || tone2.Sample != firstSample {
		t.Errorf("tone should not be overwritten; firstSample=%q gotSample=%q",
			firstSample, tone2.Sample)
	}
}

type slowCompleter struct{ delay time.Duration }

func (s *slowCompleter) Complete(ctx context.Context, _ CompletionRequest) (*CompletionResponse, error) {
	select {
	case <-time.After(s.delay):
		return nil, &timeoutError{cause: errors.New("simulated timeout")}
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func TestRouter_TimeBudget_TotalCallBudget15s(t *testing.T) {
	completer := &slowCompleter{delay: 6 * time.Second}
	cooldownStore := &stubStore{loaded: map[string]CooldownEntry{}}
	cd, _ := NewCooldownRegistry(cooldownStore)
	pinStore := newStubPinStore()
	pin := NewPinManager(pinStore)
	telStore := &stubTelemetryStore{}
	rec := NewRecorder(telStore)
	r := NewRouter(completer, cd, pin, rec, DefaultCalistaAgent())
	ctx, cancel := context.WithTimeout(context.Background(), 16*time.Second)
	defer cancel()
	start := time.Now()
	_, err := r.Call(ctx, []Message{{Role: "user", Content: "halo"}},
		CallOpts{ConversationID: "conv-budget"})
	elapsed := time.Since(start)
	if elapsed > 17*time.Second {
		t.Errorf("router took %v, exceeded 15s budget", elapsed)
	}
	if err == nil {
		t.Error("expected error or partial success within budget")
	}
}
