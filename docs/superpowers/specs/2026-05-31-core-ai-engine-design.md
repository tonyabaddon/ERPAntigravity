# Core AI Engine — Design Spec
**Date:** 2026-05-31  
**Project:** Sinar Elektrik MSME ERP  
**Subsystem:** Core AI Engine (WhatsApp Bot) — Subsystem 1 of 3  
**Status:** Approved for implementation planning

---

## 1. Overview

The Core AI Engine is the backend brain of the WhatsApp ordering system. It connects WhatsApp numbers (via the Go `whatsmeow` library) to a Gemini-powered conversation state machine that greets customers, collects their order details, checks live inventory, and locks confirmed orders with a 2×24-hour booking timeout. When the AI cannot resolve a conversation, it escalates to a human admin via the Sales Inbox.

This spec covers **Subsystem 1 only** — the Go daemon, state machine, data model, and React wiring. Dashboard automation (Subsystem 2) and Sales Inbox enhancements (Subsystem 3) are separate specs.

---

## 2. Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Implementation target | Full-stack real | Go daemon + Gemini API + Supabase |
| Conversation flow | State machine + LLM | Deterministic field collection, LLM handles language only |
| Escalation logic | Rules first, LLM fallback | Rules catch known cases instantly; LLM handles edge cases |
| Booking timeout | 2×24 hours | Reminder at 44hr, auto-cancel at 48hr |
| Timeout language | Follows customer | Detected at GREETING state, stored on conversation |
| WhatsApp integration | `whatsmeow` (Go) | Uses personal/existing WA numbers, avoids Meta API cost |
| Architecture | Go-centric + Supabase Realtime | Go owns all logic; React gets live updates as free side-effect of DB writes |

---

## 3. System Architecture

```
Customer WhatsApp
       ↕  (WhatsApp Web Protocol / WebSocket)
Go Daemon (whatsmeow)
  ├── WA Client (receive/send)
  ├── State Machine (conversation transitions)
  ├── Rules Engine (escalation detection)
  └── Scheduler (2×24hr timeout goroutines)
       ↕  (Supabase REST API — service key)
Supabase (PostgreSQL)
  ├── conversations
  ├── messages
  ├── orders
  └── stock_items (existing)
       ↕  (Supabase Realtime WebSocket)
React Frontend
  ├── SalesInboxScreen  (live chat monitor)
  ├── DashboardScreen   (orders queue + approval)
  └── WhatsappAiScreen  (number management)
```

### Core design rules

- **Go daemon is the primary writer** to `conversations`, `messages`, and `orders`. Three explicit React write exceptions, all enforced via RLS:
  1. React INSERTs to `messages` (sender: "admin") for admin replies → Go detects via DB listener and forwards to WhatsApp.
  2. React UPDATEs `conversations.state` to `ESCALATED_ADMIN` (handover to admin) or `COLLECTING` (hand back to AI) via the toggle button.
  3. React UPDATEs `orders.shipping_fee` and `orders.status = 'APPROVED'` when admin approves an order.
- **State persisted before every WA reply.** If the daemon restarts, it reads conversation state from Supabase and resumes exactly where it left off.
- **Gemini is never called from React.** The API key stays server-side in the Go daemon only.
- **Realtime is free.** Every DB write by Go automatically pushes a WebSocket event to subscribed React clients — no polling, no extra infrastructure.

---

## 4. Conversation State Machine

### States

| State | Description |
|---|---|
| `GREETING` | AI sends welcome message, detects customer language |
| `COLLECTING` | AI extracts Name, Company, Address, Product — one missing field per turn |
| `CLARIFYING` | AI asks about ambiguous specs (qty, size, color, location). Max 3 rounds |
| `STOCK_CHECK` | System queries DB for matching items, price, availability. AI presents summary |
| `CONFIRMING` | AI awaits customer confirmation: "OK" or "BENAR" |
| `BOOKED` | Order locked. Stock reserved. 2×24hr timer starts. Order pushed to Dashboard as PENDING |
| `TIMEOUT_REMINDER` | At 44hr mark. WA reminder sent in customer's language |
| `CANCELLED` | At 48hr mark with no response. Stock released. Admin notified |
| `APPROVED` | Admin has input shipping fee and clicked Approve in Dashboard |
| `COMPLETED` | WA invoice blast sent with bank transfer details |
| `ESCALATED_ADMIN` | AI stuck, product not found, discount request, or LLM signals ESCALATE |
| `ESCALATED_WIRING` | Custom/installation order detected by keyword rules |

### Happy path flow

```
GREETING → COLLECTING → CLARIFYING → STOCK_CHECK → CONFIRMING → BOOKED
  → (44hr) TIMEOUT_REMINDER
  → (48hr, no response) CANCELLED
  → (admin approves) APPROVED → COMPLETED
```

### Escalation exits

Escalation can fire from `COLLECTING`, `CLARIFYING`, or `STOCK_CHECK`.

**ESCALATED_WIRING** — triggered by keyword rules:
- Keywords: `instalasi`, `grounding`, `panel custom`, `wiring`, `proyek besar`, `diagram`
- AI sends: *"Permintaan ini membutuhkan tim teknis kami. Staf kami akan segera menghubungi Anda."* (or English equivalent)
- Conversation appears in Sales Inbox as `WIRING_CUSTOM`

**ESCALATED_ADMIN** — triggered by:
- Rules: product not found in DB after 2 attempts; customer requests discount; offensive language detected
- LLM: returns `next_action: "ESCALATE"` when it cannot resolve ambiguity after 2 clarification rounds
- AI sends polite handover message
- Conversation appears in Sales Inbox as `BUTUH_ADMIN`

---

## 5. Gemini Integration

Gemini handles **language generation only** within each state. The Go state machine controls transitions — Gemini cannot skip states or override escalation rules.

### Structured output per state

Each Gemini call uses `response_mime_type: "application/json"`. Go's `engine/parser.go` unmarshals the response into a typed struct. If parsing fails, Go falls back to a safe generic reply and logs the error — the daemon never crashes on a bad LLM response.

| State | Gemini output fields |
|---|---|
| `GREETING` | `reply`, `detected_language` |
| `COLLECTING` | `reply`, `collected{name,company,address,product}`, `next_action` |
| `CLARIFYING` | `reply`, `specs{qty,size,color,notes}`, `next_action`, `clarification_round` |
| `STOCK_CHECK` | `reply` (includes price/stock from DB context), `next_action` |
| `CONFIRMING` | `reply`, `confirmed: bool`, `modification_requested: bool` |

### Context passed to Gemini on every call

- System prompt for current state (from `engine/prompts.go`)
- Last 10 messages from conversation history
- Current `collected_data` JSON
- Relevant stock items (name, price, stock count) when state is `STOCK_CHECK` or later
- Customer's detected language (after `GREETING`)

---

## 6. Data Model

### Table: `whatsapp_numbers`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | e.g. `wa_1` |
| `phone_number` | text | e.g. `+6281299887766` |
| `name` | text | Alias for this number |
| `status` | enum | `CONNECTED`, `DISCONNECTED`, `PAIRING` |
| `is_enabled` | boolean | Master on/off switch |
| `is_ai_enabled` | boolean | AI auto-reply on/off |
| `created_at` | timestamp | |

### Table: `conversations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `wa_number_id` | text FK | References `whatsapp_numbers.id` |
| `customer_phone` | text | Customer's WA number |
| `state` | enum | Current state machine state |
| `language` | text | `id` (Bahasa) or `en` (English), detected at GREETING |
| `collected_data` | jsonb | Built up incrementally: `{name, company, address, product, quantity, specs}` |
| `clarification_round` | int | 0–3, resets on state change |
| `created_at` | timestamp | |
| `updated_at` | timestamp | Updated on every state transition |

### Table: `messages`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `conversation_id` | uuid FK | References `conversations.id` |
| `sender` | enum | `customer`, `ai`, `admin`, `system` |
| `text` | text | Message content |
| `media_url` | text | Nullable. Supabase Storage URL |
| `media_type` | text | Nullable. `image`, `pdf`, `excel`, `word` |
| `created_at` | timestamp | |

### Table: `orders`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `conversation_id` | uuid FK | References `conversations.id` |
| `customer_name` | text | Copied from `collected_data` at BOOKED |
| `customer_company` | text | |
| `customer_address` | text | |
| `customer_phone` | text | |
| `items` | jsonb | Array: `[{sku, name, qty, unit_price, subtotal}]` |
| `subtotal` | numeric | Sum of item subtotals |
| `shipping_fee` | numeric | Null until admin fills it in |
| `total` | numeric | `subtotal + shipping_fee`, computed on approval |
| `status` | enum | `PENDING`, `APPROVED`, `CANCELLED`, `COMPLETED` |
| `booking_expires_at` | timestamp | `created_at + 48 hours` |
| `reminder_sent_at` | timestamp | Null until 44hr reminder fires |
| `approved_at` | timestamp | Null until admin approves |
| `created_at` | timestamp | |

### Row-Level Security (RLS) summary

- `conversations`, `messages`, `orders`: Go daemon has full access via service key (bypasses RLS). React reads via anon key — SELECT only by default, with three explicit UPDATE/INSERT exceptions below.
- `messages`: React may INSERT rows where `sender = 'admin'` only.
- `conversations`: React may UPDATE `state` column only, and only to `ESCALATED_ADMIN` or `COLLECTING` (toggle values). All other columns are read-only from the frontend.
- `orders`: React may UPDATE `shipping_fee` and `status` only (for admin approval flow). All other columns are read-only from the frontend.
- `stock_items`: unchanged — React retains full CRUD as today.
- Supabase Realtime publication enabled on: `messages`, `conversations`, `orders`, `whatsapp_numbers`.

---

## 7. Go Daemon Package Structure

```
backend-go/
├── main.go                    # Init all services, wire dependencies, block on OS signal
├── go.mod
│
├── internal/
│   ├── whatsapp/
│   │   ├── client.go          # whatsmeow setup: SQLite auth store, QR flow, pairing code
│   │   ├── handler.go         # WA event handler: dispatch to rules engine then state machine
│   │   └── sender.go          # Send text replies and media via whatsmeow
│   │
│   ├── engine/
│   │   ├── machine.go         # Process(conversation, msg) → reply, nextState
│   │   ├── prompts.go         # System prompt per state, parameterised by language
│   │   └── parser.go          # Unmarshal Gemini JSON → typed struct, validate fields
│   │
│   ├── rules/
│   │   └── escalation.go      # Keyword scan → EscalationType (WIRING / ADMIN / nil)
│   │
│   ├── gemini/
│   │   └── client.go          # GenerateReply(state, history, context) → raw JSON string
│   │
│   ├── db/
│   │   ├── client.go          # Supabase REST client init (URL + service key)
│   │   ├── conversations.go   # GetOrCreate, UpdateState, UpdateCollectedData
│   │   ├── messages.go        # InsertMessage, ListenForAdminMessages
│   │   ├── orders.go          # CreateOrder, UpdateStatus, SetShippingFee
│   │   └── stock.go           # QueryByName, QueryBySKU (read-only)
│   │
│   └── scheduler/
│       └── timeout.go         # Schedule(orderId, 48h), Cancel, RestoreOnBoot
│
└── config/
    └── config.go              # Load env: SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY
```

### Message processing flow (per incoming WA message)

1. `whatsapp/handler.go` receives WA event → extract `senderPhone`, `text`, `waNumberId`. Skip if `IsFromMe` or empty.
2. `rules/escalation.go` scans message text. If keyword match → insert system message, update conversation state, send WA handover reply. **Stop.**
3. `db/conversations.go` GetOrCreate conversation. `db/messages.go` InsertMessage (sender: "customer") → Realtime pushes to Sales Inbox.
4. `engine/machine.go` selects system prompt for current state. Queries stock if needed.
5. `gemini/client.go` calls Gemini with structured output. `engine/parser.go` unmarshals response. On parse failure → safe fallback reply, log error.
6. `engine/machine.go` merges new fields into `collected_data`, computes `nextState`. If `next_action: "ESCALATE"` → override to `ESCALATED_ADMIN`.
7. `db/conversations.go` UpdateState + UpdateCollectedData. `db/messages.go` InsertMessage (sender: "ai"). **State persisted before WA reply.**
8. If state just became `BOOKED`: `db/orders.go` CreateOrder → `scheduler/timeout.go` Schedule(orderId, 48h). Order appears in Dashboard as PENDING.
9. `whatsapp/sender.go` sends AI reply via whatsmeow. Target latency: < 3 seconds end-to-end.

### Daemon restart safety

- **Conversations:** State is in Supabase after every step. On boot, load all non-terminal conversations from DB — state machine resumes transparently.
- **Timeouts:** `scheduler.RestoreOnBoot()` queries all BOOKED orders where `booking_expires_at` is in the future and re-schedules goroutines. No bookings lost on restart.

---

## 8. Booking Timeout System

| Time | Action |
|---|---|
| T+0 (BOOKED) | `scheduler.Schedule(orderId, 48h)` goroutine starts. Stock flagged as reserved. |
| T+44hr | Go sends WhatsApp reminder to customer in their language: *"Pemesanan Anda akan berakhir dalam 4 jam. Balas OK untuk mengkonfirmasi atau pesanan akan dibatalkan."* Updates `orders.reminder_sent_at`. State → `TIMEOUT_REMINDER`. |
| T+48hr | If still BOOKED/TIMEOUT_REMINDER: state → `CANCELLED`. Stock released. `orders.status` → `CANCELLED`. Admin notified via system message in Sales Inbox. |
| Any time (APPROVED) | `scheduler.Cancel(orderId)` stops the goroutine. Timer disarmed. |

---

## 9. React Changes

### SalesInboxScreen.tsx (major)

- Replace static `INITIAL_CHATS` with data from `conversations` + `messages` tables via `useRealtimeConversations()` hook.
- Supabase Realtime subscription on `messages` INSERT → new chat bubbles appear live.
- Supabase Realtime subscription on `conversations` UPDATE → status badges update live.
- Admin reply: React INSERTs to `messages` (sender: "admin") → Go's `db/messages.go ListenForAdminMessages` detects it → `whatsapp/sender.go` forwards to customer WA.
- AI↔Admin toggle: React UPDATEs `conversations.state` to `ESCALATED_ADMIN` (handover to admin) or `COLLECTING` (hand back to AI — Go resumes from data collection with existing `collected_data` intact).
- Media upload: file picker → Supabase Storage bucket `chat-media` → INSERT `messages` row with `media_url` + `media_type` → Go downloads from Storage URL → `whatsapp/sender.go` sends via `SendMedia()`.
- Customer media received: Go uploads to Storage → INSERTs message row → Sales Inbox shows preview → AI sends acknowledgement and auto-escalates to `BUTUH_ADMIN`.

### DashboardScreen.tsx (medium)

- New orders panel: live list of `orders` WHERE `status = 'PENDING'` via Realtime.
- Each order card shows: customer name, company, address, items, subtotal, shipping fee input field, Approve button.
- Admin fills `shipping_fee` → clicks Approve → React UPDATEs `orders.shipping_fee` and `orders.status = 'APPROVED'`.
- Go daemon's `db/orders.go` listener detects APPROVED → generates invoice message → `whatsapp/sender.go` sends WA blast to customer.

### WhatsappAiScreen.tsx (minor)

- Load numbers from `whatsapp_numbers` Supabase table instead of localStorage.
- QR/pairing flow triggers real whatsmeow pairing via a lightweight HTTP endpoint on the Go daemon (the only case where React makes a direct call to Go — avoids Supabase round-trip for interactive pairing).
- Remove Sandbox simulator — real conversations are monitored in Sales Inbox.
- Connection status badge driven by Realtime subscription on `whatsapp_numbers` UPDATE.

### New shared hook: `useRealtimeConversations()`

```typescript
// src/hooks/useRealtimeConversations.ts
export function useRealtimeConversations() {
  // 1. Initial load: conversations + messages + orders from Supabase
  // 2. Subscribe: messages INSERT → append to correct conversation
  // 3. Subscribe: conversations UPDATE → update state/status badge
  // 4. Subscribe: orders INSERT/UPDATE → update dashboard queue
  // 5. Cleanup all subscriptions on unmount
  return { conversations, orders, sendAdminMessage, toggleAiControl }
}
```

### Screens with no changes

`StockManagerScreen`, `UserManagementScreen`, `NotificationSettingsScreen`, `AuthScreen`, `Sidebar`, `App.tsx` routing — zero changes required.

---

## 10. Environment Variables

```env
# Go daemon (.env in backend-go/)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key

# React frontend (.env in project root — already partially configured)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## 11. Out of Scope (covered in Subsystems 2 and 3)

- Dashboard Automation (full invoice generation, bank details, WA blast formatting) → Subsystem 2 spec
- Sales Inbox rich media UI polish, filter enhancements → Subsystem 3 spec
- Multi-language prompt library beyond Bahasa Indonesia and English → future
- WhatsApp Business API (Meta) migration → future
- Payment gateway integration → future
