# WA Notification Framework Overhaul — Design Spec (FINAL)

**Date:** 2026-07-19
**Author:** Autonomous session with founder brainstorm + review cycles
**Status:** FINAL for founder review before writing-plans

**Scope**: **7 sprints, ~23.5 dev-days total.** Ships incrementally (each sprint deploy-ready standalone).

**Founder criteria driving design decisions:**
1. **Value for tenant NOW** — every sprint delivers something tenant-visible + billable
2. **Zero infrastructure cost** — reuse whatsmeow, Postgres, Sentry, Resend (no new vendors)
3. **Scalable** — 100 tenants no re-architecture needed; 1000 tenants graceful degradation
4. **Best practices** — RLS, idempotent migrations, retry+backoff, structured logging, feature flags, independent sprint deployability
5. **Best UI/UX for non-tech-savvy MSME owners** — chip-input over template syntax, live WhatsApp-style preview, auto-save, plain-language error messages, sensible defaults

---

## 1. Context

Landing page (`caleo.id`) promises multiple WA notification features:
- Piutang & AR module: "WA reminder otomatis — cashflow toko lancar tanpa harus telepon 1-1"
- Testimonial Ibu S: "Piutang turun ~40% dalam 2 bulan" attributed to WA reminder auto
- Multiple lifecycle events promised (order status, payment confirmations, booking expiry, etc.)
- Landing hero-side prominent "Ngobrol WA" CTA — 13× WA links across landing pointing to founder's personal WhatsApp

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

## 2. Goal

Ship a shared WA notification framework and comprehensive overhaul of all 8 existing WA notification paths + 5 net-new notifications + 1 net-new customer-acquisition surface (Caleo Admin WA bot). Harmonize, verify, fix bugs, add missing features, improve quality — so landing promises align with code, tenant gets immediate cashflow-improving features, and future scaling (100+ tenants, AI Manager, marketplace integrations) build on solid foundation.

## 3. Non-goals (explicit)

- **NOT for Starter/Pro tier WA reminders** — Piutang WA reminder is Premium-exclusive. No auto, no manual, no email fallback for non-Premium. Landing needs update to reflect Premium gating.
- **NOT for payment gateway integration** (QRIS/GoPay/OVO) — payment link in reminders = future Phase.
- **NOT for multi-cadence Piutang** beyond H-3 + H+3.
- **NOT for owner-editable H offsets** (rule dates fixed; only content editable).
- **NOT for per-invoice opt-out** on Piutang reminders — only per-customer or global tenant toggle.
- **NOT for big transaction fraud alert** (deferred, requires AI Manager work).
- **NOT for end-of-month closing reminder** (deferred, low priority).
- **NOT for outbound WA media send** (text only; media inbound already supported).
- **NOT for customer-side notification history / mute list / consent capture** in this framework (founder decision 2026-07-19: skip 1/2/4 of critical additions). Rationale: current tenant base is trusted-tenant model where opt-out managed offline via customer service. Revisit at 50+ tenant scale.
- **NOT for whatsmeow read receipt / delivered status** capture (whatsmeow event support unclear + not user-value critical).
- **NOT for multi-language (id/en)** switch — all templates ship id-ID only. English variants Phase 3.

## 4. Success criteria (measurable per sprint)

**Sprint 1 (Harmonize + Fix bugs) — 2 dev-days:**
- ✅ All 8 existing paths use `NotifyCustomer` or `BroadcastToStaff` wrappers (no direct `SendText` calls in application code)
- ✅ B1 fixed: approval WA cards actually reach owner recipients when approval request created
- ✅ B2, B3 fixed: `messages` audit table has entry for every WA send
- ✅ B4 fixed: `wa_daily_send_count` tracked per tenant, enforced at 300/day for Calista replies

**Sprint 2 (Piutang scheduler) — 5 dev-days:**
- ✅ Premium tenant with active Calista session + open tempo invoice + eligible customer receives H-3 message on `due_date - 3 days` at 09:00 WIB, and H+3 message on `due_date + 3 days` at 09:00 WIB, via tenant's own WA number
- ✅ Owner edits H-3 / H+3 templates in Settings, sees live preview with sample data, sends test WA to own phone, auto-save on blur
- ✅ Owner toggles per-customer opt-out or tenant-wide toggle
- ✅ Every reminder logged in `piutang_reminder_sent` audit table
- ✅ Manual send button KEEPS with 1×/invoice/day constraint

**Sprint 3 (Universal editable templates + versioning) — 4 dev-days:**
- ✅ 7 additional templates editable via Settings UI (same UX as Piutang): Follow-up (D), Booking-expiry (E), 5 lifecycle (F: payment_verified, dp_verified, payment_rejected, order_approved, order_shipped), Staff escalation (B), Approval card (C), Heartbeat digest (H) — 10 templates total in registry
- ✅ Each template has default value + reset button + live preview + test-send + edit history "Riwayat perubahan"
- ✅ `tenant_notification_templates_history` tracks all edits (actor + timestamp + old/new content)
- ✅ Lifecycle refinement: `order_created` explicit event fires when order placed (currently only implicit via Calista `buildInvoiceMessage`); `order_shipped` event verified fires end-to-end

**Sprint 4 (New notifications) — 3.5 dev-days:**
- ✅ Piutang overdue summary sent to owner every 08:00 WIB via `BroadcastToStaff` with editable template
- ✅ **NEW**: Hutang overdue summary sent to owner every 07:30 WIB (parallel to Piutang) — "N tagihan supplier jatuh tempo minggu ini"
- ✅ Approval SLA breach alert triggers when approval pending >2 hours
- ✅ **NEW**: Post-order feedback request cron sent 7 days after order status=DELIVERED/COMPLETED, with editable template + `customer_feedback` collection table + aggregation dashboard tab

**Sprint 5 (Existing notification improvements + Session health) — 3 dev-days:**
- ✅ Heartbeat digest skipped when omset=0 for the day
- ✅ Non-critical staff notifications respect 22:00-07:00 quiet hours (approval SLA + Caleo-ops session-health-alerts bypass)
- ✅ Multiple staff notifications within 5-min window consolidated to 1 message
- ✅ **NEW**: `session_health` per-tenant poll every 5 min; if Calista WA session offline > 30 min → alert **Caleo ops team email** (NOT tenant owner — per founder decision, Caleo support fixes proactively). Auto-reconnect retry logic.

**Sprint 6 (E2E verification + WA recipient CRUD audit) — 2 dev-days:**
- ✅ All 7 existing customer paths (A-G) have automated E2E test covering happy path
- ✅ WA recipients CRUD via PengaturanScreen: add/edit/delete/toggle/role-change all working, phone format validation (+62 auto-normalize), verified with real WA send test
- ✅ No hardcoded WA numbers anywhere in code (all resolved via `wa_recipients` table)

**Sprint 7 (Caleo Admin WA Automation Bot) — 4 dev-days:**
- ✅ Dedicated Caleo-platform WhatsApp number (Caleo owns, whatsmeow session)
- ✅ Prospect chats via landing "Ngobrol WA" CTA → auto-reply with FAQ answers (from landing FAQ 15 items)
- ✅ Keyword-based FAQ matcher (no LLM cost — pure Go string match) with fuzzy tolerance
- ✅ Escalation to founder's personal WA when non-FAQ question detected
- ✅ Analytics dashboard: prospect count, top questions, conversion to demo scheduled
- ✅ **Value: DOUBLES AS LIVE DEMO** of Calista AI for prospects — "this is what your customers see if you upgrade Premium"

## 5. Architecture

### 5.1 Harmonization layer — `internal/notification` package (Sprint 1)

New package that ALL WA-send callers migrate to. Three primary functions:

**`NotifyCustomer(ctx, tenantID, convID, phone, lang, msg string) error`**
- Enforces per-tenant daily WA send quota (default 300/day for Premium, configurable per subscription)
- Calls `Sender.SendText(ctx, phone, msg)`
- On success: writes to `messages` table (sender = SenderAI, direction = OUTBOUND) — audit trail atomic
- On failure: logs to Sentry + updates retry counter
- Returns typed error (`ErrQuotaExceeded`, `ErrWASessionOffline`, `ErrSendFailed`, `ErrTemplateRenderError`)

**`BroadcastToStaff(ctx, tenantID string, filter RecipientFilter, msg string) error`**
- Fetches `GetActiveRecipients(tenantID, filter)` (cached 60s per tenant/filter combo)
- `RecipientFilter` = `{Role: "owner" | "admin" | "" (all), CritLevel: "critical" | "normal"}` — critical bypasses quiet hours
- Sends `msg` to each recipient via `Sender.SendText`
- Records staff-broadcast log (single row aggregating all recipients + failure list)
- Consolidation window (Sprint 5): coalesce multiple calls within 5 minutes for same tenant into 1 combined message

**`SendOpsEmail(ctx, subject, body string) error` (NEW, Sprint 5)**
- Wraps Resend REST API call
- Recipient: env var `CALEO_OPS_EMAIL` (default: `halo@caleo.id`)
- Used for: Sprint 5 session-health alerts (WA session dead), Sprint 7 escalations to founder
- Structured log + Sentry breadcrumb per send

All three functions use `MessageBuilder` interface for templated content — each caller passes a named template renderer, not raw string:

```go
type MessageBuilder interface {
    Build(ctx context.Context, params map[string]any) (string, error)
    TemplateID() string  // for versioning + observability
    RequiredParams() []string  // for validation
}
```

Extracted template registry lives in `internal/notification/templates/`:
- `piutang_reminder_h3.go` (Sprint 2)
- `piutang_reminder_h3_plus.go` (Sprint 2)
- `piutang_overdue_summary.go` (Sprint 4)
- `hutang_overdue_summary.go` (Sprint 4 — NEW)
- `approval_sla_breach.go` (Sprint 4)
- `post_order_feedback.go` (Sprint 4 — NEW)
- `booking_expiry.go` — extracted from `main.go:495-511` (Sprint 1, fixes B2)
- `admin_forward.go` — extracted from `main.go:617-632` (Sprint 1, fixes B3)
- `approval_card.go` — wraps existing `FormatApprovalMessage` (Sprint 1, fixes B1 by wiring call site)
- `followup_customer.go` (Sprint 1, extracted from `followup/poller.go`)
- `heartbeat_digest.go` (Sprint 1, extracted from `heartbeat/poller.go`)
- 5 × `lifecycle_*.go` (Sprint 3, extracted from `handler.go`) — `order_created`, `payment_verified`, `dp_verified`, `payment_rejected`, `order_approved`, `order_shipped` (6 total actually, `order_created` newly added)
- `staff_escalation_*.go` (Sprint 3, extracted from `handler.go`)
- `caleo_admin_faq_*.go` (Sprint 7, 15 templates per landing FAQ)
- `caleo_admin_escalation.go` (Sprint 7, escalation-to-founder template)

### 5.2 Retry + Quiet Hours + Consolidation + Session Health (Sprint 1 base + Sprint 5 enhancements)

**Retry policy:**
- Send fails (network / whatsmeow error) → mark FAILED, retry once after 1 hour via `t_jobs` queue
- Second attempt fails → give up, mark PERMANENT_FAILED, log to Sentry
- WA session offline → mark SKIPPED, retry via cron next day
- Quota exceeded → mark SKIPPED_QUOTA, do NOT retry

**Quiet hours (Sprint 5):**
- Enforced in `BroadcastToStaff` for `CritLevel="normal"` messages
- Config: `notification_config.quiet_hours_start` / `quiet_hours_end` per tenant (default 22:00-07:00 WIB)
- Critical messages bypass (approval SLA breach, session-health-ops-alert)
- Messages sent during quiet hours held in queue, delivered at quiet_hours_end + morning batch

**Silent-day (Sprint 5):**
- Heartbeat digest calls `checkOmsetToday(tenantID)` before sending
- If omset = 0 for the day, skip digest entirely
- Log "SKIPPED_SILENT_DAY" for observability

**Consolidation window (Sprint 5):**
- `BroadcastToStaff` for same tenant within 5 minutes coalesces into single message
- Format: "3 kejadian dalam 5 menit terakhir:\n\n1. [msg1]\n\n2. [msg2]\n\n3. [msg3]"
- Prevents notification fatigue during busy periods

**Session health monitoring (Sprint 5 — NEW):**
- `internal/notification/session_health.go` background goroutine
- Every 5 min: query all Premium tenants with `whatsapp_numbers` active row → check whatsmeow client `IsConnected()`
- If offline > 30 min continuous: call `SendOpsEmail("[Caleo Ops] WA Session Offline — tenant {slug}", ...)`
- Also: attempt auto-reconnect (call `client.Connect()` if disconnected)
- Log to Sentry with `WARNING` level per session state change
- Dashboard (admin.caleo.id): tenant health tab shows per-tenant WA session state with colored badges (green=online, yellow=<30min offline, red=>30min offline)

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

### 5.4 Order lifecycle refinement (Sprint 3 — NEW additions)

**`order_created` explicit event (currently missing as explicit path):**
- Postgres trigger on `orders` table INSERT: `NOTIFY order_created` with payload
- Handler in `handler.go` HandleOrderCreated: formats invoice message via template, sends via `NotifyCustomer`
- Ensures every new order → customer gets immediate WA confirmation (even for admin-created / kasir-created orders, not just Calista chat orders)

**`order_shipped` event verification:**
- Currently listed in Sprint 3 template registry but not verified to fire end-to-end
- Sprint 3 task: check `orders.status` transitions to SHIPPED via kasir/pesanan UI → verify Postgres NOTIFY fires → handler processes → WA sends
- If gap found, wire trigger + handler

### 5.5 Piutang overdue summary — staff notification (Sprint 4)

**Cron trigger:** Daily 08:00 WIB (1 hour before Piutang customer reminders at 09:00 WIB — owner sees situation before customer notifications go out).

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

**Delivery:** `BroadcastToStaff(tenantID, {Role: "owner", CritLevel: "normal"}, msg)` — respects quiet hours.

**Editable via** Settings → Notifikasi → Ringkasan Piutang Harian (enable/disable + template).

### 5.6 Hutang overdue summary — staff notification (Sprint 4 — NEW)

**Purpose:** Complement Piutang (customer owes tenant) with Hutang (tenant owes supplier) — full cashflow visibility.

**Cron trigger:** Daily 07:30 WIB (30 min before Piutang summary — reminds owner about outgoing obligations first).

**Content:**
```
💸 Ringkasan Hutang Supplier — {tanggal}

Tagihan jatuh tempo minggu ini: {N}
Total nilai: Rp {total}

Terdekat:
• {supplier_1_name} — Rp {amt} — jatuh tempo {date}
• {supplier_2_name} — Rp {amt} — jatuh tempo {date}
• {supplier_3_name} — Rp {amt} — jatuh tempo {date}

Buka Pembelian → Pembayaran untuk atur pembayaran.
```

**Delivery:** `BroadcastToStaff(tenantID, {Role: "owner", CritLevel: "normal"}, msg)` — respects quiet hours.

**Editable via** Settings → Notifikasi → Ringkasan Hutang Harian.

### 5.7 Approval SLA breach alert (Sprint 4)

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

**Delivery:** `BroadcastToStaff(tenantID, {Role: "owner", CritLevel: "critical"}, msg)` — BYPASSES quiet hours.

**Dedup:** Once notified for a given approval, mark `approval_requests.sla_breach_notified_at` — don't re-notify same approval twice.

### 5.8 Post-order feedback request — customer notification (Sprint 4 — NEW)

**Purpose:** Collect real testimonials + rating data. Feeds landing update from anonymized "Pak B/Ibu S" testimonials to real named testimonials (with consent).

**Cron trigger:** Daily 10:00 WIB (after morning reminders). Scans orders with `status IN ('DELIVERED', 'COMPLETED')` + `delivered_at = CURRENT_DATE - INTERVAL '7 days'` + no prior feedback request sent.

**Content (template):**
```
Halo {customer_nama} 👋, 

Terima kasih sudah order di {toko_nama}! Kami mau tanya sedikit — bagaimana pengalaman belanjanya?

Kalau puas: balas dengan angka (1-5), 5 = sangat puas.
Kalau ada masalah: langsung kabari kami, siap bantu.

Ratings + kata-kata baik dari kamu akan kami gunakan untuk testimonial (opt-in). Terima kasih! 🙏 — {toko_nama}
```

**Delivery:** `NotifyCustomer(tenantID, convID, customer_phone, "id", rendered_msg)`

**Response collection:**
- Inbound message received handler checks if conv has active feedback_request context
- Parse numeric rating (1-5) + optional text → INSERT into `customer_feedback` table
- If rating >= 4 + optional text: mark as candidate testimonial for tenant/Caleo landing review

**UI:** New tab in tenant dashboard "Feedback Customer" showing aggregated ratings + comments + toggle "Approve for landing use" (owner reviews before Caleo team picks).

### 5.9 Template versioning + audit trail (Sprint 3 — NEW)

**Table:** `tenant_notification_templates_history`
```sql
CREATE TABLE public.tenant_notification_templates_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  template_id TEXT NOT NULL,  -- e.g., 'piutang_reminder_h3'
  actor_user_id UUID REFERENCES admin_users(id),
  old_content TEXT,
  new_content TEXT NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON tenant_notification_templates_history (tenant_id, template_id, edited_at DESC);
```

**UI:** Template editor sidebar shows "Riwayat perubahan" link → modal with paginated history table (actor + timestamp + diff view old vs new).

**Purpose:** Compliance (kalau customer complain tone kasar) + auditability (siapa ganti kapan) + revert capability (bisa restore ke versi lama dengan 1 click).

### 5.10 Caleo Admin WA Automation Bot (Sprint 7 — NEW)

**Purpose (dual):**
1. **Automation**: Prospects clicking landing "Ngobrol WA" CTA get auto-reply with FAQ answers (currently they interrupt founder for basic questions)
2. **Live demo**: Prospects experience Calista AI in action — "seperti ini WA reminder yang customer kamu akan terima kalau upgrade Premium"

**Architecture:**
- Dedicated Caleo-platform WhatsApp number (new number, NOT founder's personal — founder personal stays for escalation only)
- Reuse whatsmeow client pattern via a special "system" tenant record (tenant_id = `00000000-0000-0000-0000-000000000000` sentinel, RLS explicitly permits system reads)
- Runs as separate whatsmeow session alongside per-tenant Calista sessions
- Session persistence: same PostgreSQL sqlstore
- Config: `CALEO_ADMIN_WA_PHONE` env var (system tenant WA number)

**FAQ Matcher (Go, keyword-based, zero LLM cost):**
```go
type FAQEntry struct {
    ID        string   // "harga", "setup", "trial", ...
    Keywords  []string // ["berapa harga", "biaya", "cost", "cost berapa"]
    Response  string   // template with variables (currently just {tanggal}, {nama_prospek})
    NextStep  string   // "schedule_demo" | "chat_founder" | nil
}
```

15 FAQ entries seeded from landing FAQ:
1. **harga**: pricing tiers overview + link to caleo.id/#promos
2. **setup**: onboarding process 1 minggu
3. **trial**: 14 hari refund guarantee
4. **fitur_starter**: what Starter includes
5. **fitur_pro**: what Pro adds
6. **fitur_premium**: what Premium adds + AI + website
7. **calista_ai**: how Calista works
8. **multi_channel**: Shopee/Tokped/etc claim (with roadmap disclaimer)
9. **security**: UU PDP + encryption + backup
10. **integration_bank**: bank recon claim + roadmap for payment gateway
11. **kantor**: LTC Glodok address + jam operasional
12. **demo**: request live demo — chat founder handoff
13. **kompetitor**: comparison vs Mekari/Jurnal/dll
14. **migrasi_data**: dari Mekari/Jurnal 1 minggu
15. **kontak_founder**: escalation trigger

**Match logic:**
- Simple case-insensitive substring + Levenshtein distance ≤ 2 for typo tolerance
- No LLM call — pure Go string ops, zero cost
- If confidence < 0.7: fall through to "chat founder" escalation

**Escalation flow:**
- Non-FAQ message received: send "Terima kasih untuk pertanyaannya! Founder Caleo akan reply sebentar" + forward inbound to founder's personal WA via existing whatsmeow-to-whatsmeow send
- Founder can reply back via Sales Inbox pattern (Path G) — response goes back to prospect through Caleo Admin WA number

**Analytics (Sprint 7 delivers):**
- New table `caleo_admin_bot_analytics`: (session_id, first_message_at, faq_hits, escalated_at, demo_scheduled_at, converted_to_signup_at)
- Admin dashboard at admin.caleo.id: "Caleo WA Bot" tab shows:
  - Prospect count per day
  - Top 5 FAQ questions
  - Escalation rate (prospects with non-FAQ questions)
  - Conversion funnel: prospect → demo scheduled → signup

**Landing integration:**
- ALL 13 landing "Ngobrol WA" CTAs currently point to `wa.me/6285264787775` (founder personal)
- Sprint 7 ships: swap 13 CTAs to point to `wa.me/{CALEO_ADMIN_WA_NUMBER}` — new number
- Founder personal number kept for existing customer support + escalation from bot
- Update DNS/config: no code change needed — just landing HTML update

**Scaling projection:**
- At 100 prospects/day (aspirational): bot handles ~80% automated (FAQ hits), ~20% escalate to founder
- Whatsmeow single session handles unlimited concurrent chats (WhatsApp Web is multi-conversation by design)
- No cost scaling — WhatsApp free + whatsmeow free
- If prospect volume grows to 500+/day, add second session in load-balanced round-robin

### 5.11 Frontend UI — comprehensive UX design

**Design principles for non-tech-savvy MSME owners:**
1. **No template syntax typing** — variable chips clickable, insert visual tokens
2. **Live WhatsApp bubble preview** — owner sees exactly what customer sees
3. **Auto-save on blur** — no lost work, no "did I click save?" anxiety
4. **Test-send to owner's own phone** — validates real WA rendering before enable
5. **Sensible defaults** — every toggle starts in reasonable state, ships default templates
6. **Plain-language error messages** — "Nomor customer belum ada, tambahin dulu di menu Pelanggan" not "phone field is null"
7. **First-time onboarding tour** — modal walkthrough of template editor for first-time users, dismissible
8. **Consistent visual language** — Inter font, navy/gold palette, WhatsApp green for send buttons — matches landing
9. **Bahasa Indonesia everywhere** — no English UI copy leakage
10. **Mobile-responsive** — MSME owners use phones — 375-414px viewport must work

**Screens (all sprints):**

**Sprint 2**: `src/components/pengaturan/PiutangWaReminderScreen.tsx`
- Header: Breadcrumb `Pengaturan → Piutang → WA Reminder Templates` + Premium badge
- Global toggle: "✅ WA Reminder Scheduler aktif" (default: TRUE)
- Two template panels stacked vertically (H-3 top, H+3 bottom, each with:)
  - Left column (60% width):
    - Chip buttons row: `[+ Nama Customer] [+ Nomor Invoice] [+ Jumlah Rp] [+ Nama Toko] [+ Tanggal Jatuh Tempo]`
    - Textarea 8 rows tall
    - Below textarea: "✓ Tersimpan otomatis · 187/700 char" (auto-updates as user types)
    - Buttons row: `[🔄 Reset ke default] [📱 Kirim tes ke HP saya]` + [📜 Riwayat perubahan]
  - Right column (40% width):
    - WhatsApp bubble preview (styled as WA chat: green header bar, white bubble, sample data resolved)
    - Sample data shows below preview: "Data contoh: Pak Budi, Toko Jaya Makmur, INV-2607-0142, Rp 4.200.000, 22 Jul 2026"

Interaction details:
- Clicking chip: variable name inserted at cursor position in textarea, wrapped as visual token `[Nama Customer]` (rendered as pill in preview, resolved to sample data in preview panel)
- Textarea character counter: green 0-500, yellow 500-650, red 650-700+
- "Kirim tes" button: sends test WA to logged-in owner's phone via `NotifyCustomer` with special `template_id = "test"` to distinguish in audit; shows success toast "✓ Terkirim ke +62-8XX-XX-XXX"
- Reset button: 1-click (no confirm), reverts to shipped default template. Old content preserved in versioning history (Sprint 3 feature).
- Riwayat perubahan: modal shows paginated table `Waktu | Diubah oleh | Preview lama → baru | Restore` (Sprint 3 addition)

**Sprint 3**: `src/components/pengaturan/NotificationTemplatesScreen.tsx` (universal)
- Left sidebar: 10 template entries grouped `Untuk Customer / Untuk Staff & Owner`
- Right panel: editor for selected template (same layout as Piutang, adapted for each template's variables + sample data)
- Search bar at top of sidebar for finding templates fast
- Each entry in sidebar shows: template name, last edited timestamp, edit icon if custom (vs default)

**Sprint 4**: Settings → Notifikasi additions:
- Card: "🕗 Ringkasan Piutang Harian" — enable/disable toggle + template edit button + time picker (default 08:00 WIB)
- Card: "🕐 Ringkasan Hutang Harian" — enable/disable toggle + template edit button + time picker (default 07:30 WIB)
- Card: "⚠️ Approval SLA Breach Alert" — enable/disable toggle + threshold slider (default 2 jam, range 30 min - 8 jam)
- Card: "📝 Feedback Customer Post-Order" — enable/disable toggle + template edit button + delay slider (default 7 hari, range 3-14 hari)

**Sprint 5**: Settings → Notifikasi → Preferensi (new sub-page):
- Card: "🌙 Jam Tenang" — time range picker (default 22:00 - 07:00) — "Notifikasi non-critical akan ditahan selama jam ini"
- Card: "📦 Gabungkan Notifikasi" — slider 0-30 menit (default 5 menit, 0 = disabled) — "Beberapa notif dalam window ini digabung jadi 1 pesan"
- Card: "💤 Skip Hari Kosong" — checkbox (default ON) — "Skip ringkasan harian kalau omset hari itu = 0"

**Sprint 6**: `PengaturanScreen.tsx` WA recipient CRUD audit
- Verify existing UI works: add/edit/delete/toggle/role-change
- Add phone format validation with +62 country code auto-normalize (accept `085X`, `+628X`, `62 8X`, etc., normalize to `62XXXXXXXXX`)
- Add "Kirim tes" button per recipient row — verifies WA works before saving
- Add helper text: "Nomor WA yang aktif akan terima semua notifikasi. Owner-role dapat notif approval + business digest. Admin-role dapat notif escalation."

**Sprint 7**: Admin dashboard "Caleo WA Bot" tab (admin.caleo.id):
- Analytics cards: prospects today, week, month
- Top 5 FAQ questions asked bar chart
- Escalation rate line chart (7-day trend)
- Conversion funnel visualization
- Recent conversations list (searchable) — click to view full transcript

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
- `tenant_notification_templates` (per-tenant per-type template registry — 10 rows per tenant)
- `tenant_notification_templates_history` (versioning — NEW)
- Postgres trigger: `orders_insert_notify` firing `order_created` NOTIFY

**Sprint 4 migrations:**
- `approval_requests.sla_breach_notified_at TIMESTAMPTZ` (dedup)
- `customer_feedback` table (rating 1-5, optional text, order_id FK) — NEW
- No new table for Piutang/Hutang overdue summary — computed from `orders` / `purchase_invoices` tables on the fly

**Sprint 5 migrations:**
- `notification_config.quiet_hours_start TIME DEFAULT '22:00'`
- `notification_config.quiet_hours_end TIME DEFAULT '07:00'`
- `notification_config.consolidation_window_seconds INT DEFAULT 300`
- `notification_config.skip_digest_on_zero_omset BOOLEAN DEFAULT TRUE`
- `whatsapp_session_health` table (per-tenant per-poll health record) — NEW
- Env var addition: `CALEO_OPS_EMAIL` (default `halo@caleo.id`)

**Sprint 6**: No new migrations.

**Sprint 7 migrations:**
- `caleo_admin_bot_faq` (seeded FAQ entries — 15 rows)
- `caleo_admin_bot_analytics` (prospect session tracking)
- Env var addition: `CALEO_ADMIN_WA_PHONE` (Caleo platform WA number)

All migrations idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`). RLS enforced per new tenant-scoped table.

## 7. Deployment plan (per sprint)

Each sprint independently deployable. Failure at Sprint N doesn't block N-1 rollout.

### Sprint 1 (Days 1-2)
Migrate all 5 existing send-path callers to `NotifyCustomer` / `BroadcastToStaff` wrappers. Fix B1-B4. Deploy → verify B1-B4 fixes on Garindo staging → broadcast if green.

### Sprint 2 (Days 3-7)
Piutang scheduler + template editor + audit table + opt-out UI. Deploy → run 1 week on Garindo before broadcasting to other Premium tenants.

### Sprint 3 (Days 8-11)
Universal template editor rollout + versioning + order lifecycle refinement. Migrate remaining 8 inline formats to `tenant_notification_templates` registry. Deploy → verify each template still renders correctly + `order_created` fires end-to-end.

### Sprint 4 (Days 12-15)
Piutang overdue summary + Hutang overdue summary + Approval SLA breach + Post-order feedback request. Deploy → verify each cron fires + notifications arrive correctly.

### Sprint 5 (Days 16-18)
Quiet hours + silent-day + consolidation window + Session health monitor + `SendOpsEmail`. Deploy → observe over 3 days.

### Sprint 6 (Day 19)
E2E test suite run + PengaturanScreen WA recipient audit + gap fixes.

### Sprint 7 (Days 20-23)
Caleo Admin WA Bot: procure Caleo-platform WA number → provision whatsmeow session → seed 15 FAQ entries → wire escalation to founder personal → analytics dashboard → landing swap 13 CTAs to new number.

### Rollback per sprint

- Sprint 1: `git revert` migration + backend. Idempotent — no data loss.
- Sprint 2: `DROP TABLE piutang_reminder_sent`, `DROP TABLE tenant_wa_reminder_config`, `DROP COLUMN wa_reminder_enabled`. Feature flag: `tenant_wa_reminder_config.enabled = FALSE` for instant global disable without code rollback.
- Sprint 3: Fallback — if template row missing, use hardcoded default. Postgres trigger drop: `DROP TRIGGER orders_insert_notify ON orders`.
- Sprint 4: `DROP COLUMN sla_breach_notified_at`, `DROP TABLE customer_feedback` — no other-feature impact.
- Sprint 5: Set quiet_hours=00:00 to disable; consolidation_window_seconds=0 to disable; session health goroutine can be disabled via env var kill switch.
- Sprint 6: Test-only sprint, no rollback needed.
- Sprint 7: Landing revert 13 CTAs back to founder personal number. Delete Caleo-platform whatsmeow session. Tables can drop.

## 8. Observability

- Every `NotifyCustomer`, `BroadcastToStaff`, and `SendOpsEmail` call emits structured log: `{tenant_id, feature, phone_hash, template_id, status, duration_ms}`
- Sentry captures: quota exceeded (INFO), permanent failure (ERROR), session offline >2 consecutive attempts (WARNING), template render failure (ERROR), Caleo Ops email failure (ERROR)
- Metric counters:
  - `wa_notification_sent_total{tenant, feature, status}`
  - `wa_daily_quota_used_current{tenant}` (gauge)
  - `notification_template_edited_count{tenant, template_id}`
  - `piutang_reminder_sent_total{tenant, rule_type, status}`
  - `hutang_summary_sent_total{tenant}` (Sprint 4)
  - `approval_sla_breach_notified_total{tenant}`
  - `feedback_request_sent_total{tenant, converted_to_response}` (Sprint 4)
  - `session_health_offline_alert_total{tenant}` (Sprint 5)
  - `caleo_bot_faq_hit_total{faq_id}` (Sprint 7)
  - `caleo_bot_escalation_total` (Sprint 7)
- Daily admin digest to `CALEO_OPS_EMAIL`: "Yesterday: N Premium tenants sent M reminders, K failed, L quiet-hours-delayed. Bot: P prospects, Q escalated"

## 9. Security

- RLS on all new tables/columns (tenant isolation enforced; `caleo_admin_bot_*` uses sentinel tenant with restricted RLS bypass)
- Template content sanitization: strip control chars, limit 700 char, no HTML/scripts (plain text only), disallow phone numbers except `{customer_nama}`-style vars
- Rate limits at `NotifyCustomer` layer prevent runaway spam
- Manual send RPC enforces tier check (Premium only)
- WA recipient CRUD requires owner-role in `admin_users`
- Approval WA button-reply signature validation (existing `/api/approval/wa-webhook`) unchanged
- Caleo Admin WA session: whatsmeow session stored in Postgres with encryption-at-rest (Supabase default); env vars via GCP Secret Manager not `.env` in prod
- `SendOpsEmail` recipient hardcoded from env — cannot be manipulated by tenant input

## 10. Cost (zero-cost verification)

- **whatsmeow**: free (WhatsApp Web protocol, open source)
- **Postgres tables**: existing Supabase project, all rows well within free tier at 100 tenant scale
- **Sentry**: existing DSN, additional events well within monthly quota
- **Resend**: free tier 3K emails/month — session health alerts + Caleo ops digests + Sprint 5 fallback total < 100/mo
- **Caleo Admin WA number** (Sprint 7): use existing Caleo team WhatsApp number OR purchase new prepaid SIM (Rp 5,000 one-time to activate). One-time only.
- **Cloud Run compute**: existing service, marginal CPU/memory increase from new goroutines <5% at 100 tenant scale
- **Total added recurring cost: Rp 0/mo.** One-time SIM cost (~Rp 5,000) if needed for Sprint 7.

## 11. Reversibility

**Semi-reversible / tactical mix**:
- `internal/notification` package: semi-reversible once adopted by 5+ paths
- Piutang scheduler + universal template registry + new staff notifs: tactical (flag-off via config)
- Data model: `DROP TABLE`/`DROP COLUMN` idempotent, no other-feature impact
- Caleo Admin WA Bot: fully reversible — landing revert 13 CTAs + delete session
- No `advisor()` per CLAUDE.md scale-forward triggers (no irreversible arch, <500 line diff per sprint)

## 12. Effort estimate (per sprint)

| Sprint | Focus | Dev-days |
|---|---|---|
| 1 | Harmonize + Fix B1/B2/B3/B4 | 2 |
| 2 | Piutang WA scheduler + editable template | 5 |
| 3 | Universal editable template rollout + versioning + order lifecycle refinement | 4 |
| 4 | Piutang overdue summary + Hutang overdue summary + Approval SLA breach + Post-order feedback | 3.5 |
| 5 | Silent-day + quiet hours + consolidation + Session health monitor | 3 |
| 6 | E2E verification (A-G) + WA recipient CRUD audit | 2 |
| 7 | Caleo Admin WA Bot (FAQ + escalation + analytics + landing swap) | 4 |
| **Total** | | **23.5** |

Blockers: none. Backend + frontend deploy pipelines existing.

## 13. Value delivered per sprint (tenant-visible)

**Sprint 1**: Landing promise "WA reminder otomatis" starts being honored — approval WA cards actually reach owner + audit trail complete. No tenant-visible change to end-user, but reliability foundation.

**Sprint 2**: Premium tenants START receiving H-3/H+3 Piutang reminders — real cashflow improvement. Testimonial "Ibu S piutang turun 40%" becomes actual replicable outcome.

**Sprint 3**: Tenant owner can customize ALL notification templates — voice/tone control. Previously hardcoded messages become branded per tenant.

**Sprint 4**: Owner gets daily Piutang + Hutang situational awareness (before starting day) + Approval alerts (no bottleneck) + feedback pipeline (real testimonials collected).

**Sprint 5**: Notification fatigue reduced (quiet hours + consolidation) + Caleo team proactively notified of failed sessions (Premium tenant reliability up).

**Sprint 6**: All 7 customer notification paths validated end-to-end. Recipient CRUD verified. No hidden gaps.

**Sprint 7**: New prospect-acquisition surface via WhatsApp bot — dual value: (a) automates founder's inbound support load, (b) live demo of Calista AI for prospects → higher Premium tier conversion.

## 14. Scalability considerations

**At 100 tenants:**
- Piutang cron scans ~2,000 open invoices (20 avg × 100 Premium tenants) — SQL-indexed query completes in <500ms
- Consolidation window at 5 min → notification storms handled gracefully
- Session health monitor: 100 poll calls per 5 min = 20/min → negligible CPU
- Caleo bot: 100 prospects/day handled by single whatsmeow session

**At 1,000 tenants:**
- Piutang cron scanning ~20,000 invoices — index still fast, but consider sharding by tenant hash across 2 workers (add `WORKER_ID` env var)
- Session health: 1,000 polls per 5 min → move to worker queue (t_jobs) instead of goroutine ticker
- Caleo bot: aspirational 1,000 prospects/day = 500K messages/day — whatsmeow single session may hit WhatsApp rate limits (~5-10K/day soft limit). Add second session round-robin at ~500 prospects/day threshold.
- Template rendering: cached per (tenant, template_id) with 5min TTL — reduces N+1 DB hits

**At 10,000+ tenants** (aspirational):
- Move notification framework to dedicated worker pods (separate Cloud Run service)
- Postgres → per-region read replicas for template lookups
- WhatsApp integration migration to WhatsApp Business API (paid) for higher volume + reliability

## 15. Best practices checklist

**Code quality:**
- ✅ Package-per-responsibility (`internal/notification` for shared framework, `internal/piutang/reminder_poller` for feature-specific)
- ✅ Interface-driven design (`MessageBuilder`, `RecipientResolver` — testable)
- ✅ Typed errors (`ErrQuotaExceeded`, `ErrWASessionOffline`) — no error string matching
- ✅ Context propagation everywhere — cancellable operations
- ✅ Structured logging via `slog` — no `fmt.Printf`

**Data safety:**
- ✅ RLS on every new table
- ✅ Idempotent migrations (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`)
- ✅ Foreign keys with `ON DELETE CASCADE` where lifecycle-tied
- ✅ Indexes on all common query paths (`piutang_reminder_sent(tenant_id, sent_at DESC)`, etc.)
- ✅ Timestamps in `TIMESTAMPTZ` — no local timezone drift

**Reliability:**
- ✅ Retry with backoff (1 hour after first fail, then permanent)
- ✅ Circuit breaker semantics (whatsmeow offline → SKIP not FAIL)
- ✅ Dedup at every rule (invoice_id + rule_type + date)
- ✅ Feature flags for instant kill switch (`tenant_wa_reminder_config.enabled = FALSE`)

**Testing:**
- ✅ Unit tests for template rendering (all variables, edge cases)
- ✅ Integration tests for eligibility SQL (correct/incorrect selection)
- ✅ E2E tests for full send flow with mock WA session
- ✅ Manual verification per feature with real WA to founder's phone

## 16. UX principles for non-tech-savvy MSME owners (detailed)

**Template editor interaction patterns:**

1. **Variable insertion via clickable chips, not typing `{curly_braces}`**
   - Rationale: MSME owner sees `{customer_nama}` in a text field and thinks "why is there code?" → hesitates to edit → doesn't customize
   - Design: chips at top of editor labeled `[+ Nama Customer]`, clicking inserts a visual pill in textarea that renders as blue-highlighted token
   - Fallback: if user pastes raw `{customer_nama}` text, editor auto-converts to chip on blur

2. **WhatsApp bubble preview — real, not schematic**
   - Rationale: owner needs to see EXACTLY what customer sees, not a placeholder box
   - Design: preview panel styled as authentic WhatsApp chat — green header, white message bubble, ✓✓ read receipt, timestamp
   - Sample data pre-filled with realistic Indonesian names: Pak Budi, Toko Jaya Makmur, INV-2607-0142
   - "Ganti data contoh" link to pick a real customer for preview

3. **Test-send to owner's own phone**
   - Rationale: preview is code-rendered — actual WhatsApp rendering may differ (emoji, line breaks, character encoding)
   - Design: "📱 Kirim tes ke HP saya" button prominently below preview
   - Sends actual WA to logged-in owner's registered phone number
   - Feedback toast: "✓ Terkirim ke +62-85X-XXXX-XXXX" with animation

4. **Auto-save on blur — no save button**
   - Rationale: MSME owner used to WhatsApp UX (auto-save) — expects same
   - Design: as owner types, changes tracked in dirty state
   - When owner clicks elsewhere or tabs away: save fires + subtle "✓ Tersimpan" indicator animates
   - No confirm dialogs, no "unsaved changes" warnings — trust auto-save

5. **Reset to default — one click, no confirm**
   - Rationale: reset action is safe (versioned in history — can undo via history)
   - Design: "🔄 Reset ke default" button
   - Single click: reverts + logs to history + shows toast "Template dikembalikan ke default"
   - Undo available via Riwayat Perubahan → click restore on previous version

6. **Character counter with color coding**
   - Rationale: WhatsApp truncates long messages; owner may not know 700-char limit
   - Design: below textarea "187/700 char" — green 0-500, yellow 500-650, red 650+
   - At 700+: block save + tooltip "Pesan terlalu panjang, WhatsApp mungkin potong"

7. **First-time onboarding tour**
   - Rationale: first visit to template editor may confuse — explain 5 key features in 30s
   - Design: overlay tour on first visit (dismissible), highlighting: (1) chip buttons, (2) preview panel, (3) test-send, (4) auto-save indicator, (5) reset button
   - "Jangan tampilkan lagi" checkbox → sets `user_pref.completed_template_editor_tour = TRUE`

**Notification settings dashboard patterns:**

1. **Card-based grid layout** — each notification type as a card (toggle + edit template button + last-fired timestamp)
2. **Toggle state visible at glance** — big green/gray toggle switch, no ambiguity
3. **Default templates always visible + restorable** — no "your changes lost, sorry"
4. **Sensible defaults for time pickers** — 08:00 WIB, 22:00 WIB (business hours) — MSME rarely overrides

**Error state design:**

1. **Plain language error messages**
   - Bad: "phone_number field is null or invalid format"
   - Good: "Nomor WA customer belum diisi, tambahin dulu di menu Pelanggan"
   - Bad: "Rate limit exceeded for tenant subscription tier"
   - Good: "Sudah mengirim 300 WA hari ini (batas paket Premium). Batas reset besok jam 00:00. Untuk kirim lebih banyak, upgrade ke Premium Plus."

2. **Suggest fix inline**
   - Every error message has "Klik untuk memperbaiki" action if applicable
   - Example: "Nomor WA belum diisi. [Buka data customer →]"

3. **Never hide errors — never fail silently**
   - Every send failure surfaces in PiutangScreen badge: "⚠️ H+3 FAILED (retry besok)"
   - Owner can see + acknowledge, no black-box behavior

**Mobile responsive:**
- Template editor collapses to single-column on <768px viewport
- Chip buttons wrap into 2-3 rows on narrow screens
- Preview panel becomes toggleable via "Lihat Preview" button (default: hidden, show on tap)
- All buttons min 44×44px tap target
- All copy in Bahasa Indonesia

## 17. Landing marketing accuracy — follow-up needed after ship

After all 7 sprints ship, update landing:
- Piutang module card: mark "WA reminder otomatis" as (Premium)
- FAQ #7: mention 300/day cap now enforced code-side (was landing-only claim)
- pricing.md v4: sync tier features + remove partial-ship disclosure for B1/B2/B3/B4 items now fixed
- Landing 13 CTAs: swap `wa.me/6285264787775` → `wa.me/{CALEO_ADMIN_WA_NUMBER}` (Sprint 7 delivers Caleo bot)
- Case study or landing add: "Real testimonial from anonymized to named" as feedback pipeline (Sprint 4) matures

Not part of dev sprint estimate. ~1-2 days marketing work.

## 18. Reversibility rating

**Semi-reversible / tactical mix.** No `advisor()` required. Each sprint diff <500 lines. `internal/notification` package is the biggest architectural weight (semi-reversible once adopted); all other changes are tactical/reversible via feature flag or `DROP` migration. Caleo Admin WA Bot (Sprint 7) is fully reversible — undo landing CTAs, delete session.

## 19. Open questions — ALL CLOSED (2026-07-19 brainstorm)

1. ✅ **Tier gating for Piutang WA reminder**: Premium ONLY. Landing update needed.
2. ✅ **Timing**: Fixed H-3 + H+3 rules.
3. ✅ **Template editability**: Content editable, rules fixed. Universal rollout.
4. ✅ **Delivery**: Via tenant's Calista whatsmeow session.
5. ✅ **Manual button**: KEEP with 1×/invoice/day constraint.
6. ✅ **Harmonization scope**: Full — fix B1-B4 before layering Piutang.
7. ✅ **Additional staff notifications**: Piutang overdue + Hutang overdue + Approval SLA breach + Post-order feedback.
8. ✅ **Deferred staff notifications**: Big transaction fraud alert + End of month closing reminder (defer to future).
9. ✅ **Existing notification improvements**: Silent-day + quiet hours + consolidation (add all 3).
10. ✅ **E2E verification scope**: All 7 customer paths (A-G) + PengaturanScreen WA recipient CRUD.
11. ✅ **Session health alert recipient**: Caleo team email (NOT tenant owner — Caleo support fixes proactively).
12. ✅ **Consent capture / customer mute list / notification history**: DEFERRED (founder decision — current trusted-tenant model, revisit at 50+ tenants).
13. ✅ **NEW: Caleo Admin WA Bot** for prospect Q&A + demo showcase — Sprint 7.
14. ✅ **Template versioning + audit**: Added to Sprint 3.
15. ✅ **Order lifecycle refinement**: order_created + order_shipped verified — Sprint 3.
