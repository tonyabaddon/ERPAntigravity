package engine

import "errors"

// ErrChainExhausted is the sentinel returned when all models in the LLM
// fallback chain are simultaneously unavailable. The engine catches this
// (via errors.Is) and transitions the conversation to StateEscalatedAdmin
// (human takeover).
//
// Hoisted to the engine package so engine does not need to import internal/llm
// (which would create an import cycle once llm.EngineAdapter imports engine).
// The llm package re-exports this as llm.ErrChainExhausted for ergonomic use
// at the call sites that produce it.
var ErrChainExhausted = errors.New("engine: LLM chain exhausted")
