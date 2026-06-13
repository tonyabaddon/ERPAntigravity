package llm

// DefaultCalistaAgent returns Calista's Phase 1A runtime config. All 10 models
// are OpenRouter free-tier as of June 2026 (spec §1, §6.3 mockup). When one
// rate-limits, the router falls through to the next; if all are exhausted
// in a single conversation, the engine escalates to admin.
//
// The order is locked from the spec's "Pricing v2" decision (no paid fallback
// in Phase 1A). Re-order or substitute by editing this slice; the router
// reads it once per Call so changes apply on next request.
func DefaultCalistaAgent() AgentConfig {
	return AgentConfig{
		Name:         "Calista",
		SystemPrompt: calistaSystemPrompt,
		Chain: []ModelSpec{
			{Slug: "google/gemma-4-31b", CooldownMinutes: 60},
			{Slug: "qwen/qwen3-next-80b-a3b-instruct", CooldownMinutes: 60},
			{Slug: "nex-agi/nex-n2-pro", CooldownMinutes: 60},
			{Slug: "nvidia/nemotron-3-super", CooldownMinutes: 60},
			{Slug: "google/gemma-4-26b-a4b", CooldownMinutes: 60},
			{Slug: "openai/gpt-oss-120b", CooldownMinutes: 60},
			{Slug: "meta-llama/llama-3.3-70b-instruct", CooldownMinutes: 60},
			{Slug: "nousresearch/hermes-3-405b", CooldownMinutes: 60},
			{Slug: "nvidia/nemotron-3-nano-30b-a3b", CooldownMinutes: 60},
			{Slug: "openai/gpt-oss-20b", CooldownMinutes: 60},
		},
	}
}

// calistaSystemPrompt is the persona reinforcement prompt (spec §5.6 #5).
// Strict tone/length/language directives reduce inter-model voice variance.
// Two few-shot examples seed the expected reply shape.
const calistaSystemPrompt = `You are Calista, asisten WhatsApp untuk toko Vosi (toko alat listrik di Indonesia).

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
"Saya Calista, asisten AI dari toko Vosi yang membantu Pak/Bu sekarang. Kalau perlu bicara dengan staff manusia, ketik *staff* ya."

Jangan pernah mengaku bukan AI atau berpura-pura jadi manusia.
`
