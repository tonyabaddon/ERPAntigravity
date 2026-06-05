# WhatsApp QR Code Fix — Design Spec
Date: 2026-06-05

## Problem

QR code tidak muncul di halaman WhatsApp AI. Daemon online (fetch `/api/wa/qr` berhasil), tapi response selalu `qr: "", connected: false`. Gejala: "Menunggu QR dari daemon..." ditampilkan terus-menerus.

## Root Cause

Dua bug terkait:

**Bug 1 (utama): Stored session memblokir QR loop**
`client.go Connect()` line 55 — jika `Store.ID != nil` (sesi WA pernah tersimpan di PostgreSQL dari pairing sebelumnya), daemon masuk reconnect path tanpa `GetQRChannel`. QR loop tidak pernah dimulai, `currentQR` tetap `""`.

Saat reconnect gagal/pending: `connected=false, qr=""` → frontend stuck "Menunggu QR".

**Bug 2 (sekunder): Tidak ada tombol logout saat disconnected**
`WhatsappAiScreen.tsx:323-328` — tombol "Putuskan Koneksi" hanya render jika `waConnected=true`. Ketika daemon stuck di reconnect (`connected=false`), user tidak bisa trigger logout untuk clear session dan memulai QR pairing baru.

**Bug 3 (sekunder): QR loop exit saat Connect() gagal**
`client.go runQRLoop` di binary ter-deploy (`46a567f`) — jika `c.WA.Connect()` gagal setelah QR timeout, loop langsung `return`. QR tidak pernah di-rotate. Fix sudah ada di file tapi belum di-commit/deploy.

## Fix Design

### Part 1 — Frontend: Tombol Force-Logout di State "Menunggu QR"

**File**: `src/components/WhatsappAiScreen.tsx`

**Perubahan**: Di blok `{!waConnected && !qrCode}` (line 344), tambah tombol "Minta QR Baru" di bawah tombol "Refresh Status", conditional pada `daemonOnline=true`.

Behavior:
- Tombol memanggil `handleLogout()` yang sudah ada (POST `/api/wa/logout`)
- `handleLogout` mengirim request ke backend → daemon panggil `Logout()` → `Store.Delete()` → `os.Exit(0)` → Cloud Run restart → `Store.ID=nil` → QR loop dimulai → QR muncul
- Tombol hanya muncul kalau `daemonOnline=true` (daemon responsif), tidak saat benar-benar offline

**Tidak ada perubahan API** — reuse `handleLogout` yang sudah ada.

### Part 2 — Backend: Commit + Rebuild Binary

**File**: `backend-go/internal/whatsapp/client.go`

**Perubahan yang sudah ada (uncommitted)**: Di `runQRLoop`, bagian after `GetQRChannel` success — `c.WA.Connect()` sekarang retry infinite loop (5s delay) alih-alih exit QR loop saat gagal.

**Action**:
1. Commit `client.go` dengan perubahan yang ada
2. Rebuild binary: `CGO_ENABLED=0 GOOS=linux go build -o daemon .`
3. Commit binary baru

## Components Affected

| File | Jenis Perubahan |
|------|-----------------|
| `src/components/WhatsappAiScreen.tsx` | Tambah tombol force-logout di kondisi stuck |
| `backend-go/internal/whatsapp/client.go` | Commit existing fix (QR loop retry) |
| `backend-go/daemon` | Rebuild binary |

## Flow Setelah Fix

```
User buka halaman WA AI
  → Daemon online, qr="" (stored session blocking)
  → UI menampilkan "Menunggu QR..."
  → User klik tombol "Minta QR Baru"
  → POST /api/wa/logout
  → Daemon: Store.Delete() → os.Exit(0)
  → Cloud Run restart daemon
  → Store.ID = nil → QR loop dimulai
  → /api/wa/qr returns qr: "<qr_string>"
  → UI menampilkan QR code
  → User scan → BERHASIL TERSAMBUNG
```

## Out of Scope

- Backend self-healing otomatis (auto-clear session setelah N reconnect failures) — bisa dipertimbangkan di iterasi berikutnya
- Perubahan ke PostgreSQL schema atau migration
