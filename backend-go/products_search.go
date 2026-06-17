package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

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

func (h *SearchHandler) logInference(ctx context.Context, kind, status string, latencyMs int64, errMsg string) {
	_, _ = h.DB.ExecContext(ctx,
		`INSERT INTO public.clip_inference_log (kind, status, latency_ms, error_msg)
		 VALUES ($1, $2, $3, NULLIF($4, ''))`,
		kind, status, latencyMs, errMsg)
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
// inference, then calls public.search_products_by_embedding to return the
// top-5 matches at similarity >= 0.70.
func (h *SearchHandler) SearchByPhoto(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

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
		h.logInference(r.Context(), "search", "cold_start_timeout", time.Since(start).Milliseconds(), err.Error())
		http.Error(w, "clip load: "+err.Error(), http.StatusServiceUnavailable)
		return
	}
	vec, err := clip.EncodeImage(data)
	if err != nil {
		h.logInference(r.Context(), "search", "error", time.Since(start).Milliseconds(), err.Error())
		http.Error(w, "encode: "+err.Error(), http.StatusInternalServerError)
		return
	}

	rows, err := h.DB.QueryContext(r.Context(),
		`SELECT sku, name, category, price, stock, min_stock, photo_url, similarity, warehouse_stock
		 FROM public.search_products_by_embedding($1::vector, 0.70, 5)`,
		vecToPg(vec))
	if err != nil {
		h.logInference(r.Context(), "search", "error", time.Since(start).Milliseconds(), err.Error())
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
			h.logInference(r.Context(), "search", "error", time.Since(start).Milliseconds(), err.Error())
			http.Error(w, "scan: "+err.Error(), http.StatusInternalServerError)
			return
		}
		row.PhotoURL = h.publicURL(photoPath)
		_ = json.Unmarshal(whJSON, &row.WarehouseStock)
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		h.logInference(r.Context(), "search", "error", time.Since(start).Milliseconds(), err.Error())
		http.Error(w, "rows iter: "+err.Error(), http.StatusInternalServerError)
		return
	}

	h.logInference(r.Context(), "search", "success", time.Since(start).Milliseconds(), "")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"results":    out,
		"latency_ms": time.Since(start).Milliseconds(),
	})
}

// IndexPhotos fetches each photo path from the public Storage bucket, encodes
// it with CLIP, and upserts the resulting embedding into
// public.stock_photo_embeddings keyed by (sku, photo_path).
func (h *SearchHandler) IndexPhotos(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	var body struct {
		SKU        string   `json:"sku"`
		PhotoPaths []string `json:"photo_paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := clip.LoadModel(clipModelPath); err != nil {
		h.logInference(r.Context(), "index", "cold_start_timeout", time.Since(start).Milliseconds(), err.Error())
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
			`INSERT INTO public.stock_photo_embeddings (sku, photo_path, embedding)
			 VALUES ($1, $2, $3::vector)
			 ON CONFLICT (sku, photo_path)
			 DO UPDATE SET embedding = EXCLUDED.embedding, indexed_at = now()`,
			body.SKU, p, vecToPg(vec))
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
	h.logInference(r.Context(), "index", status, time.Since(start).Milliseconds(), lastErr)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"sku":     body.SKU,
		"indexed": indexed,
		"error":   lastErr,
	})
}
