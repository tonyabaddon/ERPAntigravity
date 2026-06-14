package llm

import (
	"context"
	"errors"
	"time"
)

// Completer is the minimal interface the router needs from an HTTP backend.
// OpenRouterClient implements this; tests can inject a fake.
type Completer interface {
	Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error)
}

// Router is the public entry point for the engine. It owns sticky pinning,
// fallback-chain navigation, cooldown registry, tone seeding, tripwire
// inspection, and telemetry. See spec §5.1 and §5.6.
type Router struct {
	completer Completer
	cooldowns *CooldownRegistry
	pins      *PinManager
	telemetry *Recorder
	agent     AgentConfig
}

func NewRouter(completer Completer, cd *CooldownRegistry, pin *PinManager, rec *Recorder, agent AgentConfig) *Router {
	return &Router{
		completer: completer,
		cooldowns: cd,
		pins:      pin,
		telemetry: rec,
		agent:     agent,
	}
}

const (
	totalCallBudget = 15 * time.Second
	perCallTimeout  = 8 * time.Second
)

// Call picks a model (sticky pin if any, primary if new, fallback if pinned
// is in cooldown) and posts a chat-completion request. On rate-limit, falls
// through the chain. Returns ErrChainExhausted when all models are unavailable.
func (r *Router) Call(ctx context.Context, msgs []Message, opts CallOpts) (*Response, error) {
	if opts.ConversationID == "" {
		return nil, errors.New("llm/router: ConversationID required")
	}
	deadline := time.Now().Add(totalCallBudget)
	ctx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()

	// Snapshot the pre-call pin so we can detect forced-swaps regardless of
	// which candidate ended up succeeding (Case 1/2/3/4 all flow through here).
	var originalPinSlug string
	if existing, perr := r.pins.Get(ctx, opts.ConversationID); perr == nil && existing != nil {
		originalPinSlug = existing.ModelSlug
	}

	candidates, err := r.pickCandidates(ctx, opts)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, &ChainExhaustedError{TriedModels: nil}
	}

	tried := make([]string, 0, len(candidates))

	for _, slug := range candidates {
		if time.Now().After(deadline) {
			break
		}
		tried = append(tried, slug)
		start := time.Now()

		req := CompletionRequest{
			Model:     slug,
			Messages:  msgs,
			MaxTokens: opts.MaxTokens,
		}
		callCtx, callCancel := context.WithTimeout(ctx, perCallTimeout)
		resp, callErr := r.completer.Complete(callCtx, req)
		callCancel()

		latencyMs := int(time.Since(start) / time.Millisecond)

		if callErr != nil {
			// Auth error is a non-recoverable env-var problem — every model
			// in the chain uses the same key. Return immediately so the
			// founder sees the actual error (not "chain exhausted" 10 models
			// later). Cooldown registry NOT touched: the models themselves
			// aren't broken, the credential is.
			if IsAuth(callErr) {
				_ = r.telemetry.Record(ctx, TelemetryRecord{
					ConversationID: opts.ConversationID,
					ModelSlug:      slug,
					StateBoundary:  opts.StateBoundary,
					LatencyMs:      latencyMs,
					Status:         StatusError,
					ErrorMessage:   callErr.Error(),
				})
				return nil, callErr
			}
			r.classifyAndCooldown(slug, callErr, time.Now())
			_ = r.telemetry.Record(ctx, TelemetryRecord{
				ConversationID: opts.ConversationID,
				ModelSlug:      slug,
				StateBoundary:  opts.StateBoundary,
				LatencyMs:      latencyMs,
				Status:         classifyStatus(callErr),
				ErrorMessage:   callErr.Error(),
			})
			continue
		}

		// Success.
		// Forced-swap = we entered with a pin AND served a different model
		// (covers Case 2 unpin-to-primary AND Case 3 cooldown-fallback).
		wasForcedSwap := originalPinSlug != "" && originalPinSlug != slug
		r.cooldowns.MarkSuccess(slug, time.Now())
		if err := r.updatePinAfterSuccess(ctx, opts.ConversationID, slug); err != nil {
			if errors.Is(err, ErrSwapCapExceeded) {
				_ = r.telemetry.Record(ctx, TelemetryRecord{
					ConversationID: opts.ConversationID,
					ModelSlug:      slug,
					StateBoundary:  opts.StateBoundary,
					LatencyMs:      latencyMs,
					Status:         StatusEscalatedChainExhaust,
				})
				return nil, &ChainExhaustedError{TriedModels: append(tried, "(swap_cap_exceeded)")}
			}
			return nil, err
		}

		flags := InspectOutbound(resp.Body)
		status := StatusSuccess
		if len(flags) > 0 {
			status = StatusTripwireAlert
		}

		_ = r.telemetry.Record(ctx, TelemetryRecord{
			ConversationID:   opts.ConversationID,
			ModelSlug:        slug,
			Tier:             TierLayer1Free,
			WasForcedSwap:    wasForcedSwap,
			StateBoundary:    opts.StateBoundary,
			PromptTokens:     resp.Usage.Prompt,
			CompletionTokens: resp.Usage.Completion,
			LatencyMs:        latencyMs,
			Status:           status,
		})

		return &Response{
			Body:          resp.Body,
			ModelUsed:     slug,
			WasForcedSwap: wasForcedSwap,
			LatencyMs:     latencyMs,
			PromptTokens:  resp.Usage.Prompt,
			OutputTokens:  resp.Usage.Completion,
			TripwireFlags: flags,
		}, nil
	}

	return nil, &ChainExhaustedError{TriedModels: tried}
}

// Pin sticks a conversation to a specific model.
func (r *Router) Pin(ctx context.Context, convID, slug string) error {
	return r.pins.Set(ctx, convID, slug)
}

// Unpin clears the conversation pin. Called by the engine on terminal states.
func (r *Router) Unpin(ctx context.Context, convID string) error {
	return r.pins.Unpin(ctx, convID)
}

// pickCandidates returns the ordered list of model slugs to try based on
// pin state + cooldowns + state-boundary opportunity. Spec §5.1 routing decision.
func (r *Router) pickCandidates(ctx context.Context, opts CallOpts) ([]string, error) {
	now := time.Now()
	pin, err := r.pins.Get(ctx, opts.ConversationID)
	if err != nil {
		return nil, err
	}
	chain := r.agent.Chain
	if len(chain) == 0 {
		return nil, errors.New("llm/router: empty chain in agent config")
	}
	primary := chain[0].Slug

	// Case 4: new conversation
	if pin == nil {
		return r.candidatesFromIndex(chain, 0, now), nil
	}

	// Case 1 / Case 2: pinned + healthy
	if r.cooldowns.IsHealthy(pin.ModelSlug, now) {
		// Case 2: state-boundary speculative-retry of primary. The cooldown
		// flag may be stale (provider could have recovered before TTL); we
		// give primary one shot at the boundary, then fall through normally.
		if opts.StateBoundary && pin.ModelSlug != primary {
			out := []string{primary}
			out = append(out, r.candidatesAfter(chain, primary, now)...)
			return out, nil
		}
		return append([]string{pin.ModelSlug},
			r.candidatesAfter(chain, pin.ModelSlug, now)...), nil
	}

	// Case 3: pinned but in cooldown — forced swap
	return r.candidatesAfter(chain, pin.ModelSlug, now), nil
}

func (r *Router) candidatesFromIndex(chain []ModelSpec, start int, now time.Time) []string {
	out := make([]string, 0, len(chain)-start)
	for i := start; i < len(chain); i++ {
		if r.cooldowns.IsHealthy(chain[i].Slug, now) {
			out = append(out, chain[i].Slug)
		}
	}
	return out
}

func (r *Router) candidatesAfter(chain []ModelSpec, currentSlug string, now time.Time) []string {
	idx := -1
	for i, m := range chain {
		if m.Slug == currentSlug {
			idx = i
			break
		}
	}
	return r.candidatesFromIndex(chain, idx+1, now)
}

// updatePinAfterSuccess writes pin state after a successful call.
// If the served slug differs from the previously-pinned slug, this is a
// forced swap and increments swap_count (may return ErrSwapCapExceeded).
func (r *Router) updatePinAfterSuccess(ctx context.Context, convID, servedSlug string) error {
	pin, err := r.pins.Get(ctx, convID)
	if err != nil {
		return err
	}
	if pin == nil {
		return r.pins.Set(ctx, convID, servedSlug)
	}
	if pin.ModelSlug == servedSlug {
		return nil
	}
	return r.pins.ForceSwap(ctx, convID, servedSlug)
}

func (r *Router) classifyAndCooldown(slug string, err error, now time.Time) {
	switch {
	case IsRateLimit(err):
		r.cooldowns.MarkRateLimited(slug, 60, now)
	case IsTimeout(err):
		r.cooldowns.MarkTransient(slug, 2, "timeout", now)
	case IsServerError(err):
		r.cooldowns.MarkTransient(slug, 5, "5xx", now)
	default:
		r.cooldowns.MarkTransient(slug, 5, "unknown_error", now)
	}
}

func classifyStatus(err error) string {
	switch {
	case IsRateLimit(err):
		return StatusRateLimited
	case IsTimeout(err):
		return StatusTimeout
	default:
		return StatusError
	}
}
