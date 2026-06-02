# Frontend D3: Conversation Inbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update SalesInboxScreen so conversation status badges reflect real DB states (BOOKED, WAITING_PAYMENT, etc.), the AI toggle correctly sets `ai_active`, the "Butuh Admin" filter includes `ai_active = false` conversations, follow-up counts are visible, and an order context bar appears when the active conversation has a linked order.

**Architecture:** All changes are in `src/components/SalesInboxScreen.tsx`. The hook already provides `paymentUploadedOrders` and the corrected `toggleAiControl` after D1. This plan replaces `stateToStatus()` with `getStatusInfo()`, updates the filter, updates the toggle call site, and adds two new UI elements (follow-up indicator, order context bar).

**Tech Stack:** React, TypeScript, Tailwind CSS

**Prerequisite:** D1 must be complete. `npm run build` must pass before starting.

---

## File Map

| File | Change |
|---|---|
| `src/components/SalesInboxScreen.tsx` | Replace status logic, fix filter, fix toggle, add follow-up indicator, add order context bar |

---

### Task 1: Replace `stateToStatus` with `getStatusInfo` and update status badges

**Files:**
- Modify: `src/components/SalesInboxScreen.tsx`

**Context:** The current `stateToStatus(state: string)` function maps only 3 values and returns an intermediate string — everything from BOOKED to COMPLETED shows as "Dikelola AI". The replacement `getStatusInfo(conv)` takes the full conversation object so it can also check `conv.ai_active`, and returns a direct `{ label, className }` shape used inline in JSX.

- [ ] **Step 1: Remove `stateToStatus` and add `getStatusInfo`**

In `src/components/SalesInboxScreen.tsx`, delete the entire `stateToStatus` function (lines 36–39):

```typescript
  const stateToStatus = (state: string) => {
    if (state === 'ESCALATED_ADMIN') return 'BUTUH_ADMIN';
    if (state === 'ESCALATED_WIRING') return 'WIRING_CUSTOM';
    return 'DIKELOLA_AI';
  };
```

Replace it with `getStatusInfo` (this is a standalone function, not inside the component — place it just above the component definition, before `export default function SalesInboxScreen`):

```typescript
function getStatusInfo(conv: ConversationWithMessages): { label: string; className: string } {
  const s = conv.state;
  if (s === 'ESCALATED_ADMIN') return { label: 'Butuh Admin', className: 'bg-red-100 text-red-700' };
  if (s === 'ESCALATED_WIRING') return { label: 'Wiring', className: 'bg-yellow-100 text-yellow-700' };
  if (s === 'BOOKED' || s === 'WAITING_PAYMENT' || s === 'PAYMENT_UPLOADED')
    return { label: 'Menunggu Bayar', className: 'bg-amber-100 text-amber-700' };
  if (s === 'PAYMENT_VERIFIED' || s === 'COMPLETED')
    return { label: 'Selesai', className: 'bg-emerald-100 text-emerald-700' };
  if (s === 'CANCELLED')
    return { label: 'Batal', className: 'bg-gray-100 text-gray-500' };
  if (!conv.ai_active)
    return { label: 'Manual', className: 'bg-orange-100 text-orange-700' };
  return { label: 'AI', className: 'bg-blue-100 text-blue-700' };
}
```

- [ ] **Step 2: Replace the `statusBadge` function**

Delete the existing `statusBadge` function inside the component (lines 84–101):

```typescript
  const statusBadge = (state: string) => {
    const status = stateToStatus(state);
    const styles: Record<string, string> = { ... };
    const labels: Record<string, string> = { ... };
    return (<span ...>{labels[status]}</span>);
  };
```

Replace with:

```typescript
  const statusBadge = (conv: ConversationWithMessages) => {
    const { label, className } = getStatusInfo(conv);
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${className}`}>
        {label}
      </span>
    );
  };
```

- [ ] **Step 3: Update all `statusBadge(conv.state)` call sites**

Search the file for `statusBadge(` — there are 2 call sites:
- In the conversation list item (sidebar): `{statusBadge(conv.state)}` → `{statusBadge(conv)}`
- In the chat panel header: `{statusBadge(activeChat.state)}` → `{statusBadge(activeChat)}`

Make both changes.

- [ ] **Step 4: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SalesInboxScreen.tsx
git commit -m "fix(inbox): replace stateToStatus with getStatusInfo for accurate conversation state badges"
```

---

### Task 2: Fix the filter and AI toggle button

**Files:**
- Modify: `src/components/SalesInboxScreen.tsx`

**Context:** Two fixes needed:
1. The "Butuh Admin" filter only checks `state === ESCALATED_ADMIN/WIRING` but misses conversations where `ai_active = false` (admin has taken manual control without state being ESCALATED).
2. `handleToggleAi` passes `(convId, currentState)` to `toggleAiControl`, but after D1 the hook's `toggleAiControl` expects `(conversationId, makeActive: boolean)`.

- [ ] **Step 1: Fix `filteredChats` — update "Butuh Admin" filter**

Find the `filteredChats` filter block (around line 42). Replace the `activeFilter === 'Butuh Admin'` branch:

```typescript
    if (activeFilter === 'Butuh Admin') return status === 'BUTUH_ADMIN' || status === 'WIRING_CUSTOM';
```

With:

```typescript
    if (activeFilter === 'Butuh Admin') {
      return conv.state === 'ESCALATED_ADMIN' || conv.state === 'ESCALATED_WIRING' || !conv.ai_active;
    }
```

Also remove the `stateToStatus` call that computed `status` at the top of the filter callback since the filter now uses `conv.state` and `conv.ai_active` directly. The full updated `filteredChats` should be:

```typescript
  const filteredChats = conversations.filter(conv => {
    if (searchQuery && !conv.customer_phone.includes(searchQuery) &&
        !(conv.collected_data.name ?? '').toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (activeFilter === 'Semua') return true;
    if (activeFilter === 'Butuh Admin') {
      return conv.state === 'ESCALATED_ADMIN' || conv.state === 'ESCALATED_WIRING' || !conv.ai_active;
    }
    if (activeFilter === 'Dikelola AI') return conv.ai_active &&
      conv.state !== 'ESCALATED_ADMIN' && conv.state !== 'ESCALATED_WIRING';
    return true;
  });
```

- [ ] **Step 2: Fix `handleToggleAi`**

Replace the existing `handleToggleAi` function (lines 68–71):

```typescript
  const handleToggleAi = async (convId: string, currentState: string) => {
    const isAdminControlled = currentState === 'ESCALATED_ADMIN' || currentState === 'ESCALATED_WIRING';
    await toggleAiControl(convId, !isAdminControlled);
  };
```

With:

```typescript
  const handleToggleAi = async (conv: ConversationWithMessages) => {
    await toggleAiControl(conv.id, !conv.ai_active);
  };
```

- [ ] **Step 3: Update the toggle button's `onClick` and `title`**

Find the toggle button in the chat panel header (around line 174):

```tsx
              <button
                onClick={() => handleToggleAi(activeChat.id, activeChat.state)}
                title={activeChat.state === 'ESCALATED_ADMIN' ? 'Kembalikan ke AI' : 'Alihkan ke Admin'}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              >
```

Replace with:

```tsx
              <button
                onClick={() => handleToggleAi(activeChat)}
                title={activeChat.ai_active ? 'Alihkan ke Admin (Nonaktifkan AI)' : 'Aktifkan AI kembali'}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              >
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SalesInboxScreen.tsx
git commit -m "fix(inbox): correct Butuh Admin filter to include ai_active=false, fix handleToggleAi signature"
```

---

### Task 3: Add follow-up count indicator

**Files:**
- Modify: `src/components/SalesInboxScreen.tsx`

**Context:** The backend's follow-up poller sends up to 2 automated follow-up WhatsApp messages per day to silent conversations. `followup_count_today` on `DbConversation` tracks how many have been sent today. Showing this in the inbox tells the admin at a glance which customers have already been followed up automatically.

- [ ] **Step 1: Add follow-up badge in the conversation list item**

In the sidebar conversation list, find the `<div className="flex items-center justify-between gap-1">` block that contains the customer name and status badge. It looks like:

```tsx
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium text-sm truncate">{getDisplayName(conv)}</span>
                  {statusBadge(conv)}
                </div>
```

Add the follow-up indicator after `{statusBadge(conv)}`:

```tsx
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium text-sm truncate">{getDisplayName(conv)}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {statusBadge(conv)}
                    {conv.followup_count_today > 0 && (
                      <span className="text-xs text-gray-400" title={`${conv.followup_count_today} follow-up otomatis terkirim hari ini`}>
                        ↩{conv.followup_count_today}/2
                      </span>
                    )}
                  </div>
                </div>
```

- [ ] **Step 2: Add follow-up badge in the chat panel header**

Find the chat panel header (around line 162), the section that shows `statusBadge(activeChat)` and the toggle button. Add the follow-up count display between the status badge and the toggle button:

```tsx
              <div className="flex items-center gap-2">
                {statusBadge(activeChat)}
                {activeChat.followup_count_today > 0 && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    Follow-up: {activeChat.followup_count_today}/2 terkirim
                  </span>
                )}
                <button
                  onClick={() => handleToggleAi(activeChat)}
                  title={activeChat.ai_active ? 'Alihkan ke Admin (Nonaktifkan AI)' : 'Aktifkan AI kembali'}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                </button>
              </div>
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SalesInboxScreen.tsx
git commit -m "feat(inbox): show followup_count_today indicator in conversation list and chat header"
```

---

### Task 4: Add order context bar in the chat panel

**Files:**
- Modify: `src/components/SalesInboxScreen.tsx`

**Context:** When a conversation has an associated order (e.g. it's in BOOKED or WAITING_PAYMENT state), the admin should be able to see the order ID, total, and current status at a glance without leaving the inbox. The hook already exposes `orders` (PENDING_ADMIN_CONFIRMATION) and `paymentUploadedOrders` (PAYMENT_UPLOADED). We combine both to find if the active conversation has a linked order.

- [ ] **Step 1: Destructure `paymentUploadedOrders` from the hook**

Find the hook destructure at the top of `SalesInboxScreen` (around line 13):

```typescript
  const { conversations, sendAdminMessage, sendAdminMedia, toggleAiControl, loading } = useRealtimeConversations();
```

Replace with:

```typescript
  const { conversations, orders, paymentUploadedOrders, sendAdminMessage, sendAdminMedia, toggleAiControl, loading } = useRealtimeConversations();
```

- [ ] **Step 2: Compute `activeOrder`**

After `const activeChat = conversations.find(c => c.id === activeChatId);` (around line 22), add:

```typescript
  const allOrders = [...orders, ...paymentUploadedOrders];
  const activeOrder = allOrders.find(o => o.conversation_id === activeChatId);
```

- [ ] **Step 3: Add the order context bar below the chat header**

In the chat panel JSX, find the closing `</div>` of the chat header section (the block with `flex items-center justify-between px-4 py-3 border-b bg-white`). Immediately after it, add the order context bar:

```tsx
          {/* Order context bar */}
          {activeOrder && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between text-xs">
              <span className="font-semibold text-amber-800">
                {activeOrder.gjp_order_id ?? 'Pesanan'} · Rp {activeOrder.total.toLocaleString('id-ID')}
              </span>
              <span className={`px-2 py-0.5 rounded-full font-bold ${
                activeOrder.status === 'PAYMENT_UPLOADED'
                  ? 'bg-amber-200 text-amber-900'
                  : 'bg-blue-100 text-blue-800'
              }`}>
                {activeOrder.status.replace(/_/g, ' ')}
              </span>
            </div>
          )}
```

- [ ] **Step 4: Verify build — zero errors**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SalesInboxScreen.tsx
git commit -m "feat(inbox): add order context bar showing gjp_order_id and status for active conversation"
```

---

## D3 Complete

After all 4 tasks: `npm run build` passes with zero errors.

**Manual smoke test:**
1. Open Sales Inbox — conversations load from Supabase
2. Click a conversation in ESCALATED_ADMIN state — badge should show "Butuh Admin" (red)
3. Click a conversation in BOOKED state — badge should show "Menunggu Bayar" (amber)
4. Conversations where `ai_active = false` should show "Manual" (orange) unless they're ESCALATED
5. Click the AI toggle on a conversation — verify `conversations.ai_active` changes in Supabase table editor
6. A conversation with `followup_count_today = 1` should show "↩1/2" in the list and "Follow-up: 1/2 terkirim" in the header
7. If the active conversation has a linked order in PAYMENT_UPLOADED status — the amber order context bar should appear below the chat header
