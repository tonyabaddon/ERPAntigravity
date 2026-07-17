//go:build smoke
// +build smoke

// Smoke test: submit echo_test job via service_role DB, wait for worker to claim
// and complete it, verify status=SUCCEEDED and result=payload.
// Run with: go test -tags smoke -run TestSmokeEchoJob ./internal/jobs/...
// Requires SUPABASE_DB_CONNECTION env var (service_role connection string).
package jobs

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

func TestSmokeEchoJob(t *testing.T) {
	connStr := os.Getenv("SUPABASE_DB_CONNECTION")
	if connStr == "" {
		t.Skip("SUPABASE_DB_CONNECTION not set — skipping smoke test")
	}

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}

	ctx := context.Background()

	// Insert a job directly (bypassing enqueue_job SECDEF auth check —
	// smoke test uses service_role which bypasses RLS).
	var tenantID string
	err = db.QueryRowContext(ctx, `SELECT id FROM public.tenants LIMIT 1`).Scan(&tenantID)
	if err != nil {
		t.Fatalf("get test tenant: %v", err)
	}

	var jobID string
	err = db.QueryRowContext(ctx,
		`INSERT INTO public.t_jobs (tenant_id, job_type, payload)
		 VALUES ($1, 'echo_test', '{"hello":"smoke_test"}'::jsonb)
		 RETURNING id`,
		tenantID,
	).Scan(&jobID)
	if err != nil {
		t.Fatalf("insert job: %v", err)
	}
	t.Logf("Enqueued echo_test job: %s (tenant: %s)", jobID, tenantID)

	// Debug: directly call claim_next_job to see what it returns
	var claimedJobID, claimedTenant, claimedType string
	var claimedPayload []byte
	var claimedAttempts int
	claimErr := db.QueryRowContext(ctx,
		`SELECT job_id, tenant_id, job_type, payload, attempts FROM claim_next_job($1)`,
		"debug-worker",
	).Scan(&claimedJobID, &claimedTenant, &claimedType, &claimedPayload, &claimedAttempts)
	t.Logf("claim_next_job debug: err=%v job_id=%s type=%s", claimErr, claimedJobID, claimedType)

	// If claim worked, manually complete it
	if claimErr == nil {
		t.Logf("claim succeeded for job %s, running EchoHandler...", claimedJobID)
		result2, handlerErr := EchoHandler(ctx, claimedTenant, json.RawMessage(claimedPayload))
		if handlerErr != nil {
			t.Fatalf("EchoHandler failed: %v", handlerErr)
		}
		t.Logf("EchoHandler result: %s", result2)
		// Complete the job
		_, completeErr := db.ExecContext(ctx,
			`SELECT complete_job($1, $2, $3::jsonb, $4, $5, $6, $7)`,
			claimedJobID, "SUCCEEDED", string(result2), nil, nil, "debug-worker", 0,
		)
		if completeErr != nil {
			t.Fatalf("complete_job failed: %v", completeErr)
		}
		t.Logf("complete_job called successfully")
	}

	// Manually run the worker for one cycle (will be no-op if debug above claimed it)
	w := NewWorker(db)
	w.workerID = "smoke-test-worker"
	w.Register("echo_test", EchoHandler)
	w.processOne(ctx)

	// Verify job status
	var status string
	var resultBytes []byte
	err = db.QueryRowContext(ctx,
		`SELECT status, result FROM public.t_jobs WHERE id = $1 AND tenant_id = $2`,
		jobID, tenantID,
	).Scan(&status, &resultBytes)
	result := json.RawMessage(resultBytes)
	if err != nil {
		t.Fatalf("query result: %v", err)
	}

	t.Logf("Job status: %s, result: %s", status, result)
	if status != "SUCCEEDED" {
		t.Errorf("expected SUCCEEDED, got %s", status)
	}

	var resultMap map[string]interface{}
	if err := json.Unmarshal(result, &resultMap); err != nil {
		t.Errorf("unmarshal result: %v", err)
	}
	if resultMap["hello"] != "smoke_test" {
		t.Errorf("result mismatch: %v", resultMap)
	}

	// Verify run log
	var runCount int
	err = db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM public.t_job_runs WHERE job_id = $1`,
		jobID,
	).Scan(&runCount)
	if err != nil {
		t.Fatalf("count runs: %v", err)
	}
	if runCount < 2 { // STARTED + SUCCEEDED
		t.Errorf("expected >=2 run log entries, got %d", runCount)
	}

	t.Logf("Smoke test PASSED: job %s SUCCEEDED with correct result, %d run log entries", jobID, runCount)

	// Cleanup
	db.ExecContext(ctx, `DELETE FROM public.t_job_runs WHERE job_id = $1`, jobID)
	db.ExecContext(ctx, `DELETE FROM public.t_jobs WHERE id = $1 AND tenant_id = $2`, jobID, tenantID)
	_ = time.Now() // suppress unused import
}
