package engine

import (
	"context"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// RetryProcess calls machine.Process up to maxAttempts times (each with the
// 10-second timeout already baked into gemini.GenerateReply).
// onFirstFail is called exactly once when attempt 1 fails — use it to send
// a holding message to the customer.
// Returns the first successful ProcessResult, or the last failed result if all
// attempts are exhausted (GeminiError will be non-nil in that case).
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
		if result.GeminiError == nil {
			return result
		}
		if attempt == 1 {
			onFirstFail()
		}
	}
	return result
}
