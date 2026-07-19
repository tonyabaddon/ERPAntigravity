// backend-go/internal/notification/send_ops_email.go
package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

// opsEmailSender is an interface so tests can inject a mock HTTP client.
type opsEmailSender interface {
	Do(*http.Request) (*http.Response, error)
}

var defaultOpsEmailClient opsEmailSender = http.DefaultClient

// SendOpsEmail sends a plain-text ops alert email via Resend REST API.
//
// Required env vars:
//   - RESEND_API_KEY: Bearer token for Resend API (error if empty)
//
// Optional env vars:
//   - CALEO_OPS_EMAIL: recipient address (default: halo@caleo.id)
//
// The "from" address is always "Caleo Ops Alert <halo@caleo.id>" — this
// domain is verified in the Resend account. Do not change without also
// updating the Resend verified domain.
func SendOpsEmail(ctx context.Context, subject, body string) error {
	return sendOpsEmailWith(ctx, subject, body, defaultOpsEmailClient)
}

func sendOpsEmailWith(ctx context.Context, subject, body string, client opsEmailSender) error {
	apiKey := os.Getenv("RESEND_API_KEY")
	if apiKey == "" {
		return fmt.Errorf("notification: RESEND_API_KEY not set")
	}
	recipient := os.Getenv("CALEO_OPS_EMAIL")
	if recipient == "" {
		recipient = "halo@caleo.id"
	}

	payload := map[string]any{
		"from":    "Caleo Ops Alert <halo@caleo.id>",
		"to":      []string{recipient},
		"subject": subject,
		"text":    body,
	}
	buf := &bytes.Buffer{}
	if err := json.NewEncoder(buf).Encode(payload); err != nil {
		return fmt.Errorf("notification: encode email payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", buf)
	if err != nil {
		return fmt.Errorf("notification: build resend request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("notification: resend request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("notification: resend API error: status=%d", resp.StatusCode)
	}
	return nil
}
