package storage

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"time"
)

// UploadPaymentProof uploads image bytes to the Supabase Storage `payment-proofs` bucket.
// Uses tenant-prefixed path: tenants/{tenantID}/{orderID}/{ms}[.pdf]
// This matches the payment_proofs_read_own_tenant RLS policy (migration 301).
// Returns the storage path (not a public URL — bucket is private; readers must use signed URLs).
// Caller should log the error and continue — a failed upload must not drop the payment flow.
func UploadPaymentProof(ctx context.Context, supabaseURL, serviceKey, tenantID, orderID string, data []byte, contentType string) (string, error) {
	if contentType == "" {
		contentType = "image/jpeg"
	}
	// Path: tenants/{tenantID}/{orderID}/{ms}[.pdf]
	// tenantID prefix enforces RLS policy on reads; service key bypasses RLS on write.
	storagePath := fmt.Sprintf("tenants/%s/%s/%d", tenantID, orderID, time.Now().UnixMilli())
	if contentType == "application/pdf" {
		storagePath += ".pdf"
	}
	uploadURL := fmt.Sprintf("%s/storage/v1/object/payment-proofs/%s", supabaseURL, storagePath)

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

	// Return the storage path — not a public URL (bucket is private).
	// FE reads via createSignedUrl or StorageLink component.
	return storagePath, nil
}
