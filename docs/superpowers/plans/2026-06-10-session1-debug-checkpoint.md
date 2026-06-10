# Session 1 Debug Checkpoint — 2026-06-10

## Current state

### Deployed
- Cloud Run revision: `00024-h9t` (or later) on `https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/`
- Latest bundle: `index-D9yt4tJY.js`
- Latest commit on `origin/main`: `154dd58` (debug logging)

### DB state (verified 2026-06-10 04:19 UTC)
- `approval_requests` row id=516, type=`rakit_lock`, status=`pending` (expires_at past but expiry job hasn't fired)
- `rakit_lock_requests` row id=1 linked to approval 516
- `kasir_transactions` row `9a7727e3-b4af-4995-bd67-a8f710043457`, status=`PENDING_LOCK_APPROVAL`
- Requester: `227c28f4-09f6-4dc9-af7a-01b0feb2c194` (tonywei.office@gmail.com)
- RLS on `approval_requests` is OFF, no policies

### Verified working (don't re-test)
- ✅ Cart UI: add komponen + jasa rakit → save WIP works
- ✅ WIP list shows the transaction
- ✅ LockSubmissionModal: submit lock creates approval_requests + rakit_lock_requests

### Open bug (BLOCKED on user diagnostic)
**Symptom:** Persetujuan inbox shows "0 permintaan terbuka" despite DB having pending row id=516.

**What I've verified server-side:**
- Anon REST query `GET /rest/v1/approval_requests?status=eq.pending` returns the row correctly (1-row array)
- Deployed bundle has `Rakit Lock` filter pill code + `RakitLockApprovalRequestRow` component code
- ApprovalInboxScreen row-render branch at `src/components/approval/ApprovalInboxScreen.tsx:237-257` is correct

**What I need from user:**
- Browser DevTools → Network tab → filter `approval_requests` → click Persetujuan menu → copy **Response body** of the resulting REST call to `/rest/v1/approval_requests?select=*&status=eq.pending&order=requested_at.asc`

**Three possible diagnoses depending on response body:**
1. Response = `[]` → server returning empty for authenticated user (RLS, JWT scope, or some filter)
2. Response = `[{id:516,...}]` → frontend has data but rendering breaks (rakit_lock branch crash silently?)
3. Response = `{code,message}` → query failing (auth expired, etc.)

## How to resume after laptop restart

1. **Reopen Claude Code** in this project folder (`/Users/tonywei/IdeaProjects/ERPAntigravity`)
2. The chat history should persist (Claude Code saves per-project). Open the same session.
3. If chat history is lost, paste this prompt to resume:
   ```
   Resume from docs/superpowers/plans/2026-06-10-session1-debug-checkpoint.md.
   The open bug: Persetujuan inbox shows "0 permintaan terbuka" but DB has approval row id=516.
   I will paste the Network tab Response body now.
   ```
4. Then paste the Response body for the `approval_requests` REST call from your DevTools Network tab.

## Session 2 update (2026-06-10 ~14:30 UTC)

### Server-side conclusively ruled out
- Both `anon` AND `authenticated` roles have SELECT on `approval_requests` (verified via `information_schema.table_privileges`)
- `relrowsecurity=f`, `relforcerowsecurity=f`, 0 rows in `pg_policies` (RLS truly off)
- No `db-pre-request` hook (`pg_settings` has no pgrst/pre-request entries)
- `authenticator` role only preloads `supautils, safeupdate` (no read-side filter)
- Directly via psql with `SET ROLE authenticated` and with `SET ROLE anon`: row 516 returned in both cases
- **Live curl with the user's actual session JWT**: HTTP 200 + row returned (matches user's headers showing `content-range: 0-0/*` = 1 row)

### Client-side narrowing
- User's request to `/rest/v1/approval_requests?...` carried correct `apikey`, `authorization`, `accept-profile: public`, `x-client-info: supabase-js-web/2.106.2`, origin `garindo-jaya-panel-msme-erp-frontend-422860632808.asia-southeast1.run.app`
- User's bundle = `index-D9yt4tJY.js` (confirmed via curl on both Cloud Run aliases)
- User claimed body=`[]` but response headers say 1 row → likely user copied body from a different Network entry than headers came from. **Multiple entries must exist** (initial mount fetch, realtime subscription re-fetch, 30s poll re-fetch). One of them may genuinely return empty.

### Standing hypothesis
The deployed `listPendingApprovals` is called at least once with no Authorization (before supabase-js restores the session from localStorage), gets back empty under some condition we haven't reproduced, then a later call returns the row but state is already set to empty AND… no — `refresh()` always overwrites with the latest fetch result. So this hypothesis doesn't fully explain the UI staying empty.

Alternative: a render-time crash in `RakitLockApprovalRequestRow` could explain blank UI but NOT the "0 permintaan terbuka" header count (which uses `requests.length`, set before render). Unless React tears down on crash and restarts with empty state.

### Next session plan
User installed `chrome-devtools-mcp` so I can inspect the live app directly. Sequence:
1. `mcp__chrome-devtools__new_page` on the Cloud Run URL
2. Wait for user to log in via OTP
3. Navigate to Persetujuan
4. `list_network_requests` filtered by `approval_requests` — see EVERY entry + body
5. `list_console_messages` for any silent errors
6. `evaluate_script` to read `localStorage['sb-*-auth-token']` and inspect React state

## Also pending
- Task #19: `[object Object]` → TypeError Window root cause is **still unknown**. The diagnostic logging is deployed but no console output shared yet. User said they got past the bug somehow ("udah bisa create rakit") — may have been intermittent, may have been a specific input. If it doesn't recur, low priority.
- Task #16: End-to-end smoke test (partially passed: cart + WIP + lock submit work; approval display blocked by current bug).
- Commit `7ace82a` (PRD doc + Mekari summary) was accidentally added by a subagent — user hasn't decided to revert or keep. Low priority.

## Quick commands to verify state after resume

```bash
# Check current commit
cd /Users/tonywei/IdeaProjects/ERPAntigravity && git log --oneline -3

# Check DB state of the test approval
PSQL=/opt/homebrew/Cellar/libpq/18.4/bin/psql
PGPASSWORD='cgJ?mveH2%3/Z/z' $PSQL \
  "host=aws-1-ap-northeast-1.pooler.supabase.com port=5432 user=postgres.ekhhojaezdfjfwuxyjkl dbname=postgres sslmode=require" \
  -c "SELECT id, request_type, status FROM approval_requests WHERE id = 516;"

# Verify deployed bundle has rakit code
curl -s "https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/" \
  | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1
```
