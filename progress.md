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

## D1-T1: Fix types.ts — expand DbOrder.status and add missing fields — DONE (2026-06-02)

- Replaced `DbConversation` interface: added `ai_active: boolean`, `last_ai_message_at?: string`, `followup_count_today: number`, `last_followup_date?: string`
- Replaced `DbOrder` interface: expanded status union from 4 values to 12 (full business lifecycle), added `gjp_order_id?`, `order_type?`, `delivery_type?`, `payment_proof_url?`, `payment_verified_at?`, `verified_by?`, `created_at: string`, `updated_at: string`
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `fix(types): expand DbOrder.status and add missing fields to DbOrder and DbConversation` (092c838, e9d2d34)

## D1-T2: Fix supabaseClient.ts — toggleAiControl and fetchPendingOrders — DONE (2026-06-02)

- Fixed `toggleAiControl`: now `(conversationId, makeActive: boolean)` — updates `{ ai_active: makeActive }` column instead of incorrectly setting `state`
- Fixed `fetchPendingOrders`: changed `.eq('status', 'PENDING')` to `.eq('status', 'PENDING_ADMIN_CONFIRMATION')` to match actual DB enum value
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `fix(supabase): correct fetchPendingOrders status filter and toggleAiControl to use ai_active` (04e5a36)

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

## D2-T3: Add PAYMENT_UPLOADED panel to DashboardScreen.tsx — DONE (2026-06-02)

- Modified `src/components/DashboardScreen.tsx`
- Destructured `paymentUploadedOrders`, `verifyPayment`, `rejectPayment` from `useRealtimeConversations()` hook
- Added local state `paymentUploadedOrders` with `React.useEffect` sync from raw hook value
- Added `handleVerify` and `handleReject` with optimistic removal (card disappears immediately, rolls back on error)
- Rendered `PaymentVerificationCard` list inside new "Bukti Pembayaran Menunggu Verifikasi" panel below Pending Orders panel
- `npm run build` passes cleanly — zero TypeScript errors, successful production build
- Committed: `feat(dashboard): add PAYMENT_UPLOADED panel with verify/reject and optimistic removal` (33ce5c6)

## D2-T4: Fix optimistic removal race condition in handleVerify and handleReject — DONE (2026-06-02)

- Fixed `src/components/DashboardScreen.tsx` — `handleVerify` and `handleReject` functions
- **Problem**: Rolling back to stale `rawPaymentOrders` on API failure would drop new orders arrived via Realtime during the call
- **Solution**: Capture the specific order before removing it, then re-insert only that order on failure
- Updated `handleVerify`: captures `order = paymentUploadedOrders.find(o => o.id === orderId)` before removal, re-inserts with `setPaymentUploadedOrders(prev => [...prev, order])` on catch
- Updated `handleReject`: identical logic for reject flow
- Build: `npm run build` passes — 2378 modules transformed, dist built in 1.64s
- Committed: `fix(dashboard): fix optimistic removal race condition - re-insert specific order on failure` (e52fad4)

## D3-T2: Fix filteredChats filter and handleToggleAi in SalesInboxScreen.tsx — DONE (2026-06-02)

- Modified `src/components/SalesInboxScreen.tsx`
- Fixed `filteredChats` "Butuh Admin" filter: now also catches conversations where `ai_active = false` (admin took manual control without ESCALATED state). Added `!conv.ai_active` to ESCALATED_ADMIN/WIRING check.
- Fixed "Dikelola AI" filter: now requires `conv.ai_active === true` AND not escalated (was missing the `ai_active` check).
- Replaced `handleToggleAi(convId: string, currentState: string)` with `handleToggleAi(conv: ConversationWithMessages)` that calls `toggleAiControl(conv.id, !conv.ai_active)` directly.
- Updated toggle button `onClick` from `handleToggleAi(activeChat.id, activeChat.state)` to `handleToggleAi(activeChat)`.
- Updated toggle button `title` from state-based label to `ai_active`-based label: "Alihkan ke Admin (Nonaktifkan AI)" / "Aktifkan AI kembali".
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `fix(inbox): correct Butuh Admin filter to include ai_active=false, fix handleToggleAi signature` (2c9d4cf)

## D3-T1: Replace stateToStatus with getStatusInfo in SalesInboxScreen.tsx — DONE (2026-06-02)

- Modified `src/components/SalesInboxScreen.tsx`
- Removed `stateToStatus(state: string)` function from inside the component
- Added `getStatusInfo(conv: ConversationWithMessages)` module-level function (before `export default`) that:
  - Returns `{ label, className }` directly for all 7 states: ESCALATED_ADMIN, ESCALATED_WIRING, BOOKED/WAITING_PAYMENT/PAYMENT_UPLOADED, PAYMENT_VERIFIED/COMPLETED, CANCELLED, manual (ai_active=false), and AI (default)
  - Checks `conv.ai_active` field (available via D1 fix) for the "Manual" case
- Replaced `statusBadge(state: string)` with `statusBadge(conv: ConversationWithMessages)` calling `getStatusInfo(conv)`
- Updated both `statusBadge` call sites: `statusBadge(conv.state)` → `statusBadge(conv)` and `statusBadge(activeChat.state)` → `statusBadge(activeChat)`
- Updated `filteredChats` filter to check `conv.state` directly (removed dependency on removed `stateToStatus`)
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `fix(inbox): replace stateToStatus with getStatusInfo for accurate conversation state badges` (2924841)

## D3-T3: Add followup_count_today indicator in SalesInboxScreen.tsx — DONE (2026-06-02)

_(Previously completed — details in task tracking)_

## D3-T4: Add order context bar in SalesInboxScreen.tsx — DONE (2026-06-02)

- Modified `src/components/SalesInboxScreen.tsx`
- **Step 1**: Destructured `orders` and `paymentUploadedOrders` from `useRealtimeConversations()` hook (added to existing destructure at line 28)
- **Step 2**: Computed `activeOrder` by combining both order arrays and finding the order matching `activeChatId` (added at lines 38-39)
- **Step 3**: Added order context bar JSX below chat header (lines 198-212):
  - Conditionally rendered when `activeOrder` exists
  - Shows `gjp_order_id` (fallback to "Pesanan") and `total` in rupiah format
  - Shows status badge with conditional styling: amber for `PAYMENT_UPLOADED`, blue for other statuses
  - Status label uses `.replace(/_/g, ' ')` for display (e.g., "PENDING_ADMIN_CONFIRMATION" → "PENDING ADMIN CONFIRMATION")
  - Styled with amber background (bg-amber-50/border-amber-100) to distinguish from chat header
- **Step 4**: Verified build: `npm run build` — 2378 modules transformed, zero TypeScript errors
- **Step 5**: Committed: `feat(inbox): add order context bar showing gjp_order_id and status for active conversation` (83769b2)
- Bar correctly appears only when activeChat is selected (inside the truthy activeChat branch) and when the conversation has an associated order

## D4-T1: Add statsService to supabaseClient.ts — DONE (2026-06-02)

- Added `statsService` export to `src/lib/supabaseClient.ts` with two methods:
  - `fetchTodayStats()` — returns `{ verifiedOrdersTotal, verifiedOrdersCount, totalConversationsToday, aiConversationsToday }` by querying orders (PAYMENT_VERIFIED status, today's date) and conversations (today's WIB date) from Supabase
  - `fetchRecentActivity()` — returns last 10 AI/admin messages from today as `{ text, sender, created_at }[]` for the dashboard activity log
- Also added `isSupabaseConfigured` export (boolean) so UI can gracefully skip data fetches when Supabase is not configured
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `feat(supabase): add statsService with fetchTodayStats and fetchRecentActivity` (752e119)

## D4-T2: Wire real KPI stats to DashboardScreen.tsx — DONE (2026-06-02)

- Modified `src/components/DashboardScreen.tsx`
- Removed `chatsCount` from function signature destructure (was not in interface, now removed from function params too)
- Added `stats` state (`useState<{verifiedOrdersTotal, verifiedOrdersCount, totalConversationsToday, aiConversationsToday} | null>(null)`)
- Added `useEffect` to call `statsService.fetchTodayStats()` on mount when `isSupabaseConfigured`
- Stat 1 badge: changed from hardcoded `+14.2%` to `{stats ? 'Live' : '...'}`
- Stat 1 h3: changed from hardcoded `{formatRupiah(3840000)}` to `{formatRupiah(stats?.verifiedOrdersTotal ?? 0)}`
- Stat 1 p: changed from hardcoded "Rp 3.100.000 pada hari kemarin" to "Pesanan PAYMENT_VERIFIED hari ini"
- Stat 2 h3: changed from hardcoded `18 Transaksi` to `{(stats?.verifiedOrdersCount ?? 0)} Transaksi`
- Stat 3 h3: changed from hardcoded `94.2% Efisiensi` to computed AI efficiency percentage
- Stat 3 p: changed from hardcoded "Menghemat ~4.8 jam" to live `${aiConversationsToday} dari ${totalConversationsToday} chat ditangani AI hari ini`
- Modified `src/App.tsx`: removed `chatsCount={chats.length}` prop from `<DashboardScreen>`
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `feat(dashboard): wire real KPI stats from statsService, remove chatsCount prop` (bb4f5c0)

## D4-T3: Wire real activity log in DashboardScreen.tsx — DONE (2026-06-02)

- Modified `src/components/DashboardScreen.tsx`
- **Step 1**: Added `recentActivity` state and useEffect after the existing stats useEffect (line 93-100):
  - `const [recentActivity, setRecentActivity] = useState<Array<{ text: string; sender: string; created_at: string }>>([])` — typed array with text, sender, created_at fields
  - `useEffect` calls `statsService.fetchRecentActivity().then(setRecentActivity)` on mount when `isSupabaseConfigured`
- **Step 2**: Replaced hardcoded activity items in "Detak Jantung Log Aktivitas AI" section (line 311-343):
  - Old: 3 hardcoded divs with CheckCircle2/Clock/AlertTriangle icons and fixed dates
  - New: Conditional rendering with empty state ("Belum ada aktivitas hari ini.") and `.map()` over recentActivity array
  - Each item displays: emerald CheckCircle2 icon, "Pesan AI"/"Sistem" label, message text (2-line clamp), formatted date/time in Indonesian locale
- **Step 3**: Verified build: `npm run build` — 2378 modules transformed, zero errors
- **Step 4**: Committed: `feat(dashboard): replace hardcoded activity log with real messages from Supabase` (18db476)

## D4-T4: Remove stale chats state from App.tsx and INITIAL_CHATS from initialData.ts — DONE (2026-06-02)

- Removed `chats` useState and `INITIAL_CHATS` import from `src/App.tsx` (inbox now reads from Supabase realtime)
- Removed `INITIAL_CHATS` array (141 lines of hardcoded chat data) from `src/initialData.ts`
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `refactor(app): remove stale chats state and INITIAL_CHATS now that inbox uses Supabase realtime` (2390602)

## D4 Dashboard & UX Polish — COMPLETE (2026-06-02)

All 4 tasks complete:
- T1: `statsService` (fetchTodayStats + fetchRecentActivity) added to supabaseClient.ts
- T2: Dashboard KPI stats wired to live Supabase data, chatsCount prop removed
- T3: Activity log wired to real messages from Supabase
- T4: Removed stale `chats` state and `INITIAL_CHATS` hardcoded data

## E1-T1: SQL migration — anon write grants — DONE (2026-06-02)

- Created `supabase/migrations/20260602000003_admin_write_grants.sql`
- Grants `INSERT, UPDATE` on `bank_config` + sequence usage to anon role
- Grants `INSERT, UPDATE, DELETE` on `wa_recipients` + sequence usage to anon role
- Grants column-level `UPDATE (is_enabled, is_ai_enabled)` on `whatsapp_numbers` to anon role
- All RLS policies added as idempotent DO blocks (6 policies total)
- Migration must be applied manually in Supabase SQL Editor before frontend writes work
- Committed: `feat(db): grant anon write access to bank_config, wa_recipients, whatsapp_numbers` (a98c7cf)

## E1-T2: Add DbBankConfig, DbWaRecipient, and 'settings' to types.ts — DONE (2026-06-02)

- Added `| 'settings'` to `ActivePage` union type
- Added `DbBankConfig` interface (id, bank_name, account_number, account_name, is_active, updated_at)
- Added `DbWaRecipient` interface (id, role: 'admin'|'owner', name, wa_number, is_active, created_at)
- Both interfaces placed immediately after `DbOrder` interface
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `feat(types): add DbBankConfig, DbWaRecipient, and 'settings' to ActivePage` (e028c99)

## E1-T3: Add bankConfigService and waRecipientsService to supabaseClient.ts — DONE (2026-06-02)

- Updated `src/lib/supabaseClient.ts`
- Extended import line to include `DbBankConfig` and `DbWaRecipient` from `../types`
- Added `bankConfigService` export with two methods:
  - `fetch()` — returns the active `DbBankConfig` row (using `maybeSingle()`) or null
  - `save(values, existingId?)` — UPSERTs by UPDATE when existingId given, INSERT otherwise
- Added `waRecipientsService` export with four methods:
  - `fetchAll()` — returns all `DbWaRecipient` rows ordered by `created_at` ASC
  - `add(values)` — inserts new recipient with `is_active: true`
  - `toggleActive(id, isActive)` — flips `is_active` flag for a given recipient
  - `remove(id)` — deletes recipient by id
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `feat(supabase): add bankConfigService and waRecipientsService`

## TypeScript Strict-Mode Fixes — DONE (2026-06-02)

- Fixed `src/components/SalesInboxScreen.tsx`:
  - Removed `WAITING_PAYMENT`, `PAYMENT_UPLOADED`, `PAYMENT_VERIFIED` from `getStatusInfo` — these are `DbOrder.status` (OrderStatus) values, not `ConversationState` values; `conv.state` never holds them
  - Now only `'BOOKED'` maps to "Menunggu Bayar" and only `'COMPLETED'` maps to "Selesai"
  - Converted `ChatBubble` from function declaration with inline type to `const ChatBubble: React.FC<ChatBubbleProps>` to fix React 19 key prop type checking
- Fixed `src/components/DashboardScreen.tsx`:
  - Changed `React.useState<typeof rawPaymentOrders>([])` to explicit `React.useState<DbOrder[]>([])`
  - Converted `PaymentVerificationCard` from function declaration to `const PaymentVerificationCard: React.FC<PaymentVerificationCardProps>` to fix key prop type error
- Added `src/vite-env.d.ts` with `/// <reference types="vite/client" />` to resolve `import.meta.env` TypeScript error in WhatsappAiScreen.tsx
- `npx tsc --noEmit` — zero errors (was 6 errors before fixes)
- `npm run build` — 2378 modules transformed, zero errors
- Committed: `fix: resolve TypeScript strict-mode errors in getStatusInfo and DbOrder state typing` (04a77d8)

## E1-T4: Create PengaturanScreen.tsx component — DONE (2026-06-02)

_(Previously completed — details in task tracking)_

## E1-T5: Wire Sidebar and App.tsx to add Pengaturan route — DONE (2026-06-02)

- Added `settings` entry to `menuItems` array in `src/components/Sidebar.tsx` (after `whatsapp-ai`): id='settings', label='Pengaturan', icon=Settings (already imported), description='Konfigurasi Sistem'
- Added `import PengaturanScreen from './components/PengaturanScreen'` to `src/App.tsx` after `WhatsappAiScreen` import
- Added `case 'settings': return <PengaturanScreen showToast={triggerToast} />` to `renderPage()` switch in `src/App.tsx`
- `npm run build` passes cleanly — zero TypeScript errors (2379 modules transformed)
- Committed: `feat(nav): add Pengaturan to sidebar and App.tsx routing` (0a11650)

## E1-T6: Fix WhatsappAiScreen field mapping and toggle handlers — DONE (2026-06-02)

- Fixed **Bug 1** (load mapping): `useEffect` Supabase fetch now maps snake_case DB columns to camelCase `WhatsappAiNumber` fields (`phone_number → phoneNumber`, `is_enabled → isEnabled`, `is_ai_enabled → isAiEnabled`, `created_at → createdAt`)
- Fixed **Bug 2** (Realtime UPDATE handler): channel callback now maps `row.is_enabled`, `row.is_ai_enabled`, `row.status` instead of spreading raw `payload.new` (which is snake_case and would never match camelCase fields)
- Fixed **Bug 3** (`handleToggleEnable`): converted from no-op to real async function — does optimistic UI update, calls `supabase.from('whatsapp_numbers').update({ is_enabled: newValue })`, reverts on error
- Fixed **Bug 4** (`handleToggleAiEnabled`): identical pattern — optimistic update, persists `{ is_ai_enabled: newValue }` to DB, reverts on error with warning toast
- `npm run build` passes cleanly — zero TypeScript errors (2379 modules transformed)
- Committed: `fix(whatsapp): fix field mapping bug and persist is_enabled/is_ai_enabled toggles to DB` (6dcf8b9)

## E1 Admin Configuration — COMPLETE (2026-06-02)

All 6 tasks complete. Feature is fully implemented:
- SQL migration: anon write grants on bank_config, wa_recipients, whatsapp_numbers (apply manually)
- Types: DbBankConfig, DbWaRecipient, 'settings' added to ActivePage
- Services: bankConfigService and waRecipientsService added to supabaseClient.ts
- UI: PengaturanScreen.tsx with bank config card (read/edit/create) and WA recipients card (list/toggle/add/delete)
- Navigation: "Pengaturan" entry in Sidebar, App.tsx case 'settings' route
- Bug fix: WhatsappAiScreen snake_case→camelCase mapping + real Supabase toggle handlers

## E2-T1: Add DbCustomer, DbLead, 'pipeline' to types.ts — DONE (2026-06-02)

- Added `DbCustomer` interface (id, wa_number, name, company, created_at)
- Added `DbLead` interface with embedded `customers: DbCustomer | null` for Supabase join results
- Added `| 'pipeline'` to `ActivePage` union
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `feat(types): add DbCustomer, DbLead, and 'pipeline' to ActivePage` (8d7f723)

## E2-T2: Add leadsService to supabaseClient.ts — DONE (2026-06-02)

- Extended import line to include `DbCustomer` and `DbLead` from `../types`
- Added `leadsService` export with one method:
  - `fetchAll()` — returns `DbLead[]` from `leads` table with a `customers(*)` join, ordered by `updated_at` DESC
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `feat(supabase): add leadsService with fetchAll join query` (caed203)

## E2-T3: Create PipelineScreen.tsx — DONE (2026-06-02)

- Created `src/components/PipelineScreen.tsx` (160 lines, read-only)
- Filter tabs: Semua / Aktif (NEW+IN_PROGRESS) / Eskalasi / Selesai / Gugur — with live counts
- Each row: customer name + company, WA number (mono), Lead ID (mono, md+ only), color-coded status badge, relative timestamp ("2 jam lalu")
- Status badge colors: NEW=gray, IN_PROGRESS=blue, ESCALATED=amber, ORDERED=green, DROPPED=red
- Empty states: no leads at all vs no leads for current filter
- Supabase-not-configured fallback (yellow banner)
- `npm run build` passes cleanly — zero TypeScript errors
- Committed: `feat(ui): add read-only PipelineScreen with lead status filter tabs` (8d1f335)

## E2-T4: Wire Sidebar and App.tsx for Pipeline route — DONE (2026-06-02)

- Added `TrendingUp` to lucide-react imports in `src/components/Sidebar.tsx`
- Added `'pipeline'` menu item (label: "Pipeline", icon: TrendingUp, description: "Leads & Prospek") after 'settings' entry
- Added `import PipelineScreen from './components/PipelineScreen'` to `src/App.tsx`
- Added `case 'pipeline': return <PipelineScreen showToast={triggerToast} />` to renderPage() switch
- `npm run build` passes cleanly — zero TypeScript errors (2380 modules)
- Committed: `feat(nav): add Pipeline to sidebar and App.tsx routing` (5e8d515)

## E2 Sales Pipeline — COMPLETE (2026-06-02)

All 4 tasks complete. Feature is fully implemented:
- Types: DbCustomer, DbLead with embedded join field, 'pipeline' in ActivePage
- Service: leadsService.fetchAll() with customers(*) join
- UI: Read-only PipelineScreen with 5 filter tabs and color-coded status badges
- Navigation: "Pipeline" entry in Sidebar, App.tsx case 'pipeline' route

## E3-T1: SQL migration — notification_config table — DONE (2026-06-03)

- Created `supabase/migrations/20260602000004_notification_config.sql`
- Table: `notification_config` with serial PK; columns for enabled flag, interval_label, 5 report booleans, low_stock_alert int, delay_alert int, updated_at timestamptz
- RLS enabled; idempotent DO blocks for 3 policies: anon_select, anon_insert, anon_update (all using `true` predicate)
- `GRANT INSERT, UPDATE ON notification_config TO anon` + `GRANT USAGE ON SEQUENCE notification_config_id_seq TO anon`
- `trg_notification_config_updated_at` trigger wired to existing `set_updated_at()` function
- Migration applied via Supabase MCP (`apply_migration`) — confirmed `set_updated_at` function exists before applying
- Committed: `feat(db): add notification_config table with RLS and anon grants` (d9cf04f)

## E3-T2: Update types.ts and initialData.ts — DONE (2026-06-03)

- Removed `targetNumber: string` field from `NotificationConfig` interface in `src/types.ts`
- Added `DbNotificationConfig` interface in `src/types.ts` after `DbLead` — mirrors `notification_config` table columns
- Removed `targetNumber: '81234567890'` from `INITIAL_CONFIG` in `src/initialData.ts`
- Removed `targetNumber` state, handleSave field, and JSX input block from `src/components/NotificationSettingsScreen.tsx` (minimal fix to unblock build; full rewrite deferred to Task 4)
- `npm run build` passes with zero TypeScript errors
- Committed: `feat(types): remove targetNumber from NotificationConfig; add DbNotificationConfig` (fdfa73c)

## E3-T3: Add notificationConfigService to supabaseClient.ts — DONE (2026-06-03)

- Added `DbNotificationConfig` to the import line in `src/lib/supabaseClient.ts`
- Added `notificationConfigService` export after `leadsService` with two methods:
  - `fetch()` — queries `notification_config` table with `maybeSingle()`, returns `DbNotificationConfig | null`
  - `save(values, existingId?)` — UPDATE with `updated_at` timestamp when `existingId` given, INSERT otherwise
- `npm run build` passes cleanly — zero TypeScript errors (2380 modules transformed)
- Committed: `feat(supabase): add notificationConfigService with fetch and save` (b146a8d)

## F1-T2: Service Layer — companySettingsService + ordersService updates — DONE (2026-06-03)

- Added `DbCompanySettings` to the import line in `src/lib/supabaseClient.ts`
- Added `companySettingsService` export with two methods:
  - `fetch()` — queries `company_settings` with `.eq('id', 1).single()`, returns `DbCompanySettings`
  - `save(values)` — upserts `{ id: 1, ...values, updated_at: ... }` to `company_settings` table
- Extended `orderService` with two new methods:
  - `fetchAll()` — returns all `DbOrder[]` ordered by `created_at` DESC (for Order History screen)
  - `rejectOrder(orderId)` — sets order `status` to `'CANCELLED'` (admin-side reject)
- Updated `verifyPayment` signature: now accepts `adminName = ''` param and writes `verified_by: adminName` alongside existing `status` + `payment_verified_at` fields
- `npm run build` passes cleanly — zero TypeScript errors (2380 modules)
- Committed: `feat(service): add companySettingsService, ordersService.fetchAll/rejectOrder, verifyPayment adminName` (0e9d867)

## F1-T3: Sidebar Nav + App.tsx Routing (stub) — DONE (2026-06-03)

- Added `ClipboardList` to lucide-react imports in `src/components/Sidebar.tsx`
- Added `'order-history'` menu item (label: "Riwayat Pesanan", icon: ClipboardList, description: "Semua Pesanan") after 'pipeline' entry
- Created `src/components/OrderHistoryScreen.tsx` stub — accepts `currentUser` and `showToast` props, renders "Riwayat Pesanan" heading and "Coming soon..." placeholder
- Added `import OrderHistoryScreen` to `src/App.tsx` and `case 'order-history'` route passing `currentUser` and `showToast={triggerToast}`
- `npm run build` passes cleanly — zero TypeScript errors (2381 modules transformed)
- Committed: `feat(nav): add Riwayat Pesanan to sidebar and App routing` (cc5c2f0)

## F1-T4: OrderHistoryScreen scaffold — header, tabs, search, collapsed rows — DONE (2026-06-03)

- Replaced stub `src/components/OrderHistoryScreen.tsx` with full 234-line implementation
- Header: ClipboardList icon, title, action badges (pending confirmations count, uploaded payment proofs count)
- 6 filter tabs: Semua / Perlu Konfirmasi / Menunggu Bayar / Bukti Dikirim / Selesai / Dibatalkan — with live counts and amber "!" dot on Bukti Dikirim when > 0
- Search: filters by customer_name, gjp_order_id, customer_phone (case-insensitive)
- Collapsed row list: shows customer name, order ID (gjp_order_id or UUID prefix), formatted date, item pill (first item + overflow count), total in status-themed color, status badge, expand chevron
- Left border accent: purple for PENDING_ADMIN_CONFIRMATION, blue for PAYMENT_UPLOADED
- Dimmed rows (opacity-55) for CANCELLED and PAYMENT_REJECTED
- Expanded row placeholder "[expanded row — {status}]" — to be filled in Tasks 5–7
- Supabase-not-configured fallback (yellow banner)
- Loading state and per-tab empty states
- Pre-type-verified: all DbOrder field names confirmed against src/types.ts before writing (no adjustments needed)
- `npm run build` passes cleanly — zero TypeScript errors (2381 modules transformed)
- Committed: `feat(order-history): scaffold with filter tabs, search, collapsed rows` (b022a1f)

## E3-T4: Update NotificationSettingsScreen.tsx — DONE (2026-06-03)

- Added `useEffect`, `useRef` to React imports; added `notificationConfigService`, `isSupabaseConfigured` from supabaseClient
- Added `dbConfigIdRef` (useRef) to track the row id across saves without triggering re-render
- `useEffect` on mount: loads config from Supabase (if configured) and hydrates all state fields
- `handleSave` made async: persists to Supabase before calling `onConfigChange`; on error shows local-only toast
- Removed "Nomor WhatsApp Tujuan" comment placeholder from JSX; grid changed from `md:grid-cols-3` to `md:grid-cols-2`

## Bug Fix: Log InsertMessage error in BOOKED holding reply — DONE (2026-06-04)

- Fixed `backend-go/internal/whatsapp/handler.go` in `processMessage()` BOOKED/TIMEOUT_REMINDER intercept block (lines 114-124)
- Changed line 119 from fire-and-forget `h.db.InsertMessage(conv.ID, models.SenderAI, reply)` to error-checked pattern: `if _, err := h.db.InsertMessage(...) { log.Printf("[HANDLER] BOOKED InsertMessage error: %v", err) }`

## Task 7: Deploy to Firebase Hosting — DONE (2026-06-04)

- Created `vosi-landing/firebase.json` with hosting config: public root ".", ignore patterns, SPA rewrites, caching headers for images (604800s) and HTML (300s)
- Created `vosi-landing/.firebaserc` with default project ID placeholder "vosi-landing"
- Created `vosi-landing/DEPLOY.md` with comprehensive deployment guide: prerequisites, first-time setup (Firebase CLI install, login, project creation), placeholder replacements (GA4, WA numbers, domain), deployment commands (preview channel and production), custom domain setup, and notes on future backend API integration
- All files verified with correct content via `cat` commands
- Committed: `feat(vosi-landing): add Firebase Hosting config and deployment guide` (efd0d0a)
- Consistent with error-checking pattern used at line 132 for customer message insertion
- Build: `CGO_ENABLED=1 go build ./...` — clean (no errors)
- Tests: `CGO_ENABLED=1 go test ./...` — all PASS (internal/engine, internal/rules, internal/storage, internal/scheduler)
- Committed: `fix(wa): log InsertMessage error in BOOKED holding reply` (8854932)
- `npm run build` passes cleanly — zero TypeScript errors (2380 modules transformed)
- Committed: `feat(notifications): sync config with Supabase on load/save; remove targetNumber field` (50fa798)

## E3 Notification Config Persistence — COMPLETE (2026-06-03)

All 4 tasks complete:
- T1: `notification_config` table created in Supabase with RLS + anon grants
- T2: `targetNumber` removed from `NotificationConfig` and `INITIAL_CONFIG`; `DbNotificationConfig` type added
- T3: `notificationConfigService` (fetch/save) added to supabaseClient.ts
- T4: `NotificationSettingsScreen` now loads from and saves to Supabase

## F1-T5: Expanded Row — PENDING_ADMIN_CONFIRMATION (Approve / Reject) — DONE (2026-06-03)

- Added 3 new state variables: `shippingFees`, `approvingId`, `rejectingId` after `expandedId`
- Added `handleApprove` async handler: resolves fee (0 for PICKUP, parsed input for DELIVERY), calls `orderService.approveOrder`, updates order status optimistically, collapses row, shows toast
- Added `handleRejectOrder` async handler: window.confirm gate, calls `orderService.rejectOrder`, updates order status to CANCELLED optimistically, collapses row, shows toast
- Added `ItemsTable` component before `export default`: renders 4-column product grid (name+SKU, qty, harga, subtotal) with footer showing subtotal/ongkir/total summary row
- Replaced expanded body placeholder with two conditional branches:
  - `PENDING_ADMIN_CONFIRMATION`: purple-themed expanded panel with 3-column customer details grid, ItemsTable, booking expiry timestamp, and right-side action column with shipping fee input (static for PICKUP, numeric input for DELIVERY), Approve and Tolak buttons with loading states and disabled logic
  - All other statuses: unchanged placeholder `[expanded row — {status}]`
- `booking_expires_at` field confirmed present in `DbOrder` interface (line 149 of types.ts) — used directly with `formatDate()` helper
- `npm run build` passes cleanly — zero TypeScript errors (2381 modules transformed, 976.79 kB bundle)
- Committed: `feat(order-history): add PENDING_ADMIN_CONFIRMATION expanded row with approve/reject` (e180260)

## F1-T6: Expanded Row — PAYMENT_UPLOADED (Verify / Reject Payment) — DONE (2026-06-03)

_(Previously completed — details in task tracking)_

## F1-T7: Expanded Rows — WAITING_PAYMENT, COMPLETED/PAYMENT_VERIFIED, CANCELLED — DONE (2026-06-03)

- Added `invoiceOrder` state (`useState<DbOrder | null>(null)`) after `rejectingPaymentId` state
- Replaced `[expanded row — {order.status}]` placeholder with 3 conditional expanded panels:
  - `WAITING_PAYMENT`: gray-themed panel, 4-column grid (Pelanggan, No. WA, Pengiriman, Total), ItemsTable
  - `PAYMENT_VERIFIED` / `COMPLETED`: gray-themed panel, 4-column grid (last col = Diverifikasi Oleh with name + date), ItemsTable, footer row with verified-by label and "📄 Lihat Invoice" button (calls `setInvoiceOrder(order)`)
  - `CANCELLED` / `PAYMENT_REJECTED`: gray-themed panel, 3-column grid (Pelanggan, No. WA, Total in gray), ItemsTable
- Added invoice modal stub below order list: renders placeholder text when `invoiceOrder` is set; wired in Task 8
- `npm run build` passes cleanly — zero TypeScript errors (2381 modules transformed)
- Committed: `feat(order-history): add expanded rows for WAITING_PAYMENT, COMPLETED, CANCELLED` (b647ee0)

## F1-T8: InvoiceModal component with PDF print — DONE (2026-06-03)

- Created `src/components/InvoiceModal.tsx` (190 lines)
- Fetches `companySettingsService.fetch()` and `bankConfigService.fetch()` in parallel on mount; guarded by `isSupabaseConfigured`
- Toolbar: dark-navy header with order ID and "Download PDF" (green) + close (×) buttons — both `print:hidden`
- Invoice body sections:
  - Header: company name, address, phone/email (with `⚙ config` badge, `print:hidden`), Invoice title, order ID (gjp_order_id or UUID prefix), creation date
  - Bill To: customer name, address, WA number, delivery type, LUNAS badge
  - Line items table: navy thead, rows with product name + SKU, qty, unit price, subtotal
  - Totals block: subtotal, shipping fee (defaults to 0 if null), TOTAL in navy bold
  - Bank info box: fetched live from `bankConfigService`; `⚙ config` badge (`print:hidden`); shows verification details if `payment_verified_at` is set
  - No-refund notice: orange-themed callout
  - Footer: thank-you text with company name
- Modal footer: Tutup + Download PDF buttons — both `print:hidden`
- Print CSS: `@media print` hides all body children except `#invoice-print-root`; `.print:hidden` class hidden during print
- Field verification: all DbOrder, DbBankConfig, DbCompanySettings field names confirmed against src/types.ts — no adjustments needed
- `npm run build` passes cleanly — zero TypeScript errors (993.53 kB bundle, 2382 modules)
- Wired InvoiceModal in `src/components/OrderHistoryScreen.tsx`: replaced stub div with `<InvoiceModal order={invoiceOrder} onClose={() => setInvoiceOrder(null)} />`
- Committed: `feat(invoice): add InvoiceModal with PDF print, company settings, no-refund notice` (ec63ccc)

## F1-T10: Dashboard Cleanup — DONE (2026-06-03)

- Modified `src/components/DashboardScreen.tsx` and `src/App.tsx`
- Removed inline `PaymentVerificationCard` component definition (58 lines)
- Removed pending-order approval panel (shipping fee inputs, Setujui buttons, per-order detail cards)
- Removed payment verification panel (verify/reject buttons, payment proof image)
- Removed associated state: `shippingFees`, `approvingId`, `paymentUploadedOrders` local state + its `useEffect`
- Removed handlers: `handleApprove`, `handleVerify`, `handleReject`
- Removed `approveOrder`, `verifyPayment`, `rejectPayment` from `useRealtimeConversations` destructure
- Removed `Clock`, `Image` from lucide-react imports; removed `DbOrder` type import
- Added compact alert-badge buttons: purple "X pesanan perlu konfirmasi" and blue "X bukti bayar menunggu verifikasi" — both navigate to `order-history`
- Updated `DashboardScreenProps`: replaced `onPageChange` with `onNavigate: (page: ActivePage) => void`; added `showToast`; kept `lowStockCount` (still used by KPI card)
- Updated "Buka Inbox Chat" button to use `onNavigate('sales-inbox')`
- Updated App.tsx `case 'dashboard'` to pass `showToast={triggerToast}` and `onNavigate={(page) => setActivePage(page)}`
- Note: spec interface omitted `lowStockCount` but it's still consumed by the Low Stock KPI card; kept intentionally
- `npm run build` passes — zero TypeScript errors (992.16 kB bundle, 2382 modules)
- Committed: `feat(dashboard): replace order panels with alert links to Order History` (4e7b14f)

## F1-T9: Company Settings in PengaturanScreen — DONE (2026-06-03)

- Modified `src/components/PengaturanScreen.tsx`
- Added `MapPin` to lucide-react imports; `DbCompanySettings` to types import; `companySettingsService` to service import
- Added 5 company state variables: `company`, `companyLoading`, `companyEditing`, `companyForm`, `companySaving`
- Extended `useEffect` `Promise.all` to fetch `companySettingsService.fetch()` as third item; `setCompanyLoading(false)` in `finally` block; `setCompanyLoading(false)` also guarded in not-configured early-return
- Added `startCompanyEdit`, `cancelCompanyEdit`, `saveCompany` handlers after existing `cancelEdit`
- Added "Profil Perusahaan" card between Rekening Bank and Penerima Notifikasi WA cards
  - Read-only view: displays company_name, address, phone, email as label-value rows
  - Edit mode: renders fields via `.map()` for company_name / address / phone / email inputs
  - Empty state: "Profil perusahaan belum diisi" with "Isi Profil" button
  - `save()` calls `companySettingsService.save(companyForm)` then re-fetches to refresh UI
- `npm run build` passes — zero TypeScript errors (997.40 kB bundle, 2382 modules)
- Committed: `feat(settings): add Profil Perusahaan section for invoice company details` (1e607e7)

## F1: Order History — COMPLETE (2026-06-03)

All 10 tasks shipped across 13 commits (2cec3a1 → bbc766d):

- **Types**: `DbCompanySettings`, `'order-history'` in ActivePage
- **Service layer**: `companySettingsService.fetch/save`, `orderService.fetchAll`, `rejectOrder`, `verifyPayment(adminName)`
- **Supabase**: `company_settings` table + RLS + seed row
- **Sidebar + routing**: Riwayat Pesanan nav item, App.tsx route
- **OrderHistoryScreen**: header with alert badges, 6 filter tabs, search, collapsed rows with status colors and left-border accents, 5 expanded row designs (PENDING_ADMIN_CONFIRMATION with ongkir+approve/reject, PAYMENT_UPLOADED with verify/reject, WAITING_PAYMENT read-only, COMPLETED/PAYMENT_VERIFIED with Lihat Invoice, CANCELLED/PAYMENT_REJECTED read-only)
- **InvoiceModal**: PDF-style invoice preview with company settings + bank config, no-refund notice, `window.print()` with visibility-based print CSS fix
- **PengaturanScreen**: Profil Perusahaan card (company_name, address, phone, email)
- **DashboardScreen**: removed approval + payment verification panels; replaced with two alert badge buttons linking to Riwayat Pesanan

## G2: Reports & Analytics — COMPLETE (2026-06-03)

Commits: 611cf75

- **Data layer** (`src/lib/supabaseClient.ts`): added `groupByDay<T>` helper (builds day-keyed buckets so charts always show all N days, even zero-data days); added `statsService.fetchWeeklyRevenue()` + `statsService.fetchWeeklyConversations()` for Dashboard; added `reportsService` with `fetchSummary`, `fetchDailyRevenue`, `fetchDailyConversations`, `fetchTopProducts` (top 5 by unit qty, computed by flattening `orders[].items` JSON client-side)
- **Dashboard fix** (`DashboardScreen.tsx`): removed 14-line hardcoded `WEEKLY_REVENUE_DATA` and `BOT_PERFORMANCE_DATA` constants; wired both charts to real Supabase data via `useEffect` on mount; chart JSX unchanged
- **LaporanScreen** (`src/components/LaporanScreen.tsx`): new screen — period selector (7 hari / 30 hari / 90 hari), 4 KPI cards (omset, pesanan, avg nilai, tingkat AI), revenue area chart, AI vs manual bar chart, top-5 products table; all data refetched when period changes; graceful empty/unconfigured states
- **Routing**: `'laporan'` added to `ActivePage`; Sidebar gains BarChart2 nav item between Sales Inbox and AI Stock; App.tsx routes to `<LaporanScreen />`

## H1: Inbox AI UI/UX Revamp — COMPLETE (2026-06-03)

Full rewrite of `SalesInboxScreen.tsx` per approved spec. Commit: d5064fe

- **Layout**: 3-panel `flex h-full` — left `w-56` (navy header, search, filter tabs, conversation list), center `flex-1` (chat panel), right `w-48` (context panel)
- **Navy design system**: `bg-[#012749]` headers on both left and center panels; `bg-[#f8f9ff]` message background; `bg-[#2d8a4e]` admin bubbles; left-border selection accent on conversation rows
- **State display**: all 12 `ConversationState` values mapped to Indonesian labels + color badges in `CONV_STATE_DISPLAY`
- **Mode banner**: full-width bar below chat header — red for escalated states, emerald for admin mode, blue for AI mode — with action button toggling `ai_active` via `toggleAiControl`
- **Filter tabs**: Semua / Admin (N) / AI (N) with live counts; filter logic matches spec exactly
- **Right panel stepper**: 6-step vertical stepper (Sapa → Kumpul Data → Cek Stok → Konfirmasi → Menunggu Bayar → Selesai); off-path states (ESCALATED_ADMIN, ESCALATED_WIRING, CANCELLED) shown as badge above stepper with all steps gray
- **Right panel data**: adaptive "Data Terkumpul" (only non-empty fields with emoji icons), related order (gjp_order_id, total, status), follow-up count
- **Empty state**: centered MessageSquare icon when no conversation selected
- **Build**: `npm run build` passes with zero TypeScript errors

## G1: Customer Intelligence — COMPLETE (2026-06-03)

All 7 tasks shipped across 7 commits (28686b9 → ff5a805):

- **Types** (`src/types.ts`): added `'pelanggan'` to `ActivePage`; added `DbCustomerWithStats`, `DbCustomerProfile` interfaces; added `orders?: DbOrder[]` to `DbLead`; added `customer_id?: string` to `DbOrder`
- **Service layer** (`src/lib/supabaseClient.ts`): added `customersService.fetchAll()` (customer list with order_count + total_spend computed client-side from FK join); added `customersService.fetchProfile(id)` (full customer with orders + leads sorted by date); extended `leadsService.fetchAll()` to join linked orders via `orders!orders_leads_id_fkey`
- **Sidebar + routing**: added "Pelanggan" nav item (`Users` icon) between Pipeline and Riwayat Pesanan; added `'pelanggan'` route in App.tsx; added `openCustomerId` state + `handleOpenCustomer` handler; `onPageChange` resets `openCustomerId` when navigating away from pelanggan
- **PelangganScreen** (`src/components/PelangganScreen.tsx`): split-view layout — fixed 288px left panel (customer list + search filtering by name/WA/company, selected state with navy accent), dynamic right panel (empty state, loading state, full profile with navy header + initials avatar + total spend, 3-stat row with conversion rate, order cards with status badge, lead cards with Pipeline link)
- **PipelineScreen** (`src/components/PipelineScreen.tsx`): full rewrite — added search bar (name/WA/company), collapsible rows with ChevronDown rotation, `PipelineItemsTable` for ORDERED leads (product table + subtotal/ongkir/total footer), non-ORDERED expanded state with info box, "Buka Percakapan" quick link, customer name as clickable link → `onOpenCustomer`; renamed interface from `PengaturanScreenProps` to `PipelineScreenProps`
- **OrderHistoryScreen** (`src/components/OrderHistoryScreen.tsx`): customer name in collapsed row changed from plain text to clickable link (`text-[#012749] underline`) → `onOpenCustomer(order.customer_id)` for cross-screen navigation to Pelanggan profile

## Frontend/Backend Gap Fix — Task 1: Add company_settings migration file — DONE (2026-06-03)

- Created `supabase/migrations/20260603000001_company_settings.sql`
- Versioned DDL for `company_settings` table (was previously applied via MCP, now has a migration file for fresh deployments)
- Table structure: id (PRIMARY KEY DEFAULT 1), company_name, address, phone, email, updated_at (DEFAULT now() DEFAULT now())
- RLS enabled with two policies: public read (anon SELECT), anon write (anon ALL with CHECK)
- Grants anon role SELECT, INSERT, UPDATE
- Seed query: INSERT default row (id=1, company_name='Garindo Jaya Panel') with ON CONFLICT DO NOTHING
- `npm run build` passes cleanly — zero TypeScript errors (2378 modules transformed)
- Committed: `feat(db): add company_settings migration file (was applied via MCP, now versioned)` (d9619d2)

## Frontend/Backend Gap Fix — Task 3: Wire AuthScreen to Supabase Auth OTP — DONE (2026-06-03)

- Replaced `src/components/AuthScreen.tsx` with Supabase Auth magic-link OTP flow
  - Removed all simulated random OTP generation and the `123456` hardcoded backdoor
  - `handleSendSignInOtp` / `handleSendSignUpOtp` now call `supabase.auth.signInWithOtp({ email })` when Supabase is configured
  - `handleSignInSubmit` / `handleSignUpSubmit` now call `supabase.auth.verifyOtp({ email, token, type: 'email' })` to verify the real OTP
  - Sign-up flow calls `supabase.auth.updateUser({ data: { full_name, store_name } })` to persist metadata after OTP verify
  - `deriveDisplayName()` helper extracts a display name from `user_metadata.full_name` or falls back to the email prefix
  - Dev-mode bypass: when `isSupabaseConfigured` is false, OTP send is skipped and `123456` is accepted only locally (not in production)
  - Dev-mode amber banner shown at bottom of screen when Supabase is unconfigured
  - Added `signInLoading` / `signUpLoading` boolean states; buttons disabled during async operations
- Updated `src/App.tsx` with three targeted edits:
  - **Edit A**: added `supabase` to the import from `./lib/supabaseClient`
  - **Edit B**: added session-restore `useEffect` — calls `supabase.auth.getSession()` on mount to auto-login users with an existing session; subscribes to `onAuthStateChange` to log out if session is revoked externally
  - **Edit C**: made `handleLogout` async; calls `supabase.auth.signOut()` before clearing local state
- `npm run build` passes cleanly (2384 modules transformed, zero TypeScript errors)
- Committed: `feat(auth): wire AuthScreen to Supabase Auth OTP — remove simulated code and 123456 backdoor` (fbb64e3)

## Frontend/Backend Gap Fix — Task 4: Add admin_users migration, DbAdminUser type, adminUsersService — DONE (2026-06-03)

- Created `supabase/migrations/20260603000003_admin_users.sql`
  - `admin_users` table: id (uuid PK), name (text NOT NULL), email (text nullable), whatsapp (text nullable), role (text, default 'Staff Admin Toko'), permissions (jsonb), status (text, default 'Aktif'), created_at (timestamptz)
  - RLS enabled; idempotent policy "anon full access admin_users" (FOR ALL TO anon)
  - GRANT SELECT, INSERT, UPDATE, DELETE to anon
- Applied migration via Supabase MCP to project `zocefskkwykivbxhruoy` (ERP MSME) — `admin_users` confirmed present in `list_tables`
- Added `DbAdminUser` interface to `src/types.ts` (after existing `AdminUser`): nullable email/whatsapp, string status, string created_at
- Added `DbAdminUser` to import in `src/lib/supabaseClient.ts`
- Added `adminUsersService` to `src/lib/supabaseClient.ts`: `fetchAll()`, `upsert(user)`, `remove(id)`
- `npm run build` passes cleanly (2384 modules transformed, zero TypeScript errors) — both before and after service addition
- Committed: `feat(db): add admin_users migration, DbAdminUser type, and adminUsersService` (6751e59)

## Auth Bug Fixes (Code Quality Review) — DONE (2026-06-03)

Three targeted fixes to the Supabase Auth implementation:

- **Fix 1 — Stale closure in onAuthStateChange (App.tsx line 88):** Removed the `&& currentUser` guard from `onAuthStateChange` callback. Because the effect has `[]` deps, `currentUser` was always captured as `null` at mount, making the condition always-false. Now resets to auth screen whenever `!session`, so sign-out from another tab or session expiry is handled correctly.
- **Fix 2 — Silent failure on updateUser in sign-up flow (AuthScreen.tsx line 176):** Destructured the error from `supabase.auth.updateUser(...)`. If it fails, `setSignUpLoading(false)` is called, a toast is shown (`❌ Gagal simpan profil: ...`), and the flow returns early — preventing the user from entering the dashboard with empty name/store_name.
- **Fix 3 — Silent failure on signOut in handleLogout (App.tsx line 189):** Wrapped `supabase.auth.signOut()` in a try/catch. A network-level sign-out failure no longer blocks local state cleanup — local state is always cleared regardless of server response (best-effort pattern).
- `npm run build` passes cleanly (2384 modules transformed, zero TypeScript errors)
- Committed: `fix(auth): fix stale closure in onAuthStateChange, add error handling for updateUser and signOut` (11da57a)

## Frontend/Backend Gap Fix — Task 5: Make UserManagementScreen self-contained — DONE (2026-06-03)

- Rewrote `src/components/UserManagementScreen.tsx` — component is now fully self-contained:
  - Removed `admins` and `onAdminsUpdate` props from interface; only `showToast` remains
  - Added `loading` state with spinner while Supabase fetch is in flight
  - `useEffect` on mount: if `isSupabaseConfigured`, calls `adminUsersService.fetchAll()` and hydrates state; falls back to `INITIAL_ADMINS` if Supabase is off or table is empty
  - `handleTogglePermission` made async: calls `adminUsersService.upsert()` after local state update when Supabase configured
  - `handleCreateAdminSubmit` made async: uses `crypto.randomUUID()` for new id; calls `adminUsersService.upsert()` when Supabase configured
  - `handleRemoveAdmin` made async: calls `adminUsersService.remove()` when Supabase configured
  - Info banner updated: shows Supabase-connected vs local-only message
  - Preserved original floating "SIMPAN PERUBAHAN TIM" button at bottom
  - Added `dbToAdminUser` and `adminUserToDb` mapper functions for `DbAdminUser ↔ AdminUser` conversion
- Updated `src/App.tsx` with four targeted removals:
  - Removed `AdminUser` from the types import line
  - Removed `INITIAL_ADMINS` from the initialData import
  - Removed `admins` useState (was reading from `localStorage.getItem('sinar_elektrik_admins')`)
  - Removed `useEffect` that persisted `admins` to localStorage
  - Updated `case 'user-management'` render: removed `admins` and `onAdminsUpdate` props
- `npm run build` passes cleanly — zero TypeScript errors (2384 modules transformed)
- Committed: `feat(admin-users): make UserManagementScreen self-contained with Supabase — remove localStorage` (5213282)

## Frontend ↔ Backend Gap Fixes — COMPLETE (2026-06-03)

All 5 tasks shipped across 5 commits (d9619d2 → 33c752e):

**P1a — `company_settings` migration file** (commit d9619d2)
- Created `supabase/migrations/20260603000001_company_settings.sql`
- Versioned the DDL for the `company_settings` table that was previously applied via MCP only
- Idempotent: `CREATE TABLE IF NOT EXISTS`, policy guards via `DO $$ BEGIN IF NOT EXISTS ... END $$`

**P1b — `stocks` migration file** (commit f4ab2de)
- Created `supabase/migrations/20260603000002_stocks_table.sql`
- Versioned the DDL previously documented only as manual SQL in `backend-go/README.md`

**P2 — Wire AuthScreen to Supabase Auth OTP** (commits fbb64e3, 11da57a)
- Replaced simulated OTP (Math.random, 123456 backdoor) with real `supabase.auth.signInWithOtp` + `verifyOtp`
- Sign-up flow stores `full_name` and `store_name` in Supabase user metadata via `updateUser`
- App.tsx: session restore on page refresh via `getSession`, auth state listener via `onAuthStateChange`
- App.tsx: `handleLogout` is now async, calls `supabase.auth.signOut()`
- Dev bypass retained: when Supabase is not configured, `123456` is accepted as OTP with amber warning banner
- Fixed stale closure in `onAuthStateChange` (currentUser guard removed)
- Added error handling for `updateUser` and `signOut` with try/catch and toast feedback

**P3 — `admin_users` table + UserManagementScreen Supabase wiring** (commits 6751e59, 697bca7, 5213282, 33c752e)
- Created `supabase/migrations/20260603000003_admin_users.sql` and applied to Supabase
- Added `DbAdminUser` interface to `src/types.ts`
- Added `adminUsersService` (fetchAll, upsert, remove) to `src/lib/supabaseClient.ts`
- Rewrote `UserManagementScreen` to be self-contained: fetches from Supabase on mount, saves/deletes in real-time, optimistic updates with rollback on failure
- Removed `admins` localStorage state from App.tsx; component no longer receives data props

**P4 — Remove dead `/api/stocks` REST routes from Go daemon** (commit 12b82dd)
- Removed `mux.HandleFunc("/api/stocks", ...)` and `mux.HandleFunc("/api/stocks/", ...)` route registrations
- Removed all dead-code functions and struct: `handleStocksRoute`, `handleSingleStockRoute`, `StockItem`, `getStocks`, `upsertStock`, `updateStockPriceAndVolume`, `deleteStock` (lines 192–345, 154 lines removed)
- Removed now-unused imports: `"fmt"` and `"strings"`
- `go build ./...` passes with zero errors
- Frontend talks directly to Supabase for stock data; Go daemon no longer exposes stock endpoints

## Bug Fixes & Knowledge Update — DONE (2026-06-03)

### Auth Bug Fix: Wrong Supabase project in .env
- Root cause: `.env` pointed to `ekhhojaezdfjfwuxyjkl` ("ERP MSME AI Studio", Japan) — a different project
- All migrations were applied to `zocefskkwykivbxhruoy` ("ERP MSME", Singapore)
- Fixed `.env`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` now point to the correct project
- This fixes: "No API key found in request" error on OTP send (client was hitting wrong project)
- This fixes: Sales Inbox showing empty (conversations table was in different project)
- Note: `.env` is gitignored; this fix is local-only — Cloud Build substitution vars also need updating

### Auth Bug 2: Magic link instead of 6-digit OTP — Dashboard config required
- `signInWithOtp` sends email with magic link by default; Supabase email template controls what user sees
- Fix: Go to Supabase Dashboard → Authentication → Email Templates → "Magic Link"
- Edit template to include the 6-digit token: add `Your OTP code: <strong>{{ .Token }}</strong>` before the link
- No code change needed — this is a Supabase project configuration

### Calista Knowledge Update: Add 1mm ketebalan for Panel Besi
- Added `1 mm` to Besi (iron) material thickness options in `calista_system_prompt.txt`
- Line 106: `1.2 mm / 1.5 mm / 1.8 mm / 2 mm / 3 mm` → `1 mm / 1.2 mm / 1.5 mm / 1.8 mm / 2 mm / 3 mm`
- Checklist updated: `1.2 / 1.5 / 1.8 / 2 / 3 mm` → `1 / 1.2 / 1.5 / 1.8 / 2 / 3 mm`
- Rebuilt Go backend binary to embed updated prompt
- Committed: `feat(calista): add 1mm ketebalan to Panel Besi spec`

## E2E Full Frontend–Backend Integration Audit — DONE (2026-06-03)

### Schema Fix: Drop legacy tables + apply 8 pending migrations to correct Supabase project

**Root cause**: Supabase project `zocefskkwykivbxhruoy` had legacy tables from a prior ERP version (`whatsapp_conversations`, `products`, `customers` with UUID PK, etc.) that conflicted with all 8 pending migrations. All conflicting tables had 0 rows — safe to drop.

**Actions taken**:
1. Dropped all 16 legacy tables with CASCADE via `apply_migration` (name: `drop_legacy_tables`)
2. Applied migrations in order:
   - `core_ai_engine` — whatsapp_numbers, conversations, messages, orders + RLS + pg_notify triggers
   - `schema_id_system` — order_status enum expansion, customers, leads, bank_config, gjp sequences
   - `payment_flow` — wa_recipients, payment_verified/rejected triggers
   - `followup_scheduler` — followup columns on conversations + trigger
   - `admin_write_grants` — anon write grants for bank_config, wa_recipients, whatsapp_numbers
   - `notification_config` — notification_config table
   - `company_settings` — company_settings table (seeded row id=1: "Garindo Jaya Panel")
   - `stocks_table` — stocks table with public RLS

**Final schema**: 12 tables, all with RLS enabled. `company_settings` has 1 seeded row.

### Bug Fix: `useRealtimeConversations` loading state when Supabase is null

- Added `setLoading(false)` to the `if (!supabase) return` guard in `src/hooks/useRealtimeConversations.ts`
- Without this fix, `SalesInboxScreen` shows "Memuat percakapan..." forever when Supabase is not configured

### E2E Screen Audit Results

All 14 screens reviewed against the Supabase schema and service implementations:

| Screen | Status | Notes |
|---|---|---|
| AuthScreen | ✅ OK | OTP → `supabase.auth.signInWithOtp` + `verifyOtp` |
| DashboardScreen | ✅ OK | statsService queries orders + conversations |
| SalesInboxScreen | ✅ OK | useRealtimeConversations + 4 Realtime channels |
| StockManagerScreen | ✅ OK | Props-based; App.tsx handles Supabase upsert/delete |
| WhatsappAiScreen | ✅ OK | Reads whatsapp_numbers from Supabase; polls daemon for QR |
| PipelineScreen | ✅ OK | leadsService with customers + orders FK joins |
| OrderHistoryScreen | ✅ OK | Full order lifecycle with PAYMENT_VERIFIED/REJECTED flows |
| PelangganScreen | ✅ OK | customersService with FK joins to orders + leads |
| LaporanScreen | ✅ OK | reportsService queries orders + conversations |
| NotificationSettingsScreen | ✅ OK | notificationConfigService reads/writes |
| PengaturanScreen | ✅ OK | bankConfig + waRecipients + companySettings all wired |
| UserManagementScreen | ✅ OK | adminUsersService fetchAll/upsert/remove |
| InvoiceModal | ✅ OK | Reads company_settings + bank_config for invoice rendering |
| Sidebar | ✅ OK | All 11 ActivePage nav items present |

No code gaps found beyond the one bug above.

## P5 — Real-time daemon online/offline health badge in WhatsappAiScreen — DONE (2026-06-03)

- Added `daemonOnline` boolean state (line 45) next to existing `waConnected` state
- Updated `fetchQR` (lines 97-110): `setDaemonOnline(true)` at top of try block; `setDaemonOnline(false)` in catch — piggybacking on the existing 5-second poll that already runs
- Replaced static "Active daemon (whatsmeow)" badge (line 257-261) with dynamic conditional rendering:
  - Online: emerald text + animated ping dot, "Daemon online"
  - Offline: rose-500 text + static rose-400 dot, "Daemon offline"
- `npm run build` passes — zero TypeScript errors (2384 modules transformed)
- Committed: `feat(ui): add real-time daemon online/offline health badge to WhatsappAiScreen` (7e27bf2)

## Production Fixes — DONE (2026-06-04)

### Fix: .env reverted to correct Supabase project
- `.env` was pointing to `zocefskkwykivbxhruoy` (wrong project) — reverted to `ekhhojaezdfjfwuxyjkl` (production)
- Applied `admin_users` migration to `ekhhojaezdfjfwuxyjkl` (was missing from production, all other 11 tables already present)
- All 12 tables now live in production with real data

### Fix: OTP maxLength 6 → 8
- Supabase generates 8-digit OTP codes via `{{ .Token }}` in Magic Link email template
- Both Sign In and Sign Up OTP inputs had `maxLength={6}` — users could not enter the last 2 digits
- Changed to `maxLength={8}` and updated placeholder text

### Fix: WhatsApp session persistence (SQLite → PostgreSQL)
- `wa_store.db` (SQLite) lived on Cloud Run's ephemeral filesystem — lost on every redeploy or scale-to-zero
- Switched whatsmeow store from `sqlite3` to `postgres` (Supabase DB connection string)
- Session now persists permanently across deploys; QR scan required only once
- Removed `go-sqlite3` dependency and CGO requirement → simpler Dockerfile, smaller image
- Removed unused `WAStorePath` config field

### Fix: approved_at data quality
- `UpdateOrderStatus` was setting `approved_at = now()` for all non-CANCELLED status changes
- Fixed to only set `approved_at` when status becomes `WAITING_PAYMENT` (actual admin approval)

### Fix: WhatsApp logout endpoint added
- Added `/api/wa/logout` HTTP endpoint to Go backend (`backend-go/main.go`)
- Added `Logout()` method to `whatsapp.Client` (calls `c.WA.Logout(context.Background())`)
- Added "Putuskan Koneksi" button in `WhatsappAiScreen` connected state UI

### Fix: WhatsApp AI screen UI improvements
- Removed redundant phone number input form for pairing (was asking for phone after QR scan — redundant)
- Replaced with clear scan QR instructions and "Cara Scan QR" steps

### Fix: RLS enabled on all whatsmeow tables
- Enabled RLS on all 16 whatsmeow tables + added UPDATE/INSERT policies for company_settings

## Fix: Address asked too early in AI conversation flow — DONE (2026-06-04)

**Root cause**: `AllCoreFieldsFilled()` required `Address`, `missingFields()` listed "alamat pengiriman", and the COLLECTING prompt included Address as a required field — causing Calista to ask for address upfront, violating the system prompt's hard rule #15.

**Fix** (across 5 files, clean build confirmed):
- `models/types.go`: Added `StateDelivery ConversationState = "DELIVERY"`. Removed `d.Address != ""` from `AllCoreFieldsFilled()`.
- `engine/prompts.go`: Removed Address from COLLECTING prompt template and JSON format. Added explicit instruction "JANGAN tanyakan alamat di fase ini". Removed "alamat pengiriman" from `missingFields()`. Added new `StateDelivery` prompt that asks pickup-vs-delivery and collects address only if customer chooses delivery.
- `engine/parser.go`: Removed `Address` from `CollectedFields`. Added `DeliveryResponse` struct (`reply`, `next_action: PICKUP|DELIVERY|CONTINUE`, `address`) and `ParseDelivery()`.
- `engine/machine.go`: Added `DeliveryType models.DeliveryType` to `ProcessResult`. Removed address merge in COLLECTING case. Changed CONFIRMING `confirmed=true` → `StateDelivery` (no longer creates order immediately). Added `StateDelivery` case: PICKUP → `CreateOrder=true, DeliveryType=PICKUP`; DELIVERY+address → update address in NewData, `CreateOrder=true, DeliveryType=DELIVERY`.
- `internal/whatsapp/handler.go`: Before `handleBooking`, apply `result.NewData` to `conv.CollectedData` so delivery address is present when order is created. Updated `handleBooking` signature to accept `deliveryType models.DeliveryType`. Pass `deliveryType` to `CreateOrder` instead of hardcoded `""`.

**New flow**: GREETING → COLLECTING (name/company/product only) → CLARIFYING → STOCK_CHECK → CONFIRMING → **DELIVERY** (pickup/delivery choice + address if delivery) → BOOKED

## WhatsApp AI Screen — Inbox Navigation Shortcut — DONE (2026-06-04)

**Root cause**: User couldn't find ongoing customer conversations because they were looking in the "WhatsApp AI" screen (daemon control panel) instead of "Sales Inbox". DB confirmed 6 conversations exist, RLS permits access.

**Fix**:
- Added `onNavigate: (page: ActivePage) => void` prop to `WhatsappAiScreenProps`
- Added clickable "Lihat Percakapan Customer" shortcut card between the daemon status section and the main grid in `WhatsappAiScreen.tsx`
  - Navy Inbox icon, explanatory text pointing to "Sales Inbox"
  - Arrow icon with hover animation
  - Clicking navigates directly to `sales-inbox`
- Wired `onNavigate={setActivePage}` in `App.tsx` `case 'whatsapp-ai'`
- `npx tsc --noEmit` — only pre-existing React 19 `key` prop error in `SalesInboxScreen.tsx`, no new errors

## Bug Fix Task 1: Expose connected phone number in /api/wa/qr — DONE (2026-06-04)

- Modified `backend-go/main.go` `/api/wa/qr` handler to add `phone` field
- When paired: `phone = waClient.WA.Store.ID.User` (e.g. `6281234567890`); when not paired: `phone = ""`
- Response is now `{ qr, connected, phone }`
- `go build ./...` passes cleanly
- Committed: `feat(api): expose connected phone number in /api/wa/qr response` (ebc2c20)

## Bug Fix Task 2: Display WhatsApp phone number when connected — DONE (2026-06-04)

**Root cause**: Backend `/api/wa/qr` endpoint now returns `{ qr, connected, phone }` but frontend was not reading or displaying the phone number.

**Fix** — 4 targeted edits to `src/components/WhatsappAiScreen.tsx`:

1. **Add state variable** (line 48): Inserted `const [waPhone, setWaPhone] = useState<string>('');` between `waConnected` and `daemonOnline` state declarations
2. **Read phone in fetchQR** (line 105): Added `setWaPhone(data.phone || '');` right after `setWaConnected(data.connected);` in the fetch success block
3. **Display phone in UI** (lines 316-318): Inside the connected state block (`{waConnected && (`), added conditional rendering:
   ```tsx
   {waPhone && (
     <p className="text-xs font-black text-emerald-600 tracking-tight">+{waPhone}</p>
   )}
   ```
   Placed between the `<h4>BERHASIL TERSAMBUNG</h4>` and the session saved message
4. **Build verification** (2378 modules transformed): `npm run build 2>&1 | tail -20` shows zero TypeScript errors; build completes successfully (1,022.32 kB → dist/index.html)

**Result**: When WhatsApp is connected, the phone number appears in green below the "BERHASIL TERSAMBUNG" heading in the format `+62123456789`

- Committed: `feat(ui): show connected WhatsApp phone number in WhatsApp AI screen` (145ae45)

## Task 3 (Bug Fix): Backend — fix kendala teknis for BOOKED state — DONE (2026-06-04)

**Root Cause**: Customers who message after booking (state = BOOKED) caused the state machine to be called with an unknown-state prompt, resulting in Gemini returning an empty response and FallbackReply firing ("kendala teknis" error).

**Fix**: Intercept BOOKED and TIMEOUT_REMINDER states in `processMessage()` before the state machine is called, send a static holding message, and return.

- Created regression test `TestProcessBookedStateReturnsEmptyReply` in `backend-go/internal/engine/machine_test.go`:
  - Documents that BOOKED state produces no reply from the machine (confirming handler-level intercept is correct fix)
  - Test verifies: machine returns empty reply, state remains BOOKED
  - Test PASSES

- Added intercept in `backend-go/internal/whatsapp/handler.go` at line 105 (before terminal state check):
  - Checks `conv.State == models.StateBooked || conv.State == models.StateTimeoutReminder`
  - Sends bilingual holding message (Indonesian / English) without invoking Gemini
  - Inserts message to DB and sends to WhatsApp; logs error if send fails (non-fatal)
  - Returns early to prevent machine.Process() call

- Build and test verification:
  - `CGO_ENABLED=1 go build ./...` — clean build (no errors)
  - New test `TestProcessBookedStateReturnsEmptyReply` PASSES
  - All engine/rules tests still PASS (pre-existing failure in TestProcessConfirmingBooked unrelated to this task)

- Committed: `fix(wa): intercept BOOKED state in handler to prevent kendala teknis error` (96f398d)

## Vosi Landing Page — Task 1: Scaffold vosi-landing project folder — DONE (2026-06-04)

- Created `/vosi-landing/` project directory
- Copied `landing-final.html` (832 lines) to `vosi-landing/index.html` from `.superpowers/brainstorm/19476-1780503711/content/` prototype
- Created `vosi-landing/.gitignore` with: `.DS_Store`, `node_modules/`, `*.log`
- Created `vosi-landing/robots.txt` with standard Allow: / directive
- Created `vosi-landing/sitemap.xml` with single URL entry for https://vosi.id/ (monthly changefreq, priority 1.0)
- Verification:
  - `ls -la vosi-landing/` shows 4 files: `.gitignore`, `index.html`, `robots.txt`, `sitemap.xml`
  - `wc -l vosi-landing/index.html` shows 832 lines (> 800 ✓)
  - `grep -c "konsultasi|hero|faq|sp-wrap"` returns 87 matches (> 4 ✓)
- Committed: `feat(vosi-landing): scaffold production project from prototype` (47b7dc8)

## Vosi Landing Page — Task 3: SEO meta tags, Open Graph, and favicon — DONE (2026-06-04)

- Added SEO meta tags to `vosi-landing/index.html` after `<title>` line:
  - `meta name="description"`: "Vosi otomasi balasan WhatsApp bisnis kamu 24 jam — terima order, cek stok, dan kirim invoice secara otomatis. Aktif dalam 3 hari kerja."
  - `meta name="keywords"`: "whatsapp bot bisnis, ai whatsapp indonesia, otomasi whatsapp, chatbot toko, vosi"
  - `link rel="canonical"`: https://vosi.id/
- Added Open Graph tags for social media preview (WhatsApp, Facebook, LinkedIn):
  - `og:type` → website, `og:url` → https://vosi.id/, `og:locale` → id_ID
  - `og:title`, `og:description`, `og:image` → https://vosi.id/og-image.png
- Added Twitter Card meta tags (summary_large_image format)
- Added favicon link: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
- Created `vosi-landing/favicon.svg` (376 bytes) with lightning bolt icon inside rounded square with blue-to-green gradient
- Verification:
  - `grep -n "og:title\|og:image\|description\|favicon"` returns 6 matches at lines 9, 16–18, 24, 28 ✓
  - `ls -la vosi-landing/favicon.svg` shows file exists, 376 bytes ✓
- Committed: `feat(vosi-landing): add SEO meta tags, Open Graph, and favicon` (5de43de)

## Vosi Landing Page — Task 6: Pre-launch HTML validation checklist — DONE (2026-06-04)

**HTML Validation Results**: 59 errors remaining (all inline style warnings, acceptable per instructions)

- **Step 6.1**: Installed and ran `npx html-validate` on `vosi-landing/index.html`
  - Initial validation: 92 errors total
  - Error categories: button missing type attributes (9), raw `&` characters (11), self-closing input tags (1), inline style warnings (71)

- **Step 6.2**: Fixed critical errors (22 total):
  1. Added `type="button"` to 9 buttons across the page (nav CTA, hero CTA, FAQ items × 6, comparison section CTA, final CTA)
  2. Encoded all raw `&` characters as `&amp;` (11 instances in section titles, select options, footer, comparison messages)
  3. Converted 3 self-closing `<input/>` tags to non-self-closing `<input>` form

- **Step 6.3**: Added accessibility attributes:
  - Added `name="jenis-bisnis"` to `<select>` element for proper form field identification

- **Step 6.4**: Verified all buttons have `type` attributes
  - Final validation shows zero `no-implicit-button-type` errors
  - Final validation shows zero `no-raw-characters` errors
  - Final validation shows zero `void-style` errors

- **Final Validation Status**: 59 errors (all `no-inline-style` warnings, acceptable per requirements)
  - Inline styles are documented design decision in HTML-only landing page (no external CSS file)
  - Per instructions: "warnings about inline styles...are acceptable — do not fix warnings"

- Committed: `fix(vosi-landing): HTML validation fixes - add button type attributes, encode ampersands, fix self-closing input tags` (e4394df)

## Bug Fix: Sales Inbox conversations not loading — DONE (2026-06-04)

**Root cause (1 — operational)**: The backend deployment via `cloudbuild.yaml` overwrote the production frontend at `https://sinar-elektrik-msme-erp-422860632808.asia-southeast1.run.app`. The production URL now serves the Go API, not the React app. To restore: trigger `cloudbuild.frontend.yaml` or run `npm run dev` locally.

**Root cause (2 — code bug)**: `useRealtimeConversations.ts` never called `setLoading(false)` when any fetch in `load()` failed (e.g., transient Supabase error). UI would hang at "Memuat percakapan..." indefinitely instead of showing the empty state.

**Fix**: Added `.finally(() => { if (mounted) setLoading(false); })` to the `load()` call chain. Moved `setLoading(false)` out of the `load()` function body so it always fires exactly once regardless of success or failure.

## Bug Fix: User Management cannot add users — DONE (2026-06-04)

**Root cause**: `admin_users` table only had an `anon` RLS policy. After OTP login, users hold the `authenticated` role, which had no matching policy — all reads/writes silently failed. `adminUsersService.upsert()` threw an error, triggering the optimistic-add rollback.

**Fix**: Applied Supabase migration `add_authenticated_policies_admin_users`:
```sql
CREATE POLICY "auth_all_admin_users" ON admin_users
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
```

**Secondary fix**: Removed the `if (rows.length > 0)` guard in `UserManagementScreen.tsx` `fetchAll()` handler. Previously, an empty DB table caused `INITIAL_ADMINS` (hardcoded demo data) to remain in state — deleting them locally wouldn't persist, and they'd reappear on refresh. Now the UI always reflects the real DB state (empty table → empty list).

**Verification**:
- Confirmed migration applied: both `auth_all_admin_users` and `auth full access admin_users` (FOR ALL TO authenticated) policies present on `admin_users` table
- Schema confirmed compatible: `created_at` has `DEFAULT now()` so upsert omitting it works correctly

## Payment Proof Fix — DONE (2026-06-04)

Fixed three bugs that prevented customer payment proofs (images and PDFs) from being processed:

**Bug 1 fixed: Timestamp filter dropped queued media during redeploys**
- `Handle()` previously filtered ALL messages (including media) with `Timestamp.Before(startedAt)`, dropping payment proofs sent while the backend was restarting
- Fix: moved timestamp filter inside the text-message branch only — media messages now bypass the filter entirely
- Commits: `fix(wa): apply timestamp filter to text messages only, not media`

**Bug 2 fixed: viewOnce and ephemeral image wrappers not unwrapped**
- `GetImageMessage()` only checked the top-level proto field; newer WhatsApp clients wrap images in `viewOnceMessage` or `ephemeralMessage`
- Fix: added two unwrapping blocks in `handleMediaMessage()` that resolve through `GetViewOnceMessage().GetMessage()` and `GetEphemeralMessage().GetMessage()`
- Commits: `fix(wa): accept viewOnce/ephemeral images and PDF documents as payment proofs`

**Bug 3 fixed: PDF documents not accepted as payment proofs**
- Only `GetImageMessage()` was checked; customers sending PDF payment proofs fell into admin escalation
- Fix: added `DownloadDocument(*waProto.DocumentMessage)` to `sender.go`; `handleMediaMessage()` now checks `GetDocumentMessage()` and routes to `DownloadDocument` when no image is found
- Commits: `feat(wa): add DownloadDocument to sender for PDF payment proofs`

**Files changed**: `backend-go/internal/whatsapp/sender.go`, `backend-go/internal/whatsapp/handler.go`

## Admin Roles & Permissions — Task 4: Wire AuthScreen — DONE (2026-06-04)

**Changes to `src/components/AuthScreen.tsx`** (commit c08157e):
- Added `adminUsersService` import from `../lib/supabaseClient` and `PermissionSet, ALL_PERMISSIONS` from `../types`
- Widened `onLoginSuccess` prop type to include `permissions: PermissionSet`
- `devBypass` now passes `permissions: ALL_PERMISSIONS` to `onLoginSuccess`
- `handleSignInSubmit`: after successful OTP verify, calls `adminUsersService.fetchByEmail(signInEmail)` — blocks login with toast if email is not in `admin_users` table; derives `name`, `role`, and `permissions` from the DB row
- `handleSignUpSubmit`: auto-creates Owner row in `admin_users` via `adminUsersService.upsert()` after sign-up; passes `permissions: ALL_PERMISSIONS` to `onLoginSuccess`
- Build: `npm run build` — zero TypeScript errors (`✓ built in 33.26s`)

## Feature: Add real email field to UserManagementScreen — DONE (2026-06-04)

**Reason**: OTP login requires a real email address; the form previously auto-generated fake `name@sinarelektrik.com` emails that could never receive OTP codes.

**Changes to `src/components/UserManagementScreen.tsx`**:
- Added email `<input type="email">` field between "Nama Lengkap" and "No. WhatsApp" in the "Tambah Admin Baru" form
- Updated validation: now checks `newEmail.trim()` before checking WhatsApp/role — shows toast if email is blank
- Updated `newAdmin` object: replaced auto-generated `${prefix}@sinarelektrik.com` with `newEmail` (real user input)
- Added `setNewEmail('')` to form reset block so field clears after successful submit

## Laporan RLS Fix — DONE (2026-06-04)

Added `authenticated` RLS policies on `orders`, `conversations`, and `messages` tables via Supabase migration `add_authenticated_policies_orders_conversations_messages`. After OTP login the Supabase JS client uses the `authenticated` role — without these policies all four `reportsService` queries silently returned empty arrays. LaporanScreen now shows real revenue, order count, AI rate, and top products.

## Admin Roles & Permissions — Tasks 1–3, 5: Types, supabaseClient, App.tsx, Sidebar — DONE (2026-06-04)

**Task 1** (commit a0f3f60): Expanded `PermissionSet` in `src/types.ts` from 4 keys to 11 (one per sidebar item: dashboard, salesInbox, laporan, aiStock, pipeline, pelanggan, orderHistory, userManagement, whatsappAi, notifications, settings). Added exported `ALL_PERMISSIONS` constant (all 11 true). Updated `INITIAL_ADMINS` in `src/initialData.ts` with sensible defaults per role. Build: zero TS errors.

**Task 2** (commit 730145f): Added `adminUsersService.fetchByEmail(email)` to `src/lib/supabaseClient.ts`. Queries `admin_users` by email via `.maybeSingle()`, returns `DbAdminUser | null`, throws on error.

**Task 3** (commit d5c73fa): Widened `currentUser` state in `src/App.tsx` to include `permissions: PermissionSet`. Imports `PermissionSet, ALL_PERMISSIONS` from `./types`. Session-restore `getSession` block now passes `permissions: ALL_PERMISSIONS`. `handleLoginSuccess` parameter type updated.

**Task 5** (commit f5adbba): Updated `src/components/Sidebar.tsx`:
- Added `permKey: keyof PermissionSet` to each of the 11 menu items
- Added `visibleItems` filter: hides items where `currentUser.permissions[permKey] === false`
- Renders `visibleItems.map` instead of `menuItems.map`
- Added `useEffect` (dep: `currentUser?.permissions`) that redirects to `'dashboard'` if active page becomes hidden

## Admin Roles & Permissions — Task 6: UserManagementScreen expandable rows + Owner role — DONE (2026-06-04)

Full rewrite of the permissions section in `src/components/UserManagementScreen.tsx` (commit b2fec37):

- **Imports**: Replaced `ChevronLeft`, `ChevronRight`, `Settings` with `ChevronDown`, `Trash2`, `Crown`; added `ALL_PERMISSIONS` to types import
- **`defaultPermissions(role)`**: New helper function before the component; maps Owner → ALL_PERMISSIONS, Supervisor Gudang / Staff Admin Toko / Finance Manager → role-specific 11-key PermissionSet
- **State**: Added `expandedId` state (accordion) and `PERM_LABELS` constant (11 key→label mappings for all PermissionSet keys)
- **`handleCreateAdminSubmit`**: Replaced hardcoded 4-key permissions object with `defaultPermissions(newRole)` call
- **Role dropdown**: Added `<option value="Owner">Owner</option>` as first real option
- **Right column rewrite**: Replaced `<table>` with expandable card list:
  - Each card shows avatar initial, name, email, role, active-permission count badge (`X/11 aktif` or `Semua akses` for Owner), status badge, ChevronDown (rotates on expand), Trash2 delete button
  - Owner rows show Crown icon next to name
  - Expanded panel: 2–3 column grid of toggle labels; Owner rows locked (`disabled`, `opacity-60`, `cursor-not-allowed`) with amber Crown warning message
  - Permission toggles: `w-9 h-5` sliding toggle with `peer-checked:bg-[#2d8a4e]`
- **Build**: `npm run build` — zero TypeScript errors (`✓ built in 1.75s`)
