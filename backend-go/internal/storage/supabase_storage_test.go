package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUploadPaymentProof_Success(t *testing.T) {
	var receivedMethod, receivedAuth, receivedContentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedMethod = r.Method
		receivedAuth = r.Header.Get("Authorization")
		receivedContentType = r.Header.Get("Content-Type")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	url, err := UploadPaymentProof(context.Background(), srv.URL, "test-service-key", "order-abc", []byte("fake-image-bytes"), "image/jpeg")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if url == "" {
		t.Fatal("expected non-empty public URL")
	}
	if !strings.Contains(url, "order-abc") {
		t.Errorf("URL should contain order ID, got: %s", url)
	}
	if receivedMethod != http.MethodPut {
		t.Errorf("expected PUT, got: %s", receivedMethod)
	}
	if receivedAuth != "Bearer test-service-key" {
		t.Errorf("unexpected Authorization header: %s", receivedAuth)
	}
	if receivedContentType != "image/jpeg" {
		t.Errorf("unexpected Content-Type: %s", receivedContentType)
	}
}

func TestUploadPaymentProof_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	_, err := UploadPaymentProof(context.Background(), srv.URL, "key", "order-xyz", []byte("bytes"), "image/jpeg")
	if err == nil {
		t.Fatal("expected error when server returns 5xx")
	}
}

func TestUploadPaymentProof_DefaultContentType(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ct := r.Header.Get("Content-Type")
		if ct != "image/jpeg" {
			http.Error(w, "bad content type", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// empty contentType should default to image/jpeg
	_, err := UploadPaymentProof(context.Background(), srv.URL, "key", "order-1", []byte("bytes"), "")
	if err != nil {
		t.Fatalf("expected no error with empty content type, got: %v", err)
	}
}

func TestUploadPaymentProof_PDFGetsSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	url, err := UploadPaymentProof(context.Background(), srv.URL, "key", "order-pdf", []byte("pdf-bytes"), "application/pdf")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if !strings.HasSuffix(url, ".pdf") {
		t.Errorf("expected URL to end in .pdf for PDF uploads, got: %s", url)
	}
}

func TestUploadPaymentProof_ImageNoSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	url, err := UploadPaymentProof(context.Background(), srv.URL, "key", "order-img", []byte("img-bytes"), "image/jpeg")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if strings.HasSuffix(url, ".pdf") {
		t.Errorf("image URL should not have .pdf suffix, got: %s", url)
	}
}
