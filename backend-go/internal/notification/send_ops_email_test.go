// backend-go/internal/notification/send_ops_email_test.go
package notification

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

// mockHTTPClient captures the request sent to it and returns a canned response.
type mockHTTPClient struct {
	capturedReq *http.Request
	status      int
}

func (m *mockHTTPClient) Do(req *http.Request) (*http.Response, error) {
	m.capturedReq = req
	body := io.NopCloser(strings.NewReader("{}"))
	return &http.Response{
		StatusCode: m.status,
		Body:       body,
	}, nil
}

func TestSendOpsEmail_MissingAPIKey(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	err := sendOpsEmailWith(context.Background(), "subj", "body", &mockHTTPClient{status: 200})
	if err == nil {
		t.Fatal("expected error when RESEND_API_KEY is empty, got nil")
	}
	if !strings.Contains(err.Error(), "RESEND_API_KEY") {
		t.Errorf("error message should mention RESEND_API_KEY, got: %v", err)
	}
}

func TestSendOpsEmail_SuccessDefaultRecipient(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "test-key-123")
	t.Setenv("CALEO_OPS_EMAIL", "")

	mock := &mockHTTPClient{status: 200}
	err := sendOpsEmailWith(context.Background(), "Test subject", "Test body", mock)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if mock.capturedReq == nil {
		t.Fatal("expected HTTP request to be made")
	}
	if got := mock.capturedReq.Header.Get("Authorization"); got != "Bearer test-key-123" {
		t.Errorf("Authorization header = %q; want %q", got, "Bearer test-key-123")
	}
}

func TestSendOpsEmail_SuccessCustomRecipient(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "key-abc")
	t.Setenv("CALEO_OPS_EMAIL", "ops-team@example.com")

	mock := &mockHTTPClient{status: 200}
	err := sendOpsEmailWith(context.Background(), "subj", "body", mock)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestSendOpsEmail_HTTP400Error(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "key-abc")
	t.Setenv("CALEO_OPS_EMAIL", "")

	mock := &mockHTTPClient{status: 422}
	err := sendOpsEmailWith(context.Background(), "subj", "body", mock)
	if err == nil {
		t.Fatal("expected error on HTTP 422, got nil")
	}
	if !strings.Contains(err.Error(), "422") {
		t.Errorf("error should mention status code 422, got: %v", err)
	}
}

func TestSendOpsEmail_HTTP500Error(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "key-abc")
	t.Setenv("CALEO_OPS_EMAIL", "")

	mock := &mockHTTPClient{status: 500}
	err := sendOpsEmailWith(context.Background(), "subj", "body", mock)
	if err == nil {
		t.Fatal("expected error on HTTP 500, got nil")
	}
}
