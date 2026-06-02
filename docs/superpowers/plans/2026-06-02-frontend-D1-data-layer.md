# Frontend D1: Data & Query Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all TypeScript type definitions, Supabase query functions, and the Realtime hook so the data layer correctly reflects the live backend schema — no UI changes.

**Architecture:** Three files touched in dependency order: types first (everything imports from it), then supabaseClient (depends on types), then the hook (depends on both). Each task is independently buildable. After D1, sub-projects D2, D3, and D4 can be implemented in any order.

**Tech Stack:** TypeScript, `@supabase/supabase-js`, React hooks

**Build check after every task:** `cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build`

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Expand `DbOrder.status`, add missing `DbOrder` fields, add missing `DbConversation` fields |
| `src/lib/supabaseClient.ts` | Fix `fetchPendingOrders`, fix `toggleAiControl`, add 3 new order functions |
| `src/hooks/useRealtimeConversations.ts` | Add `paymentUploadedOrders` state, fix 2 Realtime listeners, expose 3 new functions |

---

### Task 1: Fix `src/types.ts` — DbConversation and DbOrder

**Files:**
- Modify: `src/types.ts:87–136`

**Context:** `DbConversation` (line 87) is missing `ai_active`, `last_ai_message_at`, `followup_count_today`, `last_followup_date`. `DbOrder` (line 116) has a stale 4-value `status` union and is missing 7 fields that exist in the Go backend `Order` struct.

- [ ] **Step 1: Replace the `DbConversation` interface**

Open `src/types.ts`. Replace the entire `DbConversation` interface (lines 87–104) with:

```typescript
export interface DbConversation {
  id: string;
  wa_number_id: string;
  customer_phone: string;
  state: ConversationState;
  language: string;
  collected_data: {
    name?: string;
    company?: string;
    address?: string;
    product?: string;
    quantity?: number;
    specs?: { size?: string; color?: string; notes?: string };
  };
  clarification_round: number;
  ai_active: boolean;
  last_ai_message_at?: string;
  followup_count_today: number;
  last_followup_date?: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Replace the `DbOrder` interface**

Replace the entire `DbOrder` interface (lines 116–136) with:

```typescript
export interface DbOrder {
  id: string;
  conversation_id: string;
  customer_name: string;
  customer_company: string;
  customer_address: string;
  customer_phone: string;
  items: Array<{
    sku: string;
    name: string;
    qty: number;
    unit_price: number;
    subtotal: number;
  }>;
  subtotal: number;
  shipping_fee?: number;
  total: number;
  status:
    | 'PENDING_ADMIN_CONFIRMATION'
    | 'PENDING_PRICE_NEGO'
    | 'PENDING_STOCK_CHECK'
    | 'PENDING_CUSTOM_QUOTE'
    | 'PENDING_WIRING_QUOTE'
    | 'APPROVED'
    | 'WAITING_PAYMENT'
    | 'PAYMENT_UPLOADED'
    | 'PAYMENT_VERIFIED'
    | 'PAYMENT_REJECTED'
    | 'CANCELLED'
    | 'COMPLETED';
  booking_expires_at: string;
  gjp_order_id?: string;
  order_type?: 'STANDARD' | 'CUSTOM_PANEL' | 'WIRING_PANEL';
  delivery_type?: 'PICKUP' | 'DELIVERY';
  payment_proof_url?: string;
  payment_verified_at?: string;
  verified_by?: string;
  updated_at: string;
}
```

- [ ] **Step 3: Verify build passes**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: build succeeds, zero TypeScript errors. If you see errors about `status` comparisons (e.g. `'PENDING' is not assignable`), those will be fixed in later tasks — for now just confirm the types file itself compiles.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "fix(types): expand DbOrder.status and add missing fields to DbOrder and DbConversation"
```

---

### Task 2: Fix `fetchPendingOrders` and `toggleAiControl` in supabaseClient.ts

**Files:**
- Modify: `src/lib/supabaseClient.ts:118–126` (toggleAiControl)
- Modify: `src/lib/supabaseClient.ts:150–159` (fetchPendingOrders)

**Context:** `fetchPendingOrders` queries `.eq('status', 'PENDING')` — the actual DB value is `'PENDING_ADMIN_CONFIRMATION'`. `toggleAiControl` updates the `state` column with invented string values (`'ESCALATED_ADMIN'`/`'COLLECTING'`) instead of setting the `ai_active` boolean column.

- [ ] **Step 1: Fix `toggleAiControl`**

In `src/lib/supabaseClient.ts`, replace the entire `toggleAiControl` method (lines 118–126) with:

```typescript
  async toggleAiControl(conversationId: string, makeActive: boolean): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('conversations')
      .update({ ai_active: makeActive })
      .eq('id', conversationId);
    if (error) throw error;
  },
```

Note: the parameter changed from `handOver: boolean` to `makeActive: boolean`. `makeActive = true` turns AI on; `makeActive = false` gives admin control. Any call site that passed `handOver` must pass `!currentAiActive` instead — the hook in Task 4 handles this.

- [ ] **Step 2: Fix `fetchPendingOrders`**

In `src/lib/supabaseClient.ts`, change line 155 from:

```typescript
    .eq('status', 'PENDING')
```

to:

```typescript
    .eq('status', 'PENDING_ADMIN_CONFIRMATION')
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero errors. The hook still calls `toggleAiControl(conversationId, handOver)` with the old signature — that will cause a TS error until Task 4. If you see exactly that error, it's expected; fix it now by temporarily updating the hook call to use the new signature: in `src/hooks/useRealtimeConversations.ts` line 134, change `conversationService.toggleAiControl(conversationId, handOver)` to `conversationService.toggleAiControl(conversationId, !handOver)` as a placeholder. Task 4 will replace the entire hook wrapper properly.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "fix(supabase): correct fetchPendingOrders status filter and toggleAiControl to use ai_active"
```

---

### Task 3: Add payment functions to `supabaseClient.ts`

**Files:**
- Modify: `src/lib/supabaseClient.ts` — add 3 methods to `orderService`

**Context:** The admin needs to fetch orders with `status = 'PAYMENT_UPLOADED'`, and to verify or reject them. The Go backend listens for `pg_notify('order_payment_verified', ...)` and `order_payment_rejected` — these are triggered by DB triggers when the status column changes to those values. The frontend just updates the status column; the backend handles the rest automatically.

- [ ] **Step 1: Add `fetchPaymentUploadedOrders` to `orderService`**

In `src/lib/supabaseClient.ts`, inside the `orderService` object (after the `approveOrder` method closing brace), add:

```typescript
  async fetchPaymentUploadedOrders(): Promise<DbOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'PAYMENT_UPLOADED')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async verifyPayment(orderId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ status: 'PAYMENT_VERIFIED', payment_verified_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) throw error;
  },

  async rejectPayment(orderId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ status: 'PAYMENT_REJECTED' })
      .eq('id', orderId);
    if (error) throw error;
  },
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero errors (or only the temporary hook error from Task 2 Step 3 if you didn't fix it yet — fix it now if so).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(supabase): add fetchPaymentUploadedOrders, verifyPayment, rejectPayment to orderService"
```

---

### Task 4: Fix `useRealtimeConversations.ts` hook

**Files:**
- Modify: `src/hooks/useRealtimeConversations.ts`

**Context:** The hook needs to: (1) add a second `paymentUploadedOrders` state loaded on mount, (2) fix both Realtime listeners to use the correct status values, (3) expose `verifyPayment` and `rejectPayment` wrappers, and (4) update the `toggleAiControl` wrapper to use the new `makeActive` signature.

- [ ] **Step 1: Add `paymentUploadedOrders` state**

In `src/hooks/useRealtimeConversations.ts`, after line 12 (`const [orders, setOrders] = useState<DbOrder[]>([])`), add:

```typescript
  const [paymentUploadedOrders, setPaymentUploadedOrders] = useState<DbOrder[]>([]);
```

- [ ] **Step 2: Load payment uploaded orders on mount**

Replace the `Promise.all` call inside the `load()` function (lines 23–26) with:

```typescript
      const [convs, pendingOrders, paymentOrders] = await Promise.all([
        conversationService.fetchConversations(),
        orderService.fetchPendingOrders(),
        orderService.fetchPaymentUploadedOrders(),
      ]);
      if (!mounted) return;
```

After `setOrders(pendingOrders)`, add:

```typescript
      setPaymentUploadedOrders(paymentOrders);
```

- [ ] **Step 3: Fix the orders INSERT Realtime listener**

Replace lines 91–96 (the INSERT handler body) with:

```typescript
        (payload) => {
          const newOrder = payload.new as DbOrder;
          if (newOrder.status === 'PENDING_ADMIN_CONFIRMATION') {
            setOrders(prev => [...prev, newOrder]);
          } else if (newOrder.status === 'PAYMENT_UPLOADED') {
            setPaymentUploadedOrders(prev => [...prev, newOrder]);
          }
        })
```

- [ ] **Step 4: Fix the orders UPDATE Realtime listener**

Replace lines 98–106 (the UPDATE handler body) with:

```typescript
        (payload) => {
          const updatedOrder = payload.new as DbOrder;
          // Manage pending-approval list
          if (updatedOrder.status === 'PENDING_ADMIN_CONFIRMATION') {
            setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
          } else {
            setOrders(prev => prev.filter(o => o.id !== updatedOrder.id));
          }
          // Manage payment-uploaded list
          if (updatedOrder.status === 'PAYMENT_UPLOADED') {
            setPaymentUploadedOrders(prev =>
              prev.some(o => o.id === updatedOrder.id)
                ? prev.map(o => o.id === updatedOrder.id ? updatedOrder : o)
                : [...prev, updatedOrder]
            );
          } else {
            setPaymentUploadedOrders(prev => prev.filter(o => o.id !== updatedOrder.id));
          }
        })
```

- [ ] **Step 5: Update `toggleAiControl` wrapper and add new wrappers**

Replace lines 133–135 (the `toggleAiControl` function) with:

```typescript
  const toggleAiControl = async (conversationId: string, makeActive: boolean): Promise<void> => {
    await conversationService.toggleAiControl(conversationId, makeActive);
  };

  const verifyPayment = async (orderId: string): Promise<void> => {
    await orderService.verifyPayment(orderId);
  };

  const rejectPayment = async (orderId: string): Promise<void> => {
    await orderService.rejectPayment(orderId);
  };
```

- [ ] **Step 6: Update the hook's return value**

Replace the `return { ... }` block at the bottom of the hook with:

```typescript
  return {
    conversations,
    orders,
    paymentUploadedOrders,
    loading,
    sendAdminMessage,
    sendAdminMedia,
    toggleAiControl,
    approveOrder,
    verifyPayment,
    rejectPayment,
  };
```

- [ ] **Step 7: Verify build — zero errors**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors. If you see `Property 'paymentUploadedOrders' does not exist` errors in DashboardScreen or SalesInboxScreen, those components haven't been updated yet (D2/D3) — ignore them for now, they are not called from those files yet.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useRealtimeConversations.ts
git commit -m "fix(hook): add paymentUploadedOrders, fix realtime listeners, expose verifyPayment/rejectPayment"
```

---

## D1 Complete

After all 4 tasks: `npm run build` passes with zero errors. The data layer correctly models the backend. Sub-projects D2, D3, D4 can now be implemented in any order.

**Manual smoke test (optional but recommended):**
1. Open the app in browser (run `npm run dev` if not running)
2. Go to Sales Inbox — conversations should load from real Supabase data
3. Click the AI toggle button on a conversation — verify in Supabase table editor that `conversations.ai_active` changed (not the `state` column)
4. Go to Dashboard — if there are real `PENDING_ADMIN_CONFIRMATION` orders in the DB, they will now appear; previously they showed nothing because the query used the wrong status
