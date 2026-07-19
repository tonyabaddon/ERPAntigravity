package caleobot

import "strings"

type FaqEntry struct {
	ID       string
	Keywords []string
	Response string
	NextStep string
}

type FaqMatcher struct{ faqs []FaqEntry }

func NewFaqMatcher(faqs []FaqEntry) *FaqMatcher { return &FaqMatcher{faqs: faqs} }

func (m *FaqMatcher) Match(input string) (FaqEntry, bool) {
	normalized := strings.ToLower(strings.TrimSpace(input))
	inputWords := strings.Fields(normalized)

	var best FaqEntry
	bestScore := 0
	for _, faq := range m.faqs {
		score := 0
		for _, kw := range faq.Keywords {
			kwLower := strings.ToLower(kw)
			if strings.Contains(normalized, kwLower) {
				score += 10
				continue
			}
			for _, iw := range inputWords {
				if len(kwLower) >= 4 && levenshtein(iw, kwLower) <= 2 {
					score += 5
				}
			}
		}
		if score > bestScore {
			bestScore = score
			best = faq
		}
	}
	if bestScore < 5 {
		return FaqEntry{}, false
	}
	return best, true
}

func levenshtein(a, b string) int {
	if len(a) == 0 {
		return len(b)
	}
	if len(b) == 0 {
		return len(a)
	}
	prev := make([]int, len(b)+1)
	curr := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		curr[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			curr[j] = min3(curr[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev, curr = curr, prev
	}
	return prev[len(b)]
}

func min3(a, b, c int) int {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}
