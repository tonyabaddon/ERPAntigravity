package engine

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

const maxClarificationRounds = 3

// GeminiClient is the interface the machine depends on — allows mocking in tests.
type GeminiClient interface {
	GenerateReply(ctx context.Context, fullPrompt string) (string, error)
}

type Machine struct {
	gemini GeminiClient
}

func NewMachine(g GeminiClient) *Machine {
	return &Machine{gemini: g}
}

type ProcessResult struct {
	Reply              string
	NextState          models.ConversationState
	NewData            *models.CollectedData
	ClarificationRound int
	Language           string
	CreateOrder        bool
	DeliveryType       models.DeliveryType
	GeminiError        error
}

// Process runs the state machine for one incoming customer message.
// On any Gemini or parse failure, it returns a safe fallback — never returns an error.
func (m *Machine) Process(ctx context.Context, conv *models.Conversation, incomingText string, history []models.Message, stockContext string) (*ProcessResult, error) {
	result := &ProcessResult{
		NextState:          conv.State,
		Language:           conv.Language,
		ClarificationRound: conv.ClarificationRound,
	}

	prompt := BuildPrompt(conv.State, conv.Language, conv.CollectedData, history, stockContext)
	fullPrompt := fmt.Sprintf("%s\n\nCustomer message: %s", prompt, incomingText)

	rawJSON, err := m.gemini.GenerateReply(ctx, fullPrompt)
	if err != nil {
		log.Printf("[ENGINE] Gemini error in state %s: %v", conv.State, err)
		result.Reply = FallbackReply(conv.Language)
		result.GeminiError = err
		return result, nil
	}

	switch conv.State {
	case models.StateGreeting:
		resp, err := ParseGreeting(rawJSON)
		if err != nil {
			log.Printf("[ENGINE] Parse greeting error: %v — raw: %s", err, rawJSON)
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		result.Language = resp.DetectedLanguage
		result.NextState = models.StateCollecting

	case models.StateCollecting:
		resp, err := ParseCollecting(rawJSON)
		if err != nil {
			log.Printf("[ENGINE] Parse collecting error: %v — raw: %s", err, rawJSON)
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
			log.Printf("[ENGINE] Parse clarifying error: %v — raw: %s", err, rawJSON)
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
			log.Printf("[ENGINE] Parse stock_check error: %v — raw: %s", err, rawJSON)
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
			log.Printf("[ENGINE] Parse confirming error: %v — raw: %s", err, rawJSON)
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
			log.Printf("[ENGINE] Parse delivery error: %v — raw: %s", err, rawJSON)
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

	return result, nil
}
