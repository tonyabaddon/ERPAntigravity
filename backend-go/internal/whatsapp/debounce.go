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
