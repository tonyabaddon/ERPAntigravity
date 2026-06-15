package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const defaultGeminiBaseURL = "https://generativelanguage.googleapis.com/v1beta/openai"

// GeminiClient is a minimal OpenAI-compatible HTTP client for Google's Gemini
// API via the OpenAI compatibility endpoint. Shares the Completer interface
// with OpenRouterClient so the router treats them interchangeably.
//
// Free-tier limits per Google AI Studio account (not shared with other users):
//   - gemini-2.5-flash: 10 RPM, 250K TPM, 500 RPD
//   - gemini-2.0-flash: 15 RPM, 1M TPM, 1,500 RPD
type GeminiClient struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

type GeminiOption func(*GeminiClient)

func WithGeminiBaseURL(u string) GeminiOption {
	return func(c *GeminiClient) { c.baseURL = u }
}

func WithGeminiHTTPTimeout(d time.Duration) GeminiOption {
	return func(c *GeminiClient) { c.http.Timeout = d }
}

func NewGeminiClient(apiKey string, opts ...GeminiOption) *GeminiClient {
	c := &GeminiClient{
		apiKey:  apiKey,
		baseURL: defaultGeminiBaseURL,
		http:    &http.Client{Timeout: 8 * time.Second},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

type geminiAPIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// Complete posts a chat-completion request and returns the assistant's reply.
// Reuses the same error types (rateLimitError, authError, serverError,
// timeoutError) as OpenRouterClient so router classification logic is uniform.
func (c *GeminiClient) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
	buf, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("gemini: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST",
		c.baseURL+"/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return nil, fmt.Errorf("gemini: new request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		if isContextDeadline(err) {
			return nil, &timeoutError{cause: err}
		}
		return nil, fmt.Errorf("gemini: http do: %w", err)
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
		return nil, fmt.Errorf("gemini: http %d: %s", resp.StatusCode, string(body))
	}

	var parsed geminiAPIResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("gemini: parse response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("gemini: empty choices")
	}

	return &CompletionResponse{
		Body: parsed.Choices[0].Message.Content,
		Usage: TokenUsage{
			Prompt:     parsed.Usage.PromptTokens,
			Completion: parsed.Usage.CompletionTokens,
			Total:      parsed.Usage.TotalTokens,
		},
	}, nil
}
