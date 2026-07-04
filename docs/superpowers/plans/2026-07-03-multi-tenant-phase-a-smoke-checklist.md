# Phase A — Smoke Checklist (Local Supabase Docker)

## Prerequisites
- [ ] `supabase --version` >= 1.170
- [ ] `docker ps` shows running Docker
- [ ] Repo on branch that contains all Phase A migrations

## Pre-test: Auth Hook Registration

**Manual step in Supabase Dashboard:**
- [ ] Supabase Dashboard → Authentication → Hooks → Custom Access Token
- [ ] Enable hook
- [ ] Point to: `public.custom_access_token_hook`
- [ ] Save
- [ ] This must complete BEFORE running frontend login smoke tests below

## Steps

- [ ] `supabase start` — expect all containers healthy
- [ ] `supabase db reset` — expect all migrations apply cleanly (watch for RAISE NOTICE lines)
- [ ] `./scripts/verify-migrations.sh` — expect "OK" output
- [ ] `for f in supabase/tests/pgtap/*.sql; do supabase test db --file "$f"; done` — expect all pgTAP tests pass
- [ ] `npm run test:isolation` — expect all cross-tenant + expiry + impersonation tests pass
- [ ] Manual browser smoke (against local Supabase + local FE `npm run dev`):
  - [ ] Login as tonywei.office@gmail.com via OTP — redirected to `/admin` (super-admin path)
  - [ ] From `/admin`, enter slug "garindo" → impersonate → land on `/t/garindo/dashboard`
  - [ ] All existing Garindo screens load (dashboard, sales, stok, kasir, pengaturan, laporan)
  - [ ] No console errors
  - [ ] Header injection: DevTools → Network → any Supabase request → confirm JWT claim contains tenant slug in `custom_access_token_hook` payload
  - [ ] Exit impersonation → back to `/admin`
- [ ] Legacy redirect check: type `/dashboard` in URL bar → should auto-redirect to `/t/garindo/dashboard`
- [ ] Read-only mode simulation:
  - [ ] `supabase db psql -c "UPDATE tenant_subscriptions SET expires_at='2020-01-01' WHERE tenant_id='11111111-1111-1111-1111-111111111111';"`
  - [ ] Refresh browser → red banner appears
  - [ ] Any write button (e.g., "Simpan" in Pengaturan) → error toast SUBSCRIPTION_EXPIRED_READONLY
  - [ ] Restore: `UPDATE tenant_subscriptions SET expires_at='2099-12-31' WHERE ...`
