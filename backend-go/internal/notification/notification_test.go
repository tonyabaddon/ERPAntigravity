// backend-go/internal/notification/notification_test.go
package notification

import (
	"errors"
	"testing"
)

func TestErrQuotaExceededIsError(t *testing.T) {
	if ErrQuotaExceeded == nil {
		t.Fatal("ErrQuotaExceeded should be non-nil")
	}
	if !errors.Is(ErrQuotaExceeded, ErrQuotaExceeded) {
		t.Fatal("errors.Is should match ErrQuotaExceeded")
	}
}

func TestErrWASessionOfflineIsError(t *testing.T) {
	if ErrWASessionOffline == nil {
		t.Fatal("ErrWASessionOffline should be non-nil")
	}
}

func TestErrSendFailedIsError(t *testing.T) {
	if ErrSendFailed == nil {
		t.Fatal("ErrSendFailed should be non-nil")
	}
}

func TestErrTemplateRenderErrorIsError(t *testing.T) {
	if ErrTemplateRenderError == nil {
		t.Fatal("ErrTemplateRenderError should be non-nil")
	}
}
