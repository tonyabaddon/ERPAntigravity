# Message Debouncing untuk Calista — Design Spec

**Tanggal**: 2026-06-06
**Status**: Approved for implementation
**Author**: Tony (dengan Claude)

## Konteks & Motivasi

Calista (Go WhatsApp AI daemon) saat ini memanggil Gemini sekali per pesan customer yang masuk. Customer Indonesia di WhatsApp punya kebiasaan rapid-fire — kirim beberapa pesan pendek dalam hitungan detik ("halo", "saya tony", "dari Garindo", "mau panel box"). Tiap pesan memicu satu Gemini call dengan konteks parsial, menghasilkan reply yang sering bertanya hal yang baru saja di-jawab customer di pesan selanjutnya.

Dua masalah konkret:

1. **Cost / quota**: Free tier Gemini 2.5 Flash Lite = 15 RPM / 1000 RPD. Pada ~7 calls/conv, capacity ~143 chat/hari. Volume bisnis projected > 200/hari akan langsung mentok RPD.

2. **Kualitas konteks**: Calista membalas pesan parsial → bertanya hal yang sudah customer ketik di pesan berikutnya. Customer merasa tidak didenger. Conversion impact unknown tapi suspected negatif.

**Solusi**: tunggu 5 detik silence sebelum memproses pesan. Gabungkan pesan customer dalam window itu menjadi satu Gemini call. Tampilkan typing indicator selama menunggu agar customer tahu Calista sedang menyiapkan jawaban.

## Tujuan

- Turunkan Gemini calls per conversation dari ~7 menjadi ~3.5–5 (target 35–50% reduction).
- Naikkan daily customer capacity di free tier dari ~143 ke ~285.
- Tingkatkan kualitas reply Calista — full context per call.
- Tetap responsif untuk path time-sensitive (escalation, media).
- Bisa di-toggle off via env var kalau ada bug.

## Non-Goals

- Tidak optimasi prompt size (system prompt 11.5K token tetap dikirim per call).
- Tidak pakai Gemini Context Caching (akan ditambahkan saat upgrade paid tier).
- Tidak ubah state machine, parser, scheduler, atau frontend.
- Tidak persist buffer ke Postgres di v1 (terima data loss saat daemon restart).

## Arsitektur

Debounce disisipkan sebagai **layer di antara WhatsApp event entry dan existing `processMessage`**. Layer ini per-phone, dengan state machine 3 state dan 2 timer.

```
                  ┌────────────────────────────────────┐
                  │  WhatsApp event (whatsmeow)        │
                  └──────────────┬─────────────────────┘
                                 │
                ┌────────────────▼─────────────────┐
                │  handler.Handle()                │
                │  - filter group/broadcast        │
                │  - filter outbound               │
                └────────────────┬─────────────────┘
                                 │
                ┌────────────────▼─────────────────┐
                │  Routing decision                │
                ├──────────────────────────────────┤
   media ───────┤ skip debounce (langsung)         │──► handleMediaMessage()
                ├──────────────────────────────────┤
   escalation ──┤ skip debounce (langsung)         │──► handleEscalation()
   keyword      ├──────────────────────────────────┤
                │ text biasa                       │
                └────────────────┬─────────────────┘
                                 │
                ┌────────────────▼─────────────────┐
                │  DebounceHandler (NEW)           │
                │  per-phone buffer + timers       │
                │  IDLE ──► BUFFERING ──► PROCESSING│
                │  ▲────────────────────────┘      │
                │  typing indicator on/off         │
                └────────────────┬─────────────────┘
                                 │ flush (joined text)
                ┌────────────────▼─────────────────┐
                │  processJoinedMessage() (existing│
                │   `processMessage` di-rename)    │
                │  - GetOrCreateConversation       │
                │  - InsertMessage × N (audit)     │
                │  - engine.Machine.Process()      │
                │  - send reply                    │
                └──────────────────────────────────┘
```

### Tiga prinsip arsitektur

1. **Debounce adalah layer murni di atas pipeline existing**. `processMessage`, state machine, Gemini client, dan semua DB call tidak berubah. Layer baru hanya mengubah *kapan* dan *apa* yang dikirim.

2. **Bypass paths explicit**. Media (foto bukti transfer) dan escalation keyword (diskon, wiring) tidak masuk buffer. Time-sensitive harus tetap instant — bukan optimasi, tapi correctness.

3. **Per-phone isolation**. Tiap nomor punya buffer & state machine sendiri. Concurrency safety via mutex per-phone, bukan global lock.

## Komponen

### File baru: `backend-go/internal/whatsapp/debounce.go`

```go
type bufferState int

const (
    stateIdle bufferState = iota
    stateBuffering
    stateProcessing
)

type phoneBuffer struct {
    mu          sync.Mutex
    state       bufferState
    texts       []string
    firstMsgAt  time.Time
    softTimer   *time.Timer
    hardTimer   *time.Timer
    typingStop  chan struct{}
    nextBuffer  []string
}

type DebounceHandler struct {
    mu       sync.RWMutex
    buffers  map[string]*phoneBuffer
    clock    Clock
    waClient *whatsmeow.Client
    softWait time.Duration  // default 5s
    hardWait time.Duration  // default 12s
    flushFn  func(ctx context.Context, phone string, joined string, originalTexts []string) error
}

type Clock interface {
    Now() time.Time
    AfterFunc(d time.Duration, f func()) *time.Timer
}
```

**Method publik:**

| Method | Tujuan |
|---|---|
| `NewDebounceHandler(waClient, flushFn, opts...) *DebounceHandler` | Constructor |
| `Push(ctx, phone, text)` | Entry — `handler.go` panggil ini untuk text |
| `Flush(phone)` | Force-flush sinkron (untuk bypass paths) |
| `Shutdown(ctx)` | Graceful drain saat SIGTERM |

### Refactor: `backend-go/internal/whatsapp/handler.go`

`Handler` struct dapat field baru:

```go
type Handler struct {
    db          *db.Client
    machine     *engine.Machine
    sender      *Sender
    sched       *scheduler.Scheduler
    waNumberID  string
    debounce    *DebounceHandler  // NEW
}
```

`Handle()` di-restructure jadi router:
```
Handle(evt)
  ├─ filter outbound/group/broadcast → drop
  ├─ media? → handleMediaMessage (bypass)
  ├─ rules.CheckEscalation hit? → debounce.Flush + handleEscalation (bypass)
  └─ text biasa → debounce.Push(phone, text)
                    └─ saat flush → processJoinedMessage(ctx, phone, joined, originalTexts)
```

`processMessage` di-rename `processJoinedMessage`. Body hampir tidak berubah, kecuali:
- Insert N message rows (per pesan customer) untuk preserve audit trail di sales inbox
- Gemini call sekali dengan teks gabungan

### Tweak prompt: `backend-go/internal/engine/prompts.go`

State COLLECTING prompt ditambahi instruksi multi-field:

```
Anda mungkin menerima pesan customer yang sudah berisi beberapa field
sekaligus (contoh: "Halo, saya Tony dari Garindo Jaya, mau panel box
40x30 5 pcs untuk dikirim ke Jakarta Selatan"). Ekstrak SEMUA field
yang terdeteksi sekaligus, lalu tanyakan SEMUA field yang masih kurang
dalam satu pesan singkat.
```

State CLARIFYING, STOCK_CHECK, CONFIRMING, ADD_MORE, DELIVERY tidak diubah.

### Konfigurasi (env vars)

| Variable | Default | Tujuan |
|---|---|---|
| `DEBOUNCE_ENABLED` | `false` (deploy aman) → `true` setelah QA | Kill switch |
| `DEBOUNCE_SOFT_WAIT_MS` | `5000` | Window reset tiap pesan baru |
| `DEBOUNCE_HARD_WAIT_MS` | `12000` | Cap dari pesan pertama |
| `DEBOUNCE_HOLDOUT_PERCENT` | `0` | Persen phone yang bypass debounce (untuk A/B nanti) |

### File yang TIDAK disentuh

`engine/machine.go`, `engine/parser.go`, `engine/retry.go`, `gemini/client.go`, semua di `db/`, `scheduler/`, `heartbeat/`, `followup/`, semua frontend React.

## Data Flow

### Skenario A — Rapid-fire customer (golden path)

```
t=0.0s  Customer kirim "halo"
        ├─ Handle() filter passes
        ├─ rules.CheckEscalation("halo") → none
        ├─ debounce.Push(phone, "halo")
        │   └─ state: IDLE → BUFFERING
        │       ├─ texts = ["halo"]
        │       ├─ firstMsgAt = 0.0
        │       ├─ softTimer set 5s (expire @ 5.0)
        │       ├─ hardTimer set 12s (expire @ 12.0)
        │       └─ startTyping() — kirim Composing ke WA
        └─ return (gak respond dulu)

t=2.1s  Customer kirim "saya tony"
        ├─ debounce.Push(phone, "saya tony")
        │   └─ state BUFFERING:
        │       ├─ texts = ["halo", "saya tony"]
        │       ├─ softTimer di-stop, set ulang 5s (expire @ 7.1)
        │       └─ hardTimer tetap @ 12.0
        └─ return

t=4.5s  Customer kirim "mau panel box 40x30 5 pcs ke Jakarta"
        ├─ debounce.Push(phone, "mau panel box ...")
        │   └─ state BUFFERING:
        │       ├─ texts = 3 elements
        │       ├─ softTimer set ulang 5s (expire @ 9.5)
        │       └─ hardTimer tetap @ 12.0
        └─ return

t=9.5s  softTimer expire → flush()
        ├─ state BUFFERING → PROCESSING
        ├─ texts moved to local var, pb.texts = nil
        ├─ kedua timer di-stop
        ├─ joined = "halo\nsaya tony\nmau panel box 40x30 5 pcs ke Jakarta"
        ├─ flushFn(ctx, phone, joined, originalTexts)
        │   └─ processJoinedMessage:
        │       ├─ GetOrCreateConversation
        │       ├─ Insert 3 message rows (1 per originalText, untuk audit)
        │       ├─ engine.Machine.Process(conv, joined, ...) — 1 Gemini call
        │       ├─ Insert AI reply row
        │       └─ sender.SendText(reply)
        ├─ postFlush: nextBuffer empty → state IDLE
        └─ stopTyping() — kirim Paused ke WA
```

**Hasil**: 3 pesan customer → 3 rows di DB + 1 Gemini call + 1 reply WA. Total 9.5s+ε customer melihat typing indicator.

### Skenario B — Hard cap menyelamatkan dari infinite-typing customer

```
t=0.0s   "halo"           → BUFFERING, soft @ 5s, hard @ 12s
t=3.0s   "mau tanya"      → soft reset @ 8s, hard tetap @ 12s
t=6.0s   "panel box"      → soft reset @ 11s, hard tetap @ 12s
t=9.0s   "ukuran berapa"  → soft reset @ 14s, hard tetap @ 12s
t=12.0s  hardTimer expire → flush() (4 pesan)
```

Customer tidak dibiarkan menunggu lebih dari 12 detik dari pesan pertama.

### Skenario C — Escalation keyword di tengah buffering

```
t=0.0s   "halo, mau panel box"     → BUFFERING
t=2.0s   "ada diskon ga?"
         ├─ Handle() jalan dulu
         ├─ rules.CheckEscalation → EscalationAdmin
         ├─ debounce.Flush(phone) — proses buffer existing dulu
         │   └─ joined = "halo, mau panel box\nada diskon ga?"
         │       Gemini call, reply normal, state → IDLE
         ├─ handleAdminEscalation(phone) — escalation message terkirim
         └─ return
```

Customer dapat 2 reply terpisah dalam ~1 detik: reply normal + escalation notice.

### Skenario D — Pesan masuk saat PROCESSING

```
t=9.5s   softTimer expire → state BUFFERING → PROCESSING
         Gemini call mulai (~2-3 detik)

t=10.2s  Customer kirim "oh iya, lupa nama saya andi"
         └─ state PROCESSING → nextBuffer = ["oh iya, lupa..."]
            (gak interrupt Gemini, gak reset timer)

t=12.0s  Gemini selesai, reply terkirim
         ├─ postFlush: nextBuffer not empty
         ├─ state PROCESSING → BUFFERING (cycle 2)
         ├─ texts = nextBuffer, nextBuffer = nil
         ├─ firstMsgAt = 12.0
         ├─ softTimer set 5s, hardTimer set 12s
         └─ typing indicator tetap on
```

Pesan koreksi customer tidak hilang, diproses di siklus berikutnya. Total 2 reply Calista, masing-masing dengan context utuh.

### Skenario E — Customer cuma kirim 1 pesan

```
t=0.0s   "berapa harga panel box 40x30?"  → BUFFERING
t=5.0s   softTimer expire → flush() (1 pesan)
```

5 detik delay walaupun cuma 1 pesan. Trade-off accepted — typing indicator bikin terasa natural.

## Error Handling

### Per-step failure di `flush()`

```go
func (h *DebounceHandler) flush(phone string) {
    pb := h.getBuffer(phone)

    pb.mu.Lock()
    if pb.state != stateBuffering {
        pb.mu.Unlock()
        return  // idempotent
    }
    texts := pb.texts
    pb.texts = nil
    pb.softTimer.Stop()
    pb.hardTimer.Stop()
    pb.state = stateProcessing
    pb.mu.Unlock()

    defer func() {
        if r := recover(); r != nil {
            log.Printf("[DEBOUNCE] panic in flush phone=%s: %v", phone, r)
        }
        h.postFlush(pb, phone)
    }()

    joined := strings.Join(texts, "\n")
    if err := h.flushFn(context.Background(), phone, joined, texts); err != nil {
        log.Printf("[DEBOUNCE] flushFn error phone=%s: %v", phone, err)
    }
}
```

Error handling di `processJoinedMessage` sama dengan `processMessage` existing:

| Step | Error | Handling |
|---|---|---|
| `GetOrCreateConversation` | DB drop | existing retry 3×, log + drop |
| `InsertMessage` (N rows) | DB drop | per-row insert; gagal salah satu log + lanjut |
| `engine.Machine.Process` | 429 / timeout | existing `engine/retry.go` smart retry (bail on rate limit) |
| `InsertMessage` (AI reply) | DB drop | log + lanjut send |
| `sender.SendText` | WA disconnect | log + drop reply, conv state masih ke-update |

Debounce tidak menambah error path baru di pipeline core.

### Safety nets

**`postFlush` — cleanup pasti jalan:**

```go
func (h *DebounceHandler) postFlush(pb *phoneBuffer, phone string) {
    pb.mu.Lock()
    defer pb.mu.Unlock()

    if len(pb.nextBuffer) > 0 {
        pb.state = stateBuffering
        pb.texts = pb.nextBuffer
        pb.nextBuffer = nil
        pb.firstMsgAt = h.clock.Now()
        pb.startTimers()
    } else {
        pb.state = stateIdle
        pb.stopTyping()
        h.mu.Lock()
        delete(h.buffers, phone)
        h.mu.Unlock()
    }
}
```

**Buffer size cap** — `const maxBufferTexts = 20`. Customer spam pesan ke-21 di-drop dengan log warning.

**Timer cleanup** — `Stop()` eksplisit di setiap flush; reset eksplisit di setiap push baru saat BUFFERING.

**Typing indicator goroutine** — single goroutine per phone, loop sampai `typingStop` channel di-close. Idempotent close (nil-check).

**Panic recovery** — `defer recover()` di `Handle()` dan di `flush()`. Sudah pattern yang ada di codebase.

### Catastrophic failures

**Cloud Run restart / OOM**: buffer in-memory hilang. Customer message dalam buffer hilang juga. **Mitigasi v1**: terima loss; window 5 detik = jendela risiko kecil. **Mitigasi v2 (kalau perlu)**: persist buffer ke Postgres (`pending_message_buffer` table), trade-off +1 DB write per push.

**Graceful shutdown**: `main.go` signal handler tambah `debounce.Shutdown(ctx)` sebelum `waClient.Disconnect()`. Loop semua buffer, flush sinkron yang BUFFERING (timeout 8 detik).

**PROCESSING state stuck**: Gemini context timeout sudah ada di `engine/retry.go`. Timeout → flushFn return error → `postFlush` defer jalan → state ke IDLE.

**Customer DDoS**: buffer cap 20 + hard timer 12s = max 5 flush/menit per phone + Gemini retry bail on rate limit. Acceptable untuk threat model panel-electrical.

### Observabilitas

Log structured per event:
```
[DEBOUNCE] action=push    phone=628xxx state=IDLE→BUFFERING
[DEBOUNCE] action=push    phone=628xxx state=BUFFERING texts_count=2
[DEBOUNCE] action=flush   phone=628xxx reason=soft_timer texts_count=3 wait_ms=5200
[DEBOUNCE] action=flush   phone=628xxx reason=hard_cap   texts_count=4 wait_ms=12000
[DEBOUNCE] action=flush   phone=628xxx reason=escalation texts_count=1
[DEBOUNCE] action=spam    phone=628xxx dropped=true texts_count=21
[DEBOUNCE] action=panic   phone=628xxx err="..."
```

Heartbeat daily report dapat 3 baris baru:
```
DEBOUNCE today
- total flush:        287
- avg texts/flush:    2.3
- avg wait_ms:        4800
- hardcap rate:       4.2%
- spam dropped:       0
```

### Yang sengaja TIDAK di-handle

- Customer kirim dari device berbeda dengan phone yang sama → masuk buffer yang sama (by design).
- WhatsApp delivery receipt delay (centang abu-abu lebih lama) — acceptable.
- Pesan sangat panjang (>10000 karakter) — Gemini context window cukup besar, tidak perlu chunk.
- Voice message di tengah text buffering — voice = media bypass, di-handle terpisah.

## Testing

### Unit tests — `backend-go/internal/whatsapp/debounce_test.go`

Semua test pakai `Clock` interface yang di-inject. Tidak ada `time.Sleep` real.

| Test | Yang diuji |
|---|---|
| `TestPush_IdleToBuffering` | Pesan pertama → IDLE→BUFFERING, timers set, typing on |
| `TestPush_BufferingResetsSoftTimer` | Pesan kedua → softTimer reset, hardTimer tetap |
| `TestFlush_SoftTimerExpires` | 5s tanpa pesan → flush dipanggil dengan teks gabungan |
| `TestFlush_HardCapEnforced` | Rapid-fire 4 pesan @ 3s → flush @ 12s (bukan @ 14s) |
| `TestProcessing_NextBufferDuringFlush` | Pesan masuk saat PROCESSING → masuk nextBuffer, cycle ke-2 setelah selesai |
| `TestSpamCap_DropsExcess` | Pesan ke-21 → drop dengan log warning |
| `TestForceFlush_EscalationBypass` | `Flush(phone)` saat BUFFERING → flush sinkron, state IDLE |
| `TestShutdown_DrainsBuffers` | `Shutdown(ctx)` flush semua BUFFERING, return saat selesai |
| `TestPostFlush_TransitionsToIdle` | flushFn selesai, nextBuffer kosong → IDLE, typing off, map entry dihapus |
| `TestPostFlush_TransitionsToBuffering` | flushFn selesai, nextBuffer ada → cycle baru BUFFERING |
| `TestPanicRecovery_FlushFnPanics` | flushFn panic → `defer recover()`, postFlush tetap jalan |

**Concurrency tests (jalankan dengan `-race`):**

| Test | Yang diuji |
|---|---|
| `TestConcurrentPush_SamePhone` | 100 goroutine push same phone → no race, urut |
| `TestConcurrentPush_DifferentPhones` | 100 phone × 10 pesan → no race, no cross-contamination |
| `TestConcurrentFlushAndPush` | Push masuk persis saat flush mulai → masuk nextBuffer atau buffer baru, tidak hilang |

**Fake clock implementation (~30 baris):**
```go
type fakeClock struct {
    mu     sync.Mutex
    now    time.Time
    timers []*fakeTimer  // sorted by deadline
}
func (c *fakeClock) Advance(d time.Duration)
func (c *fakeClock) Now() time.Time
func (c *fakeClock) AfterFunc(d, f) *time.Timer
```

### Integration tests — `debounce_integration_test.go`

In-package, pakai stub Gemini & WA:

| Test | Skenario |
|---|---|
| `TestEndToEnd_RapidFireOneFlush` | 3 pesan dalam 5s → 1 call ke mockMachine.Process dengan teks gabungan |
| `TestEndToEnd_HardCapFires` | 4 pesan @ 3s → 1 call @ 12s |
| `TestEndToEnd_EscalationBypassesBuffer` | "halo" + "ada diskon?" → buffer di-flush + escalation, 2 reply terpisah |
| `TestEndToEnd_MediaBypassesBuffer` | "halo" + foto → buffer di-flush + handleMediaMessage |
| `TestEndToEnd_GracefulShutdown` | 5 phone BUFFERING → Shutdown → semua di-flush |

### Manual QA pre-deploy

Pakai dua HP atau sandbox lokal. Wajib semua passing sebelum deploy:

1. **Single message**: kirim "halo", tunggu 5s, dapat reply normal.
2. **Rapid-fire**: kirim 3 pesan secepatnya, dapat 1 reply gabungan.
3. **Typing indicator**: confirm "Calista is typing..." muncul di HP selama buffer aktif.
4. **Escalation**: kirim "halo" + 3s + "mau diskon" → 2 reply (normal + escalation).
5. **Media**: kirim "halo" + 3s + foto → 1 reply (buffer flush) + auto-escalate untuk foto.
6. **Hard cap**: rapid-fire 5 pesan @ 3s → Calista mulai reply di ~12s.

## Rollout Plan

Karena Calista belum dipakai customer produksi, langsung 100% setelah QA passing — gradual rollout tidak diperlukan.

| Fase | Setting | Yang dilakukan |
|---|---|---|
| **Pre-deploy** | manual QA sandbox / dua HP | 6 skenario manual QA. Wajib semua passing. |
| **Deploy** | `DEBOUNCE_ENABLED=true`, no holdout | Push code ke main, Cloud Build deploy. Daemon restart, debounce aktif untuk semua phone. |
| **Hari 1–3** | monitor pasif | Tail log untuk error & metric (push count, flush count, hardcap rate). Manual review tiap chat. |
| **Hari 4+** | normal operation | Heartbeat report harian dapat baris debounce. Watch trends. |

**Kill switch**: `DEBOUNCE_ENABLED=false` → behavior lama tanpa code revert. Untuk emergency.

**Hold-out group ditunda** — saat ini volume terlalu kecil. Bisa di-enable nanti via env var `DEBOUNCE_HOLDOUT_PERCENT=5` tanpa deploy ulang.

## Success Metrics

Review setelah 2 minggu di 100%:

| Metric | Baseline (pre-debounce) | Target |
|---|---|---|
| Gemini calls per chat | ~7 | ≤ 4.5 (35%+ reduction) |
| Chat-to-paid order conversion | (current %) | ≥ baseline (tidak boleh turun) |
| Daily customer capacity (free tier) | ~143 | ≥ 230 |
| 429 rate (rate limit error) | (current) | ≤ baseline |
| Manual reviewer score | (subjective) | "Calista terasa lebih nyambung" |

## Open Questions / Future Work

- **Buffer persistence**: kalau insiden restart bikin pesan hilang, tambahkan Postgres-backed buffer.
- **Adaptive window**: track inter-message gap per conversation, sesuaikan softWait per customer. Skip di v1.
- **Hold-out cohort**: enable saat volume cukup untuk pengukuran statistik (mungkin > 100 chat/hari).
- **Option A (deterministic shortcuts)**: layer di atas debounce kalau capacity perlu naik lagi setelah B di-evaluate.
- **Slim system prompt + Gemini Context Caching**: relevan saat upgrade paid tier.

## Estimasi Effort

| Komponen | Lines |
|---|---|
| `phoneBuffer` struct + methods | ~120 |
| `DebounceHandler` map + accessor | ~40 |
| Typing indicator goroutine | ~30 |
| Integrasi ke `Handle()` + refactor `processMessage` → `processJoinedMessage` | ~25 |
| Prompt tweak `engine/prompts.go` | ~20 |
| Unit tests (dengan fake clock) | ~150 |
| Integration tests | ~100 |
| Feature flag + config plumbing | ~15 |
| **Total** | **~500 baris** |

Estimasi waktu implementasi: **2 hari** termasuk QA manual.
