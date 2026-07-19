// Package templates contains reusable WA message template renderers.
package templates

import (
	"context"
	"fmt"
)

// ApprovalCard renders the WA button-reply approval message with
// machine-parseable approve:<id> / reject:<id> lines.
//
// This is the B1 fix: the approval_sender.go code in internal/whatsapp was
// built and tested but the call site never existed — approval WA cards were
// never sent. ApprovalCard is the template-layer representation so that Sprint 3
// template versioning can extend it without touching the send path.
//
// The card is intentionally thin: the Postgres NOTIFY payload carries only
// (approval_id, type, details) — a richer card (ActorName, ValueRp, etc.)
// would require a second DB query in the handler. Sprint 3+ can add that
// via whatsapp.FormatApprovalMessage + a DB fetch once template versioning is in.
type ApprovalCard struct{}

// TemplateID returns the stable template identifier for versioning + logs.
func (ApprovalCard) TemplateID() string { return "approval_card" }

// RequiredParams returns the parameter keys Build expects.
func (ApprovalCard) RequiredParams() []string {
	return []string{"approval_id", "type", "details"}
}

// Build renders the approval card message with the provided params.
// Required params: approval_id, type, details.
func (a ApprovalCard) Build(_ context.Context, params map[string]any) (string, error) {
	for _, k := range a.RequiredParams() {
		if _, ok := params[k]; !ok {
			return "", fmt.Errorf("approval_card: missing required param %q", k)
		}
	}
	return fmt.Sprintf(
		"⚠️ *Approval Request*\n\n*Tipe:* %v\n*Detail:* %v\n\nBalas dengan:\n`approve:%v` untuk setujui\n`reject:%v` untuk tolak",
		params["type"], params["details"], params["approval_id"], params["approval_id"],
	), nil
}
