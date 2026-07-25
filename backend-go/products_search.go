package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/api"
	"github.com/username/sinar-elektrik-backend/internal/clip"
)

const clipModelPath = "/app/models/clip-vit-base-patch32.onnx"

// SearchHandler bundles the dependencies the foto-search endpoints need —
// the Postgres pool (Supabase) for the RPC and upserts, plus the project ref
// used to build public Storage URLs for the `product-photos` bucket.
type SearchHandler struct {
	DB         *sql.DB
	ProjectRef string
}

// NewSearchHandler constructs a SearchHandler. ProjectRef is taken from
// SUPABASE_PROJECT_REF when set; otherwise it is best-effort extracted from
// SUPABASE_DB_CONNECTION (Supabase pooler usernames look like
// `postgres.<projectref>` — the substring between `postgres.` and the next
// `:` is the project ref).
func NewSearchHandler(db *sql.DB) *SearchHandler {
	ref := os.Getenv("SUPABASE_PROJECT_REF")
	if ref == "" {
		conn := os.Getenv("SUPABASE_DB_CONNECTION")
		if idx := strings.Index(conn, "postgres."); idx >= 0 {
			after := conn[idx+len("postgres."):]
			if colon := strings.Index(after, ":"); colon > 0 {
				ref = after[:colon]
			}
		}
	}
	return &SearchHandler{DB: db, ProjectRef: ref}
}

// vecToPg formats a []float32 as a Postgres pgvector literal '[0.1,0.2,...]'.
// pgvector accepts the bracket form when cast via ::vector. Six significant
// digits is enough for CLIP embeddings (which are stored as float4).
func vecToPg(v []float32) string {
	var sb strings.Builder
	sb.Grow(len(v) * 10)
	sb.WriteByte('[')
	for i, x := range v {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(strconv.FormatFloat(float64(x), 'g', 6, 32))
	}
	sb.WriteByte(']')
	return sb.String()
}

// tenantIDFromRequest pulls tenant_id from the JWT Authorization header.
// Returns "" if header missing/malformed — caller decides the safe behaviour
// (search returns empty results; index rejects with 400). This is the
// "accept-both-for-one-release" strategy: absent-JWT paths don't cross
// tenants (empty results is intentional), so no cross-tenant leak can escape
// even if a stale client hits the endpoint during the deploy window.
func tenantIDFromRequest(r *http.Request) string {
	tenantID, _ := api.ExtractJWTClaims(r.Header.Get("Authorization"))
	return tenantID
}

// logInference writes a row to public.clip_inference_log. Requires a
// non-empty tenant_id because the column is NOT NULL and the pooler user has
// no JWT context — omitting it triggers `_resolve_tenant_id()` DEFAULT which
// resolves to a sentinel UUID that isn't in `tenants`, so the FK constraint
// fires and every INSERT silently rolls back. Pass "" when tenant is unknown
// and the log entry will be skipped (documented; better than silent failure).
func (h *SearchHandler) logInference(ctx context.Context, tenantID, kind, status string, latencyMs int64, errMsg string) {
	if tenantID == "" {
		return
	}
	_, err := h.DB.ExecContext(ctx,
		`INSERT INTO public.clip_inference_log (tenant_id, kind, status, latency_ms, error_msg)
		 VALUES ($1::uuid, $2, $3, $4, NULLIF($5, ''))`,
		tenantID, kind, status, latencyMs, errMsg)
	if err != nil {
		slog.WarnContext(ctx, "[CLIP] logInference INSERT failed",
			slog.String("tenant_id", tenantID),
			slog.String("kind", kind),
			slog.String("error", err.Error()))
	}
}

// publicURL returns the Supabase Storage public URL for a path in the
// `product-photos` bucket. Falls back to the raw path when ProjectRef is
// unknown — the frontend will at least see what was stored.
func (h *SearchHandler) publicURL(path string) string {
	if h.ProjectRef == "" {
		return path
	}
	return fmt.Sprintf("https://%s.supabase.co/storage/v1/object/public/product-photos/%s", h.ProjectRef, path)
}

// SearchByPhoto accepts multipart/form-data with a `photo` field, runs CLIP
// inference, then calls public.search_products_by_embedding scoped to the
// caller's tenant_id (extracted from JWT).
//
// Missing JWT → returns empty results (no error). Intentional during the
// accept-both-for-one-release rollout: prevents cross-tenant leak if a stale
// FE bundle without JWT hits the endpoint, while not breaking the deploy.
// Follow-up commit will tighten to strict 401.
func (h *SearchHandler) SearchByPhoto(w http.ResponseWriter, r *http.Request) {
	enableCors(&w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	start := time.Now()

	tenantID := tenantIDFromRequest(r)
	if tenantID == "" {
		slog.WarnContext(r.Context(), "[CLIP] SearchByPhoto called without JWT — returning empty results",
			slog.String("remote_addr", r.RemoteAddr),
			slog.String("user_agent", r.UserAgent()))
	}

	if err := r.ParseMultipartForm(6 * 1024 * 1024); err != nil {
		http.Error(w, "parse form: "+err.Error(), http.StatusBadRequest)
		return
	}
	file, _, err := r.FormFile("photo")
	if err != nil {
		http.Error(w, "missing 'photo' field: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "read body: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if len(data) > 5*1024*1024 {
		http.Error(w, "image > 5MB", http.StatusBadRequest)
		return
	}

	if err := clip.LoadModel(clipModelPath); err != nil {
		h.logInference(r.Context(), tenantID, "search", "cold_start_timeout", time.Since(start).Milliseconds(), err.Error())
		http.Error(w, "clip load: "+err.Error(), http.StatusServiceUnavailable)
		return
	}
	vec, err := clip.EncodeImage(data)
	if err != nil {
		h.logInference(r.Context(), tenantID, "search", "error", time.Since(start).Milliseconds(), err.Error())
		http.Error(w, "encode: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// p_tenant_id filters both the embedding CTE and the stocks JOIN inside the
	// RPC. Passing NULL when tenantID is "" returns zero rows — safe default
	// for the accept-both-for-one-release strategy.
	var tenantParam sql.NullString
	if tenantID != "" {
		tenantParam = sql.NullString{String: tenantID, Valid: true}
	}
	rows, err := h.DB.QueryContext(r.Context(),
		`SELECT sku, name, category, price, stock, min_stock, photo_url, similarity, warehouse_stock
		 FROM public.search_products_by_embedding($1::vector, 0.70, 5, $2::uuid)`,
		vecToPg(vec), tenantParam)
	if err != nil {
		h.logInference(r.Context(), tenantID, "search", "error", time.Since(start).Milliseconds(), err.Error())
		http.Error(w, "search rpc: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type result struct {
		SKU            string         `json:"sku"`
		Name           string         `json:"name"`
		Category       string         `json:"category"`
		Price          float64        `json:"price"`
		Stock          int            `json:"stock"`
		MinStock       int            `json:"min_stock"`
		PhotoURL       string         `json:"photo_url"`
		Similarity     float32        `json:"similarity"`
		WarehouseStock map[string]any `json:"warehouse_stock"`
	}
	var out []result
	for rows.Next() {
		var row result
		var photoPath string
		var whJSON []byte
		if err := rows.Scan(&row.SKU, &row.Name, &row.Category, &row.Price, &row.Stock, &row.MinStock, &photoPath, &row.Similarity, &whJSON); err != nil {
			h.logInference(r.Context(), tenantID, "search", "error", time.Since(start).Milliseconds(), err.Error())
			http.Error(w, "scan: "+err.Error(), http.StatusInternalServerError)
			return
		}
		row.PhotoURL = h.publicURL(photoPath)
		_ = json.Unmarshal(whJSON, &row.WarehouseStock)
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		h.logInference(r.Context(), tenantID, "search", "error", time.Since(start).Milliseconds(), err.Error())
		http.Error(w, "rows iter: "+err.Error(), http.StatusInternalServerError)
		return
	}

	h.logInference(r.Context(), tenantID, "search", "success", time.Since(start).Milliseconds(), "")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"results":    out,
		"latency_ms": time.Since(start).Milliseconds(),
	})
}

// IndexPhotos fetches each photo path from the public Storage bucket, encodes
// it with CLIP, and upserts the resulting embedding into
// public.stock_photo_embeddings keyed by (sku, photo_path).
//
// Requires JWT — no accept-both fallback because a missing tenant_id would
// hit the `stock_photo_embeddings.tenant_id NOT NULL` constraint (same silent
// FK-violation bug that motivated this fix). Returning 400 here is
// intentional: the only caller is ProductForm.tsx which always has a
// logged-in user session.
func (h *SearchHandler) IndexPhotos(w http.ResponseWriter, r *http.Request) {
	enableCors(&w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	start := time.Now()

	tenantID := tenantIDFromRequest(r)
	if tenantID == "" {
		slog.WarnContext(r.Context(), "[CLIP] IndexPhotos called without JWT",
			slog.String("remote_addr", r.RemoteAddr),
			slog.String("user_agent", r.UserAgent()))
		http.Error(w, "unauthenticated: index-photos requires a valid JWT in Authorization header", http.StatusUnauthorized)
		return
	}

	var body struct {
		SKU        string   `json:"sku"`
		PhotoPaths []string `json:"photo_paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := clip.LoadModel(clipModelPath); err != nil {
		h.logInference(r.Context(), tenantID, "index", "cold_start_timeout", time.Since(start).Milliseconds(), err.Error())
		http.Error(w, "clip load: "+err.Error(), http.StatusServiceUnavailable)
		return
	}

	httpClient := &http.Client{Timeout: 20 * time.Second}

	indexed := 0
	var lastErr string
	for _, p := range body.PhotoPaths {
		url := h.publicURL(p)
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
		if err != nil {
			lastErr = "build request: " + err.Error()
			continue
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = "download: " + err.Error()
			continue
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			lastErr = fmt.Sprintf("download %s: HTTP %d", p, resp.StatusCode)
			continue
		}
		imgBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = "read body: " + err.Error()
			continue
		}
		vec, err := clip.EncodeImage(imgBytes)
		if err != nil {
			lastErr = "encode: " + err.Error()
			continue
		}
		_, err = h.DB.ExecContext(r.Context(),
			`INSERT INTO public.stock_photo_embeddings (tenant_id, sku, photo_path, embedding)
			 VALUES ($1::uuid, $2, $3, $4::vector)
			 ON CONFLICT (sku, photo_path)
			 DO UPDATE SET embedding = EXCLUDED.embedding, indexed_at = now()`,
			tenantID, body.SKU, p, vecToPg(vec))
		if err != nil {
			lastErr = "upsert: " + err.Error()
			continue
		}
		indexed++
	}

	status := "success"
	if lastErr != "" && indexed == 0 {
		status = "error"
	} else if lastErr != "" {
		status = "partial"
	}
	h.logInference(r.Context(), tenantID, "index", status, time.Since(start).Milliseconds(), lastErr)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"sku":     body.SKU,
		"indexed": indexed,
		"error":   lastErr,
	})
}
