# Task 3.4 Report — Universal NotificationTemplatesScreen + History Modal

## Status
DONE — lint clean, 28 tests pass.

## Commit
TBD (committing after this report)

## Files Created/Modified
- **Created** `src/components/pengaturan/NotificationTemplatesScreen.tsx`
- **Created** `src/components/notification/TemplateHistoryModal.tsx`
- **Modified** `src/lib/urlRoute.ts` — added `notification-templates` to ACTIVE_PAGES whitelist
- **Modified** `src/types.ts` — added `notification-templates` to ActivePage union
- **Modified** `src/App.tsx` — import + case `notification-templates`
- **Modified** `src/components/PengaturanScreen.tsx` — nav button in whatsapp-ai tab

Total: 2 new, 4 modified.

## Key Decisions

### Go default string alignment
- `order_created`: Brief had "Kami akan info kalau pesanan sudah siap dikirim" but Go `DefaultOrderCreatedTemplate` says "Kami akan segera proses pesanan Anda." — **used Go constant verbatim**.
- `order_shipped`: Brief had "sudah kami kirim!" but Go `DefaultOrderShippedTemplate` says "Anda sudah selesai kami proses!" — **used Go constant verbatim**.
- `booking_expiry`: No Go const (uses `fmt.Sprintf`), reconstructed string from Go source — matches brief exactly.
- `heartbeat_digest`: No Go const (uses `strings.Builder` + `formatRp`), Go produces dynamic format strings. Used brief's canonical default: `"📊 *Ringkasan Hari Ini — {tanggal}*\n\n💰 Omset: Rp {omset_hari}\n💵 Laba: Rp {laba_hari}\n\n⚠️ Stok menipis: {low_stock_count} item"`.
- `staff_escalation_payment`, `followup_customer`: No Go files yet — used brief defaults.

### Import fix
Brief had `from '../../lib/supabase'` but this project uses `from '../../lib/supabaseClient'` (matching PiutangWaReminderScreen). Fixed.

### saveTemplate race condition fix
Brief's `resetDefault` called `saveTemplate()` after `setTemplates()` but `saveTemplate` read stale closure state. Fixed by passing `contentOverride` param to `saveTemplate()` so reset/restore call `saveTemplate(content)` directly with the new value.

## Concerns
- `send_notification_test` RPC (for test-send button) does not exist in the codebase yet — the button will show `error.message` if pressed. Not a blocker for this task; the RPC is a Phase 3 follow-up.
- heartbeat_digest's `{omset_hari}` and `{laba_hari}` are stored as pre-formatted strings in the DB template; the Go backend currently formats these with `formatRp()` before substitution. When custom template support is wired into heartbeat_digest.go, the backend will need to accept pre-formatted values (already the case for the default path via `renderSimple`).
