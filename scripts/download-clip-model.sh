#!/usr/bin/env bash
# scripts/download-clip-model.sh — downloads CLIP ONNX model used by foto-search.
set -euo pipefail
MODEL_PATH="models/clip-vit-base-patch32.onnx"

mkdir -p models
if [[ -f "$MODEL_PATH" ]]; then
  echo "Model already present at $MODEL_PATH"
  exit 0
fi
curl -L -o "$MODEL_PATH" \
  "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx"
echo "Downloaded $MODEL_PATH ($(shasum -a 256 "$MODEL_PATH" | cut -d' ' -f1))"
