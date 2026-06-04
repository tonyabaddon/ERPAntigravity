# Admin Invitation Email — Design Spec
**Date:** 2026-06-04
**Project:** ERP Antigravity (Sinar Elektrik)
**Status:** Approved for implementation

---

## 1. Problem

When an Owner adds a new admin via User Management, the record is saved to `admin_users` but the new user receives no notification. They have no idea they've been added and cannot know to log in.

---

## 2. Solution

After a successful `admin_users` upsert, the frontend calls a Supabase Edge Function that sends a branded invitation email via Gmail SMTP. The email tells the new user they've been added, their role, and how to log in using the existing OTP flow.

---

## 3. Architecture & Data Flow

```
UserManagementScreen (handleCreateAdminSubmit)
  1. adminUsersService.upsert(newAdmin)           ← existing, unchanged
  2. fetch POST /functions/v1/send-admin-invite   ← new (best-effort, non-fatal)
       { email, name, role, addedByName, appUrl: window.location.origin }

Edge Function (Deno, supabase/functions/send-admin-invite/index.ts)
  3. Validate required fields
  4. Connect to Gmail SMTP (smtp.gmail.com:587, STARTTLS)
     Credentials from Supabase secrets: GMAIL_USER, GMAIL_APP_PASSWORD
  5. Send HTML invitation email
  6. Return 200 OK

New user receives email with login instructions → uses existing OTP flow
```

**Error handling:** If the Edge Function call fails, show `⚠️ Admin dibuat tapi gagal kirim email undangan.` toast. Do NOT roll back the user creation — email is best-effort.

---

## 4. Email Content

**Subject:** Anda telah ditambahkan ke ERP Pro

**Body (HTML):**
- Greeting: "Halo [Name],"
- "[addedByName] telah menambahkan Anda ke sistem ERP Pro sebagai [Role]."
- CTA button → `appUrl`
- Login instructions:
  1. Masukkan email Anda: `[email]`
  2. Klik **Kirim OTP**
  3. Masukkan kode 6 digit yang dikirim ke email ini

---

## 5. Edge Function Interface

**Endpoint:** `POST /functions/v1/send-admin-invite`

**Request headers:**
- `Content-Type: application/json`
- `Authorization: Bearer <supabase-anon-key>`

**Request body:**
```json
{
  "email": "staff@email.com",
  "name": "Budi Santoso",
  "role": "Staff Admin Toko",
  "addedByName": "Tony Wei",
  "appUrl": "https://yourapp.com"
}
```

**Response:** `200 OK` on success, `400` if required fields missing, `500` on SMTP failure.

---

## 6. Supabase Secrets Required

Set in Supabase Dashboard → Project Settings → Edge Functions → Secrets:

| Secret name | Value |
|---|---|
| `GMAIL_USER` | `tinythinkers.co.id@gmail.com` |
| `GMAIL_APP_PASSWORD` | 16-char App Password from Google Account → Security → App Passwords |

---

## 7. Frontend Changes

**`src/components/UserManagementScreen.tsx`**

- Add `currentUser: { name: string } | null` to `UserManagementScreenProps` (already passed from `App.tsx`)
- After `adminUsersService.upsert(newAdmin)` succeeds, call the Edge Function with `fetch()` using anon key as Bearer token
- Wrap in try/catch — failure shows warning toast, does not block or revert user creation

**New file:** `supabase/functions/send-admin-invite/index.ts`
- Deno Edge Function using smtp library for Gmail
- Reads `GMAIL_USER` and `GMAIL_APP_PASSWORD` from `Deno.env`
- Sends HTML email built from request payload
- CORS headers for browser fetch

---

## 8. Files Changed

| File | Change |
|---|---|
| `src/components/UserManagementScreen.tsx` | Add `currentUser` prop, call Edge Function after upsert |
| `supabase/functions/send-admin-invite/index.ts` | New Edge Function |
