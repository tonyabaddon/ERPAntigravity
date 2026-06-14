package engine

import (
	"encoding/json"
	"fmt"
	"strings"
)

// GreetingResponse is the JSON shape Gemini returns in GREETING state.
type GreetingResponse struct {
	Reply            string `json:"reply"`
	DetectedLanguage string `json:"detected_language"`
}

// CollectedFields mirrors collected_data fields Gemini fills in during COLLECTING.
type CollectedFields struct {
	Name    string `json:"name"`
	Company string `json:"company"`
	Product string `json:"product"`
}

// CollectingResponse is the JSON shape Gemini returns in COLLECTING state.
type CollectingResponse struct {
	Reply      string          `json:"reply"`
	Collected  CollectedFields `json:"collected"`
	NextAction string          `json:"next_action"`
}

// ClarifyingSpecs holds spec details collected during CLARIFYING state.
type ClarifyingSpecs struct {
	Qty   int    `json:"qty"`
	Size  string `json:"size"`
	Color string `json:"color"`
	Notes string `json:"notes"`
}

// ClarifyingResponse is the JSON shape Gemini returns in CLARIFYING state.
type ClarifyingResponse struct {
	Reply      string          `json:"reply"`
	Specs      ClarifyingSpecs `json:"specs"`
	NextAction string          `json:"next_action"`
}

// StockCheckResponse is the JSON shape Gemini returns in STOCK_CHECK state.
type StockCheckResponse struct {
	Reply      string `json:"reply"`
	NextAction string `json:"next_action"`
}

// ConfirmingResponse is the JSON shape Gemini returns in CONFIRMING state.
type ConfirmingResponse struct {
	Reply                string `json:"reply"`
	Confirmed            bool   `json:"confirmed"`
	ModificationRequested bool  `json:"modification_requested"`
}

func ParseGreeting(raw string) (*GreetingResponse, error) {
	clean, err := tolerantParseJSON(raw)
	if err != nil {
		return nil, err
	}
	raw = clean
	var r GreetingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func ParseCollecting(raw string) (*CollectingResponse, error) {
	clean, err := tolerantParseJSON(raw)
	if err != nil {
		return nil, err
	}
	raw = clean
	var r CollectingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func ParseClarifying(raw string) (*ClarifyingResponse, error) {
	clean, err := tolerantParseJSON(raw)
	if err != nil {
		return nil, err
	}
	raw = clean
	var r ClarifyingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func ParseStockCheck(raw string) (*StockCheckResponse, error) {
	clean, err := tolerantParseJSON(raw)
	if err != nil {
		return nil, err
	}
	raw = clean
	var r StockCheckResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func ParseConfirming(raw string) (*ConfirmingResponse, error) {
	clean, err := tolerantParseJSON(raw)
	if err != nil {
		return nil, err
	}
	raw = clean
	var r ConfirmingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// DeliveryResponse is the JSON shape Gemini returns in DELIVERY state.
type DeliveryResponse struct {
	Reply      string `json:"reply"`
	NextAction string `json:"next_action"` // PICKUP | DELIVERY | CONTINUE
	Address    string `json:"address"`
}

func ParseDelivery(raw string) (*DeliveryResponse, error) {
	clean, err := tolerantParseJSON(raw)
	if err != nil {
		return nil, err
	}
	raw = clean
	var r DeliveryResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// FallbackReply returns a safe fallback message when Gemini output cannot be parsed.
// Language-aware: returns Indonesian for "id", English for anything else.
func FallbackReply(language string) string {
	if language == "id" {
		return "Maaf, saya mengalami kendala teknis. Silakan coba lagi atau ketik 'halo' untuk memulai ulang."
	}
	return "Sorry, I encountered a technical issue. Please try again or type 'hello' to restart."
}

// AddMoreResponse is the JSON shape Gemini returns in ADD_MORE state.
type AddMoreResponse struct {
	Reply      string `json:"reply"`
	AddAnother bool   `json:"add_another"`
	Language   string `json:"language"`
}

func ParseAddMore(raw string) AddMoreResponse {
	clean, err := tolerantParseJSON(raw)
	if err != nil {
		return AddMoreResponse{AddAnother: false}
	}
	raw = clean
	var r AddMoreResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return AddMoreResponse{AddAnother: false}
	}
	return r
}

// tolerantParseJSON normalizes the various JSON-output quirks that different
// OpenRouter-backed models exhibit. Returns a cleaned JSON object string
// ready for the strict parsers (ParseGreeting, ParseCollecting, etc.).
//
// Steps:
//   1. Strip ` ```json … ``` ` markdown fences.
//   2. Find the first balanced `{...}` block via brace counting.
//   3. Return the extracted block.
//
// Errors when no balanced block is present.
func tolerantParseJSON(raw string) (string, error) {
	s := raw
	// 1. Strip markdown code fences.
	if i := strings.Index(s, "```"); i >= 0 {
		after := s[i+3:]
		after = strings.TrimPrefix(after, "json")
		after = strings.TrimPrefix(after, "\n")
		if j := strings.Index(after, "```"); j >= 0 {
			s = after[:j]
		} else {
			s = after
		}
	}
	// 2. Find first balanced {...} block.
	start := strings.Index(s, "{")
	if start < 0 {
		return "", fmt.Errorf("tolerant_parser: no opening brace in %q", raw)
	}
	depth := 0
	for i := start; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1], nil
			}
		}
	}
	return "", fmt.Errorf("tolerant_parser: unbalanced braces in %q", raw)
}
