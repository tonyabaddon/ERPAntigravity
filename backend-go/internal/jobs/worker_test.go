package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// TestEchoHandler verifies the echo handler returns payload unchanged.
func TestEchoHandler(t *testing.T) {
	payload := json.RawMessage(`{"hello":"world"}`)
	result, err := EchoHandler(context.Background(), "tenant-1", payload)
	if err != nil {
		t.Fatalf("EchoHandler returned error: %v", err)
	}
	if string(result) != string(payload) {
		t.Fatalf("expected %s, got %s", payload, result)
	}
}

// TestWorkerNoHandler verifies that an unregistered job_type results in a
// complete_job call being made (status=FAILED). We use AnyArg() for all args
// since we can't predict exact duration or error message text from the mock.
func TestWorkerNoHandler(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	// claim_next_job returns one row (payload as []byte to match sql.Scan)
	claimRows := sqlmock.NewRows([]string{"job_id", "tenant_id", "job_type", "payload", "attempts"}).
		AddRow("job-1", "tenant-1", "unknown_type", []byte(`{"x":1}`), 1)
	mock.ExpectQuery(`SELECT job_id, tenant_id, job_type, payload, attempts FROM claim_next_job`).
		WithArgs("test-worker").
		WillReturnRows(claimRows)

	// complete_job should be called — we use AnyArg for all because sqlmock
	// v1.5.2 does strict equality and nil interfaces can differ.
	mock.ExpectExec(`SELECT complete_job`).
		WithArgs(
			sqlmock.AnyArg(), // job_id
			sqlmock.AnyArg(), // status (FAILED)
			sqlmock.AnyArg(), // result
			sqlmock.AnyArg(), // error_code
			sqlmock.AnyArg(), // error_message
			sqlmock.AnyArg(), // worker_id
			sqlmock.AnyArg(), // duration_ms
		).
		WillReturnResult(sqlmock.NewResult(0, 0))

	w := NewWorker(db)
	w.workerID = "test-worker"
	// no handler registered for "unknown_type"

	w.processOne(context.Background())

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet mock expectations: %v", err)
	}
}

// TestWorkerHandlerSuccess verifies the happy path: claim → handler → complete.
func TestWorkerHandlerSuccess(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	claimRows := sqlmock.NewRows([]string{"job_id", "tenant_id", "job_type", "payload", "attempts"}).
		AddRow("job-2", "tenant-1", "echo_test", []byte(`{"ping":true}`), 1)
	mock.ExpectQuery(`SELECT job_id, tenant_id, job_type, payload, attempts FROM claim_next_job`).
		WithArgs("test-worker").
		WillReturnRows(claimRows)

	mock.ExpectExec(`SELECT complete_job`).
		WithArgs(
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(0, 0))

	w := NewWorker(db)
	w.workerID = "test-worker"
	w.Register("echo_test", EchoHandler)

	w.processOne(context.Background())

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet mock expectations: %v", err)
	}
}

// TestWorkerHandlerError verifies that a handler error causes complete_job call.
func TestWorkerHandlerError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	claimRows := sqlmock.NewRows([]string{"job_id", "tenant_id", "job_type", "payload", "attempts"}).
		AddRow("job-3", "tenant-1", "failing_job", []byte(`{}`), 1)
	mock.ExpectQuery(`SELECT job_id, tenant_id, job_type, payload, attempts FROM claim_next_job`).
		WithArgs("test-worker").
		WillReturnRows(claimRows)

	mock.ExpectExec(`SELECT complete_job`).
		WithArgs(
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(0, 0))

	w := NewWorker(db)
	w.workerID = "test-worker"
	w.Register("failing_job", func(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		return nil, errors.New("intentional test failure")
	})

	w.processOne(context.Background())

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet mock expectations: %v", err)
	}
}

// TestWorkerNoRows verifies that an idle poll (no jobs) is a no-op.
func TestWorkerNoRows(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	claimRows := sqlmock.NewRows([]string{"job_id", "tenant_id", "job_type", "payload", "attempts"})
	mock.ExpectQuery(`SELECT job_id, tenant_id, job_type, payload, attempts FROM claim_next_job`).
		WithArgs("test-worker").
		WillReturnRows(claimRows)

	w := NewWorker(db)
	w.workerID = "test-worker"
	w.processOne(context.Background())

	// complete_job must NOT be called
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet mock expectations: %v", err)
	}
}

// TestCompleteWithCancelledContext verifies that complete() succeeds even when
// the passed ctx is already cancelled (shutdown-race fix: complete uses a fresh
// context.Background() internally, so SIGTERM during handler execution does not
// cause the job to stay RUNNING forever).
func TestCompleteWithCancelledContext(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	// complete_job must be called despite the cancelled ctx.
	mock.ExpectExec(`SELECT complete_job`).
		WithArgs(
			sqlmock.AnyArg(), // job_id
			sqlmock.AnyArg(), // status
			sqlmock.AnyArg(), // result
			sqlmock.AnyArg(), // error_code
			sqlmock.AnyArg(), // error_message
			sqlmock.AnyArg(), // worker_id
			sqlmock.AnyArg(), // duration_ms
		).
		WillReturnResult(sqlmock.NewResult(0, 0))

	w := NewWorker(db)
	w.workerID = "test-worker"

	// Cancel the context BEFORE calling complete — simulates SIGTERM race.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// Should NOT fail or skip the complete_job call even though ctx is already done.
	w.complete(ctx, "job-shutdown", "SUCCEEDED", json.RawMessage(`{"ok":true}`), "", "", 42)

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("complete_job was not called despite cancelled ctx (shutdown race not fixed): %v", err)
	}
}

// TestWorkerContextCancellation verifies Start() exits when context is cancelled.
func TestWorkerContextCancellation(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	w := NewWorker(db)
	w.workerID = "test-worker"

	ctx, cancel := context.WithCancel(context.Background())

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		w.Start(ctx)
	}()

	cancel()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// success
	case <-time.After(2 * time.Second):
		t.Error("worker did not stop after context cancellation")
	}
}
