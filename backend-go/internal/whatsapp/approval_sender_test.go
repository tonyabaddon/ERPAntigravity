package whatsapp

import (
	"strings"
	"testing"
)

func TestFormatApprovalMessage_AdjustmentRusak(t *testing.T) {
	got := FormatApprovalMessage(ApprovalPayload{
		ID:           42,
		RequestType:  "adjustment",
		ActorName:    "Andi",
		ItemSummary:  "TEST-IMM Kabel NYM 3×2.5",
		Detail:       "Atas −3 unit",
		Reason:       "rusak: kena air",
		ValueRp:      9000,
		EvidenceLink: "https://example.com/foo.jpg",
	})
	for _, want := range []string{"Approval", "adjustment", "Andi", "TEST-IMM",
		"Atas −3 unit", "rusak", "9.000", "Setujui", "Tolak", "approve:42", "reject:42"} {
		if !strings.Contains(got, want) {
			t.Fatalf("output missing %q\n--- got ---\n%s", want, got)
		}
	}
}
