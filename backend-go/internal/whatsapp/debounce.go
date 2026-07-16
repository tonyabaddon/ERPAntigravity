package whatsapp

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

type bufferState int

const (
	stateIdle bufferState = iota
	stateBuffering
	stateProcessing
)

const maxBufferTexts = 20

// FlushFunc dipanggil oleh debounce saat window expire.
type FlushFunc func(ctx context.Context, phone string, joined string, originalTexts []string) error

// TypingNotifier sends WhatsApp typing presence updates.
// Implemented by WATypingNotifier in production; stubbed in tests.
type TypingNotifier interface {
	SendTyping(phone string, composing bool)
}

// noopTypingNotifier is used when no notifier is configured.
type noopTypingNotifier struct{}

func (noopTypingNotifier) SendTyping(string, bool) {}

type phoneBuffer struct {
	mu         sync.Mutex
	state      bufferState
	texts      []string
	firstMsgAt time.Time
	softTimer  Timer
	hardTimer  Timer
	typingStop chan struct{}
	nextBuffer []string
}

type DebounceConfig struct {
	Clock    Clock
	FlushFn  FlushFunc
	SoftWait time.Duration
	HardWait time.Duration
	Typing   TypingNotifier // optional, defaults to noop
}

type DebounceHandler struct {
	mu       sync.RWMutex
	buffers  map[string]*phoneBuffer
	clock    Clock
	flushFn  FlushFunc
	softWait time.Duration
	hardWait time.Duration
	typing   TypingNotifier
}

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

// Push adds a text to the buffer for the given phone.
// Called from handler.go for text messages that should be debounced.
func (h *DebounceHandler) Push(ctx context.Context, phone, text string) {
	pb := h.getOrCreateBuffer(phone)
	pb.mu.Lock()

	switch pb.state {
	case stateIdle:
		pb.state = stateBuffering
		pb.firstMsgAt = h.clock.Now()
		pb.texts = []string{text}
		h.startTimers(pb, phone)
		h.startTyping(pb, phone)
		slog.Info("[DEBOUNCE] action=push state=IDLE→BUFFERING", slog.String("phone", phone))
	case stateBuffering:
		if len(pb.texts) >= maxBufferTexts {
			slog.Warn("[DEBOUNCE] action=spam dropped=true state=BUFFERING", slog.String("phone", phone), slog.Int("texts_count", len(pb.texts)))
			pb.mu.Unlock()
			return
		}
		pb.texts = append(pb.texts, text)
		h.resetSoftTimer(pb, phone)
		slog.Info("[DEBOUNCE] action=push state=BUFFERING", slog.String("phone", phone), slog.Int("texts_count", len(pb.texts)))
	case stateProcessing:
		if len(pb.nextBuffer) >= maxBufferTexts {
			slog.Warn("[DEBOUNCE] action=spam dropped=true state=PROCESSING", slog.String("phone", phone), slog.Int("next_count", len(pb.nextBuffer)))
			pb.mu.Unlock()
			return
		}
		pb.nextBuffer = append(pb.nextBuffer, text)
	}
	pb.mu.Unlock()
}

// Flush forces immediate processing of the buffered messages for phone.
// Called from handler.go before bypass paths (escalation, media) to
// preserve customer message order.
// Idempotent: no-op if buffer is IDLE/PROCESSING or doesn't exist.
func (h *DebounceHandler) Flush(phone string) {
	pb := h.getBufferUnsafe(phone)
	if pb == nil {
		return
	}
	h.flushBuffer(pb, phone, "force_flush")
}

// Shutdown synchronously flushes all BUFFERING phones.
// Buffers in PROCESSING state are left to finish on their own.
// Respects ctx cancellation — returns early if ctx expires.
// Called from main.go on graceful shutdown (SIGTERM).
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
		// Look up pb again — could have been deleted by a concurrent flush
		pb := h.getBufferUnsafe(phone)
		if pb == nil {
			continue
		}
		h.flushBuffer(pb, phone, "shutdown")
	}
}

// startTimers must be called with pb.mu held.
func (h *DebounceHandler) startTimers(pb *phoneBuffer, phone string) {
	pb.softTimer = h.clock.AfterFunc(h.softWait, func() { h.flushBuffer(pb, phone, "soft_timer") })
	pb.hardTimer = h.clock.AfterFunc(h.hardWait, func() { h.flushBuffer(pb, phone, "hard_cap") })
}

// resetSoftTimer must be called with pb.mu held.
func (h *DebounceHandler) resetSoftTimer(pb *phoneBuffer, phone string) {
	if pb.softTimer != nil {
		pb.softTimer.Stop()
	}
	pb.softTimer = h.clock.AfterFunc(h.softWait, func() { h.flushBuffer(pb, phone, "soft_timer") })
}

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

// flushBuffer drains the buffer pointed to by pb. Takes pb directly (not via
// map lookup by phone) so timer callbacks always operate on the buffer they
// were installed for — prevents an orphan-buffer race where a delete+recreate
// of the map entry would cause timer callbacks to silently target the wrong
// buffer.
func (h *DebounceHandler) flushBuffer(pb *phoneBuffer, phone, reason string) {
	pb.mu.Lock()
	if pb.state != stateBuffering {
		pb.mu.Unlock()
		return // idempotent: already flushed by other timer or force-flush
	}
	texts := pb.texts
	waitMs := h.clock.Now().Sub(pb.firstMsgAt).Milliseconds()
	pb.texts = nil
	if pb.softTimer != nil {
		pb.softTimer.Stop()
	}
	if pb.hardTimer != nil {
		pb.hardTimer.Stop()
	}
	pb.state = stateProcessing
	pb.mu.Unlock()

	slog.Info("[DEBOUNCE] action=flush", slog.String("phone", phone), slog.String("reason", reason), slog.Int("texts_count", len(texts)), slog.Int64("wait_ms", waitMs))

	// IMPORTANT: defer order matters. defer postFlush is registered FIRST,
	// so it runs LAST (after recover). The defer recover() is registered
	// SECOND, so it runs FIRST, catching any panic before postFlush.
	defer h.postFlush(pb, phone)
	defer func() {
		if r := recover(); r != nil {
			slog.Error("[DEBOUNCE] action=panic", slog.String("phone", phone), slog.Any("error", r))
		}
	}()

	joined := joinTexts(texts)
	if err := h.flushFn(context.Background(), phone, joined, texts); err != nil {
		slog.Error("[DEBOUNCE] action=flush_err", slog.String("phone", phone), slog.Any("error", err))
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
		h.stopTyping(pb) // signal typing goroutine to stop before map lock
		h.mu.Lock()
		// Identity check: only delete if the map still points to OUR buffer.
		// A concurrent Push that raced with us and created a fresh buffer
		// must not be evicted. Without this check, the new buffer would be
		// silently leaked from the map.
		if h.buffers[phone] == pb {
			delete(h.buffers, phone)
		}
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

// getBufferUnsafe returns the buffer for phone without acquiring pb.mu.
// For tests only — callers must lock pb.mu before reading/mutating fields.
// Returns nil if no buffer exists for phone.
func (h *DebounceHandler) getBufferUnsafe(phone string) *phoneBuffer {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.buffers[phone]
}
