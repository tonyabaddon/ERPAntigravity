# WhatsApp QR Code Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix QR code tidak muncul di halaman WhatsApp AI dengan menambah tombol force-logout saat daemon stuck dan memperbaiki QR loop exit bug.

**Architecture:** Dua perubahan independen: (1) frontend — tambah tombol "Minta QR Baru" di state `!waConnected && !qrCode && daemonOnline`; (2) backend — commit existing `client.go` fix yang mencegah QR loop keluar saat `Connect()` gagal, lalu rebuild binary.

**Tech Stack:** React/TypeScript (Vite), Go (whatsmeow), Cloud Run

---

## File Map

| File | Action | Tanggung Jawab |
|------|--------|----------------|
| `src/components/WhatsappAiScreen.tsx` | Modify | Tambah tombol force-logout di kondisi stuck (line ~355) |
| `backend-go/internal/whatsapp/client.go` | Commit existing changes | QR loop retry — sudah ada di working tree, belum di-commit |
| `backend-go/daemon` | Rebuild | Binary baru dengan QR loop fix |

---

## Task 1: Frontend — Tambah Tombol "Minta QR Baru"

**Files:**
- Modify: `src/components/WhatsappAiScreen.tsx:344-362`

### Context

Saat ini blok `{!waConnected && !qrCode}` (line 344) hanya punya tombol "Refresh Status". Tidak ada cara untuk trigger logout/clear session ketika daemon online tapi QR tidak muncul (stored session blocking QR loop). Tombol "Putuskan Koneksi" hanya muncul saat `waConnected=true`.

- [ ] **Step 1: Buka file dan cari blok yang perlu diubah**

Buka `src/components/WhatsappAiScreen.tsx`. Cari blok ini (sekitar line 344):

```tsx
{!waConnected && !qrCode && (
  <div className="text-center space-y-3">
    {qrLoading ? (
      <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
    ) : (
      <div className="w-16 h-16 mx-auto rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300">
        <QrCode className="w-8 h-8" />
      </div>
    )}
    <p className="text-xs text-slate-500 font-bold">Menunggu QR dari daemon...</p>
    <p className="text-[10px] text-gray-400">Menghubungkan ke backend Cloud Run...</p>
    <button
      onClick={() => handleCheckConnection('')}
      className="bg-[#012749] hover:bg-[#2d8a4e] text-white px-5 py-2 rounded-full text-[10px] font-bold transition-all cursor-pointer shadow-md"
    >
      Refresh Status
    </button>
  </div>
)}
```

- [ ] **Step 2: Tambah tombol "Minta QR Baru" setelah tombol "Refresh Status"**

Tambah tombol baru di dalam `<div className="text-center space-y-3">`, tepat setelah tombol "Refresh Status". Tombol ini hanya muncul kalau `daemonOnline=true`.

Ubah blok menjadi:

```tsx
{!waConnected && !qrCode && (
  <div className="text-center space-y-3">
    {qrLoading ? (
      <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
    ) : (
      <div className="w-16 h-16 mx-auto rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300">
        <QrCode className="w-8 h-8" />
      </div>
    )}
    <p className="text-xs text-slate-500 font-bold">Menunggu QR dari daemon...</p>
    <p className="text-[10px] text-gray-400">Menghubungkan ke backend Cloud Run...</p>
    <button
      onClick={() => handleCheckConnection('')}
      className="bg-[#012749] hover:bg-[#2d8a4e] text-white px-5 py-2 rounded-full text-[10px] font-bold transition-all cursor-pointer shadow-md"
    >
      Refresh Status
    </button>
    {daemonOnline && (
      <button
        onClick={handleLogout}
        className="bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-full text-[10px] font-extrabold transition-all cursor-pointer shadow-md"
      >
        Minta QR Baru
      </button>
    )}
  </div>
)}
```

- [ ] **Step 3: TypeScript check**

```bash
npm run lint
```

Expected: exit 0, tidak ada error baru. Error pre-existing di App.tsx/SalesInboxScreen.tsx/Sidebar.tsx boleh diabaikan (sudah ada sebelumnya).

- [ ] **Step 4: Commit**

```bash
git add src/components/WhatsappAiScreen.tsx
git commit -m "fix(ui): add force-logout button when QR stuck in waiting state"
```

---

## Task 2: Backend — Commit client.go Fix

**Files:**
- Commit: `backend-go/internal/whatsapp/client.go` (perubahan sudah ada di working tree)

### Context

File `client.go` sudah punya perubahan di `runQRLoop` yang mencegah QR loop exit saat `c.WA.Connect()` gagal. Perubahan ini di bagian akhir loop (setelah `GetQRChannel` sukses), mengubah:

```go
// LAMA (deployed binary — exit QR loop jika Connect gagal):
if err := c.WA.Connect(); err != nil {
    log.Printf("[WA] Reconnect error: %v — exiting QR loop", err)
    return
}
```

menjadi:

```go
// BARU (retry infinite dengan 5s delay):
for attempt := 1; ; attempt++ {
    if err := c.WA.Connect(); err == nil {
        break
    } else {
        log.Printf("[WA] QR loop connect attempt %d error: %v — retrying in 5s", attempt, err)
        time.Sleep(5 * time.Second)
        select {
        case <-ctx.Done():
            return
        default:
        }
    }
}
```

- [ ] **Step 1: Verifikasi diff sebelum commit**

```bash
git diff backend-go/internal/whatsapp/client.go
```

Expected: Hanya perubahan di `runQRLoop` — bagian `for attempt := 1; ; attempt++` yang menggantikan single `if err := c.WA.Connect()`. Tidak ada perubahan lain.

- [ ] **Step 2: Commit client.go**

```bash
git add backend-go/internal/whatsapp/client.go
git commit -m "fix(whatsapp): retry QR loop Connect() indefinitely instead of exiting on failure"
```

---

## Task 3: Backend — Rebuild Binary

**Files:**
- Rebuild: `backend-go/daemon`

### Context

Binary `backend-go/daemon` ter-deploy saat ini berasal dari commit `46a567f` dan tidak punya fix QR loop dari Task 2. Binary perlu di-rebuild agar Cloud Run deploy yang baru (via `cloudbuild.yaml`) menggunakan code terbaru.

- [ ] **Step 1: Build binary**

```bash
cd backend-go && CGO_ENABLED=0 GOOS=linux go build -o daemon .
```

Expected: Tidak ada error output. File `backend-go/daemon` ter-update (cek dengan `ls -la backend-go/daemon`).

- [ ] **Step 2: Verifikasi build bersih**

```bash
cd backend-go && go build ./...
```

Expected: exit 0, tidak ada error.

- [ ] **Step 3: Jalankan Go tests**

```bash
cd backend-go && go test ./internal/...
```

Expected: Semua test PASS. Contoh output:
```
ok  	github.com/username/sinar-elektrik-backend/internal/engine
ok  	github.com/username/sinar-elektrik-backend/internal/heartbeat
ok  	github.com/username/sinar-elektrik-backend/internal/whatsapp
...
```

- [ ] **Step 4: Commit binary**

```bash
git add backend-go/daemon
git commit -m "build: rebuild daemon with QR loop retry fix"
```

---

## Task 4: Update Progress Doc

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Append ke progress.md**

Tambah entri baru di akhir `progress.md`:

```markdown
## 2026-06-05 — WhatsApp QR Code Fix

### Problem
QR code tidak muncul di halaman WhatsApp AI. Daemon online tapi `qr: ""` di response `/api/wa/qr`.

### Root Cause
- Bug 1: Stored WA session di PostgreSQL (`Store.ID != nil`) menyebabkan daemon masuk reconnect path saat restart, QR loop tidak pernah dimulai
- Bug 2: Tidak ada tombol logout di UI saat `waConnected=false`, user tidak bisa clear session yang stuck
- Bug 3: QR loop exit saat `c.WA.Connect()` gagal (sudah ada di client.go tapi belum di-commit/deploy)

### Fix
- `src/components/WhatsappAiScreen.tsx`: Tambah tombol "Minta QR Baru" di state `!waConnected && !qrCode && daemonOnline` — memanggil `handleLogout()` untuk force-clear session
- `backend-go/internal/whatsapp/client.go`: Commit existing fix — QR loop retry infinite saat Connect() gagal (5s delay)
- `backend-go/daemon`: Rebuilt binary
```

- [ ] **Step 2: Commit progress**

```bash
git add progress.md
git commit -m "docs(progress): WhatsApp QR fix complete"
```

---

## Verifikasi Manual (Setelah Semua Task)

Setelah fix di-deploy ke Cloud Run:

1. Buka halaman WhatsApp AI
2. Jika `daemonOnline=true` dan QR tidak muncul → tombol "Minta QR Baru" harus terlihat
3. Klik tombol → daemon restart
4. Tunggu ~5-10 detik → polling `/api/wa/qr` setiap 5 detik
5. QR Code harus muncul
6. Scan dengan WhatsApp → status berubah ke "BERHASIL TERSAMBUNG"
