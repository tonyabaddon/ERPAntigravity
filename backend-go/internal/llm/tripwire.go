package llm

import (
	"regexp"
	"strings"
)

// Tripwire flag identifiers. Stored in messages.tripwire_flags and llm_calls
// status='tripwire_alert' when any fire. None of these block the reply —
// they observe-only, except FlagOptOut which has a side-effect at the
// handler layer (sets ai_active=false). Spec §5.1.
const (
	FlagReplyTooLong    = "reply_too_long"
	FlagNonWhitelistURL = "non_whitelist_url"
	FlagProfanity       = "profanity"
	FlagLanguageDrift   = "language_drift"
	FlagJailbreak       = "jailbreak"
	FlagOptOut          = "opt_out"
	FlagAIQuestion      = "ai_question"
)

const replyMaxChars = 800

// urlWhitelist is the canonical Vosi-owned-domain set. URLs to these are
// considered safe for inclusion in replies (e.g. catalog links, terms page).
// Anything else fires FlagNonWhitelistURL.
var urlWhitelist = []string{
	"vosi.id",
	"vosi.app",
	"vosi.co.id",
	"calista.vosi.id",
}

var urlPattern = regexp.MustCompile(`https?://([\w.-]+)`)

// profanityWords is intentionally short and conservative. False-positives
// here are cheap (just an alert, no blocking); false-negatives are tolerable.
// Extend over time based on tripwire-alert review.
var profanityWords = []string{
	"anjing", "asu", "bangsat", "bajingan", "kontol", "memek", "ngentot",
	"fuck", "shit", "asshole", "bitch", "damn",
}

// englishTopWords powers the language-drift heuristic. If a reply contains
// >30% of words from this list, we flag it. Heuristic, not a parser.
var englishTopWords = map[string]bool{
	"the": true, "a": true, "an": true, "is": true, "are": true,
	"was": true, "were": true, "to": true, "for": true, "with": true,
	"in": true, "on": true, "at": true, "of": true, "and": true,
	"or": true, "but": true, "if": true, "then": true, "this": true,
	"that": true, "these": true, "those": true, "you": true, "your": true,
	"i": true, "we": true, "they": true, "he": true, "she": true,
	"it": true, "do": true, "does": true, "did": true, "will": true,
	"would": true, "should": true, "can": true, "could": true,
	"hello": true, "hi": true, "thanks": true, "thank": true,
	"good": true, "bad": true, "yes": true, "no": true,
	"please": true, "price": true, "today": true, "tomorrow": true,
	"buy": true, "sell": true, "order": true, "available": true,
}

var jailbreakPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)ignore\s+(?:the\s+)?(?:previous|above|prior|all\s+prior)`),
	regexp.MustCompile(`(?i)you\s+are\s+now\s+`),
	regexp.MustCompile(`(?i)disregard\s+(?:all\s+)?(?:prior|previous|instructions)`),
	regexp.MustCompile(`(?i)system\s+prompt`),
}

var optOutPattern = regexp.MustCompile(`(?i)^(?:stop|berhenti|unsubscribe|cancel)$`)

var aiQuestionPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)apakah\s+anda\s+(?:ai|bot|robot)`),
	regexp.MustCompile(`(?i)are\s+you\s+(?:an?\s+)?(?:ai|bot|robot)`),
	regexp.MustCompile(`(?i)calista\s+(?:manusia|ai|bot)`),
}

// InspectOutbound runs all outbound-direction heuristics on a Calista reply
// and returns the set of flags that fired. An empty slice means clean.
func InspectOutbound(reply string) []string {
	var flags []string
	if len(reply) > replyMaxChars {
		flags = append(flags, FlagReplyTooLong)
	}
	if hasNonWhitelistURL(reply) {
		flags = append(flags, FlagNonWhitelistURL)
	}
	if hasProfanity(reply) {
		flags = append(flags, FlagProfanity)
	}
	if hasLanguageDrift(reply) {
		flags = append(flags, FlagLanguageDrift)
	}
	return flags
}

// InspectInbound runs all inbound-direction heuristics on a customer message.
func InspectInbound(msg string) []string {
	var flags []string
	for _, p := range jailbreakPatterns {
		if p.MatchString(msg) {
			flags = append(flags, FlagJailbreak)
			break
		}
	}
	if optOutPattern.MatchString(strings.TrimSpace(msg)) {
		flags = append(flags, FlagOptOut)
	}
	for _, p := range aiQuestionPatterns {
		if p.MatchString(msg) {
			flags = append(flags, FlagAIQuestion)
			break
		}
	}
	return flags
}

func hasNonWhitelistURL(s string) bool {
	matches := urlPattern.FindAllStringSubmatch(s, -1)
	for _, m := range matches {
		host := strings.ToLower(m[1])
		ok := false
		for _, w := range urlWhitelist {
			if host == w || strings.HasSuffix(host, "."+w) {
				ok = true
				break
			}
		}
		if !ok {
			return true
		}
	}
	return false
}

func hasProfanity(s string) bool {
	lower := strings.ToLower(s)
	for _, w := range profanityWords {
		if regexp.MustCompile(`\b` + regexp.QuoteMeta(w) + `\b`).MatchString(lower) {
			return true
		}
	}
	return false
}

func hasLanguageDrift(s string) bool {
	words := strings.Fields(strings.ToLower(s))
	if len(words) < 4 {
		return false // too short to judge meaningfully
	}
	englishCount := 0
	for _, w := range words {
		w = strings.Trim(w, ".,!?;:")
		if englishTopWords[w] {
			englishCount++
		}
	}
	return float64(englishCount)/float64(len(words)) > 0.30
}
