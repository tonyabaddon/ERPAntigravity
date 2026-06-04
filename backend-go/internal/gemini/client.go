package gemini

import (
	"context"
	"fmt"
	"time"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

type Client struct {
	model *genai.GenerativeModel
	gc    *genai.Client
}

// NewClient creates a Gemini client using the provided API key and system prompt.
func NewClient(ctx context.Context, apiKey, systemPrompt string) (*Client, error) {
	gc, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return nil, fmt.Errorf("gemini: new client: %w", err)
	}
	model := gc.GenerativeModel("gemini-3.5-flash")
	model.ResponseMIMEType = "application/json"
	model.SystemInstruction = &genai.Content{
		Parts: []genai.Part{genai.Text(systemPrompt)},
	}
	return &Client{model: model, gc: gc}, nil
}

// GenerateReply sends a prompt to Gemini and returns the raw JSON string response.
func (c *Client) GenerateReply(ctx context.Context, fullPrompt string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	resp, err := c.model.GenerateContent(ctx, genai.Text(fullPrompt))
	if err != nil {
		return "", fmt.Errorf("gemini: generate: %w", err)
	}
	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini: empty response")
	}
	text, ok := resp.Candidates[0].Content.Parts[0].(genai.Text)
	if !ok {
		return "", fmt.Errorf("gemini: unexpected part type")
	}
	return string(text), nil
}

// Close releases the underlying Gemini client connection.
func (c *Client) Close() {
	c.gc.Close()
}
