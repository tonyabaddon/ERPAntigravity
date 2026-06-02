# ERP Antigravity — Implementation Progress

## Task 1: Update Go module dependencies — DONE (2026-05-31)

- Updated `backend-go/go.mod` to go 1.25.0 with all required direct dependencies
- Added: `go.mau.fi/whatsmeow`, `github.com/google/generative-ai-go`, `github.com/mattn/go-sqlite3`, `github.com/joho/godotenv`, `google.golang.org/api`
- Note: The task-specified whatsmeow commit `50b888c41a20` does not exist; resolved to latest: `v0.0.0-20260529101937-a7ea56383ec4`
- `go.sum` created with 43 entries covering all transitive deps
- `CGO_ENABLED=1 go build ./...` passes cleanly
- Committed: `feat(go): add whatsmeow, gemini, sqlite3, godotenv deps`

### Follow-up fix (2026-05-31): populate go.sum h1: hashes

- The four forward-declared direct requires (`generative-ai-go`, `godotenv`, `go-sqlite3`, `google.golang.org/api`) were missing h1: content hashes because no source file imports them yet
- Used `go get <module>@<version>` (explicit args) to write h1: lines — `go mod download` without explicit args does NOT write h1: for unused deps in modern Go
- `go.mod` is unchanged; `go 1.25.0` directive kept (whatsmeow itself requires it)
- go.sum now has 53 entries (10 new h1: lines for the four deps plus their transitive indirect deps)
- `go mod verify` and `CGO_ENABLED=1 go build ./...` both pass
- Committed: `fix(go): populate go.sum h1 hashes for direct deps not yet imported in source`

## Task 2: Supabase schema migration — DONE (2026-05-31)

- Created `supabase/migrations/20260531000000_core_ai_engine.sql`
- Defines 4 enums: `conversation_state` (12 values), `message_sender`, `order_status`, `wa_number_status`
- Creates 4 tables: `whatsapp_numbers`, `conversations`, `messages`, `orders` with appropriate indexes
- RLS enabled on all tables; anon-key policies scoped to read-all, insert admin messages, toggle conversation state, approve orders
- `pg_notify` triggers for `admin_messages` and `order_approved` channels (Go daemon listens via LISTEN)
- Supabase Realtime enabled for all 4 tables
- File header notes: create Storage bucket `chat-media` with Public access after applying
- Apply via: `supabase db push` or paste into Supabase Dashboard SQL editor
- Committed: `feat(db): add core AI engine schema — conversations, messages, orders, RLS, triggers`

### Migration fixes (2026-05-31): 7 issues patched

- Fix 1 (Critical): 4 bare `ALTER PUBLICATION` lines replaced with idempotent DO blocks checking `pg_publication_tables`
- Fix 2 (Critical): Column-level `GRANT UPDATE (state) ON conversations TO anon` and `GRANT UPDATE (status, shipping_fee) ON orders TO anon` added after RLS policies
- Fix 3 (Important): `set_updated_at()` trigger function + `trg_conversations_updated_at` trigger added
- Fix 4 (Important): `updated_at timestamptz NOT NULL DEFAULT now()` column added to `orders` table + `trg_orders_updated_at` trigger added (shares `set_updated_at()` function)
- Fix 5 (Important): `ALTER TABLE whatsapp_numbers ADD CONSTRAINT uq_wa_phone UNIQUE (phone_number)` added
- Fix 6 (Important): `notify_admin_message()` payload changed from `'text', NEW.text` to `'message_id', NEW.id` to avoid 8000-byte pg_notify truncation
- Fix 7 (Minor): All 4 `CREATE TYPE` statements wrapped in idempotent DO/EXCEPTION blocks
- Committed: `fix(db): idempotent migration, column-level grants, updated_at triggers, pg_notify fix`

## Task 3: Go shared models — DONE (2026-05-31)

- Created `backend-go/internal/models/types.go`
- Defines `ConversationState` type with 12 constants (exactly matching Supabase `conversation_state` enum)
- `IsTerminal()` method identifies states where incoming messages should be ignored: `CANCELLED`, `COMPLETED`, `ESCALATED_ADMIN`, `ESCALATED_WIRING`
- Defines `CollectedData` struct with `AllCoreFieldsFilled()` validation method
- Defines `Conversation`, `Message`, `Order`, `OrderItem`, `StockItem` structs with JSON tags
- `CGO_ENABLED=1 go build ./internal/models/...` passes cleanly
- Committed: `feat(go): add shared models package`

## Task 4: Config loader — DONE (2026-05-31)

_(Previously completed — not detailed here)_

## Task 5: DB client with LISTEN/NOTIFY — DONE (2026-05-31)

- Created `backend-go/internal/db/client.go`
- `Client` struct wraps `*sql.DB` and `*pq.Listener`
- `NewClient(connStr)` opens a pooled connection (max 10 open / 5 idle / 5 min lifetime) and a `pq.Listener` with 10s min reconnect, 1 min max
- `StartListening(NotifyHandlers)` subscribes to `admin_messages` and `order_approved` channels; dispatches each notification to the appropriate handler in its own goroutine
- `NotifyHandlers.OnAdminMessage` signature is `func(conversationID, messageID string)` — receives `message_id` from payload (not text), matching the updated `notify_admin_message` trigger
- `Close()` shuts down both listener and DB pool cleanly
- `CGO_ENABLED=1 go build ./internal/db/...` passes cleanly

## Task 6: DB conversations — DONE (2026-05-31)

- Created `backend-go/internal/db/conversations.go`
- `GetOrCreateConversation` returns the most recent active conversation or creates a new `GREETING` one
- `UpdateConversationState`, `UpdateCollectedData`, `UpdateLanguage` — targeted UPDATE helpers
- `ListConversationsByPhone` — returns all conversations for a phone number DESC
- `CGO_ENABLED=1 go build ./internal/db/...` passes cleanly

## Task 7: DB messages, orders, stock — DONE (2026-05-31)

- Created `backend-go/internal/db/messages.go`
  - `InsertMessage`, `InsertMediaMessage`, `GetMessageByID`, `ListLast10Messages`
  - `GetMessageByID` needed by main.go to look up full message text from the `admin_messages` LISTEN payload (which sends `message_id` not text)
- Created `backend-go/internal/db/orders.go`
  - `CreateOrder` — inserts with 48 h booking expiry; RETURNING includes `updated_at`
  - `UpdateOrderStatus` — sets `approved_at = now()` for non-CANCELLED statuses
  - `MarkReminderSent`, `ListActiveBookings`, `GetOrderByConversation`, `GetOrderByID`
  - `PendingOrder` helper struct for the scheduler
- Created `backend-go/internal/db/stock.go`
  - `SearchStockByName` — case-insensitive LIKE search on `stocks` table, returns up to 10 in-stock results
- `CGO_ENABLED=1 go build ./internal/db/...` passes cleanly
- Committed: `feat(go): add DB layer — client, conversations, messages, orders, stock`

## Task 8: Rules engine for keyword escalation — DONE (2026-05-31)

- Created `backend-go/internal/rules/escalation.go`
  - `EscalationType` string type with three constants: `EscalationNone` (""), `EscalationWiring` ("WIRING"), `EscalationAdmin` ("ADMIN")
  - `wiringKeywords` array: instalasi, grounding, panel custom, wiring, proyek besar, diagram, installation, custom panel
  - `adminKeywords` array: diskon, discount, harga khusus, special price, potongan harga, price cut
  - `CheckEscalation(text string)` scans message for keywords (case-insensitive); WIRING takes priority over ADMIN
- Created `backend-go/internal/rules/escalation_test.go`
  - `TestWiringKeywords` covers 5 positive cases and 2 negative cases
  - `TestAdminKeywords` covers 3 positive cases and 1 negative case
  - All 2 tests PASS
- This rules engine is the first thing checked when a WhatsApp message arrives, before any LLM call — fast keyword scan
- Committed: `feat(go): add rules engine with keyword escalation detection`

## Task 9: Engine parser (Gemini JSON → typed structs) — DONE (2026-05-31)

- Created `backend-go/internal/engine/parser.go`
  - Defines typed response structs for all 6 states: `GreetingResponse`, `CollectingResponse`, `ClarifyingResponse`, `StockCheckResponse`, `ConfirmingResponse`
  - Support structs: `CollectedFields` (name, company, address, product), `ClarifyingSpecs` (qty, size, color, notes)
  - Parse functions: `ParseGreeting`, `ParseCollecting`, `ParseClarifying`, `ParseStockCheck`, `ParseConfirming` — all return `(*T, error)`
  - `FallbackReply(language string)` — language-aware safe fallback when JSON parse fails (Indonesian for "id", English otherwise)
- Created `backend-go/internal/engine/parser_test.go`
  - 5 tests: `TestParseGreeting`, `TestParseGreetingInvalidJSON`, `TestParseCollecting`, `TestParseConfirming`, `TestFallbackReply`
  - All 5 tests PASS
- TDD workflow: tests written first and confirmed failing, then implementation written, tests confirmed passing
- Committed: `feat(go): add engine parser — Gemini JSON to typed structs with tests`

## Task 10: Engine prompts for conversation states — DONE (2026-05-31)

- Created `backend-go/internal/engine/prompts.go`
  - `BuildPrompt(state, language, data, history, stockContext)` — constructs full system+context prompt for Gemini API calls
  - Includes collected data (name, company, address, product, qty), stock context, and conversation history
  - `systemPromptForState(state, language)` — returns state-specific system prompt for all 5 active states:
    - `StateGreeting`: greet warmly, detect language, respond with JSON containing reply + detected_language
    - `StateCollecting`: ask for ONE missing field at a time (name, company, address, product); escalate on discount/special price requests
    - `StateClarifying`: ask about quantity, size, color, notes; move to READY or ESCALATE
    - `StateStockCheck`: present available stock from DB with prices; CONFIRM or ESCALATE
    - `StateConfirming`: present full order summary, await "OK"/"BENAR" confirmation
  - `StockContextString(items)` — formats `[]models.StockItem` as compact stock display for prompt (name, SKU, price in Rupiah, stock quantity)
  - `formatHistory(msgs)` — converts message slice to readable conversation history with sender role + message text
  - All prompts include language selector (Bahasa Indonesia / English) and JSON response format constraints
- `CGO_ENABLED=1 go build ./internal/engine/...` passes cleanly (no errors)
- Committed: `feat(go): add engine prompts — system prompts per conversation state`

## Task 11: Gemini API client wrapper — DONE (2026-05-31)

- Created `backend-go/internal/gemini/client.go`
- `Client` struct wraps `*genai.Client` and `*genai.GenerativeModel`
- `NewClient(ctx, apiKey)` initializes Gemini client with `gemini-1.5-flash` model and `ResponseMIMEType = "application/json"` (forces valid JSON output)
- `GenerateReply(ctx, fullPrompt)` sends prompt to Gemini, extracts text from response candidates, returns raw JSON string
- `Close()` releases underlying client connection
- Method signatures match `GeminiClient` interface contract defined in `internal/engine/machine.go`
- Added `github.com/google/generative-ai-go@v0.19.0` and transitive deps to `go.mod` and `go.sum` (53 entries total)
- `CGO_ENABLED=1 go build ./internal/gemini/...` passes cleanly
- Committed: `feat(go): add Gemini client wrapper with JSON response mode`

## Task 12: State machine for Go WhatsApp AI daemon — DONE (2026-05-31)

- Created `backend-go/internal/engine/machine.go`
  - `GeminiClient` interface: `GenerateReply(ctx, fullPrompt) (string, error)` — allows mock injection in tests
  - `Machine` struct wrapping a `GeminiClient`; `NewMachine(g)` constructor
  - `ProcessResult` struct: Reply, NextState, NewData, ClarificationRound, Language, CreateOrder
  - `Process(ctx, conv, incomingText, history, stockContext)` — full state machine dispatch:
    - GREETING → parses language, always advances to COLLECTING
    - COLLECTING → merges partial fields; advances to CLARIFYING when AllCoreFieldsFilled(); ESCALATE → ESCALATED_ADMIN
    - CLARIFYING → accumulates specs; READY or round ≥ 3 → STOCK_CHECK; ESCALATE → ESCALATED_ADMIN
    - STOCK_CHECK → CONFIRM → CONFIRMING; ESCALATE → ESCALATED_ADMIN
    - CONFIRMING → confirmed=true → BOOKED (CreateOrder=true); modification_requested=true → back to CLARIFYING round 0
  - Parse failures or Gemini errors return a safe FallbackReply with state unchanged; function never returns a non-nil error
- Created `backend-go/internal/engine/machine_test.go`
  - `mockGemini` struct satisfies `GeminiClient` for test isolation
  - 5 tests: `TestProcessGreeting`, `TestProcessCollectingMovesToClarifying`, `TestProcessEscalate`, `TestProcessConfirmingBooked`, `TestProcessGeminiFallback`
  - TDD workflow: test file written and confirmed failing (undefined: Machine), then implementation written, all 10 engine tests PASS
- `go test ./internal/engine/... -v` — 10/10 PASS
- Committed: `feat(go): add conversation state machine with Gemini integration`

## Task 13: Booking timeout scheduler — DONE (2026-05-31)

- Created `backend-go/internal/scheduler/timeout.go`
  - `BookingEntry` struct: ID (string) and ExpiresAt (time.Time)
  - `Scheduler` struct with two maps for tracking reminder and cancellation timers, plus onReminder and onCancel callbacks
  - `NewScheduler(onReminder, onCancel)` constructor returns initialized scheduler
  - `Schedule(orderID, expiresAt)` registers two timers: reminder fires at (expiresAt - 24hr), cancellation fires at expiresAt
  - `Cancel(orderID)` stops both timers for an order and removes them from maps
  - `RestoreOnBoot(entries)` re-registers timers for all active bookings after daemon restart (filters out expired entries)
  - All timer operations are guarded by mutex to ensure thread-safe concurrent access
- Created `backend-go/internal/scheduler/timeout_test.go`
  - 3 tests covering core scenarios: `TestSchedulerFiresReminder`, `TestSchedulerCancel`, `TestRestoreOnBoot`
  - TDD workflow: tests written and confirmed failing, then implementation written
  - All 3 tests PASS
- `CGO_ENABLED=1 go build ./...` passes cleanly
- Committed: `feat(go): add booking timeout scheduler with restore-on-boot`

## Task 14: WhatsApp client and sender — DONE (2026-05-31)

- Created `backend-go/internal/whatsapp/client.go`
  - `Client` struct wrapping `*whatsmeow.Client`
  - `NewClient(ctx, dbPath)` opens SQLite store via `sqlstore.New` (ctx required by this version), calls `GetFirstDevice(ctx)`, constructs WA client
  - `Connect(ctx)` handles two cases: new device (QR flow, logs QR code) and reconnect (existing session)
  - `AddEventHandler(handler)` wraps raw WA events and filters to `*events.Message` only
  - `Disconnect()` for clean shutdown
- Created `backend-go/internal/whatsapp/sender.go`
  - `Sender` struct wrapping `*whatsmeow.Client`
  - `SendText(ctx, toPhone, text)` constructs a JID and sends `*waE2E.Message{Conversation: proto.String(text)}`
- API fixes applied vs. plan template:
  - `sqlstore.New` requires `ctx context.Context` as first arg (plan had 3-arg form)
  - `GetFirstDevice` requires `ctx context.Context` (plan had no arg)
  - Proto import changed from `go.mau.fi/whatsmeow/binary/proto` to `go.mau.fi/whatsmeow/proto/waE2E` (moved in newer whatsmeow)
  - `SendMessage` uses `*waE2E.Message` not `*waProto.Message`
- Added `go.mau.fi/whatsmeow v0.0.0-20260529101937-a7ea56383ec4` and `github.com/mattn/go-sqlite3 v1.14.44` as direct deps; added `petermattis/goid` and `golang.org/x/exp` as indirect deps
- `CGO_ENABLED=1 go build ./internal/whatsapp/...` passes cleanly
- Committed: `feat(go): add whatsmeow client and text sender`

## Task 15: WhatsApp handler — DONE (2026-05-31)

- Created `backend-go/internal/whatsapp/handler.go`
  - `Handler` struct: references db.Client, engine.Machine, Sender, scheduler.Scheduler, waNumberID
  - `Handle(rawEvt)` — entry point called by WA event loop; ignores outbound messages; routes text vs media; spawns goroutine
  - `processMessage` — main dispatch pipeline:
    1. `rules.CheckEscalation` for keyword fast-path (wiring/admin/none)
    2. `GetOrCreateConversation`
    3. Skip if `conv.State.IsTerminal()`
    4. `InsertMessage(conv.ID, models.SenderCustomer, text)` — triggers Realtime to Sales Inbox
    5. `ListLast10Messages` for history context
    6. `SearchStockByName` for stock context (in STOCK_CHECK or CLARIFYING states)
    7. `machine.Process` — Gemini-backed state machine
    8. Persist: `UpdateCollectedData`, `UpdateLanguage`, `UpdateConversationState`
    9. `handleBooking` if `result.CreateOrder` — creates DB order row, schedules timeout timers
    10. `InsertMessage(models.SenderAI, reply)` + `SendText`
  - `handleWiringEscalation` — escalates to ESCALATED_WIRING state, sends bilingual reply
  - `handleAdminEscalation` — escalates to ESCALATED_ADMIN state, sends bilingual reply
  - `handleMediaMessage` — auto-escalates to ESCALATED_ADMIN for any non-text message
  - `HandleApprovedOrder(ctx, orderID, conversationID, shippingFee)` — called from LISTEN/NOTIFY dispatcher; cancels timer, builds invoice, sends to customer, marks COMPLETED
  - `buildInvoiceMessage` — bilingual (id/en) invoice with itemized list, subtotal, shipping, total, bank transfer details
- All InsertMessage calls use typed `models.MessageSender` enum constants (not string literals)
- `CGO_ENABLED=1 go build ./...` passes cleanly
- Committed: `feat(go): add WA event handler — wires rules, state machine, DB, scheduler`

## Task 16: Rewrite main.go — full daemon — DONE (2026-05-31)

- Overwrote `backend-go/main.go` with full daemon wire-up replacing the flat HTTP stock server
- Initializes in order: DB client, Gemini client, state machine, WhatsApp client + sender, scheduler, WA handler
- Scheduler callbacks look up orders from DB; send WA reminder text; call `MarkReminderSent` and `UpdateConversationState`
- Restores active booking timers on boot via `ListActiveBookings` + `sched.RestoreOnBoot`
- `StartListening` wires two NOTIFY handlers:
  - `OnAdminMessage(conversationID, messageID)` — calls `GetMessageByID` to get full message text, looks up `customer_phone`, forwards via `sender.SendText`
  - `OnOrderApproved` — delegates to `waHandler.HandleApprovedOrder`
- HTTP endpoints: `/api/health`, `/api/wa/status`, `/api/stocks` (GET/POST), `/api/stocks/{sku}` (PUT/DELETE)
- Stock CRUD functions refactored to accept `*db.Client` parameter (was global `*sql.DB`)
- Graceful shutdown on SIGINT/SIGTERM: waits on signal channel, disconnects WA
- `CGO_ENABLED=1 go build ./...` passes cleanly
- Committed: `feat(go): rewrite main.go — wire daemon: WA + Gemini + state machine + scheduler`

## Task 17: React types and supabaseClient additions — DONE (2026-05-31)

- Added `ConversationState` union type (12 values matching Supabase enum) to `src/types.ts`
- Added `DbConversation`, `DbMessage`, `DbOrder` interfaces to `src/types.ts` (DB-aligned, used by Realtime hook)
- Added `import type { DbConversation, DbMessage, DbOrder }` to `src/lib/supabaseClient.ts`
- Added `conversationService` with 6 methods: `fetchConversations`, `fetchMessages`, `insertAdminMessage`, `toggleAiControl`, `uploadChatMedia`, `insertAdminMediaMessage`
- Added `orderService` with 2 methods: `fetchPendingOrders`, `approveOrder`
- `npm run build` passes cleanly — no TypeScript errors
- Committed: `feat(react): add DB-aligned types and conversation/order service methods`

## Task 18: useRealtimeConversations hook — DONE (2026-05-31)

- Created `src/hooks/useRealtimeConversations.ts`
- `ConversationWithMessages` interface extends `DbConversation` with a `messages: DbMessage[]` field
- Hook loads top 20 conversations with messages + pending orders on mount via `Promise.all`
- Subscribes to 4 Supabase Realtime channels:
  - `messages-insert`: appends new messages to the correct conversation in state
  - `conversations-update`: merges updated conversation fields into state
  - `conversations-insert`: fetches messages for new conversation and prepends to state
  - `orders-changes`: handles INSERT (PENDING only) and UPDATE (filter out non-PENDING from state)
- Cleanup function removes all channels on unmount
- Exposes: `conversations`, `orders`, `loading`, `sendAdminMessage`, `sendAdminMedia`, `toggleAiControl`, `approveOrder`
- `sendAdminMedia` maps file extensions to mediaType strings (pdf, image, excel, word, file)
- `npm run build` passes cleanly — no TypeScript errors
- Committed: `feat(react): add useRealtimeConversations hook with Supabase Realtime`

## Task 20: DashboardScreen — add orders panel — DONE (2026-05-31)

- Added `useState` to existing React import in `src/components/DashboardScreen.tsx`
- Added `useRealtimeConversations` import from `../hooks/useRealtimeConversations`
- `Clock` from lucide-react was already imported — no change needed
- Added hook invocation: `const { orders, approveOrder } = useRealtimeConversations()`
- Added `shippingFees` and `approvingId` state, plus `handleApprove` async handler
- Added pending orders panel JSX rendered conditionally when `orders.length > 0`
- Panel shows customer info, itemized order lines, subtotal, expiry, shipping fee input, and approve button
- `npm run build` passes cleanly — no TypeScript errors
- Committed: `feat(react): add pending orders panel to DashboardScreen`

## Task 19: SalesInboxScreen — connect to real data — DONE (2026-05-31)

- Rewrote `src/components/SalesInboxScreen.tsx` to use `useRealtimeConversations` hook instead of mock `chats` prop
- Removed `SalesInboxScreenProps` fields (`chats`, `onChatsUpdate`) — component is now self-contained
- Updated `src/App.tsx`: `<SalesInboxScreen />` rendered with no props; `chats` state retained for `DashboardScreen.chatsCount`
- New component features:
  - Auto-selects first conversation on load
  - Filters: Semua / Butuh Admin / Dikelola AI (maps `conv.state` to status via `stateToStatus`)
  - Search by `customer_phone` or `collected_data.name`
  - `ChatBubble` renders customer / ai / admin / system messages with distinct styles
  - Media attachments rendered as clickable links
  - `handleToggleAi` calls `toggleAiControl` based on current conversation state
  - File upload via hidden `<input type="file">` feeds `sendAdminMedia`
  - Loading state renders "Memuat percakapan..." while hook fetches data
- `npm run build` passes cleanly — no TypeScript errors
- Committed: `feat(react): rewrite SalesInboxScreen — connect to Supabase Realtime`

## Task 21: WhatsappAiScreen — connect to Supabase — DONE (2026-05-31)

- Replaced `DEFAULT_WA_NUMBERS` constant and localStorage-based state init with Supabase fetch from `whatsapp_numbers` table
- Added `loading` state with spinner shown while Supabase fetch is in flight
- Added Realtime `UPDATE` subscription on `whatsapp_numbers` via `supabase.channel('wa-numbers-update')` — live status updates without page reload
- Removed all sandbox simulator state and handlers: `sandboxSelectedId`, `sandboxText`, `sandboxMessages`, `isSandboxAiTyping`, `handleSendSandboxSim`, `generateSmartStockResponse`, `sandboxScrollRef`
- Removed the entire "Sandbox Chat Pelanggan" JSX section (was right column second card)
- Replaced fake QR/pairing simulation with instructional log-output versions pointing users to Go daemon terminal
- Added `handleCheckConnection(numberId)` — calls `http://localhost:8080/api/wa/status`, alerts on connected/disconnected/daemon-not-running
- Added "Cek" status button next to each number in the list
- Toggle handlers now show informational toast pointing to Supabase dashboard (DB is source of truth)
- Removed localStorage save `useEffect`; removed `DEFAULT_WA_NUMBERS` constant; cleaned up unused imports
- `npm run build` passes cleanly — no TypeScript errors
- Committed: `feat(react): connect WhatsappAiScreen to Supabase — remove sandbox, add Realtime status`

## Task 3: TDD rewrite of engine/prompts.go — DONE (2026-06-01)

- Created `backend-go/internal/engine/prompts_test.go` (11 tests)
  - TDD workflow: test file written and confirmed failing (undefined: orBelum, missingFields), then prompts.go rewritten
  - Tests cover: `TestBuildPromptGreeting`, `TestBuildPromptCollectingIncludesCollectedData`, `TestBuildPromptCollectingListsMissingFields`, `TestBuildPromptClarifyingIncludesProductAndSpecs`, `TestBuildPromptStockCheckIncludesStockContext`, `TestBuildPromptConfirmingIncludesOrderSummaryAndBothBoolFields`, `TestStockContextStringEmpty`, `TestStockContextStringWithItems`, `TestOrBelum`, `TestMissingFieldsAllMissing`, `TestMissingFieldsNoneMissing`
  - All 11 tests PASS
- Rewrote `backend-go/internal/engine/prompts.go`:
  - Replaced "Sari" persona English prompts with Calista-branded Indonesian SOP references
  - `BuildPrompt` now returns state-specific JSON format instruction; Calista persona lives in `SystemInstruction` (set in gemini.NewClient), not here
  - State instructions reference SOP Fase 1, Fase 1.5, Fase 2 for consistency with garindo_jaya_panel_AI_prompt.md
  - Added `orBelum(s)` helper — returns "belum diketahui" for empty strings (Indonesian UX)
  - Added `missingFields(c)` helper — lists unfilled `CollectedData` fields in Indonesian labels (nama, perusahaan, alamat, produk)
  - `StockContextString` updated: fallback message in Indonesian, format now includes `(SKU: ...)` and `stok:` labels
  - `formatHistory` updated: fallback message in Indonesian "(belum ada pesan)"
  - `language` parameter retained for API compatibility (used by machine.go caller); not used in body — valid in Go
- `CGO_ENABLED=1 go test ./...` — all tests pass, no regressions
- `CGO_ENABLED=1 go build ./...` — clean build
- Committed: `feat(go): rewrite engine prompts — state-specific JSON format, Calista SOP references`

## Task 2: Update Gemini client to accept system prompt — DONE (2026-06-01)

- Updated `backend-go/internal/gemini/client.go`:
  - Changed `NewClient` signature from `NewClient(ctx, apiKey)` to `NewClient(ctx, apiKey, systemPrompt)`
  - Set `model.SystemInstruction = &genai.Content{Parts: []genai.Part{genai.Text(systemPrompt)}}` at client construction time
  - No changes to `GenerateReply` or `Close` methods
- Updated `backend-go/main.go`:
  - Added `"github.com/username/sinar-elektrik-backend/internal/assets"` import
  - Changed `gemini.NewClient(ctx, cfg.GeminiAPIKey)` to `gemini.NewClient(ctx, cfg.GeminiAPIKey, assets.CalistaSystemPrompt)`
- Verified build: `CGO_ENABLED=1 go build ./...` passes with no errors
- Verified tests: `CGO_ENABLED=1 go test ./...` — all pass; `machine_test.go` mockGemini unaffected by interface-compatible change
- Committed: `feat(go): wire Calista system prompt into Gemini client via SystemInstruction`

## Task 2 (schema migration plan): Expand Go models (types.go) — DONE (2026-06-01)

- Replaced `backend-go/internal/models/types.go` with expanded model definitions
- Removed old `OrderStatusPending` and `OrderStatusApproved` constants; replaced with 10 fine-grained statuses: `PENDING_ADMIN_CONFIRMATION`, `PENDING_PRICE_NEGO`, `PENDING_STOCK_CHECK`, `PENDING_CUSTOM_QUOTE`, `PENDING_WIRING_QUOTE`, `WAITING_PAYMENT`, `PAYMENT_UPLOADED`, `PAYMENT_VERIFIED`, `CANCELLED`, `COMPLETED`
- Added `OrderType` type with 3 constants: `STANDARD`, `CUSTOM_PANEL`, `WIRING_PANEL`
- Added `DeliveryType` type with 2 constants: `PICKUP`, `DELIVERY`
- Added `LeadStatus` type with 5 constants: `NEW`, `IN_PROGRESS`, `ESCALATED`, `ORDERED`, `DROPPED`
- Added `AIActive bool` field to `Conversation` struct
- Expanded `Order` struct with new fields: `GJPOrderID`, `OrderType`, `LeadsID`, `CustomerID`, `DeliveryType`, `PaymentProofURL`, `PaymentVerifiedAt`, `VerifiedBy`
- Added `Customer` struct (id, wa_number, name, company)
- Added `Lead` struct (id, customer_id, conversation_id, wa_number, status, confirmed_order_id)
- Added `BankConfig` struct (id, bank_name, account_number, account_name, is_active)
- `CGO_ENABLED=1 go build ./...` — clean build (no errors)
- `CGO_ENABLED=1 go test ./internal/engine/... ./internal/rules/...` — all tests PASS
- Committed: `feat(go): expand models — new order statuses, order/delivery types, lead status, customer/lead/bankconfig structs` (72837ec)

## Task 1 (schema ID system migration): SQL migration file created — DONE (2026-06-01)

- Created `supabase/migrations/20260601000001_schema_id_system.sql`
- Expands `order_status` enum with 8 new spec-compliant business statuses
- Adds `ai_active boolean` column to `conversations` table (with anon GRANT)
- Creates 3 sequences: `gjp_cust_seq`, `gjp_lead_seq`, `gjp_ord_seq` for GJP ID generation
- Creates `customers` table (id, wa_number, name, company) with RLS + unique constraint
- Creates `leads` table (id, customer_id, conversation_id, wa_number, status) with RLS, indexes, `trg_leads_updated_at` trigger
- Creates `bank_config` table (bank_name, account_number, account_name, is_active) with RLS + `trg_bank_config_updated_at` trigger
- Adds 8 new columns to `orders` table (gjp_order_id, order_type, leads_id, customer_id, delivery_type, payment_proof_url, payment_verified_at, verified_by)
- Enables Supabase Realtime for `customers` and `leads` tables
- All DDL is idempotent (IF NOT EXISTS / DO $$ BEGIN ... END $$)
- Migration NOT applied to Supabase — user applies manually
- Committed: `feat(sql): add schema migration — customers, leads, bank_config, ai_active, order status expansion` (d7c7257)

## Task 3 (schema migration plan): Create DB files — customers, leads, bank_config — DONE (2026-06-01)

- Created `backend-go/internal/db/customers.go`
  - `GetOrCreateCustomer(waNumber)` — INSERT ... ON CONFLICT DO UPDATE so RETURNING always returns a row; ID format: `GJP-CUST-XXXX` (sequence `gjp_cust_seq`)
- Created `backend-go/internal/db/leads.go`
  - `CreateLead(customerID, conversationID, waNumber)` — ID format: `GJP-LEAD-YYYYMMDD-XXXX` (date from DB clock, sequence `gjp_lead_seq`); COALESCE on nullable `confirmed_order_id`
  - `UpdateLeadStatus(leadID, status)` — targeted UPDATE with `updated_at = time.Now()`
- Created `backend-go/internal/db/bank_config.go`
  - `GetActiveBankConfig()` — returns first active row or nil (handles `sql.ErrNoRows` cleanly)
- `CGO_ENABLED=1 go build ./...` — clean build (no errors)
- `CGO_ENABLED=1 go test ./internal/engine/... ./internal/rules/...` — all tests PASS
- Committed: `feat(go): add db layer for customers, leads, bank_config tables` (9d2fbb3)

## Task 4 (schema migration plan): Update conversations.go — DONE (2026-06-01)

_(Previously completed — details in task tracking)_

## Task 5 (schema migration plan): Rewrite orders.go — new columns and PENDING_ADMIN_CONFIRMATION — DONE (2026-06-01)

- Rewrote `backend-go/internal/db/orders.go` (full replacement)
- `CreateOrder` gains 4 new parameters: `leadsID, customerID string, orderType models.OrderType, deliveryType models.DeliveryType`
- Empty string params converted to `nil` for nullable FK columns (leadsID, customerID, deliveryType)
- Default status changed from `'PENDING'` to `'PENDING_ADMIN_CONFIRMATION'`
- INSERT now populates `leads_id`, `customer_id`, `order_type`, `delivery_type` columns
- RETURNING clause expanded to include `gjp_order_id`, `order_type`, `leads_id`, `customer_id`, `delivery_type` (with COALESCE for nullable fields)
- All SELECT queries in `GetOrderByConversation`, `GetOrderByID` updated to include new columns
- `ListActiveBookings` status filter updated from `'PENDING'` to `'PENDING_ADMIN_CONFIRMATION'`
- Added `GetOrderByIDWithPayment` — returns full order including `payment_proof_url`, `payment_verified_at`, `verified_by` for payment verification flow (sub-project C)
- Added `database/sql` import for `sql.NullTime` handling of nullable `payment_verified_at`
- Build check: `CGO_ENABLED=1 go build ./...` — fails only in `handler.go` (CreateOrder arity mismatch, GetOrCreateConversation return mismatch) as expected; no errors in orders.go
- Engine/rules tests: `CGO_ENABLED=1 go test ./internal/engine/... ./internal/rules/...` — all PASS
- Committed: `feat(go): orders.go — new columns, PENDING_ADMIN_CONFIRMATION default, GetOrderByIDWithPayment` (1b3843d)

## Code Review Fix: rows.Scan/rows.Err error handling + UpdateOrderTotal — DONE (2026-06-01)

- Fixed `backend-go/internal/db/conversations.go`: `ListConversationsByPhone` now checks `rows.Scan` error and calls `rows.Err()` after the loop; both return early with the error
- Fixed `backend-go/internal/db/orders.go`: `ListActiveBookings` now checks `rows.Scan` error and calls `rows.Err()` after the loop; both return early with the error
- Added `UpdateOrderTotal(orderID string, total float64) error` to `backend-go/internal/db/orders.go` to write the correct total (subtotal + shipping) back to DB when an order is approved
- Fixed `backend-go/internal/whatsapp/handler.go`: `HandleApprovedOrder` now calls `h.db.UpdateOrderTotal(orderID, total)` immediately after computing `total := order.Subtotal + shippingFee`, before building the invoice message
- `CGO_ENABLED=1 go build ./...` — clean build (no errors)
- `CGO_ENABLED=1 go test ./...` — all tests PASS
- Committed: `fix(go): add rows.Scan/rows.Err error handling; add UpdateOrderTotal for correct invoice total` (881e749)

## Task 1 (C1 Payment Lifecycle plan): Payment flow migration file created — DONE (2026-06-02)

- Created `supabase/migrations/20260602000001_payment_flow.sql`
- Adds `PAYMENT_REJECTED` enum value to `order_status` type
- Creates `wa_recipients` table (id, role, name, wa_number, is_active, created_at) with RLS policy for anon SELECT
- Adds `notify_payment_verified()` trigger function that fires on `orders.status = 'PAYMENT_VERIFIED'` — sends pg_notify payload with order_id and conversation_id to `payment_verified` channel
- Adds `notify_payment_rejected()` trigger function that fires on `orders.status = 'PAYMENT_REJECTED'` — sends pg_notify payload with order_id and conversation_id to `payment_rejected` channel
- All DDL is idempotent (IF NOT EXISTS / DO $$ BEGIN ... END $$)
- Committed: `feat(sql): add payment flow migration — wa_recipients, PAYMENT_REJECTED, payment triggers` (4b39770)
- MANUAL: User must apply this migration in Supabase dashboard SQL Editor
- MANUAL: User must create `payment-proofs` Storage bucket (public) in Supabase dashboard

## Task 2 (C1 Payment Lifecycle plan): Update Go models (types.go) — DONE (2026-06-02)

- Updated `backend-go/internal/models/types.go`
- Added `OrderStatusPaymentRejected OrderStatus = "PAYMENT_REJECTED"` constant to the OrderStatus const block (after `OrderStatusPaymentVerified`)
- Added `WaRecipient` struct at the end of the file (after `BankConfig` struct):
  - Fields: `ID int`, `Role string`, `Name string`, `WANumber string`, `IsActive bool`, `CreatedAt time.Time`
  - All fields have JSON tags matching Supabase `wa_recipients` table column names
- Build check: `CGO_ENABLED=1 go build ./...` — clean (no errors)
- Test check: `CGO_ENABLED=1 go test ./...` — all PASS (internal/engine, internal/rules tests unaffected)
- Committed: `feat(go): add OrderStatusPaymentRejected and WaRecipient model` (d274412)

## Task 3 (C1 Payment Lifecycle plan): Create storage package with tests — DONE (2026-06-02)

- Created `backend-go/internal/storage/supabase_storage_test.go` (TDD: tests first)
  - 3 tests: `TestUploadPaymentProof_Success`, `TestUploadPaymentProof_ServerError`, `TestUploadPaymentProof_DefaultContentType`
  - Test setup: `httptest.NewServer` mocks Supabase Storage API
  - Tests verify: PUT method, Authorization header format, Content-Type header, public URL construction, error handling for 5xx responses
  - All 3 tests PASS
- Created `backend-go/internal/storage/supabase_storage.go` (implementation)
  - `UploadPaymentProof(ctx, supabaseURL, serviceKey, orderID, data, contentType)` — uploads image bytes to Supabase Storage bucket `payment-proofs`
  - Defaults `contentType` to `"image/jpeg"` if empty
  - Constructs filename as `orderID/unixMilliseconds` (unique per upload)
  - Sends PUT request with Bearer token and Content-Type headers
  - Returns permanent public URL on HTTP 2xx, error on 3xx+ or request failure
  - Caller should log error and continue — failed upload must not drop payment flow
  - Error messages wrapped with `storage:` prefix for diagnostic clarity
- Build check: `CGO_ENABLED=1 go build ./...` — clean (no errors)
- Test check: `CGO_ENABLED=1 go test ./internal/storage/... -v` — **3/3 PASS** (0.538s)
- Committed: `feat(go): add storage package — UploadPaymentProof to Supabase Storage` (f25b3fa)

## Task 4 (C1 Payment Lifecycle plan): Create DB files — wa_recipients and payment — DONE (2026-06-02)

- Created `backend-go/internal/db/wa_recipients.go`
  - `GetActiveRecipients()` — returns all active wa_recipients rows scanned into `[]*models.WaRecipient`
  - Called when sending payment notifications and order approval notifications
- Created `backend-go/internal/db/payment.go`
  - `UpdatePaymentProof(orderID, url)` — stores proof URL and advances status to `'PAYMENT_UPLOADED'`
  - `RejectPayment(orderID)` — resets status from `'PAYMENT_REJECTED'` back to `'WAITING_PAYMENT'`
- Build check: `CGO_ENABLED=1 go build ./...` — clean (no errors)
- Test check: `CGO_ENABLED=1 go test ./...` — all PASS (internal/storage, internal/rules, internal/engine all pass)
- Committed: `feat(go): add db layer for wa_recipients, payment proof, and payment rejection` (cbf7fb0)

## Task 5 (C1 Payment Lifecycle plan): Update DB client — new LISTEN/NOTIFY channels — DONE (2026-06-02)

- Updated `backend-go/internal/db/client.go`
- Modified `NotifyHandlers` struct: added `OnPaymentVerified func(orderID, conversationID string)` and `OnPaymentRejected func(orderID, conversationID string)` handlers
- Modified `StartListening` method:
  - Changed from individual `c.listener.Listen` calls to loop: `["admin_messages", "order_approved", "payment_verified", "payment_rejected"]`
  - Added two new case clauses in notification switch: `"payment_verified"` and `"payment_rejected"` with payload unmarshaling and handler dispatch (matching `order_approved` pattern)
  - Updated log message from `"[DB] LISTEN/NOTIFY active on admin_messages, order_approved"` to include all four channels
- Build check: `CGO_ENABLED=1 go build ./...` — clean (no errors)
- Test check: `CGO_ENABLED=1 go test ./...` — all PASS (11 tests in internal/engine, internal/rules, internal/storage all pass)
- Committed: `feat(go): db client — add payment_verified and payment_rejected LISTEN channels` (a666e4a)

## Task 6 (C1 Payment Lifecycle plan): Update config — add SUPABASE_URL and SUPABASE_SERVICE_KEY — DONE (2026-06-02)

- Updated `backend-go/config/config.go`
- Added two new fields to `Config` struct: `SupabaseURL string` and `SupabaseServiceKey string` (after `WAStorePath`)
- Added two new entries to `Load()` function:
  - `SupabaseURL:        getEnv("SUPABASE_URL", "")`
  - `SupabaseServiceKey: getEnv("SUPABASE_SERVICE_KEY", "")`
- Build check: `CGO_ENABLED=1 go build ./...` — clean (no errors)
- Test check: `CGO_ENABLED=1 go test ./...` — all PASS (11 tests in internal/engine, internal/rules, internal/storage; all test files pass)
- Committed: `feat(go): config — add SUPABASE_URL and SUPABASE_SERVICE_KEY` (8310766)

## Task 7 (C1 Payment Lifecycle plan): Update sender — add DownloadMedia — DONE (2026-06-02)

- Updated `backend-go/internal/whatsapp/sender.go`
- Added `DownloadMedia(ctx context.Context, img *waProto.ImageMessage) ([]byte, string, error)` method to Sender struct
- Method calls `s.client.Download(ctx, img)` to fetch image bytes from WhatsApp servers
- Returns raw bytes, MIME type (defaults to "image/jpeg" if missing), and error
- Error wrapping follows package convention: `fmt.Errorf("sender: download media: %w", err)`
- Import `waProto "go.mau.fi/whatsmeow/proto/waE2E"` was already present — no changes needed
- Build check: `CGO_ENABLED=1 go build ./...` — clean (no errors)
- Test check: `CGO_ENABLED=1 go test ./...` — all PASS (11 tests in internal/engine, internal/rules, internal/storage)
- Committed: `feat(go): sender — add DownloadMedia for WA image download` (9af70ca)

## Task 8 (C1 Payment Lifecycle plan): Update handler.go and main.go — DONE (2026-06-02)

- Rewrote `backend-go/internal/whatsapp/handler.go` (full replacement):
  - Added `supabaseURL` and `supabaseServiceKey` fields to `Handler` struct
  - Updated `NewHandler` signature to accept `supabaseURL, supabaseServiceKey string` params
  - Added `"github.com/username/sinar-elektrik-backend/internal/storage"` import
  - `handleMediaMessage` now checks if a `WAITING_PAYMENT` order exists for the conversation before deciding the path:
    - If yes: payment proof flow — calls `DownloadMedia`, `UploadPaymentProof`, `UpdatePaymentProof`, sends ack to customer, sends notification to all active recipients
    - If no: falls through to admin escalation (unchanged previous behavior)
  - `HandleApprovedOrder` rewritten: calls `GetActiveBankConfig` for live bank details, calls `GetActiveRecipients` to notify all admin WA numbers, sets status to `WAITING_PAYMENT` (not `COMPLETED`), sets conversation to `BOOKED` state
  - Added `HandlePaymentVerified(ctx, orderID, conversationID)` — sends confirmation WA to customer, marks order `COMPLETED`, marks conversation `COMPLETED`, updates lead status to `ORDERED`
  - Added `HandlePaymentRejected(ctx, orderID, conversationID)` — sends rejection WA to customer, calls `RejectPayment` (resets order back to `WAITING_PAYMENT` for re-upload)
  - `buildInvoiceMessage` now accepts `*models.BankConfig` param and uses live bank data (with fallback to BCA hardcoded values)
  - `UpdateLanguage` call now checks and logs error (was previously fire-and-forget)
- Updated `backend-go/main.go` (two targeted edits):
  - Edit A: `NewHandler` call updated to pass `cfg.SupabaseURL, cfg.SupabaseServiceKey`
  - Edit B: `StartListening` call extended with `OnPaymentVerified` and `OnPaymentRejected` handler functions
- Build check: `CGO_ENABLED=1 go build ./...` — clean (no errors)
- Test check: `CGO_ENABLED=1 go test ./...` — all PASS (internal/engine, internal/rules, internal/storage all pass)
- Committed: `feat(go): payment lifecycle — proof upload, HandlePaymentVerified, HandlePaymentRejected, fix HandleApprovedOrder`

## Task 4 (C2 Follow-up Scheduler plan): Create db/followup.go — DONE (2026-06-02)

- Created `backend-go/internal/db/followup.go`
- Three DB functions implemented:
  - `GetEligibleForFollowup() ([]*models.Conversation, error)` — returns conversations where Calista has sent >= 1 msg, customer has not replied in 4+ hours, and daily WIB quota (max 2 follow-ups) is not exhausted; filtered by `ai_active = true` and non-terminal states; uses WIB timezone (Asia/Jakarta) for date boundary checks
  - `IncrementFollowup(convID string) error` — records a follow-up send; uses SQL CASE to atomically reset count to 1 if it's a new WIB day, otherwise increment; updates `last_followup_date` to current WIB date
  - `ResetFollowupCounter(convID string) error` — clears follow-up tracking when customer replies; sets `followup_count_today = 0` and `last_followup_date = NULL`
- Build check: `CGO_ENABLED=1 go build ./...` — clean (no errors)
- Test check: `CGO_ENABLED=1 go test ./...` — all PASS (internal/engine, internal/rules, internal/storage, internal/scheduler all pass)
- Committed: `feat(go): add db followup layer — GetEligibleForFollowup, IncrementFollowup, ResetFollowupCounter`

## Task 5 (C2 Follow-up Scheduler plan): Create followup/poller.go with TDD — DONE (2026-06-02)

- Created `backend-go/internal/followup/poller_test.go` (test first, TDD)
  - 7 tests: `TestBuildFollowupMessage_StandardID`, `TestBuildFollowupMessage_StandardEN`, `TestBuildFollowupMessage_BookedID`, `TestBuildFollowupMessage_BookedEN`, `TestIsNewWIBDay_NilIsNewDay`, `TestIsNewWIBDay_YesterdayIsNewDay`, `TestIsNewWIBDay_FarFutureIsNotNewDay`
  - Tests confirmed failing before implementation (build error: undefined symbols)
  - All 7 tests PASS after implementation
- Created `backend-go/internal/followup/poller.go` (implementation)
  - `Poller` struct wraps `*db.Client` and `*whatsapp.Sender`
  - `NewPoller(d, s)` constructor; `Start(ctx)` launches background goroutine ticking every minute
  - `poll(ctx)` fetches eligible conversations, skips those at daily quota (2/day), builds message, calls `SendText`, `InsertMessage`, `IncrementFollowup`
  - Skips DB update on `SendText` failure (no phantom count increment)
  - `isNewWIBDay(t *time.Time)` — returns true if nil or date is before today in WIB; computes today's UTC midnight from WIB now
  - `buildFollowupMessage` dispatches to `standardMessage` or `bookedMessage` by state
  - 4 message variants: standard/booked × id/en, each with 2 counts (total 8 templates)
  - WIB timezone: `time.FixedZone("WIB", 7*3600)` (UTC+7)
- `CGO_ENABLED=1 go build ./...` — clean (no errors)
- `CGO_ENABLED=1 go test ./...` — all PASS (7 new followup tests + all previous tests)
- Committed: `feat(go): add followup poller — polling goroutine and WA message builder`

## Task 6 (C2 Follow-up Scheduler plan): Wire handler.go and main.go — DONE (2026-06-02)

- Updated `backend-go/internal/whatsapp/handler.go`
  - Added `ResetFollowupCounter(conv.ID)` call in `processMessage` immediately after `GetOrCreateConversation` success, before customer record logic
  - Non-fatal: logs error and continues so customer message is never dropped
- Updated `backend-go/main.go`
  - Added import: `"github.com/username/sinar-elektrik-backend/internal/followup"`
  - Added `followup.NewPoller(dbClient, sender).Start(ctx)` after `waClient.AddEventHandler`, before booking timer restore
  - Added `log.Println("[MAIN] Follow-up poller started (1-minute tick)")`
- Bug fix from final review: `GetEligibleForFollowup` was scanning `last_followup_date` into `interface{}` (discarded), causing `conv.LastFollowupDate` to always be nil and `isNewWIBDay` to always return true → always used count=1 messages. Fixed by using `sql.NullTime` with `.Valid` guard (matching pattern in conversations.go).
- Additional fix: in `poll()`, swapped order to `IncrementFollowup` before `InsertMessage` so a failed message log does not allow duplicate sends on next tick.
- `CGO_ENABLED=1 go build ./...` — clean (no errors)
- `CGO_ENABLED=1 go test ./...` — all PASS (7 followup tests + all previous tests)
- Committed: `feat(go): wire follow-up poller — ResetFollowupCounter on reply, start poller in main`
- Committed: `fix(followup): scan last_followup_date as sql.NullTime in GetEligibleForFollowup`

## C2 Follow-up Scheduler — COMPLETE (2026-06-02)

All 6 tasks complete. Feature is fully implemented:
- SQL migration: 3 columns + last_ai_message_at trigger
- Go models: 3 new Conversation fields
- DB layer: conversations.go scan updated; followup.go with 3 functions
- Poller: polling goroutine with WIB quota, 8 message templates (standard/BOOKED × count1/2 × id/en)
- Handler: ResetFollowupCounter on every customer reply
- Main: poller started on boot

## D1-T3: Add payment functions to supabaseClient.ts — DONE (2026-06-02)

- Added 3 methods to `orderService` in `src/lib/supabaseClient.ts`:
  - `fetchPaymentUploadedOrders()` — returns `DbOrder[]` with status = 'PAYMENT_UPLOADED'
  - `verifyPayment(orderId)` — sets status to 'PAYMENT_VERIFIED' and timestamps `payment_verified_at`
  - `rejectPayment(orderId)` — sets status to 'PAYMENT_REJECTED'
- All methods follow existing pattern: check supabase configured, update orders table, throw on error
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `feat(supabase): add fetchPaymentUploadedOrders, verifyPayment, rejectPayment to orderService` (a50be86)

## D2-T1: Fix pending orders panel in DashboardScreen.tsx — DONE (2026-06-02)

- Added `useEffect` to import in `src/components/DashboardScreen.tsx`
- Added `useEffect` that auto-fills `shippingFees[order.id] = '0'` for PICKUP orders when `orders` array changes (prevents falsy-0 blocking approve button)
- Fixed approve button `disabled` condition: replaced `!shippingFees[order.id]` with `shippingFees[order.id] === undefined || shippingFees[order.id] === ''` (correctly allows fee of 0 for pickup)
- Added order ID row under customer name: shows `order.gjp_order_id ?? order.id.slice(0, 8)` in monospace + delivery_type badge (blue "Ambil Sendiri" for PICKUP, amber "Pengiriman" for DELIVERY)
- Made shipping fee input read-only for PICKUP orders: shows static "Rp 0 (Pickup)" text, hides editable input
- `npm run build` — zero TypeScript errors
- Committed: `fix(dashboard): fix pickup approve button, show delivery_type and gjp_order_id on order cards` (a125791)

## D1-T4: Fix useRealtimeConversations hook — DONE (2026-06-02)

- Added `paymentUploadedOrders` state (`useState<DbOrder[]>([])`) alongside `orders`
- Extended `Promise.all` in `load()` to also call `orderService.fetchPaymentUploadedOrders()` and call `setPaymentUploadedOrders(paymentOrders)` after fetch
- Fixed INSERT Realtime handler: now checks `'PENDING_ADMIN_CONFIRMATION'` (adds to `orders`) and `'PAYMENT_UPLOADED'` (adds to `paymentUploadedOrders`); was checking wrong `'PENDING'` status
- Fixed UPDATE Realtime handler: manages both `orders` and `paymentUploadedOrders` lists independently using correct status values (`'PENDING_ADMIN_CONFIRMATION'`, `'PAYMENT_UPLOADED'`)
- Updated `toggleAiControl` wrapper: renamed param from `handOver` to `makeActive` and added explicit `Promise<void>` return type
- Added `verifyPayment(orderId)` wrapper calling `orderService.verifyPayment`
- Added `rejectPayment(orderId)` wrapper calling `orderService.rejectPayment`
- Updated return object to expose `paymentUploadedOrders`, `verifyPayment`, `rejectPayment`
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `fix(hook): add paymentUploadedOrders, fix realtime listeners, expose verifyPayment/rejectPayment` (be7e780)

## D2-T2: Fix DbOrder import in DashboardScreen.tsx — DONE (2026-06-02)

- Fixed `src/components/DashboardScreen.tsx`
- Added static import at top: `import { DbOrder } from '../types';`
- Changed `PaymentVerificationCardProps` interface: `order: import('../types').DbOrder` → `order: DbOrder`
- Replaced dynamic type import with static import for cleaner type checking
- `npm run build` passes cleanly — zero TypeScript errors, successful production build
- Committed: `fix(dashboard): use static DbOrder import in PaymentVerificationCard props` (9274785)
