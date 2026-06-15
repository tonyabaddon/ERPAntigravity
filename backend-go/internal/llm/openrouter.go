package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultOpenRouterBaseURL = "https://openrouter.ai/api/v1"

// OpenRouterClient is a minimal OpenAI-compatible HTTP client for openrouter.ai.
// Kept dependency-free (uses only net/http + encoding/json) — OpenRouter mirrors
// OpenAI's /chat/completions contract, so we don't need a vendor SDK.
type OpenRouterClient struct {
	apiKey     string
	baseURL    string
	httpRef    string // HTTP-Referer header (account attribution → higher free-tier rate limits)
	appTitle   string // X-Title header (account attribution)
	http       *http.Client
}

type OpenRouterOption func(*OpenRouterClient)

func WithBaseURL(u string) OpenRouterOption {
	return func(c *OpenRouterClient) { c.baseURL = u }
}

func WithHTTPTimeout(d time.Duration) OpenRouterOption {
	return func(c *OpenRouterClient) { c.http.Timeout = d }
}

// WithHTTPReferer sets the HTTP-Referer header sent on every call.
// OpenRouter uses this for account attribution and rewards attributed
// requests with higher free-tier rate limits.
func WithHTTPReferer(referer string) OpenRouterOption {
	return func(c *OpenRouterClient) { c.httpRef = referer }
}

// WithAppTitle sets the X-Title header sent on every call (account attribution).
func WithAppTitle(title string) OpenRouterOption {
	return func(c *OpenRouterClient) { c.appTitle = title }
}

func NewOpenRouterClient(apiKey string, opts ...OpenRouterOption) *OpenRouterClient {
	c := &OpenRouterClient{
		apiKey:   apiKey,
		baseURL:  defaultOpenRouterBaseURL,
		httpRef:  "https://calista.vosi.id", // sensible default per spec §5.1
		appTitle: "Calista",
		http:     &http.Client{Timeout: 8 * time.Second}, // per-call soft timeout (spec §5.1)
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// CompletionRequest mirrors the OpenAI chat-completions request shape.
type CompletionRequest struct {
	Model     string    `json:"model"`
	Messages  []Message `json:"messages"`
	MaxTokens int       `json:"max_tokens,omitempty"`
}

// CompletionResponse normalizes OpenRouter's response for the router.
type CompletionResponse struct {
	Body  string
	Usage TokenUsage
}

type openRouterAPIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
			// Reasoning models (e.g. nex-agi/nex-n2-pro:free,
			// nvidia/nemotron-3-nano-omni) split their output between Content
			// and Reasoning. When per-state max_tokens is tight, reasoning can
			// consume the budget and leave Content empty. Fallback to Reasoning
			// below preserves whatever the model actually produced.
			Reasoning string `json:"reasoning,omitempty"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// Complete posts a chat-completion request and returns the assistant's reply.
// Caller is responsible for timeout via ctx (also enforced by client.Timeout).
func (c *OpenRouterClient) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
	buf, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("openrouter: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST",
		c.baseURL+"/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return nil, fmt.Errorf("openrouter: new request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	if c.httpRef != "" {
		httpReq.Header.Set("HTTP-Referer", c.httpRef)
	}
	if c.appTitle != "" {
		httpReq.Header.Set("X-Title", c.appTitle)
	}

	resp, err := c.http.Do(httpReq)
	if err != nil {
		if isContextDeadline(err) {
			return nil, &timeoutError{cause: err}
		}
		return nil, fmt.Errorf("openrouter: http do: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, &rateLimitError{status: resp.StatusCode, body: string(body)}
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, &authError{status: resp.StatusCode, body: string(body)}
	}
	if resp.StatusCode >= 500 {
		return nil, &serverError{status: resp.StatusCode, body: string(body)}
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("openrouter: http %d: %s", resp.StatusCode, string(body))
	}

	var parsed openRouterAPIResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("openrouter: parse response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("openrouter: empty choices")
	}

	// Prefer Content; fall back to Reasoning for reasoning-style models that
	// exhausted their max_tokens budget inside the reasoning phase and left
	// Content empty. The downstream tolerantParseJSON treats both the same.
	replyBody := parsed.Choices[0].Message.Content
	if replyBody == "" {
		replyBody = parsed.Choices[0].Message.Reasoning
	}

	return &CompletionResponse{
		Body: replyBody,
		Usage: TokenUsage{
			Prompt:     parsed.Usage.PromptTokens,
			Completion: parsed.Usage.CompletionTokens,
			Total:      parsed.Usage.TotalTokens,
		},
	}, nil
}

// --- Error classification (used by router + cooldown) ---

type rateLimitError struct {
	status int
	body   string
}

func (e *rateLimitError) Error() string {
	return fmt.Sprintf("llm: rate limited (HTTP %d): %s", e.status, e.body)
}

type serverError struct {
	status int
	body   string
}

func (e *serverError) Error() string {
	return fmt.Sprintf("llm: server error (HTTP %d): %s", e.status, e.body)
}

// authError signals the API key was rejected (401) or lacks permission (403).
// The router does NOT cooldown on auth errors — they affect every model in
// the chain identically and are non-recoverable without env-var change.
type authError struct {
	status int
	body   string
}

func (e *authError) Error() string {
	return fmt.Sprintf("llm: auth rejected (HTTP %d) — check API key: %s", e.status, e.body)
}

type timeoutError struct{ cause error }

func (e *timeoutError) Error() string { return "llm: timeout: " + e.cause.Error() }
func (e *timeoutError) Unwrap() error { return e.cause }

// IsRateLimit returns true when the error indicates a 429 / quota condition.
func IsRateLimit(err error) bool {
	var rl *rateLimitError
	return errors.As(err, &rl)
}

// IsAuth returns true when the error indicates a 401 / 403 (bad API key).
// Auth errors are NEVER cooldown-eligible — every model in the chain shares
// the same key, so cooling one model wouldn't help. The router fails fast on
// auth errors and surfaces them directly to the caller.
func IsAuth(err error) bool {
	var ae *authError
	return errors.As(err, &ae)
}

// IsServerError returns true when the error indicates a 5xx upstream failure.
func IsServerError(err error) bool {
	var se *serverError
	return errors.As(err, &se)
}

// IsTimeout returns true when the call exceeded its time budget.
func IsTimeout(err error) bool {
	var te *timeoutError
	if errors.As(err, &te) {
		return true
	}
	return isContextDeadline(err)
}

func isContextDeadline(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(err.Error(), "deadline exceeded") ||
		strings.Contains(err.Error(), "Client.Timeout")
}
