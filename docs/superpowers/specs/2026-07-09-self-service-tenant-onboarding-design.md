# Self-Service Tenant Onboarding Design

**Status:** Draft — awaiting user approval
**Author:** Claude Opus 4.7 + tonywei
**Date:** 2026-07-09

## Success Criterion

Sales rep dapat onboard tenant baru dari awal sampai owner login sukses,
**tanpa harus escalate ke founder** (kecuali destructive rollback yang
memang designed founder-only).

## Scope: 5 MUST-HAVE Items

1. **Edge Function `create-tenant-owner`** — wrap Supabase Auth Admin API +
   provision_tenant RPC dengan compensating rollback.
2. **Sales Rep role + lifecycle** — new enum column `platform_admins.role`
   + status column + JWT claim + RLS gates + UI hides + admin UI untuk
   founder add/deactivate rep.
3. **`deprovision_tenant` RPC + UI** — hard delete tenant dengan audit
   log. Super_admin only.
4. **Slug blocklist** — reserved words check di Edge Function.
5. **Broad sales rep operational access** — RLS + RPC updates supaya
   sales_rep bisa: assign paket (update_plan_admin), toggle module,
   record payment (record_payment). Payment tab TIDAK di-narrow — sales
   rep butuh access untuk validasi transfer.

## Out of Scope (explicitly deferred)

- Slug availability real-time pre-check UI (accepts inline error on submit)
- Owner welcome checklist di dashboard tenant baru
- Master data auto-seed (kategori/gudang/satuan)
- Sales rep dashboard filter (rep sees all tenants, hanya delete yang gated)
- Resend invite button (OTP fallback via login page cukup untuk MVP)
- Payment gateway integration (offline transfer + admin manual entry via
  existing Wave 5 `/admin/tenants/<slug>?tab=pembayaran`)

## Section 1: Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  VOSI Admin Panel (Sales Rep or Super Admin)                │
│  /admin/tenants/new (existing wizard)                       │
│  /admin/tenants/<slug> (add "Hapus tenant" button — super)  │
└────┬────────────────────────────────────────────┬───────────┘
     │                                            │
     │ POST                                       │ POST
     ▼                                            ▼
┌─────────────────────┐            ┌──────────────────────┐
│ Edge Function       │            │ RPC: deprovision_    │
│ create-tenant-owner │            │ tenant(tenant_id)    │
│                     │            │                      │
│ - Verify caller is  │            │ - Verify caller is   │
│   platform_admin    │            │   super_admin (only) │
│ - Validate slug     │            │ - DELETE 5 tables    │
│   (regex+blocklist) │            │   atomically         │
│ - Auth Admin API:   │            │ - INSERT audit_log   │
│   inviteUserByEmail │            │ - auth.users kept    │
│   +email_confirm    │            │                      │
│ - RPC: provision_   │            └──────┬───────────────┘
│   tenant()          │                   │
│ - Rollback on fail  │                   │
└────┬────────────────┘                   │
     │                                    │
     ▼                                    ▼
┌────────────────────────────────────────────────────────────┐
│                   Supabase Postgres                        │
│  auth.users (invite email sent by Supabase)                │
│  tenants + tenant_subscriptions + tenant_users +           │
│  admin_users + store_settings (seeded/deleted atomik)      │
│  platform_admins (NEW column: role='super_admin'|'sales_   │
│                    rep', default 'super_admin')            │
│  audit_log (DEPROVISION_TENANT event)                      │
└────────────────────────────────────────────────────────────┘
```

### Design decisions

1. **Edge Function di Supabase, bukan Cloud Run.** Butuh service_role
   untuk `auth.admin.*`. Edge Function membaca secret aman, tidak leak
   ke frontend.
2. **Sales Rep role via kolom enum**, bukan matrix permission — YAGNI
   compliance untuk 2 role stereotype awal. Migrate ke matrix kalau
   >5 role stereotypes muncul.
3. **Deprovision = hard delete**, bukan soft delete. Reason: sales rep
   typo cleanup butuh slug/email bebas untuk retry.
4. **auth.users TIDAK di-delete** saat deprovision. Owner bisa punya
   tenant lain; email bisa di-retry.
5. **Compensating rollback** di Edge Function: jika provision_tenant
   gagal setelah `auth.users` terbentuk, delete user via admin API.
6. **Super_admin universal override** untuk deprovision — no
   "creator-only" restriction (user explicit choice: security > velocity).
7. **Rate limit awareness** — Supabase Auth default 10 invite/hour per
   IP. Sales tim >3 orang di 1 kantor bisa hit; document sebagai
   monitoring point, bukan implement custom limiter.

## Section 2: Component Details

### C1: Edge Function `create-tenant-owner`

**Location:** `supabase/functions/create-tenant-owner/index.ts`

**Endpoint:** `POST /functions/v1/create-tenant-owner`

**Auth:** Supabase built-in JWT verification (`verify_jwt=true`) +
manual check `platform_admin_role` claim in ('super_admin', 'sales_rep').

**Input schema:**
```typescript
{
  slug: string;              // 3-30 chars, lowercase, alphanumeric+dash
  name: string;              // Display name
  plan_code: 'STARTER' | 'PRO' | 'PREMIUM';
  expires_in_months: number; // 1-60
  owner_email: string;       // Valid email, will receive invite
  owner_name: string;        // Display name for admin_users.name
}
```

**Output schema:**
```typescript
// Success
{ tenant_id: string; slug: string; owner_user_id: string; expires_at: string }
// Error
{ error: string; code: 'E1'|'E2'|...; message: string }
```

**Logic (pseudocode):**
```typescript
export default async (req: Request) => {
  // 1. Verify JWT + role
  const jwt = extractJwt(req);
  if (!jwt) return err(401, 'E1', 'Sesi expired');
  if (!isPlatformAdmin(jwt)) return err(403, 'E2', 'Akses ditolak');

  // 2. Parse + validate input
  const input = await req.json();
  if (!validSlugFormat(input.slug)) return err(400, 'E3', '...');
  if (isReservedSlug(input.slug)) return err(400, 'E4', '...');

  // 3. Pre-check slug availability
  const { data: exists } = await sb.from('tenants').select('id')
    .eq('slug', input.slug).maybeSingle();
  if (exists) return err(409, 'E5', 'Slug sudah dipakai');

  // 4. Create auth.users via invite
  const { data: user, error: authErr } = await sbAdmin.auth.admin
    .inviteUserByEmail(input.owner_email, { data: {}, email_confirm: true });
  if (authErr) return mapAuthErr(authErr);  // E7, E8

  // 5. Provision tenant (with rollback on failure)
  try {
    const { data: tenant, error: rpcErr } = await sb.rpc('provision_tenant', {
      p_owner_user_id: user.id,
      p_slug: input.slug,
      p_name: input.name,
      p_owner_name: input.owner_name,
      p_owner_email: input.owner_email,
      p_plan_code: input.plan_code,
      p_expires_in_months: input.expires_in_months,
    });
    if (rpcErr) throw rpcErr;
    return json({ tenant_id: tenant.tenant_id, slug: input.slug,
                  owner_user_id: user.id, expires_at: tenant.expires_at });
  } catch (rpcErr) {
    // ROLLBACK — critical for zero-orphan guarantee
    await sbAdmin.auth.admin.deleteUser(user.id);
    return err(500, 'E9', 'Gagal simpan tenant, data owner sudah cleanup, retry');
  }
};
```

**Reserved slugs blocklist:**
```typescript
const RESERVED_SLUGS = [
  'admin', 'api', 'auth', 'login', 'logout', 'register', 'signup', 'signin',
  'www', 'mail', 'blog', 'docs', 'help', 'support', 'settings', 'pengaturan',
  't', 'select-tenant', 'onboarding', 'billing',
];
```

**Reuse:** wizard `TenantWizard.tsx` submit sekarang panggil endpoint ini
(ganti direct `provision_tenant` call). Existing `provision_tenant` RPC
di-reuse via step 5.

---

### C2: Sales Rep role

**Migration (`20261115000032_sales_rep_role.sql`):**
```sql
ALTER TABLE public.platform_admins
  ADD COLUMN role TEXT NOT NULL DEFAULT 'super_admin'
  CHECK (role IN ('super_admin', 'sales_rep')),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'disabled'));

-- All existing platform_admins → super_admin + active (backward compat).
-- Sales rep baru: INSERT via create_sales_rep RPC.
-- Resign / suspend: UPDATE status='disabled' (audit trail lebih baik dari DELETE).
```

**Auth Hook update (ALTER FUNCTION existing `custom_access_token_hook`):**

Bukan create new — modify function yang sudah production di Phase A.
Extend logic untuk:
- Read `platform_admins.role` + `status` for the user
- If `status='disabled'` → skip role claim (JWT tidak mendapat platform admin claim)
- Else expose sebagai claim `platform_admin_role` di JWT

Backward compat: existing `is_platform_admin` claim tetap true untuk BOTH
super_admin + sales_rep, jadi existing code jalan. New code cek claim
baru `platform_admin_role` untuk role-specific gates.

**Helper functions:**

```sql
-- NEW: strict super_admin check
CREATE OR REPLACE FUNCTION public._is_super_admin_from_jwt()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb->>'platform_admin_role') = 'super_admin',
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public._is_super_admin_from_jwt() TO authenticated;

-- Existing _is_platform_admin_from_jwt() UNCHANGED — returns true
-- for BOTH super_admin and sales_rep (backward compat).
```

**RLS updates:**

| Table | Command | Rule after migration |
|---|---|---|
| tenants | SELECT | `_is_platform_admin_from_jwt()` — both roles |
| tenants | INSERT/UPDATE/DELETE | `_is_super_admin_from_jwt()` — super only |
| tenant_subscriptions | SELECT | `_is_platform_admin_from_jwt()` |
| tenant_subscriptions | UPDATE (via `update_plan_admin` SECDEF) | Both roles via RPC |
| tenant_subscriptions | INSERT/DELETE (direct or via `renew_subscription`) | Super only |
| tenant_payments | SELECT | `_is_platform_admin_from_jwt()` — both roles |
| tenant_payments | INSERT (via `record_payment` SECDEF) | Both roles |
| tenant_payments | UPDATE/DELETE | Super only |
| tenant_features / tenant_feature_overrides | SELECT | Both roles |
| tenant_features / tenant_feature_overrides | UPDATE (via module toggle RPC) | Both roles |
| plans | ALL | Super only — UNCHANGED |

**RPC auth check updates:**

Existing RPCs perlu ubah gate dari `_is_platform_admin_from_jwt()` ke
allow-list eksplisit:

| RPC | Existing gate | New gate |
|---|---|---|
| `provision_tenant` | platform_admin | UNCHANGED (both roles OK) |
| `update_plan_admin` | super_admin (assume) | platform_admin (kedua role) |
| `record_payment` | platform_admin | UNCHANGED (both roles OK) |
| `renew_subscription` | platform_admin | narrow to super_admin |
| `suspend_tenant` / `activate_tenant` | platform_admin | narrow to super_admin |
| `deprovision_tenant` (NEW) | — | super_admin only |
| `create_sales_rep` (NEW) | — | super_admin only |
| `deactivate_sales_rep` (NEW) | — | super_admin only |

**Sales rep operational path:** semua modification lewat SECDEF RPC.
Direct table INSERT/UPDATE untuk sales_rep = blocked. Ini simplify audit
+ enforce business logic centralized di RPC.

**Super admin exemption:** super_admin punya `_is_platform_admin_from_jwt()`
true + `_is_super_admin_from_jwt()` true. Bisa panggil semua RPC + direct
table writes untuk edge cases.

**UI gates (client-side):**

Update existing `isSuperAdmin()` helper in `src/lib/adminAuth.ts`:
```typescript
// Baca JWT claim `platform_admin_role`, return true jika === 'super_admin'
// Fallback ke existing `is_platform_admin` claim untuk backward compat
// (pre-migration users).
```

Sidebar (`AdminLayout.tsx`):
- Hide `/admin/plans` link jika `!isSuperAdmin()`
- Hide `/admin/revenue` link jika `!isSuperAdmin()`
- Hide `/admin/sales-reps` link jika `!isSuperAdmin()` (route baru — see C5)

TenantDetailShell — conditional UI berdasarkan role:

| Section | Super Admin | Sales Rep |
|---|---|---|
| Ringkasan tab | View all fields | View all fields |
| Pengguna tab | Full manage | View only (add/edit/delete hidden) |
| Log aktivitas tab | View all | View all |
| Pembayaran tab (Wave 5) | View + Catat Pembayaran + Edit/Delete | View + Catat Pembayaran (edit/delete hidden) |
| Paket & Modul (via update_plan_admin) | Full edit | Full edit |
| Suspend / Activate button (Wave 4a) | Visible | Hidden |
| Renew Subscription button (Wave 4a) | Visible | Hidden |
| Delete tenant (Zona Bahaya — NEW) | Visible | Hidden |

---

### C3: `deprovision_tenant` RPC + UI

**Migration (`20261115000033_deprovision_tenant.sql`):**

```sql
CREATE OR REPLACE FUNCTION public.deprovision_tenant(
  p_tenant_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_snapshot JSONB;
BEGIN
  -- Auth gate: super_admin ONLY
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION 'deprovision_tenant: super_admin required'
      USING errcode = 'P0403';
  END IF;

  -- Snapshot for audit
  SELECT to_jsonb(t.*) INTO v_tenant_snapshot
  FROM public.tenants t WHERE t.id = p_tenant_id;

  IF v_tenant_snapshot IS NULL THEN
    RAISE EXCEPTION 'deprovision_tenant: tenant % not found', p_tenant_id
      USING errcode = 'P0002';
  END IF;

  -- Delete atomically (cascade order matters — FK aware)
  DELETE FROM public.admin_users WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenant_users WHERE tenant_id = p_tenant_id;
  DELETE FROM public.store_settings WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenants WHERE id = p_tenant_id;

  -- Audit trail
  INSERT INTO public.audit_log (event_type, payload, created_at)
  VALUES (
    'DEPROVISION_TENANT',
    jsonb_build_object(
      'tenant_snapshot', v_tenant_snapshot,
      'reason', p_reason,
      'actor_user_id', auth.uid()
    ),
    now()
  );

  RETURN jsonb_build_object(
    'deleted_slug', v_tenant_snapshot->>'slug',
    'deleted_at', now(),
    'actor', auth.uid()
  );
END;
$function$;

ALTER FUNCTION public.deprovision_tenant(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.deprovision_tenant(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deprovision_tenant(UUID, TEXT) TO authenticated;
```

**UI: `DeleteTenantModal.tsx`**

Location: `src/components/admin/TenantDetail/DeleteTenantModal.tsx`

Modal pattern (see Section 2 wireframe):
- Alasan hapus (textarea, required)
- Ketik ulang slug untuk konfirmasi (input, must match)
- Cancel + Hapus Permanen buttons

Integration point: TenantDetailShell — new "Danger Zone" section
rendered conditionally based on `isSuperAdmin()`.

Reuse: existing `RenewSubscriptionModal.tsx` (Wave 4a) structural pattern
+ `adminToast` for success/error feedback.

---

### C4: Slug blocklist

Trimmed list (10 items, hanya route collisions real):
```typescript
const RESERVED_SLUGS = [
  'admin', 't', 'select-tenant',       // Wajib — direct URL clash
  'api', 'auth', 'login', 'register',  // Sebaiknya — future routes
  'signup', 'signin', 'settings',      // Sebaiknya — Supabase Auth defaults
];
```

Removed dari draft awal: `www, mail, blog, docs, help, support,
pengaturan, onboarding, billing` — over-paranoid, no actual collision.

### C5: Sales rep management (add/deactivate)

**Status:** NEW. Tanpa ini founder tetap manual SQL setiap tambah sales rep
= sales team growth tetap bottleneck.

**RPC: `create_sales_rep(p_email, p_name)` — SECDEF, super_admin only.**

```sql
CREATE OR REPLACE FUNCTION public.create_sales_rep(
  p_email TEXT,
  p_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION 'create_sales_rep: super_admin required' USING errcode = 'P0403';
  END IF;
  IF p_email IS NULL OR p_email !~ '^[^ ]+@[^ ]+\.[^ ]+$' THEN
    RAISE EXCEPTION 'create_sales_rep: invalid email' USING errcode = '22023';
  END IF;

  -- auth.users must be created first via Edge Function
  -- (mirror pattern of create-tenant-owner: invite email)
  -- This RPC assumes v_user_id sudah exist di auth.users.
  -- Called by Edge Function `invite-sales-rep` yang wrap auth.admin.inviteUserByEmail.

  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'create_sales_rep: user_id not found for %', p_email
      USING errcode = 'P0002';
  END IF;

  INSERT INTO public.platform_admins (user_id, role, status, name)
  VALUES (v_user_id, 'sales_rep', 'active', p_name);

  RETURN jsonb_build_object('user_id', v_user_id, 'email', p_email, 'name', p_name);
END;
$function$;
```

**Edge Function `invite-sales-rep`** (companion untuk create_sales_rep):
- Same pattern sebagai `create-tenant-owner` tapi lebih simple
- inviteUserByEmail → RPC create_sales_rep → return
- Compensating rollback jika RPC gagal

**RPC: `deactivate_sales_rep(p_user_id, p_reason)` — SECDEF, super_admin only.**

```sql
CREATE OR REPLACE FUNCTION public.deactivate_sales_rep(
  p_user_id UUID, p_reason TEXT
) RETURNS JSONB ...
AS $function$
BEGIN
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION '...' USING errcode = 'P0403';
  END IF;

  UPDATE public.platform_admins SET status='disabled'
  WHERE user_id = p_user_id AND role = 'sales_rep';

  INSERT INTO public.audit_log (event_type, payload)
  VALUES ('DEACTIVATE_SALES_REP', jsonb_build_object(...));

  -- Note: existing JWT tetap valid sampai expire (~1 jam).
  -- Immediate revoke butuh Supabase Auth force-logout (nice-to-have).

  RETURN jsonb_build_object('user_id', p_user_id, 'deactivated_at', now());
END;
$function$;
```

**UI: `/admin/sales-reps` route (NEW).**

Simple list + create form:
- Table: name, email, status, tenants_created (count), actions
- Row action untuk active reps: "Nonaktifkan" button → modal + reason input
- Button di top: "Tambah Sales Rep" → wizard mini (1 step: email + name)
- Route gated: super_admin only

Add sidebar link "Sales Reps" — super_admin only, hidden dari sales_rep.

Reuse: existing `TenantsList.tsx` table pattern.

## Section 2.5: (removed — payment narrow reversed based on final sales rep scope)

Original draft narrowed payment access to super_admin. Later re-scope
confirmed sales rep needs Pembayaran tab access untuk validasi transfer
dari tenant. RLS updates di C2 above cover this: sales_rep can SELECT
+ INSERT via record_payment RPC, but cannot UPDATE/DELETE existing
payment rows (super_admin only untuk correcting mistakes).

## Section 3: Data Flow

### Happy path
Wizard → Edge Function → validate slug → pre-check available →
inviteUserByEmail → provision_tenant → return { tenant_id, ... }.
Owner receives invite email, clicks magic link, lands on dashboard.

### Slug conflict (E5)
Wizard → Edge Function → validate → pre-check finds duplicate →
return 409 → wizard shows inline error, form state preserved →
sales rep edits slug + resubmits.

### Compensating rollback (E9)
Wizard → Edge Function → validate + pre-check OK → inviteUserByEmail
succeeds → provision_tenant fails (rare DB error) → Edge Function
deletes user → return 500 → wizard shows error, sales rep retries.

### Deprovision
Super admin views tenant detail → Danger Zone → click Delete → modal
→ types reason + confirms slug → click Hapus Permanen → RPC deletes
5 tables + inserts audit_log → redirect to /admin/tenants list.

Sales rep views tenant detail → Danger Zone HIDDEN → cannot access.

## Section 4: Error Handling

15 error scenarios documented in original brainstorm (E1-E11, D1-D4,
W1-W4). Each maps to:
- Source (Edge Fn / RPC / client)
- HTTP/PG code
- Bahasa Indonesia user message
- Recovery action

Full table in brainstorming transcript. Key ones:

- **E5 (slug taken):** inline error, form preserved
- **E7 (email exists):** rare, message: "email sudah terdaftar, konfirm owner sama atau ganti"
- **E8 (rate limit):** "tunggu 10 menit"
- **E9 (RPC fail):** auto rollback + retry prompt
- **D1 (sales rep delete attempt):** "hanya super admin bisa hapus, hubungi founder"

All error messages: Bahasa Indonesia, blame-free, actionable, no stack
trace leak.

## Section 5: Testing Strategy

### P0 (must have)

**Edge Function (Deno tests):**
- Compensating rollback fires on provision_tenant failure
- Slug validation (regex + blocklist + pre-check)
- Auth gate rejects non-platform-admin

**RPC (pgTAP):**
- deprovision_tenant blocks sales_rep JWT
- deprovision_tenant happy path (5 tables cleaned + audit inserted)
- auth.users preserved after deprovision

**RLS (pgTAP):**
- sales_rep UPDATE/DELETE on tenants blocked
- sales_rep INSERT tenants allowed (via wizard flow)

**UI (vitest):**
- Delete modal: confirm-slug must match for enable
- Delete button hidden for sales_rep role

### P1 (should have)

- Sidebar filter test (sales_rep hides /admin/plans + /admin/revenue)
- Happy path E2E manual Chrome MCP smoke

### P2 (nice to have)

- Wizard result copy assertion
- End-to-end automated smoke via Chrome MCP

### Test data setup

Seed super_admin + sales_rep fixtures via test setup script.
Reuse existing pgTAP JWT simulation pattern.

### Regression protection

Add to CI (existing isolation-audit workflow):
- pgTAP suite for `_is_super_admin_from_jwt` semantic
- pgTAP suite for deprovision_tenant auth gate
- Deno test suite for Edge Function

## Reuse Summary

Nothing rebuilt from scratch. All new components hook into existing infra:
- `TenantWizard.tsx` — existing, ganti submit target ke Edge Function
- `provision_tenant` RPC — existing (Wave 2 wizard shipped)
- `audit_log` table — existing (Wave 5)
- `adminToast` — existing
- `RenewSubscriptionModal` pattern — mirrored untuk delete modal
- `_is_platform_admin_from_jwt` — existing (backward compat, still true
  untuk kedua role)
- Auth hook JWT claims — existing pattern, add `platform_admin_role` claim

## Success Criteria (revisit)

Sales rep dapat (daily operations, no founder needed):
- ✅ Login ke VOSI admin dengan role `sales_rep`
- ✅ Onboard tenant baru via wizard `/admin/tenants/new`
- ✅ Owner terima email invite + magic link login → OTP login berikutnya
- ✅ Assign / ubah paket + toggle module untuk tenant mana pun
- ✅ Record + validasi payment transfer dari tenant
- ✅ View list semua tenant + detail (kecuali destructive buttons)
- ✅ Error handling inline (slug conflict, rate limit, dll)

Sales rep TIDAK bisa (founder escalation):
- ❌ Delete tenant (super_admin only — via /admin/tenants/<slug> Zona Bahaya)
- ❌ Suspend / activate tenant (super_admin only)
- ❌ Renew subscription (super_admin only)
- ❌ Add / edit / hapus admin user di dalam tenant (super_admin only —
   owner tenant biasanya handle sendiri)
- ❌ Akses /admin/plans (catalog paket global)
- ❌ Akses /admin/revenue (analytics platform-wide)
- ❌ Akses /admin/sales-reps (manage rep lain)

Escalation ke founder cuma untuk:
- Delete tenant (typo cleanup)
- Suspend/renew (billing decisions)
- Owner locked out (email loss)
- Sales rep resign / new hire

Untuk model founder weekly-review + sales rep daily operations, ini
fit-for-purpose.

## Implementation Effort Estimate (revised)

| Component | Effort |
|---|---|
| Edge Function `create-tenant-owner` | 2-3 hours |
| Sales Rep role + status + auth hook + RLS updates | 3-4 hours |
| RPC gate updates (update_plan_admin, renew, suspend/activate) | 1-2 hours |
| Sales rep management (create + deactivate + UI) | 2-3 hours |
| deprovision_tenant RPC + Zona Bahaya UI | 1.5-2 hours |
| Slug blocklist (bundle with Edge Function) | 15 minutes |
| Testing (minimal: manual smoke + P0 unit tests) | 2 hours |
| **Total** | **~12-16 hours** |

## Deploy sequence (Missing #3 fix)

Kritikal — kalau salah urutan, founder bisa kehilangan access.

```
1. Deploy migration 20261115000032 (role + status columns, backward compat)
2. Deploy migration 20261115000033 (deprovision_tenant RPC)
3. Deploy migration 20261115000034 (RPC gate updates)
4. Deploy auth hook ALTER (add platform_admin_role claim, skip if disabled)
5. Force JWT refresh (via Supabase Auth admin API atau tunggu session expire ~1jam)
6. Deploy frontend (isSuperAdmin() helper + UI conditionals + new routes)
7. Deploy Edge Functions (create-tenant-owner + invite-sales-rep)
8. Smoke test as founder → verify super_admin access intact
9. Create test sales_rep + smoke test as sales_rep
```

Backwards compat safety: existing `is_platform_admin` claim TETAP true
untuk kedua role, jadi kalau frontend deploy sebelum auth hook, existing
gates tetap work (fallback ke old behavior).
