package clip

import (
	"fmt"
	"os"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

var (
	once    sync.Once
	sess    *ort.DynamicAdvancedSession
	loadErr error
)

const (
	inputName  = "pixel_values"
	outputName = "image_embeds"
)

// LoadModel initializes the ONNX session lazily. Idempotent; safe to call
// from multiple goroutines. Returns the load error if the model file is
// missing or initialization failed.
//
// Uses DynamicAdvancedSession so input/output tensors can be bound per-call
// inside EncodeImage. The previous AdvancedSession bound empty tensors at
// load time and never rebound them, so inference always returned zeros.
func LoadModel(modelPath string) error {
	once.Do(func() {
		if _, err := os.Stat(modelPath); err != nil {
			loadErr = fmt.Errorf("stat model file: %w", err)
			return
		}
		// onnxruntime_go's default lookup tries "onnxruntime.so" without the
		// "lib" prefix; our Docker image installs as libonnxruntime.so.
		// Allow an env override (ONNX_LIB_PATH) so deployments can point at
		// the canonical libonnxruntime.so.1.18.1 we shipped.
		libPath := os.Getenv("ONNX_LIB_PATH")
		if libPath == "" {
			libPath = "/usr/local/lib/libonnxruntime.so"
		}
		if _, err := os.Stat(libPath); err == nil {
			ort.SetSharedLibraryPath(libPath)
		}
		if err := ort.InitializeEnvironment(); err != nil {
			loadErr = fmt.Errorf("init onnxruntime: %w", err)
			return
		}
		s, err := ort.NewDynamicAdvancedSession(
			modelPath,
			[]string{inputName},
			[]string{outputName},
			nil,
		)
		if err != nil {
			loadErr = fmt.Errorf("create dynamic session: %w", err)
			return
		}
		sess = s
	})
	return loadErr
}

// Session returns the loaded session. Caller must have already called LoadModel.
func Session() *ort.DynamicAdvancedSession { return sess }
