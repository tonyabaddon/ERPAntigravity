package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
)

// CSPReportHandler receives Content-Security-Policy violation reports from
// browsers. The frontend serves CSP-Report-Only pointing to this endpoint,
// so we can observe what would-be-blocked before flipping to enforce mode.
//
// Reports arrive as POST with Content-Type application/csp-report or
// application/reports+json. We accept both and log to slog — Cloud Logging
// captures the entries; can be alerted on via a log-based metric later.
//
// Task 16 gap-fix 2026-07-18. Zero-cost (self-hosted, no third-party SaaS).
//
// Wire in main.go with:
//   mux.HandleFunc("/security/csp-report", api.CSPReportHandler)
//
// Then update serve.json CSP to include:
//   report-uri https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/security/csp-report
func CSPReportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Read body (cap at 8KB — CSP reports are small; anything larger is abuse).
	body, err := io.ReadAll(io.LimitReader(r.Body, 8192))
	if err != nil {
		slog.WarnContext(r.Context(), "[CSP-REPORT] body read failed",
			slog.String("error", err.Error()))
		w.WriteHeader(http.StatusNoContent)
		return
	}
	defer r.Body.Close()

	// Try to parse as JSON for structured logging. If parse fails, log raw.
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err == nil {
		slog.WarnContext(r.Context(), "[CSP-REPORT] violation",
			slog.Any("report", parsed),
			slog.String("user_agent", r.UserAgent()),
			slog.String("referer", r.Referer()))
	} else {
		slog.WarnContext(r.Context(), "[CSP-REPORT] violation (unparseable)",
			slog.String("raw", string(body)),
			slog.String("user_agent", r.UserAgent()))
	}

	// Respond 204 — browsers ignore response body for reports.
	w.WriteHeader(http.StatusNoContent)
}
