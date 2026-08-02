package jobs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/notification"
	"github.com/username/sinar-elektrik-backend/internal/notification/templates"
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

// NewPiutangManualSendHandler returns a JobHandler for the 'piutang_manual_send' job type.
// The handler is a closure that captures the shared notifier and service-role DB connection.
// It mirrors the reminder_poller send path but uses rule_type='MANUAL' for audit.
//
// Live DB column notes (verified 2026-07-19):
//   - orders.customer_id: text (not UUID)
//   - customers.wa_number: WA contact (not .phone)
//   - orders.total - orders.piutang_paid_amount: amount outstanding
//   - tenants has no .language column: default to "id"
//   - orders has no .invoice_no column: use short UUID suffix as display identifier
func NewPiutangManualSendHandler(notifier *notification.Notifier, db *sql.DB) JobHandler {
	return func(ctx context.Context, tenantID string, payload json.RawMessage) (json.RawMessage, error) {
		log := slog.Default().With(
			slog.String("job_type", "piutang_manual_send"),
			slog.String("tenant_id", tenantID),
		)

		// --- Parse payload ---
		var p struct {
			InvoiceID string `json:"invoice_id"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return nil, fmt.Errorf("piutang_manual_send: bad payload: %w", err)
		}
		if p.InvoiceID == "" {
			return nil, fmt.Errorf("piutang_manual_send: missing invoice_id in payload")
		}

		log = log.With(slog.String("invoice_id", p.InvoiceID))

		// --- Query invoice + customer + tenant + config ---
		var (
			customerID    string
			customerName  string
			customerPhone sql.NullString
			tokoName      string
			invoiceTotal  int64
			paidAmount    int64
			dueDate       time.Time
			convID        sql.NullString
			templateH3    sql.NullString
			templateH3Plus sql.NullString
		)
		err := db.QueryRowContext(ctx, `
			SELECT
			  o.customer_id,
			  c.name                                   AS customer_name,
			  c.wa_number                              AS customer_phone,
			  t.name                                   AS toko_name,
			  COALESCE(o.total, 0)::BIGINT             AS invoice_total,
			  COALESCE(o.piutang_paid_amount, 0)::BIGINT AS paid_amount,
			  o.due_date,
			  COALESCE(cv.id::TEXT, '')               AS conv_id,
			  cfg.template_h3,
			  cfg.template_h3_plus
			FROM public.orders o
			JOIN public.customers         c   ON c.id          = o.customer_id
			                                 AND c.tenant_id   = o.tenant_id
			JOIN public.tenants           t   ON t.id          = o.tenant_id
			LEFT JOIN public.conversations cv
			     ON cv.customer_phone = c.wa_number
			    AND cv.tenant_id      = o.tenant_id
			LEFT JOIN public.tenant_wa_reminder_config cfg ON cfg.tenant_id = o.tenant_id
			WHERE o.id = $1 AND o.tenant_id = $2
		`, p.InvoiceID, tenantID).Scan(
			&customerID, &customerName, &customerPhone, &tokoName,
			&invoiceTotal, &paidAmount, &dueDate,
			&convID, &templateH3, &templateH3Plus,
		)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, fmt.Errorf("piutang_manual_send: invoice %s not found for tenant %s", p.InvoiceID, tenantID)
			}
			return nil, fmt.Errorf("piutang_manual_send: query failed: %w", err)
		}

		phone := ""
		if customerPhone.Valid {
			phone = customerPhone.String
		}
		if phone == "" {
			log.WarnContext(ctx, "piutang_manual_send: customer has no WA number, skipping")
			recordManualSent(ctx, db, tenantID, p.InvoiceID, customerID, "", "SKIPPED", "customer wa_number is empty")
			return json.RawMessage(`{"status":"SKIPPED","reason":"no_wa_number"}`), nil
		}

		amountDue := invoiceTotal - paidAmount
		if amountDue < 0 {
			amountDue = 0
		}

		// --- Determine rule type: H-3 (before due) or H+3 (overdue/manual sends after due) ---
		// For manual sends: use H-3 template if invoice is not yet overdue, H+3 otherwise.
		today := time.Now().UTC().Truncate(24 * time.Hour)
		dueDateLocal := dueDate.UTC().Truncate(24 * time.Hour)
		isOverdue := today.After(dueDateLocal)

		// Short invoice reference for template (last 8 chars of UUID, readable without a full number).
		invoiceRef := p.InvoiceID
		if len(invoiceRef) > 8 {
			invoiceRef = invoiceRef[len(invoiceRef)-8:]
		}

		params := map[string]any{
			"customer_nama": customerName,
			"toko_nama":     tokoName,
			"invoice_no":    invoiceRef,
			"jumlah":        formatRpManual(amountDue),
			"due_date":      dueDate.Format("2 Jan 2006"),
		}

		convIDStr := ""
		if convID.Valid {
			convIDStr = convID.String
		}

		var msg string
		var buildErr error
		ruleType := "H-3"
		if isOverdue {
			ruleType = "H+3"
			overdueDays := int(today.Sub(dueDateLocal).Hours() / 24)
			if overdueDays < 0 {
				overdueDays = 0
			}
			params["overdue_days"] = overdueDays
			tmpl := templates.PiutangReminderH3Plus{}
			if templateH3Plus.Valid {
				tmpl.CustomTemplate = templateH3Plus.String
			}
			msg, buildErr = tmpl.Build(ctx, params)
		} else {
			tmpl := templates.PiutangReminderH3{}
			if templateH3.Valid {
				tmpl.CustomTemplate = templateH3.String
			}
			msg, buildErr = tmpl.Build(ctx, params)
		}
		if buildErr != nil {
			log.ErrorContext(ctx, "piutang_manual_send: template build failed", slog.String("error", buildErr.Error()))
			recordManualSent(ctx, db, tenantID, p.InvoiceID, customerID, "", "FAILED", buildErr.Error())
			return nil, fmt.Errorf("piutang_manual_send: template build failed: %w", buildErr)
		}

		// --- Send via NotifyCustomer (quota-checked, audit trail) ---
		sendErr := notifier.NotifyCustomer(ctx, tenantID, convIDStr, phone, "id", msg)
		switch {
		case sendErr == nil:
			recordManualSent(ctx, db, tenantID, p.InvoiceID, customerID, msg, "SENT", "")
			log.InfoContext(ctx, "piutang_manual_send: sent",
				slog.String("rule_type", ruleType),
				slog.String("customer_id", customerID))
			return json.RawMessage(`{"status":"SENT"}`), nil

		case errors.Is(sendErr, notification.ErrQuotaExceeded):
			recordManualSent(ctx, db, tenantID, p.InvoiceID, customerID, msg, "SKIPPED_QUOTA", "quota exceeded")
			log.InfoContext(ctx, "piutang_manual_send: quota exceeded",
				slog.String("customer_id", customerID))
			return json.RawMessage(`{"status":"SKIPPED_QUOTA"}`), nil

		case errors.Is(sendErr, notification.ErrWASessionOffline):
			recordManualSent(ctx, db, tenantID, p.InvoiceID, customerID, msg, "SKIPPED", sendErr.Error())
			return nil, fmt.Errorf("piutang_manual_send: WA session offline: %w", sendErr)

		default:
			recordManualSent(ctx, db, tenantID, p.InvoiceID, customerID, msg, "FAILED", sendErr.Error())
			return nil, fmt.Errorf("piutang_manual_send: send failed: %w", sendErr)
		}
	}
}

// recordManualSent writes a MANUAL audit row to piutang_reminder_sent.
// Uses ON CONFLICT DO NOTHING so duplicate calls on the same day are idempotent.
func recordManualSent(ctx context.Context, db *sql.DB, tenantID, invoiceID, customerID, msg, status, errMsg string) {
	_, err := db.ExecContext(ctx, `
		INSERT INTO public.piutang_reminder_sent
		  (tenant_id, invoice_id, customer_id, rule_type, status, message_body, error_message, sent_date)
		VALUES ($1, $2, $3, 'MANUAL', $4, $5, NULLIF($6, ''), CURRENT_DATE)
		ON CONFLICT (invoice_id, rule_type, sent_date) DO NOTHING
	`, tenantID, invoiceID, customerID, status, msg, errMsg)
	if err != nil {
		slog.ErrorContext(ctx, "piutang_manual_send: audit insert failed",
			slog.String("invoice_id", invoiceID),
			slog.String("status", status),
			slog.String("error", err.Error()))
	}
}

// formatRpManual formats an int64 as Indonesian Rupiah dot-separated thousands.
// Duplicated from piutang package to avoid cross-package import cycles.
func formatRpManual(n int64) string {
	if n == 0 {
		return "0"
	}
	sign := ""
	if n < 0 {
		sign = "-"
		n = -n
	}
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
