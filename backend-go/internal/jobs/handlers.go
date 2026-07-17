package jobs

import (
	"context"
	"encoding/json"
)

// EchoHandler returns the payload unchanged.
// Used for end-to-end smoke testing of the worker pipeline:
//
//	SELECT enqueue_job('echo_test', '{"hello":"world"}'::jsonb);
//	-- wait ~5s for poll interval
//	SELECT status, result FROM t_jobs WHERE job_type = 'echo_test';
//	-- expect: status=SUCCEEDED, result={"hello":"world"}
func EchoHandler(_ context.Context, _ string, payload json.RawMessage) (json.RawMessage, error) {
	return payload, nil
}
