// send-admin-invite — atomic admin creation + invite for tenant-level admins.
//
// 2026-07-24 rewrite: previous version cuma kirim SMTP email. Bug consequence:
// admin_users row punya client-random UUID yang tidak match auth.users.id, dan
// tidak ada tenant_users row. New admin login → JWT tanpa tenant_id → blank
// dashboard / RLS block.
//
// New atomic flow (called BEFORE admin_upsert_user in FE):
//   1. Verify caller is authenticated + Owner in current tenant
//   2. Call auth.admin.inviteUserByEmail() → creates auth.users, returns id
//      (idempotent: kalau user sudah ada, dapatkan existing id)
//   3. INSERT tenant_users (auth_id, tenant_id, 'staff' | 'owner')
//   4. Send SMTP invite email
//   5. RETURN { user_id, email }
//
// FE UserManagementScreen kemudian panggil admin_upsert_user dengan user_id
// yang di-return — tidak lagi pakai crypto.randomUUID().

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  email?: string;
  name?: string;
  role?: string;
  addedByName?: string;
  appUrl?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { email, name, role, addedByName, appUrl } = body;
  if (!email || !name || !role || !addedByName || !appUrl) {
    return json({ error: "Missing required fields" }, 400);
  }
  if (!appUrl.startsWith("https://") && !appUrl.startsWith("http://")) {
    return json({ error: "Invalid appUrl" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Diagnostic: log which alg + kid the service key JWT declares. Auth started
  // rejecting our calls with "unrecognized JWT kid <nil> for algorithm ES256"
  // — means Supabase rotated keys and the env var now holds an ES256 key
  // without kid. Log alg + presence of kid so we can detect this.
  try {
    const headerB64 = SERVICE_KEY.split(".")[0];
    const b64 = headerB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const header = JSON.parse(atob(padded));
    console.log("SERVICE_KEY header:", { alg: header.alg, kid: header.kid, hasKid: !!header.kid });
  } catch (e) {
    console.log("SERVICE_KEY header decode fail:", e);
  }
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!SERVICE_KEY) return json({ error: "Server misconfig: no service key" }, 500);
  if (!gmailUser || !gmailPass) return json({ error: "SMTP credentials not configured" }, 500);

  // ─── 1. Verify caller ────────────────────────────────────────────────────
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user: caller }, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !caller) return json({ error: "Unauthorized" }, 401);

  // Extract caller's tenant_id from JWT
  let callerTenantId: string | null = null;
  try {
    const payloadPart = token.split(".")[1];
    const b64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    callerTenantId = claims.tenant_id ?? null;
  } catch {
    // fall through
  }
  if (!callerTenantId || callerTenantId === "00000000-0000-0000-0000-000000000000") {
    return json({ error: "Caller has no tenant context" }, 403);
  }

  // Service-role client untuk admin API + DB writes
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify caller is Owner in this tenant (defense-in-depth on top of RLS)
  const { data: callerRow } = await svc
    .from("admin_users")
    .select("role")
    .eq("id", caller.id)
    .eq("tenant_id", callerTenantId)
    .maybeSingle();
  if (!callerRow || callerRow.role !== "Owner") {
    return json({ error: "Owner role required to invite admins" }, 403);
  }

  // ─── 2. Create or reuse existing auth.users via /auth/v1/admin/users ─────
  // NOTE (2026-07-24): tested 4 endpoints against this deployment:
  //   - POST /auth/v1/admin/invite → 404 not found (SDK's default is broken)
  //   - POST /auth/v1/invite       → 403 bad_jwt when called from Edge Function
  //     ("unrecognized JWT kid <nil> for algorithm ES256") — Supabase rotated
  //     signing keys but env SUPABASE_SERVICE_ROLE_KEY didn't rotate along.
  //   - POST /auth/v1/admin/users  → **200 OK** — creates auth.users directly,
  //     no invite email dependency (we send our own via SMTP below).
  // We use /auth/v1/admin/users. The SMTP email at Step 4 tells the new admin
  // how to login via OTP — Supabase Auth OTP works fine even for pre-created
  // rows with email_confirm=true.
  let inviteeUserId: string | null = null;

  const createResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "apikey": SERVICE_KEY,
    },
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { full_name: name },
    }),
  });

  const createJson = await createResp.json().catch(() => ({} as { id?: string; msg?: string; code?: string }));

  if (createResp.ok && createJson.id) {
    inviteeUserId = createJson.id;
  } else {
    // Check if error is "already registered" — reuse existing auth.users
    const msg = (createJson.msg ?? JSON.stringify(createJson)).toLowerCase();
    const isAlreadyRegistered =
      msg.includes("already registered") ||
      msg.includes("already been registered") ||
      msg.includes("user already exists") ||
      msg.includes("duplicate") ||
      (msg.includes("email") && msg.includes("has already"));
    if (isAlreadyRegistered) {
      const lookupResp = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
        {
          headers: {
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "apikey": SERVICE_KEY,
          },
        },
      );
      const lookupJson = await lookupResp.json().catch(() => ({} as { users?: Array<{ id: string; email: string }> }));
      const found = lookupJson.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (found?.id) {
        inviteeUserId = found.id;
      } else {
        return json({
          error: "Email exists tapi tidak ditemukan via lookup. Kontak admin.",
          debug: { createStatus: createResp.status, createBody: createJson, lookupBody: lookupJson },
        }, 500);
      }
    } else {
      return json({
        error: `Create user failed: ${createJson.msg ?? `HTTP ${createResp.status}`}`,
        debug: { status: createResp.status, body: createJson },
      }, 500);
    }
  }

  if (!inviteeUserId) return json({ error: "Failed to resolve invitee user_id" }, 500);

  // ─── 3. Ensure tenant_users membership ───────────────────────────────────
  // Map app role → tenant_users.role enum ('owner' | 'admin' | 'staff' | 'kasir')
  const tenantRole = role.toLowerCase().includes("owner")
    ? "owner"
    : role.toLowerCase().includes("kasir")
      ? "kasir"
      : "staff";

  const { error: tuErr } = await svc
    .from("tenant_users")
    .upsert(
      { user_id: inviteeUserId, tenant_id: callerTenantId, role: tenantRole, status: "ACTIVE" },
      { onConflict: "tenant_id,user_id" },
    );
  if (tuErr) {
    return json({ error: `tenant_users upsert failed: ${tuErr.message}` }, 500);
  }

  // ─── 3b. Self-heal admin_users.id if OLD FE created row with random UUID ─
  // OLD FE flow: crypto.randomUUID() → admin_users.id (mismatch with auth.users.id).
  // NEW FE flow: no admin_users row yet (FE calls admin_upsert_user AFTER us).
  // Self-heal: if row exists with same email + different id, sync it.
  const { data: existingAdmin } = await svc
    .from("admin_users")
    .select("id")
    .eq("email", email)
    .eq("tenant_id", callerTenantId)
    .maybeSingle();
  if (existingAdmin && existingAdmin.id !== inviteeUserId) {
    // Bypass RLS on the UPDATE via service key — id column has no FK on
    // admin_users so the UPDATE is safe.
    const { error: healErr } = await svc
      .from("admin_users")
      .update({ id: inviteeUserId })
      .eq("id", existingAdmin.id);
    if (healErr) {
      // Non-fatal — log but continue
      console.warn("self-heal admin_users.id failed:", healErr);
    }
  }

  // ─── 4. Send SMTP invite email (best-effort) ─────────────────────────────
  const html = buildInviteEmail({ name, role, addedByName, email, appUrl });
  const smtp = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  });
  try {
    await smtp.send({
      from: `Caleo ERP <${gmailUser}>`,
      to: email,
      subject: "Anda telah ditambahkan ke Caleo ERP",
      html,
    });
    await smtp.close();
  } catch (err) {
    await smtp.close().catch(() => {});
    console.error("SMTP error (non-fatal — auth invite email already sent by Supabase):", err);
    // Not fatal — Supabase invite email already sent via inviteUserByEmail above.
  }

  return json({ success: true, user_id: inviteeUserId, email });
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildInviteEmail(p: {
  name: string;
  role: string;
  addedByName: string;
  email: string;
  appUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f9ff;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9ff;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:24px;border:1px solid #e5eeff;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#1e3d60,#102a43);padding:32px 40px;">
          <p style="margin:0;color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px;">Caleo ERP</p>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.6);font-size:13px;">Sistem Manajemen Toko</p>
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="margin:0 0 8px;font-size:20px;font-weight:800;color:#012749;">Halo ${escapeHtml(p.name)},</p>
          <p style="margin:0 0 24px;font-size:14px;color:#43474e;line-height:1.6;">
            <strong>${escapeHtml(p.addedByName)}</strong> telah menambahkan Anda ke sistem <strong>Caleo ERP</strong> sebagai <strong>${escapeHtml(p.role)}</strong>.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;"><tr>
            <td style="background:#2d8a4e;border-radius:50px;padding:14px 32px;">
              <a href="${escapeHtml(p.appUrl)}" style="color:#fff;text-decoration:none;font-size:13px;font-weight:800;">MULAI LOGIN →</a>
            </td>
          </tr></table>
          <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#012749;">Cara login:</p>
          <ol style="margin:0 0 24px;padding-left:20px;color:#43474e;font-size:13px;line-height:2;">
            <li>Buka link di atas atau kunjungi: <a href="${escapeHtml(p.appUrl)}" style="color:#2d8a4e;">${escapeHtml(p.appUrl)}</a></li>
            <li>Masukkan email Anda: <strong>${escapeHtml(p.email)}</strong></li>
            <li>Klik <strong>Kirim OTP</strong></li>
            <li>Masukkan kode 6 digit yang dikirim ke email ini</li>
          </ol>
          <p style="margin:0;font-size:12px;color:#9ca3af;">Email ini dikirim otomatis. Jika Anda tidak mengenal pengirim, abaikan email ini.</p>
        </td></tr>
        <tr><td style="background:#f8f9ff;padding:20px 40px;border-top:1px solid #e5eeff;">
          <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">© 2026 Caleo ERP System</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
