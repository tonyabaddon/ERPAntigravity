# Self-Service Tenant Onboarding Design

**Status:** Draft — awaiting user approval
**Author:** Claude Opus 4.7 + tonywei
**Date:** 2026-07-09

## Success Criterion

Sales rep dapat onboard tenant baru dari awal sampai owner login sukses,
**tanpa harus escalate ke founder** (kecuali destructive rollback yang
memang designed founder-only).

## Scope: 4 MUST-HAVE Items

1. **Edge Function `create-tenant-owner`** — wrap Supabase Auth Admin API +
   provision_tenant RPC dengan compensating rollback.
2. **Sales Rep role** — new enum column `platform_admins.role`
   (`super_admin`/`sales_rep`) + JWT claim + RLS gates + UI hides.
3. **`deprovision_tenant` RPC + UI** — hard delete tenant dengan audit
   log. Super_admin only.
4. **Slug blocklist** — reserved words check di Edge Function.

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
  CHECK (role IN ('super_admin', 'sales_rep'));

-- All existing platform_admins → super_admin (backward compatible).
-- Sales rep baru: INSERT dengan role='sales_rep'.

-- Extend auth hook untuk expose role claim
-- (see custom_access_token_hook update)
```

**Auth Hook update:**

Extend existing `custom_access_token_hook` function untuk read
`platform_admins.role` dan expose sebagai claim `platform_admin_role`
di JWT.

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
| tenants | SELECT | `_is_platform_admin_from_jwt()` — both roles can view |
| tenants | INSERT/UPDATE/DELETE | `_is_super_admin_from_jwt()` — direct writes = super only |
| tenant_subscriptions | SELECT | `_is_platform_admin_from_jwt()` |
| tenant_subscriptions | INSERT/UPDATE/DELETE | `_is_super_admin_from_jwt()` |
| plans | ALL | Already super-admin-only (Wave 4a) — UNCHANGED |

**Sales rep write path:** sales_rep tidak punya direct INSERT permission
di tenants — mereka HARUS via `provision_tenant` RPC yang SECDEF (bypass
RLS internally). Edge Function calls RPC on their behalf. Ini enforce
single write path + auditability.

**Super admin direct writes:** super_admin bisa langsung `.from('tenants').update({...})` untuk edge cases (mis. rename tenant tanpa lewat wizard).
Sales rep tidak.

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

TenantDetailShell:
- Danger Zone section (delete button) rendered jika `isSuperAdmin()`
- Sales rep tidak lihat sama sekali

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

Already covered in C1. Const array shared between Edge Function + wizard
(nice-to-have inline pre-check).

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

## Implementation Effort Estimate

| Component | Effort |
|---|---|
| Edge Function `create-tenant-owner` | 2-3 hours |
| Sales Rep role (migration + JWT + RLS + UI gates) | 3-4 hours |
| deprovision_tenant RPC + Delete modal | 1.5-2 hours |
| Slug blocklist (bundle with Edge Function) | 15 minutes |
| Testing (all layers) | 5.5 hours |
| **Total** | **~12-15 hours** |

Note: original estimate was 6-10 hours. Testing budget yang comprehensive
bumps it up. Kalau accept manual smoke test dan skip pgTAP → ~8 hours.

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

Sales rep dapat:
- ✅ Login ke VOSI admin dengan role `sales_rep`
- ✅ Buka wizard `/admin/tenants/new` + fill form
- ✅ Submit → Edge Function bikin auth.users + seed tenant + kirim invite
- ✅ Owner terima email invite + klik magic link + masuk dashboard
- ✅ Kalau gagal (slug taken, rate limit), dapat error inline yang jelas
- ✅ Owner subsequent login via OTP tetap jalan
- ❌ Sales rep TIDAK bisa hapus tenant (by design — super_admin only)
- ❌ Sales rep TIDAK bisa akses /admin/plans + /admin/revenue

Escalation ke founder tetap needed untuk: delete tenant (typo cleanup),
email loss / owner locked out, refund, sales rep turnover (customer minta
delete tenant yang di-onboard rep yang sudah resign).

Untuk MVP + sales team kecil (2-5 rep), tradeoff ini acceptable.
