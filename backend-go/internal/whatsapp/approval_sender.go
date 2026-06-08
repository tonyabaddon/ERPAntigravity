package whatsapp

import (
	"context"
	"fmt"
	"strings"

	"github.com/dustin/go-humanize"
)

// ApprovalPayload is the minimal flattened view of an approval request used to
// render the WA approval card. Callers in internal/approvals build this from
// the request_type-specific payload schema (adjustment, opname, price_change,
// kasir_*) so this package stays request-type agnostic.
type ApprovalPayload struct {
	ID           int64
	RequestType  string
	ActorName    string
	ItemSummary  string
	Detail       string
	Reason       string
	ValueRp      float64
	EvidenceLink string
}

// FormatApprovalMessage renders the Indonesian-language approval card for WA.
// The output includes machine-parseable button payloads `approve:<id>` and
// `reject:<id>` on the last two lines — the WA webhook (Task 18) parses these.
func FormatApprovalMessage(p ApprovalPayload) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "🔐 Approval — %s\n", p.RequestType)
	fmt.Fprintf(&sb, "Karyawan: %s\n", p.ActorName)
	fmt.Fprintf(&sb, "Item: %s\n", p.ItemSummary)
	fmt.Fprintf(&sb, "Detail: %s\n", p.Detail)
	fmt.Fprintf(&sb, "Alasan: %s\n", p.Reason)
	if p.ValueRp != 0 {
		// humanize.CommafWithDigits uses "," as the thousand separator.
		// Indonesian convention is "." — convert the formatted number only
		// (we splice it in already-localised so the rest of the message,
		// which has no commas yet, is untouched).
		nilai := strings.ReplaceAll(humanize.CommafWithDigits(p.ValueRp, 0), ",", ".")
		fmt.Fprintf(&sb, "Nilai: Rp %s\n", nilai)
	}
	if p.EvidenceLink != "" {
		fmt.Fprintf(&sb, "Bukti: %s\n", p.EvidenceLink)
	}
	fmt.Fprintf(&sb, "\nBalas:\n[✓ Setujui] approve:%d\n[✗ Tolak] reject:%d\n", p.ID, p.ID)
	return sb.String()
}

// SendApprovalRequest formats and sends an approval WA message to the given JID.
// Returns the underlying SendText error (which already wraps the JID for
// diagnostics). Multi-owner fanout is the caller's responsibility — this stays
// per-recipient so per-Owner failures don't poison the whole broadcast.
func (s *Sender) SendApprovalRequest(ctx context.Context, ownerJID string, p ApprovalPayload) error {
	return s.SendText(ctx, ownerJID, FormatApprovalMessage(p))
}
