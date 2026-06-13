// Package llm implements Calista's model-agnostic LLM gateway. It owns:
//   - HTTP calls to OpenRouter (openrouter.ai)
//   - Per-conversation sticky model pinning
//   - Per-model cooldown registry persisted across daemon restarts
//   - First-reply tone seeding for perceptual continuity
//   - Output tripwire heuristics
//   - Per-call telemetry written to public.llm_calls
//
// Phase 1A scope: free-tier 10-model chain via OpenRouter. Layer 2 paid
// fallback and multimodal handling ship in later phases.
package llm

import (
	"errors"
	"fmt"
)

// ErrChainExhausted is the sentinel returned when all models in the chain
// are simultaneously unavailable. The engine catches this and transitions
// the conversation to StateEscalatedAdmin (human takeover).
var ErrChainExhausted = errors.New("llm: chain exhausted")

// ChainExhaustedError carries the list of model slugs tried, for telemetry
// and debugging. Implements errors.Is(err, ErrChainExhausted).
type ChainExhaustedError struct {
	TriedModels []string
}

func (e *ChainExhaustedError) Error() string {
	return fmt.Sprintf("llm: chain exhausted after trying %d models: %v",
		len(e.TriedModels), e.TriedModels)
}

func (e *ChainExhaustedError) Is(target error) bool {
	return target == ErrChainExhausted
}

// ModelSpec is one entry in the fallback chain. Slug matches OpenRouter's
// model identifier (e.g. "google/gemma-4-31b"). CooldownMinutes is the
// initial cooldown on 429 — extended exponentially on consecutive failures.
type ModelSpec struct {
	Slug            string
	CooldownMinutes int
}

// AgentConfig is Calista's runtime configuration. Phase 1A holds this in
// memory (see chain.go); Phase 1B moves to public.ai_agents.
type AgentConfig struct {
	Name         string
	SystemPrompt string
	Chain        []ModelSpec
}

// Message is one turn in the conversation context sent to the LLM. The
// role field follows the OpenAI chat-completions convention.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// IsValidRole returns true if role is one of system/user/assistant.
func IsValidRole(role string) bool {
	switch role {
	case "system", "user", "assistant":
		return true
	}
	return false
}

// CallOpts carries per-call hints from the engine to the router.
type CallOpts struct {
	// ConversationID identifies the conversation for sticky pinning. Required.
	ConversationID string
	// StateBoundary signals the engine just transitioned states. The router
	// uses this as the ONE moment it may unpin back to a "better" model.
	StateBoundary bool
	// MaxTokens caps the completion length for this call (per-state budget).
	MaxTokens int
}

// Response is what the router returns to the engine on success.
type Response struct {
	Body          string
	ModelUsed     string
	WasForcedSwap bool
	LatencyMs     int
	PromptTokens  int
	OutputTokens  int
	TripwireFlags []string
}

// TokenUsage is the per-call billing/budget breakdown from OpenRouter.
type TokenUsage struct {
	Prompt     int
	Completion int
	Total      int
}
