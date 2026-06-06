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

const maxBufferTexts = 20

// FlushFunc dipanggil oleh debounce saat window expire.
type FlushFunc func(ctx context.Context, phone string, joined string, originalTexts []string) error

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

	switch pb.state {
	case stateIdle:
		pb.state = stateBuffering
		pb.firstMsgAt = h.clock.Now()
		pb.texts = []string{text}
		h.startTimers(pb, phone)
	case stateBuffering:
		if len(pb.texts) >= maxBufferTexts {
			// Spam cap — drop. (Logging in later task.)
			pb.mu.Unlock()
			return
		}
		pb.texts = append(pb.texts, text)
		h.resetSoftTimer(pb, phone)
	case stateProcessing:
		if len(pb.nextBuffer) >= maxBufferTexts {
			pb.mu.Unlock()
			return
		}
		pb.nextBuffer = append(pb.nextBuffer, text)
	}
	pb.mu.Unlock()
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
