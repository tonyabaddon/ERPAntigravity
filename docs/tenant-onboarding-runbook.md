# Tenant Onboarding Runbook

**Audience:** VOSI platform admin doing manual onboarding until Phase B Wave 2
wizard UI ships.

**Goal:** get a new tenant from zero to "owner can log in and see their
dashboard" without hitting the bugs we surfaced on 2026-07-07/08 (tenant
isolation leak, tenant_users RLS 42P17, missing admin_users row, hardcoded
`Garindo Jaya Panel` branding, etc.).

**Time estimate:** 5-10 minutes per tenant.

---

## Prerequisites

- Access to Supabase Dashboard (project `ekhhojaezdfjfwuxyjkl`) as a platform admin.
- Access to run SQL via Supabase MCP or the SQL Editor.
- The owner's email address (real inbox they can receive OTP at, or Gmail
  plus-alias like `founder+customer@gmail.com` for demo tenants).

---

## Step 1 — Create the owner user via Supabase Auth Admin API

Do NOT insert into `auth.users` directly. GoTrue expects several text columns
(`confirmation_token`, `recovery_token`, `email_change*`, `reauthentication_token`,
`phone_change*`) to be empty strings, not NULL. Raw INSERT skips those and login
fails with `500: sql: Scan error on column index 3, name "confirmation_token"`.

Two safe ways:

**Option A — Supabase Dashboard UI:**
1. Authentication → Users → **Add user** → **Create new user**.
2. Fill email + a temporary password (owner will rotate via OTP later, or use
   password reset flow).
3. Toggle **Auto Confirm User** ON so `email_confirmed_at` is stamped now.
4. Optionally set User Metadata: `{"full_name": "Owner Name", "store_name": "Tenant Display Name"}`.
   The `store_name` field is a nice-to-have; the tenant dashboard reads its
   display name from `tenants.name` via the `bootstrap_tenant_context` RPC.
5. Copy the newly-created user's UUID (shown in the row).

**Option B — Edge Function using service_role:**
```typescript
const { data, error } = await supabaseAdmin.auth.admin.createUser({
  email: 'owner@newtenant.com',
  password: crypto.randomUUID(), // rotated on first login
  email_confirm: true,
  user_metadata: { full_name: 'Owner Name', store_name: 'Tenant Display Name' },
});
```

## Step 2 — Call `provision_tenant` RPC

One atomic call seeds `tenants` + `tenant_subscriptions` + `tenant_users` +
`admin_users`. Callable by any platform admin JWT.

Via MCP `execute_sql` (or Supabase SQL Editor after setting a platform-admin
JWT via `SET LOCAL request.jwt.claims = '...'`):

```sql
SELECT public.provision_tenant(
  p_owner_user_id     := '<owner-uuid-from-step-1>',
  p_slug              := 'toko-jaya-makmur',      -- 3-30 chars, [a-z0-9-]
  p_name              := 'Toko Jaya Makmur',       -- shown in dashboard header
  p_owner_name        := 'Demo Owner',             -- shown in sidebar
  p_owner_email       := 'owner@newtenant.com',    -- must match auth.users.email
  p_plan_code         := 'PREMIUM',                -- STARTER | PRO | PREMIUM
  p_expires_in_months := 12
);
```

Response (jsonb):
```json
{
  "tenant_id": "...",
  "slug": "toko-jaya-makmur",
  "name": "Toko Jaya Makmur",
  "plan_code": "PREMIUM",
  "activated_at": "...",
  "expires_at": "...",
  "owner_user_id": "..."
}
```

Failure modes:
- `P0403` — caller is not a platform admin
- `22023` — slug format invalid, plan_code invalid, or name empty
- `P0002` — `p_owner_user_id` not found in `auth.users` (repeat Step 1)
- `23505` — slug already exists (pick a different one)

## Step 3 — Verify

Owner logs in via `https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/`
using their email + password (from Step 1) OR OTP (email must arrive at owner's
inbox).

Expected post-login:
- URL: `/t/<slug>/dashboard?screen=dashboard`
- Sidebar: **VOSI** (product brand, static)
- Header top: `tenants.name` value from Step 2
- Dashboard heading: `Selamat Datang di Hub Kendali <tenants.name>`
- Empty KPI state (Rp 0 / 0 transaksi / etc.) — data will fill as they use the app
- Footer: `© 2026 VOSI MSME ERP • Powered by DeepMind & Gemini AI`

Quick SQL sanity check the seed worked:
```sql
SELECT t.slug, t.name, s.plan_code, s.expires_at,
       tu.role AS membership_role, au.role AS admin_role
FROM public.tenants t
JOIN public.tenant_subscriptions s USING (tenant_id)
JOIN public.tenant_users tu ON tu.tenant_id = t.id
JOIN public.admin_users au ON au.id = tu.user_id
WHERE t.slug = '<slug>';
-- Expect one row: membership_role='owner', admin_role='Owner'.
```

## Step 4 — Optional master-data seeding

`provision_tenant` seeds only the minimum needed to log in. For a demo tenant
that needs sample content, follow-up seed SQL (idempotent per tenant):

- `chart_of_accounts` — 62-row default COA. There's a trigger
  `_seed_company_settings_for_new_tenant` that auto-inserts `company_settings`
  when the tenants row is created; check whether COA follows a similar path or
  needs manual copy from a template tenant.
- `warehouses`, `product_categories`, `product_brands`, `product_units`,
  `bank_config`, `approval_settings`, `piutang_settings`, etc. — clone from
  a template tenant if your product requires them for empty-state rendering.
- `stocks`, `customers`, `suppliers`, `cash_accounts` — real tenant data;
  they populate as the tenant uses the app.

For demo tenants like Toko Jaya Makmur, we hand-seeded 20 SKU / 10 customers /
5 suppliers / 3 cash accounts via ad-hoc SQL. That workflow is captured in
`progress.md` under the 2026-07-07 entries.

## Step 5 — Set `company_settings.nama_toko` (optional but recommended)

Invoice PDFs, receipts, Neraca/LabaRugi reports read the tenant's display
name from `company_settings.nama_toko`. If unset they fall back to
`Toko Anda` / `Perusahaan Anda`. Set it early:

```sql
UPDATE public.company_settings
SET nama_toko = '<tenants.name>'
WHERE tenant_id = '<tenant-uuid>';
```

## Gotchas we've hit

1. **NULL text fields in `auth.users`.** If you accidentally insert into
   `auth.users` raw, run this to unbreak login:
   ```sql
   UPDATE auth.users SET
     confirmation_token = COALESCE(confirmation_token, ''),
     recovery_token = COALESCE(recovery_token, ''),
     email_change_token_new = COALESCE(email_change_token_new, ''),
     email_change = COALESCE(email_change, ''),
     email_change_token_current = COALESCE(email_change_token_current, ''),
     reauthentication_token = COALESCE(reauthentication_token, ''),
     phone_change = COALESCE(phone_change, ''),
     phone_change_token = COALESCE(phone_change_token, '')
   WHERE id = '<owner-uuid>';
   ```

2. **`admin_users` row missing.** AuthScreen's post-OTP guard is
   `fetchByEmail(signInEmail)` — no row → "Email belum terdaftar sebagai admin".
   `provision_tenant` inserts this, but if you seeded manually and forgot,
   add it (matching Garindo's Owner permission shape — see
   `20261115000029_provision_tenant_rpc.sql` for the JSON template).

3. **Slug ≠ current tenant → guard redirects.** The URL slug guard in
   `App.tsx` redirects `/t/wrongslug/*` to `/t/<jwt-slug>/dashboard`. If a
   customer bookmarks the wrong URL, they'll be corrected. Expected behavior.

4. **`tenant_users` RLS — historically 42P17 for non-admin.**
   Closed by migration 20261115000030 (SECDEF `_is_tenant_admin` helper
   replaces the recursive EXISTS). Direct `.from('tenant_users')` SELECT
   now works for non-admin users, scoped to their own memberships. Older
   frontend code that still uses `bootstrap_tenant_context` for slug lookup
   remains correct; the migration is orthogonal.

5. **Cross-tenant view leaks.** All public views must be `security_invoker=true`.
   Migration `20261115000028_secinvoker_view_isolation.sql` set this for the
   13 existing views. New views must include the setting; check with:
   ```sql
   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND COALESCE((SELECT bool_or(opt LIKE 'security_invoker=true')
                   FROM unnest(c.reloptions) opt), false) = false;
   ```
   All public views should be `security_invoker=true` — no exceptions since
   migration 20261115000030 closed the tenant_users recursion.
