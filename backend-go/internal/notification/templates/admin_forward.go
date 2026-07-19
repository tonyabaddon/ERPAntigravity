// Package templates contains reusable WA message template renderers.
package templates

import (
	"context"
	"errors"
	"fmt"
)

// AdminForward is a passthrough template — the message content IS the admin's
// typed input. This is the B3 fix: the main.go LISTEN/NOTIFY handler previously
// called sender.SendText directly, skipping InsertMessage, so messages typed in
// Sales Inbox and forwarded to customers were never written to the audit trail.
// Routing through NotifyCustomer atomically persists the audit row.
type AdminForward struct{}

// TemplateID returns the stable template identifier for versioning + logs.
func (AdminForward) TemplateID() string { return "admin_forward" }

// RequiredParams returns the parameter keys Build expects.
func (AdminForward) RequiredParams() []string { return []string{"text"} }

// Build returns params["text"] as-is. No formatting is applied — the admin's
// message is forwarded verbatim to the customer.
func (AdminForward) Build(_ context.Context, params map[string]any) (string, error) {
	text, ok := params["text"].(string)
	if !ok || text == "" {
		return "", fmt.Errorf("admin_forward: missing 'text' param: %w", errors.New("missing"))
	}
	return text, nil
}
