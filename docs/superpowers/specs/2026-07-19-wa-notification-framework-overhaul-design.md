# WA Notification Framework Overhaul — Design Spec

**Date:** 2026-07-19
**Author:** Autonomous session with founder brainstorm
**Status:** For founder final review before writing-plans

**Scope**: 6 sprints, ~17 dev-days total. Ships incrementally (each sprint deploy-ready standalone).

---

## 1. Context

Landing page (`caleo.id`) promises multiple WA notification features:
- Piutang & AR module: "WA reminder otomatis — cashflow toko lancar tanpa harus telepon 1-1"
- Testimonial Ibu S: "Piutang turun ~40% dalam 2 bulan" attributed to WA reminder auto
- Multiple lifecycle events promised (order status, payment confirmations, booking expiry, etc.)

**Current state (per 2026-07-19 WA audit):** 8 outbound WA send paths exist, all calling shared `Sender.SendText` primitive but each duplicating error handling, audit trail, recipient resolution logic. Piutang WA reminder button in `PiutangScreen.tsx` is **DISABLED** (`title="Phase 1C — WA reminder otomatis"`). Landing testimonial impact claim currently un-backed by code.

**4 real bugs found during audit:**
- **B1**: Order approval WA card (`approval_sender.go`) is built + tested but **NOT WIRED** — call site missing. Approval cards may not actually send today.
- **B2**: Booking-expiry reminder (`main.go:495-511`) sends via `SendText` but skips `InsertMessage` — no audit trail
- **B3**: Admin forward (`main.go:617-632`) same audit-skip issue
- **B4**: Calista 300 chat/hari cap claim on landing/pricing.md is **not implemented** in code (only per-conversation follow-up 2/day quota exists)

**Fragmentation issues:**
- 5 isolated caller patterns for `SendText` (handler.go, followup/poller.go, heartbeat/poller.go, main.go × 2 inline closures)
- Every message template is inline `fmt.Sprintf` at call site (only `buildInvoiceMessage` extracted)
- `GetActiveRecipients()` called 4× without caching
- No retry with backoff, no shared quota enforcement
- Naming inconsistency (notification / message / reminder / notify)

**Founder decisions during brainstorm (2026-07-19):**
1. Full harmonize first + fix B1-B4 (Sprint 1)
2. Piutang WA reminder Premium-only, H-3 + H+3, editable template, per-customer opt-out, keep manual override with 1×/invoice/day constraint (Sprint 2)
3. Universal editable template rollout to all 7 non-Calista notification paths — no asymmetric UX where only Piutang can custom while others hardcoded (Sprint 3)
4. Add 2 new staff/owner notifications: Piutang overdue summary + Approval SLA breach (Sprint 4)
5. Improve existing notifications: silent-day (skip omset=0), quiet hours (22:00-07:00 for non-critical), consolidation window (5-min debounce for staff) (Sprint 5)
6. End-to-end verification of all Customer paths (A-G) + WA recipient CRUD audit (Sprint 6)

## 2. Goal

Ship a shared WA notification framework and comprehensive overhaul of all 8+ existing WA notification paths — harmonize, verify, fix bugs, add missing features, improve quality — so landing promises align with code, and future features (AI Manager, marketplace integrations) build on solid foundation.

## 3. Non-goals (explicit)

- **NOT for Starter/Pro tier WA reminders** — Piutang WA reminder is Premium-exclusive. No auto, no manual, no email fallback for non-Premium. Landing needs update to reflect Premium gating.
- **NOT for payment gateway integration** (QRIS/GoPay/OVO) — payment link in reminders = future Phase (per FAQ #9 roadmap).
- **NOT for multi-cadence Piutang** beyond H-3 + H+3 (no H0, no H+7, no H+30 configurable).
- **NOT for owner-editable H offsets** (rule dates fixed: -3 / +3; only message CONTENT editable).
- **NOT for per-invoice opt-out** on Piutang reminders — only per-customer or global tenant toggle.
- **NOT for big transaction fraud alert** (deferred, requires AI Manager work).
- **NOT for end-of-month closing reminder** (deferred, low priority).
- **NOT for outbound WA media send** (only text; media inbound already supported).

## 4. Success criteria (measurable per sprint)

**Sprint 1 (Harmonize + Fix bugs):**
- ✅ All 8 existing paths use `NotifyCustomer` or `BroadcastToStaff` wrappers (no direct `SendText` calls in application code)
- ✅ B1 fixed: approval WA cards actually reach owner recipients when approval request created
- ✅ B2, B3 fixed: `messages` audit table has entry for every WA send
- ✅ B4 fixed: `wa_daily_send_count` tracked per tenant, enforced at 300/day for Calista replies

**Sprint 2 (Piutang scheduler):**
- ✅ Premium tenant with active Calista session + open tempo invoice + eligible customer receives H-3 message on `due_date - 3 days` at 09:00 WIB, and H+3 message on `due_date + 3 days` at 09:00 WIB
- ✅ Owner edits H-3 / H+3 templates in Settings, sees live preview with sample data, sends test WA to own phone, auto-save on blur
- ✅ Owner toggles per-customer opt-out or tenant-wide toggle
- ✅ Every reminder logged in `piutang_reminder_sent` audit table

**Sprint 3 (Universal editable templates):**
- ✅ 7 additional templates editable via Settings UI (same UX pattern as Piutang): Follow-up (D), Booking-expiry (E), 5 lifecycle (F: payment_verified, dp_verified, payment_rejected, order_approved, order_shipped), Staff escalation (B), Approval card (C), Heartbeat digest (H)
- ✅ Each template has default value + reset button + live preview + test-send

**Sprint 4 (New staff notifications):**
- ✅ Piutang overdue summary sent to owner every 08:00 WIB via `BroadcastToStaff` with editable template
- ✅ Approval SLA breach alert triggers when approval pending >2 hours

**Sprint 5 (Existing notification improvements):**
- ✅ Heartbeat digest skipped when omset=0 for the day
- ✅ Non-critical staff notifications respect 22:00-07:00 quiet hours (approval SLA + big-tx alerts bypass)
- ✅ Multiple staff notifications within 5-min window consolidated to 1 message

**Sprint 6 (E2E verification):**
- ✅ All 7 existing customer paths (A-G) have automated E2E test covering happy path
- ✅ WA recipients CRUD via PengaturanScreen: add/edit/delete/toggle/role-change all working, phone format validation, verified with real WA send test
- ✅ No hardcoded WA numbers anywhere in code (all resolved via `wa_recipients` table)

## 5. Architecture

### 5.1 Harmonization layer — `internal/notification` package (Sprint 1)

New package that ALL WA-send callers migrate to. Two primary functions:

**`NotifyCustomer(ctx, tenantID, convID, phone, lang, msg string) error`**
- Enforces per-tenant daily WA send quota (default 300/day, configurable per subscription)
- Calls `Sender.SendText(ctx, phone, msg)`
- On success: writes to `messages` table (sender = SenderAI, direction = OUTBOUND) — audit trail atomic
- On failure: logs to Sentry + updates retry counter
- Returns typed error (`ErrQuotaExceeded`, `ErrWASessionOffline`, `ErrSendFailed`)

**`BroadcastToStaff(ctx, tenantID string, filter RecipientFilter, msg string) error`**
- Fetches `GetActiveRecipients(tenantID, filter)` (cached 60s per tenant/filter combo)
- `RecipientFilter` = `{Role: "owner" | "admin" | "" (all), CritLevel: "critical" | "normal"}` — critical bypasses quiet hours
- Sends `msg` to each recipient via `Sender.SendText`
- Records staff-broadcast log (single row aggregating all recipients + failure list)
- Consolidation window (Sprint 5): coalesce multiple calls within 5 minutes for same tenant into 1 combined message

Both functions use `MessageBuilder` for templated content — each caller passes a named template renderer, not raw string.

Extracted template registry lives in `internal/notification/templates/`:
- `piutang_reminder_h3.go` (Sprint 2)
- `piutang_reminder_h3_plus.go` (Sprint 2)
- `piutang_overdue_summary.go` (Sprint 4)
- `approval_sla_breach.go` (Sprint 4)
- `booking_expiry.go` — extracted from `main.go:495-511` (Sprint 1, fixes B2)
- `admin_forward.go` — extracted from `main.go:617-632` (Sprint 1, fixes B3)
- `approval_card.go` — wraps existing `FormatApprovalMessage` (Sprint 1, fixes B1 by wiring call site)
- `followup_customer.go` (Sprint 1, extracted from `followup/poller.go`)
- `heartbeat_digest.go` (Sprint 1, extracted from `heartbeat/poller.go`)
- 5 × `lifecycle_*.go` (Sprint 3, extracted from `handler.go`)
- `staff_escalation_*.go` (Sprint 3, extracted from `handler.go`)

### 5.2 Retry + Quiet Hours + Consolidation (Sprint 1 base + Sprint 5 enhancements)

**Retry policy:**
- Send fails (network / whatsmeow error) → mark FAILED, retry once after 1 hour via `t_jobs` queue
- Second attempt fails → give up, mark PERMANENT_FAILED, log to Sentry
- WA session offline → mark SKIPPED, retry via cron next day
- Quota exceeded → mark SKIPPED_QUOTA, do NOT retry

**Quiet hours (Sprint 5):**
- Enforced in `BroadcastToStaff` for `CritLevel="normal"` messages
- Config: `notification_config.quiet_hours_start` / `quiet_hours_end` per tenant (default 22:00-07:00 WIB)
- Critical messages (approval SLA, big-tx alerts if enabled) bypass quiet hours
- Messages sent during quiet hours held in queue, delivered at quiet_hours_end + morning batch

**Silent-day (Sprint 5):**
- Heartbeat digest calls `checkOmsetToday(tenantID)` before sending
- If omset = 0 for the day, skip digest entirely
- Log "SKIPPED_SILENT_DAY" for observability

**Consolidation window (Sprint 5):**
- `BroadcastToStaff` for same tenant within 5 minutes coalesces into single message
- Format: "3 kejadian dalam 5 menit terakhir:\n\n1. [msg1]\n\n2. [msg2]\n\n3. [msg3]"
- Prevents notification fatigue during busy periods

### 5.3 Piutang WA reminder scheduler (Sprint 2)

New package `internal/piutang/reminder_poller.go` following `internal/followup/poller.go` pattern.

**Cron trigger:** Global daily at 09:00 WIB (single ticker in `main.go`; scans all Premium tenants).

**Eligibility filter (SQL):**
```sql
SELECT invoice_id, customer_id, tenant_id, due_date, amount_due, payment_type
FROM orders o
JOIN customers c ON o.customer_id = c.id
JOIN tenants t ON o.tenant_id = t.id
JOIN tenant_subscriptions ts ON t.id = ts.tenant_id
WHERE
  ts.tier = 'premium' AND ts.status = 'active'
  AND o.status = 'OPEN'
  AND o.payment_type IN ('tempo', 'kredit')
  AND c.phone IS NOT NULL
  AND c.wa_reminder_enabled = TRUE
  AND ts.piutang_wa_reminder_enabled = TRUE
  AND (
    (o.due_date = CURRENT_DATE + INTERVAL '3 days' AND NOT EXISTS (
      SELECT 1 FROM piutang_reminder_sent WHERE invoice_id = o.id AND rule_type = 'H-3' AND status = 'SENT'
    ))
    OR
    (o.due_date = CURRENT_DATE - INTERVAL '3 days' AND NOT EXISTS (
      SELECT 1 FROM piutang_reminder_sent WHERE invoice_id = o.id AND rule_type = 'H+3' AND status = 'SENT'
    ))
  )
```

**Manual send override:**
- PiutangScreen per-invoice "Kirim reminder sekarang" button (Premium only, tier-gated in UI)
- Backend RPC: `send_piutang_reminder_manual(invoice_id)` — enforces 1×/invoice/day constraint
- Uses same `NotifyCustomer` + template flow

### 5.4 Piutang overdue summary — staff notification (Sprint 4)

**Cron trigger:** Daily 08:00 WIB (1 hour before Piutang customer reminders, so owner sees the situation before customer notifications go out).

**Content:**
```
📊 Ringkasan Piutang — {tanggal}

Total invoice overdue: {N}
Total nilai: Rp {total}

Terlama:
• {customer_1_name} — Rp {amt} — H+{days}
• {customer_2_name} — Rp {amt} — H+{days}
• {customer_3_name} — Rp {amt} — H+{days}

Semua akan dapat H+3 auto WA reminder (jam 09:00). Yang H+30+ mungkin butuh follow-up personal.
```

**Delivery:** `BroadcastToStaff(tenantID, {Role: "owner", CritLevel: "normal"}, msg)` — respects quiet hours (won't send at 08:00 if quiet hours end at 09:00; will trigger at 09:00 instead).

**Editable via** Settings → Notifikasi → Ringkasan Piutang Harian (enable/disable + template).

### 5.5 Approval SLA breach alert (Sprint 4)

**Trigger:** Every 15 minutes, poller scans `approval_requests` for status = PENDING + `created_at < NOW() - INTERVAL '2 hours'` + not yet notified.

**Content:**
```
⚠️ Approval Pending SLA Breach

{N} approval sudah pending > 2 jam belum di-respond:

• {type_1} — {details_1} — sudah {duration}
• {type_2} — {details_2} — sudah {duration}
...

Buka Approval Inbox di app.caleo.id untuk respond.
```

**Delivery:** `BroadcastToStaff(tenantID, {Role: "owner", CritLevel: "critical"}, msg)` — BYPASSES quiet hours. Approval bottleneck is business-critical.

**Dedup:** Once notified for a given approval, mark `approval_requests.sla_breach_notified_at` — don't re-notify same approval twice.

### 5.6 E2E verification harness (Sprint 6)

New Playwright + backend integration test suite: `tests/e2e/wa-notifications/`

Per path (A-G):
- **Path A (Calista reply)**: Seed conversation → inject inbound message via test API → assert response WA within 10s + `messages` row exists
- **Path B (Staff escalation)**: Trigger payment_proof event → assert all `wa_recipients` (active) get WA send
- **Path C (Approval card)**: Create approval request via RPC → assert owner-role recipients get WA card with `approve:X` / `reject:X` buttons
- **Path D (Follow-up)**: Seed conversation with `last_ai_message_at = 5h ago` → tick poller manually → assert follow-up sent + counter incremented
- **Path E (Booking expiry)**: Create test booking with `expires_at = 25h from now` → tick scheduler → assert reminder sent at 24h-before
- **Path F (Lifecycle)**: Emit each lifecycle NOTIFY (payment_verified, dp_verified, payment_rejected, order_approved) → assert each sends WA + audit row
- **Path G (Admin forward)**: POST via Sales Inbox → assert customer receives WA + audit re-log

**Real-WA verification** (manual, one-time per feature): Use founder's personal phone as test recipient. Actually send + verify WhatsApp bubble looks correct.

### 5.7 Frontend UI

**Sprint 2**: `PiutangWaReminderScreen.tsx` (template editor with chip-based variable insertion + live preview + auto-save + test-send).

**Sprint 3**: Extend to universal `NotificationTemplatesScreen.tsx`:
- Left sidebar: list of 10 templates grouped by recipient (Customer / Staff+Owner)
- Right panel: editor for selected template (same UX as Piutang editor)
- Each template has default value shipped (reset one-click)

**Sprint 4**: Settings → Notifikasi:
- ✅ Ringkasan Piutang Harian (enable/disable + template)
- ✅ Approval SLA Breach Alert (enable/disable + SLA threshold config: 2h default)

**Sprint 5**: Settings → Notifikasi → Preferensi:
- ✅ Quiet hours: 22:00–07:00 (editable)
- ✅ Consolidation window: 5 menit (editable, 0 to disable)
- ✅ Silent-day (skip digest kalau omset 0) — checkbox

**Sprint 6**: `PengaturanScreen.tsx` WA recipient CRUD audit + fix any gaps found. Ensure phone format validation with +62 country code auto-normalize.

## 6. Data model changes (all sprints combined)

**Sprint 1 migrations:**
- `tenant_subscriptions.wa_daily_quota_used INT DEFAULT 0`
- `tenant_subscriptions.wa_daily_quota_reset_date DATE DEFAULT CURRENT_DATE`
- `approval_requests.sent_wa_card_at TIMESTAMPTZ` (for Path C wire fix — dedup)

**Sprint 2 migrations:**
- `piutang_reminder_sent` (audit table)
- `customers.wa_reminder_enabled BOOLEAN DEFAULT TRUE`
- `tenant_wa_reminder_config` (singleton per tenant, templates + toggle)

**Sprint 3 migrations:**
- `tenant_notification_templates` (per-tenant per-type template registry — 10 rows per tenant, one for each editable template)

**Sprint 4 migrations:**
- `approval_requests.sla_breach_notified_at TIMESTAMPTZ` (dedup for Sprint 4)
- No new table for Piutang overdue summary — computed from `orders` table on the fly

**Sprint 5 migrations:**
- `notification_config.quiet_hours_start TIME DEFAULT '22:00'`
- `notification_config.quiet_hours_end TIME DEFAULT '07:00'`
- `notification_config.consolidation_window_seconds INT DEFAULT 300`
- `notification_config.skip_digest_on_zero_omset BOOLEAN DEFAULT TRUE`

**Sprint 6**: No new migrations — pure verification + UI polish.

All migrations idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`).

## 7. Deployment plan (per sprint)

Each sprint independently deployable. If Sprint 3 blocked, Sprints 1-2 already in production.

### Sprint 1 (Days 1-2)
Migrate all 5 existing send-path callers to `NotifyCustomer` / `BroadcastToStaff` wrappers. Fix B1-B4. Deploy → verify B1-B4 fixes on Garindo staging.

### Sprint 2 (Days 3-7)
Piutang scheduler + template editor + audit table + opt-out UI. Deploy → run 1 week on Garindo before broadcasting to other Premium tenants.

### Sprint 3 (Days 8-11)
Universal template editor rollout. Migrate remaining 8 inline formats to `tenant_notification_templates` registry. Deploy → verify each template still renders correctly.

### Sprint 4 (Days 12-14)
Piutang overdue summary cron + Approval SLA breach poller. Deploy → verify on Garindo (approve/reject test approvals, check WA arrives).

### Sprint 5 (Days 15-16)
Quiet hours + silent-day + consolidation window logic in `NotifyCustomer` / `BroadcastToStaff`. Deploy → observe over 3 days.

### Sprint 6 (Day 17)
E2E test suite run + PengaturanScreen WA recipient audit + gap fixes. Final validation.

### Rollback per sprint

- Sprint 1: `git revert` migration + backend. Idempotent — no data loss.
- Sprint 2: `DROP TABLE piutang_reminder_sent`, `DROP TABLE tenant_wa_reminder_config`, `DROP COLUMN wa_reminder_enabled`. Feature flag: `tenant_wa_reminder_config.enabled = FALSE` for instant global disable without code rollback.
- Sprint 3: Fallback path — if `tenant_notification_templates` row missing, use hardcoded default (same as current behavior).
- Sprint 4: `DROP COLUMN sla_breach_notified_at` — no other-feature impact.
- Sprint 5: Set `quiet_hours_start = quiet_hours_end = '00:00'` to disable quiet hours; set `consolidation_window_seconds = 0` to disable consolidation.
- Sprint 6: Test-only sprint, no rollback needed.

## 8. Observability

- Every `NotifyCustomer` and `BroadcastToStaff` call emits structured log: `{tenant_id, feature, phone_hash, template_id, status, duration_ms}`
- Sentry captures: quota exceeded (INFO), permanent failure (ERROR), session offline >2 consecutive attempts (WARNING), template render failure (ERROR)
- Metric counters:
  - `wa_notification_sent_total{tenant, feature, status}`
  - `wa_daily_quota_used_current{tenant}` (gauge)
  - `notification_template_edited_count{tenant, template_id}` (Sprint 3)
  - `piutang_reminder_sent_total{tenant, rule_type, status}` (Sprint 2)
  - `approval_sla_breach_notified_total{tenant}` (Sprint 4)
- Daily admin digest: "Yesterday: N Premium tenants sent M reminders, K failed, L quiet-hours-delayed"

## 9. Security

- RLS on all new tables/columns (tenant isolation)
- Template content sanitization: strip control chars, limit 700 char, no HTML/scripts (plain text only), disallow phone numbers except `{customer_nama}`-style vars
- Rate limits at `NotifyCustomer` layer prevent runaway spam
- Manual send RPC enforces tier check (Premium only)
- WA recipient CRUD requires owner-role in `admin_users`
- Approval WA button-reply signature validation (existing `/api/approval/wa-webhook`) unchanged

## 10. Cost

- No new infrastructure (Calista whatsmeow session, Postgres, Sentry — all existing)
- Additional WA send volume: at 10 Premium tenants × 20 open invoices × 2 reminders = ~400/mo. Plus staff notifications ~200/mo. Total ~600 additional WA sends/mo. Whatsmeow is free.
- **Total added cost: Rp 0/mo.**

## 11. Reversibility

**Semi-reversible / tactical mix**:
- `internal/notification` package: semi-reversible once adopted by 5+ paths
- Piutang scheduler + universal template registry + new staff notifs: tactical (flag-off via config)
- Data model: `DROP TABLE`/`DROP COLUMN` idempotent, no other-feature impact
- No `advisor()` per CLAUDE.md scale-forward triggers (no irreversible arch, <500 line diff per sprint)

## 12. Effort estimate (per sprint)

| Sprint | Focus | Dev-days |
|---|---|---|
| 1 | Harmonize + Fix B1/B2/B3/B4 | 2 |
| 2 | Piutang WA scheduler + editable template | 5 |
| 3 | Universal editable template rollout (7 additional templates) | 3.5 |
| 4 | Piutang overdue summary + Approval SLA breach | 2.5 |
| 5 | Silent-day + quiet hours + consolidation | 2 |
| 6 | E2E verification (A-G) + WA recipient CRUD audit | 2 |
| **Total** | | **17 dev-days** |

Blockers: none. Backend + frontend deploy pipelines existing.

## 13. Open questions — CLOSED

1. **Tier gating for Piutang WA reminder**: Premium ONLY. Landing update needed.
2. **Timing**: Fixed H-3 + H+3 rules.
3. **Template editability**: Content editable, rules fixed. Universal rollout (not just Piutang).
4. **Delivery**: Via tenant's Calista whatsmeow session.
5. **Manual button**: KEEP with 1×/invoice/day constraint.
6. **Harmonization scope**: Full — fix B1-B4 before layering Piutang.
7. **Additional staff notifications**: Piutang overdue summary + Approval SLA breach (both add).
8. **Deferred staff notifications**: Big transaction fraud alert + End of month closing reminder (defer to future).
9. **Existing notification improvements**: Silent-day + quiet hours + consolidation (add all 3).
10. **E2E verification scope**: All 7 customer paths (A-G) + PengaturanScreen WA recipient CRUD.

## 14. Landing marketing accuracy — follow-up needed after ship

After all 6 sprints ship, update landing:
- Piutang module card: mark "WA reminder otomatis" as (Premium)
- FAQ #7: mention 300/day cap now enforced code-side (was landing-only claim)
- pricing.md v4: sync tier features + remove partial-ship disclosure for B1/B2/B3/B4 items now fixed

Not part of dev sprint estimate. ~1 day marketing work.

## 15. Reversibility rating

**Semi-reversible / tactical mix.** No `advisor()` required. Each sprint diff <500 lines. `internal/notification` package is the biggest architectural weight (semi-reversible once adopted); all other changes are tactical/reversible via feature flag or `DROP` migration.
