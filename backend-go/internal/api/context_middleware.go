package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/username/sinar-elektrik-backend/internal/logging"
)

// RequestContextMiddleware wraps an http.Handler and injects structured
// identity values into the request context before delegating to the inner
// handler. Three fields are extracted and stored via the logging package
// context helpers:
//
//   - request_id  — from X-Request-Id header, or a freshly generated UUID v4
//     when the header is absent. Guaranteed non-empty.
//   - tenant_id   — from the JWT "tenant_id" claim in the Authorization Bearer
//     token, or "" when the header is absent / unparseable / claim missing.
//   - user_id     — from the JWT "sub" claim, or "" under the same conditions.
//
// JWT decoding is decode-only (no signature verification) — that is already
// performed by Supabase PostgREST / RLS before any request reaches this
// backend. The only purpose here is structured log enrichment; no
// authorization decision is made from these values.
//
// Non-HTTP pollers and background goroutines that call slog.InfoContext with a
// bare context.Background() will simply emit without those fields — the
// CloudHandler omits empty strings.
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

// ExtractJWTClaims parses the middle (payload) segment of a JWT in the
// Authorization: Bearer header and returns the "tenant_id" and "sub" claims.
// Returns ("", "") on any decoding / parsing failure — callers treat "" as
// "not present" and either omit the field from logs (middleware use) or
// take a safe fallback path (handler use, e.g. return empty results instead
// of leaking cross-tenant data).
//
// No signature verification is performed here. For log enrichment this is
// fine because Supabase PostgREST / RLS already verified upstream. Handlers
// that use this for tenant scoping rely on the same upstream guarantee —
// only requests that already passed Supabase's edge auth can send a valid
// tenant_id claim.
func ExtractJWTClaims(authHeader string) (tenantID, userID string) {
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return "", ""
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", ""
	}

	// JWT uses base64url (RFC 4648 §5) without padding — use RawURLEncoding.
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", ""
	}

	var claims map[string]interface{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", ""
	}

	if v, ok := claims["tenant_id"].(string); ok {
		tenantID = v
	}
	if v, ok := claims["sub"].(string); ok {
		userID = v
	}
	return tenantID, userID
}
