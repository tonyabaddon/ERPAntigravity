package engine_test

import (
	"context"
	"errors"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/llm"
	"github.com/username/sinar-elektrik-backend/internal/models"
)

// greetingCompleter always returns a valid greeting JSON ready for ParseGreeting.
type greetingCompleter struct{}

func (greetingCompleter) Complete(_ context.Context, _ llm.CompletionRequest) (*llm.CompletionResponse, error) {
	return &llm.CompletionResponse{
		Body:  `{"reply":"Halo Pak!","detected_language":"id"}`,
		Usage: llm.TokenUsage{Prompt: 10, Completion: 5, Total: 15},
	}, nil
}

// alwaysRateLimitedCompleter simulates every model in the chain returning 429.
type alwaysRateLimitedCompleter struct{}

func (alwaysRateLimitedCompleter) Complete(_ context.Context, _ llm.CompletionRequest) (*llm.CompletionResponse, error) {
	return nil, llm.NewRateLimitErrorForTest()
}

func makeRouter(t *testing.T, c llm.Completer) *llm.Router {
	t.Helper()
	cdStore := llm.NewStubCooldownStore()
	cd, err := llm.NewCooldownRegistry(cdStore)
	if err != nil {
		t.Fatal(err)
	}
	pinStore := llm.NewStubPinStoreForTest()
	rec := llm.NewRecorder(llm.NewStubTelemetryStoreForTest())
	return llm.NewRouter(c, cd, llm.NewPinManager(pinStore), rec, llm.DefaultCalistaAgent())
}

func TestEngine_WithRouter_HappyPath(t *testing.T) {
	router := makeRouter(t, greetingCompleter{})
	adapter := llm.NewEngineAdapter(router)
	m := engine.NewMachine(adapter)

	conv := &models.Conversation{
		ID:       "conv-test-1",
		State:    models.StateGreeting,
		Language: "id",
	}
	res, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.NextState != models.StateCollecting {
		t.Errorf("expected NextState=COLLECTING, got %s", res.NextState)
	}
	if res.LLMError != nil {
		t.Errorf("unexpected LLMError: %v", res.LLMError)
	}
	if res.ChainExhausted {
		t.Error("did not expect ChainExhausted on happy path")
	}
}

func TestEngine_WithRouter_ChainExhausted_EscalatesToAdmin(t *testing.T) {
	router := makeRouter(t, alwaysRateLimitedCompleter{})
	adapter := llm.NewEngineAdapter(router)
	m := engine.NewMachine(adapter)

	conv := &models.Conversation{
		ID:       "conv-test-2",
		State:    models.StateCollecting,
		Language: "id",
	}
	res, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if !res.ChainExhausted {
		t.Error("expected ChainExhausted=true after all-rate-limited completer")
	}
	if res.NextState != models.StateEscalatedAdmin {
		t.Errorf("expected NextState=ESCALATED_ADMIN, got %s", res.NextState)
	}
	if !errors.Is(res.LLMError, engine.ErrChainExhausted) {
		t.Errorf("expected LLMError to be ErrChainExhausted, got %v", res.LLMError)
	}
}
