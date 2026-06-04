package engine

import "encoding/json"

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
	var r GreetingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func ParseCollecting(raw string) (*CollectingResponse, error) {
	var r CollectingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func ParseClarifying(raw string) (*ClarifyingResponse, error) {
	var r ClarifyingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func ParseStockCheck(raw string) (*StockCheckResponse, error) {
	var r StockCheckResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func ParseConfirming(raw string) (*ConfirmingResponse, error) {
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
	var r AddMoreResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return AddMoreResponse{AddAnother: false}
	}
	return r
}
