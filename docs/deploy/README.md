# Deploy — Internal Operations

Dokumentasi deployment, runbook, dan operational notes. **Tidak di-deploy ke production.**

## File

| File | Fungsi |
|---|---|
| `vosi-landing-deploy.md` | Deployment guide untuk Firebase Hosting vosi-landing — pre-launch checklist, prerequisites, Firebase CLI commands, custom domain setup, future backend planning |

## Kenapa di `docs/deploy/` bukan di project root atau publik folder

Deployment guide berisi:
- Daftar placeholder yang harus di-replace (WA number, GA4 ID, domain)
- Firebase project ID + setup commands
- Internal runbook untuk operational team

Kalau di `vosi-landing/` (publik Firebase Hosting), kompetitor bisa:
- Tahu stack kamu (Firebase Hosting)
- Lihat placeholder yang masih belum di-fill (signal "site masih beta")
- Cari celah konfigurasi yang belum complete

Dengan di `docs/deploy/`, file hanya bisa diakses lokal dari repo.

## Future additions di folder ini

- Backend Cloud Run deploy guide (kalau ditambah API)
- Database migration runbook
- Incident response playbook
- DNS + domain transfer documentation
