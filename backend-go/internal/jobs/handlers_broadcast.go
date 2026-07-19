// backend-go/internal/jobs/handlers_broadcast.go
//
// Job handlers for deferred broadcast jobs (Sprint 5.2b / Errata 3):
//   - broadcast_quiet_delay: re-fires a BroadcastToStaff call the morning
//     after quiet hours have passed.
//   - broadcast_consolidated: renders N held messages into a single WA send.
//
// Both handlers pass InternalBroadcastCtx so BroadcastToStaff skips its own
// quiet-hours / consolidation check (recursion guard).
package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/notification"
)

// NewBroadcastQuietDelayHandler returns a JobHandler for 'broadcast_quiet_delay'.
//
// Payload shape:
//
//	{
//	  "tenant_id": "<uuid>",
//	  "msg":       "<text>",
//	  "filter":    {"Role":"", "CritLevel":""}
//	}
//
// The handler calls BroadcastToStaff with the internal-broadcast marker so
// quiet-hours / consolidation logic is bypassed on the outbound send.
func NewBroadcastQuietDelayHandler(notifier *notification.Notifier) JobHandler {
	return func(ctx context.Context, tenantID string, payload json.RawMessage) (json.RawMessage, error) {
		var p struct {
			TenantID string                     `json:"tenant_id"`
			Msg      string                     `json:"msg"`
			Filter   notification.RecipientFilter `json:"filter"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return nil, fmt.Errorf("broadcast_quiet_delay: bad payload: %w", err)
		}
		if p.TenantID == "" {
			return nil, fmt.Errorf("broadcast_quiet_delay: missing tenant_id in payload")
		}
		if p.Msg == "" {
			return nil, fmt.Errorf("broadcast_quiet_delay: missing msg in payload")
		}

		log := slog.Default().With(
			slog.String("job_type", "broadcast_quiet_delay"),
			slog.String("tenant_id", p.TenantID),
		)
		log.InfoContext(ctx, "executing deferred quiet-hours broadcast")

		// Use InternalBroadcastCtx to bypass quiet-hours re-check.
		internalCtx := notification.InternalBroadcastCtx(ctx)
		if err := notifier.BroadcastToStaff(internalCtx, p.TenantID, p.Filter, p.Msg); err != nil {
			return nil, fmt.Errorf("broadcast_quiet_delay: send failed: %w", err)
		}

		log.InfoContext(ctx, "deferred broadcast sent successfully")
		return json.RawMessage(`{"status":"SENT"}`), nil
	}
}

// NewBroadcastConsolidatedHandler returns a JobHandler for 'broadcast_consolidated'.
//
// Payload shape:
//
//	{
//	  "tenant_id":  "<uuid>",
//	  "window_sec": 300,
//	  "messages":   ["m1", "m2", ...]
//	}
//
// Renders messages as:
//
//	"N kejadian dalam W menit terakhir:\n\n1. m1\n\n2. m2\n\n..."
//
// Then calls BroadcastToStaff with the internal-broadcast marker.
func NewBroadcastConsolidatedHandler(notifier *notification.Notifier) JobHandler {
	return func(ctx context.Context, tenantID string, payload json.RawMessage) (json.RawMessage, error) {
		var p struct {
			TenantID  string   `json:"tenant_id"`
			WindowSec int      `json:"window_sec"`
			Messages  []string `json:"messages"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return nil, fmt.Errorf("broadcast_consolidated: bad payload: %w", err)
		}
		if p.TenantID == "" {
			return nil, fmt.Errorf("broadcast_consolidated: missing tenant_id in payload")
		}
		if len(p.Messages) == 0 {
			// Nothing to send — treat as success.
			slog.InfoContext(ctx, "broadcast_consolidated: empty messages array, skipping",
				slog.String("tenant_id", p.TenantID))
			return json.RawMessage(`{"status":"SKIPPED","reason":"empty_messages"}`), nil
		}

		log := slog.Default().With(
			slog.String("job_type", "broadcast_consolidated"),
			slog.String("tenant_id", p.TenantID),
			slog.Int("message_count", len(p.Messages)),
		)
		log.InfoContext(ctx, "executing consolidated broadcast")

		windowMin := p.WindowSec / 60
		if windowMin < 1 {
			windowMin = 1
		}

		combined := renderConsolidated(p.Messages, windowMin)

		internalCtx := notification.InternalBroadcastCtx(ctx)
		filter := notification.RecipientFilter{} // broadcast to all staff/owner
		if err := notifier.BroadcastToStaff(internalCtx, p.TenantID, filter, combined); err != nil {
			return nil, fmt.Errorf("broadcast_consolidated: send failed: %w", err)
		}

		log.InfoContext(ctx, "consolidated broadcast sent successfully")
		return json.RawMessage(fmt.Sprintf(`{"status":"SENT","message_count":%d}`, len(p.Messages))), nil
	}
}

// renderConsolidated formats N messages into the Indonesian consolidated alert format.
//
//	"N kejadian dalam W menit terakhir:\n\n1. m1\n\n2. m2\n\n..."
func renderConsolidated(messages []string, windowMinutes int) string {
	var sb strings.Builder
	n := len(messages)
	sb.WriteString(fmt.Sprintf("%d kejadian dalam %d menit terakhir:\n", n, windowMinutes))
	for i, m := range messages {
		sb.WriteString(fmt.Sprintf("\n%d. %s", i+1, m))
		if i < n-1 {
			sb.WriteString("\n")
		}
	}
	return sb.String()
}
