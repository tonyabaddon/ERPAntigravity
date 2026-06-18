package clip

import (
	"fmt"
	"math"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

var encodeMu sync.Mutex

// EncodeImage runs CLIP inference on the given image bytes and returns a 512-dim
// L2-normalized embedding vector. Caller must have called LoadModel() before.
//
// Input/output tensors are allocated per call and passed into
// DynamicAdvancedSession.Run so the session always reads the fresh input.
// encodeMu serializes calls because the underlying ONNX session is not
// thread-safe for concurrent Run() invocations.
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
	defer inputTensor.Destroy()

	outputTensor, err := ort.NewEmptyTensor[float32](ort.NewShape(1, 512))
	if err != nil {
		return nil, fmt.Errorf("alloc output: %w", err)
	}
	defer outputTensor.Destroy()

	if err := sess.Run(
		[]ort.Value{inputTensor},
		[]ort.Value{outputTensor},
	); err != nil {
		return nil, fmt.Errorf("session run: %w", err)
	}

	raw := outputTensor.GetData()
	var sumSq float32
	for _, v := range raw {
		sumSq += v * v
	}
	norm := float32(1.0)
	if sumSq > 0 {
		norm = float32(1.0 / math.Sqrt(float64(sumSq)))
	}
	out := make([]float32, len(raw))
	for i, v := range raw {
		out[i] = v * norm
	}
	return out, nil
}
