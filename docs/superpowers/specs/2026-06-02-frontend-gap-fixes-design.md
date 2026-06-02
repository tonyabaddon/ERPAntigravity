# Frontend Gap Fixes — Implementation Design

> **For agentic workers:** This spec covers 4 independent sub-projects (D1–D4). Implement one sub-project per session using `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Each sub-project has its own spec section with all context needed.

**Goal:** Align the React frontend with the live Go backend and Supabase schema so the admin dashboard and sales inbox are fully functional.

**Architecture:** Four sequential phases, each independently deployable. Phase D1 (data layer) must be completed before D2–D4 because all later phases depend on correct types and query functions. D2, D3, D4 are independent of each other after D1.

**Tech Stack:** React + TypeScript, Supabase JS client (`@supabase/supabase-js`), Tailwind CSS, Lucide React icons

**Module path:** `src/` (Vite + React frontend)

**Build check:** `npm run build` must pass with zero TypeScript errors after each phase.

**Do NOT touch:** `backend-go/` directory, any `.sql` migration files, `backend-go/internal/` Go source.

---

## Background: Gap Analysis Summary

22 gaps were found by auditing the frontend against `backend-go/internal/models/types.go` and the live Supabase schema.

### Critical gaps (break core admin workflow):
- **GAP-01:** `DbOrder.status` type only has 4 values; backend has 11 distinct statuses
- **GAP-02:** `fetchPendingOrders()` queries `.eq('status', 'PENDING')` — should be `'PENDING_ADMIN_CONFIRMATION'`
- **GAP-03:** Realtime listeners check `status === 'PENDING'` — same wrong value
- **GAP-04:** `DbConversation` missing `ai_active`, `last_ai_message_at`, `followup_count_today`, `last_followup_date`
- **GAP-05:** `toggleAiControl()` sets `state = 'ESCALATED_ADMIN'/'COLLECTING'` instead of `ai_active = true/false`

### High gaps (missing features):
- **GAP-06:** No `fetchPaymentUploadedOrders()`, `verifyPayment()`, `rejectPayment()` in supabaseClient
- **GAP-07:** Hook doesn't track `PAYMENT_UPLOADED` orders at all
- **GAP-08:** No PAYMENT_UPLOADED panel in Dashboard
- **GAP-09:** Approve button `disabled={!shippingFees[order.id]}` — `0` is falsy, blocks pickup orders
- **GAP-10:** `DbOrder` missing fields: `gjp_order_id`, `order_type`, `delivery_type`, `payment_proof_url`, `payment_verified_at`, `verified_by`, `updated_at`
- **GAP-11:** Order cards don't show `delivery_type` or `gjp_order_id`

### Medium gaps (usability):
- **GAP-12:** Status badge collapses BOOKED/WAITING_PAYMENT/etc. all to "AI"
- **GAP-13:** "Butuh Admin" filter doesn't check `ai_active = false`
- **GAP-14:** No follow-up tracking display (`followup_count_today`)
- **GAP-15:** No link from conversation to its associated order
- **GAP-16:** Dashboard KPI stats are hardcoded mock data
- **GAP-17:** Activity log is hardcoded

### Low gaps (deferred):
- **GAP-18:** WhatsappAiScreen toggles are no-ops → deferred
- **GAP-19:** Auth simulated (accepts "123456") → deferred (requires Supabase Auth project)
- **GAP-20:** UserManagement localStorage-only → deferred
- **GAP-21:** NotificationSettings has no backend → deferred
- **GAP-22:** `INITIAL_CHATS` uses invented status strings → cleaned up in D4

---

## Sub-project D1: Data & Query Layer

**Fixes:** GAP-01, GAP-02, GAP-03, GAP-04, GAP-05, GAP-06, GAP-07, GAP-10

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/supabaseClient.ts`
- Modify: `src/hooks/useRealtimeConversations.ts`

### D1 — `src/types.ts` changes

**1. Fix `DbOrder.status`** (line 133):
```typescript
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
```

**2. Add missing fields to `DbOrder`** (after `booking_expires_at`):
```typescript
gjp_order_id?: string;
order_type?: 'STANDARD' | 'CUSTOM_PANEL' | 'WIRING_PANEL';
delivery_type?: 'PICKUP' | 'DELIVERY';
payment_proof_url?: string;
payment_verified_at?: string;
verified_by?: string;
updated_at: string;
```

**3. Add missing fields to `DbConversation`** (after `clarification_round`):
```typescript
ai_active: boolean;
last_ai_message_at?: string;
followup_count_today: number;
last_followup_date?: string;
```

### D1 — `src/lib/supabaseClient.ts` changes

**1. Fix `fetchPendingOrders()`:**
```typescript
.eq('status', 'PENDING_ADMIN_CONFIRMATION')
```

**2. Fix `toggleAiControl()`** — change the update target from `state` to `ai_active`:
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
Note: the parameter name changes from `handOver: boolean` to `makeActive: boolean` for clarity. `makeActive = true` means AI is active; `makeActive = false` means admin has control.

**3. Add `fetchPaymentUploadedOrders()`:**
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
```

**4. Add `verifyPayment()`:**
```typescript
async verifyPayment(orderId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('orders')
    .update({ status: 'PAYMENT_VERIFIED', payment_verified_at: new Date().toISOString() })
    .eq('id', orderId);
  if (error) throw error;
},
```

**5. Add `rejectPayment()`:**
```typescript
async rejectPayment(orderId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('orders')
    .update({ status: 'PAYMENT_REJECTED' })
    .eq('id', orderId);
  if (error) throw error;
},
```

### D1 — `src/hooks/useRealtimeConversations.ts` changes

**1. Add `paymentUploadedOrders` state** alongside `orders`:
```typescript
const [paymentUploadedOrders, setPaymentUploadedOrders] = useState<DbOrder[]>([]);
```

**2. Load on mount** — extend the `Promise.all` in `load()`:
```typescript
const [convs, pendingOrders, paymentOrders] = await Promise.all([
  conversationService.fetchConversations(),
  orderService.fetchPendingOrders(),
  orderService.fetchPaymentUploadedOrders(),
]);
// ...
setPaymentUploadedOrders(paymentOrders);
```

**3. Fix orders INSERT listener** (line 94):
```typescript
if (newOrder.status === 'PENDING_ADMIN_CONFIRMATION') {
  setOrders(prev => [...prev, newOrder]);
} else if (newOrder.status === 'PAYMENT_UPLOADED') {
  setPaymentUploadedOrders(prev => [...prev, newOrder]);
}
```

**4. Fix orders UPDATE listener** (lines 100–105):
```typescript
(payload) => {
  const updatedOrder = payload.new as DbOrder;
  // Handle pending orders list
  if (updatedOrder.status === 'PENDING_ADMIN_CONFIRMATION') {
    setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
  } else {
    setOrders(prev => prev.filter(o => o.id !== updatedOrder.id));
  }
  // Handle payment uploaded list
  if (updatedOrder.status === 'PAYMENT_UPLOADED') {
    setPaymentUploadedOrders(prev =>
      prev.some(o => o.id === updatedOrder.id)
        ? prev.map(o => o.id === updatedOrder.id ? updatedOrder : o)
        : [...prev, updatedOrder]
    );
  } else {
    setPaymentUploadedOrders(prev => prev.filter(o => o.id !== updatedOrder.id));
  }
}
```

**5. Fix `toggleAiControl` wrapper** — update signature to match corrected service:
```typescript
const toggleAiControl = async (conversationId: string, makeActive: boolean) => {
  await conversationService.toggleAiControl(conversationId, makeActive);
};
```

**6. Add `verifyPayment` and `rejectPayment` wrappers:**
```typescript
const verifyPayment = async (orderId: string) => {
  await orderService.verifyPayment(orderId);
};
const rejectPayment = async (orderId: string) => {
  await orderService.rejectPayment(orderId);
};
```

**7. Return `paymentUploadedOrders`, `verifyPayment`, `rejectPayment` from hook.**

---

## Sub-project D2: Order Lifecycle UI

**Depends on:** D1 complete

**Fixes:** GAP-08, GAP-09, GAP-11

**Files:**
- Modify: `src/components/DashboardScreen.tsx`

### D2 — Pending Orders panel fixes

**Approve button fix** (GAP-09) — change disabled condition:
```typescript
disabled={approvingId === order.id || shippingFees[order.id] === undefined || shippingFees[order.id] === ''}
```

**Auto-fill shipping fee for PICKUP orders** — when rendering each order card, if `order.delivery_type === 'PICKUP'`, render the fee input as read-only with value `'0'` and ensure `shippingFees[order.id]` is initialized to `'0'`:
```typescript
// In useEffect or inline when orders change:
// For pickup orders, pre-set the shipping fee to '0'
useEffect(() => {
  orders.forEach(order => {
    if (order.delivery_type === 'PICKUP' && shippingFees[order.id] === undefined) {
      setShippingFees(prev => ({ ...prev, [order.id]: '0' }));
    }
  });
}, [orders]);
```

**Display `gjp_order_id`** (GAP-11) — add to order card header:
```tsx
<p className="text-xs font-mono text-gray-400">
  {order.gjp_order_id ?? order.id.slice(0, 8)}
</p>
```

**Display `delivery_type` badge** (GAP-11):
```tsx
<span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
  order.delivery_type === 'PICKUP'
    ? 'bg-blue-50 text-blue-700'
    : 'bg-amber-50 text-amber-700'
}`}>
  {order.delivery_type === 'PICKUP' ? 'Ambil Sendiri' : 'Pengiriman'}
</span>
```

**Shipping fee input** — if PICKUP, show read-only `Rp 0`; if DELIVERY, show editable input as before.

### D2 — New PAYMENT_UPLOADED panel (GAP-08)

Add below the existing Pending Orders panel. Receives `paymentUploadedOrders` and `verifyPayment`, `rejectPayment` from `useRealtimeConversations()`.

```tsx
{paymentUploadedOrders.length > 0 && (
  <div className="mt-6">
    <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
      <ImageIcon className="w-5 h-5 text-emerald-600" />
      Bukti Pembayaran Menunggu Verifikasi ({paymentUploadedOrders.length})
    </h2>
    <div className="space-y-3">
      {paymentUploadedOrders.map(order => (
        <PaymentVerificationCard
          key={order.id}
          order={order}
          onVerify={() => verifyPayment(order.id)}
          onReject={() => rejectPayment(order.id)}
        />
      ))}
    </div>
  </div>
)}
```

**`PaymentVerificationCard` component** (defined as a local function component at the bottom of `DashboardScreen.tsx`):
- Shows: `gjp_order_id`, customer name, total, items summary
- Shows payment proof: if `order.payment_proof_url`, render a clickable thumbnail (`<a href={url} target="_blank">Lihat Bukti Transfer</a>` + `<img src={url} className="max-h-32 rounded object-contain mt-2" />`)
- If no URL yet: show "Belum ada foto bukti" placeholder
- "✓ Verifikasi" button (green) with loading state
- "✕ Tolak" button (red) with loading state
- On success: optimistic removal from list

---

## Sub-project D3: Conversation Inbox

**Depends on:** D1 complete

**Fixes:** GAP-12, GAP-13, GAP-14, GAP-15

**Files:**
- Modify: `src/components/SalesInboxScreen.tsx`

### D3 — Status badge mapping (GAP-12)

Replace `stateToStatus()` with a direct `statusBadge(conv)` function that takes the full conversation object:

```typescript
function getStatusInfo(conv: ConversationWithMessages): { label: string; className: string } {
  const s = conv.state;
  if (s === 'ESCALATED_ADMIN') return { label: 'Butuh Admin', className: 'bg-red-100 text-red-700' };
  if (s === 'ESCALATED_WIRING') return { label: 'Wiring', className: 'bg-yellow-100 text-yellow-700' };
  if (s === 'BOOKED' || s === 'WAITING_PAYMENT' || s === 'PAYMENT_UPLOADED')
    return { label: 'Menunggu Bayar', className: 'bg-amber-100 text-amber-700' };
  if (s === 'PAYMENT_VERIFIED' || s === 'COMPLETED')
    return { label: 'Selesai', className: 'bg-emerald-100 text-emerald-700' };
  if (s === 'CANCELLED') return { label: 'Batal', className: 'bg-gray-100 text-gray-500' };
  if (!conv.ai_active) return { label: 'Manual', className: 'bg-orange-100 text-orange-700' };
  return { label: 'AI', className: 'bg-blue-100 text-blue-700' };
}
```

### D3 — Filter fix (GAP-13)

Update `filteredChats`:
```typescript
if (activeFilter === 'Butuh Admin') {
  return conv.state === 'ESCALATED_ADMIN' || conv.state === 'ESCALATED_WIRING' || !conv.ai_active;
}
```

### D3 — AI toggle button fix (GAP-05 downstream)

Replace `handleToggleAi` signature and all call sites:
```typescript
const handleToggleAi = async (conv: ConversationWithMessages) => {
  await toggleAiControl(conv.id, !conv.ai_active);
};
```

Update the button's `onClick` in the chat panel header (was `handleToggleAi(activeChat.id, activeChat.state)`):
```tsx
<button
  onClick={() => handleToggleAi(activeChat)}
  title={activeChat.ai_active ? 'Alihkan ke Admin (Nonaktifkan AI)' : 'Aktifkan AI kembali'}
  className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
>
  <ArrowLeftRight className="w-4 h-4" />
</button>
```

### D3 — Follow-up indicator (GAP-14)

In the conversation list item, after the status badge:
```tsx
{conv.followup_count_today > 0 && (
  <span className="text-xs text-gray-400 ml-1">
    ↩ {conv.followup_count_today}/2
  </span>
)}
```

In the chat panel header (next to status badge):
```tsx
{activeChat.followup_count_today > 0 && (
  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
    Follow-up: {activeChat.followup_count_today}/2 terkirim
  </span>
)}
```

### D3 — Order context in chat panel (GAP-15)

The hook already provides both `orders` (PENDING_ADMIN_CONFIRMATION) and `paymentUploadedOrders` (PAYMENT_UPLOADED). Pull both from the hook in SalesInboxScreen and expose them.

Compute the active conversation's order:
```typescript
const { conversations, orders, paymentUploadedOrders, ... } = useRealtimeConversations();
const allOrders = [...orders, ...paymentUploadedOrders];
const activeOrder = allOrders.find(o => o.conversation_id === activeChatId);
```

In the chat panel, if `activeOrder` exists, show a thin info bar below the header:
```tsx
{activeOrder && (
  <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between text-xs">
    <span className="font-semibold text-amber-800">
      {activeOrder.gjp_order_id ?? 'Pesanan'} · Rp {activeOrder.total.toLocaleString('id-ID')}
    </span>
    <span className={`px-2 py-0.5 rounded-full font-bold ${
      activeOrder.status === 'PAYMENT_UPLOADED' ? 'bg-amber-200 text-amber-900' : 'bg-blue-100 text-blue-800'
    }`}>
      {activeOrder.status}
    </span>
  </div>
)}
```

---

## Sub-project D4: Polish & Cleanup

**Depends on:** D1 complete (D2, D3 not required)

**Fixes:** GAP-16, GAP-17, GAP-22 (partial), and App.tsx stale state

**Files:**
- Modify: `src/lib/supabaseClient.ts` — add stats query
- Modify: `src/components/DashboardScreen.tsx` — wire real stats to 3 KPI cards and activity log
- Modify: `src/App.tsx` — remove stale `chats` state
- Modify: `src/initialData.ts` — remove `INITIAL_CHATS` export if no longer imported

### D4 — Stats query

Add to `supabaseClient.ts`:
```typescript
export const statsService = {
  async fetchTodayStats(): Promise<{
    verifiedOrdersTotal: number;
    verifiedOrdersCount: number;
    totalConversationsToday: number;
    aiConversationsToday: number;
  }> {
    if (!supabase) throw new Error('Supabase not configured');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const iso = todayStart.toISOString();

    const [ordersRes, convsRes, aiConvsRes] = await Promise.all([
      supabase.from('orders')
        .select('total')
        .eq('status', 'PAYMENT_VERIFIED')
        .gte('created_at', iso),
      supabase.from('conversations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', iso),
      supabase.from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('ai_active', true)
        .gte('created_at', iso),
    ]);

    const verifiedTotal = (ordersRes.data ?? []).reduce((sum, o) => sum + (o.total ?? 0), 0);
    return {
      verifiedOrdersTotal: verifiedTotal,
      verifiedOrdersCount: ordersRes.data?.length ?? 0,
      totalConversationsToday: convsRes.count ?? 0,
      aiConversationsToday: aiConvsRes.count ?? 0,
    };
  },

  async fetchRecentActivity(): Promise<Array<{ text: string; sender: string; created_at: string }>> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data } = await supabase
      .from('messages')
      .select('text, sender, created_at')
      .in('sender', ['system', 'ai'])
      .order('created_at', { ascending: false })
      .limit(5);
    return data ?? [];
  },
};
```

### D4 — DashboardScreen KPI cards

Load stats on mount:
```typescript
const [stats, setStats] = useState<{ verifiedOrdersTotal: number; verifiedOrdersCount: number; totalConversationsToday: number; aiConversationsToday: number } | null>(null);
const [recentActivity, setRecentActivity] = useState<Array<{ text: string; sender: string; created_at: string }>>([]);

useEffect(() => {
  if (isSupabaseConfigured) {
    statsService.fetchTodayStats().then(setStats).catch(console.error);
    statsService.fetchRecentActivity().then(setRecentActivity).catch(console.error);
  }
}, []);
```

Replace the 3 hardcoded KPI values:
- "Total Omset Hari Ini" → `formatRupiah(stats?.verifiedOrdersTotal ?? 0)` (remove hardcoded `+14.2%` badge; replace with `stats ? 'Live' : 'Loading...'`)
- "Pesanan Terproses" → `(stats?.verifiedOrdersCount ?? 0) + ' Transaksi'`
- "Otomasi Balasan AI" → compute `stats ? Math.round((stats.aiConversationsToday / Math.max(stats.totalConversationsToday, 1)) * 100) + '%' : '...'`
- Keep the recharts weekly chart data as-is (decorative — no backfill)

Replace the 3 hardcoded activity log items with `recentActivity.map(...)`. If empty, show "Belum ada aktivitas hari ini."

### D4 — App.tsx cleanup

Remove:
- `chats` state, its `useState` initializer, and its `useEffect` localStorage sync (lines 47–49, 73–75)
- `chatsCount` prop passed to `DashboardScreen`

Update `DashboardScreen` props interface to remove `chatsCount`.

### D4 — initialData.ts cleanup

Check if `INITIAL_CHATS` and `ChatItem`/`ChatStatusType` are still imported anywhere after App.tsx cleanup. If not, remove the `INITIAL_CHATS` export from `initialData.ts`. Do not remove `INITIAL_STOCK`, `INITIAL_ADMINS`, or `INITIAL_CONFIG` — those are still used.

---

## Error Handling Rules (all phases)

- Supabase errors: log with `console.error`, show a toast if the calling component has access to `showToast`, otherwise fail silently
- Realtime events with unexpected shape: log and skip (don't crash the listener)
- Missing optional fields (e.g. `gjp_order_id` is null): always use `??` fallback — never `.!` or non-null assertion
- Loading states: always show a loading indicator for async operations before results arrive; never show a spinner indefinitely (add a timeout-aware fallback)

## TypeScript Rules (all phases)

- No `any` types introduced — use proper `DbOrder`, `DbConversation` types throughout
- All new functions must have explicit return types
- `npm run build` must produce zero TypeScript errors

## Testing Approach (all phases)

No unit tests exist in this project. Verify each phase by:
1. `npm run build` — zero TS errors
2. Manual test in browser against the live Supabase project (`ekhhojaezdfjfwuxyjkl`)
3. For D1: confirm via Supabase table editor that `conversations.ai_active` updates correctly when toggle is clicked
4. For D2: confirm a real `PENDING_ADMIN_CONFIRMATION` order appears in dashboard; confirm PICKUP approve works
5. For D3: confirm conversation state badges match the actual `state` column in DB
6. For D4: confirm KPI numbers match counts in Supabase table editor

## Deferred (out of scope for all phases)

- Auth: Supabase Auth integration (requires separate project setup)
- UserManagement: Supabase integration for admin users
- NotificationSettings: Backend WA heartbeat report
- WhatsappAiScreen: Real toggle persistence for WA number enable/disable
