# WhatsApp Agent Stack — Comparison & Adoption Assessment

**Date:** 2026-06-13
**Reference:** [lakshit77/Whatsapp-Agent](https://github.com/lakshit77/Whatsapp-Agent)
**Purpose:** Decide which patterns from the reference repo to adopt for scale and sustainability.
**Status:** Approved. Drives the companion design doc `2026-06-13-calista-phase-1-design.md`.

---

## 1. Executive Summary

The reference repo (`lakshit77/Whatsapp-Agent`) is a much simpler stack than ours, but exposes three patterns we do not have today that are valuable for scale and sustainability:

1. **Meta WhatsApp Business Cloud API** as the channel (vs our whatsmeow Go daemon). Required to onboard multi-tenant without N QR pairings, and is the only contractually safe long-term channel.
2. **OpenRouter as the LLM gateway** (vs our direct Gemini integration). Unlocks model freedom, cost-free fallback chains, and the engineering ability to A/B-test models.
3. **Per-conversation Agent/Human mode toggle** (vs implicit AI-always-on). Critical safety net for hand-off when the AI fumbles.

Our stack is materially **more mature** than the reference repo on every other axis (Go backend, debouncing, approval-button flows, tests, ERP integration, deep observability). We are not migrating off our maturity — we are surgically adopting the three patterns above.

**Recommended adoption strategy: Layered (Approach A).** Phase 1 adds the three patterns above (additive, low risk, ~3-4 weeks). Phase 2 migrates the channel from whatsmeow to Meta Cloud API in parallel — whatsmeow stays running until Cloud API is proven (no cutover, no risk to tenant #1).

---

## 2. Current State — What We Have

### 2.1 Backend (`backend-go/internal/whatsapp/`)

| File | LOC | Purpose |
|------|-----|---------|
| `client.go` | 224 | whatsmeow daemon lifecycle, QR pairing, SQLite session store |
| `handler.go` | 785 | Inbound message routing, group/broadcast filtering, media bypass, debouncer integration |
| `sender.go` | 63 | Outbound text |
| `approval_sender.go` | 57 | Interactive approval buttons |
| `debounce.go` | 308 | Rapid-fire customer message debouncing (5-15s window) |
| `typing.go` | 28 | "Calista is typing…" indicator |
| `clock.go` | 25 | Time abstraction for tests |
| Tests | ~770 | Unit + integration, TDD-discipline |

Plus pollers (`internal/followup/`, `internal/heartbeat/`, `internal/approvals/expiry_poller.go`), webhook handler (`internal/api/approval_webhook.go`), AI engine (`internal/engine/`), rules (`internal/rules/`), scheduler (`internal/scheduler/`).

### 2.2 Frontend (`src/components/WhatsappAiScreen.tsx`)

- 821 lines
- Live QR display via `qrcode.react`
- Real-time daemon status polling
- WhatsApp number list with per-number AI enable/disable
- Code snippet preview for daemon connection
- Loaded from Supabase via realtime subscription

### 2.3 Channel — whatsmeow (unofficial)

- Library: `go.mau.fi/whatsmeow`
- Protocol: WhatsApp multi-device protocol (reverse-engineered)
- Pairing: QR code per phone, one daemon per number
- Cost: zero per message
- Compliance: against Meta ToS (gray area)
- Multi-tenant: N daemons + N QR sessions
- Ban risk: moderate at single-tenant DM volume, high at marketing-blast volume

### 2.4 AI Model — Gemini 2.5 (direct SDK)

- Library: `google/generative-ai-go`
- Single model, single vendor
- Free tier: 15 RPM (aggressive)
- No fallback path on outage

### 2.5 Data Model (relevant Supabase tables)

- `whatsapp_numbers` — phone, name, status, is_ai_enabled
- Sales channel tables (14 channels including whatsapp)
- Approval flow tables with audit
- Multi-tenant scaffolding in design (Layer C-min spec, separate)

---

## 3. Reference State — What `lakshit77/Whatsapp-Agent` Has

### 3.1 Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 16 App Router + Tailwind |
| Backend | Next.js API routes (same project) |
| DB | Supabase + realtime |
| Channel | **Meta WhatsApp Business Cloud API** (webhook + Graph API) |
| LLM | **OpenRouter** (OpenAI-compatible gateway, `AI_MODEL` env var) |
| Hosting | Vercel + ngrok (dev) |

### 3.2 Key Patterns

1. **Per-conversation `mode` field** — `agent` (AI auto-reply) or `human` (manual). Toggle from dashboard.
2. **Realtime conversation list** — Supabase channel subscription, sorted by latest message.
3. **WhatsApp-style chat UI** — bubble layout, timestamps, manual send box.
4. **Model abstraction** — change `AI_MODEL=anthropic/claude-sonnet-4` vs `google/gemini-2.5-flash` without code changes.
5. **Flow** — webhook → store inbound → call OpenRouter → store reply → send via Graph API → Supabase realtime pushes to dashboard.

### 3.3 What It Lacks (vs Us)

- No debouncing
- No retries
- No queue / async processing
- No interactive buttons (approval flow)
- No tests
- No conversation memory window management
- No rate limiting / abuse handling
- No multi-warehouse / ERP context
- No multi-tenant
- No observability beyond logs

---

## 4. Side-by-Side Comparison

| Dimension | ERPAntigravity (today) | lakshit77/Whatsapp-Agent | Adopt? |
|-----------|------------------------|--------------------------|--------|
| **Channel** | whatsmeow (unofficial, free, QR-pair) | Meta Cloud API (official, paid, webhook) | **Yes (Phase 2, parallel)** |
| **LLM gateway** | Direct Gemini SDK | OpenRouter (multi-model) | **Yes (Phase 1A)** |
| **Conversation mode** | Implicit (AI always on per-number) | Explicit `agent`/`human` per-conversation | **Yes (Phase 1B)** |
| **Conversation dashboard** | Number list, no per-chat thread view | Conversation list + thread view | **Yes (Phase 1C)** |
| **Debouncing** | 308-line implementation, tests | None | Keep ours |
| **Approval buttons** | Interactive WA buttons + expiry poller | None | Keep ours |
| **Tests** | TDD discipline, ~1500 LOC | None | Keep ours |
| **Multi-tenant** | Planned (Layer C-min spec) | None | Keep ours, Cloud API unblocks |
| **Multimodal (image/voice)** | Media bypass to human | None | **Yes (Phase 1B)** — Nemotron Nano Omni |
| **Knowledge base** | None (prompt-only) | None | **Yes (Phase 1B)** — Calista upload UI |
| **Safety guardrail** | None | None | Defer; tripwire heuristics in Phase 1A |
| **Backend language** | Go | TypeScript / Node | Keep Go |

---

## 5. Recommended Adoptions

### 5.1 Phase 1 (additive, ~3-4 weeks total)

**1A. OpenRouter as LLM gateway + auto-failover router** (~1 week)

Replace direct Gemini SDK with OpenRouter HTTP client behind a fallback-chain router. When the primary model returns 429 / quota-exhausted, cool down and fall through to the next model. Per-conversation pinning for continuity. Telemetry on which model handled which call.

**Model chain (for Indonesian sales chat):**
1. `google/gemma-4-31b` (140+ languages, function calling, multimodal)
2. `qwen/qwen3-next-80b-a3b-instruct` (strong SEA languages)
3. `nex-agi/nex-n2-pro` (Qwen3.5-based, newest)
4. `google/gemma-4-26b-a4b` (MoE, fast fallback)
5. `openai/gpt-oss-120b` (function-calling reliability)
6. `meta-llama/llama-3.3-70b-instruct` (battle-tested)
7. `google/gemini-2.5-flash` (paid, our existing direct path — last-resort)

**Tripwire heuristics** (zero-latency, zero-cost output monitoring) — log reply length > 800 chars, non-whitelisted URLs, profanity wordlist hits, jailbreak phrase detection. Slack-alert, do not block. Empirical foundation for the optional Phase 1D guardrail.

**1B. Agent/Human mode toggle + Calista knowledge + multimodal** (~1.5 weeks)

- Per-conversation `mode` column (`agent` | `human`), toggle UI on dashboard
- "Calista Settings" tab — system prompt editor, model chain config, knowledge uploader (Option A: stuff into system prompt, ≤30K tokens total)
- Multimodal path: route media messages through `nvidia/nemotron-3-nano-omni` (text + image + video + audio)

**1C. Conversation dashboard polish** (~1 week)

- Conversation list view in `WhatsappAiScreen` (or new screen) — sorted by latest message, mode badge per row
- Thread view with WhatsApp-style bubbles, timestamps, manual send box
- Realtime subscription via existing Supabase channel pattern

**1D. Deferred / conditional**

- pgvector RAG upgrade — only if Option A knowledge exceeds 30K-token budget
- Nemotron 3.5 Content Safety guardrail — only if tripwire surfaces actual incidents
- Owl Alpha — only for non-customer-PII tasks (it logs prompts)

### 5.2 Phase 2 (channel migration, ~4-6 weeks)

**Hard constraint: whatsmeow stays running through entire Phase 2. No cutover until Cloud API parity is proven on a test number.**

- 2A. Build `backend-go/internal/cloudapi/` (handler, sender, webhook verify). Channel-agnostic routing layer above both `whatsmeow` and `cloudapi` packages. Tenant #1 production traffic untouched.
- 2B. Provision a test WhatsApp Business number through Meta. Shadow tests: send, receive, AI reply, approval buttons (Interactive Message API), debouncing equivalent.
- 2C. Achieve feature parity. Document deltas (e.g. typing indicators behave differently in Cloud API). Sign off.
- 2D. Plan tenant #1 cutover only after 2C sign-off:
  - Re-pair tenant #1 phone with Meta Business profile
  - Flip routing flag in DB (`channel_provider` column on `whatsapp_numbers`)
  - whatsmeow code remains as fallback for ≥30 days
  - Remove whatsmeow only after soak window with zero regressions
- New tenants onboard directly to Cloud API — never touch whatsmeow.

---

## 6. Why Not the Other Approaches

**Approach B (Cloud API first, everything else after)** — rejected because:
- 5+ weeks of zero shippable value before any improvement reaches tenant #1
- Channel rewrite has highest blast radius; doing it without intermediate validation is the riskiest sequence
- Tenant #2 isn't signed yet (per `progress.md`, prereq tracks Layer C-min, pricing, legal, etc. still in progress) — no urgency to front-load it

**Approach C (hybrid forever — keep whatsmeow + add Cloud API)** — rejected because:
- Doubles maintenance forever (every approval/debounce/typing feature lives in two places)
- whatsmeow ToS risk doesn't go away — it stays for tenant #1 indefinitely
- Phase 2D's parallel-then-migrate already gives us the safety benefits without permanent dual-stack

---

## 7. Hard Constraints (Locked)

1. **Whatsmeow runs throughout Phase 2.** Cloud API is added in parallel, proven on a test number, then tenant #1 is migrated only after parity sign-off. Whatsmeow code stays ≥30 days post-cutover as fallback.
2. **No customer-PII through Owl Alpha.** Its model card explicitly states prompts may be logged for training. Use only for internal admin tasks where customer data is not present.
3. **No Venice Uncensored.** Safety layers explicitly removed — brand-damage risk too high.
4. **Calista replies must stay under 3s p95 perceived latency.** This is the WhatsApp-UX threshold. Constrains the router cooldown design and rules out adding the Phase 1D safety guardrail by default.

---

## 8. Out of Scope (Not Adopting from Reference Repo)

- **Next.js as backend.** Our Go backend is superior for the workload (concurrency, daemon lifecycle, tests).
- **Synchronous webhook flow.** We will keep our async patterns (debouncer, pollers).
- **Vercel deployment.** We have Cloud Run + Supabase already.
- **The reference repo's lack of tests.** We keep our TDD discipline; new code follows existing patterns.

---

## 9. Open Questions / Future Revisits

- **Cost projection for Cloud API at projected multi-tenant volume.** Needs message-volume estimate per tenant × Indonesian per-conversation pricing (~$0.005-0.029 depending on category, first 1000 service convos/month free). Revisit before Phase 2D cutover.
- **OpenRouter data residency.** Customer messages transit openrouter.ai edge. Check OpenRouter's data policy against UU PDP (Indonesia data protection law) before sending PII through free open-source routes. Paid routes are explicit no-train, no-log. Revisit in Phase 1A.
- **Multimodal model selection.** Phase 1B starts with Nemotron Nano Omni. Re-evaluate against Gemma 4 31B (also multimodal) after 2 weeks of usage data.
- **Knowledge upload Option A → B trigger.** Option A (stuff into prompt) breaks when knowledge >30K tokens. Set up monitoring at Phase 1B ship time so we know when to upgrade.

---

## 10. Success Criteria for Phase 1

- Phase 1A: 95% of LLM calls succeed via the fallback chain (no `ErrAllModelsExhausted` alarms). p95 latency under 3s end-to-end. At least 3 of 7 models in the chain have served ≥10% of traffic in the first week (proves the chain is real, not theatre).
- Phase 1B: Operators flip Agent → Human mode in <2s. Calista uses knowledge from uploaded sources in ≥50% of replies (measured by injection log). Multimodal path handles image messages with reply latency ≤4s p95.
- Phase 1C: Conversation list loads in <1s. Realtime updates land in <2s. Operator can manually send a message in <3 clicks.

---

## 11. References

- Reference repo: https://github.com/lakshit77/Whatsapp-Agent
- Companion design: `docs/superpowers/specs/2026-06-13-calista-phase-1-design.md`
- Multi-tenant context: `docs/superpowers/specs/multi-tenant-prerequisites-design.md`
- Existing WA code: `backend-go/internal/whatsapp/`
- Existing UI: `src/components/WhatsappAiScreen.tsx`
