package engine

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

const maxClarificationRounds = 3

// LLMClient is the interface the engine depends on. Implemented by both
// llm.Router (default) and the legacy gemini.Client adapter (for the
// ENABLE_OPENROUTER=false emergency fallback path).
type LLMClient interface {
	Complete(ctx context.Context, fullPrompt string, opts CallOpts) (*LLMResult, error)
}

// CallOpts mirrors llm.CallOpts but is duplicated here to keep the engine
// package import-free of llm (avoiding a cycle if llm ever needed engine).
type CallOpts struct {
	ConversationID string
	StateBoundary  bool
	MaxTokens      int
}

// LLMResult is what the engine receives back from any LLM client.
type LLMResult struct {
	Body          string
	ModelUsed     string
	WasForcedSwap bool
	LatencyMs     int
	TripwireFlags []string
}

type Machine struct {
	llm LLMClient
}

func NewMachine(l LLMClient) *Machine {
	return &Machine{llm: l}
}

type ProcessResult struct {
	Reply              string
	NextState          models.ConversationState
	NewData            *models.CollectedData
	ClarificationRound int
	Language           string
	CreateOrder        bool
	DeliveryType       models.DeliveryType
	LLMError           error
	ChainExhausted     bool
}

// Process runs the state machine for one incoming customer message.
// On any LLM or parse failure, it returns a safe fallback — never returns an error.
func (m *Machine) Process(ctx context.Context, conv *models.Conversation, incomingText string, history []models.Message, stockContext string) (*ProcessResult, error) {
	result := &ProcessResult{
		NextState:          conv.State,
		Language:           conv.Language,
		ClarificationRound: conv.ClarificationRound,
	}

	prompt := BuildPrompt(conv.State, conv.Language, conv.CollectedData, history, stockContext)
	fullPrompt := fmt.Sprintf("%s\n\nCustomer message: %s", prompt, incomingText)

	res, err := m.llm.Complete(ctx, fullPrompt, CallOpts{
		ConversationID: conv.ID,
		MaxTokens:      maxTokensForState(conv.State),
	})
	if err != nil {
		slog.ErrorContext(ctx, "[ENGINE] LLM error", slog.String("state", string(conv.State)), slog.Any("error", err))
		result.Reply = FallbackReply(conv.Language)
		result.LLMError = err
		if errors.Is(err, ErrChainExhausted) {
			result.ChainExhausted = true
			result.NextState = models.StateEscalatedAdmin
		}
		return result, nil
	}
	rawJSON := res.Body

	switch conv.State {
	case models.StateGreeting:
		resp, err := ParseGreeting(rawJSON)
		if err != nil {
			slog.ErrorContext(ctx, "[ENGINE] Parse greeting error", slog.Any("error", err), slog.String("raw", rawJSON))
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		result.Language = resp.DetectedLanguage
		result.NextState = models.StateCollecting

	case models.StateCollecting:
		resp, err := ParseCollecting(rawJSON)
		if err != nil {
			slog.ErrorContext(ctx, "[ENGINE] Parse collecting error", slog.Any("error", err), slog.String("raw", rawJSON))
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		newData := conv.CollectedData
		if resp.Collected.Name != "" {
			newData.Name = resp.Collected.Name
		}
		if resp.Collected.Company != "" {
			newData.Company = resp.Collected.Company
		}
		if resp.Collected.Product != "" {
			newData.Product = resp.Collected.Product
		}
		result.NewData = &newData
		if newData.AllCoreFieldsFilled() {
			result.NextState = models.StateClarifying
		}
		if resp.NextAction == "ESCALATE" {
			result.NextState = models.StateEscalatedAdmin
		}

	case models.StateClarifying:
		resp, err := ParseClarifying(rawJSON)
		if err != nil {
			slog.ErrorContext(ctx, "[ENGINE] Parse clarifying error", slog.Any("error", err), slog.String("raw", rawJSON))
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		newData := conv.CollectedData
		if resp.Specs.Qty > 0 {
			newData.Quantity = resp.Specs.Qty
		}
		if resp.Specs.Size != "" {
			newData.Specs.Size = resp.Specs.Size
		}
		if resp.Specs.Color != "" {
			newData.Specs.Color = resp.Specs.Color
		}
		if resp.Specs.Notes != "" {
			newData.Specs.Notes = resp.Specs.Notes
		}
		result.NewData = &newData
		newRound := conv.ClarificationRound + 1
		result.ClarificationRound = newRound
		switch {
		case resp.NextAction == "ESCALATE":
			result.NextState = models.StateEscalatedAdmin
		case resp.NextAction == "READY" || newRound >= maxClarificationRounds:
			result.NextState = models.StateStockCheck
		}

	case models.StateStockCheck:
		resp, err := ParseStockCheck(rawJSON)
		if err != nil {
			slog.ErrorContext(ctx, "[ENGINE] Parse stock_check error", slog.Any("error", err), slog.String("raw", rawJSON))
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		if resp.NextAction == "CONFIRM" {
			result.NextState = models.StateConfirming
		} else if resp.NextAction == "ESCALATE" {
			result.NextState = models.StateEscalatedAdmin
		}

	case models.StateConfirming:
		resp, err := ParseConfirming(rawJSON)
		if err != nil {
			slog.ErrorContext(ctx, "[ENGINE] Parse confirming error", slog.Any("error", err), slog.String("raw", rawJSON))
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		if resp.Confirmed {
			newData := conv.CollectedData
			specsStr := strings.TrimSpace(
				newData.Specs.Size + " " + newData.Specs.Color + " " + newData.Specs.Notes,
			)
			newData.Cart = append(newData.Cart, models.CartItem{
				Product:  newData.Product,
				Quantity: newData.Quantity,
				Specs:    specsStr,
			})
			newData.Product = ""
			newData.Quantity = 0
			newData.Specs = models.SpecsData{}
			result.NewData = &newData
			result.NextState = models.StateAddMore
		} else if resp.ModificationRequested {
			result.NextState = models.StateClarifying
			result.ClarificationRound = 0
		}

	case models.StateAddMore:
		parsed := ParseAddMore(rawJSON)
		result.Reply = parsed.Reply
		if parsed.Language != "" {
			result.Language = parsed.Language
		}
		if parsed.AddAnother {
			result.NextState = models.StateCollecting
		} else {
			result.NextState = models.StateDelivery
		}

	case models.StateDelivery:
		resp, err := ParseDelivery(rawJSON)
		if err != nil {
			slog.ErrorContext(ctx, "[ENGINE] Parse delivery error", slog.Any("error", err), slog.String("raw", rawJSON))
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		switch resp.NextAction {
		case "PICKUP":
			result.DeliveryType = models.DeliveryTypePickup
			result.NextState = models.StateBooked
			result.CreateOrder = true
		case "DELIVERY":
			newData := conv.CollectedData
			if resp.Address != "" {
				newData.Address = resp.Address
			}
			result.NewData = &newData
			result.DeliveryType = models.DeliveryTypeDelivery
			result.NextState = models.StateBooked
			result.CreateOrder = true
		}
	}

	// Unpin the router's sticky-pin when the conversation reaches a terminal
	// state. Only the llm.EngineAdapter implements the unpinner interface; the
	// gemini.EngineAdapter is a no-op (it has no pin concept). Best-effort —
	// errors here would only leak a DB row that the hourly stale-pin cleanup
	// job (spec §5.5) reaps anyway.
	if isTerminalState(result.NextState) {
		if u, ok := m.llm.(unpinner); ok {
			_ = u.Unpin(ctx, conv.ID)
		}
	}

	return result, nil
}

// unpinner is the optional interface an LLMClient may implement to clear
// per-conversation sticky-pin state when the conversation terminates. The
// llm.EngineAdapter (wrapping llm.Router) implements it; the gemini.EngineAdapter
// returns nil (no-op) by design.
type unpinner interface {
	Unpin(ctx context.Context, conversationID string) error
}

func isTerminalState(s models.ConversationState) bool {
	switch s {
	case models.StateBooked, models.StateCompleted, models.StateCancelled,
		models.StateEscalatedAdmin, models.StateEscalatedWiring:
		return true
	}
	return false
}

// maxTokensForState returns the per-state max_tokens budget. The Calista
// persona reply (greeting + numbered prompt list + JSON wrapper) consistently
// runs 150-250 tokens, and the original spec §5.6 #6 budgets (60-200) caused
// JSON truncation mid-string → tolerant_parser "unbalanced braces" errors →
// customer sees FallbackReply "kendala teknis". Verified in prod 2026-06-14
// with Gemini 2.5-flash-lite: model emitted a clean reply but completion
// hit the 100-token cap mid-sentence in StateCollecting.
//
// Budgets bumped ~2-3x. On Gemini direct (~$0.0001 per call at this volume)
// the cost is negligible; on OpenRouter free tier the budget isn't billed.
func maxTokensForState(s models.ConversationState) int {
	switch s {
	case models.StateGreeting:
		return 200
	case models.StateCollecting:
		return 300
	case models.StateClarifying:
		return 300
	case models.StateStockCheck:
		return 400
	case models.StateConfirming:
		return 400
	case models.StateAddMore:
		return 150
	case models.StateDelivery:
		return 250
	case models.StateBooked:
		return 400
	}
	return 300 // safe default
}
