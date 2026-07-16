package api

import (
	"log/slog"
	"net/http"
	"strings"
)

// VersionRouter wraps an existing http.Handler (typically *http.ServeMux with
// routes registered at /api/*) and accepts both:
//
//   - /api/v1/*  — canonical versioned path; rewrites to /api/* before
//     delegating to inner so route registration is unchanged.
//   - /api/*     — legacy path; delegates as-is but adds
//     X-Deprecated-Path response header and emits a slog warning.
//
// Any other path gets a 404. This lets us lock the /api/v1/* contract for
// tenant #2 while keeping /api/* alive for backward compat during 1 release
// cycle (sunset: 2027-Q3).
func VersionRouter(inner http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		switch {
		case strings.HasPrefix(path, "/api/v1/"):
			// Strip the version segment: /api/v1/health → /api/health
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/api/" + path[len("/api/v1/"):]
			inner.ServeHTTP(w, r2)

		case strings.HasPrefix(path, "/api/"):
			// Legacy path: serve as-is, but signal deprecation.
			canonical := "/api/v1/" + path[len("/api/"):]
			w.Header().Set("X-Deprecated-Path", canonical)
			slog.WarnContext(r.Context(), "legacy API path used",
				slog.String("path", path),
				slog.String("use_instead", canonical),
			)
			inner.ServeHTTP(w, r)

		default:
			http.NotFound(w, r)
		}
	})
}
