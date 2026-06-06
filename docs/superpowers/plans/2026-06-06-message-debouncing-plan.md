# Message Debouncing untuk Calista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan debounce layer ke Go WhatsApp daemon agar pesan customer dalam window 5 detik (hard cap 12s) di-coalesce ke satu Gemini call — meningkatkan capacity free tier dari ~143 ke ~285 chat/hari dan memperbaiki kualitas reply Calista.

**Architecture:** Layer baru `DebounceHandler` di antara `Handle()` (WA event entry) dan `processMessage` existing. Per-phone state machine (IDLE → BUFFERING → PROCESSING) dengan dual timer (soft reset, hard cap). Media + escalation keyword bypass debounce. Typing indicator selama buffer aktif. Feature flag `DEBOUNCE_ENABLED` untuk kill switch.

**Tech Stack:** Go 1.25, whatsmeow, sync.Mutex, time.Timer, testify (untuk assertions di test baru), fake clock pattern.

**Spec:** `docs/superpowers/specs/2026-06-06-message-debouncing-design.md`

---

## File Structure

| File | Action | Tujuan |
|---|---|---|
| `backend-go/internal/whatsapp/clock.go` | Create | `Clock` interface + `realClock` |
| `backend-go/internal/whatsapp/clock_test.go` | Create | `fakeClock` test helper |
| `backend-go/internal/whatsapp/debounce.go` | Create | `DebounceHandler` + `phoneBuffer` |
| `backend-go/internal/whatsapp/debounce_test.go` | Create | Unit tests |
| `backend-go/internal/whatsapp/debounce_integration_test.go` | Create | End-to-end tests |
| `backend-go/internal/whatsapp/handler.go` | Modify | Add `debounce` field, rename `processMessage` → `processJoinedMessage`, route via debounce |
| `backend-go/internal/engine/prompts.go` | Modify | Tweak COLLECTING prompt untuk multi-field extraction |
| `backend-go/internal/engine/prompts_test.go` | Modify | Add test untuk multi-field instruction |
| `backend-go/main.go` | Modify | Instantiate DebounceHandler, wire shutdown drain |

---

## Task 1: Clock interface dan fakeClock helper

**Files:**
- Create: `backend-go/internal/whatsapp/clock.go`
- Create: `backend-go/internal/whatsapp/clock_test.go`

Foundation untuk timer testability — semua timer di debounce pakai interface ini supaya unit test gak perlu `time.Sleep` real.

- [ ] **Step 1: Write fakeClock test**

`backend-go/internal/whatsapp/clock_test.go`:
```go
package whatsapp

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestFakeClock_AfterFuncFiresOnAdvance(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	var fired int32

	fc.AfterFunc(5*time.Second, func() {
		atomic.StoreInt32(&fired, 1)
	})

	fc.Advance(4 * time.Second)
	if atomic.LoadInt32(&fired) != 0 {
		t.Fatalf("timer fired too early")
	}

	fc.Advance(2 * time.Second) // total 6s, past the 5s deadline
	if atomic.LoadInt32(&fired) != 1 {
		t.Fatalf("timer did not fire after deadline passed")
	}
}

func TestFakeClock_StopPreventsFire(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	var fired int32

	timer := fc.AfterFunc(5*time.Second, func() {
		atomic.StoreInt32(&fired, 1)
	})

	if !timer.Stop() {
		t.Fatalf("Stop returned false on active timer")
	}
	fc.Advance(10 * time.Second)
	if atomic.LoadInt32(&fired) != 0 {
		t.Fatalf("timer fired after Stop()")
	}
}

func TestFakeClock_NowAdvances(t *testing.T) {
	start := time.Unix(1000, 0)
	fc := newFakeClock(start)
	fc.Advance(7 * time.Second)
	if !fc.Now().Equal(start.Add(7 * time.Second)) {
		t.Fatalf("Now did not advance correctly: got %v", fc.Now())
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestFakeClock -v`
Expected: FAIL with "undefined: newFakeClock"

- [ ] **Step 3: Implement Clock + fakeClock**

`backend-go/internal/whatsapp/clock.go`:
```go
package whatsapp

import "time"

// Clock abstracts time so tests can run deterministically with a fake clock.
type Clock interface {
	Now() time.Time
	AfterFunc(d time.Duration, f func()) Timer
}

// Timer abstracts time.Timer so fakes can implement Stop().
type Timer interface {
	Stop() bool
}

// realClock is the production implementation.
type realClock struct{}

func newRealClock() Clock { return realClock{} }

func (realClock) Now() time.Time { return time.Now() }
func (realClock) AfterFunc(d time.Duration, f func()) Timer {
	return time.AfterFunc(d, f)
}
```

Then add fakeClock to `clock_test.go` (same file as tests):
```go
import (
	"sort"
	"sync"
)

type fakeTimer struct {
	deadline time.Time
	fn       func()
	stopped  bool
	clock    *fakeClock
}

func (t *fakeTimer) Stop() bool {
	t.clock.mu.Lock()
	defer t.clock.mu.Unlock()
	if t.stopped {
		return false
	}
	t.stopped = true
	return true
}

type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}

func newFakeClock(start time.Time) *fakeClock {
	return &fakeClock{now: start}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) Timer {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{
		deadline: c.now.Add(d),
		fn:       f,
		clock:    c,
	}
	c.timers = append(c.timers, t)
	return t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	// Snapshot timers that should fire, sorted by deadline
	due := make([]*fakeTimer, 0)
	remaining := make([]*fakeTimer, 0)
	for _, t := range c.timers {
		if t.stopped {
			continue
		}
		if !t.deadline.After(c.now) {
			due = append(due, t)
		} else {
			remaining = append(remaining, t)
		}
	}
	sort.Slice(due, func(i, j int) bool {
		return due[i].deadline.Before(due[j].deadline)
	})
	c.timers = remaining
	c.mu.Unlock()

	// Fire callbacks OUTSIDE the lock (callbacks may reacquire it)
	for _, t := range due {
		t.fn()
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestFakeClock -v`
Expected: PASS 3 tests

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/clock.go backend-go/internal/whatsapp/clock_test.go
git commit -m "feat(whatsapp): add Clock interface with realClock and fakeClock for testable timers"
```

---

## Task 2: phoneBuffer struct dan Push IDLE→BUFFERING

**Files:**
- Create: `backend-go/internal/whatsapp/debounce.go`
- Create: `backend-go/internal/whatsapp/debounce_test.go`

Buffer per-phone yang menerima pesan pertama → enter BUFFERING dengan dual timer.

- [ ] **Step 1: Write failing test**

`backend-go/internal/whatsapp/debounce_test.go`:
```go
package whatsapp

import (
	"context"
	"sync"
	"testing"
	"time"
)

// stubFlushFn captures flush invocations for assertion.
type stubFlushFn struct {
	mu    sync.Mutex
	calls []stubFlushCall
}

type stubFlushCall struct {
	phone string
	joined string
	originalTexts []string
}

func (s *stubFlushFn) fn(ctx context.Context, phone, joined string, originalTexts []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, stubFlushCall{phone, joined, append([]string{}, originalTexts...)})
	return nil
}

func (s *stubFlushFn) getCalls() []stubFlushCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]stubFlushCall{}, s.calls...)
}

func newTestDebounce(t *testing.T, clock *fakeClock, flushFn FlushFunc) *DebounceHandler {
	t.Helper()
	return NewDebounceHandler(DebounceConfig{
		Clock:    clock,
		FlushFn:  flushFn,
		SoftWait: 5 * time.Second,
		HardWait: 12 * time.Second,
	})
}

func TestPush_IdleToBuffering(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628xxx", "halo")

	pb := d.getBufferUnsafe("628xxx")
	if pb == nil {
		t.Fatalf("expected buffer to be created")
	}
	if pb.state != stateBuffering {
		t.Fatalf("expected state=BUFFERING, got %v", pb.state)
	}
	if len(pb.texts) != 1 || pb.texts[0] != "halo" {
		t.Fatalf("expected texts=['halo'], got %v", pb.texts)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestPush_IdleToBuffering -v`
Expected: FAIL with "undefined: DebounceHandler" / "undefined: stateBuffering"

- [ ] **Step 3: Implement minimal DebounceHandler + phoneBuffer**

`backend-go/internal/whatsapp/debounce.go`:
```go
package whatsapp

import (
	"context"
	"sync"
	"time"
)

type bufferState int

const (
	stateIdle bufferState = iota
	stateBuffering
	stateProcessing
)

// FlushFunc dipanggil oleh debounce saat window expire.
type FlushFunc func(ctx context.Context, phone string, joined string, originalTexts []string) error

type phoneBuffer struct {
	mu          sync.Mutex
	state       bufferState
	texts       []string
	firstMsgAt  time.Time
	softTimer   Timer
	hardTimer   Timer
	typingStop  chan struct{}
	nextBuffer  []string
}

type DebounceConfig struct {
	Clock    Clock
	FlushFn  FlushFunc
	SoftWait time.Duration
	HardWait time.Duration
}

type DebounceHandler struct {
	mu       sync.RWMutex
	buffers  map[string]*phoneBuffer
	clock    Clock
	flushFn  FlushFunc
	softWait time.Duration
	hardWait time.Duration
}

func NewDebounceHandler(cfg DebounceConfig) *DebounceHandler {
	return &DebounceHandler{
		buffers:  make(map[string]*phoneBuffer),
		clock:    cfg.Clock,
		flushFn:  cfg.FlushFn,
		softWait: cfg.SoftWait,
		hardWait: cfg.HardWait,
	}
}

// Push adds a text to the buffer for the given phone.
// Called from handler.go for text messages that should be debounced.
func (h *DebounceHandler) Push(ctx context.Context, phone, text string) {
	pb := h.getOrCreateBuffer(phone)
	pb.mu.Lock()
	defer pb.mu.Unlock()

	switch pb.state {
	case stateIdle:
		pb.state = stateBuffering
		pb.firstMsgAt = h.clock.Now()
		pb.texts = []string{text}
		// timer setup di task berikutnya
	case stateBuffering:
		pb.texts = append(pb.texts, text)
	case stateProcessing:
		pb.nextBuffer = append(pb.nextBuffer, text)
	}
}

func (h *DebounceHandler) getOrCreateBuffer(phone string) *phoneBuffer {
	h.mu.RLock()
	pb, ok := h.buffers[phone]
	h.mu.RUnlock()
	if ok {
		return pb
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if pb, ok = h.buffers[phone]; ok {
		return pb
	}
	pb = &phoneBuffer{state: stateIdle}
	h.buffers[phone] = pb
	return pb
}

// getBufferUnsafe is for tests only — no locking, no creation.
func (h *DebounceHandler) getBufferUnsafe(phone string) *phoneBuffer {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.buffers[phone]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestPush_IdleToBuffering -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/debounce.go backend-go/internal/whatsapp/debounce_test.go
git commit -m "feat(whatsapp): add DebounceHandler skeleton with phoneBuffer Push IDLE→BUFFERING"
```

---

## Task 3: Soft timer setup dan reset on second Push

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce.go`
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

Push pertama set soft timer; push kedua di state BUFFERING reset soft timer.

- [ ] **Step 1: Write failing test**

Tambahkan ke `debounce_test.go`:
```go
func TestPush_BufferingResetsSoftTimer(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628xxx", "halo")
	fc.Advance(3 * time.Second)         // t=3s, dalam window
	d.Push(context.Background(), "628xxx", "tony")
	fc.Advance(4 * time.Second)         // t=7s — would expire if not reset (5s from t=0)
	if got := len(stub.getCalls()); got != 0 {
		t.Fatalf("flush fired prematurely after %d calls", got)
	}

	fc.Advance(2 * time.Second)         // t=9s — past reset deadline of 8s (3+5)
	if got := len(stub.getCalls()); got != 1 {
		t.Fatalf("expected 1 flush call, got %d", got)
	}
	call := stub.getCalls()[0]
	if call.joined != "halo\ntony" {
		t.Fatalf("expected joined='halo\\ntony', got %q", call.joined)
	}
	if call.phone != "628xxx" {
		t.Fatalf("expected phone='628xxx', got %q", call.phone)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestPush_BufferingResetsSoftTimer -v`
Expected: FAIL — timer never fires (not implemented yet)

- [ ] **Step 3: Implement timers + flush**

Update `debounce.go` Push and add startTimers/flush/postFlush:
```go
// Replace Push body:
func (h *DebounceHandler) Push(ctx context.Context, phone, text string) {
	pb := h.getOrCreateBuffer(phone)
	pb.mu.Lock()

	switch pb.state {
	case stateIdle:
		pb.state = stateBuffering
		pb.firstMsgAt = h.clock.Now()
		pb.texts = []string{text}
		h.startTimers(pb, phone)
	case stateBuffering:
		pb.texts = append(pb.texts, text)
		h.resetSoftTimer(pb, phone)
	case stateProcessing:
		pb.nextBuffer = append(pb.nextBuffer, text)
	}
	pb.mu.Unlock()
}

// startTimers must be called with pb.mu held.
func (h *DebounceHandler) startTimers(pb *phoneBuffer, phone string) {
	pb.softTimer = h.clock.AfterFunc(h.softWait, func() { h.flush(phone, "soft_timer") })
	pb.hardTimer = h.clock.AfterFunc(h.hardWait, func() { h.flush(phone, "hard_cap") })
}

// resetSoftTimer must be called with pb.mu held.
func (h *DebounceHandler) resetSoftTimer(pb *phoneBuffer, phone string) {
	if pb.softTimer != nil {
		pb.softTimer.Stop()
	}
	pb.softTimer = h.clock.AfterFunc(h.softWait, func() { h.flush(phone, "soft_timer") })
}

func (h *DebounceHandler) flush(phone, reason string) {
	pb := h.getBufferUnsafe(phone)
	if pb == nil {
		return
	}

	pb.mu.Lock()
	if pb.state != stateBuffering {
		pb.mu.Unlock()
		return // idempotent: already flushed by other timer or force-flush
	}
	texts := pb.texts
	pb.texts = nil
	if pb.softTimer != nil {
		pb.softTimer.Stop()
	}
	if pb.hardTimer != nil {
		pb.hardTimer.Stop()
	}
	pb.state = stateProcessing
	pb.mu.Unlock()

	defer h.postFlush(pb, phone)

	joined := joinTexts(texts)
	if err := h.flushFn(context.Background(), phone, joined, texts); err != nil {
		// existing pipeline handles its own retry/error logging.
		// Here we just log debounce-side errors. (Logger added in later task.)
		_ = err
	}
}

func (h *DebounceHandler) postFlush(pb *phoneBuffer, phone string) {
	pb.mu.Lock()
	defer pb.mu.Unlock()

	if len(pb.nextBuffer) > 0 {
		pb.state = stateBuffering
		pb.texts = pb.nextBuffer
		pb.nextBuffer = nil
		pb.firstMsgAt = h.clock.Now()
		h.startTimers(pb, phone)
	} else {
		pb.state = stateIdle
		h.mu.Lock()
		delete(h.buffers, phone)
		h.mu.Unlock()
	}
}

func joinTexts(texts []string) string {
	if len(texts) == 0 {
		return ""
	}
	if len(texts) == 1 {
		return texts[0]
	}
	// Manual join to avoid importing strings just for this.
	var total int
	for _, s := range texts {
		total += len(s) + 1
	}
	buf := make([]byte, 0, total)
	for i, s := range texts {
		if i > 0 {
			buf = append(buf, '\n')
		}
		buf = append(buf, s...)
	}
	return string(buf)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-go && go test ./internal/whatsapp/ -run "TestPush_" -v`
Expected: PASS 2 tests (TestPush_IdleToBuffering + TestPush_BufferingResetsSoftTimer)

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/debounce.go backend-go/internal/whatsapp/debounce_test.go
git commit -m "feat(whatsapp): debounce soft timer with reset on subsequent push"
```

---

## Task 4: Hard cap timer enforces flush regardless of soft resets

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

Hard timer dimulai dari pesan pertama dan TIDAK di-reset. Test rapid-fire 4 pesan @ 3s — flush harus terjadi @ 12s bukan @ 14s (yang akan terjadi kalau soft saja).

- [ ] **Step 1: Write failing test**

Tambahkan ke `debounce_test.go`:
```go
func TestFlush_HardCapEnforced(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628xxx", "m1")    // t=0
	fc.Advance(3 * time.Second)
	d.Push(context.Background(), "628xxx", "m2")    // t=3
	fc.Advance(3 * time.Second)
	d.Push(context.Background(), "628xxx", "m3")    // t=6
	fc.Advance(3 * time.Second)
	d.Push(context.Background(), "628xxx", "m4")    // t=9

	// At t=9, soft timer would expire at t=14, hard cap at t=12.
	fc.Advance(2*time.Second + 500*time.Millisecond)  // t=11.5: still buffered
	if got := len(stub.getCalls()); got != 0 {
		t.Fatalf("flush fired before hard cap, got %d calls", got)
	}

	fc.Advance(1 * time.Second) // t=12.5: hard cap @ 12 has fired
	if got := len(stub.getCalls()); got != 1 {
		t.Fatalf("expected hard cap to fire 1 call, got %d", got)
	}
	call := stub.getCalls()[0]
	if call.joined != "m1\nm2\nm3\nm4" {
		t.Fatalf("expected joined='m1\\nm2\\nm3\\nm4', got %q", call.joined)
	}
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestFlush_HardCapEnforced -v`
Expected: PASS — hard timer already implemented in Task 3.

(If it fails, the issue is likely in `resetSoftTimer` accidentally touching hardTimer — fix by ensuring resetSoftTimer ONLY touches softTimer.)

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/whatsapp/debounce_test.go
git commit -m "test(whatsapp): verify hard cap fires regardless of soft timer resets"
```

---

## Task 5: PROCESSING state — push goes to nextBuffer, cycle 2 starts after flush

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

Saat flushFn lagi jalan (PROCESSING), push baru masuk nextBuffer. Setelah flushFn selesai, postFlush mendetect nextBuffer dan mulai cycle baru BUFFERING.

- [ ] **Step 1: Write failing test**

Tambahkan ke `debounce_test.go`:
```go
// slowFlushFn blocks until release is closed. Allows asserting state during PROCESSING.
type slowFlushFn struct {
	stub      *stubFlushFn
	release   chan struct{}
	entered   chan struct{}
}

func (s *slowFlushFn) fn(ctx context.Context, phone, joined string, originalTexts []string) error {
	close(s.entered)
	<-s.release
	return s.stub.fn(ctx, phone, joined, originalTexts)
}

func TestProcessing_NextBufferDuringFlush(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	slow := &slowFlushFn{
		stub:    stub,
		release: make(chan struct{}),
		entered: make(chan struct{}),
	}
	d := newTestDebounce(t, fc, slow.fn)

	d.Push(context.Background(), "628xxx", "first")
	// Trigger flush
	fc.Advance(5 * time.Second)
	<-slow.entered // ensure flushFn started

	// During PROCESSING, new push should go to nextBuffer
	d.Push(context.Background(), "628xxx", "second")

	pb := d.getBufferUnsafe("628xxx")
	pb.mu.Lock()
	if pb.state != stateProcessing {
		pb.mu.Unlock()
		t.Fatalf("expected state=PROCESSING during flush, got %v", pb.state)
	}
	if len(pb.nextBuffer) != 1 || pb.nextBuffer[0] != "second" {
		pb.mu.Unlock()
		t.Fatalf("expected nextBuffer=['second'], got %v", pb.nextBuffer)
	}
	pb.mu.Unlock()

	// Release flushFn so it returns
	close(slow.release)

	// Wait for postFlush to run (state transition is sync within flush goroutine)
	// We need a small spin since flush runs in a goroutine.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		pb.mu.Lock()
		if pb.state == stateBuffering && len(pb.texts) == 1 && pb.texts[0] == "second" {
			pb.mu.Unlock()
			break
		}
		pb.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	pb.mu.Lock()
	if pb.state != stateBuffering {
		pb.mu.Unlock()
		t.Fatalf("expected cycle 2 to start in BUFFERING, got %v", pb.state)
	}
	if len(pb.texts) != 1 || pb.texts[0] != "second" {
		pb.mu.Unlock()
		t.Fatalf("expected cycle 2 texts=['second'], got %v", pb.texts)
	}
	pb.mu.Unlock()
}
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestProcessing_NextBufferDuringFlush -v -timeout 10s`

If FAIL: likely because flush is called inline (not in goroutine), so Push can't run during PROCESSING. Need to fix Task 3 implementation:
- `flush()` itself is called from `AfterFunc` callback (already a goroutine). Good.
- But the issue is sequencing: `flush` takes pb.mu.Lock, sets state PROCESSING, releases lock, runs flushFn. During flushFn execution, the pb.mu is released so Push can grab it.

If PASS: implementation already handles it. Move on.

- [ ] **Step 3: Fix if needed**

The `flush` function in Task 3 already releases pb.mu before calling flushFn, so this should pass. If it doesn't, double-check that:
1. `pb.mu.Unlock()` is called BEFORE `h.flushFn(...)` in `flush()`.
2. `postFlush` is in `defer`.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/whatsapp/debounce_test.go
git commit -m "test(whatsapp): verify nextBuffer queue during PROCESSING and cycle 2 startup"
```

---

## Task 6: postFlush transitions to IDLE when nextBuffer empty

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

Setelah flushFn selesai dan nextBuffer kosong, buffer kembali ke IDLE dan entry di map dihapus untuk cegah memory leak.

- [ ] **Step 1: Write failing test**

Tambahkan ke `debounce_test.go`:
```go
func TestPostFlush_TransitionsToIdleAndDeletesEntry(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628xxx", "halo")
	fc.Advance(5 * time.Second) // triggers flush, stub returns immediately

	// Small spin since flush + postFlush run via goroutine path
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if d.getBufferUnsafe("628xxx") == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if d.getBufferUnsafe("628xxx") != nil {
		t.Fatalf("expected buffer entry to be deleted after flush with empty nextBuffer")
	}
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestPostFlush_TransitionsToIdleAndDeletesEntry -v`
Expected: PASS (postFlush implemented in Task 3 already deletes entry)

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/whatsapp/debounce_test.go
git commit -m "test(whatsapp): verify postFlush deletes buffer entry to prevent leak"
```

---

## Task 7: Spam cap drops messages > 20

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce.go`
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

- [ ] **Step 1: Write failing test**

Tambahkan ke `debounce_test.go`:
```go
func TestSpamCap_DropsExcess(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	// Push 25 messages quickly
	for i := 0; i < 25; i++ {
		d.Push(context.Background(), "628xxx", "msg")
	}

	pb := d.getBufferUnsafe("628xxx")
	pb.mu.Lock()
	defer pb.mu.Unlock()
	if len(pb.texts) != maxBufferTexts {
		t.Fatalf("expected texts capped at %d, got %d", maxBufferTexts, len(pb.texts))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestSpamCap_DropsExcess -v`
Expected: FAIL with "undefined: maxBufferTexts" or "got 25"

- [ ] **Step 3: Implement spam cap**

In `debounce.go`, add constant and modify Push:
```go
const maxBufferTexts = 20
```

Update Push switch case stateBuffering:
```go
case stateBuffering:
    if len(pb.texts) >= maxBufferTexts {
        // log when logger is wired in later task
        pb.mu.Unlock()
        return
    }
    pb.texts = append(pb.texts, text)
    h.resetSoftTimer(pb, phone)
    pb.mu.Unlock()
    return
```

Note: previous Push body had a single deferred Unlock. Refactor to use explicit Unlock per case to avoid early-return-with-defer problem, OR keep the defer and just `return` after the cap check.

Cleanest fix — keep deferred unlock:
```go
func (h *DebounceHandler) Push(ctx context.Context, phone, text string) {
	pb := h.getOrCreateBuffer(phone)
	pb.mu.Lock()
	defer pb.mu.Unlock()

	switch pb.state {
	case stateIdle:
		pb.state = stateBuffering
		pb.firstMsgAt = h.clock.Now()
		pb.texts = []string{text}
		h.startTimers(pb, phone)
	case stateBuffering:
		if len(pb.texts) >= maxBufferTexts {
			return // spam cap — drop
		}
		pb.texts = append(pb.texts, text)
		h.resetSoftTimer(pb, phone)
	case stateProcessing:
		if len(pb.nextBuffer) >= maxBufferTexts {
			return
		}
		pb.nextBuffer = append(pb.nextBuffer, text)
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestSpamCap_DropsExcess -v`
Expected: PASS

- [ ] **Step 5: Run all debounce tests to make sure no regression**

Run: `cd backend-go && go test ./internal/whatsapp/ -run "TestPush_|TestFlush_|TestProcessing_|TestPostFlush_|TestSpamCap_" -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/whatsapp/debounce.go backend-go/internal/whatsapp/debounce_test.go
git commit -m "feat(whatsapp): spam cap drops messages above maxBufferTexts (20)"
```

---

## Task 8: Panic recovery in flush

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce.go`
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

Kalau flushFn panic, recover dan tetap jalankan postFlush sehingga state buffer pulih ke IDLE.

- [ ] **Step 1: Write failing test**

Tambahkan ke `debounce_test.go`:
```go
func TestPanicRecovery_FlushFnPanics(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	panicFn := func(ctx context.Context, phone, joined string, originalTexts []string) error {
		panic("simulated panic")
	}
	d := newTestDebounce(t, fc, panicFn)

	d.Push(context.Background(), "628xxx", "halo")
	fc.Advance(5 * time.Second)

	// Wait for goroutine + recover to finish
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if d.getBufferUnsafe("628xxx") == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if d.getBufferUnsafe("628xxx") != nil {
		t.Fatalf("expected buffer entry deleted after panic recovery")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestPanicRecovery_FlushFnPanics -v`
Expected: FAIL — test runner reports the panic and may crash.

- [ ] **Step 3: Add panic recovery in flush**

In `debounce.go` `flush()`, wrap flushFn call:
```go
func (h *DebounceHandler) flush(phone, reason string) {
	pb := h.getBufferUnsafe(phone)
	if pb == nil {
		return
	}

	pb.mu.Lock()
	if pb.state != stateBuffering {
		pb.mu.Unlock()
		return
	}
	texts := pb.texts
	pb.texts = nil
	if pb.softTimer != nil {
		pb.softTimer.Stop()
	}
	if pb.hardTimer != nil {
		pb.hardTimer.Stop()
	}
	pb.state = stateProcessing
	pb.mu.Unlock()

	defer h.postFlush(pb, phone)
	defer func() {
		if r := recover(); r != nil {
			// log when logger wired in
			_ = r
		}
	}()

	joined := joinTexts(texts)
	_ = h.flushFn(context.Background(), phone, joined, texts)
}
```

**Important**: order of defers matters. `defer postFlush` is registered FIRST (so it runs LAST, after recover). The `defer recover` is registered SECOND (so it runs FIRST, catching the panic before postFlush).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestPanicRecovery_FlushFnPanics -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/debounce.go backend-go/internal/whatsapp/debounce_test.go
git commit -m "feat(whatsapp): recover panic in flush, ensure postFlush always runs"
```

---

## Task 9: Force-flush method for bypass paths

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce.go`
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

`Flush(phone)` public method untuk handler.go panggil saat ada escalation keyword atau media → buffer existing di-flush sinkron, baru bypass path jalan.

- [ ] **Step 1: Write failing test**

Tambahkan ke `debounce_test.go`:
```go
func TestForceFlush_FlushesBufferSynchronously(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628xxx", "halo")
	d.Push(context.Background(), "628xxx", "mau panel")

	if got := len(stub.getCalls()); got != 0 {
		t.Fatalf("flush should not have fired yet")
	}

	d.Flush("628xxx")

	if got := len(stub.getCalls()); got != 1 {
		t.Fatalf("expected force-flush to fire 1 call, got %d", got)
	}
	if stub.getCalls()[0].joined != "halo\nmau panel" {
		t.Fatalf("expected joined='halo\\nmau panel', got %q", stub.getCalls()[0].joined)
	}
}

func TestForceFlush_NoOpWhenIdle(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	// No push → buffer is IDLE / nonexistent
	d.Flush("628xxx") // should not panic, no call

	if got := len(stub.getCalls()); got != 0 {
		t.Fatalf("force-flush on idle should be no-op, got %d calls", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestForceFlush -v`
Expected: FAIL with "undefined: d.Flush"

- [ ] **Step 3: Implement Flush**

In `debounce.go`, add public method that calls existing internal `flush`:
```go
// Flush forces immediate processing of the buffered messages for phone.
// Called from handler.go before bypass paths (escalation, media) to
// preserve customer message order.
// Idempotent: no-op if buffer is IDLE/PROCESSING or doesn't exist.
func (h *DebounceHandler) Flush(phone string) {
	h.flush(phone, "force_flush")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestForceFlush -v`
Expected: PASS 2 tests

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/debounce.go backend-go/internal/whatsapp/debounce_test.go
git commit -m "feat(whatsapp): add public Flush method for bypass-path sync drain"
```

---

## Task 10: Graceful shutdown drains all buffers

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce.go`
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

`Shutdown(ctx)` flush semua buffer yang BUFFERING. Dipanggil dari main.go saat SIGTERM.

- [ ] **Step 1: Write failing test**

Tambahkan ke `debounce_test.go`:
```go
func TestShutdown_DrainsAllBuffers(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	d.Push(context.Background(), "628aaa", "halo a")
	d.Push(context.Background(), "628bbb", "halo b")
	d.Push(context.Background(), "628ccc", "halo c")

	if got := len(stub.getCalls()); got != 0 {
		t.Fatalf("flush should not have fired before shutdown")
	}

	d.Shutdown(context.Background())

	calls := stub.getCalls()
	if len(calls) != 3 {
		t.Fatalf("expected 3 flush calls after shutdown, got %d", len(calls))
	}
	seen := map[string]bool{}
	for _, c := range calls {
		seen[c.phone] = true
	}
	for _, phone := range []string{"628aaa", "628bbb", "628ccc"} {
		if !seen[phone] {
			t.Fatalf("expected phone %s to be flushed, got calls: %+v", phone, calls)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestShutdown_DrainsAllBuffers -v`
Expected: FAIL with "undefined: d.Shutdown"

- [ ] **Step 3: Implement Shutdown**

In `debounce.go`:
```go
// Shutdown synchronously flushes all BUFFERING phones.
// Buffers in PROCESSING state are left to finish on their own.
// Respects ctx cancellation — returns early if ctx expires.
func (h *DebounceHandler) Shutdown(ctx context.Context) {
	h.mu.RLock()
	phones := make([]string, 0, len(h.buffers))
	for phone := range h.buffers {
		phones = append(phones, phone)
	}
	h.mu.RUnlock()

	for _, phone := range phones {
		select {
		case <-ctx.Done():
			return
		default:
		}
		h.flush(phone, "shutdown")
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestShutdown_DrainsAllBuffers -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/debounce.go backend-go/internal/whatsapp/debounce_test.go
git commit -m "feat(whatsapp): add Shutdown method to drain buffers on graceful exit"
```

---

## Task 11: Concurrency safety with race detector

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

Run all debounce tests with `-race` to catch any data races.

- [ ] **Step 1: Add concurrent push test**

Tambahkan ke `debounce_test.go`:
```go
func TestConcurrentPush_NoRace(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	d := newTestDebounce(t, fc, stub.fn)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				phone := "628aaa"
				if i%2 == 0 {
					phone = "628bbb"
				}
				d.Push(context.Background(), phone, "msg")
			}
		}(i)
	}
	wg.Wait()

	// Each phone has < 20 (spam cap), but both should be in BUFFERING.
	aaa := d.getBufferUnsafe("628aaa")
	bbb := d.getBufferUnsafe("628bbb")
	if aaa == nil || bbb == nil {
		t.Fatalf("expected both buffers created, aaa=%v bbb=%v", aaa, bbb)
	}
}
```

- [ ] **Step 2: Run all debounce tests with race detector**

Run: `cd backend-go && go test ./internal/whatsapp/ -run "TestPush_|TestFlush_|TestProcessing_|TestPostFlush_|TestSpamCap_|TestPanicRecovery_|TestForceFlush_|TestShutdown_|TestConcurrentPush_|TestFakeClock_" -race -v`
Expected: ALL PASS, no race detected

- [ ] **Step 3: Fix any races found**

If race detector flags an issue:
- Check that `pb.mu` is held for all field access on `phoneBuffer`
- Check that `h.mu` (RWMutex on map) is held for `buffers` map access
- Verify `getBufferUnsafe` is only used in tests after acquiring caller-known synchronization

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/whatsapp/debounce_test.go
git commit -m "test(whatsapp): add concurrent push test with race detector"
```

---

## Task 12: Typing indicator goroutine

**Files:**
- Modify: `backend-go/internal/whatsapp/debounce.go`
- Modify: `backend-go/internal/whatsapp/debounce_test.go`

Saat BUFFERING aktif, kirim ChatPresenceComposing ke WhatsApp tiap 8 detik (composing expires ~10s). Stop saat IDLE.

Karena WhatsApp client adalah dependency external, kita abstrahkan dengan interface:

- [ ] **Step 1: Write failing test**

Tambahkan ke `debounce_test.go`:
```go
// stubTypingNotifier records typing state changes for assertion.
type stubTypingNotifier struct {
	mu    sync.Mutex
	calls []stubTypingCall
}

type stubTypingCall struct {
	phone string
	composing bool
}

func (s *stubTypingNotifier) SendTyping(phone string, composing bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, stubTypingCall{phone, composing})
}

func (s *stubTypingNotifier) calls_() []stubTypingCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]stubTypingCall{}, s.calls...)
}

func TestTypingIndicator_OnDuringBuffering(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	stub := &stubFlushFn{}
	notifier := &stubTypingNotifier{}
	d := NewDebounceHandler(DebounceConfig{
		Clock:    fc,
		FlushFn:  stub.fn,
		SoftWait: 5 * time.Second,
		HardWait: 12 * time.Second,
		Typing:   notifier,
	})

	d.Push(context.Background(), "628xxx", "halo")

	// Wait briefly for typing goroutine to send initial composing
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if len(notifier.calls_()) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	calls := notifier.calls_()
	if len(calls) == 0 {
		t.Fatalf("expected at least 1 composing call after push")
	}
	if !calls[0].composing || calls[0].phone != "628xxx" {
		t.Fatalf("expected first call composing=true phone=628xxx, got %+v", calls[0])
	}

	// Trigger flush
	fc.Advance(5 * time.Second)
	// Wait for goroutine to stop typing
	deadline = time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		calls = notifier.calls_()
		last := calls[len(calls)-1]
		if !last.composing && last.phone == "628xxx" {
			return // saw the paused signal
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected paused signal after flush, got calls: %+v", notifier.calls_())
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestTypingIndicator -v`
Expected: FAIL with "unknown field Typing" or "undefined behavior"

- [ ] **Step 3: Add TypingNotifier interface and integrate**

In `debounce.go`:
```go
// TypingNotifier sends WhatsApp typing presence updates.
type TypingNotifier interface {
	SendTyping(phone string, composing bool)
}

// noopTypingNotifier is used when no notifier is configured.
type noopTypingNotifier struct{}

func (noopTypingNotifier) SendTyping(string, bool) {}
```

Add to `DebounceConfig` and `DebounceHandler`:
```go
type DebounceConfig struct {
	Clock    Clock
	FlushFn  FlushFunc
	SoftWait time.Duration
	HardWait time.Duration
	Typing   TypingNotifier  // optional
}

type DebounceHandler struct {
	// ... existing fields
	typing   TypingNotifier
}

// NewDebounceHandler:
func NewDebounceHandler(cfg DebounceConfig) *DebounceHandler {
	typing := cfg.Typing
	if typing == nil {
		typing = noopTypingNotifier{}
	}
	return &DebounceHandler{
		buffers:  make(map[string]*phoneBuffer),
		clock:    cfg.Clock,
		flushFn:  cfg.FlushFn,
		softWait: cfg.SoftWait,
		hardWait: cfg.HardWait,
		typing:   typing,
	}
}
```

Add startTyping/stopTyping methods, called from Push (IDLE→BUFFERING) and postFlush (→IDLE):
```go
// startTyping launches a goroutine that re-sends Composing every 8s.
// Must be called with pb.mu held.
func (h *DebounceHandler) startTyping(pb *phoneBuffer, phone string) {
	pb.typingStop = make(chan struct{})
	stop := pb.typingStop
	notifier := h.typing
	go func() {
		notifier.SendTyping(phone, true) // initial composing
		ticker := time.NewTicker(8 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				notifier.SendTyping(phone, false) // paused
				return
			case <-ticker.C:
				notifier.SendTyping(phone, true) // refresh
			}
		}
	}()
}

// stopTyping signals the typing goroutine to stop.
// Must be called with pb.mu held.
func (h *DebounceHandler) stopTyping(pb *phoneBuffer) {
	if pb.typingStop != nil {
		close(pb.typingStop)
		pb.typingStop = nil
	}
}
```

Wire into Push (stateIdle case) and postFlush:

In Push:
```go
case stateIdle:
    pb.state = stateBuffering
    pb.firstMsgAt = h.clock.Now()
    pb.texts = []string{text}
    h.startTimers(pb, phone)
    h.startTyping(pb, phone)  // NEW
```

In postFlush:
```go
} else {
    pb.state = stateIdle
    h.stopTyping(pb)  // NEW
    h.mu.Lock()
    delete(h.buffers, phone)
    h.mu.Unlock()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestTypingIndicator -v`
Expected: PASS

- [ ] **Step 5: Run all tests with race detector**

Run: `cd backend-go && go test ./internal/whatsapp/ -race -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/whatsapp/debounce.go backend-go/internal/whatsapp/debounce_test.go
git commit -m "feat(whatsapp): typing indicator goroutine via TypingNotifier interface"
```

---

## **CHECKPOINT 1 — Review tasks 1-12**

At this point the `DebounceHandler` is fully built and unit-tested. Stop here for human review.

**Verification before continuing:**
- [ ] All unit tests pass with `-race`: `cd backend-go && go test ./internal/whatsapp/ -race -v`
- [ ] `debounce.go` is < 250 lines (focused responsibility)
- [ ] No exported types or methods are unused

**Manual review prompts for the reviewer:**
1. Does the public API of `DebounceHandler` (Push, Flush, Shutdown, NewDebounceHandler) feel coherent?
2. Any concurrency concern in the timer + map interaction?
3. Is `getBufferUnsafe` properly limited to test usage only?

If approved, continue. If changes requested, address them before Task 13.

---

## Task 13: COLLECTING prompt tweak for multi-field extraction

**Files:**
- Modify: `backend-go/internal/engine/prompts.go`
- Modify: `backend-go/internal/engine/prompts_test.go`

Update COLLECTING state instruction to extract all fields present in a possibly-joined customer message.

- [ ] **Step 1: Write failing test**

Tambahkan ke `prompts_test.go`:
```go
func TestBuildPromptCollecting_IncludesMultiFieldInstruction(t *testing.T) {
	conv := &models.Conversation{
		ID:    "conv-test",
		State: models.StateCollecting,
	}
	prompt := BuildPrompt(conv, "id", &models.CollectedData{}, nil, "")
	if !strings.Contains(prompt, "ekstrak SEMUA field") {
		t.Fatalf("expected multi-field instruction in COLLECTING prompt, got:\n%s", prompt)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/engine/ -run TestBuildPromptCollecting_IncludesMultiFieldInstruction -v`
Expected: FAIL — multi-field instruction not in prompt yet

- [ ] **Step 3: Update prompt**

In `prompts.go`, find the COLLECTING case in `stateInstructions` and insert (or append) the multi-field instruction. Locate the existing COLLECTING block (around the section that says "ask for one missing field"). Replace or augment with:

```
Anda mungkin menerima pesan customer yang sudah berisi beberapa field
sekaligus (contoh: "Halo, saya Tony dari Garindo Jaya, mau panel box
40x30 5 pcs untuk dikirim ke Jakarta Selatan"). Ekstrak SEMUA field
yang terdeteksi sekaligus, lalu tanyakan SEMUA field yang masih kurang
dalam satu pesan singkat.
```

Insert above the existing "tanyakan SATU field" line (or replace it).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-go && go test ./internal/engine/ -run TestBuildPromptCollecting_IncludesMultiFieldInstruction -v`
Expected: PASS

- [ ] **Step 5: Run all engine tests to verify no regression**

Run: `cd backend-go && go test ./internal/engine/ -v`
Expected: ALL PASS (no other prompts test should break)

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/engine/prompts.go backend-go/internal/engine/prompts_test.go
git commit -m "feat(prompts): COLLECTING extracts multi-field from joined messages"
```

---

## Task 14: handler.go — refactor routing and rename processMessage

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go`

Add `debounce *DebounceHandler` field. Rename `processMessage` → `processJoinedMessage`, add `originalTexts []string` param, insert N rows. Route text via debounce.

- [ ] **Step 1: Update Handler struct and constructor**

In `handler.go` line 19:
```go
type Handler struct {
	db                 *db.Client
	machine            *engine.Machine
	sender             *Sender
	scheduler          *scheduler.Scheduler
	waNumberID         string
	startedAt          time.Time
	supabaseURL        string
	supabaseServiceKey string
	debounce           *DebounceHandler // NEW
}

func NewHandler(d *db.Client, m *engine.Machine, s *Sender, sc *scheduler.Scheduler, waNumberID, supabaseURL, supabaseServiceKey string, debounce *DebounceHandler) *Handler {
	return &Handler{
		db: d, machine: m, sender: s, scheduler: sc,
		waNumberID: waNumberID, startedAt: time.Now(),
		supabaseURL: supabaseURL, supabaseServiceKey: supabaseServiceKey,
		debounce: debounce,
	}
}
```

- [ ] **Step 2: Modify Handle() routing**

In `handler.go` line 38, replace the body so text messages go through debounce. The escalation rule check moves up here so we can bypass debounce immediately:

```go
func (h *Handler) Handle(rawEvt interface{}) {
	evt, ok := rawEvt.(*events.Message)
	if !ok {
		return
	}
	if evt.Info.IsFromMe {
		return
	}
	if evt.Info.IsGroup || evt.Info.Chat.Server == "g.us" || evt.Info.Chat.Server == "broadcast" {
		log.Printf("[HANDLER] Skipping non-DM message from chat %s sender %s", evt.Info.Chat, evt.Info.Sender)
		return
	}

	text := evt.Message.GetConversation()
	if text == "" && evt.Message.GetExtendedTextMessage() != nil {
		text = evt.Message.GetExtendedTextMessage().GetText()
	}

	// Media bypass: never debounce. Drain any in-flight buffer first.
	if text == "" {
		senderJID := evt.Info.Sender.ToNonAD().String()
		if h.debounce != nil {
			h.debounce.Flush(senderJID)
		}
		h.handleMediaMessage(evt)
		return
	}

	if evt.Info.Timestamp.Before(h.startedAt.Add(-5 * time.Minute)) {
		log.Printf("[HANDLER] Dropping stale backlog from %s (msg=%v started=%v)", evt.Info.Sender, evt.Info.Timestamp, h.startedAt)
		return
	}

	log.Printf("[HANDLER] Processing text from %s: %q", evt.Info.Sender, text)
	senderJID := evt.Info.Sender.ToNonAD().String()

	// Escalation keyword bypass: drain buffer, then escalate immediately.
	esc := rules.CheckEscalation(text)
	if esc != rules.EscalationNone {
		if h.debounce != nil {
			h.debounce.Flush(senderJID)
		}
		go func() {
			ctx := context.Background()
			switch esc {
			case rules.EscalationWiring:
				h.handleWiringEscalation(ctx, senderJID, text)
			case rules.EscalationAdmin:
				h.handleAdminEscalation(ctx, senderJID, text)
			}
		}()
		return
	}

	// Normal path: route through debounce if enabled, else direct.
	if h.debounce != nil {
		h.debounce.Push(context.Background(), senderJID, text)
	} else {
		go h.processJoinedMessage(context.Background(), senderJID, text, []string{text})
	}
}
```

**Note**: assumes `handleAdminEscalation` exists with the same signature as `handleWiringEscalation`. Verify by `grep "func.*handleAdminEscalation" handler.go`.

- [ ] **Step 3: Rename processMessage → processJoinedMessage**

Find line 81 (`func (h *Handler) processMessage(ctx context.Context, senderPhone, text string)`).

Rename and add `originalTexts []string` parameter:
```go
// processJoinedMessage is the unified pipeline used for both debounced and direct text messages.
// originalTexts contains the customer's raw messages (one per actual WA message) for audit-trail
// insertion; joined `text` is the combined string sent to Gemini.
func (h *Handler) processJoinedMessage(ctx context.Context, senderPhone, text string, originalTexts []string) {
```

Inside processJoinedMessage, find where messages are inserted (currently a single InsertMessage call for customer text). Replace with a loop over originalTexts:

```go
// Insert one row per original customer message (preserves audit trail in Sales Inbox).
for _, original := range originalTexts {
    if err := h.db.InsertMessage(conv.ID, models.SenderCustomer, original); err != nil {
        log.Printf("[HANDLER] InsertMessage error for conv %s: %v", conv.ID, err)
        // continue — Gemini call doesn't depend on this
    }
}
```

If `originalTexts` is empty (defensive), fall back to using `text`:
```go
texts := originalTexts
if len(texts) == 0 {
    texts = []string{text}
}
for _, original := range texts {
    // ...
}
```

- [ ] **Step 4: Build to verify compilation**

Run: `cd backend-go && go build ./...`
Expected: clean build, no errors

Note: build will fail because `main.go` still calls `NewHandler(...)` with the old signature. Fix in Task 15.

- [ ] **Step 5: Commit**

Wait until Task 15 before committing — handler.go and main.go must be in the same commit to compile cleanly.

---

## Task 15: main.go — instantiate DebounceHandler and wire it

**Files:**
- Modify: `backend-go/main.go`

Read env vars, build DebounceHandler with realClock, pass to NewHandler. Wire shutdown drain. Build flushFn that calls processJoinedMessage.

- [ ] **Step 1: Add env var helpers (if not present)**

In `main.go`, ensure there's a helper for reading int env vars with default. If not present, add:
```go
func getEnvIntDefault(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		log.Printf("[CONFIG] bad %s=%q, using default %d: %v", key, v, def, err)
		return def
	}
	return n
}

func getEnvBoolDefault(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v == "true" || v == "1"
}
```

Add `"strconv"` to imports if needed.

- [ ] **Step 2: Build a WA typing notifier adapter**

In `main.go` (or in a new file `backend-go/internal/whatsapp/typing.go`):

```go
// waTypingNotifier implements DebounceHandler.TypingNotifier by sending
// Composing presence updates via the whatsmeow client.
type waTypingNotifier struct {
	client *whatsmeow.Client
}

func (w *waTypingNotifier) SendTyping(phone string, composing bool) {
	jid, err := types.ParseJID(phone)
	if err != nil {
		return
	}
	presence := types.ChatPresencePaused
	if composing {
		presence = types.ChatPresenceComposing
	}
	_ = w.client.SendChatPresence(jid, presence, types.ChatPresenceMediaText)
}
```

Place this in `backend-go/internal/whatsapp/typing.go` for cleanliness.

- [ ] **Step 3: Wire DebounceHandler in main.go**

Find where `NewHandler(...)` is currently called. Before that call, build the debounce:

```go
debounceEnabled := getEnvBoolDefault("DEBOUNCE_ENABLED", false)
softWaitMs := getEnvIntDefault("DEBOUNCE_SOFT_WAIT_MS", 5000)
hardWaitMs := getEnvIntDefault("DEBOUNCE_HARD_WAIT_MS", 12000)

var debounceHandler *whatsapp.DebounceHandler
if debounceEnabled {
	// Build flushFn = adapter that invokes the handler's processJoinedMessage.
	// Use a pointer to handler that we'll fill in after creation.
	var hRef *whatsapp.Handler
	flushFn := func(ctx context.Context, phone, joined string, originalTexts []string) error {
		if hRef == nil {
			return nil
		}
		hRef.ProcessJoinedMessage(ctx, phone, joined, originalTexts)
		return nil
	}
	debounceHandler = whatsapp.NewDebounceHandler(whatsapp.DebounceConfig{
		Clock:    whatsapp.NewRealClock(),
		FlushFn:  flushFn,
		SoftWait: time.Duration(softWaitMs) * time.Millisecond,
		HardWait: time.Duration(hardWaitMs) * time.Millisecond,
		Typing:   &whatsapp.WATypingNotifier{Client: waClient.Raw()}, // see Step 4
	})
	log.Printf("[MAIN] Debounce enabled soft=%dms hard=%dms", softWaitMs, hardWaitMs)
	waHandler := whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID, supabaseURL, supabaseKey, debounceHandler)
	hRef = waHandler
	waClient.AddEventHandler(waHandler.Handle)
} else {
	waHandler := whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID, supabaseURL, supabaseKey, nil)
	waClient.AddEventHandler(waHandler.Handle)
}
```

- [ ] **Step 4: Export needed symbols**

To call from main, the following must be exported from the whatsapp package:
- `NewRealClock() Clock` — rename `newRealClock` if it was lowercase
- `WATypingNotifier{Client}` — move/rename `waTypingNotifier` to exported `WATypingNotifier`
- `(*Handler).ProcessJoinedMessage(...)` — export by renaming receiver method from `processJoinedMessage` to `ProcessJoinedMessage`

In `backend-go/internal/whatsapp/clock.go`:
```go
func NewRealClock() Clock { return realClock{} }
```

In `backend-go/internal/whatsapp/typing.go`:
```go
package whatsapp

import (
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

type WATypingNotifier struct {
	Client *whatsmeow.Client
}

func (w *WATypingNotifier) SendTyping(phone string, composing bool) {
	jid, err := types.ParseJID(phone)
	if err != nil {
		return
	}
	presence := types.ChatPresencePaused
	if composing {
		presence = types.ChatPresenceComposing
	}
	_ = w.Client.SendChatPresence(jid, presence, types.ChatPresenceMediaText)
}
```

In `backend-go/internal/whatsapp/handler.go`, rename `processJoinedMessage` to `ProcessJoinedMessage`. Update internal calls accordingly.

- [ ] **Step 5: Wire shutdown drain**

Find the signal handler block in `main.go` (search for `signal.Notify` or `SIGTERM`). Add a debounce drain BEFORE the WA disconnect:

```go
<-sigChan
log.Println("[MAIN] shutdown signal received")
if debounceHandler != nil {
    log.Println("[MAIN] draining debounce buffers...")
    drainCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
    debounceHandler.Shutdown(drainCtx)
    cancel()
}
log.Println("[MAIN] disconnecting WhatsApp client...")
waClient.Disconnect()
```

- [ ] **Step 6: Build to verify everything compiles**

Run: `cd backend-go && go build ./...`
Expected: clean build

- [ ] **Step 7: Run full test suite**

Run: `cd backend-go && go test ./... -race`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go backend-go/internal/whatsapp/typing.go backend-go/internal/whatsapp/clock.go backend-go/main.go
git commit -m "feat(go): wire DebounceHandler into handler + main with env vars and graceful drain"
```

---

## Task 16: Integration test — rapid-fire one flush end-to-end

**Files:**
- Create: `backend-go/internal/whatsapp/debounce_integration_test.go`

End-to-end test stubbing `flushFn` to a mock `processJoinedMessage` that records calls. Verifies 3 pushes → 1 flushFn invocation with joined text.

- [ ] **Step 1: Write integration test**

`backend-go/internal/whatsapp/debounce_integration_test.go`:
```go
package whatsapp

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestIntegration_RapidFireSingleFlush(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	var flushCount int32
	var lastJoined string
	var lastOriginals []string

	flushFn := func(ctx context.Context, phone, joined string, originalTexts []string) error {
		atomic.AddInt32(&flushCount, 1)
		lastJoined = joined
		lastOriginals = append([]string{}, originalTexts...)
		return nil
	}

	d := NewDebounceHandler(DebounceConfig{
		Clock:    fc,
		FlushFn:  flushFn,
		SoftWait: 5 * time.Second,
		HardWait: 12 * time.Second,
	})

	d.Push(context.Background(), "628xxx", "halo")
	fc.Advance(2 * time.Second)
	d.Push(context.Background(), "628xxx", "saya tony")
	fc.Advance(2 * time.Second)
	d.Push(context.Background(), "628xxx", "mau panel")
	fc.Advance(5 * time.Second) // 5s after last push → soft timer fires

	// Allow flush goroutine to complete
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&flushCount) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if got := atomic.LoadInt32(&flushCount); got != 1 {
		t.Fatalf("expected 1 flush call, got %d", got)
	}
	if lastJoined != "halo\nsaya tony\nmau panel" {
		t.Fatalf("unexpected joined: %q", lastJoined)
	}
	if len(lastOriginals) != 3 {
		t.Fatalf("expected 3 original texts, got %d: %v", len(lastOriginals), lastOriginals)
	}
}

func TestIntegration_HardCapEndToEnd(t *testing.T) {
	fc := newFakeClock(time.Unix(0, 0))
	var flushCount int32
	flushFn := func(ctx context.Context, phone, joined string, originalTexts []string) error {
		atomic.AddInt32(&flushCount, 1)
		return nil
	}
	d := NewDebounceHandler(DebounceConfig{
		Clock:    fc,
		FlushFn:  flushFn,
		SoftWait: 5 * time.Second,
		HardWait: 12 * time.Second,
	})

	// Rapid-fire 4 messages @ 3s apart (always resetting soft timer)
	for i := 0; i < 4; i++ {
		d.Push(context.Background(), "628xxx", "msg")
		fc.Advance(3 * time.Second)
	}

	// At this point t=12s, hard cap should have fired
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&flushCount) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&flushCount); got != 1 {
		t.Fatalf("expected hard cap to trigger 1 flush, got %d", got)
	}
}
```

- [ ] **Step 2: Run tests**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestIntegration -race -v`
Expected: PASS 2 tests

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/whatsapp/debounce_integration_test.go
git commit -m "test(whatsapp): end-to-end debounce integration — rapid-fire and hard cap"
```

---

## **CHECKPOINT 2 — Review tasks 13-16**

Stop here for human review before manual QA and deploy.

**Verification before continuing:**
- [ ] Full test suite passes: `cd backend-go && go test ./... -race`
- [ ] Build clean: `cd backend-go && go build ./...`
- [ ] handler.go properly routes via debounce when enabled, direct when nil

**Manual review prompts for the reviewer:**
1. Did `Handle()` refactor preserve all existing filters (group/broadcast/stale-backlog)?
2. Does `processJoinedMessage` insert N rows correctly without duplication?
3. Is there a code path that bypasses debounce when `DEBOUNCE_ENABLED=false` cleanly?

If approved, continue to manual QA.

---

## Task 17: Manual QA on staging or two phones

**Files:**
- No code changes — checklist only.

Before flipping `DEBOUNCE_ENABLED=true` in production, run all 6 scenarios from the spec on a staging deploy or local sandbox with two phones (one daemon-paired, one customer simulator).

- [ ] **Step 1: Deploy to staging with debounce enabled**

If no staging exists, run daemon locally:
```bash
cd backend-go
DEBOUNCE_ENABLED=true \
DEBOUNCE_SOFT_WAIT_MS=5000 \
DEBOUNCE_HARD_WAIT_MS=12000 \
SUPABASE_DB_CONNECTION="host=db.... port=5432 user=postgres password='...' dbname=postgres sslmode=require" \
GEMINI_API_KEY=AIzaSy... \
go run main.go
```
Pair WA with second phone via QR.

- [ ] **Step 2: Run scenario 1 — Single message**

Action: From customer phone, send "halo" once. Wait.
Expected: ~5s after send, Calista replies with greeting. Typing indicator visible during wait.

- [ ] **Step 3: Run scenario 2 — Rapid-fire batched into one reply**

Action: Send 3 messages within 4 seconds: "halo" / "saya tony" / "mau panel box 40x30 5 pcs".
Expected: Calista replies ONCE with a context-aware response that references all three pieces.

- [ ] **Step 4: Run scenario 3 — Typing indicator visible**

Action: Send one message. Observe customer phone WhatsApp UI.
Expected: "Calista is typing..." appears within ~1 second and stays until reply arrives.

- [ ] **Step 5: Run scenario 4 — Escalation keyword bypass**

Action: Send "halo" then within 3s send "mau diskon".
Expected: TWO replies — first reply (acknowledging halo+mau diskon, but escalation triggers), then escalation message ("Untuk diskon mohon tunggu admin kami...").

(Adjust expectation if the escalation message replaces the normal reply — depends on Handle() routing in Task 14.)

- [ ] **Step 6: Run scenario 5 — Media bypass**

Action: Send "halo", then within 3s send a photo.
Expected: First a text reply (from flushing the buffered "halo"), then the photo handler runs (auto-escalate as per existing behavior).

- [ ] **Step 7: Run scenario 6 — Hard cap at 12s**

Action: Send 5 messages @ ~2.5s intervals.
Expected: ~12s after the first message, Calista starts replying. The reply references all 5 messages.

- [ ] **Step 8: Check logs**

Verify daemon logs show debounce activity:
```
[HANDLER] Processing text from 628xxx: "halo"
[DEBOUNCE] (any logging you added)
```

- [ ] **Step 9: If all 6 scenarios pass, proceed to deploy**

If any scenario fails, fix the bug, re-test, then proceed.

---

## Task 18: Deploy to production

**Files:**
- Modify: Cloud Build trigger substitutions (via gcloud CLI, no repo changes needed for env vars).

Direct 100% rollout per spec.

- [ ] **Step 1: Update Cloud Build trigger with new env vars**

Use existing `gcloud builds triggers update` command pattern. Add substitution `_DEBOUNCE_ENABLED=true`.

Find the trigger name:
```bash
gcloud builds triggers list --format="value(name)" --filter="garindo"
```

Update substitutions:
```bash
gcloud builds triggers update <TRIGGER_NAME> \
  --update-substitutions=_DEBOUNCE_ENABLED=true,_DEBOUNCE_SOFT_WAIT_MS=5000,_DEBOUNCE_HARD_WAIT_MS=12000 \
  --region=asia-southeast1
```

- [ ] **Step 2: Update cloudbuild.yaml to pass env vars to Cloud Run**

In `backend-go/cloudbuild.yaml` (or root `cloudbuild.yaml`), find the `gcloud run deploy` step. Add new `--set-env-vars` entries:
```
--set-env-vars DEBOUNCE_ENABLED=${_DEBOUNCE_ENABLED},DEBOUNCE_SOFT_WAIT_MS=${_DEBOUNCE_SOFT_WAIT_MS},DEBOUNCE_HARD_WAIT_MS=${_DEBOUNCE_HARD_WAIT_MS}
```

Commit cloudbuild.yaml change:
```bash
git add cloudbuild.yaml
git commit -m "chore(cloudbuild): pass debounce env vars to Cloud Run deploy"
```

- [ ] **Step 3: Trigger build & deploy**

```bash
git push origin main
```
Cloud Build trigger fires automatically. Wait for build to complete:
```bash
gcloud builds list --limit=1 --region=asia-southeast1
```

- [ ] **Step 4: Verify daemon is up with debounce enabled**

```bash
curl https://garindo-jaya-panel-msme-erp-xxx.asia-southeast1.run.app/api/health
```
Expected: 200 OK.

Check daemon logs:
```bash
gcloud run services logs read garindo-jaya-panel-msme-erp --region=asia-southeast1 --limit=50 | grep -E "(DEBOUNCE|MAIN)"
```
Expected: see `[MAIN] Debounce enabled soft=5000ms hard=12000ms`.

- [ ] **Step 5: Send a test message from a phone**

Using a paired test phone, send a rapid-fire sequence. Verify reply quality + timing.

- [ ] **Step 6: Monitor for 3 days**

Check daily heartbeat report for debounce metrics (if added in observability layer). Tail logs for errors:
```bash
gcloud run services logs read garindo-jaya-panel-msme-erp --region=asia-southeast1 --limit=200 --freshness=1d | grep -E "(DEBOUNCE|ERROR|PANIC)"
```

- [ ] **Step 7: Update progress.md**

Add an entry to `progress.md` documenting the deploy and what was rolled out.

```bash
git add progress.md
git commit -m "docs(progress): message debouncing deployed to production"
```

---

## Rollback Plan

If something goes wrong post-deploy:

```bash
gcloud builds triggers update <TRIGGER_NAME> \
  --update-substitutions=_DEBOUNCE_ENABLED=false \
  --region=asia-southeast1
git commit --allow-empty -m "chore: trigger redeploy to disable debounce"
git push origin main
```

Daemon redeploys with `DEBOUNCE_ENABLED=false` → behavior reverts to pre-debounce. No code revert needed.

---

## Self-Review Notes

Coverage check:
- Spec §Arsitektur → Tasks 14-15 (routing) + Tasks 2-12 (DebounceHandler)
- Spec §Komponen → Files mapped in File Structure table; all created
- Spec §Data Flow Skenario A,B → Tasks 3-4 + integration Task 16
- Spec §Data Flow Skenario C → Task 14 (Handle routing) + Task 17 (manual QA)
- Spec §Data Flow Skenario D → Task 5
- Spec §Data Flow Skenario E → Task 16 (no special case — covered by single-message integration)
- Spec §Error Handling → Tasks 7 (spam cap), 8 (panic recovery), 10 (shutdown), 11 (race)
- Spec §Testing §5.1 unit tests → Tasks 2-12
- Spec §Testing §5.2 integration → Task 16
- Spec §Testing §5.3 manual QA → Task 17
- Spec §Rollout → Task 18
- Spec §COLLECTING prompt tweak → Task 13

Type consistency: `FlushFunc`, `Clock`, `Timer`, `TypingNotifier`, `DebounceConfig`, `DebounceHandler`, `phoneBuffer`, `bufferState` constants — all consistent across tasks.
