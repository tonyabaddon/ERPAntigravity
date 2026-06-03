# WhatsApp AI Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs: (1) show the connected WhatsApp phone number in the UI, and (2) stop the "Maaf, saya mengalami kendala teknis" error that fires when a customer messages after their order is booked.

**Architecture:** Issue 1 is a one-line backend addition + small UI change. Issue 2 requires adding an early-return intercept in `processMessage()` before the state machine is invoked — the root cause is that `StateBooked` is not terminal, so the machine is called with an invalid prompt, Gemini returns an empty response, and `FallbackReply()` fires.

**Tech Stack:** Go (backend), React + TypeScript (frontend), whatsmeow JID type for phone extraction.

---

## File Map

| File | What changes |
|------|-------------|
| `backend-go/main.go` | `/api/wa/qr` handler: add `phone` field when connected |
| `src/components/WhatsappAiScreen.tsx` | Store `waPhone` from API; display it in the connected UI block |
| `backend-go/internal/whatsapp/handler.go` | `processMessage()`: intercept `StateBooked` / `StateTimeoutReminder` before state machine call |
| `backend-go/internal/engine/machine_test.go` | Add test proving BOOKED state returns empty result from machine (documents why handler fix is needed) |

---

## Task 1: Backend — expose phone number in `/api/wa/qr`

**Files:**
- Modify: `backend-go/main.go` (the `/api/wa/qr` handler, lines ~151-160)

- [ ] **Step 1: Open `backend-go/main.go` and find the `/api/wa/qr` handler**

The handler currently looks like this:

```go
mux.HandleFunc("/api/wa/qr", func(w http.ResponseWriter, r *http.Request) {
    enableCors(&w)
    w.Header().Set("Content-Type", "application/json")
    qr := waClient.GetQR()
    paired := waClient.WA.Store.ID != nil
    json.NewEncoder(w).Encode(map[string]interface{}{
        "qr":        qr,
        "connected": paired,
    })
})
```

- [ ] **Step 2: Add phone extraction and include it in the response**

Replace the handler body with:

```go
mux.HandleFunc("/api/wa/qr", func(w http.ResponseWriter, r *http.Request) {
    enableCors(&w)
    w.Header().Set("Content-Type", "application/json")
    qr := waClient.GetQR()
    paired := waClient.WA.Store.ID != nil
    phone := ""
    if paired {
        phone = waClient.WA.Store.ID.User
    }
    json.NewEncoder(w).Encode(map[string]interface{}{
        "qr":        qr,
        "connected": paired,
        "phone":     phone,
    })
})
```

`Store.ID.User` is the phone digits without `+`, e.g. `6281234567890`. It is an empty string when not paired so the field is always safe to include.

- [ ] **Step 3: Build to verify no compile errors**

```bash
cd backend-go && go build ./...
```

Expected: no output (clean build).

- [ ] **Step 4: Commit**

```bash
git add backend-go/main.go
git commit -m "feat(api): expose connected phone number in /api/wa/qr response"
```

---

## Task 2: Frontend — display phone number when WhatsApp is connected

**Files:**
- Modify: `src/components/WhatsappAiScreen.tsx`

- [ ] **Step 1: Add `waPhone` state variable**

Find the existing state declarations near the top of the component (around line 46-50). The block looks like:

```tsx
const [qrCode, setQrCode] = useState<string>('');
const [waConnected, setWaConnected] = useState(false);
const [daemonOnline, setDaemonOnline] = useState(false);
const [qrLoading, setQrLoading] = useState(false);
```

Add `waPhone` after `daemonOnline`:

```tsx
const [qrCode, setQrCode] = useState<string>('');
const [waConnected, setWaConnected] = useState(false);
const [waPhone, setWaPhone] = useState<string>('');
const [daemonOnline, setDaemonOnline] = useState(false);
const [qrLoading, setQrLoading] = useState(false);
```

- [ ] **Step 2: Extract `phone` from the QR API response in `fetchQR`**

Find the `fetchQR` function (~line 99). The current fetch block is:

```tsx
const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/wa/qr`);
const data = await res.json();
setDaemonOnline(true);
setWaConnected(data.connected);
setQrCode(data.qr || '');
```

Add `setWaPhone` after `setWaConnected`:

```tsx
const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/wa/qr`);
const data = await res.json();
setDaemonOnline(true);
setWaConnected(data.connected);
setWaPhone(data.phone || '');
setQrCode(data.qr || '');
```

- [ ] **Step 3: Display phone number in the "BERHASIL TERSAMBUNG" UI block**

Find the connected state block (~line 313-325):

```tsx
{waConnected && (
  <div className="text-center space-y-3">
    <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto animate-bounce shrink-0" />
    <h4 className="font-extrabold text-[#012749] text-xs">BERHASIL TERSAMBUNG</h4>
    <p className="text-[10px] text-gray-400">whatsmeow session tersimpan di wa_store.db</p>
    <button
      onClick={handleLogout}
      ...
    >
```

Add the phone number line between the title and the session note:

```tsx
{waConnected && (
  <div className="text-center space-y-3">
    <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto animate-bounce shrink-0" />
    <h4 className="font-extrabold text-[#012749] text-xs">BERHASIL TERSAMBUNG</h4>
    {waPhone && (
      <p className="text-xs font-black text-emerald-600 tracking-tight">+{waPhone}</p>
    )}
    <p className="text-[10px] text-gray-400">whatsmeow session tersimpan di wa_store.db</p>
    <button
      onClick={handleLogout}
      ...
    >
```

- [ ] **Step 4: Build frontend to verify no TypeScript errors**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: build completes with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/WhatsappAiScreen.tsx
git commit -m "feat(ui): show connected WhatsApp phone number in WhatsApp AI screen"
```

---

## Task 3: Backend — fix "kendala teknis" for BOOKED state

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go` (`processMessage` function)
- Modify: `backend-go/internal/engine/machine_test.go` (add BOOKED state regression test)

### 3a — Add regression test to document the problem

- [ ] **Step 1: Add test to `backend-go/internal/engine/machine_test.go`**

Open the file and add this test at the end (before the final closing brace if any, but this file has no wrapper — just append):

```go
func TestProcessBookedStateReturnsEmptyReply(t *testing.T) {
	// BOOKED state has no case in the machine switch — it must never reach
	// machine.Process() in production. This test documents that if it does,
	// the machine returns an empty reply (not a fallback error), confirming
	// the handler-level intercept in processMessage() is the correct fix.
	m := newTestMachine(`{"reply":"some response"}`)
	conv := &models.Conversation{State: models.StateBooked, Language: "id"}
	result, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Reply != "" {
		t.Errorf("BOOKED state should produce no reply from machine, got: %s", result.Reply)
	}
	if result.NextState != models.StateBooked {
		t.Errorf("BOOKED state should remain BOOKED, got %s", result.NextState)
	}
}
```

- [ ] **Step 2: Run the test to verify it passes (machine already behaves this way)**

```bash
cd backend-go && go test ./internal/engine/... -run TestProcessBookedStateReturnsEmptyReply -v
```

Expected output:
```
--- PASS: TestProcessBookedStateReturnsEmptyReply (0.00s)
PASS
```

### 3b — Add the handler-level intercept

- [ ] **Step 3: Open `backend-go/internal/whatsapp/handler.go` and find `processMessage`**

Locate step 5 in `processMessage()` (around line 112):

```go
// 5. Terminal state — ignore further messages
if conv.State.IsTerminal() {
    return
}
```

- [ ] **Step 4: Add the BOOKED/TIMEOUT_REMINDER intercept immediately before step 5**

Insert these lines so the full block reads:

```go
// 5a. Post-booking holding states — send static status message, never invoke Gemini.
//     Without this, the machine is called with an unknown-state prompt, Gemini returns
//     an empty response, and FallbackReply fires ("kendala teknis").
if conv.State == models.StateBooked || conv.State == models.StateTimeoutReminder {
    reply := "Pesanan Anda sedang menunggu konfirmasi dari tim admin kami. Mohon ditunggu sebentar ya 🙏"
    if conv.Language == "en" {
        reply = "Your order is awaiting confirmation from our admin team. Please wait a moment 🙏"
    }
    h.db.InsertMessage(conv.ID, models.SenderAI, reply)
    if err := h.sender.SendText(ctx, senderPhone, reply); err != nil {
        log.Printf("[HANDLER] BOOKED holding reply send error: %v", err)
    }
    return
}

// 5. Terminal state — ignore further messages
if conv.State.IsTerminal() {
    return
}
```

- [ ] **Step 5: Build and run all tests**

```bash
cd backend-go && go build ./... && go test ./...
```

Expected: clean build, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go backend-go/internal/engine/machine_test.go
git commit -m "fix(wa): intercept BOOKED state in handler to prevent kendala teknis error

When a customer messages after booking, the state machine was called with
an unknown-state prompt, causing Gemini to return an empty response and
FallbackReply to fire. Now BOOKED/TIMEOUT_REMINDER send a static holding
message without invoking Gemini."
```

---

## Task 4: Update progress.md

- [ ] **Step 1: Update `progress.md` to record both fixes**

Open `progress.md` and add an entry describing:
- Issue 1 fixed: connected WhatsApp phone number now shown in UI
- Issue 2 fixed: "kendala teknis" on BOOKED state eliminated by handler-level intercept

- [ ] **Step 2: Commit**

```bash
git add progress.md
git commit -m "chore: update progress.md with WhatsApp AI bug fixes"
```
