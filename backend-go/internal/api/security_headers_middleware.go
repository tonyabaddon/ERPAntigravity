package api

import "net/http"

// SecurityHeadersMiddleware adds baseline security headers to every response.
// Applies to all HTTP responses from the Go backend (JSON API + health probes).
//
// Kept minimal (no CSP) since the backend serves JSON, not HTML. CSP is enforced
// on the frontend Cloud Run via serve.json. See docs/superpowers/specs/
// 2026-07-18-task-16-security-headers-design.md for the wider rollout.
//
// Task 16 gap-fix 2026-07-18: audit surfaced backend had zero security headers.
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		// 2-year HSTS, includeSubDomains, preload-ready — matches FE Cloud Run
		// so caleo.id-wide HSTS story is consistent across all origins.
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
		// Prevent MIME sniffing on JSON/error responses.
		h.Set("X-Content-Type-Options", "nosniff")
		// Reject cross-origin framing (defense-in-depth even for JSON API).
		h.Set("X-Frame-Options", "DENY")
		// Cross-origin sends origin only, no path/query — matches FE policy.
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// Deny unused browser features (defensive — backend serves no HTML,
		// but if a client accidentally renders API response as HTML, block).
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")

		next.ServeHTTP(w, r)
	})
}
