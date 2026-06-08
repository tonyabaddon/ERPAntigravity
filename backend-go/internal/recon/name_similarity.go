// backend-go/internal/recon/name_similarity.go
package recon

import (
	"strings"

	"github.com/agnivade/levenshtein"
)

var namePrefixes = []string{"PT ", "CV ", "BPK ", "BAPAK ", "IBU ", "BU ", "MR ", "MRS ", "MS "}
var nameSuffixes = []string{" TBK", " CV", " PT"}

// NormalizeName uppercases, strips business prefixes/suffixes, and collapses whitespace.
func NormalizeName(s string) string {
	u := strings.ToUpper(strings.TrimSpace(s))
	changed := true
	for changed {
		changed = false
		for _, p := range namePrefixes {
			if strings.HasPrefix(u, p) {
				u = strings.TrimSpace(strings.TrimPrefix(u, p))
				changed = true
			}
		}
		for _, sfx := range nameSuffixes {
			if strings.HasSuffix(u, sfx) {
				u = strings.TrimSpace(strings.TrimSuffix(u, sfx))
				changed = true
			}
		}
	}
	// Collapse multi-space
	return strings.Join(strings.Fields(u), " ")
}

// NameSimilarity returns 0.0-1.0. 1.0 = identical after normalization.
func NameSimilarity(a, b string) float64 {
	na, nb := NormalizeName(a), NormalizeName(b)
	if na == "" || nb == "" {
		return 0
	}
	if na == nb {
		return 1.0
	}
	// Check word-set similarity (order-insensitive)
	if wordSetEqual(na, nb) {
		return 0.95
	}
	dist := levenshtein.ComputeDistance(na, nb)
	maxLen := len(na)
	if len(nb) > maxLen {
		maxLen = len(nb)
	}
	if maxLen == 0 {
		return 0
	}
	return 1.0 - float64(dist)/float64(maxLen)
}

func wordSetEqual(a, b string) bool {
	fa, fb := strings.Fields(a), strings.Fields(b)
	if len(fa) != len(fb) {
		return false
	}
	seen := map[string]int{}
	for _, w := range fa {
		seen[w]++
	}
	for _, w := range fb {
		seen[w]--
		if seen[w] < 0 {
			return false
		}
	}
	return true
}
