package llm

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ToneSignature captures the "voice" of Calista's first reply in a
// conversation. Persisted as conversations.first_reply_tone JSONB. On every
// subsequent call (regardless of which model handles it), BuildToneHint
// renders these fields into a prompt hint that asks the new model to match
// the original tone. Spec §5.6 #4.
type ToneSignature struct {
	Greeting  string `json:"greeting"`
	Signoff   string `json:"signoff"`
	Formality string `json:"formality"`
	Sample    string `json:"sample"`
	ModelUsed string `json:"model_used"`
}

// ExtractTone derives a ToneSignature from a Calista reply. Heuristic but
// stable — same reply always produces the same signature.
func ExtractTone(reply, modelUsed string) ToneSignature {
	reply = strings.TrimSpace(reply)
	if reply == "" {
		return ToneSignature{ModelUsed: modelUsed}
	}

	t := ToneSignature{
		Sample:    reply,
		ModelUsed: modelUsed,
		Formality: classifyFormality(reply),
	}
	t.Greeting = extractGreeting(reply)
	t.Signoff = extractSignoff(reply)
	return t
}

// MarshalToneJSON serializes a ToneSignature for DB storage (jsonb column).
func MarshalToneJSON(t ToneSignature) ([]byte, error) {
	return json.Marshal(t)
}

// UnmarshalToneJSON inverse of MarshalToneJSON, for reads from DB.
func UnmarshalToneJSON(raw []byte) (ToneSignature, error) {
	var t ToneSignature
	if len(raw) == 0 {
		return t, nil
	}
	err := json.Unmarshal(raw, &t)
	return t, err
}

// BuildToneHint renders a ToneSignature into a system-prompt fragment that
// asks the answering model to mimic the established voice. Empty if tone
// has no useful content (new conversation, first reply not yet captured).
func BuildToneHint(t ToneSignature) string {
	if t.Sample == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("This conversation's established voice (from your first reply):\n")
	if t.Greeting != "" {
		fmt.Fprintf(&b, "- Greeting style: %q\n", t.Greeting)
	}
	if t.Signoff != "" {
		fmt.Fprintf(&b, "- Sign-off style: %q\n", t.Signoff)
	}
	if t.Formality != "" {
		fmt.Fprintf(&b, "- Tone: %s\n", t.Formality)
	}
	fmt.Fprintf(&b, "- Sample turn: %q\n", t.Sample)
	b.WriteString("MATCH THIS VOICE. Reply in the same Bahasa Indonesia register.")
	return b.String()
}

// classifyFormality detects pak/bu addressing as "casual_pak_bu", "bapak/ibu"
// addressing as "formal", otherwise "neutral". Used as a coarse hint only.
func classifyFormality(reply string) string {
	lower := strings.ToLower(reply)
	if strings.Contains(lower, "bapak") || strings.Contains(lower, "ibu") {
		return "formal_bapak_ibu"
	}
	if strings.Contains(lower, " pak") || strings.Contains(lower, " bu") ||
		strings.HasSuffix(lower, "pak") || strings.HasSuffix(lower, "bu") ||
		strings.HasPrefix(lower, "pak ") || strings.HasPrefix(lower, "bu ") {
		return "casual_pak_bu"
	}
	return "neutral"
}

// extractGreeting returns the first sentence-fragment of the reply if it
// looks like a salutation (starts with "halo", "selamat", "hi", etc.).
func extractGreeting(reply string) string {
	first := reply
	if idx := strings.IndexAny(reply, "!.?"); idx > 0 {
		first = reply[:idx]
	}
	low := strings.ToLower(first)
	for _, prefix := range []string{"halo", "selamat", "hi", "hai"} {
		if strings.HasPrefix(low, prefix) {
			return strings.TrimSpace(first)
		}
	}
	return ""
}

// extractSignoff returns the last sentence if it looks like a closing
// (terima kasih, sampai jumpa, etc.). Most Calista replies have none.
func extractSignoff(reply string) string {
	low := strings.ToLower(reply)
	closings := []string{"terima kasih", "sampai jumpa", "salam"}
	for _, c := range closings {
		if idx := strings.LastIndex(low, c); idx >= 0 {
			return strings.TrimSpace(reply[idx:])
		}
	}
	return ""
}
