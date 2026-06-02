# Frontend D2: Order Lifecycle UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update DashboardScreen so admin can see real pending orders with correct data (order ID, delivery type), approve pickup orders without getting stuck on the zero-fee check, and see + verify/reject payment-uploaded orders.

**Architecture:** All changes are confined to `src/components/DashboardScreen.tsx`. This plan adds a `useEffect` to pre-fill pickup shipping fees, updates the existing pending orders card rendering, and adds a new `PaymentVerificationCard` component and panel. Requires D1 to be complete first (types, hook functions).

**Tech Stack:** React, TypeScript, Tailwind CSS, Lucide React

**Prerequisite:** D1 must be complete. Run `npm run build` before starting — it must pass.

---

## File Map

| File | Change |
|---|---|
| `src/components/DashboardScreen.tsx` | Fix approve button, add delivery info, add PaymentVerificationCard, add PAYMENT_UPLOADED panel |

---

### Task 1: Fix the Pending Orders panel — approve button, delivery type, order ID

**Files:**
- Modify: `src/components/DashboardScreen.tsx`

**Context:** Three problems in the current pending orders panel:
1. `disabled={!shippingFees[order.id]}` — `0` is falsy, permanently blocking pickup orders
2. No display of `delivery_type` — admin doesn't know if order is pickup or delivery
3. No display of `gjp_order_id` — admin sees a raw UUID instead of the business order ID like `GJP-ORD-20260602-0001`

- [ ] **Step 1: Add pickup auto-fill `useEffect`**

In `src/components/DashboardScreen.tsx`, after the `const [approvingId, setApprovingId] = useState<string | null>(null);` line (around line 70), add:

```typescript
  // Pre-fill shipping fee to '0' for PICKUP orders so the approve button is enabled
  useEffect(() => {
    orders.forEach(order => {
      if (order.delivery_type === 'PICKUP') {
        setShippingFees(prev => {
          if (prev[order.id] !== undefined) return prev;
          return { ...prev, [order.id]: '0' };
        });
      }
    });
  }, [orders]);
```

- [ ] **Step 2: Fix the approve button's `disabled` condition**

Find the approve button (around line 330):
```tsx
disabled={approvingId === order.id || !shippingFees[order.id]}
```

Replace with:
```tsx
disabled={approvingId === order.id || shippingFees[order.id] === undefined || shippingFees[order.id] === ''}
```

- [ ] **Step 3: Add `gjp_order_id` and `delivery_type` to each order card**

Find the order card header area. Currently it shows `order.customer_name` at the top (around line 299). Add the order ID and delivery badge immediately after the customer name `<p>`:

```tsx
<div className="flex items-center gap-2 mt-0.5">
  <p className="text-xs font-mono text-gray-400">
    {order.gjp_order_id ?? order.id.slice(0, 8)}
  </p>
  {order.delivery_type && (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
      order.delivery_type === 'PICKUP'
        ? 'bg-blue-50 text-blue-700'
        : 'bg-amber-50 text-amber-700'
    }`}>
      {order.delivery_type === 'PICKUP' ? 'Ambil Sendiri' : 'Pengiriman'}
    </span>
  )}
</div>
```

- [ ] **Step 4: Make shipping fee input read-only for PICKUP orders**

Find the shipping fee input block (around line 318–326). Replace it with:

```tsx
<div className="flex items-center gap-2">
  <span className="text-sm text-gray-600">Ongkir (Rp):</span>
  {order.delivery_type === 'PICKUP' ? (
    <span className="w-28 text-sm font-semibold text-gray-500 px-2 py-1">Rp 0 (Pickup)</span>
  ) : (
    <input
      type="number"
      min="0"
      className="w-28 border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      placeholder="0"
      value={shippingFees[order.id] ?? ''}
      onChange={e => setShippingFees(prev => ({ ...prev, [order.id]: e.target.value }))}
    />
  )}
</div>
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/DashboardScreen.tsx
git commit -m "fix(dashboard): fix pickup approve button, show delivery_type and gjp_order_id on order cards"
```

---

### Task 2: Add `PaymentVerificationCard` component

**Files:**
- Modify: `src/components/DashboardScreen.tsx` — add component at bottom of file

**Context:** A new card component for displaying orders in `PAYMENT_UPLOADED` status. Shows payment proof image (or placeholder), customer info, order total, and Verify/Reject buttons. Manages its own loading state for each button click.

- [ ] **Step 1: Add the `Image` icon import from lucide-react**

At the top of `src/components/DashboardScreen.tsx`, in the lucide-react import line, add `Image` to the destructured imports:

```typescript
import {
  TrendingUp,
  ShoppingBag,
  Zap,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  MessageSquare,
  CheckCircle2,
  Image,
} from 'lucide-react';
```

- [ ] **Step 2: Add `PaymentVerificationCard` at the bottom of `DashboardScreen.tsx`**

After the closing `}` of the `DashboardScreen` default export function, at the very end of the file, add:

```tsx
interface PaymentVerificationCardProps {
  order: import('../types').DbOrder;
  onVerify: () => Promise<void>;
  onReject: () => Promise<void>;
}

function PaymentVerificationCard({ order, onVerify, onReject }: PaymentVerificationCardProps) {
  const [verifying, setVerifying] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);

  const handleVerify = async () => {
    setVerifying(true);
    try { await onVerify(); } finally { setVerifying(false); }
  };

  const handleReject = async () => {
    setRejecting(true);
    try { await onReject(); } finally { setRejecting(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-emerald-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-800">{order.customer_name}</p>
            <p className="text-xs font-mono text-gray-400">{order.gjp_order_id ?? order.id.slice(0, 8)}</p>
          </div>
          <p className="text-sm text-gray-500">{order.customer_company} · {order.customer_phone}</p>
          <p className="mt-1 text-sm font-semibold text-gray-800">
            Total: Rp {order.total.toLocaleString('id-ID')}
          </p>

          {/* Payment proof */}
          <div className="mt-3">
            {order.payment_proof_url ? (
              <div className="space-y-1">
                <a
                  href={order.payment_proof_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 underline font-medium"
                >
                  Lihat Bukti Transfer ↗
                </a>
                <img
                  src={order.payment_proof_url}
                  alt="Bukti pembayaran"
                  className="max-h-32 rounded object-contain border border-gray-100"
                />
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Belum ada foto bukti transfer</p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={handleVerify}
            disabled={verifying || rejecting}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-40"
          >
            {verifying ? 'Memproses...' : '✓ Verifikasi'}
          </button>
          <button
            onClick={handleReject}
            disabled={verifying || rejecting}
            className="px-4 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 disabled:opacity-40"
          >
            {rejecting ? 'Memproses...' : '✕ Tolak'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero errors. The component is defined but not yet used — that's fine, no unused-variable error because it's exported-style at file scope.

- [ ] **Step 4: Commit**

```bash
git add src/components/DashboardScreen.tsx
git commit -m "feat(dashboard): add PaymentVerificationCard component for payment proof review"
```

---

### Task 3: Add the PAYMENT_UPLOADED panel to DashboardScreen

**Files:**
- Modify: `src/components/DashboardScreen.tsx`

**Context:** Wire up `paymentUploadedOrders`, `verifyPayment`, and `rejectPayment` from the hook, then render the new panel below the existing Pending Orders panel. Use optimistic removal from the list so the card disappears immediately after the admin clicks Verify or Reject.

- [ ] **Step 1: Pull new values from the hook**

Find the line in `DashboardScreen` that calls `useRealtimeConversations()` (around line 68):

```typescript
  const { orders, approveOrder } = useRealtimeConversations();
```

Replace with:

```typescript
  const { orders, paymentUploadedOrders: rawPaymentOrders, approveOrder, verifyPayment: verifyPaymentFn, rejectPayment: rejectPaymentFn } = useRealtimeConversations();
  const [paymentUploadedOrders, setPaymentUploadedOrders] = React.useState<typeof rawPaymentOrders>([]);

  // Sync incoming hook data into local state (for optimistic removal)
  React.useEffect(() => {
    setPaymentUploadedOrders(rawPaymentOrders);
  }, [rawPaymentOrders]);
```

- [ ] **Step 2: Add optimistic removal handlers**

After the `handleApprove` function (around line 80), add:

```typescript
  const handleVerify = async (orderId: string) => {
    setPaymentUploadedOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await verifyPaymentFn(orderId);
    } catch (err) {
      console.error('verifyPayment failed:', err);
      // Re-sync from hook on failure
      setPaymentUploadedOrders(rawPaymentOrders);
    }
  };

  const handleReject = async (orderId: string) => {
    setPaymentUploadedOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await rejectPaymentFn(orderId);
    } catch (err) {
      console.error('rejectPayment failed:', err);
      setPaymentUploadedOrders(rawPaymentOrders);
    }
  };
```

- [ ] **Step 3: Add the PAYMENT_UPLOADED panel to the JSX**

Find the closing `</div>` of the entire `DashboardScreen` return block (the outermost `<div className="space-y-8 animate-fadeIn">`). Add the new panel immediately after the Pending Orders `{orders.length > 0 && (...)}` block:

```tsx
      {/* Payment Verification Panel */}
      {paymentUploadedOrders.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
            <Image className="w-5 h-5 text-emerald-600" />
            Bukti Pembayaran Menunggu Verifikasi ({paymentUploadedOrders.length})
          </h2>
          <div className="space-y-3">
            {paymentUploadedOrders.map(order => (
              <PaymentVerificationCard
                key={order.id}
                order={order}
                onVerify={() => handleVerify(order.id)}
                onReject={() => handleReject(order.id)}
              />
            ))}
          </div>
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
git add src/components/DashboardScreen.tsx
git commit -m "feat(dashboard): add PAYMENT_UPLOADED panel with verify/reject and optimistic removal"
```

---

## D2 Complete

After all 3 tasks: `npm run build` passes with zero errors.

**Manual smoke test:**
1. Run `npm run dev` and navigate to Dashboard
2. If there are orders with `status = 'PENDING_ADMIN_CONFIRMATION'` in Supabase: they should appear in the Pending Orders panel with their `gjp_order_id` and delivery type badge
3. For a PICKUP order: the shipping fee field should show "Rp 0 (Pickup)" and the approve button should be enabled
4. For a DELIVERY order: the shipping fee input should be editable; entering 0 should enable the approve button
5. If there are orders with `status = 'PAYMENT_UPLOADED'`: they should appear in the new panel with their payment proof image (or placeholder text)
6. Clicking "Verifikasi" should make the card disappear immediately (optimistic removal) and update the DB
