# G1 — Customer Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pelanggan (Customer 360) split-view screen and improve Pipeline with search, collapsible rows, and order detail expansion.

**Architecture:** New `PelangganScreen` with a fixed customer list on the left and a profile panel on the right — selecting a customer loads their profile without page navigation. Pipeline gets a search bar and collapsible rows; ORDERED leads show a full items table. Customer names in Pipeline and Order History become links that open the Pelanggan screen with that customer pre-selected.

**Tech Stack:** React 19, TypeScript (strict), Tailwind CSS v4, Supabase JS client, Lucide React icons. No test framework — verification is `npm run build` (zero TypeScript errors).

---

## File Map

| File | Change |
|------|--------|
| `src/types.ts` | Add `'pelanggan'` to `ActivePage`; add `DbCustomerWithStats`, `DbCustomerProfile`; add `orders?: DbOrder[]` to `DbLead` |
| `src/lib/supabaseClient.ts` | Add `customersService.fetchAll()` and `customersService.fetchProfile()`; extend `leadsService.fetchAll()` select |
| `src/components/Sidebar.tsx` | Add `Users` import; add `'pelanggan'` menu entry after Pipeline |
| `src/App.tsx` | Add `'pelanggan'` route; add `openCustomerId` state + `handleOpenCustomer`; pass to Pipeline + OrderHistory |
| Create: `src/components/PelangganScreen.tsx` | Full split-view Customer 360 screen |
| `src/components/PipelineScreen.tsx` | Add search, `expandedId` state, collapsible rows, items table, `onOpenCustomer` prop |
| `src/components/OrderHistoryScreen.tsx` | Add `onOpenCustomer` prop; make customer name a link in collapsed row |

---

## Task 1: Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `'pelanggan'` to `ActivePage` union**

In `src/types.ts`, line 220, change:
```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history';
```
to:
```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history' | 'pelanggan';
```

- [ ] **Step 2: Add `orders?: DbOrder[]` to `DbLead`**

In `src/types.ts`, in the `DbLead` interface (after `customers: DbCustomer | null;`), add:
```typescript
  orders?: DbOrder[];  // linked orders via orders.leads_id FK (populated by leadsService.fetchAll)
```

- [ ] **Step 3: Add `DbCustomerWithStats` and `DbCustomerProfile` interfaces**

After the `DbLead` interface closing brace, add:
```typescript
export interface DbCustomerWithStats extends DbCustomer {
  order_count: number;
  total_spend: number;
}

export interface DbCustomerProfile extends DbCustomer {
  orders: DbOrder[];
  leads: DbLead[];
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: zero TypeScript errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add pelanggan to ActivePage; add DbCustomerWithStats, DbCustomerProfile, DbLead.orders"
```

---

## Task 2: Service Layer

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add `DbCustomerWithStats` and `DbCustomerProfile` to the import line**

In `src/lib/supabaseClient.ts` line 7, extend the import:
```typescript
import type { DbConversation, DbMessage, DbOrder, DbBankConfig, DbWaRecipient, DbCustomer, DbCustomerWithStats, DbCustomerProfile, DbLead, DbNotificationConfig, DbCompanySettings } from '../types';
```

- [ ] **Step 2: Add `customersService` after `leadsService`**

After the closing `};` of `leadsService`, add:
```typescript
export const customersService = {
  async fetchAll(): Promise<DbCustomerWithStats[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('customers')
      .select('*, orders!orders_customer_id_fkey(id, total)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(({ orders, ...customer }: any) => ({
      ...customer,
      order_count: orders?.length ?? 0,
      total_spend: (orders ?? []).reduce((s: number, o: any) => s + Number(o.total ?? 0), 0),
    }));
  },

  async fetchProfile(customerId: string): Promise<DbCustomerProfile> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('customers')
      .select('*, orders!orders_customer_id_fkey(*), leads!leads_customer_id_fkey(*)')
      .eq('id', customerId)
      .single();
    if (error) throw error;
    const profile = data as any;
    profile.orders = (profile.orders ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    profile.leads = (profile.leads ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return profile as DbCustomerProfile;
  },
};
```

- [ ] **Step 3: Update `leadsService.fetchAll()` to join linked orders**

Replace the existing `leadsService.fetchAll()` body:
```typescript
export const leadsService = {
  async fetchAll(): Promise<DbLead[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('leads')
      .select('*, customers(*), orders!orders_leads_id_fkey(id, gjp_order_id, items, subtotal, shipping_fee, total, status, created_at, delivery_type)')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DbLead[];
  },
};
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(supabase): add customersService fetchAll/fetchProfile; extend leadsService with orders join"
```

---

## Task 3: Sidebar + App.tsx Routing Stub

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Create: `src/components/PelangganScreen.tsx` (stub only)

- [ ] **Step 1: Add `Users` import to Sidebar.tsx**

In `src/components/Sidebar.tsx`, find the lucide-react import line and add `Users`:
```typescript
import { LayoutDashboard, MessageSquare, Package, Users2, Bell, Bot, Settings, TrendingUp, ClipboardList, Zap, LogOut, Users } from 'lucide-react';
```

- [ ] **Step 2: Add `'pelanggan'` menu item to Sidebar**

After the Pipeline menu entry (`id: 'pipeline'` block), add:
```typescript
    {
      id: 'pelanggan' as ActivePage,
      label: 'Pelanggan',
      icon: Users,
      description: 'Profil & Riwayat',
    },
```

- [ ] **Step 3: Create `PelangganScreen.tsx` stub**

Create `src/components/PelangganScreen.tsx`:
```typescript
import React from 'react';
import { Users } from 'lucide-react';
import { ActivePage } from '../types';

interface PelangganScreenProps {
  openCustomerId?: string | null;
  onNavigate: (page: ActivePage) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function PelangganScreen({ openCustomerId, onNavigate, showToast }: PelangganScreenProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Pelanggan</h1>
      </div>
      <p className="text-gray-400 text-sm">Coming soon... openCustomerId={openCustomerId ?? 'none'}</p>
    </div>
  );
}
```

- [ ] **Step 4: Add `openCustomerId` state and `handleOpenCustomer` to App.tsx**

In `src/App.tsx`, after the `activePage` state declaration, add:
```typescript
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null);
```

Add the handler function after `handleLogout`:
```typescript
  const handleOpenCustomer = (customerId: string) => {
    setOpenCustomerId(customerId);
    setActivePage('pelanggan');
  };
```

Also, in the `setActivePage` call (via Sidebar `onPageChange`), reset `openCustomerId` when leaving `'pelanggan'`. Find where `onPageChange` is called in Sidebar and update App.tsx to:
```typescript
onPageChange={(page) => {
  if (page !== 'pelanggan') setOpenCustomerId(null);
  setActivePage(page);
}}
```

- [ ] **Step 5: Add `PelangganScreen` import and route to App.tsx**

Add import after the `PipelineScreen` import:
```typescript
import PelangganScreen from './components/PelangganScreen';
```

In `renderPage()` switch, add after the `'pipeline'` case:
```typescript
      case 'pelanggan':
        return (
          <PelangganScreen
            openCustomerId={openCustomerId}
            onNavigate={setActivePage}
            showToast={triggerToast}
          />
        );
```

- [ ] **Step 6: Verify build and sidebar**

Run: `npm run build`
Expected: zero TypeScript errors. The "Pelanggan" entry should now appear in the sidebar between Pipeline and Riwayat Pesanan.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar.tsx src/components/PelangganScreen.tsx src/App.tsx
git commit -m "feat(nav): add Pelanggan to sidebar and App.tsx routing stub"
```

---

## Task 4: PelangganScreen — Left Panel (Customer List)

**Files:**
- Modify: `src/components/PelangganScreen.tsx`

Replace the stub with the full implementation including the left panel. The right panel will be added in Task 5.

- [ ] **Step 1: Write full PelangganScreen with left panel**

Replace `src/components/PelangganScreen.tsx` entirely:
```typescript
import React, { useState, useEffect } from 'react';
import { Users, Search } from 'lucide-react';
import { ActivePage, DbCustomerWithStats } from '../types';
import { customersService, isSupabaseConfigured } from '../lib/supabaseClient';

interface PelangganScreenProps {
  openCustomerId?: string | null;
  onNavigate: (page: ActivePage) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

export default function PelangganScreen({ openCustomerId, onNavigate, showToast }: PelangganScreenProps) {
  const [customers, setCustomers] = useState<DbCustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(openCustomerId ?? null);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    customersService.fetchAll()
      .then(setCustomers)
      .catch(() => showToast('Gagal memuat data pelanggan.', 'warning'))
      .finally(() => setLoading(false));
  }, []);

  // Sync when parent passes a new openCustomerId
  useEffect(() => {
    if (openCustomerId) setSelectedId(openCustomerId);
  }, [openCustomerId]);

  const filtered = customers.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.wa_number.includes(q) ||
      c.company.toLowerCase().includes(q)
    );
  });

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-800">Pelanggan</h1>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
          Supabase belum dikonfigurasi.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Pelanggan</h1>
      </div>

      {/* Split layout */}
      <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ minHeight: '520px' }}>

        {/* Left panel */}
        <div className="w-72 shrink-0 border-r border-gray-200 flex flex-col">
          {/* Search */}
          <div className="p-3 border-b border-gray-200">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400">
              <Search className="w-3.5 h-3.5 shrink-0" />
              <input
                className="flex-1 bg-transparent outline-none text-gray-700 placeholder:text-gray-400 text-xs"
                placeholder="Cari nama, WA, perusahaan..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Customer list */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {loading ? (
              <div className="p-6 text-center text-sm text-gray-400">Memuat...</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                {customers.length === 0 ? 'Belum ada data pelanggan.' : 'Tidak ada pelanggan yang cocok dengan pencarian.'}
              </div>
            ) : (
              filtered.map(c => {
                const isSelected = selectedId === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                      isSelected ? 'bg-indigo-50 border-l-[3px] border-l-[#012749]' : 'hover:bg-gray-50 border-l-[3px] border-l-transparent'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                      isSelected ? 'bg-[#012749] text-white' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {initials(c.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-bold text-sm truncate ${isSelected ? 'text-[#012749]' : 'text-gray-800'}`}>
                        {c.name}
                      </div>
                      <div className="font-mono text-[10px] text-gray-400 truncate">{c.wa_number}</div>
                    </div>
                    <div className={`text-xs font-bold shrink-0 ${isSelected ? 'text-[#012749]' : 'text-gray-500'}`}>
                      {c.order_count}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel — placeholder until Task 5 */}
        <div className="flex-1 flex items-center justify-center text-gray-300">
          <div className="text-center">
            <Users className="w-10 h-10 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-400">Pilih pelanggan untuk melihat profilnya.</p>
          </div>
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: zero TypeScript errors. Navigate to Pelanggan in sidebar — should show header, split layout with customer list on left, placeholder on right.

- [ ] **Step 3: Commit**

```bash
git add src/components/PelangganScreen.tsx
git commit -m "feat(pelanggan): add left panel — customer list with search and selection state"
```

---

## Task 5: PelangganScreen — Right Panel (Customer Profile)

**Files:**
- Modify: `src/components/PelangganScreen.tsx`

Add `profile` state and the full right panel. Replace only the right panel placeholder div.

- [ ] **Step 1: Add profile state and fetch logic**

In `PelangganScreen`, add inside the component (after `selectedId` state):
```typescript
  const [profile, setProfile] = useState<DbCustomerProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
```

Add import for `DbCustomerProfile` in the types import line:
```typescript
import { ActivePage, DbCustomerWithStats, DbCustomerProfile } from '../types';
```

Add a `useEffect` that fires when `selectedId` changes:
```typescript
  useEffect(() => {
    if (!selectedId || !isSupabaseConfigured) { setProfile(null); return; }
    setLoadingProfile(true);
    customersService.fetchProfile(selectedId)
      .then(setProfile)
      .catch(() => showToast('Gagal memuat profil pelanggan.', 'warning'))
      .finally(() => setLoadingProfile(false));
  }, [selectedId]);
```

- [ ] **Step 2: Add helper constants and functions before `export default`**

Add before `export default function PelangganScreen`:
```typescript
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  PENDING_ADMIN_CONFIRMATION: { label: '🔔 Perlu Konfirmasi', className: 'bg-purple-100 text-purple-800' },
  APPROVED:         { label: '✓ Disetujui',       className: 'bg-teal-100 text-teal-800' },
  WAITING_PAYMENT:  { label: '⏳ Menunggu Bayar',  className: 'bg-yellow-100 text-yellow-800' },
  PAYMENT_UPLOADED: { label: '📎 Bukti Dikirim',   className: 'bg-blue-100 text-blue-800' },
  PAYMENT_VERIFIED: { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  COMPLETED:        { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  PAYMENT_REJECTED: { label: '✕ Bayar Ditolak',    className: 'bg-rose-100 text-rose-800' },
  CANCELLED:        { label: '✕ Dibatalkan',        className: 'bg-red-100 text-red-800' },
};

const TOTAL_COLOR: Record<string, string> = {
  PAYMENT_VERIFIED: 'text-green-700',
  COMPLETED:        'text-green-700',
  WAITING_PAYMENT:  'text-yellow-700',
  PAYMENT_UPLOADED: 'text-blue-700',
  PAYMENT_REJECTED: 'text-gray-400',
  CANCELLED:        'text-gray-400',
};

const LEAD_BADGE: Record<string, { label: string; className: string }> = {
  NEW:         { label: 'Baru',     className: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { label: 'Proses',   className: 'bg-blue-100 text-blue-700' },
  ESCALATED:   { label: 'Eskalasi', className: 'bg-amber-100 text-amber-700' },
  ORDERED:     { label: 'Selesai',  className: 'bg-emerald-100 text-emerald-700' },
  DROPPED:     { label: 'Gugur',    className: 'bg-red-100 text-red-500' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRupiah(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}
```

- [ ] **Step 3: Replace the right panel placeholder with the full profile panel**

Replace the entire `{/* Right panel — placeholder until Task 5 */}` div with:
```typescript
        {/* Right panel */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-gray-300">
              <div className="text-center">
                <Users className="w-10 h-10 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-400">Pilih pelanggan untuk melihat profilnya.</p>
              </div>
            </div>
          ) : loadingProfile ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Memuat profil...</div>
          ) : profile ? (
            <>
              {/* Profile header */}
              <div className="bg-[#012749] text-white p-4 flex items-center gap-3 shrink-0">
                <div className="w-11 h-11 rounded-xl bg-[#2d8a4e] flex items-center justify-center text-lg font-extrabold shrink-0">
                  {initials(profile.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold text-[15px] truncate">{profile.name}</div>
                  <div className="text-[11px] opacity-60 mt-0.5">
                    {profile.wa_number}
                    {profile.company && ` · ${profile.company}`}
                  </div>
                  <div className="text-[11px] opacity-60">Pelanggan sejak {formatDate(profile.created_at)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-extrabold text-emerald-300">
                    {formatRupiah(profile.orders.reduce((s, o) => s + o.total, 0))}
                  </div>
                  <div className="text-[9px] opacity-55">total belanja</div>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 border-b border-gray-200 shrink-0">
                {[
                  { label: 'Pesanan', value: profile.orders.length.toString() },
                  { label: 'Leads',   value: profile.leads.length.toString() },
                  {
                    label: 'Konversi',
                    value: profile.leads.length === 0 ? '—' :
                      Math.round(profile.leads.filter(l => l.status === 'ORDERED').length / profile.leads.length * 100) + '%',
                    color: profile.leads.length === 0 ? 'text-gray-400' :
                      profile.leads.filter(l => l.status === 'ORDERED').length === profile.leads.length ? 'text-[#2d8a4e]' : 'text-amber-600',
                  },
                ].map((stat, i) => (
                  <div key={i} className={`py-3 text-center ${i < 2 ? 'border-r border-gray-200' : ''}`}>
                    <div className={`text-base font-extrabold ${(stat as any).color ?? 'text-[#012749]'}`}>{stat.value}</div>
                    <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mt-0.5">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Orders section */}
              <div className="px-5 py-4">
                <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Riwayat Pesanan ({profile.orders.length})
                </div>
                {profile.orders.length === 0 ? (
                  <p className="text-sm text-gray-400">Belum ada pesanan.</p>
                ) : (
                  profile.orders.map(order => {
                    const badge = STATUS_BADGE[order.status] ?? { label: order.status, className: 'bg-gray-100 text-gray-600' };
                    const totalColor = TOTAL_COLOR[order.status] ?? 'text-gray-700';
                    return (
                      <div key={order.id} className="border border-gray-200 rounded-lg p-3 mb-2 last:mb-0 text-xs">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold font-mono text-gray-700">{order.gjp_order_id ?? order.id.slice(0, 8)}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                        </div>
                        <div className="text-gray-500 text-[11px]">
                          {order.items[0]?.name ?? '—'}
                          {order.items.length > 1 && ` +${order.items.length - 1}`}
                          {order.delivery_type === 'PICKUP' ? ' · 🏪 Pickup' : ' · 🚚 Delivery'}
                          {' · '}{formatDate(order.created_at)}
                        </div>
                        <div className={`font-extrabold text-sm mt-1 ${totalColor}`}>{formatRupiah(order.total)}</div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Leads section */}
              <div className="px-5 py-4 border-t border-gray-100">
                <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Leads ({profile.leads.length})
                </div>
                {profile.leads.length === 0 ? (
                  <p className="text-sm text-gray-400">Belum ada lead.</p>
                ) : (
                  profile.leads.map(lead => {
                    const badge = LEAD_BADGE[lead.status] ?? LEAD_BADGE.NEW;
                    return (
                      <div key={lead.id} className="border border-gray-200 rounded-lg p-3 mb-2 last:mb-0 flex justify-between items-center">
                        <div>
                          <div className="font-mono text-[11px] font-semibold text-gray-700">{lead.id}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Dibuat {formatDate(lead.created_at)}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                          <button
                            onClick={() => onNavigate('pipeline')}
                            className="text-[10px] text-gray-400 underline underline-offset-2 cursor-pointer"
                          >
                            Kelola di Pipeline →
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : null}
        </div>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: zero TypeScript errors. Selecting a customer in the Pelanggan screen should show their profile on the right.

- [ ] **Step 5: Commit**

```bash
git add src/components/PelangganScreen.tsx
git commit -m "feat(pelanggan): add right panel — profile header, stats, orders, leads"
```

---

## Task 6: Pipeline Improvements

**Files:**
- Modify: `src/components/PipelineScreen.tsx`

Add search, collapsible rows, items table for ORDERED leads, quick nav links, and `onOpenCustomer` prop.

- [ ] **Step 1: Update imports and props interface**

Replace the imports and interface at the top of `src/components/PipelineScreen.tsx`:
```typescript
import React, { useState, useEffect } from 'react';
import { TrendingUp, Search, ChevronDown } from 'lucide-react';
import { ActivePage, DbLead } from '../types';
import { leadsService, isSupabaseConfigured } from '../lib/supabaseClient';

interface PipelineScreenProps {
  onOpenCustomer: (customerId: string) => void;
  onNavigate: (page: ActivePage) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}
```

- [ ] **Step 2: Add `ItemsTable` component before `export default`**

Add before `export default function PipelineScreen`:
```typescript
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ItemsTable({ items, headerClass }: { items: DbLead['orders'][0]['items']; headerClass: string }) {
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
          Rp {items.reduce((s, i) => s + i.subtotal, 0).toLocaleString('id-ID')}<br />
          Rp {(items[0] as any)?._shipping_fee?.toLocaleString('id-ID') ?? '—'}<br />
          <strong className="text-gray-800">—</strong>
        </div>
      </div>
    </div>
  );
}
```

Wait — `ItemsTable` needs the full order for ongkir and total, not just items. Revise to accept the full order:

```typescript
function PipelineItemsTable({ order }: { order: NonNullable<DbLead['orders']>[0] }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden text-xs mb-3">
      <div className="grid grid-cols-4 px-3 py-2 font-bold uppercase tracking-wide text-[10px] bg-green-100 text-green-700">
        <span>Produk</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Harga</span>
        <span className="text-right">Subtotal</span>
      </div>
      {order.items.map((item, i) => (
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
        <div className="text-right text-gray-600 leading-relaxed min-w-[100px]">
          Rp {order.subtotal.toLocaleString('id-ID')}<br />
          Rp {(order.shipping_fee ?? 0).toLocaleString('id-ID')}<br />
          <strong className="text-gray-800">Rp {order.total.toLocaleString('id-ID')}</strong>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `filterLeads` to accept search string and update component signature**

Replace `filterLeads` function:
```typescript
function filterLeads(leads: DbLead[], tab: FilterTab, search: string): DbLead[] {
  let result = leads;
  switch (tab) {
    case 'active':    result = leads.filter(l => l.status === 'NEW' || l.status === 'IN_PROGRESS'); break;
    case 'escalated': result = leads.filter(l => l.status === 'ESCALATED'); break;
    case 'ordered':   result = leads.filter(l => l.status === 'ORDERED'); break;
    case 'dropped':   result = leads.filter(l => l.status === 'DROPPED'); break;
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter(l =>
      (l.customers?.name ?? '').toLowerCase().includes(q) ||
      l.wa_number.includes(q) ||
      (l.customers?.company ?? '').toLowerCase().includes(q)
    );
  }
  return result;
}
```

- [ ] **Step 4: Rewrite `PipelineScreen` component with full UI**

Replace the entire `export default function PipelineScreen` with:
```typescript
export default function PipelineScreen({ onOpenCustomer, onNavigate, showToast }: PipelineScreenProps) {
  const [leads, setLeads] = useState<DbLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    leadsService.fetchAll()
      .then(setLeads)
      .catch(() => showToast('Gagal memuat data pipeline.', 'warning'))
      .finally(() => setLoading(false));
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-800">Pipeline Penjualan</h1>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
          Supabase belum dikonfigurasi. Tambahkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY ke file .env untuk menggunakan fitur ini.
        </div>
      </div>
    );
  }

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all',       label: `Semua (${leads.length})` },
    { id: 'active',    label: `Aktif (${leads.filter(l => l.status === 'NEW' || l.status === 'IN_PROGRESS').length})` },
    { id: 'escalated', label: `Eskalasi (${leads.filter(l => l.status === 'ESCALATED').length})` },
    { id: 'ordered',   label: `Selesai (${leads.filter(l => l.status === 'ORDERED').length})` },
    { id: 'dropped',   label: `Gugur (${leads.filter(l => l.status === 'DROPPED').length})` },
  ];

  const visible = filterLeads(leads, activeTab, search);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Pipeline Penjualan</h1>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-[#012749] text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-400">
        <Search className="w-4 h-4 shrink-0" />
        <input
          className="flex-1 bg-transparent outline-none text-gray-700 placeholder:text-gray-400"
          placeholder="Cari nama, nomor WA, perusahaan..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">Memuat pipeline...</div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          {leads.length === 0
            ? 'Belum ada lead. Lead dibuat otomatis saat percakapan WhatsApp baru masuk.'
            : search.trim()
            ? 'Tidak ada lead yang cocok dengan pencarian.'
            : 'Tidak ada lead dengan status ini.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {visible.map(lead => {
            const badge = STATUS_BADGE[lead.status] ?? STATUS_BADGE.NEW;
            const customer = lead.customers;
            const isExpanded = expandedId === lead.id;
            const linkedOrder = lead.orders?.[0] ?? null;

            return (
              <div key={lead.id} className="border-b border-gray-100 last:border-0">
                {/* Collapsed row */}
                <div
                  className={`flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-gray-50' : ''}`}
                  onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span
                        className="font-semibold text-sm text-[#012749] underline underline-offset-2 cursor-pointer hover:opacity-80"
                        onClick={e => { e.stopPropagation(); if (customer?.id) onOpenCustomer(customer.id); }}
                      >
                        {customer?.name || lead.wa_number}
                      </span>
                      {customer?.company && (
                        <span className="text-xs text-gray-400 truncate hidden sm:block">· {customer.company}</span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-gray-400">{lead.wa_number}</p>
                  </div>
                  <div className="hidden md:block shrink-0">
                    <p className="text-xs font-mono text-gray-400">{lead.id.slice(0, 12)}...</p>
                  </div>
                  <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400 hidden sm:block">{relativeTime(lead.updated_at)}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                {/* Expanded row */}
                {isExpanded && (
                  lead.status === 'ORDERED' && linkedOrder ? (
                    <div className="px-6 py-4 border-t border-green-200 bg-green-50">
                      <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div>
                          <div className="font-semibold text-gray-700">{customer?.name || lead.wa_number}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div>
                          <div className="font-mono font-semibold text-gray-700">{lead.wa_number}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pesanan Terkait</div>
                          <span
                            className="font-semibold text-[#012749] underline underline-offset-2 cursor-pointer text-xs"
                            onClick={() => onNavigate('order-history')}
                          >
                            {linkedOrder.gjp_order_id ?? linkedOrder.id.slice(0, 8)} ↗
                          </span>
                        </div>
                      </div>
                      <PipelineItemsTable order={linkedOrder} />
                      <div className="flex gap-3 mt-1">
                        <button
                          onClick={() => onNavigate('sales-inbox')}
                          className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
                        >
                          → Buka Percakapan
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                      <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div>
                          <div className="font-semibold text-gray-700">{customer?.name || lead.wa_number}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div>
                          <div className="font-mono font-semibold text-gray-700">{lead.wa_number}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Status</div>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                        </div>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-500 text-center mb-3">
                        Lead ini belum memiliki pesanan terkonfirmasi.
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => onNavigate('sales-inbox')}
                          className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
                        >
                          → Buka Percakapan
                        </button>
                      </div>
                    </div>
                  )
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

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: zero TypeScript errors.

- [ ] **Step 6: Update App.tsx to pass new props to PipelineScreen**

In `src/App.tsx`, in `renderPage()`, replace the `'pipeline'` case:
```typescript
      case 'pipeline':
        return (
          <PipelineScreen
            onOpenCustomer={handleOpenCustomer}
            onNavigate={setActivePage}
            showToast={triggerToast}
          />
        );
```

Run: `npm run build` — must still pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/PipelineScreen.tsx src/App.tsx
git commit -m "feat(pipeline): add search, collapsible rows, items table for ORDERED leads, onOpenCustomer links"
```

---

## Task 7: OrderHistoryScreen — Customer Name Link + App.tsx Wiring

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `onOpenCustomer` prop to `OrderHistoryScreenProps`**

In `src/components/OrderHistoryScreen.tsx`, update the interface:
```typescript
interface OrderHistoryScreenProps {
  currentUser: { name: string; role: string; avatarUrl: string; storeName: string } | null;
  onOpenCustomer: (customerId: string) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}
```

Update function signature:
```typescript
export default function OrderHistoryScreen({ currentUser, onOpenCustomer, showToast }: OrderHistoryScreenProps) {
```

- [ ] **Step 2: Make customer name clickable in collapsed row**

In the collapsed row (around line 318), find:
```typescript
<div className="font-bold text-sm text-gray-800">{order.customer_name}</div>
```

Replace with:
```typescript
<div
  className="font-bold text-sm text-[#012749] underline underline-offset-2 cursor-pointer hover:opacity-80 inline"
  onClick={e => { e.stopPropagation(); if (order.customer_id) onOpenCustomer(order.customer_id); }}
>
  {order.customer_name}
</div>
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: TypeScript error about missing `onOpenCustomer` prop in App.tsx — expected, fix in next step.

- [ ] **Step 4: Pass `onOpenCustomer` to OrderHistoryScreen in App.tsx**

In `src/App.tsx`, update the `'order-history'` case:
```typescript
      case 'order-history':
        return (
          <OrderHistoryScreen
            currentUser={currentUser}
            onOpenCustomer={handleOpenCustomer}
            showToast={triggerToast}
          />
        );
```

- [ ] **Step 5: Final build verification**

Run: `npm run build`
Expected: zero TypeScript errors, build succeeds cleanly.

- [ ] **Step 6: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx src/App.tsx
git commit -m "feat(order-history): make customer name a link to Pelanggan profile"
```

---

## Self-Review

**Spec coverage:**
- ✅ Pelanggan split-view screen with left panel (list + search) — Task 4
- ✅ Right panel (profile header, stats, orders section, leads section) — Task 5
- ✅ `openCustomerId` prop + auto-select on navigation — Task 3 + 5
- ✅ Sidebar "Pelanggan" entry after Pipeline — Task 3
- ✅ `customersService.fetchAll()` and `fetchProfile()` — Task 2
- ✅ `leadsService.fetchAll()` extended with orders join — Task 2
- ✅ Pipeline search bar — Task 6
- ✅ Pipeline collapsible rows with chevron — Task 6
- ✅ Pipeline ORDERED expanded row: items table + order link + percakapan link — Task 6
- ✅ Pipeline non-ORDERED expanded row: info box + percakapan link — Task 6
- ✅ Pipeline customer name → onOpenCustomer — Task 6
- ✅ OrderHistoryScreen customer name → onOpenCustomer — Task 7
- ✅ App.tsx wiring (openCustomerId state, handleOpenCustomer, reset on page change) — Task 3 + 6 + 7
- ✅ All empty states — Tasks 4, 5, 6
- ✅ DbLead.orders field — Task 1

**Type consistency check:**
- `DbCustomerWithStats` defined in Task 1, used in Task 4 ✅
- `DbCustomerProfile` defined in Task 1, used in Task 5 ✅
- `customersService.fetchAll()` returns `DbCustomerWithStats[]` ✅
- `customersService.fetchProfile()` returns `DbCustomerProfile` ✅
- `onOpenCustomer: (customerId: string) => void` consistent across Tasks 3, 6, 7 ✅
- `handleOpenCustomer` defined in Task 3, passed in Tasks 6 and 7 ✅
- `PipelineItemsTable` accepts `order: NonNullable<DbLead['orders']>[0]` — this resolves to `DbOrder` since `DbLead.orders` is `DbOrder[] | undefined` ✅
