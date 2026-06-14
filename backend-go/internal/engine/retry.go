package engine

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// retrySleep is package-level so tests can swap it for a no-op.
var retrySleep = time.Sleep

// RetryProcess calls machine.Process up to maxAttempts times. Between attempts it
// sleeps with exponential backoff (2s, 4s, 8s, …). If the LLM error is a
// rate-limit (HTTP 429 / RESOURCE_EXHAUSTED), it bails out immediately —
// per-minute quota does not reset within the retry window, so further attempts
// would only burn budget without recovering.
//
// onFirstFail is called exactly once when attempt 1 fails — use it to send
// a holding message to the customer.
// Returns the first successful ProcessResult, or the last failed result if all
// attempts are exhausted (LLMError will be non-nil in that case).
func RetryProcess(
	ctx context.Context,
	machine *Machine,
	conv *models.Conversation,
	text string,
	history []models.Message,
	stockContext string,
	maxAttempts int,
	onFirstFail func(),
) *ProcessResult {
	var result *ProcessResult
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		result, _ = machine.Process(ctx, conv, text, history, stockContext) // Process never returns non-nil error
		if result.LLMError == nil {
			return result
		}
		if attempt == 1 {
			onFirstFail()
		}
		// ChainExhausted means the router already tried all 10 free models and
		// gave up — retrying would re-run the same exhausted chain. Bail out
		// immediately so the handler can escalate to admin without waiting
		// for the full 51s exponential backoff (2+4+8+16+...).
		if errors.Is(result.LLMError, ErrChainExhausted) {
			return result
		}
		if isRateLimitError(result.LLMError) {
			return result
		}
		if attempt < maxAttempts {
			backoff := time.Duration(1<<attempt) * time.Second // 2s, 4s, 8s…
			select {
			case <-ctx.Done():
				return result
			default:
				retrySleep(backoff)
			}
		}
	}
	return result
}

func isRateLimitError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "429") || strings.Contains(msg, "RESOURCE_EXHAUSTED")
}
