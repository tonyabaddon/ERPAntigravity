# F1 — Order History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Riwayat Pesanan screen where the admin can view all orders, approve new orders (with ongkir input), verify payment proofs, and download PDF invoices — consolidating workflows currently split across DashboardScreen.

**Architecture:** 9 independent tasks building from data layer → screen scaffold → expanded rows → invoice modal → settings section → dashboard cleanup. Each task must leave `npm run build` passing. Tasks 1–3 are prerequisites for the rest; Tasks 4–9 are independent of each other after Task 3.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Supabase JS client, Lucide React, `window.print()` for PDF

**Spec:** `docs/superpowers/specs/2026-06-03-order-history-design.md`

---

## Context

- **No test framework** — verification is `npm run build` (TypeScript strict) + manual browser check at `http://localhost:3000`
- **Existing `bank_config` table** already has `bank_name`, `account_number`, `account_name` and is already managed in PengaturanScreen. The invoice will reuse `bankConfigService.fetch()` — do NOT create duplicate bank fields in `company_settings`.
- **`company_settings`** only needs: `company_name`, `address`, `phone`, `email`
- **`verifyPayment`** currently sets status to `PAYMENT_VERIFIED`. The "Selesai" filter tab must include BOTH `PAYMENT_VERIFIED` and `COMPLETED` since both represent completed orders.
- **`currentUser`** in `App.tsx` has shape `{ name: string; role: string; avatarUrl: string; storeName: string }` — `currentUser.name` is the admin name for audit trail.
- **`useRealtimeConversations` hook** exposes `orders` (PENDING_ADMIN_CONFIRMATION only), `paymentUploadedOrders`, `approveOrder`, `verifyPayment`, `rejectPayment`. Dashboard currently uses these for its panels — do not break the hook until Task 9.
- **Do NOT touch:** `backend-go/`, any `.sql` migration files directly (use Supabase MCP tool).

---

## Task 1: DB Migration + DbCompanySettings Type

**Files:**
- Modify: `src/types.ts` (add `DbCompanySettings`, add `'order-history'` to `ActivePage`)
- New Supabase table via MCP: `company_settings`

- [ ] **Step 1: Apply the Supabase migration**

Use the Supabase MCP tool (`mcp__plugin_supabase_supabase__apply_migration`) with project ID `ekhhojaezdfjfwuxyjkl`:

```sql
CREATE TABLE IF NOT EXISTS company_settings (
  id           integer PRIMARY KEY DEFAULT 1,
  company_name text NOT NULL DEFAULT 'Garindo Jaya Panel',
  address      text NOT NULL DEFAULT '',
  phone        text NOT NULL DEFAULT '',
  email        text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read company_settings"
  ON company_settings FOR SELECT TO anon USING (true);

GRANT SELECT ON company_settings TO anon;
GRANT ALL   ON company_settings TO service_role;

-- Seed the default row so fetch() never returns null
INSERT INTO company_settings (id, company_name) VALUES (1, 'Garindo Jaya Panel')
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Add `DbCompanySettings` interface to `src/types.ts`**

After the existing `DbNotificationConfig` interface (around line 210), add:

```typescript
export interface DbCompanySettings {
  id: number;
  company_name: string;
  address: string;
  phone: string;
  email: string;
  updated_at: string;
}
```

- [ ] **Step 3: Add `'order-history'` to the `ActivePage` union in `src/types.ts`**

Find the line:
```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline';
```

Replace with:
```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history';
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add DbCompanySettings, order-history ActivePage"
```

---

## Task 2: Service Layer — companySettingsService + ordersService updates

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add `companySettingsService` at the end of `src/lib/supabaseClient.ts`** (before the final closing of the file):

```typescript
export const companySettingsService = {
  async fetch(): Promise<DbCompanySettings> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('company_settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (error) throw error;
    return data;
  },

  async save(values: Omit<DbCompanySettings, 'id' | 'updated_at'>): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('company_settings')
      .upsert({ id: 1, ...values, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
};
```

Also add `DbCompanySettings` to the import at the top of `supabaseClient.ts`:
```typescript
import { DbOrder, DbConversation, DbBankConfig, DbWaRecipient, DbLead, DbNotificationConfig, DbCompanySettings } from '../types';
```

- [ ] **Step 2: Add `fetchAll()` and `rejectOrder()` to the existing `orderService` in `src/lib/supabaseClient.ts`**

Inside the `orderService` object (after the existing `rejectPayment` method, before the closing `}`):

```typescript
  async fetchAll(): Promise<DbOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async rejectOrder(orderId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ status: 'CANCELLED' })
      .eq('id', orderId);
    if (error) throw error;
  },
```

- [ ] **Step 3: Update `verifyPayment` to accept `adminName`**

Find the existing `verifyPayment` method in `orderService`:
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

Replace with:
```typescript
  async verifyPayment(orderId: string, adminName = ''): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({
        status: 'PAYMENT_VERIFIED',
        payment_verified_at: new Date().toISOString(),
        verified_by: adminName,
      })
      .eq('id', orderId);
    if (error) throw error;
  },
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(service): add companySettingsService, ordersService.fetchAll/rejectOrder, verifyPayment adminName"
```

---

## Task 3: Sidebar Nav + App.tsx Routing (stub)

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add Riwayat Pesanan to the nav items in `src/components/Sidebar.tsx`**

Add `ClipboardList` to the lucide-react import line:
```typescript
import {
  LayoutDashboard, Inbox, Package, Users, Bell, Settings, LogOut,
  Zap, UserCheck, Bot, TrendingUp, ClipboardList
} from 'lucide-react';
```

In the `menuItems` array, add after the `pipeline` entry:
```typescript
    {
      id: 'order-history' as ActivePage,
      label: 'Riwayat Pesanan',
      icon: ClipboardList,
      description: 'Semua Pesanan',
    },
```

- [ ] **Step 2: Add the route in `src/App.tsx`**

Add the import at the top (with other component imports):
```typescript
import OrderHistoryScreen from './components/OrderHistoryScreen';
```

In the `renderContent()` switch statement, add before the `default` case:
```typescript
      case 'order-history':
        return (
          <OrderHistoryScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
```

- [ ] **Step 3: Create the stub `src/components/OrderHistoryScreen.tsx`**

```typescript
import React from 'react';

interface OrderHistoryScreenProps {
  currentUser: { name: string; role: string; avatarUrl: string; storeName: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function OrderHistoryScreen({ currentUser, showToast }: OrderHistoryScreenProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="text-2xl font-bold text-gray-800">Riwayat Pesanan</h1>
      <p className="text-gray-500">Coming soon...</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify build and nav**

```bash
npm run build
```

Expected: zero TypeScript errors. Open `http://localhost:3000`, find "Riwayat Pesanan" in the sidebar, click it — stub renders.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx src/components/OrderHistoryScreen.tsx
git commit -m "feat(nav): add Riwayat Pesanan to sidebar and App routing"
```

---

## Task 4: OrderHistoryScreen — Header, Filter Tabs, Search, Collapsed Rows, Empty States

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx` (full replacement)

- [ ] **Step 1: Replace `OrderHistoryScreen.tsx` with the full implementation**

```typescript
import React, { useState, useEffect } from 'react';
import { ClipboardList, Search, ChevronDown } from 'lucide-react';
import { DbOrder } from '../types';
import { orderService, isSupabaseConfigured } from '../lib/supabaseClient';

interface OrderHistoryScreenProps {
  currentUser: { name: string; role: string; avatarUrl: string; storeName: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type FilterTab = 'all' | 'pending' | 'waiting' | 'uploaded' | 'done' | 'cancelled';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  PENDING_ADMIN_CONFIRMATION: { label: '🔔 Perlu Konfirmasi', className: 'bg-purple-100 text-purple-800' },
  PENDING_PRICE_NEGO:         { label: '💬 Nego Harga',       className: 'bg-orange-100 text-orange-800' },
  PENDING_STOCK_CHECK:        { label: '📦 Cek Stok',         className: 'bg-orange-100 text-orange-800' },
  PENDING_CUSTOM_QUOTE:       { label: '📐 Custom Quote',     className: 'bg-orange-100 text-orange-800' },
  PENDING_WIRING_QUOTE:       { label: '🔌 Wiring Quote',     className: 'bg-orange-100 text-orange-800' },
  APPROVED:                   { label: '✓ Disetujui',         className: 'bg-teal-100 text-teal-800' },
  WAITING_PAYMENT:            { label: '⏳ Menunggu Bayar',   className: 'bg-yellow-100 text-yellow-800' },
  PAYMENT_UPLOADED:           { label: '📎 Bukti Dikirim',    className: 'bg-blue-100 text-blue-800' },
  PAYMENT_VERIFIED:           { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  COMPLETED:                  { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  PAYMENT_REJECTED:           { label: '✕ Bayar Ditolak',     className: 'bg-rose-100 text-rose-800' },
  CANCELLED:                  { label: '✕ Dibatalkan',        className: 'bg-red-100 text-red-800' },
};

const TOTAL_COLOR: Record<string, string> = {
  PENDING_ADMIN_CONFIRMATION: 'text-purple-700',
  WAITING_PAYMENT:            'text-yellow-700',
  PAYMENT_UPLOADED:           'text-blue-700',
  PAYMENT_VERIFIED:           'text-green-700',
  COMPLETED:                  'text-green-700',
  PAYMENT_REJECTED:           'text-gray-400',
  CANCELLED:                  'text-gray-400',
};

const LEFT_BORDER: Record<string, string> = {
  PENDING_ADMIN_CONFIRMATION: 'border-l-4 border-l-purple-500',
  PAYMENT_UPLOADED:           'border-l-4 border-l-blue-500',
};

function filterOrders(orders: DbOrder[], tab: FilterTab, search: string): DbOrder[] {
  let filtered = orders;
  if (tab === 'pending')   filtered = orders.filter(o => o.status === 'PENDING_ADMIN_CONFIRMATION');
  if (tab === 'waiting')   filtered = orders.filter(o => o.status === 'WAITING_PAYMENT');
  if (tab === 'uploaded')  filtered = orders.filter(o => o.status === 'PAYMENT_UPLOADED');
  if (tab === 'done')      filtered = orders.filter(o => o.status === 'PAYMENT_VERIFIED' || o.status === 'COMPLETED');
  if (tab === 'cancelled') filtered = orders.filter(o => o.status === 'CANCELLED' || o.status === 'PAYMENT_REJECTED');
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(o =>
      o.customer_name.toLowerCase().includes(q) ||
      (o.gjp_order_id ?? '').toLowerCase().includes(q) ||
      o.customer_phone.includes(q)
    );
  }
  return filtered;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function ItemPill({ items }: { items: DbOrder['items'] }) {
  if (!items || items.length === 0) return null;
  return (
    <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs">
      {items[0].name}{items.length > 1 ? <strong> +{items.length - 1}</strong> : null}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <ClipboardList className="w-10 h-10 text-gray-200 mx-auto mb-3" />
      <p className="text-sm font-semibold text-gray-400">{message}</p>
    </div>
  );
}

const EMPTY_MESSAGES: Record<FilterTab, string> = {
  all:       'Belum ada pesanan.',
  pending:   'Tidak ada pesanan yang perlu dikonfirmasi.',
  waiting:   'Tidak ada pesanan yang menunggu pembayaran.',
  uploaded:  'Tidak ada bukti bayar menunggu verifikasi.',
  done:      'Belum ada pesanan yang selesai.',
  cancelled: 'Tidak ada pesanan yang dibatalkan.',
};

export default function OrderHistoryScreen({ currentUser, showToast }: OrderHistoryScreenProps) {
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    orderService.fetchAll()
      .then(setOrders)
      .catch(() => showToast('Gagal memuat pesanan.', 'warning'))
      .finally(() => setLoading(false));
  }, []);

  const pendingCount   = orders.filter(o => o.status === 'PENDING_ADMIN_CONFIRMATION').length;
  const uploadedCount  = orders.filter(o => o.status === 'PAYMENT_UPLOADED').length;
  const waitingCount   = orders.filter(o => o.status === 'WAITING_PAYMENT').length;
  const doneCount      = orders.filter(o => o.status === 'PAYMENT_VERIFIED' || o.status === 'COMPLETED').length;
  const cancelledCount = orders.filter(o => o.status === 'CANCELLED' || o.status === 'PAYMENT_REJECTED').length;

  const visible = filterOrders(orders, tab, search);

  const tabs: { id: FilterTab; label: string; count: number; dot?: boolean }[] = [
    { id: 'all',       label: 'Semua',            count: orders.length },
    { id: 'pending',   label: 'Perlu Konfirmasi', count: pendingCount },
    { id: 'waiting',   label: 'Menunggu Bayar',   count: waitingCount },
    { id: 'uploaded',  label: 'Bukti Dikirim',    count: uploadedCount, dot: uploadedCount > 0 },
    { id: 'done',      label: 'Selesai',           count: doneCount },
    { id: 'cancelled', label: 'Dibatalkan',        count: cancelledCount },
  ];

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-800">Riwayat Pesanan</h1>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
          Supabase belum dikonfigurasi.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <ClipboardList className="w-6 h-6 text-gray-700 shrink-0" />
        <h1 className="text-2xl font-bold text-gray-800">Riwayat Pesanan</h1>
        <div className="ml-auto flex gap-2 flex-wrap">
          {pendingCount > 0 && (
            <span className="bg-purple-100 text-purple-800 border border-purple-200 px-3 py-1 rounded-full text-xs font-bold">
              🔔 {pendingCount} pesanan perlu konfirmasi
            </span>
          )}
          {uploadedCount > 0 && (
            <span className="bg-blue-100 text-blue-800 border border-blue-200 px-3 py-1 rounded-full text-xs font-bold">
              📎 {uploadedCount} bukti bayar menunggu verifikasi
            </span>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
              tab === t.id
                ? 'bg-[#012749] text-white border-[#012749]'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            {t.label} ({t.count})
            {t.dot && (
              <span className="bg-amber-400 text-amber-900 rounded-full px-1.5 text-[9px] font-black">!</span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-400">
        <Search className="w-4 h-4 shrink-0" />
        <input
          className="flex-1 bg-transparent outline-none text-gray-700 placeholder:text-gray-400"
          placeholder="Cari nama pelanggan, GJP Order ID, nomor WA..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">Memuat...</div>
      ) : visible.length === 0 ? (
        <EmptyState message={EMPTY_MESSAGES[tab]} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {visible.map(order => {
            const badge   = STATUS_BADGE[order.status] ?? { label: order.status, className: 'bg-gray-100 text-gray-600' };
            const totalCl = TOTAL_COLOR[order.status] ?? 'text-gray-700';
            const borderCl = LEFT_BORDER[order.status] ?? 'border-l-4 border-l-transparent';
            const isDimmed = order.status === 'CANCELLED' || order.status === 'PAYMENT_REJECTED';
            const isExpanded = expandedId === order.id;

            return (
              <div key={order.id} className={`border-b border-gray-100 last:border-0 ${borderCl} ${isDimmed ? 'opacity-55' : ''}`}>
                {/* Collapsed row */}
                <div
                  className={`flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-gray-50' : ''}`}
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-gray-800">{order.customer_name}</div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className="text-xs text-gray-400 font-mono">{order.gjp_order_id ?? order.id.slice(0, 8)}</span>
                      <span className="text-gray-300 text-xs">·</span>
                      <span className="text-xs text-gray-400">{formatDate(order.created_at)}</span>
                      <span className="text-gray-300 text-xs">·</span>
                      <ItemPill items={order.items} />
                    </div>
                  </div>
                  <div className={`text-sm font-extrabold shrink-0 ${totalCl}`}>
                    Rp {order.total.toLocaleString('id-ID')}
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${badge.className}`}>
                    {badge.label}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                {/* Expanded body placeholder — filled in Tasks 5–7 */}
                {isExpanded && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
                    [expanded row — {order.status}]
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Manual smoke test**

Open `http://localhost:3000`, navigate to Riwayat Pesanan. Verify:
- Filter tabs render with counts
- Search narrows the list
- Alert badges appear when orders in those states exist
- Rows are clickable (expand/collapse shows placeholder text)

- [ ] **Step 4: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(order-history): scaffold with filter tabs, search, collapsed rows"
```

---

## Task 5: Expanded Row — PENDING_ADMIN_CONFIRMATION (Approve / Reject)

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx`

- [ ] **Step 1: Add state and helper for the ongkir input and approve action**

Inside `OrderHistoryScreen`, after the `expandedId` state declaration, add:

```typescript
  const [shippingFees, setShippingFees] = useState<Record<string, string>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const handleApprove = async (orderId: string, deliveryType: string | undefined) => {
    const fee = deliveryType === 'PICKUP' ? 0 : parseFloat(shippingFees[orderId] ?? '0');
    setApprovingId(orderId);
    try {
      await orderService.approveOrder(orderId, fee);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'APPROVED', shipping_fee: fee } : o));
      setExpandedId(null);
      showToast('Pesanan berhasil disetujui.', 'success');
    } catch {
      showToast('Gagal menyetujui pesanan.', 'warning');
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectOrder = async (orderId: string) => {
    if (!window.confirm('Yakin tolak pesanan ini?')) return;
    setRejectingId(orderId);
    try {
      await orderService.rejectOrder(orderId);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'CANCELLED' } : o));
      setExpandedId(null);
      showToast('Pesanan ditolak.', 'info');
    } catch {
      showToast('Gagal menolak pesanan.', 'warning');
    } finally {
      setRejectingId(null);
    }
  };
```

- [ ] **Step 2: Create the `ExpandedPendingConfirmation` component** (add before the `export default` line):

```typescript
function ItemsTable({ items, headerClass }: { items: DbOrder['items']; headerClass: string }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden text-xs mb-3">
      <div className={`grid grid-cols-4 px-3 py-2 font-bold uppercase tracking-wide text-[10px] ${headerClass}`}>
        <span>Produk</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Harga</span>
        <span className="text-right">Subtotal</span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-4 px-3 py-2 border-t border-gray-100 bg-white">
          <div>
            <div className="font-semibold text-gray-800">{item.name}</div>
            <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
          </div>
          <div className="text-center font-semibold">{item.qty}</div>
          <div className="text-right text-gray-500">Rp {item.unit_price.toLocaleString('id-ID')}</div>
          <div className="text-right font-bold text-gray-800">Rp {item.subtotal.toLocaleString('id-ID')}</div>
        </div>
      ))}
      <div className="flex justify-end gap-6 px-3 py-2 border-t-2 border-gray-200 bg-gray-50 text-[11px]">
        <div className="text-right text-gray-400 leading-relaxed">
          Subtotal<br />Ongkir<br /><strong className="text-gray-700">Total</strong>
        </div>
        <div className="text-right text-gray-600 leading-relaxed min-w-[90px]">
          Rp {items.reduce((s, i) => s + i.subtotal, 0).toLocaleString('id-ID')}
          <br />—
          <br /><strong className="text-gray-800">Rp {items.reduce((s, i) => s + i.subtotal, 0).toLocaleString('id-ID')} + ongkir</strong>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace the expanded body placeholder for `PENDING_ADMIN_CONFIRMATION`**

In the `{isExpanded && ...}` section within the order row map, replace:

```typescript
                {/* Expanded body placeholder — filled in Tasks 5–7 */}
                {isExpanded && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
                    [expanded row — {order.status}]
                  </div>
                )}
```

with:

```typescript
                {isExpanded && order.status === 'PENDING_ADMIN_CONFIRMATION' && (
                  <div className="px-5 py-4 border-t border-purple-200 bg-purple-50">
                    <div className="grid grid-cols-[1fr_auto] gap-5 items-start">
                      {/* Left: detail */}
                      <div>
                        <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                        </div>
                        <ItemsTable items={order.items} headerClass="bg-purple-100 text-purple-700" />
                        <div className="text-[10px] text-gray-400">⏱ Booking berakhir: {formatDate(order.booking_expires_at)}</div>
                      </div>
                      {/* Right: action */}
                      <div className="flex flex-col gap-2 min-w-[140px]">
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 text-center">Tetapkan Ongkir</div>
                        {order.delivery_type === 'PICKUP' ? (
                          <div className="text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2 text-center">Rp 0 (Pickup)</div>
                        ) : (
                          <div className="flex items-center gap-1.5 bg-gray-50 border border-purple-200 rounded-lg px-3 py-2">
                            <span className="text-gray-400 text-xs">Rp</span>
                            <input
                              type="number"
                              min="0"
                              className="flex-1 bg-transparent text-sm font-bold text-gray-700 outline-none w-20"
                              placeholder="0"
                              value={shippingFees[order.id] ?? ''}
                              onChange={e => setShippingFees(prev => ({ ...prev, [order.id]: e.target.value }))}
                            />
                          </div>
                        )}
                        <button
                          onClick={() => handleApprove(order.id, order.delivery_type)}
                          disabled={
                            approvingId === order.id ||
                            (order.delivery_type !== 'PICKUP' && (!shippingFees[order.id] || shippingFees[order.id] === ''))
                          }
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700 disabled:opacity-40"
                        >
                          {approvingId === order.id ? 'Memproses...' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => handleRejectOrder(order.id)}
                          disabled={rejectingId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-red-600 text-xs font-bold rounded-lg border-2 border-red-200 hover:bg-red-50 disabled:opacity-40"
                        >
                          ✕ Tolak
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {isExpanded && order.status !== 'PENDING_ADMIN_CONFIRMATION' && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
                    [expanded row — {order.status}]
                  </div>
                )}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Manual test**

Open `http://localhost:3000` → Riwayat Pesanan. Expand a "Perlu Konfirmasi" row. Verify the ongkir input and Approve/Tolak buttons appear. For PICKUP orders, verify the input is replaced with "Rp 0 (Pickup)".

- [ ] **Step 6: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(order-history): add PENDING_ADMIN_CONFIRMATION expanded row with approve/reject"
```

---

## Task 6: Expanded Row — PAYMENT_UPLOADED (Verify / Reject Payment)

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx`

- [ ] **Step 1: Add verify/reject payment state and handlers** inside `OrderHistoryScreen`, after the existing `handleRejectOrder`:

```typescript
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [rejectingPaymentId, setRejectingPaymentId] = useState<string | null>(null);

  const handleVerifyPayment = async (orderId: string) => {
    setVerifyingId(orderId);
    try {
      await orderService.verifyPayment(orderId, currentUser?.name ?? '');
      setOrders(prev => prev.map(o =>
        o.id === orderId
          ? { ...o, status: 'PAYMENT_VERIFIED', verified_by: currentUser?.name ?? '', payment_verified_at: new Date().toISOString() }
          : o
      ));
      setExpandedId(null);
      showToast('Pembayaran berhasil diverifikasi.', 'success');
    } catch {
      showToast('Gagal memverifikasi pembayaran.', 'warning');
    } finally {
      setVerifyingId(null);
    }
  };

  const handleRejectPayment = async (orderId: string) => {
    if (!window.confirm('Yakin tolak bukti bayar ini?')) return;
    setRejectingPaymentId(orderId);
    try {
      await orderService.rejectPayment(orderId);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'PAYMENT_REJECTED' } : o));
      setExpandedId(null);
      showToast('Bukti bayar ditolak.', 'info');
    } catch {
      showToast('Gagal menolak bukti bayar.', 'warning');
    } finally {
      setRejectingPaymentId(null);
    }
  };
```

- [ ] **Step 2: Replace the `PAYMENT_UPLOADED` placeholder in the expanded body**

Find:
```typescript
                {isExpanded && order.status !== 'PENDING_ADMIN_CONFIRMATION' && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
                    [expanded row — {order.status}]
                  </div>
                )}
```

Replace with:
```typescript
                {isExpanded && order.status === 'PAYMENT_UPLOADED' && (
                  <div className="px-5 py-4 border-t border-blue-200 bg-blue-50">
                    <div className="grid grid-cols-[1fr_auto] gap-5 items-start">
                      <div>
                        <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                        </div>
                        <ItemsTable items={order.items} headerClass="bg-blue-100 text-blue-700" />
                        {/* Payment proof */}
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">Bukti Transfer</div>
                          <div className="flex items-start gap-3">
                            {order.payment_proof_url ? (
                              <img
                                src={order.payment_proof_url}
                                alt="Bukti bayar"
                                className="w-16 h-20 object-cover rounded-lg border-2 border-blue-200 cursor-pointer"
                                onClick={() => window.open(order.payment_proof_url, '_blank')}
                              />
                            ) : (
                              <div className="w-16 h-20 bg-indigo-100 border-2 border-indigo-200 rounded-lg flex flex-col items-center justify-center gap-1">
                                <span className="text-indigo-400 text-lg">🖼</span>
                                <span className="text-[9px] text-indigo-400 font-semibold">Foto Bukti</span>
                              </div>
                            )}
                            <div>
                              {order.payment_proof_url && (
                                <a
                                  href={order.payment_proof_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-blue-600 font-semibold underline"
                                >
                                  Lihat Ukuran Penuh ↗
                                </a>
                              )}
                              <p className="text-[10px] text-gray-400 mt-1">
                                Dikirim {formatDate(order.updated_at)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Action */}
                      <div className="flex flex-col gap-2 min-w-[120px]">
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 text-center">Tindakan</div>
                        <button
                          onClick={() => handleVerifyPayment(order.id)}
                          disabled={verifyingId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-40"
                        >
                          {verifyingId === order.id ? 'Memproses...' : '✓ Verifikasi'}
                        </button>
                        <button
                          onClick={() => handleRejectPayment(order.id)}
                          disabled={rejectingPaymentId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-red-600 text-xs font-bold rounded-lg border-2 border-red-200 hover:bg-red-50 disabled:opacity-40"
                        >
                          ✕ Tolak
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {isExpanded && order.status !== 'PENDING_ADMIN_CONFIRMATION' && order.status !== 'PAYMENT_UPLOADED' && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
                    [expanded row — {order.status}]
                  </div>
                )}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(order-history): add PAYMENT_UPLOADED expanded row with verify/reject"
```

---

## Task 7: Expanded Rows — WAITING_PAYMENT, COMPLETED/PAYMENT_VERIFIED, CANCELLED

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx`

- [ ] **Step 1: Add invoice modal state** inside `OrderHistoryScreen` (after the `rejectingPaymentId` state):

```typescript
  const [invoiceOrder, setInvoiceOrder] = useState<DbOrder | null>(null);
```

- [ ] **Step 2: Replace the final placeholder with all remaining expanded rows**

Find:
```typescript
                {isExpanded && order.status !== 'PENDING_ADMIN_CONFIRMATION' && order.status !== 'PAYMENT_UPLOADED' && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
                    [expanded row — {order.status}]
                  </div>
                )}
```

Replace with:
```typescript
                {isExpanded && order.status === 'WAITING_PAYMENT' && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                    <div className="grid grid-cols-4 gap-3 mb-3 text-xs">
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Total</div><div className="font-bold text-gray-800">Rp {order.total.toLocaleString('id-ID')}</div></div>
                    </div>
                    <ItemsTable items={order.items} headerClass="bg-gray-100 text-gray-600" />
                  </div>
                )}
                {isExpanded && (order.status === 'PAYMENT_VERIFIED' || order.status === 'COMPLETED') && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                    <div className="grid grid-cols-4 gap-3 mb-3 text-xs">
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Diverifikasi Oleh</div>
                        <div className="font-semibold text-gray-700">
                          {order.verified_by ?? '—'}{order.payment_verified_at ? ` · ${formatDate(order.payment_verified_at)}` : ''}
                        </div>
                      </div>
                    </div>
                    <ItemsTable items={order.items} headerClass="bg-gray-100 text-gray-600" />
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <span className="text-xs text-gray-500">
                        ✅ Diverifikasi oleh {order.verified_by ?? '—'} · {order.payment_verified_at ? formatDate(order.payment_verified_at) : '—'}
                      </span>
                      <button
                        onClick={() => setInvoiceOrder(order)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-white text-[#012749] text-xs font-bold rounded-lg border border-[#c7d7f5] hover:bg-blue-50"
                      >
                        📄 Lihat Invoice
                      </button>
                    </div>
                  </div>
                )}
                {isExpanded && (order.status === 'CANCELLED' || order.status === 'PAYMENT_REJECTED') && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                    <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Total</div><div className="font-bold text-gray-400">Rp {order.total.toLocaleString('id-ID')}</div></div>
                    </div>
                    <ItemsTable items={order.items} headerClass="bg-gray-100 text-gray-600" />
                  </div>
                )}
```

Also add the `InvoiceModal` render just before the closing `</div>` of the return (after the order list):
```typescript
      {/* Invoice modal — wired in Task 8 */}
      {invoiceOrder && (
        <div className="text-xs text-gray-400 p-4">Invoice modal coming soon for {invoiceOrder.gjp_order_id}</div>
      )}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(order-history): add expanded rows for WAITING_PAYMENT, COMPLETED, CANCELLED"
```

---

## Task 8: InvoiceModal Component

**Files:**
- Create: `src/components/InvoiceModal.tsx`
- Modify: `src/components/OrderHistoryScreen.tsx` (wire up modal)

- [ ] **Step 1: Create `src/components/InvoiceModal.tsx`**

```typescript
import React, { useEffect, useState, useRef } from 'react';
import { X, Download, FileText } from 'lucide-react';
import { DbOrder, DbBankConfig, DbCompanySettings } from '../types';
import { bankConfigService, companySettingsService, isSupabaseConfigured } from '../lib/supabaseClient';

interface InvoiceModalProps {
  order: DbOrder;
  onClose: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function InvoiceModal({ order, onClose }: InvoiceModalProps) {
  const [company, setCompany] = useState<DbCompanySettings | null>(null);
  const [bank, setBank]       = useState<DbBankConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    Promise.all([companySettingsService.fetch(), bankConfigService.fetch()])
      .then(([co, bk]) => { setCompany(co); setBank(bk); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const orderId = order.gjp_order_id ?? order.id.slice(0, 8).toUpperCase();

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          body > *:not(#invoice-print-root) { display: none !important; }
          #invoice-print-root { position: fixed; inset: 0; z-index: 9999; background: white; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>

      {/* Modal overlay */}
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          id="invoice-print-root"
          className="bg-white rounded-2xl overflow-hidden shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-3 bg-[#012749] text-white print:hidden">
            <div className="flex items-center gap-2 font-bold text-sm">
              <FileText className="w-4 h-4" />
              Invoice {orderId}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#2d8a4e] text-white text-xs font-bold rounded-lg hover:bg-green-700"
              >
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
              <button onClick={onClose} className="opacity-60 hover:opacity-100 text-xl leading-none">×</button>
            </div>
          </div>

          {/* Scrollable invoice body */}
          <div className="overflow-y-auto bg-gray-100 p-4 flex-1">
            <div ref={printRef} className="bg-white rounded-lg shadow-sm p-7 font-serif text-sm">
              {loading ? (
                <p className="text-center text-gray-400 py-8">Memuat...</p>
              ) : (
                <>
                  {/* Invoice header */}
                  <div className="flex justify-between items-start pb-5 mb-5 border-b-2 border-[#012749]">
                    <div>
                      <div className="text-xl font-black text-[#012749] tracking-tight">{company?.company_name ?? 'Garindo Jaya Panel'}</div>
                      <div className="text-[11px] text-gray-500 font-sans mt-1 flex items-center gap-1">
                        {company?.address || 'Alamat belum diisi'}
                        <span className="print:hidden text-[9px] bg-indigo-100 text-indigo-700 rounded px-1 py-0.5 font-bold">⚙ config</span>
                      </div>
                      <div className="text-[11px] text-gray-500 font-sans">
                        {company?.phone && `${company.phone} · `}{company?.email ?? ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-[#012749] tracking-widest uppercase">Invoice</div>
                      <div className="text-xs font-mono font-bold text-gray-700 mt-1">{orderId}</div>
                      <div className="text-[10px] text-gray-400 font-sans mt-0.5">Tanggal: {formatDate(order.created_at)}</div>
                    </div>
                  </div>

                  {/* Bill To */}
                  <div className="grid grid-cols-2 gap-5 mb-5">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 font-sans">Kepada Yth.</div>
                      <div className="font-bold text-gray-800">{order.customer_name}</div>
                      {order.customer_company && <div className="text-xs text-gray-500 font-sans">{order.customer_company}</div>}
                      {order.customer_address && <div className="text-xs text-gray-500 font-sans">{order.customer_address}</div>}
                      <div className="text-xs text-gray-500 font-sans">WA: {order.customer_phone}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 font-sans">Pengiriman</div>
                      <div className="text-xs text-gray-600 font-sans mb-3">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1 font-sans">Status Pembayaran</div>
                      <span className="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded font-sans">✓ LUNAS</span>
                    </div>
                  </div>

                  {/* Line items table */}
                  <table className="w-full text-xs font-sans border-collapse mb-4">
                    <thead>
                      <tr className="bg-[#012749] text-white">
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-bold">No.</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-bold">Produk / SKU</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Qty</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Harga Satuan</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-gray-800">{item.name}</div>
                            <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{item.qty}</td>
                          <td className="px-3 py-2 text-right text-gray-500">Rp {item.unit_price.toLocaleString('id-ID')}</td>
                          <td className="px-3 py-2 text-right font-bold text-gray-800">Rp {item.subtotal.toLocaleString('id-ID')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Totals */}
                  <div className="flex justify-end mb-4">
                    <div className="min-w-[200px] text-xs font-sans">
                      <div className="flex justify-between py-1 text-gray-500 border-b border-gray-100">
                        <span>Subtotal</span><span>Rp {order.subtotal.toLocaleString('id-ID')}</span>
                      </div>
                      <div className="flex justify-between py-1 text-gray-500 border-b border-gray-100">
                        <span>Ongkos Kirim</span><span>Rp {(order.shipping_fee ?? 0).toLocaleString('id-ID')}</span>
                      </div>
                      <div className="flex justify-between py-2 font-black text-[#012749] text-sm border-t-2 border-[#012749] mt-1">
                        <span>TOTAL</span><span>Rp {order.total.toLocaleString('id-ID')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Bank info */}
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-3 font-sans">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Informasi Pembayaran</div>
                      <span className="print:hidden text-[9px] bg-indigo-100 text-indigo-700 rounded px-1 py-0.5 font-bold">⚙ config</span>
                    </div>
                    <div className="text-xs text-gray-700">
                      {bank ? (
                        <>Bank {bank.bank_name} · No. Rek: <strong>{bank.account_number}</strong> · a/n <strong>{bank.account_name}</strong></>
                      ) : (
                        <span className="text-gray-400">Rekening belum dikonfigurasi di Pengaturan.</span>
                      )}
                    </div>
                    {order.payment_verified_at && (
                      <div className="text-xs text-green-700 font-semibold mt-1">
                        ✓ Pembayaran diverifikasi oleh {order.verified_by ?? '—'} pada {formatDateTime(order.payment_verified_at)}
                      </div>
                    )}
                  </div>

                  {/* No-refund notice */}
                  <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5 mb-4 font-sans text-xs text-orange-800">
                    <strong>Catatan Penting:</strong> Barang yang telah dibeli tidak dapat dikembalikan atau direfund dalam kondisi apapun. Pastikan pesanan sudah sesuai sebelum melakukan pembayaran.
                  </div>

                  {/* Footer */}
                  <div className="text-center text-[10px] text-gray-400 font-sans border-t border-gray-100 pt-3">
                    Terima kasih atas kepercayaan Anda kepada {company?.company_name ?? 'Garindo Jaya Panel'} 🙏<br />
                    Dokumen ini diterbitkan secara otomatis oleh sistem ERP {company?.company_name ?? 'Garindo Jaya Panel'}.
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Modal footer */}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 print:hidden">
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-200">Tutup</button>
            <button onClick={handlePrint} className="flex items-center gap-1.5 px-4 py-2 bg-[#2d8a4e] text-white text-xs font-bold rounded-lg hover:bg-green-700">
              <Download className="w-3.5 h-3.5" /> Download PDF
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Wire up `InvoiceModal` in `OrderHistoryScreen.tsx`**

Add the import at the top:
```typescript
import InvoiceModal from './InvoiceModal';
```

Replace the stub modal render added in Task 7:
```typescript
      {/* Invoice modal — wired in Task 8 */}
      {invoiceOrder && (
        <div className="text-xs text-gray-400 p-4">Invoice modal coming soon for {invoiceOrder.gjp_order_id}</div>
      )}
```

With:
```typescript
      {invoiceOrder && (
        <InvoiceModal order={invoiceOrder} onClose={() => setInvoiceOrder(null)} />
      )}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Manual test**

Navigate to Riwayat Pesanan, expand a COMPLETED/PAYMENT_VERIFIED order, click "Lihat Invoice". Verify:
- Modal opens with invoice document
- Company name and bank details are shown (from Supabase if configured; fallback text if not)
- No-refund notice appears
- "Download PDF" button triggers `window.print()`
- `⚙ config` badges do not appear when printing (use browser print preview to confirm)

- [ ] **Step 5: Commit**

```bash
git add src/components/InvoiceModal.tsx src/components/OrderHistoryScreen.tsx
git commit -m "feat(invoice): add InvoiceModal with PDF print, company settings, no-refund notice"
```

---

## Task 9: Company Settings in PengaturanScreen

**Files:**
- Modify: `src/components/PengaturanScreen.tsx`

- [ ] **Step 1: Add `DbCompanySettings` import and `companySettingsService` import**

At the top of `PengaturanScreen.tsx`, update the imports:
```typescript
import { DbBankConfig, DbWaRecipient, DbCompanySettings } from '../types';
import { bankConfigService, waRecipientsService, companySettingsService, isSupabaseConfigured } from '../lib/supabaseClient';
```

Also add `MapPin` to the lucide-react import:
```typescript
import { Settings, Building2, Users, Plus, Trash2, ToggleLeft, ToggleRight, Edit2, Save, X, MapPin } from 'lucide-react';
```

- [ ] **Step 2: Add company settings state inside `PengaturanScreen`**

After the `bankSaving` state declaration, add:
```typescript
  const [company, setCompany]           = useState<DbCompanySettings | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [companyEditing, setCompanyEditing] = useState(false);
  const [companyForm, setCompanyForm]   = useState({ company_name: '', address: '', phone: '', email: '' });
  const [companySaving, setCompanySaving] = useState(false);
```

- [ ] **Step 3: Add company settings fetch to the existing `useEffect`**

Find the `Promise.all` call in the `useEffect`:
```typescript
    Promise.all([bankConfigService.fetch(), waRecipientsService.fetchAll()])
      .then(([bank, recips]) => {
        setBankConfig(bank);
        setRecipients(recips);
      })
      .catch(err => {
        console.error('PengaturanScreen load error:', err);
        showToast('Gagal memuat data pengaturan.', 'warning');
      })
      .finally(() => {
        setBankLoading(false);
        setRecipientsLoading(false);
      });
```

Replace with:
```typescript
    Promise.all([bankConfigService.fetch(), waRecipientsService.fetchAll(), companySettingsService.fetch()])
      .then(([bank, recips, co]) => {
        setBankConfig(bank);
        setRecipients(recips);
        setCompany(co);
      })
      .catch(err => {
        console.error('PengaturanScreen load error:', err);
        showToast('Gagal memuat data pengaturan.', 'warning');
      })
      .finally(() => {
        setBankLoading(false);
        setRecipientsLoading(false);
        setCompanyLoading(false);
      });
```

- [ ] **Step 4: Add company settings handlers** (after the `cancelEdit` function):

```typescript
  const startCompanyEdit = () => {
    setCompanyForm({
      company_name: company?.company_name ?? '',
      address:      company?.address ?? '',
      phone:        company?.phone ?? '',
      email:        company?.email ?? '',
    });
    setCompanyEditing(true);
  };

  const cancelCompanyEdit = () => setCompanyEditing(false);

  const saveCompany = async (): Promise<void> => {
    if (!companyForm.company_name) {
      showToast('Nama perusahaan wajib diisi.', 'warning');
      return;
    }
    setCompanySaving(true);
    try {
      await companySettingsService.save(companyForm);
      const updated = await companySettingsService.fetch();
      setCompany(updated);
      setCompanyEditing(false);
      showToast('Profil perusahaan berhasil disimpan.', 'success');
    } catch (err) {
      console.error('saveCompany error:', err);
      showToast('Gagal menyimpan profil perusahaan.', 'warning');
    } finally {
      setCompanySaving(false);
    }
  };
```

- [ ] **Step 5: Add the Profil Perusahaan card to the JSX** (insert after the closing `</div>` of the "Rekening Bank" card, before the "Penerima Notifikasi WA" card):

```typescript
      {/* Company profile card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-bold text-gray-800">Profil Perusahaan</h2>
          </div>
          {company && !companyEditing && (
            <button onClick={startCompanyEdit} className="p-2 rounded-lg hover:bg-gray-100" title="Edit profil">
              <Edit2 className="w-4 h-4 text-gray-600" />
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-4">Data ini tampil di setiap invoice yang diterbitkan.</p>

        {companyLoading ? (
          <p className="text-sm text-gray-400">Memuat...</p>
        ) : companyEditing ? (
          <div className="space-y-3">
            {[
              { key: 'company_name', label: 'Nama Perusahaan', placeholder: 'Garindo Jaya Panel' },
              { key: 'address',      label: 'Alamat',          placeholder: 'Jl. Contoh No. 1, Jakarta' },
              { key: 'phone',        label: 'Telepon',         placeholder: '+62 21-xxxx-xxxx' },
              { key: 'email',        label: 'Email',           placeholder: 'toko@email.com' },
            ].map(field => (
              <div key={field.key}>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{field.label}</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={field.placeholder}
                  value={companyForm[field.key as keyof typeof companyForm]}
                  onChange={e => setCompanyForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveCompany}
                disabled={companySaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {companySaving ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button
                onClick={cancelCompanyEdit}
                disabled={companySaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                Batal
              </button>
            </div>
          </div>
        ) : company ? (
          <div className="space-y-2">
            {[
              { label: 'Nama Perusahaan', value: company.company_name },
              { label: 'Alamat',          value: company.address || '—' },
              { label: 'Telepon',         value: company.phone || '—' },
              { label: 'Email',           value: company.email || '—' },
            ].map(row => (
              <div key={row.label} className="flex items-start gap-3 text-sm">
                <span className="w-40 text-gray-500 font-medium shrink-0">{row.label}</span>
                <span className="font-semibold text-gray-800">{row.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500 mb-3">Profil perusahaan belum diisi.</p>
            <button onClick={startCompanyEdit} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 mx-auto">
              <Plus className="w-4 h-4" /> Isi Profil
            </button>
          </div>
        )}
      </div>
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Manual test**

Navigate to Pengaturan. Verify the "Profil Perusahaan" card appears. Edit and save — verify changes persist on refresh.

- [ ] **Step 8: Commit**

```bash
git add src/components/PengaturanScreen.tsx
git commit -m "feat(settings): add Profil Perusahaan section for invoice company details"
```

---

## Task 10: Dashboard Cleanup

**Files:**
- Modify: `src/components/DashboardScreen.tsx`
- Modify: `src/App.tsx` (pass `setActivePage` to DashboardScreen, or use existing prop)

- [ ] **Step 1: Check how `DashboardScreen` currently receives navigation**

Open `src/App.tsx` and find how `DashboardScreen` is rendered. Check if it already receives an `onNavigate` or `setActivePage` prop. If it does, use it. If not, add it in this step.

In `src/App.tsx`, find:
```typescript
      case 'dashboard':
        return (
          <DashboardScreen showToast={triggerToast} />
        );
```

Replace with:
```typescript
      case 'dashboard':
        return (
          <DashboardScreen
            showToast={triggerToast}
            onNavigate={(page) => setActivePage(page)}
          />
        );
```

- [ ] **Step 2: Update `DashboardScreen` props interface**

At the top of `src/components/DashboardScreen.tsx`, find the props interface and add `onNavigate`:

```typescript
interface DashboardScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onNavigate: (page: import('../types').ActivePage) => void;
}
```

Update the function signature:
```typescript
export default function DashboardScreen({ showToast, onNavigate }: DashboardScreenProps) {
```

- [ ] **Step 3: Remove the order approval panel from DashboardScreen**

Find and delete the entire block that renders pending orders (the "Order Baru Masuk" / `orders.map(...)` section). This is the block guarded by `{orders.length > 0 && (...)}`  that renders order cards with the ongkir input and Setujui button.

Replace the deleted block with the two alert links:

```typescript
      {/* Alert links to Order History */}
      {(orders.length > 0 || paymentUploadedOrders.length > 0) && (
        <div className="flex gap-3 flex-wrap">
          {orders.length > 0 && (
            <button
              onClick={() => onNavigate('order-history')}
              className="flex items-center gap-2 bg-purple-100 text-purple-800 border border-purple-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-purple-200 transition-colors"
            >
              🔔 {orders.length} pesanan perlu konfirmasi
              <span className="text-purple-400 text-xs">→ Riwayat Pesanan</span>
            </button>
          )}
          {paymentUploadedOrders.length > 0 && (
            <button
              onClick={() => onNavigate('order-history')}
              className="flex items-center gap-2 bg-blue-100 text-blue-800 border border-blue-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-200 transition-colors"
            >
              📎 {paymentUploadedOrders.length} bukti bayar menunggu verifikasi
              <span className="text-blue-400 text-xs">→ Riwayat Pesanan</span>
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 4: Remove the `PaymentVerificationCard` panel from DashboardScreen**

Find and delete the entire block guarded by `{paymentUploadedOrders.length > 0 && (...)}` that renders the "Bukti Pembayaran Menunggu Verifikasi" section with `PaymentVerificationCard` components.

Also remove the `PaymentVerificationCard` component definition from the file if it's defined there (not imported from elsewhere). If it IS imported, remove the import line too.

- [ ] **Step 5: Remove now-unused state and handlers from DashboardScreen**

Remove any state or handlers that are now only used by the removed panels:
- `shippingFees` state (if only used by approval panel)
- `approvingId` state (if only used by approval panel)
- `handleApprove` function (if only used by approval panel)
- `handleVerify` / `handleReject` functions (if only used by PaymentVerificationCard)

Check for TypeScript errors after removing — `npm run build` will catch anything missed.

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: zero TypeScript errors.

- [ ] **Step 7: Manual end-to-end test**

1. Dashboard: verify old approval panel is gone, purple/blue alert badges appear when data exists
2. Click a badge → navigates to Riwayat Pesanan
3. Riwayat Pesanan: all filter tabs work, expand/collapse rows
4. Approve a PENDING order → row updates to APPROVED, disappears from "Perlu Konfirmasi" tab
5. Verify a PAYMENT_UPLOADED order → row updates to PAYMENT_VERIFIED, shows in "Selesai" tab
6. Open invoice modal on a PAYMENT_VERIFIED order → PDF preview renders, Download PDF works
7. Pengaturan → Profil Perusahaan → save → invoice now shows updated address

- [ ] **Step 8: Update progress.md**

Add a note that F1 Order History is complete.

- [ ] **Step 9: Commit**

```bash
git add src/components/DashboardScreen.tsx src/App.tsx
git commit -m "feat(dashboard): replace order panels with alert links to Order History"
```
