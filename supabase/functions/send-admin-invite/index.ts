import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: { email?: string; name?: string; role?: string; addedByName?: string; appUrl?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { email, name, role, addedByName, appUrl } = body;
  if (!email || !name || !role || !addedByName || !appUrl) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!appUrl.startsWith("https://") && !appUrl.startsWith("http://")) {
    return new Response(JSON.stringify({ error: "Invalid appUrl" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPass) {
    return new Response(JSON.stringify({ error: "SMTP credentials not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const html = buildInviteEmail({ name, role, addedByName, email, appUrl });

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  });

  try {
    await client.send({
      from: `ERP Pro <${gmailUser}>`,
      to: email,
      subject: "Anda telah ditambahkan ke ERP Pro",
      html,
    });
    await client.close();
  } catch (err) {
    await client.close().catch(() => {});
    console.error("SMTP error:", err);
    return new Response(JSON.stringify({ error: "Failed to send email" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3d60,#102a43);padding:32px 40px;">
            <p style="margin:0;color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px;">ERP Pro</p>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.6);font-size:13px;">Sistem Manajemen Toko</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 8px;font-size:20px;font-weight:800;color:#012749;">Halo ${escapeHtml(p.name)},</p>
            <p style="margin:0 0 24px;font-size:14px;color:#43474e;line-height:1.6;">
              <strong>${escapeHtml(p.addedByName)}</strong> telah menambahkan Anda ke sistem <strong>ERP Pro</strong> sebagai <strong>${escapeHtml(p.role)}</strong>.
            </p>
            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#2d8a4e;border-radius:50px;padding:14px 32px;">
                  <a href="${escapeHtml(p.appUrl)}" style="color:#fff;text-decoration:none;font-size:13px;font-weight:800;">MULAI LOGIN →</a>
                </td>
              </tr>
            </table>
            <!-- Instructions -->
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#012749;">Cara login:</p>
            <ol style="margin:0 0 24px;padding-left:20px;color:#43474e;font-size:13px;line-height:2;">
              <li>Buka link di atas atau kunjungi: <a href="${escapeHtml(p.appUrl)}" style="color:#2d8a4e;">${escapeHtml(p.appUrl)}</a></li>
              <li>Masukkan email Anda: <strong>${escapeHtml(p.email)}</strong></li>
              <li>Klik <strong>Kirim OTP</strong></li>
              <li>Masukkan kode 6 digit yang dikirim ke email ini</li>
            </ol>
            <p style="margin:0;font-size:12px;color:#9ca3af;">Email ini dikirim otomatis. Jika Anda tidak mengenal pengirim, abaikan email ini.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9ff;padding:20px 40px;border-top:1px solid #e5eeff;">
            <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">© 2026 TechSaaS ERP System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
