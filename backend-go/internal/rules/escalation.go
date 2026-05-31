package rules

import "strings"

type EscalationType string

const (
	EscalationNone   EscalationType = ""
	EscalationWiring EscalationType = "WIRING"
	EscalationAdmin  EscalationType = "ADMIN"
)

var wiringKeywords = []string{
	"instalasi", "grounding", "panel custom", "wiring",
	"proyek besar", "diagram", "installation", "custom panel",
}

var adminKeywords = []string{
	"diskon", "discount", "harga khusus", "special price",
	"potongan harga", "price cut",
}

// CheckEscalation scans message text for known escalation keywords.
// WIRING takes priority over ADMIN.
func CheckEscalation(text string) EscalationType {
	lower := strings.ToLower(text)
	for _, kw := range wiringKeywords {
		if strings.Contains(lower, kw) {
			return EscalationWiring
		}
	}
	for _, kw := range adminKeywords {
		if strings.Contains(lower, kw) {
			return EscalationAdmin
		}
	}
	return EscalationNone
}
