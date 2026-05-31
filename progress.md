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

## Tasks 4–21: Pending
