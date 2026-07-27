package api

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/username/sinar-elektrik-backend/internal/logging"
)

// jwtSecret is loaded once from SUPABASE_JWT_SECRET on first use. Empty
// means signature verification is DISABLED — callers that use claims for
// security decisions MUST check IsJWTVerificationEnabled() and fail-closed
// when it returns false.
//
// The startup-time secret load is lazy (init loop can run before
// os.Getenv is authoritative in some hosts, and we want tests to be able to
// override via env). Sync.Once memoises after the first ExtractJWTClaims
// call.
var (
	jwtSecret     []byte
	jwtSecretOnce sync.Once
	jwtEnabled    bool
)

func loadJWTSecret() {
	jwtSecretOnce.Do(func() {
		v := os.Getenv("SUPABASE_JWT_SECRET")
		if v == "" {
			slog.Warn("[AUTH] SUPABASE_JWT_SECRET is empty — JWT signature verification DISABLED. Tenant-scoped endpoints will refuse requests until this secret is set.")
			return
		}
		jwtSecret = []byte(v)
		jwtEnabled = true
	})
}

// IsJWTVerificationEnabled returns true when the JWT secret is loaded and
// signatures WILL be verified. Handlers that make security decisions on
// claim contents should call this and return 503 if false, so the operator
// gets a clear signal that the secret is missing rather than silently
// accepting forged tokens.
func IsJWTVerificationEnabled() bool {
	loadJWTSecret()
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
//     token, or "" when the header is absent / signature invalid / claim missing.
//   - user_id     — from the JWT "sub" claim, or "" under the same conditions.
//
// When SUPABASE_JWT_SECRET is set, the JWT signature is verified with HS256
// before claims are read — an unsigned or forged token yields ("", "").
// When the secret is empty (misconfiguration), the middleware still populates
// request_id but skips the JWT parse; tenant-scoped handlers must call
// IsJWTVerificationEnabled() and fail-closed.
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

// ExtractJWTClaims verifies the JWT signature (HS256) in the Authorization
// Bearer header against SUPABASE_JWT_SECRET, then returns the "tenant_id"
// and "sub" claims from the payload. Returns ("", "") on any of:
//   - header missing / not "Bearer " (case-insensitive per RFC 7235)
//   - malformed token
//   - signature mismatch (forged or unsigned token)
//   - claim missing or non-UUID (tenant_id)
//   - secret not configured (jwtEnabled=false) — safest default: refuse to
//     surface claims when we can't verify them, so callers fall through to
//     their empty-tenant path (return empty results / 401) rather than
//     trusting an unverified value.
//
// This function is called from:
//   - RequestContextMiddleware: for log enrichment ("" → omit field)
//   - handler-scoped tenant scoping (e.g. products_search.go): "" triggers
//     the accept-both fallback (search returns empty, index returns 401)
//
// Both call sites are safe with "" when the secret is missing — the ONLY
// dangerous case is silently trusting a claim we didn't verify, which this
// function refuses to do.
func ExtractJWTClaims(authHeader string) (tenantID, userID string) {
	loadJWTSecret()
	if !jwtEnabled {
		return "", ""
	}

	// Case-insensitive "Bearer " prefix per RFC 7235 §2.1.
	if len(authHeader) < 7 || !strings.EqualFold(authHeader[:7], "Bearer ") {
		return "", ""
	}
	tokenStr := authHeader[7:]

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
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
