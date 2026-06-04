# Admin Invitation Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an Owner adds a new admin via User Management, send a branded invitation email from Gmail telling them they've been added and how to log in via OTP.

**Architecture:** A new Supabase Edge Function (`send-admin-invite`) handles email sending via Gmail SMTP using the `denomailer` Deno library and secrets stored in Supabase. The frontend calls this function after a successful `adminUsersService.upsert()` — email failure shows a warning toast but does not block user creation.

**Tech Stack:** Deno (Supabase Edge Functions), denomailer 1.6.0, React/TypeScript (existing), Supabase anon key for Edge Function auth.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/functions/send-admin-invite/index.ts` | Create | CORS + input validation + Gmail SMTP send |
| `src/lib/supabaseClient.ts` | Modify | Export `supabaseUrl` and `supabaseAnonKey` |
| `src/components/UserManagementScreen.tsx` | Modify | Accept `currentUser` prop, call Edge Function after upsert |

---

## Task 1: Create the Edge Function

**Files:**
- Create: `supabase/functions/send-admin-invite/index.ts`

- [ ] **Step 1: Create the file with CORS handler and input validation**

Create `supabase/functions/send-admin-invite/index.ts`:

```ts
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPass) {
    return new Response(JSON.stringify({ error: "SMTP credentials not configured" }), {
      status: 500,
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
      from: gmailUser,
      to: email,
      subject: "Anda telah ditambahkan ke ERP Pro",
      html,
    });
    await client.close();
  } catch (err) {
    await client.close().catch(() => {});
    return new Response(JSON.stringify({ error: "Failed to send email", detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

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
            <p style="margin:0 0 8px;font-size:20px;font-weight:800;color:#012749;">Halo ${p.name},</p>
            <p style="margin:0 0 24px;font-size:14px;color:#43474e;line-height:1.6;">
              <strong>${p.addedByName}</strong> telah menambahkan Anda ke sistem <strong>ERP Pro</strong> sebagai <strong>${p.role}</strong>.
            </p>
            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#2d8a4e;border-radius:50px;padding:14px 32px;">
                  <a href="${p.appUrl}" style="color:#fff;text-decoration:none;font-size:13px;font-weight:800;">MULAI LOGIN →</a>
                </td>
              </tr>
            </table>
            <!-- Instructions -->
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#012749;">Cara login:</p>
            <ol style="margin:0 0 24px;padding-left:20px;color:#43474e;font-size:13px;line-height:2;">
              <li>Buka link di atas atau kunjungi: <a href="${p.appUrl}" style="color:#2d8a4e;">${p.appUrl}</a></li>
              <li>Masukkan email Anda: <strong>${p.email}</strong></li>
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
```

- [ ] **Step 2: Verify the file is saved correctly**

```bash
cat supabase/functions/send-admin-invite/index.ts | head -5
```
Expected output: first line is `import { SMTPClient } from ...`

- [ ] **Step 3: Commit the Edge Function**

```bash
git add supabase/functions/send-admin-invite/index.ts
git commit -m "feat(edge-fn): add send-admin-invite Edge Function via Gmail SMTP"
```

---

## Task 2: Export Supabase config from supabaseClient

**Files:**
- Modify: `src/lib/supabaseClient.ts` — lines 9-10 (the `const supabaseUrl` and `const supabaseAnonKey` declarations)

The two constants are already defined at the top of the file but not exported. Export them so components can reuse them without re-reading `import.meta.env`.

- [ ] **Step 1: Export the two constants**

In `src/lib/supabaseClient.ts`, change lines 9-10 from:

```ts
const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
```

to:

```ts
export const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
export const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
```

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
npx tsc --noEmit
```
Expected: same 2 pre-existing errors in SalesInboxScreen.tsx and Sidebar.tsx, nothing new.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(supabase): export supabaseUrl and supabaseAnonKey"
```

---

## Task 3: Wire frontend to call Edge Function

**Files:**
- Modify: `src/components/UserManagementScreen.tsx`

- [ ] **Step 1: Add `currentUser` to the props interface**

In `src/components/UserManagementScreen.tsx`, change:

```ts
interface UserManagementScreenProps {
  showToast: (msg: string) => void;
}
```

to:

```ts
interface UserManagementScreenProps {
  showToast: (msg: string) => void;
  currentUser: { name: string } | null;
}
```

- [ ] **Step 2: Destructure `currentUser` in the component**

Change the component signature from:

```ts
export default function UserManagementScreen({ showToast }: UserManagementScreenProps) {
```

to:

```ts
export default function UserManagementScreen({ showToast, currentUser }: UserManagementScreenProps) {
```

- [ ] **Step 3: Add the import for supabaseUrl and supabaseAnonKey**

At the top of the file, change:

```ts
import { adminUsersService, isSupabaseConfigured } from '../lib/supabaseClient';
```

to:

```ts
import { adminUsersService, isSupabaseConfigured, supabaseUrl, supabaseAnonKey } from '../lib/supabaseClient';
```

- [ ] **Step 4: Add the Edge Function call inside `handleCreateAdminSubmit`**

Find the success block after `adminUsersService.upsert(newAdmin)` succeeds (around line 168 — where `setNewName('')` etc. is called). Add the invite call right after the upsert `try/catch` block, before clearing form fields:

```ts
    // Send invitation email (best-effort — failure does not block user creation)
    if (isSupabaseConfigured) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-admin-invite`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            email: newAdmin.email,
            name: newAdmin.name,
            role: newAdmin.role,
            addedByName: currentUser?.name ?? 'Admin',
            appUrl: window.location.origin,
          }),
        });
      } catch {
        showToast('⚠️ Admin dibuat tapi gagal kirim email undangan.');
      }
    }
```

The full `handleCreateAdminSubmit` success path after this change (from the upsert onwards):

```ts
    if (isSupabaseConfigured) {
      try {
        await adminUsersService.upsert(adminUserToDb(newAdmin));
      } catch (err) {
        console.error('upsert new admin failed:', err);
        setAdmins(prev => prev.filter(a => a.id !== newAdmin.id));
        showToast('⚠️ Gagal menyimpan admin baru ke Supabase.');
        return;
      }
    }

    // Send invitation email (best-effort — failure does not block user creation)
    if (isSupabaseConfigured) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-admin-invite`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            email: newAdmin.email,
            name: newAdmin.name,
            role: newAdmin.role,
            addedByName: currentUser?.name ?? 'Admin',
            appUrl: window.location.origin,
          }),
        });
      } catch {
        showToast('⚠️ Admin dibuat tapi gagal kirim email undangan.');
      }
    }

    setNewName('');
    setNewEmail('');
    setNewWhatsapp('');
    setNewRole('Pilih Peran...');
    showToast(`🎉 Akun baru created! ${newAdmin.name} terdaftar. Email undangan terkirim.`);
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: same 2 pre-existing errors only, nothing new.

- [ ] **Step 6: Commit**

```bash
git add src/components/UserManagementScreen.tsx
git commit -m "feat(user-mgmt): send invitation email to new admin after creation"
```

---

## Task 4: Deploy the Edge Function to Supabase

- [ ] **Step 0: Verify Supabase secrets are set**

Go to **Supabase Dashboard → Project `ekhhojaezdfjfwuxyjkl` → Project Settings → Edge Functions → Secrets** and confirm both are present:
- `GMAIL_USER` = `tinythinkers.co.id@gmail.com`
- `GMAIL_APP_PASSWORD` = 16-char App Password

If either is missing, add it there before proceeding. To generate a Gmail App Password: Google Account → Security → 2-Step Verification → App Passwords → create one for "Mail".

- [ ] **Step 1: Deploy via Supabase MCP**

Use the `mcp__plugin_supabase_supabase__deploy_edge_function` tool with:
- `project_id`: `ekhhojaezdfjfwuxyjkl`
- `name`: `send-admin-invite`
- `entrypoint_path`: `supabase/functions/send-admin-invite/index.ts`

- [ ] **Step 2: Verify deployment**

Use `mcp__plugin_supabase_supabase__list_edge_functions` with project `ekhhojaezdfjfwuxyjkl` and confirm `send-admin-invite` appears in the list.

- [ ] **Step 3: Test the deployed function**

In the app, add a test admin with a real email address you control. Verify the invitation email arrives. Check the inbox for the subject "Anda telah ditambahkan ke ERP Pro".

If the email doesn't arrive, check Edge Function logs via `mcp__plugin_supabase_supabase__get_logs` with service `edge-functions`.

- [ ] **Step 4: Update progress.md**

Add a section to `progress.md`:

```markdown
## Admin Invitation Email — DONE (2026-06-04)

- New Supabase Edge Function `send-admin-invite` sends HTML invitation email via Gmail SMTP (denomailer 1.6.0, port 465 TLS)
- Frontend calls Edge Function after successful admin_users upsert; failure is non-fatal (warning toast only)
- Secrets required in Supabase: GMAIL_USER, GMAIL_APP_PASSWORD
- Deployed to project ekhhojaezdfjfwuxyjkl
```

- [ ] **Step 5: Commit progress update**

```bash
git add progress.md
git commit -m "docs: mark admin invite email as done"
```
