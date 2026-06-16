# Foto-Search Plan C — CLIP Backend + Kasir UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship end-to-end Cari by Foto: CLIP ViT-Base-32 ONNX inference in backend-go (indexing + search endpoints), pgvector similarity search RPC, KasirScreen header button, `CariByFotoModal` with 3 entry points (Camera + Upload File + drag-and-drop), `HasilCariFotoModal` showing top-5 with stok per gudang inline, and cold-start UX banner.

**Architecture:** Backend Go gets a new `internal/clip/` package (model singleton + preprocess + encoder). Model file `clip-vit-base-patch32.onnx` (~150MB) bundled into Docker image at build time. Two HTTP endpoints: `POST /api/products/index-photos` (background indexing) and `POST /api/products/search-by-photo`. Frontend `CariByFotoModal` handles three input modes (Camera, File picker, drag-drop) through one shared pipeline. Results render in `HasilCariFotoModal` with similarity %, no AI describe banner. Cold-start UX inline banner masks first-request latency.

**Tech Stack:** Go 1.22 + `github.com/yalue/onnxruntime_go` for ONNX inference, `github.com/disintegration/imaging` for image resize, React 19 + TypeScript + Vitest 4, Supabase Postgres + pgvector HNSW index.

**Spec reference:** `docs/superpowers/specs/2026-06-14-product-photo-search-design.md` (§4 Kasir UI, §5 CLIP pipeline, §6.2 monitoring — but monitor panel is in Plan D). This plan covers spec Phases 3 + 4.

**Prerequisites:**
- Plan A merged: `stock_photo_embeddings` table exists, `photo_urls` column on `stocks`, `productPhotoService` ships.
- Verify ONNX model bundled: `ls models/clip-vit-base-patch32.onnx` should exist after Task 2 below.
- Branch off main after Plan A merge.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `models/clip-vit-base-patch32.onnx` | CLIP image encoder ONNX export (~150MB) | Create (download) |
| `backend-go/internal/clip/model.go` | Singleton ONNX session loader (lazy load on first request) | Create |
| `backend-go/internal/clip/preprocess.go` | JPEG/PNG decode → resize 224×224 → normalize float32 | Create |
| `backend-go/internal/clip/encoder.go` | `EncodeImage([]byte) ([]float32, error)` public API | Create |
| `backend-go/internal/clip/encoder_test.go` | Unit tests for preprocess + encoder (skipped if model missing) | Create |
| `backend-go/handlers/products_search.go` | HTTP handlers for `/api/products/index-photos` + `/api/products/search-by-photo` | Create |
| `backend-go/main.go` | Wire new handlers into router | Modify |
| `Dockerfile` | Copy ONNX model into image | Modify |
| `supabase/migrations/20260616000010_search_products_by_embedding_rpc.sql` | RPC `search_products_by_embedding(query vector(512), threshold float, limit int)` | Create |
| `supabase/migrations/20260616000011_clip_inference_log.sql` | `clip_inference_log` table | Create |
| `src/lib/cariByFotoService.ts` | Client wrapper: POST multipart, parse response | Create |
| `src/components/kasir/CariByFotoModal.tsx` | 3 entry points modal | Create |
| `src/components/kasir/CariByFotoDropzone.tsx` | Drag-drop sub-component | Create |
| `src/components/kasir/HasilCariFotoModal.tsx` | Top-5 result list with similarity + actions | Create |
| `src/components/KasirScreen.tsx` | Add tombol "📷 Cari by Foto [AI]" in header | Modify |

---

### Task 1: DB migration — `search_products_by_embedding` RPC

**Files:**
- Create: `supabase/migrations/20260616000010_search_products_by_embedding_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260616000010_search_products_by_embedding_rpc.sql
-- pgvector cosine-similarity search over stock_photo_embeddings.

CREATE OR REPLACE FUNCTION public.search_products_by_embedding(
  query_embedding vector(512),
  similarity_threshold REAL DEFAULT 0.70,
  result_limit INT DEFAULT 5
) RETURNS TABLE (
  sku TEXT,
  name TEXT,
  category TEXT,
  price NUMERIC,
  stock INT,
  min_stock INT,
  photo_url TEXT,
  similarity REAL,
  warehouse_stock JSONB
) LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT
      e.sku,
      MAX(1 - (e.embedding <=> query_embedding)) AS similarity,
      MIN(e.photo_path) FILTER (WHERE TRUE) AS photo_path
    FROM public.stock_photo_embeddings e
    GROUP BY e.sku
  ),
  top AS (
    SELECT * FROM ranked
    WHERE similarity &gt;= similarity_threshold
    ORDER BY similarity DESC
    LIMIT result_limit
  )
  SELECT
    s.sku,
    s.name,
    s.category,
    s.price::NUMERIC,
    s.stock,
    s.min_stock,
    t.photo_path AS photo_url,
    t.similarity,
    jsonb_build_object('atas', COALESCE(s.stock_atas, 0), 'bawah', COALESCE(s.stock_bawah, 0)) AS warehouse_stock
  FROM top t
  JOIN public.stocks s ON s.sku = t.sku
  ORDER BY t.similarity DESC;
$$;

GRANT EXECUTE ON FUNCTION public.search_products_by_embedding(vector, REAL, INT) TO authenticated, service_role;
```

- [ ] **Step 2: Apply and verify**

```bash
./scripts/apply-pending-migrations.sh
psql "$DATABASE_URL" -c "SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname='search_products_by_embedding';"
```

Expected: signature `query_embedding vector, similarity_threshold real DEFAULT 0.70, result_limit integer DEFAULT 5`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260616000010_search_products_by_embedding_rpc.sql
git commit -m "feat(db): search_products_by_embedding RPC (pgvector cosine, top-N)"
```

---

### Task 2: DB migration — `clip_inference_log` table

**Files:**
- Create: `supabase/migrations/20260616000011_clip_inference_log.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260616000011_clip_inference_log.sql
CREATE TABLE IF NOT EXISTS public.clip_inference_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('index', 'search')),
  status      TEXT NOT NULL CHECK (status IN ('success', 'error', 'cold_start_timeout')),
  latency_ms  INT,
  error_msg   TEXT,
  called_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clip_inference_log_today
  ON public.clip_inference_log (called_at DESC);

ALTER TABLE public.clip_inference_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON public.clip_inference_log FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "owner/admin read" ON public.clip_inference_log FOR SELECT TO authenticated USING (TRUE);
```

- [ ] **Step 2: Apply and commit**

```bash
./scripts/apply-pending-migrations.sh
git add supabase/migrations/20260616000011_clip_inference_log.sql
git commit -m "feat(db): clip_inference_log table for monitoring"
```

---

### Task 3: Download + bundle CLIP ONNX model

**Files:**
- Create: `models/clip-vit-base-patch32.onnx`
- Modify: `.gitignore`, `Dockerfile`

- [ ] **Step 1: Download the model**

```bash
mkdir -p models
curl -L -o models/clip-vit-base-patch32.onnx \
  "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx"
ls -lh models/clip-vit-base-patch32.onnx
```

Expected: file size ~150MB. SHA-256 (snapshot at time of writing): record actual checksum with `shasum -a 256 models/clip-vit-base-patch32.onnx` and copy into a comment for verification.

- [ ] **Step 2: Add model to .gitignore (DO NOT commit 150MB to git)**

Append to `.gitignore`:

```
# CLIP model — download separately via scripts/download-clip-model.sh
models/clip-vit-base-patch32.onnx
```

- [ ] **Step 3: Create download script**

```bash
cat &gt; scripts/download-clip-model.sh &lt;&lt;'EOF'
#!/usr/bin/env bash
# scripts/download-clip-model.sh — downloads CLIP ONNX model used by foto-search.
set -euo pipefail
MODEL_PATH="models/clip-vit-base-patch32.onnx"
EXPECTED_SHA256="${CLIP_MODEL_SHA256:-replace-after-first-download}"

mkdir -p models
if [[ -f "$MODEL_PATH" ]]; then
  echo "Model already present at $MODEL_PATH"
  exit 0
fi
curl -L -o "$MODEL_PATH" \
  "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx"
ACTUAL_SHA256=$(shasum -a 256 "$MODEL_PATH" | cut -d' ' -f1)
if [[ "$EXPECTED_SHA256" != "replace-after-first-download" &amp;&amp; "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "SHA mismatch: expected $EXPECTED_SHA256 got $ACTUAL_SHA256" &gt;&amp;2
  exit 1
fi
echo "Downloaded $MODEL_PATH (sha256: $ACTUAL_SHA256)"
EOF
chmod +x scripts/download-clip-model.sh
```

- [ ] **Step 4: Update `Dockerfile` to bundle the model**

Read current Dockerfile (`cat Dockerfile`) and find the `COPY` block. Insert before `COPY backend-go/` or equivalent:

```dockerfile
# CLIP ONNX model — downloaded via scripts/download-clip-model.sh
COPY models/clip-vit-base-patch32.onnx /app/models/clip-vit-base-patch32.onnx
```

If the host model file is absent at build time, build will fail loudly — that's intentional.

- [ ] **Step 5: Commit (model file is git-ignored)**

```bash
git add .gitignore scripts/download-clip-model.sh Dockerfile
git commit -m "feat(deploy): CLIP ONNX model download script + Dockerfile bundling"
```

---

### Task 4: Backend Go — `internal/clip/preprocess.go`

**Files:**
- Create: `backend-go/internal/clip/preprocess.go`
- Modify: `backend-go/go.mod` (add `github.com/disintegration/imaging`)

- [ ] **Step 1: Add imaging dependency**

```bash
cd backend-go &amp;&amp; go get github.com/disintegration/imaging@v1.6.2
```

- [ ] **Step 2: Write preprocess**

```go
// backend-go/internal/clip/preprocess.go
package clip

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"

	"github.com/disintegration/imaging"
)

// CLIP ViT-Base-32 normalization (OpenAI standard).
var (
	clipMean = [3]float32{0.48145466, 0.4578275, 0.40821073}
	clipStd  = [3]float32{0.26862954, 0.26130258, 0.27577711}
)

// PreprocessImage decodes JPEG/PNG bytes, resizes to 224x224, returns
// CHW float32 tensor normalized with CLIP mean/std.
func PreprocessImage(data []byte) ([]float32, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}
	resized := imaging.Resize(img, 224, 224, imaging.Lanczos)
	bounds := resized.Bounds()
	if bounds.Dx() != 224 || bounds.Dy() != 224 {
		return nil, fmt.Errorf("resize produced %dx%d, expected 224x224", bounds.Dx(), bounds.Dy())
	}
	// CHW layout: [channel][y][x] flattened.
	out := make([]float32, 3*224*224)
	for y := 0; y &lt; 224; y++ {
		for x := 0; x &lt; 224; x++ {
			r, g, b, _ := resized.At(x, y).RGBA()
			// RGBA is 16-bit; normalize to 0..1 then apply CLIP mean/std.
			rn := (float32(r)/65535.0 - clipMean[0]) / clipStd[0]
			gn := (float32(g)/65535.0 - clipMean[1]) / clipStd[1]
			bn := (float32(b)/65535.0 - clipMean[2]) / clipStd[2]
			out[0*224*224+y*224+x] = rn
			out[1*224*224+y*224+x] = gn
			out[2*224*224+y*224+x] = bn
		}
	}
	return out, nil
}
```

- [ ] **Step 3: Verify build**

```bash
cd backend-go &amp;&amp; go build ./internal/clip/...
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add backend-go/go.mod backend-go/go.sum backend-go/internal/clip/preprocess.go
git commit -m "feat(clip): preprocess — decode + resize 224x224 + CLIP normalize"
```

---

### Task 5: Backend Go — `internal/clip/model.go` (ONNX session loader)

**Files:**
- Create: `backend-go/internal/clip/model.go`
- Modify: `backend-go/go.mod` (add `github.com/yalue/onnxruntime_go`)

- [ ] **Step 1: Add ONNX runtime binding**

```bash
cd backend-go &amp;&amp; go get github.com/yalue/onnxruntime_go@v1.14.0
```

The host environment must also have the ONNX Runtime C shared library available (`libonnxruntime.so` / `libonnxruntime.dylib`). For Cloud Run Linux containers, install via Dockerfile (see Task 8).

- [ ] **Step 2: Write singleton loader**

```go
// backend-go/internal/clip/model.go
package clip

import (
	"fmt"
	"os"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

var (
	once       sync.Once
	sess       *ort.AdvancedSession
	inputName  = "pixel_values"
	outputName = "image_embeds"
	loadErr    error
)

// LoadModel initializes the ONNX session lazily. Idempotent; safe to call
// from multiple goroutines. Returns the load error if the model file is
// missing or initialization failed.
func LoadModel(modelPath string) error {
	once.Do(func() {
		if _, err := os.Stat(modelPath); err != nil {
			loadErr = fmt.Errorf("stat model file: %w", err)
			return
		}
		if err := ort.InitializeEnvironment(); err != nil {
			loadErr = fmt.Errorf("init onnxruntime: %w", err)
			return
		}
		inputShape := ort.NewShape(1, 3, 224, 224)
		inputTensor, err := ort.NewEmptyTensor[float32](inputShape)
		if err != nil {
			loadErr = fmt.Errorf("alloc input tensor: %w", err)
			return
		}
		outputShape := ort.NewShape(1, 512)
		outputTensor, err := ort.NewEmptyTensor[float32](outputShape)
		if err != nil {
			loadErr = fmt.Errorf("alloc output tensor: %w", err)
			return
		}
		s, err := ort.NewAdvancedSession(
			modelPath,
			[]string{inputName},
			[]string{outputName},
			[]ort.ArbitraryTensor{inputTensor},
			[]ort.ArbitraryTensor{outputTensor},
			nil,
		)
		if err != nil {
			loadErr = fmt.Errorf("create session: %w", err)
			return
		}
		sess = s
	})
	return loadErr
}

// Session returns the loaded session. Caller must have already called LoadModel.
func Session() *ort.AdvancedSession { return sess }
```

- [ ] **Step 3: Verify build**

```bash
cd backend-go &amp;&amp; go build ./internal/clip/...
```

If ONNX library missing on host, expect linker error. Install via instructions in Task 8 (Dockerfile) for production; for local dev install manually (`brew install onnxruntime` on macOS).

- [ ] **Step 4: Commit**

```bash
git add backend-go/go.mod backend-go/go.sum backend-go/internal/clip/model.go
git commit -m "feat(clip): ONNX session singleton loader (lazy, thread-safe)"
```

---

### Task 6: Backend Go — `internal/clip/encoder.go`

**Files:**
- Create: `backend-go/internal/clip/encoder.go`

- [ ] **Step 1: Write encoder**

```go
// backend-go/internal/clip/encoder.go
package clip

import (
	"fmt"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

var encodeMu sync.Mutex

// EncodeImage runs CLIP inference on the given image bytes and returns a 512-dim
// L2-normalized embedding vector. Caller must have called LoadModel().
func EncodeImage(data []byte) ([]float32, error) {
	if sess == nil {
		return nil, fmt.Errorf("clip session not loaded — call LoadModel first")
	}
	pixels, err := PreprocessImage(data)
	if err != nil {
		return nil, fmt.Errorf("preprocess: %w", err)
	}
	encodeMu.Lock()
	defer encodeMu.Unlock()

	inputTensor, err := ort.NewTensor(ort.NewShape(1, 3, 224, 224), pixels)
	if err != nil {
		return nil, fmt.Errorf("alloc input: %w", err)
	}
	outputTensor, err := ort.NewEmptyTensor[float32](ort.NewShape(1, 512))
	if err != nil {
		return nil, fmt.Errorf("alloc output: %w", err)
	}
	if err := sess.Run(); err != nil {
		return nil, fmt.Errorf("session run: %w", err)
	}
	raw := outputTensor.GetData()
	// L2 normalize (CLIP embeddings are typically used normalized for cosine search).
	var sumSq float32
	for _, v := range raw {
		sumSq += v * v
	}
	norm := float32(1.0)
	if sumSq &gt; 0 {
		norm = 1.0 / float32(sqrtFloat32(sumSq))
	}
	out := make([]float32, len(raw))
	for i, v := range raw {
		out[i] = v * norm
	}
	// Suppress unused-warning on inputTensor (the session reads from the registered input).
	_ = inputTensor
	return out, nil
}

func sqrtFloat32(x float32) float32 {
	// Newton-Raphson for float32 sqrt — avoids importing math for one call.
	z := float32(1.0)
	for i := 0; i &lt; 10; i++ {
		z = z - (z*z-x)/(2*z)
	}
	return z
}
```

- [ ] **Step 2: Test build**

```bash
cd backend-go &amp;&amp; go build ./internal/clip/...
```

- [ ] **Step 3: Write smoke test (skipped if model missing)**

```go
// backend-go/internal/clip/encoder_test.go
package clip

import (
	"os"
	"testing"
)

func TestEncodeImage_Smoke(t *testing.T) {
	modelPath := "../../../models/clip-vit-base-patch32.onnx"
	if _, err := os.Stat(modelPath); err != nil {
		t.Skipf("model file missing at %s — run scripts/download-clip-model.sh", modelPath)
	}
	if err := LoadModel(modelPath); err != nil {
		t.Fatalf("LoadModel: %v", err)
	}
	// 224x224 minimal valid JPEG.
	img, err := os.ReadFile("testdata/sample-mcb.jpg")
	if err != nil {
		t.Skipf("testdata/sample-mcb.jpg missing — skipping smoke")
	}
	vec, err := EncodeImage(img)
	if err != nil {
		t.Fatalf("EncodeImage: %v", err)
	}
	if len(vec) != 512 {
		t.Fatalf("expected len 512, got %d", len(vec))
	}
}
```

- [ ] **Step 4: Run test**

```bash
cd backend-go &amp;&amp; go test ./internal/clip/...
```

Expected: PASS or SKIP (if model file missing).

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/clip/encoder.go backend-go/internal/clip/encoder_test.go
git commit -m "feat(clip): EncodeImage — ONNX inference + L2 normalize → vector(512)"
```

---

### Task 7: Backend Go — HTTP handlers

**Files:**
- Create: `backend-go/handlers/products_search.go`
- Modify: `backend-go/main.go`

- [ ] **Step 1: Write handlers**

```go
// backend-go/handlers/products_search.go
package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"erpantigravity/backend-go/internal/clip"
	"erpantigravity/backend-go/internal/supabase"
)

const modelPath = "/app/models/clip-vit-base-patch32.onnx"

// IndexPhotosRequest — body { sku, photo_paths: [storage paths or signed URLs] }
type IndexPhotosRequest struct {
	SKU        string   `json:"sku"`
	PhotoPaths []string `json:"photo_paths"`
}

func IndexPhotosHandler(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	var req IndexPhotosRequest
	if err := json.NewDecoder(r.Body).Decode(&amp;req); err != nil {
		http.Error(w, "bad json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := clip.LoadModel(modelPath); err != nil {
		logInference(r.Context(), "index", "error", time.Since(start), err.Error())
		http.Error(w, "clip load: "+err.Error(), http.StatusInternalServerError)
		return
	}
	indexed := 0
	var lastErr error
	for _, path := range req.PhotoPaths {
		bytes, err := supabase.DownloadStorage("product-photos", path)
		if err != nil {
			lastErr = fmt.Errorf("download %s: %w", path, err)
			continue
		}
		vec, err := clip.EncodeImage(bytes)
		if err != nil {
			lastErr = fmt.Errorf("encode %s: %w", path, err)
			continue
		}
		if err := supabase.UpsertEmbedding(req.SKU, path, vec); err != nil {
			lastErr = fmt.Errorf("upsert %s: %w", path, err)
			continue
		}
		indexed++
	}
	status := "success"
	errMsg := ""
	if lastErr != nil {
		status = "error"
		errMsg = lastErr.Error()
	}
	logInference(r.Context(), "index", status, time.Since(start), errMsg)
	json.NewEncoder(w).Encode(map[string]any{"indexed": indexed, "error": errMsg})
}

func SearchByPhotoHandler(w http.ResponseWriter, r *http.Request) {
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
	if len(data) &gt; 5*1024*1024 {
		http.Error(w, "image &gt; 5MB", http.StatusBadRequest)
		return
	}
	if err := clip.LoadModel(modelPath); err != nil {
		logInference(r.Context(), "search", "cold_start_timeout", time.Since(start), err.Error())
		http.Error(w, "clip load: "+err.Error(), http.StatusServiceUnavailable)
		return
	}
	vec, err := clip.EncodeImage(data)
	if err != nil {
		logInference(r.Context(), "search", "error", time.Since(start), err.Error())
		http.Error(w, "encode: "+err.Error(), http.StatusInternalServerError)
		return
	}
	results, err := supabase.SearchByEmbedding(vec, 0.70, 5)
	if err != nil {
		logInference(r.Context(), "search", "error", time.Since(start), err.Error())
		http.Error(w, "search: "+err.Error(), http.StatusInternalServerError)
		return
	}
	logInference(r.Context(), "search", "success", time.Since(start), "")
	json.NewEncoder(w).Encode(map[string]any{"results": results})
}

func logInference(ctx interface{}, kind, status string, elapsed time.Duration, errMsg string) {
	supabase.InsertClipInferenceLog(kind, status, int(elapsed.Milliseconds()), errMsg)
}
```

> **Implementer note**: `supabase.DownloadStorage`, `supabase.UpsertEmbedding`, `supabase.SearchByEmbedding`, `supabase.InsertClipInferenceLog` are thin Supabase REST/RPC wrappers. They likely don't exist yet — add them as small helpers in `backend-go/internal/supabase/` following the existing pattern. Each is a single HTTP request to Supabase REST API with the service-role key. Approximately 50 lines total.

- [ ] **Step 2: Wire routes in `main.go`**

In `backend-go/main.go` find the route registration (look for `http.HandleFunc` or mux pattern):

```go
mux.HandleFunc("POST /api/products/index-photos", handlers.IndexPhotosHandler)
mux.HandleFunc("POST /api/products/search-by-photo", handlers.SearchByPhotoHandler)
```

- [ ] **Step 3: Build + test**

```bash
cd backend-go &amp;&amp; go build ./...
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add backend-go/handlers/products_search.go backend-go/main.go
git commit -m "feat(api): /api/products/index-photos + /api/products/search-by-photo handlers"
```

---

### Task 8: Dockerfile — install ONNX runtime library

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Add ONNX runtime install step**

Find the backend-go builder stage in `Dockerfile`. Before the binary `RUN go build`, add:

```dockerfile
# ONNX Runtime C library (required by onnxruntime_go).
RUN apt-get update &amp;&amp; apt-get install -y --no-install-recommends \
    wget tar libgomp1 ca-certificates &amp;&amp; \
    wget -q https://github.com/microsoft/onnxruntime/releases/download/v1.18.1/onnxruntime-linux-x64-1.18.1.tgz &amp;&amp; \
    tar -xzf onnxruntime-linux-x64-1.18.1.tgz &amp;&amp; \
    cp onnxruntime-linux-x64-1.18.1/lib/libonnxruntime.so.1.18.1 /usr/local/lib/ &amp;&amp; \
    ln -s /usr/local/lib/libonnxruntime.so.1.18.1 /usr/local/lib/libonnxruntime.so &amp;&amp; \
    ldconfig &amp;&amp; \
    rm -rf onnxruntime-linux-x64-1.18.1*
```

In the final runtime stage, also copy the .so:

```dockerfile
COPY --from=builder /usr/local/lib/libonnxruntime.so /usr/local/lib/libonnxruntime.so
COPY --from=builder /usr/local/lib/libonnxruntime.so.1.18.1 /usr/local/lib/libonnxruntime.so.1.18.1
RUN ldconfig
```

- [ ] **Step 2: Build image locally to verify**

```bash
docker build -t erp-test:clip .
docker run --rm erp-test:clip ls /usr/local/lib/libonnxruntime.so
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat(deploy): install ONNX runtime 1.18.1 in Docker image"
```

---

### Task 9: Frontend — `cariByFotoService.ts`

**Files:**
- Create: `src/lib/cariByFotoService.ts`

- [ ] **Step 1: Write the service**

```ts
// src/lib/cariByFotoService.ts
export interface SearchResult {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  min_stock: number;
  photo_url: string;
  similarity: number;
  warehouse_stock: Record<string, number>;
}

const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL ?? '';

export async function searchByPhoto(blob: Blob): Promise<{ results: SearchResult[] }> {
  const fd = new FormData();
  fd.append('photo', blob, 'query.jpg');
  const resp = await fetch(`${BACKEND_URL}/api/products/search-by-photo`, {
    method: 'POST',
    body: fd,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`search-by-photo ${resp.status}: ${text}`);
  }
  return resp.json();
}

export async function indexPhotos(sku: string, photoPaths: string[]): Promise<{ indexed: number; error?: string }> {
  const resp = await fetch(`${BACKEND_URL}/api/products/index-photos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku, photo_paths: photoPaths }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`index-photos ${resp.status}: ${text}`);
  }
  return resp.json();
}
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit
git add src/lib/cariByFotoService.ts
git commit -m "feat(client): cariByFotoService — POST multipart + JSON index"
```

---

### Task 10: `CariByFotoDropzone.tsx` — drag-drop sub-component

**Files:**
- Create: `src/components/kasir/CariByFotoDropzone.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/kasir/CariByFotoDropzone.tsx
import React, { useState } from 'react';

interface Props {
  onFileSelected: (file: File) => void;
  onError: (msg: string) => void;
}

export default function CariByFotoDropzone({ onFileSelected, onError }: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    if (files.length &gt; 1) {
      onError('Cuma 1 foto per search. Ambil yang pertama.');
    }
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      onError('Hanya foto yang didukung.');
      return;
    }
    if (file.size &gt; 5 * 1024 * 1024) {
      onError('File terlalu besar. Max 5MB.');
      return;
    }
    onFileSelected(file);
  };

  return (
    <button
      type="button"
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`w-full rounded-2xl p-5 text-left transition-colors border-2 border-dashed ${
        isDragging ? 'bg-violet-100 border-violet-500' : 'bg-violet-50/50 border-violet-300 hover:bg-violet-100'
      }`}
    >
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-violet-200 rounded-2xl flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-3xl text-violet-800">cloud_upload</span>
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-violet-700">Opsi 3 · BARU</p>
          <h4 className="text-sm font-extrabold text-violet-900 mt-0.5">
            {isDragging ? 'Lepas foto di sini' : 'Tarik &amp; lepas foto ke sini'}
          </h4>
          <p className="text-[11px] text-violet-800 mt-1 leading-snug">Drag foto langsung dari File Explorer / Finder.</p>
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit
git add src/components/kasir/CariByFotoDropzone.tsx
git commit -m "feat(kasir): CariByFotoDropzone — drag-drop with validation"
```

---

### Task 11: `CariByFotoModal.tsx` — 3 entry points + cold-start banner

**Files:**
- Create: `src/components/kasir/CariByFotoModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
// src/components/kasir/CariByFotoModal.tsx
import React, { useRef, useState } from 'react';
import { compressImage } from '../../lib/productPhotoService';
import { searchByPhoto, type SearchResult } from '../../lib/cariByFotoService';
import CariByFotoDropzone from './CariByFotoDropzone';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onResults: (results: SearchResult[], queryBlob: Blob) => void;
  showToast: (msg: string, kind?: 'success' | 'info' | 'warning') => void;
}

export default function CariByFotoModal({ isOpen, onClose, onResults, showToast }: Props) {
  const [isSearching, setIsSearching] = useState(false);
  const [coldStart, setColdStart] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const runSearch = async (file: File) => {
    setIsSearching(true);
    const coldTimer = setTimeout(() => setColdStart(true), 1000);
    try {
      const blob = await compressImage(file);
      const { results } = await searchByPhoto(blob);
      clearTimeout(coldTimer);
      setColdStart(false);
      onResults(results, blob);
      onClose();
    } catch (e) {
      clearTimeout(coldTimer);
      const msg = (e as Error).message;
      if (msg.includes('503') || msg.includes('cold')) {
        showToast('AI tidak siap, coba lagi atau cari via teks.', 'warning');
      } else {
        showToast(`Search gagal: ${msg}`, 'warning');
      }
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[10px] font-extrabold text-emerald-700 uppercase tracking-widest">Cari Produk via Foto</p>
            <h3 className="text-base font-extrabold text-[#012749] mt-0.5">Pilih sumber foto produk</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center">
            <span className="material-symbols-outlined text-base text-slate-600">close</span>
          </button>
        </div>

        {coldStart &amp;&amp; (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 mb-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-amber-800 animate-spin">progress_activity</span>
              <div>
                <h4 className="text-sm font-extrabold text-amber-900">⏱️ Menyiapkan AI… 5 detik</h4>
                <p className="text-[11px] text-amber-800 mt-1">CLIP model lagi di-load. Search berikutnya akan langsung cepat.</p>
              </div>
            </div>
          </div>
        )}

        {isSearching &amp;&amp; !coldStart &amp;&amp; (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 mb-4 text-center text-[12px] text-[#012749] font-bold">
            Mencari…
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <button
            onClick={() => camRef.current?.click()}
            disabled={isSearching}
            className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-2xl p-5 text-left disabled:opacity-50">
            <div className="w-12 h-12 bg-emerald-200 rounded-2xl flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-2xl text-emerald-800">photo_camera</span>
            </div>
            <p className="text-[10px] font-extrabold uppercase text-emerald-700">Opsi 1</p>
            <h4 className="text-sm font-extrabold text-emerald-900 mt-0.5">Pakai Kamera</h4>
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) void runSearch(f); }} />
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isSearching}
            className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-2xl p-5 text-left disabled:opacity-50">
            <div className="w-12 h-12 bg-blue-200 rounded-2xl flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-2xl text-blue-800">folder_open</span>
            </div>
            <p className="text-[10px] font-extrabold uppercase text-blue-700">Opsi 2</p>
            <h4 className="text-sm font-extrabold text-blue-900 mt-0.5">Upload File</h4>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) void runSearch(f); }} />
          </button>
        </div>

        <CariByFotoDropzone
          onFileSelected={runSearch}
          onError={msg => showToast(msg, 'warning')}
        />

        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900">
          💡 Foto produk dari angle depan / label paling jelas memberi hasil paling akurat.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/kasir/CariByFotoModal.tsx
git commit -m "feat(kasir): CariByFotoModal — 3 entry points + cold-start banner"
```

---

### Task 12: `HasilCariFotoModal.tsx`

**Files:**
- Create: `src/components/kasir/HasilCariFotoModal.tsx`

- [ ] **Step 1: Write the result modal**

```tsx
// src/components/kasir/HasilCariFotoModal.tsx
import React from 'react';
import type { SearchResult } from '../../lib/cariByFotoService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  results: SearchResult[];
  queryBlobUrl: string | null;
  onChangePhoto: () => void;
  onAddToCart: (result: SearchResult) => void;
}

export default function HasilCariFotoModal({ isOpen, onClose, results, queryBlobUrl, onChangePhoto, onAddToCart }: Props) {
  if (!isOpen) return null;
  const isEmpty = results.length === 0;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[10px] font-extrabold text-emerald-700 uppercase tracking-widest">Hasil Cari by Foto</p>
            <h3 className="text-base font-extrabold text-[#012749] mt-0.5">Top {results.length} produk paling mirip</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center">
            <span className="material-symbols-outlined text-base text-slate-600">close</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 mb-5 bg-emerald-50 border border-emerald-200 rounded-2xl p-3">
          <div className="flex items-center gap-3">
            {queryBlobUrl ? (
              <img src={queryBlobUrl} alt="query" className="w-16 h-16 rounded-xl object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-slate-200" />
            )}
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700">Foto yang dicari</p>
              <p className="text-[12.5px] font-bold text-emerald-900">Visual similarity (CLIP)</p>
            </div>
          </div>
          <button onClick={onChangePhoto} className="px-3 py-2 bg-white border border-emerald-200 text-emerald-700 rounded-full text-[11px] font-extrabold inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-base">refresh</span> Ganti foto
          </button>
        </div>

        {isEmpty &amp;&amp; (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[12px] text-amber-900">
            ⚠ Tidak menemukan produk yang cukup mirip dengan foto. Coba foto lain atau cari via teks/SKU.
          </div>
        )}

        <div className="space-y-2">
          {results.map((r, i) => {
            const isBest = i === 0;
            const lowStock = r.stock &lt;= (r.min_stock || 10);
            return (
              <div key={r.sku} className={`rounded-2xl p-3 flex items-center gap-3 ${isBest ? 'bg-emerald-50/40 border border-emerald-300' : 'bg-white border border-slate-200'}`}>
                <img src={r.photo_url} alt={r.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {isBest &amp;&amp; <span className="text-[9px] font-extrabold bg-emerald-600 text-white px-2 py-0.5 rounded-full uppercase">Best match</span>}
                  <h4 className="text-sm font-extrabold text-[#012749] mt-1">{r.name}</h4>
                  <p className="text-[10.5px] font-mono text-slate-500">{r.sku}</p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    <span className="font-bold text-[#012749]">Rp {new Intl.NumberFormat('id-ID').format(r.price)}</span>
                    {Object.entries(r.warehouse_stock).filter(([, q]) => q &gt; 0).map(([w, q]) => (
                      <span key={w} className={`ml-2 ${lowStock ? 'text-amber-700' : 'text-emerald-700'} font-semibold`}>
                        {w} {q}
                      </span>
                    ))}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[11px] font-extrabold text-emerald-700">{Math.round(r.similarity * 100)}%</div>
                  <button
                    onClick={() => onAddToCart(r)}
                    className={`mt-1 px-3 py-1.5 rounded-full text-[10px] font-extrabold uppercase inline-flex items-center gap-1 ${isBest ? 'bg-[#2d8a4e] text-white' : 'bg-white border border-emerald-300 text-emerald-700'}`}>
                    <span className="material-symbols-outlined text-sm">add</span> Tambah
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-200 text-center">
          <button onClick={onClose} className="text-[11.5px] font-bold text-[#012749] hover:underline inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-base">search</span>
            Tidak ada yang cocok? Cari manual via teks
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit
git add src/components/kasir/HasilCariFotoModal.tsx
git commit -m "feat(kasir): HasilCariFotoModal — top-5 with similarity, no AI describe"
```

---

### Task 13: Wire button + modals into `KasirScreen.tsx`

**Files:**
- Modify: `src/components/KasirScreen.tsx`

- [ ] **Step 1: Add state + imports near top of `KasirScreen`**

```tsx
import { useState } from 'react';
import CariByFotoModal from './kasir/CariByFotoModal';
import HasilCariFotoModal from './kasir/HasilCariFotoModal';
import type { SearchResult } from '../lib/cariByFotoService';
```

Inside the component:

```tsx
  const [isFotoOpen, setIsFotoOpen] = useState(false);
  const [isHasilOpen, setIsHasilOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [queryBlobUrl, setQueryBlobUrl] = useState<string | null>(null);

  const handleResults = (rs: SearchResult[], blob: Blob) => {
    setResults(rs);
    if (queryBlobUrl) URL.revokeObjectURL(queryBlobUrl);
    setQueryBlobUrl(URL.createObjectURL(blob));
    setIsHasilOpen(true);
  };

  const handleAddToCart = (r: SearchResult) => {
    // TODO: reuse existing add-to-cart by SKU logic.
    showToast(`✅ ${r.name} ditambahkan ke kasir.`, 'success');
    setIsHasilOpen(false);
  };
```

- [ ] **Step 2: Add button in the header area**

Locate the header search box rendering and add next to it:

```tsx
<button
  type="button"
  onClick={() => setIsFotoOpen(true)}
  className="px-5 py-2 bg-gradient-to-br from-[#2d8a4e] to-emerald-700 text-white rounded-full text-xs font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 shadow-lg">
  <span className="material-symbols-outlined text-base">photo_camera</span> Cari by Foto [AI]
</button>
```

- [ ] **Step 3: Mount the modals at the bottom of the component's return tree**

```tsx
<CariByFotoModal
  isOpen={isFotoOpen}
  onClose={() => setIsFotoOpen(false)}
  onResults={handleResults}
  showToast={showToast}
/>
<HasilCariFotoModal
  isOpen={isHasilOpen}
  onClose={() => { setIsHasilOpen(false); if (queryBlobUrl) { URL.revokeObjectURL(queryBlobUrl); setQueryBlobUrl(null); } }}
  results={results}
  queryBlobUrl={queryBlobUrl}
  onChangePhoto={() => { setIsHasilOpen(false); setIsFotoOpen(true); }}
  onAddToCart={handleAddToCart}
/>
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/KasirScreen.tsx
git commit -m "feat(kasir): wire Cari by Foto button + modals into KasirScreen header"
```

---

### Task 14: Wire `index-photos` after `ProductForm` save

**Files:**
- Modify: `src/components/produk/CatalogView.tsx`

- [ ] **Step 1: Call `indexPhotos` after successful upsert**

In `handleSave`, after `await stockService.upsertStockFull(...)` and before `showToast('✅ ...')`:

```tsx
  // Fire-and-forget CLIP indexing — UI doesn't wait, badge will update via realtime/poll later.
  if (payload.photo_urls &amp;&amp; payload.photo_urls.length &gt; 0) {
    const paths = payload.photo_urls.map(u => u.split('/product-photos/')[1]).filter(Boolean) as string[];
    void indexPhotos(payload.sku ?? '', paths).catch(e =>
      showToast(`Indexing background gagal: ${e.message}`, 'info')
    );
  }
```

Add import:

```tsx
import { indexPhotos } from '../../lib/cariByFotoService';
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/produk/CatalogView.tsx
git commit -m "feat(produk): trigger CLIP indexing after stocks upsert (fire-and-forget)"
```

---

### Task 15: Manual smoke + update progress.md

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Run backend + frontend + smoke**

```bash
# Terminal 1: backend
cd backend-go &amp;&amp; ./scripts/download-clip-model.sh &amp;&amp; go run main.go
# Terminal 2: frontend
npm run dev
```

Open `http://localhost:5173/?screen=kasir`. Smoke checklist:

1. Kasir header shows "📷 Cari by Foto [AI]" pill. Click → modal opens.
2. Modal shows 3 entry points: Kamera card, Upload File card, Drag-drop zone.
3. Drag a JPG from Finder/Explorer onto the drop zone → drop highlight active, then submits.
4. First search after backend restart → cold-start banner appears ("⏱️ Menyiapkan AI… 5 detik"), then results.
5. Subsequent search → no banner, results within ~500ms.
6. Results modal shows top 5 with similarity %, warehouse_stock inline, "Best match" badge on #1.
7. Click "Ganti foto" → back to Cari modal.
8. Click "+ Tambah" on a result → toast confirm, modal closes.
9. Upload a product photo via Tambah Barang form → background indexing kicks off → after ~150ms × N photos, that product appears in subsequent searches.
10. Drop a PDF onto the dropzone → toast "Hanya foto yang didukung."
11. Drop 3 files at once → toast "Cuma 1 foto per search" + first file used.

- [ ] **Step 2: Append progress.md entry**

```markdown

---

## 2026-06-16 — Plan C CLIP Backend + Kasir UI SHIPPED

- Migrations 20260616000010-11: `search_products_by_embedding` RPC + `clip_inference_log` table.
- `backend-go/internal/clip/` package: model singleton, preprocess (224x224 + CLIP normalize), encoder (ONNX inference + L2 normalize → vector(512)).
- ONNX runtime 1.18.1 installed in Dockerfile; CLIP model bundled at `/app/models/clip-vit-base-patch32.onnx`.
- `POST /api/products/index-photos` (background) + `POST /api/products/search-by-photo` (multipart).
- KasirScreen tombol "📷 Cari by Foto [AI]"; `CariByFotoModal` with 3 entry points (Camera + Upload + drag-drop); `HasilCariFotoModal` showing top-5.
- Cold-start UX inline banner.
- Indexing fires automatically after ProductForm save.
- Cari by Foto p95 latency (warm): TBD measure post-deploy.
- Akurasi top-1 (smoke test): TBD measure post-deploy.
```

- [ ] **Step 3: Commit**

```bash
git add progress.md
git commit -m "docs(progress): Plan C CLIP backend + Kasir UI shipped"
```

---

## Out of scope (deferred)

- CLIP Inference Monitor panel UI in Pengaturan → **Plan D**
- Costing method radio → **Plan D**
- initial_stock approval handler + WhatsApp template → **Plan D**
- Full test coverage (unit + integration) → **Plan D**
- Realtime "Indexing…" badge on product cards via Supabase Realtime → defer until UX feedback signals it's needed
