package gemini

import (
	"context"

	"github.com/username/sinar-elektrik-backend/internal/engine"
)

// EngineAdapter wraps the existing Gemini *Client to satisfy engine.LLMClient.
// Used when ENABLE_OPENROUTER=false to keep a working emergency path without
// touching upstream call sites.
type EngineAdapter struct {
	client *Client
}

func NewEngineAdapter(c *Client) *EngineAdapter {
	return &EngineAdapter{client: c}
}

// Complete satisfies engine.LLMClient. opts is ignored — direct Gemini has no
// sticky pin or per-state budget concept (Phase 2 may revisit).
func (a *EngineAdapter) Complete(ctx context.Context, fullPrompt string, _ engine.CallOpts) (*engine.LLMResult, error) {
	body, err := a.client.GenerateReply(ctx, fullPrompt)
	if err != nil {
		return nil, err
	}
	return &engine.LLMResult{
		Body:      body,
		ModelUsed: "google/gemini-2.5-flash-lite-direct",
	}, nil
}

// Unpin is a no-op for the direct Gemini path (no sticky pinning). Implements
// the engine's optional unpinner interface so terminal-state cleanup is safe
// regardless of which LLMClient is wired.
func (a *EngineAdapter) Unpin(_ context.Context, _ string) error { return nil }
