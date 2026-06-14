package llm

import (
	"context"
	"errors"
	"testing"
	"time"
)

type stubTelemetryStore struct {
	records []TelemetryRecord
	err     error
}

func (s *stubTelemetryStore) RecordLLMCall(_ context.Context, r TelemetryRecord) error {
	if s.err != nil {
		return s.err
	}
	s.records = append(s.records, r)
	return nil
}

func TestTelemetry_Record_Success(t *testing.T) {
	store := &stubTelemetryStore{}
	rec := NewRecorder(store)
	err := rec.Record(context.Background(), TelemetryRecord{
		ConversationID: "conv-1",
		ModelSlug:      "google/gemma-4-31b",
		Tier:           TierLayer1Free,
		Status:         StatusSuccess,
		PromptTokens:   100,
		CompletionTokens: 30,
		LatencyMs:      850,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(store.records) != 1 {
		t.Errorf("expected 1 record, got %d", len(store.records))
	}
	if store.records[0].CreatedAt.IsZero() {
		t.Error("expected CreatedAt to be set by recorder")
	}
}

func TestTelemetry_Record_ErrorPropagates(t *testing.T) {
	store := &stubTelemetryStore{err: errors.New("db down")}
	rec := NewRecorder(store)
	err := rec.Record(context.Background(), TelemetryRecord{
		ConversationID: "conv-1",
		ModelSlug:      "x",
		Status:         StatusSuccess,
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestTelemetry_Record_DefaultsCreatedAt(t *testing.T) {
	store := &stubTelemetryStore{}
	rec := NewRecorder(store)
	before := time.Now()
	_ = rec.Record(context.Background(), TelemetryRecord{
		ConversationID: "conv-1",
		ModelSlug:      "x",
		Status:         StatusSuccess,
	})
	after := time.Now()
	got := store.records[0].CreatedAt
	if got.Before(before) || got.After(after) {
		t.Errorf("CreatedAt %v not in [%v, %v]", got, before, after)
	}
}
