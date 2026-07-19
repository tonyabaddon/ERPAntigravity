// backend-go/internal/notification/quota.go
package notification

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Quota gates NotifyCustomer sends by per-tenant daily WA send count.
// Zero-allocation hot path: single SELECT ... FOR UPDATE + UPDATE per send.
// Reset is lazy: when wa_daily_quota_reset_date < today, we zero the counter
// and set reset_date to today.
type Quota struct {
	db *sql.DB
}

// NewQuota returns a Quota checker bound to the shared txn-pooler DB handle.
func NewQuota(db *sql.DB) *Quota { return &Quota{db: db} }

// CheckAndIncrement atomically verifies quota is not exceeded and increments
// the used counter. Returns ErrQuotaExceeded if daily limit reached.
func (q *Quota) CheckAndIncrement(ctx context.Context, tenantID string) error {
	tx, err := q.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("quota: begin tx: %w", err)
	}
	defer tx.Rollback()

	var used, limit int
	var resetDate time.Time
	err = tx.QueryRowContext(ctx, `
		SELECT wa_daily_quota_used, wa_daily_quota_limit, wa_daily_quota_reset_date
		FROM tenant_subscriptions
		WHERE tenant_id = $1
		FOR UPDATE
	`, tenantID).Scan(&used, &limit, &resetDate)
	if err != nil {
		return fmt.Errorf("quota: select tenant: %w", err)
	}

	// Lazy reset: if reset_date is earlier than today, zero the counter.
	today := time.Now().UTC().Format("2006-01-02")
	if resetDate.UTC().Format("2006-01-02") < today {
		used = 0
	}

	if used >= limit {
		return ErrQuotaExceeded
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE tenant_subscriptions
		SET wa_daily_quota_used = $1,
		    wa_daily_quota_reset_date = CURRENT_DATE
		WHERE tenant_id = $2
	`, used+1, tenantID)
	if err != nil {
		return fmt.Errorf("quota: update tenant: %w", err)
	}
	return tx.Commit()
}
