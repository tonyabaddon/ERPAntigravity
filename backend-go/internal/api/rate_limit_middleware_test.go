package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"golang.org/x/time/rate"

	"github.com/username/sinar-elektrik-backend/internal/logging"
)

// okHandler is a trivial handler that always returns 200 OK.
var okHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

// ctxWithTenant returns a request whose context carries tenantID via the logging
// package (same path as RequestContextMiddleware would set).
func ctxWithTenant(r *http.Request, tenantID string) *http.Request {
	return r.WithContext(logging.WithTenantID(r.Context(), tenantID))
}

// nilDBGetter is a getDB func that always returns nil (simulates startup window).
func nilDBGetter() *sql.DB { return nil }

// TestRateLimit_BelowLimit verifies that requests below the rate limit all succeed.
func TestRateLimit_BelowLimit(t *testing.T) {
	t.Parallel()
	rl := NewRateLimitMiddleware(nilDBGetter)
	handler := rl.Wrap(okHandler)

	// With default 100 rps and burst 200, 5 requests should all succeed.
	for i := range 5 {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/some-endpoint", nil)
		req = ctxWithTenant(req, "tenant-abc")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("request %d: got %d, want 200", i, rr.Code)
		}
	}
}

// TestRateLimit_AboveLimit verifies that a burst above the configured limit
// triggers 429 with the expected JSON body and Retry-After header.
func TestRateLimit_AboveLimit(t *testing.T) {
	t.Parallel()

	// Create a limiter with rate=1 req/s, burst=2.
	// Manually populate the cache with a very tight limiter so we trigger 429.
	rl := NewRateLimitMiddleware(nilDBGetter)

	// Pre-load a limiter with rate=1, burst=2 for this tenant to force 429 quickly.
	import_rate := 1 // 1 req/s
	tl := &tenantLimiter{
		limiter:  newLimiterForTest(import_rate),
		loadedAt: time.Now(),
	}
	rl.limiters.Store("tenant-tight", tl)

	handler := rl.Wrap(okHandler)

	// Drain the 2-token burst + 1 more to hit 429.
	got429 := false
	for i := range 4 {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/some-endpoint", nil)
		req = ctxWithTenant(req, "tenant-tight")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code == http.StatusTooManyRequests {
			got429 = true
			// Verify JSON body
			var body map[string]interface{}
			if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
				t.Fatalf("request %d: 429 body not valid JSON: %v", i, err)
			}
			if body["error"] != "RATE_LIMIT_EXCEEDED" {
				t.Errorf("request %d: expected error=RATE_LIMIT_EXCEEDED, got %v", i, body["error"])
			}
			// Verify Retry-After header
			if rr.Header().Get("Retry-After") != "1" {
				t.Errorf("request %d: expected Retry-After: 1, got %q", i, rr.Header().Get("Retry-After"))
			}
		}
	}
	if !got429 {
		t.Error("expected at least one 429 response but got none")
	}
}

// TestRateLimit_HealthProbeBypass verifies that health probe paths never get
// rate-limited even when the tenant's token bucket is exhausted.
func TestRateLimit_HealthProbeBypass(t *testing.T) {
	t.Parallel()

	rl := NewRateLimitMiddleware(nilDBGetter)

	// Pre-load an exhausted limiter (rate=0 events/s, burst=0).
	exhausted := &tenantLimiter{
		limiter:  newLimiterForTest(0),
		loadedAt: time.Now(),
	}
	rl.limiters.Store("tenant-exhaust", exhausted)

	handler := rl.Wrap(okHandler)

	bypassPaths := []string{
		"/api/v1/live", "/api/v1/ready", "/api/v1/health",
		"/api/live", "/api/ready", "/api/health",
	}
	for _, path := range bypassPaths {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req = ctxWithTenant(req, "tenant-exhaust")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("path %q: expected 200 bypass, got %d", path, rr.Code)
		}
	}
}

// TestRateLimit_NoTenantIDBypass verifies that requests without a tenant_id
// (no JWT / unauthenticated) bypass rate limiting entirely.
func TestRateLimit_NoTenantIDBypass(t *testing.T) {
	t.Parallel()

	rl := NewRateLimitMiddleware(nilDBGetter)
	handler := rl.Wrap(okHandler)

	// Request with empty context (no tenant_id set).
	for i := range 5 {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/some-endpoint", nil)
		// Deliberately do NOT call ctxWithTenant — context has no tenant_id.
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("no-tenant request %d: got %d, want 200", i, rr.Code)
		}
	}
}

// TestRateLimit_IndependentTenants verifies that exhausting one tenant's bucket
// does not affect another tenant's requests.
func TestRateLimit_IndependentTenants(t *testing.T) {
	t.Parallel()

	rl := NewRateLimitMiddleware(nilDBGetter)

	// Exhaust tenant-A.
	exhaustedA := &tenantLimiter{
		limiter:  newLimiterForTest(0),
		loadedAt: time.Now(),
	}
	rl.limiters.Store("tenant-A", exhaustedA)

	// tenant-B has a healthy limiter (default via DB fallback, gets 100 rps/200 burst).
	// It will be cache-missed and created fresh — plenty of tokens.
	handler := rl.Wrap(okHandler)

	// tenant-A should get 429.
	reqA := httptest.NewRequest(http.MethodGet, "/api/v1/foo", nil)
	reqA = ctxWithTenant(reqA, "tenant-A")
	rrA := httptest.NewRecorder()
	handler.ServeHTTP(rrA, reqA)
	if rrA.Code != http.StatusTooManyRequests {
		t.Errorf("tenant-A: expected 429, got %d", rrA.Code)
	}

	// tenant-B should still get 200.
	reqB := httptest.NewRequest(http.MethodGet, "/api/v1/foo", nil)
	reqB = ctxWithTenant(reqB, "tenant-B")
	rrB := httptest.NewRecorder()
	handler.ServeHTTP(rrB, reqB)
	if rrB.Code != http.StatusOK {
		t.Errorf("tenant-B: expected 200, got %d", rrB.Code)
	}
}

// TestRateLimit_CacheExpiryReloadsConfig verifies that after the cache TTL
// elapses, a new DB call is made (the in-memory limiter is replaced).
func TestRateLimit_CacheExpiryReloadsConfig(t *testing.T) {
	t.Parallel()

	dbCallCount := 0
	mockGetDB := func() *sql.DB {
		// We don't return a real DB; we just count calls.
		// loadRateConfig will get a nil DB and use the default.
		// We track calls to this getter to verify it's invoked after TTL.
		dbCallCount++
		return nil
	}

	rl := NewRateLimitMiddleware(mockGetDB)

	// Prime the cache with an expired entry.
	expired := &tenantLimiter{
		limiter:  newLimiterForTest(DefaultRateLimitPerSecond),
		loadedAt: time.Now().Add(-TenantConfigCacheTTL - time.Second), // expired
	}
	rl.limiters.Store("tenant-ttl", expired)

	handler := rl.Wrap(okHandler)
	before := dbCallCount

	req := httptest.NewRequest(http.MethodGet, "/api/v1/endpoint", nil)
	req = ctxWithTenant(req, "tenant-ttl")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if dbCallCount == before {
		t.Error("expected DB getter to be called after TTL expiry, but it was not")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 after TTL reload, got %d", rr.Code)
	}
}

// TestRateLimit_NilDB_UsesDefault verifies that when getDB returns nil
// (startup window), the middleware falls back to DefaultRateLimitPerSecond
// and does not panic.
func TestRateLimit_NilDB_UsesDefault(t *testing.T) {
	t.Parallel()

	rl := NewRateLimitMiddleware(nilDBGetter)
	handler := rl.Wrap(okHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/endpoint", nil)
	req = ctxWithTenant(req, "tenant-nil-db")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	// With 100 rps / 200 burst and 1 request, should succeed.
	if rr.Code != http.StatusOK {
		t.Errorf("nil DB: expected 200, got %d", rr.Code)
	}
}

// newLimiterForTest creates a rate.Limiter for tests.
// rps=0 creates a limiter that immediately exhausts (no events allowed).
func newLimiterForTest(rps int) *rate.Limiter {
	if rps == 0 {
		// rate.NewLimiter with limit=0, burst=0 — no tokens ever available.
		return rate.NewLimiter(0, 0)
	}
	return rate.NewLimiter(rate.Limit(rps), rps*2)
}

// Compile-time check: ensure we import context (used in ctxWithTenant via logging).
var _ context.Context = context.Background()
