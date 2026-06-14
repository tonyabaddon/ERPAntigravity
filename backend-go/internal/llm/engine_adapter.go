package llm

import (
	"context"

	"github.com/username/sinar-elektrik-backend/internal/engine"
)

// EngineAdapter wraps Router to satisfy engine.LLMClient. The adapter
// converts engine.CallOpts → llm.CallOpts and translates llm.Response →
// engine.LLMResult. The engine's full prompt string is wrapped in a
// single user-role message — the system prompt comes from agent config
// and is prepended by the router.
type EngineAdapter struct {
	router *Router
}

func NewEngineAdapter(r *Router) *EngineAdapter {
	return &EngineAdapter{router: r}
}

func (a *EngineAdapter) Complete(ctx context.Context, fullPrompt string, opts engine.CallOpts) (*engine.LLMResult, error) {
	resp, err := a.router.Call(ctx, []Message{
		{Role: "system", Content: a.router.agent.SystemPrompt},
		{Role: "user", Content: fullPrompt},
	}, CallOpts{
		ConversationID: opts.ConversationID,
		StateBoundary:  opts.StateBoundary,
		MaxTokens:      opts.MaxTokens,
	})
	if err != nil {
		return nil, err
	}
	return &engine.LLMResult{
		Body:          resp.Body,
		ModelUsed:     resp.ModelUsed,
		WasForcedSwap: resp.WasForcedSwap,
		LatencyMs:     resp.LatencyMs,
		TripwireFlags: resp.TripwireFlags,
	}, nil
}

// Unpin exposes Router.Unpin to the engine for terminal-state cleanup.
func (a *EngineAdapter) Unpin(ctx context.Context, convID string) error {
	return a.router.Unpin(ctx, convID)
}
