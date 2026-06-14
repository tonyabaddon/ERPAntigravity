package engine

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// Skip real backoff during tests so retry-exhaustion cases stay fast.
func init() {
	retrySleep = func(time.Duration) {}
}

// mockLLMSequence fails the first `failN` calls, then succeeds.
type mockLLMSequence struct {
	calls    int
	failN    int
	response string
}

func (m *mockLLMSequence) Complete(_ context.Context, _ string, _ CallOpts) (*LLMResult, error) {
	m.calls++
	if m.calls <= m.failN {
		return nil, fmt.Errorf("simulated timeout on call %d", m.calls)
	}
	return &LLMResult{Body: m.response, ModelUsed: "mock"}, nil
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
	if result.LLMError != nil {
		t.Errorf("expected success, got LLMError: %v", result.LLMError)
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
	seq := &mockLLMSequence{failN: 3, response: `{"reply":"Halo!","detected_language":"id"}`}
	m := &Machine{llm: seq}
	firstFailCalled := 0
	result := RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 10, func() {
		firstFailCalled++
	})
	if result.LLMError != nil {
		t.Errorf("expected success on retry, got LLMError: %v", result.LLMError)
	}
	if firstFailCalled != 1 {
		t.Errorf("onFirstFail should be called exactly once, called %d times", firstFailCalled)
	}
	if seq.calls != 4 {
		t.Errorf("expected 4 LLM calls, got %d", seq.calls)
	}
}

func TestRetryProcess_AllFail(t *testing.T) {
	m := &Machine{llm: &mockLLMError{err: fmt.Errorf("simulated timeout")}}
	firstFailCalled := 0
	result := RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 10, func() {
		firstFailCalled++
	})
	if result.LLMError == nil {
		t.Error("expected LLMError after all retries exhausted")
	}
	if firstFailCalled != 1 {
		t.Errorf("onFirstFail should be called exactly once, called %d times", firstFailCalled)
	}
}

func TestRetryProcess_OnFirstFailCalledOnce(t *testing.T) {
	// Fails all 5 attempts — onFirstFail must fire exactly once regardless.
	m := &Machine{llm: &mockLLMError{err: fmt.Errorf("timeout")}}
	count := 0
	RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 5, func() {
		count++
	})
	if count != 1 {
		t.Errorf("expected onFirstFail called exactly 1 time, got %d", count)
	}
}

// 429 errors must not be retried — per-minute quota doesn't reset within the
// retry window, so more attempts would only burn budget.
func TestRetryProcess_RateLimitBailsImmediately(t *testing.T) {
	seq := &mockLLMSequence{
		failN:    100, // would normally fail all attempts
		response: "",
	}
	// Override mock to return a 429-style error on every call.
	m := &Machine{llm: &mockLLMError{
		err: fmt.Errorf("llm: generate: googleapi: Error 429: quota exceeded"),
	}}
	result := RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 5, func() {})
	if result.LLMError == nil {
		t.Error("expected LLMError to be set")
	}
	// Sequence mock is not used here; we assert via a separate counter mock.
	_ = seq

	// Now verify call count: a rate-limit error should stop at attempt 1.
	counter := &mockLLMCounter{err: fmt.Errorf("Error 429: rate limit")}
	m2 := &Machine{llm: counter}
	RetryProcess(context.Background(), m2, testConv(), "halo", nil, "", 10, func() {})
	if counter.calls != 1 {
		t.Errorf("expected exactly 1 LLM call on 429, got %d", counter.calls)
	}
}

func TestRetryProcess_NonRateLimitRetriesAllAttempts(t *testing.T) {
	counter := &mockLLMCounter{err: fmt.Errorf("context deadline exceeded")}
	m := &Machine{llm: counter}
	RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 3, func() {})
	if counter.calls != 3 {
		t.Errorf("expected 3 LLM calls for transient error, got %d", counter.calls)
	}
}

type mockLLMCounter struct {
	err   error
	calls int
}

func (m *mockLLMCounter) Complete(_ context.Context, _ string, _ CallOpts) (*LLMResult, error) {
	m.calls++
	return nil, m.err
}
