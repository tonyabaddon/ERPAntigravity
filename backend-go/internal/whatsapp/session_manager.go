package whatsapp

import (
	"sync"

	"go.mau.fi/whatsmeow"
)

// SessionManager holds a per-tenant map of live *whatsmeow.Client instances.
// In the current single-tenant Cloud Run deployment there is exactly one
// registered client; the map design makes the type forward-compatible with
// multi-tenant deployments without any API change.
//
// Thread-safe: sync.Map handles concurrent Register / CheckClient calls from
// the background health-poller goroutine and the main startup path.
type SessionManager struct {
	// sessions maps tenantID → *whatsmeow.Client.
	// Sentinel key "" means "this instance serves all tenants" — used when
	// SERVES_TENANT_ID env var is absent. CheckClient then checks that single
	// client for any tenantID it is asked about.
	sessions sync.Map
}

// NewSessionManager returns an initialised (empty) SessionManager.
func NewSessionManager() *SessionManager {
	return &SessionManager{}
}

// Register associates client with tenantID. Call once per tenant at startup.
// Re-registering the same tenantID overwrites the previous value (safe for
// restart / reconnect scenarios).
func (m *SessionManager) Register(tenantID string, client *whatsmeow.Client) {
	m.sessions.Store(tenantID, client)
}

// CheckClient returns true if the WA session for tenantID is currently
// connected, and true (fail-safe) if tenantID is not registered in this
// manager.
//
// Fail-safe semantics: returning true for unknown tenants avoids false-positive
// ops alerts for tenants that are simply not served by this Cloud Run instance.
//
// Special sentinel: if the empty-string key "" is registered (single-tenant
// deployment where SERVES_TENANT_ID is unset), that client is used as the
// fallback for ANY tenantID lookup that finds no exact match.
func (m *SessionManager) CheckClient(tenantID string) bool {
	// Exact match first.
	if v, ok := m.sessions.Load(tenantID); ok {
		client, _ := v.(*whatsmeow.Client)
		return client != nil && client.IsConnected()
	}

	// Sentinel fallback: if "" is registered, this instance is the sole WA
	// handler — use its client for all tenant checks.
	if v, ok := m.sessions.Load(""); ok {
		client, _ := v.(*whatsmeow.Client)
		return client != nil && client.IsConnected()
	}

	// Tenant is not managed by this instance — return true (fail-safe, no alert).
	return true
}
