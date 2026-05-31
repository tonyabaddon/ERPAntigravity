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

## Tasks 19–21: Pending
