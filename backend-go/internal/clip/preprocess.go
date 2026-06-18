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
	out := make([]float32, 3*224*224)
	for y := 0; y < 224; y++ {
		for x := 0; x < 224; x++ {
			r, g, b, _ := resized.At(x, y).RGBA()
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
