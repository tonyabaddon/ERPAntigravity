package llm

import (
	"context"
	"time"
)

// Status values written to llm_calls.status. Mirror the CHECK constraint
// in migration 20260613000034.
const (
	StatusSuccess               = "success"
	StatusRateLimited           = "rate_limited"
	StatusError                 = "error"
	StatusTripwireAlert         = "tripwire_alert"
	StatusEscalatedChainExhaust = "escalated_chain_exhausted"
	StatusContextOverflow       = "context_overflow"
	StatusTimeout               = "timeout"
)

// Tier values written to llm_calls.tier. Mirror the CHECK constraint.
const (
	TierLayer1Free            = "layer1_free"
	TierLayer2PaidGeminiFlash = "layer2_paid_gemini_flash"
	TierLayer3DirectGemini    = "layer3_direct_gemini"
	TierEscalateAdmin         = "escalate_admin"
)

// TelemetryRecord is one row inserted into public.llm_calls per LLM call.
type TelemetryRecord struct {
	ConversationID   string
	ModelSlug        string
	Tier             string
	WasForcedSwap    bool
	StateBoundary    bool
	PromptTokens     int
	CompletionTokens int
	LatencyMs        int
	CostIDREstimated float64
	Status           string
	ErrorMessage     string
	CreatedAt        time.Time
}

// TelemetryStore persists TelemetryRecord. Implemented by db.CalistaStore.
type TelemetryStore interface {
	RecordLLMCall(ctx context.Context, r TelemetryRecord) error
}

// Recorder wraps TelemetryStore with the default-CreatedAt rule.
type Recorder struct {
	store TelemetryStore
}

func NewRecorder(store TelemetryStore) *Recorder {
	return &Recorder{store: store}
}

// Record fills in CreatedAt if zero and writes through to the store.
func (r *Recorder) Record(ctx context.Context, rec TelemetryRecord) error {
	if rec.CreatedAt.IsZero() {
		rec.CreatedAt = time.Now().UTC()
	}
	if rec.Tier == "" {
		rec.Tier = TierLayer1Free
	}
	return r.store.RecordLLMCall(ctx, rec)
}
