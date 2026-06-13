# Calista Phase 1 — Design Spec

**Date:** 2026-06-13
**Companion:** `2026-06-13-whatsapp-agent-comparison-assessment.md`
**Phase:** 1 (additive — channel migration is Phase 2, separate spec)
**Estimate:** 3.5-4.5 weeks across sub-phases 1A → 1C
**Status:** Awaiting user review before transition to `writing-plans` skill.

---

## 1. Goals

1. Replace direct Gemini SDK with **OpenRouter** behind a 10-model **free-tier** fallback chain so Calista feels "unlimited" with **Rp 0 recurring AI cost**.
2. **Preserve conversation continuity** during model swaps via sticky per-conversation pinning, state-boundary unpin opportunities, hard 2-swap cap, and first-reply tone seeding — customer experiences one consistent "Calista" even when the underlying model changes.
3. **Escalate to admin (existing flow) as the safety net** when all 10 free models exhaust — no paid fallback, no recurring cost ceiling.
4. Add **per-conversation Agent/Human mode** so operators can safely take over when Calista fumbles.
5. Add **Calista knowledge upload** so admins can equip the agent with FAQ, brand tone, pricing rules without code changes.
6. Add **multimodal handling** so customer-sent images and voice notes get understood replies, not silent drops.
7. Add a **conversation dashboard** so operators see all in-flight chats, mode, latest message.
8. Lay the abstractions Phase 2 (Cloud API migration) will need — channel-agnostic message handling, conversation-state column, model-agnostic AI layer.

## 2. Out of Scope (Phase 1)

- Meta Cloud API channel migration — Phase 2 spec, separate
- pgvector RAG (knowledge upload uses simple text-stuffing first)
- Nemotron 3.5 Content Safety guardrail (deferred unless tripwire surfaces incidents)
- Multi-tenant phone-number-ID routing — Phase 2
- Per-tenant model chain configuration — Phase 2 or later

## 3. Architecture Overview

```
┌─────────────── Inbound (whatsmeow) ──────────────┐
│  customer WA msg → handler.go → debouncer        │
│                                ↓                  │
│                    routeMessage(senderJID, text)  │
│                                ↓                  │
│              ┌─── new: agent_mode lookup ───┐    │
│              │  conversations.mode = ?       │    │
│              └─────────────┬─────────────────┘    │
│                ┌─────'agent'─────┐  ┌─'human'─┐  │
│                ↓                  ↓           ↓   │
│         engine.Machine    skip AI, notify dashboard
│                ↓                                  │
│        new: llm.Router                            │
│        ┌────────────────────────────────┐        │
│        │  build prompt with knowledge   │        │
│        │  → try primary model           │        │
│        │  → on 429: cooldown, fall thru │        │
│        │  → success: return + telemetry │        │
│        └────────────────────────────────┘        │
│                ↓                                  │
│           tripwire heuristics check               │
│                ↓                                  │
│           sender.go (whatsmeow)                   │
└──────────────────────────────────────────────────┘

┌─────────────── Frontend ─────────────────────────┐
│  /whatsapp-ai (existing screen, enhanced):        │
│  - Conversations tab (new)                        │
│    └─ List + thread view + Agent/Human toggle    │
│  - Calista Settings tab (new)                     │
│    └─ System prompt, model chain, knowledge       │
│  - Numbers tab (existing)                         │
└──────────────────────────────────────────────────┘
```

## 4. Data Model Changes

### 4.1 Supabase migrations

**Important: `conversations` and `messages` tables already exist** (created in `supabase/migrations/20260531000000_core_ai_engine.sql`). Phase 1 **ALTERS** the existing tables rather than creating duplicates. Existing Go structs in `backend-go/internal/models/types.go` (`Conversation`, `Message`) need updated field mapping accordingly.

```
supabase/migrations/20260613000030_calista_phase1_conversations_alter.sql  # ALTER existing
supabase/migrations/20260613000031_calista_phase1_messages_alter.sql       # ALTER existing
supabase/migrations/20260613000032_calista_phase1_ai_agents.sql            # NEW table
supabase/migrations/20260613000033_calista_phase1_knowledge.sql            # NEW table
supabase/migrations/20260613000034_calista_phase1_llm_calls.sql            # NEW table
supabase/migrations/20260613000035_calista_phase1_cooldowns.sql            # NEW table — registry persistence
supabase/migrations/20260613000036_calista_phase1_media_bucket.sql         # Storage bucket + RLS
supabase/migrations/20260613000037_calista_phase1_realtime.sql             # ALTER PUBLICATION (idempotent)
```

### 4.2 Tables

#### 4.2.1 ALTER existing `conversations` table

Existing schema (from `20260531000000_core_ai_engine.sql`) has: `id`, `wa_number_id`, `customer_phone`, `state` (engine.Machine state), `language`, `collected_data` jsonb, `clarification_round`, `ai_active` boolean (= "AI handles vs human handles"), `created_at`, `updated_at`, `last_ai_message_at`, `followup_count_today`, `last_followup_date`.

**Migration `20260613000030`:**

```sql
-- Add Phase 1 columns
ALTER TABLE public.conversations
  ADD COLUMN mode_changed_at timestamptz,
  ADD COLUMN mode_changed_by uuid REFERENCES public.admin_users(id),
  ADD COLUMN last_message_at timestamptz,
  ADD COLUMN last_message_preview text,
  ADD COLUMN unread_count int DEFAULT 0,
  ADD COLUMN pinned_model_slug text,
  ADD COLUMN pinned_at timestamptz,
  ADD COLUMN swap_count int DEFAULT 0,
  ADD COLUMN first_reply_tone jsonb;

-- `mode` is a derived view of existing `ai_active` for compatibility.
-- Phase 1A uses `ai_active` directly (no behavior change). Phase 1B introduces
-- explicit `mode = 'agent' | 'human'` via a generated column for cleaner reads:
ALTER TABLE public.conversations
  ADD COLUMN mode text GENERATED ALWAYS AS
    (CASE WHEN ai_active THEN 'agent' ELSE 'human' END) STORED;

-- Writes use ai_active. Reads can use mode. Phase 1D considers full rename.

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
  ON public.conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_pinned_model
  ON public.conversations(pinned_model_slug)
  WHERE pinned_model_slug IS NOT NULL;

-- last_message_at backfill from existing data: use latest message createdAt or conversation updated_at
UPDATE public.conversations c
SET last_message_at = COALESCE(
  (SELECT MAX(m.created_at) FROM public.messages m WHERE m.conversation_id = c.id),
  c.updated_at
);
```

**Note on `ai_active` vs `mode`:** Keep `ai_active` as the source-of-truth boolean for backward compat with existing `engine.Machine`, `followup_poller`, and `heartbeat_poller` code. The new `mode` generated column is a convenience for dashboards. Toggling from UI writes `ai_active`; UI reads `mode`. No code rewrite needed in existing pollers.

RLS: existing policy stays; admin with `can_manage_calista` perm writes (**this permission is new** — added to `PermissionSet` in `src/types.ts` alongside `can_manage_warehouses` / `canConfigureSalesChannels`. Backfill `ALL_PERMISSIONS = true`).

#### 4.2.2 ALTER existing `messages` table

Existing schema has: `id`, `conversation_id`, `sender` (`'customer' | 'ai' | 'operator'`), `text`, `media_url`, `media_type`, `created_at`.

**Migration `20260613000031`:**

```sql
ALTER TABLE public.messages
  ADD COLUMN direction text GENERATED ALWAYS AS
    (CASE WHEN sender = 'customer' THEN 'inbound' ELSE 'outbound' END) STORED,
  ADD COLUMN model_used text,
  ADD COLUMN latency_ms int,
  ADD COLUMN tripwire_flags text[];

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_model_used
  ON public.messages(model_used) WHERE model_used IS NOT NULL;
```

**Mapping:** existing `sender` stays the write-target (`'customer' | 'ai' | 'operator'`). The new `direction` generated column gives clean read access. `body` is the existing `text` column — no rename. `sent_by` is the existing `sender`.

**`ai_agents`** (new — Calista config, future-proof for multi-tenant + cost control):

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | `'Calista'` (more agents possible later) |
| `system_prompt` | text | editable from settings UI |
| `model_chain` | jsonb | ordered array of `{slug, cooldown_minutes, daily_budget?}` |
| `is_active` | boolean | |
| `openrouter_api_key` | text NULL (encrypted via pgcrypto) | per-tenant key. NULL in Phase 1 (uses `OPENROUTER_API_KEY` env var fallback). Required in Phase 2 multi-tenant. Encrypted at rest, decrypted only in backend Go process at call-time. NEVER returned to frontend in plain text. |
| `layer2_enabled` | boolean DEFAULT false | when true, router uses Layer 2 (paid Gemini Flash via OpenRouter) as fallback after Layer 1 free chain exhausts. **NEVER auto-set true — only via founder dashboard approval (§5.7).** |
| `layer2_monthly_cap_idr` | int NULL | monthly spending cap in Indonesian rupiah. NULL = unlimited (NOT recommended). Default suggested: Rp 200,000/month |
| `layer2_current_month_spend_idr` | int DEFAULT 0 | accumulator updated per Layer 2 call. Reset to 0 by monthly cron on day 1 of each month |
| `layer2_cap_action` | text DEFAULT `'auto_disable'` | what happens when cap hit: `'auto_disable'` (Layer 2 off until next month, escalate-to-admin used instead) or `'notify_only'` (keep using Layer 2, just alert founder) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `updated_by` | uuid FK → `admin_users` | |

Single row for Phase 1 (`name='Calista'`, `openrouter_api_key=NULL`, `layer2_enabled=false`). Phase 2 multi-tenant adds `tenant_id` and requires `openrouter_api_key` per row.

**`ai_knowledge_sources`** (new):

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `agent_id` | uuid FK → `ai_agents` | |
| `kind` | text | `'file'`, `'text'`, `'url'`, `'auto_catalog'` |
| `label` | text | display name |
| `content` | text | extracted plain text (for `kind='file'/'text'/'url'`) |
| `source_ref` | text | filename or URL |
| `token_count` | int | for budget tracking |
| `is_enabled` | boolean | toggle inclusion without delete |
| `created_at` | timestamptz | |
| `created_by` | uuid FK → `admin_users` | |

For `kind='auto_catalog'`: special row, `content` populated by a server-side job that summarises the live `stocks` table into a compact catalog string (re-run on schedule).

**`llm_calls`** (new — telemetry):

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `conversation_id` | uuid FK | |
| `model_slug` | text | which model actually answered |
| `tier` | text | `'layer1_free'`, `'layer2_paid_gemini_flash'`, `'layer3_direct_gemini'`, `'escalate_admin'` |
| `was_forced_swap` | boolean | true if this call swapped from the previously pinned model due to 429 |
| `state_boundary` | boolean | true if the call happened at a state-machine boundary (eligible for unpin-back-to-primary) |
| `prompt_tokens` | int | |
| `completion_tokens` | int | |
| `latency_ms` | int | |
| `cost_idr_estimated` | numeric DEFAULT 0 | per-call cost in Indonesian rupiah. Always 0 for Layer 1 (free). Calculated from model pricing × token counts for Layer 2-3. Used by `cost_monitor` job for cap enforcement. |
| `status` | text | `'success'`, `'rate_limited'`, `'error'`, `'tripwire_alert'`, `'escalated_chain_exhausted'` |
| `error_message` | text | |
| `created_at` | timestamptz | |

Partitioned by month if/when volume warrants. Indexed on `(model_slug, created_at)` for dashboards.

**`model_cooldowns`** (new — cooldown registry persistence):

| Column | Type | Notes |
|--------|------|-------|
| `model_slug` | text PK | e.g. `'google/gemma-4-31b'` |
| `cooldown_until` | timestamptz | NULL or past → available; future → cooled down |
| `last_error` | text | reason for last cooldown (`'rate_limit'`, `'timeout'`, `'5xx'`) |
| `consecutive_failures` | int | for exponential cooldown extension if a model keeps failing |
| `updated_at` | timestamptz | |

The router's in-memory cooldown state is the hot path (every call checks it). The table persists state across daemon restart — without it, every `backend-go` restart would freshly hammer rate-limited models, causing a 429 storm. On boot, the router loads the registry; on each cooldown change, it writes back asynchronously.

### 4.3 Supabase Storage bucket

`whatsapp-media` bucket (new):

- Path pattern: `whatsapp-media/{wa_number_id}/{YYYY-MM}/{message_id}.{ext}`
- RLS: any authenticated admin reads; only the backend service role writes
- Public URL: NO (signed URLs only — customer media is private)
- Retention: indefinite (see §13 — kept for ML training corpus)
- Used by Phase 1B multimodal flow: customer-sent images/audio/video persisted here, `messages.media_url` stores the signed-URL path

### 4.4 Realtime publication

`conversations`, `messages`, `ai_agents`, `ai_knowledge_sources` all added to `supabase_realtime` publication (idempotent `ALTER PUBLICATION` guards). Drives the dashboard live updates and Calista settings broadcast. `model_cooldowns` and `llm_calls` NOT in realtime (no client subscribers).

## 5. Backend Changes (`backend-go/`)

### 5.1 New package: `internal/llm/`

```
internal/llm/
  router.go            # ModelChain, Router, Call() with sticky pinning + fallback
  router_test.go
  openrouter.go        # HTTP client for openrouter.ai
  openrouter_test.go
  models.go            # ModelSpec, ModelState, error classification, ChainExhaustedError
  cooldown.go          # global cooldown registry (per-model)
  cooldown_test.go
  pinning.go           # per-conversation sticky pin + swap-count + state-boundary unpin
  pinning_test.go
  tone.go              # first-reply tone seeding (extract + inject)
  tone_test.go
  tripwire.go          # output heuristics (length, URLs, profanity, jailbreak phrases, language drift)
  tripwire_test.go
  telemetry.go         # llm_calls insert
```

**Router interface (illustrative):**

```go
type Router interface {
    // Call picks a model based on (a) conversation pin, (b) per-model cooldown, (c) chain order.
    // Returns ChainExhaustedError when all 10 free models are unavailable and the conversation
    // should be escalated to admin (StateEscalatedAdmin) via the existing escalation flow.
    Call(ctx context.Context, agent AgentConfig, msgs []Message, opts CallOpts) (*Response, error)

    // Pin (used internally) sticks a conversation to a specific model.
    Pin(ctx context.Context, conversationID, modelSlug string) error

    // Unpin clears the conversation pin. Called when conversation terminates
    // (BOOKED/COMPLETED/CANCELLED/ESCALATED_*) by the engine.
    Unpin(ctx context.Context, conversationID string) error
}

type CallOpts struct {
    ConversationID  string  // required — for sticky pinning
    StateBoundary   bool    // hint: at a state-machine transition (eligible for unpin-back-to-primary)
    AllowMultimodal bool    // gate the media-handling branch
}

type Response struct {
    Body           string
    ModelUsed      string
    WasForcedSwap  bool       // true if router swapped from pinned model due to 429
    LatencyMs      int
    Tokens         TokenUsage
    TripwireFlags  []string
}

// ChainExhaustedError signals all 10 free models are simultaneously unavailable.
// Engine catches this and transitions conversation to StateEscalatedAdmin —
// existing escalation flow notifies admin via WA, customer gets holding message.
type ChainExhaustedError struct{ TriedModels []string }
```

**Routing decision (per Call):**

```
1. If conversation has pinned_model AND it's not in cooldown AND swap_count < 2:
     → use pinned model.
2. If conversation has pinned_model AND it IS in cooldown AND StateBoundary=true AND
   primary model is healthy:
     → unpin and try primary (rare voice-recovery moment).
3. If conversation has pinned_model AND it IS in cooldown AND not at state boundary:
     → forced swap. Increment swap_count. Pick next-in-chain model that's not in cooldown.
       If swap_count would exceed 2 → return ChainExhaustedError (escalate).
4. If conversation has NO pinned_model (new conversation):
     → pre-flight check primary cooldown. If healthy, pin to primary. Else pin to first
       healthy fallback.
5. After successful call, if no first_reply_tone yet, extract and persist (§5.6).
```

**Cooldown rules (initial — all 10 models are free tier):**

- 429 / quota error → cooldown 60 min (free models reset daily, so generous)
- 500-class error → cooldown 5 min (transient)
- Timeout → cooldown 2 min
- Cooldown decays linearly; background warm-up pings every 10 min clear early
- **Cooldown state is persisted to `model_cooldowns` table** (in-memory cache is the hot path, async write-back on each change). Router loads registry on boot. Without persistence, daemon restart wipes cooldown knowledge → first 100 conversations after restart hammer rate-limited models → 429 storm.
- Consecutive failures on the same model extend cooldown exponentially (60min → 90min → 120min capped at 4h). Reset to 60min after one success.

**LLM call timeout:**

- Per-call soft timeout: **8 seconds**. On timeout, treat as transient (cooldown 2min), fall through to next model.
- Total `Router.Call` budget: **15 seconds** across all fallback attempts. Beyond that, return `ChainExhaustedError` even if more models could have been tried — protects WhatsApp UX from indefinite delays.
- Customer-perceived latency target: p95 < 3s. Tail bounded at 15s worst-case.

**Tripwire heuristics (Phase 1A):**

| Heuristic | Direction | Threshold | Action |
|-----------|-----------|-----------|--------|
| Reply length | outbound | >800 chars | log + alert |
| Non-whitelist URL | outbound | any | log + alert |
| Profanity (ID + EN wordlist) | outbound | any | log + alert |
| Language drift | outbound | >30% English tokens in reply | log + alert |
| Jailbreak phrase | inbound | `/ignore (previous\|above\|system)/i`, `/you are now/i`, `/disregard/i` | log + alert |
| Customer opt-out | inbound | `/^(stop\|berhenti\|unsubscribe\|cancel)$/i` (whole-message match, case-insensitive, trimmed) | **set `ai_active=false` (mode→human), persist message, send acknowledgement "Baik Pak/Bu, percakapan dialihkan ke staff. Terima kasih.", notify admin via WA** |
| AI self-ID question | inbound | `/apakah anda (ai\|bot)/i`, `/are you (ai\|bot)/i`, `/calista (manusia\|ai)/i` | inject self-ID directive into next prompt so model answers honestly (no separate hardcoded response — keeps voice consistent) |

**Self-ID directive** (injected when the question is detected):
> "The customer just asked whether you are an AI. Answer truthfully and briefly in the conversation's established language: 'Saya Calista, asisten AI dari toko Vosi yang membantu Pak/Bu sekarang. Kalau perlu bicara dengan staff manusia langsung, ketik *staff* ya.' Do not deny being AI."

`tripwire_flags` populated on outbound message, `llm_calls.status = 'tripwire_alert'` if any fire. Alert delivery: WA notification to a configurable `CALISTA_ALERT_PHONE` env var (zero new infra). Reply is NOT blocked — empirical first. Opt-out is the ONLY heuristic that has a state-changing side effect (forces human mode); all others are observe-only.

### 5.2 Modify `internal/engine/`

Today's engine calls Gemini directly. Refactor:

- Engine becomes model-agnostic — calls `llm.Router.Call(ctx, agent, msgs, opts)` instead of Gemini SDK
- System prompt assembled from `ai_agents.system_prompt` + enabled `ai_knowledge_sources.content` + first_reply_tone hint + per-state directives, concat with `\n\n---\n\n` separators
- **Full-payload token budget check (NEW — wider than just knowledge):** total prompt = system + knowledge + first_reply_tone + collected_data + last-N messages. If total > 80% of model's max context (e.g. 25K for a 32K-context model), drop oldest messages from history first. If still > 90%, drop low-priority knowledge sources (keep `auto_catalog` first). If still over, error + log to `llm_calls.status='context_overflow'`.
- **Tolerant JSON parsing (NEW — Gap fix #7):** existing parsers (`ParseGreeting`, `ParseCollecting`, etc.) currently assume strict JSON. Different models on OpenRouter return JSON with quirks (extra prose before/after, markdown code fences, trailing commas). Wrap each parser in `tolerantParseJSON(raw)` that: (a) strips ` ```json … ``` ` markdown fences, (b) extracts the first balanced `{...}` block via regex, (c) accepts trailing-comma tolerance via `json.RawMessage` + custom unmarshal, (d) on hard failure, retries the LLM call once with a strict "REPLY WITH JSON ONLY, NO PROSE" prepended directive. Same fallback reply (`FallbackReply()`) returns on second failure.
- Direct Gemini SDK removed from engine dependencies

### 5.2.1 Engine integration map (Gap fix #4)

How the existing `engine` package wires to the new `llm.Router`:

| Existing | Phase 1 change |
|----------|----------------|
| `engine.GeminiClient` interface | Renamed `engine.LLMClient`; implementation is `llm.Router` |
| `engine.Machine.gemini` field | Renamed `engine.Machine.llm` |
| `engine.Machine.Process()` signature | Unchanged — same `ProcessResult` returned |
| `BuildPrompt(state, language, collected, history, stockContext)` | **Unchanged signature**, body now also pulls first_reply_tone + knowledge + per-state max_tokens directive from agent config |
| `ParseGreeting` / `ParseCollecting` / etc. | **Unchanged interface**, internally wrapped in `tolerantParseJSON` |
| `FallbackReply(language)` | **Unchanged**. Used on parse failure (retry exhausted) AND on `ChainExhaustedError` (router-level) |
| `ProcessResult.GeminiError` field | Renamed `LLMError`. Populated with the original `error` returned by `llm.Router.Call` — including `ChainExhaustedError` |
| **NEW**: `ProcessResult.ChainExhausted bool` | True when `LLMError` is `ChainExhaustedError`. Handler reads this → triggers `StateEscalatedAdmin` transition + admin notification via existing `approval_sender.go` path |
| `Conversation.AIActive` (Go struct) | Still read-write target. The `mode` generated column in DB is for dashboards only. Engine code unchanged. |

`internal/gemini/` package: stays in repo as a possible direct fallback if `ENABLE_OPENROUTER` is flipped off in emergency. Not in chain by default.

`engine.NewMachine(g GeminiClient)` constructor signature updated to `engine.NewMachine(l LLMClient)` — call sites in `main.go` updated accordingly.

### 5.3 Modify `internal/whatsapp/handler.go`

- After debouncer flush, lookup `conversations.mode` for the sender
- If `mode='human'`: persist inbound message, increment `unread_count`, emit dashboard notification, DO NOT call engine
- If `mode='agent'`: existing flow, but pipe through `llm.Router` (via engine)
- Inbound media: route to multimodal chain (router gated by `AllowMultimodal=true`); fallback to current human-bypass if multimodal returns error
- All outbound messages persisted to `messages` table with `model_used` populated

### 5.4 New endpoint(s)

- `POST /api/conversations/{id}/mode` — toggle agent/human (admin auth required)
- `POST /api/conversations/{id}/send` — manual send (operator mode)
- `POST /api/ai-agents/{id}/knowledge` — upload file/text/url
- `DELETE /api/ai-agents/{id}/knowledge/{ksid}` — remove
- `PATCH /api/ai-agents/{id}` — update system prompt, model chain
- `POST /api/admin/calista/test-call` — fire a one-shot test through the router (for the settings UI "Test" button)

Existing webhook handler unchanged in structure.

### 5.5 Background jobs

- **Catalog auto-sync** — daily cron job populates the `kind='auto_catalog'` knowledge source from `stocks` table (compact JSON of `{sku, name, price, stock_qty}` filtered to active items)
- **Model warm-up** — every 10 min, ping cooled-down models with a 1-token request; clear cooldown on 200
- **Tripwire alert dispatcher** — read unprocessed `llm_calls.status='tripwire_alert'` rows, dispatch via configured channel (default: WA to `CALISTA_ALERT_PHONE`), mark processed. Rate-limited to max 1 alert per minute per heuristic to avoid alarm fatigue.
- **Stale-pin cleanup** — hourly job clears `pinned_model_slug` for conversations that haven't had a message in 24h (avoids resurrecting pins to dead conversations)

### 5.6 Conversation Continuity Design

The router's goal is to make the customer feel like one consistent "Calista", even when the underlying model swaps due to rate-limits. Continuity has two layers — technical (full context always passed) and perceptual (voice/tone stays consistent). Phase 1A solves both.

**Technical continuity (automatic):**

- Every LLM call includes: system prompt + enabled knowledge sources + collected_data summary + last 15 messages (sliding window). The model doesn't carry state — the prompt does.
- State machine state (`conversations.state`, `CollectedData`) persisted in DB. Model swap reads from DB, picks up exactly where prior model left off.
- For long conversations (>15 turns), older messages are summarized into a single "context recap" prepended to the window. The state machine's `CollectedData` already captures order intent, so the recap focuses on chitchat/clarifying-context only.

**Perceptual continuity (the design):**

1. **Sticky model pinning** — see §5.1 routing decision. Once a conversation lands on Model X (either at start or via forced swap), it stays on X for subsequent calls until X is unavailable AND we're at a state boundary AND a healthier model is available.

2. **State-boundary unpin opportunity** — `StateBoundary=true` is passed by `engine.Machine` when transitioning between conversation states (e.g. `StateCollecting → StateClarifying`). The router uses this as the ONLY moment to consider unpinning back to a "better" (earlier-in-chain) model. Mid-state, the pin is sacred. This makes any voice shift land at a moment the customer already perceives as a topic transition, masking the shift.

3. **Hard cap at 2 swaps → escalate** — once `swap_count` reaches 2, the next forced swap returns `ChainExhaustedError`. Engine catches this, transitions conversation to `StateEscalatedAdmin`, existing escalation infrastructure notifies a human admin via WA (`approval_sender.go` flow), customer receives a holding message ("Sebentar ya Pak/Bu, saya cek dulu"). Zero paid cost. The customer sees AT MOST 2 voice changes per conversation; the 3rd "swap" is to a human.

4. **First-reply tone seeding** — after the first AI reply lands successfully, extract a "tone signature" and persist to `conversations.first_reply_tone`:

   ```json
   {
     "greeting": "Halo Pak Budi",
     "signoff": "(none — brief replies)",
     "formality": "casual_pak_bu",
     "sample": "Halo Pak Budi! Kabel 2.5mm tersedia. Berapa meter Pak?",
     "model_used": "google/gemma-4-31b"
   }
   ```

   On subsequent calls (regardless of which model handles them), prompt assembly prepends this hint:

   ```
   This conversation's established voice (from your first reply):
   - Greeting style: "Halo Pak Budi"
   - Tone: casual_pak_bu
   - Length: 1-3 short sentences
   - Sample turn: "[insert sample]"
   MATCH THIS VOICE. Reply in the same Bahasa Indonesia register.
   ```

   Imperfect (models still vary) but materially reduces the perceived gap when a swap happens.

5. **Persona reinforcement constants** — all calls include strict directives in `ai_agents.system_prompt`:

   - Tone: ramah tapi sopan, address as Pak/Bu/Bapak/Ibu
   - Language: **Bahasa Indonesia only** — never reply in English
   - Length: 1-3 short sentences; never walls of text
   - Emoji: max 1 per reply (👋 🙏 ✅ allowed)
   - Style: 2-3 few-shot example exchanges showing the expected voice

6. **Per-state max_tokens cap** — different conversation states have different reply budgets:

   ```
   StateGreeting:   60 tokens
   StateCollecting: 100 tokens
   StateClarifying: 120 tokens
   StateStockCheck: 150 tokens
   StateConfirming: 150 tokens
   StateAddMore:    60 tokens
   StateDelivery:   100 tokens
   StateBooked:     200 tokens (last reply with order summary)
   ```

   Stops verbose models (Llama 3.3 70B tends to ramble) from over-running on calls that other models handle in 1 line.

7. **Language drift guard (tripwire)** — heuristic: if reply contains >30% English tokens, the tripwire fires `status='tripwire_alert'`. Reply is NOT blocked, but the alert flags potential drift for retraining the persona prompt. If chronic, add a stronger language directive to the prompt and re-run.

**Worked example — Pak Budi orders 50m kabel:**

```
Turn 1: New conversation. Router pre-flight: gemma-4-31b healthy → pin.
        Call gemma. Reply: "Halo Pak Budi! Kabel 2.5mm tersedia. Berapa meter Pak?"
        Extract first_reply_tone. swap_count=0. Pinned model: gemma-4-31b.

Turn 2: Budi: "50 meter". State: StateClarifying. No state boundary.
        Pinned model gemma-4-31b healthy → use it. Reply consistent. swap_count=0.

Turn 3: State boundary StateClarifying→StateStockCheck. Pinned gemma healthy.
        StateBoundary=true triggers re-check — gemma still healthy, no swap.

Turn 4: gemma-4-31b returns 429 (mid-state, no boundary). Forced swap.
        Pick next-in-chain healthy: qwen3-next-80b. Pin updated. swap_count=1.
        Inject first_reply_tone hint into qwen's prompt. Reply mimics gemma's tone.

Turn 5: State boundary StateStockCheck→StateConfirming. Pinned qwen.
        State-boundary check: gemma still in cooldown → keep qwen. swap_count=1.

Turn 6-7: qwen handles confirming + add_more. swap_count=1.

Turn 8: qwen 429. Forced swap. nex-n2-pro healthy. swap_count=2 (AT CAP).

Turn 9: nex 429. swap_count would reach 3 → ChainExhaustedError.
        Engine transitions to StateEscalatedAdmin. Admin notified via WA.
        Customer receives: "Sebentar ya Pak Budi, saya cek dulu". Human takes over.

End of conversation: BOOKED reached eventually. Engine calls Router.Unpin().
        first_reply_tone preserved for analytics.
```

**Test coverage required in `pinning_test.go`:**

- New conversation pins to primary when primary is healthy
- New conversation skips primary if primary in cooldown
- Sticky pin retained mid-state even if "better" model recovers
- StateBoundary=true triggers unpin-back-to-primary when primary recovered
- Forced swap increments swap_count
- swap_count cap of 2 → 3rd 429 returns ChainExhaustedError
- Unpin clears pinned_model_slug
- first_reply_tone extracted on first successful call only (not subsequent)
- first_reply_tone hint injected into prompts after extraction

### 5.7 Cost Notification & Approval System

**Core principle (locked, aligns with founder memory):** every paid-tier upgrade requires explicit founder approval. The system NEVER auto-activates paid models. Notifications inform; the founder decides.

Phase 1 ships Layer 1 only (free OpenRouter). Layer 2 (paid Gemini Flash via OpenRouter) is built ready but `layer2_enabled=false` by default — only the founder can flip it via the dashboard with explicit confirmation.

**The 4-layer cost ladder:**

```
Layer 1: OpenRouter free 10-model chain        — Rp 0 (default, always on)
Layer 2: Paid Gemini Flash via OpenRouter      — ~Rp 100/conv (opt-in only)
Layer 3: Direct Gemini Asia (UU PDP compliance) — Phase 2/3, similar cost
Layer 4: Escalate-to-admin (human handover)    — Rp 0 (always available)
```

**Notification triggers** — sent to founder via WA (`CALISTA_ALERT_PHONE`) and surfaced as a dashboard banner:

| Trigger | Threshold | Severity | Message template |
|---------|-----------|----------|------------------|
| Chain exhaustion | `escalated_chain_exhausted` rate >1% in 24h | ⚠️ Warning | "Free tier showing pressure (X% conversations escalating). Consider enabling Layer 2 paid Gemini Flash. Estimated cost at current volume: Rp Y/bulan." |
| Volume ceiling | Total daily LLM calls >80% of free-tier ceiling | 📊 Info | "Approaching free-tier capacity ceiling. Layer 2 recommended within 7 days." |
| Excessive swaps | Avg swaps/conversation >1.5 over 24h | 🔄 Warning | "Models swapping too often (avg X swaps). Free tier under pressure." |
| Tenant capacity | Single tenant hit daily limit (Phase 2 only) | 👤 Warning | "Tenant {name} exhausted daily quota at hour X." |
| Layer 2 monthly spend | 70% / 95% / 100% of `layer2_monthly_cap_idr` | 💰 Warning / 🚨 Urgent / 🛑 Auto-disabled | Cap-progress alert |

Rate-limited: max 1 notification per trigger per day to prevent alarm fatigue. Quiet hours respected (22:00-06:00 WIB), urgent alerts override.

**Founder approval flow for Layer 2 activation:**

```
1. Trigger fires → founder receives WA notification.
2. Founder opens Calista Settings tab → "Cost Controls" section.
3. UI shows:
     - Current Layer 1 health (chain exhaustion rate, volume %)
     - Layer 2 status: DISABLED
     - Estimated monthly cost at current volume if enabled
     - Toggle: [ ] Enable Layer 2
     - Cap input: [Rp 200,000 ▾] per month
     - Cap action: ( ) auto-disable when hit  ( ) notify only
4. Founder toggles → confirmation modal:
     "Anda akan mengaktifkan paid Gemini Flash sebagai fallback Layer 2.
      Estimated monthly cost: Rp X
      Monthly cap: Rp Y
      Cap action: auto-disable / notify only
      Lanjut?"
     [Cancel] [Confirm]
5. On Confirm → write `ai_agents.layer2_enabled=true`,
   `layer2_monthly_cap_idr=200000`, `layer2_cap_action='auto_disable'`.
6. Router begins using Layer 2 as Layer 1 fallback.
7. Every Layer 2 call writes `llm_calls.cost_idr_estimated` and increments
   `ai_agents.layer2_current_month_spend_idr` atomically.
```

**Cap enforcement (`cost_monitor` background job, runs hourly):**

```
for each ai_agent where layer2_enabled=true:
  spend = ai_agent.layer2_current_month_spend_idr
  cap = ai_agent.layer2_monthly_cap_idr
  pct = spend / cap

  if pct >= 0.70 and not notified_70_this_month:
    notify_founder("💰 70% bulan ini terpakai (Rp X / Rp Y)")
  if pct >= 0.95 and not notified_95_this_month:
    notify_founder("🚨 95% bulan ini terpakai. Cap akan kena dalam hari ini.")
  if pct >= 1.0:
    if ai_agent.layer2_cap_action == 'auto_disable':
      set ai_agent.layer2_enabled=false
      notify_founder("🛑 Cap bulanan tercapai. Layer 2 DISABLED. Reset 1 bulan depan.")
    else:  # notify_only
      notify_founder("💸 Cap bulanan dilampaui. Layer 2 tetap aktif (notify_only mode).")
```

**Monthly reset cron** (day 1 of each month, 00:00 WIB):
- Reset `layer2_current_month_spend_idr` to 0 for all agents
- If `layer2_cap_action='auto_disable'` and was auto-disabled last month → automatically re-enable
- Send monthly summary to founder: "Cost last month: Rp X. Resetting today."

**Quiet defaults (Phase 1A ship state):**
- `layer2_enabled = false`
- `layer2_monthly_cap_idr = NULL` (no cap because Layer 2 is off)
- `layer2_current_month_spend_idr = 0`
- `OPENROUTER_API_KEY` env var = Vosi's account (single-tenant)
- Notification triggers ACTIVE from day 1 — but with Layer 2 off, they only inform; nothing auto-activates

**Test coverage required (`cost_monitor_test.go`):**
- Notification fires once per trigger per day, not 100×
- Cap auto-disable removes `layer2_enabled` flag
- Cap notify-only keeps `layer2_enabled` true but still notifies
- Monthly reset on day 1 zeroes spend counter
- Quiet hours (22:00-06:00 WIB) suppress non-urgent notifications
- Founder approval flow round-trips: dashboard write → DB → router behavior change

**6-month trajectory (per founder's 50-tenant target by EOY):**

| Month | Tenants | Layer 1 status | Layer 2 status | Projected Vosi cost |
|-------|---------|----------------|-----------------|---------------------|
| 0 (now) | 1 | Active | Disabled | Rp 0/bulan |
| 1-2 | 2-5 | Active (per-tenant keys ready in schema) | Disabled | Rp 0/bulan |
| 3 ⚠️ Checkpoint 1 | 6-15 | Watch metrics | Notification likely → founder decides | Rp 0 - 50K/bulan |
| 4 | 16-30 | Active | Likely enabled after Month 3 trigger | Rp 50-150K/bulan |
| 5 | 31-45 | Active | Active | Rp 150-300K/bulan |
| 6 (EOY) | 46-50 | Active | Active | Rp 200-400K/bulan (~Rp 4-8K/tenant) |

Per-tenant AI cost stays 5-10% of likely Vosi subscription pricing → healthy margin throughout the year.

## 6. Frontend Changes

### 6.1 `WhatsappAiScreen.tsx` reorg

Today: single tab with QR + numbers list. Restructure into three tabs:

1. **Numbers** (existing functionality, minimal change)
2. **Conversations** (new)
3. **Calista Settings** (new)

Sidebar item stays `WhatsApp AI`. Tab navigation inside the screen.

### 6.2 Conversations tab

```
┌─ Conversations ─────────────────────────────────────────────┐
│ [Search...]  Filter: [All ▾] Mode: [All ▾]   Realtime ●     │
├─────────────────────────────────────────────────────────────┤
│ Avatar | Customer       | Last msg               | Mode | ⓘ │
│   B    | Budi (+62...)  | Bos ada stok kabel?    | 🤖   | 2 │
│   S    | Siti (+62...)  | Foto barang [image]    | 🧑‍💼   | 0 │
│ ...                                                          │
├─────────────────────────────────────────────────────────────┤
│ ↓ open Budi → thread view (right pane or full screen)        │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ Mode: [🤖 Agent] [🧑‍💼 Human]                              ││
│ │ ───── chat bubbles ─────                                  ││
│ │  Calista: Halo Pak Budi! Ada yang bisa…  · 11:23         ││
│ │  Budi: Bos ada stok kabel 2.5mm?         · 11:24         ││
│ │  Calista: Kabel 2.5mm tersedia, harga…   · 11:24 [gemma] ││
│ │ ───── send box ─────                                      ││
│ │  [type a message...]  [📎] [Send]                         ││
│ └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

- List query: `select * from conversations order by last_message_at desc limit 50`
- Realtime: subscribe to `conversations` + `messages` channels, update list/thread reactively
- Mode toggle: optimistic update, RPC to backend
- Manual send: only enabled in `human` mode

### 6.3 Calista Settings tab

```
┌─ Calista Settings ──────────────────────────────────────────┐
│ Persona / System prompt:                                     │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ Kamu adalah Calista, asisten WhatsApp untuk toko Vosi.   ││
│ │ Sapa pelanggan dengan ramah...                            ││
│ └──────────────────────────────────────────────────────────┘│
│ [Save] [Test reply]                                          │
│                                                              │
│ Model Chain — all FREE (router pins per conversation, fall through on 429):│
│ ┌──────────────────────────────────────────────────────────┐│
│ │ 1. google/gemma-4-31b           [cooldown 60m] [↑↓] [✕]  ││
│ │ 2. qwen/qwen3-next-80b-a3b...   [cooldown 60m] [↑↓] [✕]  ││
│ │ 3. nex-agi/nex-n2-pro           [cooldown 60m] [↑↓] [✕]  ││
│ │ 4. nvidia/nemotron-3-super      [cooldown 60m] [↑↓] [✕]  ││
│ │ 5. google/gemma-4-26b-a4b       [cooldown 60m] [↑↓] [✕]  ││
│ │ 6. openai/gpt-oss-120b          [cooldown 60m] [↑↓] [✕]  ││
│ │ 7. meta-llama/llama-3.3-70b...  [cooldown 60m] [↑↓] [✕]  ││
│ │ 8. nousresearch/hermes-3-405b   [cooldown 60m] [↑↓] [✕]  ││
│ │ 9. nvidia/nemotron-3-nano-30b   [cooldown 60m] [↑↓] [✕]  ││
│ │ 10. openai/gpt-oss-20b          [cooldown 60m] [↑↓] [✕]  ││
│ │ All exhausted → escalate to admin (no paid fallback)     ││
│ │ [+ Add model]                                            ││
│ └──────────────────────────────────────────────────────────┘│
│ Conversation continuity:                                     │
│   ☑ Sticky pin per conversation                              │
│   ☑ State-boundary unpin opportunity                         │
│   Hard cap: 2 swaps → escalate to admin                      │
│                                                              │
│ Knowledge Base                                               │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ ⚙ product-catalog (auto-sync from stocks, daily)         ││
│ │   18,400 tokens · last synced 11:00 WIB     [Re-sync]    ││
│ │ ✅ faq-indonesia.md          [3,200 tok] [Disable] [✕]   ││
│ │ ✅ brand-tone.pdf            [1,800 tok] [Disable] [✕]   ││
│ │ [+ Upload file]   [+ Paste text]   [+ Add URL]           ││
│ │                                                          ││
│ │ Total: 23,400 / 30,000 tokens   ████████░░ 78%           ││
│ └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

- File parsing: PDF via `pdf-parse` lib, text + URL just stored. Done server-side.
- Token count via tiktoken estimate (good enough for budget tracking)
- "Test reply" sends a fake customer message through the full pipeline + shows model used + reply
- Bahasa Indonesia labels throughout (consistent with existing screens)

### 6.4 New component files (`src/components/whatsapp-ai/`)

```
src/components/whatsapp-ai/
  ConversationsTab.tsx
  ConversationList.tsx
  ConversationThread.tsx
  MessageBubble.tsx
  ModeToggle.tsx
  CalistaSettingsTab.tsx
  SystemPromptEditor.tsx
  ModelChainEditor.tsx
  KnowledgeUploader.tsx
  KnowledgeList.tsx
```

`WhatsappAiScreen.tsx` shrinks to a tab shell — the 821-line monolith is split.

## 7. Sub-Phase Breakdown

### Phase 1A — OpenRouter + Router + Continuity + Tripwire (~1.5 weeks)

Goal: Calista's AI calls go through OpenRouter via a 10-model free-tier chain with sticky-pinned conversation continuity. Direct Gemini SDK removed from engine. Tripwire heuristics live. Worst case (all 10 exhausted) escalates to admin via existing flow.

- **Setup:** OpenRouter account, $10 one-time prefund (unlocks higher free-tier rate limits). Add `OPENROUTER_API_KEY` + `CALISTA_ALERT_PHONE` env vars.
- **DB migrations:**
  - `llm_calls` table (telemetry)
  - `conversations` table: add columns `pinned_model_slug`, `pinned_at`, `swap_count`, `first_reply_tone` (used in Phase 1A only; full conversations table created in 1B)
- **Backend (`internal/llm/`):**
  - `router.go` — sticky pinning, state-boundary unpin, hard 2-swap cap, ChainExhaustedError
  - `pinning.go` — per-conversation pin/unpin/swap-count
  - `cooldown.go` — global per-model cooldown registry
  - `openrouter.go` — HTTP client (OpenAI-compatible)
  - `tone.go` — first-reply tone extraction + injection
  - `tripwire.go` — length, URL, profanity, jailbreak, language-drift heuristics
  - `telemetry.go` — `llm_calls` insert
- **Backend engine refactor:**
  - `engine.Machine` calls `llm.Router.Call(ctx, agent, msgs, CallOpts{ConversationID, StateBoundary})` instead of Gemini SDK
  - Catches `ChainExhaustedError` and transitions to `StateEscalatedAdmin`
  - Calls `Router.Unpin(conversationID)` on conversation termination
- **Backend handler:** existing whatsapp handler unchanged; engine refactor is transparent
- **Frontend:** nothing user-visible in 1A (UI changes ship in 1B/1C)
- **Tests:** router fallback under simulated 429s, sticky pin retention across calls, state-boundary unpin, hard cap at 2 swaps, tripwire heuristics, first-reply tone extraction + injection, ChainExhaustedError → engine escalation
- **Ship gate:**
  - 95% of `llm_calls` succeed (status='success')
  - p95 latency <3s end-to-end
  - ≥5 of 10 models actually serve traffic in first week (proves chain depth is real)
  - `escalated_chain_exhausted` rate <0.5% (rare safety net, not routine)
  - Zero engine crashes
  - Operator observation: tenant #1 cannot tell when a swap happened (qualitative check)

### Phase 1B — Mode toggle + Calista knowledge + Multimodal (~1.5 weeks)

Goal: Operators can flip Agent/Human per conversation. Admins can upload knowledge. Calista understands images/voice.

- DB: migrations for `conversations`, `messages`, `ai_agents`, `ai_knowledge_sources`
- Backend: handler.go mode lookup, mode toggle endpoint, knowledge endpoints, catalog auto-sync job, multimodal branch in router
- Frontend: Conversations tab list + thread, mode toggle, Calista Settings tab, knowledge uploader
- Tests: mode-toggle race conditions, knowledge token budget enforcement, multimodal end-to-end
- Ship gate: mode toggle <2s; knowledge injection visible in `llm_calls` payload; multimodal reply <4s p95

### Phase 1C — Dashboard polish (~1 week)

Goal: Conversation dashboard is the operator's daily-use surface, not an afterthought.

- Frontend: search, filter, unread badge, sound notification (toggleable), keyboard navigation
- Backend: pagination, search indexes
- Tests: realtime update lands <2s; list loads <1s with 1000 conversations
- Ship gate: operator can find any conversation in <5s

### Phase 1D — Conditional (only if Phase 1B-C signal demands)

- pgvector RAG upgrade if knowledge >30K tokens
- Nemotron 3.5 Content Safety guardrail if tripwire surfaces actual incidents
- Per-conversation model preference (e.g. always-use-Claude for VIP customers)

## 8. Rollout Strategy

Each sub-phase ships independently — no big-bang merge.

- **Pre-Phase-1A setup steps (founder action):**
  - Create OpenRouter account → prefund $10 one-time (unlocks higher free-tier rate limits across all 10 free models in chain). This $10 sits as an account balance; we won't spend it because chain has no paid fallback. It's a deposit, not a subscription.
  - Generate `OPENROUTER_API_KEY` → add to `backend-go` env vars
  - Register a WA number to receive tripwire/escalation alerts → set `CALISTA_ALERT_PHONE` env var
- **Feature flag pattern:** `ENABLE_OPENROUTER`, `ENABLE_AGENT_HUMAN_MODE`, `ENABLE_CALISTA_KNOWLEDGE`. Default off in prod until each sub-phase is ready. Toggle in `backend-go` env.
- **Shadow mode for Phase 1A:** for the first 3 days, run OpenRouter call alongside the existing Gemini call (both fire, only Gemini's reply is sent). Log both to `llm_calls` with a `shadow_of` link. After 3 days, compare on these objective criteria:
  - **Reply relevance** (subjective 1-5, sampled 50 conversation pairs by founder): does the reply answer the customer's question?
  - **Reply length** (objective): median, p95 length per provider; should be comparable to existing Gemini baseline (currently ~80-150 chars)
  - **Language consistency** (objective): % of replies that stay in detected conversation language. Threshold: ≥95% Bahasa Indonesia maintained
  - **Tripwire fires** (objective): per-provider count of length/URL/profanity/jailbreak/language-drift triggers
  - **State transition success** (objective): % of replies that successfully parse into the expected JSON shape per state. Threshold: ≥98%
  - **Latency p95** (objective): per-provider end-to-end latency. Threshold: <3s
  
  If OpenRouter chain meets all objective thresholds AND founder's subjective check is positive → flip `ENABLE_OPENROUTER=true`. If any threshold misses → fix and extend shadow mode another 3 days.
- **Tenant #1 communication plan:** before flipping the flag, send a short WA to tenant #1 operator: "Pak/Bu, hari ini kita upgrade AI Calista pakai beberapa model lain (lebih cepat + lebih cerdas). Mungkin gaya bahasanya sedikit berubah di awal. Mohon flag ke saya kalau ada balasan yang aneh. Terima kasih." 5-minute conversation, prevents confusion when they notice voice shifts in early days.
- **Whatsmeow code untouched** — no risk to current channel during Phase 1.
- **Per-conversation mode defaults to `agent`** on first inbound — matches today's implicit behavior. Migration backfills existing implicit conversations.

## 9. Telemetry & Observability

- `llm_calls` table is the source of truth for AI behavior. Dashboard query: success rate by model, latency p95 by model, tripwire alert count, cost (when paid models used).
- Tripwire alerts delivered via configured channel (see §5.5 — default WA to `CALISTA_ALERT_PHONE`). Rate-limited: max 1 alert per minute per heuristic.
- Existing Go-side logger lines unchanged.
- Phase 1C adds a small "Calista Health" widget on the Conversations tab footer: today's call count, primary model fallthrough rate, tripwire alerts in last 24h.

## 10. Testing Strategy

- `internal/llm/router_test.go` — fallback chain behavior: primary 200, primary 429 → fallback 200, all 429 → ErrAllModelsExhausted, cooldown decay, warm-up
- `internal/llm/tripwire_test.go` — each heuristic with positive and negative cases
- `internal/llm/openrouter_test.go` — HTTP mocking, retry policy
- `internal/engine/` integration test — full pipeline with mocked OpenRouter client
- Frontend: vitest for mode-toggle optimistic update, knowledge upload token budget
- Integration test: `tests/integration/calista.test.ts` — end-to-end with a real Supabase test instance

Existing whatsmeow tests stay green throughout — no regression budget.

## 11. Open Risks

| Risk | Mitigation |
|------|------------|
| OpenRouter platform outage takes down all AI | Engine catches all-models-down and transitions conversation to `StateEscalatedAdmin` — admin notified, human takes over via existing flow. Customer not stranded. |
| All 10 free models rate-limit simultaneously | Statistically rare (8 different providers globally). When it does happen, escalate to admin per design — no customer outage, just human handover. Add 11th-12th free model if observed >1% of conversations |
| Voice shift noticeable across model swap | First-reply tone seeding + persona constants + per-state max_tokens + few-shot examples in system prompt. Worst case: 2 visible shifts then human handover |
| Sticky pin retained after model permanently goes paid | Stale-pin cleanup job clears pins on conversations inactive >24h. Manually drop the model from chain UI if it goes paid. |
| Knowledge >30K tokens breaks Option A | Token budget check throws clear error in UI; trigger to plan Phase 1D pgvector |
| Multimodal model quality regression vs current media-bypass | A/B: keep human-bypass as fallback for first 2 weeks; compare operator-feedback ratings |
| Mode toggle race: customer message lands between agent->human flip and dashboard show | Server-side timestamp wins; client subscribes to changes so UI catches up within 200ms |
| Operator forgets a conversation in `human` mode forever | Phase 1D: auto-revert to `agent` after N hours of operator inactivity (configurable; default off) |
| OpenRouter "free" model silently becomes paid mid-month | Cost stays $0 because we have no paid fallback; that model will start returning errors or our prefunded $10 will tick down. Operator dashboard tracks per-model spend (always $0 expected); any spend triggers an alert. Demote the model in chain if it goes paid. |

## 12. Success Criteria

- **Phase 1A:**
  - 95% of LLM calls succeed (status='success').
  - p95 latency <3s end-to-end.
  - ≥5 of 10 models actually serve traffic in first week (proves chain depth).
  - `escalated_chain_exhausted` rate <0.5% of conversations.
  - Average swaps per conversation <0.5 (most conversations stay on primary).
  - Tenant #1 cannot distinguish replies from Gemini baseline vs OpenRouter chain (qualitative founder check).
  - OpenRouter monthly spend remains Rp 0 (all calls hit free tier).
- **Phase 1B:** Mode toggle propagates <2s. Knowledge cited in ≥50% of relevant replies (manual sampling). Multimodal reply <4s p95.
- **Phase 1C:** Conversation list loads <1s. Realtime updates <2s. Operator can find any conversation in <5s.
- **Overall:** Tenant #1 user satisfaction (qualitative — founder check-in) improves vs Gemini-only baseline. No regressions in current approval-button or debouncer flows. Total monthly AI cost: Rp 0.

## 13. Data Retention Policy

**Locked: no automated cleanup. All data retained indefinitely for future ML training (§14).**

- `messages`, `llm_calls`, `conversations`, `ai_knowledge_sources`, `whatsapp-media` Storage bucket — **never auto-deleted**.
- Estimated storage growth at projected volume: ~50MB/year per tenant (calls + messages). Supabase free tier covers 1GB; ~$0.125/GB/month thereafter. **<$1/month for 10 years of data.**
- **Individual customer deletion requests under UU PDP Pasal 35** (data subject right to erasure): handled via an admin-triggered redaction RPC (not automated cleanup). RPC anonymises the customer's name, phone, address, and message bodies in `conversations` + `messages` but preserves: structural rows (so ML datasets stay sample-counted), `llm_calls` records (already anonymous — only model_slug + latency + token counts). Process documented in Pre-launch checklist (§16).
- No retention SLA promised to customers; if a tenant chooses to enforce one later (e.g. 2-year retention), per-tenant retention policy added in Phase 2 multi-tenant work — NOT in Phase 1.

## 14. Data as a Moat (ML Training Corpus)

Phase 1's accumulated data builds a private corpus that becomes a competitive advantage over time. The retention policy above (§13) preserves the raw materials; this section explains why.

**Accumulating assets:**

| Asset | Phase 1 source | ML value |
|-------|----------------|----------|
| Customer ↔ Calista conversation pairs | `messages` table | Training corpus for fine-tuning a private Calista variant on real Indonesian sales chat |
| Operator-corrected drafts (when human takes over after Calista) | `messages` where `sender='operator'` immediately following `sender='ai'` in same conversation | **Preference pairs for DPO/RLHF** — operator's reply is the "preferred" example, Calista's is the "rejected" example. This is the highest-value training signal in modern LLM tuning. |
| Tone signatures | `conversations.first_reply_tone` jsonb | Training data for a "Calista tone consistency" classifier — could be deployed as a tripwire in Phase 1D |
| Tripwire-flagged outputs | `messages.tripwire_flags` + `llm_calls.status='tripwire_alert'` | Labeled negative examples for fine-tuning safety/quality |
| Customer-sent media (images, voice) | `whatsapp-media` bucket | Multimodal training set for Indonesian product-photo recognition |
| Per-model performance by domain | `llm_calls` aggregated by state + model_slug | Empirical model ranking specific to your sales-chat use case — drives chain re-tuning |

**Projected corpus size at 300 calls/day per tenant:**

| Time | Conversations | LLM calls | Operator overrides (~5% rate) | Tone signatures |
|------|---------------|-----------|-------------------------------|------------------|
| 6 months | ~6,500 | ~55,000 | ~2,750 | ~6,500 |
| 1 year | ~13,000 | ~110,000 | ~5,500 | ~13,000 |
| 3 years | ~40,000 | ~330,000 | ~16,500 | ~40,000 |

At 5,500+ preference pairs (1-year mark), you have **enough labeled data to fine-tune a small model** (e.g. Llama 3.2 3B, Qwen 2.5 7B) using DPO and meaningfully outperform a generic free-tier model on YOUR specific domain (Indonesian electrical-hardware sales chat). At 16,500+ pairs (3-year mark) you can fine-tune a mid-size model.

**Fine-tuning roadmap (post-Phase-1, indicative):**

- **Month 6:** baseline analysis — query the corpus, identify common failure modes Calista has on real conversations
- **Month 12:** first fine-tuning attempt on a small base model (Llama 3.2 3B or similar). Deploy as the 11th model in the chain (between free SOTA models and escalate-to-admin). A/B test against current chain
- **Month 18-24:** if the fine-tuned model meaningfully wins on Indonesian sales-chat metrics, promote to top of chain. Becomes "Calista Prime" — a proprietary model nobody else has
- **Year 3+:** corpus large enough to fine-tune a 7B-14B model. At that point, Calista's quality is sustainably ahead of generic free-tier models. Competitive moat.

**Important:** This is a long-game value. Phase 1 doesn't BUILD the fine-tuned model — it builds the corpus that ENABLES future fine-tuning. The cost (storage <$1/month, no engineering work in Phase 1) vs the option value (proprietary model 1-3 years out) is overwhelmingly favorable.

## 15. Capacity & Benefits Summary

### Capacity at Phase 1 ship-time

| Variable | Value |
|----------|-------|
| Bottleneck | OpenRouter free-tier rate limits (other layers uncapped) |
| Aggregate free-tier capacity (with $10 prefund) | ~2,000-5,000 LLM calls/day across 10-model chain |
| Avg LLM calls per typical order conversation | 8-15 (state machine + back-and-forth) |
| **Conservative capacity per tenant** | **~165 conversations/day** |
| **Realistic capacity per tenant** | **~300 conversations/day** |
| **Generous capacity per tenant** | **~625 conversations/day** |
| Today's baseline (Gemini-only) | ~125 conversations/day before silent failure |
| **Capacity multiplier vs today** | **2-5×** |

For tenant #1's current volume (~50 conversations/day), Phase 1 gives **3-12× headroom**. Room for tenant #2-5 on the same chain.

For 15+ tenants long-term, per-tenant OpenRouter accounts OR paid models needed. Out of scope for Phase 1.

### Benefits breakdown

**Customer-facing:**
- Multimodal: customers send "foto barang seperti ini" + image → Calista understands → conversion bump on visual-product inquiries
- Continuity design: customer experiences ONE consistent Calista across model swaps
- Operator can rescue confused conversations via mode toggle → fewer lost leads
- Customer opt-out detection ("STOP", "berhenti") respects customer wishes → fewer brand-damage incidents

**Operator-facing:**
- All conversations on one dashboard (Phase 1C): reply in <5s instead of WA-app hunt
- Mode toggle: explicit "who's replying" indicator → no ambiguity
- Knowledge upload self-service: admin updates FAQ/catalog in minutes, not engineering days
- Tripwire alerts → operator sees issues before customer does

**Engineering:**
- Model-agnostic AI layer: A/B test models in days, not weeks
- Telemetry-driven chain re-tuning: facts beat opinions
- Phase 2 (Cloud API) abstractions all laid in Phase 1
- TDD discipline maintained
- Whatsmeow untouched: zero risk to current production

**Business / Cost:**
- Rp 0 monthly recurring AI cost
- "Calista handles 300+ conversations/day with multi-model AI" = real product copy
- Unblocks tenant #2 (paired with Phase 2)
- Founder confidence loop: see Calista improve → trust the platform

**Data moat (long-game):**
- Accumulating training corpus from day 1 (§14)
- Storage cost <$1/month for 10-year retention
- Path to fine-tuned proprietary Calista at month 12+

## 16. Pre-Launch Checklist

Items that must be DONE before tenant #1 can run on the OpenRouter chain in production (i.e. before flipping `ENABLE_OPENROUTER=true`).

**Operational:**
- [ ] OpenRouter account created, $10 prefunded
- [ ] `OPENROUTER_API_KEY` set in production env
- [ ] `CALISTA_ALERT_PHONE` set in production env
- [ ] All Phase 1A migrations applied to production Supabase (with `supabase db push`)
- [ ] Shadow mode run for ≥3 days; objective criteria (§8) all met
- [ ] Tenant #1 operator notified of upcoming change (script in §8)

**Legal / Compliance:**
- [ ] **UU PDP individual deletion RPC** implemented and tested (`redact_calista_conversation(conversation_id)` — anonymises name/phone/body, preserves structural rows for ML stats). Required before any customer can lawfully invoke their right to erasure
- [ ] **Privacy notice updated** on tenant #1's customer-facing touchpoints (toko WhatsApp profile, website if any): "Pesan Anda mungkin diproses oleh asisten AI Calista yang dibantu layanan pihak ketiga (OpenRouter). Data disimpan untuk keperluan pelayanan dan perbaikan layanan. Hubungi {toko_contact} untuk meminta penghapusan data Anda."
- [ ] **Lawful basis check** with founder — for tenant #1 (Vosi-owned single toko), founder is data controller; legitimate interest for service delivery is reasonable. For tenant #2+ (Phase 2), per-tenant lawful basis needs review
- [ ] AI self-identification policy implemented (§5.1 tripwire) — model answers "are you AI?" honestly when asked

**Quality gates:**
- [ ] Router fallback chain tested under simulated 429 (all paths + escalation)
- [ ] Sticky pin test passing
- [ ] Engine integration map (§5.2.1) implemented and tested
- [ ] Tolerant JSON parser tested on each of the 10 models in chain (each may have output quirks)
- [ ] Cooldown registry persistence verified (kill daemon, restart, verify cooldowns restored)
- [ ] Media storage bucket + RLS deployed
- [ ] Existing whatsmeow tests still green (no regression in approval-button or debouncer flows)

**Rollback plan:**
- [ ] `ENABLE_OPENROUTER=false` returns engine to direct Gemini SDK (kept available in `internal/gemini/`)
- [ ] Documented in runbook: how to flip the flag and verify

## 17. Hand-off to writing-plans

Once user approves this spec, the `writing-plans` skill takes the Phase 1A breakdown first (it's the smallest, lowest-risk, most independent unit) and produces the implementation plan. Phase 1B and 1C get separate writing-plans passes after 1A ships.
