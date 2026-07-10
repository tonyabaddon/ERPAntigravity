import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { RESERVED_SLUGS, SLUG_RE } from "./blocklist.ts";

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type ErrorCode = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7' | 'E8' | 'E9' | 'E10' | 'E11';

interface ErrorResponse {
  error: string;
  code: ErrorCode;
  message: string;
}

interface SuccessResponse {
  tenant_id: string;
  slug: string;
  owner_user_id: string;
  expires_at: string;
}

interface RequestBody {
  slug: string;
  name: string;
  plan_code: string;
  expires_in_months: number;
  owner_email: string;
  owner_name: string;
}

interface JwtPayload {
  sub: string;
  email?: string;
  platform_admin_role?: string;
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errResponse(status: number, code: ErrorCode, message: string): Response {
  const body: ErrorResponse = { error: code, code, message };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function okResponse(data: SuccessResponse): Response {
  return new Response(JSON.stringify(data), {
    status: 201,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeJwtPayload(jwt: string): JwtPayload | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Step 1: JWT extraction ─────────────────────────────────────────────────
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!jwt) {
    return errResponse(401, 'E1', 'Sesi expired — silakan login ulang');
  }

  // ── Step 2: Platform admin role check (JWT claim, no DB round-trip) ────────
  const payload = decodeJwtPayload(jwt);
  if (!payload) {
    return errResponse(401, 'E1', 'Sesi expired — silakan login ulang');
  }
  if (!['super_admin', 'sales_rep'].includes(payload.platform_admin_role ?? '')) {
    return errResponse(403, 'E2', 'Akses ditolak — bukan platform admin');
  }

  // ── Step 3: Parse request body ────────────────────────────────────────────
  let input: RequestBody;
  try {
    input = await req.json() as RequestBody;
  } catch {
    return errResponse(400, 'E11', 'Field wajib tidak lengkap');
  }

  const { slug, name, plan_code, expires_in_months, owner_email, owner_name } = input;

  // ── Step 4: Validate required fields ─────────────────────────────────────
  if (!slug || !name || !plan_code || !expires_in_months || !owner_email || !owner_name) {
    return errResponse(400, 'E11', 'Field wajib tidak lengkap');
  }

  // ── Step 5: Validate slug format ──────────────────────────────────────────
  if (!SLUG_RE.test(slug)) {
    return errResponse(400, 'E3', 'Format slug invalid (3-30 karakter, huruf kecil, angka, dash)');
  }

  // ── Step 6: Validate slug not reserved ───────────────────────────────────
  if (RESERVED_SLUGS.includes(slug)) {
    return errResponse(400, 'E4', 'Slug tidak boleh menggunakan kata reserved');
  }

  // ── Step 7: Validate email format ─────────────────────────────────────────
  if (!EMAIL_RE.test(owner_email)) {
    return errResponse(400, 'E6', 'Format email invalid');
  }

  // ── Step 8: Init Supabase clients ─────────────────────────────────────────
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // `sb`: RLS-gated, fires under caller's identity (for provision_tenant + slug check)
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  // `sbAdmin`: service_role, for auth admin ops + platform_admin_audit writes
  const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Step 9: Slug uniqueness pre-check ─────────────────────────────────────
  const { data: existingTenant, error: slugCheckError } = await sb
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (slugCheckError) {
    console.error('Slug check error:', slugCheckError);
    // Non-fatal: proceed (provision_tenant will also enforce uniqueness)
  }

  if (existingTenant) {
    return errResponse(409, 'E5', 'Slug sudah dipakai — pilih yang lain');
  }

  // ── Step 10: Invite user via auth admin ───────────────────────────────────
  const { data: inviteData, error: inviteError } = await sbAdmin.auth.admin.inviteUserByEmail(
    owner_email,
    { data: { full_name: owner_name } },
  );

  if (inviteError) {
    const msg = inviteError.message?.toLowerCase() ?? '';
    if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('user already exists')) {
      return errResponse(422, 'E7', 'Email sudah terdaftar — user tidak dibuat');
    }
    console.error('inviteUserByEmail error:', inviteError);
    return errResponse(500, 'E8', 'Gagal membuat user (invite service error)');
  }

  const user = inviteData?.user;
  if (!user?.id) {
    return errResponse(500, 'E8', 'Gagal membuat user (invite service error)');
  }

  // ── Step 11: Provision tenant via RPC ─────────────────────────────────────
  const { data: tenantData, error: provisionError } = await sb.rpc('provision_tenant', {
    p_owner_user_id: user.id,
    p_slug: slug,
    p_name: name,
    p_owner_name: owner_name,
    p_owner_email: owner_email,
    p_plan_code: plan_code,
    p_expires_in_months: expires_in_months,
  });

  if (provisionError || !tenantData) {
    console.error('provision_tenant error:', provisionError);

    // ── Compensating rollback: delete the auth user we just created ────────
    try {
      await sbAdmin.auth.admin.deleteUser(user.id);
    } catch (rollbackErr) {
      console.error(`ORPHAN AUTH USER: ${user.id}`, rollbackErr);
      return errResponse(500, 'E10', 'Rollback gagal — hubungi support (orphan detected)');
    }

    return errResponse(500, 'E9', 'Gagal simpan tenant — data user sudah cleanup, silakan retry');
  }

  const tenant = tenantData as { tenant_id: string; slug: string; expires_at: string };

  // ── Step 12: Emit PROVISION_TENANT audit event ────────────────────────────
  const { error: auditError } = await sbAdmin.from('platform_admin_audit').insert({
    admin_user_id: payload.sub,
    admin_email: payload.email ?? 'unknown',
    tenant_id: tenant.tenant_id,
    action: 'PROVISION_TENANT',
    detail: {
      slug,
      name,
      plan_code,
      expires_in_months,
      owner_email,
      owner_user_id: user.id,
    },
  });

  if (auditError) {
    // Non-fatal: tenant already provisioned, log and continue
    console.error('Audit insert error (non-fatal):', auditError);
  }

  // ── Step 13: Return success ───────────────────────────────────────────────
  return okResponse({
    tenant_id: tenant.tenant_id,
    slug: tenant.slug,
    owner_user_id: user.id,
    expires_at: tenant.expires_at,
  });
});
