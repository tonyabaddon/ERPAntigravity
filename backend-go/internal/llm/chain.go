package llm

import "github.com/username/sinar-elektrik-backend/internal/assets"

// DefaultCalistaAgent returns Calista's Phase 1A runtime config. All 10 models
// are OpenRouter free-tier as of June 2026 (spec §1, §6.3 mockup). When one
// rate-limits, the router falls through to the next; if all are exhausted
// in a single conversation, the engine escalates to admin.
//
// SystemPrompt uses the embedded `assets.CalistaSystemPrompt` (~1,100 lines —
// full Garindo Jaya Panel persona + SOP + phase-by-phase rules) so the
// OpenRouter path has BEHAVIORAL PARITY with the legacy direct-Gemini path,
// which loads the same string into `gemini.NewClient(...)`'s SystemInstruction.
// Spec §12 success criterion: "tenant #1 cannot distinguish from Gemini
// baseline" — only achievable when both paths see the same persona. The
// abbreviated inline `calistaSystemPrompt` below is kept ONLY as fallback
// for tests that want a tiny deterministic string.
//
// The model order is locked from the spec's "Pricing v2" decision (no paid
// fallback in Phase 1A). Re-order or substitute by editing this slice; the
// router reads it once per Call so changes apply on next request.
func DefaultCalistaAgent() AgentConfig {
	prompt := assets.CalistaSystemPrompt
	if prompt == "" {
		// Embedded asset failed to load — fall back to the abbreviated prompt
		// so the system still functions. This should never happen in practice
		// (the embed directive resolves at compile time), but a defensive
		// guard avoids a silent empty-prompt regression if assets.go is broken.
		prompt = calistaSystemPrompt
	}
	return AgentConfig{
		Name:         "Calista",
		SystemPrompt: prompt,
		Chain: []ModelSpec{
			// Slugs verified against the live OpenRouter /api/v1/models catalog
			// on 2026-06-14. All carry the `:free` suffix (required to route to
			// the free-tier endpoint instead of the paid variant). Some require
			// extra slug segments (e.g. `-it`, size suffix, llama-3.1 lineage)
			// that didn't appear in the user-facing model browser.
			//
			// Reasoning-style models (nex-agi/*, nvidia/nemotron-*) are demoted
			// to last-resort positions: they split output between message.content
			// and message.reasoning, causing degraded reply text relative to plain
			// instruct models. openrouter.go falls back to .reasoning when
			// .content is empty, so customers still get *a* reply when we land
			// on one — just not a clean instruct-style one.
			{Slug: "google/gemma-4-31b-it:free", CooldownMinutes: 60},
			{Slug: "qwen/qwen3-next-80b-a3b-instruct:free", CooldownMinutes: 60},
			{Slug: "google/gemma-4-26b-a4b-it:free", CooldownMinutes: 60},
			{Slug: "openai/gpt-oss-120b:free", CooldownMinutes: 60},
			{Slug: "meta-llama/llama-3.3-70b-instruct:free", CooldownMinutes: 60},
			{Slug: "nousresearch/hermes-3-llama-3.1-405b:free", CooldownMinutes: 60},
			{Slug: "openai/gpt-oss-20b:free", CooldownMinutes: 60},
			{Slug: "nvidia/nemotron-3-super-120b-a12b:free", CooldownMinutes: 60},
			{Slug: "nex-agi/nex-n2-pro:free", CooldownMinutes: 60},
			{Slug: "nvidia/nemotron-3-nano-30b-a3b:free", CooldownMinutes: 60},
		},
	}
}

// DefaultCalistaAgentGemini returns Calista's config wired for the Gemini
// direct backend (Google AI Studio free tier via the OpenAI-compatible
// endpoint). Same SystemPrompt as the OpenRouter variant — only the chain
// slugs differ.
//
// Single model: gemini-2.5-flash-lite. Rationale verified empirically on
// 2026-06-14:
//   - gemini-2.5-flash and gemini-flash-latest run in "thinking mode" by
//     default, which consumes max_tokens silently and leaves message.content
//     truncated or empty (same failure mode as OpenRouter reasoning models).
//   - gemini-2.0-flash returned `limit: 0` for this key's free tier.
//   - gemini-1.5-flash is deprecated (HTTP 404 on this API version).
//   - gemini-2.5-flash-lite emits clean JSON in one round with no thinking
//     overhead — matches the legacy direct-SDK model choice for parity.
func DefaultCalistaAgentGemini() AgentConfig {
	prompt := assets.CalistaSystemPrompt
	if prompt == "" {
		prompt = calistaSystemPrompt
	}
	return AgentConfig{
		Name:         "Calista",
		SystemPrompt: prompt,
		Chain: []ModelSpec{
			{Slug: "gemini-2.5-flash-lite", CooldownMinutes: 60},
		},
	}
}

// calistaSystemPrompt is the persona reinforcement prompt (spec §5.6 #5).
// Strict tone/length/language directives reduce inter-model voice variance.
// Two few-shot examples seed the expected reply shape.
const calistaSystemPrompt = `You are Calista, asisten WhatsApp untuk toko ini (toko alat listrik di Indonesia).

TONE: ramah tapi sopan. Selalu sapa pelanggan dengan Pak/Bu/Bapak/Ibu.
LANGUAGE: Bahasa Indonesia casual. JANGAN PERNAH balas dalam Bahasa Inggris.
LENGTH: 1-3 kalimat pendek per balasan. JANGAN tulis dinding teks.
EMOJI: maksimal 1 per balasan, hanya 👋 🙏 ✅ yang boleh dipakai.

CONTOH BALASAN YANG BAIK:
- Customer: "Bos ada kabel 2.5mm?"
  Calista: "Halo Pak! Kabel 2.5mm tersedia. Mau berapa meter ya Pak?"
- Customer: "Saya mau order, alamat kirim ke Surabaya"
  Calista: "Baik Pak. Surabaya untuk pengiriman ya. Sebelumnya boleh saya catat nama dan nomor HP Pak dulu? 🙏"

JIKA pelanggan tanya apakah kamu AI atau bot, jawab jujur:
"Saya Calista, asisten AI dari toko ini yang membantu Pak/Bu sekarang. Kalau perlu bicara dengan staff manusia, ketik *staff* ya."

Jangan pernah mengaku bukan AI atau berpura-pura jadi manusia.
`
