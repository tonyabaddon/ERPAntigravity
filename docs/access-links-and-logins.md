  # Access Links & Logins

Snapshot **2026-07-11**. Sumber data: query langsung `public.tenants`, `public.tenant_users`, `public.admin_users`, `public.platform_admins` di project Supabase `ekhhojaezdfjfwuxyjkl`. Update dokumen ini kalau daftar tenant / user berubah — jangan diandalkan sebagai source-of-truth kalau lebih dari beberapa minggu tanpa refresh.

---

## Host frontend (Cloud Run, asia-southeast2)

```
https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app
```

Satu deployment melayani semua tenant + panel VOSI Admin. Routing di-handle React Router client-side; slug tenant terikat ke JWT — kalau owner buka slug tenant lain, `App.tsx` redirect otomatis ke slug JWT-nya. Auth via Supabase (`ekhhojaezdfjfwuxyjkl.supabase.co`) — password + OTP email.

---

## Tenant dashboards

Semua tenant login via URL yang sama; setelah OTP sukses, backend redirect ke `/t/<slug>/dashboard?screen=dashboard`.

### Tenant 1 — Garindo Jaya Panel (flagship)

- **Slug:** `garindo`
- **Tenant ID:** `11111111-1111-1111-1111-111111111111`
- **URL:** https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/t/garindo/dashboard
- **Aktif sejak:** 2026-07-04
- **Owner login (Aktif):**
  - `tonywei.office@gmail.com` — founder; punya double-hat (Owner Garindo + platform super_admin, lihat bagian VOSI Admin)
  - `jennysetiawangjp@gmail.com` — Owner sisi Garindo (Jenny)
- **Owner nonaktif (Tidak Aktif — tidak bisa login):** `tonywei1993@gmail.com`
- **Staff login aktif:** `garindojayapanelsales@gmail.com` (role `Staff Admin Toko`)

### Tenant 2 — Toko Jaya Makmur (demo tenant)

- **Slug:** `toko-jaya-makmur`
- **Tenant ID:** `22222222-2222-2222-2222-222222222222`
- **URL:** https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/t/toko-jaya-makmur/dashboard
- **Aktif sejak:** 2026-07-07
- **Owner login (Aktif):** `tonywei.office+demo@gmail.com` (Gmail plus-alias — inbox jatuh ke `tonywei.office@gmail.com`)

Tenant demo hasil hand-seed 20 SKU / 10 customer / 5 supplier / 3 cash account — dipakai untuk QA multi-tenant isolation.

### Tenant 3 — Warung Sinar Rezeki

- **Slug:** `warung-sinar-rezeki`
- **Tenant ID:** `49cbbc94-977c-4bc4-bf9b-0195342f1608`
- **URL:** https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/t/warung-sinar-rezeki/dashboard
- **Aktif sejak:** 2026-07-08
- **Owner login (Aktif):** `tonywei.office+tenant3@gmail.com` (Gmail plus-alias — inbox jatuh ke `tonywei.office@gmail.com`)

---

## VOSI Admin (super-admin panel)

- **URL:** https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/admin
- **Guard:** hanya user yang punya row di `public.platform_admins` (status `active`) yang bisa masuk; role lain di-redirect ke `/dashboard` dengan toast "Halaman khusus admin".

### Super admin (Aktif)

- `tonywei.office@gmail.com` (user_id `227c28f4-09f6-4dc9-af7a-01b0feb2c194`) — satu-satunya super_admin saat ini; punya semua kapabilitas: impersonasi tenant, CRUD plan, CRUD sales rep, deprovision, module toggle, verifikasi pembayaran, log aktivitas.

### Sales rep (Aktif)

**Belum ada.** Tabel `platform_admins` sudah support role `sales_rep`, tapi belum ada seed. Untuk membuat sales rep pertama, super admin buka `/admin/sales-reps` → "Tambah Sales Rep" → isi email + nama + `user_id` (harus sudah ada di `auth.users`; buat dulu via Supabase Auth Admin API kalau belum). Sales rep punya akses subset (tenant list read-only + impersonasi Tidak diperbolehkan).

---

## Gotchas login

- **Slug ≠ JWT-slug → auto-redirect.** Bookmark URL tenant lain akan otomatis diarahkan ke tenant JWT — bukan bug.
- **Impersonation session (super_admin).** Saat super_admin impersonate tenant, JWT-nya tetap memuat klaim `platform_admin`. Ini masih P0 open (F-6 di `docs/qa/QA_FINDINGS.md`) — dashboard KPI benar, tapi AI Log & Laporan Performa bisa bocor lintas tenant. Untuk QA multi-tenant, login langsung sebagai owner email tenant target, jangan impersonate.
- **Plus-alias Gmail.** Email `tonywei.office+demo@` dan `tonywei.office+tenant3@` semua masuk ke inbox `tonywei.office@gmail.com` — praktis untuk QA, tapi ingat OTP untuk 3 tenant + admin akan datang ke inbox yang sama.
- **Owner nonaktif = tidak bisa login.** Row `admin_users` dengan `status='Tidak Aktif'` di-reject oleh AuthScreen (post-OTP guard `fetchByEmail`). Kalau butuh reaktivasi, update `admin_users.status='Aktif'`.

---

## Runbook terkait

- **Onboard tenant baru:** `docs/tenant-onboarding-runbook.md` (5-10 menit / tenant, manual sampai Wave 2 wizard ship)
- **Promote build baru ke Cloud Run:** `docs/cloud-run-promote-runbook.md`
- **QA cycle status:** `docs/qa/QA_FINDINGS.md`
