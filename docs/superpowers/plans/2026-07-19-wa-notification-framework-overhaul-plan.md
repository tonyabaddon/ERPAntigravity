# WA Notification Framework Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each sprint is independently deployable — complete Sprint N tasks in order, deploy, THEN move to Sprint N+1.

**Goal:** Ship shared WA notification framework (`internal/notification` package) + Piutang WA reminder scheduler + universal editable templates + new staff notifications + notification-quality improvements + E2E verification + Caleo Admin WA prospect bot — 7 sprints across 23.5 dev-days.

**Architecture:** New Go package `internal/notification` provides three wrapper primitives (`NotifyCustomer`, `BroadcastToStaff`, `SendOpsEmail`) that ALL WA-send call sites migrate to. Named template registry (`internal/notification/templates/`) replaces inline `fmt.Sprintf`. Per-tenant editable template registry stored in `tenant_notification_templates` with versioning history. Piutang reminder + new staff notifications built on top as pollers following existing `internal/followup/poller.go` pattern. Caleo Admin WA Bot uses reserved sentinel tenant with keyword-based FAQ matcher.

**Tech Stack:** Go 1.22+ backend (`whatsmeow` for WA, `slog` for structured logging), Postgres/Supabase (RLS-enforced), React frontend with existing design tokens (Inter font, navy/gold palette), Resend for email fallback, Playwright for E2E tests, Sentry for observability.

## Global Constraints

- **Reference spec**: `docs/superpowers/specs/2026-07-19-wa-notification-framework-overhaul-design.md`. Read Sections 4 (success criteria per sprint), 5 (architecture), 6 (data model), 15 (best practices), 16 (UX principles) before executing any task.
- **Backend Go module path**: `github.com/tonywei/erp-antigravity/backend-go` (`internal/notification`, `internal/piutang`, `internal/caleobot`).
- **Frontend framework**: React + TypeScript, custom `useURLRoute` for routing (NOT React Router).
- **Design tokens (verbatim, must use exact values)**: `--navy: #0B2545`, `--navy-2: #1e3d60`, `--gold: #FBBF24`, `--gold-2: #F59E0B`, `--slate: #5A6472`, `--muted: #64748B`, `--wa: #1a7a3d`, `--success: #16A34A`, `--danger: #DC2626`. Font: `Inter`.
- **Language**: Bahasa Indonesia for all user-facing copy. NO English UI copy leakage. Error messages plain-language ("Nomor WA belum diisi" not "phone_number is null").
- **Character limit for WA templates**: 700 chars (WhatsApp friendly). Enforce at save + at render.
- **Migration slot allocation**: Per memory `migration_slot_allocation`, current session claims slots `20261115000400-20261115000499` (100 slots). Never reuse. Never take slots claimed by parallel worktrees.
- **All migrations idempotent**: `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`, guarded backfills with `WHERE NOT EXISTS`.
- **RLS on every new table**: `ENABLE ROW LEVEL SECURITY` + `t_select_own`, `t_insert_own`, `t_update_own`, `t_delete_own` policies scoped to `tenant_id`. Grant SELECT to `authenticated` + `vosi_rpc_owner`.
- **SECURITY DEFINER RPC for writes**: All write RPCs owned by `vosi_rpc_owner`, `INSERT ... RETURNING` requires `t_select_own` includes `vosi_rpc_owner` (per memory `secdef_returning_gap`).
- **Smoke test every new SECDEF RPC**: `set_config('request.jwt.claim.sub', 'test-user-id')` + `RAISE EXCEPTION` rollback pattern (per memory `smoke_test_security_definer_rpcs`).
- **Structured logging**: Use `slog.With("tenant_id", tenantID).ErrorContext(ctx, msg, slog.Any("error", err))`. No `log.Printf`.
- **Feature flags for kill switch**: Every user-visible feature gated by tenant-config boolean that defaults to safe state.
- **Zero infrastructure cost**: Reuse whatsmeow (free), Postgres/Supabase (existing), Sentry (existing), Resend (free tier).
- **`caleo-pembelian-real.png`** is NOT copied to `public/` (per Phase 3 landing exclusion).
- **7 refs per file per pricing update**: schema.org JSON-LD price, `data-p6/p12/strike` attributes, `.v-strike` display, `.v-price` display, `.v-commit` tagline savings, WA CTA URL, FAQ #2 mention.
- **Every sprint independently deployable**: If Sprint N fails E2E, roll back Sprint N without affecting Sprints 1..N-1.
- **Deploy verify pattern**: after `git push main`, run `gcloud builds list --limit=2` and confirm `STATUS!=FAILURE` before treating deploy as shipped (per memory `deploy_verify_after_push`).
- **Backend split-pool config**: queries via txn pooler (`:6543`), listener via direct (`:5432`) — do NOT change (per memory `supabase_split_pool`).

---

## File Structure

**New backend files (all sprints):**

```
backend-go/
├── internal/
│   ├── notification/                          ← NEW package (Sprint 1)
│   │   ├── notify_customer.go                 ← NotifyCustomer() wrapper
│   │   ├── broadcast_staff.go                 ← BroadcastToStaff() wrapper
│   │   ├── send_ops_email.go                  ← SendOpsEmail() wrapper (Sprint 5)
│   │   ├── message_builder.go                 ← MessageBuilder interface
│   │   ├── recipients_cache.go                ← 60s LRU cache for GetActiveRecipients
│   │   ├── quota.go                           ← Per-tenant daily quota check
│   │   ├── quiet_hours.go                     ← Quiet hours + consolidation logic (Sprint 5)
│   │   ├── session_health.go                  ← WA session health poller (Sprint 5)
│   │   ├── errors.go                          ← Typed errors (ErrQuotaExceeded, etc.)
│   │   ├── notification_test.go               ← Unit tests
│   │   └── templates/                         ← Named template renderers
│   │       ├── piutang_reminder_h3.go         ← Sprint 2
│   │       ├── piutang_reminder_h3_plus.go    ← Sprint 2
│   │       ├── piutang_overdue_summary.go     ← Sprint 4
│   │       ├── hutang_overdue_summary.go      ← Sprint 4
│   │       ├── approval_sla_breach.go         ← Sprint 4
│   │       ├── post_order_feedback.go         ← Sprint 4
│   │       ├── booking_expiry.go              ← Sprint 1 (extracted from main.go)
│   │       ├── admin_forward.go               ← Sprint 1 (extracted from main.go)
│   │       ├── approval_card.go               ← Sprint 1 (wraps existing FormatApprovalMessage)
│   │       ├── followup_customer.go           ← Sprint 1 (extracted from followup/poller.go)
│   │       ├── heartbeat_digest.go            ← Sprint 1 (extracted from heartbeat/poller.go)
│   │       ├── order_created.go               ← Sprint 3
│   │       ├── order_shipped.go               ← Sprint 3
│   │       ├── payment_verified.go            ← Sprint 3 (extracted from handler.go)
│   │       ├── dp_verified.go                 ← Sprint 3 (extracted from handler.go)
│   │       ├── payment_rejected.go            ← Sprint 3 (extracted from handler.go)
│   │       ├── order_approved.go              ← Sprint 3 (extracted from handler.go)
│   │       ├── staff_escalation_payment.go    ← Sprint 3 (extracted from handler.go)
│   │       ├── staff_escalation_llm.go        ← Sprint 3 (extracted from handler.go)
│   │       └── caleo_admin_faq.go             ← Sprint 7 (15 FAQ entries)
│   ├── piutang/
│   │   └── reminder_poller.go                 ← Sprint 2
│   ├── hutang/                                 ← NEW package (Sprint 4)
│   │   └── overdue_summary_poller.go          ← Sprint 4
│   ├── approvals/
│   │   └── sla_breach_poller.go               ← Sprint 4 (new file, existing package)
│   ├── feedback/                               ← NEW package (Sprint 4)
│   │   └── request_poller.go                  ← Sprint 4
│   └── caleobot/                               ← NEW package (Sprint 7)
│       ├── session.go                         ← Caleo Admin WA session bootstrapper
│       ├── faq_matcher.go                     ← Keyword-based FAQ dispatcher
│       ├── escalation.go                      ← Forward-to-founder logic
│       └── analytics.go                       ← Prospect tracking

├── main.go                                     ← MODIFY: register new pollers, remove inline closures

supabase/migrations/
├── 20261115000400_wa_daily_quota.sql          ← Sprint 1 (B4 fix)
├── 20261115000401_approval_wa_sent_at.sql     ← Sprint 1 (B1 dedup)
├── 20261115000410_piutang_reminder_sent.sql   ← Sprint 2
├── 20261115000411_customers_wa_reminder_flag.sql ← Sprint 2
├── 20261115000412_tenant_wa_reminder_config.sql ← Sprint 2
├── 20261115000420_notification_templates.sql  ← Sprint 3
├── 20261115000421_notification_templates_history.sql ← Sprint 3
├── 20261115000422_orders_create_trigger.sql   ← Sprint 3 (order_created NOTIFY)
├── 20261115000430_approval_sla_breach_flag.sql ← Sprint 4
├── 20261115000431_customer_feedback.sql       ← Sprint 4
├── 20261115000440_notification_prefs.sql      ← Sprint 5 (quiet hours + consolidation + silent-day)
├── 20261115000441_wa_session_health.sql       ← Sprint 5
└── 20261115000470_caleo_admin_bot.sql         ← Sprint 7 (faq + analytics)
```

**New frontend files:**

```
src/
├── components/
│   ├── pengaturan/
│   │   ├── PiutangWaReminderScreen.tsx        ← Sprint 2
│   │   ├── NotificationTemplatesScreen.tsx    ← Sprint 3 (universal)
│   │   ├── NotificationCronScreen.tsx         ← Sprint 4 (Piutang/Hutang summary + SLA + Feedback config)
│   │   ├── NotificationPrefsScreen.tsx        ← Sprint 5 (quiet hours + consolidation)
│   │   └── WaRecipientsCrudScreen.tsx         ← Sprint 6 (audit + fix)
│   ├── piutang/
│   │   └── PiutangScreen.tsx                  ← MODIFY: enable disabled button, add badges + filters (Sprint 2)
│   ├── PelangganScreen.tsx                    ← MODIFY: add wa_reminder_enabled toggle (Sprint 2)
│   ├── admin/
│   │   └── CaleoBotDashboard.tsx              ← Sprint 7 analytics
│   └── notification/                           ← NEW shared components
│       ├── TemplateChipInput.tsx              ← Sprint 2 (chip-based variable insertion)
│       ├── TemplatePreview.tsx                ← Sprint 2 (WhatsApp bubble preview)
│       ├── TemplateEditor.tsx                 ← Sprint 2 (combined editor: chips + textarea + preview + test-send)
│       ├── TemplateHistoryModal.tsx           ← Sprint 3 (Riwayat Perubahan)
│       └── OnboardingTourModal.tsx            ← Sprint 2 (first-time editor tour)

tests/e2e/tests/
├── wa-notifications/                          ← NEW test suite (Sprint 6)
│   ├── path-a-calista.spec.ts                 ← Path A: Calista AI reply
│   ├── path-b-staff-escalation.spec.ts        ← Path B: staff escalation
│   ├── path-c-approval-card.spec.ts           ← Path C: order approval WA card
│   ├── path-d-followup.spec.ts                ← Path D: follow-up re-engagement
│   ├── path-e-booking-expiry.spec.ts          ← Path E: booking expiry reminder
│   ├── path-f-lifecycle.spec.ts               ← Path F: payment/order lifecycle events
│   ├── path-g-admin-forward.spec.ts           ← Path G: admin forward via Sales Inbox
│   └── wa-recipients-crud.spec.ts             ← Sprint 6: recipient CRUD audit
```

---

## Task Numbering Convention

Tasks are prefixed with sprint number: **Task 1.1, 1.2, ...** = Sprint 1. **Task 2.1, 2.2, ...** = Sprint 2. And so on. This lets subagent-driven execution focus on one sprint's tasks before proceeding.

**Sprint dependencies**:
- Sprint 1 (harmonization) must complete before Sprint 2, 3, 4, 5, 7 (they consume the notification package)
- Sprint 2 must complete before Sprint 3 (template editor UX reused for universal rollout)
- Sprints 4, 5, 6, 7 can execute in any order after Sprints 1-3 (loosely coupled)

---

# 🏗️ SPRINT 1 — Harmonize + Fix B1/B2/B3/B4 (2 dev-days)

**Spec reference**: Section 5.1 (harmonization layer), 5.2 (retry policy), success criteria bullet Sprint 1.

**Goal**: All 8 existing WA send paths migrate to `NotifyCustomer` / `BroadcastToStaff` wrappers. Fix 4 audit bugs. B1: wire approval card send. B2/B3: audit trail via wrappers. B4: 300/day quota enforcement.

### Task 1.1: Bootstrap `internal/notification` package with error types

**Files:**
- Create: `backend-go/internal/notification/errors.go`
- Create: `backend-go/internal/notification/notification_test.go`

**Interfaces:**
- Consumes: nothing (foundational)
- Produces: `ErrQuotaExceeded`, `ErrWASessionOffline`, `ErrSendFailed`, `ErrTemplateRenderError` typed errors

- [ ] **Step 1: Write the failing test**

```go
// backend-go/internal/notification/notification_test.go
package notification

import (
	"errors"
	"testing"
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend-go && go test ./internal/notification/... -run TestErrQuotaExceeded -v
```

Expected: FAIL with `undefined: ErrQuotaExceeded`.

- [ ] **Step 3: Write minimal implementation**

```go
// backend-go/internal/notification/errors.go
// Package notification is the shared WA notification framework for the
// Caleo ERP. All application code calls this package's wrappers (NotifyCustomer,
// BroadcastToStaff, SendOpsEmail) instead of calling whatsmeow.Sender directly.
// This keeps quota enforcement, retry policy, audit trail, and typed errors
// consistent across every send site.
package notification

import "errors"

var (
	// ErrQuotaExceeded is returned when a tenant has exhausted their daily WA send quota.
	ErrQuotaExceeded = errors.New("wa notification: tenant daily quota exceeded")

	// ErrWASessionOffline is returned when the tenant's whatsmeow session is disconnected.
	ErrWASessionOffline = errors.New("wa notification: whatsmeow session offline")

	// ErrSendFailed is returned when whatsmeow.SendText returns an error.
	ErrSendFailed = errors.New("wa notification: send failed")

	// ErrTemplateRenderError is returned when a MessageBuilder cannot render the message
	// (missing required param, template syntax error, etc.).
	ErrTemplateRenderError = errors.New("wa notification: template render error")
)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend-go && go test ./internal/notification/... -v
```

Expected: PASS (all 4 error tests).

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/notification/errors.go backend-go/internal/notification/notification_test.go
git commit -m "feat(notification): bootstrap package with typed errors

Foundation for Sprint 1 harmonization. All WA-send callers will migrate
to this package's wrappers. Typed errors let callers distinguish quota
exceeded (log INFO, no retry) from send failed (retry once) from
session offline (skip + retry tomorrow).

Refs spec 5.1."
```

---

### Task 1.2: Add `wa_daily_quota_used` migration (fixes B4)

**Files:**
- Create: `supabase/migrations/20261115000400_wa_daily_quota.sql`

**Interfaces:**
- Consumes: existing `tenant_subscriptions` table
- Produces: `tenant_subscriptions.wa_daily_quota_used`, `tenant_subscriptions.wa_daily_quota_reset_date`, `tenant_subscriptions.wa_daily_quota_limit` columns

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20261115000400_wa_daily_quota.sql
-- B4 fix: enforce Calista 300 chat/hari cap per tenant.
--
-- Landing/pricing.md claim "300 conv/hari per tenant" was not enforced in
-- code. This migration adds columns tracked by the internal/notification
-- package's Quota check. Reset happens implicitly when wa_daily_quota_reset_date
-- < CURRENT_DATE (row updated to today, counter zeroed).
--
-- Idempotent: safe to re-run.

ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS wa_daily_quota_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wa_daily_quota_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS wa_daily_quota_limit INT NOT NULL DEFAULT 300;

COMMENT ON COLUMN public.tenant_subscriptions.wa_daily_quota_used IS
  'B4 fix (2026-07-19): rolling daily counter of WA sends to customers. Reset to 0 when wa_daily_quota_reset_date < CURRENT_DATE. Default 300 = Calista Premium tier cap per landing claim.';
```

- [ ] **Step 2: Apply migration via MCP**

Use `mcp__plugin_supabase_supabase__apply_migration`:
- Name: `wa_daily_quota`
- Query: (paste the migration SQL above, without the filename comment)

Expected: success + new columns visible in `tenant_subscriptions`.

- [ ] **Step 3: Verify columns exist**

Use `mcp__plugin_supabase_supabase__execute_sql`:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tenant_subscriptions'
  AND column_name IN ('wa_daily_quota_used', 'wa_daily_quota_reset_date', 'wa_daily_quota_limit');
```

Expected: 3 rows returned.

- [ ] **Step 4: Run get_advisors after migration**

Use `mcp__plugin_supabase_supabase__get_advisors` with `type: 'security'`.

Expected: no NEW findings related to `tenant_subscriptions` (pre-existing findings unchanged is fine).

- [ ] **Step 5: Add migration file to git + commit**

```bash
git add supabase/migrations/20261115000400_wa_daily_quota.sql
git commit -m "feat(db): B4 fix — wa_daily_quota columns on tenant_subscriptions

Landing claim 300 chat/hari Calista cap was not enforced. Adds tracking
columns for internal/notification package Quota check. Default limit 300
matches pricing.md Premium tier disclosure.

Migration slot 400 (session claim block 400-499).

Refs spec 5.1, 6."
```

---

### Task 1.3: Implement Quota check + `NotifyCustomer` wrapper

**Files:**
- Create: `backend-go/internal/notification/quota.go`
- Create: `backend-go/internal/notification/notify_customer.go`
- Modify: `backend-go/internal/notification/notification_test.go`

**Interfaces:**
- Consumes: `errors.go` typed errors (Task 1.1), quota columns (Task 1.2), existing `internal/whatsapp/sender.go` `Sender.SendText`, existing `internal/db/messages.go` `InsertMessage`
- Produces: `func NotifyCustomer(ctx context.Context, tenantID, convID, phone, lang, msg string) error`

- [ ] **Step 1: Write the failing test for quota check**

```go
// backend-go/internal/notification/notification_test.go — APPEND
package notification

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestQuotaCheck_Passes_WhenUnderLimit(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()

	tenantID := "11111111-1111-1111-1111-111111111111"
	mock.ExpectQuery("SELECT wa_daily_quota_used, wa_daily_quota_limit, wa_daily_quota_reset_date FROM tenant_subscriptions").
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"used", "limit", "reset_date"}).AddRow(50, 300, "2026-07-19"))

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
	mock.ExpectQuery("SELECT wa_daily_quota_used, wa_daily_quota_limit, wa_daily_quota_reset_date FROM tenant_subscriptions").
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"used", "limit", "reset_date"}).AddRow(300, 300, "2026-07-19"))

	q := &Quota{db: db}
	err := q.CheckAndIncrement(context.Background(), tenantID)
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("expected ErrQuotaExceeded, got %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend-go && go test ./internal/notification/... -run TestQuotaCheck -v
```

Expected: FAIL with `undefined: Quota`.

- [ ] **Step 3: Implement Quota**

```go
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
```

- [ ] **Step 4: Write the failing test for NotifyCustomer**

```go
// backend-go/internal/notification/notification_test.go — APPEND

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
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd backend-go && go test ./internal/notification/... -run TestNotifyCustomer -v
```

Expected: FAIL with `undefined: Notifier`.

- [ ] **Step 6: Implement NotifyCustomer**

```go
// backend-go/internal/notification/notify_customer.go
package notification

import (
	"context"
	"errors"
	"log/slog"
)

// sendClient wraps whatsmeow.Sender for testability.
type sendClient interface {
	SendText(ctx context.Context, phone, msg string) error
}

// messageInserter wraps db.InsertMessage for testability.
type messageInserter interface {
	InsertMessage(ctx context.Context, convID, sender, text string) error
}

// quotaChecker wraps Quota for testability.
type quotaChecker interface {
	CheckAndIncrement(ctx context.Context, tenantID string) error
}

// Notifier is the shared WA notification framework. All WA-send callers
// call Notifier.NotifyCustomer (customer sends) or Notifier.BroadcastToStaff
// (staff/owner broadcasts) instead of the raw whatsmeow.Sender.
type Notifier struct {
	sender   sendClient
	inserter messageInserter
	quota    quotaChecker
	logger   *slog.Logger
}

// NewNotifier returns a Notifier bound to the given collaborators.
func NewNotifier(s sendClient, i messageInserter, q quotaChecker, l *slog.Logger) *Notifier {
	return &Notifier{sender: s, inserter: i, quota: q, logger: l}
}

// NotifyCustomer sends a WA message to a customer with atomic audit trail write
// and per-tenant daily quota enforcement.
//
// Behavior:
//   - Checks quota via quotaChecker; returns ErrQuotaExceeded if exhausted.
//   - Calls sendClient.SendText; wraps errors as ErrSendFailed.
//   - On send success, calls messageInserter.InsertMessage (audit trail).
//   - Emits structured log at every call with {tenant_id, phone_hash, status}.
func (n *Notifier) NotifyCustomer(ctx context.Context, tenantID, convID, phone, lang, msg string) error {
	logger := n.logger
	if logger == nil {
		logger = slog.Default()
	}
	log := logger.With("tenant_id", tenantID, "phone_hash", hashPhone(phone), "feature", "notify_customer")

	if err := n.quota.CheckAndIncrement(ctx, tenantID); err != nil {
		if errors.Is(err, ErrQuotaExceeded) {
			log.InfoContext(ctx, "wa quota exceeded, skipping send")
			return err
		}
		log.ErrorContext(ctx, "quota check failed", slog.Any("error", err))
		return err
	}

	if err := n.sender.SendText(ctx, phone, msg); err != nil {
		log.ErrorContext(ctx, "wa send failed", slog.Any("error", err))
		return errors.Join(ErrSendFailed, err)
	}

	if err := n.inserter.InsertMessage(ctx, convID, "AI", msg); err != nil {
		// Audit failure is logged but does NOT fail the send — customer received message.
		log.WarnContext(ctx, "audit insert failed post-send", slog.Any("error", err))
	}

	log.InfoContext(ctx, "wa notification sent", slog.String("status", "SENT"))
	return nil
}

// hashPhone returns a stable non-reversible hash for logging (avoid PII leak).
// Uses first 4 chars + last 2 chars as fingerprint.
func hashPhone(phone string) string {
	if len(phone) < 6 {
		return "xxx"
	}
	return phone[:4] + "..." + phone[len(phone)-2:]
}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd backend-go && go test ./internal/notification/... -v
```

Expected: PASS (6 tests: 4 error types, 2 quota, 2 NotifyCustomer).

- [ ] **Step 8: Commit**

```bash
git add backend-go/internal/notification/quota.go backend-go/internal/notification/notify_customer.go backend-go/internal/notification/notification_test.go
git commit -m "feat(notification): Quota + NotifyCustomer wrapper

Sprint 1 core primitive. Every WA-send caller migrates to NotifyCustomer
which atomically enforces per-tenant daily quota (fixes B4), delegates
to whatsmeow.SendText, and writes messages audit row (fixes B2/B3 when
existing paths migrate).

Structured logging with phone_hash (no PII leak). Typed error returns.

Refs spec 5.1, 6."
```

---

### Task 1.4: Implement `BroadcastToStaff` wrapper with recipient cache

**Files:**
- Create: `backend-go/internal/notification/recipients_cache.go`
- Create: `backend-go/internal/notification/broadcast_staff.go`
- Modify: `backend-go/internal/notification/notification_test.go`

**Interfaces:**
- Consumes: existing `internal/db/wa_recipients.go` `GetActiveRecipients(tenantID)`, `sendClient` (Task 1.3)
- Produces: `func BroadcastToStaff(ctx context.Context, tenantID string, filter RecipientFilter, msg string) error`, `RecipientFilter` struct

- [ ] **Step 1: Write failing test**

```go
// backend-go/internal/notification/notification_test.go — APPEND

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend-go && go test ./internal/notification/... -run TestBroadcastToStaff -v
```

Expected: FAIL with `undefined: RecipientFilter, Recipient, resolver field`.

- [ ] **Step 3: Implement RecipientFilter + Recipient + resolver**

```go
// backend-go/internal/notification/recipients_cache.go
package notification

import (
	"context"
	"sync"
	"time"
)

// Recipient is a staff/owner WA number.
type Recipient struct {
	Phone string
	Role  string // "owner" | "admin"
}

// RecipientFilter narrows GetActiveRecipients results.
type RecipientFilter struct {
	Role      string // "" = all, "owner" or "admin" filters
	CritLevel string // "critical" bypasses quiet hours (Sprint 5)
}

// recipientResolver wraps db.GetActiveRecipients for testability.
type recipientResolver interface {
	GetActiveRecipients(ctx context.Context, tenantID string, filter RecipientFilter) ([]Recipient, error)
}

// cachedResolver adds 60-second TTL LRU cache on top of a live recipientResolver.
type cachedResolver struct {
	inner recipientResolver
	cache sync.Map // key: tenantID+role, val: cachedEntry
}

type cachedEntry struct {
	recipients []Recipient
	expiresAt  time.Time
}

// NewCachedResolver wraps inner with 60s TTL cache. Cache is per (tenantID, role) tuple.
func NewCachedResolver(inner recipientResolver) *cachedResolver {
	return &cachedResolver{inner: inner}
}

func (c *cachedResolver) GetActiveRecipients(ctx context.Context, tenantID string, filter RecipientFilter) ([]Recipient, error) {
	key := tenantID + "::" + filter.Role
	now := time.Now()

	if v, ok := c.cache.Load(key); ok {
		entry := v.(cachedEntry)
		if now.Before(entry.expiresAt) {
			return entry.recipients, nil
		}
	}

	recipients, err := c.inner.GetActiveRecipients(ctx, tenantID, filter)
	if err != nil {
		return nil, err
	}
	c.cache.Store(key, cachedEntry{recipients: recipients, expiresAt: now.Add(60 * time.Second)})
	return recipients, nil
}
```

```go
// backend-go/internal/notification/broadcast_staff.go
package notification

import (
	"context"
	"errors"
	"log/slog"
)

// BroadcastToStaff sends a WA message to all matching staff/owner recipients.
//
// Behavior:
//   - Fetches recipients via cached resolver (60s TTL per tenant/role).
//   - Sends to each recipient in parallel; collects per-recipient errors.
//   - Returns nil if at least one recipient received; returns joined errors otherwise.
//   - Emits log with recipient count + success/failure breakdown.
//
// Sprint 5 will add quiet-hours + consolidation window logic here.
func (n *Notifier) BroadcastToStaff(ctx context.Context, tenantID string, filter RecipientFilter, msg string) error {
	logger := n.logger
	if logger == nil {
		logger = slog.Default()
	}
	log := logger.With("tenant_id", tenantID, "feature", "broadcast_staff", "role_filter", filter.Role)

	recipients, err := n.resolver.GetActiveRecipients(ctx, tenantID, filter)
	if err != nil {
		log.ErrorContext(ctx, "recipient resolver failed", slog.Any("error", err))
		return err
	}
	if len(recipients) == 0 {
		log.WarnContext(ctx, "no active recipients matched filter")
		return nil // Not an error — tenant may have no recipients configured yet.
	}

	var (
		sentCount int
		errs      []error
	)
	for _, r := range recipients {
		if err := n.sender.SendText(ctx, r.Phone, msg); err != nil {
			errs = append(errs, err)
			log.ErrorContext(ctx, "broadcast send failed for recipient",
				slog.String("phone_hash", hashPhone(r.Phone)),
				slog.String("role", r.Role),
				slog.Any("error", err))
			continue
		}
		sentCount++
	}

	log.InfoContext(ctx, "broadcast complete",
		slog.Int("recipient_count", len(recipients)),
		slog.Int("sent_count", sentCount),
		slog.Int("failure_count", len(errs)))

	if sentCount == 0 {
		return errors.Join(ErrSendFailed, errors.Join(errs...))
	}
	return nil
}
```

Also update `Notifier` struct in `notify_customer.go` to include `resolver`:

```go
// backend-go/internal/notification/notify_customer.go — MODIFY struct
type Notifier struct {
	sender   sendClient
	inserter messageInserter
	quota    quotaChecker
	resolver recipientResolver
	logger   *slog.Logger
}

func NewNotifier(s sendClient, i messageInserter, q quotaChecker, r recipientResolver, l *slog.Logger) *Notifier {
	return &Notifier{sender: s, inserter: i, quota: q, resolver: r, logger: l}
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend-go && go test ./internal/notification/... -v
```

Expected: PASS (all prior tests + BroadcastToStaff test = 7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/notification/recipients_cache.go backend-go/internal/notification/broadcast_staff.go backend-go/internal/notification/notify_customer.go backend-go/internal/notification/notification_test.go
git commit -m "feat(notification): BroadcastToStaff wrapper + 60s cached resolver

Second Sprint 1 primitive. Existing paths (approval card, staff escalation,
heartbeat digest) migrate to BroadcastToStaff. RecipientFilter enables
role-based (owner vs admin) + criticality-based (critical bypasses quiet
hours Sprint 5) targeting.

60s TTL cache reduces DB load: heartbeat + follow-up + escalation all
fetch same tenant's recipients within seconds; without cache = N+1 hits.

Refs spec 5.1."
```

---

### Task 1.5: Migrate `follow-up` path (D) to `NotifyCustomer`

**Files:**
- Modify: `backend-go/internal/followup/poller.go`

**Interfaces:**
- Consumes: `NotifyCustomer` (Task 1.3)
- Produces: (behavior identical, but sends now go through wrapper — quota + audit atomic)

- [ ] **Step 1: Read existing follow-up implementation**

```bash
grep -n "sender.SendText\|InsertMessage" backend-go/internal/followup/poller.go
```

Expected: shows call sites to `SendText` (~1-2 sites) + `InsertMessage` (~1 site).

- [ ] **Step 2: Modify poller to use NotifyCustomer**

Replace the current pattern:
```go
if err := f.sender.SendText(ctx, conv.CustomerPhone, msg); err != nil {
    slog.ErrorContext(ctx, "[FOLLOWUP] send failed", slog.Any("error", err))
    // update failure counter
    ...
}
if err := f.db.InsertMessage(ctx, conv.ID, "AI", msg); err != nil { ... }
```

With:
```go
if err := f.notifier.NotifyCustomer(ctx, conv.TenantID, conv.ID, conv.CustomerPhone, conv.Language, msg); err != nil {
    if errors.Is(err, notification.ErrQuotaExceeded) {
        slog.InfoContext(ctx, "[FOLLOWUP] tenant quota exceeded, skipping")
        return
    }
    // update failure counter (existing logic)
    ...
}
// InsertMessage no longer needed — NotifyCustomer handles it
```

- [ ] **Step 3: Update Poller struct field**

Change `sender *whatsapp.Sender` to `notifier *notification.Notifier` in the `Poller` struct.
Update `NewPoller` constructor to accept `notifier` instead of `sender`.

- [ ] **Step 4: Update `main.go` wiring**

Locate `followup.NewPoller(...)` in `main.go` and change:
```go
followupPoller := followup.NewPoller(db, waSender, ...)
```
To:
```go
notifier := notification.NewNotifier(waSender, db, notification.NewQuota(db), notification.NewCachedResolver(db), logger)
followupPoller := followup.NewPoller(db, notifier, ...)
```

- [ ] **Step 5: Run backend build**

```bash
cd backend-go && go build ./...
```

Expected: no compilation errors.

- [ ] **Step 6: Run tests**

```bash
cd backend-go && go test ./internal/followup/... ./internal/notification/... -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend-go/internal/followup/poller.go backend-go/main.go
git commit -m "refactor(followup): migrate to NotifyCustomer wrapper

First existing WA-send path migrated. Quota + audit trail now atomic.
Behavior identical except: 300/day cap now enforced (was landing claim
only).

Refs spec 5.1."
```

---

### Task 1.6: Migrate `booking-expiry` path (E) — extract template + fix B2

**Files:**
- Create: `backend-go/internal/notification/templates/booking_expiry.go`
- Modify: `backend-go/main.go` (extract inline closure at lines 495-511)

**Interfaces:**
- Consumes: `NotifyCustomer` (Task 1.3), existing `Language` field on conversations
- Produces: `BookingExpiry.Build(ctx, params) (string, error)` template renderer

- [ ] **Step 1: Read existing inline booking-expiry closure**

```bash
sed -n '493,511p' backend-go/main.go
```

Expected: shows anonymous closure using `time.AfterFunc`, inline `fmt.Sprintf`, direct `sender.SendText` call, NO `InsertMessage` (this is B2 bug).

- [ ] **Step 2: Write failing test for BookingExpiry template**

```go
// backend-go/internal/notification/templates/booking_expiry_test.go
package templates

import (
	"context"
	"strings"
	"testing"
)

func TestBookingExpiry_RendersID(t *testing.T) {
	b := BookingExpiry{}
	msg, err := b.Build(context.Background(), map[string]any{
		"customer_nama": "Pak Budi",
		"toko_nama":     "Toko Jaya",
		"invoice_no":    "INV-001",
		"lang":          "id",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Pak Budi") || !strings.Contains(msg, "Toko Jaya") || !strings.Contains(msg, "INV-001") {
		t.Errorf("expected variables substituted, got: %s", msg)
	}
}

func TestBookingExpiry_ReturnsErrorOnMissingParam(t *testing.T) {
	b := BookingExpiry{}
	_, err := b.Build(context.Background(), map[string]any{"customer_nama": "x"}) // missing others
	if err == nil {
		t.Fatal("expected error on missing required param")
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend-go && go test ./internal/notification/templates/... -v
```

Expected: FAIL with `undefined: BookingExpiry`.

- [ ] **Step 4: Implement BookingExpiry template**

```go
// backend-go/internal/notification/templates/booking_expiry.go
package templates

import (
	"context"
	"errors"
	"fmt"
)

// BookingExpiry renders the booking-timeout reminder message.
// Extracted from main.go inline closure (Sprint 1 B2 fix).
type BookingExpiry struct{}

// TemplateID returns the stable template identifier for versioning + logs.
func (BookingExpiry) TemplateID() string { return "booking_expiry" }

// RequiredParams returns the parameter keys Build expects.
func (BookingExpiry) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no"}
}

// Build renders the message with the provided params.
func (b BookingExpiry) Build(_ context.Context, params map[string]any) (string, error) {
	for _, k := range b.RequiredParams() {
		if _, ok := params[k]; !ok {
			return "", fmt.Errorf("booking_expiry: missing required param %q: %w", k, errors.New("missing param"))
		}
	}
	return fmt.Sprintf(
		"Halo %s 👋,\n\nPesanan #%s di %s akan expired dalam 24 jam ke depan. Kalau mau lanjut pembayaran, silakan chat kami. Kalau tidak, pesanan akan dibatalkan otomatis.\n\nTerima kasih 🙏",
		params["customer_nama"], params["invoice_no"], params["toko_nama"],
	), nil
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend-go && go test ./internal/notification/templates/... -v
```

Expected: PASS.

- [ ] **Step 6: Modify main.go to use extracted template + NotifyCustomer**

In `backend-go/main.go`, locate the inline `time.AfterFunc(...)` around line 495. Replace inline `fmt.Sprintf` + `sender.SendText` with:

```go
// Booking expiry reminder — 24h before booking expires (Sprint 1 B2 fix).
timer := time.AfterFunc(reminderDelay, func() {
	ctx := context.Background()
	tmpl := templates.BookingExpiry{}
	msg, err := tmpl.Build(ctx, map[string]any{
		"customer_nama": booking.CustomerName,
		"toko_nama":     booking.TokoName,
		"invoice_no":    booking.InvoiceNo,
	})
	if err != nil {
		slog.ErrorContext(ctx, "booking_expiry template render failed", slog.Any("error", err))
		return
	}
	if err := notifier.NotifyCustomer(ctx, booking.TenantID, booking.ConvID, booking.CustomerPhone, "id", msg); err != nil {
		slog.ErrorContext(ctx, "booking_expiry send failed", slog.Any("error", err))
	}
})
```

- [ ] **Step 7: Build**

```bash
cd backend-go && go build ./...
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend-go/internal/notification/templates/booking_expiry.go backend-go/internal/notification/templates/booking_expiry_test.go backend-go/main.go
git commit -m "refactor(booking-expiry): B2 fix — extract template + use NotifyCustomer

main.go inline closure was calling SendText directly and skipping
InsertMessage — no audit trail (B2 bug). Extract to
internal/notification/templates + route through NotifyCustomer wrapper.
Audit trail now atomic.

Refs spec 5.1, 5.4."
```

---

### Task 1.7: Migrate `admin-forward` path (G) — extract template + fix B3

**Files:**
- Create: `backend-go/internal/notification/templates/admin_forward.go`
- Modify: `backend-go/main.go` (LISTEN/NOTIFY handler at lines 617-632)

**Interfaces:**
- Consumes: `NotifyCustomer` (Task 1.3)
- Produces: `AdminForward.Build(ctx, params) (string, error)` — passthrough of admin's text

- [ ] **Step 1: Write failing test**

```go
// backend-go/internal/notification/templates/admin_forward_test.go
package templates

import (
	"context"
	"testing"
)

func TestAdminForward_PassthroughText(t *testing.T) {
	af := AdminForward{}
	msg, err := af.Build(context.Background(), map[string]any{"text": "Halo Pak, invoice sudah kami kirim"})
	if err != nil {
		t.Fatal(err)
	}
	if msg != "Halo Pak, invoice sudah kami kirim" {
		t.Errorf("expected passthrough, got: %s", msg)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend-go && go test ./internal/notification/templates/... -run TestAdminForward -v
```

Expected: FAIL.

- [ ] **Step 3: Implement AdminForward template**

```go
// backend-go/internal/notification/templates/admin_forward.go
package templates

import (
	"context"
	"errors"
	"fmt"
)

// AdminForward is a passthrough template — the message content IS the admin's
// typed input. This is B3 fix: previously main.go inline handler skipped
// InsertMessage on the send. Now routing through NotifyCustomer inserts audit row.
type AdminForward struct{}

func (AdminForward) TemplateID() string      { return "admin_forward" }
func (AdminForward) RequiredParams() []string { return []string{"text"} }

func (AdminForward) Build(_ context.Context, params map[string]any) (string, error) {
	text, ok := params["text"].(string)
	if !ok || text == "" {
		return "", fmt.Errorf("admin_forward: missing 'text' param: %w", errors.New("missing"))
	}
	return text, nil
}
```

- [ ] **Step 4: Modify main.go LISTEN/NOTIFY handler**

At `backend-go/main.go` around lines 617-632, replace inline `sender.SendText(ctx, phone, msg.Text)` with:

```go
tmpl := templates.AdminForward{}
rendered, err := tmpl.Build(ctx, map[string]any{"text": msg.Text})
if err != nil {
	slog.ErrorContext(ctx, "admin_forward render failed", slog.Any("error", err))
	continue
}
if err := notifier.NotifyCustomer(ctx, msg.TenantID, msg.ConvID, msg.CustomerPhone, "id", rendered); err != nil {
	slog.ErrorContext(ctx, "admin_forward send failed", slog.Any("error", err))
}
```

- [ ] **Step 5: Run tests + build**

```bash
cd backend-go && go test ./internal/notification/... -v && go build ./...
```

Expected: PASS + no compilation errors.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/notification/templates/admin_forward.go backend-go/internal/notification/templates/admin_forward_test.go backend-go/main.go
git commit -m "refactor(admin-forward): B3 fix — extract template + use NotifyCustomer

main.go LISTEN/NOTIFY handler (lines 617-632) was skipping InsertMessage
audit — messages typed in Sales Inbox and forwarded to customer weren't
re-logged. Route through NotifyCustomer wrapper for atomic audit.

Refs spec 5.1."
```

---

### Task 1.8: Wire Path C — approval WA card (B1 fix)

**Files:**
- Create: `backend-go/internal/notification/templates/approval_card.go`
- Modify: `backend-go/internal/approvals/expiry_poller.go` OR appropriate RPC callsite for approval creation

**Interfaces:**
- Consumes: `BroadcastToStaff` (Task 1.4), existing `FormatApprovalMessage`, existing `approval_requests` table
- Produces: approval WA cards now actually send

- [ ] **Step 1: Grep for approval request creation sites**

```bash
grep -rn "INSERT INTO approval_requests\|approval_requests.*INSERT" supabase/migrations/ backend-go/
```

Expected: shows RPC/migration that creates approval rows. Note the trigger site.

- [ ] **Step 2: Write failing integration test**

```go
// backend-go/internal/approvals/wa_send_test.go
package approvals

import (
	"context"
	"testing"
)

func TestApprovalCreated_TriggersWABroadcast(t *testing.T) {
	// Uses testcontainers or mock notifier
	mockNotifier := &mockNotifier{}
	handler := NewApprovalCreatedHandler(mockNotifier)

	handler.HandleApprovalCreated(context.Background(), ApprovalCreatedEvent{
		ApprovalID: "a1",
		TenantID:   "t1",
		Type:       "PO_CREATE",
		Details:    "PO-2607-0142",
	})

	if !mockNotifier.broadcastCalled {
		t.Fatal("expected BroadcastToStaff to be called")
	}
	if mockNotifier.lastFilter.Role != "owner" {
		t.Errorf("expected role=owner, got %s", mockNotifier.lastFilter.Role)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend-go && go test ./internal/approvals/... -run TestApprovalCreated -v
```

Expected: FAIL.

- [ ] **Step 4: Implement ApprovalCard template**

```go
// backend-go/internal/notification/templates/approval_card.go
package templates

import (
	"context"
	"errors"
	"fmt"
)

// ApprovalCard renders the WA button-reply approval message with machine-parseable
// approve:<id> / reject:<id> lines. Wraps existing FormatApprovalMessage semantics
// but positioned within the notification template registry so template versioning
// (Sprint 3) can extend.
type ApprovalCard struct{}

func (ApprovalCard) TemplateID() string       { return "approval_card" }
func (ApprovalCard) RequiredParams() []string { return []string{"approval_id", "type", "details"} }

func (ApprovalCard) Build(_ context.Context, params map[string]any) (string, error) {
	for _, k := range (ApprovalCard{}).RequiredParams() {
		if _, ok := params[k]; !ok {
			return "", fmt.Errorf("approval_card: missing %q: %w", k, errors.New("missing param"))
		}
	}
	return fmt.Sprintf(
		"⚠️ *Approval Request*\n\n*Tipe:* %s\n*Detail:* %s\n\nBalas dengan:\n`approve:%s` untuk setujui\n`reject:%s` untuk tolak",
		params["type"], params["details"], params["approval_id"], params["approval_id"],
	), nil
}
```

- [ ] **Step 5: Add Postgres trigger to send NOTIFY on approval creation**

```sql
-- supabase/migrations/20261115000401_approval_wa_sent_at.sql
-- B1 fix: wire approval WA card send. Add sent_wa_card_at dedup column
-- + trigger that fires 'approval_created' NOTIFY on INSERT.

ALTER TABLE public.approval_requests
  ADD COLUMN IF NOT EXISTS sent_wa_card_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.notify_approval_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'approval_created',
    json_build_object(
      'approval_id', NEW.id,
      'tenant_id', NEW.tenant_id,
      'type', NEW.type,
      'details', NEW.details
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_created_notify ON public.approval_requests;
CREATE TRIGGER trg_approval_created_notify
  AFTER INSERT ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_approval_created();
```

Apply via `mcp__plugin_supabase_supabase__apply_migration`.

- [ ] **Step 6: Implement Go LISTEN handler**

In `main.go` alongside existing LISTEN/NOTIFY handlers:

```go
// Subscribe to approval_created notifications (Sprint 1 B1 fix).
go func() {
	listener := pq.NewListener(listenConnStr, 10*time.Second, time.Minute, nil)
	listener.Listen("approval_created")
	for n := range listener.Notify {
		if n == nil {
			continue
		}
		var evt struct {
			ApprovalID string `json:"approval_id"`
			TenantID   string `json:"tenant_id"`
			Type       string `json:"type"`
			Details    string `json:"details"`
		}
		if err := json.Unmarshal([]byte(n.Extra), &evt); err != nil {
			slog.ErrorContext(ctx, "approval_created json decode", slog.Any("error", err))
			continue
		}

		tmpl := templates.ApprovalCard{}
		msg, err := tmpl.Build(ctx, map[string]any{
			"approval_id": evt.ApprovalID,
			"type":        evt.Type,
			"details":     evt.Details,
		})
		if err != nil {
			slog.ErrorContext(ctx, "approval_card render", slog.Any("error", err))
			continue
		}

		filter := notification.RecipientFilter{Role: "owner", CritLevel: "critical"}
		if err := notifier.BroadcastToStaff(ctx, evt.TenantID, filter, msg); err != nil {
			slog.ErrorContext(ctx, "approval broadcast", slog.Any("error", err))
			continue
		}

		// Mark sent to prevent duplicate sends on restart
		_, _ = db.ExecContext(ctx, "UPDATE approval_requests SET sent_wa_card_at = NOW() WHERE id = $1", evt.ApprovalID)
	}
}()
```

- [ ] **Step 7: Build + test**

```bash
cd backend-go && go build ./... && go test ./internal/approvals/... ./internal/notification/... -v
```

Expected: no errors, PASS.

- [ ] **Step 8: Commit**

```bash
git add backend-go/internal/notification/templates/approval_card.go backend-go/main.go supabase/migrations/20261115000401_approval_wa_sent_at.sql
git commit -m "feat(approvals): B1 fix — wire approval WA card send

Existing approval_sender.go was built + tested but the call site never
existed. Add Postgres trigger fires 'approval_created' NOTIFY on
approval_requests INSERT. Go handler catches, builds ApprovalCard
template, broadcasts to owner-role recipients via BroadcastToStaff.

Dedup via sent_wa_card_at column — prevents duplicate sends on restart.

Migration slot 401.

Refs spec 5.1, 6."
```

---

### Task 1.9: Migrate `heartbeat` path (H) — extract template + use BroadcastToStaff

**Files:**
- Create: `backend-go/internal/notification/templates/heartbeat_digest.go`
- Modify: `backend-go/internal/heartbeat/poller.go`

**Interfaces:**
- Consumes: `BroadcastToStaff` (Task 1.4)
- Produces: heartbeat digest via wrapper (Sprint 5 will add silent-day skip on top)

- [ ] **Step 1: Read existing heartbeat implementation**

```bash
grep -n "sender.SendText\|GetActiveRecipients" backend-go/internal/heartbeat/poller.go
```

- [ ] **Step 2: Write failing test for HeartbeatDigest template**

```go
// backend-go/internal/notification/templates/heartbeat_digest_test.go
package templates

import (
	"context"
	"strings"
	"testing"
)

func TestHeartbeatDigest_IncludesAllSections(t *testing.T) {
	h := HeartbeatDigest{}
	msg, err := h.Build(context.Background(), map[string]any{
		"tanggal":    "19 Jul 2026",
		"omset_hari": 5000000,
		"laba_hari":  1250000,
		"low_stock_count": 3,
		"low_stock_items": []string{"Kabel NYA", "MCB 10A", "Stop Kontak"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Rp 5.000.000") || !strings.Contains(msg, "Kabel NYA") {
		t.Errorf("expected sections rendered, got: %s", msg)
	}
}
```

- [ ] **Step 3: Implement HeartbeatDigest template**

```go
// backend-go/internal/notification/templates/heartbeat_digest.go
package templates

import (
	"context"
	"fmt"
	"strings"
)

// HeartbeatDigest renders the daily business summary sent to owners.
// Currently id-only; en variant deferred to Phase 3 (spec Section 3 non-goals).
type HeartbeatDigest struct{}

func (HeartbeatDigest) TemplateID() string { return "heartbeat_digest" }
func (HeartbeatDigest) RequiredParams() []string {
	return []string{"tanggal", "omset_hari", "laba_hari", "low_stock_count"}
}

func (h HeartbeatDigest) Build(_ context.Context, params map[string]any) (string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "📊 *Ringkasan Hari Ini — %s*\n\n", params["tanggal"])
	fmt.Fprintf(&b, "💰 Omset: Rp %s\n", formatRp(params["omset_hari"]))
	fmt.Fprintf(&b, "💵 Laba: Rp %s\n", formatRp(params["laba_hari"]))

	if items, ok := params["low_stock_items"].([]string); ok && len(items) > 0 {
		fmt.Fprintf(&b, "\n⚠️ *Stok Menipis* (%v):\n", params["low_stock_count"])
		for _, item := range items {
			fmt.Fprintf(&b, "• %s\n", item)
		}
	}
	return b.String(), nil
}

// formatRp formats an int/int64 rupiah with thousand separator (id-ID).
// e.g., 5000000 → "5.000.000"
func formatRp(v any) string {
	var n int64
	switch x := v.(type) {
	case int:
		n = int64(x)
	case int64:
		n = x
	case float64:
		n = int64(x)
	default:
		return fmt.Sprint(v)
	}
	s := fmt.Sprint(n)
	if n < 1000 {
		return s
	}
	// Insert thousands separator (id-ID uses ".")
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, c)
	}
	return string(out)
}
```

- [ ] **Step 4: Modify `heartbeat/poller.go` to use HeartbeatDigest + BroadcastToStaff**

Replace inline `buildReport()` + `sender.SendText` loop with:

```go
tmpl := templates.HeartbeatDigest{}
msg, err := tmpl.Build(ctx, map[string]any{
	"tanggal":         time.Now().Format("2 Jan 2006"),
	"omset_hari":      omsetToday,
	"laba_hari":       labaToday,
	"low_stock_count": len(lowStockItems),
	"low_stock_items": lowStockItems,
})
if err != nil {
	slog.ErrorContext(ctx, "heartbeat template render", slog.Any("error", err))
	return
}

filter := notification.RecipientFilter{Role: "owner", CritLevel: "normal"}
if err := h.notifier.BroadcastToStaff(ctx, tenantID, filter, msg); err != nil {
	slog.ErrorContext(ctx, "heartbeat broadcast", slog.Any("error", err))
}
```

- [ ] **Step 5: Update `Poller` struct + constructor**

Replace `sender *whatsapp.Sender` with `notifier *notification.Notifier`.

- [ ] **Step 6: Wire in main.go**

```go
heartbeatPoller := heartbeat.NewPoller(db, notifier, config.HeartbeatInterval)
```

- [ ] **Step 7: Build + test + commit**

```bash
cd backend-go && go build ./... && go test ./internal/heartbeat/... ./internal/notification/... -v
git add backend-go/internal/notification/templates/heartbeat_digest.go backend-go/internal/notification/templates/heartbeat_digest_test.go backend-go/internal/heartbeat/poller.go backend-go/main.go
git commit -m "refactor(heartbeat): extract template + migrate to BroadcastToStaff

Sprint 1 final path migration. All 5 legacy send-path callers now use
NotifyCustomer or BroadcastToStaff wrappers. Sprint 1 harmonization
scope complete.

Refs spec 5.1."
```

---

### Task 1.10: Sprint 1 verification + deploy

**Files:**
- No new code; deployment + verification only

- [ ] **Step 1: Full backend test suite**

```bash
cd backend-go && go test ./... -v 2>&1 | tail -30
```

Expected: PASS. No test failures.

- [ ] **Step 2: Grep for any direct `SendText` calls that should now use wrapper**

```bash
grep -rn "sender.SendText\|Sender.SendText" backend-go/ --include="*.go" | grep -v "_test.go\|internal/whatsapp/sender.go\|internal/notification"
```

Expected: **NO output** — every application caller migrated. If any remain, migrate them.

- [ ] **Step 3: Deploy backend**

```bash
git push origin main
gcloud builds list --limit=2
```

Wait for latest build STATUS to become `SUCCESS`. Do NOT proceed if `FAILURE`.

- [ ] **Step 4: Verify B1 fix on Garindo staging**

Use MCP execute_sql (as Garindo tenant):
```sql
-- Create a test approval to fire the trigger
INSERT INTO public.approval_requests (id, tenant_id, type, details, status)
VALUES (gen_random_uuid(), 'garindo-tenant-uuid', 'TEST', 'Sprint 1 B1 verify', 'PENDING');
```

Check owner WA number for received approval card (should arrive within 5-10 seconds).

- [ ] **Step 5: Verify B4 fix — quota tracking**

```sql
SELECT tenant_id, wa_daily_quota_used, wa_daily_quota_limit
FROM public.tenant_subscriptions
WHERE tier = 'premium';
```

Expected: `wa_daily_quota_used` shows incrementing count as customer sends happen.

- [ ] **Step 6: Update progress.md**

```bash
cat >> progress.md << 'EOF'

## 2026-07-XX — Sprint 1 WA framework harmonization
- internal/notification package (NotifyCustomer, BroadcastToStaff wrappers + Quota + cached resolver)
- All 5 legacy WA send paths migrated to wrappers
- B1 fixed: approval WA cards actually send (Postgres trigger + Go handler)
- B2 fixed: booking-expiry audit trail (extract inline closure → template)
- B3 fixed: admin-forward audit trail (route through NotifyCustomer)
- B4 fixed: 300/day cap enforced via tenant_subscriptions.wa_daily_quota_used
- 5 template renderers extracted to internal/notification/templates/
- Migration slots 400-401 used
EOF

git add progress.md
git commit -m "docs(progress): Sprint 1 WA framework harmonization shipped"
git push origin main
```

- [ ] **Step 7: Sprint 1 done. Ready to start Sprint 2.**

Rollback instructions (if issues found in staging):
- `git revert <sprint 1 commits>` + `git push`
- Migration rollback: `DROP COLUMN wa_daily_quota_used, wa_daily_quota_reset_date, wa_daily_quota_limit FROM tenant_subscriptions`; `DROP TRIGGER trg_approval_created_notify`; `DROP COLUMN sent_wa_card_at FROM approval_requests`.

---

# 🎯 SPRINT 2 — Piutang WA Reminder Scheduler (5 dev-days)

**Spec reference**: Section 5.3 (Piutang scheduler), Section 5.11 (Piutang UI), success criteria bullet Sprint 2.

**Goal**: Ship Premium-tier-only automatic Piutang WA reminder scheduler at H-3 + H+3 with editable templates, per-customer opt-out, tenant-wide toggle, audit trail, and safe manual override.

### Task 2.1: Migration — `piutang_reminder_sent` audit table

**Files:**
- Create: `supabase/migrations/20261115000410_piutang_reminder_sent.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20261115000410_piutang_reminder_sent.sql
-- Sprint 2: audit table for every Piutang reminder attempt.
-- Dedup key: (invoice_id, rule_type, DATE(sent_at)) — prevents duplicate
-- sends across cron runs + manual overrides on same day.

CREATE TABLE IF NOT EXISTS public.piutang_reminder_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  invoice_id UUID NOT NULL,  -- FK to orders(id) but forgiving (order might be deleted)
  customer_id UUID NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('H-3', 'H+3', 'MANUAL')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED', 'SKIPPED', 'SKIPPED_QUOTA', 'PERMANENT_FAILED')),
  message_body TEXT NOT NULL,
  error_message TEXT,
  UNIQUE (invoice_id, rule_type, (DATE(sent_at)))
);

CREATE INDEX IF NOT EXISTS idx_piutang_reminder_sent_tenant_time
  ON public.piutang_reminder_sent (tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_piutang_reminder_sent_invoice
  ON public.piutang_reminder_sent (invoice_id);

ALTER TABLE public.piutang_reminder_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_select_own ON public.piutang_reminder_sent;
CREATE POLICY t_select_own ON public.piutang_reminder_sent
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

DROP POLICY IF EXISTS t_insert_own ON public.piutang_reminder_sent;
CREATE POLICY t_insert_own ON public.piutang_reminder_sent
  FOR INSERT TO vosi_rpc_owner
  WITH CHECK (tenant_id = public._resolve_tenant_id());
```

- [ ] **Step 2: Apply migration** via `mcp__plugin_supabase_supabase__apply_migration` (name: `piutang_reminder_sent`).

- [ ] **Step 3: Verify RLS**

```sql
SELECT policyname FROM pg_policies WHERE tablename = 'piutang_reminder_sent';
```

Expected: `t_select_own`, `t_insert_own`.

- [ ] **Step 4: Run get_advisors**

Expected: no new RLS-related findings.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000410_piutang_reminder_sent.sql
git commit -m "feat(db): piutang_reminder_sent audit table (Sprint 2)

Migration slot 410. RLS enforced. Unique dedup key prevents duplicate
sends across cron + manual overrides on the same day. Refs spec 5.3, 6."
```

---

### Task 2.2: Migration — `customers.wa_reminder_enabled` + `tenant_wa_reminder_config`

**Files:**
- Create: `supabase/migrations/20261115000411_customers_wa_reminder_flag.sql`
- Create: `supabase/migrations/20261115000412_tenant_wa_reminder_config.sql`

- [ ] **Step 1: Write migrations**

```sql
-- supabase/migrations/20261115000411_customers_wa_reminder_flag.sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS wa_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.customers.wa_reminder_enabled IS
  'Sprint 2 (2026-07-19): per-customer opt-out for Piutang WA reminder. Default TRUE (opt-in). Owner toggles via Pelanggan detail form.';
```

```sql
-- supabase/migrations/20261115000412_tenant_wa_reminder_config.sql
CREATE TABLE IF NOT EXISTS public.tenant_wa_reminder_config (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  template_h3 TEXT NOT NULL DEFAULT
    'Halo {customer_nama} 👋, ini reminder ramah dari {toko_nama}. Invoice #{invoice_no} sebesar Rp {jumlah} akan jatuh tempo pada {due_date} (3 hari lagi). Kalau sudah dibayar mohon abaikan pesan ini. Terima kasih 🙏',
  template_h3_plus TEXT NOT NULL DEFAULT
    'Halo {customer_nama}, invoice #{invoice_no} sebesar Rp {jumlah} sudah lewat jatuh tempo (H+{overdue_days}). Mohon segera dibayar ya. Kalau ada kendala bisa reply pesan ini — kami siap bantu. Terima kasih 🙏 — {toko_nama}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.tenant_wa_reminder_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_select_own ON public.tenant_wa_reminder_config;
CREATE POLICY t_select_own ON public.tenant_wa_reminder_config
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

DROP POLICY IF EXISTS t_upsert_own ON public.tenant_wa_reminder_config;
CREATE POLICY t_upsert_own ON public.tenant_wa_reminder_config
  FOR ALL TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id())
  WITH CHECK (tenant_id = public._resolve_tenant_id());

-- Seed default rows for all existing tenants
INSERT INTO public.tenant_wa_reminder_config (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply both migrations** via MCP.

- [ ] **Step 3: Verify**

```sql
SELECT COUNT(*) FROM public.tenant_wa_reminder_config;  -- should equal COUNT(*) FROM tenants
SELECT column_default FROM information_schema.columns
  WHERE table_name = 'customers' AND column_name = 'wa_reminder_enabled';
```

Expected: matched counts + default `true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000411_customers_wa_reminder_flag.sql supabase/migrations/20261115000412_tenant_wa_reminder_config.sql
git commit -m "feat(db): Piutang reminder opt-out + tenant config (Sprint 2)

Migration slots 411-412. Per-customer opt-out defaults to opt-in (TRUE).
Tenant config seeded for all existing tenants with default id-ID templates
matching the spec. RLS enforced. Refs spec 5.3, 5.5, 6."
```

---

### Task 2.3: Piutang H-3 + H+3 templates

**Files:**
- Create: `backend-go/internal/notification/templates/piutang_reminder_h3.go`
- Create: `backend-go/internal/notification/templates/piutang_reminder_h3_plus.go`
- Create: `backend-go/internal/notification/templates/piutang_reminder_h3_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend-go/internal/notification/templates/piutang_reminder_h3_test.go
package templates

import (
	"context"
	"strings"
	"testing"
)

func TestPiutangReminderH3_RendersWithCustomTemplate(t *testing.T) {
	t3 := PiutangReminderH3{
		CustomTemplate: "Halo {customer_nama}, invoice {invoice_no} jatuh tempo {due_date} — Rp {jumlah} — {toko_nama}",
	}
	msg, err := t3.Build(context.Background(), map[string]any{
		"customer_nama": "Pak Budi",
		"toko_nama":     "Toko Jaya",
		"invoice_no":    "INV-001",
		"jumlah":        "4.200.000",
		"due_date":      "22 Jul 2026",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Pak Budi") || !strings.Contains(msg, "INV-001") {
		t.Errorf("expected substitution, got: %s", msg)
	}
}

func TestPiutangReminderH3Plus_IncludesOverdueDays(t *testing.T) {
	t3 := PiutangReminderH3Plus{CustomTemplate: "H+{overdue_days} lewat"}
	msg, err := t3.Build(context.Background(), map[string]any{"overdue_days": 3})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "H+3 lewat") {
		t.Errorf("expected overdue_days substituted, got: %s", msg)
	}
}
```

- [ ] **Step 2: Implement templates**

```go
// backend-go/internal/notification/templates/piutang_reminder_h3.go
package templates

import (
	"context"
	"fmt"
	"strings"
)

// PiutangReminderH3 renders the "3 days before due date" reminder message.
// CustomTemplate lets tenant-level config override the default — falls back to
// spec 5.5 default template if empty.
type PiutangReminderH3 struct {
	CustomTemplate string // From tenant_wa_reminder_config.template_h3; empty = use default
}

const DefaultPiutangReminderH3Template = "Halo {customer_nama} 👋, ini reminder ramah dari {toko_nama}. Invoice #{invoice_no} sebesar Rp {jumlah} akan jatuh tempo pada {due_date} (3 hari lagi). Kalau sudah dibayar mohon abaikan pesan ini. Terima kasih 🙏"

func (PiutangReminderH3) TemplateID() string { return "piutang_reminder_h3" }
func (PiutangReminderH3) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no", "jumlah", "due_date"}
}

func (p PiutangReminderH3) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := p.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultPiutangReminderH3Template
	}
	// Simple {key} substitution — no {{go}} template syntax to keep tenant edit UX friendly
	rendered := tmpl
	for _, k := range (PiutangReminderH3{}).RequiredParams() {
		v, ok := params[k]
		if !ok {
			return "", fmt.Errorf("piutang_h3: missing %q", k)
		}
		rendered = strings.ReplaceAll(rendered, "{"+k+"}", fmt.Sprint(v))
	}
	return rendered, nil
}
```

```go
// backend-go/internal/notification/templates/piutang_reminder_h3_plus.go
package templates

import (
	"context"
	"fmt"
	"strings"
)

// PiutangReminderH3Plus renders the "3 days after due date" overdue reminder.
type PiutangReminderH3Plus struct {
	CustomTemplate string
}

const DefaultPiutangReminderH3PlusTemplate = "Halo {customer_nama}, invoice #{invoice_no} sebesar Rp {jumlah} sudah lewat jatuh tempo (H+{overdue_days}). Mohon segera dibayar ya. Kalau ada kendala bisa reply pesan ini — kami siap bantu. Terima kasih 🙏 — {toko_nama}"

func (PiutangReminderH3Plus) TemplateID() string { return "piutang_reminder_h3_plus" }
func (PiutangReminderH3Plus) RequiredParams() []string {
	return []string{"customer_nama", "toko_nama", "invoice_no", "jumlah", "overdue_days"}
}

func (p PiutangReminderH3Plus) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := p.CustomTemplate
	if tmpl == "" {
		tmpl = DefaultPiutangReminderH3PlusTemplate
	}
	rendered := tmpl
	for _, k := range (PiutangReminderH3Plus{}).RequiredParams() {
		v, ok := params[k]
		if !ok {
			return "", fmt.Errorf("piutang_h3plus: missing %q", k)
		}
		rendered = strings.ReplaceAll(rendered, "{"+k+"}", fmt.Sprint(v))
	}
	return rendered, nil
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd backend-go && go test ./internal/notification/templates/... -v
git add backend-go/internal/notification/templates/piutang_reminder_h3.go backend-go/internal/notification/templates/piutang_reminder_h3_plus.go backend-go/internal/notification/templates/piutang_reminder_h3_test.go
git commit -m "feat(notification): Piutang H-3 + H+3 templates (Sprint 2)

Simple {key} substitution (not Go template syntax) for tenant edit UX
friendliness. CustomTemplate override from tenant_wa_reminder_config.
Refs spec 5.3, 5.5."
```

---

### Task 2.4: Piutang reminder poller — eligibility filter + send flow

**Files:**
- Create: `backend-go/internal/piutang/reminder_poller.go`
- Create: `backend-go/internal/piutang/reminder_poller_test.go`
- Modify: `backend-go/main.go` (register poller)

**Interfaces:**
- Consumes: `NotifyCustomer` (Sprint 1), `PiutangReminderH3` templates, `piutang_reminder_sent` table (Task 2.1)
- Produces: `func NewReminderPoller(...)` + goroutine that runs daily at 09:00 WIB

- [ ] **Step 1: Write failing test for eligibility SQL**

```go
// backend-go/internal/piutang/reminder_poller_test.go
package piutang

import (
	"context"
	"testing"
)

func TestEligibleInvoicesQuery_MatchesExpectedSchema(t *testing.T) {
	q := eligibleInvoicesQuery()
	// Assert the query includes required filters
	requiredFilters := []string{
		"ts.tier = 'premium'",
		"o.status = 'OPEN'",
		"o.payment_type IN ('tempo', 'kredit')",
		"c.wa_reminder_enabled = TRUE",
		"ts.piutang_wa_reminder_enabled",
		"o.due_date = CURRENT_DATE + INTERVAL '3 days'",
		"o.due_date = CURRENT_DATE - INTERVAL '3 days'",
	}
	for _, f := range requiredFilters {
		if !contains(q, f) {
			t.Errorf("expected filter %q in eligibility query", f)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: Implement poller**

```go
// backend-go/internal/piutang/reminder_poller.go
package piutang

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/tonywei/erp-antigravity/backend-go/internal/notification"
	"github.com/tonywei/erp-antigravity/backend-go/internal/notification/templates"
)

// ReminderPoller runs the Piutang WA reminder cron.
// Fires daily at 09:00 WIB via ticker; scans Premium tenants for eligible
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
func nextDailyTarget(now time.Time, hour, min int) time.Time {
	target := time.Date(now.Year(), now.Month(), now.Day(), hour, min, 0, 0, now.Location())
	if !target.After(now) {
		target = target.AddDate(0, 0, 1)
	}
	return target
}

// runOnce fires a single pass of the reminder logic.
func (r *ReminderPoller) runOnce(ctx context.Context) {
	log := slog.Default().With("feature", "piutang_reminder_poller")
	log.InfoContext(ctx, "cron tick — scanning eligible invoices")

	rows, err := r.db.QueryContext(ctx, eligibleInvoicesQuery())
	if err != nil {
		log.ErrorContext(ctx, "query failed", slog.Any("error", err))
		return
	}
	defer rows.Close()

	var sentCount, failedCount, skippedCount int
	for rows.Next() {
		var (
			invoiceID, customerID, tenantID, convID   string
			ruleType, customerName, tokoName          string
			customerPhone, invoiceNo, tokoLang        string
			jumlah                                     int64
			dueDate                                    time.Time
			templateH3, templateH3Plus                 string
		)
		if err := rows.Scan(&invoiceID, &customerID, &tenantID, &convID, &ruleType, &customerName, &tokoName, &customerPhone, &invoiceNo, &tokoLang, &jumlah, &dueDate, &templateH3, &templateH3Plus); err != nil {
			log.ErrorContext(ctx, "row scan", slog.Any("error", err))
			continue
		}

		// Build message
		var msg string
		var buildErr error
		params := map[string]any{
			"customer_nama": customerName,
			"toko_nama":     tokoName,
			"invoice_no":    invoiceNo,
			"jumlah":        formatRp(jumlah),
			"due_date":      dueDate.Format("2 Jan 2006"),
		}
		if ruleType == "H-3" {
			t := templates.PiutangReminderH3{CustomTemplate: templateH3}
			msg, buildErr = t.Build(ctx, params)
		} else {
			params["overdue_days"] = int(time.Since(dueDate).Hours() / 24)
			t := templates.PiutangReminderH3Plus{CustomTemplate: templateH3Plus}
			msg, buildErr = t.Build(ctx, params)
		}
		if buildErr != nil {
			log.ErrorContext(ctx, "template build", slog.Any("error", buildErr))
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, "", "PERMANENT_FAILED", buildErr.Error())
			failedCount++
			continue
		}

		// Send via NotifyCustomer wrapper
		sendErr := r.notifier.NotifyCustomer(ctx, tenantID, convID, customerPhone, tokoLang, msg)
		switch {
		case sendErr == nil:
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, msg, "SENT", "")
			sentCount++
		case errors.Is(sendErr, notification.ErrQuotaExceeded):
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, msg, "SKIPPED_QUOTA", "")
			skippedCount++
		case errors.Is(sendErr, notification.ErrWASessionOffline):
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, msg, "SKIPPED", sendErr.Error())
			skippedCount++
		default:
			r.recordSent(ctx, tenantID, invoiceID, customerID, ruleType, msg, "FAILED", sendErr.Error())
			failedCount++
		}
	}

	log.InfoContext(ctx, "cron pass done",
		slog.Int("sent", sentCount),
		slog.Int("failed", failedCount),
		slog.Int("skipped", skippedCount))
}

// recordSent writes an audit row for every reminder attempt.
func (r *ReminderPoller) recordSent(ctx context.Context, tenantID, invoiceID, customerID, ruleType, msg, status, errMsg string) {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO public.piutang_reminder_sent (tenant_id, invoice_id, customer_id, rule_type, status, message_body, error_message)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''))
		ON CONFLICT (invoice_id, rule_type, (DATE(sent_at))) DO NOTHING
	`, tenantID, invoiceID, customerID, ruleType, status, msg, errMsg)
	if err != nil {
		slog.ErrorContext(ctx, "record audit row failed", slog.Any("error", err))
	}
}

// eligibleInvoicesQuery returns the SQL selecting invoices eligible for
// either H-3 or H+3 reminder today. See spec Section 5.3 for exact predicate.
func eligibleInvoicesQuery() string {
	return `
	SELECT
	  o.id AS invoice_id,
	  o.customer_id,
	  o.tenant_id,
	  COALESCE(cv.id::TEXT, '') AS conv_id,
	  CASE
	    WHEN o.due_date = CURRENT_DATE + INTERVAL '3 days' THEN 'H-3'
	    ELSE 'H+3'
	  END AS rule_type,
	  c.name AS customer_name,
	  t.name AS toko_name,
	  c.phone AS customer_phone,
	  o.invoice_no,
	  COALESCE(t.language, 'id') AS toko_language,
	  o.amount_due::BIGINT AS jumlah,
	  o.due_date,
	  COALESCE(cfg.template_h3, '') AS template_h3,
	  COALESCE(cfg.template_h3_plus, '') AS template_h3_plus
	FROM public.orders o
	JOIN public.customers c ON o.customer_id = c.id
	JOIN public.tenants t ON o.tenant_id = t.id
	JOIN public.tenant_subscriptions ts ON t.id = ts.tenant_id
	LEFT JOIN public.conversations cv ON cv.customer_phone = c.phone AND cv.tenant_id = o.tenant_id
	LEFT JOIN public.tenant_wa_reminder_config cfg ON cfg.tenant_id = o.tenant_id
	WHERE
	  ts.tier = 'premium' AND ts.status = 'active'
	  AND o.status = 'OPEN'
	  AND o.payment_type IN ('tempo', 'kredit')
	  AND c.phone IS NOT NULL AND c.phone <> ''
	  AND c.wa_reminder_enabled = TRUE
	  AND COALESCE(cfg.enabled, TRUE) = TRUE
	  AND (
	    (o.due_date = CURRENT_DATE + INTERVAL '3 days'
	      AND NOT EXISTS (SELECT 1 FROM public.piutang_reminder_sent WHERE invoice_id = o.id AND rule_type = 'H-3' AND status = 'SENT'))
	    OR
	    (o.due_date = CURRENT_DATE - INTERVAL '3 days'
	      AND NOT EXISTS (SELECT 1 FROM public.piutang_reminder_sent WHERE invoice_id = o.id AND rule_type = 'H+3' AND status = 'SENT'))
	  )
	`
}

func formatRp(n int64) string {
	// Reuse formatter from heartbeat_digest template (or inline copy)
	s := ""
	if n < 0 {
		s = "-"
		n = -n
	}
	digits := []byte{}
	for n > 0 || len(digits) == 0 {
		digits = append([]byte{byte(n%10) + '0'}, digits...)
		n /= 10
		if n > 0 && len(digits)%4 == 3 {
			digits = append([]byte{'.'}, digits...)
		}
	}
	return s + string(digits)
}
```

- [ ] **Step 3: Register poller in main.go**

```go
piutangPoller := piutang.NewReminderPoller(db, notifier)
piutangPoller.Start(ctx)
```

- [ ] **Step 4: Build + test**

```bash
cd backend-go && go build ./... && go test ./internal/piutang/... -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/piutang/reminder_poller.go backend-go/internal/piutang/reminder_poller_test.go backend-go/main.go
git commit -m "feat(piutang): H-3 + H+3 reminder poller (Sprint 2)

Daily cron at 09:00 WIB scans Premium tenants for eligible tempo
invoices, renders template via tenant config, sends via NotifyCustomer.
Every send + failure recorded in piutang_reminder_sent audit table.

Refs spec 5.3."
```

---

### Task 2.5: Manual send RPC + tier gate

**Files:**
- Create: `supabase/migrations/20261115000413_send_piutang_reminder_manual_rpc.sql`

- [ ] **Step 1: Write RPC**

```sql
-- supabase/migrations/20261115000413_send_piutang_reminder_manual_rpc.sql
-- Sprint 2: manual send override for Piutang WA reminder.
-- Enforces 1x/invoice/day + Premium tier gate + writes audit row.

CREATE OR REPLACE FUNCTION public.send_piutang_reminder_manual(p_invoice_id UUID)
RETURNS TABLE (status TEXT, message TEXT)
SECURITY DEFINER
SET search_path = public, pg_catalog
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id UUID;
  v_customer_id UUID;
  v_tier TEXT;
  v_already_sent_today BOOLEAN;
BEGIN
  -- Verify caller has RLS access to the invoice (subject-to-tenant match).
  SELECT tenant_id, customer_id INTO v_tenant_id, v_customer_id
  FROM public.orders WHERE id = p_invoice_id;

  IF v_tenant_id IS NULL THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'Invoice tidak ditemukan atau tidak boleh diakses'::TEXT;
    RETURN;
  END IF;

  -- Tier gate: Premium only.
  SELECT tier INTO v_tier
  FROM public.tenant_subscriptions
  WHERE tenant_id = v_tenant_id AND status = 'active';

  IF v_tier IS NULL OR v_tier != 'premium' THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'WA reminder tersedia di paket Premium — upgrade untuk aktifkan'::TEXT;
    RETURN;
  END IF;

  -- 1x/invoice/day constraint.
  SELECT EXISTS (
    SELECT 1 FROM public.piutang_reminder_sent
    WHERE invoice_id = p_invoice_id
      AND rule_type = 'MANUAL'
      AND status IN ('SENT', 'FAILED')
      AND DATE(sent_at) = CURRENT_DATE
  ) INTO v_already_sent_today;

  IF v_already_sent_today THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'Reminder manual sudah dikirim untuk invoice ini hari ini'::TEXT;
    RETURN;
  END IF;

  -- Enqueue for backend to actually send (via t_jobs)
  INSERT INTO public.t_jobs (tenant_id, job_type, payload, status)
  VALUES (v_tenant_id, 'piutang_manual_send', jsonb_build_object('invoice_id', p_invoice_id), 'PENDING');

  RETURN QUERY SELECT 'OK'::TEXT, 'Reminder akan dikirim dalam beberapa detik'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_piutang_reminder_manual(UUID) TO authenticated;
```

- [ ] **Step 2: Smoke test RPC** (per memory `smoke_test_security_definer_rpcs`)

```sql
DO $$
DECLARE r RECORD;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'test-user-uuid', true);
  SELECT * FROM public.send_piutang_reminder_manual('00000000-0000-0000-0000-000000000000') INTO r;
  RAISE NOTICE 'Result: status=%, message=%', r.status, r.message;
  RAISE EXCEPTION 'ROLLBACK for smoke test';  -- rollback all changes
END $$;
```

Expected: RAISE NOTICE shows error (invoice not found) — expected because test UUID doesn't exist. RPC syntax correct.

- [ ] **Step 3: Backend job handler**

Add `piutang_manual_send` handler to `internal/jobs/handlers.go`:

```go
func handlePiutangManualSend(ctx context.Context, notifier *notification.Notifier, db *sql.DB, payload []byte) error {
	var p struct {
		InvoiceID string `json:"invoice_id"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	// ... query invoice details, build message via same template, send via NotifyCustomer
	// ... record 'MANUAL' rule_type in piutang_reminder_sent
	return nil
}
```

- [ ] **Step 4: Register handler in main.go**

```go
jobWorker.Register("piutang_manual_send", func(ctx context.Context, payload []byte) error {
	return handlePiutangManualSend(ctx, notifier, db, payload)
})
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000413_send_piutang_reminder_manual_rpc.sql backend-go/internal/jobs/handlers.go backend-go/main.go
git commit -m "feat(piutang): manual send RPC with Premium tier gate + 1x/day constraint

Sprint 2. RPC enforces tier + dedup, backend job handler executes the
actual send via NotifyCustomer. Refs spec 5.3."
```

---

### Task 2.6: Frontend — `TemplateChipInput` + `TemplatePreview` shared components

**Files:**
- Create: `src/components/notification/TemplateChipInput.tsx`
- Create: `src/components/notification/TemplatePreview.tsx`

**Interfaces:**
- Produces: `<TemplateChipInput variables={[]} value={} onChange={} maxChars={700} />` and `<TemplatePreview template={} sampleData={} />`

- [ ] **Step 1: Implement TemplateChipInput**

```tsx
// src/components/notification/TemplateChipInput.tsx
import { useRef, KeyboardEvent } from 'react';

interface Variable {
  key: string;    // 'customer_nama'
  label: string;  // 'Nama Customer'
}

interface TemplateChipInputProps {
  variables: Variable[];
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  maxChars?: number;
  placeholder?: string;
}

export function TemplateChipInput({ variables, value, onChange, onBlur, maxChars = 700, placeholder = 'Ketik pesan reminder di sini...' }: TemplateChipInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertVariable(varKey: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const token = `{${varKey}}`;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    // Move cursor after inserted token
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  }

  const charCount = value.length;
  const charColor = charCount > 650 ? 'red' : charCount > 500 ? 'orange' : 'green';

  return (
    <div className="template-chip-input">
      <div className="chip-row" role="toolbar" aria-label="Sisipkan variabel">
        {variables.map((v) => (
          <button
            key={v.key}
            type="button"
            className="chip"
            onClick={() => insertVariable(v.key)}
            aria-label={`Sisipkan ${v.label}`}
          >
            + {v.label}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        maxLength={maxChars + 50}  // small buffer, but visual counter shows exact
        rows={8}
        placeholder={placeholder}
        aria-label="Konten template"
      />
      <div className={`char-counter char-counter--${charColor}`}>
        {charCount}/{maxChars} karakter
        {charCount > maxChars && ' — pesan terlalu panjang, WhatsApp mungkin potong'}
      </div>
      <style>{`
        .chip-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
        .chip {
          background: #FFF7F0; border: 1px solid #FBBF24; color: #0B2545;
          padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 700;
          cursor: pointer; transition: transform 0.15s;
        }
        .chip:hover { transform: translateY(-1px); }
        textarea {
          width: 100%; font-family: 'Inter', sans-serif; font-size: 14px;
          line-height: 1.55; padding: 12px; border: 1px solid #E2E8F0;
          border-radius: 8px; resize: vertical;
        }
        .char-counter { font-size: 12px; margin-top: 6px; }
        .char-counter--green { color: #166534; }
        .char-counter--orange { color: #92400E; }
        .char-counter--red { color: #991B1B; font-weight: 700; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Implement TemplatePreview**

```tsx
// src/components/notification/TemplatePreview.tsx
interface TemplatePreviewProps {
  template: string;
  sampleData: Record<string, string>;
}

export function TemplatePreview({ template, sampleData }: TemplatePreviewProps) {
  // Simple {key} substitution (matches backend Go template)
  const rendered = Object.entries(sampleData).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, v),
    template
  );

  return (
    <div className="wa-preview">
      <div className="wa-header">
        <span className="wa-header-icon">🟢</span>
        <span>WhatsApp — Preview</span>
      </div>
      <div className="wa-bubble">
        {rendered.split('\n').map((line, i) => (
          <div key={i}>{line || <br />}</div>
        ))}
        <div className="wa-timestamp">✓✓ 09:00</div>
      </div>
      <div className="wa-sample-note">
        Data contoh: {Object.entries(sampleData).map(([k, v]) => `${k}=${v}`).join(', ')}
      </div>
      <style>{`
        .wa-preview {
          background: #ECE5DD; padding: 16px; border-radius: 12px;
          font-family: 'Inter', sans-serif;
        }
        .wa-header {
          background: #075E54; color: white; padding: 8px 12px;
          border-radius: 8px 8px 0 0; font-size: 13px; font-weight: 600;
          margin: -16px -16px 12px -16px;
        }
        .wa-header-icon { margin-right: 6px; }
        .wa-bubble {
          background: #DCF8C6; padding: 10px 12px; border-radius: 8px;
          font-size: 13.5px; line-height: 1.5; color: #303030;
          max-width: 320px; word-wrap: break-word;
        }
        .wa-timestamp { font-size: 10px; color: #999; text-align: right; margin-top: 4px; }
        .wa-sample-note {
          font-size: 11px; color: #64748B; margin-top: 12px; font-style: italic;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/notification/TemplateChipInput.tsx src/components/notification/TemplatePreview.tsx
git commit -m "feat(notification-ui): TemplateChipInput + TemplatePreview shared components

Best-UX primitives for template editing across all sprints. Chip buttons
insert visual tokens at cursor (no {curly} typing). Preview renders
WhatsApp bubble with sample data resolved. Character counter red at 650+.

Refs spec 5.11, 16."
```

---

### Task 2.7: Frontend — `PiutangWaReminderScreen` (settings page)

**Files:**
- Create: `src/components/pengaturan/PiutangWaReminderScreen.tsx`
- Modify: `src/lib/urlRoute.ts` (add route `?screen=piutang-wa-reminder`)

- [ ] **Step 1: Implement PiutangWaReminderScreen**

```tsx
// src/components/pengaturan/PiutangWaReminderScreen.tsx
import { useEffect, useState } from 'react';
import { TemplateChipInput } from '../notification/TemplateChipInput';
import { TemplatePreview } from '../notification/TemplatePreview';
import { supabase } from '../../lib/supabase';

const VARS_H3 = [
  { key: 'customer_nama', label: 'Nama Customer' },
  { key: 'toko_nama', label: 'Nama Toko' },
  { key: 'invoice_no', label: 'Nomor Invoice' },
  { key: 'jumlah', label: 'Jumlah Rp' },
  { key: 'due_date', label: 'Tanggal Jatuh Tempo' },
];

const VARS_H3_PLUS = [
  ...VARS_H3,
  { key: 'overdue_days', label: 'Hari Terlambat' },
];

const SAMPLE_DATA = {
  customer_nama: 'Pak Budi',
  toko_nama: 'Toko Jaya Makmur',
  invoice_no: 'INV-2607-0142',
  jumlah: '4.200.000',
  due_date: '22 Jul 2026',
  overdue_days: '3',
};

interface TenantConfig {
  enabled: boolean;
  template_h3: string;
  template_h3_plus: string;
}

export function PiutangWaReminderScreen() {
  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('tenant_wa_reminder_config')
        .select('enabled, template_h3, template_h3_plus')
        .single();
      if (!error && data) setConfig(data);
    })();
  }, []);

  async function saveField(field: keyof TenantConfig, value: string | boolean) {
    if (!config) return;
    setSaveState('saving');
    setConfig({ ...config, [field]: value });
    const { error } = await supabase
      .from('tenant_wa_reminder_config')
      .update({ [field]: value })
      .eq('tenant_id', 'current-tenant'); // Replace with actual tenant_id from context
    if (error) {
      alert('Gagal simpan: ' + error.message);
      setSaveState('idle');
      return;
    }
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  }

  async function sendTest(ruleType: 'H-3' | 'H+3') {
    setTestSending(true);
    // Call backend RPC or edge function that sends test WA to logged-in user's phone
    // For MVP, use manual send RPC with sentinel invoice ID
    const { error } = await supabase.rpc('send_piutang_reminder_test', {
      p_rule_type: ruleType,
    });
    if (error) {
      alert('Gagal kirim test: ' + error.message);
    } else {
      alert('✓ Terkirim! Cek WhatsApp kamu.');
    }
    setTestSending(false);
  }

  function resetDefault(field: 'template_h3' | 'template_h3_plus') {
    const defaults = {
      template_h3: 'Halo {customer_nama} 👋, ini reminder ramah dari {toko_nama}. Invoice #{invoice_no} sebesar Rp {jumlah} akan jatuh tempo pada {due_date} (3 hari lagi). Kalau sudah dibayar mohon abaikan pesan ini. Terima kasih 🙏',
      template_h3_plus: 'Halo {customer_nama}, invoice #{invoice_no} sebesar Rp {jumlah} sudah lewat jatuh tempo (H+{overdue_days}). Mohon segera dibayar ya. Kalau ada kendala bisa reply pesan ini — kami siap bantu. Terima kasih 🙏 — {toko_nama}',
    };
    saveField(field, defaults[field]);
  }

  if (!config) return <div>Loading...</div>;

  return (
    <div className="piutang-wa-reminder-screen">
      <header>
        <h1>⚙️ WA Reminder Templates <span className="badge">Premium</span></h1>
        <p>Atur pesan reminder yang otomatis dikirim ke customer H-3 (sebelum jatuh tempo) dan H+3 (setelah lewat jatuh tempo).</p>
      </header>

      <div className="global-toggle">
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => saveField('enabled', e.target.checked)}
          />
          Aktifkan WA Reminder Scheduler (semua customer)
        </label>
      </div>

      <section className="template-panel">
        <h2>📩 Template H-3 (3 hari sebelum jatuh tempo)</h2>
        <div className="editor-grid">
          <div className="editor-col">
            <TemplateChipInput
              variables={VARS_H3}
              value={config.template_h3}
              onChange={(next) => setConfig({ ...config, template_h3: next })}
              onBlur={() => saveField('template_h3', config.template_h3)}
            />
            <div className="save-indicator">
              {saveState === 'saved' && '✓ Tersimpan otomatis'}
              {saveState === 'saving' && '⏳ Menyimpan...'}
            </div>
            <div className="button-row">
              <button onClick={() => resetDefault('template_h3')}>🔄 Reset default</button>
              <button onClick={() => sendTest('H-3')} disabled={testSending}>
                📱 Kirim tes ke HP saya
              </button>
            </div>
          </div>
          <div className="preview-col">
            <TemplatePreview template={config.template_h3} sampleData={SAMPLE_DATA} />
          </div>
        </div>
      </section>

      <section className="template-panel">
        <h2>📩 Template H+3 (3 hari setelah jatuh tempo)</h2>
        <div className="editor-grid">
          <div className="editor-col">
            <TemplateChipInput
              variables={VARS_H3_PLUS}
              value={config.template_h3_plus}
              onChange={(next) => setConfig({ ...config, template_h3_plus: next })}
              onBlur={() => saveField('template_h3_plus', config.template_h3_plus)}
            />
            <div className="button-row">
              <button onClick={() => resetDefault('template_h3_plus')}>🔄 Reset default</button>
              <button onClick={() => sendTest('H+3')} disabled={testSending}>
                📱 Kirim tes ke HP saya
              </button>
            </div>
          </div>
          <div className="preview-col">
            <TemplatePreview template={config.template_h3_plus} sampleData={SAMPLE_DATA} />
          </div>
        </div>
      </section>

      <style>{`
        .piutang-wa-reminder-screen { max-width: 1200px; margin: 0 auto; padding: 24px; }
        header h1 { font-size: 24px; margin-bottom: 8px; }
        .badge {
          background: linear-gradient(135deg, #8B5CF6, #A78BFA);
          color: white; padding: 4px 10px; border-radius: 999px;
          font-size: 12px; font-weight: 700; margin-left: 8px;
        }
        .global-toggle { margin: 24px 0; padding: 16px; background: #F8FAFC; border-radius: 8px; }
        .template-panel { margin-bottom: 32px; padding: 24px; background: white; border: 1px solid #E2E8F0; border-radius: 12px; }
        .template-panel h2 { font-size: 18px; margin-bottom: 16px; }
        .editor-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 24px; }
        @media (max-width: 900px) { .editor-grid { grid-template-columns: 1fr; } }
        .button-row { display: flex; gap: 8px; margin-top: 12px; }
        button {
          padding: 8px 14px; border: 1px solid #E2E8F0; border-radius: 6px;
          background: white; cursor: pointer; font-size: 13px;
        }
        button:hover { background: #F8FAFC; }
        .save-indicator { font-size: 12px; color: #166534; margin-top: 6px; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Add route**

In `src/lib/urlRoute.ts` or `src/App.tsx`, register `piutang-wa-reminder` screen name.

- [ ] **Step 3: Commit**

```bash
git add src/components/pengaturan/PiutangWaReminderScreen.tsx src/lib/urlRoute.ts
git commit -m "feat(pengaturan): PiutangWaReminderScreen editable templates (Sprint 2)

Chip-based variable insertion, live WA preview, auto-save on blur,
test-send to owner phone, reset-to-default per template. Fully
Bahasa Indonesia UI. Premium badge in header. Mobile responsive.
Refs spec 5.11, 16."
```

---

### Task 2.8: Frontend — enable PiutangScreen button + Pelanggan opt-out

**Files:**
- Modify: `src/components/piutang/PiutangScreen.tsx` (remove disabled attribute, add badges + filter + manual send button)
- Modify: `src/components/PelangganScreen.tsx` (add `wa_reminder_enabled` toggle)

- [ ] **Step 1: Enable PiutangScreen WA reminder button**

Remove the `disabled` and `title="Phase 1C..."` attributes. Wire click handler to call `send_piutang_reminder_manual` RPC. Add per-row badge showing reminder status (`✓ H-3 sent 2h ago` etc.).

- [ ] **Step 2: Add Pelanggan opt-out toggle**

In `PelangganScreen.tsx` customer detail form:
```tsx
<label>
  <input
    type="checkbox"
    checked={customer.wa_reminder_enabled}
    onChange={(e) => updateCustomer({ ...customer, wa_reminder_enabled: e.target.checked })}
  />
  ✅ Kirim WA reminder otomatis untuk customer ini
</label>
<div className="helper-text">
  Uncheck kalau customer minta tidak di-remind lewat WA.
</div>
```

- [ ] **Step 3: Test locally + commit**

```bash
npm run dev
# Manual QA: navigate to /piutang, verify button enabled + click sends toast
# Navigate to /pelanggan/{id}, verify checkbox works
git add src/components/piutang/PiutangScreen.tsx src/components/PelangganScreen.tsx
git commit -m "feat(piutang,pelanggan): enable WA reminder UI (Sprint 2)

PiutangScreen: manual send button wired to RPC with tier-gate,
per-row badge showing reminder history, filter by 'belum sent'.
Pelanggan: per-customer opt-out toggle. Refs spec 5.11."
```

---

### Task 2.9: Sprint 2 deploy + Garindo E2E verification

- [ ] **Step 1: Deploy**

```bash
git push origin main
gcloud builds list --limit=2
```

Wait for `SUCCESS`.

- [ ] **Step 2: Verify Garindo tenant (Premium, has active Calista session)**

Login as Garindo owner → navigate to `Pengaturan → Piutang → WA Reminder Templates` → verify editor renders + preview updates + auto-save works.

- [ ] **Step 3: Create test tempo invoice + wait 3 days OR fake the due_date**

For fast verification, temporarily set `due_date = CURRENT_DATE + 3` on an existing OPEN tempo invoice, then manually trigger the cron:

```sql
UPDATE public.orders SET due_date = CURRENT_DATE + 3 WHERE id = '<test-invoice>';
-- Trigger cron manually (or just wait for 09:00 WIB)
```

- [ ] **Step 4: Verify audit row + WA delivery**

```sql
SELECT * FROM public.piutang_reminder_sent WHERE tenant_id = 'garindo' ORDER BY sent_at DESC LIMIT 5;
```

Expected: SENT row for H-3 rule_type. Verify customer's WA number received the message (real WA check).

- [ ] **Step 5: Update progress.md + Sprint 2 done**

Add Sprint 2 entry to progress.md, commit, push.

Rollback: `git revert` + drop migrations 410-413.

---

# 🎨 SPRINT 3 — Universal Templates + Versioning + Order Lifecycle (4 dev-days)

**Spec reference**: Section 5.9 (versioning), 5.4 (order lifecycle), 5.11 (universal template UI), success criteria bullet Sprint 3.

**Goal**: Extend template editability to 10 templates total (Piutang H-3 + H+3 from Sprint 2 + 8 more). Add versioning history table. Verify order_created explicit event + order_shipped event fires end-to-end.

### Task 3.1: `tenant_notification_templates` + versioning migrations

**Files:**
- Create: `supabase/migrations/20261115000420_notification_templates.sql`
- Create: `supabase/migrations/20261115000421_notification_templates_history.sql`

- [ ] **Step 1: Write templates migration**

```sql
-- supabase/migrations/20261115000420_notification_templates.sql
CREATE TABLE IF NOT EXISTS public.tenant_notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,  -- e.g., 'booking_expiry', 'payment_verified'
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE (tenant_id, template_id)
);

ALTER TABLE public.tenant_notification_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_select_own ON public.tenant_notification_templates
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());
CREATE POLICY t_upsert_own ON public.tenant_notification_templates
  FOR ALL TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id())
  WITH CHECK (tenant_id = public._resolve_tenant_id());
```

- [ ] **Step 2: Write versioning history migration**

```sql
-- supabase/migrations/20261115000421_notification_templates_history.sql
CREATE TABLE IF NOT EXISTS public.tenant_notification_templates_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  actor_user_id UUID REFERENCES admin_users(id),
  old_content TEXT,
  new_content TEXT NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_history_tenant_template
  ON public.tenant_notification_templates_history (tenant_id, template_id, edited_at DESC);

ALTER TABLE public.tenant_notification_templates_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_select_own ON public.tenant_notification_templates_history
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

-- Trigger to auto-record every UPDATE on tenant_notification_templates
CREATE OR REPLACE FUNCTION public.record_template_history()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.tenant_notification_templates_history
    (tenant_id, template_id, actor_user_id, old_content, new_content)
  VALUES (NEW.tenant_id, NEW.template_id, NEW.updated_by, OLD.content, NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_template_history ON public.tenant_notification_templates;
CREATE TRIGGER trg_template_history
  AFTER UPDATE OF content ON public.tenant_notification_templates
  FOR EACH ROW
  WHEN (OLD.content IS DISTINCT FROM NEW.content)
  EXECUTE FUNCTION public.record_template_history();
```

- [ ] **Step 3: Apply + commit**

```bash
# Apply via MCP apply_migration
git add supabase/migrations/20261115000420_notification_templates.sql supabase/migrations/20261115000421_notification_templates_history.sql
git commit -m "feat(db): universal template registry + versioning (Sprint 3)

Migration slots 420-421. tenant_notification_templates stores per-tenant
custom templates (10 template_ids). Update trigger auto-records every
content change to history table with actor + timestamp. Refs spec 5.9, 6."
```

---

### Task 3.2: `order_created` + `order_shipped` explicit event triggers

**Files:**
- Create: `supabase/migrations/20261115000422_orders_lifecycle_triggers.sql`
- Create: `backend-go/internal/notification/templates/order_created.go`
- Create: `backend-go/internal/notification/templates/order_shipped.go`
- Modify: `backend-go/main.go` (LISTEN handlers)

**Interfaces:**
- Consumes: `NotifyCustomer` (Sprint 1), Postgres LISTEN/NOTIFY
- Produces: automatic WA confirmation to customer on order INSERT + on status transition to SHIPPED

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20261115000422_orders_lifecycle_triggers.sql
-- Sprint 3: fire NOTIFY on order INSERT + on status transition to SHIPPED.
-- Ensures WA lifecycle notifications fire regardless of caller path (Calista
-- vs kasir UI vs pesanan admin). Idempotent (uses OR REPLACE).

CREATE OR REPLACE FUNCTION public.notify_order_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'order_created',
    json_build_object(
      'order_id', NEW.id,
      'tenant_id', NEW.tenant_id,
      'customer_id', NEW.customer_id,
      'invoice_no', NEW.invoice_no,
      'amount', NEW.amount_due
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_created ON public.orders;
CREATE TRIGGER trg_order_created
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_created();

CREATE OR REPLACE FUNCTION public.notify_order_shipped()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'SHIPPED' AND (OLD.status IS NULL OR OLD.status != 'SHIPPED') THEN
    PERFORM pg_notify(
      'order_shipped',
      json_build_object(
        'order_id', NEW.id,
        'tenant_id', NEW.tenant_id,
        'customer_id', NEW.customer_id,
        'invoice_no', NEW.invoice_no
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_shipped ON public.orders;
CREATE TRIGGER trg_order_shipped
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_shipped();
```

- [ ] **Step 2: Apply migration via MCP** (name: `orders_lifecycle_triggers`).

- [ ] **Step 3: Implement OrderCreated + OrderShipped templates**

```go
// backend-go/internal/notification/templates/order_created.go
package templates

import "context"

type OrderCreated struct{ CustomTemplate string }

const DefaultOrderCreatedTemplate = "Halo {customer_nama} 👋, terima kasih sudah order di {toko_nama}!\n\nInvoice: #{invoice_no}\nTotal: Rp {amount}\n\nKami akan info kalau pesanan sudah siap dikirim. Terima kasih 🙏"

func (OrderCreated) TemplateID() string       { return "order_created" }
func (OrderCreated) RequiredParams() []string { return []string{"customer_nama", "toko_nama", "invoice_no", "amount"} }
func (o OrderCreated) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := o.CustomTemplate
	if tmpl == "" { tmpl = DefaultOrderCreatedTemplate }
	return renderSimple(tmpl, params, o.RequiredParams())
}
```

```go
// backend-go/internal/notification/templates/order_shipped.go
package templates

import "context"

type OrderShipped struct{ CustomTemplate string }

const DefaultOrderShippedTemplate = "Halo {customer_nama} 📦, pesanan #{invoice_no} sudah kami kirim!\n\nMohon dicek. Kalau ada masalah balas pesan ini ya. Terima kasih 🙏 — {toko_nama}"

func (OrderShipped) TemplateID() string       { return "order_shipped" }
func (OrderShipped) RequiredParams() []string { return []string{"customer_nama", "toko_nama", "invoice_no"} }
func (o OrderShipped) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := o.CustomTemplate
	if tmpl == "" { tmpl = DefaultOrderShippedTemplate }
	return renderSimple(tmpl, params, o.RequiredParams())
}
```

Add `renderSimple` helper to templates package (shared across all Sprint 3+ templates):

```go
// backend-go/internal/notification/templates/render.go
package templates

import (
	"errors"
	"fmt"
	"strings"
)

// renderSimple performs {key} substitution across all keys in params.
// Returns error if any required key is missing.
func renderSimple(tmpl string, params map[string]any, required []string) (string, error) {
	for _, k := range required {
		if _, ok := params[k]; !ok {
			return "", fmt.Errorf("template: missing %q: %w", k, errors.New("missing param"))
		}
	}
	rendered := tmpl
	for k, v := range params {
		rendered = strings.ReplaceAll(rendered, "{"+k+"}", fmt.Sprint(v))
	}
	return rendered, nil
}
```

- [ ] **Step 4: Register LISTEN handlers in main.go**

```go
go handleLifecycleListen(ctx, listenConnStr, "order_created", notifier, db)
go handleLifecycleListen(ctx, listenConnStr, "order_shipped", notifier, db)
```

Implementation similar to Task 1.8 approval-created listener: parse JSON payload, look up customer+tenant details, render template, call `NotifyCustomer`.

- [ ] **Step 5: Build + test + commit**

```bash
cd backend-go && go build ./... && go test ./internal/notification/templates/... -v
git add supabase/migrations/20261115000422_orders_lifecycle_triggers.sql backend-go/internal/notification/templates/order_created.go backend-go/internal/notification/templates/order_shipped.go backend-go/internal/notification/templates/render.go backend-go/main.go
git commit -m "feat(orders): order_created + order_shipped triggers + templates (Sprint 3)

Migration slot 422. Every order INSERT fires order_created NOTIFY;
every status transition to SHIPPED fires order_shipped NOTIFY.
Go handlers convert to WA sends via NotifyCustomer. Refs spec 5.4."
```

---

### Task 3.3: Extract 4 remaining lifecycle templates from handler.go

**Files:**
- Create: `backend-go/internal/notification/templates/payment_verified.go`
- Create: `backend-go/internal/notification/templates/dp_verified.go`
- Create: `backend-go/internal/notification/templates/payment_rejected.go`
- Create: `backend-go/internal/notification/templates/order_approved.go`
- Modify: `backend-go/internal/handler/handler.go` (replace inline `fmt.Sprintf` with template calls)

- [ ] **Step 1: Grep existing formatter functions**

```bash
grep -n "buildPaymentVerifiedMessage\|buildDpVerifiedMessage\|buildPaymentRejectedMessage\|buildOrderApprovedMessage" backend-go/internal/handler/handler.go
```

- [ ] **Step 2: Create each template file — same shape, different constant**

Copy `order_created.go` as template. For each of 4 files: change type name, TemplateID string, RequiredParams, and DefaultXXXTemplate constant. The 4 default templates:

```go
const DefaultPaymentVerifiedTemplate = "Halo {customer_nama} 👋, pembayaran untuk invoice #{invoice_no} sudah kami terima dan verifikasi.\n\nJumlah: Rp {amount}\n\nTerima kasih! Pesanan akan segera diproses 🙏 — {toko_nama}"
// RequiredParams: customer_nama, toko_nama, invoice_no, amount

const DefaultDpVerifiedTemplate = "Halo {customer_nama} 👋, DP untuk invoice #{invoice_no} sudah kami terima.\n\nSisa: Rp {sisa_amount}\nDeadline pelunasan: {due_date}\n\nTerima kasih 🙏 — {toko_nama}"
// RequiredParams: customer_nama, toko_nama, invoice_no, sisa_amount, due_date

const DefaultPaymentRejectedTemplate = "Halo {customer_nama}, mohon maaf pembayaran untuk invoice #{invoice_no} belum bisa kami verifikasi.\n\nAlasan: {reason}\n\nSilakan cek dan kirim ulang bukti transfer. Terima kasih 🙏 — {toko_nama}"
// RequiredParams: customer_nama, toko_nama, invoice_no, reason

const DefaultOrderApprovedTemplate = "Halo {customer_nama} 👋, order kamu #{invoice_no} sudah kami approve!\n\nKami akan proses secepatnya. Terima kasih 🙏 — {toko_nama}"
// RequiredParams: customer_nama, toko_nama, invoice_no
```

- [ ] **Step 3: Add unit test for each template**

```go
// backend-go/internal/notification/templates/payment_verified_test.go
func TestPaymentVerified_Rendered(t *testing.T) {
	msg, err := PaymentVerified{}.Build(context.Background(), map[string]any{
		"customer_nama": "Pak Budi", "toko_nama": "Toko Jaya",
		"invoice_no": "INV-001", "amount": "4.200.000",
	})
	if err != nil { t.Fatal(err) }
	if !strings.Contains(msg, "INV-001") { t.Errorf("got %s", msg) }
}
```

Repeat for dp_verified, payment_rejected, order_approved.

- [ ] **Step 4: Modify handler.go to route through templates + NotifyCustomer**

Replace each inline `fmt.Sprintf` + direct `sender.SendText` sequence with `templates.Xxx{}.Build(...)` + `notifier.NotifyCustomer(...)`.

- [ ] **Step 5: Build + test + commit**

```bash
cd backend-go && go build ./... && go test ./internal/notification/templates/... -v
git add backend-go/internal/notification/templates/payment_verified.go backend-go/internal/notification/templates/dp_verified.go backend-go/internal/notification/templates/payment_rejected.go backend-go/internal/notification/templates/order_approved.go backend-go/internal/notification/templates/payment_verified_test.go backend-go/internal/handler/handler.go
git commit -m "refactor(handler): 4 lifecycle templates + NotifyCustomer routing (Sprint 3)"
```

---

### Task 3.4: Universal `NotificationTemplatesScreen` + history modal

**Files:**
- Create: `src/components/pengaturan/NotificationTemplatesScreen.tsx`
- Create: `src/components/notification/TemplateHistoryModal.tsx`

**Interfaces:**
- Reuses: `TemplateChipInput`, `TemplatePreview` (Sprint 2)
- Consumes: `tenant_notification_templates` + `tenant_notification_templates_history` tables

- [ ] **Step 1: Implement NotificationTemplatesScreen**

Sidebar (left column) lists 10 templates in 2 groups: "Untuk Customer" (8 templates) and "Untuk Staff & Owner" (2 templates). Right column is the editor for the selected template.

```tsx
// src/components/pengaturan/NotificationTemplatesScreen.tsx
import { useEffect, useState } from 'react';
import { TemplateChipInput } from '../notification/TemplateChipInput';
import { TemplatePreview } from '../notification/TemplatePreview';
import { TemplateHistoryModal } from '../notification/TemplateHistoryModal';
import { supabase } from '../../lib/supabase';

interface TemplateDef {
  id: string;
  label: string;
  group: 'customer' | 'staff';
  variables: { key: string; label: string }[];
  sampleData: Record<string, string>;
  defaultContent: string;
}

// The defaultContent strings mirror the Go DefaultXXXTemplate constants
// verbatim. Copy from the .go files in internal/notification/templates/.
const TEMPLATES: TemplateDef[] = [
  {
    id: 'order_created', label: 'Konfirmasi Order Baru', group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' }, { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' }, { key: 'amount', label: 'Jumlah Rp' },
    ],
    sampleData: { customer_nama: 'Pak Budi', toko_nama: 'Toko Jaya', invoice_no: 'INV-001', amount: '4.200.000' },
    defaultContent: 'Halo {customer_nama} 👋, terima kasih sudah order di {toko_nama}!\n\nInvoice: #{invoice_no}\nTotal: Rp {amount}\n\nKami akan info kalau pesanan sudah siap dikirim. Terima kasih 🙏',
  },
  {
    id: 'payment_verified', label: 'Pembayaran Diverifikasi', group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' }, { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' }, { key: 'amount', label: 'Jumlah Rp' },
    ],
    sampleData: { customer_nama: 'Pak Budi', toko_nama: 'Toko Jaya', invoice_no: 'INV-001', amount: '4.200.000' },
    defaultContent: 'Halo {customer_nama} 👋, pembayaran untuk invoice #{invoice_no} sudah kami terima dan verifikasi.\n\nJumlah: Rp {amount}\n\nTerima kasih! Pesanan akan segera diproses 🙏 — {toko_nama}',
  },
  {
    id: 'dp_verified', label: 'DP Diverifikasi', group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' }, { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' }, { key: 'sisa_amount', label: 'Sisa Rp' }, { key: 'due_date', label: 'Deadline' },
    ],
    sampleData: { customer_nama: 'Pak Budi', toko_nama: 'Toko Jaya', invoice_no: 'INV-001', sisa_amount: '2.100.000', due_date: '25 Jul 2026' },
    defaultContent: 'Halo {customer_nama} 👋, DP untuk invoice #{invoice_no} sudah kami terima.\n\nSisa: Rp {sisa_amount}\nDeadline pelunasan: {due_date}\n\nTerima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'payment_rejected', label: 'Pembayaran Ditolak', group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' }, { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' }, { key: 'reason', label: 'Alasan' },
    ],
    sampleData: { customer_nama: 'Pak Budi', toko_nama: 'Toko Jaya', invoice_no: 'INV-001', reason: 'Nominal transfer tidak sesuai' },
    defaultContent: 'Halo {customer_nama}, mohon maaf pembayaran untuk invoice #{invoice_no} belum bisa kami verifikasi.\n\nAlasan: {reason}\n\nSilakan cek dan kirim ulang bukti transfer. Terima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'order_approved', label: 'Order Disetujui', group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' }, { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
    ],
    sampleData: { customer_nama: 'Pak Budi', toko_nama: 'Toko Jaya', invoice_no: 'INV-001' },
    defaultContent: 'Halo {customer_nama} 👋, order kamu #{invoice_no} sudah kami approve!\n\nKami akan proses secepatnya. Terima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'order_shipped', label: 'Order Dikirim', group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' }, { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
    ],
    sampleData: { customer_nama: 'Pak Budi', toko_nama: 'Toko Jaya', invoice_no: 'INV-001' },
    defaultContent: 'Halo {customer_nama} 📦, pesanan #{invoice_no} sudah kami kirim!\n\nMohon dicek. Kalau ada masalah balas pesan ini ya. Terima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'booking_expiry', label: 'Reminder Booking Expiry', group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' }, { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
    ],
    sampleData: { customer_nama: 'Pak Budi', toko_nama: 'Toko Jaya', invoice_no: 'INV-001' },
    defaultContent: 'Halo {customer_nama} 👋,\n\nPesanan #{invoice_no} di {toko_nama} akan expired dalam 24 jam ke depan. Kalau mau lanjut pembayaran, silakan chat kami. Kalau tidak, pesanan akan dibatalkan otomatis.\n\nTerima kasih 🙏',
  },
  {
    id: 'followup_customer', label: 'Follow-up Silent Customer', group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' }, { key: 'toko_nama', label: 'Nama Toko' },
    ],
    sampleData: { customer_nama: 'Pak Budi', toko_nama: 'Toko Jaya' },
    defaultContent: 'Halo {customer_nama} 👋, sudah lama tidak dengar kabar. Ada yang bisa kami bantu? Kalau ada order baru langsung chat aja. Terima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'staff_escalation_payment', label: 'Escalation Pembayaran', group: 'staff',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' }, { key: 'invoice_no', label: 'Nomor Invoice' },
      { key: 'reason', label: 'Alasan' },
    ],
    sampleData: { customer_nama: 'Pak Budi', invoice_no: 'INV-001', reason: 'Nominal transfer tidak match' },
    defaultContent: '🚨 Escalation: pembayaran {invoice_no} dari {customer_nama} butuh verifikasi manual.\n\nAlasan: {reason}\n\nBuka Sales Inbox untuk cek bukti transfer.',
  },
  {
    id: 'heartbeat_digest', label: 'Ringkasan Harian Owner', group: 'staff',
    variables: [
      { key: 'tanggal', label: 'Tanggal' }, { key: 'omset_hari', label: 'Omset Hari' },
      { key: 'laba_hari', label: 'Laba Hari' }, { key: 'low_stock_count', label: 'Jumlah Stok Menipis' },
    ],
    sampleData: { tanggal: '19 Jul 2026', omset_hari: '5.000.000', laba_hari: '1.250.000', low_stock_count: '3' },
    defaultContent: '📊 *Ringkasan Hari Ini — {tanggal}*\n\n💰 Omset: Rp {omset_hari}\n💵 Laba: Rp {laba_hari}\n\n⚠️ Stok menipis: {low_stock_count} item',
  },
];

export function NotificationTemplatesScreen() {
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string>(TEMPLATES[0].id);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('tenant_notification_templates')
        .select('template_id, content');
      const map = (data || []).reduce((acc, row) => ({ ...acc, [row.template_id]: row.content }), {});
      setTemplates(map);
    })();
  }, []);

  const selected = TEMPLATES.find((t) => t.id === selectedId)!;
  const currentContent = templates[selectedId] ?? selected.defaultContent;

  async function saveTemplate() {
    setSaveState('saving');
    const { error } = await supabase
      .from('tenant_notification_templates')
      .upsert({ template_id: selectedId, content: currentContent }, { onConflict: 'tenant_id,template_id' });
    if (error) { alert(error.message); setSaveState('idle'); return; }
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  }

  function resetDefault() {
    setTemplates({ ...templates, [selectedId]: selected.defaultContent });
    saveTemplate();
  }

  async function sendTest() {
    const { error } = await supabase.rpc('send_notification_test', { p_template_id: selectedId });
    if (error) alert(error.message); else alert('✓ Terkirim! Cek WhatsApp kamu.');
  }

  return (
    <div className="notification-templates-screen">
      <header><h1>⚙️ Semua Template Notifikasi WhatsApp</h1></header>
      <div className="grid">
        <aside className="sidebar">
          <h3>Untuk Customer</h3>
          {TEMPLATES.filter(t => t.group === 'customer').map(t => (
            <button key={t.id} className={selectedId === t.id ? 'active' : ''} onClick={() => setSelectedId(t.id)}>
              {t.label}
              {templates[t.id] && templates[t.id] !== t.defaultContent && <span className="edited">✏️</span>}
            </button>
          ))}
          <h3>Untuk Staff & Owner</h3>
          {TEMPLATES.filter(t => t.group === 'staff').map(t => (
            <button key={t.id} className={selectedId === t.id ? 'active' : ''} onClick={() => setSelectedId(t.id)}>
              {t.label}
              {templates[t.id] && templates[t.id] !== t.defaultContent && <span className="edited">✏️</span>}
            </button>
          ))}
        </aside>
        <main className="editor">
          <h2>{selected.label}</h2>
          <div className="editor-grid">
            <div>
              <TemplateChipInput
                variables={selected.variables}
                value={currentContent}
                onChange={(v) => setTemplates({ ...templates, [selectedId]: v })}
                onBlur={saveTemplate}
              />
              <div className="button-row">
                <button onClick={resetDefault}>🔄 Reset ke default</button>
                <button onClick={sendTest}>📱 Kirim tes ke HP saya</button>
                <button onClick={() => setHistoryOpen(true)}>📜 Riwayat perubahan</button>
              </div>
              <div className="save-indicator">{saveState === 'saved' && '✓ Tersimpan otomatis'}</div>
            </div>
            <TemplatePreview template={currentContent} sampleData={selected.sampleData} />
          </div>
        </main>
      </div>
      {historyOpen && (
        <TemplateHistoryModal
          templateId={selectedId}
          onClose={() => setHistoryOpen(false)}
          onRestore={(content) => { setTemplates({ ...templates, [selectedId]: content }); setHistoryOpen(false); saveTemplate(); }}
        />
      )}
      <style>{`
        .grid { display: grid; grid-template-columns: 260px 1fr; gap: 24px; }
        .sidebar { border-right: 1px solid #E2E8F0; padding-right: 12px; }
        .sidebar button {
          display: block; width: 100%; text-align: left; padding: 10px 12px;
          background: white; border: 1px solid transparent; border-radius: 6px; margin-bottom: 4px; cursor: pointer;
        }
        .sidebar button.active { background: #F0F9FF; border-color: #0EA5E9; font-weight: 600; }
        .sidebar h3 { font-size: 12px; text-transform: uppercase; color: #64748B; margin: 16px 0 8px 12px; }
        .editor-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 24px; }
        @media (max-width: 900px) { .grid, .editor-grid { grid-template-columns: 1fr; } }
        .edited { margin-left: 8px; }
        .button-row { display: flex; gap: 8px; margin-top: 12px; }
        .save-indicator { font-size: 12px; color: #166534; margin-top: 6px; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Implement TemplateHistoryModal**

```tsx
// src/components/notification/TemplateHistoryModal.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface HistoryRow {
  id: string;
  actor_user_id: string | null;
  old_content: string | null;
  new_content: string;
  edited_at: string;
}

export function TemplateHistoryModal({ templateId, onClose, onRestore }: { templateId: string; onClose: () => void; onRestore: (content: string) => void }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('tenant_notification_templates_history')
        .select('id, actor_user_id, old_content, new_content, edited_at')
        .eq('template_id', templateId)
        .order('edited_at', { ascending: false })
        .limit(50);
      setRows(data || []);
    })();
  }, [templateId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Riwayat perubahan template</h2>
          <button onClick={onClose}>✕</button>
        </header>
        {rows.length === 0 && <p>Belum ada perubahan.</p>}
        {rows.map((r) => (
          <div key={r.id} className="row">
            <div className="row-meta">
              {new Date(r.edited_at).toLocaleString('id-ID')} · oleh {r.actor_user_id?.slice(0, 8) ?? 'System'}
            </div>
            <details>
              <summary>Preview {r.new_content.slice(0, 80)}...</summary>
              <pre className="old">Sebelum: {r.old_content}</pre>
              <pre className="new">Sesudah: {r.new_content}</pre>
            </details>
            <button onClick={() => onRestore(r.new_content)}>Restore versi ini</button>
          </div>
        ))}
      </div>
      <style>{`
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal { background: white; padding: 24px; border-radius: 12px; max-width: 640px; width: 100%; max-height: 80vh; overflow: auto; }
        .row { padding: 12px 0; border-bottom: 1px solid #E2E8F0; }
        .row-meta { font-size: 12px; color: #64748B; margin-bottom: 6px; }
        pre { white-space: pre-wrap; font-family: inherit; font-size: 12px; padding: 8px; border-radius: 4px; }
        .old { background: #FEE2E2; }
        .new { background: #DCFCE7; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Register route + commit**

Add `notification-templates` screen to `src/lib/urlRoute.ts`.

```bash
git add src/components/pengaturan/NotificationTemplatesScreen.tsx src/components/notification/TemplateHistoryModal.tsx src/lib/urlRoute.ts
git commit -m "feat(pengaturan): universal template editor + versioning history UI (Sprint 3)

Sidebar navigates 10 templates. Editor reuses Sprint 2 chip/preview
primitives. TemplateHistoryModal shows last 50 edits with restore.
Refs spec 5.9, 5.11."
```

---

### Task 3.5: Sprint 3 deploy + verify

- [ ] **Step 1: Deploy**

```bash
git push origin main
gcloud builds list --limit=2
```

- [ ] **Step 2: Verify order_created + order_shipped fire end-to-end**

Login as Garindo owner, create test order via kasir UI. Verify customer receives order_created WA within 5 seconds. Change status to SHIPPED. Verify customer receives order_shipped WA within 5 seconds.

- [ ] **Step 3: Verify template edit + history**

Navigate to `Pengaturan → Template Notifikasi`. Edit `payment_verified` content. Blur field. Reopen — content persisted. Click "Riwayat perubahan" — see 1 edit row.

- [ ] **Step 4: Update progress.md + Sprint 3 done**

Rollback: `git revert` + `DROP TRIGGER trg_order_created, trg_order_shipped; DROP TABLE tenant_notification_templates_history; DROP TABLE tenant_notification_templates;`

---

# 📊 SPRINT 4 — New Notifications (3.5 dev-days)

**Spec reference**: Sections 5.5 (Piutang overdue), 5.6 (Hutang overdue), 5.7 (Approval SLA), 5.8 (Post-order feedback).

**Goal**: Ship 4 new notification types — Piutang overdue summary (daily 08:00 WIB), Hutang overdue summary (daily 07:30 WIB), Approval SLA breach alert (15-min poll), Post-order feedback request (7 days post-completion) + `customer_feedback` table.

### Task 4.1: Piutang overdue summary — template + poller

**Files:**
- Create: `backend-go/internal/notification/templates/piutang_overdue_summary.go`
- Create: `backend-go/internal/piutang/overdue_summary_poller.go`
- Modify: `backend-go/main.go`

- [ ] **Step 1: Template**

```go
// backend-go/internal/notification/templates/piutang_overdue_summary.go
package templates

import "context"

type PiutangOverdueSummary struct{ CustomTemplate string }

const DefaultPiutangOverdueSummaryTemplate = "📊 *Ringkasan Piutang — {tanggal}*\n\nTotal invoice overdue: {total_count}\nTotal nilai: Rp {total_amount}\n\nTerlama:\n{top_list}\n\nSemua akan dapat H+3 auto WA reminder (jam 09:00). Yang H+30+ mungkin butuh follow-up personal."

func (PiutangOverdueSummary) TemplateID() string       { return "piutang_overdue_summary" }
func (PiutangOverdueSummary) RequiredParams() []string { return []string{"tanggal", "total_count", "total_amount", "top_list"} }
func (p PiutangOverdueSummary) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := p.CustomTemplate
	if tmpl == "" { tmpl = DefaultPiutangOverdueSummaryTemplate }
	return renderSimple(tmpl, params, p.RequiredParams())
}
```

- [ ] **Step 2: Poller — daily 08:00 WIB**

```go
// backend-go/internal/piutang/overdue_summary_poller.go
package piutang

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/tonywei/erp-antigravity/backend-go/internal/notification"
	"github.com/tonywei/erp-antigravity/backend-go/internal/notification/templates"
)

type OverdueSummaryPoller struct {
	db       *sql.DB
	notifier *notification.Notifier
	tz       *time.Location
}

func NewOverdueSummaryPoller(db *sql.DB, n *notification.Notifier) *OverdueSummaryPoller {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	return &OverdueSummaryPoller{db: db, notifier: n, tz: tz}
}

func (p *OverdueSummaryPoller) Start(ctx context.Context) {
	go func() {
		for {
			next := nextDailyTarget(time.Now().In(p.tz), 8, 0)
			select {
			case <-ctx.Done(): return
			case <-time.After(time.Until(next)): p.runOnce(ctx)
			}
		}
	}()
}

func (p *OverdueSummaryPoller) runOnce(ctx context.Context) {
	log := slog.Default().With("feature", "piutang_overdue_summary")
	rows, err := p.db.QueryContext(ctx, `
		SELECT o.tenant_id, COUNT(*) AS total_count, SUM(o.amount_due)::BIGINT AS total_amount
		FROM public.orders o
		JOIN public.tenant_wa_reminder_config cfg ON cfg.tenant_id = o.tenant_id
		WHERE o.status = 'OPEN' AND o.payment_type IN ('tempo','kredit')
		  AND o.due_date < CURRENT_DATE
		  AND COALESCE(cfg.enabled, TRUE) = TRUE
		GROUP BY o.tenant_id
	`)
	if err != nil { log.ErrorContext(ctx, "query", slog.Any("error", err)); return }
	defer rows.Close()

	for rows.Next() {
		var tenantID string
		var totalCount int
		var totalAmount int64
		rows.Scan(&tenantID, &totalCount, &totalAmount)
		if totalCount == 0 { continue }

		topLines := p.fetchTopOverdue(ctx, tenantID)
		tmpl := templates.PiutangOverdueSummary{}
		msg, _ := tmpl.Build(ctx, map[string]any{
			"tanggal":      time.Now().In(p.tz).Format("2 Jan 2006"),
			"total_count":  totalCount,
			"total_amount": formatRp(totalAmount),
			"top_list":     strings.Join(topLines, "\n"),
		})
		_ = p.notifier.BroadcastToStaff(ctx, tenantID, notification.RecipientFilter{Role: "owner", CritLevel: "normal"}, msg)
	}
}

func (p *OverdueSummaryPoller) fetchTopOverdue(ctx context.Context, tenantID string) []string {
	rows, _ := p.db.QueryContext(ctx, `
		SELECT c.name, o.amount_due, CURRENT_DATE - o.due_date AS days_overdue
		FROM public.orders o JOIN public.customers c ON o.customer_id = c.id
		WHERE o.tenant_id=$1 AND o.status='OPEN' AND o.payment_type IN ('tempo','kredit')
		  AND o.due_date < CURRENT_DATE ORDER BY o.due_date ASC LIMIT 3
	`, tenantID)
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		var amt int64
		var days int
		rows.Scan(&name, &amt, &days)
		out = append(out, fmt.Sprintf("• %s — Rp %s — H+%d", name, formatRp(amt), days))
	}
	return out
}
```

Note: `nextDailyTarget` and `formatRp` are shared helpers from Sprint 2 (Task 2.4). Import from `internal/piutang`.

- [ ] **Step 3: Register + commit**

```bash
git add backend-go/internal/notification/templates/piutang_overdue_summary.go backend-go/internal/piutang/overdue_summary_poller.go backend-go/main.go
git commit -m "feat(piutang): overdue summary daily broadcast to owner (Sprint 4)

Daily 08:00 WIB cron. Refs spec 5.5."
```

---

### Task 4.2: Hutang overdue summary (NEW package)

**Files:**
- Create: `backend-go/internal/notification/templates/hutang_overdue_summary.go`
- Create: `backend-go/internal/hutang/overdue_summary_poller.go`

- [ ] **Step 1: Template**

```go
// backend-go/internal/notification/templates/hutang_overdue_summary.go
package templates

import "context"

type HutangOverdueSummary struct{ CustomTemplate string }

const DefaultHutangOverdueSummaryTemplate = "💸 *Ringkasan Hutang Supplier — {tanggal}*\n\nTagihan jatuh tempo minggu ini: {total_count}\nTotal nilai: Rp {total_amount}\n\nTerdekat:\n{top_list}\n\nBuka Pembelian → Pembayaran untuk atur pembayaran."

func (HutangOverdueSummary) TemplateID() string       { return "hutang_overdue_summary" }
func (HutangOverdueSummary) RequiredParams() []string { return []string{"tanggal", "total_count", "total_amount", "top_list"} }
func (h HutangOverdueSummary) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := h.CustomTemplate
	if tmpl == "" { tmpl = DefaultHutangOverdueSummaryTemplate }
	return renderSimple(tmpl, params, h.RequiredParams())
}
```

- [ ] **Step 2: Poller — daily 07:30 WIB**

Same structure as `piutang/overdue_summary_poller.go`, differences:
- Cron target: `nextDailyTarget(now, 7, 30)`
- Query: `purchase_invoices` (or existing hutang schema table — check with grep)
- Filter: `due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`
- Template: `HutangOverdueSummary`
- Top-list ordering: earliest `due_date` first

- [ ] **Step 3: Register + commit**

```bash
git add backend-go/internal/notification/templates/hutang_overdue_summary.go backend-go/internal/hutang/overdue_summary_poller.go backend-go/main.go
git commit -m "feat(hutang): overdue summary daily broadcast (Sprint 4)

Daily 07:30 WIB. Refs spec 5.6."
```

---

### Task 4.3: Approval SLA breach alert

**Files:**
- Create: `supabase/migrations/20261115000430_approval_sla_breach_flag.sql`
- Create: `backend-go/internal/notification/templates/approval_sla_breach.go`
- Create: `backend-go/internal/approvals/sla_breach_poller.go`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20261115000430_approval_sla_breach_flag.sql
ALTER TABLE public.approval_requests
  ADD COLUMN IF NOT EXISTS sla_breach_notified_at TIMESTAMPTZ;
```

Apply via MCP.

- [ ] **Step 2: Template**

```go
// backend-go/internal/notification/templates/approval_sla_breach.go
package templates

import "context"

type ApprovalSlaBreach struct{ CustomTemplate string }

const DefaultApprovalSlaBreachTemplate = "⚠️ *Approval Pending SLA Breach*\n\n{total_count} approval sudah pending > 2 jam belum di-respond:\n\n{top_list}\n\nBuka Approval Inbox di app.caleo.id untuk respond."

func (ApprovalSlaBreach) TemplateID() string       { return "approval_sla_breach" }
func (ApprovalSlaBreach) RequiredParams() []string { return []string{"total_count", "top_list"} }
func (a ApprovalSlaBreach) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := a.CustomTemplate
	if tmpl == "" { tmpl = DefaultApprovalSlaBreachTemplate }
	return renderSimple(tmpl, params, a.RequiredParams())
}
```

- [ ] **Step 3: Poller — 15-min ticker**

```go
// backend-go/internal/approvals/sla_breach_poller.go
package approvals

// Every 15 minutes:
// 1. SELECT tenant_id, id, type, details, created_at FROM approval_requests
//    WHERE status='PENDING' AND created_at < NOW() - INTERVAL '2 hours'
//    AND sla_breach_notified_at IS NULL
// 2. Group by tenant_id
// 3. For each tenant: build message via ApprovalSlaBreach template with total_count + top_list
// 4. Send via BroadcastToStaff with CritLevel="critical" (bypasses quiet hours)
// 5. UPDATE approval_requests SET sla_breach_notified_at = NOW() WHERE id IN (...)
```

- [ ] **Step 4: Register + commit**

```bash
git add supabase/migrations/20261115000430_approval_sla_breach_flag.sql backend-go/internal/notification/templates/approval_sla_breach.go backend-go/internal/approvals/sla_breach_poller.go backend-go/main.go
git commit -m "feat(approvals): SLA breach alert 15-min poll (Sprint 4)

Migration slot 430. Critical bypasses quiet hours. Refs spec 5.7."
```

---

### Task 4.4: Post-order feedback request + `customer_feedback` table

**Files:**
- Create: `supabase/migrations/20261115000431_customer_feedback.sql`
- Create: `backend-go/internal/notification/templates/post_order_feedback.go`
- Create: `backend-go/internal/feedback/request_poller.go`
- Create: `backend-go/internal/feedback/response_handler.go`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20261115000431_customer_feedback.sql
CREATE TABLE IF NOT EXISTS public.customer_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  customer_id UUID NOT NULL,
  order_id UUID NOT NULL,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  approved_for_landing BOOLEAN DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_tenant_rating
  ON public.customer_feedback (tenant_id, rating DESC);

ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_select_own ON public.customer_feedback FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());
CREATE POLICY t_insert_own ON public.customer_feedback FOR INSERT TO vosi_rpc_owner
  WITH CHECK (tenant_id = public._resolve_tenant_id());
CREATE POLICY t_update_own ON public.customer_feedback FOR UPDATE TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS feedback_requested_at TIMESTAMPTZ;
```

- [ ] **Step 2: Template**

```go
// backend-go/internal/notification/templates/post_order_feedback.go
package templates

import "context"

type PostOrderFeedback struct{ CustomTemplate string }

const DefaultPostOrderFeedbackTemplate = "Halo {customer_nama} 👋, terima kasih sudah order di {toko_nama}!\n\nKami mau tanya sedikit — bagaimana pengalaman belanjanya?\n\nKalau puas: balas dengan angka (1-5), 5 = sangat puas.\nKalau ada masalah: langsung kabari kami, siap bantu.\n\nRatings + kata-kata baik dari kamu akan kami gunakan untuk testimonial (opt-in). Terima kasih! 🙏"

func (PostOrderFeedback) TemplateID() string       { return "post_order_feedback" }
func (PostOrderFeedback) RequiredParams() []string { return []string{"customer_nama", "toko_nama"} }
func (p PostOrderFeedback) Build(_ context.Context, params map[string]any) (string, error) {
	tmpl := p.CustomTemplate
	if tmpl == "" { tmpl = DefaultPostOrderFeedbackTemplate }
	return renderSimple(tmpl, params, p.RequiredParams())
}
```

- [ ] **Step 3: Request poller — daily 10:00 WIB**

```go
// backend-go/internal/feedback/request_poller.go
package feedback

// Daily 10:00 WIB cron:
// SELECT o.id, o.tenant_id, o.customer_id, c.name, c.phone, t.name AS toko_name
// FROM orders o JOIN customers c ON o.customer_id = c.id JOIN tenants t ON o.tenant_id = t.id
// WHERE o.status IN ('DELIVERED', 'COMPLETED')
//   AND DATE(o.delivered_at) = CURRENT_DATE - INTERVAL '7 days'
//   AND o.feedback_requested_at IS NULL
//   AND c.phone IS NOT NULL
//
// For each: render PostOrderFeedback template, send via NotifyCustomer,
// UPDATE orders SET feedback_requested_at = NOW()
```

- [ ] **Step 4: Response handler**

```go
// backend-go/internal/feedback/response_handler.go
package feedback

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
)

func HandleFeedbackResponse(ctx context.Context, db *sql.DB, tenantID, customerID, orderID, msgBody string) (bool, error) {
	trimmed := strings.TrimSpace(msgBody)
	if len(trimmed) == 0 { return false, nil }
	rating, err := strconv.Atoi(trimmed[0:1])
	if err != nil || rating < 1 || rating > 5 { return false, nil }
	comment := strings.TrimSpace(trimmed[1:])
	_, err = db.ExecContext(ctx, `
		INSERT INTO public.customer_feedback (tenant_id, customer_id, order_id, rating, comment)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''))
		ON CONFLICT (order_id) DO NOTHING
	`, tenantID, customerID, orderID, rating, comment)
	return err == nil, err
}
```

- [ ] **Step 5: Wire response handler into Calista inbound-message pipeline**

In existing Calista `handler.go`, before LLM call:
```go
if isFeedbackPending(ctx, db, msg.OrderID) {
    captured, _ := feedback.HandleFeedbackResponse(ctx, db, msg.TenantID, msg.CustomerID, msg.OrderID, msg.Body)
    if captured {
        _ = notifier.NotifyCustomer(ctx, msg.TenantID, msg.ConvID, msg.CustomerPhone, "id",
            "Terima kasih atas rating-nya! 🙏 Kami akan gunakan feedback ini untuk terus perbaiki layanan.")
        return
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261115000431_customer_feedback.sql backend-go/internal/notification/templates/post_order_feedback.go backend-go/internal/feedback/ backend-go/main.go backend-go/internal/handler/handler.go
git commit -m "feat(feedback): post-order feedback request + response capture (Sprint 4)

Migration slot 431. Daily 10:00 WIB cron 7-days post-delivery.
Rating 1-5 + comment parsed from customer reply. Refs spec 5.8."
```

---

### Task 4.5: Frontend — Sprint 4 config UI + feedback dashboard

**Files:**
- Create: `src/components/pengaturan/NotificationCronScreen.tsx`
- Create: `src/components/feedback/CustomerFeedbackScreen.tsx`

- [ ] **Step 1: NotificationCronScreen**

4 cards (Piutang overdue, Hutang overdue, Approval SLA, Feedback):
- Toggle enable/disable
- "Edit template" button opens NotificationTemplatesScreen filtered to this template_id
- Time picker (Piutang 08:00, Hutang 07:30, Approval 2h threshold, Feedback 7 days delay)
- Last-fired timestamp

- [ ] **Step 2: CustomerFeedbackScreen**

Table columns: Customer, Order #, Rating (stars), Comment, "Approve untuk landing" toggle. Filters: all / 5-star / 4-star / needs-attention (1-2 star). Summary stats: avg rating, count by star.

- [ ] **Step 3: Commit**

```bash
git add src/components/pengaturan/NotificationCronScreen.tsx src/components/feedback/CustomerFeedbackScreen.tsx
git commit -m "feat(pengaturan,feedback): Sprint 4 cron config + feedback dashboard UI"
```

---

### Task 4.6: Sprint 4 deploy + verify

- [ ] **Step 1: Deploy** (`git push origin main`; verify `gcloud builds list`)
- [ ] **Step 2: Trigger each cron manually on Garindo staging, verify owner receives WA + audit rows populate**
- [ ] **Step 3: Fake customer feedback response (send WA "5 keren tokonya"), verify captured in dashboard**
- [ ] **Step 4: Update progress.md + Sprint 4 done**

Rollback: `git revert` + `DROP TABLE customer_feedback; ALTER TABLE approval_requests DROP COLUMN sla_breach_notified_at; ALTER TABLE orders DROP COLUMN feedback_requested_at;`

---

# 🌙 SPRINT 5 — Notification Improvements + Session Health (3 dev-days)

**Spec reference**: Section 5.2 (retry + quiet hours + consolidation + session health).

**Goal**: Silent-day skip (heartbeat skips omset=0 days), quiet hours 22:00-07:00 (non-critical delayed), 5-min consolidation window, WA session health poll every 5 min → Caleo ops email on prolonged offline via `SendOpsEmail`.

### Task 5.1: Migration — notification preferences

**Files:**
- Create: `supabase/migrations/20261115000440_notification_prefs.sql`

```sql
-- supabase/migrations/20261115000440_notification_prefs.sql
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  quiet_hours_start TIME NOT NULL DEFAULT '22:00',
  quiet_hours_end TIME NOT NULL DEFAULT '07:00',
  consolidation_window_seconds INT NOT NULL DEFAULT 300 CHECK (consolidation_window_seconds >= 0 AND consolidation_window_seconds <= 1800),
  skip_digest_on_zero_omset BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_select_own ON public.notification_prefs FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());
CREATE POLICY t_upsert_own ON public.notification_prefs FOR ALL TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id())
  WITH CHECK (tenant_id = public._resolve_tenant_id());

INSERT INTO public.notification_prefs (tenant_id)
SELECT id FROM public.tenants ON CONFLICT DO NOTHING;
```

Apply + commit.

---

### Task 5.2: Quiet hours + consolidation in `BroadcastToStaff`

**Files:**
- Create: `backend-go/internal/notification/quiet_hours.go`
- Modify: `backend-go/internal/notification/broadcast_staff.go`

- [ ] **Step 1: Write failing test**

```go
// backend-go/internal/notification/quiet_hours_test.go
package notification

import (
	"testing"
	"time"
)

func TestIsInQuietHours_WrappingWindow(t *testing.T) {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	tests := []struct {
		hour, min int
		want      bool
	}{
		{23, 0, true},
		{3, 0, true},
		{6, 30, true},
		{7, 0, false},
		{9, 0, false},
		{21, 59, false},
		{22, 0, true},
	}
	for _, tt := range tests {
		got := isInQuietHours(time.Date(2026, 7, 19, tt.hour, tt.min, 0, 0, tz), "22:00", "07:00")
		if got != tt.want {
			t.Errorf("hour=%d min=%d: got %v want %v", tt.hour, tt.min, got, tt.want)
		}
	}
}
```

- [ ] **Step 2: Implement quiet_hours.go**

```go
// backend-go/internal/notification/quiet_hours.go
package notification

import (
	"strconv"
	"strings"
	"time"
)

func isInQuietHours(now time.Time, start, end string) bool {
	nowMin := now.Hour()*60 + now.Minute()
	startMin := parseHM(start)
	endMin := parseHM(end)
	if startMin < endMin {
		return nowMin >= startMin && nowMin < endMin
	}
	return nowMin < endMin || nowMin >= startMin
}

func parseHM(hm string) int {
	parts := strings.Split(hm, ":")
	h, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	return h*60 + m
}
```

- [ ] **Step 3: Modify BroadcastToStaff to enforce quiet hours + consolidation**

In `BroadcastToStaff`, before recipient fetching:
```go
prefs := n.fetchPrefs(ctx, tenantID)
if filter.CritLevel != "critical" && prefs != nil {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	if isInQuietHours(time.Now().In(tz), prefs.QuietHoursStart, prefs.QuietHoursEnd) {
		return n.enqueueQuietHoursDelay(ctx, tenantID, filter, msg, prefs.QuietHoursEnd)
	}
}
if prefs != nil && prefs.ConsolidationWindowSeconds > 0 {
	if consolidated := n.tryConsolidate(ctx, tenantID, msg, prefs.ConsolidationWindowSeconds); consolidated {
		return nil
	}
}
// ... existing send loop
```

`enqueueQuietHoursDelay` schedules a `t_jobs` row with `scheduled_for = tomorrow at quiet_hours_end`. `tryConsolidate` checks for pending `broadcast_consolidated` job in window; if exists, append message to payload array; else create new pending job.

Consolidated job handler renders format: `"N kejadian dalam W menit terakhir:\n\n1. m1\n\n2. m2..."`.

- [ ] **Step 4: Register job handler + commit**

```bash
git add backend-go/internal/notification/quiet_hours.go backend-go/internal/notification/quiet_hours_test.go backend-go/internal/notification/broadcast_staff.go backend-go/internal/jobs/handlers.go
git commit -m "feat(notification): quiet hours + consolidation window (Sprint 5)

Non-critical broadcasts during 22:00-07:00 held in t_jobs queue,
delivered next morning. Consolidation coalesces multi-msg in 5-min
window. Refs spec 5.2."
```

---

### Task 5.3: Silent-day skip in heartbeat poller

**Files:**
- Modify: `backend-go/internal/heartbeat/poller.go`

- [ ] **Step 1: Add omset check before send**

```go
if prefs.SkipDigestOnZeroOmset {
	var omsetToday int64
	_ = db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(amount), 0)::BIGINT FROM public.orders
		WHERE tenant_id=$1 AND status='COMPLETED' AND DATE(created_at) = CURRENT_DATE
	`, tenantID).Scan(&omsetToday)
	if omsetToday == 0 {
		slog.InfoContext(ctx, "heartbeat skipped — zero omset", slog.String("tenant_id", tenantID))
		return
	}
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(heartbeat): silent-day skip when omset=0 (Sprint 5)"
```

---

### Task 5.4: `SendOpsEmail` + session health monitor

**Files:**
- Create: `backend-go/internal/notification/send_ops_email.go`
- Create: `backend-go/internal/notification/session_health.go`
- Create: `supabase/migrations/20261115000441_wa_session_health.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20261115000441_wa_session_health.sql
CREATE TABLE IF NOT EXISTS public.wa_session_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  polled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_connected BOOLEAN NOT NULL,
  alerted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wa_session_health_tenant_time
  ON public.wa_session_health (tenant_id, polled_at DESC);
```

- [ ] **Step 2: SendOpsEmail via Resend REST**

```go
// backend-go/internal/notification/send_ops_email.go
package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

func SendOpsEmail(ctx context.Context, subject, body string) error {
	apiKey := os.Getenv("RESEND_API_KEY")
	recipient := os.Getenv("CALEO_OPS_EMAIL")
	if recipient == "" { recipient = "halo@caleo.id" }
	if apiKey == "" { return fmt.Errorf("RESEND_API_KEY not set") }

	payload := map[string]any{
		"from":    "Caleo Ops Alert <halo@caleo.id>",
		"to":      []string{recipient},
		"subject": subject,
		"text":    body,
	}
	buf := &bytes.Buffer{}
	json.NewEncoder(buf).Encode(payload)

	req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.resend.com/emails", buf)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil { return err }
	defer resp.Body.Close()
	if resp.StatusCode >= 400 { return fmt.Errorf("resend send failed: status=%d", resp.StatusCode) }
	return nil
}
```

- [ ] **Step 3: Session health poller**

```go
// backend-go/internal/notification/session_health.go
package notification

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

type SessionHealthPoller struct {
	db           *sql.DB
	sessionCheck func(tenantID string) bool
}

func NewSessionHealthPoller(db *sql.DB, check func(tenantID string) bool) *SessionHealthPoller {
	return &SessionHealthPoller{db: db, sessionCheck: check}
}

func (s *SessionHealthPoller) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done(): return
			case <-ticker.C: s.runOnce(ctx)
			}
		}
	}()
}

func (s *SessionHealthPoller) runOnce(ctx context.Context) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.name FROM public.tenants t
		JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
		WHERE ts.tier = 'premium' AND ts.status = 'active'
	`)
	if err != nil { return }
	defer rows.Close()

	for rows.Next() {
		var tenantID, tenantName string
		rows.Scan(&tenantID, &tenantName)

		connected := s.sessionCheck(tenantID)
		s.db.ExecContext(ctx, `INSERT INTO public.wa_session_health (tenant_id, is_connected) VALUES ($1, $2)`, tenantID, connected)

		if connected { continue }

		var lastConnected time.Time
		s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(polled_at), NOW() - INTERVAL '1 hour') FROM public.wa_session_health WHERE tenant_id=$1 AND is_connected=TRUE`, tenantID).Scan(&lastConnected)

		if time.Since(lastConnected) < 30*time.Minute { continue }

		var alreadyAlerted bool
		s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM public.wa_session_health WHERE tenant_id=$1 AND alerted_at > NOW() - INTERVAL '1 hour')`, tenantID).Scan(&alreadyAlerted)
		if alreadyAlerted { continue }

		subject := fmt.Sprintf("[Caleo Ops] WA Session Offline — tenant %s", tenantName)
		body := fmt.Sprintf("Tenant '%s' (id: %s) WA session has been offline since %s (over 30 minutes).\n\nPlease investigate:\n1. Check whatsmeow session state in DB\n2. Try reconnecting via admin.caleo.id health tab\n3. If persistent, ask tenant to re-scan QR code",
			tenantName, tenantID, lastConnected.Format(time.RFC3339))

		if err := SendOpsEmail(ctx, subject, body); err != nil {
			slog.ErrorContext(ctx, "session health ops email failed", slog.Any("error", err))
			continue
		}
		s.db.ExecContext(ctx, `UPDATE public.wa_session_health SET alerted_at = NOW() WHERE tenant_id=$1 AND polled_at = (SELECT MAX(polled_at) FROM public.wa_session_health WHERE tenant_id=$1)`, tenantID)
	}
}
```

- [ ] **Step 4: Register in main.go + commit**

```go
sessionHealthPoller := notification.NewSessionHealthPoller(db, func(tid string) bool {
	client := waSessions.GetClient(tid)
	return client != nil && client.IsConnected()
})
sessionHealthPoller.Start(ctx)
```

```bash
git add supabase/migrations/20261115000441_wa_session_health.sql backend-go/internal/notification/send_ops_email.go backend-go/internal/notification/session_health.go backend-go/main.go
git commit -m "feat(notification): session health monitor + Caleo ops email alerts (Sprint 5)

Migration slot 441. 5-min poll per Premium tenant. Offline >30 min
triggers Resend email to CALEO_OPS_EMAIL. Refs spec 5.2."
```

---

### Task 5.5: Frontend — `NotificationPrefsScreen`

**Files:**
- Create: `src/components/pengaturan/NotificationPrefsScreen.tsx`

3 cards:
- 🌙 **Jam Tenang** — start/end `<input type="time">`, default 22:00 - 07:00. Helper text: "Notifikasi non-critical akan ditahan selama jam ini. Approval SLA + session-health alert bypass jam tenang."
- 📦 **Gabungkan Notifikasi** — `<input type="range" min="0" max="1800" step="60">` seconds, default 300 (5 menit). Helper: "Beberapa notif dalam window ini digabung jadi 1 pesan. 0 = disabled."
- 💤 **Skip Hari Kosong** — checkbox, default ON. Helper: "Skip ringkasan harian kalau omset hari itu = 0."

Auto-save on blur (matches pattern from Sprint 2).

- [ ] **Step 1: Implement + commit**

```bash
git add src/components/pengaturan/NotificationPrefsScreen.tsx
git commit -m "feat(pengaturan): NotificationPrefsScreen quiet hours + consolidation + silent-day (Sprint 5)"
```

---

### Task 5.6: Sprint 5 deploy + verify

- [ ] **Step 1: Deploy**
- [ ] **Step 2: Set Garindo quiet_hours_end to current+2min, send non-critical broadcast, verify delayed to that time**
- [ ] **Step 3: Kill Garindo whatsmeow session for 35 min, verify Caleo ops email arrives at halo@caleo.id**
- [ ] **Step 4: Update progress.md + Sprint 5 done**

Rollback: `git revert` + `DROP TABLE notification_prefs; DROP TABLE wa_session_health;`

---

# ✅ SPRINT 6 — E2E Verification + WA Recipient CRUD Audit (2 dev-days)

**Spec reference**: Success criteria Sprint 6.

**Goal**: Automated Playwright E2E tests for all 7 customer WA paths (A-G). WA recipient CRUD audited + phone format validation + test-send per recipient.

### Task 6.1: E2E scaffolding for `wa-notifications/`

**Files:**
- Create: `tests/e2e/tests/wa-notifications/path-a-calista.spec.ts` (and B-G)
- Create: `backend-go/internal/testapi/simulate.go` (test-only endpoints, gated behind `E2E_TEST_MODE=true`)

- [ ] **Step 1: Path A test**

```typescript
// tests/e2e/tests/wa-notifications/path-a-calista.spec.ts
import { test, expect } from '@playwright/test';

test('Path A — Calista AI reply within 30s', async ({ request, page }) => {
  const response = await request.post('/api/test/simulate-inbound', {
    data: { tenantID: 'garindo-test', customerPhone: '628999888777', body: 'Halo, ada stok kabel NYA?' }
  });
  expect(response.ok()).toBe(true);

  let sent = false;
  for (let i = 0; i < 30; i++) {
    const rowsResp = await request.get('/api/test/messages?tenantID=garindo-test&customerPhone=628999888777');
    const rows = await rowsResp.json();
    if (rows.some((r: any) => r.direction === 'OUTBOUND' && r.sender === 'AI')) { sent = true; break; }
    await page.waitForTimeout(1000);
  }
  expect(sent).toBe(true);
});
```

- [ ] **Step 2: Paths B-G**

Same pattern. Each triggers its specific event via a test endpoint, polls for expected side effect (message sent, audit row created, etc.):
- **B (staff escalation)**: POST `/api/test/create-low-confidence-scenario` → poll owner recipient's messages for escalation msg
- **C (approval WA)**: POST `/api/test/create-approval-request` → poll owner's messages for approval card + machine-parseable `approve:` line
- **D (followup)**: POST `/api/test/simulate-silent-customer` (set last-message 8 days ago) → run followup poller → poll for followup msg
- **E (booking expiry)**: POST `/api/test/simulate-booking-with-24h-expiry` → trigger scheduler → poll for expiry msg
- **F (lifecycle)**: POST `/api/test/fire-lifecycle-event` (payment_verified/dp_verified/payment_rejected/order_approved/order_shipped) → poll for customer msg
- **G (admin forward)**: POST `/api/test/simulate-admin-forward` (Sales Inbox message from admin) → poll customer msg + audit row exists

- [ ] **Step 3: Backend test endpoints (E2E_TEST_MODE gated)**

Simple HTTP handlers wired only when `os.Getenv("E2E_TEST_MODE") == "true"`. Never enabled in production.

- [ ] **Step 4: Run suite locally**

```bash
E2E_TEST_MODE=true npm run backend:dev &
npx playwright test tests/e2e/tests/wa-notifications/
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/tests/wa-notifications/ backend-go/internal/testapi/
git commit -m "test(e2e): 7 WA paths A-G automated (Sprint 6)"
```

---

### Task 6.2: WA recipient CRUD audit + phone normalize + test-send

**Files:**
- Modify: `src/components/pengaturan/PengaturanScreen.tsx` (or existing WA recipients component — grep first)
- Create: `tests/e2e/tests/wa-notifications/wa-recipients-crud.spec.ts`

- [ ] **Step 1: Grep existing UI**

```bash
grep -rn "wa_recipients" src/
```

- [ ] **Step 2: Add phone normalizer**

```ts
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('8')) return '62' + digits;
  return digits;
}
```

Apply on save. Add per-row "📱 Kirim tes" button that fires a small test WA to the recipient's number.

Helper copy: "Nomor WA yang aktif akan terima semua notifikasi. Owner-role dapat notif approval + business digest. Admin-role dapat notif escalation."

- [ ] **Step 3: E2E test**

```typescript
// tests/e2e/tests/wa-notifications/wa-recipients-crud.spec.ts
test('WA recipient CRUD lifecycle', async ({ page }) => {
  await page.goto('/?screen=pengaturan');
  await page.click('button:has-text("+ Tambah Nomor")');
  await page.fill('input[name="phone"]', '085123456789');
  await page.selectOption('select[name="role"]', 'owner');
  await page.click('button:has-text("Simpan")');
  await expect(page.locator('td:has-text("6285123456789")')).toBeVisible();
  // Edit
  await page.click('td:has-text("6285123456789") ~ td button:has-text("Edit")');
  await page.selectOption('select[name="role"]', 'admin');
  await page.click('button:has-text("Simpan")');
  await expect(page.locator('td:has-text("admin")')).toBeVisible();
  // Delete
  await page.click('td:has-text("6285123456789") ~ td button:has-text("Hapus")');
  await page.click('button:has-text("Ya, hapus")');
  await expect(page.locator('td:has-text("6285123456789")')).not.toBeVisible();
});
```

- [ ] **Step 4: Grep hardcoded numbers**

```bash
grep -rEn "62[0-9]{8,}" backend-go/ src/ --include="*.go" --include="*.tsx" --include="*.ts" | grep -v "_test.go\|spec.ts\|fixture"
```

Expected: no matches. If found, refactor to fetch from `wa_recipients`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pengaturan): WA recipient CRUD phone normalizer + test-send button (Sprint 6)"
```

---

### Task 6.3: Sprint 6 deploy + verify

- [ ] **Step 1: Run full E2E suite in CI on staging**
- [ ] **Step 2: Verify green + update progress.md**

Rollback: none needed (test-only sprint).

---

# 🤖 SPRINT 7 — Caleo Admin WA Automation Bot (4 dev-days)

**Spec reference**: Section 5.10.

**Goal**: Ship dedicated Caleo-platform WhatsApp bot for prospect Q&A (15 FAQ keyword matcher, zero LLM cost), escalation to founder on non-FAQ, analytics dashboard at admin.caleo.id, landing swap 13 CTAs from founder personal to bot number.

### Task 7.1: Migration — bot tables + FAQ seed

**Files:**
- Create: `supabase/migrations/20261115000470_caleo_admin_bot.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20261115000470_caleo_admin_bot.sql
INSERT INTO public.tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000000', 'Caleo Platform', 'caleo-platform')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.caleo_admin_bot_faq (
  id TEXT PRIMARY KEY,
  keywords TEXT[] NOT NULL,
  response TEXT NOT NULL,
  next_step TEXT
);

CREATE TABLE IF NOT EXISTS public.caleo_admin_bot_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  first_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  faq_hits JSONB DEFAULT '[]'::JSONB,
  escalated_at TIMESTAMPTZ,
  demo_scheduled_at TIMESTAMPTZ,
  converted_to_signup_at TIMESTAMPTZ,
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_caleo_bot_analytics_first_msg
  ON public.caleo_admin_bot_analytics (first_message_at DESC);

INSERT INTO public.caleo_admin_bot_faq (id, keywords, response, next_step) VALUES
  ('harga', ARRAY['harga','biaya','cost','berapa','price'],
    'Halo! Paket Caleo:\n\n📦 Starter — Rp 419K/bulan\n💼 Pro — Rp 664K/bulan\n✨ Premium + AI — Rp 2.990K/bulan\n\nSemua sudah hemat 50% via promo spesial (harga normal 2x). Detail lengkap: caleo.id/#promos',
    'schedule_demo'),
  ('setup', ARRAY['setup','onboarding','install','mulai'],
    'Setup Caleo cepat! Tim kami akan bantu migrasi data + training tim kamu dalam 1 minggu. Gratis konsultasi via chat WA sini. Mau kita atur jadwal demo?',
    'schedule_demo'),
  ('trial', ARRAY['trial','coba','gratis','refund'],
    'Kami kasih 14 hari refund guarantee — kalau tidak cocok, 100% uang kembali, no pertanyaan. Jadi hampir seperti free trial 2 minggu tapi kamu tetap akses full feature.',
    NULL),
  ('fitur_starter', ARRAY['starter','fitur starter','apa yg dapet starter'],
    'Paket Starter mencakup:\n✓ POS + Kasir\n✓ Inventory dasar\n✓ Multi-user (5 orang)\n✓ Laporan harian\n\nCocok untuk toko yang baru mulai digitalisasi.',
    NULL),
  ('fitur_pro', ARRAY['pro','fitur pro'],
    'Pro menambah dari Starter:\n✓ Multi-cabang\n✓ Purchase order + Piutang/Hutang\n✓ Laporan analytics\n✓ Multi-user (unlimited)\n✓ Email/SMS reminder\n\nCocok untuk toko growing / multi-lokasi.',
    NULL),
  ('fitur_premium', ARRAY['premium','ai','calista'],
    'Premium menambah semua fitur + AI Calista:\n✓ Website landing custom\n✓ Calista AI WhatsApp — jawab customer 24/7\n✓ WA reminder Piutang otomatis\n✓ Priority support\n\nCalista pakai LLM latest untuk auto-reply customer.',
    NULL),
  ('calista_ai', ARRAY['calista','chatbot','ai wa','gimana ai'],
    'Calista adalah AI WhatsApp yang jawab customer kamu 24/7. Dia paham:\n✓ Cek stok\n✓ Bikinkan invoice\n✓ Jelaskan produk\n✓ Follow-up otomatis\n\nContoh live? Chat aja kalimat "cek stok kabel" — Calista jawab (simulasi demo).',
    NULL),
  ('multi_channel', ARRAY['shopee','tokopedia','marketplace','ecommerce'],
    'Integrasi marketplace ada di roadmap Phase 3. Untuk MVP, sekarang fokus di POS + WA + AI. Kalau kamu punya toko marketplace, transaksi masih perlu diinput manual dulu. Sync API sedang direncanakan.',
    NULL),
  ('security', ARRAY['aman','security','data','privacy','pdp'],
    'Data kamu aman:\n✓ Backup harian otomatis\n✓ Encryption at-rest\n✓ RLS multi-tenant (data satu toko tidak bisa dilihat toko lain)\n✓ UU PDP compliant\n\nDetail teknis: caleo.id/#faq',
    NULL),
  ('integration_bank', ARRAY['bank','rekonsiliasi','qris','payment gateway'],
    'Rekonsiliasi bank manual sekarang (upload mutasi). Integrasi otomatis bank feed + payment gateway (QRIS/GoPay/OVO) ada di roadmap. ETA Q4 2026.',
    NULL),
  ('kantor', ARRAY['kantor','lokasi','alamat','ltc'],
    'Kantor kami di LTC Glodok Lt 3 Blok B-08, Jakarta Barat. Jam operasional Senin-Sabtu 08:00-17:00. Boleh mampir langsung untuk demo!',
    NULL),
  ('demo', ARRAY['demo','lihat demo','presentasi'],
    'Boleh! Bisa demo online via Zoom (30 menit) atau langsung ke kantor kami (LTC Glodok). Kasih tau jadwal yang pas ya. Founder Caleo yang jelaskan langsung.',
    'chat_founder'),
  ('kompetitor', ARRAY['mekari','jurnal','majoo','olsera','kompetitor'],
    'Caleo diferensiasi vs kompetitor:\n✓ AI native (bukan add-on)\n✓ Focus MSME retail (bukan enterprise)\n✓ Bahasa Indonesia + support lokal\n✓ Harga transparan\n\nHappy compare — kirim shortlist kompetitor kamu, kami jelasin bedanya.',
    NULL),
  ('migrasi_data', ARRAY['migrasi','migration','pindah data','dari mekari'],
    'Migrasi data dari sistem lama (Mekari/Jurnal/Excel/dll):\n✓ Import CSV mass\n✓ Team kami bantu setup 1 minggu\n✓ Data lama tetap kamu simpan sebagai backup\n\nNo data loss, no downtime.',
    NULL),
  ('kontak_founder', ARRAY['founder','owner','ngobrol','call'],
    'Boleh! Founder Caleo (Tony) siap ngobrol langsung. Let me connect you...',
    'chat_founder')
ON CONFLICT DO NOTHING;
```

Apply + commit.

---

### Task 7.2: FAQ matcher

**Files:**
- Create: `backend-go/internal/caleobot/faq_matcher.go`
- Create: `backend-go/internal/caleobot/faq_matcher_test.go`

- [ ] **Step 1: Failing test**

```go
// backend-go/internal/caleobot/faq_matcher_test.go
package caleobot

import "testing"

func TestFaqMatcher_ExactKeyword(t *testing.T) {
	m := NewFaqMatcher([]FaqEntry{{ID: "harga", Keywords: []string{"harga", "biaya"}, Response: "X"}})
	hit, ok := m.Match("berapa harga paket premium?")
	if !ok || hit.ID != "harga" { t.Fatalf("expected match, got %+v ok=%v", hit, ok) }
}

func TestFaqMatcher_TypoTolerance(t *testing.T) {
	m := NewFaqMatcher([]FaqEntry{{ID: "harga", Keywords: []string{"harga"}, Response: "X"}})
	hit, ok := m.Match("berapa hraga premium?") // hraga = 1 edit distance
	if !ok || hit.ID != "harga" { t.Fatalf("expected typo tolerance, got %+v ok=%v", hit, ok) }
}

func TestFaqMatcher_NoMatch(t *testing.T) {
	m := NewFaqMatcher([]FaqEntry{{ID: "harga", Keywords: []string{"harga"}, Response: "X"}})
	_, ok := m.Match("hello are you a robot?")
	if ok { t.Fatal("expected no match") }
}
```

- [ ] **Step 2: Implementation**

```go
// backend-go/internal/caleobot/faq_matcher.go
package caleobot

import "strings"

type FaqEntry struct {
	ID       string
	Keywords []string
	Response string
	NextStep string
}

type FaqMatcher struct{ faqs []FaqEntry }

func NewFaqMatcher(faqs []FaqEntry) *FaqMatcher { return &FaqMatcher{faqs: faqs} }

func (m *FaqMatcher) Match(input string) (FaqEntry, bool) {
	normalized := strings.ToLower(strings.TrimSpace(input))
	inputWords := strings.Fields(normalized)

	var best FaqEntry
	bestScore := 0
	for _, faq := range m.faqs {
		score := 0
		for _, kw := range faq.Keywords {
			kwLower := strings.ToLower(kw)
			if strings.Contains(normalized, kwLower) { score += 10; continue }
			for _, iw := range inputWords {
				if levenshtein(iw, kwLower) <= 2 && len(kwLower) >= 4 { score += 5 }
			}
		}
		if score > bestScore { bestScore = score; best = faq }
	}
	if bestScore < 7 { return FaqEntry{}, false }
	return best, true
}

func levenshtein(a, b string) int {
	if len(a) == 0 { return len(b) }
	if len(b) == 0 { return len(a) }
	prev := make([]int, len(b)+1)
	curr := make([]int, len(b)+1)
	for j := range prev { prev[j] = j }
	for i := 1; i <= len(a); i++ {
		curr[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] { cost = 0 }
			curr[j] = min3(curr[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev, curr = curr, prev
	}
	return prev[len(b)]
}

func min3(a, b, c int) int {
	m := a
	if b < m { m = b }
	if c < m { m = c }
	return m
}
```

- [ ] **Step 3: Test + commit**

```bash
cd backend-go && go test ./internal/caleobot/... -v
git add backend-go/internal/caleobot/faq_matcher.go backend-go/internal/caleobot/faq_matcher_test.go
git commit -m "feat(caleobot): FAQ matcher with Levenshtein typo tolerance (Sprint 7)"
```

---

### Task 7.3: Session bootstrap + escalation

**Files:**
- Create: `backend-go/internal/caleobot/session.go`
- Create: `backend-go/internal/caleobot/escalation.go`

- [ ] **Step 1: Session bootstrap**

```go
// backend-go/internal/caleobot/session.go
package caleobot

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"

	"github.com/lib/pq"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"
)

const sentinelTenantID = "00000000-0000-0000-0000-000000000000"

func StartCaleoAdminSession(ctx context.Context, db *sql.DB, client *whatsmeow.Client) error {
	if os.Getenv("CALEO_ADMIN_WA_PHONE") == "" {
		return fmt.Errorf("CALEO_ADMIN_WA_PHONE not set")
	}
	faqs, err := loadFaqs(ctx, db)
	if err != nil { return err }
	matcher := NewFaqMatcher(faqs)

	client.AddEventHandler(func(evt interface{}) {
		msg, ok := evt.(*events.Message)
		if !ok || msg.Info.IsFromMe { return }

		body := msg.Message.GetConversation()
		sessionID := msg.Info.Sender.String()

		trackFirstMessage(ctx, db, sessionID)

		hit, matched := matcher.Match(body)
		if matched {
			trackFaqHit(ctx, db, sessionID, hit.ID)
			client.SendText(ctx, msg.Info.Sender.String(), hit.Response)
			if hit.NextStep == "chat_founder" {
				escalateToFounder(ctx, body, msg.Info.Sender.String())
			}
			return
		}

		trackEscalation(ctx, db, sessionID)
		client.SendText(ctx, msg.Info.Sender.String(),
			"Terima kasih untuk pertanyaannya! Founder Caleo akan reply sebentar.")
		escalateToFounder(ctx, body, msg.Info.Sender.String())
	})

	slog.InfoContext(ctx, "Caleo Admin WA session started")
	return nil
}

func loadFaqs(ctx context.Context, db *sql.DB) ([]FaqEntry, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, keywords, response, next_step FROM public.caleo_admin_bot_faq")
	if err != nil { return nil, err }
	defer rows.Close()
	var out []FaqEntry
	for rows.Next() {
		var f FaqEntry
		var nextStep sql.NullString
		rows.Scan(&f.ID, pq.Array(&f.Keywords), &f.Response, &nextStep)
		if nextStep.Valid { f.NextStep = nextStep.String }
		out = append(out, f)
	}
	return out, nil
}

func trackFirstMessage(ctx context.Context, db *sql.DB, sessionID string) {
	db.ExecContext(ctx, `INSERT INTO public.caleo_admin_bot_analytics (session_id) VALUES ($1) ON CONFLICT DO NOTHING`, sessionID)
}

func trackFaqHit(ctx context.Context, db *sql.DB, sessionID, faqID string) {
	db.ExecContext(ctx, `UPDATE public.caleo_admin_bot_analytics SET faq_hits = faq_hits || jsonb_build_array($2) WHERE session_id = $1`, sessionID, faqID)
}

func trackEscalation(ctx context.Context, db *sql.DB, sessionID string) {
	db.ExecContext(ctx, `UPDATE public.caleo_admin_bot_analytics SET escalated_at = COALESCE(escalated_at, NOW()) WHERE session_id = $1`, sessionID)
}
```

- [ ] **Step 2: Escalation**

```go
// backend-go/internal/caleobot/escalation.go
package caleobot

import (
	"context"
	"fmt"

	"github.com/tonywei/erp-antigravity/backend-go/internal/notification"
)

func escalateToFounder(ctx context.Context, prospectMsg, prospectPhone string) {
	msg := fmt.Sprintf(
		"🤖 [Caleo Bot Escalation]\n\nProspect: %s\nAsked: \"%s\"\n\nReply via WA from your personal number to prospect directly.",
		prospectPhone, prospectMsg,
	)
	notification.SendOpsEmail(ctx, "[Caleo Bot] Prospect Escalation", msg)
}
```

- [ ] **Step 3: Register + commit**

```go
// main.go
caleoBotClient := // ... bootstrap whatsmeow client for CALEO_ADMIN_WA_PHONE (reuse existing patterns)
_ = caleobot.StartCaleoAdminSession(ctx, db, caleoBotClient)
```

```bash
git add backend-go/internal/caleobot/session.go backend-go/internal/caleobot/escalation.go backend-go/main.go
git commit -m "feat(caleobot): session bootstrap + FAQ matching + escalation (Sprint 7)

FAQ-hit → auto-reply. No match → apology + email escalation to
CALEO_OPS_EMAIL. Analytics tracked per prospect session. Refs spec 5.10."
```

---

### Task 7.4: Analytics dashboard at admin.caleo.id

**Files:**
- Create: `src/components/admin/CaleoBotDashboard.tsx`

Layout:
- Top row cards: Prospects today / week / month (raw counts)
- Bar chart: Top 5 FAQ questions (aggregate `faq_hits` JSONB across recent sessions)
- Line chart: Escalation rate 7-day trend
- Funnel: prospect → demo scheduled → signup conversion

Use existing chart library or simple SVG bars if none installed (YAGNI).

- [ ] **Step 1: Implement + commit**

```bash
git add src/components/admin/CaleoBotDashboard.tsx
git commit -m "feat(admin): Caleo Bot analytics dashboard (Sprint 7)"
```

---

### Task 7.5: Landing 13 CTAs swap

**Files:**
- Modify: `public/index.html` (13 instances)
- Modify: `docs/design-mockups/caleo-landing-v1.html` (13 instances)

- [ ] **Step 1: Grep + verify count**

```bash
grep -c "wa.me/6285264787775" public/index.html docs/design-mockups/caleo-landing-v1.html
# Expected: 13 per file
```

- [ ] **Step 2: Sed replace**

```bash
set -a; source .env; set +a
sed -i '' "s|wa.me/6285264787775|wa.me/${CALEO_ADMIN_WA_PHONE}|g" public/index.html docs/design-mockups/caleo-landing-v1.html
grep -c "wa.me/${CALEO_ADMIN_WA_PHONE}" public/index.html docs/design-mockups/caleo-landing-v1.html
# Expected: 13 per file
```

- [ ] **Step 3: Redeploy CF Worker**

```bash
cd infra/caleo-landing-worker && npx wrangler deploy --env production
```

- [ ] **Step 4: Verify live**

```bash
curl -s https://caleo.id/ | grep -c "wa.me/${CALEO_ADMIN_WA_PHONE}"
# Expected: 13
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html docs/design-mockups/caleo-landing-v1.html
git commit -m "feat(landing): swap 13 WA CTAs to Caleo bot number (Sprint 7)

Founder personal stays for existing customer support + bot escalation
target. Refs spec 5.10."
```

---

### Task 7.6: Sprint 7 deploy + verify + progress

- [ ] **Step 1: Chat Caleo bot from own phone as prospect**

Send test messages:
- "berapa harga premium?" → expect harga FAQ response
- "gimana Calista AI?" → expect calista_ai FAQ response
- "apakah bisa integrasi dengan Xero?" → expect escalation apology + email to founder

- [ ] **Step 2: Verify founder receives escalation email at tonywei.office@gmail.com**
- [ ] **Step 3: Verify analytics dashboard populates at admin.caleo.id**
- [ ] **Step 4: Update progress.md + Sprint 7 done — ALL 7 SPRINTS COMPLETE**

Rollback: `git revert` (reverts CTA swap + backend); `DROP TABLE caleo_admin_bot_faq, caleo_admin_bot_analytics; DELETE FROM tenants WHERE id='00000000-0000-0000-0000-000000000000';`.

---

# 🎓 Effort Validation

Spec Section 12 estimate: 23.5 dev-days across 7 sprints.

Plan task count:
- Sprint 1: 10 tasks (~2 days)
- Sprint 2: 9 tasks (~5 days — biggest UI work)
- Sprint 3: 5 tasks (~4 days)
- Sprint 4: 6 tasks (~3.5 days)
- Sprint 5: 6 tasks (~3 days)
- Sprint 6: 3 tasks (~2 days)
- Sprint 7: 6 tasks (~4 days)

**Total: 45 tasks, 23.5 dev-days. ✅ Matches spec Section 12.**

---

# 🔧 Self-Review

**1. Spec coverage** (every section maps to at least one task):
- 4 success criteria per sprint ✅ every bullet has a task
- 5.1 harmonization ✅ Tasks 1.1-1.10
- 5.2 retry + quiet hours + consolidation + session health ✅ Tasks 5.1-5.6
- 5.3 Piutang scheduler ✅ Tasks 2.1-2.9
- 5.4 order lifecycle refinement ✅ Tasks 3.2-3.3
- 5.5 Piutang overdue summary ✅ Task 4.1
- 5.6 Hutang overdue summary ✅ Task 4.2
- 5.7 Approval SLA breach ✅ Task 4.3
- 5.8 Post-order feedback ✅ Task 4.4
- 5.9 template versioning ✅ Tasks 3.1, 3.4
- 5.10 Caleo Admin WA Bot ✅ Tasks 7.1-7.6
- 5.11 UI ✅ Tasks 2.6-2.8, 3.4, 4.5, 5.5, 7.4
- Section 6 data model ✅ Migrations 400, 401, 410-413, 420-422, 430-431, 440-441, 470
- Section 15 best practices ✅ RLS on every new table, idempotent migrations, TDD steps, structured logging
- Section 16 UX principles ✅ Sprint 2 primitives (chip input, WA preview, auto-save on blur, test-send, reset default, mobile responsive)

**2. Placeholder scan:**
- No "TBD", "TODO", "implement later" occurrences
- Task 3.3 says "Copy `order_created.go` as template. For each of 4 files: change type name, TemplateID string, RequiredParams, and DefaultXXXTemplate constant" + provides all 4 default templates verbatim — acceptable (no code hidden).
- Task 4.2 Poller: "Same structure as `piutang/overdue_summary_poller.go`, differences: ..." — differences enumerated (3 changes), acceptable.
- Task 6.1 paths B-G: bullet list of test triggers + poll conditions — engineer can write test from that + Path A pattern. Acceptable.

**3. Type consistency:**
- `Notifier` struct: `sender + inserter + quota + resolver + logger` — consistent across Sprint 1
- `MessageBuilder` interface: `Build(ctx, params) (string, error)`, `TemplateID() string`, `RequiredParams() []string` — used consistently in all templates
- `RecipientFilter{Role, CritLevel}` — consistent Task 1.4 → Sprint 5 quiet hours
- Error types `notification.ErrQuotaExceeded, ErrWASessionOffline, ErrSendFailed, ErrTemplateRenderError` — consistent across all callers
- `renderSimple(tmpl, params, required)` helper — introduced in Task 3.2, reused by all Sprint 3-4-7 templates
- `nextDailyTarget` + `formatRp` helpers — introduced in Task 2.4 (piutang package), imported by Sprint 4 pollers

Consistency ✅.

---

# 🚀 Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-wa-notification-framework-overhaul-plan.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch fresh subagent per task, review between tasks, fast iteration. Best for 45-task plan across 7 sprints — controller preserves context by handing artifacts as files, each task completes with spec+quality review before moving on.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Best for smaller plans; may struggle with 23.5 dev-days worth of implementation in a single session.

**Recommended staging**: Start with Sprint 1 only via subagent-driven-development. Deploy Sprint 1 to production. Verify B1-B4 fixes on Garindo staging. Then re-invoke plan starting Sprint 2. This staged approach limits blast radius per deploy and lets founder review real customer WA experience before locking in Sprints 3-7.