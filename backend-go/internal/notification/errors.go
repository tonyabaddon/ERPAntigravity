// Package notification is the shared WA notification framework for the
// Caleo ERP. All application code calls this package's wrappers (NotifyCustomer,
// BroadcastToStaff, SendOpsEmail) instead of calling whatsmeow.Sender directly.
// This keeps quota enforcement, retry policy, audit trail, and typed errors
// consistent across every send site.
package notification

import "errors"

var (
	// ErrQuotaExceeded is returned when a tenant has exhausted their daily WA send quota.
	ErrQuotaExceeded = errors.New("wa notification: tenant daily quota exceeded")

	// ErrWASessionOffline is returned when the tenant's whatsmeow session is disconnected.
	ErrWASessionOffline = errors.New("wa notification: whatsmeow session offline")

	// ErrSendFailed is returned when whatsmeow.SendText returns an error.
	ErrSendFailed = errors.New("wa notification: send failed")

	// ErrTemplateRenderError is returned when a MessageBuilder cannot render the message
	// (missing required param, template syntax error, etc.).
	ErrTemplateRenderError = errors.New("wa notification: template render error")
)
