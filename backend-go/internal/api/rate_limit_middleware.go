package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/username/sinar-elektrik-backend/internal/logging"
)

const (
	// DefaultRateLimitPerSecond is the fallback rate limit when no tenant-specific
	// config is found or the DB is unavailable. Matches the migration DEFAULT 100.
	DefaultRateLimitPerSecond = 100

	// TenantConfigCacheTTL controls how long a loaded rate limit is cached in
	// memory before the middleware re-queries the DB. This bounds the lag between
	// a tenant_subscriptions update and the middleware picking it up.
	// Known limitation: rate limit state (token bucket fill level) resets on
	// Cloud Run restart — acceptable at 10-tenant scale. Move to Redis for
	// multi-instance deploys.
	TenantConfigCacheTTL = 5 * time.Minute
)

// rateLimitBypass lists paths that must never be rate-limited.
// Cloud Run liveness and readiness probes must always succeed regardless of
// per-tenant quota — a 429 here would mark the revision unhealthy and trigger
// an unwanted rollback.
var rateLimitBypass = map[string]bool{
	"/api/v1/live":   true,
	"/api/v1/ready":  true,
	"/api/v1/health": true,
	"/api/live":      true,
	"/api/ready":     true,
	"/api/health":    true,
}

type tenantLimiter struct {
	limiter  *rate.Limiter
	loadedAt time.Time
}

// RateLimitMiddleware enforces per-tenant token-bucket rate limits.
//
// Design: in-memory sync.Map keyed by tenant_id. Config is loaded from
// tenant_subscriptions.rate_limit_per_second and cached for TenantConfigCacheTTL.
//
// The DB is accessed via a lazy getter func so the middleware can be
// constructed before the DB connection is established (the HTTP server starts
// before the DB retry loop completes). If the getter returns nil, the default
// rate limit applies.
type RateLimitMiddleware struct {
	getDB    func() *sql.DB // lazy DB getter; returns nil during startup
	limiters sync.Map       // tenantID string → *tenantLimiter
}

// NewRateLimitMiddleware creates a rate-limit middleware.
// getDB is called on each cache miss to obtain the current *sql.DB.
// It may return nil (e.g. during startup before the DB connects), in which
// case the default rate limit is used.
func NewRateLimitMiddleware(getDB func() *sql.DB) *RateLimitMiddleware {
	return &RateLimitMiddleware{getDB: getDB}
}

// Wrap returns an http.Handler that enforces per-tenant rate limits.
//
// Bypass rules (evaluated in order):
//  1. Path is in rateLimitBypass → always pass through (health probes)
//  2. No tenant_id in context (no JWT / unauthenticated) → pass through
//  3. Token bucket allows → pass through
//  4. Token bucket full → 429 with RATE_LIMIT_EXCEEDED + Retry-After: 1
func (m *RateLimitMiddleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// B4: health probe bypass — must come first, before any tenant check.
		if rateLimitBypass[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}

		tenantID := logging.TenantIDFromContext(r.Context())
		if tenantID == "" {
			// No JWT or unauthenticated request — no tenant to rate-limit.
			next.ServeHTTP(w, r)
			return
		}

		limiter := m.getLimiter(r.Context(), tenantID)
		if !limiter.Allow() {
			slog.WarnContext(r.Context(), "rate_limit_exceeded",
				slog.String("tenant_id", tenantID),
				slog.String("path", r.URL.Path),
			)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"error":   "RATE_LIMIT_EXCEEDED",
				"message": "Too many requests. Please try again shortly.",
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}

// getLimiter returns the cached limiter for tenantID, refreshing if TTL expired.
func (m *RateLimitMiddleware) getLimiter(ctx context.Context, tenantID string) *rate.Limiter {
	if v, ok := m.limiters.Load(tenantID); ok {
		tl := v.(*tenantLimiter)
		if time.Since(tl.loadedAt) < TenantConfigCacheTTL {
			return tl.limiter
		}
	}
	rps := m.loadRateConfig(ctx, tenantID)
	// Burst = 2× rate to allow short API bursts (natural for browser/mobile clients).
	lim := rate.NewLimiter(rate.Limit(rps), rps*2)
	m.limiters.Store(tenantID, &tenantLimiter{limiter: lim, loadedAt: time.Now()})
	return lim
}

// loadRateConfig fetches rate_limit_per_second for tenantID from the DB.
// Falls back to DefaultRateLimitPerSecond on any error (nil DB, query error,
// no row, or non-positive value).
func (m *RateLimitMiddleware) loadRateConfig(ctx context.Context, tenantID string) int {
	db := m.getDB()
	if db == nil {
		// DB not yet connected (startup window) — use safe default.
		return DefaultRateLimitPerSecond
	}
	var rps int
	err := db.QueryRowContext(ctx,
		`SELECT rate_limit_per_second
		 FROM tenant_subscriptions
		 WHERE tenant_id = $1
		 ORDER BY created_at DESC
		 LIMIT 1`,
		tenantID,
	).Scan(&rps)
	if err != nil {
		slog.WarnContext(ctx, "rate_limit_config_load_failed_using_default",
			slog.String("tenant_id", tenantID),
			slog.String("error", err.Error()),
		)
		return DefaultRateLimitPerSecond
	}
	if rps <= 0 {
		return DefaultRateLimitPerSecond
	}
	return rps
}
