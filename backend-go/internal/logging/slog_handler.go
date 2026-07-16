// Package logging provides a Cloud Logging-compatible structured logger backed
// by the stdlib log/slog package (Go 1.21+). No external dependencies.
//
// Usage:
//
//	logging.Init()  // call once in main() before any log sites
//
// Per-request context enrichment:
//
//	ctx = logging.WithTenantID(ctx, "uuid")
//	ctx = logging.WithUserID(ctx, "uuid")
//	ctx = logging.WithRequestID(ctx, "uuid")
//	slog.InfoContext(ctx, "msg", "key", "val")
//
// The custom handler reads those values from ctx and injects them as top-level
// JSON fields so Cloud Logging can filter by jsonPayload.tenant_id="<uuid>".
//
// Cloud Logging field mapping:
//   - slog "level"  → "severity"  (with WARN→WARNING translation)
//   - slog "msg"    → "message"
//   - slog "time"   → "timestamp" (RFC 3339 nano)
//
// Non-HTTP call sites (pollers, WA event handlers) pass a background ctx —
// missing context values are silently omitted, never emitted as "".
package logging

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"time"
)

// contextKey is an unexported type for context keys in this package.
// Using a private type prevents external packages from creating collisions.
type contextKey int

const (
	keyTenantID  contextKey = iota
	keyUserID    contextKey = iota
	keyRequestID contextKey = iota
)

// WithTenantID returns a derived context that carries tenantID.
func WithTenantID(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, keyTenantID, tenantID)
}

// WithUserID returns a derived context that carries userID.
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, keyUserID, userID)
}

// WithRequestID returns a derived context that carries requestID.
func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, keyRequestID, requestID)
}

// TenantIDFromContext extracts the tenant_id stored by WithTenantID, or "".
func TenantIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(keyTenantID).(string); ok {
		return v
	}
	return ""
}

// UserIDFromContext extracts the user_id stored by WithUserID, or "".
func UserIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(keyUserID).(string); ok {
		return v
	}
	return ""
}

// RequestIDFromContext extracts the request_id stored by WithRequestID, or "".
func RequestIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(keyRequestID).(string); ok {
		return v
	}
	return ""
}

// Init configures slog.SetDefault with a Cloud Logging-compatible JSON handler
// writing to stdout. Call once at process start in main().
func Init() {
	slog.SetDefault(slog.New(NewCloudHandler(os.Stdout, nil)))
}

// CloudHandler is a slog.Handler that emits structured JSON compatible with
// Google Cloud Logging's jsonPayload ingestion. Key differences from the
// stdlib JSONHandler:
//   - "time"  → "timestamp" (RFC 3339 Nano)
//   - "level" → "severity"  (WARN→WARNING to match Cloud Logging enum)
//   - "msg"   → "message"
//   - ctx values tenant_id / user_id / request_id injected as top-level fields
//     when non-empty.
//
// Callers should use slog.InfoContext / slog.ErrorContext so ctx propagates.
type CloudHandler struct {
	w     io.Writer
	level slog.Leveler
	attrs []slog.Attr
	group string // single-level group prefix; deep nesting not needed today
}

// NewCloudHandler creates a CloudHandler that writes to w.
// opts.Level controls the minimum level; nil defaults to slog.LevelInfo.
func NewCloudHandler(w io.Writer, opts *slog.HandlerOptions) *CloudHandler {
	var lvl slog.Leveler = slog.LevelInfo
	if opts != nil && opts.Level != nil {
		lvl = opts.Level
	}
	return &CloudHandler{w: w, level: lvl}
}

// Enabled implements slog.Handler.
func (h *CloudHandler) Enabled(_ context.Context, lvl slog.Level) bool {
	return lvl >= h.level.Level()
}

// WithAttrs implements slog.Handler. Returns a new handler with extra attrs
// pre-baked — these appear in every subsequent log record.
func (h *CloudHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	n := &CloudHandler{
		w:     h.w,
		level: h.level,
		attrs: append(append([]slog.Attr(nil), h.attrs...), attrs...),
		group: h.group,
	}
	return n
}

// WithGroup implements slog.Handler.
func (h *CloudHandler) WithGroup(name string) slog.Handler {
	n := &CloudHandler{
		w:     h.w,
		level: h.level,
		attrs: append([]slog.Attr(nil), h.attrs...),
		group: name,
	}
	return n
}

// Handle implements slog.Handler. Emits one JSON object per log record.
func (h *CloudHandler) Handle(ctx context.Context, r slog.Record) error {
	// Build the JSON object in a map so order is deterministic for the
	// stable fields (severity, timestamp, message) followed by context
	// fields, followed by record attrs.
	m := make(map[string]interface{}, 8+r.NumAttrs())

	// Cloud Logging expects "severity" not "level".
	m["severity"] = cloudSeverity(r.Level)

	// Cloud Logging expects "timestamp" not "time".
	if !r.Time.IsZero() {
		m["timestamp"] = r.Time.UTC().Format(time.RFC3339Nano)
	}

	// Cloud Logging expects "message" not "msg".
	m["message"] = r.Message

	// Per-request context fields — only emitted when non-empty so poller
	// entries (which use background ctx) don't emit "tenant_id":"".
	if tid := TenantIDFromContext(ctx); tid != "" {
		m["tenant_id"] = tid
	}
	if uid := UserIDFromContext(ctx); uid != "" {
		m["user_id"] = uid
	}
	if rid := RequestIDFromContext(ctx); rid != "" {
		m["request_id"] = rid
	}

	// Pre-baked handler-level attrs (from WithAttrs).
	for _, a := range h.attrs {
		if !a.Equal(slog.Attr{}) {
			appendAttr(m, h.group, a)
		}
	}

	// Per-record attrs (from the slog call site).
	r.Attrs(func(a slog.Attr) bool {
		if !a.Equal(slog.Attr{}) {
			appendAttr(m, h.group, a)
		}
		return true
	})

	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	_, err = h.w.Write(b)
	return err
}

// appendAttr writes a single slog.Attr into m, respecting group prefix.
func appendAttr(m map[string]interface{}, group string, a slog.Attr) {
	key := a.Key
	if group != "" {
		key = group + "." + key
	}
	switch a.Value.Kind() {
	case slog.KindGroup:
		sub := make(map[string]interface{})
		for _, ga := range a.Value.Group() {
			appendAttr(sub, "", ga)
		}
		m[key] = sub
	default:
		m[key] = a.Value.Any()
	}
}

// cloudSeverity maps slog.Level to Cloud Logging severity strings.
// Reference: https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
func cloudSeverity(l slog.Level) string {
	switch {
	case l >= slog.LevelError:
		return "ERROR"
	case l >= slog.LevelWarn:
		return "WARNING" // Cloud Logging uses WARNING, not WARN
	case l >= slog.LevelInfo:
		return "INFO"
	default:
		return "DEBUG"
	}
}
