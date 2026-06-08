package db

import (
	"context"
	"database/sql"
	"time"
)

// ApprovalRequest is the Go representation of public.approval_requests.
// Payload is exposed as raw JSON bytes — callers (the WA sender, the webhook
// handler, the Owner dashboard) each parse a different request-type-specific
// schema, so we don't decode here. Nullable columns use sql.Null* wrappers
// rather than pointers because the rest of internal/db follows that style
// (see bank_config.go) and because Scan into Null* is the lib/pq idiom.
type ApprovalRequest struct {
	ID              int64
	RequestType     string
	Payload         []byte
	RequestedBy     string // uuid as text — callers don't parse it
	RequestedAt     time.Time
	ExpiresAt       time.Time
	Status          string
	DecidedBy       sql.NullString
	DecidedAt       sql.NullTime
	DecisionChannel sql.NullString
	WaMessageID     sql.NullString
}

// scanApprovalRequest scans a single SELECT-row into ApprovalRequest.
// Centralised so every helper that reads approval_requests stays in lockstep
// with the column list — adding a column means changing ONE place.
func scanApprovalRequest(s interface {
	Scan(dest ...any) error
}) (ApprovalRequest, error) {
	var a ApprovalRequest
	err := s.Scan(
		&a.ID,
		&a.RequestType,
		&a.Payload,
		&a.RequestedBy,
		&a.RequestedAt,
		&a.ExpiresAt,
		&a.Status,
		&a.DecidedBy,
		&a.DecidedAt,
		&a.DecisionChannel,
		&a.WaMessageID,
	)
	return a, err
}

const approvalRequestColumns = `
	id,
	request_type::text,
	payload,
	requested_by::text,
	requested_at,
	expires_at,
	status::text,
	decided_by::text,
	decided_at,
	decision_channel,
	wa_message_id`

// ListPendingApprovalRequests returns all pending approval rows in
// requested_at ASC order. When requestedBy is non-empty it acts as a filter
// on the requested_by UUID — used by per-tenant inbox views. Pass "" for the
// global pending list (the poller's per-minute snapshot and the all-owners
// dashboard both call it that way).
func (c *Client) ListPendingApprovalRequests(requestedBy string) ([]ApprovalRequest, error) {
	query := `
		SELECT` + approvalRequestColumns + `
		  FROM public.approval_requests
		 WHERE status = 'pending'`
	args := []any{}
	if requestedBy != "" {
		query += ` AND requested_by = $1::uuid`
		args = append(args, requestedBy)
	}
	query += ` ORDER BY requested_at ASC`

	rows, err := c.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ApprovalRequest
	for rows.Next() {
		a, err := scanApprovalRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetApprovalRequest fetches a single row by id. Returns sql.ErrNoRows when
// the id does not exist so callers can map directly to a 404 response.
func (c *Client) GetApprovalRequest(id int64) (ApprovalRequest, error) {
	row := c.DB.QueryRow(`
		SELECT`+approvalRequestColumns+`
		  FROM public.approval_requests
		 WHERE id = $1`, id)
	return scanApprovalRequest(row)
}

// SetWaMessageID records the WhatsApp message id of the approval card after
// Calista posts it to the Owner JID. Backed by the SECURITY DEFINER RPC
// public._set_wa_message_id (migration …022) whose WHERE wa_message_id IS NULL
// clause makes the call idempotent: a retry after a transient WA send error
// that actually delivered does NOT clobber the recorded id.
func (c *Client) SetWaMessageID(id int64, waMessageID string) error {
	_, err := c.DB.Exec(
		`SELECT public._set_wa_message_id($1, $2)`,
		id, waMessageID)
	return err
}

// ExpirePendingApprovals invokes the SECURITY DEFINER RPC
// public.expire_pending_approvals(), which flips every pending row whose
// expires_at < now() to status='expired' with decision_channel='auto_expire'
// and decided_by IS NULL. Returns the number of rows that were flipped on
// this call (zero is the common case once the backlog is drained).
//
// Called once per minute by approvals.Poller. Returning the count to the
// caller lets the poller log a one-line summary only when work happened, so
// the daemon log stays quiet during steady state.
//
// The query is scoped via QueryRowContext so the poller's ctx cancellation
// (clean shutdown) aborts an in-flight RPC rather than letting it run to
// completion against a closing pool.
func (c *Client) ExpirePendingApprovals(ctx context.Context) (int, error) {
	var n int
	err := c.DB.QueryRowContext(ctx,
		`SELECT public.expire_pending_approvals()`).Scan(&n)
	return n, err
}

// CountPendingApprovalsForOwner returns the total number of pending
// approval_requests rows across all owners. Used by the poller's heartbeat
// to surface "X requests still need your attention" in the daily WA digest.
// The name is aspirational — the spec deliberately does NOT filter by owner
// role here; in MSME deployments the pending queue is shared.
func (c *Client) CountPendingApprovalsForOwner() (int, error) {
	var n int
	err := c.DB.QueryRow(
		`SELECT COUNT(*) FROM public.approval_requests WHERE status = 'pending'`,
	).Scan(&n)
	return n, err
}
