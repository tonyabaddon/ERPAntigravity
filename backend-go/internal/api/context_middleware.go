package api

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/username/sinar-elektrik-backend/internal/logging"
)

// Supabase migrated from HS256 shared-secret signing to ES256 asymmetric
// signing keys (2026 migration; see https://supabase.com/docs/guides/auth/signing-keys).
// User session JWTs are now signed with a project-private ES256 key; the
// matching public key is published at the auth JWKS endpoint. We fetch that
// endpoint once at startup, keyfunc auto-refreshes on cache miss.
//
// This is strictly better than shared-secret verification: no secret to
// leak, no GCP Secret Manager entry to manage, and the public key rotates
// transparently.
var (
	jwtKeyfunc     jwt.Keyfunc
	jwtKeyfuncOnce sync.Once
	jwtEnabled     bool
)

func loadJWTKeyfunc() {
	jwtKeyfuncOnce.Do(func() {
		base := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
		if base == "" {
			slog.Warn("[AUTH] SUPABASE_URL is empty — JWT signature verification DISABLED. Tenant-scoped endpoints will refuse requests until this env var is set.")
			return
		}
		jwksURL := base + "/auth/v1/.well-known/jwks.json"
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		k, err := keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
		if err != nil {
			slog.Error("[AUTH] failed to load JWKS — JWT signature verification DISABLED",
				slog.String("jwks_url", jwksURL),
				slog.String("error", err.Error()))
			return
		}
		jwtKeyfunc = k.Keyfunc
		jwtEnabled = true
		slog.Info("[AUTH] JWKS loaded — JWT signature verification ENABLED",
			slog.String("jwks_url", jwksURL))
	})
}

// IsJWTVerificationEnabled returns true when the JWKS is loaded and
// signatures WILL be verified. Handlers that make security decisions on
// claim contents should call this and return 503 if false, so the operator
// gets a clear signal that JWKS load failed rather than silently accepting
// forged tokens.
func IsJWTVerificationEnabled() bool {
	loadJWTKeyfunc()
	return jwtEnabled
}

// RequestContextMiddleware wraps an http.Handler and injects structured
// identity values into the request context before delegating to the inner
// handler. Three fields are extracted and stored via the logging package
// context helpers:
//
//   - request_id  — from X-Request-Id header, or a freshly generated UUID v4
//     when the header is absent. Guaranteed non-empty.
//   - tenant_id   — from the JWT "tenant_id" claim in the Authorization Bearer
//     token, verified against the JWKS. "" if header missing / signature
//     invalid / claim missing / non-UUID.
//   - user_id     — from the JWT "sub" claim, same conditions.
func RequestContextMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// --- request_id ---------------------------------------------------
		requestID := r.Header.Get("X-Request-Id")
		if requestID == "" {
			requestID = uuid.NewString()
		}
		ctx = logging.WithRequestID(ctx, requestID)

		// --- JWT claims (tenant_id, user_id) ------------------------------
		tenantID, userID := ExtractJWTClaims(r.Header.Get("Authorization"))
		if tenantID != "" {
			ctx = logging.WithTenantID(ctx, tenantID)
		}
		if userID != "" {
			ctx = logging.WithUserID(ctx, userID)
		}

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ExtractJWTClaims verifies the JWT signature (ES256 via JWKS) in the
// Authorization Bearer header and returns the "tenant_id" and "sub" claims
// from the payload. Returns ("", "") on any of:
//   - header missing / not "Bearer " (case-insensitive per RFC 7235)
//   - malformed token
//   - signature mismatch (forged / unsigned / signed with wrong key)
//   - claim missing or non-UUID (tenant_id)
//   - JWKS not loaded (SUPABASE_URL missing at startup) — refuse to surface
//     unverified claims. Callers fall through to their empty-tenant path
//     (search returns empty, index returns 401) rather than trusting an
//     unverified value.
//
// Called from RequestContextMiddleware (log enrichment; "" → omit field) and
// from handler-scoped tenant scoping (products_search.go; "" triggers the
// accept-both fallback). Both are safe with "" — the ONLY dangerous case is
// silently trusting a claim we didn't verify, which this function refuses.
func ExtractJWTClaims(authHeader string) (tenantID, userID string) {
	loadJWTKeyfunc()
	if !jwtEnabled {
		return "", ""
	}

	// Case-insensitive "Bearer " prefix per RFC 7235 §2.1.
	if len(authHeader) < 7 || !strings.EqualFold(authHeader[:7], "Bearer ") {
		return "", ""
	}
	tokenStr := authHeader[7:]

	token, err := jwt.Parse(tokenStr, jwtKeyfunc,
		jwt.WithValidMethods([]string{"ES256"}))
	if err != nil || token == nil || !token.Valid {
		return "", ""
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", ""
	}

	// tenant_id claim must be a syntactically valid UUID. Malformed values
	// (e.g. attacker payload with tenant_id='admin') fall through to "".
	if v, ok := claims["tenant_id"].(string); ok {
		if _, perr := uuid.Parse(v); perr == nil {
			tenantID = v
		}
	}
	if v, ok := claims["sub"].(string); ok {
		userID = v
	}
	return tenantID, userID
}
