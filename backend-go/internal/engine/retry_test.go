package engine

import (
	"context"
	"fmt"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// mockGeminiSequence fails the first `failN` calls, then succeeds.
type mockGeminiSequence struct {
	calls    int
	failN    int
	response string
}

func (m *mockGeminiSequence) GenerateReply(_ context.Context, _ string) (string, error) {
	m.calls++
	if m.calls <= m.failN {
		return "", fmt.Errorf("simulated timeout on call %d", m.calls)
	}
	return m.response, nil
}

func testConv() *models.Conversation {
	return &models.Conversation{State: models.StateGreeting, Language: "id"}
}

func TestRetryProcess_SuccessFirstAttempt(t *testing.T) {
	m := newTestMachine(`{"reply":"Halo!","detected_language":"id"}`)
	firstFailCalled := 0
	result := RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 10, func() {
		firstFailCalled++
	})
	if result.GeminiError != nil {
		t.Errorf("expected success, got GeminiError: %v", result.GeminiError)
	}
	if result.Reply != "Halo!" {
		t.Errorf("expected reply 'Halo!', got %q", result.Reply)
	}
	if firstFailCalled != 0 {
		t.Errorf("onFirstFail should not be called on success, called %d times", firstFailCalled)
	}
}

func TestRetryProcess_SuccessOnRetry(t *testing.T) {
	// Fails first 3 attempts, succeeds on attempt 4.
	seq := &mockGeminiSequence{failN: 3, response: `{"reply":"Halo!","detected_language":"id"}`}
	m := &Machine{gemini: seq}
	firstFailCalled := 0
	result := RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 10, func() {
		firstFailCalled++
	})
	if result.GeminiError != nil {
		t.Errorf("expected success on retry, got GeminiError: %v", result.GeminiError)
	}
	if firstFailCalled != 1 {
		t.Errorf("onFirstFail should be called exactly once, called %d times", firstFailCalled)
	}
	if seq.calls != 4 {
		t.Errorf("expected 4 Gemini calls, got %d", seq.calls)
	}
}

func TestRetryProcess_AllFail(t *testing.T) {
	m := &Machine{gemini: &mockGeminiError{err: fmt.Errorf("simulated timeout")}}
	firstFailCalled := 0
	result := RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 10, func() {
		firstFailCalled++
	})
	if result.GeminiError == nil {
		t.Error("expected GeminiError after all retries exhausted")
	}
	if firstFailCalled != 1 {
		t.Errorf("onFirstFail should be called exactly once, called %d times", firstFailCalled)
	}
}

func TestRetryProcess_OnFirstFailCalledOnce(t *testing.T) {
	// Fails all 5 attempts — onFirstFail must fire exactly once regardless.
	m := &Machine{gemini: &mockGeminiError{err: fmt.Errorf("timeout")}}
	count := 0
	RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 5, func() {
		count++
	})
	if count != 1 {
		t.Errorf("expected onFirstFail called exactly 1 time, got %d", count)
	}
}
