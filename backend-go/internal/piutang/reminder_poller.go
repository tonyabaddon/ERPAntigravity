// Package piutang implements the Piutang WA reminder cron poller.
// Fires daily at 09:00 WIB; scans Premium tenants for tempo/kredit invoices
// that are H-3 (3 days before due) or H+3 (3 days overdue), then sends a
// WhatsApp reminder via the shared notification.Notifier framework.
package piutang

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/notification"
	"github.com/username/sinar-elektrik-backend/internal/notification/templates"
)

// ReminderPoller runs the Piutang WA reminder cron.
// Fires daily at 09:00 WIB via time.After; scans Premium tenants for eligible
// invoices (H-3 or H+3 to due_date) and enqueues sends.
type ReminderPoller struct {
	db       *sql.DB
	notifier *notification.Notifier
	tz       *time.Location // WIB
}

// NewReminderPoller returns a poller. Call Start(ctx) to launch the cron goroutine.
func NewReminderPoller(db *sql.DB, notifier *notification.Notifier) *ReminderPoller {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	return &ReminderPoller{db: db, notifier: notifier, tz: tz}
}

// Start launches the 09:00 WIB daily cron goroutine.
// Stops when ctx is cancelled (process shutdown).
func (r *ReminderPoller) Start(ctx context.Context) {
	go func() {
		for {
			next := nextDailyTarget(time.Now().In(r.tz), 9, 0)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Until(next)):
				r.runOnce(ctx)
			}
		}
	}()
}

// nextDailyTarget returns the next occurrence of HH:MM in the given timezone.
// If today's HH:MM has already passed, returns tomorrow's.
func nextDailyTarget(now time.Time, hour, min int) time.Time {
	target := time.Date(now.Year(), now.Month(), now.Day(), hour, min, 0, 0, now.Location())
	if !target.After(now) {
		target = target.AddDate(0, 0, 1)
	}
	return target
}

// runOnce executes one reminder pass: queries eligible invoices, sends WA,
// records audit row for every outcome (SENT / SKIPPED_QUOTA / SKIPPED / FAILED).
func (r *ReminderPoller) runOnce(ctx context.Context) {
	log := slog.Default().With("feature", "piutang_reminder_poller")
	log.InfoContext(ctx, "cron tick — scanning eligible invoices")

	rows, err := r.db.QueryContext(ctx, eligibleInvoicesQuery())
	if err != nil {
		log.ErrorContext(ctx, "eligibility query failed", slog.Any("error", err))
		return
	}
	defer rows.Close()

	var sentCount, failedCount, skippedCount int

	for rows.Next() {
		var (
			invoiceID     string
			customerID    string
			tenantID      string
			convID        string
			ruleType      string
			customerName  string
			tokoName      string
			customerPhone string
			invoiceNo     string
			tokoLang      string
			jumlah        int64
			dueDate       time.Time
			templateH3    string
			templateH3Plus string
		)
		if err := rows.Scan(
			&invoiceID, &customerID, &tenantID, &convID, &ruleType,
			&customerName, &tokoName, &customerPhone, &invoiceNo,
			&tokoLang, &jumlah, &dueDate, &templateH3, &templateH3Plus,
		); err != nil {
			log.ErrorContext(ctx, "row scan failed", slog.Any("error", err))
			continue
		}

		params := map[string]any{
			"customer_nama": customerName,
			"toko_nama":     tokoName,
			"invoice_no":    invoiceNo,
			"jumlah":        formatRp(jumlah),
			"due_date":      dueDate.Format("2 Jan 2006"),
		}

		var msg string
		var buildErr error
		if ruleType == "H-3" {
			t := templates.PiutangReminderH3{CustomTemplate: templateH3}
			msg, buildErr = t.Build(ctx, params)
		} else {
			// H+3: add overdue_days param
			overdueDays := int(time.Since(dueDate).Hours() / 24)
			if overdueDays < 0 {
				overdueDays = 0
			}
			params["overdue_days"] = overdueDays
			t := templates.PiutangReminderH3Plus{CustomTemplate: templateH3Plus}
			msg, buildErr = t.Build(ctx, params)
		}
		if buildErr != nil {
			log.ErrorContext(ctx, "template build failed",
				slog.String("invoice_id", invoiceID),
				slog.String("rule_type", ruleType),
				slog.Any("error", buildErr))
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, "", "FAILED", buildErr.Error())
			failedCount++
			continue
		}

		// Send via NotifyCustomer — quota checked, audit trail written atomically.
		sendErr := r.notifier.NotifyCustomer(ctx, tenantID, convID, customerPhone, tokoLang, msg)
		switch {
		case sendErr == nil:
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, msg, "SENT", "")
			sentCount++
			log.InfoContext(ctx, "piutang reminder sent",
				slog.String("invoice_id", invoiceID),
				slog.String("rule_type", ruleType),
				slog.String("tenant_id", tenantID))

		case errors.Is(sendErr, notification.ErrQuotaExceeded):
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, msg, "SKIPPED_QUOTA", "")
			skippedCount++
			log.InfoContext(ctx, "piutang reminder quota exceeded, skipping",
				slog.String("invoice_id", invoiceID),
				slog.String("tenant_id", tenantID))

		case errors.Is(sendErr, notification.ErrWASessionOffline):
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, msg, "SKIPPED", sendErr.Error())
			skippedCount++
			log.WarnContext(ctx, "piutang reminder WA session offline",
				slog.String("invoice_id", invoiceID),
				slog.String("tenant_id", tenantID),
				slog.Any("error", sendErr))

		default:
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, msg, "FAILED", sendErr.Error())
			failedCount++
			log.ErrorContext(ctx, "piutang reminder send failed",
				slog.String("invoice_id", invoiceID),
				slog.String("tenant_id", tenantID),
				slog.Any("error", sendErr))
		}
	}

	if err := rows.Err(); err != nil {
		log.ErrorContext(ctx, "rows iteration error", slog.Any("error", err))
	}

	log.InfoContext(ctx, "cron pass done",
		slog.Int("sent", sentCount),
		slog.Int("failed", failedCount),
		slog.Int("skipped", skippedCount))
}

// recordSent writes one audit row per reminder attempt to piutang_reminder_sent.
// sent_date is derived from NOW() on the DB side to satisfy the UNIQUE constraint
// (invoice_id, rule_type, sent_date) enforced by Task 2.1.
// ON CONFLICT DO NOTHING: idempotent — if the cron runs twice in a day (restart
// or manual trigger), only the first row lands.
func (r *ReminderPoller) recordSent(ctx context.Context, tenantID, invoiceID, customerID, ruleType, msg, status, errMsg string) {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO public.piutang_reminder_sent
		  (tenant_id, invoice_id, customer_id, rule_type, status, message_body, error_message)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''))
		ON CONFLICT (invoice_id, rule_type, (DATE(sent_at))) DO NOTHING
	`, tenantID, invoiceID, customerID, ruleType, status, msg, errMsg)
	if err != nil {
		slog.ErrorContext(ctx, "piutang_reminder_sent audit insert failed",
			slog.String("invoice_id", invoiceID),
			slog.String("status", status),
			slog.Any("error", err))
	}
}

// eligibleInvoicesQuery returns the SQL selecting invoices eligible for a
// piutang WA reminder today. Covers two rules:
//   - H-3: invoice due exactly 3 calendar days from now
//   - H+3: invoice due exactly 3 calendar days ago (overdue)
//
// Filters: Premium tier, active subscription, piutang WA feature enabled,
// customer WA consent enabled, tenant-level reminder config enabled,
// and NOT already SENT today for the same rule.
func eligibleInvoicesQuery() string {
	return `
	SELECT
	  o.id                                     AS invoice_id,
	  o.customer_id,
	  o.tenant_id,
	  COALESCE(cv.id::TEXT, '')               AS conv_id,
	  CASE
	    WHEN o.due_date = CURRENT_DATE + INTERVAL '3 days' THEN 'H-3'
	    ELSE 'H+3'
	  END                                      AS rule_type,
	  c.name                                   AS customer_name,
	  t.name                                   AS toko_name,
	  c.phone                                  AS customer_phone,
	  o.invoice_no,
	  COALESCE(t.language, 'id')              AS toko_language,
	  o.amount_due::BIGINT                     AS jumlah,
	  o.due_date,
	  COALESCE(cfg.template_h3, '')           AS template_h3,
	  COALESCE(cfg.template_h3_plus, '')      AS template_h3_plus
	FROM public.orders o
	JOIN public.customers    c   ON c.id       = o.customer_id
	JOIN public.tenants      t   ON t.id       = o.tenant_id
	JOIN public.tenant_subscriptions ts        ON ts.tenant_id = o.tenant_id
	LEFT JOIN public.conversations cv
	     ON cv.customer_phone = c.phone
	    AND cv.tenant_id      = o.tenant_id
	LEFT JOIN public.tenant_wa_reminder_config cfg ON cfg.tenant_id = o.tenant_id
	WHERE
	  ts.tier = 'premium'
	  AND ts.status = 'active'
	  AND ts.piutang_wa_reminder_enabled = TRUE
	  AND o.status = 'OPEN'
	  AND o.payment_type IN ('tempo', 'kredit')
	  AND c.phone IS NOT NULL AND c.phone <> ''
	  AND c.wa_reminder_enabled = TRUE
	  AND COALESCE(cfg.enabled, TRUE) = TRUE
	  AND (
	        (     o.due_date = CURRENT_DATE + INTERVAL '3 days'
	          AND NOT EXISTS (
	                SELECT 1 FROM public.piutang_reminder_sent prs
	                WHERE prs.invoice_id = o.id
	                  AND prs.rule_type  = 'H-3'
	                  AND prs.status     = 'SENT'
	              )
	        )
	    OR
	        (     o.due_date = CURRENT_DATE - INTERVAL '3 days'
	          AND NOT EXISTS (
	                SELECT 1 FROM public.piutang_reminder_sent prs
	                WHERE prs.invoice_id = o.id
	                  AND prs.rule_type  = 'H+3'
	                  AND prs.status     = 'SENT'
	              )
	        )
	      )
	`
}

// formatRp formats an integer as Indonesian Rupiah with dot-separated thousands.
// Example: 1500000 → "1.500.000"
func formatRp(n int64) string {
	if n == 0 {
		return "0"
	}
	sign := ""
	if n < 0 {
		sign = "-"
		n = -n
	}
	// Build digit string with dots every 3 digits from the right
	digits := []byte{}
	for n > 0 {
		if len(digits) > 0 && len(digits)%3 == 0 {
			digits = append([]byte{'.'}, digits...)
		}
		digits = append([]byte{byte(n%10) + '0'}, digits...)
		n /= 10
	}
	return sign + string(digits)
}
