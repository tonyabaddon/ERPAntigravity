// Package templates contains reusable WA message template renderers.
// Each template is a stateless struct with a Build method that renders a
// parameterised string from a map of named values.
package templates

import (
	"context"
	"fmt"
	"strings"
)

// HeartbeatDigest renders the daily business summary sent to owners.
// Currently id-only; en variant deferred to Phase 3 (spec Section 3 non-goals).
type HeartbeatDigest struct{}

// TemplateID returns the stable template identifier for versioning + logs.
func (HeartbeatDigest) TemplateID() string { return "heartbeat_digest" }

// RequiredParams returns the parameter keys Build expects.
func (HeartbeatDigest) RequiredParams() []string {
	return []string{"tanggal", "omset_hari", "laba_hari", "low_stock_count"}
}

// Build renders the heartbeat digest with the provided params.
// Required params: tanggal (string), omset_hari (int/int64/float64),
// laba_hari (int/int64/float64), low_stock_count (int).
// Optional: low_stock_items ([]string) — low-stock section rendered only when present and non-empty.
func (h HeartbeatDigest) Build(_ context.Context, params map[string]any) (string, error) {
	for _, k := range h.RequiredParams() {
		if _, ok := params[k]; !ok {
			return "", fmt.Errorf("heartbeat_digest: missing required param %q", k)
		}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "📊 *Ringkasan Hari Ini — %s*\n\n", params["tanggal"])
	fmt.Fprintf(&b, "💰 Omset: Rp %s\n", formatRp(params["omset_hari"]))
	fmt.Fprintf(&b, "💵 Laba: Rp %s\n", formatRp(params["laba_hari"]))

	if items, ok := params["low_stock_items"].([]string); ok && len(items) > 0 {
		fmt.Fprintf(&b, "\n⚠️ *Stok Menipis* (%v):\n", params["low_stock_count"])
		for _, item := range items {
			fmt.Fprintf(&b, "• %s\n", item)
		}
	}

	return b.String(), nil
}

// formatRp formats an int/int64/float64 rupiah value with id-ID thousand separator.
// e.g., 5000000 → "5.000.000"
func formatRp(v any) string {
	var n int64
	switch x := v.(type) {
	case int:
		n = int64(x)
	case int64:
		n = x
	case float64:
		n = int64(x)
	default:
		return fmt.Sprint(v)
	}
	s := fmt.Sprint(n)
	if n < 1000 {
		return s
	}
	// Insert thousands separator (id-ID uses ".")
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, c)
	}
	return string(out)
}
