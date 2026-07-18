// Package sentryutil initialises Sentry error tracking for the Go backend.
//
// Call Init() once at the top of main() before any other initialisation.
// When SENTRY_DSN is absent, Init() is a complete no-op — the backend starts
// normally with slog-only error reporting. This is the expected state until
// the founder sets SENTRY_DSN in Cloud Run environment variables.
package sentryutil

import (
	"log/slog"
	"os"
	"regexp"

	"github.com/getsentry/sentry-go"
)

// piiPatterns lists regex patterns for values that must be stripped from
// Sentry events before they leave the process.
var (
	// Supabase JWT: starts with eyJ (base64 header).
	jwtRE = regexp.MustCompile(`eyJ[A-Za-z0-9_/+=-]{10,}`)
	// Indonesian WA phone numbers: 628... or 08... followed by 8-12 digits.
	waPhoneRE = regexp.MustCompile(`\b(628|08)\d{8,12}\b`)
	// PII key names whose values are redacted from Extra / Tags.
	piiKeys = map[string]bool{
		"password": true, "pin": true, "new_pin": true, "old_pin": true,
		"customer_phone": true, "nomor_hp": true,
		"customer_name": true, "nama_pelanggan": true,
		"service_role_key": true, "api_key": true,
	}
)

// scrubString redacts PII patterns from a single string value.
func scrubString(s string) string {
	s = jwtRE.ReplaceAllString(s, "[JWT_REDACTED]")
	s = waPhoneRE.ReplaceAllString(s, "[PHONE_REDACTED]")
	return s
}

// ScrubEvent removes PII from a Sentry event before transmission.
//
//   - Authorization / Cookie request headers → "[REDACTED]".
//   - Request body (may contain customer payloads) → removed entirely.
//   - JWT patterns and WA phone numbers in string values → redacted.
//   - Known PII key names in Extra and Tags → "[REDACTED]".
func ScrubEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}

	// Scrub request headers and body.
	if event.Request != nil {
		if event.Request.Headers != nil {
			for _, k := range []string{
				"Authorization", "authorization", "Cookie", "cookie",
			} {
				if _, ok := event.Request.Headers[k]; ok {
					event.Request.Headers[k] = "[REDACTED]"
				}
			}
		}
		// POST bodies may contain customer payloads — remove entirely.
		event.Request.Data = ""
	}

	// Scrub Tags map.
	if event.Tags != nil {
		for k, v := range event.Tags {
			if piiKeys[k] {
				event.Tags[k] = "[REDACTED]"
				continue
			}
			event.Tags[k] = scrubString(v)
		}
	}

	// Scrub breadcrumb messages and data.
	for i := range event.Breadcrumbs {
		if event.Breadcrumbs[i].Message != "" {
			event.Breadcrumbs[i].Message = scrubString(event.Breadcrumbs[i].Message)
		}
		if event.Breadcrumbs[i].Data != nil {
			for k, v := range event.Breadcrumbs[i].Data {
				if piiKeys[k] {
					event.Breadcrumbs[i].Data[k] = "[REDACTED]"
					continue
				}
				if s, ok := v.(string); ok {
					event.Breadcrumbs[i].Data[k] = scrubString(s)
				}
			}
		}
	}

	return event
}

// getEnvDefault returns the value of the named env var, or defaultVal when absent.
func getEnvDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

// Init initialises the Sentry SDK.
//
// Returns true when Sentry was initialised successfully; false in dormant mode
// (SENTRY_DSN absent). Callers must defer sentry.Flush(2*time.Second) in
// main() regardless — it is safe to call even when SDK was not initialised.
func Init() bool {
	dsn := os.Getenv("SENTRY_DSN")
	if dsn == "" {
		slog.Warn("[SENTRY] SENTRY_DSN not set — error tracking disabled (dormant mode)")
		return false
	}

	err := sentry.Init(sentry.ClientOptions{
		Dsn:         dsn,
		Environment: getEnvDefault("ENVIRONMENT", "production"),
		Release:     os.Getenv("COMMIT_SHA"),
		// Capture ALL backend errors — volume is bounded at current scale.
		SampleRate: 1.0,
		// 10 % of transactions for performance monitoring.
		TracesSampleRate: 0.1,
		BeforeSend:       ScrubEvent,
	})
	if err != nil {
		slog.Error("[SENTRY] init failed — error tracking disabled",
			slog.Any("error", err))
		return false
	}

	slog.Info("[SENTRY] initialized",
		slog.String("env", getEnvDefault("ENVIRONMENT", "production")),
		slog.String("release", os.Getenv("COMMIT_SHA")))
	return true
}
