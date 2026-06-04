package storage

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"time"
)

// UploadPaymentProof uploads image bytes to the Supabase Storage `payment-proofs` bucket.
// Returns the permanent public URL on success, or ("", err) on failure.
// Caller should log the error and continue — a failed upload must not drop the payment flow.
func UploadPaymentProof(ctx context.Context, supabaseURL, serviceKey, orderID string, data []byte, contentType string) (string, error) {
	if contentType == "" {
		contentType = "image/jpeg"
	}
	filename := fmt.Sprintf("%s/%d", orderID, time.Now().UnixMilli())
	if contentType == "application/pdf" {
		filename += ".pdf"
	}
	uploadURL := fmt.Sprintf("%s/storage/v1/object/payment-proofs/%s", supabaseURL, filename)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("storage: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Content-Type", contentType)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("storage: upload request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("storage: upload failed with HTTP %d", resp.StatusCode)
	}

	publicURL := fmt.Sprintf("%s/storage/v1/object/public/payment-proofs/%s", supabaseURL, filename)
	return publicURL, nil
}
