package feedback

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestHandleFeedbackResponse_ValidRating(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	order := PendingOrder{
		OrderID:    "00000000-0000-0000-0000-000000000001",
		TenantID:   "00000000-0000-0000-0000-000000000002",
		CustomerID: "cust-abc",
	}

	mock.ExpectExec(`INSERT INTO public.customer_feedback`).
		WithArgs(order.TenantID, order.CustomerID, order.OrderID, 4, "pengiriman cepat").
		WillReturnResult(sqlmock.NewResult(1, 1))

	captured, err := HandleFeedbackResponse(context.Background(), db, order, "4 pengiriman cepat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !captured {
		t.Error("expected captured=true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet mock expectations: %v", err)
	}
}

func TestHandleFeedbackResponse_RatingOnly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	order := PendingOrder{
		OrderID:  "00000000-0000-0000-0000-000000000001",
		TenantID: "00000000-0000-0000-0000-000000000002",
	}

	mock.ExpectExec(`INSERT INTO public.customer_feedback`).
		WithArgs(order.TenantID, order.CustomerID, order.OrderID, 5, "").
		WillReturnResult(sqlmock.NewResult(1, 1))

	captured, err := HandleFeedbackResponse(context.Background(), db, order, "5")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !captured {
		t.Error("expected captured=true")
	}
}

func TestHandleFeedbackResponse_NotARating(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	order := PendingOrder{}

	captured, err := HandleFeedbackResponse(context.Background(), db, order, "mau pesan lagi dong")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if captured {
		t.Error("expected captured=false for non-rating message")
	}
}

func TestHandleFeedbackResponse_OutOfRange(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	order := PendingOrder{}

	captured, err := HandleFeedbackResponse(context.Background(), db, order, "6 bagus sekali")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if captured {
		t.Error("expected captured=false for rating > 5")
	}
}

func TestHandleFeedbackResponse_ZeroRating(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	captured, err := HandleFeedbackResponse(context.Background(), db, PendingOrder{}, "0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if captured {
		t.Error("expected captured=false for rating=0")
	}
}

func TestHandleFeedbackResponse_EmptyBody(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	captured, err := HandleFeedbackResponse(context.Background(), db, PendingOrder{}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if captured {
		t.Error("expected captured=false for empty body")
	}
}

// Ensure the package compiles with the real sql.DB type (no mock needed here).
var _ *sql.DB = nil
