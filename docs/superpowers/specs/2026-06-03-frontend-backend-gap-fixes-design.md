---
name: frontend-backend-gap-fixes
description: Design for closing 5 identified gaps between frontend and backend — missing migrations, fake auth, localStorage-only admin users, redundant Go stock API, and missing health indicator.
metadata:
  type: project
---

# Frontend ↔ Backend Gap Fixes

**Date:** 2026-06-03  
**Status:** Approved — proceeding to implementation plan

## Problem Summary

A gap audit revealed 5 mismatches between what's built on the frontend vs backend:

| Priority | Gap | Impact |
|---|---|---|
| P1 | `company_settings` table has no migration file | Breaks fresh deployment — InvoiceModal + PengaturanScreen fail |
| P1 | `stocks` table has no migration file | Breaks fresh deployment — StockManagerScreen + AI stock search fail |
| P2 | AuthScreen uses simulated OTP + hardcoded user | Security risk in production; `verified_by` field is fictional |
| P3 | UserManagementScreen is localStorage-only | Admin data is device-local; lost on browser clear |
| P4 | Go `/api/stocks` REST API is redundant | Dual write path; frontend talks directly to Supabase instead |

## P1: Add Missing Migration Files

### `company_settings`
Applied directly to Supabase via MCP during F1 Order History work. Needs a versioned migration file.

```sql
CREATE TABLE IF NOT EXISTS company_settings (
  id    int PRIMARY KEY DEFAULT 1,
  company_name  text,
  address       text,
  phone         text,
  email         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read company_settings" ON company_settings FOR SELECT TO anon USING (true);
GRANT SELECT ON company_settings TO anon;
GRANT INSERT, UPDATE ON company_settings TO anon;
INSERT INTO company_settings (id, company_name) VALUES (1, 'Garindo Jaya Panel')
  ON CONFLICT (id) DO NOTHING;
```

### `stocks`
Documented as manual SQL in `backend-go/README.md`. Needs a versioned migration file.

```sql
CREATE TABLE IF NOT EXISTS public.stocks (
  sku        VARCHAR(50) PRIMARY KEY,
  name       TEXT NOT NULL,
  category   VARCHAR(100) NOT NULL,
  price      NUMERIC NOT NULL,
  stock      INT NOT NULL,
  status     VARCHAR(50) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow Public Access" ON public.stocks FOR ALL USING (true) WITH CHECK (true);
```

Both files use `IF NOT EXISTS` so they're safe to apply against an existing database.

## P2: Wire AuthScreen to Supabase Auth

Replace simulated OTP flow with Supabase magic link (OTP via email):

- `handleSendSignInOtp` → calls `supabase.auth.signInWithOtp({ email })`
- `handleSignInSubmit` → calls `supabase.auth.verifyOtp({ email, token, type: 'email' })`
- On success: read `user.email` from session; look up display name from `wa_recipients` or use email prefix as fallback
- On auth state change: `supabase.auth.onAuthStateChange` to handle session persistence
- Sign Up flow: same OTP path (Supabase handles new vs existing user automatically with magic link)
- `handleLogout` in App.tsx: call `supabase.auth.signOut()`
- Remove: hardcoded `simulatedCode`, `123456` backdoor, hardcoded avatar URL, hardcoded `name/role`

`currentUser` shape becomes: `{ name: string, role: string, email: string, avatarUrl: string, storeName: string }`  
`name` = display name from `wa_recipients` where `wa_number` matches, or email prefix  
`role` = hardcoded `'Owner'` for now (role management is P3)  
`storeName` = from `company_settings.company_name`

## P3: Wire UserManagementScreen to Supabase

Add `admin_users` table to Supabase. Map existing `AdminUser` interface to DB rows.

```sql
CREATE TABLE IF NOT EXISTS admin_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  whatsapp    text,
  role        text NOT NULL DEFAULT 'Staff',
  permissions jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_users TO anon;
CREATE POLICY "anon full access admin_users" ON admin_users FOR ALL TO anon USING (true) WITH CHECK (true);
```

Add `adminUsersService` to `supabaseClient.ts`:
- `fetchAll()` — returns `AdminUser[]`
- `upsert(user)` — insert or update
- `remove(id)` — delete

Update `UserManagementScreen` to use service instead of `onAdminsUpdate` prop.  
Update `App.tsx` to remove `admins` localStorage state.

## P4: Remove Redundant Go `/api/stocks` REST API (Optional / Deferred)

The Go daemon's `/api/stocks` endpoints are dead code from the frontend's perspective. Options:
- **Keep as-is**: the daemon exposes them but nothing calls them. Low risk, low reward to remove.
- **Remove**: clean up `main.go` — remove `handleStocksRoute`, `handleSingleStockRoute`, and their helper structs.

Recommendation: **defer P4** — removing live HTTP routes is a breaking change for any tool/admin that might call them directly. Not worth the risk now.

## P5: Health Badge (Deferred)

Add a small "daemon: online/offline" indicator to WhatsappAiScreen using the existing `/api/health` endpoint. Deferred — low priority cosmetic change.

## Implementation Order

1. P1a — `company_settings` migration file  
2. P1b — `stocks` migration file  
3. P2 — Supabase Auth in AuthScreen + App.tsx logout  
4. P3 — `admin_users` table + UserManagementScreen service wiring  

P4 and P5 deferred.
