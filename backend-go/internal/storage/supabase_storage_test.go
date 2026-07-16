package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testTenantID = "11111111-1111-1111-1111-111111111111"

func TestUploadPaymentProof_Success(t *testing.T) {
	var receivedMethod, receivedAuth, receivedContentType, receivedPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedMethod = r.Method
		receivedAuth = r.Header.Get("Authorization")
		receivedContentType = r.Header.Get("Content-Type")
		receivedPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Migration 301: signature now takes tenantID; returns storage path (not public URL)
	storagePath, err := UploadPaymentProof(context.Background(), srv.URL, "test-service-key", testTenantID, "order-abc", []byte("fake-image-bytes"), "image/jpeg")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if storagePath == "" {
		t.Fatal("expected non-empty storage path")
	}
	// Path must be tenants/{tenantID}/... and contain order ID
	if !strings.HasPrefix(storagePath, "tenants/"+testTenantID+"/") {
		t.Errorf("storage path must start with tenants/{tenantID}/, got: %s", storagePath)
	}
	if !strings.Contains(storagePath, "order-abc") {
		t.Errorf("storage path should contain order ID, got: %s", storagePath)
	}
	// Upload URL path must include storage path
	if !strings.Contains(receivedPath, testTenantID) {
		t.Errorf("upload URL should contain tenant ID, got path: %s", receivedPath)
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

	_, err := UploadPaymentProof(context.Background(), srv.URL, "key", testTenantID, "order-xyz", []byte("bytes"), "image/jpeg")
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
	_, err := UploadPaymentProof(context.Background(), srv.URL, "key", testTenantID, "order-1", []byte("bytes"), "")
	if err != nil {
		t.Fatalf("expected no error with empty content type, got: %v", err)
	}
}

func TestUploadPaymentProof_PDFGetsSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	storagePath, err := UploadPaymentProof(context.Background(), srv.URL, "key", testTenantID, "order-pdf", []byte("pdf-bytes"), "application/pdf")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if !strings.HasSuffix(storagePath, ".pdf") {
		t.Errorf("expected storage path to end in .pdf for PDF uploads, got: %s", storagePath)
	}
}

func TestUploadPaymentProof_ImageNoSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	storagePath, err := UploadPaymentProof(context.Background(), srv.URL, "key", testTenantID, "order-img", []byte("img-bytes"), "image/jpeg")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if strings.HasSuffix(storagePath, ".pdf") {
		t.Errorf("image storage path should not have .pdf suffix, got: %s", storagePath)
	}
}

func TestUploadPaymentProof_OctetStreamNoSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	storagePath, err := UploadPaymentProof(context.Background(), srv.URL, "key", testTenantID, "order-oct", []byte("binary-bytes"), "application/octet-stream")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if strings.HasSuffix(storagePath, ".pdf") {
		t.Errorf("application/octet-stream must not get .pdf suffix, got: %s", storagePath)
	}
}
