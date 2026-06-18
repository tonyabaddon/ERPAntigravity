# Multistage build for Go application
FROM golang:1.25-bookworm AS builder

# Set the Current Working Directory inside the container
WORKDIR /app

# ONNX Runtime C library (required by github.com/yalue/onnxruntime_go for
# CLIP image-embedding inference in internal/clip/). Glibc-linked, hence
# Debian bookworm base (Alpine/musl ABI mismatch).
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget tar libgomp1 ca-certificates && \
    wget -q https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-linux-x64-1.22.0.tgz && \
    tar -xzf onnxruntime-linux-x64-1.22.0.tgz && \
    cp onnxruntime-linux-x64-1.22.0/lib/libonnxruntime.so.1.22.0 /usr/local/lib/ && \
    ln -s /usr/local/lib/libonnxruntime.so.1.22.0 /usr/local/lib/libonnxruntime.so && \
    ldconfig && \
    rm -rf onnxruntime-linux-x64-1.22.0*

# Build context is repo root (see cloudbuild.yaml), so all source paths are
# prefixed with backend-go/.

# Copy go.mod and go.sum first to leverage Docker layer caching.
COPY backend-go/go.mod backend-go/go.sum ./

# Download all dependencies (will be cached if mod files don't change).
RUN go mod download

# Copy the Go source tree.
COPY backend-go/ ./

# Build the Go app. CGO_ENABLED=1 is required because onnxruntime_go binds
# to the libonnxruntime C library installed above.
RUN CGO_ENABLED=1 GOOS=linux go build -o main .

######## Start a new stage from scratch #######
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata libgomp1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /root/

# Copy the Pre-built binary file from the previous stage
COPY --from=builder /app/main .

# ONNX Runtime shared library — needed at runtime by the CLIP package.
COPY --from=builder /usr/local/lib/libonnxruntime.so /usr/local/lib/libonnxruntime.so
COPY --from=builder /usr/local/lib/libonnxruntime.so.1.22.0 /usr/local/lib/libonnxruntime.so.1.22.0
RUN ldconfig

# CLIP ONNX model — downloaded via scripts/download-clip-model.sh from the
# repo root before `docker build`. NOTE: the default build context for this
# Dockerfile is backend-go/, so this COPY only works if the build context is
# the repo root (or a copy step places the model into backend-go/models/
# first). Cloud Build wiring lives in cloudbuild.yaml — flagged for the
# deploy-pipeline iteration.
COPY models/clip-vit-base-patch32.onnx /app/models/clip-vit-base-patch32.onnx

# Expose port (default 8080)
EXPOSE 8080

# Command to run the executable
CMD ["./main"]
