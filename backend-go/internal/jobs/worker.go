package jobs

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"os"
	"time"

	"github.com/getsentry/sentry-go"
)

const (
	// PollInterval is how often the worker polls for new jobs when idle.
	PollInterval = 5 * time.Second
	// MaxJobDuration is the maximum time a single job is allowed to run.
	MaxJobDuration = 10 * time.Minute
)

// JobHandler processes a specific job_type.
// Returns result JSON on success, or an error on failure (which marks the job FAILED).
type JobHandler func(ctx context.Context, tenantID string, payload json.RawMessage) (json.RawMessage, error)

// Worker polls t_jobs for QUEUED work and dispatches to registered handlers.
// It runs co-located in the Go HTTP service — no external queue or broker needed.
// FOR UPDATE SKIP LOCKED in claim_next_job() makes it safe to run multiple
// instances if Cloud Run scales horizontally.
type Worker struct {
	db       *sql.DB
	handlers map[string]JobHandler
	workerID string
	stopCh   chan struct{}
}

// NewWorker creates a Worker that uses the provided *sql.DB (service_role
// connection — bypasses RLS for cross-tenant job polling).
func NewWorker(db *sql.DB) *Worker {
	hostname, _ := os.Hostname()
	return &Worker{
		db:       db,
		handlers: make(map[string]JobHandler),
		workerID: hostname,
		stopCh:   make(chan struct{}),
	}
}

// Register binds a handler to a job_type string.
// Call before Start(). Not goroutine-safe after Start() is called.
func (w *Worker) Register(jobType string, handler JobHandler) {
	w.handlers[jobType] = handler
}

// Start begins the polling loop. Blocks until Stop() is called or ctx is cancelled.
func (w *Worker) Start(ctx context.Context) {
	slog.InfoContext(ctx, "[JOBS] worker started", slog.String("worker_id", w.workerID))
	ticker := time.NewTicker(PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-w.stopCh:
			slog.InfoContext(ctx, "[JOBS] worker stopped")
			return
		case <-ctx.Done():
			slog.InfoContext(ctx, "[JOBS] worker context cancelled")
			return
		case <-ticker.C:
			w.processOne(ctx)
		}
	}
}

// Stop signals the polling loop to exit.
func (w *Worker) Stop() {
	close(w.stopCh)
}

// processOne claims and executes one job. Errors are logged and not propagated —
// a failed claim or handler error results in a FAILED job status, not a crash.
func (w *Worker) processOne(ctx context.Context) {
	var jobID, tenantID, jobType string
	var payloadBytes []byte // scan as []byte then reinterpret as RawMessage
	var attempts int

	row := w.db.QueryRowContext(ctx,
		`SELECT job_id, tenant_id, job_type, payload, attempts FROM claim_next_job($1)`,
		w.workerID,
	)
	err := row.Scan(&jobID, &tenantID, &jobType, &payloadBytes, &attempts)
	payload := json.RawMessage(payloadBytes)
	if err == sql.ErrNoRows {
		return // no jobs available — normal idle state
	}
	if err != nil {
		slog.ErrorContext(ctx, "[JOBS] claim_next_job scan failed",
			slog.String("error", err.Error()))
		return
	}

	logger := slog.With(
		slog.String("job_id", jobID),
		slog.String("tenant_id", tenantID),
		slog.String("job_type", jobType),
		slog.Int("attempt", attempts),
	)
	logger.InfoContext(ctx, "[JOBS] job claimed, processing")

	handler, ok := w.handlers[jobType]
	if !ok {
		logger.ErrorContext(ctx, "[JOBS] no handler registered for job_type")
		w.complete(ctx, jobID, "FAILED", nil, "NO_HANDLER",
			"no handler registered for job_type: "+jobType, 0)
		return
	}

	start := time.Now()
	jobCtx, cancel := context.WithTimeout(ctx, MaxJobDuration)
	defer cancel()

	result, jobErr := handler(jobCtx, tenantID, payload)
	duration := int(time.Since(start).Milliseconds())

	if jobErr != nil {
		logger.ErrorContext(ctx, "[JOBS] handler returned error",
			slog.String("error", jobErr.Error()),
			slog.Int("duration_ms", duration))
		// Forward job failures to Sentry with tenant/job context.
		// Safe no-op when Sentry SDK is uninitialised (DSN absent).
		sentry.WithScope(func(scope *sentry.Scope) {
			scope.SetTag("tenant_id", tenantID)
			scope.SetTag("job_type", jobType)
			scope.SetTag("job_id", jobID)
			sentry.CaptureException(jobErr)
		})
		w.complete(ctx, jobID, "FAILED", nil, "HANDLER_ERROR", jobErr.Error(), duration)
		return
	}

	logger.InfoContext(ctx, "[JOBS] job succeeded", slog.Int("duration_ms", duration))
	w.complete(ctx, jobID, "SUCCEEDED", result, "", "", duration)
}

// complete calls complete_job() RPC to update the job status and log the run.
//
// SHUTDOWN SAFETY: We use a fresh context.Background() with a short timeout
// instead of the passed ctx. The caller's ctx may be cancelled during a SIGTERM
// shutdown sequence (workerCtx is cancelled before the handler returns), but we
// MUST still record completion — otherwise the job stays RUNNING forever and is
// never retried. The write is brief (single RPC) so 10s is ample.
// ctx is kept for logging so slog can extract trace IDs from the cancellation path.
func (w *Worker) complete(ctx context.Context, jobID, status string,
	result json.RawMessage, errCode, errMsg string, durationMs int) {

	// Use a fresh background context so this write survives parent cancellation.
	completeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var resultArg interface{}
	if len(result) > 0 {
		resultArg = string(result)
	}
	var errCodeArg, errMsgArg interface{}
	if errCode != "" {
		errCodeArg = errCode
	}
	if errMsg != "" {
		errMsgArg = errMsg
	}

	_, err := w.db.ExecContext(completeCtx,
		`SELECT complete_job($1, $2, $3::jsonb, $4, $5, $6, $7)`,
		jobID, status, resultArg, errCodeArg, errMsgArg, w.workerID, durationMs,
	)
	if err != nil {
		slog.ErrorContext(ctx, "[JOBS] complete_job RPC failed",
			slog.String("job_id", jobID),
			slog.String("error", err.Error()))
	}
}
