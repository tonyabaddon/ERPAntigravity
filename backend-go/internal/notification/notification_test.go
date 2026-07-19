// backend-go/internal/notification/notification_test.go
package notification

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
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

func TestQuotaCheck_Passes_WhenUnderLimit(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()

	tenantID := "11111111-1111-1111-1111-111111111111"
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT wa_daily_quota_used, wa_daily_quota_limit, wa_daily_quota_reset_date FROM tenant_subscriptions").
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"used", "limit", "reset_date"}).AddRow(50, 300, time.Date(2026, 7, 19, 0, 0, 0, 0, time.UTC)))
	mock.ExpectExec("UPDATE tenant_subscriptions").
		WithArgs(51, tenantID).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	q := &Quota{db: db}
	err := q.CheckAndIncrement(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("expected pass, got %v", err)
	}
}

func TestQuotaCheck_Fails_WhenOverLimit(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()

	tenantID := "11111111-1111-1111-1111-111111111111"
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT wa_daily_quota_used, wa_daily_quota_limit, wa_daily_quota_reset_date FROM tenant_subscriptions").
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"used", "limit", "reset_date"}).AddRow(300, 300, time.Date(2026, 7, 19, 0, 0, 0, 0, time.UTC)))
	mock.ExpectRollback()

	q := &Quota{db: db}
	err := q.CheckAndIncrement(context.Background(), tenantID)
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("expected ErrQuotaExceeded, got %v", err)
	}
}

type mockSender struct {
	called bool
	err    error
}

func (m *mockSender) SendText(ctx context.Context, phone, msg string) error {
	m.called = true
	return m.err
}

type mockMessageInserter struct {
	called bool
}

func (m *mockMessageInserter) InsertMessage(ctx context.Context, convID, sender, text string) error {
	m.called = true
	return nil
}

type mockQuota struct{ err error }

func (m *mockQuota) CheckAndIncrement(ctx context.Context, tenantID string) error { return m.err }

func TestNotifyCustomer_HappyPath(t *testing.T) {
	sender := &mockSender{}
	inserter := &mockMessageInserter{}
	quota := &mockQuota{}
	notifier := &Notifier{sender: sender, inserter: inserter, quota: quota}

	err := notifier.NotifyCustomer(context.Background(), "t1", "c1", "628123", "id", "test msg")
	if err != nil {
		t.Fatalf("expected pass, got %v", err)
	}
	if !sender.called {
		t.Fatal("expected sender to be called")
	}
	if !inserter.called {
		t.Fatal("expected message inserter to be called")
	}
}

func TestNotifyCustomer_ReturnsQuotaExceeded(t *testing.T) {
	notifier := &Notifier{
		sender:   &mockSender{},
		inserter: &mockMessageInserter{},
		quota:    &mockQuota{err: ErrQuotaExceeded},
	}

	err := notifier.NotifyCustomer(context.Background(), "t1", "c1", "628123", "id", "test msg")
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("expected ErrQuotaExceeded, got %v", err)
	}
}

type mockRecipientResolver struct {
	recipients []Recipient
	called     bool
}

func (m *mockRecipientResolver) GetActiveRecipients(ctx context.Context, tenantID string, filter RecipientFilter) ([]Recipient, error) {
	m.called = true
	return m.recipients, nil
}

func TestBroadcastToStaff_HappyPath(t *testing.T) {
	sender := &mockSender{}
	resolver := &mockRecipientResolver{
		recipients: []Recipient{
			{Phone: "628111", Role: "owner"},
			{Phone: "628222", Role: "admin"},
		},
	}
	notifier := &Notifier{sender: sender, resolver: resolver}

	err := notifier.BroadcastToStaff(context.Background(), "t1", RecipientFilter{}, "alert!")
	if err != nil {
		t.Fatalf("expected pass, got %v", err)
	}
	if !resolver.called {
		t.Fatal("expected resolver to be called")
	}
}
