# H1 — Inbox AI UI/UX Revamp Design

**Date:** 2026-06-03  
**Status:** Approved — ready for implementation

---

## Overview

Revamp `SalesInboxScreen` to match the app's navy design system and give admins full visibility into the AI's progress. The current inbox uses generic blue styling and shows almost no conversation context — admins can't tell at a glance what stage the AI is at, what data has been collected, or whether the AI needs help.

**Tech Stack:** React + TypeScript, Tailwind CSS, Lucide React icons, existing `useRealtimeConversations` hook (no backend changes).  
**Build check:** `npm run build` must pass with zero TypeScript errors after each task.  
**Do NOT touch:** `backend-go/`, any `.sql` migration files, `src/hooks/useRealtimeConversations.ts`.

---

## Architecture

### Modified files only
- `src/components/SalesInboxScreen.tsx` — full rewrite, 3-panel layout

No new files, no new services, no type changes. The hook already exposes everything needed.

---

## Layout — 3-Panel

```
┌─────────────────────────────────────────────────────────────────┐
│ [navy header: Inbox AI · count]                                  │
├──────────────────┬──────────────────────────┬───────────────────┤
│  [search]        │ [navy header: name+phone] │  📋 Konteks       │
│  [filter tabs]   │ [mode banner — full width]│  ─────────────── │
│  ─────────────── │ ─────────────────────────│  Alur: stepper    │
│  conv list       │ messages (bg-[#f8f9ff])   │  ─────────────── │
│  rows with       │                           │  Data Terkumpul   │
│  state chips     │                           │  (adaptive)       │
│                  │                           │  ─────────────── │
│                  │                           │  Pesanan Terkait  │
│                  │                           │  ─────────────── │
│                  │                           │  Follow-up        │
│                  ├──────────────────────────┤                   │
│                  │ [input bar]               │                   │
└──────────────────┴──────────────────────────┴───────────────────┘
```

- Left panel: `w-56 shrink-0`, navy header, gray background
- Center panel: `flex-1 min-w-0`, full flex column
- Right panel: `w-48 shrink-0`, white background

Outer wrapper: `flex h-full` (full height of the page content area).

---

## State & Status Mappings

### Conversation state → display

All 12 backend `ConversationState` values mapped:

```typescript
const CONV_STATE_DISPLAY: Record<string, { label: string; badgeClass: string }> = {
  GREETING:         { label: 'Sapa',            badgeClass: 'bg-violet-100 text-violet-700' },
  COLLECTING:       { label: 'Kumpul Data',      badgeClass: 'bg-blue-100 text-blue-700' },
  CLARIFYING:       { label: 'Klarifikasi',      badgeClass: 'bg-sky-100 text-sky-700' },
  STOCK_CHECK:      { label: 'Cek Stok',         badgeClass: 'bg-cyan-100 text-cyan-700' },
  CONFIRMING:       { label: 'Konfirmasi',        badgeClass: 'bg-amber-100 text-amber-700' },
  BOOKED:           { label: 'Menunggu Bayar',    badgeClass: 'bg-yellow-100 text-yellow-800' },
  TIMEOUT_REMINDER: { label: 'Follow-up',         badgeClass: 'bg-violet-100 text-violet-700' },
  APPROVED:         { label: 'Disetujui',         badgeClass: 'bg-teal-100 text-teal-700' },
  COMPLETED:        { label: 'Selesai',           badgeClass: 'bg-emerald-100 text-emerald-700' },
  CANCELLED:        { label: 'Dibatalkan',        badgeClass: 'bg-gray-100 text-gray-500' },
  ESCALATED_ADMIN:  { label: 'Butuh Admin',       badgeClass: 'bg-red-100 text-red-700' },
  ESCALATED_WIRING: { label: 'Eskalasi Wiring',   badgeClass: 'bg-orange-100 text-orange-700' },
};
```

### Main-path stepper steps (6 steps, index 0–5)

```typescript
const STEPPER_STEPS = [
  { label: 'Sapa',          states: ['GREETING'] },
  { label: 'Kumpul Data',   states: ['COLLECTING', 'CLARIFYING'] },
  { label: 'Cek Stok',      states: ['STOCK_CHECK'] },
  { label: 'Konfirmasi',    states: ['CONFIRMING'] },
  { label: 'Menunggu Bayar',states: ['BOOKED', 'TIMEOUT_REMINDER', 'APPROVED'] },
  { label: 'Selesai',       states: ['COMPLETED'] },
];
// Off-path (shown as badge above stepper, not as a step):
// ESCALATED_ADMIN, ESCALATED_WIRING, CANCELLED
```

```typescript
const OFF_PATH_STATES = new Set(['ESCALATED_ADMIN', 'ESCALATED_WIRING', 'CANCELLED']);
const isOffPath = OFF_PATH_STATES.has(conv.state);
const activeStep = isOffPath ? -1 : STEPPER_STEPS.findIndex(s => s.states.includes(conv.state));
```

Steps before `activeStep` = done (green dot + green line).  
`activeStep` = amber dot with ring + bold label.  
Steps after active = pending (gray dot + gray line).

If `isOffPath === true`: `activeStep` is `-1` so all steps render as pending (gray). The off-path badge above explains the current situation. We don't attempt to reconstruct the last normal state since the hook doesn't expose previous state history.

### Mode banner logic

```typescript
function getModeBanner(conv: ConversationWithMessages): {
  bg: string; text: string; btnLabel: string; makeActive: boolean;
} {
  if (conv.state === 'ESCALATED_ADMIN' || conv.state === 'ESCALATED_WIRING') {
    return { bg: 'bg-red-700', text: `🚨 ${CONV_STATE_DISPLAY[conv.state].label} — AI dijeda otomatis`, btnLabel: 'Ambil Alih', makeActive: false };
  }
  if (!conv.ai_active) {
    return { bg: 'bg-emerald-700', text: '👤 Mode Admin — AI dinonaktifkan', btnLabel: 'Aktifkan AI', makeActive: true };
  }
  return { bg: 'bg-blue-700', text: `🤖 Dikelola AI · ${CONV_STATE_DISPLAY[conv.state]?.label ?? conv.state}`, btnLabel: 'Ambil Alih', makeActive: false };
}
```

Banner sits directly below the navy chat header, full width, with action button on the right.

---

## Left Panel

### Header
```tsx
<div className="bg-[#012749] text-white px-3 py-3 flex items-center gap-2 shrink-0">
  <MessageSquare className="w-4 h-4" />
  <span className="font-bold text-sm">Inbox AI</span>
  <span className="ml-auto bg-white/20 text-xs font-bold px-2 py-0.5 rounded-full">
    {conversations.length}
  </span>
</div>
```

### Search
`bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs` with `Search` icon, inside `p-2 border-b border-gray-100` wrapper.

### Filter tabs
Three pill buttons: **Semua**, **Admin (N)**, **AI (N)** — where N is the live count.
- Active: `bg-[#012749] text-white`
- Inactive: `bg-white border border-gray-200 text-gray-500`

Filter logic:
- Semua: all
- Admin: `state === 'ESCALATED_ADMIN' || state === 'ESCALATED_WIRING' || !ai_active`
- AI: `ai_active && state !== 'ESCALATED_ADMIN' && state !== 'ESCALATED_WIRING'`

### Conversation rows
`divide-y divide-gray-100 flex-1 overflow-y-auto`

Each row `px-3 py-2.5 cursor-pointer hover:bg-gray-50 flex items-start gap-2 border-l-[3px]`:
- Selected: `bg-indigo-50 border-l-[#012749]`
- Unselected: `border-l-transparent`

Row content:
- Avatar: `w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold` — color based on state (red for escalated, blue for AI, gray for done)
- Name: `font-bold text-xs text-gray-800` + preview `text-[10px] text-gray-400 truncate`
- State badge: small pill using `CONV_STATE_DISPLAY[conv.state]` — `text-[8px] font-bold px-1.5 py-0.5 rounded-full`
- Time: `text-[8px] text-gray-300 ml-auto shrink-0`

Display name: `conv.collected_data.name || conv.customer_phone`

---

## Center Panel

### Chat header
```tsx
<div className="bg-[#012749] text-white px-4 py-2.5 flex items-center gap-2.5 shrink-0">
  <div className="w-8 h-8 rounded-full bg-[#2d8a4e] flex items-center justify-center text-xs font-bold shrink-0">
    {initials}
  </div>
  <div className="flex-1 min-w-0">
    <div className="font-bold text-sm truncate">{displayName}</div>
    <div className="text-[10px] opacity-60">{conv.customer_phone}</div>
  </div>
</div>
```

### Mode banner
Full-width bar directly below header. See mode banner logic above.
```tsx
<div className={`${banner.bg} text-white px-4 py-1.5 flex items-center justify-between text-xs shrink-0`}>
  <span>{banner.text}</span>
  <button onClick={() => toggleAiControl(conv.id, banner.makeActive)}
    className="bg-white/20 hover:bg-white/30 rounded-md px-2 py-1 text-[10px] font-bold">
    {banner.btnLabel}
  </button>
</div>
```

### Messages area
`flex-1 overflow-y-auto p-3 bg-[#f8f9ff] flex flex-col gap-2`

**Bubble styles:**
- Customer: `bg-white border border-gray-200 rounded-2xl rounded-tl-none text-gray-800` — left aligned, sender label "Pelanggan" above in `text-[9px] text-gray-400`
- AI: `bg-[#012749] text-white rounded-2xl rounded-tr-none` — right aligned, sender label "🤖 AI"
- Admin: `bg-[#2d8a4e] text-white rounded-2xl rounded-tr-none` — right aligned, sender label "👤 Admin"
- System: centered, `text-[9px] text-gray-400 italic py-1`

Timestamp: `text-[8px] opacity-60 mt-1 text-right` inside each bubble.

Each bubble `max-w-[68%] px-3 py-2 text-xs leading-relaxed`.

Auto-scroll to bottom on new messages and on conversation switch.

### Input bar
`bg-white border-t border-gray-200 px-3 py-2 flex items-center gap-2 shrink-0`
- Attach button: `PlusCircle` icon, `text-gray-400 hover:text-gray-600`
- Input: `flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#012749]`
- Send button: `bg-[#012749] text-white rounded-lg p-1.5 disabled:opacity-40` with `Send` icon

Hidden `<input type="file">` for attach, same as current.

---

## Right Panel

### Header
`bg-gray-50 border-b border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 shrink-0`
Text: "📋 Konteks Percakapan"

### Section 1 — Alur Percakapan (stepper)

Off-path badge (if applicable): shown *above* the stepper steps.
```tsx
{isOffPath && (
  <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full mb-2 inline-block ${CONV_STATE_DISPLAY[conv.state].badgeClass}`}>
    {CONV_STATE_DISPLAY[conv.state].label}
  </div>
)}
```

Stepper:
```tsx
{STEPPER_STEPS.map((step, i) => {
  const isDone = activeStep > i;
  const isActive = activeStep === i;
  return (
    <div key={i} className="flex items-start gap-2">
      <div className="flex flex-col items-center">
        <div className={`w-2 h-2 rounded-full mt-0.5 shrink-0 ${
          isDone ? 'bg-[#2d8a4e]' : isActive ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-gray-200'
        }`} />
        {i < STEPPER_STEPS.length - 1 && (
          <div className={`w-px flex-1 min-h-[10px] ${isDone ? 'bg-[#2d8a4e]' : 'bg-gray-200'}`} />
        )}
      </div>
      <div className={`text-[9px] pb-2 ${
        isDone ? 'text-gray-400' : isActive ? 'font-bold text-amber-700' : 'text-gray-300'
      }`}>
        {step.label}
        {isActive && ' ◀'}
      </div>
    </div>
  );
})}
```

### Section 2 — Data Terkumpul (adaptive)

Only render fields that have a non-empty value. Fields checked in order:
1. `name` → `👤`
2. `company` → `🏢`
3. `product` + `quantity` → `📦` (e.g. "Panel 200W × 2")
4. `address` → `📍`
5. `specs.size` / `specs.color` / `specs.notes` → `📐` (joined, only if any spec exists)

If no fields filled: show `text-[9px] text-gray-400 italic` "Data belum terkumpul."

Each field row: `flex items-start gap-1.5 mb-1 text-[9px]`
- Icon span `text-[10px] flex-shrink-0`
- Value span `text-gray-700 font-medium leading-snug`

### Section 3 — Pesanan Terkait

Find matching order: `[...orders, ...paymentUploadedOrders].find(o => o.conversation_id === conv.id)`.

If found:
- `gjp_order_id ?? id.slice(0, 8)`: `font-mono text-[10px] font-bold text-[#012749]`
- Amount: `text-sm font-extrabold text-[#2d8a4e]`
- Status label from `CONV_STATE_DISPLAY` or a small order-status map: `text-[9px] text-gray-400`

If not found: `text-[9px] text-gray-400 italic` "Belum ada pesanan."

### Section 4 — Follow-up Otomatis

```tsx
<div className="text-xs font-bold text-gray-700">{conv.followup_count_today} / 2</div>
<div className="text-[9px] text-gray-400 mt-0.5">terkirim hari ini</div>
```

### Empty state (no conversation selected)

When `!activeChat`:
```tsx
<div className="flex-1 flex items-center justify-center text-gray-300">
  <div className="text-center">
    <MessageSquare className="w-10 h-10 mx-auto mb-2" />
    <p className="text-sm font-semibold text-gray-400">Pilih percakapan untuk mulai</p>
  </div>
</div>
```
Right panel also shows the empty state (just the header + "—" in each section).

---

## Empty & Loading States

| Condition | Behavior |
|-----------|----------|
| `loading === true` | Center of screen: "Memuat percakapan..." |
| No conversations | Left panel: "Belum ada percakapan." centered |
| Search returns nothing | "Tidak ada percakapan yang cocok." |
| `!isSupabaseConfigured` | Yellow warning card (same pattern as other screens) |

---

## Out of Scope

- Approving orders or verifying payments from the inbox (handled in Order History)
- Editing collected data from the admin UI
- Pagination of conversation list (limited to 20 by hook)
- Read receipts / delivery status
- Pinning or archiving conversations
